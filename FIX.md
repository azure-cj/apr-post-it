# Fixes from sharing the hub's Firebase (Nov 13, 2026)

Post-It and Alpha Listing Hub share one Firebase project (`apr-listing-live`) and will keep sharing it: the
accounts, People, the Claude budget and, later, the listings are the same for both apps. Each app keeps its own repo
and its own functions (codebase `post-it` here, `default` in the hub).

A check of both servers against the shared project found three things to fix. Fix 1 and Post-It's halves of
fixes 2 and 3 are below. The hub fixes its own halves at the same time, in its repo.

Delete this file once all three are done, and add a decision to `docs/DECISIONS.md` for them.

---

## 1. A turned-off account can still use Reword for up to an hour

**The problem.** `paraphrase` (`firebase/functions/src/paraphrase.ts`, `caller()`) checks only the `role` saved in
the sign-in. A sign-in lasts up to an hour. So when someone is turned off on the hub's People screen, signed out
everywhere, or loses their role, they can still reword posts until their sign-in runs out, and each call spends the
shared Claude budget ($5 a day per person, $50 a month for everyone).

The hub's functions ask Firebase about the caller on every call (`requireCurrentRole` in the hub's
`firebase/functions/src/caller.ts`), so a change on People stops them at once.

**The fix.** Do the same three checks in `caller()`: the account isn't turned off, the sign-in isn't from before the
account's sign-ins were ended, and the account's role *now* is one Post-It allows. `caller()` becomes async:

```ts
import { getAuth } from "firebase-admin/auth";

async function caller(request: CallableRequest): Promise<{ uid: string; email: string }> {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to reword a post.");
  const role = auth.token["role"];
  if (typeof role !== "string" || !POST_IT_ROLES.includes(role)) {
    throw new HttpsError("permission-denied", "Rewording is for agents and admins.");
  }
  // Firebase asked about the caller now, not the sign-in's copy: a turned-off account, an ended sign-in or a role
  // taken away stops at once (the hub's requireCurrentRole does the same).
  const user = await getAuth().getUser(auth.uid).catch(() => null);
  const validSince = user?.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0;
  if (!user || user.disabled || auth.token.auth_time * 1000 < validSince) {
    throw new HttpsError("unauthenticated", "This sign-in has ended. Sign in again.");
  }
  const current = user.customClaims?.["role"];
  if (typeof current !== "string" || !POST_IT_ROLES.includes(current)) {
    throw new HttpsError("permission-denied", "Rewording is for agents and admins.");
  }
  return { uid: auth.uid, email: typeof auth.token.email === "string" ? auth.token.email : "" };
}
```

and in `paraphrase`: `const { uid, email } = await caller(request);`

**Tests** (`firebase/tests/paraphrase.test.ts`, on the emulator):
- An agent whose account is turned off (`getAuth().updateUser(uid, { disabled: true })`) is refused with
  `unauthenticated`, and nothing is added to `claudeUsage`.
- An agent whose sign-ins were ended (`getAuth().revokeRefreshTokens(uid)`) is refused with `unauthenticated`.
- An agent whose role was taken away after signing in (`setCustomUserClaims(uid, {})`, same ID token) is refused with
  `permission-denied`.
- An agent in good standing still gets a reword.

**Then** deploy: `firebase deploy --only functions:post-it --project apr-listing-live`.

**Every new function** that moves Post-It's data into Firestore (the `postingStart`, `logPost`, … in
`docs/hub/post-it-functions.patch`) should use this same check, not the sign-in's role alone.

---

## 2. Changing the Claude key needs both apps deployed again

**The problem.** Both apps use the same secret, `CLAUDE_API_KEY`. A function gets the version of a secret that
existed when it was deployed. If the owner sets a new key and only the hub is deployed again, Reword keeps using the
old key, and stops working ("Claude isn't set up right") the day the old key is revoked.

**The fix.** In `firebase/README.md`, under "Deploying (the owner)", add:

> After a new `CLAUDE_API_KEY` is set (`firebase functions:secrets:set CLAUDE_API_KEY --project apr-listing-live`),
> deploy Post-It's functions again too, or Reword keeps the old key. The hub's `npm run deploy:live` only deploys the
> hub's. Revoke the old key only after both are deployed.

The hub's README gets the same note from its side.

---

## 3. The emulator tip could make the hub's deploy publish Post-It's functions

**The problem.** `firebase/README.md` says, for testing with the hub's functions too: "run the hub's emulators
instead and add this folder's codebase to its `firebase.json`." The hub's deploy uses `--only functions`, which
deploys every codebase in its `firebase.json`. If that edit is left in, the next hub deploy publishes whatever copy
of Post-It's functions is on that PC, possibly an old one, over the live ones.

The hub is changing its deploy to `functions:default` only, so its deploy can't publish Post-It's functions. The
tip still edits a file in the hub's repo, though.

**The fix.** Change the tip in `firebase/README.md` to:

> To have the hub's functions too, add this folder's codebase to the hub's `firebase.json` **on your PC only**, and
> undo it before committing in the hub's repo. Never deploy Post-It's functions from the hub's folder: they deploy
> from here, with `--only functions:post-it`.

---

## Good to know (no change needed now)

- **Claude's prices are written in both repos:** `PRICES` in `firebase/functions/src/limits.ts` here and in the
  hub's `firebase/functions/src/claude-jobs.ts`. They match today. If a price or the model changes, change both, or
  the two apps count the same budget differently.
- **Post-It reads and writes the hub's documents directly:** `config/claude` (`on`, `dailyUsd`,
  `monthlyBudgetUsd`), `claudeUsage/{month}` and `claudeUsage/{month}/days/{day}_{uid}` (the shape `record()`
  writes), and `users/{uid}.name`. The hub lists these in its README as fields Post-It depends on, and won't rename
  them without telling you.
- **Function names must be unique across both apps.** The hub's README lists Post-It's function names
  (`paraphrase`). Tell the hub's developer before adding a new one, or prefix new ones (`posting…`).
- **Anyone who can deploy to `apr-listing-live` can read all of its data,** the owners' details and commissions
  included, because functions run as the project's own account. Post-It's functions should read only what Post-It
  needs.
