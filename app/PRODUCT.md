# APG Post-It: product

The durable context for anyone designing or building a screen in this app. Sources:
`README.md`, `docs/DECISIONS.md`, `docs/ROLES.md`, `docs/DATA-FLOW.md`,
`docs/plans/TAURI-PLAN.md`. Where this file and those disagree, those win; fix this one.

## What it is

A Windows desktop app (Tauri 2, React 18, TypeScript strict; WebView2) that real-estate
interns at APG keep open all day to post property listings to Facebook. Version 1.0.0. It
has never shipped.

The job, once per listing, dozens of times a day:

1. **Find** the listing: from today's queue, or by searching the library.
2. **Copy only its public text.** Never the owner's details, never the commission.
3. **Download its photos** into `Downloads\APG Post-It\<property>` for Facebook's upload box.
4. **Post** on Facebook (outside the app).
5. **Log the post**: the Facebook account and the post link. Date, time, type, title and
   "posted by" are filled in for you.

A **7-day cooldown** stops a listing being posted again too soon. It is checked by the
server, under a lock, so a refusal is final and arrives as a sentence with the next allowed
date.

The admin builds each intern's **daily queue** and watches the **tracker**: posted today,
pending, who's done, due for repost, never posted. The admin also owns the setup: the web
app link, the team and their keys, the rules. There are two roles, Admin and Intern (D14).

## The library

About 1,474 listings in four categories, read from the company Drive through a directory
sheet that is rebuilt nightly:

| Category (as the Drive names it) | On screen |
|---|---|
| COMMERCIAL SPACE | Commercial space |
| CONDO / HOUSE AND LOT | Condo / house and lot |
| OFFICE SPACE | Office space |
| WAREHOUSE | Warehouse |

Each listing is a folder: one posting document and its photos. The document is public
text first, then a separator, then the internal section. The documents don't agree on a
separator (D5), so the text is cut at the earliest known marker. **79 documents have no
separator at all, and Copy is blocked for them** (D6): an invisible hazard made into a
visible queue of documents to fix.

## Who uses it

| Role | Does | Sees |
|---|---|---|
| **Intern** | Works a queue top to bottom. Searches when the queue is done. Logs posts as themself | Public text only. The internal section is absent from their replies, not hidden (D1) |
| **Admin** | Assigns the postings: builds queues, watches the tracker, fixes logged rows, sweeps doc health. Owns Settings: the web app link, cooldown, team, keys | Everything |

The scene: an office PC or laptop, Windows 10 or 11, often a 1366×768 screen, sometimes
at 125–150% text size. Post-It sits beside a browser with Facebook open, and a global
shortcut brings it to the front. The same five steps repeat all day, so speed and
certainty matter more than discovery. Interns are new to the company and to the library;
a wrong post is public and permanent.

## Sign-in and identity

Each person has their own **key** on a private Team tab (D2, D3). The key is the
identity: the server resolves it to a name and a role before doing anything, and
"Posted by" is taken from the key, so a post cannot be logged under someone else's name.
Revoking someone is one cell. A leaked intern key grants intern rights only; a leaked
admin key is as bad as a shared password. The app never keeps the key in the WebView:
the OS holds it.

So sign-in is: paste the web app link and your key, and the server says who you are. The
copy must say that the key is your identity and is not to be shared.

## The sister app

**Alpha Listing Hub** (the checker) answers "has this been posted before?". Post-It
answers "what should I post next, and did it go out?". They read the same library, will be
joined in one launcher, and **must look like one family**. The checker's design system is
copied into `src/theme/tokens.css` (copied, not shared as a package: D12). See
`DESIGN.md`.

Where Post-It differs, on purpose: the checker is anonymous; Post-It knows who you are,
because it withholds owner and commission details by role and records who posted what.

## Voice

- Plain words, short sentences, sentence case. No tracked capitals, ever.
- Name things the way the team does: *public text*, *internal section*, *cooldown*,
  *queue*, *tracker*, *FB account*, *post link*, *key*.
- **Every refusal is a sentence that says what happened and what to do next.** "Posted 2
  days ago by Jan. You can post it again on Thu 6 Nov." Not "Error 409".
- No exclamation marks, no celebration, no blame. Calm and specific.

## Mode

Every surface in this app is **Operate**: the visitor completes a task. Scanability,
consistency and certainty outrank expression. The brand lives in precise details: the
gold brand word, the one gold button, the gold of what is selected and of keyboard focus.

## What success looks like

- An intern works a whole queue without asking anyone what to do next.
- Nothing private is ever posted. Copy is impossible when a check fails.
- No listing is posted inside its cooldown, and the refusal explains itself.
- An admin reads the day from the tracker in under a minute.

## What it must never be

- A marketing page. No hero sections, slogans, illustrations or celebration.
- Clever. Never hide the state of a listing behind a hover, an icon alone, or colour alone.
- Light themed. It is dark only, like the checker.
- Easy to get wrong. The safe action is the obvious one; the unsafe one isn't offered.

## Accessibility

WCAG 2.2 AA. Everything works from the keyboard, and focus is always visible (gold).
Windows' "Animation effects" reaches the WebView as `prefers-reduced-motion` and is
honoured. Layout is measured against the container after text-size zoom, so 150% text
still fits. Nothing is smaller than 14px.
