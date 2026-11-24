import { useEffect, useState } from 'react';
import { currentQueue } from '@/core/queues';
import { postReminder } from '@/core/reminders';
import { queueProgress, samePerson, shortDate } from '@/core/summary';
import { useApp, useAssignments, usePosts } from './state';

/** Where this PC keeps the last day it reminded someone to post, so it reminds them once a day. */
export const POST_REMINDED_KEY = 'postReminded';

/** How often the queue is read again, and the clock looked at, while the app is open. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/** The hour now on the tracker's clock (Manila), 0 to 23. */
function manilaHour(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', hour12: false }).format(new Date(ms))) % 24;
}

/**
 * The reminder to post: a Windows notification, once a day, to someone whose
 * queue is running with listings left: from the hour set in Settings (off:
 * never), when they haven't posted today, or when the deadline is today or
 * the next working day. Only while the app is open. Draws nothing.
 */
export function PostReminder({ who }: { readonly who: string }) {
  const app = useApp();
  const assignments = useAssignments({ maxAgeMs: 15 * 60 * 1000, pollMs: CHECK_EVERY_MS });
  const posts = usePosts({ maxAgeMs: 15 * 60 * 1000, pollMs: CHECK_EVERY_MS });
  const fromHour = app.settings.postReminderHour;
  const today = app.today();
  const { platform } = app;

  // The hour passes while the app sits open: look at the clock again now and then.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (fromHour <= 0) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [fromHour]);

  useEffect(() => {
    if (fromHour <= 0 || !assignments.data || !posts.data) return undefined;
    const period = currentQueue(who, assignments.data, today);
    const progress = queueProgress(who, period, assignments.data, posts.data, today);
    const postedToday = posts.data.filter(
      (p) => p.date === today && (p.status === 'Posted' || p.status === 'Pending') && samePerson(p.postedBy, who),
    ).length;
    const say = postReminder({
      period,
      left: progress.notShared,
      postedToday,
      today,
      hour: manilaHour(app.now()),
      fromHour,
      dueWords: period ? shortDate(period.due) : '',
    });
    if (!say) return undefined;
    const stamp = `${today}|${who}`;
    let live = true;
    void (async () => {
      const last = await platform.readLocal(POST_REMINDED_KEY).catch(() => null);
      if (!live || last === stamp) return;
      await platform.writeLocal(POST_REMINDED_KEY, stamp).catch(() => {});
      await platform.notify(say.title, say.body);
    })();
    return () => {
      live = false;
    };
    // `app` is a new object whenever the settings change; its clock is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments.data, posts.data, who, today, fromHour, platform, tick]);

  return null;
}
