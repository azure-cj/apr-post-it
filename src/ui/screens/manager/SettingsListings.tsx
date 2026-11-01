import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Card, Notice, PAGE_SIZE, Pagination, SearchBox, Spinner, usePaged } from '../../components';
import { BackendError } from '@/core/backend';
import type { IndexCheck } from '@/core/types';
import { ConfirmAction, sentence } from './SettingsShared';

/** The Directory build, as `directoryStatus` says it. */
export interface DirectoryBuild {
  readonly running: boolean;
  readonly done: number;
  readonly total: number;
  /** When the last build finished, as the server sent it; '' when never. */
  readonly builtAt: string;
}

export interface SettingsListingsProps {
  readonly onDirectoryStatus?: (() => Promise<DirectoryBuild>) | undefined;
  /** Starts a rebuild; the server begins about 10 s later. */
  readonly onRebuildDirectory?: (() => Promise<unknown>) | undefined;
  readonly onIndexCheck?: (() => Promise<IndexCheck>) | undefined;
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** How often the build is read again while it runs. Default 10 s. */
  readonly pollMs?: number | undefined;
}

/** After Rebuild, how many reads to wait for the build to start before giving up waiting. */
const START_READS = 9;

const count = (n: number) => n.toLocaleString('en-PH');
export const driveFolder = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

/** "Sat 31 Oct, 6:04 PM" in Manila, or the text as sent when it isn't a time. */
export function builtWords(builtAt: string): string {
  const ms = Date.parse(builtAt);
  if (Number.isNaN(ms)) return builtAt;
  const at = new Date(ms);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(at);
  return `${day.replace(',', '')}, ${time}`;
}

