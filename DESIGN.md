# APG Post-It: design system

This is the checker's design system (Alpha Listing Hub), copied into
`src/theme/tokens.css` so the two apps read as one family. This file describes that
system and how Post-It applies it. It does not invent a new one: **tokens.css is the
source of truth**. If a value here disagrees with tokens.css, tokens.css is right and this
file is stale.

Product context is in `PRODUCT.md`. Components live in `src/ui/components/`, and a live
reference of every component and variant is at `#/kit` in development.

---

## 1. The rules that make the family

1. **Gold does exactly four jobs.** The brand word. The **one** primary button on a screen.
   What is selected. Keyboard focus. Nothing else is gold: not headings, not labels, not
   links, not icons, not borders, not counts.
2. **Everything else is carried by the status colours**: ok (green), warn (amber), danger
   (red), info (blue), neutral.
3. **Dark first, OLED black.** A `#121212` page and neutral greys; no warm tint except the
   gold. Dark is the default. A light theme (black and gold on white) swaps the colour
   tokens only, chosen in Settings (§2, "Light theme").
4. **No box-shadows.** Depth comes from the card's vertical gradient and its top-lit edge.
5. **Montserrat** (500, 600, 700) for headings, labels and buttons. **Segoe UI** for body text.
6. **Nothing under 14px.**
7. **Sentence case. No tracked capitals.** Letter-spacing is 0 everywhere.
8. **One easing curve.** **Only opacity and transform animate.**

## 2. Colour

Black and gold, the company's colours, tuned for OLED displays: a charcoal-black page,
neutral greys that step up in light, and gold for exactly four jobs. **There is no warm or
brown tint anywhere except the gold itself.** Every grey is neutral (R = G = B).

### The palette

| Role | Colour |
|---|---|
| Background | `#121212` charcoal black |
| Primary text | `#E0E0E0` |
| Secondary text | `#B0B0B0` |
| Borders and dividers | `#444444` |
| Neutral accent | `#888888` soft grey: icons, input edges, neutral dots |
| Gold | `#E0B84A`, unchanged: brand word, the one primary button, selected, focus |

### The rules

1. **OLED black, not pure black.** The page is `#121212`: dark enough that an OLED panel
   barely lights it, light enough that text doesn't smear against true-black pixels and the
   cards above it still read. Only the photo viewer's scrim goes to pure black.
2. **Light comes up in steps of neutral grey.** Page `#121212` → sidebar `#1A1A1A` → card
   `#1E1E1E`→`#1A1A1A` → raised `#222222` → tooltip `#2A2A2A`. A card separates from the
   page by its fill (1.12:1 at its top) and its top-lit edge together, never by the edge
   alone. Inputs go the other way, to `#0C0C0C`, so they read as recessed.
3. **Hover and pressed are white washes, not new colours.** `--row-hover` 3%,
   `--neutral-bg` 6% (≈ `#282828` on a card), `--neutral-soft` 12% (≈ `#363636`). They fade in by opacity, so they work on any grey.
4. **Gold does four jobs and nothing else** (§1). Gold on every grey in the ramp is at least
   7.6:1; the focus ring needs 3:1.
5. **`#888888` is for icons, edges, dots and placeholders, never small body text on a raised
   surface.** On `#222222` it measures 4.49:1, just under AA, so the placeholder token is
   lifted to `#8C8C8C` (4.73:1 on `#222222`, 5.82:1 on an input). Neither goes on
   `--tip-bg`.
6. **No raw colour outside `tokens.css`.** Components use tokens only.

### Light theme

