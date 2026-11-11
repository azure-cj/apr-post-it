# Post-It's Firebase functions

Post-It's own functions on the Listing Hub's Firebase project (`apr-listing-live`), deployed as
the codebase **`post-it`**. The hub's functions are the codebase `default`, deployed from the
hub's repo. Each repo deploys only its own codebase, so neither deletes the other's functions
(D29 in `docs/DECISIONS.md`).

| Function | What it does |
|---|---|
| `paraphrase` | Rewords a post with Claude (`claude-haiku-5-5`), on the hub's `CLAUDE_API_KEY` and within the hub's limits in `config/claude`. Each call is added to `claudeUsage` under the job `paraphrase`. |

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
Firestore 8080), for the app in development. It has only Post-It's functions; to have the hub's
too, run the hub's emulators instead and add this folder's codebase to its `firebase.json`.

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

Before the first deploy, check the hub has no function called `paraphrase` of its own (the
Functions list in the Firebase console). The limits are set on the hub, in `config/claude`:
`on`, `dailyUsd` (per person per Manila day, default 5) and `monthlyBudgetUsd` (default 50).
