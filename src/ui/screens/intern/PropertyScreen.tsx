import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BackendError } from '@/core/backend';
import { runChecks } from '@/core/checks';
import { cooldown, lastPostedOn } from '@/core/cooldown';
import { normalize } from '@/core/matcher';
import { canManage, type CheckResult, type CooldownState, type PostLogEntry, type PropertyDetail } from '@/core/types';
import { Button, Card, CategoryDot, CheckList, Icon, Notice, Pill, categoryKind } from '../../components';
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
  folderLine,
  folderOf,
  friendlyFolder,
  longDate,
  shortDate,
} from './format';
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
  settings: 'Settings',
};

const backPaths: Record<NavKey, string> = {
  queue: paths.queue,
  find: paths.find,
  tracker: paths.tracker,
  assign: paths.assign,
  settings: paths.settings,
};

/** Alt+key shortcuts, by KeyboardEvent.code so they hold whatever the keyboard layout. */
const SHORTCUTS = { copy: 'KeyC', photos: 'KeyP', log: 'KeyL' } as const;

/**
 * One listing: its public text in a bounded box with the screen's one gold
 * button, Copy; the pre-post checks, any one of which blocks Copy; the
 * photos; and the cooldown. An intern never has the internal section here,
 * and a document nobody has separated shows none of its text.
 */