Black and gold on white, for people who work in a bright office. `<html data-theme="light">`
(set by `src/ui/state/theme.ts`) overrides **every colour token and nothing else**, so no
component knows which theme it is in. The choice is `dark` (the default), `light` or
`system` (follows Windows' mode, live). It is kept with `platform().writeLocal('theme')` and
applied in `main.tsx` before the first render. `color-scheme` follows the theme, so native
controls, the date picker and scrollbars do too. Screens read it with `useTheme()`.

**The rules**

1. **Light goes down in steps, not up.** Page `#FAFAFA` → sidebar `#F5F5F5` → raised
   `#F0F0F0`; cards and inputs are white. A white card separates from the page by its edge
   (`#E5E5E5`, `#D9D9D9` at the bottom: still lit from above), not by a shadow. There are
   still no shadows.
2. **Washes are black, not white.** Hover 3%, neutral 5%, pressed 9%.
3. **Two golds.** The primary button keeps the bright gradient with `#121212` text (6.0:1 on
   its darkest stop). Everything that draws gold as text or a thin mark, the brand word,
   the selected chip's text and tick, the current-item mark, the focus ring, uses the
   deep gold `#806210`: 5.5:1 on the page, 5.7:1 on a card, 4.8:1 on the selected wash
   over the sidebar. Bright `#E0B84A` on white is 1.9:1 and is never text there.
4. **Status hues are darkened for white**, and every `-strong` passes 4.5:1 as well, since
   a few screens use it as text. Warn is a burnt orange, `#A34B05`, kept 17° of hue away
   from the gold so "look again" never reads as "selected".
5. **The photo viewer stays dark** in both themes: `:root[data-theme="light"] .viewer`
   re-declares the dark tokens, so a photo is still the only lit thing on screen.
6. **Selected text** is solid gold with `#121212` in dark (9.9:1), a 45% gold wash with
   `#121212` in light (13.8:1).

| Token | Dark | Light | Light, measured |
|---|---|---|---|
| `--bg` | `#121212` | `#fafafa` | page |
| `--surface` | `#1a1a1a` | `#f5f5f5` | sidebar, side wells |
| `--card-bg` | `#1e1e1e`→`#1a1a1a` | `#ffffff` | cards |
| `--surface-raised` | `#222222` | `#f0f0f0` | avatars, raised wells |
| `--tip-bg` | `#2a2a2a` | `#ffffff` | tooltips, toasts (with `--border-strong` edge) |
| `--input-bg` | `#0c0c0c` | `#ffffff` | inputs |
| `--top-bar-bg` | `#121212` 94% | `#fafafa` 94% | title bar |
| `--inset` | black 30% | black 4% | recessed well |
| `--text` | `#e0e0e0` | `#121212` | 18.0:1 page, 18.7:1 card |
| `--text-label` | `#cccccc` | `#2e2e2e` | 13.0:1 page |
| `--text-muted` | `#b0b0b0` | `#4a4a4a` | 8.5:1 page, 7.8:1 raised |
| `--placeholder` | `#8c8c8c` | `#6b6b6b` | 5.3:1 input, 4.7:1 raised |
| `--zero-text` | `#5c5c5c` | `#9e9e9e` | 2.6:1, decorative only (§11.2) |
| `--border-soft` | `#2e2e2e` | `#ebebeb` | row dividers |
| `--border` | `#444444` | `#e0e0e0` | borders |
| `--button-edge` | `#4d4d4d` | `#c8c8c8` | ghost button edge |
| `--border-strong` | `#5c5c5c` | `#b5b5b5` | scrollbar thumb, toast edge |
| `--pick-edge` | `#888888` | `#858585` | input edge, 3.7:1 on a card |
| `--card-edge` | `#444`→`#2e2e2e` | `#e5e5e5`→`#d9d9d9` | card edge |
| `--row-hover` / `--neutral-bg` / `--neutral-soft` | white 3/6/12% | black 3/5/9% | washes |
| `--gold` | `#e0b84a` | `#806210` | 5.5:1 page; ring ≥5.0:1 everywhere |
| `--gold-soft` | gold 12% | gold 16% | selected wash; gold text on it 5.2:1 |
| `--gold-edge` | gold 55% | `#a67e16` 60% | selected chip edge |
| `--gold-gradient` / `--on-gold` | unchanged | unchanged | 6.0–13.9:1 |
| `--ok-text` / `-strong` | `#93d9a3` / `#62c47e` | `#1a6331` / `#23803f` | 6.3:1 on its tint / 5.0:1 |
| `--warn-text` | `#f5b77a` | `#a34b05` | 5.1:1 on its tint over the page |
| `--danger-text` / `-strong` | `#ff9d95` / `#f0645a` | `#a8261b` / `#c42b1c` | 6.0:1 / 5.7:1 |
| `--on-danger` | `#1f0a08` | `#ffffff` | close button glyph, 5.7:1 |
| `--info-text` / `-strong` | `#a9cdef` / `#6fa8dc` | `#1c5596` / `#2668b3` | 6.4:1 / 5.7:1; links 7.2:1 |
| `--neutral-text` / `-strong` | `#cccccc` / `#888888` | `#333333` / `#737373` | 10.8:1 / 4.2:1 dot |
| `--type-*` | as above | `#2f78d4` `#c94e1e` `#158a62` `#a87000` `#858585` | each ≥3.5:1 as a dot |
| `--selection-bg` | `#e0b84a` | gold 45% | text on it 9.9:1 / 13.8:1 |
| `--scrim` | black 75% | `#121212` 45% | behind a dialog |

Every pair the components use is checked by the contrast script for both themes (text
4.5:1, rings, dots and input edges 3:1); none fails.

### Surfaces (dark)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#121212` | The page. Flat: no glow, no gradient |
| `--surface` | `#1a1a1a` | Flat panels: the sidebar, side wells |
| `--card-bg` | gradient `#1e1e1e` → `#1a1a1a` | Cards: lighter at the top, as if lit from above |
| `--surface-raised` | `#222222` | Avatars, raised wells |
| `--tip-bg` | `#2a2a2a` | Tooltips, toasts, the skip link: the highest surface |
| `--input-bg` | `#0c0c0c` | Inputs and text wells: darker than the page, so they read as recessed |
| `--top-bar-bg` | `--bg` at 94% | The title bar |
| `--viewer-bg` | black at 94% | Behind a full-size photo |
| `--inset` / `--inset-edge` | black 30% / white 8% | A recessed well; the white edge doubles as the hover wash on gold |

### Text

| Token | Value | On `--bg` | On a card | Use |
|---|---|---|---|---|
| `--text` | `#e0e0e0` | 14.2:1 | 12.6:1 | Body and headings |
| `--text-label` | `#cccccc` | 11.7:1 | 10.4:1 | Field labels, secondary controls (a step between primary and secondary) |
| `--text-muted` | `#b0b0b0` | 8.6:1 | 7.7:1 | Descriptions, hints, metadata |
| `--placeholder` | `#8c8c8c` | 5.6:1 | 5.2:1 | Placeholder text and disabled button text only |
| `--zero-text` | `#5c5c5c` | **2.8:1** | | A zero that should recede. Fails AA as text: see §11 |

### Edges: neutral grey, never gold

| Token | Value | Use |
|---|---|---|
| `--border-soft` | `#2e2e2e` | Row dividers inside a card, the quietest line |
| `--border` | `#444444` | Borders and dividers |
| `--button-edge` | `#4d4d4d` | Ghost and quiet button edges |
| `--border-strong` | `#5c5c5c` | Scrollbar thumbs, strong separators |
| `--pick-edge` | `#888888` | Input edges: 4.9:1 on a card, 5.5:1 on the input's fill (WCAG 1.4.11) |
| `--card-edge` | gradient `#444444` → `#333333` → `#2e2e2e` | The card's top-lit edge |
| `--row-hover` / `--outline-shape` | white 3% / 7% | Row hover; outline shapes |

### Gold: four jobs

Unchanged from the checker. Gold on the page is 9.9:1; on the highest grey (`#2a2a2a`) 7.6:1.

| Token | Use |
|---|---|
| `--gold` `#e0b84a` | The brand word, the selected indicator, the focus ring |
| `--gold-gradient` | The one primary button (`#f6dc8a` → `#e0b84a` → `#b98a26`) |
| `--on-gold` `#121212` | Text on the primary button: 6.0:1 on the darkest stop, 13.9:1 on the lightest |
| `--gold-soft` | The wash behind a selected chip or segment (gold text on it: 7.3:1 on a card) |
| `--gold-edge` | The edge of a selected chip |

### Status

Each family has a background, a text colour, a strong colour for icons and dots, a soft
wash, a line and an edge. Warn has only `-bg`, `-text` and `-edge`. Every `-bg` is the
family's own hue at 12%, so on a neutral grey it reads as green, amber, red or blue, not
brown. Status text on its own tint is at least 7.0:1; on a plain card at least 8.7:1.

| Family | Text | Means |
|---|---|---|
| ok | `#93d9a3` | Done, passed, posted |
| warn | `#f5b77a` | Look again, pending |
| danger | `#ff9d95` | Refused, failed, blocked, in cooldown |
| info | `#a9cdef` | Neutral information; links |
| neutral | `#cccccc` (dot `#888888`) | To do, counts, roles |

### Listing types: one hue per type, everywhere

| Token | Value | Category |
|---|---|---|
| `--type-commercial` | `#3987e5` | Commercial space |
| `--type-condo` | `#d95926` | Condo / house and lot |
| `--type-office` | `#199e70` | Office space |
| `--type-warehouse` | `#c98500` | Warehouse |
| `--type-unsorted` | `#888888` | Anything else |

**Type hues are only ever a dot.** Never text, never a background, never a border. Each
of these hues sits close to a status hue or to gold (see §11), so the shape (a dot beside
neutral text) is what keeps "this is a warehouse" from reading as "this is selected" or
"this is blocked".

## 3. Type

Montserrat for headings, labels and buttons; Segoe UI for everything a person reads at
length. Weights: 500 label, 600 heading, 700 display (the brand word).

| Token | Size / line | Use |
|---|---|---|
| `--text-caption` | 14 / 20 | Pills, badges, hints, metadata in tight places. **The floor** |
| `--text-meta` | 15 / 22 | Field labels, nav, chips, secondary lines |
| `--text-body` | 16 / 24 | Body text, inputs, buttons |
| `--text-name` | 17 / 23 | A property's name in a list |
| `--text-title` | 20 / 26 | Card and section titles, empty-state titles |
| `--text-heading` | 24 / 30 | The screen's one `h1` |
| `--text-verdict` | 28 / 34 | The big answer: "Ready to post", "In cooldown" |

Sentence case everywhere, including buttons, pills and table headers. Letter-spacing 0.
Counts use tabular figures.

## 4. Space

A 2px base: `--space-1` 2 · `-2` 4 · `-3` 6 · `-4` 8 · `-5` 10 · `-6` 12 · `-7` 14 ·
`-8` 16 · `-9` 18 · `-10` 20 · `-12` 24 · `-14` 28 · `-20` 40 · `-24` 48.

Rhythm used by the components: 4–8 inside a control, 12–16 between related things, 20–24
between groups, 40–48 between regions.

## 5. Shape

| Token | Radius | Use |
|---|---|---|
| `--radius-sm` | 4 | Tiny marks |
| `--radius-chip` | 8 | Chips |
| `--radius-input` | 12 | Inputs, buttons, nav items |
| `--radius-row` | 14 | List rows, notices, toasts, check lines |
| `--radius-verdict` | 16 | The verdict panel |
| `--radius-card` | 18 | Cards |
| `--radius-pill` | 999 | Pills and count badges (half their own height) |

## 6. Depth

There are no shadows. A card is raised by two things only:

- its background, `--card-bg`, a vertical gradient a shade lighter at the top, and
- its edge, `--card-edge`, a 1px gradient line brightest at the top: light from above.

In CSS that is `border: 1px solid transparent; background: var(--card-bg) padding-box,
var(--card-edge) border-box;`. Inputs go the other way: darker than the page
(`--input-bg`), so they sit below the surface.

## 7. Motion

One curve, `--ease-out` (`cubic-bezier(0.215, 0.61, 0.355, 1)`), no bounce, no spring.
Only `opacity` and `transform` animate; colour and size changes snap.

| Token | ms | Use |
|---|---|---|
| `--dur-press` | 80 | A button's press (`scale(--press-scale)`, 0.98) |
| `--dur-fast` | 120 | Hover washes fading in |
| `--dur-exit` | 150 | Things leaving |
| `--dur-enter` | 200 | Things arriving (rise `--rise`, 8px, and fade) |
| `--dur-move` | 250 | Things changing place |
| `--dur-scroll` | 300 | Scrolling to something |
| `--stagger` | 40 | Between items of a list arriving together |

Hover is an overlay whose opacity fades in, not a background-colour transition. The one
exception to the curve is the spinner, which turns at a constant speed because it is a
loop, not a transition.

Windows' "Animation effects" reaches the WebView as `prefers-reduced-motion`; every
duration drops to 0 and the rise to 0px. The spinner stops turning and breathes instead.

## 8. Layout

- **Measured, not guessed.** Breakpoints are measured against the container's width after
  the text-size zoom, not the viewport. In CSS that is a container query on the shell; the
  content column is what is measured.
- `--bp-compact` 1100 and `--bp-stack` 900 (container widths). Page padding: 24 above
  1100, 16 between, 12 below 900. Page content is at most `--page-max`, 1320.
- Two-pane screens: a side pane of `--pane-regular` 400 (`--pane-compact` 340 below
  1100), a gap of `--gap-regular` 40 (`--gap-compact` 24), stacking below 900.
- **A left sidebar holds the app's chrome**: the words "APG Post-It" at the top (no logo
  mark), the nav, then the person, Sign out and the collapse toggle at the bottom. It
  lists no people: an Admin reaches the interns through the **Interns** nav item, which
  opens the Interns screen, so the sidebar stays the same short height however large the
  team grows. Collapsed it is a 64px icon rail with tooltips; Ctrl+B toggles it; the
  choice is remembered, and windows under 1000px start collapsed. Width animates only on
  a toggle.
