# Drive + Sheets backend (Google Apps Script)

The desktop app does not talk to the Google APIs. It calls one Apps Script web app, which
runs **as the owner** and returns JSON. That one decision buys three things:

* **No Google credentials on intern machines.** No GCP project, no OAuth consent screen,
  no service-account key file to leak. The app holds the web app's URL and the person's own
  key.
* **The internal section never leaves the server.** Where a listing's postable text ends is
  decided by `splitAtSeparator_` in `Separators.gs`. An intern's reply has no `internalText`
  at all, and a document nobody has separated reaches an intern as no text, marked
  `withheld` (below). The **role** decides this, from the key. Nothing in the request can
  ask for more.
* **The cooldown is a real guarantee.** `logPost` checks it under `LockService`,
  so two interns saving the same property at the same moment cannot both get through.
  A client-side check can always be raced or bypassed.

## The project's files

All of these go into **one** Apps Script project:

| File | What it is |
|---|---|
| `Code.gs` | The web app: every action below. |
| `Separators.gs` | **Required.** The one place that decides where a listing's postable text ends (D13). `Code.gs` calls it whenever a property is opened; without it, opening a property fails with "Separators.gs is missing from this Apps Script project", and `SETUP` says the same. Paste it unchanged. It is pure ASCII so the editor cannot corrupt a rule, and its rules are never copied into another file. |
| `BuildDirectory.gs` | Builds the directory sheet from the Drive library (`START`, `STATUS`, `CONTINUE`, `STOP`, `RESTART`, `VERIFY`, `FIND_ROOT`), and `RESTART_FROM_APP`, which the app's rebuild button runs on a trigger. |
| `appsscript.json` | The manifest. |

Apps Script gives every file in a project **one global scope**. A top-level name declared in
two files breaks the project when it is a `const`, and silently replaces the other when it
is a `function`. `src/server-tests` loads the three files into one scope the same way,
and fails if two of them declare the same name.

## Building the listing directory first

`BuildDirectory.gs` walks the Drive library and writes one row per listing into the
directory spreadsheet: category, listing type, name, photo download links, and the posting
text with the owner's section cut off by `Separators.gs`. The library's depth is not fixed,
so a folder counts as a listing when it has no sub-folders or holds files of its own (D9).
Run `START`. The work goes on in batches on a trigger, and `STATUS` says how far it has got.

It is also the fastest doc-health report you will get: the **Issues** column names every
listing with no document, no photos, or no separator of any kind. That last one matters
most. Nobody has separated that document, so none of it is confirmed safe to post (D6).

Run it before anything else. The web app only reads the directory. A search is one sheet
read rather than hundreds of Drive calls.

## Three spreadsheets

* **The tracker**: the one the company already uses. Posts and Assignments rows go here,
  into its existing columns. Do not make a new one.
* **A private admin sheet**: create this one, and share it with nobody. It holds the
  script's `Settings` tab (the rules, below) and its `Team` tab: `Name`, `Email`, `Role`, `Key`, `FB Accounts` (the FB broker
  name(s), the Facebook account name the person posts as; comma separated), `FB Profile Link`
  and `Active`. Columns are found by header name. A tab made before `FB Profile Link`
  existed keeps working: the column is added after the last one the first time a Team row is
  written. `Team` lists everyone's key, so it cannot live in a sheet the team
  can open: whoever reads an admin's key can act as that admin (D3).
* **The directory**, written by `BuildDirectory.gs`.

## Set it up

1. Make the private admin spreadsheet. Copy its id from the URL
   (`/spreadsheets/d/<THIS>/edit`).
2. Create the script. If the tracker already has a bound Apps Script project (and it does
   if the earlier web app was built from its Extensions menu), a second bound project is not
   possible, so make a **standalone** script at <https://script.google.com> instead. A
   standalone script has no spreadsheet menu; run `SETUP` and `ADD_PERSON` from the editor
   instead, as below.
3. Add `Code.gs`, `Separators.gs` and `BuildDirectory.gs`, each as its own file. Then
   ⚙ *Project Settings* → "Show `appsscript.json`", and paste the manifest. It sets the
   time zone, the web app's access and the scopes, and enables the advanced Drive service,
   which `BuildDirectory.gs` needs only to read a `.docx`.
