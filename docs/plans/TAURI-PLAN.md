# Building Post-It in Tauri, React and TypeScript: plan

Written Oct 31, 2026. Planning only: nothing here is built yet. The direction follows
[D42](../../../apr-listing-checker/docs/DECISIONS.md) in the checker's repo — on Oct 30, 2026
the IT head said every company system uses Tauri, React and TypeScript, so they can be
joined later without friction.

In this plan, **the prototype** is the C# / WPF solution in `src/`, 204 tests, never run on
Windows. **The new app** is the Tauri app this plan builds in `app/`. **The checker** is
Alpha Listing Hub, the sibling application in `apr-listing-checker`.

---

## 1. What it's for

- **Post-It and the checker are two halves of one job.** The checker asks "has this been
  posted before?". Post-It asks "what should I post next, and did it go out?". They read the
  same Drive library and will be joined later, so they should be the same kind of program.
- **Nothing is lost by moving now.** The checker is porting a working 2.0.0 and must keep two
  apps alive during the port. Post-It has never been run by anybody: there is no installed
  version, no user data, no dual-maintenance period. **It is cheaper to move Post-It than the
  checker, and the work is already specified.**
- **The rules are written and tested.** `PostIt.Core` and `PostIt.Presentation` are UI-free
  C# with 204 tests covering the cooldown, the posting-text split, the pre-post checks, the
  property name matcher, the queues, the tracker, and every screen's logic. Those tests are
  the acceptance criteria for the TypeScript port; they say what "right" means before a line
  of it is written.
- **Firebase is coming.** The checker's FIREBASE-PLAN puts the rules in Cloud Functions.
  Rules written in TypeScript now move there; rules written in C# would be written twice.

---

## 2. Decisions

Record anything that changes on the way under Deviations at the end.

