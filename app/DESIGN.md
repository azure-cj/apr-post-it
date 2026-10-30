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
3. **Dark only.** There is no light theme and no theme switch.
4. **No box-shadows.** Depth comes from the card's vertical gradient and its top-lit edge.
5. **Montserrat** (500, 600, 700) for headings, labels and buttons. **Segoe UI** for body text.
6. **Nothing under 14px.**
7. **Sentence case. No tracked capitals.** Letter-spacing is 0 everywhere.
8. **One easing curve.** **Only opacity and transform animate.**

## 2. Colour

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0e0c08` | The page |
| `--bg-glow` | gold at 10% | The soft glow at the top of the page, nowhere else |
| `--surface` | `#17140e` | Flat panels |
| `--surface-raised` | `#1e1a12` | Avatars, raised wells |
| `--card-bg` | gradient `#1c1811` → `#16130d` | Cards: lighter at the top, as if lit from above |
| `--input-bg` | `#0b0906` | Inputs: darker than the page, so they read as recessed |
| `--tip-bg` | `#241f16` | Tooltips and toasts |
| `--top-bar-bg` | `--bg` at 94% | The top bar |
| `--viewer-bg` | near-black at 94% | Behind a full-size photo |
| `--inset` / `--inset-edge` | black 25% / white 8% | A recessed well; the white edge doubles as the hover wash on gold |

### Text

| Token | Value | On `--bg` | Use |
|---|---|---|---|
| `--text` | `#f3eee4` | 16.9:1 | Body and headings |
| `--text-label` | `#d9d2c4` | 13:1 | Field labels, secondary controls |
| `--text-muted` | `#b8af9c` | 9.0:1 | Descriptions, hints, metadata |
| `--placeholder` | `#8a8170` | 5.2:1 (on `--input-bg`) | Placeholder text only |
| `--zero-text` | `#5c5547` | **2.6:1** | A zero that should recede. Fails AA as text: see §11 |

### Edges: cream at an alpha, never gold

`--border-soft` 6%, `--border` 10%, `--button-edge` 18%, `--border-strong` 24%,
`--pick-edge` 40%, `--outline-shape` 7%, `--row-hover` 3%. The card edge, `--card-edge`,
is a gradient from 14% at the top to 6% at the bottom: the top-lit edge.

### Gold: four jobs

| Token | Use |
|---|---|
| `--gold` `#e0b84a` | The brand word, the selected indicator, the focus ring |
| `--gold-gradient` | The one primary button |
| `--on-gold` `#1a1408` | Text on the primary button (5.9:1 on the darkest stop) |
| `--gold-soft` | The wash behind a selected chip |
| `--gold-edge` | The edge of a selected chip; text selection |

### Status

Each family has a background, a text colour, a strong colour for icons and dots, a soft
wash, a line and an edge. Warn has only `-bg`, `-text` and `-edge`.

| Family | Text | Means |
|---|---|---|
| ok | `#93d9a3` | Done, passed, posted |
| warn | `#f5b77a` | Look again, pending |
| danger | `#ff9d95` | Refused, failed, blocked, in cooldown |
| info | `#a9cdef` | Neutral information; links |
| neutral | `#c9c2b4` | To do, counts, roles |

### Listing types: one hue per type, everywhere

| Token | Value | Category |
|---|---|---|
| `--type-commercial` | `#3987e5` | Commercial space |
| `--type-condo` | `#d95926` | Condo / house and lot |
| `--type-office` | `#199e70` | Office space |
| `--type-warehouse` | `#c98500` | Warehouse |
| `--type-unsorted` | `#6f685a` | Anything else |

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
  the text-size zoom, not the viewport. In CSS that is a container query on the shell; in
  the top bar it is literal measurement (below).
- `--bp-compact` 1100 and `--bp-stack` 900 (container widths). Page padding: 24 above
  1100, 16 between, 12 below 900. Page content is at most `--page-max`, 1320.
- Two-pane screens: a side pane of `--pane-regular` 400 (`--pane-compact` 340 below
  1100), a gap of `--gap-regular` 40 (`--gap-compact` 24), stacking below 900.
- **The top bar takes the first arrangement that fits**: one row (brand, nav, you), then
  two rows (brand and you, then nav). It measures what its parts need against the room it
  has, so it adapts to text size and to the nav a role gets, not to a fixed width. If even
  two rows don't fit, the nav wraps.
- **The document scrolls; the top bar sticks.** `--top-bar-bg` is 94% opaque because the
  screen scrolls under it. One scroll container means the bar and the screen always share a
  width (their left edges line up at every size), the bar runs to the window's edge, and
  Page Down works wherever focus is.
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
| **TopBar** | `nav`, `currentKey`, `user`, `onNavigate`, `onSignOut` | Brand word gold; the current item gets a gold mark and brighter text; measured layout |
| **CheckList** | `checks: CheckResult[]`, `label` | Order kept, so a check is always in the same place. Pass, warn, fail each have an icon shape and a word for screen readers; a fail line is tinted so it is found first |

The shell (`src/ui/App.tsx`) holds the routes: Sign in, Find, Property, Log a post, My
queue, Assign, Tracker, Settings. Nav by role, per `docs/ROLES.md`: an intern gets My
queue and Find; a manager Tracker, Assign and Find; an admin also Settings. The
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
2. **`--zero-text` is 2.6:1 on `--bg`.** Fine for a decorative zero beside a label that
   carries the meaning, not for a zero that is the information. Post-It's components
   don't use it; the tracker should show "0 posted" in `--text-muted`.
3. **Naming.** tokens.css calls the four categories "listing types"; `core/types.ts` uses
   `listingType` for "For sale" / "For lease". On screen and in components, the four are
   **categories**; the token names stay as copied.
4. **Input edges.** `--border-strong` around an input measures 2.06:1 against a card,
   under WCAG 1.4.11's 3:1 for the edge that identifies a field. Inputs use `--pick-edge`
   instead: 3.43:1 against the card, 3.82:1 against the input's own fill. Still cream at
   an alpha, still never gold.
5. **`--focus-radius` (14px) has no job in CSS.** An outline follows its element's radius,
   so this token, presumably for the checker's previous UI toolkit, is unused here.
