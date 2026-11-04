import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card, Notice, TextInput } from '../components';
import './SignInScreen.css';

/**
 * Sign in with your account: the same email and password as Alpha Listing
 * Hub. The account says who you are and your role; the screen asks nothing
 * else.
 */
export function AccountSignInScreen({
  onSubmit,
  busy,
  error,
}: {
  readonly onSubmit: (email: string, password: string) => void;
  readonly busy: boolean;
  readonly error?: string | null | undefined;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [missing, setMissing] = useState({ email: false, password: false });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const next = { email: email.trim() === '', password: password === '' };
    setMissing(next);
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();
    onSubmit(email.trim(), password);
  };

  return (
    <div className="sign-in">
      <Card className="sign-in__card">
        <h1 className="sign-in__title" tabIndex={-1}>
          Sign in
        </h1>
        <form className="sign-in__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
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
            error={missing.email ? 'Type your email.' : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              if (missing.email) setMissing((m) => ({ ...m, email: false }));
            }}
          />
          <TextInput
            ref={passwordRef}
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            readOnly={busy}
            error={missing.password ? 'Type your password.' : undefined}
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
              if (missing.password) setMissing((m) => ({ ...m, password: false }));
            }}
          />
          <div className="sign-in__actions">
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
          <summary>No account?</summary>
          <p>Use your Alpha Listing Hub account. Ask an admin to make one.</p>
        </details>
      </Card>
    </div>
  );
}
