import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Notice,
  Pill,
  SearchBox,
  Spinner,
} from "../../components";
import {
  dailyTotals,
  postsForProperty,
  searchPosts,
  type DailyTotal,
} from "@/core/records";
import { addDays, plural, shortDate } from "@/core/summary";
import type { PostLogEntry } from "@/core/types";
import { Dialog } from "./Dialog";
import "./RecordsScreen.css";

export type RecordsRange = "today" | "7" | "30";

export interface RecordsScreenProps {
  /** Every Posts row. */
  readonly posts: readonly PostLogEntry[];
  /** Today, yyyy-MM-dd. */
  readonly today: string;
  /** The rows haven't arrived yet. */
  readonly loading?: boolean | undefined;
  readonly error?: string | null | undefined;
  /** Opens a post's link in the browser. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** Hands over the current results as CSV, with a file name for them. */
  readonly onExport?: ((csv: string, fileName: string) => void) | undefined;
  readonly initialRange?: RecordsRange | undefined;
}

const RANGES: readonly {
  readonly key: RecordsRange;
  readonly label: string;
  readonly days: number;
}[] = [
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
];

/** Shown at once; the rest are in the CSV. */
export const RESULT_ROWS = 200;

/**
 * Who posted what, when: posts per day for a range, and a search over the
 * posts in it. A property opens its whole history, so "someone asked about
 * this listing; who posted it?" is one click.
 */
export function RecordsScreen({
  posts,
  today,
  loading = false,
  error,
  onOpenLink,
  onExport,
  initialRange = "7",
}: RecordsScreenProps) {
  const [range, setRange] = useState<RecordsRange>(initialRange);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<{
    readonly id: string;
    readonly name: string;
  } | null>(null);

  const days = RANGES.find((r) => r.key === range)!.days;
  const from = addDays(today, -(days - 1));
  const totals = useMemo(
    () => dailyTotals(posts, from, today),
    [posts, from, today],
  );
  const results = useMemo(
    () => searchPosts(posts, { query, from, to: today }),
    [posts, query, from, today],
  );
  const shown = results.slice(0, RESULT_ROWS);
  const waiting = loading && posts.length === 0;

  return (
    <div className="page records">
      <header className="page-header records__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Records
        </h1>
        <div className="records__ranges" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <Chip
              key={r.key}
              selected={range === r.key}
              onSelectedChange={() => setRange(r.key)}
            >
              {r.label}
            </Chip>
          ))}
        </div>
      </header>

      {error ? (
        <Notice tone="danger" live className="records__notice">
          {error}
        </Notice>
      ) : null}

      {waiting ? (
        <div className="records__waiting">
          <Spinner label="Reading the posts" />
          <span>Reading the posts…</span>
        </div>
      ) : (
        <>
          <Card
            title="Posts per day"
            padding="tight"
            className="records__daily"
          >
            <div className="records__daily-body">
              <DayBars totals={totals} />
              <DayTable totals={totals} />
            </div>
          </Card>

          <Card
            title="Posts"
            padding="tight"
            className="records__posts"
            actions={
              <div className="records__tools">
                <SearchBox
                  className="records__search"
                  label="Search posts"
                  placeholder="Property, intern or link"
                  value={query}
                  onValueChange={setQuery}
                />
                {onExport ? (
                  <Button
                    size="small"
                    disabled={results.length === 0}
                    onClick={() =>
                      onExport(
                        postsCsv(results),
                        `posts ${from} to ${today}.csv`,
                      )
                    }
                  >
                    Export CSV
                  </Button>
                ) : null}
              </div>
            }
          >
            <p className="records__count" role="status">
              {results.length > shown.length
                ? `${shown.length} of ${results.length.toLocaleString("en-PH")}`
                : plural(results.length, "post", "posts")}
            </p>
            {results.length === 0 ? (
              <EmptyState
                headingLevel={3}
                title={query ? "No posts match" : "No posts in this range"}
              />
            ) : (
              <PostTable
                posts={shown}
                onOpenLink={onOpenLink}
                onOpenProperty={(post) =>
                  setHistory({ id: post.propertyId, name: post.title })
                }
              />
            )}
          </Card>
        </>
      )}

      {history ? (
        <PropertyHistory
          name={history.name}
          posts={postsForProperty(posts, history)}
          onOpenLink={onOpenLink}
          onClose={() => setHistory(null)}
        />
      ) : null}
    </div>
  );
}

