# Decisions

Numbered so other documents can point at them. Newest last. A decision is recorded when it
was hard to reach, cost something, or will look arbitrary to whoever reads the code next.

---

### D1. The posting text is split on the server, not hidden in the app (Oct 30, 2026)

*Changed by D16:* an intern now gets a separated document's internal section, to read.

An intern's reply from the web app contains no internal text **at all** — not hidden, absent.
The alternative, sending the whole document and collapsing part of it, leaves the owner's
details and the commission sitting in memory on a machine we do not control, one developer
tool away from being read.

### D2. Each person has their own key; the key is the identity (Oct 30, 2026)

The script runs as the Drive owner, so `Session.getActiveUser()` says nothing useful about
who is calling. Identity comes from a key on a private Team tab, resolved to a name and a
role before anything is dispatched. No Google Workspace and no per-user Google sign-in
needed. Revoking somebody is one cell. `Posted By` is taken from the key, so a post cannot
be logged under another name.

This is where Post-It parts company with the checker, which is deliberately anonymous
(its D4, D20). The checker publishes what agents post publicly anyway; Post-It withholds
owner and commission details by role and records who did what.

### D3. The Team tab lives in a private spreadsheet, not the tracker (Oct 30, 2026)

The Team tab holds every person's key. The tracker is open to the whole team, so a key kept
there could be read by anyone who can open it — including a manager's. `ADMIN_SHEET_ID`
names a separate spreadsheet shared with nobody.

### D4. The directory sheet is the index; Drive stays the origin (Oct 30, 2026)

`BuildDirectory.gs` walks Drive nightly and writes one row per listing. The app reads that
sheet, so a search is one read rather than hundreds of Drive calls. But the sheet is only as
fresh as the last rebuild, so **opening a property re-reads its document live**; the sheet's
copy is the fallback, and the reply says which one was used.

### D5. Cut the posting text at whichever marker comes first (Oct 30, 2026)

The documents do not agree on one separator. Across 1,474 listings: `---` in 1,079, `__` in
124, `===` in 93, `━━━` in 45, and a bare heading such as `1 MONTH STANDARD COMMISSION` in
54. The `__` we were told about covers 8%.

So every known marker is checked and the text is cut at the earliest. This occasionally cuts
a line early — a listing advertising "no commission" loses its last line. That is the right
way round: a short post can be fixed, a published owner's phone number cannot. The marker
used is recorded in a `Cut at` column so the result can be audited rather than trusted.

### D6. A document with no separator cannot be copied (Oct 31, 2026)

> **Superseded in part by D15 (Nov 1, 2026).** Such a document is now shown, and can be
> copied after a check, without its flagged lines. What still holds: a missing separator
> is never treated as "safe", and the documents stay a visible queue to fix.

79 of 1,474 documents have no marker of any kind. The check for this existed but only
warned, and a warning stops nobody. It now blocks Copy.

A missing marker does not mean there is nothing private in the document; it means nobody has
separated it yet, and in the real library those are exactly the ones carrying the owner's
mobile number. About 5% of the library is affected, which is the point: an invisible hazard
becomes a visible queue of documents to fix.

### D7. Nothing written to a sheet may be evaluated (Oct 30, 2026)

A `Cut at` label beginning with `=` became `#ERROR!` in 35 rows. The same trap was aimed at
the posting text, where a listing opening `+ 3 bedrooms` would have been evaluated and lost
silently. The output range is formatted as plain text before anything is written.

### D8. A long job hands over to a trigger, and schedules its successor first (Oct 30, 2026)

Apps Script kills a function at six minutes. The directory builder scanned and then called
the writing phase inline, so both shared one execution: the scan used most of it and the
writer was killed before it could write a row **or** schedule its follow-up. A full queue, an
empty sheet, nothing running, and no error to show for it.

The scan now hands over to a trigger, and each batch schedules its successor **before** doing
the work, so a batch that overruns still leaves the run going.

### D9. A folder is a listing when it has no sub-folders, or holds files of its own (Oct 31, 2026)

The library's depth is not fixed: `COMMERCIAL SPACE` goes category → listing type → listing,
while `CONDO / HOUSE AND LOT` goes category → `FOR SALE` → `Lot` → listing. Counting levels
missed 499 listings.

