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
* **The 7-day cooldown is a real guarantee.** `logPost` checks it under `LockService`,
  so two interns saving the same property at the same moment cannot both get through.
  A client-side check can always be raced or bypassed.

## The project's files

All of these go into **one** Apps Script project:

| File | What it is |
|---|---|
| `Code.gs` | The web app: every action below. |
| `Separators.gs` | **Required.** The one place that decides where a listing's postable text ends (D13). `Code.gs` calls it whenever a property is opened; without it, opening a property fails with "Separators.gs is missing from this Apps Script project", and `SETUP` says the same. Paste it unchanged. It is pure ASCII so the editor cannot corrupt a rule, and its rules are never copied into another file. |
| `BuildDirectory.gs` | Builds the directory sheet from the Drive library (`START`, `STATUS`, `CONTINUE`, `STOP`, `RESTART`, `VERIFY`). |
| `appsscript.json` | The manifest. |

Apps Script gives every file in a project **one global scope**. A top-level name declared in
two files breaks the project when it is a `const`, and silently replaces the other when it
is a `function`. `app/src/server-tests` loads the three files into one scope the same way,
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
  script's `Team` tab. `Team` lists everyone's key, so it cannot live in a sheet the team
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
   * `COOLDOWN_DAYS` and `TZ`: 7 days, on Manila's calendar.
5. Check `CFG` at the top of `BuildDirectory.gs` (`ROOT_FOLDER_ID`, `SHEET_ID`), and run
   **`START`** to build the directory.
6. Run **`SETUP`** from the editor and accept the permission prompt. It checks that
   `Separators.gs` is there, then counts the directory's listings, the tracker's rows and
   the team.
7. For each person, edit the three values at the top of **`ADD_PERSON`** and press Run. The
   key is printed in the execution log. Paste it into their copy of Post-It.
   `SHARED_KEY` stops working the moment the Team tab has its first row.
8. Deploy → New deployment → **Web app**. Execute as **Me**, access **Anyone**.
   Leave any earlier deployment running until the desktop app is proven.
   "Execute as Me" is the whole point: every Drive read happens as the library's owner,
   so nobody else needs Drive access. Copy the `/exec` URL.
9. Check it: `<exec-url>?action=ping&key=<your key>` in a browser. It should name you
   and your role. That puts your key in the browser's history, so do it once, from your
   own machine. The app always sends the key in the request body.

## Actions

Every call carries `key`, and the key *is* the identity: it is resolved to a name and a
role before anything is dispatched (`docs/ROLES.md`). The app POSTs JSON; a GET with query
parameters is answered the same way. Every reply is `{ ok: true, … }` or
`{ ok: false, error, message? }`.

| Action | Who | What it does |
|---|---|---|
| `ping` | everyone | Who the key belongs to: `name`, `role`, `fbAccounts`, and the server's `time`. |
| `properties` | everyone | Every listing: `id`, `name`, `category`, `listingType`, `subCategory`, `photoCount`, `hasIssues`. One sheet read. |
| `property` | everyone | One listing by `id`: `publicText`, `photos`, `hasInternal`, `withheld`, `cutAt`, `issues`, `live`, and for an Admin only, `internalText`. |
| `posts` | everyone | The Posts tab as rows, every value text. An intern gets only their own. |
| `assignments` | everyone | The Assignments tab as rows, every value text. An intern gets only their own. |
| `logPost` | everyone | Appends a Posts row and replies with its `status`, `date`, `time` and `postedBy`. Refuses with `error: 'cooldown'` (with `lastPosted`, `nextAllowed` and the sentence to show) inside the cooldown, and with `'forbidden'` for a Facebook account not on the person's Team row. |
| `addLink` | everyone | Turns a Pending row into Posted with its link: `notfound` when there is no such row. An intern can complete only their own. |
| `setStatus` | everyone | Moves one queue item's status: `notfound` when no open item matches. An intern can move only their own. |
| `saveQueue` | Admin | Replaces one person's queue for one date. |

Two things in a reply come from the key, never from the request:

* **`internalText`** is in a `property` reply only for an Admin. For an intern
  it is not empty, it is absent. A heading separator's label quotes its line
  (`heading: Commission: 3%`), so an intern's `cutAt` is the kind of marker only (`heading`).
* **`postedBy`** on a logged post is the caller's own name. An Admin may log on an
  intern's behalf by sending `postedBy`; from an intern it is ignored.

### `withheld`

When nobody has separated a document, `Separators.gs` finds no marker, and none of the text
is confirmed safe to post. Blocking the Copy button is not enough (D6): text on screen can be
selected and copied by hand. So an intern is not sent it at all (D13). Their reply has
`publicText: ''`, `hasInternal: false` and `withheld: true`, so the screen can say why it is
empty. An Admin gets the whole document in `publicText`, with `withheld: false`,
so they can add the separator. The same holds when the text comes from the directory's copy
rather than the live document.

## Your existing tracker is not reformatted

Nothing is written by column position. Each field is found by matching the sheet's own
header row against a list of accepted spellings (`POST_FIELDS` / `ASSIGN_FIELDS`), so the
tracker keeps its column order and wording. A column the sheet does not have is skipped;
a *required* one that is missing raises a message naming it. The header row is read with
the rows, never cached, so a column moved in the sheet takes effect at once.

**What the script writes is plain text** (D7). It formats each cell it fills as `@` before
writing to it, so a date stays `2026-03-09`, a time stays `14:30`, a folder named `1201`
stays text, and nothing beginning `=` or `+` is evaluated. Columns it does not fill keep
their own format. Everything read comes back as text too: a date as `yyyy-MM-dd`, a time as
`HH:mm`, a number as its digits. A time that an earlier version let Sheets turn into a time
value reads back as `HH:mm`, not as `1899-12-30`.

The one column worth adding is **PropertyId**. A row is matched to a listing by its folder id
when both have one, so renaming a folder breaks nothing. A row without one, such as every row
logged before the column was added, is matched by its title, with case, accents, punctuation
and the usual abbreviations ignored, as the app matches names.

## The cooldown

A listing posted, or logged as Pending, fewer than `COOLDOWN_DAYS` calendar days ago on
Manila's calendar cannot be logged again. Pending counts because a post still waiting for its
link must stop a second intern posting the same listing. The app predicts the same answer
before it asks (`app/src/core/cooldown.ts`), but the server's answer is the one that holds,
because it is given under the lock.

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
* **Revoking takes up to a minute.** Set Active to `FALSE` on the Team tab. The tab is
  cached for 60 seconds, so a key already in use keeps working until then.
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

`app/src/core/backend.ts` POSTs `{ action, key, … }` as JSON to the `/exec` URL and turns
every refusal into a sentence a person can act on. `tracker.ts` and `directory.ts` read the
replies. A logged post's date, time and Posted By are always taken from the reply, never from
the PC's clock.

## Testing it

`app/src/server-tests` runs these files in Node, in one shared scope, with every Google
service they use faked, including a Sheets that evaluates what it is given as Sheets does:

```
cd app
npx vitest run src/server-tests/
```

The tests also hold the server to the app's own rules: its name matching, its reading of the
tracker's dates, and its cooldown, through its own client.
