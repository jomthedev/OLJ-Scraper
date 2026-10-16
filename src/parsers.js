// Pure parsing helpers. They take a Cheerio `$` and return plain objects,
// so they can be tested without network access.

const BASE = 'https://www.onlinejobs.ph';
const JOB_PATH_RE = /\/jobseekers\/job\/[^/?#]*-(\d+)\/?(?:[?#]|$)/;
const JOB_LINK_SELECTOR = 'a[href*="/jobseekers/job/"]';
const SKILL_LINK_SELECTOR = 'a[href*="/jobseekers/search/c/"]';

export const normalizeText = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Extracts the job id and canonical URL from a job link. Returns null for anything else. */
export function parseJobHref(href) {
    if (!href) return null;
    const m = href.match(JOB_PATH_RE);
    if (!m) return null;
    let url;
    try {
        url = new URL(href, BASE);
    } catch {
        return null;
    }
    if (!/(^|\.)onlinejobs\.ph$/i.test(url.hostname)) return null;
    return { jobId: m[1], jobUrl: BASE + url.pathname.replace(/\/$/, '') };
}

/** Text of an element with a space between child elements so nothing gets glued together. */
function spacedText($, el) {
    const clone = $(el).clone();
    clone.find('*').each((_, e) => {
        $(e).append(' ');
    });
    return normalizeText(clone.text());
}

/** Text of an element that keeps line breaks between blocks, <br> and list items. */
function blockText($, root) {
    const clone = $(root).clone();
    clone.find('script,style,noscript').remove();
    clone.find('br').replaceWith('\n');
    clone.find('li').each((_, e) => {
        $(e).prepend('• ');
    });
    clone.find('p,div,li,h1,h2,h3,h4,h5,h6,tr,ul,ol').each((_, e) => {
        $(e).append('\n');
    });
    return clone
        .text()
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function normalizeType(t) {
    if (!t) return null;
    const s = t.toLowerCase().replace(/-/g, ' ').trim();
    if (s.startsWith('full')) return 'Full Time';
    if (s.startsWith('part')) return 'Part Time';
    if (s === 'gig') return 'Gig';
    if (s === 'any') return 'Any';
    return normalizeText(t);
}

/**
 * Header text looks like: `<title> <type> *Posted on 2026-10-15 13:52:21* <salary>`
 */
function parseHeader(text) {
    const m = text.match(
        /\*?\s*Posted on\s+(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)\s*\*?/i,
    );
    if (!m) return null;
    const before = text.slice(0, m.index).trim();
    const after = text.slice(m.index + m[0].length).trim();
    const tm = before.match(/^(.*?)\s*\b(Full[- ]Time|Part[- ]Time|Gig|Any)\s*$/i);
    return {
        title: tm ? tm[1].trim() : before,
        type: tm ? normalizeType(tm[2]) : null,
        datePosted: m[1],
        salary: after || null,
    };
}

/**
 * Parses a search result page.
 * @returns {{ jobs: object[], total: number | null }}
 */
export function parseSearchPage($) {
    const bodyText = normalizeText($('body').text());
    const totalMatch = bodyText.match(/Displaying\s+\d+\s+out of\s+([\d,]+)\s+jobs/i);
    const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;

    // Group every link by job id: each card has several links to the same job.
    const groups = new Map();
    $(JOB_LINK_SELECTOR).each((_, a) => {
        const parsed = parseJobHref($(a).attr('href'));
        if (!parsed) return;
        if (!groups.has(parsed.jobId)) groups.set(parsed.jobId, { ...parsed, anchors: [] });
        groups.get(parsed.jobId).anchors.push(a);
    });

    const jobs = [];
    for (const group of groups.values()) {
        const entries = group.anchors
            .map((a) => ({ a, text: spacedText($, a) }))
            .filter((e) => e.text);

        const headerEntry = entries.find((e) => /Posted on/i.test(e.text));
        if (!headerEntry) continue; // a job link that is not a result card
        const header = parseHeader(headerEntry.text);
        if (!header) continue;

        // Climb to the card: the largest ancestor that only contains this job's links.
        let card = $(headerEntry.a);
        while (card.parent().length && !card.parent().is('body, html')) {
            const parent = card.parent();
            const containsOtherJob = parent
                .find(JOB_LINK_SELECTOR)
                .toArray()
                .some((x) => {
                    const p = parseJobHref($(x).attr('href'));
                    return p && p.jobId !== group.jobId;
                });
            if (containsOtherJob) break;
            card = parent;
        }

        const others = entries.filter(
            (e) =>
                e !== headerEntry &&
                !e.text.startsWith('/jobseekers/') &&
                !/^see more$/i.test(e.text),
        );
        const snippetEntry = others.reduce(
            (best, e) => (!best || e.text.length > best.text.length ? e : best),
            null,
        );
        // Some cards show a short employer label as an extra link to the same job.
        const employerEntry = others.find((e) => e !== snippetEntry && e.text.length <= 80);

        const skills = [
            ...new Set(
                card
                    .find(SKILL_LINK_SELECTOR)
                    .toArray()
                    .map((s) => normalizeText($(s).text()))
                    .filter(Boolean),
            ),
        ];

        jobs.push({
            jobId: group.jobId,
            jobUrl: group.jobUrl,
            jobTitle: header.title,
            employerName: employerEntry ? employerEntry.text : null,
            employmentType: header.type,
            salary: header.salary,
            datePosted: header.datePosted,
            descriptionSnippet: snippetEntry ? snippetEntry.text : null,
            skills,
        });
    }
    return { jobs, total };
}

const LABELS = [
    'TYPE OF WORK',
    'WAGE / SALARY',
    'HOURS PER WEEK',
    'DATE UPDATED',
    'JOB OVERVIEW',
    'SKILL REQUIREMENT',
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normLabel = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** Reads the value that follows a label line such as "TYPE OF WORK". */
function readLabelled(lines, label) {
    const re = new RegExp(
        '^' + label.split(' ').map(escapeRe).join('\\s+') + '\\s*:?\\s*(.*)$',
        'i',
    );
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (!m) continue;
        if (m[1].trim()) return m[1].trim();
        const next = lines[i + 1];
        if (!next || LABELS.includes(normLabel(next))) return null;
        return next;
    }
    return null;
}

function toIsoDate(s) {
    if (!s) return null;
    const d = new Date(`${s} UTC`);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

/** Parses a job detail page. */
export function parseJobPage($, pageUrl) {
    const ref = parseJobHref(pageUrl);
    const text = blockText($, $('body'));
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    let jobTitle = normalizeText($('h1').first().text());
    if (!jobTitle) {
        jobTitle = normalizeText($('title').first().text())
            .replace(/\s*-\s*OnlineJobs\.ph\s*$/i, '')
            .replace(/\s+\d{6,}$/, '');
    }

    const hours = readLabelled(lines, 'HOURS PER WEEK');
    const descMatch = text.match(
        /JOB OVERVIEW\s*([\s\S]*?)(?:\n\s*SKILL REQUIREMENTS?\s*(?:\n|$)|\n\s*VIEW OTHER JOB POSTS FROM|\n\s*SHARE THIS POST|$)/i,
    );

    const skills = [
        ...new Set(
            $(SKILL_LINK_SELECTOR)
                .toArray()
                .map((s) => normalizeText($(s).text()))
                .filter(Boolean),
        ),
    ];

    return {
        jobId: ref ? ref.jobId : null,
        jobUrl: ref ? ref.jobUrl : pageUrl,
        jobTitle: jobTitle || null,
        employmentType: normalizeType(readLabelled(lines, 'TYPE OF WORK')),
        salary: readLabelled(lines, 'WAGE / SALARY'),
        hoursPerWeek: hours && /^\d+$/.test(hours) ? Number(hours) : hours,
        dateUpdated: toIsoDate(readLabelled(lines, 'DATE UPDATED')),
        fullDescription: descMatch ? descMatch[1].replace(/\n{3,}/g, '\n\n').trim() || null : null,
        skills,
    };
}

const REDACTED = '[redacted]';
const EMAIL_RE = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
// Obfuscated emails such as "jane [at] gmail [dot] com". Only bracketed forms, so prose like "work at home" is left alone.
const OBFUSCATED_EMAIL_RE = /[\w.+-]+\s*[[({]\s*at\s*[\])}]\s*[\w-]+(?:\s*(?:[[({]\s*dot\s*[\])}]|\.)\s*[\w-]+)+/gi;
const PROFILE_URL_RE =
    /\b(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook\.com|fb\.com|m\.me|linkedin\.com\/in|wa\.me|t\.me|telegram\.me|instagram\.com|twitter\.com|x\.com|calendly\.com)\/[^\s<>()]+/gi;
const MESSENGER_ID_RE =
    /\b(skype|telegram|discord|viber|wechat|whatsapp|signal|kik)(\s*(?:id|name|handle|username|number|no\.?|#)?\s*[:=-]\s*)(?:live:)?[^\s,;]+/gi;
const HANDLE_RE = /(^|[\s(])@[A-Za-z0-9_][A-Za-z0-9_.]{2,}/g;
// Candidate phone numbers: an optional "+", then digits with spaces, dots, dashes or parentheses between them.
const PHONE_CANDIDATE_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;

/** True when a digit run looks like a phone number rather than a salary, range or date. */
function looksLikePhone(s) {
    const digits = s.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(s.trim())) return false; // date
    if (s.trim().startsWith('+')) return true;
    if (/^(?:0|63)?9\d{9}$/.test(digits)) return true; // PH mobile: 09xx / 639xx
    if (/\(\d{2,4}\)/.test(s)) return true; // area code in parentheses
    if (/^\s*\d{3,4}[\s.-]\d{3,4}[\s.-]\d{4}\s*$/.test(s)) return true; // 3-3-4 / 4-3-4 groups
    if (/^\s*\d{3}[\s.-]\d{4}\s*$/.test(s)) return true; // 7-digit local 123-4567
    return /^\d{10,13}$/.test(s.trim()); // long unformatted number
}

/**
 * Replaces emails, phone numbers, messenger IDs, @handles and personal profile links with "[redacted]".
 * Company websites and ordinary numbers (salaries, ranges, dates) are kept.
 */
export function redactContactInfo(text) {
    if (!text) return text;
    return text
        .replace(EMAIL_RE, REDACTED)
        .replace(OBFUSCATED_EMAIL_RE, REDACTED)
        .replace(PROFILE_URL_RE, REDACTED)
        .replace(MESSENGER_ID_RE, (_m, app, sep) => `${app}${sep}${REDACTED}`)
        .replace(HANDLE_RE, (_m, pre) => `${pre}${REDACTED}`)
        .replace(PHONE_CANDIDATE_RE, (m) => (looksLikePhone(m) ? REDACTED : m));
}
