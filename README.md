# Job Tracker

A personal job-application tracker built as a Chrome extension plus a Google Apps Script
backend. Capture a job posting from the browser in one click, get an AI-drafted outreach
message and cover letter, log everything to a Google Sheet — and let the backend keep each
application's status current by reading Gmail.

> This is a personal tool built for a real job search, not a product. It's published here as a
> small, complete example of an end-to-end system: browser extension → serverless backend →
> spreadsheet, with an LLM and an email-parsing job wired in.

---

## What it does

1. **Capture.** You open a job posting on a supported portal and click the extension. A content
   script scrapes the company, position, full description, and URL from the page DOM.
2. **Draft.** The extension posts the job to the Apps Script backend, which calls the Anthropic
   Messages API (`claude-haiku-4-5`) to write a short outreach message, pick up the recruiter's
   name if the posting names one, and return the right CV link — in Spanish or English,
   whichever you chose with the language toggle.
3. **Cover letter (optional).** The same backend builds a prompt from your stored resume text
   and the scraped description, drafts a letter, renders it into a formatted Google Doc with a
   letterhead, exports it to PDF into a `Cover Letters` Drive folder, and returns the link.
4. **Log.** The completed record is appended as a row to a Google Sheet.
5. **Track.** Every 6 hours, a time-based trigger reads Gmail, matches job-related messages
   against the rows in the sheet, and moves each application's stage forward automatically.

The extension and web form are in Spanish; generated content can be Spanish or English.

## Architecture

```
┌──────────────────────────┐
│  Chrome extension (MV3)  │
│  content.js  — scrapes   │
│  popup.js    — UI + POST │
└────────────┬─────────────┘
             │  POST /exec  {action: analyze | coverLetter | addRow}
             ▼
┌───────────────────────────────────────────────────────┐
│  Google Apps Script web app (Code.js)                 │
│                                                       │
│  doPost ──┬─ analyze      → Anthropic Messages API    │
│           ├─ coverLetter  → Anthropic + Docs + Drive  │
│           └─ addRow       → Sheets                    │
│                                                       │
│  doGet  ──── index.html (standalone manual-entry form)│
│                                                       │
│  actualizarEstadosDesdeCorreo()   ← 6-hour trigger    │
│      GmailApp + SpreadsheetApp + PropertiesService    │
│      (no AI, no external calls)                       │
└────────────┬──────────────────────────────────────────┘
             ▼
     Google Sheet (one row per application)
```

**Design note — the extension holds no secrets.** The Anthropic API key, CV links, resume text,
and contact details live only in Apps Script's Script Properties, server-side. The extension's
sole setting is the web-app URL. An earlier version called Anthropic directly from the popup,
which meant shipping an API key inside the extension; that logic now lives entirely in the
backend.

### Repository layout

| Path | What it is |
| --- | --- |
| `extension/manifest.json` | Manifest V3: permissions, host permissions, content-script matches |
| `extension/content.js` | Per-portal DOM scraping, with a JSON-LD `JobPosting` fast path and a generic `h1`/`h2`/`article` fallback |
| `extension/popup.html` / `popup.js` | Popup UI, language toggle, backend calls, config screen |
| `apps-script/Code.js` | The whole backend: `doGet`/`doPost`, the three actions, and the Gmail status updater |
| `apps-script/index.html` | Standalone web form served by `doGet` — manual entry outside the extension, calling the same server functions via `google.script.run` |
| `apps-script/appsscript.json` | Runtime config (V8; web app runs as `USER_DEPLOYING`, access `MYSELF`) |

## Supported job portals

Each portal has its own scraping logic in `content.js`; anything else falls back to a generic
scrape.

| Portal | URL pattern |
| --- | --- |
| LinkedIn | `linkedin.com/jobs/view/*` |
| El Empleo | `elempleo.com/co/ofertas-trabajo/*`, `elempleo.com/co/JobOffers/*` |
| Computrabajo | `co.computrabajo.com/*` |
| Himalayas | `himalayas.app/companies/*/jobs/*` |
| Magneto365 | `magneto365.com/co/empleos/*` |

## The sheet

`addRow` appends eleven columns, A–K. Column L is added by hand and written by the status
tracker.

