# Job Tracker

A personal job-application tracker made of two pieces: a Chrome extension that captures job
postings from the browser, and a Google Apps Script backend that logs them to a Google Sheet,
generates cover letters, and auto-updates application status by reading Gmail.

## Components

### `extension/` — Chrome extension (Manifest V3)

- `manifest.json` — permissions, host permissions, content script matches. No longer requests
  `api.anthropic.com` — the extension never talks to Anthropic directly.
- `content.js` — injected into job-posting pages; scrapes company, position, description, and
  URL from the DOM (per-site selectors), returned to the popup via `chrome.runtime.onMessage`.
- `popup.js` / `popup.html` — the extension UI. On open, extracts the job from the active tab,
  then POSTs `{action: 'analyze', company, position, description, language}` to the Apps Script
  backend, which drafts a short outreach message + recruiter contact name via Claude and returns
  the CV Drive link for the selected language too — the extension holds no API key and no CV
  links of its own (see API key storage below). The user picks CV/message language with a
  manual toggle (not auto-detected). Optionally requests a cover letter from the same backend
  (sending the full scraped description plus the selected language; extra details are optional),
  then POSTs the completed record to the Apps Script web app to append it to the tracking sheet.
  Both `analyzeWithClaude()` and `generateCover()` check the backend response for `result.error`
  before reporting success, so a failed generation surfaces the real error instead of a false
  success message.

**Job portals covered:** LinkedIn (`linkedin.com/jobs/view/*`), El Empleo
(`elempleo.com/co/ofertas-trabajo/*`), Computrabajo (`co.computrabajo.com/*`), Himalayas
(`himalayas.app/companies/*/jobs/*`), and Magneto365 (`magneto365.com/co/empleos/*`). Each has
its own DOM-scraping logic in `content.js`; anything else falls back to a generic `h1`/`h2`/
`article` scrape.

### `apps-script/` — Google Apps Script backend

- `Code.js` — the web app (`doGet`/`doPost`). Handles three actions posted from the extension:
  - `addRow` — appends a row to the Google Sheet (`SHEET_ID`, tab `Sheet1`).
  - `analyze` (`generateOutreach()`) — calls **Anthropic's Messages API**
    (`claude-haiku-4-5-20251001`, via `ANTHROPIC_API_KEY`) with the job description to draft a
    short outreach message and guess the recruiter's contact name in the requested language,
    and returns the matching `CV_EN`/`CV_ES` Drive link alongside it. This used to run in the
    browser (`popup.js`); it now lives entirely server-side so the extension never touches the
    Anthropic key or the CV links.
  - `coverLetter` (`generateCoverLetter()`) — builds a prompt from the candidate's resume text,
    the full scraped job description, and the selected UI language, calls the same Anthropic
    Messages API to draft the letter in that language, then creates a Google Doc, formats it,
    exports it to PDF into a "Cover Letters" Drive folder, and returns the Drive link + letter
    text.
- `index.html` — a standalone web form (served by `doGet`) that duplicates the extension's
  "add application" flow for manual entry outside the browser extension, calling the same
  `addRow`/`generateCoverLetter`/`analyzeJob` server functions via `google.script.run`.
- `appsscript.json` — runtime config; web app runs `USER_DEPLOYING`, access `MYSELF`.
- `.clasp.json` — clasp project binding (script ID); gitignored.

### ⚠️ Deployment is version-pinned — `clasp push` alone does not update it

The web app URL the extension calls (`config.scriptUrl`, deployment ID starting
`AKfycbzMskErKSZn`) is pinned to whatever code was live at the time it was deployed. Running
`clasp push` only updates the script's "Head" version in the editor — it does **not** update
what that `/exec` URL serves. After any change to `Code.js` (or `index.html`), you must also go
to **Deploy → Manage deployments → (pencil icon on the active deployment) → Version: New
version → Deploy**. Skipping this step means the extension keeps calling the old code, which
looks identical to a fresh bug (e.g. a fixed function still failing the same way).

### Status tracking via Gmail (bottom half of `Code.js`)

`actualizarEstadosDesdeCorreo()` (installed as a 6-hour time-based trigger via
`instalarTriggerEstados()`) keeps the sheet's stage column current **without calling any AI and
without any `UrlFetchApp` call at all** (zero token cost, zero external requests — only
`GmailApp`, `SpreadsheetApp`, and `PropertiesService`):

1. Reads all rows from the sheet to build a list of `{company, position, current stage}`.
2. Searches Gmail from known job-portal domains or application-related subjects, using
   `after:<date>` computed from the last successful run (`EST_LAST_RUN` script property, with a
   1-day safety margin) rather than a fixed lookback — so an outage longer than a few days
   doesn't lose emails permanently; only the very first run (no `EST_LAST_RUN` yet) falls back
   to a wide default window (`EST_DEFAULT_LOOKBACK_DAYS`, 30 days).
3. Evaluates every **message** in every returned thread individually (not just the thread's
   last message, and not the whole thread as a unit), skipping only messages whose Gmail message
   ID is already recorded in the `EST_PROCESSED_MSG_IDS` script property. This is a per-message
   check rather than a per-thread Gmail label, so a new reply arriving in an already-seen thread
   still gets read and evaluated — the earlier v2 design labeled the whole thread as processed,
   which silently skipped later replies in that same thread.
