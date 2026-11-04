import { useState } from 'react';
import { waitedFor, type WaitingPost } from '@/core/summary';
import type { PostLogEntry } from '@/core/types';
import { Button, Card } from '../../components';
import { sentenceOf, useApp, useNotify } from '../../state';
import './WaitingPosts.css';

/**
 * Pending reminders (PI-87): your posts still waiting for the group admin's
 * approval that this week's queue doesn't already show, oldest first. Open
 * checks it on Facebook; Approved marks it posted, with the link it was logged
 * with. A Pending post holds its listing's cooldown, so a forgotten one costs.
 */
export function WaitingPosts({ waiting, onChanged }: { readonly waiting: readonly WaitingPost[]; readonly onChanged: () => void }) {
  if (waiting.length === 0) return null;
  return (
    <Card className="waiting" title={waiting.length === 1 ? '1 post waiting for approval' : `${waiting.length} posts waiting for approval`}>
      <ol className="waiting__list">
        {waiting.map(({ post, days }) => (
          <WaitingRow key={`${post.postLink}-${post.date}-${post.title}`} post={post} days={days} onChanged={onChanged} />
        ))}
      </ol>
    </Card>
  );
}

function WaitingRow({ post, days, onChanged }: { readonly post: PostLogEntry; readonly days: number; readonly onChanged: () => void }) {
  const app = useApp();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = post.postLink.trim();

  const approved = async () => {
    if (busy || !link) return;
    setBusy(true);
    setError(null);
    try {
      await app.tracker.addLink(post, link);
      notify(`Marked posted: ${post.title}.`);
      onChanged();
    } catch (err) {
      setError(sentenceOf(err));
      setBusy(false);
    }
  };

  return (
    <li className="waiting__row">
      <div className="waiting__what">
        <span className="waiting__title">{post.title}</span>
        <span className={days >= 2 ? 'waiting__age waiting__age--old' : 'waiting__age'}>Waiting {waitedFor(days)}</span>
        {error ? <span className="waiting__error">{error}</span> : null}
      </div>
      <div className="waiting__actions">
        {link ? (
          <Button size="small" variant="quiet" onClick={() => void app.platform.open(link)} aria-label={`Open the post of ${post.title}`}>
            Open
          </Button>
        ) : null}
        {link ? (
          <Button size="small" busy={busy} onClick={() => void approved()} aria-label={`Approved: ${post.title}`}>
            Approved
          </Button>
        ) : null}
      </div>
    </li>
  );
}
