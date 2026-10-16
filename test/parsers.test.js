// Run with: npm test
// The HTML below is SYNTHETIC: hand-written to mimic the structure seen on onlinejobs.ph.
// It checks the parsing logic, not the live site markup.
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { parseSearchPage, parseJobPage, parseJobHref } from '../src/parsers.js';

const searchHtml = `
<html><body>
<nav><a href="/jobseekers/jobsearch">find jobs</a></nav>
<p>Displaying 30 out of 295 jobs</p>
<div class="results">
  <div class="job-post">
    <a href="https://www.onlinejobs.ph/jobseekers/job/operations-admin-assistant-1750230"><div><h4>Operations, Admin and Job Scheduling Assistant <small>Full Time</small></h4><em>Posted on 2026-10-15 13:52:21</em> <span>55000-60000</span></div></a>
    <a href="/jobseekers/job/operations-admin-assistant-1750230">A growing family-owned lawn care business based in Perth is looking for an experienced assistant…</a>
    <a href="/jobseekers/job/operations-admin-assistant-1750230">See More</a>
    <a href="/jobseekers/search/c/management-services--administrative-management">Administrative Management</a>
    <a href="/jobseekers/search/c/customer-support--customer-service">Customer Service</a>
  </div>
  <div class="job-post">
    <a href="/jobseekers/job/paid-media-buyer-1750214">Test Employer</a>
    <a href="/jobseekers/job/paid-media-buyer-1750214">Paid Media Buyer (Performance Marketing) Full Time *Posted on 2026-10-15 13:16:04* USD $1,000 - $1,400 / month</a>
    <a href="/jobseekers/job/paid-media-buyer-1750214">You own two of our four newer channels and grow them: TikTok, Snapchat, Reddit, Taboola…</a>
    <a href="/jobseekers/job/paid-media-buyer-1750214">See More</a>
  </div>
  <div class="job-post">
    <a href="/jobseekers/job/attorney-full-time-1677012">Attorney | Lawyer | Full-Time | Full Time *Posted on 2026-10-14 13:10:15* $5+ Per Hour</a>
    <a href="/jobseekers/job/attorney-full-time-1677012">Attorney | Lawyer | Full-Time | Potential Long Term Opportunity for attorneys…</a>
  </div>
</div>
</body></html>`;

const jobHtml = `
<html><head><title>Microsoft Dynamics and Power Apps Developer 1725257 - OnlineJobs.ph</title></head>
<body>
<nav><a href="/login">log in</a></nav>
<h1>Microsoft Dynamics and Power Apps Developer</h1>
<div><img src="x.jpg"><h3>TYPE OF WORK</h3><p>Full Time</p></div>
<div><img src="x.jpg"><h3>WAGE / SALARY</h3><p>$5/hour</p></div>
<div><img src="x.jpg"><h3>HOURS PER WEEK</h3><p>40</p></div>
<div><img src="x.jpg"><h3>DATE UPDATED</h3><p>Oct 13, 2026</p></div>
<div><strong>JOB OVERVIEW</strong><br>
Microsoft Dynamics 365 &amp; Power Platform Developer<br><br>
Responsibilities<br>
<ul><li>Build Power Apps</li><li>Build Power Automate flows</li></ul>
Please include the text 'OHmazing Tech' in your submission.
</div>
<div><strong>SKILL REQUIREMENT</strong>
<a href="/jobseekers/search/c/crm--microsoft-dynamics-365">Microsoft Dynamics 365</a>
<a href="/jobseekers/search/c/saas--power-automate">Power Automate</a>
</div>
<div>VIEW OTHER JOB POSTS FROM:</div>
<footer>Copyright</footer>
</body></html>`;

// parseJobHref
assert.deepEqual(parseJobHref('/jobseekers/job/foo-bar-20261014-1750198'), {
    jobId: '1750198',
    jobUrl: 'https://www.onlinejobs.ph/jobseekers/job/foo-bar-20261014-1750198',
});
assert.equal(parseJobHref('/jobseekers/search/c/crm'), null);
assert.equal(parseJobHref('https://example.com/jobseekers/job/x-123'), null);

// Search page
const { jobs, total } = parseSearchPage(load(searchHtml));
assert.equal(total, 295);
assert.equal(jobs.length, 3);

const [a, b, c] = jobs;
assert.equal(a.jobId, '1750230');
assert.equal(a.jobTitle, 'Operations, Admin and Job Scheduling Assistant');
assert.equal(a.employmentType, 'Full Time');
assert.equal(a.datePosted, '2026-10-15 13:52:21');
assert.equal(a.salary, '55000-60000');
assert.match(a.descriptionSnippet, /lawn care/);
assert.deepEqual(a.skills, ['Administrative Management', 'Customer Service']);
assert.equal(a.employerName, null);

assert.equal(b.jobTitle, 'Paid Media Buyer (Performance Marketing)');
assert.equal(b.salary, 'USD $1,000 - $1,400 / month');
assert.equal(b.employerName, 'Test Employer');
assert.deepEqual(b.skills, []);

// The title itself ends with "Full-Time |"; only the trailing "Full Time" badge is the type.
assert.equal(c.jobTitle, 'Attorney | Lawyer | Full-Time |');
assert.equal(c.employmentType, 'Full Time');
assert.equal(c.salary, '$5+ Per Hour');
assert.deepEqual(a.skills.length, 2); // skills are scoped to their own card

// Detail page
const d = parseJobPage(
    load(jobHtml),
    'https://www.onlinejobs.ph/jobseekers/job/microsoft-dynamics-and-power-apps-developer-1725257',
);
assert.equal(d.jobId, '1725257');
assert.equal(d.jobTitle, 'Microsoft Dynamics and Power Apps Developer');
assert.equal(d.employmentType, 'Full Time');
assert.equal(d.salary, '$5/hour');
assert.equal(d.hoursPerWeek, 40);
assert.equal(d.dateUpdated, '2026-10-13');
assert.deepEqual(d.skills, ['Microsoft Dynamics 365', 'Power Automate']);
assert.match(d.fullDescription, /^Microsoft Dynamics 365 & Power Platform Developer/);
assert.match(d.fullDescription, /• Build Power Apps/);
assert.match(d.fullDescription, /OHmazing Tech/);
assert.doesNotMatch(d.fullDescription, /SKILL REQUIREMENT|VIEW OTHER JOB POSTS|Copyright/);

console.log('All parser tests passed.');
