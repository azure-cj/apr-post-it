# APG Post-It

A Windows desktop app for posting property listings to Facebook. An intern finds a listing,
copies **only its public text** and its photos, posts, and logs the link; an admin builds each
intern's queue and watches progress. The listings are the company's Google Drive library and
the log is the company's Google Sheets tracker, reached through a small Google Apps Script web
app. The owner's details and the commission never reach an intern: the server cuts them off
before replying (`docs/DECISIONS.md` D1, D13).

Built with Tauri 2, React and TypeScript (D10). Who can do what: `docs/ROLES.md`.

## Set up a PC to build it

1. **Node.js LTS**: <https://nodejs.org/>
2. **Rust**: <https://rustup.rs/> (accept the Visual Studio C++ build tools it offers).
3. **WebView2**: already on Windows 10 and 11. If not,
   <https://developer.microsoft.com/microsoft-edge/webview2/>

## Run, build, uninstall

* **`run.cmd`**: runs the app from source. Installs packages on the first run.
* **`build.cmd`**: installs packages, runs the tests, and builds the installer into
  `src-tauri\target\release\bundle\nsis`. Give that `.exe` to whoever needs the app.
* **`uninstall.cmd`**: removes the installed app, its settings and its saved key from this
  PC. It asks first, and never touches the Google sheets, Drive or this folder.

From a terminal in this folder: `npm test` runs the tests, `npm run tauri dev` runs the app, and
`npm run dev` runs it in a browser for development, against the real web app.

## Set up the server (once)

Full details, and what each action does: `server/README.md`.

1. Make a **private** spreadsheet for the Team tab, shared with nobody: it holds everyone's
   key (D3).
2. At <https://script.google.com> make a project and add **`Code.gs`** and
   **`Separators.gs`** from `server` (plus `BuildDirectory.gs`, which builds the
   listing directory, and the `appsscript.json` manifest).
3. At the top of `Code.gs`, set **`TRACKER_SHEET_ID`** (the company tracker) and
   **`ADMIN_SHEET_ID`** (the private spreadsheet). Build the directory with `START` in
   `BuildDirectory.gs`.
4. Add the first Admin: edit the name in **`ADD_PERSON`**, keep the role `Admin`, and press
   Run. The key is in the execution log. Run it again for each person.
5. Deploy: Deploy, New deployment, **Web app**, Execute as **Me**, access **Anyone**. Copy
   the `/exec` link.
6. **Build the link into the app, once, before building it.** Paste the `/exec` link into
   `PASTED_SCRIPT_URL` in **`src/config.ts`**, or put `VITE_SCRIPT_URL=<the /exec link>` in
   a **`.env.local`** file beside `package.json` (it wins over the file, and git ignores
   it). Then run `build.cmd`. The link is not a secret; the keys are.
7. Everyone signs in by pasting **only their key**. Settings shows the built-in link,
   read-only.

To change the script later, keep the same link: Deploy, **Manage deployments**, edit the
existing deployment and choose **New version**. A new deployment gets a new link, and every
copy of the app would have to be rebuilt with it. With no link built in (the empty
placeholder, as in development and the tests), sign-in asks for the link as well.
