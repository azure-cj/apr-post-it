import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card, Notice, TextInput } from '../components';
import './SignInScreen.css';

/** Said after a reset link is asked for, whether or not the email has an account. */
export const RESET_SENT = 'If that email has an account, a reset link is on its way. Check your inbox.';

/**
 * Sign in with your account: the same email and password as Alpha Listing
 * Hub. The account says who you are and your role; the screen asks nothing
 * else.
 *
 * The email last signed in with on this PC comes filled in, so only the
 * password is typed. "Forgot password?" sends a reset link to the email typed.
 */
export function AccountSignInScreen({
  onSubmit,
  busy,
  error,
  initialEmail,
  onForgotPassword,
}: {
  readonly onSubmit: (email: string, password: string) => void;
  readonly busy: boolean;
  readonly error?: string | null | undefined;
  /** The email last signed in with on this PC, filled in. */
  readonly initialEmail?: string | null | undefined;
  /** Sends a reset link. Resolves when sent; rejects with a sentence. Without it, no "Forgot password?". */
  readonly onForgotPassword?: ((email: string) => Promise<void>) | undefined;
}) {
  const remembered = initialEmail?.trim() ?? '';
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // What each field is missing, as its error sentence; null when nothing.
  const [missing, setMissing] = useState<{ email: string | null; password: string | null }>({ email: null, password: null });
  const [reset, setReset] = useState<{ busy: boolean; sent: boolean; error: string | null }>({
    busy: false,
    sent: false,
    error: null,
  });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // The email is already there: straight to the password.
    (remembered ? passwordRef : emailRef).current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const next = {
      email: email.trim() === '' ? 'Type your email.' : null,
      password: password === '' ? 'Type your password.' : null,
    };
    setMissing(next);
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();
    setReset((r) => ({ ...r, sent: false, error: null }));
    onSubmit(email.trim(), password);
  };

  const typeAnotherEmail = () => {
    setEmail('');
    setMissing((m) => ({ ...m, email: null }));
    emailRef.current?.focus();
  };

  const forgotPassword = async () => {
    if (!onForgotPassword || busy || reset.busy) return;
    if (email.trim() === '') {
      setMissing((m) => ({ ...m, email: 'Type your email first.' }));
      emailRef.current?.focus();
      return;
    }
    setReset({ busy: true, sent: false, error: null });
    try {
      await onForgotPassword(email.trim());
      if (mounted.current) setReset({ busy: false, sent: true, error: null });
    } catch (err) {
      const sentence = err instanceof Error && err.message ? err.message : "Couldn't send the link. Try again.";
      if (mounted.current) setReset({ busy: false, sent: false, error: sentence });
    }
  };

  return (
    <div className="sign-in">
      <Card className="sign-in__card">
        <h1 className="sign-in__title" tabIndex={-1}>
          Sign in
        </h1>
        <p className="sign-in__lead">Use your Alpha Listing Hub account. Your queue, listings and posts are waiting.</p>
        <form className="sign-in__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          <div className="sign-in__email">
            <TextInput
              ref={emailRef}
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              readOnly={busy}
              error={missing.email ?? undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                if (missing.email) setMissing((m) => ({ ...m, email: null }));
              }}
            />
            {remembered && email === remembered ? (
              <p className="sign-in__switch">
                Not you?{' '}
                <Button variant="link" onClick={typeAnotherEmail} disabled={busy}>
                  Use another email
                </Button>
              </p>
            ) : null}
          </div>
          <TextInput
            ref={passwordRef}
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            readOnly={busy}
            error={missing.password ?? undefined}
            end={
              <Button
                variant="quiet"
                size="small"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            }
            onChange={(event) => {
              setPassword(event.target.value);
              if (missing.password) setMissing((m) => ({ ...m, password: null }));
            }}
          />
          <div className="sign-in__actions">
            {onForgotPassword ? (
              <Button variant="link" className="sign-in__forgot" busy={reset.busy} disabled={busy} onClick={() => void forgotPassword()}>
                {reset.busy ? 'Sending link…' : 'Forgot password?'}
              </Button>
            ) : null}
            <Button type="submit" variant="primary" busy={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
          {reset.sent ? (
            <Notice tone="info" live className="sign-in__note">
              {RESET_SENT}
            </Notice>
          ) : null}
          {reset.error ? (
            <Notice tone="danger" live className="sign-in__error">
              {reset.error}
            </Notice>
          ) : null}
          {error ? (
            <Notice tone="danger" live className="sign-in__error">
              {error}
            </Notice>
          ) : null}
        </form>
        <details className="sign-in__where">
          <summary>No account?</summary>
          <p>Use your Alpha Listing Hub account. Ask an admin to make one.</p>
        </details>
      </Card>
    </div>
  );
}
