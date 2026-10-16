import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { parseSearchPage, parseJobPage, redactContactInfo } from './parsers.js';

const SEARCH_BASE = 'https://www.onlinejobs.ph/jobseekers/jobsearch';
const PAGE_SIZE = 30;

await Actor.init();

const {
    keyword = '',
    employmentType = 'any',
    startUrls = [],
    maxJobs = 100,
    includeDetails = true,
    postedWithinDays = 0,
    startDate = '',
    endDate = '',
    requestDelaySecs = 5,
    redactContactInfo: redact = true,
    proxyConfiguration,
} = (await Actor.getInput()) ?? {};

/** Search page URL for a given offset (0, 30, 60, ...), keeping the query string. */
function pageUrl(urlStr, offset) {
    const u = new URL(urlStr);
    const base = u.pathname.replace(/\/\d+\/?$/, '').replace(/\/$/, '');
    u.pathname = offset > 0 ? `${base}/${offset}` : base;
    return u.toString();
}

function offsetOf(urlStr) {
    const m = new URL(urlStr).pathname.match(/\/(\d+)\/?$/);
    return m ? Number(m[1]) : 0;
}

function buildStartRequests() {
    const urls = startUrls.map((s) => (typeof s === 'string' ? s : s.url)).filter(Boolean);
    if (urls.length === 0) {
        const u = new URL(SEARCH_BASE);
        if (keyword.trim()) u.searchParams.set('jobkeyword', keyword.trim());
        urls.push(u.toString());
    }
    return urls.map((url) => ({
        url,
        label: 'LIST',
        userData: { offset: offsetOf(url) },
    }));
}

const typeFilter = employmentType && employmentType !== 'any' ? employmentType : null;
const matchesType = (job) =>
    !typeFilter || !job.employmentType || job.employmentType === 'Any' || job.employmentType === typeFilter;

// Date filter on the "date posted" shown on the site. Compared as YYYY-MM-DD strings (inclusive),
// so the site's own time zone never shifts a job across the boundary.
const dayString = (d) => d.toISOString().slice(0, 10);
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v ?? '') ? v.slice(0, 10) : null);
const fromDay =
    isoDay(startDate) ?? (postedWithinDays > 0 ? dayString(new Date(Date.now() - postedWithinDays * 86_400_000)) : null);
const toDay = isoDay(endDate);
if (fromDay && toDay && fromDay > toDay) throw new Error(`startDate (${fromDay}) is after endDate (${toDay}).`);

const dayOf = (job) => isoDay(job.datePosted);
const isTooOld = (job) => !!fromDay && !!dayOf(job) && dayOf(job) < fromDay;
const isTooNew = (job) => !!toDay && !!dayOf(job) && dayOf(job) > toDay;

const seen = new Set();
let accepted = 0;

const clean = (text) => (redact ? redactContactInfo(text) : text);

const toRecord = (listing, detail = {}) => {
    const pick = (key) => detail[key] ?? listing[key] ?? null;
    return {
        jobUrl: listing.jobUrl,
        jobId: listing.jobId,
        jobTitle: pick('jobTitle'),
        employerName: listing.employerName ?? null,
        employmentType: pick('employmentType'),
        salary: pick('salary'),
        hoursPerWeek: detail.hoursPerWeek ?? null,
        datePosted: listing.datePosted ?? null,
        dateUpdated: detail.dateUpdated ?? null,
        descriptionSnippet: clean(listing.descriptionSnippet ?? null),
        fullDescription: clean(detail.fullDescription ?? null),
        skills: detail.skills?.length ? detail.skills : listing.skills ?? [],
        scrapedAt: new Date().toISOString(),
    };
};

/** Next step of the endDate search: probe the middle page, or start listing once lo === hi. */
async function enqueueProbeOrList(c, listUrl, lo, hi) {
    if (lo >= hi) {
        const start = lo * PAGE_SIZE;
        log.info(`Starting listing at offset ${start}.`);
        await c.addRequests([
            { url: pageUrl(listUrl, start), uniqueKey: `list:${start}:${listUrl}`, label: 'LIST', userData: { offset: start } },
        ]);
        return;
    }
    const mid = Math.floor((lo + hi) / 2);
    await c.addRequests([
        {
            url: pageUrl(listUrl, mid * PAGE_SIZE),
            uniqueKey: `probe:${mid}:${listUrl}`,
            label: 'PROBE',
            userData: { offset: mid * PAGE_SIZE, lo, hi, listUrl },
        },
    ]);
}

