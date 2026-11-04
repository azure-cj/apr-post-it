import { useEffect } from 'react';
import { waitedFor, waitingPosts } from '@/core/summary';
import { useApp, usePosts } from './state';

/** Where this PC keeps the last day it reminded someone, so it reminds them once a day. */
export const REMINDED_KEY = 'pendingReminded';

/** How often the posts are read again for the reminder while the app is open. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Pending reminders (PI-88): a Windows notification, once a day, when one of
 * your posts has waited for the group admin's approval for the days set in
 * Settings (0: never). It says how many, and the oldest. Draws nothing.
 */
export function PendingNotifier({ who }: { readonly who: string }) {
  const app = useApp();
  const posts = usePosts({ maxAgeMs: 15 * 60 * 1000, pollMs: CHECK_EVERY_MS });
  const after = app.settings.pendingReminderDays;
  const today = app.today();
  const { platform } = app;

  useEffect(() => {
    if (after <= 0 || !posts.data) return;
    const old = waitingPosts(posts.data, who, today).filter((w) => w.days >= after);
    const oldest = old[0];
    if (!oldest) return;
    const stamp = `${today}|${who}`;
    let live = true;
    void (async () => {
      const last = await platform.readLocal(REMINDED_KEY).catch(() => null);
      if (!live || last === stamp) return;
      await platform.writeLocal(REMINDED_KEY, stamp).catch(() => {});
      const title = old.length === 1 ? '1 post still waiting for approval' : `${old.length} posts still waiting for approval`;
      await platform.notify(title, `Oldest: ${oldest.post.title}, waiting ${waitedFor(oldest.days)}. Check them in My queue.`);
    })();
    return () => {
      live = false;
    };
  }, [posts.data, who, today, after, platform]);

  return null;
}
