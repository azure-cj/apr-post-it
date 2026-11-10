import { useEffect, useId, useRef, useState, type ClipboardEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BackendError } from '@/core/backend';
import { runChecks } from '@/core/checks';
import { cooldown, lastPostedOn } from '@/core/cooldown';
import { normalize } from '@/core/matcher';
import { copyTextFor, flaggedLinesOf, linesOf, STANDARD_SEPARATOR } from '@/core/posting-text';
import {
  canManage,
  type CheckResult,
  type CooldownState,
  type Photo,
  type PostLogEntry,
  type Property,
  type PropertyDetail,
} from '@/core/types';
import { Button, Card, CategoryDot, CheckList, Icon, Notice, Pill, categoryKind, categoryLabel } from '../../components';
import {
  manilaTime,
  paths,
  sectionOf,
  sentenceOf,
  useApp,
  useDirectoryList,
  useNotify,
  usePosts,
  useSavedFolder,
  useUser,
  type NavKey,
} from '../../state';
import {
  count,
  dayMonth,
  daysAgo,
  daysBetween,
  firstName,
  folderName,
  folderOf,
  friendlyFolder,
  longDate,
  shortDate,
} from './format';
import { LogStep } from './LogStep';
import { PhotoPicker, Thumb } from './PhotoPicker';
import { PhotoViewer } from './PhotoViewer';
import { BackLink, Key, Waiting } from './shared';
import './PropertyScreen.css';

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly detail: PropertyDetail }
  | { readonly status: 'failed'; readonly error: string; readonly gone: boolean };

const backLabels: Record<NavKey, string> = {
  queue: 'My queue',
  find: 'Results',
  tracker: 'Tracker',
  assign: 'Assign',
  interns: 'Agents',
  records: 'Records',
  settings: 'Settings',
};

const backPaths: Record<NavKey, string> = {
  queue: paths.queue,
  find: paths.find,
  tracker: paths.tracker,
  assign: paths.assign,
  interns: paths.interns,
  records: paths.records,
  settings: paths.settings,
};

/** Alt+key shortcuts, by KeyboardEvent.code so they hold whatever the keyboard layout. */
const SHORTCUTS = { copy: 'KeyC', photos: 'KeyP', log: 'KeyL' } as const;

/**
 * One listing, the whole job on one screen: its public text with Copy, the
 * pre-post checks (any failure blocks Copy), the photos, the cooldown, and
 * the log step under the text. Keyed by the listing, so opening the next one
 * starts clean.
 */
export function PropertyScreen() {
  const { id = '' } = useParams();
  return <PropertyPage key={id} id={id} />;
}