- **The Interns screen** (`/interns`, Admin only) is the weekly monitor. The header holds
  the heading, the week picker (‹ "2–6 Nov" ›, This week, Next week) and Refresh; on a
  weekend it opens on the week that just ended. Then "Who posted?", the screen's one big
  search: a listing name or a pasted Facebook link shows every matching post right below
  (listing, intern, when, FB account, status, Open), and Escape clears it. Four tiles
  (Posted of the target, Pending, Left or Missed, Behind of the interns). One table, worst
  first: initials and name, "12 / 40" over a green and amber bar, Mon–Fri as five small
  bars (today ringed in neutral grey, days to come dashed), the pace as a pill (Not
  started and Missed danger, Behind warn, On track neutral, Done ok), and the last post.
  A row opens that intern's week in a side pane (the row gets the gold selected wash and
  mark): the bar and pace, Open in Assign and FB profile, the last 4 weeks as small bars,
  then Not shared / Pending / Posted (with Open) / Missed, five each before "Show all".
  Escape or Close shuts it. Revoked people sit in a folded "Revoked" card below. The
  Tracker's Interns card shows the same week as "12 / 40" and the pace, and links here
  with "See all interns". The intern's My queue heads the week: "This week · 12 of 40", a
  bar, "Due Fri 6 Nov" (an amber "Due today" on Friday), and from Saturday next week's
  queue with "Starts Mon 9 Nov".
