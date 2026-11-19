# Who can do what

Platform-independent. The same two roles apply whether the UI is the Tauri app or an Apps
Script web app; only the enforcement point moves.

## Roles

Two roles (D14).

**Admin** — the person who assigns the postings. Builds the queues, sees everyone, fixes
mistakes, and owns the setup: folders, rules, team, keys. An admin may also be given a queue,
by another admin or by themselves, and posts it as an intern does (D31).
**Intern** — everyone else. Posts. Sees their own queue and their own tracker rows, nobody
else's.

There used to be a third, **Manager**, between the two. It is merged into Admin. A Team row
that still says `Manager` is read as `Admin`, by the server and by the app; any other value,
blank included, is `Intern`.

| | Intern | Admin |
|---|:--:|:--:|
| Search properties, view public text, photos | ✔ | ✔ |
| Copy public posting text | ✔ | ✔ |
| **See the internal section** (commission, terms) | ✔ read only (D16) | ✔ |
| My Queue | own only | own, while they have one or a post waiting (D31) |
| Log a post | as self | as self; on behalf of anyone active (server only) |
| Add the live link to a Pending post | own only | any |
| Post inside the 7-day cooldown | ✔, warned "Posted recently" (v19) | ✔, warned (v19) |
| Edit or void a logged row | ✘ | ✔ |
| Assign, reorder, remove queue items | ✘ | ✔ (to interns and admins, D31) |
| Tracker: posted, pending, due for repost, never posted | own numbers | everyone |
| Doc health sweep | ✘ | ✔ |
| Settings: folders, cooldown, team, keys | ✘ | ✔ |
| Settings: theme, reminders, About | ✔ (D32) | ✔ |

In the app an Admin gets Tracker, Assign, Agents, Records, Find and Settings, and My queue (before
Find) while they have a queue running or coming, or a post of their own waiting for approval,
and while they are on it (D31); an Intern gets My queue, Find and Settings, where only
Appearance, Reminders and About are theirs, with no tabs (D32).

## The two that are boundaries, not preferences

Everything above is a guard rail except these, which hold even against a tampered client:

1. **The internal section is never copied.** The split happens server-side, and
   `internalText` is a field of its own, never part of `publicText`. An intern reads it
   behind a toggle; Copy never takes it (D16).
2. **A post's link is checked under a lock before the row is appended.** The same Facebook
   post can't be logged twice, nor under a second name (D22). Until v19 this was the
   cooldown; it now warns and refuses nothing.

Everything else — which buttons are greyed out, which screens appear — is UI convenience.

## How the server knows who is calling

Each person has their own key, listed on a **Team** tab:

| Name | Email | Role | Key | FB Accounts | Active |
|---|---|---|---|---|---|
| Maria Santos | maria@… | Admin | `7f3a…` | | TRUE |
| Jan Dela Cruz | jan@… | Intern | `9b2c…` | APG Main, APG Rentals | TRUE |

The key identifies the caller, so the role is enforced on the server rather than being a
claim the client is trusted to make. This needs no Google Workspace and no per-user Google
sign-in — the script still runs as the Drive owner, as it already does.

Consequences worth knowing:

* **Revoking somebody is one cell.** Set Active to FALSE. No Drive permissions to unpick.
* **A leaked intern key grants intern rights only** — but since D16 that includes reading
  the internal text of separated documents.
* **A leaked admin key is a real problem**, the same as a shared password. Keep admin
  keys off shared machines.
* **`Posted By` comes from the key**, not from the request, so an intern cannot log a post
  against someone else's name. An admin may, for anyone active, from one of that person's
  own FB accounts.
* **FB accounts are per person.** Jan's log screen offers only the accounts listed in his
  row, and the server rejects anything else.

Until the Team tab has its first row, `CONFIG.SHARED_KEY` acts as a temporary admin key so
there is no chicken-and-egg at setup. It stops working the moment a real row exists.

## Open decisions

1. ~~Admin separate from Manager, or folded in?~~ Folded in: two roles, Admin and Intern (D14).
2. ~~May an admin override a cooldown?~~ Nobody needs to: since v19 the cooldown warns and
   refuses nothing, for an intern or an admin.
3. ~~May an admin also post, with a queue of their own?~~ Yes: any admin may be given a queue,
   and works it from My queue (D31).