| Col | Field | Col | Field |
| --- | --- | --- | --- |
| A | Company | G | Deadline |
| B | Contact person | H | CV link |
| C | Application date | I | Cover letter link |
| D | **Stage** | J | Job posting URL |
| E | Source / type | K | Outreach message / notes |
| F | Position | L | Last status change *(manual column — see setup)* |

Stages: `Aplicado` → `Visto por reclutador` → `En revisión` → `Entrevista` → `Oferta`, plus
`Rechazado` and `Sin respuesta`.

## Status tracking via Gmail

`actualizarEstadosDesdeCorreo()` runs on a 6-hour time-based trigger and keeps column D current.
It uses **no AI and makes no external HTTP calls at all** — only `GmailApp`, `SpreadsheetApp`,
and `PropertiesService` — so it costs nothing per run.

How a run works:

1. **Read the sheet** into a list of `{company, position, current stage, last change date}`.
2. **Search Gmail** for messages from known job-portal domains or with application-related
   subjects, using `after:<date>` derived from the last successful run (stored in the
   `EST_LAST_RUN` script property, with a one-day safety margin). Only the very first run falls
   back to a wide 30-day window, so an outage longer than a few days doesn't lose emails
   permanently.
3. **Evaluate every message individually** — not just each thread's latest message, and not the
   thread as a unit. Already-seen message IDs are recorded in `EST_PROCESSED_MSG_IDS`. This is
   deliberately per-message rather than a per-thread Gmail label: an earlier design labeled the
   whole thread as processed, which silently skipped later replies in that same thread.
4. **Match message → application** by token overlap on company and position, after normalizing
   text (accents, case, and punctuation stripped) and dropping generic words and corporate
   suffixes — so `Acme Consulting Europe & Latam S.A.S.` in the sheet still matches an email
   that only says `Acme Consulting`. Ambiguous matches (the position matches several open applications but the company
   matches none) are skipped rather than guessed.
5. **Classify the stage** with Spanish/English keyword rules (`EST_REGLAS`).
6. **Only move forward.** Stages are ranked (`EST_RANK`); a run never downgrades one.
7. **Stale rule.** A row with no status change in 30 days that isn't already `Rechazado`,
   `Oferta`, or `Sin respuesta` becomes **`Sin respuesta`** — never `Rechazado`, because silence
   isn't a rejection. `Sin respuesta` ranks at 0, so a real email later still overrides it. This
   pass runs after the email pass, using each row's post-update state.
