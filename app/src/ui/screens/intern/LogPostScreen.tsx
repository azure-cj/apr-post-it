import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BackendError } from '@/core/backend';
import { cooldown, lastPostedOn } from '@/core/cooldown';
import type { Property, PropertyDetail } from '@/core/types';
import { Button, Card, CategoryDot, Icon, Notice, Pill, TextInput, categoryKind, categoryLabel } from '../../components';
import {
  paths,
  sectionOf,
  sentenceOf,
  useApp,
  useDirectoryList,
  useNotify,
  usePosts,
  useUser,
} from '../../state';
import { folderLine, isFacebookLink, longDate } from './format';
import { BackLink, Waiting } from './shared';
import './LogPostScreen.css';

interface FieldErrors {
  fbAccount?: string | undefined;
  postLink?: string | undefined;
}

type Outcome =
  | { readonly kind: 'cooldown'; readonly message: string; readonly nextAllowed: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Log a post: which FB account it went out on, and its link. Everything else
 * on the row (date, time, type, title, who) is filled in, and the server
 * decides the cooldown under a lock, so its refusal is final and is shown as
 * it said it.
 */
export function LogPostScreen() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const app = useApp();
  const user = useUser();
  const notify = useNotify();
  const section = sectionOf(location.state);
  const posts = usePosts();

  // The name and category: from the list, or the listing as last opened.
  useDirectoryList();
  const listed = app.directory.get(id);
  const [opened, setOpened] = useState<PropertyDetail | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const { openProperty } = app;
  useEffect(() => {
    if (listed) return undefined;
    let current = true;
    openProperty(id).then(
      (detail) => current && setOpened(detail),
      (err: unknown) => current && setOpenError(sentenceOf(err)),
    );
    return () => {
      current = false;
    };
  }, [listed, openProperty, id]);
  const property: Property | null = listed ?? opened;

  useEffect(() => {
    document.title = `Log a post${property ? `: ${property.name}` : ''} · APG Post-It`;
  }, [property]);

  // ---- the two things typed by hand -------------------------------------------

  const accounts = user.fbAccounts;
  // The account you used last, which is usually the one you are using now.
  const lastUsed = useMemo(() => {
    const mine = (posts.data ?? []).filter((p) => p.postedBy === user.name && p.fbAccount.trim());
    return mine.at(-1)?.fbAccount.trim() ?? '';
  }, [posts.data, user.name]);

  const [fbAccount, setFbAccount] = useState<string | null>(null);
  const account = fbAccount ?? (accounts.length > 0 ? (accounts.includes(lastUsed) ? lastUsed : accounts[0]!) : lastUsed);
  const [postLink, setPostLink] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const accountRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  // Arrive in the field to paste into: the account is already chosen. Once,
  // as soon as the form is there.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !property) return;
    arrived.current = true;
    (accounts.length === 0 && !account ? accountRef : linkRef).current?.focus();
  }, [property, accounts.length, account]);

  const link = postLink.trim();
  const status = link ? 'Posted' : 'Pending';

  // What this screen can see of the cooldown: a warning, not a refusal. The
  // server decides, with everyone's posts and under a lock.
  const known = property && posts.data ? cooldown(lastPostedOn(posts.data, property), app.today(), app.settings) : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !property) return;
    const chosen = account.trim();
    const problems: FieldErrors = {};
    if (!chosen) problems.fbAccount = 'Type the FB account you posted from.';
    if (link && !isFacebookLink(link)) {
      problems.postLink = "That isn't a Facebook link. Copy the link from the date under the post on Facebook.";
    }
    setErrors(problems);
    if (problems.fbAccount) return accountRef.current?.focus();
    if (problems.postLink) return linkRef.current?.focus();

    setBusy(true);
    setOutcome(null);
    try {
      const row = await app.tracker.logPost({
        propertyId: property.id,
        propertyName: property.name,
        fbAccount: chosen,
        postLink: link,
        type: categoryLabel(property.category),
      });
      notify(
        row.status === 'Pending'
          ? `Logged as pending. Add the live link from My queue once the group approves it.`
          : `Logged. ${property.name}, posted from ${chosen}.`,
      );
      navigate(section === 'queue' ? paths.queue : paths.find);
    } catch (err) {
      if (err instanceof BackendError && err.code === 'cooldown') {
        // The server's own sentence: it holds the lock and the dates.
        setOutcome({ kind: 'cooldown', message: err.message, nextAllowed: err.nextAllowed });
      } else if (err instanceof BackendError && err.code === 'forbidden' && accounts.length === 0) {
        setErrors({ fbAccount: err.message });
        accountRef.current?.focus();
      } else {
        setOutcome({ kind: 'error', message: sentenceOf(err) });
      }
      setBusy(false);
    }
  };

  if (!property) {
    return (
      <div className="page log-post">
        <BackLink to={paths.property(id)} state={location.state}>
          The listing
        </BackLink>
        <header className="page-header">
          <h1 className="page-header__title" tabIndex={-1}>
            Log a post
          </h1>
        </header>
        {openError ? (
          <Notice tone="danger" live title="This listing didn't open">
            {openError}
          </Notice>
        ) : (
          <Waiting>Opening the listing…</Waiting>
        )}
      </div>
    );
  }

  return (
    <div className="page log-post">
      <BackLink to={paths.property(id)} state={location.state}>
        {property.name}
      </BackLink>
      <header className="page-header log-post__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Log a post
        </h1>
        <p className="meta-row">
          <span className="log-post__folder">
            <CategoryDot kind={categoryKind(property.category)} />
            {property.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>{folderLine(property)}</span>
        </p>
      </header>

      <div className="two-pane">
        <div className="two-pane__main">
          {outcome?.kind === 'cooldown' ? (
            <Notice tone="danger" live title="Not saved: it's still in its cooldown" className="log-post__outcome">
              <p>{outcome.message}</p>
              {outcome.nextAllowed ? (
                <p className="log-post__next">
                  Next allowed: <strong>{longDate(outcome.nextAllowed)}</strong>
                </p>
              ) : null}
            </Notice>
          ) : outcome?.kind === 'error' ? (
            <Notice tone="danger" live title="Not saved" className="log-post__outcome">
              {outcome.message}
            </Notice>
          ) : known?.blocked && known.nextAllowed ? (
            <Notice tone="warn" title="This looks like it's in its cooldown">
              {known.message} Saving will be refused.
            </Notice>
          ) : null}

          <Card padding="regular">
            <form className="log-post__form" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy || undefined}>
              {accounts.length > 0 ? (
                <fieldset className="choices">
                  <legend className="field__label">FB account</legend>
                  <div className="choices__list">
                    {accounts.map((name) => (
                      <label key={name} className="choice">
                        <input
                          type="radio"
                          name="fb-account"
                          className="choice__input"
                          value={name}
                          checked={account === name}
                          disabled={busy}
                          onChange={() => setFbAccount(name)}
                        />
                        <span className="choice__face">
                          <Icon name="check" size={16} className="choice__tick" />
                          {name}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="field__hint">The accounts on your row of the team. The server accepts no others.</p>
                </fieldset>
              ) : (
                <TextInput
                  ref={accountRef}
                  label="FB account"
                  value={account}
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={busy}
                  error={errors.fbAccount}
                  hint="The Facebook account or page you posted from, as the tracker names it."
                  onChange={(event) => {
                    setFbAccount(event.target.value);
                    if (errors.fbAccount) setErrors((e) => ({ ...e, fbAccount: undefined }));
                  }}
                />
              )}

              <TextInput
                ref={linkRef}
                label="Post link"
                type="url"
                inputMode="url"
                placeholder="https://www.facebook.com/groups/…/posts/…"
                autoComplete="off"
                spellCheck={false}
                value={postLink}
                readOnly={busy}
                error={errors.postLink}
                hint="Copy it from the date under the post on Facebook. Still waiting for the group to approve it? Leave this empty: it's logged as pending, and you add the link from My queue."
                onChange={(event) => {
                  setPostLink(event.target.value);
                  if (errors.postLink) setErrors((e) => ({ ...e, postLink: undefined }));
                }}
              />

              <div className="log-post__actions">
                <Button type="submit" variant="primary" busy={busy}>
                  {busy ? 'Saving…' : status === 'Posted' ? 'Save' : 'Save as pending'}
                </Button>
                <p className="meta">Saved to the tracker under your name.</p>
              </div>
            </form>
          </Card>
        </div>

        <aside className="two-pane__side" aria-label="The row that is written">
          <Card title="Written for you" description="The rest of the tracker row. Nothing here is typed." headingLevel={2} padding="tight">
            <dl className="row-preview">
              <div>
                <dt>Date</dt>
                <dd>{longDate(app.today())}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>When you save</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{categoryLabel(property.category)}</dd>
              </div>
              <div>
                <dt>Title</dt>
                <dd>{property.name}</dd>
              </div>
              <div>
                <dt>Posted by</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {status === 'Posted' ? (
                    <Pill tone="ok" dot>
                      Posted
                    </Pill>
                  ) : (
                    <Pill tone="warn" dot>
                      Pending
                    </Pill>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