function PropertyPage({ id }: { readonly id: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const app = useApp();
  const user = useUser();
  const notify = useNotify();
  const manager = canManage(user);
  const section = sectionOf(location.state);

  useDirectoryList(); // re-render when the list arrives, for the name below
  const summary = app.directory.get(id);

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { openProperty } = app;
  useEffect(() => {
    let current = true;
    setLoad({ status: 'loading' });
    openProperty(id).then(
      (detail) => {
        if (current) setLoad({ status: 'ready', detail });
      },
      (err: unknown) => {
        if (current) {
          setLoad({ status: 'failed', error: sentenceOf(err), gone: err instanceof BackendError && err.code === 'notfound' });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [openProperty, id, attempt]);

  const posts = usePosts();
  const detail = load.status === 'ready' ? load.detail : null;
  const name = detail?.name ?? summary?.name ?? '';
  const known: Property | undefined = detail ?? summary;

  useEffect(() => {
    document.title = `${name || 'Property'} · APG Post-It`;
  }, [name]);

  // ---- what may be copied ----------------------------------------------------

  // Sold, by the listing checker: neither copied nor logged.
  const sold = isSold(detail) || isSold(summary);

  // A document nobody has separated is shown, to be checked before posting
  // (D15): to an intern only when the server says `unseparated`, to an admin
  // whenever it has text. Its flagged lines are marked and never copied, and
  // the checks run on what would be copied.
  const unseparated = detail !== null && isUnseparated(detail, manager);
  const flagged = unseparated ? flaggedLinesOf(detail) : NONE;
  const copyText = detail === null ? '' : unseparated ? copyTextFor(detail) : detail.publicText;

  // Otherwise an intern is never sent the text of a document nobody has
  // separated (D13): a folder with no document, or an older server. The server
  // says so with its `withheld` flag; when a reply has no flag, it is judged
  // here from `hasInternal`. Either way forViewer has already emptied the text.
  const withheld = detail !== null && !manager && !unseparated && isWithheld(detail);
  const noDocument = withheld && /\bno document\b/i.test(detail.issues);
  const checks: readonly CheckResult[] =
    detail && !withheld ? runChecks(unseparated ? { publicText: copyText, hasInternal: false, unseparated: true } : detail) : [];
  // A commission word the flags missed, on the line it is on, so it can be shown.
  const hitLine = unseparated ? commissionLine(detail.publicText, checks, flagged) : null;

  // "I checked it": once per listing, since the page is keyed by it.
  const [checked, setChecked] = useState(false);

  const mine = posts.data && name ? postsOf(posts.data, { id, name }) : [];
  const cool: CooldownState | null = posts.data && name ? cooldown(lastPostedOn(posts.data, { id, name }), app.today(), app.settings) : null;

  const gate = copyGate({
    detail,
    copyText,
    sold,
    withheld,
    noDocument,
    unseparated,
    checked,
    hitLine,
    checks,
    cool,
    manager,
    checkingCooldown: posts.data === null && posts.loading,
  });
  const canCopy = gate.kind === 'ready';

  // ---- actions ---------------------------------------------------------------

  const [copying, setCopying] = useState(false);
  const [copiedAt, setCopiedAt] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyRef = useRef<HTMLButtonElement>(null);

  const copy = async () => {
    if (!detail || !canCopy || copying) return;
    setCopying(true);
    setCopyError(null);
    try {
      // The public text and nothing else: never the internal section, never a flagged line.
      await app.platform.copyText(copyText);
      setCopiedAt(manilaTime(app.now()));
      notify('Copied. Paste it into Facebook.');
    } catch (err) {
      setCopyError(sentenceOf(err));
    } finally {
      setCopying(false);
    }
  };

  // An admin fixing a document with no separator: the marker to paste where its public text ends (AID-176).
  const copySeparator = async () => {
    try {
      await app.platform.copyText(STANDARD_SEPARATOR);
      notify('Separator copied. Paste it on its own line where the public text ends.');
    } catch (err) {
      notify(sentenceOf(err), 'danger');
    }
  };

  const [savedFolder, rememberFolder] = useSavedFolder(id);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photosRef = useRef<HTMLButtonElement>(null);
  const photos = detail?.photos ?? [];
  const [viewing, setViewing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);

  const download = async (chosen: readonly Photo[]) => {
    setPicking(false);
    if (!detail || saving || chosen.length === 0) return;
    setSaving(true);
    setPhotoError(null);
    try {
      const saved = await app.platform.savePhotos(detail.name, chosen);
      const first = saved[0];
      const folder = first ? folderOf(first.path) : null;
      if (folder) rememberFolder(folder);
      const where = folder ? ` to ${friendlyFolder(folder)}` : '';
      const missing = chosen.length - saved.length;
      if (missing > 0) {
        notify(`${saved.length} of ${count(chosen.length, 'photo', 'photos')} saved${where}. ${count(missing, 'photo', 'photos')} could not be downloaded.`, 'warn');
      } else {
        notify(`${count(saved.length, 'photo', 'photos')} saved${where}.`);
      }
    } catch (err) {
      setPhotoError(sentenceOf(err));
    } finally {
      setSaving(false);
    }
  };

  const openFolder = async () => {
    if (!savedFolder) return;
    setPhotoError(null);
    try {
      await app.platform.open(savedFolder);
    } catch (err) {
      setPhotoError(sentenceOf(err));
    }
  };

  const openInDrive = async () => {
    if (!detail?.folder) return;
    try {
      await app.platform.open(detail.folder);
    } catch (err) {
      notify(sentenceOf(err), 'danger');
    }
  };

  const linkRef = useRef<HTMLInputElement>(null);

  // Alt+C copies, Alt+P opens the photo picker (Enter there downloads them all), Alt+L goes to the post link:
  // the day's path without the mouse. Through the controls, so a blocked one stays blocked.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.code === SHORTCUTS.copy) copyRef.current?.click();
      else if (event.code === SHORTCUTS.photos) photosRef.current?.click();
      else if (event.code === SHORTCUTS.log) linkRef.current?.focus();
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const reasonId = useId();
  const checkId = useId();
  const textTitleId = useId();
  const photosTitleId = useId();

  // ---- the screen --------------------------------------------------------------

  if (load.status === 'failed') {
    return (
      <div className="page property">
        <BackLink to={backPaths[section]}>{backLabels[section]}</BackLink>
        <header className="page-header property__header">
          <h1 className="page-header__title" tabIndex={-1}>
            {name || 'This listing'}
          </h1>
        </header>
        <Notice
          tone="danger"
          live
          title={load.gone ? 'This listing is gone' : "This listing didn't open"}
          action={
            load.gone ? (
              <Button size="small" onClick={() => void app.refreshDirectory().then(() => navigate(paths.find))}>
                Refresh the list
              </Button>
            ) : (
              <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            )
          }
        >
          {load.error}
        </Notice>
      </div>
    );
  }

  const wholeDocument = detail !== null && !detail.hasInternal && manager && !unseparated;
  // The directory's "No separator line" is what the notice on the text already says.
  const issues = detail ? detail.issues.split(/\s+·\s+/).filter((i) => i.trim() !== '' && !(unseparated && /no separator/i.test(i))) : [];

  return (
    <div className="page property">
      <BackLink to={backPaths[section]}>{backLabels[section]}</BackLink>

      <header className="page-header property__header">
        <h1 className="page-header__title" tabIndex={-1}>
          {name || 'Opening…'}
        </h1>
        {known ? <Facts property={known} checker={summary} /> : null}
      </header>

      {sold ? (
        <Notice tone="danger" title="Sold" className="property__sold">
          Don’t post or log this listing.
        </Notice>
      ) : null}

      <div className="two-pane">
        <div className="two-pane__main">
          {/* ---- the public text: the one bounded box ---- */}
          <section className={`post-text${canCopy ? ' post-text--ready' : ''}`} aria-labelledby={textTitleId}>
            <div className="post-text__head">
              <div className="post-text__heading">
                <h2 id={textTitleId} className="section-title">
                  {wholeDocument ? 'Whole document' : 'Posting text'}
                </h2>
                {wholeDocument ? <p className="meta">Not separated: may hold owner and commission details.</p> : null}
              </div>
              <Button
                ref={copyRef}
                variant={copiedAt ? 'ghost' : 'primary'}
                className="post-text__copy"
                disabled={!canCopy}
                busy={copying}
                aria-describedby={unseparated ? `${reasonId} ${checkId}` : reasonId}
                aria-keyshortcuts="Alt+C"
                onClick={() => void copy()}
              >
                {copying ? 'Copying…' : 'Copy'}
              </Button>
            </div>

            <div id={reasonId} className="post-text__status" role="status">
              {gate.kind === 'confirm' ? (
                <p className="post-text__confirm">
                  <Icon name="warn" size={18} />
                  <span>{gate.text}</span>
                </p>
              ) : gate.kind === 'waiting' ? (
                <Waiting>{gate.text}</Waiting>
              ) : gate.kind === 'blocked' ? (
                <p className="post-text__blocked">
                  <Icon name="fail" size={18} />
                  <span>{gate.text}</span>
                </p>
              ) : copiedAt ? (
                <p className="post-text__done">
                  <Icon name="pass" size={18} />
                  <span>Copied at {copiedAt}. Paste it into Facebook.</span>
                </p>
              ) : (
                <p className="post-text__ok">
                  <Icon name="pass" size={18} />
                  <span>{unseparated ? 'Ready to copy. Marked lines stay out.' : 'Ready to copy. Every check passed.'}</span>
                </p>
              )}
            </div>

            {copyError ? (
              <Notice tone="danger" live>
                {copyError}
              </Notice>
            ) : null}

            {unseparated ? (
              <Notice
                tone="warn"
                id={checkId}
                className="post-text__check-notice"
                title="No separator. Check before posting."
                action={
                  <label className="post-text__check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={gate.kind === 'blocked' && !checked}
                      onChange={(event) => setChecked(event.target.checked)}
                    />
                    I checked it
                  </label>
                }
              >
                Lines that may hold owner or commission details are marked and won’t be copied.
                {manager ? (
                  <>
                    {' Add a separator to fix it: '}
                    <Button variant="link" onClick={() => void copySeparator()}>
                      Copy separator
                    </Button>
                    , then paste it on its own line in the document, where the public text ends.
                  </>
                ) : null}
              </Notice>
            ) : null}

            <PostText
              detail={detail}
              withheld={withheld}
              noDocument={noDocument}
              blocked={gate.kind === 'blocked'}
              copyable={canCopy}
              unseparated={unseparated}
              flagged={flagged}
              hitLine={hitLine?.index ?? null}
            />
          </section>

          {detail?.hasInternal && detail.internalText !== undefined ? <InternalSection detail={detail} /> : null}

          {/* ---- after posting ---- */}
          <LogStep
            ref={linkRef}
            property={known ?? null}
            blocked={sold}
            primary={copiedAt !== null}
            section={section}
          />

          <p className="keys meta">
            <Key>Alt</Key>+<Key>C</Key> copy · <Key>Alt</Key>+<Key>P</Key> save photos · <Key>Alt</Key>+<Key>L</Key> post link
          </p>
        </div>

        <aside className="two-pane__side" aria-label="Before you post">
          <Verdict gate={gate} cool={cool} manager={manager} />

          {/* ---- photos ---- */}
          <section className="photos" aria-labelledby={photosTitleId}>
            <div className="photos__head">
              <h2 id={photosTitleId} className="section-title">
                Photos{photos.length > 0 ? <span className="photos__count tabular"> {photos.length}</span> : null}
              </h2>
              <div className="photos__actions">
                {app.platform.hasFileSystem ? (
                  <Button
                    ref={photosRef}
                    size="small"
                    busy={saving}
                    disabled={detail === null || photos.length === 0}
                    aria-keyshortcuts="Alt+P"
                    onClick={() => setPicking(true)}
                  >
                    {saving ? 'Downloading…' : savedFolder ? 'Download again' : 'Download photos'}
                  </Button>
                ) : null}
                {savedFolder ? (
                  <Button size="small" onClick={() => void openFolder()}>
                    Open folder
                  </Button>
                ) : null}
                {manager && detail?.folder ? (
                  <Button size="small" variant="quiet" onClick={() => void openInDrive()}>
                    Open in Drive
                  </Button>
                ) : null}
              </div>
            </div>
            {savedFolder ? <p className="meta">Saved to {friendlyFolder(savedFolder)}</p> : null}
            {!app.platform.hasFileSystem && detail !== null && photos.length > 0 ? (
              <p className="meta">Saving photos works in the desktop app only.</p>
            ) : null}
            {photoError ? (
              <Notice tone="danger" live>
                {photoError}
              </Notice>
            ) : null}
            {detail === null ? (
              <Waiting>Reading the folder…</Waiting>
            ) : photos.length === 0 ? (
              <p className="meta">No photos in the folder.</p>
            ) : (
              <ul className="photos__grid">
                {photos.map((photo, i) => (
                  <li key={photo.id} className="photos__item">
                    <button type="button" className="photos__open" aria-label={`Photo ${i + 1} of ${photos.length}, view large`} onClick={() => setViewing(i)}>
                      <Thumb photo={photo} label={`Photo ${i + 1}`} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Card title="Pre-post checks" headingLevel={2} padding="tight">
            {detail === null ? (
              <Waiting>Waiting for the document…</Waiting>
            ) : withheld ? (
              <p className="meta">Run once the document is separated.</p>
            ) : (
              <CheckList checks={checks} label="Pre-post checks" />
            )}
          </Card>

          <Card title="Cooldown" headingLevel={2} padding="tight">
            <CooldownLines
              posts={posts.data}
              loading={posts.loading}
              error={posts.error}
              cool={cool}
              history={mine}
              manager={manager}
              today={app.today()}
              cooldownDays={app.settings.cooldownDays}
              onRetry={posts.reload}
            />
          </Card>

          {issues.length > 0 && !withheld ? (
            <Notice tone="warn" title="Flagged by the directory">
              <ul className="issues">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </aside>
      </div>

      {viewing !== null ? (
        <PhotoViewer photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      ) : null}
      {picking && detail ? (
        <PhotoPicker
          property={detail.name}
          photos={photos}
          onDownload={(chosen) => void download(chosen)}
          onClose={() => setPicking(false)}
          onCopy={(photo, label) => app.platform.copyPhoto(photo.url, label)}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the header

/** "Sold" from the listing checker, whatever its case. */
function isSold(p: Property | null | undefined): boolean {
  return p?.availability === 'Sold';
}

/**
 * Category, city, size, sale or lease: what the listing is, at a glance. Each
 * only when known. The checker's fields come with the detail; the list's row
 * stands in while it loads, or for a server that does not send them yet.
 */
function Facts({ property, checker }: { readonly property: Property; readonly checker: Property | undefined }) {
  const size = (property.size ?? checker?.size ?? '').trim();
  const deal = (property.dealType ?? checker?.dealType ?? '').trim() || property.listingType;
  const facts = [
    (property.city ?? checker?.city ?? '').trim(),
    size && /^[\d.,\s]+$/.test(size) ? `${size} sqm` : size,
    folderName(deal),
  ].filter((f) => f !== '');
  return (
    <p className="meta-row property__facts">
      <span className="property__category">
        <CategoryDot kind={categoryKind(property.category)} />
        {categoryLabel(property.category)}
      </span>
      {facts.map((fact) => (
        <span key={fact} className="property__fact">
          {fact}
        </span>
      ))}
    </p>
  );
}

// ------------------------------------------------------------------ pieces

/** Whether Copy may be used now, and if not, the sentence that says why. */
type CopyGate =
  | { readonly kind: 'ready' }
  | { readonly kind: 'waiting'; readonly text: string }
  /** Nothing blocks, but nobody has separated the document: it waits for "I checked it" (D15). */
  | { readonly kind: 'confirm'; readonly text: string }
  | { readonly kind: 'blocked'; readonly cause: 'sold' | 'no-document' | 'withheld' | 'check' | 'empty' | 'cooldown'; readonly text: string };

/**
 * Every failed check blocks Copy; so do a sold listing, a withheld or missing
 * document, an empty text, and a cooldown this screen can see. It waits, too, until it
 * knows when the listing was last posted.
 */
function copyGate(input: {
  detail: PropertyDetail | null;
  /** What Copy would copy: the public text, less any flagged lines. */
  copyText: string;
  sold: boolean;
  withheld: boolean;
  noDocument: boolean;
  unseparated: boolean;
  checked: boolean;
  hitLine: CommissionLine | null;
  checks: readonly CheckResult[];
  cool: CooldownState | null;
  manager: boolean;
  checkingCooldown: boolean;
}): CopyGate {
  const { detail, withheld, noDocument, checks, cool, manager } = input;
  if (input.sold) return { kind: 'blocked', cause: 'sold', text: 'Copy is blocked: this listing is sold.' };
  if (!detail) return { kind: 'waiting', text: 'Reading the document…' };
  if (noDocument) {
    return { kind: 'blocked', cause: 'no-document', text: 'Copy is blocked: this listing has no posting document yet.' };
  }
  if (withheld) {
    return { kind: 'blocked', cause: 'withheld', text: 'Copy is blocked: nobody has separated this document yet.' };
  }
  const failed = checks.filter((c) => c.status === 'fail');
  const first = failed[0];
  if (first) {
    const more = failed.length > 1 ? ` ${failed.length - 1} more ${failed.length === 2 ? 'check' : 'checks'} failed too.` : '';
    return { kind: 'blocked', cause: 'check', text: `Copy is blocked: ${failReason(first, manager, input.hitLine)}${more}` };
  }
  if (!input.copyText.trim()) {
    const why = input.unseparated
      ? 'every line is marked, so nothing is left to copy.'
      : detail.hasInternal
        ? 'there is no public text above the separator.'
        : 'the document is empty.';
    return { kind: 'blocked', cause: 'empty', text: `Copy is blocked: ${why}` };
  }
  if (cool?.blocked && cool.nextAllowed) {
    return { kind: 'blocked', cause: 'cooldown', text: `Copy is blocked: it is in its cooldown until ${longDate(cool.nextAllowed)}.` };
  }
  if (input.unseparated && !input.checked) return { kind: 'confirm', text: 'Tick “I checked it” to copy.' };
  if (input.checkingCooldown) return { kind: 'waiting', text: 'Checking when it was last posted…' };
  return { kind: 'ready' };
}

/**
 * Withheld when the server says so OR no separator was found. Either is enough:
 * a server flag of false never unlocks text nobody has separated. Asked only
 * of a document that is not shown to be checked (isUnseparated).
 */
function isWithheld(detail: PropertyDetail): boolean {
  return detail.withheld === true || !detail.hasInternal;
}

/**
 * Shown whole, to be checked (D15): nobody has separated it and it has text.
 * An intern only on a v7 server's word (`unseparated`, not `withheld`), so an
 * older server's reply is still withheld; an admin is sent it whole either way.
 */
function isUnseparated(detail: PropertyDetail, manager: boolean): boolean {
  if (detail.hasInternal || !detail.publicText.trim()) return false;
  return manager || (detail.unseparated === true && detail.withheld !== true);
}

const NONE: ReadonlySet<number> = new Set();

/** A commission word left in the copy, and the line of the text it is on. */
interface CommissionLine {
  /** 0-based, in the text as shown. */
  readonly index: number;
  readonly quoted: string;
}

function commissionLine(text: string, checks: readonly CheckResult[], flagged: ReadonlySet<number>): CommissionLine | null {
  const check = checks.find((c) => c.name === 'No commission wording' && c.status === 'fail');
  const quoted = check ? /"([^"]+)"/.exec(check.detail)?.[1] : undefined;
  if (!quoted) return null;
  const index = linesOf(text).findIndex((line, i) => !flagged.has(i) && line.includes(quoted));
  return index === -1 ? null : { index, quoted };
}

function failReason(check: CheckResult, manager: boolean, hit: CommissionLine | null = null): string {
  if (check.name === 'No commission wording') {
    const quoted = /"([^"]+)"/.exec(check.detail)?.[1];
    const what = quoted ? `“${quoted}”` : 'commission wording';
    if (hit) {
      return manager
        ? `line ${hit.index + 1} mentions “${hit.quoted}”. Move it below a separator in the document.`
        : `line ${hit.index + 1} mentions “${hit.quoted}”. Ask your admin to remove it from the document.`;
    }
    return manager
      ? `the public text mentions ${what}. Move it below the separator in the document.`
      : `the public text mentions ${what}. Ask your admin to remove it from the document.`;
  }
  if (check.name === 'Internal section hidden') {
    return "the document has no separator yet. Add one above the owner's details.";
  }
  return `${check.name.toLowerCase()}: ${check.detail}.`;
}

function PostText({
  detail,
  withheld,
  noDocument,
  blocked,
  copyable,
  unseparated,
  flagged,
  hitLine,
}: {
  readonly detail: PropertyDetail | null;
  readonly withheld: boolean;
  readonly noDocument: boolean;
  /** Something stops Copy outright: the text is shown as blocked. */
  readonly blocked: boolean;
  /** Copy may be used now. Until then, copying by hand is refused too. */
  readonly copyable: boolean;
  readonly unseparated: boolean;
  readonly flagged: ReadonlySet<number>;
  /** A line with commission wording on it, marked as what blocks. */
  readonly hitLine: number | null;
}) {
  if (detail === null) {
    return (
      <div className="post-text__body post-text__body--loading" aria-hidden="true">
        <span className="post-text__line" />
        <span className="post-text__line" />
        <span className="post-text__line post-text__line--short" />
      </div>
    );
  }

  if (withheld) {
    // None of the text: not hidden, absent (D13).
    return noDocument ? (
      <Notice tone="warn" title="There's no posting document yet" className="post-text__withheld">
        Tell your admin.
      </Notice>
    ) : (
      <Notice tone="danger" title="There's nothing safe to show yet" className="post-text__withheld">
        An admin has to add a separator above the owner's details. Tell your admin.
      </Notice>
    );
  }

  if (!detail.publicText.trim()) {
    return (
      <p className="post-text__empty meta">
        {detail.hasInternal ? 'The document has nothing above its separator.' : 'The document is empty.'}
      </p>
    );
  }

  // Text that may not be copied yet can't be copied by hand either: the safe action is the only one offered.
  const refuse = (event: ClipboardEvent) => {
    if (!copyable) event.preventDefault();
  };
  const state = blocked ? ' post-text__body--blocked' : unseparated && !copyable ? ' post-text__body--check' : '';
  return (
    <>
      <div
        className={`post-text__body${state}`}
        onCopy={refuse}
        onCut={refuse}
        tabIndex={0}
        role="document"
        aria-label={blocked ? 'Public text, blocked from copying' : unseparated ? 'Whole document, marked lines not copied' : 'Public text'}
      >
        {unseparated
          ? linesOf(detail.publicText).map((line, i) =>
              flagged.has(i) ? (
                <span key={i} className="post-text__row post-text__row--flag" data-note="Not copied">
                  <span className="post-text__sr">Not copied: </span>
                  {line}
                </span>
              ) : (
                <span key={i} className={`post-text__row${i === hitLine ? ' post-text__row--hit' : ''}`}>
                  {i === hitLine ? <span className="post-text__sr">Blocks Copy: </span> : null}
                  {line}
                </span>
              ),
            )
          : detail.publicText}
      </div>
      {detail.live ? null : <p className="meta post-text__source">From the directory’s last rebuild: the document didn’t open.</p>}
    </>
  );
}

/**
 * The part that is never posted, folded away under a warning, and where the cut
 * was made. Everyone may read it (D1); nobody can select or copy it.
 */
function InternalSection({ detail }: { readonly detail: PropertyDetail }) {
  return (
    <details className="internal" onCopy={(e) => e.preventDefault()}>
      <summary className="internal__summary">
        <Icon name="warn" className="internal__icon" />
        <span className="internal__label">
          <span className="internal__title">Internal section: never posted, never copied</span>
          <span className="meta">For you to read. Never in a post or a copy.</span>
        </span>
        <span className="internal__toggle" aria-hidden="true">
          <span className="internal__show">Show</span>
          <span className="internal__hide">Hide</span>
        </span>
      </summary>
      <div className="internal__body">
        <p className="meta">
          Cut at <span className="internal__cut">{detail.cutAt || 'no marker'}</span>
        </p>
        <div className="internal__text">{detail.internalText ?? ''}</div>
      </div>
    </details>
  );
}

/** The big answer, first thing in the side pane: may this listing be posted now? */
function Verdict({
  gate,
  cool,
  manager,
}: {
  readonly gate: CopyGate;
  readonly cool: CooldownState | null;
  readonly manager: boolean;
}) {
  const [tone, word, line] = ((): readonly ['ok' | 'warn' | 'danger' | 'neutral', string, string] => {
    if (gate.kind === 'ready') return ['ok', 'Ready to post', 'Copy, post, then log the link.'];
    if (gate.kind === 'waiting') return ['neutral', 'Checking…', gate.text];
    if (gate.kind === 'confirm') return ['warn', 'Check before posting', 'The document has no separator.'];
    switch (gate.cause) {
      case 'sold':
        return ['danger', 'Sold', 'Not to be posted.'];
      case 'no-document':
        return ['danger', 'No document', 'Nothing to post from yet.'];
      case 'withheld':
        return ['danger', 'Not separated', 'An admin must add a separator first.'];
      case 'cooldown':
        return ['danger', 'In cooldown', cool?.nextAllowed ? `Next allowed ${longDate(cool.nextAllowed)}.` : 'Posted too recently.'];
      case 'empty':
        return ['danger', 'Nothing to post', 'The document has no public text.'];
      case 'check':
        return ['danger', 'Copy is blocked', manager ? 'Fix the document. See the failed check.' : 'Ask your admin to fix the document.'];
    }
  })();
  return (
    <div className={`verdict verdict--${tone}`}>
      <p className="verdict__word">{word}</p>
      <p className="verdict__line">{line}</p>
    </div>
  );
}

function CooldownLines({
  posts,
  loading,
  error,
  cool,
  history,
  manager,
  today,
  cooldownDays,
  onRetry,
}: {
  readonly posts: readonly PostLogEntry[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly cool: CooldownState | null;
  readonly history: readonly PostLogEntry[];
  readonly manager: boolean;
  readonly today: string;
  readonly cooldownDays: number;
  readonly onRetry: () => void;
}) {
  if (posts === null) {
    if (loading) return <Waiting>Checking when it was last posted…</Waiting>;
    return (
      <Notice
        tone="warn"
        action={
          <Button size="small" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {error ?? 'The posts did not load.'} The server still checks when you log.
      </Notice>
    );
  }

  const last = cool?.lastPosted;
  return (
    <div className="cooldown">
      {cool?.blocked ? (
        <Notice tone="danger" title="In cooldown">
          {cool.message}
        </Notice>
      ) : last ? (
        <p className="cooldown__line">
          <Icon name="pass" size={18} className="cooldown__ok" />
          <span>
            Last posted {dayMonth(last)}, {daysAgo(daysBetween(last, today))}. Outside the {cooldownDays}-day cooldown.
          </span>
        </p>
      ) : (
        <p className="cooldown__line">
          <Icon name="pass" size={18} className="cooldown__ok" />
          <span>{manager ? 'Never posted.' : "You haven't posted it before."}</span>
        </p>
      )}

      {history.length > 0 ? (
        <ul className="cooldown__history" aria-label={manager ? 'Posts of this listing' : 'Your posts of this listing'}>
          {history.slice(0, 4).map((p, i) => (
            <li key={`${p.date}-${p.time}-${i}`} className="cooldown__post">
              <span className="tabular">{shortDate(p.date)}</span>
              <span className="cooldown__who">
                {manager ? `${firstName(p.postedBy)} · ` : ''}
                {p.fbAccount || 'No account'}
              </span>
              {p.status === 'Pending' ? <Pill tone="warn">Pending</Pill> : <Pill tone="ok">Posted</Pill>}
            </li>
          ))}
        </ul>
      ) : null}

      {!manager ? <p className="meta">Your posts only. The server checks everyone's.</p> : null}
    </div>
  );
}

/** This listing's posts, newest first: by folder id where both have one, else by name, as the cooldown matches them. */
function postsOf(posts: readonly PostLogEntry[], property: { readonly id: string; readonly name: string }): PostLogEntry[] {
  const key = normalize(property.name);
  return posts
    .map((post, index) => ({ post, index }))
    .filter(({ post }) =>
      property.id !== '' && post.propertyId !== '' ? post.propertyId === property.id : normalize(post.title) === key,
    )
    .sort((a, b) => b.post.date.localeCompare(a.post.date) || b.post.time.localeCompare(a.post.time) || b.index - a.index)
    .map(({ post }) => post);
}
