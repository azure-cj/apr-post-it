import { forwardRef, useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackendError } from '@/core/backend';
import { postLinkProblem } from '@/core/links';
import { normalize } from '@/core/matcher';
import { canManage, type Assignment, type PostStatus, type Property } from '@/core/types';
import { Button, Notice, TextInput } from '../../components';
import {
  paths,
  sentenceOf,
  useApp,
  useAssignments,
  useDirectoryList,
  useNotify,
  usePosts,
  useUser,
  type FromList,
  type NavKey,
} from '../../state';
import { longDate } from './format';
import './LogStep.css';

const FROM_QUEUE: FromList = { section: 'queue' };

type Outcome =
  | { readonly kind: 'cooldown'; readonly message: string; readonly nextAllowed: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * After posting: the FB account, the post's link, and whether it is live or
 * waiting for the group admin. Both status buttons wait for a valid link.
 * Saved, it opens the next listing in the queue.
 */
export const LogStep = forwardRef<HTMLInputElement, {
  readonly property: Pick<Property, 'id' | 'name' | 'category'> | null;
  /** Logging is off (a sold listing): the sentence is shown elsewhere. */
  readonly blocked: boolean;
  /** This step holds the screen's one gold button (once the text is copied). */
  readonly primary: boolean;
  readonly section: NavKey;
}>(function LogStep({ property, blocked, primary, section }, linkRef) {
  const app = useApp();
  const user = useUser();
  const notify = useNotify();
  const navigate = useNavigate();
  const posts = usePosts();
  const queue = useAssignments();
  const list = useDirectoryList();
  const titleId = useId();
  const selectId = useId();

  const accounts = user.fbAccounts;
  // The account you used last is usually the one you are using now.
  const lastUsed = useMemo(() => {
    const mine = (posts.data ?? []).filter((p) => p.postedBy === user.name && p.fbAccount.trim());
    return mine.at(-1)?.fbAccount.trim() ?? '';
  }, [posts.data, user.name]);

  const [typedAccount, setTypedAccount] = useState<string | null>(null);
  const account = typedAccount ?? (accounts.length > 0 ? (accounts.includes(lastUsed) ? lastUsed : accounts[0]!) : lastUsed);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [postLink, setPostLink] = useState('');
  const [saving, setSaving] = useState<PostStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const link = postLink.trim();
  const linkProblem = link ? postLinkProblem(link) : null;
  const ready = !blocked && property !== null && link !== '' && linkProblem === null;

  /** The next listing to post in today's queue, other than this one. */
  const nextUp = (): { id: string } | null => {
    if (!property || canManage(user)) return null;
    const today = app.today();
    const here = normalize(property.name);
    const byName = new Map((list ?? []).map((p) => [normalize(p.name), p]));
    const isThis = (a: Assignment) =>
      a.propertyId && property.id ? a.propertyId === property.id : normalize(a.propertyName) === here;
    for (const a of queue.data ?? []) {
      if (a.date !== today || a.assignedTo !== user.name || a.status !== 'Not Shared' || isThis(a)) continue;
      const id = a.propertyId || byName.get(normalize(a.propertyName))?.id;
      if (id) return { id };
    }
    return null;
  };

  const save = async (status: PostStatus) => {
    if (!ready || !property || saving) return;
    const chosen = account.trim();
    if (!chosen) {
      setAccountError('Type the FB account you posted from.');
      return;
    }
    const next = nextUp();
    setSaving(status);
    setOutcome(null);
    try {
      await app.tracker.logPost({
        propertyId: property.id,
        propertyName: property.name,
        fbAccount: chosen,
        postLink: link,
        status,
        // A fallback: the server takes the Property type from the Directory.
        type: property.category,
      });
      notify(status === 'Posted' ? `Saved as posted: ${property.name}.` : `Saved as pending: ${property.name}.`);
      if (next) navigate(paths.property(next.id), { state: FROM_QUEUE });
      else navigate(section === 'queue' || !canManage(user) ? paths.queue : paths.find);
    } catch (err) {
      if (err instanceof BackendError && err.code === 'cooldown') {
        // The server's own sentence: it holds the lock and the dates.
        setOutcome({ kind: 'cooldown', message: err.message, nextAllowed: err.nextAllowed });
      } else if (err instanceof BackendError && err.code === 'forbidden' && accounts.length === 0) {
        setAccountError(err.message);
      } else {
        setOutcome({ kind: 'error', message: sentenceOf(err) });
      }
      setSaving(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save('Posted');
  };

  return (
    <section className="log-step" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Log the post
      </h2>

      {outcome?.kind === 'cooldown' ? (
        <Notice tone="danger" live title="Not saved: still in its cooldown">
          <p>{outcome.message}</p>
          {outcome.nextAllowed ? (
            <p className="log-step__next">
              Next allowed: <strong>{longDate(outcome.nextAllowed)}</strong>
            </p>
          ) : null}
        </Notice>
      ) : outcome?.kind === 'error' ? (
        <Notice tone="danger" live title="Not saved">
          {outcome.message}
        </Notice>
      ) : null}

      <form className="log-step__form" onSubmit={submit} noValidate aria-busy={saving !== null || undefined}>
        <fieldset className="log-step__fields" disabled={blocked || property === null}>
          {accounts.length > 0 ? (
            <div className="field">
              <label className="field__label" htmlFor={selectId}>
                FB account
              </label>
              <div className="field__control log-step__select">
                <select
                  id={selectId}
                  className="field__input"
                  value={account}
                  onChange={(event) => setTypedAccount(event.target.value)}
                >
                  {accounts.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="m6 9.5 6 6 6-6" />
                </svg>
              </div>
            </div>
          ) : (
            <TextInput
              label="FB account"
              value={account}
              autoComplete="off"
              spellCheck={false}
              readOnly={saving !== null}
              error={accountError ?? undefined}
              onChange={(event) => {
                setTypedAccount(event.target.value);
                if (accountError) setAccountError(null);
              }}
            />
          )}

          <TextInput
            ref={linkRef}
            label="Post link"
            type="url"
            inputMode="url"
            placeholder="https://www.facebook.com/…"
            autoComplete="off"
            spellCheck={false}
            value={postLink}
            readOnly={saving !== null}
            error={linkProblem ?? undefined}
            hint={linkProblem ? undefined : 'Copy it from the post’s date on Facebook.'}
            aria-keyshortcuts="Alt+L"
            onChange={(event) => setPostLink(event.target.value)}
          />
        </fieldset>

        <div className="log-step__actions">
          <Button type="submit" variant={primary ? 'primary' : 'ghost'} disabled={!ready} busy={saving === 'Posted'}>
            {saving === 'Posted' ? 'Saving…' : 'Posted'}
          </Button>
          <Button disabled={!ready} busy={saving === 'Pending'} onClick={() => void save('Pending')}>
            {saving === 'Pending' ? 'Saving…' : 'Pending approval'}
          </Button>
        </div>
      </form>
    </section>
  );
});