- **Sign-in** is one card: a two-segment "Sign in as" control (Intern / Admin, the picked
  segment gold, the last choice remembered on this computer), the key field, Cancel and
  Sign in, and a folded "Where do I get a key?". The choice only states intent: after
  `ping`, a key for the other role does not sign in ("This key is for an Intern."), the
  key stays in the field and nothing is kept.
- **Settings** (Admin): the Team card in the main column (name, role, FB accounts,
  Active, and per row New key / Turn off or Turn on as quiet buttons; your own row says
  "You" and has none), with Add person in its header. Every change asks first in a
  dialog whose focus starts on Cancel; a new key is shown once in a monospace well with
  Copy and "You won't see this again." The side pane holds a compact Listings check
  (two count tiles, then Only in Directory / Only in checker / Sold as folded lists),
  the Rules and the web app link.
- **Assign** is two steps, a week at a time (`?week=` its Monday; this week, or the coming
  one from Saturday). The header holds the week picker (‹ "2–6 Nov" ›, This week, Next
  week). With no `?intern=`, a grid of cards, one per active intern and nothing else: the
  name, one pace pill (Behind warn, Not started and Missed danger, No queue neutral, On
  track info, Done ok) and "12 / 40" beside a posted-green, pending-amber bar; Behind
  first. With one, the header says the name and "Due Fri 6 Nov" ("Ended …" for a week that
  is over), then two panes. Left, Listings: the categories as one row of chips that
  scrolls sideways (its end fades), a search and a Filter menu (Fresh, Due for repost,
  Show unavailable, with a count while any is on); "− Add 40 +" (perWeek, stepped by 5)
  and ⋯ (Paste a list) in its header. Right, the week's Queue, grouped Not shared
  (drag, Alt+Up/Down, remove), Pending, Posted (Open post); its rows scroll inside it and
  its foot holds Undo changes and Save queue (n), the one gold button. A week that is over
  is one read-only card: "32 posted · 8 missed", Copy missed to next week (they arrive
  tinted, with Undo, unsaved), then Missed, Pending, Posted. Quick fill's rows are tinted
  info until saved or undone. **Fill queues** in step one's header opens a wide dialog:
  per week, the week, keep existing queues, the active interns as ticks, then Preview
  (one line per intern with a green fill bar against "per week", opening to the list;
  how many short; the skipped reasons) and Save all, the dialog's one gold button.
