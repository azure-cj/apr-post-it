# Post-It's Firebase functions, for the hub repo

`post-it-functions.patch` is one commit for Alpha Listing Hub's repo
(`imainzed5/apr-listing-checker`), not for this one. Post-It's server functions live in the
hub's `firebase/` folder (POST-IT-PLAN.md: two apps, one server), so this is kept here until it
goes to the hub team.

It adds `postingStart`, `listPosts`, `listAssignments`, `logPost`, `addLink`, `setStatus`,
`saveQueues`, `setRules` and `setFbProfiles`, with 59 emulator tests, and `fbProfiles` on People.
Contract: `docs/plans/POST-IT-FUNCTIONS.md` inside the patch. Made on top of the hub's `d2742f6`,
and checked to apply cleanly there.

To use it:

```bash
git clone https://github.com/imainzed5/apr-listing-checker.git
cd apr-listing-checker
git switch -c post-it-functions
git am path/to/post-it-functions.patch
```

Then `cd firebase && npm ci && npm --prefix functions ci && npm test` (needs Java for the emulator).
