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
| `team` | admin | — | unchanged |
| `addPerson` | admin | `{ name, role:'Intern'\|'Admin', fbAccounts?: string[], email? }` | `{ person: TeamMember, key }`. The key is shown ONCE. A name that already exists (case-insensitive) gives `error:'duplicate'`. |
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
- `LogPostInput.postLink` becomes required (a string), plus `status: 'Posted' | 'Pending'`.
- `Tracker` gains:
  - `addPerson(input) → { person, key }`
  - `setActive(name, active) → TeamMember`
  - `newKey(name) → string`
  - `saveQueues(date, queues) → number`
  - `indexCheck() → IndexCheck`
- `core/links.ts`:
  - `isFacebookPostLink(url): boolean`
  - `postLinkProblem(url): string | null`. The second returns a short sentence. The same rule as the server's.
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