- **Records** (`/records`, Admin; nav between Interns and Find): the range as chips
  (Today, 7 days, 30 days) in the header; Posts per day as hand-built CSS bars (posted
  green, pending amber, never gold) beside a compact day table that says the same in
  words; then Posts: a search (property, intern or link), Export CSV, and a table of
  time, property, posted by, FB account, status and Open. A property opens its whole
  history in a dialog. Export downloads a file in a browser and copies the CSV on the
  desktop.
- **Wording on admin screens:** a heading and no description line unless it says
  something the screen doesn't; labels over sentences.
- **A slim title bar runs across the content column**: the drag region, with minimize,
  maximize/restore and close at the top-right. Close turns danger red on hover and always
  asks first. Breakpoints measure the content column, so screens fit either sidebar width.
- Breakpoints are "below": `width < 1100px`, `width < 900px`, so a 900px container is
  compact, not narrow. The container is what's measured, so a scrollbar's width counts:
  a 900px window whose page scrolls is a narrow container.
- A form card that grows (an error appearing) is anchored at the top, never centred
  vertically, so it grows downwards instead of jumping.

## 9. Focus

`--focus-ring`: 2px solid gold, `--focus-offset` 3px, on `:focus-visible` only. The ring
follows the element's own radius. A control inside another (the Show button inside the key
field) is sized so its ring fits inside its host rather than over the host's edge.

