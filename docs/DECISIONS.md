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
queue is still given only to an active Intern on the Team tab.

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
