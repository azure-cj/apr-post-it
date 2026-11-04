# Jira board draft: APG Post-It

**Status:** created in Jira on Nov 4, 2026, in project AID (alpha-web-it.atlassian.net): epics
AID-113 to AID-129, stories AID-130 to AID-226, all labelled `post-it`. The `PI-` refs below are
draft refs; each story's description names its ref. Built from the git history (Oct 30 – Nov 3, 2026),
`docs/DECISIONS.md` (D1–D18), `docs/CONTRACT-v3.md` (v3–v10), `docs/plans/TAURI-PLAN.md` and the
uncommitted work in the tree as of Nov 4, 2026.

**Later on Nov 4, in Jira (pushed `2eaea96`):** D19, the Firebase account alone says who you
are, so PI-99 (AID-243, Team emails) is no longer needed. New PI-101 (AID-257): deploy server
`2026-11-04.2`. PI-56 (AID-147, auto-update) unblocked and In Progress. Done: AID-134, 136, 138,
142, 144, 200, 242.

**Updated Nov 4, 2026, in this file and in Jira:** sign-in no longer uses keys. The per-PC key
link (PI-52, AID-140) is replaced by the web app trusting the Firebase sign-in (D18, contract
v10). New stories PI-98 to PI-100 are AID-242, AID-243 and AID-244. AID-140 is closed as Done
(Jira has no Won't Do status here), with the reason in its title and a comment.

**Added Nov 4, 2026:** PI-101 is AID-245 (under AID-128). The ideas epic PI-E18 is AID-246, with
PI-102 to PI-106 as AID-247 to AID-251, labelled `idea`, priority Low.

Statuses used: **Done** (committed), **In Progress** (in the working tree, not committed),
**To Do** (planned, not started), **Blocked** (waiting on a person's answer), **Won't Do**
(replaced by another story).

Suggested labels: `server`, `app`, `intern`, `admin`, `security`, `data`, `release`, `decision`.

---

## Summary

| Epic | Title | Status | Stories |
|---|---|---|---|
| PI-E1 | Foundation: Tauri app and design system | Done | 6 |
| PI-E2 | Apps Script backend, keys and roles | Done | 7 |
| PI-E3 | Listing directory (Drive index) | Done | 7 |
| PI-E4 | Posting-text safety | Done | 6 |
| PI-E5 | Intern workflow: Find, property, photos, log, queue | Done | 6 |
| PI-E6 | Admin: Assign and weekly queues | Done | 5 |
| PI-E7 | Admin: Tracker, Records and monitoring | Done | 5 |
| PI-E8 | Team management and Settings | In Progress | 6 |
| PI-E9 | Sign in with an Alpha Listing Hub account (Firebase) | In Progress | 9 |
| PI-E10 | Release, install and rollout | To Do | 6 |
| PI-E11 | Join the listing hub and the checker | To Do | 5 |
| PI-E12 | Open decisions and data clean-up | Blocked / To Do | 6 |
| PI-E13 | Unseparated documents: a screen to fix them | To Do | 6 |
| PI-E14 | Never lose a log | To Do | 4 |
| PI-E15 | Record which Facebook group | To Do / Blocked | 5 |
| PI-E16 | Pending reminders and photos (pick, copy, clean up) | To Do | 6 |
| PI-E17 | Paraphrase the public text with Claude | Pending | 6 |
| PI-E18 | Ideas considered, not scheduled | Idea | 5 |

---

## PI-E1 · Foundation: Tauri app and design system — Done

Move Post-It from the C# / WPF prototype to Tauri 2 + React + TypeScript, the company stack (D10),
and share the checker's look (D12).

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-1 | Build the C# / WPF prototype as the specification (core rules, view-models, 204 tests) | Done | Oct 30. Retired Oct 31 (`71eb279`) |
| PI-2 | Write the Tauri plan and start the decision log | Done | `TAURI-PLAN.md`, D10, D11 |
| PI-3 | Scaffold the Tauri app with the checker's design tokens | Done | `src/theme/tokens.css`, D12 |
| PI-4 | Core rules, backend client, Tauri shell and platform layer (Tauri, browser, fake) | Done | `ab23782` |
| PI-5 | Own title bar with close confirmation; one window per PC | Done | `2a2530f` |
| PI-6 | OLED black and gold theme, plus light mode | Done | `e351cd0`, `31e21a0` |

**Acceptance (epic):** the app opens on Windows and in the browser; tests pass with `npm test`.

---

## PI-E2 · Apps Script backend, keys and roles — Done

The server that reads Drive and writes the tracker, and decides who may do what.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-7 | Apps Script backend for Drive properties and the tracker sheet | Done | `c9b3707` |
| PI-8 | Per-person keys; the key is the identity | Done | D2 |
| PI-9 | Team tab in a private admin spreadsheet, out of the shared tracker | Done | D3, `2a5bc96` |
| PI-10 | Server-side role enforcement (`PERMISSIONS`, `roleOf_`) | Done | `de81747` |
| PI-11 | Two roles only: Admin and Intern (Manager read as Admin) | Done | D14 |
| PI-12 | Cooldown checked under a lock before a post row is appended | Done | ROLES.md boundary 2 |
| PI-13 | Every refusal arrives as a plain sentence; say which Google setup problem it is | Done | `6ff2d2e` |

---

## PI-E3 · Listing directory (Drive index) — Done

One sheet row per listing, so search is one read instead of hundreds of Drive calls (D4).

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-14 | Build the directory sheet from the Drive library (`BuildDirectory.gs`) | Done | `d04d9ce` |
| PI-15 | `FIND_ROOT` / `START` diagnose an unreachable library folder | Done | `49007e1`, `2e39e5c` |
| PI-16 | Follow the real folder depth; a folder is a listing by sub-folders or own files | Done | D9 |
| PI-17 | Long jobs hand over to a trigger and schedule their successor first | Done | D8 |
| PI-18 | Nothing written to a sheet may be evaluated (plain-text ranges) | Done | D7 |
| PI-19 | `VERIFY` proves the sheet matches the Drive | Done | `a4e4252` |
| PI-20 | Shared exclusion list with the checker | Done | D11 |

---

## PI-E4 · Posting-text safety — Done

The owner's details and commission must never be posted.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-21 | Split the posting text on the server, not in the app | Done | D1 |
| PI-22 | Cut at whichever separator comes first; record `Cut at` | Done | D5 |
| PI-23 | One separator file (`Separators.gs`) used by server and app | Done | D13, ASCII-only test |
| PI-24 | Widen the commission check (curly apostrophes, plurals, "call the owner at…") | Done | D13, `be842d6` |
| PI-25 | Unseparated documents shown with a warning; flagged lines not copied; "I checked it" tick | Done | D15 (supersedes D6) |
| PI-26 | Interns read the internal section, never copy it | Done | D16, `0e1474d` |

---

## PI-E5 · Intern workflow — Done

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-27 | Find: search the cached directory, filters, numbered pages (10 per page) | Done | `1637916` |
| PI-28 | Property page: public text, one Copy button, pre-post checks | Done | |
| PI-29 | Photos: grid, viewer, download all to `Downloads\APG Post-It\<property>` | Done | |
| PI-30 | Log a post: FB account, live link required, cooldown refusal with next date | Done | `0ff4ee5` |
| PI-31 | My Queue: weekly list in the admin's order, Pending pinned, complete with live link | Done | |
| PI-32 | Startup screen with the listings map | Done | `183eb22` |

---

## PI-E6 · Admin: Assign and weekly queues — Done

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-33 | Assign in two steps; listings by category | Done | `865a14a` |
| PI-34 | Paste a typed list with typo suggestions; cooldown and already-queued blocking | Done | |
| PI-35 | Quick fill / fill queues for all interns | Done | `0ff4ee5`, `865a14a` |
| PI-36 | Listings held by one intern | Done | Contract v5 |
| PI-37 | Weekly queues with a Friday deadline (replaces daily) | Done | Contract v6, `dc8a0e2` |

---

## PI-E7 · Admin: Tracker, Records and monitoring — Done

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-38 | Posts match the interns' tracker sheet | Done | `e351cd0` |
| PI-39 | Weekly monitor and Who posted | Done | `dc8a0e2` |
| PI-40 | Records as a report screen (period, breakdown, chart) | Done | `ece1053`, `8985335` |
| PI-41 | Simpler Tracker with document health | Done | `8985335` |
| PI-42 | Interns screen in the admin sidebar | Done | `ea02e2c`, `052f207` |

---

## PI-E8 · Team management and Settings — In Progress

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-43 | Admin team management: add person, keys, set active | Done | `0ff4ee5` |
| PI-44 | Person has FB broker name and FB profile link | Done | `15c1d08`, `3b8fc86` |
| PI-45 | Settings in four tabs; editable rules; rebuild the directory from the app | Done | `31e21a0` |
| PI-46 | Built-in web app link, read-only in Settings | Done | `ea02e2c` |
| **PI-47** | **One person, several FB accounts, each with its own profile link** | **In Progress** | D17, contract v9. `FbAccountsField.tsx`, `PersonDialog`, `SettingsTeam`, `Code.gs`, server tests. Not committed |
| PI-48 | Deploy server `2026-11-04.1` as a new version of the existing deployment | Done | Covers PI-26, PI-47 and PI-98; app expects this version (`src/config.ts`). Was `2026-11-03.2` |

**PI-47 acceptance:**
- Accounts are edited as rows of name + link; a duplicate name, a link without a name, a comma
  in a name, or a non-Facebook link is refused with a sentence.
- An old one-link Team cell still reads as the first account's link.
- Log a post offers only the person's own accounts; the weekly target stays per person.
- `npm test` passes; committed with D17 and contract v9.

---

## PI-E9 · Sign in with an Alpha Listing Hub account (Firebase) — In Progress

Step 1 of joining the listing hub: one email and password for both apps, and **no keys**.
Listings, posts and queues stay in Apps Script. Each call carries the account's sign-in token;
`Code.gs` asks Google whose it is and finds the person by the Team tab's Email (D18, contract
v10). Name and role stay the Team tab's; the account's role must agree (agent → Intern,
admin/owner → Admin, anything else → no access).

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-49 | Firebase client: live project and emulator, sign-in, callable functions, sign-in token | In Progress | `src/platform/firebase.ts`, `firebase.test.ts`, `firebase@13.2.0`. Tested against the emulator |
| PI-50 | Map the hub role to a Post-It role; sign-in errors as sentences | In Progress | `src/core/account.ts` |
| PI-51 | Account sign-in screen (email, password, show password) | In Progress | `AccountSignIn.tsx`, `AccountSignIn.test.tsx` |
| PI-52 | ~~Link the account to the person's key once per PC~~ | Won't Do | Replaced by PI-98: no keys at all |
| PI-53 | CSP: allow Firebase hosts in the build; the emulator (and live) in `devCsp` | In Progress | `tauri.conf.json` |
| PI-54 | Decision record and contract entry for account sign-in | In Progress | D18, contract v10, server README. Not committed |
| PI-98 | Web app trusts the Firebase sign-in: token in place of a key, person found by Team Email | In Progress | `Code.gs` (`accountEmail_`, `identifyEmail_`, cached 5 min), `backend.ts` (`idToken`), 9 server tests. Keys still accepted for old copies |
| PI-99 | Fill in every person's Team tab Email with their Firebase account email | To Do | Admin. Without it, sign-in says "Nobody active on the Team tab has the email…" |
| PI-100 | Try sign-in on live (`$env:VITE_FIREBASE = 'live'; npm run tauri dev`) | To Do | After PI-48 and PI-99. First with `cj@aureo.com` |

**Epic acceptance:** an agent signs in with their hub account and lands in Post-It as an Intern,
under their Team tab name; an admin as Admin; an account with no role, or whose email is not on
the Team tab, is told why and signed out; no key is asked for or sent; development never reaches
the live project unless asked for.

---

## PI-E10 · Release, install and rollout — To Do

From `TAURI-PLAN.md` steps 8–9.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-55 | Installer build (`build.cmd`, NSIS) and `uninstall.cmd` | Done | `916436c` |
| PI-56 | Auto-update from GitHub Releases | Blocked | Needs the company GitHub org (plan Q3) |
| PI-57 | Install and update on a test PC | To Do | |
| PI-58 | Issue keys / accounts and the installer to every intern | To Do | |
| PI-59 | Install the nightly directory rebuild trigger | To Do | Plan step 0 |
| PI-60 | Post-It in daily use; close out the plan's Deviations section | To Do | Plan step 9 |

---

## PI-E11 · Join the listing hub and the checker — To Do

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-61 | Move posts and queues from Apps Script to Firebase (listings stay in Apps Script for now) | To Do | Functions built and tested on the emulator; kept as `docs/hub/post-it-functions.patch` for the hub repo. Not deployed |
| PI-62 | Retire keys on the server once every copy of the app signs in by account | To Do | Keys are already gone from the app (PI-98) |
| PI-63 | Decide: one Tauri app with Post-It and the checker as modules, or two | Blocked | IT head (plan Q2) |
| PI-64 | Shared design system package vs. copy | To Do | Currently copied (D12); revisit with PI-63 |
| PI-65 | Keep the exclusion list in step with the checker | To Do | D11, ongoing |

---

## PI-E12 · Open decisions and data clean-up — Blocked / To Do

| Key | Story | Status | Owner |
|---|---|---|---|
| PI-66 | Separate the ~79 documents with no separator | To Do | Admin / manager (plan Q7) |
| PI-67 | May an admin override a cooldown? If yes: required reason, logged | Blocked | Owner (ROLES.md open decision 2) |
| PI-68 | May a `PropertyId` column be added to the tracker? | Blocked | Account owner (plan Q6) |
| PI-69 | Confirm the tracker's posts tab name | Blocked | Account owner (plan Q5) |
| PI-70 | Agree contract v8: `building` and `created` fields, Find's "Newest" | Blocked | Owner (proposed) |
| PI-71 | Decide what a leaked intern key means now it can read internal text (D16) | To Do | Admin. Smaller once keys are retired (PI-62) |

---

## PI-E13 · Unseparated documents: a screen to fix them — To Do

The 79 documents with no separator are shown with a warning (D15), but nobody owns fixing them.
Make them a working list that gets shorter.

**How to handle them, in order of preference:**

1. **Fix in Drive.** The admin opens the document and adds the standard separator. Clean, and
   the checker benefits too. The app only helps: open the document, copy the separator, recheck.
2. **Set the cut in the app.** The admin picks the line where the public text ends. The app
   saves that in a tab of its own (Cuts), never in the Drive document (handover rule 3), and the
   server applies it when splitting. If the document changes afterwards, the saved cut no longer
   counts and the document is back to the warning.
3. **Claude suggests the cut** (needs PI-E17). The admin always confirms; nothing is automatic.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-72 | Doc health screen: the unseparated list with category, count left, "Open in Drive" | To Do | Admin only. Replaces the warning-only view |
| PI-73 | Recheck one document without rebuilding the whole directory | To Do | New server action `recheckDocument` |
| PI-74 | "Copy separator" button: puts the standard marker on the clipboard to paste into the doc | To Do | Marker from `Separators.gs` (D13) |
| PI-75 | Set the cut in the app: admin picks the last public line; saved to a Cuts tab | To Do | Tab: doc id, line, doc modified time, set by, when. Needs a decision record |
| PI-76 | A saved cut stops counting when the document's modified time changes | To Do | Back to the D15 warning; listed again on the screen |
| PI-77 | Claude suggests the cut line; admin confirms | To Do | Depends on PI-E17. The document goes to Claude, so this is admin only |

**Acceptance:** the count goes down as documents are fixed; a fixed document copies with no
"I checked it" tick; an edited document with a saved cut is warned about again.

---

## PI-E14 · Never lose a log — To Do

The intern has already posted on Facebook when they log it. If saving fails (Wi-Fi, an Apps
Script timeout, "busy"), the log must not be lost.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-78 | A log that fails to save is kept on this PC (an outbox), not lost | To Do | Through the platform store, not WebView storage |
| PI-79 | The outbox retries by itself: on launch, on reconnect, every few minutes | To Do | Title bar shows "1 post waiting to save" |
| PI-80 | Each log has its own id; the server ignores a repeat, so a retry never logs twice | To Do | The reply can be lost after the row is written. Needs a column: see PI-68 |
| PI-81 | A retry refused for the cooldown says so in a sentence and goes to the admin | To Do | The cooldown lock still decides (ROLES.md boundary 2) |

**Acceptance:** with the network off, log a post, close the app, reopen online: the post is
saved once, with its original date and time.

---

## PI-E15 · Record which Facebook group — To Do / Blocked

Today a post records the FB account, not where it went. Most posting is to groups.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-82 | Admin keeps a list of FB groups (name, link) in Settings | To Do | In an app-owned Groups tab |
| PI-83 | Log a post asks which group (or own profile / Marketplace) | To Do | |
| PI-84 | Decide: is the cooldown per listing (now) or per listing and group? | Blocked | Owner. Needs a decision record |
| PI-85 | Records and Tracker break posts down by group | To Do | |
| PI-86 | Add an "FB Group" column to the tracker | Blocked | Account owner, same question as PI-68 |

---

## PI-E16 · Pending reminders and photos — To Do

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-87 | My queue: "3 posts still need their link", oldest first | To Do | |
| PI-88 | Windows notification when Pending posts are older than a set time | To Do | Time set in Settings; admin sees Pending age per intern |
| PI-89 | Pick photos: a "Download photos" dialog, all ticked, then "Download n photos" | In Progress | `PhotoPicker.tsx`. Alt+P opens it. Not committed |
| PI-90 | Clean up: delete a property's photo folder after its post is logged | To Do | Setting: after logging / after N days / never. Only inside `Downloads\APG Post-It` |
| PI-91 | Settings shows how much space the photos use, with "Free up space" | To Do | |
| PI-101 | Copy one photo to the clipboard, to paste straight into Facebook | To Do | A "Copy" button on each photo in the Download photos dialog. Needs a Rust image-to-clipboard command in `src-tauri` and a `copyImage` on the Platform |

PI-101 is AID-245 (added Nov 4, 2026, after the board was created).

---

## PI-E17 · Paraphrase the public text with Claude — Pending

Reposting the same text word for word gets pushed down by Facebook and declined by group
admins. Offer a reworded version of the public text, and leave the intern to choose.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-92 | Decision record: what goes to Claude, who pays, the data policy | Pending | Public text only. Never `internalText`, never an unseparated document's flagged lines |
| PI-93 | The server calls the Claude API; the key stays in Script Properties | Pending | New action `paraphrase`. The app never holds the API key |
| PI-94 | The reword keeps every fact: price, size, location, terms; adds nothing | Pending | Same language as the original. Model chosen when built |
| PI-95 | Pre-post checks run again on the reword; any changed number is refused | Pending | `checks.ts`. Show the reword beside the original |
| PI-96 | Intern chooses original or reword; Copy takes the chosen one; the log records which | Pending | |
| PI-97 | Limits: a daily cap per person, cost shown to the admin, original if Claude is down | Pending | |

**Acceptance:** a reword never contains a number, phone or name that the original public text
does not; an unseparated document cannot be reworded until it is fixed (PI-E13).

---

## PI-E18 · Ideas considered, not scheduled — Idea

Suggested on Nov 4, 2026, and not chosen for now. Kept here so they are not lost. The cooldown override is already PI-67.

| Key | Story | Status | Notes |
|---|---|---|---|
| PI-102 | Admin edits or voids a logged post, with a required reason and a history | Idea | ROLES.md says Admin can; the app says "Corrections are made in the tracker sheet" (`tracker.ts` `updatePost`) |
| PI-103 | Pace warnings before Friday: interns behind their weekly target, Wednesday or Thursday | Idea | Admin sees it; the intern gets a nudge |
| PI-104 | Count inquiries per post, so Records shows which listings get responses | Idea | Could weight queue filling towards listings that get responses |
| PI-105 | Rotating opening line for reposts, written by the admin per category | Idea | Added before the public text, never inside it. Overlaps PI-E17; pick one |
| PI-106 | A history of admin actions: people added or turned off, rule changes | Idea | On the private Team spreadsheet |

---

## Next steps after review

1. Adjust epic/story names, statuses and owners here.
2. Choose: create in Jira directly through the Atlassian connector, or export as CSV for Jira's
   importer.
3. Confirm the Jira project key (`PI` is a placeholder) and whether finished work goes in as
   Done issues or only in the epic description.
