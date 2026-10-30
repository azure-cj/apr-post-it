# Drive + Sheets backend (Google Apps Script)

The Windows client does not talk to the Google APIs. It calls one Apps Script web app,
which runs **as the owner** and returns JSON. That one decision buys three things:

* **No Google credentials on intern machines.** No GCP project, no OAuth consent screen,
  no service-account key file to leak. The app holds a URL and a shared key.
* **The internal section never leaves the server.** The split happens in `splitPosting()`;
  an intern's request simply does not include `internalText` in the response.
* **The 7-day cooldown is a real guarantee.** `logPost` checks it under `LockService`,
  so two interns saving the same property at the same moment cannot both get through.
  A client-side check can always be raced or bypassed.

## Set it up

1. Open the **tracker spreadsheet** → Extensions → Apps Script. Binding the script to the
   sheet is what gives you the *Post-It* menu and lets `TRACKER_SHEET_ID` stay blank.
2. Replace `Code.gs` with this file. Then ⚙ *Project Settings* → "Show `appsscript.json`",
   and paste the manifest here. That enables the advanced Drive service, which is roughly
   ten times faster than `DriveApp` for walking folders.
3. Check `CONFIG`:
   * `PROPERTIES_FOLDER_ID` — already set to the live library folder.
   * `CATEGORY_FOLDERS` — the five real category folders. Everything else under the
     root (SOLD, Contents, Hiring…) is ignored. Empty the list to scan them all.
   * `POSTS_TAB` / `ASSIGNMENTS_TAB` — **must match the real tab names.**
   * `SHARED_KEY` — a long random string, used only until the Team tab has its first row.
4. Run `buildIndex` once from the editor and accept the permission prompt.
5. *Post-It → Install 15-minute refresh* to keep the index current.
6. *Post-It → Add a team member…* for each person. Each gets their own key; paste it
   into their copy of Post-It. `SHARED_KEY` stops working the moment the first row exists.
7. Deploy → New deployment → **Web app**. Execute as **Me**, access **Anyone**.
   "Execute as Me" is the whole point: every Drive read happens as the library's owner,
   so nobody else needs Drive access. Copy the `/exec` URL.
8. Check it: `<exec-url>?action=ping&key=<your key>` in a browser. It should name you
   and your role.

## Endpoints

| Call | Returns |
|---|---|
| `GET  ?action=ping` | health check, plus the signed-in email if the domain allows it |
| `GET  ?action=properties` | every property: id, name, category, photo count (one sheet read) |
| `GET  ?action=property&id=…&internal=true` | public text, photo URLs; internal text only when asked **and** allowed |
| `GET  ?action=posts` / `?action=assignments` | the two tracker tabs as rows |
| `POST {action:'logPost', …}` | appends a tracker row, or refuses with `error:'cooldown'` |
| `POST {action:'addLink', …}` | turns a Pending row into Posted |
| `POST {action:'saveQueue', …}` | replaces one intern's queue for one date |
| `POST {action:'setStatus', …}` | moves one queue item's status |
| `POST {action:'reindex'}` | forces an index rebuild |

Every call carries `key`, and the key *is* the identity — see `docs/ROLES.md`.

## Your existing tracker is not reformatted

Nothing is written by column position. Each field is found by matching the sheet's own
header row against a list of accepted spellings (`POST_FIELDS` / `ASSIGN_FIELDS`), so the
tracker keeps its column order and wording. A column the sheet does not have is skipped;
a *required* one that is missing raises a message naming it.

The one column worth adding is **PropertyId**. Without it, rows are matched by property
name, which breaks the moment a folder is renamed. With it, matching is exact.

## Why there is an Index tab

Walking a few hundred property folders takes tens of seconds — far too slow for a
search box, and it would burn the daily script-runtime quota if it ran on every keystroke.
`buildIndex()` walks Drive on a 15-minute trigger and writes one row per property to an
`Index` tab. `?action=properties` is then a single `getValues()`.

The posting **document is read live** when a property is opened, so an edit in Drive shows
up immediately. Only the slow `.docx` conversion path is cached, for 10 minutes.

## Things that will bite you

* **Keep posting docs as native Google Docs.** A `.docx` has to be copy-converted to a
  temp Doc on every cold read. A `.gdoc` shortcut file cannot be read at all.
* **The `/exec` URL plus the key is the credential.** Anyone holding both can read every
  property. Put them in the app's settings file, never in this repo.
* **Custom HTTP headers are dropped on redirect.** Apps Script answers with a 302 to
  `script.googleusercontent.com`, and .NET will not forward an `Authorization` header
  across that hop. Send the key in the query string or the POST body — as above.
* **Photos.** With `PUBLISH_PHOTOS: true` the script sets "anyone with the link can view"
  so the client downloads straight from Drive, in parallel, without touching the script.
  These photos are about to be posted publicly on Facebook, so this is usually fine. Set
  it to `false` and photo URLs come back empty.
* **Shared drives** need `supportsAllDrives` — already set on every call here.
* **Quotas.** 6 min per execution; 90 min/day of trigger time on personal Gmail, 6 h on
  Workspace. The 15-minute index rebuild is the only heavy job; if it ever approaches the
  limit, move it to hourly.

## Identity without Google sign-in

The script runs as the Drive owner, so `Session.getActiveUser()` says nothing useful about
who is calling. Identity comes from the key instead: each person has their own row on the
**Team** tab, and the key resolves to their name and role before anything is dispatched.

That means roles are enforced on the server, not asserted by the client — no Workspace and
no per-user Google sign-in needed. `docs/ROLES.md` has the matrix and the consequences.

## The C# side

`IPropertyRepository` and `ITrackerRepository` do not change. A
`GoogleScriptPropertyRepository` posts JSON to the `/exec` URL and deserialises the reply:

```csharp
var res = await _http.PostAsJsonAsync(_execUrl, new {
    action = "logPost", key = _key,
    property = p.Name, propertyId = p.Id,
    fbAccount, postLink, postedBy = user.Name,
});
var body = await res.Content.ReadFromJsonAsync<LogPostReply>();
if (!body.Ok && body.Error == "cooldown")
    throw new UserFacingException(body.Message);
```

`HttpClient` follows the 302 by default, so no handler configuration is needed.
