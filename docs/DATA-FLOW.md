# Where the data lives, and how the posting doc is read

Two decisions that the rest of the app leans on.

## 1. Store it, or fetch it every time?

Neither, uniformly. There are four kinds of data and they want three different answers.

| Data | Size | Policy | Why |
|---|---|---|---|
| Property index (id, name, category, photo count) | ~200 KB for 1,474 listings | **Cached on disk**, refreshed on launch and every 15 min | The search box has to be instant as you type. A network round trip per keystroke is not an option. |
| Posting text | 1–3 KB each | **Kept in memory only**, until the list is next refreshed | Fetched when a property is opened, and the server re-reads the document live, so a typo fixed in Drive a minute ago is already gone. Never written to disk: for a manager it includes the internal section (D1). |
| Photos — thumbnails | ~50 KB each | **Cached on disk, keyed by Drive file id** | Shown while browsing. Re-downloading 15 thumbnails every time someone opens a property is pure waste; they almost never change. |
| Photos — full size | 2–5 MB each | **Not cached. Downloaded on demand** to `Downloads\APG Post-It\<property>\` | This is not a cache, it is the deliverable: the intern picks those files in the Facebook upload dialog. Caching 60 MB per property to also copy it elsewhere would be silly. |
| Tracker rows (Posts, Assignments) | small | **Never cached authoritatively.** Read on open, poll while a screen is up | These change because of *other people's* actions. A stale queue or tracker is worse than a slow one. Nothing is lost by not caching: the cooldown decision is made server-side, so a stale local copy can never cause a wrong write — only a briefly stale view. |

### Where the cache goes

The property list is kept in the app's local store: one JSON file under
`%LOCALAPPDATA%\com.alphapremier.apgpostit` (`src/platform/tauri.ts`). The key is not in it:
that is in the operating system's credential store.

`%LOCALAPPDATA%` rather than `%APPDATA%` on purpose: this is regenerable data and must not
follow a roaming profile around.

**Invalidation** is by time. The list is refreshed on launch and every 15 minutes, and a refresh
that succeeds drops every property detail held in memory, so the next one opened is fetched
again (`src/core/directory.ts`). The directory sheet carries no `modifiedTime` to compare.

**Size** is capped — prune the oldest thumbnails past ~500 MB. Nothing else is big enough to matter.

**Internal text never reaches the disk.** An intern's reply never contains it: the server leaves
it out, decided by the key's role and never by the request (see `server/README.md`).
A manager's is held in memory only, forgotten when the list is refreshed or the key changes, so
a stolen laptop does not hand over every commission figure.

### What this buys

The app opens showing yesterday's index immediately, then quietly refreshes. Search never waits
on the network. Opening a property costs one small request. The connection dropping means
"photos unavailable", not a dead app.

## 2. Getting the information out of the document

### Reading it

`DocumentApp.openById(id).getBody().getText()` is the obvious call and it is **not good enough**:

* **It drops bullet glyphs.** A feature list arrives as run-on lines with no markers — exactly
  the part of a listing that most needs them.
* **It runs table cells together** with no separator, so a spec table turns to mush.

So `docToText()` walks the body instead. List items keep a `•` (or their number) and are indented
by nesting level; a two-column table becomes `Lot area: 120 sqm`; horizontal rules and page breaks
are dropped; runs of blank lines collapse. Facebook strips formatting anyway, so plain text with
real bullet characters is precisely the right target — no need to carry bold or headings across.

Images pasted *inside* the doc are invisible to this. Photos must be files in the property folder.

### Finding the parts

The doc follows a light convention rather than a rigid template, because nobody is going to
reformat 1,474 existing documents:

```
Category: House and Lot          ← optional metadata, allow-listed keys only
Location: Antipolo City

FOR SALE — 3BR house, Antipolo   ← everything above the first marker is the public text
PHP 8,500,000
• 3 bedrooms
Contact: 0917 123 4567

---                              ← the marker: whichever kind comes first
Commission: 3%
```

The documents do not agree on one separator: `---`, `__`, `===`, a bar of box-drawing
characters, or a heading such as `1 MONTH STANDARD COMMISSION`. So the text is cut at whichever
comes first (D5). That is decided in exactly one file, `server/Separators.gs`, a
**required** file of the Apps Script project, which the directory builder, the web app and the
desktop app all run unchanged (D13). Never copy its rules anywhere else.

Metadata keys are allow-listed (`Category`, `Type`, `Location`) rather than "any `Key:` line at
the top", so a listing that opens with `Contact: …` does not silently lose it. The server sends
the text above the marker as it stands; reading the metadata off it is the app's
(`src/core/posting-text.ts`).

### A document with no marker

79 of the 1,474 have none (D6). That does not mean there is nothing private in them: nobody has
separated them yet, and those are the documents found carrying owners' mobile numbers. None of
the text is confirmed safe. Until v7 an intern was never sent it (D13). The owner decided they
should be posted after a check (D15), so an intern now gets the whole document marked
`unseparated: true`, with `flaggedLines`: the lines that may hold an owner, a phone number or a
commission. The app marks them, leaves them out of the copy, and asks for a tick before Copy. A
folder with no document still reaches an intern as `publicText: ''` and `withheld: true`, so
the screen can say why it is empty rather than look broken. A manager gets the whole document,
to add the marker.

### Doc health

A convention that loose will be broken, so make the breakage visible instead of mysterious.
The directory builder records it as it reads every document. The directory sheet's **Issues**
column names each listing with no document, no photos, or no marker, and its **Cut at** column
says which marker the text was cut at, so the result can be audited rather than trusted (D5).
The `properties` list carries `hasIssues`, and an opened property its `issues`.

When a property is opened, the app runs its pre-post checks (`src/core/checks.ts`) over the
public text: a price, a contact number, no commission wording, and a marker found. For a
document with no marker they run on what Copy would copy, without the flagged lines, and a
missing marker asks for a check rather than blocking (D15).

One screen, fixed once per property. This turns a parsing problem into a data-quality chore
somebody can actually finish. The server reports whether a marker was found (`hasInternal`);
it never sends an intern the internal text itself, nor the heading it was cut at.
