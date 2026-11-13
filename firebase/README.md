# Post-It's Firebase functions

Post-It's own functions on the Listing Hub's Firebase project (`apr-listing-live`), deployed as
the codebase **`post-it`**. The hub's functions are the codebase `default`, deployed from the
hub's repo. Each repo deploys only its own codebase, so neither deletes the other's functions
(D29 in `docs/DECISIONS.md`).

| Function | What it does |
|---|---|
| `paraphrase` | Rewords a post with Claude (`claude-haiku-5-5`) as a fresh Facebook caption in Alpha Premier Realty's style (`functions/src/prompt.ts`), on the hub's `CLAUDE_API_KEY` and within the hub's limits in `config/claude`. Each call is added to `claudeUsage` under the job `paraphrase`. |

The caption ends with the agency's phone numbers and may show a per-sqm rate, and the app only accepts those
new numbers from version 1.1.5's rebuild on (`src/core/reword.ts`). Deploy a prompt change after the app that
accepts it is out, or the app refuses every caption. The agency's numbers are written in both files; change both.

This folder deploys **functions only**. Firestore and Storage rules and indexes are the hub's:
`firebase.json` here has no `firestore` or `storage` section, so a deploy from here can't
change them.

## Tests

Needs Java (for the Firestore emulator) and Node 22 or newer.

```bash
npm ci
npm --prefix functions ci
npm test
```

`npm test` builds the functions and runs them on the emulator (project `demo-apr-listing`, which
never reaches a real one). Claude is a stand-in on port 8799, started by the tests:
`scripts/local-env.mjs` writes `functions/.env.local` (pointing `CLAUDE_URL` there) and a made-up
key in `functions/.secret.local`. Both files are ignored by git. The function refuses to call
anything but `127.0.0.1` or `localhost` while it runs in the emulator, so the tests and the
emulator never reach Anthropic's API.

`npm run emulators` starts the same emulators on the hub's ports (auth 9099, functions 5001,
Firestore 8080), for the app in development. It has only Post-It's functions. To have the hub's
functions too, add this folder's codebase to the hub's `firebase.json` **on your PC only**, and
undo it before committing in the hub's repo. Never deploy Post-It's functions from the hub's
folder: they deploy from here, with `--only functions:post-it`.

## Deploying (the owner)

The key is already set on live (`CLAUDE_API_KEY`, the hub's secret); nothing here creates or
changes it. From this folder:

```bash
npm ci
npm --prefix functions ci
firebase deploy --only functions:post-it --project apr-listing-live
```

`functions:post-it` names the codebase, so only Post-It's functions are deployed, and only
Post-It's are ever deleted. The hub's (`default`) are left as they are.

After a new `CLAUDE_API_KEY` is set (`firebase functions:secrets:set CLAUDE_API_KEY --project
apr-listing-live`), deploy Post-It's functions again too, or Reword keeps the old key: a function
gets the secret's version from when it was deployed. The hub's `npm run deploy:live` only
deploys the hub's. Revoke the old key only after both are deployed.

`paraphrase` is deployed with `invoker: "public"`, so Cloud Run lets the app's call in; the
function itself then refuses anyone not signed in as an agent or admin. It asks Firebase about
the account on every call, so an account turned off, signed out everywhere or stripped of its
role on the hub's People screen is refused at once, not when its sign-in runs out (D30). Every
new Post-It function should do the same. Without it, Cloud Run
turns every call away before the function runs ("The request was not authenticated" in the
function's log), and the app can only say it couldn't reach Claude.

Before the first deploy, check the hub has no function called `paraphrase` of its own (the
Functions list in the Firebase console). The limits are set on the hub, in `config/claude`:
`on`, `dailyUsd` (per person per Manila day, default 5) and `monthlyBudgetUsd` (default 50).
