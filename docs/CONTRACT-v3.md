# Contract v3: server actions and core API for this round

Shared by every agent working in parallel. Change it only by agreement.

## Rules this round

- **Real data only.** The app reads the Directory sheet and Drive. It writes only the
  tracker (Posts, Assignments) and the Team tab. It never writes the Directory, Drive
  or the listing checker's sheet.
- **The listing checker's Apps Script is not ours.** It lives in `apr-listing-checker/`
  on the owner's PC. Never edit it. We only *read* its published Index CSV, which has
  these columns: `Folder name, City, Size (sqm), Building / street, Category,
  Deal type, Status, Group folder, Created, Modified, Link, Keywords, Folder ID,
  Indexed at, Path`. Status is `Available` or `Sold`.
- **Two roles:** Admin and Intern. The server decides who is which, from the key.

## Server actions (Code.gs)

Every call is a POST of `{ action, key, ... }`. Every reply is `{ ok, ... }`, or
`{ ok:false, error, message }`.

| action | who | request | reply |
|---|---|---|---|
| `ping` | all | — | `{ name, role, fbAccounts, time }` (unchanged) |
| `properties` | all | — | rows, each with `issues` (the Directory's Issues text) and these extra optional fields: `city, size, dealType, availability ('Available'\|'Sold'\|'')`, `inChecker:boolean`. They come from the checker CSV, joined on Folder ID. `CONFIG.CHECKER_INDEX_CSV_URL` set to `''` turns the join off, and then the fields are absent. |
| `logPost` | all | `{ property, propertyId, fbAccount, postLink, status: 'Posted'\|'Pending', type?, postedBy? (admin only) }` | `{ status, date, time, type, postedBy }`. `date` is `yyyy-MM-dd`, `time` is `HH:mm`. `type` is the Property type written: the Directory's category for `propertyId`, title cased; the request's `type` (the app sends the listing's category) only when the Directory has no such row. The app no longer sends "Group post". **`postLink` is REQUIRED**: it must be an https link on facebook.com, fb.com, m.facebook.com or fb.me. Otherwise `error:'link-required'` or `'bad-link'`. `status` is required: `Pending` means posted in a group, waiting for the group admin's approval. |
| `setStatus` | all (own rows) / admin | `status: 'Not Shared'\|'Pending'\|'Posted'` (`'To post'` is accepted and written `Not Shared`) | unchanged (Pending → Posted). With `Posted`, the assignee's newest Pending Posts row for that listing becomes Posted too. |
| `property` | all | `{ id }` | the detail, with the same checker fields as `properties`, joined the same way. |
| `addLink` | unchanged | | kept for old rows that have no link |
| `team` | admin | — | each person also has `fbProfileLink` (`''` when none). Never a key. |
| `addPerson` | admin | `{ name, role:'Intern'\|'Admin', fbAccounts?: string[], fbProfileLink?, email? }` | `{ person: TeamMember, key }`. The key is shown ONCE. A name that already exists (case-insensitive) gives `error:'duplicate'`. `fbAccounts` holds the FB broker name(s), the Facebook account name the person posts as (what they pick as "FB account name" when logging). `fbProfileLink`, optional, must be https on facebook.com, www./m./web.facebook.com or fb.com, any path; without a scheme, `https://` is put in front first. Otherwise `error:'bad-profile-link'`. |
| `updatePerson` | admin | `{ name, fbAccounts?, fbProfileLink? }` | `{ person }`. Changes only the fields sent, with addPerson's checks; name, role and key never change. Clears the team cache. |
| `setActive` | admin | `{ name, active:boolean }` | `{ person }`. You cannot deactivate yourself (`error:'self'`). |
| `newKey` | admin | `{ name }` | `{ key }`. The old key stops working at once (clear the team cache). |
| `saveQueues` | admin | `{ date, queues:[{ assignedTo, items:[{ propertyName, propertyId?, status? }] }] }` | `{ saved: <number of rows> }`. Atomic under one lock. Replaces each named intern's queue for that date the same way `saveQueue` does. |
| `indexCheck` | admin | — | `{ checkedAt, directoryCount, checkerCount, directoryOnly:[{id,name}], checkerOnly:[{id,name,path}], sold:[{id,name}] }` |

## The tracker's columns and words

The Posts tab records what the interns' own sheet, "POSTING TRACKER - INTERNS", does, with
its column names, words and formats (server/README.md has the detail).

- **Posts**, as a new tab gets them: `Date`, `Property type`, `Property title`,
  `FB account name`, `Link`, `Time posted`, `Share posting`, `Posted by`, `Property ID`.
  The older header names (`Title`, `Type`, `Time`, `Status`, `FB Account`, `Post Link`,
  `PropertyId`, …) are still read, so an existing tab keeps working.
  - `Date` is written and read as `yyyy-MM-dd` text. How the sheet displays it is not the
    app's concern.
  - `Time posted` is written `h:mm AM/PM` in Manila time (`10:23 AM`). The `posts` action
    and the `logPost` reply give it as `HH:mm`, whichever way the cell was written, so
    `PostLogEntry.time` stays `HH:mm`.
  - `Property type` is the listing's category, title cased: `Warehouse`,
    `Commercial Space`, `Condo / House and Lot`. Mixed case is kept as written.
  - `Share posting` is `Posted` or `Pending`.
- **Assignments** `Status`: `Not Shared` (assigned, not posted yet: the interns' word),
  `Pending` or `Posted`. `To post`, in rows written before, is read as `Not Shared`
  everywhere; new rows are written `Not Shared`. On screen it reads "Not shared".
- `posts` row fields are unchanged: `date, type, title, time, status, fbAccount, postLink,
  postedBy, propertyId`.

## Core (src/core)

- `AssignmentStatus` is `'Not Shared' | 'Pending' | 'Posted'`; `queueStatus(value)`
  (types.ts) reads any spelling, `To post` included. The planner and the summary helpers
  read statuses through it.
- `core/records.ts`: `propertyType(category)` (Code.gs's `propertyType_`, character for
  character), `clockTime('14:30') → '2:30 PM'`, `sheetDate('2026-10-26') → '10/26/26'`,
  `POST_COLUMNS`, and `postsCsv(posts)`: the Records CSV, in the interns' sheet's column
  order (`Date, Property type, Property title, FB account name, Link, Time posted,
  Share posting, Posted by`), date as M/D/YY and time as h:mm AM/PM. The Records table
  shows the same columns in the same order.

- `Property` (types.ts) gains these optional fields: `city, size, dealType, availability, issues`.
- `TeamMember` gains `fbProfileLink?: string`; `AddPersonInput` gains `fbProfileLink?`.
- `LogPostInput.postLink` becomes required (a string), plus `status: 'Posted' | 'Pending'`.
- `Tracker` gains:
  - `addPerson(input) → { person, key }`
  - `setActive(name, active) → TeamMember`
  - `updatePerson(name, { fbAccounts?, fbProfileLink? }) → TeamMember`
  - `newKey(name) → string`
  - `saveQueues(date, queues) → number`
  - `indexCheck() → IndexCheck`
- `core/links.ts`:
  - `isFacebookPostLink(url): boolean`
  - `postLinkProblem(url): string | null`. The second returns a short sentence. The same rule as the server's.
  - `facebookProfileProblem(url): string | null`: the Team tab's profile link rule, the same as the server's (blank is fine).
- `core/planner.ts`, `planQueues(input) → Plan`. It's pure. Input:
  - `properties` (the Directory rows)
  - `posts`
  - `assignments`
  - `interns: string[]`
  - `perIntern: number` (default 20)
  - `date`
  - `rules: { cooldownDays, repostDueDays }`
  - `keepExisting: boolean`

  The plan:
  - **Skipped, with a reason for each:**
    - sold, or not available in the checker
    - posted within the cooldown
    - already queued for anyone that date
    - no separator (D6: copy is blocked)
  - **Order:**
    - never posted first
    - then the longest since last posted
    - round-robin across categories, so each intern gets a mix
  - **Fairness:**
    - no listing goes to two interns on the same date
    - each intern gets `perIntern` or as many as there are
  - **Output:**
    - `{ queues: Map<intern, item[]>, shortBy: number, skipped: {reason, count}[] }`
- `core/records.ts`:
  - `dailyTotals(posts, from, to) → [{date, posted, pending, byIntern:{[name]:n}}]`
  - `postsForProperty(posts, {id?, name?})`, newest first
  - `searchPosts(posts, {query, from, to, intern?, status?})`

## Screens (src/ui)

Admin nav: Tracker, Assign, Interns, Records, Find, Settings.
Intern nav: My queue, Find.

## v4 additions: the Settings page and light mode

Server:

| action | who | request | reply |
|---|---|---|---|
| `ping` | all | (unchanged) | also `version: <SERVER_VERSION string>` and `rules: { cooldownDays, repostDueDays, perIntern }` |
| `setRules` | admin | `{ cooldownDays?, repostDueDays?, perIntern? }` (whole numbers: cooldown 1–60, repost 1–120, per intern 1–100) | `{ rules }`, saved on a "Settings" tab (Key, Value) beside the Team tab (adminBook) |
| `rebuildDirectory` | admin | — | `{ started: true }`. It schedules BuildDirectory's RESTART on a time trigger about 10 s later and returns at once. If a build is already running it replies `error:'busy'`. |
| `directoryStatus` | admin | — | `{ running:boolean, done:number, total:number, builtAt:string\|'' }`. `builtAt` is set by BuildDirectory when a build finishes (script property). |

- `SERVER_VERSION` is a const at the top of Code.gs, e.g. `'2026-10-31.1'`.
- The app holds `EXPECTED_SERVER_VERSION` in `src/config.ts`.
- The cooldown, repost and planner rules come from the Settings tab. CONFIG values are only the defaults.

Core:
- `Rules` gains `perIntern`.
- `session`/`ping` reading exposes `version` and `rules`.
- `tracker.setRules`, `tracker.rebuildDirectory` and `tracker.directoryStatus`.
- `serverVersionStatus(version) → 'current' | 'behind' | 'unknown'`.

Theme:
- `src/ui/state/theme.ts` exports `type ThemeChoice = 'dark' | 'light' | 'system'`.
- `useTheme(): { choice, resolved: 'dark'|'light', setChoice }` is persisted with `platform.writeLocal('theme')` and applied as `<html data-theme="dark|light">`.
- `applySavedTheme()` is called in main.tsx before the first render, so nothing flashes.
- Light mode: black and gold on white. Gold text needs a darker gold to pass AA on white.

## v5 addition: the startup screen's map

- `properties` rows gain optional `lat` and `lng` (numbers), joined by FolderId from the
  owner's geocoding sheet (`CONFIG.GEO_SHEET_ID` / `CONFIG.GEO_TAB`; server/README.md).
  Absent when the listing has no good position or the sheet cannot be found. Read only.
- `Property` gains `lat?` and `lng?`; the directory keeps them, on disk too.
- `SERVER_VERSION` / `EXPECTED_SERVER_VERSION` `2026-11-01.1`.

## v5: Assign redesign and listings held by one intern

**The rule (the owner's): a listing assigned to an intern is held by that intern until it is posted.**

- **Held:** an Assignments row with status "Not Shared" (or the older "To post"), on ANY date, holds the listing for its assignee. Posted and Pending (posted, waiting for approval) release it, and the cooldown then applies as usual.
- No one else can be assigned a held listing.
- The same intern can't get it twice either, on any date.
- **Moving it:** an admin moves a held listing explicitly, by removing it from the first intern's queue. Then it's free.

Server:
- `saveQueue` and `saveQueues` refuse any item held by a different intern, with `error:'held'`, `held:[{ propertyName, propertyId, heldBy, date }]` and a message naming the first one. Nothing is written.
- Items already in this intern's open queue on another date are refused the same way, with `heldBy` being that intern, unless the request is that same date's queue, which is a replace.
- Re-saving the same intern and date replaces it as before.

Core:
- `summary.heldListings(assignments) → Map<propertyKey, { heldBy, date }>` covers open rows only, keyed by id, else by normalised name.
- `planQueues` skips held listings, with skip reason `held` replacing `queued`. A listing held by the intern being planned isn't re-added.
- `planForIntern(input & { intern, count, category? }) → QueueItemInput[]` is the "Assign 20" quick fill for one intern. It follows the same order: never posted first, then the longest since posted, with a mix of categories unless one category is chosen.

## v6: Weekly queues (replaces daily queues)

The owner: "assign per week only, e.g. 40 listings per week; Friday is the final day before the reset."

**The week**
- A **work week** runs **Monday to Friday**, and **Friday is the deadline**.
- The **week key** is that week's Monday, as yyyy-MM-dd in Manila time.
- `weekOf(date)`: Monday–Friday map to that week's Monday. **Saturday and Sunday map to the NEXT Monday**: the reset happens after Friday, and weekend time belongs to the coming week.
- `weekDays(week)` gives Monday–Friday. `isWeekOver(week, today)` is true when today > that Friday.

**Queues**
- An intern gets one queue per week. Assignments rows keep the `Date` column but store the **week key**.
- Old daily rows still read: their date maps to `weekOf(date)`, so the past still shows correctly.
- `saveQueue`/`saveQueues` take `week` (a Monday). `date` is still accepted and converted with `weekOf`.
- **Held rule:** an open (Not Shared) row holds its listing only while its week is NOT over. When the week ends, unposted rows are **Missed**. They're shown in reports, never written as a status, and they no longer hold the listing.
- Posted and Pending release a listing as before, and then the cooldown applies.

**Rules**
- `perWeek` (default 40, 1–200) replaces `perIntern` as the planner and quick-fill default. A Settings tab key "Per week" is read; the old "Per intern" key is read as a fallback.
- Bump SERVER_VERSION and EXPECTED_SERVER_VERSION to `2026-11-01.3`.

**Pace** (core `weekProgress(intern, week, assignments, posts, today)`)
- Returns `{ target, posted, pending, notShared, missed, daysLeft, expectedByToday, pace: 'done'|'on-track'|'behind'|'not-started'|'missed' }`.
- **expectedByToday** = ceil(target × weekdaysElapsed ÷ 5), where weekdaysElapsed counts today if it's a weekday.
- **pace:**
  - **done:** posted+pending ≥ target
  - **not-started:** 0 posted and it's past Monday
  - **behind:** posted+pending < expectedByToday
  - **missed:** the week is over with items left
  - **on-track:** everything else
- `weekPostsByDay(intern, week, posts)` returns [Mon..Fri] counts.

**Who posted it**
- `core/records.whoPosted(posts, query)` returns the matches by listing name, id or link, newest first, with intern, date, time, FB account and link. It's the quick lookup for inquiries.

**Screens**
- **Assign:** a week picker (This week / Next week / ‹ ›, labelled "2–6 Nov"). From Saturday it defaults to next week, otherwise this week. "Add 40 for posting" fills the week.
- **Interns:** the weekly monitor (pace, Mon–Fri dots, Missed), plus the "Who posted?" lookup.
- **Intern's My queue:** "This week · 12 of 40 · Due Fri".

## v7: documents with no separator are shown, with a warning (the owner's decision)

- **Before:** an intern never saw a document with no separator, and Copy was blocked (D6/D13).
- **Now:** the owner wants these shown with a warning to check the contents before posting.

**Server (`property` action), for an intern and a no-separator document:**
- Send the full text as `publicText`, plus `unseparated: true` and `withheld: false`.
- Also send `flaggedLines: number[]`: 0-based line numbers in publicText where `markerKind_` or the owner/commission/phone patterns match. These are the "possible owner or commission detail" lines.
- Separated documents are unchanged: interns still never get the internal section.
- A missing document stays as it is.
- Bump SERVER_VERSION and EXPECTED_SERVER_VERSION to `2026-11-01.4`.

**App, for an unseparated document:**
- Show the text with an amber notice: "No separator. Check before posting: remove owner names, numbers and commission."
- Highlight the flagged lines.
- Copy needs a tick: "I checked it".
- What's copied leaves out the flagged lines.
- The pre-post checks run on the text that would be copied. A commission hit still blocks, with the line shown.

**Doc health:**
- `core/summary.docHealth(properties)` returns `{ noSeparator, noDocument, noPhotos, emptyAbove, unreadable }`, each a list of `{ id, name, docId?, folder }`.
- The issues text comes from BuildDirectory: "No separator line", "No document", "No photos", "Document is empty above the separator", "Could not read document". The server's `properties` rows should carry `docId` (the DocId column) when present.
- Each list offers "Open doc" (https://docs.google.com/document/d/<docId>/edit) or Open folder, so an admin can fix it in Google Docs. A fixed document applies at once, because opening a listing re-reads it live.

## v8 (proposed with the Find redesign; the owner to agree): building and created

- `properties` rows gain two more optional checker fields, joined the same way: `building`
  (the CSV's "Building / street", for search) and `created` (its "Created" as `yyyy-MM-dd`;
  `''` when it can't be read). Absent when the join is off.
- `Property` gains `building?` and `created?`. The directory's search also matches the city and
  the building. Find's "Newest" sorts by `created`, and is offered only once some listing has it.
- No version bump: the fields are optional, and an older server simply doesn't send them.

## v9: interns read the internal section; several FB accounts per person (server 2026-11-03.2)

- `property`: an intern's reply carries `internalText` when the document is separated (D16).
  The app shows it folded, never copies it and never saves it.
- `team`, `addPerson`, `updatePerson`, `setActive`: each person gains `fbProfiles`,
  `[{ account, link }]`, one per FB account they post as, in `fbAccounts`' order (`link` is
  `''` when none). `fbProfileLink` stays, as the first link, for an older app.
- `addPerson` and `updatePerson` take `fbProfiles`. When sent it replaces `fbAccounts` and
  `fbProfileLink`. Refused with `bad-accounts`: a name given twice (any case), a link with no
  name, a comma in a name, or not a list; `bad-profile-link` for a link not on Facebook.
- The Team tab keeps its columns: FB Accounts holds the names, FB Profile Link one link per
  line in the same order. A cell from before v9 (one link) is the first account's.
- `logPost` is unchanged: the FB account must be one of the person's `fbAccounts`.
- The weekly target stays per person, however many accounts they post from.
- `core/types.FbProfile`; `TeamMember.fbProfiles`; `AddPersonInput.fbProfiles` and
  `UpdatePersonInput.fbProfiles`.

## v10: Firebase sign-in instead of keys (server 2026-11-04.1)

- Every action accepts `idToken` (a Firebase sign-in token) in place of `key`; with both, the
  token wins. Code.gs checks it with Google's accounts:lookup (`CONFIG.FIREBASE_API_KEY`, the live
  project's web key) and finds the active Team row whose Email matches, in any case.
- Refused with `unauthorized`: "Your sign-in has ended. Sign in again." (a bad, expired or
  turned-off token), or "Nobody active on the Team tab has the email ... Ask your admin to add it."
- `core/backend` sends `idToken` (and never `key`) when `BackendConfig.idToken` is set; `who`
  (the account's uid) keeps `identity()` the same while the token renews.

## v11: the account says who you are (server 2026-11-04.2)

- With `idToken`, the caller's role is the account's `role` claim (agent: Intern; admin, owner:
  Admin), and its name the account's display name (its email when it has none). No Team row is
  needed. An active Team row with the same email gives its Name and FB Accounts instead; its
  Role is not read.
- Refused with `unauthorized`: "Your sign-in has ended. Sign in again." (bad, expired or
  turned-off token), or "This account can't use Post-It yet. Ask an admin to give it a role on
  the People screen." (no role, or the scanner).

## v12: never lose a log (server 2026-11-04.3)

- `logPost` with a `postLink` the same person already logged returns that row,
  `{ ok: true, repeat: true, status, date, time, type, postedBy }`, and writes nothing: a retry
  whose first try was saved. Someone else's row with the same link is not taken as one.
- `logPost` takes `loggedAt` (ISO with its zone): the row is dated by it when it is not in the
  future and at most four days old; otherwise now. The cooldown is judged at that moment too.
- `core/outbox`: `keepsForRetry(err)` is true for a failure on the way (unreachable, timeout,
  http, busy, an unreadable reply, a Google page, unauthorized, server); a refusal is not kept.

## v13: the team from Firebase (server 2026-11-04.4)

With an `idToken`, `team` lists Alpha Listing Hub's people (`listPeople`, asked with that token):
`{ name, role, email, fbAccounts, fbProfiles, fbProfileLink, active }`, role `Intern` for agent and
`Admin` for admin or owner; others are left out. FB accounts are the Team tab's for that email.
`updatePerson` saves FB accounts on the Team tab row with the person's email, making it when there
is none. `addPerson`, `setActive` and `newKey` reply `{ ok: false, error: 'hub-people' }`.
`saveQueues` and `logPost`'s `postedBy` take active people on Firebase. When `listPeople` can't be
read, the reply's error is "Couldn't read the people from Alpha Listing Hub. Try again." Calls with
a `key` are unchanged.

## v14: queues of 1 to 3 working weeks (server 2026-11-06.1)

A queue runs from its start for 1, 2 or 3 weeks of working days; Saturday and Sunday don't count.
Saved on Friday 6 Nov for 2 weeks, it is due Thursday 19 Nov (10 working days, the start counted);
saved at the weekend, it starts on Monday. The Assignments tab's `Date` is the start and the new
`Due` column (added on the first v14 save) the deadline. A row without `Due` is a one-week queue,
Monday to Friday of its week. A queue's key is the Monday of its start's week, one per person.

`saveQueue` and each queue in `saveQueues` take `start` and `due` (yyyy-MM-dd, working days, due on
or after start, 3 weeks at most; else `error: 'bad-period'`). A queue that shares a working day with
another of the same person's is refused with `error: 'overlap'`, `person`, `start`, `due`: one queue
at a time. A save without them (an app before v14) keeps the queue's saved dates. Listings are held
until the deadline; Not shared turns Missed the day after it. `assignments` rows carry `due`.
The rules gain `queueWeeks` (Settings tab `Queue weeks`, 1–3, default 2): a new queue's length.
The target of a queue is `perWeek` × its weeks; the behind warning starts on its third working day.
