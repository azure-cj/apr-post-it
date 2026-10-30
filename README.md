# APG Post-It — working prototype (Windows desktop, C# / WPF)

A prototype of the posting app from the proposal: interns find a property, copy **only the public text**,
post on Facebook, and log the link; the app writes the tracker row, refuses posts inside the 7-day cooldown,
and (Phase 2) lets the manager build each intern's queue and watch progress on the Tracker.

> **Prototype, not production.** It runs on local folders and two CSV files instead of Google Drive and the
> tracker sheet, signs you in by picking a name, and ships with made-up sample data. Everything it does on
> real Drive/Sheets is behind two small interfaces (see *Going real* below).

## Run it (Windows 10/11)

1. Install the **.NET 8 SDK**: <https://dotnet.microsoft.com/download/dotnet/8.0>
2. Double-click **`run.cmd`** (or `dotnet run --project src\PostIt.App`).
   The first run copies the bundled sample data to `%LOCALAPPDATA%\APG.PostIt\PROTOTYPE-sample` and opens the sign-in page.

`build.cmd` builds everything and runs the 183 tests. Visual Studio 2022 opens `APG.PostIt.sln` directly (no extensions, no NuGet packages needed).

## Try the demo

Sign in as an **intern** (Jan Dela Cruz):

* **My Queue** — today's list in the manager's order. *Casa Amara* is pinned at the top as **Pending** (a group post awaiting approval), four properties are *To post*, one is already *Posted*.
* **Open** the first one → only the green **public text** has a Copy button; the internal section (commission, terms) is collapsed and never copied. Pre-post checks and photos are on the same screen.
* **Next: log this post** → type the FB account, paste a Facebook link, Save. Date, type, title, time and status are written for you, into `Tracker\Posts.csv`.
* Try **Search → Verdant Hills Lot 7 → log it**: it was posted 2 days ago, so Save is refused and the next allowed date is shown.
* Try **Search → Mabini Commercial Space**: the public text mentions commission, so Copy is blocked.
* Back in **My Queue**, use **Add link** on the Pending item to turn it into Posted.

Switch user (top-right icon) and sign in as the **manager** (Maria Santos):

* **Tracker** — posted today, pending, who's done, properties due for reposting or never posted.
* **Assign** — build tomorrow's queue for an intern: search and *Add*, or paste a typed list and *Match to property folders* (`Verdant Hils Lot 3` gets a "did you mean" suggestion). Properties in cooldown or already in someone else's queue can't be added. *Save queue* writes `Tracker\Assignments.csv`.
* **Settings** — point the app at your own folders, change the cooldown, edit the team and FB accounts, or reset the sample data.

## Where the data lives

```
%LOCALAPPDATA%\APG.PostIt\
  settings.json                      folders, rules, team, FB accounts
  PROTOTYPE-sample\
    Properties\<Category>\<Property>\ posting.txt + photos   ← stands in for the Drive property folders
    Tracker\Posts.csv                 Date,Type,Title,Time,Status,FB Account,Post Link,Posted By
    Tracker\Assignments.csv           Date,Assigned To,Property,Status   ← the "one extra tab"
```

Both CSVs open in Excel (UTF-8 with BOM). The app refuses to write while a file is open in Excel and says so.

**Using your own folders:** in Settings, set *Properties folder* to a folder with one sub-folder per property
(optionally grouped in category folders) holding the posting doc (`.txt`, `.md` or `.docx`) and the photos — a
Google Drive for desktop folder works as-is. The posting doc is public text first; a line such as
`=== INTERNAL — DO NOT POST ===` (or `Internal notes`, `For agents only`…) starts the part that is never copied.
Optional `Category:` / `Location:` lines at the very top are read as metadata.

## Project layout

```
src/PostIt.Core           domain, rules, storage adapters, services   (.NET 8, no UI)
  Rules/                  CooldownPolicy, PostingTextParser, PrePostChecker, PropertyNameMatcher
  Infrastructure/         FolderPropertyRepository, CsvTrackerRepository, JsonSettingsStore, SampleDataSeeder
  Services/               PostingService, AssignmentService, TrackerService
src/PostIt.Presentation   view-models (MVVM, UI-framework free)       (.NET 8)
src/PostIt.App            the WPF app: theme, controls, views, composition root (App.xaml.cs)
tests/PostIt.Tests        183 tests, zero-dependency runner:  dotnet run --project tests\PostIt.Tests
tools/                    xaml_check.py (static XAML/binding checks), check.sh, make_sample_data.py
docs/                     UI-KIT.md (styles & patterns), mockups/ (the agreed look)
```

Flow of a save: `LogPostView` → `LogPostViewModel` → `IPostingService.LogPostAsync` → cooldown + link checks →
`ITrackerRepository.AddPostAsync` (CSV) and the queue item's status.

## Going real

Two interfaces are the whole boundary to the outside world:

* `IPropertyRepository` — today `FolderPropertyRepository` (local folders). A Google Drive version lists folders
  and reads the doc through the Drive API.
* `ITrackerRepository` — today `CsvTrackerRepository`. A Google Sheets version appends/updates rows on the two tabs.

Swap them in `App.xaml.cs`; the rules, services, view-models and screens don't change. Sign-in would become the
company Google account. Everything else in the proposal (cooldown, checks, queues, pending follow-up, tracker) is
already real logic with tests.

## Known limits of the prototype

* Built and tested on Linux without a WPF compiler: the core and view-models are compiled and tested; the XAML
  passed static checks and a manual review but has **not yet been compiled by Visual Studio / MSBuild**. The first
  Windows build may surface small XAML fixes — `build.cmd` shows them with file and line.
* Photos: "Download all" copies files to `Downloads\APG Post-It\<property>`; opening a photo uses the default viewer.
* `.gdoc` shortcuts (Drive for desktop) can't be read; export the doc as `.docx` or `.txt` into the folder.
* Mouse wheel over a text box inside a scrolling form may not scroll the form (standard WPF behaviour).
* No undo for a saved log row (edit `Posts.csv` in Excel if needed); no passwords.
