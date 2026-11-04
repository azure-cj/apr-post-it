import { useState } from 'react';
import { Button, Notice } from './components';
import { useApp, useStore } from './state';
import './UpdateBanner.css';

/**
 * Posts kept on this PC (never lose a log): how many are waiting, with Retry
 * now, and any the web app then refused, with why, until dismissed. Only the
 * signed-in person's own.
 */
export function OutboxBanner({ who }: { readonly who: string }) {
  const app = useApp();
  const { kept, refused } = useStore(app.outbox.state);
  const [sending, setSending] = useState(false);
  const waiting = kept.filter((k) => k.who === who);
  const mine = refused.filter((r) => r.who === who);
  if (waiting.length === 0 && mine.length === 0) return null;

  const retry = async () => {
    setSending(true);
    try {
      await app.outbox.flush(who);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {waiting.length > 0 ? (
        <Notice
          tone="warn"
          live
          className="update-banner"
          title={waiting.length === 1 ? '1 post waiting to save' : `${waiting.length} posts waiting to save`}
          action={
            <Button size="small" busy={sending} onClick={() => void retry()}>
              {sending ? 'Sending…' : 'Retry now'}
            </Button>
          }
        >
          Kept on this PC. Saved when the connection is back.
        </Notice>
      ) : null}
      {mine.map((r) => (
        <Notice
          key={r.id}
          tone="danger"
          live
          className="update-banner"
          title={`Not saved: ${r.title}`}
          action={
            <Button size="small" variant="quiet" aria-label={`Dismiss: ${r.title}`} onClick={() => void app.outbox.dismiss(r.id)}>
              Dismiss
            </Button>
          }
        >
          {r.message}
        </Notice>
      ))}
    </>
  );
}