After navigation a screen's `h1` takes focus without a ring (it is a place, not a
control), unless the screen has already put focus inside itself (sign-in starts in its
first field). "Skip to content" is the first stop on every screen.

## 10. Components

Import from `src/ui/components` (the index). Every one is presentational: data and
callbacks come in as props, and none of them touches `platform()`. `#/kit` (development
only, not in the production build) shows each in every variant with the product's words.

| Component | Variants and props | The rule it carries |
|---|---|---|
| **Button** | `primary`, `ghost` (default), `quiet`, `link`; `regular` 44px, `small` 36px; `busy`, `disabled`, `icon`, `block` | One `primary` per screen. `busy` keeps focus and width, shows a spinner and ignores clicks (`aria-busy`, `aria-disabled`, never `disabled`). Disabled primary drops its gold: gold is never spent on something you can't do. Disabled text is `--placeholder`, edges `--border-soft` |
| **Card** | `title` (makes it a labelled `section`), `description`, `actions`, `headingLevel` 2/3, `padding` regular 24 / tight 16 | Gradient and top-lit edge; no shadow |
| **TextInput** | `label` (required), `hint`, `error`, `end` slot | Label always visible. Error then hint read with the field (`aria-describedby`); error sets `aria-invalid`. Edge `--pick-edge` (3.4:1). Disabled loses its well |
| **SearchBox** | `label` (for screen readers), `value`, `onValueChange` | Clear button once there's text; Escape clears, and when empty lets Escape through to whatever is around it |
| **Chip** | `selected`, `onSelectedChange`, `leading` (a category dot), `count` | A toggle (`aria-pressed`). Selected is gold (wash, edge, text) **and** a tick |
| **Pill** | `tone` ok, warn, danger, info, neutral; `dot` | The word carries the meaning; colour only speeds finding it |
| **Badge** | `count`, `label` ("6 to post"), `tone` | A count, read with what it counts |
| **CategoryTag**, **CategoryDot** | `category` as the Drive names it | Hue as a dot only; name in sentence case. Matched as whole names (like D11): "Virtual Office for posting" is unsorted, not office |
| **Notice** | `tone` danger, warn, info, ok; `title`, `action`, `live` | Icon shape per tone. `live` announces it: danger and warn as alerts, the rest politely |
| **Toast**, **ToastRegion**, `useToasts` | `tone` ok, info, warn, danger | Bottom centre, at most three. 4s for ok/info, 8s for warn/danger, paused while hovered or focused. Rendered into `<body>`. A problem that needs action is a Notice, not a toast |
| **Spinner** | `small` 16, `regular` 24; `label` | Turns at constant speed; with reduced motion it breathes instead |
| **EmptyState** | `title`, body, `action`, `icon` | Says what is empty, why, and the one thing to do next |
| **Sidebar / TitleBar** | see §8 | Brand word gold; the current item gets a gold mark and brighter text. The title bar replaced the old top bar. On the desktop the window has no frame (`decorations: false`): the bar is the drag region (double-click maximizes) and carries minimize, maximize/restore and close at the top-right corner, 46×32 with inline SVG glyphs. Close turns danger red on hover, never gold, and always asks first |
| **CheckList** | `checks: CheckResult[]`, `label` | Order kept, so a check is always in the same place. Pass, warn, fail each have an icon shape and a word for screen readers; a fail line is tinted so it is found first |

