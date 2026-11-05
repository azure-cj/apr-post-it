import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Role } from '@/core/types';
import { Button, Card, Notice, TextInput } from '../components';
import { Segmented } from './manager/Segmented';
import './SignInScreen.css';
import { roleWord } from '@/core/types';

export interface SignInScreenProps {
  /** Called with the trimmed link and key once both are filled in, and the role chosen. */
  readonly onSubmit: (url: string, key: string, role: Role) => void;
  /**
   * Cancel was pressed: stop the sign-in that is running, if any, and forget
   * the error. The screen clears its own fields.
   */
  readonly onCancel?: (() => void) | undefined;
  /** Waiting for the server to say who the key belongs to. */
  readonly busy: boolean;
  /** Why the last attempt failed, as a sentence. Null or empty when it didn't. */
  readonly error?: string | null | undefined;
  /** The link from last time, so only the key needs pasting. */
  readonly initialUrl?: string | undefined;
  /**
   * The link built into this version of the app (src/config.ts). When set,
   * only the key is asked for and this link is the one sent.
   */
  readonly builtInUrl?: string | undefined;
  /** Intern or Admin: what the person says they are. The server still decides. Default Intern. */
  readonly role?: Role | undefined;
  /** The person picked the other role. Without it the screen keeps the choice itself. */
  readonly onRoleChange?: ((role: Role) => void) | undefined;
}

const ROLES: readonly Role[] = ['Intern', 'Admin'];

const WHERE_FROM: Record<Role, string> = {
  Intern: 'Ask your admin.',
  Admin: 'Your admin key comes from ADD_PERSON in Apps Script (first time only), or Settings → Team.',
};

/**
 * Sign in with your own key, and the web app link when this version has none
 * built in. The role picked here only states intent: the server, not the app,
 * says who you are, and a key for the other role doesn't sign in.
 */
export function SignInScreen({
  onSubmit,
  onCancel,
  busy,
  error,
  initialUrl = '',
  builtInUrl = '',
  role: roleProp,
  onRoleChange,
}: SignInScreenProps) {
  const builtIn = builtInUrl.trim();
  const [url, setUrl] = useState(initialUrl);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [missing, setMissing] = useState({ url: false, key: false });
  const [ownRole, setOwnRole] = useState<Role>(roleProp ?? 'Intern');
  const role = roleProp ?? ownRole;
  const urlRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  // Start where the typing starts: the link, or the key if the link is known.
  // Only on arrival, so a later initialUrl doesn't move focus.
  const arrivedWithUrl = useRef(builtIn !== '' || initialUrl !== '');
  useEffect(() => {
    (arrivedWithUrl.current ? keyRef : urlRef).current?.focus();
  }, []);

  const pickRole = (next: Role) => {
    setOwnRole(next);
    onRoleChange?.(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const cleanUrl = builtIn || url.trim();
    const cleanKey = key.trim();
    const next = { url: cleanUrl === '', key: cleanKey === '' };
    setMissing(next);
    if (next.url) {
      urlRef.current?.focus();
      return;
    }
    if (next.key) {
      keyRef.current?.focus();
      return;
    }
    onSubmit(cleanUrl, cleanKey, role);
  };

  // Something to stop or clear. With nothing, Cancel stays where it is but can't be pressed.
  const canCancel = busy || (!builtIn && url !== '') || key !== '' || Boolean(error) || missing.url || missing.key;
  const cancel = () => {
    onCancel?.();
    setUrl('');
    setKey('');
    setShowKey(false);
    setMissing({ url: false, key: false });
    (builtIn ? keyRef : urlRef).current?.focus();
  };

  return (
    <div className="sign-in">
      <Card className="sign-in__card">
        <h1 className="sign-in__title" tabIndex={-1}>
          Sign in
        </h1>

        <form className="sign-in__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          <Segmented label="Sign in as" options={ROLES} labelOf={roleWord} value={role} onChange={pickRole} disabled={busy} />

          {builtIn ? null : (
            <TextInput
              ref={urlRef}
              label="Web app link"
              type="url"
              inputMode="url"
              placeholder="https://script.google.com/macros/s/…/exec"
              autoComplete="off"
              spellCheck={false}
              value={url}
              readOnly={busy}
              error={missing.url ? 'Paste the web app link.' : undefined}
              onChange={(event) => {
                setUrl(event.target.value);
                if (missing.url) setMissing((m) => ({ ...m, url: false }));
              }}
            />
          )}

          <TextInput
            ref={keyRef}
            label="Your key"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={key}
            readOnly={busy}
            error={missing.key ? 'Paste your key.' : undefined}
            hint="Your key is your identity. Don't share it."
            end={
              <Button
                variant="quiet"
                size="small"
                onClick={() => setShowKey((shown) => !shown)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? 'Hide' : 'Show'}
              </Button>
            }
            onChange={(event) => {
              setKey(event.target.value);
              if (missing.key) setMissing((m) => ({ ...m, key: false }));
            }}
          />

          <div className="sign-in__actions">
            <Button onClick={cancel} disabled={!canCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>

          {error ? (
            <Notice tone="danger" live className="sign-in__error">
              {error}
            </Notice>
          ) : null}
        </form>

        <details className="sign-in__where">
          <summary>Where do I get a key?</summary>
          <p>{WHERE_FROM[role]}</p>
        </details>
      </Card>
    </div>
  );
}