| Topic | Decision |
|---|---|
| Where | `app/` in this repo. `src/` (the C# prototype) is deleted at step 9; git keeps it |
| The prototype meanwhile | Not built, not fixed, not run. It is a specification, not a program. Its tests are ported, not maintained |
| What's built | Everything the proposal describes: find a property, copy only the public text, download photos, log the post, the 7-day cooldown, queues, pending follow-up, the manager's tracker, doc health |
| TypeScript does | The screens, and every rule: the directory, the posting-text split, the pre-post checks, the cooldown, the name matcher, queues, the tracker, settings |
| Rust does | Only what the WebView can't: the clipboard, saving photos to disk, opening Explorer and the browser, the per-PC key, and the global shortcut. The rules stay in TypeScript so they can move to a Cloud Function as they are |
| The OS | One TypeScript interface, `platform`, is the screens' and rules' only way to the OS, with two versions: Tauri's, and a fake for the browser and tests. With the fake the whole app runs in a plain browser |
| The backend | The Apps Script web app stays (`server/apps-script/Code.gs`). It is the only holder of Google credentials. The directory sheet is the index; the tracker sheet is the record |
| Sign-in | Per-user keys on a Team tab, as built. **Not** the checker's anonymous model: Post-It decides who may see commission and owner details, and records who posted what, so it needs to know who is calling (see §7) |
| Look | The checker's design system, as CSS variables. Same palette, type scale, spacing, motion and focus rule. The two apps must read as one family |
| Tools | Vite, React, TypeScript in strict mode. Vitest for rules, Playwright for screens, `cargo test` for Rust. Styling, router and package manager follow the IT head's conventions (open question 1) |
| Name and version | **APG Post-It** on screen. Version 1.0.0 — it has never shipped |
| Platforms | Windows first. The app should build on macOS and Linux, where saving photos and Explorer differ and the app says so |

---

## 3. How it fits together

```
Google Drive: APR LISTING (one folder per listing: a document and the photos)
   │
   │ BuildDirectory.gs — nightly, or Rebuild now
   ▼
Directory sheet: 1,474 listings
   ├─ category, listing type, sub-category, name
   ├─ photo download links
   ├─ posting text, cut at the first separator
   └─ what was flagged: no separator, no document, no photos
   │
Tracker sheet (Posts, Assignments)   Admin sheet, private (Team: names, roles, keys)
   │                                  │
   └──────────────┬───────────────────┘
                  │ Code.gs — the only holder of Google credentials
                  ▼
          HTTPS, key in the body
                  ▼
app/
 ├─ src/
 │   ├─ core/ ....... directory, posting text, checks, cooldown, matcher, queues, tracker
 │   ├─ platform/ ... the only way to the OS: Tauri's version and the fake
 │   ├─ ui/ ......... sign in, search, a property, log a post, my queue, assign, tracker, settings
 │   └─ theme/ ...... the checker's colours, type scale, spacing, motion
 ├─ src-tauri/ ...... Rust: clipboard, photo downloads, Explorer, the key, the shortcut
 └─ crates/ ......... shared Rust, if any proves necessary
```

`core/` imports nothing from React or Tauri, so it runs in the app, in tests, and later in a
Cloud Function.

Tauri plugins and what each does:

| Plugin | For |
|---|---|
| clipboard-manager | Copy the public text. The one button that matters |
| http | The web app and Drive photo downloads, through Rust, so the browser's cross-site limits don't apply. Only Google's addresses allowed |
| fs, dialog, opener | Saving photos, choosing a folder, opening Drive and Facebook |
| single-instance | A second launch brings up the open window |
| window-state | The window's place and size |
| global-shortcut | Bring Post-It up while Facebook has the focus |
| updater, process | Updates and the restart after one |

---

## 4. What carries over from the prototype

The C# is a specification with tests. The port is mechanical for the parts that matter:

| C# | TypeScript | Tests |
|---|---|---|
| `Rules/CooldownPolicy` | `core/cooldown.ts` | 7-day refusal, next allowed date, repost due |
| `Rules/PostingTextParser` | `core/posting-text.ts` | the split, metadata lines, every marker |
| `Rules/PrePostChecker` | `core/checks.ts` | price, contacts, commission wording, **no separator blocks Copy** |
| `Rules/PropertyNameMatcher` | `core/matcher.ts` | fuzzy match, the numeric guard, typo suggestions |
| `Services/PostingService` | `core/posting.ts` | logging a post, completing a pending one |
| `Services/AssignmentService` | `core/queues.ts` | building a queue, cooldown blocking, reordering |
| `Services/TrackerService` | `core/tracker.ts` | posted today, pending, due for repost, never posted |
| `Infrastructure/Google/Script*` | `core/backend.ts` | the key in the body, every refusal as a sentence |
| `ViewModels/*` | React components + hooks | the 204 tests become Vitest and Playwright |

**What does not carry over:** the WPF theme (replaced by the checker's), `Mvvm.cs` (React has
its own), the local-folder and CSV adapters (the prototype's sample data — the new app talks
to the backend or to the fake), and `xaml_check.py`.

---

## 5. Build order

Each step ends with the tests passing and the app working on Windows and in the browser.

| # | Step | Effort | Done when |
|---|---|---|---|
| 0 | **Before building.** Answer the open questions. Confirm the tracker's tab name and whether a `PropertyId` column may be added. Create the private admin sheet. Install the nightly directory rebuild | 0.5 day, needs the IT head and the account owner | The questions are answered and the directory rebuilds itself nightly |
| 1 | **The empty app.** Tauri 2, Vite, React, TypeScript in `app/`, `platform` with both versions, the theme as CSS variables with Montserrat, the top bar's measured layout, one window per PC | 0.5 day | The window opens on Windows and in the browser. A second launch brings it up |
| 2 | **The backend and sign in.** `core/backend.ts`, the key, `ping`, the directory read and its cache, settings. Every refusal arrives as a sentence | 0.5 day | Signing in with a Team key names you and your role. An unknown key says what to do |
| 3 | **Find a property.** Search over the cached directory, filters by category and listing type, the property page: the public text in its green box with the one Copy button, the pre-post checks, the photo grid | 1 day | Search is instant over 1,474 rows. Copy is blocked when a check fails or no separator was found. An intern's reply contains no internal text at all |
| 4 | **Photos.** Download all to `Downloads\APG Post-It\<property>`, open one, the thumbnail cache | 0.5 day | A property's photos land on disk ready for the Facebook upload box |
| 5 | **Log a post.** The two fields, the rest filled in, the link check, the cooldown refusal with its next allowed date, writing the tracker row | 0.5 day | A post is logged. One inside the cooldown is refused by the server, not the client |
| 6 | **My Queue.** Today's list in the manager's order, Pending pinned, the counts, completing a pending post with its live link | 0.5 day | An intern works a queue from top to bottom |
| 7 | **The manager.** Assign (search and add, paste a typed list with typo suggestions, cooldown and already-queued blocking, reorder, save), the Tracker (posted today, pending, who's done, due for repost, never posted), doc health from the directory's own Issues column | 1.5 days | A queue is built and saved. The tracker shows the day |
| 8 | **Admin, install and updates.** Settings, the team and their keys, the Tauri installer and the updater from GitHub Releases | 0.5 day | A test PC installs and updates itself |
| 9 | **The switch.** Interns get keys and the installer. Docs. `src/` is deleted | 0.5 day | Post-It is in daily use. The C# is gone |

About 6 days. Steps 4 and 7 need only step 1 and the backend, so they can be built beside 3
and 5.

---

## 6. What we take from the checker

Patterns proven in the sibling app, adopted here:

- **Batched Drive queries.** `Drive.Files.list` with 30 parent ids OR'd together and
  `pageSize: 1000`, instead of an iterator per folder. The difference between a 20-second
  crawl and a timeout.
- **A stamp column on every row**, so the consumer derives freshness from the data itself.
- **Overwrite in place, never clear first**, then clear only trailing leftovers — a reader
  during a rebuild sees a complete table.
- **Set number formats before writing values.** `'@'` for ids, sizes and ISO timestamps.
  Post-It learned this the hard way: a `Cut at` label beginning with `=` became `#ERROR!` in
  35 rows before the format was set.
- **A freshness cooldown instead of rate limiting**: an endpoint that cannot be made to do
  expensive work more than once every two minutes, however many clients ask.
- **Return the fresh bytes from the mutation call**, so the client never races the publish lag.
- **Pure, service-free rules**, so the same code runs in the app, in tests and later in a
  Cloud Function.
- **Atomic, parse-validated cache replacement**: write `.tmp`, parse, then move. A bad
  download leaves the old cache intact.
- **An HTML body means a sign-in page**, not data. Say so plainly.
- **The exclusion list.** `Contents`, `Hiring`, `Sir Mark`, `TV VIDEO`, `VO`,
  `Virtual Office for posting`. Post-It's directory currently keeps the last of those as 3
  rows; it should not.

And the traps the checker flagged, which Post-It must not repeat:

- **No resumability.** The checker's indexer throws at five minutes and asks a human to
  rewrite it. Post-It's directory builder already batches and reschedules itself — keep it.
- **Prefix exclusions are dangerous.** `'VO'` excludes any top-level folder starting "vo".
  Match whole names.
- **Parent resolution is lossy** when a folder has several parents. Post-It walks downward
  from the root, so this does not arise; do not switch to a parents query without handling it.

---

## 7. Where Post-It differs, and why

The checker is **anonymous by design** (its D4, D20): no sign-in, published CSVs, a web app
open to anyone with the link. That is right for it — folder names, cities and sizes are what
agents post publicly anyway.

**Post-It cannot copy that**, and the difference is not a preference:

1. **It decides who may see the owner's details and the commission.** The split happens on
   the server and an intern's reply has no internal text in it at all. An anonymous endpoint
   has nobody to withhold it from.
2. **It records who posted what.** `Posted By` is taken from the key, not from the request,
   so a post cannot be logged under someone else's name.
3. **It refuses posts inside the cooldown** under a lock. A client-side check can be raced.

So Post-It keeps per-user keys on a private Team tab: the key resolves to a name and a role
before anything is dispatched, revoking somebody is one cell, and a leaked intern key grants
intern rights only. This costs almost nothing and the checker's own notes say as much.

---

## 8. Open questions

| # | Question | Who |
|---|---|---|
| 1 | Conventions: Tauri and React versions, styling (Tailwind, a component library?), router, state, package manager, lint and format rules, folder layout. Blocks step 1 | IT head |
| 2 | One Tauri app with Post-It and the checker as modules, or two apps that look alike? This plan keeps the rules and the OS apart from the screens, so either works | IT head |
| 3 | The company's GitHub organization for the releases repo. Blocks step 8 | IT head |
| 4 | Do Post-It and the checker share the design system as a package, or copy it? A package is better and needs somewhere to live | IT head |
| 5 | The exact tab name of the posts sheet in the tracker | Account owner |
| 6 | May a `PropertyId` column be added to the tracker? Without it, rows match by property name and break when a folder is renamed | Account owner |
| 7 | 79 listings have no separator in their document, so none of their text is confirmed safe to post. Who fixes those, and by when? | Manager |

---

## Deviations

Nothing built yet.
