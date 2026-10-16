# OnlineJobs.ph Job Scraper (Apify Actor)

Scrapes public job listings from [OnlineJobs.ph](https://www.onlinejobs.ph) and saves them to an Apify dataset (JSON, CSV, Excel, or straight into n8n).

## Input

| Field | Description | Default |
|---|---|---|
| `keyword` | Search keyword, e.g. `Dynamics 365`. Ignored if `startUrls` is set. | |
| `employmentType` | `any`, `Full Time`, `Part Time` or `Gig`. Jobs marked "Any" are always kept. | `any` |
| `startUrls` | Search result URLs pasted from your browser (with your filters applied). | |
| `maxJobs` | Maximum jobs to return (30 jobs per search page). | `100` |
| `includeDetails` | Open each job page for the full description, hours per week and date updated. | `true` |
| `postedWithinDays` | Only keep jobs posted in the last N days. `0` = off. Good for daily schedules. | `0` |
| `startDate` | Only keep jobs posted on or after this date (`YYYY-MM-DD`, inclusive). Overrides `postedWithinDays`. | |
| `endDate` | Only keep jobs posted on or before this date (`YYYY-MM-DD`, inclusive). | |
| `requestDelaySecs` | Seconds between requests. The site's robots.txt asks for 5. | `5` |
| `proxyConfiguration` | Apify Proxy settings. | Apify Proxy on |

## Output

One record per job:

```json
{
  "jobUrl": "https://www.onlinejobs.ph/jobseekers/job/microsoft-dynamics-and-power-apps-developer-1725257",
  "jobId": "1725257",
  "jobTitle": "Microsoft Dynamics and Power Apps Developer",
  "employerName": null,
  "employmentType": "Full Time",
  "salary": "$5/hour",
  "hoursPerWeek": 40,
  "datePosted": "2026-10-14 08:12:03",
  "dateUpdated": "2026-10-13",
  "descriptionSnippet": "Microsoft Dynamics 365 & Power Platform Developer ...",
  "fullDescription": "Microsoft Dynamics 365 & Power Platform Developer\n\n...",
  "skills": ["Microsoft Dynamics 365", "Power Automate", "AI Automation"],
  "scrapedAt": "2026-10-16T01:00:00.000Z"
}
```

Notes:
- `employerName` is only filled when the search page shows an employer label (some cards do). Otherwise it is `null`; the site hides employer details from logged-out visitors.
- `salary` is the free text the employer typed (`5`, `$5/hour`, `TBD`, `PHP 80,000 – 130,000 / month`), so it is not normalised.
- `datePosted` is the timestamp shown on the site, in the site's own time zone.
- Fields such as `isRemote` and `benefits` do not exist on this site. Every job is remote, and benefits are part of the free-text description.

## Rate limiting

The site's robots.txt asks for a 5 second crawl delay, so the actor runs one request at a time with a 5 second gap. Roughly: 100 jobs with details is about 9 minutes; 100 jobs without details is about 20 seconds. Please keep it that way.

## Deploy

```bash
npm install -g apify-cli
apify login
cd onlinejobs-ph-scraper
npm install
apify run        # optional local run: put input in storage/key_value_stores/default/INPUT.json
apify push       # deploys to your Apify account
```

Run `npm test` to check the parsing logic. The tests use synthetic HTML, so do one real run after deploying and look at the dataset.

## Using it in n8n

Use the Apify node's "Run an Actor" then "Get dataset items" (as in your workflow). Map the fields like this:

- `{{ $json.jobTitle }}`, `{{ $json.salary }}`, `{{ $json.employmentType }}`
- `{{ $json.fullDescription }}` instead of `descriptionText`
- `{{ $json.skills.join(', ') }}`

## Terms

Only scrape public pages, keep the request rate low, and check [OnlineJobs.ph's Terms of Use](https://www.onlinejobs.ph/terms) for your use case. Don't use the data to contact or profile people.
