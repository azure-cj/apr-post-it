import { describe, expect, it } from 'vitest';
import { postReminder, postReminderHourOf, type PostReminderInput } from './reminders';

// A queue of two weeks: Mon 2 Nov to Fri 13 Nov 2026.
const PERIOD = { start: '2026-11-02', due: '2026-11-13' };
const at = (changes: Partial<PostReminderInput> = {}): PostReminderInput => ({
  period: PERIOD,
  left: 12,
  postedToday: 0,
  today: '2026-11-04',
  hour: 10,
  fromHour: 10,
  dueWords: 'Fri 13 Nov',
  ...changes,
});

describe('the reminder to post', () => {
  it('says nothing has been posted today, with what is left and the deadline', () => {
    expect(postReminder(at())).toEqual({
      title: "You haven't posted today",
      body: '12 listings left in your queue, due Fri 13 Nov. Open My queue for the next one.',
    });
    expect(postReminder(at({ left: 1 }))!.body).toContain('1 listing left');
  });

  it('waits for the hour set, and says nothing when it is off', () => {
    expect(postReminder(at({ hour: 9 }))).toBeNull();
    expect(postReminder(at({ hour: 16, fromHour: 15 }))).not.toBeNull();
    expect(postReminder(at({ fromHour: 0, hour: 23 }))).toBeNull();
  });

  it('says nothing once they have posted today, with nothing left, with no queue, or outside it', () => {
    expect(postReminder(at({ postedToday: 2 }))).toBeNull();
    expect(postReminder(at({ left: 0 }))).toBeNull();
    expect(postReminder(at({ period: undefined }))).toBeNull();
    // Before it starts, after its deadline, and at the weekend inside it.
    expect(postReminder(at({ today: '2026-10-30' }))).toBeNull();
    expect(postReminder(at({ today: '2026-11-16' }))).toBeNull();
    expect(postReminder(at({ today: '2026-11-07' }))).toBeNull();
  });

  it('says the deadline on its day and the working day before, even after a post that day', () => {
    expect(postReminder(at({ today: '2026-11-13', postedToday: 3 }))).toEqual({
      title: 'Your queue is due today',
      body: '12 listings left to post. Open My queue for the next one.',
    });
    expect(postReminder(at({ today: '2026-11-12', postedToday: 3 }))!.title).toBe('Your queue is due Fri 13 Nov');
    // Due on a Monday: the working day before is the Friday.
    expect(postReminder(at({ period: { start: '2026-11-03', due: '2026-11-09' }, today: '2026-11-06', postedToday: 1, dueWords: 'Mon 9 Nov' }))!.title).toBe(
      'Your queue is due Mon 9 Nov',
    );
  });

  it('keeps the hour to the ones offered', () => {
    expect([0, 10, 13, 15, 11, '10', undefined].map(postReminderHourOf)).toEqual([0, 10, 13, 15, 10, 10, 10]);
  });
});
