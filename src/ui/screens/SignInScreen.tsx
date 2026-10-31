import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card, Notice, TextInput } from '../components';
import './SignInScreen.css';

export interface SignInScreenProps {
  /** Called with the trimmed link and key once both are filled in. */
  readonly onSubmit: (url: string, key: string) => void;
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
}

/**
 * Sign in with the web app link and your own key. The server, not the app,
 * says who you are and what you may do.
 */
export function SignInScreen({ onSubmit, onCancel, busy, error, initialUrl = '' }: SignInScreenProps) {
  const [url, setUrl] = useState(initialUrl);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [missing, setMissing] = useState({ url: false, key: false });
  const urlRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  // Start where the typing starts: the link, or the key if the link is known.
  // Only on arrival, so a later initialUrl doesn't move focus.
  const arrivedWithUrl = useRef(initialUrl !== '');
  useEffect(() => {
    (arrivedWithUrl.current ? keyRef : urlRef).current?.focus();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const cleanUrl = url.trim();
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
    onSubmit(cleanUrl, cleanKey);
  };

  // Something to stop or clear. With nothing, Cancel stays where it is but can't be pressed.
  const canCancel = busy || url !== '' || key !== '' || Boolean(error) || missing.url || missing.key;
  const cancel = () => {
    onCancel?.();
    setUrl('');
    setKey('');
    setShowKey(false);
    setMissing({ url: false, key: false });
    urlRef.current?.focus();
  };

  return (
    <div className="sign-in">
      <Card className="sign-in__card">
        <h1 className="sign-in__title" tabIndex={-1}>
          Sign in
        </h1>
        <p className="sign-in__intro">Paste the web app link and your own key. Your admin sends you both.</p>

        <form className="sign-in__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
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
            hint="Your key is your identity: every post you log is saved under your name. Don't share it."
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

        <p className="sign-in__footer">No key yet? Ask your admin to add you to the team.</p>
      </Card>
    </div>
  );
}