const proxy = await Actor.createProxyConfiguration(proxyConfiguration);

const crawler = new CheerioCrawler({
    proxyConfiguration: proxy,
    // robots.txt asks for "Crawl-delay: 5", so go one request at a time.
    maxConcurrency: 1,
    sameDomainDelaySecs: requestDelaySecs,
    maxRequestRetries: 4,
    requestHandlerTimeoutSecs: 60,
    preNavigationHooks: [
        (_ctx, gotOptions) => {
            gotOptions.headers = { ...gotOptions.headers, 'accept-language': 'en-US,en;q=0.9' };
        },
    ],

    async requestHandler({ request, $, crawler: c }) {
        if (request.label === 'DETAIL') {
            const detail = parseJobPage($, request.loadedUrl ?? request.url);
            await Actor.pushData(toRecord(request.userData.listing, detail));
            return;
        }

        const offset = request.userData.offset ?? 0;
        const { jobs, total } = parseSearchPage($);

        // PROBE page: binary search for the first page that reaches endDate. Results are sorted
        // newest first, so a page whose last job is still newer than endDate can be skipped whole.
        if (request.label === 'PROBE') {
            let { lo, hi, listUrl } = request.userData;
            const last = jobs.at(-1);
            if (last && isTooNew(last)) lo = offset / PAGE_SIZE + 1;
            else hi = offset / PAGE_SIZE;
            await enqueueProbeOrList(c, listUrl, lo, hi);
            return;
        }

        // LIST page
        log.info(
            `Search page (offset ${offset}): ${jobs.length} jobs parsed` +
                (total !== null ? `, site reports ${total} matching jobs` : ''),
        );
        if (jobs.length === 0) {
            log.warning('No jobs parsed from this page. The layout may have changed or the request was blocked.');
            return;
        }

        let tooOld = 0;
        for (const job of jobs) {
            if (seen.has(job.jobId)) continue;
            seen.add(job.jobId);
            if (isTooOld(job)) {
                tooOld++;
                continue;
            }
            if (isTooNew(job)) continue;
            if (accepted >= maxJobs || !matchesType(job)) continue;
            accepted++;
            if (includeDetails) {
                await c.addRequests([
                    { url: job.jobUrl, uniqueKey: job.jobId, label: 'DETAIL', userData: { listing: job } },
                ]);
            } else {
                await Actor.pushData(toRecord(job));
            }
        }

        const hasMore = total !== null ? offset + PAGE_SIZE < total : jobs.length >= PAGE_SIZE;
        // Sorted newest first: once one job is older than startDate, every later page is too.
        const reachedOlder = tooOld > 0;

        // First page is entirely newer than endDate: jump ahead instead of walking every page.
        if (offset === 0 && total !== null && hasMore && isTooNew(jobs.at(-1))) {
            log.info(`Page 1 is entirely newer than ${toDay}; searching for the first page in range.`);
            await enqueueProbeOrList(c, request.url, 1, Math.ceil(total / PAGE_SIZE) - 1);
            return;
        }

        if (accepted < maxJobs && hasMore && !reachedOlder) {
            const next = offset + PAGE_SIZE;
            await c.addRequests([
                { url: pageUrl(request.url, next), label: 'LIST', userData: { offset: next } },
            ]);
        }
    },

    // If a job page keeps failing (e.g. the post was removed), keep the data we got from the list.
    async failedRequestHandler({ request }, error) {
        log.error(`Request failed after retries: ${request.url} (${error.message})`);
        if (request.label === 'DETAIL' && request.userData?.listing) {
            await Actor.pushData(toRecord(request.userData.listing));
        }
    },
});

await crawler.run(buildStartRequests());
log.info(`Done. Collected ${accepted} jobs.`);
await Actor.setStatusMessage(`Collected ${accepted} jobs`);
await Actor.exit();
