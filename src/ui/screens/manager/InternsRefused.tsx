import { useState } from 'react';
import { Button, Notice } from '../../components';
import { isDate } from '@/core/dates';
import { clockTime } from '@/core/records';
import { openRefused, type ReportedPost } from '@/core/refused';
import { shortDate } from '@/core/summary';

export interface RefusedPostsProps {
  /** The Refused posts tab, every row; handled ones are left out here. */
  readonly refused: readonly ReportedPost[];
  /** Marks one handled. Rejects when it couldn't be saved: the caller says why. */
  readonly onHandle: (post: ReportedPost) => Promise<void>;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/** "Tue 10 Mar, 2:10 PM" from the server's ISO time on Manila's clock; the day alone, or as sent, otherwise. */
export function loggedWords(iso: string): string {
  const day = iso.slice(0, 10);
  if (!isDate(day)) return iso;
  const time = /^T(\d{2}:\d{2})/.exec(iso.slice(10))?.[1];
  return time ? `${shortDate(day)}, ${clockTime(time)}` : shortDate(day);
}

/** Who posted the listing before, and when the cooldown ended, in a sentence. */
function whyWords(post: ReportedPost): string {
  const when = isDate(post.lastPosted) ? ` on ${shortDate(post.lastPosted)}` : '';
  const by = post.lastPostedBy ? (post.lastPostedBy === post.agent ? 'They had posted it' : `${post.lastPostedBy} had posted it`) : 'It had been posted';
  const until = isDate(post.nextAllowed) ? `; it could be posted again from ${shortDate(post.nextAllowed)}` : '';
  return `${by}${when}${until}.`;
}

/**
 * Posts an agent made on Facebook that the tracker refused for the cooldown
 * when their PC sent them later (v18). Each to open and deal with on
 * Facebook, then mark handled. Nothing shows when none are waiting.
 */
export function RefusedPosts({ refused, onHandle, onOpenLink }: RefusedPostsProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const open = openRefused(refused);
  if (open.length === 0) return null;

  const handle = async (post: ReportedPost) => {
    setSaving(post.postKey);
    try {
      await onHandle(post);
    } catch {
      // Said by the caller; the button is free again.
    } finally {
      setSaving(null);
    }
  };

  return (
    <Notice
      tone="danger"
      className="interns__notice refused"
      title={open.length === 1 ? '1 post refused for the cooldown' : `${open.length} posts refused for the cooldown`}
    >
      <p className="refused__hint">
        On Facebook but not on the tracker: the agent's PC sent it after someone else had posted the listing. Open it, decide what to do
        on Facebook, then mark it handled.
      </p>
      <ul className="refused__list">
        {open.map((post) => (
          <li key={post.postKey} className="refused__item">
            <div className="refused__text">
              <strong>{post.agent || 'Someone'}</strong>: {post.property || 'a listing'}
              {post.loggedAt ? <span className="refused__when tabular">, logged {loggedWords(post.loggedAt)}</span> : null}. {whyWords(post)}
            </div>
            <div className="refused__actions">
              {onOpenLink ? (
                <Button variant="link" onClick={() => onOpenLink(post.link)} aria-label={`Open the post of ${post.property}`}>
                  Open
                </Button>
              ) : null}
              <Button
                size="small"
                busy={saving === post.postKey}
                disabled={saving !== null}
                onClick={() => void handle(post)}
                aria-label={`Mark handled: ${post.agent}'s post of ${post.property}`}
              >
                Handled
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