4. Check `CONFIG` at the top of `Code.gs`:
   * `TRACKER_SHEET_ID`: the company tracker's id. Required for a standalone script.
   * `ADMIN_SHEET_ID`: the private sheet from step 1.
   * `DIRECTORY_SHEET_ID` / `DIRECTORY_TAB`: where `BuildDirectory.gs` writes. Its own
     `CFG.SHEET_ID` must name the same spreadsheet.
   * `POSTS_TAB` / `ASSIGNMENTS_TAB`: **must match the real tab names.**
   * `SHARED_KEY`: a long random string, used only until the Team tab has its first row.
   * `COOLDOWN_DAYS`, `REPOST_DUE_DAYS` and `PER_WEEK`: the rules' **defaults** only
     (7, 14 and 40). The live values are set from the app and kept on the Settings tab
     (below). `TZ`: Manila's calendar.
   * `CHECKER_INDEX_CSV_URL`: leave it as it is, the listing checker's published Index CSV
     (below). `''` switches the join off.
5. Check `CFG` at the top of `BuildDirectory.gs` (`ROOT_FOLDER_ID`, `SHEET_ID`), and run
   **`START`** to build the directory.
6. Run **`SETUP`** from the editor and accept the permission prompt. It checks that
   `Separators.gs` is there, then counts the directory's listings, the tracker's rows and
   the team.
7. Get your first admin key (below).
8. Deploy → New deployment → **Web app**. Execute as **Me**, access **Anyone**.
   Leave any earlier deployment running until the desktop app is proven.
   "Execute as Me" is the whole point: every Drive read happens as the library's owner,
   so nobody else needs Drive access. Copy the `/exec` URL.
9. Check it: `<exec-url>?action=ping&key=<your key>` in a browser. It should name you
   and your role. That puts your key in the browser's history, so do it once, from your
   own machine. The app always sends the key in the request body.

### Getting your first admin key

1. Paste the files into the project (step 3).
2. Set the sheet IDs in `CONFIG` (step 4).
3. In the editor, open `ADD_PERSON`, put **your own name** in `name`, leave `role` as
   `'Admin'` (`fbAccounts` and `fbProfileLink` may stay blank), and press **Run**, once.
4. The key appears in **View → Executions** (the execution log), and on the Team tab of the
   private admin sheet. Paste it into your copy of Post-It.
5. After that, add everyone else from the app: **Settings → Team**. `SHARED_KEY` stops
   working the moment the Team tab has its first row.

### Updating the code later

Paste the changed files, then update the deployment with **Manage deployments → Edit →
New version** (keeps the link). A *new* deployment would get a new `/exec` URL, and every
copy of the app would have to be told it.

## Actions

Every call carries `key`, and the key *is* the identity: it is resolved to a name and a
role before anything is dispatched (`docs/ROLES.md`). The app POSTs JSON; a GET with query
parameters is answered the same way. The body is read as JSON whatever its content type, so
`npm run dev` in a browser sends it as `text/plain`, which needs no CORS preflight. Every reply is `{ ok: true, … }` or
`{ ok: false, error, message? }`.

