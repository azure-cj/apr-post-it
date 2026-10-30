# Who can do what

Platform-independent. The same three roles apply whether the UI is the WPF client
or an Apps Script web app; only the enforcement point moves.

## Roles

**Intern** — posts. Sees their own queue and their own tracker rows, nobody else's.
**Manager** — assigns queues, sees everyone, fixes mistakes.
**Admin** — owns the setup: folders, rules, team, keys. Usually also a Manager.

| | Intern | Manager | Admin |
|---|:--:|:--:|:--:|
| Search properties, view public text, photos | ✔ | ✔ | ✔ |
| Copy public posting text | ✔ | ✔ | ✔ |
| **See the internal section** (commission, terms) | **✘** | ✔ | ✔ |
| My Queue | own only | any intern's | – |
| Log a post | as self | on behalf of an intern | – |
| Add the live link to a Pending post | own only | any | – |
| **Post inside the 7-day cooldown** | **✘ refused** | ✘ refused | ✘ refused |
| Edit or void a logged row | ✘ | ✔ | ✔ |
| Assign, reorder, remove queue items | ✘ | ✔ | ✔ |
| Tracker: posted, pending, due for repost, never posted | own numbers | everyone | everyone |
| Doc health sweep | ✘ | ✔ | ✔ |
| Settings: folders, cooldown, team, keys | ✘ | ✘ | ✔ |

## The two that are boundaries, not preferences

Everything above is a guard rail except these, which hold even against a tampered client:

1. **The internal section never reaches an intern.** The split happens server-side; an
   intern's response has no `internalText` field at all. Not hidden — absent.
2. **The cooldown is checked under a lock before the row is appended.** Two interns saving
   the same property in the same second cannot both get through.

Everything else — which buttons are greyed out, which screens appear — is UI convenience.

## How the server knows who is calling

Each person has their own key, listed on a **Team** tab:

| Name | Email | Role | Key | FB Accounts | Active |
|---|---|---|---|---|---|
| Maria Santos | maria@… | Manager | `7f3a…` | | TRUE |
| Jan Dela Cruz | jan@… | Intern | `9b2c…` | APG Main, APG Rentals | TRUE |

The key identifies the caller, so the role is enforced on the server rather than being a
claim the client is trusted to make. This needs no Google Workspace and no per-user Google
sign-in — the script still runs as the Drive owner, as it already does.

Consequences worth knowing:

* **Revoking somebody is one cell.** Set Active to FALSE. No Drive permissions to unpick.
* **A leaked intern key grants intern rights only** — it cannot read internal text, because
  the server decides that, not the app.
* **A leaked manager key is a real problem**, the same as a shared password. Keep manager
  keys off shared machines.
* **`Posted By` comes from the key**, not from the request, so a post cannot be logged
  against someone else's name.
* **FB accounts are per person.** Jan's log screen offers only the accounts listed in his
  row, and the server rejects anything else.

Until the Team tab has its first row, `CONFIG.SHARED_KEY` acts as a temporary admin key so
there is no chicken-and-egg at setup. It stops working the moment a real row exists.

## Open decisions

1. **Admin separate from Manager, or folded in?** Separate is cleaner; with two or three
   people, one person simply holds both.
2. **May a manager override a cooldown?** If yes it needs a required reason and gets logged.
   Currently nobody can.
3. **May a manager also post, with a queue of their own?**