Testing for files alone was too slow — two Drive calls per folder ran the scan past the time
limit. Testing for sub-folders alone lost a listing that keeps its photos in one:
`Taguig, 135 East Tower` vanished and its `Pics (DO NOT POST) - for clients only` folder took
its place as a row. Both tests, with the files probe made only for the few folders that have
sub-folders at all.

### D10. The app is built in Tauri, React and TypeScript (Oct 31, 2026)

Following the IT head's Oct 30 decision that every company system uses this stack, so they
can be joined later. Post-It and the checker are two halves of one job and will be combined.

Post-It had a C# / WPF prototype with 204 tests, never run on Windows. It is kept as a
specification — its tests say what right means — and deleted once the Tauri app passes them.
Moving now costs less than moving the checker does: Post-It has no installed version and no
user data, so there is no period of maintaining two apps.

See [the plan](plans/TAURI-PLAN.md).

### D11. The exclusion list is the checker's (Oct 31, 2026)

Both apps read the same library, so they must agree on what counts as a listing.
`Contents`, `Hiring`, `Sir Mark`, `TV VIDEO`, `VO`, `Virtual Office for posting`, plus the
ones Post-It found for itself. Matched as whole names: the checker matches `VO` as a prefix,
which would also exclude a top-level folder beginning "Vo…".

### D12. The design system is copied from the checker, not shared as a package (Oct 31, 2026)

The two apps must read as one family, and will later sit in one launcher. The
colours, type scale, spacing, motion and focus rule are copied into
`src/theme/tokens.css`. A shared package would keep them in step
automatically, but needs somewhere to live and a release process; a copy is
what was asked for. When the checker changes a token, change it here too.

The discipline that comes with it: gold does exactly four jobs — the brand
word, the one primary button on a screen, what is selected, and keyboard
focus. Everything else is carried by status colour.

### D13. Where the postable text ends is decided in one file (Oct 31, 2026)

`server/Separators.gs` decides it. The directory builder, the web
app's live re-read when a property is opened, and the desktop app all use that
one file unchanged — the app links it at build time, so nothing is run from a
string.

This replaced three implementations, and the reason it had to is the worst
thing found so far. `BuildDirectory.gs` learned the real separators on Oct 30
(D5). `Code.gs`, which re-reads a document live whenever somebody opens a
property, still had the older list from before anyone had looked at the
library. On every document separated by `---`, `__`, `===` or a bar — 93% of
them — the owner's name, mobile number and commission would have been sent to
the intern who opened it. It was never deployed, so nothing leaked. The
checker's D2, "one matcher, linked, never copied", exists to prevent exactly
this.