8. **Prune and record.** Processed message IDs older than 35 days are dropped (the date-based
   search will never look that far back again, so the property can't grow unbounded), and the
   run's start time is saved as the new `EST_LAST_RUN`.

Two details worth calling out, both fixes for real false positives:

- The `Oferta` rule deliberately **excludes the bare phrase "oferta de empleo"**. In Spanish
  that almost always just means "job posting" — it's how portals refer to the listing itself,
  not to an offer extended to you. Only phrases where *ofrecer* clearly points at the candidate
  (`nos complace ofrecerte`, `te ofrecemos el puesto`, `offer letter`) count as a real offer.
- Column L exists because "days since the last real status change" can't be derived from the
  application date alone once a row has been updated. Rows that predate the column fall back to
  the application date in column C, so no manual backfill is needed.

Helper functions:

| Function | What it does |
| --- | --- |
| `instalarTriggerEstados()` | Installs (or reinstalls) the 6-hour trigger. Run once. |
| `probarEstados()` | Runs one real pass immediately and logs the result. |
| `diagnosticoEstados()` | **Read-only dry run** over a fixed 4-day window, independent of `EST_LAST_RUN`. Logs which job each email matched and which stage was detected, without writing to the sheet or touching the processed-message tracking. |
| `estLimpiarEtiqueta()` | Clears `EST_PROCESSED_MSG_IDS` and `EST_LAST_RUN` to force a full re-evaluation. Despite the name it no longer touches Gmail labels — the label mechanism was replaced by script properties. |

---

## Setup

You'll need a Google account, a Chrome-based browser, and an
[Anthropic API key](https://console.anthropic.com/).

### 1. Create the Google Sheet

Create a spreadsheet with a tab named `Sheet1` and a header row matching the eleven columns
above, plus:

- **Column L** — e.g. *"Última actualización de estado"*, date-formatted. Required by the stale
  rule. If column L is already taken in your sheet, point `EST_COL_LAST_CHANGE` in `Code.js` at
  a free column instead.
- **Column D data validation** — if you use a dropdown, its list must include every stage the
  script writes, including `Visto por reclutador` and `Sin respuesta`. If validation rejects
  values outside the list, the write fails.

Copy the sheet ID from its URL: `docs.google.com/spreadsheets/d/<YOUR_SHEET_ID>/edit`.

### 2. Deploy the Apps Script backend

**a. Edit `SHEET_ID` first.** In your local copy of `apps-script/Code.js`, set the `SHEET_ID`
constant at the top to your own sheet's ID. Do this before uploading, so the first version you
deploy is already pointing at your sheet.

**b. Get the code into an Apps Script project.** Either create a new project and paste
`Code.js` and `index.html` into the editor, or push them with
[`clasp`](https://github.com/google/clasp):

```bash
npm install -g @google/clasp
clasp login
cd apps-script
clasp create --type webapp --title "Job Tracker"   # writes .clasp.json (gitignored)
clasp push
```

**c. Deploy it.** **Deploy → New deployment → Web app**, execute as *Me*, access *Only myself*.
Copy the `/exec` URL — it looks like
`https://script.google.com/macros/s/<YOUR_DEPLOYMENT_ID>/exec`. This is the URL the extension
will call.

**d. Redeploy after every later change.**

> **⚠️ Deployment is version-pinned.** The `/exec` URL serves whatever code was live when that
> deployment version was created. `clasp push` — and editing in the browser — only updates the
> project's "Head" version; neither changes what the URL serves.
>
> So after **any** later edit to `Code.js` or `index.html` (including changing `SHEET_ID` if you
> pushed before setting it in step **a**), you must also go to **Deploy → Manage deployments →
> ✏️ → Version: New version → Deploy**.
>
> Skipping this looks exactly like a fresh bug: a function you just fixed keeps failing the same
> way, because the old code is still the one running.

### 3. Script properties

In the Apps Script editor: **Project Settings → Script Properties**. None of these are stored in
source, and none of them ever reach the extension.

| Property | Used by | What it holds |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `analyze`, `coverLetter` | Your Anthropic API key |
| `CV_EN` | `analyze` | Drive link to your English CV |
| `CV_ES` | `analyze` | Drive link to your Spanish CV |
| `RESUME_TEXT_EN` | `coverLetter` | Plain-text resume (English), used to ground the letter prompt |
| `RESUME_TEXT_ES` | `coverLetter` | Plain-text resume (Spanish) |
| `LETTERHEAD_CONTACT` | `coverLetter` | The email / phone / city line under the signer's name in the generated PDF |

`generateCoverLetter()` throws a clear error naming whichever property is missing for the
requested language, so a blank one fails loudly instead of producing a hollow letter.

### 4. Install the extension

1. Go to `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Open the popup, click **⚙️ Config**, paste your `/exec` URL, and save. That URL is the
   extension's only setting.

### 5. Turn on status tracking

In the Apps Script editor, run `probarEstados()` once — it will prompt for Gmail, Sheets, and
Drive authorization — and check the execution log. If the matches look right, run
`instalarTriggerEstados()` once to install the 6-hour trigger.

---

## Notes and known rough edges

- `SHEET_ID` is a hardcoded constant in `Code.js` rather than a script property. It isn't a
  secret, so the risk is low, but forking does require an edit.
- The cover letter's letterhead **name** line is still hardcoded in `generateCoverLetter()`;
  only the contact line moved to a script property.
- UI strings, sheet headers, and stage names are in Spanish. The status-detection keyword rules
  cover both Spanish and English email phrasing.
- Portal scrapers break when portals redesign their pages. `content.js` tries JSON-LD
  `JobPosting` metadata first where it's available — more stable than CSS selectors — and falls
  back to per-site selectors, then to a generic scrape.
- The web app is deployed with access *Only myself*; it's a single-user tool, with no auth layer
  of its own beyond Google's.