The shell (`src/ui/App.tsx`) holds the routes: Sign in, Find, Property, Log a post, My
queue, Assign, Tracker, Interns, Records, Settings. Nav by role, per `docs/ROLES.md`: an
intern gets My queue and Find; an admin Tracker, Assign, Interns, Records, Find and
Settings (D14).

Sign-in asks only for the key when a web app link is built into the build
(`src/config.ts`); with none built in it asks for the link too. The
`.page` and `.page-header` classes in `App.css` lay out a screen.

## 11. Known tensions in the copied tokens

Recorded so they are decided on purpose, with the checker, rather than drifted into.

1. **Every listing-type hue sits beside a status hue or gold** (hue angles measured):
   commercial `#3987e5` is 4.2° from info `#6fa8dc`; condo `#d95926` is 13° from both
   danger `#f0645a` and warn `#f5b77a`; office `#199e70` is 22° from ok `#62c47e`; and
   **warehouse `#c98500` is 4.3° from gold `#e0b84a`**, which on paper gives gold a fifth
   job. Post-It shows category and status side by side on every listing, so this matters
   more here than in the checker. The mitigation above (type hues only as a dot) works; a
   better fix is a warehouse hue away from gold, such as a violet `#9a7fe0` (6.0:1 on
   `--bg`, 44° from commercial), agreed with the checker.
2. **`--zero-text` is 2.8:1 on `--bg`.** Fine for a decorative zero beside a label that
   carries the meaning, not for a zero that is the information. Post-It's components
   don't use it; the tracker should show "0 posted" in `--text-muted`.
3. **Naming.** tokens.css calls the four categories "listing types"; `core/types.ts` uses
   `listingType` for "For sale" / "For lease". On screen and in components, the four are
   **categories**; the token names stay as copied.
4. **Input edges.** `--border` around an input measures 1.8:1 against a card, under
   WCAG 1.4.11's 3:1 for the edge that identifies a field. Inputs use `--pick-edge`
   (`#888888`) instead: 4.9:1 against the card, 5.5:1 against the input's own fill. Still
   neutral grey, still never gold.
5. **`--focus-radius` (14px) has no job in CSS.** An outline follows its element's radius,
   so this token, presumably for the checker's previous UI toolkit, is unused here.