Neither old list was complete: the library's missed `[Do not post]` and `For
internal use`, the prototype's missed every bare divider. The one file has the
union. Porting it to TypeScript then found six more gaps in it, closed the same
day: a curly apostrophe in "owner’s" (which Google Docs types by default), an
emoji before a heading, the plural "commissions", "call the owner at 0917…",
a heading ending in "line" being taken for a divider, and listing copy such as
"Internal area: 120 sqm" and "Owner financing available" being cut.

Two further rules came with it:

- **An intern is never sent text nobody has separated.** (Superseded by D15:
  now they are, marked `unseparated`, with the risky lines flagged.) Blocking the Copy
  button (D6) is not enough: text on screen can be selected and copied by
  hand. When no separator is found, an intern's reply has an empty
  `publicText` and `withheld: true`; a manager still gets the whole document,
  to fix it.
- **The file is pure ASCII.** Literal characters inside its regexes broke two
  edits, and the file is pasted into the Apps Script editor, where an encoding
  slip would silently corrupt a rule. A test enforces it.

### D14. Two roles: Admin and Intern (Oct 31, 2026)

The owner's decision. The Admin is the person who assigns the postings; everyone else is an
Intern. The old middle role, Manager, is merged into Admin: with a team this size the person
who builds the queues is the person who owns the setup, and a third role only added a column
to every permission check and a way for an admin to lose a screen by being tested for
`'Manager'`.

So every Admin gets Assign, Tracker and Settings. `PERMISSIONS` in `Code.gs` has two entries,
and `roleOf_` reads a Team row that still says `Manager` as Admin, so nobody's row has to be
retyped; the app's `parseRole` does the same with a reply. Anything else, blank included, is
Intern: an unknown role gets the fewest rights, never the most. On screen, a person to ask is
"your admin". The folder `ui/screens/manager` and `canManage` keep their names.

The boundaries in `ROLES.md` are unchanged: the internal section still never reaches an
Intern, and the role is still the key's, never the request's.

### D15. Unseparated documents are shown with a warning (Nov 1, 2026)

**Supersedes part of D6** (and the first rule under D13): a document with no separator is
no longer blocked outright.

The owner's decision. Blocking left about 79 listings, 5% of the library, unpostable
until somebody found time to separate each document, and the screen that blocked them was
confusing: "Copy is blocked: the document has no separator yet", "The document has nothing
above its separator" and "No price found in the public text" at once, about a document
that had a separator problem and a price. The owner would rather the intern read the
document, check it, and post it.

So an unseparated document is shown whole, under one amber notice, "No separator. Check
before posting." The safeguards:

- **Flagged lines are not copied.** The server sends `flaggedLines`: every line that
  `markerKind_` names, or that carries a Philippine mobile or landline number, or mentions an
  owner or a commission (`flaggedLines_` in `Separators.gs`, so the rule lives in the one
  file, D13). The app adds its own flags from the same file, so an app newer than its
  server still marks what it knows. Flagged lines are marked on screen ("Not copied"), not
  selectable, and left out of what Copy copies.
- **A tick before copying.** Copy stays off until the intern ticks "I checked it", once
  per listing.
- **The checks run on what would be copied.** A commission word the flags missed ("3
  percent to whoever closes", "rebate") still blocks Copy, and the screen names its line.
  Sold, the cooldown and a folder with no document still block too.
- **Only on the server's word.** An intern's app shows the text only when the server says
  `unseparated: true`. A reply without it, from a server before v7, is withheld as before,
  and a folder with no document is still `withheld: true`.

The cost is the agent's own number: in an unseparated document it cannot be told from the
owner's, so it is flagged too, and "Contact numbers present" warns. A post missing a contact
number can be fixed; a published owner's number cannot (D5). Separated documents are
unchanged, and the internal section still never reaches an intern (until D16).

### D16. Interns read the internal section, never copy it (Nov 3, 2026)

Part of D1 is reversed: a `property` reply now carries a separated document's `internalText`
to an intern too, and the app shows it folded under a warning, as it does for an Admin. Agents
need the commission and terms to answer a client. It is never copied: Copy takes the public
text only, the section can't be selected, and a copy made from it by hand is cancelled. It is
still never written to disk. An unseparated document is unchanged (D15). The cost: a leaked
intern key can now read internal text. This is step 1 of the plan to join the listing hub,
where an intern is an agent.

### D17. One person, several FB accounts, each with its own profile link (Nov 3, 2026)

An intern may run more than one Facebook account (CJ posts as Cyrus and as Kevs), and each
account has its own profile. The Team tab keeps its columns rather than gaining one per
account: FB Accounts lists the names and FB Profile Link holds one link per line, in the same
order, so an old one-link cell still reads as the first account's. Accounts are edited as rows
of name and link. The weekly target stays per person, not per account.

### D18. Sign in with the Firebase account; no keys in the app (Nov 4, 2026)

Post-It signs in with the same email and password as Alpha Listing Hub. Listings, posts and
queues stay in the Apps Script web app: each call carries the account's sign-in token instead
of a key, Code.gs asks Google's accounts:lookup whose it is (kept five minutes), and finds the
person by the Team tab's Email. The name and role are still the Team tab's, so history matches;
the account's role must agree (agent = Intern, admin or owner = Admin), and a scanner or an
account with no role is turned away. Keys still work on the server, for a copy of the app not
yet updated. The cost: each person's Team tab Email must be their account's email.

### D19. The Firebase account says who you are; the sheets hold the data (Nov 4, 2026)

Amends D18. Signing in needed a Team tab row with the account's email, so an account the
People screen had made could not use Post-It until an admin also typed it into the sheet. Now
the account alone decides: Code.gs reads its name and role from Google's accounts:lookup (the
`role` claim: agent is Intern, admin or owner is Admin; anything else is refused). A Team row with
the same email still lends its name and FB accounts, so Posted By and the history keep matching,
but its Role no longer counts. Listings, posts and queues stay in the sheets. Not changed: a
queue is still given only to an active Intern on the Team tab. (Amended by D31: an active
Admin may be given one too.)

### D20. Never lose a log: kept on this PC, sent again, never twice (Nov 4, 2026)

By the time an intern logs a post it is on Facebook, so a save that fails on the way (no
connection, a timeout, Apps Script busy) used to lose the record. Now it is kept on this PC (the
platform's local store), shown as "n posts waiting to save" with Retry now, and sent again at
sign-in, every five minutes and when the connection comes back, only while the same person is
signed in. A post's Facebook link is its own, so the server takes a second save of a link the
same person already logged as the first one and writes nothing (no new column, which PI-68
would have needed). A retry carries when it was logged, and the server dates the row by it if
that is within the last four days. A refusal (the cooldown, an FB account that isn't yours) is
still shown at once and never kept; one that only comes on a retry is shown until dismissed.

### D21. The team is Firebase's people; the Team tab keeps only FB accounts (Nov 4, 2026)

Amends D19. Signed in by account, Post-It's team is Alpha Listing Hub's people, read with the
admin's sign-in from the hub's `listPeople`: agent is Intern, admin or owner is Admin, and a
scanner or an account with no role is left out. People are added, given roles and turned off on
the hub's People screen only, so Post-It's Add person, Turn off and New key are gone there (the
server refuses them, `hub-people`). The name everywhere is the People screen's: the server keeps
the names `listPeople` last gave, by email, so an intern's own posts are credited under the same
name the admin's screens show. Each person's FB accounts and profile links stay in the sheets,
on the Team tab row with their email (made when there is none). A copy still on a key keeps the
Team tab as before. Queues and logging on someone's behalf take only active people on Firebase.

### D22. Only a post's link, and one post is one person's (Nov 9, 2026)

A logged post must be checkable, so its link has to open that one post: a group post, a page's or
person's post, `permalink.php` or `story.php` with `story_fbid`, `/share/p/`, a photo with `fbid`,
or a Marketplace item, on facebook.com (www, m, web) or fb.com. A profile, a group's front page or
the home page is refused ("not a post's"), and fb.me short links are gone because they hide where
they go. Copies of one link (m. or web., a tracking query, a trailing slash, letter case,
/permalink/ for /posts/) are the same post, so the same post logged again by its poster is still a
repeat, and logged by anyone else is refused with who logged it and when (`link-taken`). Add link
applies the same rules to a pending post. The app checks the link before it asks; the server
checks again. Older rows keep their links; the rules apply to new logs only.

### D23. Spot checks: an admin opens a few of each agent's posts a week (Nov 9, 2026)

Facebook can't be read by a script (logins, private groups), so nothing else confirms a logged
post is up and about the listing logged. Each week the app picks 3 of each agent's Posted posts
with a post's link, dated that week. The pick is a fixed shuffle of the week, the agent and the
post: every admin sees the same posts, agents can't tell which, and a post once checked stays
picked. On the Agents screen, the agent's panel lists them: Open, then Verified, Not found or
Wrong listing. The table's Checks column shows how far the week's check is, and a failure is a red
pill. Results are kept on the admin sheet's own Spot checks tab, one row per post, with who
checked and when: the interns' tracker is not changed, so the owner's sheet keeps its shape.
Checking a post again replaces its result. A web app before v16 has no spot checks, and the
Agents screen goes on without them.

### D25. The FB group is read from the post's link (Nov 10, 2026)

The tracker said which FB account posted, not where. The owner agreed to one more column on
the Posts tab, `FB Group`. It is filled from the link the agent already pastes, so logging
takes no extra step: a group post's link names its group (`groups/apgmain/posts/123`), a
Marketplace item is `Marketplace`, and a page's or person's post, a share link or a photo
leaves it blank. The cell holds the group as the link names it (a short name or a number);
readable names for the numbers are AID-191's, a list the admin keeps. The column is added
after the tab's last one on the first post with a group, as `Due` was on Assignments, so the
owner's own columns keep their order. Rows logged before it stay blank.

### D26. A retry refused for the cooldown goes to the admin (Nov 11, 2026)

A post kept on an agent's PC (D20) is already on Facebook when it is sent again. If, in the
meantime, someone else posted the same listing, the later save falls inside the cooldown. The
cooldown still decides (ROLES.md: nobody posts inside it, admins included): the save is refused
and nothing goes on the tracker. Before, only the agent saw it, on their own PC, in the words
meant for someone about to post, and once dismissed it was gone. Now the server writes it on
the admin sheet's own Refused posts tab, under the same lock as the check, and words the refusal
for a post already made. The admin sees the open ones on the Agents screen, opens each on
Facebook, decides there (take it down or leave it), and marks it handled. There is no "log it
anyway": that would be posting inside the cooldown. Only retries are written: a first try refused
on the spot is seen by the agent at once, and the app already blocks Copy inside the cooldown.
The tracker gets no new tab. A server before v18 doesn't tell the admin, so the app asks the
agent to.

### D27. Copy one photo goes through Rust; Copy separator copies `---` (Nov 11, 2026)

Copy photo (AID-245) puts one listing photo on the clipboard, to paste into a Facebook post
with Ctrl+V. It is a Rust command, `copy_photo`, not the WebView's clipboard: it fetches the
photo exactly as Download photos does (Drive only, a photo's bytes only, a sign-in page said
in words), turns it the way the camera held it (a pasted bitmap carries no EXIF), scales it to
2048 px on its longest side (the largest Facebook keeps; a phone photo is a quarter the size on
the clipboard) and writes it with the same clipboard plugin as Copy. A WebView version written
earlier, never wired to a button, is gone: it fetched through a second path with none of those
checks. HEIC and AVIF photos can't be copied; the message says to download them.

Copy separator (AID-176) is on the "No separator" notice, for admins. It copies `---`, which
1,079 of the 1,474 documents already use, and the marker comes from `Separators.gs`
(`standardSeparator_`, D13), so what is copied is always a marker the cut recognises.

### D28. A WebP photo is saved as a JPG, on the PC only (Nov 11, 2026)

Some listing folders on Drive hold WebP photos, which Facebook's upload box and many people's
tools don't take everywhere. Download photos now saves a WebP as a JPG (quality 92; anything
see-through is laid on white, since a JPG can't be). Only the downloaded copy is converted:
Post-It never writes to Drive, and the file there stays a WebP. The conversion runs in Rust
(`photos.rs`), off the download threads, after the bytes prove it is a WebP: a photo's name on
the server has no extension, so nothing is known before it arrives. Each step of a save is sent
to the window as a `photos-progress` event, tagged with that save's id. While a WebP is being
converted, the photos section says so in the accent colour ("Converting photo 4 of 10 from WebP
to JPG… The file on Drive is not changed."), and the "saved" message says how many were
converted. A WebP that can't be read is left out, with the reason, and the others are saved.
Copy photo already reads WebP (D27).

### D29. Rewording a post is Post-It's own Firebase function, on the hub's Claude key (Nov 11, 2026)

Reword (AID-129) asks Claude (`claude-haiku-5-5`) for a fresh wording of the public text, so
the same listing can be posted again without reading the same. It replaces plan rows PI-93 to
PI-97, which had Apps Script call Claude with a key of its own in Script Properties. Instead,
Post-It has its own `firebase/` folder with one callable function, `paraphrase`, deployed as
the codebase `post-it` beside the hub's `default` (two repos deploying one codebase delete each
other's functions). It uses the hub's `CLAUDE_API_KEY` secret and the hub's limits: it reads
`config/claude` (never writes it), refuses past a person's day or the month, both apps counted
together, and adds each call to `claudeUsage` under the job `paraphrase`. Firestore and Storage
rules stay the hub's; Post-It never deploys them.

Only what Copy would copy is sent: never the internal section, and never a document nobody has
separated (D15), which isn't offered a reword until it is fixed. The reword is shown beside the
original and gets the same pre-post checks; one whose numbers differ from the original's (a
price, a size, a phone) can't be chosen. Copy takes the one the person chooses. The posts log
doesn't yet record which was posted (PI-96's last part).

### D30. Sharing the hub's Firebase: the account is checked on every call (Nov 13, 2026)

Post-It and Alpha Listing Hub share the Firebase project `apr-listing-live`, and will keep
sharing it: the accounts, People, the Claude budget and, later, the listings. Each app keeps its
own repo and its own functions codebase (`post-it` here, `default` in the hub). A check of both
servers against the shared project found three things, fixed here and in the hub together:

- **The account, not only the sign-in.** `paraphrase` read the role saved in the sign-in, which
  lasts up to an hour, so someone turned off on People could go on spending the shared Claude
  budget until it ran out. `caller()` now asks Firebase about the account on every call, as the
  hub's `requireCurrentRole` does: turned off, or signed in before its sign-ins were ended, is
  `unauthenticated`; a role Post-It doesn't allow *now* is `permission-denied`. Every new
  Post-It function uses the same check.
- **One key, two deploys.** Both apps use the secret `CLAUDE_API_KEY`, and a function keeps the
  version it was deployed with. After a new key, Post-It's functions are deployed again too, and
  the old key is revoked only after both are (firebase/README.md).
- **Each app deploys its own functions.** The hub deploys `functions:default` only. Post-It's
  codebase may be added to the hub's `firebase.json` on a PC for the emulator, never committed
  there, and Post-It's functions deploy only from this repo, with `--only functions:post-it`.

Still shared, with no change: Claude's prices are written in both repos (`PRICES` in
`limits.ts` here, the hub's `claude-jobs.ts`), and change together; Post-It reads and writes
the hub's `config/claude`, `claudeUsage` and `users/{uid}.name`, which the hub won't rename
without saying; function names are unique across both apps, so a new one is cleared with the
hub's developer or prefixed (`posting…`).

### D31. An admin may be given a queue (Nov 19, 2026)

Amends D19 (a queue only for an active Intern). The owner's decision, closing `ROLES.md`'s third
open question. An admin may be given a queue of postings, by another admin or by themselves,
and works it as an agent does. Nothing about
the queue changes: the same deadline, the same held-listing rule, Missed on the same day, and
the same posts and checks. The role still decides only what a person may *see and change*; who
may *be given postings* is now everyone active on the team.

- **Server.** `saveQueues` takes an active Admin as it takes an active Intern; anyone else, or
  someone turned off, is still `bad-intern` (the code is kept for older apps). `saveQueue`
  never checked the role. `logPost` already credits an admin's own post to them, and their
  row of the queue follows it. `addLink` (Approved, or a pending post's link) takes the
  row that already has the link, else the newest of the person the app names (`postedBy`),
  so an admin completes their own post, not someone else's of the same listing; a link
  already on any other row is refused, so a second Approved can't move it onto another
  post. Both move the item of the queue the post's day falls in (`addLink`: the completed
  row's Date), none when it's already Posted; a day none of their items of the listing
  covers moves the lowest open one, as before, which may be a later queue's.
- **Assign.** After the agents' cards, a group of the admins' cards, the signed-in admin's
  marked You. Fill queues lists the admins after the agents, none ticked, so filling the
  week's queues gives an admin nothing unless someone ticks them. Until the team is read,
  its list is everyone the tracker mentions, admins perhaps among them, so nobody is ticked
  until the team arrives.
- **My queue.** An admin's sidebar gets My queue, before Find, with its count, while they
  have a queue running or coming, or a post of their own waiting for approval (only My queue
  marks it approved), and while they are on it: an admin who never posts sees no empty
  screen. It is the agent's screen, reading the admin's own rows; after a post made from it,
  it moves on to their next listing. The admin's welcome tour points at it, after Agents,
  only while it is in their sidebar, and its count of steps says so; on a first sign-in it
  starts once their queue is read.
- **Agents.** An admin with a queue in the week shown is a row of the monitor and of the
  Tracker's week, marked Admin, with the same pace, warnings and spot checks; an admin
  without one isn't listed. Records lists an admin as anyone else: once they post in the
  period or a queue of theirs falls due in it (no 0 row for a quiet one).

### D32. Settings for agents; no web app card (Nov 19, 2026)

Amends D14, where Settings was an admin's. The owner's decision. Settings → App loses its Web
app card, for everyone: the link built into the app (shown read-only, with Copy) and the check
of the web app's version, with the steps to deploy. Agents get Settings in their sidebar, after
Find: the App tab's cards alone, Appearance, Reminders and About, with no tabs. An admin's
Settings keeps its four tabs.

- **Nothing new is read.** An agent's Settings asks the server for nothing an admin's tabs do
  (the team, the rules, the directory). The theme and the reminder days are kept on the PC, as
  an admin's are; About shows the app's version and the web app's, as last pinged.
- **A web app that is behind** is said only on the startup screen: to an admin, "deploy a New
  version in Apps Script", as Settings used to say; to an agent, "tell your admin".
- **Errors that pointed at Settings** for the web app link or the key now say to sign in with
  them, or to check the link.

### D33. The flyer, with an optional location map (Nov 25, 2026)

**What.** A listing page offers **Make a flyer** (Alt+F) under the photos, once the text may be
copied. The flyer follows `docs/mockups/flyer.html`: three looks (Framed, Big photo, Light),
page 1 the flyer, then the photos the person picks on more pages (2, 3, 4 or 6 a page), each
1080 × 1350. An optional last page is a satellite map with a red ring around the area.
**Copy page** puts one page on the clipboard; **Save all pages** writes `Flyer 1.png`… next to
the downloaded photos.

**Only the text Copy takes.** The facts (size, prices, place, highlights, contact numbers) are
read from the same text the Copy button takes, so nothing below the line can reach a flyer.
Kind, deal, title and place can be edited in the dialog; nothing edited there is saved.

**The ring, never the spot** (apg-gis `docs/BROCHURE-MAP.md`). The server works the ring out
(`locationRing`) and the app only ever gets the ring. Its centre is APG GIS's public pin for
the listing, worked out with the same `PIN_SECRET`, copied into Post-It's Script Properties, so
the flyer and the APG map never narrow the spot down together. The ring is bigger than the
furthest the pin can be from the listing plus the lot's reach plus 50 m, so the listing is
always inside, never at its centre. The ring's size never depends on the spot itself: it uses APG's furthest move
(220 m, 550 m for a warehouse), not the distance from the spot to the pin, which would tell it. Only city and town names are drawn; the page names the
town and province, and says the address is shared on inquiry.

**Imagery.** Esri World Imagery, as APG GIS's live map, with its credit on the picture. Its
terms for printed and posted marketing pictures are to be checked before flyers with a map go
out; the provider is one line in `src/ui/screens/intern/flyer/locationMap.ts`.

### D34. Pasting a document's text the app can't show (Nov 25, 2026)

**The problem.** An agent opened a listing and saw nothing to copy: the server had no text to
send (a Word file read without the Drive service, no document, or an older server withholding
a document with no separator). The listing could not be posted until an admin fixed it.

**What the agent does now.** The Posting text card offers Open in Drive (the listing's folder;
the agent may be asked for access) and a box to paste the document's text. Pasted text goes
the same way as a document: it is cut at its separator with Separators.gs's own splitter
(D13), so a separator or an "Owner:" heading still keeps everything below it out. With no
separator it is an unseparated document (D15): the app flags the owner and commission lines,
never copies them, runs the checks on what would be copied, and waits for "I checked it".
Reword is offered on it only after the tick, and is sent only what Copy would copy.

**Not kept.** The pasted text lives on that screen only: never saved, never sent to the
server, gone when the listing is closed. The document itself is still the admin's to fix.

**Show me how.** A walkthrough of the box (the `paste` tour). It never starts by itself; its
button glows, as the one next step, until the person has taken or closed it once.

### D35. The virtual office's posts, in the app, when an admin asks (Nov 26, 2026)

**The problem.** Now and then an admin asks for the virtual office to be advertised. Its
ready-made posts sit in Drive, in APR LISTING → "Virtual Office for posting", one folder per
version ("2026 NEW VIRTUAL OFFICE", "2026 V2.0 …"), so an agent had to open Drive to post one.

**What the app does now.** The server reads that folder (`CONFIG.VIRTUAL_OFFICE_FOLDER_ID`)
and adds each folder inside it to the list, after the listings, as category "Virtual Office
for posting" with `onRequest: true`. The folder stays out of the directory and out of the
checker's world (D11): nothing is written to the Directory tab. Find shows them under their own
"Virtual office" chip. One opens like a listing, read from Drive now. Its first document is
written for posting, every line, so it goes out whole: no separator is looked for and no
line is flagged (not D13 or D15), and text pasted for one is kept whole too. Every photo in
the folder and the folders inside it can be downloaded. The category is the one the owner's tracker already
writes in Property type, so a post logged here matches the rows already there.

**Only when asked.** Posting one is optional. An admin asks by highlighting it, which already
puts it at the top of every agent's My queue (1.1.6). Until then an agent's page says "Post
this only when an admin highlights it", and Fill queues and Add leave it out; once
highlighted, they give it out first like any highlighted listing.

**Read only.** A Word file is not converted (converting writes a copy into Drive): its text is
withheld, and the agent can paste it (D34). Videos in the folder are not offered yet.

### D36. Drive links are never posted (Nov 26, 2026)

Some documents end with a link to the listing's Drive folder or a Doc: where the files are
kept, not something for Facebook. The app takes Google Drive, Docs and Photos links out of
the text it shows and copies, and out of text pasted by hand. A line that held only a link, or
a link and its label ("Photos: …"), goes; a link inside a sentence is taken out of it. The
document is never changed. Flagged line numbers are moved to match, so the right lines stay
marked. In Find, the Virtual office chip comes first after All, in its own hue (D35).

### D37. The poster, and a call to action in Copy (Nov 26, 2026)

A fourth look in the Flyer, Poster: a big headline (what it is, in capitals) with the deal and
the place above it, over one photo that fades up into it, and a strip at the bottom with the
numbers, the email and the Facebook page the post names, beside the logo. Feed (1080 x 1350),
Square (1080 x 1080) or Story (1080 x 1920). A price badge is optional and off at first. Like
the flyer, it is made only from the text Copy takes (nothing below the line), so the contacts
are the document's own. It is one picture: no photo pages and no map page. Saved, it is named
"00 Poster.png" so it sorts before the photos in the folder and goes up first.

**Call to action.** Copy can end the post with one line asking for a viewing, when ticked: "Schedule
a site viewing today: message us here, or call the numbers above." It is fixed words only,
never a number or a name, so nothing that was not already in the post goes out. It points at
the numbers only when the post has some, and is not added twice.

### D38. A tour for every screen, and a guide in Help (Nov 26, 2026)

Every screen now has its own short tour, pointing at the real buttons: My queue, Find,
Tracker, Assign, Agents, Records and Settings, as the listing page already had. Each starts
by itself the first time the screen is opened, one at a time and never right after the
welcome tour on the same screen; closing the welcome tour still turns them all off (1.1.7).
Help's Tour this page starts the one for the screen the person is on. Tours stay short:
three steps at most a screen, and the listing tour five (six for admins), each step naming
every button it is about. Related things share a step (the call to action with Copy, the
flyer and poster with the photos, Pending approval with Posted); the step-by-step detail is
in Help's guide.

Help also has a guide, "How do I…": short step-by-step topics for posting, photos, flyers
and posters, the queue and Find, the admin work, and what to do when something goes wrong.
It is searchable, and shows admins the admin topics only. Each topic is a walkthrough (D39).
The Flyer has no tour of its own: it opens as a dialog, which sits above any tour, so the
listing tour and the guide explain it instead.

### D39. Each guide topic is a walkthrough (Nov 26, 2026)

Clicking a topic in Help's guide starts its walkthrough: it goes to the screen the topic
happens on and lights up each button in turn, the way a tour does. The written steps stay
behind Steps, beside the topic. A topic about a listing opens one for the person: the
listing already open, else Next up in My queue, else the first listing in Find, by
clicking its link as they would. It only points: nothing is copied, posted or saved, and
walkthroughs are not kept in the person's tour record. A step whose button is not on the
screen (a listing with no photos, a desktop-only button) is passed over, and a closing
step says where to find it.
