# Where the data lives, and how the posting doc is read

Two decisions that the rest of the app leans on.

## 1. Store it, or fetch it every time?

Neither, uniformly. There are four kinds of data and they want three different answers.

| Data | Size | Policy | Why |
|---|---|---|---|
| Property index (id, name, category, photo count) | ~60 KB for 300 properties | **Cached on disk**, refreshed on launch and every 15 min | The search box has to be instant as you type. A network round trip per keystroke is not an option. |
| Posting text | 1–3 KB each | **Cached, but revalidated on open** | Read live when a property is opened so a typo fixed in Drive a minute ago is already gone. The cached copy is the fallback when the connection drops mid-shift. |
| Photos — thumbnails | ~50 KB each | **Cached on disk, keyed by Drive file id** | Shown while browsing. Re-downloading 15 thumbnails every time someone opens a property is pure waste; they almost never change. |
| Photos — full size | 2–5 MB each | **Not cached. Downloaded on demand** to `Downloads\APG Post-It\<property>\` | This is not a cache, it is the deliverable: the intern picks those files in the Facebook upload dialog. Caching 60 MB per property to also copy it elsewhere would be silly. |
| Tracker rows (Posts, Assignments) | small | **Never cached authoritatively.** Read on open, poll while a screen is up | These change because of *other people's* actions. A stale queue or tracker is worse than a slow one. Nothing is lost by not caching: the cooldown decision is made server-side, so a stale local copy can never cause a wrong write — only a briefly stale view. |

### Where the cache goes

```
%LOCALAPPDATA%\APG.PostIt\cache\
  index.json              the property list + each doc's modifiedTime
  text\<fileId>.json      posting text, with the modifiedTime it was read at
  thumbs\<fileId>.jpg     thumbnails
```

`%LOCALAPPDATA%` rather than `%APPDATA%` on purpose: this is regenerable data and must not
follow a roaming profile around.

**Invalidation** is by Drive's `modifiedTime`, which the index carries for every posting doc.
If the time moved, the cached text is stale. Drive file ids are stable, so they make good keys.

**Size** is capped — prune the oldest thumbnails past ~500 MB. Nothing else is big enough to matter.

**A manager's cache holds internal text**; an intern's never does, because the server does not
send it (see `server/apps-script/README.md`). Worth encrypting the manager's `text\` cache with
DPAPI (`ProtectedData`, per-user scope) — it is about ten lines and means a stolen laptop does
not hand over every commission figure.

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
reformat 300 existing documents:

```
Category: House and Lot          ← optional metadata, allow-listed keys only,
Location: Antipolo City             stripped from the public text

FOR SALE — Casa Amara            ← everything down to the marker is the public text
PHP 8,500,000
• 3 bedrooms
Contact: 0917 123 4567

=== INTERNAL — DO NOT POST ===   ← the marker. Several spellings are accepted
Commission: 3%                      (see INTERNAL_MARKERS)
```

Metadata keys are allow-listed (`Category`, `Location`) rather than "any `Key:` line at the top",
so a listing that opens with `Contact: …` does not silently lose it.

### Doc health

A convention that loose will be broken, so make the breakage visible instead of mysterious.
The manager's app pages through `?action=texts` (50 at a time — reading every doc in one request
would run past the 6-minute execution limit) and runs the existing `PrePostChecker` over the
results to list properties whose doc:

* has no posting document at all, or has it as `.docx` instead of a Google Doc
* has **no internal marker** — so the whole file is being treated as public
* has no price or no contact number
* mentions commission *in the public part*
* has no photos

One screen, fixed once per property. This turns a parsing problem into a data-quality chore
somebody can actually finish. The checks live in `PrePostChecker` in C# and are already tested;
the server only reports whether a marker was found, never the internal text itself.