| Action | Who | What it does |
|---|---|---|
| `ping` | everyone | Who the key belongs to: `name`, `role`, `fbAccounts`, and the server's `time`; also `version` (`SERVER_VERSION` at the top of `Code.gs`) and `rules`: `{ cooldownDays, repostDueDays, perWeek, perIntern }`, the live values (below); `perIntern` is `perWeek` again, under its old name, for an app built before v6. |
| `properties` | everyone | Every listing: `id`, `name`, `category`, `listingType`, `subCategory`, `photoCount`, `hasIssues`, and `issues` (the Directory's Issues text, as BuildDirectory.gs wrote it). One sheet read. With the listing checker's index joined on by Folder ID (below): `city`, `size`, `dealType`, `availability` (`Available`, `Sold` or `''`) and `inChecker`. When the index cannot be read, or is switched off, those fields are absent and the call still works. With the geocoding sheet joined on by FolderId (below): `lat` and `lng`, numbers, only for a listing that has a good position. |
| `property` | everyone | One listing by `id`: `publicText`, `photos`, `hasInternal`, `withheld`, `cutAt`, `issues`, `live`, and for an Admin only, `internalText`. The checker's fields too, joined as for `properties`. |
| `posts` | everyone | The Posts tab as rows, every value text. An intern gets only their own. |
| `assignments` | everyone | The Assignments tab as rows, every value text. An intern gets only their own. Each row also has `week`: the Monday of the week its Date is in (`''` when the date can't be read), with `date` kept as written, so a daily row from before v6 reads as its week (below). |
| `logPost` | everyone | Appends a Posts row and replies with its `status`, `date`, `time` (`HH:mm`), `type` (the Property type written) and `postedBy`. `postLink` is required, an https link on `facebook.com`, `www.`/`m.`/`web.facebook.com`, `fb.com` or `fb.me` (`error: 'link-required'` or `'bad-link'`), and so is `status`, `Posted` or `Pending` (`'bad-status'`); Pending means posted in a group and awaiting its admin's approval. Refuses with `'cooldown'` (with `lastPosted`, `nextAllowed` and the sentence to show) inside the cooldown, and with `'forbidden'` for a Facebook account not on the poster's Team row. An Admin may send `postedBy`: that person must be on the Team tab and active (`'unknown-person'`), and the account must be one of theirs. |
| `addLink` | everyone | Turns a Pending row into Posted with its link: `notfound` when there is no such row. An intern can complete only their own. Kept for old rows logged without a link. |
| `setStatus` | everyone | Moves one queue item's status (`Not Shared`, `Pending` or `Posted`; an older app's `To post` is written `Not Shared`): `notfound` when no open item matches. An intern can move only their own. With `Posted`, also marks the assignee's newest Pending post of that listing Posted (by id, else by name), keeping its link. |
| `team` | Admin | The Team tab without keys: `name`, `role`, `email`, `fbAccounts` (a list: the FB broker name(s)), `fbProfileLink` (`''` when none) and `active` for each person, revoked people included. The Key column is never sent. |
| `addPerson` | Admin | Adds `{ name, role: 'Intern' \| 'Admin', fbAccounts?, fbProfileLink?, email? }` to the Team tab and replies `{ person, key }`. The key is shown this once. A name already on the tab, in any case, is `'duplicate'`; any other role is `'bad-role'`. `fbProfileLink` is optional; when given it must be an https link on `facebook.com`, `www.`/`m.`/`web.facebook.com` or `fb.com`, any path (typed without a scheme, `https://` is put in front first), else `'bad-profile-link'`. |
| `updatePerson` | Admin | `{ name, fbAccounts?, fbProfileLink? }`: changes only the fields sent (blank clears), with `addPerson`'s checks, replying `{ person }`. Name, role and key never change. The cached Team tab is cleared, so the log step's account check uses the new broker name at once. |
| `setActive` | Admin | `{ name, active }`: revokes or restores a person, replying `{ person }`. Nobody can deactivate themselves (`'self'`). |
| `newKey` | Admin | `{ name }`: gives the person a new key, replying `{ key }`. The old one stops working at once. |
| `saveQueue` | Admin | `{ week, assignedTo, items }`: replaces one person's queue for one week. `week` and `date` as for `saveQueues`. Refuses held listings, as `saveQueues` does (below). |
| `saveQueues` | Admin | `{ week, queues: [{ assignedTo, items: [{ propertyName, propertyId?, status? }] }] }`: replaces several interns' queues for one week, all or none, under one lock, replying `{ saved }`. `week` must be a Monday, yyyy-MM-dd (`'bad-week'`). An older app's `date` is still accepted, any day, and saved as its week (a Saturday or Sunday as the next week's); `week` wins when both are sent. Every `assignedTo` must be an active Intern on the Team tab (`'bad-intern'`). Refuses held listings with `'held'` (below). |
| `setRules` | Admin | `{ cooldownDays?, repostDueDays?, perWeek? }`: changes only the rules sent, each a whole number (cooldown 1–60 days, repost 1–120 days, per week 1–200), else `'bad-rules'` (with `field`) and nothing is written. `perIntern`, from an app built before v6, is read as `perWeek` when `perWeek` is not sent. Replies `{ rules }`, as `ping` sends them. |
| `rebuildDirectory` | Admin | Schedules `BuildDirectory.gs`'s `RESTART` on a one-off trigger (`RESTART_FROM_APP`) about 10 seconds later and replies `{ started: true }` at once. `'busy'` while a build is running or already scheduled; `'no-builder'` when `BuildDirectory.gs` is not in the project. |
| `directoryStatus` | Admin | `{ running, done, total, builtAt }`: whether a build is scheduled or under way, how many listings it has written of how many, and when the last one finished (ISO, Manila; `''` before the first). |
| `indexCheck` | Admin | Compares the directory with the checker's index, read fresh: `checkedAt`, `directoryCount`, `checkerCount`, `directoryOnly` and `sold` (`{ id, name }`), and `checkerOnly` (`{ id, name, path }`). `'checker-off'` or `'checker-unavailable'` when it cannot. |

Two things in a reply come from the key, never from the request:

* **`internalText`** is in a `property` reply only for an Admin. For an intern
  it is not empty, it is absent. A heading separator's label quotes its line
  (`heading: Commission: 3%`), so an intern's `cutAt` is the kind of marker only (`heading`).
* **`postedBy`** on a logged post is the caller's own name. An Admin may log on an
  intern's behalf by sending `postedBy`; from an intern it is ignored.
* **A key** is in the reply of `addPerson` and `newKey` only. No other reply, `team`,
  `updatePerson` and `setActive` included, ever carries one.

### Weekly queues (v6)

The owner: "assign per week only, e.g. 40 listings per week; Friday is the final day before
the reset."

* **The work week** runs **Monday to Friday**, and **Friday is the deadline**. A week is
  named by its Monday, `yyyy-MM-dd` on Manila's calendar: the **week key**.
* **The reset** happens after Friday: **Saturday and Sunday belong to the next week**. A date
  maps to its week as `weekOf_` (Code.gs) and `weekOf` (the app's `src/core/week.ts`) map it:
  Monday to Friday to that Monday, Saturday and Sunday to the next Monday.
* **One queue per intern per week.** An Assignments row's `Date` holds the week key. Rows
  written before v6 hold a day; they are read as the week that day is in, so the past still
  shows correctly, and nothing in the sheet has to be rewritten.
* **Saving** a week's queue replaces that intern's rows of that week: every row whose Date
  is in it, the week key or an older day alike. The new rows are written with the week key.
* **Missed.** When a week is over (Manila's today is past its Friday), the rows still
  `Not Shared` are **Missed**. Missed is shown in the app's reports and on the intern's
  monitor; it is never written as a status, and a Missed row holds nothing (below). A late
  post still moves it to Posted as usual.

### Held listings

The owner's rule: **a listing assigned to an intern is held by that intern until it is
posted, or until its week is over.** An Assignments row whose Status is `Not Shared` (or the
older `To post`) holds its listing for its assignee while its week is not over on Manila's
today. After that Friday it is Missed and holds nothing. `Pending` and `Posted` release it at
once, and the cooldown then applies as usual. A row whose Date can't be read belongs to no
week and holds nothing. Rows are matched to a listing the way every tracker row is: by folder
id when both have one, otherwise by name as the app normalises it.

`saveQueue` and `saveQueues` check every item under the lock, before anything is written. An
item is refused when an open row in a week not over holds it for a different intern, or for
the same intern in another week. The rows the save replaces (the named interns' rows of that
week) hold nothing, so re-saving a week's queue still works, and an item taken out of a queue
is free at once. The same listing sent in two of `saveQueues`' queues is held by the first. A
refusal writes nothing and replies, `date` being the holding row's Date as a day and `week`
its week:

```json
{ "ok": false, "error": "held",
  "held": [{ "propertyName": "Casa Amara", "propertyId": "F1", "heldBy": "Ana Reyes",
             "date": "2026-03-09", "week": "2026-03-09" }],
  "message": "Casa Amara is already with Ana Reyes (queue for the week of 9–13 Mar). Remove it from their queue first." }
```

To move a held listing, remove it from the first intern's queue and save that, then add it
to the other's.

### `withheld`

When nobody has separated a document, `Separators.gs` finds no marker, and none of the text
is confirmed safe to post. Blocking the Copy button is not enough (D6): text on screen can be
selected and copied by hand. So an intern is not sent it at all (D13). Their reply has
`publicText: ''`, `hasInternal: false` and `withheld: true`, so the screen can say why it is
empty. An Admin gets the whole document in `publicText`, with `withheld: false`,
so they can add the separator. The same holds when the text comes from the directory's copy
rather than the live document.

## The listing checker's index

The listing checker is another team's Apps Script, and Post-It never edits it, its sheet or
its files. It publishes its Index as CSV (`CONFIG.CHECKER_INDEX_CSV_URL`), and `properties`
reads that one URL with `UrlFetchApp`, parses it with `Utilities.parseCsv`, and joins it to
the directory on **Folder ID** = `FolderId`: `City`, `Size (sqm)` (as text), `Deal type`,
`Status` (as `availability`) and `inChecker`. The parsed index is cached for 10 minutes, in
several cache entries because one holds at most 100 KB. If the fetch fails, or the URL is
`''`, the properties go out unchanged, without those fields; the call never fails for it.
`indexCheck` reads the CSV fresh and lists what one side has that the other does not, and
which of our listings the checker marks Sold. The manifest's `script.external_request`
scope is for this fetch.

## The geocoding sheet

The startup screen draws every listing as a dot on a map of the Philippines. Where each
listing is comes from the owner's geocoding sheet, columns `FolderId, Property, Query, Lat,
Lng, GeoStatus, Checked`. `properties` reads it **by header name** (any order, any case),
keeps the rows whose `Lat` and `Lng` are numbers inside the Philippines (lat 4.5–19.5,
lng 116.5–127), and adds `lat` and `lng` to the listing with that `FolderId`. A listing
with no good row gets neither field.

* `CONFIG.GEO_SHEET_ID`: the spreadsheet. `''` (the default) means the directory
  spreadsheet, `DIRECTORY_SHEET_ID`.
* `CONFIG.GEO_TAB`: the tab. `''` (the default) means the first tab whose header row has
  `FolderId`, `Lat` and `Lng`.

It is cached for 10 minutes, like the checker's index. If the spreadsheet, the tab or the
columns are not there, `properties` answers exactly as before, without `lat`/`lng`; the app
then places dots by the city in each listing's name. **The script never writes to this
sheet.**

## Your existing tracker is not reformatted

Nothing is written by column position. Each field is found by matching the sheet's own
header row against a list of accepted spellings (`POST_FIELDS` / `ASSIGN_FIELDS`), so the
tracker keeps its column order and wording. A column the sheet does not have is skipped;
a *required* one that is missing raises a message naming it. The header row is read with
the rows, never cached, so a column moved in the sheet takes effect at once.

**What the script writes is plain text** (D7). It formats each cell it fills as `@` before
writing to it, so a date stays `2026-03-09`, a time stays `10:23 AM`, a folder named `1201`
stays text, and nothing beginning `=` or `+` is evaluated. Columns it does not fill keep
their own format. Everything read comes back as text too: a date as `yyyy-MM-dd`, a time as
`HH:mm`, a number as its digits. A time that an earlier version let Sheets turn into a time
value reads back as `HH:mm`, not as `1899-12-30`.

### The Posts tab

It records what the interns' own sheet, **POSTING TRACKER - INTERNS**, does, with its
column names, words and formats, so it feels familiar. A tab the script creates gets these
headers, in this order:

1. **Date**: the day posted, written `yyyy-MM-dd` as text (`2026-10-26`). The interns'
   sheet shows `10/26/26`; how the sheet *displays* a date is the sheet's business, not the
   app's, so the script reads and writes ISO and leaves the display alone. A date typed by
   hand as `10/26/2026` is still read.
2. **Property type**: the listing's category from the Directory, found by folder id and
   title cased as the owner writes it: `COMMERCIAL SPACE` → `Commercial Space`,
   `CONDO / HOUSE AND LOT` → `Condo / House and Lot`. A category already in mixed case is
   kept as it is. Only when the Directory has no row for the folder is the `type` the app
   sent (the category it has) used instead, title cased the same way.
3. **Property title**: the listing's name as written.
4. **FB account name**: the Facebook account it was posted from.
5. **Link**: the post's link.
6. **Time posted**: Manila time, 12-hour, `10:23 AM`. Read back as `HH:mm` (`10:23`),
   whether the cell says `10:23 AM`, `2:05pm` or `14:05`, which is the format the app uses.
7. **Share posting**: `Posted` or `Pending` (posted in a group, awaiting its admin).
8. **Posted by**: ours. Who it is credited to, from the key.
9. **Property ID**: ours. The listing's folder id, for the records and the cooldown.

The older spellings are still read, so an existing tab keeps working: `Type` / `Category`,
`Title` / `Property` / `Property Name`, `FB Account` / `Account` / `Facebook Account` / `FB`,
`Post Link` / `URL` / `Facebook Link`, `Time`, `Status`, `Intern` / `By`, and
`PropertyId` / `Folder Id`. Headers match in any case.

### The Assignments tab

A tab the script creates gets `Date`, `Assigned To`, `Property`, `Status` and `PropertyId`
(also read as `Assigned to` / `Intern`, `Title` / `Property Name`, `Property Id` /
`Folder Id`). **Date** is the queue's week key, its Monday (v6); an older row's day is read
as its week (Weekly queues, above). **Status** is one of:

* **`Not Shared`**: assigned, not posted yet. The interns' own word for it. Rows written
  before it say `To post`, which is read as the same thing everywhere (`setStatus`,
  `logPost`, the app's queue, planner and summaries). New rows are always written
  `Not Shared`.
* **`Pending`**: posted in a group, awaiting its admin.
* **`Posted`**: live. An item already Posted is never moved back.

### Property ID

The one column worth adding to an older tab is **Property ID**. A row is matched to a listing
by its folder id when both have one, so renaming a folder breaks nothing. A row without one,
such as every row logged before the column was added, is matched by its title, with case,
accents, punctuation and the usual abbreviations ignored, as the app matches names.

## The rules: the Settings tab

Three rules are the admin's to set, from the app's Settings page (`setRules`):

| Key | What | Default | Range |
|---|---|---|---|
| cooldownDays | Days before a listing may be posted again. The server's own check uses it. | 7 | 1–60 |
| repostDueDays | Days without a post after which a listing is due for a repost. | 14 | 1–120 |
| Per week | How many listings the planner and "Add 40 for posting" give each intern for a week by default (`perWeek`). | 40 | 1–200 |

They are kept on the **Settings** tab of the private admin sheet, two columns, `Key` and
`Value`, one row per rule, written as text: the Keys `cooldownDays`, `repostDueDays` and
`Per week`. Keys are compared ignoring case, spaces and underscores (`Per week`, `perWeek`
and `per_week` are one key). v6's `Per week` replaces the old `Per intern` (written by
earlier versions as `perIntern`), which is still read when there is no good `Per week` row;
a save writes `Per week` and leaves the old row, which is then no longer read. The tab is made the first time a rule is saved.
Every reader, `ping` and the cooldown check alike, reads them through one function, cached
for 30 seconds; a save clears that cache, so it holds from the next call. A rule the tab does
not have, or has as anything other than a whole number in its range, is CONFIG's default.
You may type a value on the tab by hand; it takes effect within half a minute.

`ping` sends the rules with every sign-in, and the app uses them in place of its own
defaults.

## The cooldown

A listing posted, or logged as Pending, fewer than `cooldownDays` (the rule above) calendar
days ago on Manila's calendar cannot be logged again. Pending counts because a post still waiting for its
link must stop a second intern posting the same listing. The app predicts the same answer
before it asks (`src/core/cooldown.ts`), but the server's answer is the one that holds,
because it is given under the lock.

## Rebuilding the directory from the app

The app's Settings page has a button to rebuild the directory. A full rebuild takes
minutes, longer than a web request may run, so `rebuildDirectory` only sets a one-off
trigger for `RESTART_FROM_APP` (in `BuildDirectory.gs`) about 10 seconds later, and
answers at once. That trigger deletes itself and runs `RESTART`, exactly as pressing Run
on `RESTART` would: the scan, then `CONTINUE` in batches on its own triggers. While the
scan runs, the script property `rebuildStarted` marks it (forgotten after 10 minutes, in
case Apps Script stopped it), and once queued, the properties `cursor` and `total` say how
far it has got. When a build finishes, `CONTINUE` writes the time to the property
`builtAt`. `directoryStatus` reports all of this, and `rebuildDirectory` refuses (`busy`)
while a build is scheduled, scanning, or part way through. `STOP` in the editor still
pauses it.

## What to run from the editor

The editor's **Run** list shows every function whose name does not end in `_`, and the app's
actions used to be in it, where pressing Run on one did nothing useful. Every function only
the web app calls now ends in `_`, so the list holds only these:

| Function | When |
|---|---|
| SETUP | After pasting the files: checks everything the web app depends on. |
| ADD_PERSON | Once, for your first admin key (above). |
| START | To build the directory the first time, or after a `STOP`. |
| STATUS | How far a build has got. |
| STOP, CONTINUE | Pause and resume a build. |
| RESTART | Throw a build away and start again. The app's rebuild button does the same. |
| VERIFY | After a build: is everything in Drive in the sheet? |
| FIND_ROOT | When `START` cannot open the library folder. |

`doGet` and `doPost` are the web app, `onOpen` and `promptAddTeamMember` the spreadsheet
menu, and `RESTART_FROM_APP` the app's rebuild trigger: none of these is for the Run button.
A trigger can only call a function without the `_`, which is why those keep their names. A
test in `src/server-tests` holds the list to exactly these.

## The server's version

`SERVER_VERSION` at the top of `Code.gs` (`yyyy-MM-dd.n`) is sent with every `ping`. The
app holds the version it was built against, `EXPECTED_SERVER_VERSION` in `src/config.ts`,
and says when the deployment is older (a test keeps the two equal). Change both whenever an
action or a reply changes, then deploy a New version.

## Why there is a directory sheet

Walking more than a thousand listing folders takes minutes: far too slow for a search box,
and it would burn the daily runtime quota if it ran on every keystroke. `BuildDirectory.gs`
walks Drive once and writes the directory, and `?action=properties` is then a single
`getValues()`.

The posting **document is re-read live** when a property is opened, so an edit in Drive shows
up at once (D4). Only Google Docs can be re-read that way. For anything else, or when the read
fails, the directory's copy is used, and `live: false` says so.

## Things that will bite you

* **Keep posting docs as native Google Docs.** A `.docx` is never re-read live: the app gets
  the directory's copy, as fresh as the last build, and `BuildDirectory.gs` can only read it
  by converting a temporary copy. A `.gdoc` shortcut cannot be read at all.
* **The `/exec` URL plus a key is the credential.** Anyone holding both can do whatever that
  key's role can. The app keeps the key in the operating system's credential store; never put
  one in this repo.
* **Custom HTTP headers are dropped on redirect.** Apps Script answers with a 302 to
  `script.googleusercontent.com`, and an `Authorization` header does not survive that hop.
  The key travels in the POST body.
* **Photos.** A `property` reply carries Drive download links for the listing's photos. The
  script does not change who can open them, and the app downloads them without a Google
  sign-in, so they must be viewable by anyone with the link.
* **Revoking by hand takes up to a minute.** From the app (Settings → Team), revoking or
  issuing a new key takes effect at once. Setting Active to `FALSE` by hand on the Team tab
  does not: the tab is cached for 60 seconds, so a key already in use keeps working until then.
* **The directory is cached for a minute only while it is small.** CacheService holds at most
  100 KB per value, and a full library's directory is larger, so then every `properties` and
  `property` call reads the sheet.
* **Quotas.** 6 minutes per execution; 90 minutes a day of trigger time on personal Gmail, 6
  hours on Workspace. Building the directory is the only heavy job, and it runs in batches
  that hand over to a trigger (D8).

## Identity without Google sign-in

The script runs as the Drive owner, so `Session.getActiveUser()` says nothing useful about
who is calling. Identity comes from the key instead: each person has their own row on the
**Team** tab, and the key resolves to their name and role before anything is dispatched.

That means roles are enforced on the server, not asserted by the client: no Workspace and
no per-user Google sign-in needed. `docs/ROLES.md` has the matrix and the consequences.

## The app's side

`src/core/backend.ts` POSTs `{ action, key, … }` as JSON to the `/exec` URL and turns
every refusal into a sentence a person can act on. `tracker.ts` and `directory.ts` read the
replies. A logged post's date, time and Posted By are always taken from the reply, never from
the PC's clock.

## Testing it

`src/server-tests` runs these files in Node, in one shared scope, with every Google
service they use faked, including a Sheets that evaluates what it is given as Sheets does:

```
cd app
npx vitest run src/server-tests/
```

The tests also hold the server to the app's own rules: its name matching, its reading of the
tracker's dates, and its cooldown, through its own client.