4. For each new message, normalizes text (strips accents/case/punctuation) and matches it
   against a job by token overlap on company name and position title (`estPuntaje`) — ambiguous
   matches (position matches multiple open applications, company doesn't) are skipped rather
   than guessed.
5. Classifies the matched email's stage via keyword rules (`EST_REGLAS`) for Spanish/English
   phrases indicating Rejected / Offer / Interview / In Review / Viewed by recruiter. The
   `Oferta` rule deliberately excludes the bare phrase "oferta de empleo" — in Spanish that
   almost always just means "job posting" (how portals refer to the listing itself), not an
   actual offer extended to the candidate, and matching on it produced false positives. Only
   phrases where "ofrecer" is clearly directed at the candidate (e.g. "nos complace ofrecerte",
   "te ofrecemos el puesto") count as a real offer.
6. Only moves the stage forward (`EST_RANK` ordering; `Rechazado` and `Oferta` are the two real
   outcomes and are never downgraded — `Sin respuesta`, see below, ranks alongside `Aplicado` at
   0, so any real detected stage still overrides it).
7. Stale-application rule: any row that hasn't had a status change in `EST_STALE_DAYS` (30) days
   and isn't already `Rechazado`, `Oferta`, or `Sin respuesta` gets set to **`Sin respuesta`** —
   never `Rechazado`, since silence isn't a rejection. This runs after the email-matching pass
   (using each row's post-update state), so a row updated earlier in the same run is correctly
   judged from its new state, not stale data. "No status change" is tracked via a new sheet
   column, `EST_COL_LAST_CHANGE` (**column L** — not part of the original 11-column layout from
   `addRow()`; needs to be added to the sheet manually, see the INSTALACIÓN comment in `Code.js`
   for the exact column and why), written by this function whenever it changes a stage. For rows
   that predate this column (or haven't changed since), it falls back to the application date
   (column C) — so existing old rows are evaluated correctly from day one, no manual backfill
   needed. Since `Sin respuesta` ranks at 0 in `EST_RANK`, a later real email (e.g. an interview
   invite) still overrides it normally.
8. Before finishing, prunes `EST_PROCESSED_MSG_IDS` entries older than
   `EST_PROCESSED_RETENTION_DAYS` (35 days) — safe to discard since the date-based search will
   never look that far back again — so the property doesn't grow unbounded, and records the run
   start time as the new `EST_LAST_RUN`.

`diagnosticoEstados()` is a read-only dry run (fixed 4-day window, independent of
`EST_LAST_RUN`) for debugging match/classification without writing to the sheet or touching the
processed-messages tracking; `estLimpiarEtiqueta()` clears both `EST_PROCESSED_MSG_IDS` and
`EST_LAST_RUN` script properties to force a full re-evaluation on the next run (despite the
name, it no longer touches Gmail labels — the label-based mechanism was replaced by the
Script-Properties-based tracking described above).

**Sheet setup required for the stale-application rule:** add a column L (e.g. "Última
actualización de estado", date-formatted) to the tracking sheet, and add "Sin respuesta" (along
with the earlier "Visto por reclutador") to column D's dropdown data-validation list. If column
L is already used for something else in the live sheet, `EST_COL_LAST_CHANGE` in `Code.js` needs
to point at a free column instead.

## API key storage

The Anthropic API key, the CV Drive links, and the candidate's resume text all live **only** on
the backend, in `PropertiesService.getScriptProperties()`:

- `ANTHROPIC_API_KEY`, `CV_EN`, `CV_ES`, `RESUME_TEXT_EN`, `RESUME_TEXT_ES`, `LETTERHEAD_CONTACT`
  — read at runtime in `Code.js`. `ANTHROPIC_API_KEY` and `CV_EN`/`CV_ES` are used by both
  `generateOutreach()` (the `analyze` action) and `generateCoverLetter()` (the `coverLetter`
  action); `RESUME_TEXT_EN`/`RESUME_TEXT_ES` (the candidate's resume, used to ground the cover
  letter prompt) is used by `generateCoverLetter()` only, which picks `RESUME_TEXT_EN` or
  `RESUME_TEXT_ES` based on the same `lang` variable that already selects the letter's
  salutation/closing/date format. `LETTERHEAD_CONTACT` (the email/phone/city line under the
  signer's name in the generated cover letter PDF) is also used by `generateCoverLetter()` only.
  Set them once via Project Settings → Script Properties in the Apps Script editor (or
  `.setProperty(...)` run once from the editor) — none are stored in source.
  `generateCoverLetter()` throws a clear error naming whichever of `ANTHROPIC_API_KEY`,
  `RESUME_TEXT_EN`/`RESUME_TEXT_ES`, or `LETTERHEAD_CONTACT` is missing for the requested
  language.

The extension's only remaining setting is `scriptUrl` (`chrome.storage.sync`, entered via the
⚙️ Config screen, `s-script` field in `popup.html`). The extension holds no API key, no CV
links, no resume text, and no personal contact info of its own — every request for a message,
contact name, CV link, or cover letter goes through the Apps Script backend, which is the only
place these values are configured. No API keys, CV links, resume text, or personal contact
details are committed to source.

## Other things worth knowing

- `SHEET_ID` in `Code.js` is still a hardcoded constant (not a secret, low risk).
- The cover letter's letterhead **name** line (`'Juan Hernandez Vargas'` in
  `generateCoverLetter()`, right above the `LETTERHEAD_CONTACT` line) is still a hardcoded
  string in `Code.js` — only the email/phone/city line was moved to a script property. Flagged
  but intentionally left as-is pending a decision on whether the name should move too.