export function SettingsListings({ onDirectoryStatus, onRebuildDirectory, onIndexCheck, onOpenLink, pollMs = 10_000 }: SettingsListingsProps) {
  return (
    <div className="settings__column">
      {onDirectoryStatus ? <DirectoryCard read={onDirectoryStatus} rebuild={onRebuildDirectory} pollMs={pollMs} /> : null}
      {onIndexCheck ? <ListingsCheck onRun={onIndexCheck} onOpenLink={onOpenLink} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ directory

function DirectoryCard({
  read,
  rebuild,
  pollMs,
}: {
  readonly read: () => Promise<DirectoryBuild>;
  readonly rebuild?: (() => Promise<unknown>) | undefined;
  readonly pollMs: number;
}) {
  const [status, setStatus] = useState<DirectoryBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** Reads left while waiting for a requested build to start; 0 when not waiting. */
  const [waiting, setWaiting] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;

  const refresh = useCallback(async () => {
    try {
      const next = await readRef.current();
      setStatus(next);
      setError(null);
      setWaiting((w) => (next.running ? 0 : Math.max(0, w - 1)));
    } catch (err) {
      setError(sentence(err));
      setWaiting(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = status?.running === true;
  const polling = running || waiting > 0;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setTimeout(() => void refresh(), pollMs);
    return () => clearTimeout(timer);
  }, [polling, status, waiting, pollMs, refresh]);

  const total = status?.total ?? 0;
  const done = Math.min(status?.done ?? 0, total || Infinity);

  return (
    <Card
      title="Directory"
      actions={
        rebuild ? (
          <Button size="small" disabled={polling || status === null} onClick={() => setAsking(true)}>
            Rebuild directory
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <Notice
          tone="danger"
          live
          action={
            <Button size="small" variant="quiet" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : status === null ? (
        <div className="settings__waiting">
          <Spinner size="small" label="Reading the build" />
          <span>Reading the build…</span>
        </div>
      ) : running ? (
        <div className="build" role="status">
          <p className="build__line tabular">
            {total > 0 ? `Building… ${count(done)} of ${count(total)}` : 'Building…'}
          </p>
          <div
            className="build__bar"
            role="progressbar"
            aria-label="Directory build"
            aria-valuemin={0}
            aria-valuemax={total || undefined}
            aria-valuenow={total > 0 ? done : undefined}
          >
            <span className="build__fill" style={{ transform: `scaleX(${total > 0 ? done / total : 0})` }} />
          </div>
          <p className="settings__muted">The app keeps working with the current list.</p>
        </div>
      ) : waiting > 0 ? (
        <p className="build__line" role="status">
          Starting the build…
        </p>
      ) : (
        <p className="build__line tabular" role="status">
          {status.builtAt ? `Built ${builtWords(status.builtAt)} · ${count(total)} listings` : 'Not built yet'}
        </p>
      )}

      {asking && rebuild ? (
        <ConfirmAction
          title="Rebuild the directory?"
          body="Takes about 30–60 min. The app keeps working with the current list."
          confirmLabel="Rebuild"
          busyLabel="Starting…"
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            await rebuild();
            setAsking(false);
            setWaiting(START_READS);
          }}
        />
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ listings check

/** The Directory against the listing checker's index: counts, and the three lists folded. Runs on arrival. */
function ListingsCheck({ onRun, onOpenLink }: { readonly onRun: () => Promise<IndexCheck>; readonly onOpenLink?: ((url: string) => void) | undefined }) {
  const [result, setResult] = useState<IndexCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The checker is switched off or out of reach: nothing is wrong here, so one quiet line. */
  const [quiet, setQuiet] = useState<string | null>(null);
  const runRef = useRef(onRun);
  runRef.current = onRun;

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setQuiet(null);
    try {
      setResult(await runRef.current());
    } catch (err) {
      if (err instanceof BackendError && (err.code === 'checker-off' || err.code === 'checker-unavailable')) {
        setResult(null);
        setQuiet(err.message);
      } else {
        setError(sentence(err));
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <Card
      title="Listings check"
      actions={
        <Button size="small" busy={busy} onClick={() => void run()}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      }
    >
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      {result ? (
        <div className="check">
          <dl className="check__counts">
            <div>
              <dt>Directory</dt>
              <dd className="tabular">{count(result.directoryCount)}</dd>
            </div>
            <div>
              <dt>Checker</dt>
              <dd className="tabular">{count(result.checkerCount)}</dd>
            </div>
          </dl>
          <p className="check__why">
            Sold listings are left out of the directory on purpose. Listings added after the last build show as only in checker.
          </p>
          <CheckGroup label="Only in Directory" items={result.directoryOnly} onOpenLink={onOpenLink} />
          <CheckGroup label="Only in checker" items={result.checkerOnly} onOpenLink={onOpenLink} />
          <CheckGroup label="Sold" items={result.sold} onOpenLink={onOpenLink} />
          {result.checkedAt ? <p className="check__when">Checked {result.checkedAt}</p> : null}
        </div>
      ) : quiet ? (
        <p className="settings__muted" role="status">
          {quiet}
        </p>
      ) : busy ? (
        <div className="settings__waiting">
          <Spinner size="small" label="Checking the listings" />
          <span>Comparing the Directory with the checker…</span>
        </div>
      ) : null}
    </Card>
  );
}

function CheckGroup({
  label,
  items,
  onOpenLink,
}: {
  readonly label: string;
  readonly items: readonly { readonly id: string; readonly name: string; readonly path?: string }[];
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.name} ${i.path ?? ''}`.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const paged = usePaged(shown, PAGE_SIZE, query.trim().toLowerCase());

  if (items.length === 0) {
    return (
      <p className="check__row check__row--none">
        <span className="check__chev check__chev--none" aria-hidden="true" />
        <span>{label}</span>
        <span className="tabular">0</span>
      </p>
    );
  }
  return (
    <details className="check__group">
      <summary className="check__row">
        <span className="check__chev" aria-hidden="true" />
        <span>{label}</span>
        <span className="tabular">{count(items.length)}</span>
      </summary>
      <div className="check__body">
        <SearchBox label={`Search ${label.toLowerCase()}`} placeholder="Search" value={query} onValueChange={setQuery} aria-controls={listId} />
        {shown.length === 0 ? (
          <p className="settings__muted check__none">No match for &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <ul className="check__list" id={listId} aria-label={label} ref={paged.topRef}>
            {paged.items.map((item) => (
              <li key={item.id || item.name} className="check__item">
                <span className="check__text">
                  {item.name}
                  {item.path ? <span className="check__sub">{item.path}</span> : null}
                </span>
                {onOpenLink && item.id ? (
                  <Button variant="link" onClick={() => onOpenLink(driveFolder(item.id))} aria-label={`Open ${item.name} in Drive`}>
                    Open in Drive
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Pagination {...paged.pagination} compact label={`${label}, pages`} />
      </div>
    </details>
  );
}