/** Posts per day as bars: posted in green, pending in amber above it. The table beside it says the same in words. */
function DayBars({ totals }: { readonly totals: readonly DailyTotal[] }) {
  const max = Math.max(1, ...totals.map((t) => t.posted + t.pending));
  const step = totals.length > 14 ? 5 : 1;
  return (
    <div className="bars" aria-hidden="true">
      <div className="bars__scale">
        <span className="tabular">{max}</span>
        <span className="tabular">0</span>
      </div>
      <div className="bars__plot">
        {totals.map((t, i) => {
          const last = i === totals.length - 1;
          return (
            <div
              key={t.date}
              className="bars__day"
              title={`${shortDate(t.date)}: ${t.posted} posted, ${t.pending} pending`}
            >
              <div className="bars__stack">
                {t.pending > 0 ? (
                  <span
                    className="bars__pending"
                    style={{ height: `${(t.pending / max) * 100}%` }}
                  />
                ) : null}
                {t.posted > 0 ? (
                  <span
                    className="bars__posted"
                    style={{ height: `${(t.posted / max) * 100}%` }}
                  />
                ) : null}
              </div>
              <span className="bars__label">
                {i % step === 0 || last ? dayLabel(t.date, totals.length) : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="bars__key">
        <span className="bars__swatch bars__swatch--posted" /> Posted
        <span className="bars__swatch bars__swatch--pending" /> Pending
      </div>
    </div>
  );
}

function dayLabel(date: string, count: number): string {
  // "Sat 31" for a short range; "31" for a long one, so labels never collide.
  return count > 7
    ? String(Number(date.slice(8)))
    : shortDate(date).replace(/ \S+$/, "");
}

function DayTable({ totals }: { readonly totals: readonly DailyTotal[] }) {
  const newest = [...totals].reverse();
  return (
    <div className="records__table-wrap records__day-table">
      <table className="records__table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" className="records__num">
              Posted
            </th>
            <th scope="col" className="records__num">
              Pending
            </th>
            <th scope="col">By</th>
          </tr>
        </thead>
        <tbody>
          {newest.map((t) => (
            <tr key={t.date}>
              <th scope="row">{shortDate(t.date)}</th>
              <td
                className={`records__num tabular${t.posted === 0 ? " records__zero" : ""}`}
              >
                {t.posted}
              </td>
              <td
                className={`records__num tabular${t.pending === 0 ? " records__zero" : ""}`}
              >
                {t.pending}
              </td>
              <td className="records__by">{byWords(t.byIntern)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function byWords(byIntern: Readonly<Record<string, number>>): string {
  const people = Object.entries(byIntern).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return people
    .map(([name, n]) => `${name.split(" ")[0] || "Unknown"} ${n}`)
    .join(" · ");
}

function PostTable({
  posts,
  onOpenLink,
  onOpenProperty,
  showDate = true,
  showProperty = true,
}: {
  readonly posts: readonly PostLogEntry[];
  readonly onOpenLink?: ((url: string) => void) | undefined;
  readonly onOpenProperty?: ((post: PostLogEntry) => void) | undefined;
  readonly showDate?: boolean;
  readonly showProperty?: boolean;
}) {
  return (
    <div className="records__table-wrap">
      <table className="records__table records__post-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            {showProperty ? <th scope="col">Property</th> : null}
            <th scope="col">Posted by</th>
            <th scope="col">FB account</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="visually-hidden">Link</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post, i) => (
            <tr key={`${i}-${post.date}-${post.time}-${post.title}`}>
              <td className="records__time tabular">
                {showDate ? `${shortDate(post.date)}, ` : ""}
                {post.time}
              </td>
              {showProperty ? (
                <th scope="row" className="records__property">
                  {onOpenProperty ? (
                    <button
                      type="button"
                      className="records__property-button"
                      onClick={() => onOpenProperty(post)}
                    >
                      {post.title}
                    </button>
                  ) : (
                    post.title
                  )}
                </th>
              ) : null}
              <td>{post.postedBy}</td>
              <td>{post.fbAccount}</td>
              <td>
                {post.status === "Posted" ? (
                  <Pill tone="ok">Posted</Pill>
                ) : (
                  <Pill tone="warn">Pending</Pill>
                )}
              </td>
              <td className="records__link">
                {post.postLink && onOpenLink ? (
                  <Button
                    variant="link"
                    onClick={() => onOpenLink(post.postLink)}
                    aria-label={`Open the post of ${post.title}`}
                  >
                    Open
                  </Button>
                ) : (
                  <span className="records__zero">No link</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PropertyHistory({
  name,
  posts,
  onOpenLink,
  onClose,
}: {
  readonly name: string;
  readonly posts: readonly PostLogEntry[];
  readonly onOpenLink?: ((url: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      title={name}
      size="wide"
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="records__count">
        {plural(posts.length, "post", "posts")}
        {posts.length > 0
          ? `, last ${shortDate(posts[0]!.date)} by ${posts[0]!.postedBy}`
          : ""}
      </p>
      {posts.length > 0 ? (
        <PostTable posts={posts} onOpenLink={onOpenLink} showProperty={false} />
      ) : null}
    </Dialog>
  );
}

/** The posts as CSV, one row each, in the order given. Quoted where needed (RFC 4180), CRLF line ends. */
export function postsCsv(posts: readonly PostLogEntry[]): string {
  const head = [
    "Date",
    "Time",
    "Property",
    "Property ID",
    "Posted by",
    "FB account",
    "Status",
    "Type",
    "Link",
  ];
  const cell = (value: string) => {
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = posts.map((p) =>
    [
      p.date,
      p.time,
      p.title,
      p.propertyId,
      p.postedBy,
      p.fbAccount,
      p.status,
      p.type,
      p.postLink,
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}