export function PropertyScreen() {
  const { id = '' } = useParams();
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

  useEffect(() => {
    document.title = `${name || 'Property'} · APG Post-It`;
  }, [name]);

  // ---- what may be copied ----------------------------------------------------

  // An intern is never sent the text of a document nobody has separated (D13).
  // The server says so with its `withheld` flag; when a reply has no flag, it
  // is judged here from `hasInternal`. Either way forViewer has already
  // emptied the text of an unseparated document, so nothing shows.
  const withheld = detail !== null && !manager && isWithheld(detail);
  const noDocument = withheld && /\bno document\b/i.test(detail.issues);
  const checks: readonly CheckResult[] = detail && !withheld ? runChecks(detail) : [];

  const mine = posts.data && name ? postsOf(posts.data, { id, name }) : [];
  const cool: CooldownState | null = posts.data && name ? cooldown(lastPostedOn(posts.data, { id, name }), app.today(), app.settings) : null;

  const gate = copyGate({ detail, withheld, noDocument, checks, cool, manager, checkingCooldown: posts.data === null && posts.loading });
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
      // The public text and nothing else: never the internal section.
      await app.platform.copyText(detail.publicText);
      setCopiedAt(manilaTime(app.now()));
      notify('Copied. Paste it into Facebook.');
    } catch (err) {
      setCopyError(sentenceOf(err));
    } finally {
      setCopying(false);
    }
  };

  const [savedFolder, rememberFolder] = useSavedFolder(id);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photosRef = useRef<HTMLButtonElement>(null);
  const photos = detail?.photos ?? [];

  const downloadAll = async () => {
    if (!detail || saving || photos.length === 0) return;
    setSaving(true);
    setPhotoError(null);
    try {
      const saved = await app.platform.savePhotos(detail.name, photos);
      const first = saved[0];
      const folder = first ? folderOf(first.path) : null;
      if (folder) rememberFolder(folder);
      const where = folder ? ` to ${friendlyFolder(folder)}` : '';
      const missing = photos.length - saved.length;
      if (missing > 0) {
        notify(`${saved.length} of ${count(photos.length, 'photo', 'photos')} saved${where}. ${count(missing, 'photo', 'photos')} could not be downloaded.`, 'warn');
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

  const logPost = useCallback(() => navigate(paths.logPost(id), { state: location.state }), [navigate, id, location.state]);
  const logRef = useRef<HTMLButtonElement>(null);

  // Alt+C copies, Alt+P downloads the photos, Alt+L logs the post: the day's
  // path without the mouse. Through the buttons, so a blocked one stays blocked.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target =
        event.code === SHORTCUTS.copy ? copyRef : event.code === SHORTCUTS.photos ? photosRef : event.code === SHORTCUTS.log ? logRef : null;
      if (!target) return;
      event.preventDefault();
      target.current?.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const reasonId = useId();
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

  const category = detail ?? summary;

  return (
    <div className="page property">
      <BackLink to={backPaths[section]}>{backLabels[section]}</BackLink>

      <header className="page-header property__header">
        <h1 className="page-header__title" tabIndex={-1}>
          {name || 'Opening the listing…'}
        </h1>
        {category ? (
          <p className="meta-row">
            <span className="property__folder">
              <CategoryDot kind={categoryKind(category.category)} />
              {folderLine(category)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{category.photoCount === 0 ? 'No photos' : count(category.photoCount, 'photo', 'photos')}</span>
          </p>
        ) : null}
      </header>

      <div className="two-pane">
        <div className="two-pane__main">
          {/* ---- the public text: the one bounded box, the one gold button ---- */}
          <section className={`post-text${canCopy ? ' post-text--ready' : ''}`} aria-labelledby={textTitleId}>
            <div className="post-text__head">
              <div className="post-text__heading">
                <h2 id={textTitleId} className="section-title">
                  {detail && !detail.hasInternal && manager ? 'Whole document' : 'Public text'}
                </h2>
                <p className="meta">
                  {detail && !detail.hasInternal && manager
                    ? 'Not separated: owner and commission details may be in here.'
                    : 'Only this part is ever copied.'}
                </p>
              </div>
              <Button
                ref={copyRef}
                variant="primary"
                className="post-text__copy"
                disabled={!canCopy}
                busy={copying}
                aria-describedby={reasonId}
                aria-keyshortcuts="Alt+C"
                onClick={() => void copy()}
              >
                {copying ? 'Copying…' : 'Copy'}
              </Button>
            </div>

            <div id={reasonId} className="post-text__status" role="status">
              {gate.kind === 'waiting' ? (
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
                  <span>Ready to copy. Every check passed.</span>
                </p>
              )}
            </div>

            {copyError ? (
              <Notice tone="danger" live>
                {copyError}
              </Notice>
            ) : null}

            <PostText detail={detail} withheld={withheld} noDocument={noDocument} manager={manager} blocked={!canCopy} />
          </section>

          {manager && detail?.hasInternal ? <InternalSection detail={detail} /> : null}

          {/* ---- photos ---- */}
          <section className="photos" aria-labelledby={photosTitleId}>
            <div className="photos__head">
              <div className="post-text__heading">
                <h2 id={photosTitleId} className="section-title">
                  Photos
                </h2>
                <p className="meta">
                  {detail === null
                    ? 'Reading the folder…'
                    : photos.length === 0
                      ? 'None in the folder.'
                      : savedFolder
                        ? `Saved to ${friendlyFolder(savedFolder)}`
                        : `${count(photos.length, 'photo', 'photos')} in the folder. Saved to Downloads\\APG Post-It.`}
                </p>
              </div>
              <div className="photos__actions">
                {app.platform.hasFileSystem ? (
                  <Button
                    ref={photosRef}
                    busy={saving}
                    disabled={detail === null || photos.length === 0}
                    aria-keyshortcuts="Alt+P"
                    onClick={() => void downloadAll()}
                  >
                    {saving ? `Downloading ${count(photos.length, 'photo', 'photos')}…` : savedFolder ? 'Download again' : 'Download all'}
                  </Button>
                ) : null}
                {savedFolder ? <Button onClick={() => void openFolder()}>Open folder</Button> : null}
                {manager && detail?.folder ? (
                  <Button variant="quiet" onClick={() => void openInDrive()}>
                    Open in Drive
                  </Button>
                ) : null}
              </div>
            </div>
            {!app.platform.hasFileSystem && detail !== null && photos.length > 0 ? (
              <Notice tone="info">Saving photos works in the desktop app, not in a browser.</Notice>
            ) : null}
            {photoError ? (
              <Notice tone="danger" live>
                {photoError}
              </Notice>
            ) : null}
            {photos.length > 0 ? (
              <ul className="photos__grid">
                {photos.map((photo, i) => (
                  <li key={photo.id} className="photos__item">
                    <Thumb src={photo.thumb} alt={`Photo ${i + 1} of ${photos.length}`} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* ---- the next step ---- */}
          <section className="next-step" aria-label="After posting">
            <div>
              <p className="next-step__title">Posted it on Facebook?</p>
              <p className="meta">Log it with the FB account and the post link. The rest is filled in for you.</p>
            </div>
            <Button ref={logRef} aria-keyshortcuts="Alt+L" onClick={logPost}>
              Log this post
            </Button>
          </section>

          <p className="keys meta">
            <Key>Alt</Key>+<Key>C</Key> copies · <Key>Alt</Key>+<Key>P</Key> downloads the photos · <Key>Alt</Key>+<Key>L</Key> logs the post
          </p>
        </div>

        <aside className="two-pane__side" aria-label="Before you post">
          <Verdict gate={gate} cool={cool} manager={manager} />

          <Card title="Pre-post checks" headingLevel={2} padding="tight">
            {detail === null ? (
              <Waiting>Waiting for the document…</Waiting>
            ) : withheld ? (
              <p className="meta">The checks run once an admin has separated the document.</p>
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

          {detail && detail.issues.trim() && !withheld ? (
            <Notice tone="warn" title="Flagged by the directory">
              <ul className="issues">
                {detail.issues.split(/\s+·\s+/).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

/** Whether Copy may be used now, and if not, the sentence that says why. */
type CopyGate =
  | { readonly kind: 'ready' }
  | { readonly kind: 'waiting'; readonly text: string }
  | { readonly kind: 'blocked'; readonly cause: 'no-document' | 'withheld' | 'check' | 'empty' | 'cooldown'; readonly text: string };

/**
 * Every failed check blocks Copy; so do a withheld or missing document, an
 * empty text, and a cooldown this screen can see. It waits, too, until it
 * knows when the listing was last posted.
 */
function copyGate(input: {
  detail: PropertyDetail | null;
  withheld: boolean;
  noDocument: boolean;
  checks: readonly CheckResult[];
  cool: CooldownState | null;
  manager: boolean;
  checkingCooldown: boolean;
}): CopyGate {
  const { detail, withheld, noDocument, checks, cool, manager } = input;
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
    return { kind: 'blocked', cause: 'check', text: `Copy is blocked: ${failReason(first, manager)}${more}` };
  }
  if (!detail.publicText.trim()) {
    return { kind: 'blocked', cause: 'empty', text: 'Copy is blocked: there is no public text above the separator.' };
  }
  if (cool?.blocked && cool.nextAllowed) {
    return { kind: 'blocked', cause: 'cooldown', text: `Copy is blocked: it is in its cooldown until ${longDate(cool.nextAllowed)}.` };
  }
  if (input.checkingCooldown) return { kind: 'waiting', text: 'Checking when it was last posted…' };
  return { kind: 'ready' };
}

/**
 * Withheld when the server says so OR no separator was found. Either is enough:
 * a server flag of false never unlocks text nobody has separated.
 */
function isWithheld(detail: PropertyDetail): boolean {
  return detail.withheld === true || !detail.hasInternal;
}

function failReason(check: CheckResult, manager: boolean): string {
  if (check.name === 'No commission wording') {
    const quoted = /"([^"]+)"/.exec(check.detail)?.[1];
    const what = quoted ? `“${quoted}”` : 'commission wording';
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
  manager,
  blocked,
}: {
  readonly detail: PropertyDetail | null;
  readonly withheld: boolean;
  readonly noDocument: boolean;
  readonly manager: boolean;
  readonly blocked: boolean;
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
        This listing's folder has no document to post from, so there is nothing to copy. Tell your admin it's
        &ldquo;{detail.name}&rdquo;.
      </Notice>
    ) : (
      <Notice tone="danger" title="There's nothing safe to show yet" className="post-text__withheld">
        Nobody has separated this document. An admin has to add a separator above the owner's details before any of
        it can be shown or copied. Tell your admin it's &ldquo;{detail.name}&rdquo;.
      </Notice>
    );
  }

  if (!detail.publicText.trim()) {
    return <p className="post-text__empty meta">The document has nothing above its separator.</p>;
  }

  // Blocked text can't be selected or copied by hand either: the safe action is the only one offered.
  const refuse = (event: ClipboardEvent) => {
    if (blocked) event.preventDefault();
  };
  return (
    <>
      {!detail.hasInternal && manager ? (
        <Notice tone="danger" title="Nobody has separated this document yet">
          You see all of it because you're an admin; interns see none of it. Add a separator above the owner's details
          in the document, and Copy works once it's re-read.
        </Notice>
      ) : null}
      <div
        className={`post-text__body${blocked ? ' post-text__body--blocked' : ''}`}
        onCopy={refuse}
        onCut={refuse}
        tabIndex={0}
        role="document"
        aria-label={blocked ? 'Public text, blocked from copying' : 'Public text'}
      >
        {detail.publicText}
      </div>
      <p className="meta post-text__source">
        {detail.live
          ? 'Read from the document just now.'
          : "The document couldn't be read, so this is the directory's copy from its last rebuild."}
      </p>
    </>
  );
}

/** For a manager: the part that is never posted, folded away under a warning, and where the cut was made. */
function InternalSection({ detail }: { readonly detail: PropertyDetail }) {
  return (
    <details className="internal">
      <summary className="internal__summary">
        <Icon name="warn" className="internal__icon" />
        <span className="internal__label">
          <span className="internal__title">Internal section: never posted, never copied</span>
          <span className="meta">Owner details and commission. Shown to admins only.</span>
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
  const [tone, word, line] = ((): readonly ['ok' | 'danger' | 'neutral', string, string] => {
    if (gate.kind === 'ready') return ['ok', 'Ready to post', 'Copy the text, download the photos, then post it.'];
    if (gate.kind === 'waiting') return ['neutral', 'Checking…', gate.text];
    switch (gate.cause) {
      case 'no-document':
        return ['danger', 'No document', 'There is nothing to post from yet.'];
      case 'withheld':
        return ['danger', 'Not separated', 'Nothing can be copied until an admin adds a separator.'];
      case 'cooldown':
        return ['danger', 'In cooldown', cool?.nextAllowed ? `It can be posted again on ${longDate(cool.nextAllowed)}.` : 'It was posted too recently.'];
      case 'empty':
        return ['danger', 'Nothing to post', 'The document has no public text.'];
      case 'check':
        return [
          'danger',
          'Copy is blocked',
          manager
            ? 'The document needs fixing first. The failed check says what to change.'
            : 'Ask your admin to fix the document. The failed check says what is wrong.',
        ];
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
        {error ?? 'The posts did not load.'} The server checks the cooldown again when you log the post.
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

      {!manager ? (
        <p className="meta">You see your own posts only. When you log a post, the server checks everyone's.</p>
      ) : null}
    </div>
  );
}

/** A photo's thumbnail, or a plain tile when there is none or it won't load. */
function Thumb({ src, alt }: { readonly src: string; readonly alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="photos__tile" role="img" aria-label={alt}>
        {alt}
      </span>
    );
  }
  return <img className="photos__img" src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
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
