# Decisions

Numbered so other documents can point at them. Newest last. A decision is recorded when it
was hard to reach, cost something, or will look arbitrary to whoever reads the code next.

---

### D1. The posting text is split on the server, not hidden in the app (Oct 30, 2026)

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
