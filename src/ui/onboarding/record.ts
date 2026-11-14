import type { Platform } from '@/platform';
import type { TaskId, TourId } from './tours';

/**
 * What one person has seen and done, on this PC: kept by name, so two people
 * sharing a PC each get their own tour and list. Nothing goes to the server.
 */
export interface OnboardingRecord {
  /** A tour finished ('done') or closed early ('skipped'). */
  readonly tours: Partial<Record<TourId, 'done' | 'skipped'>>;
  readonly tasks: Partial<Record<TaskId, true>>;
  /** Tours no longer start by themselves: the person closed the welcome tour. Help still starts them. */
  readonly autoOff: boolean;
  /** The getting-started list, put away. */
  readonly listHidden: boolean;
}

export const EMPTY_RECORD: OnboardingRecord = { tours: {}, tasks: {}, autoOff: false, listHidden: false };

export function recordKey(name: string): string {
  return `onboarding:${name.trim().toLowerCase()}`;
}

/** The person's record, or null when they have none yet (never signed in here since tours came). */
export async function readRecord(platform: Pick<Platform, 'readLocal'>, name: string): Promise<OnboardingRecord | null> {
  const text = await platform.readLocal(recordKey(name)).catch(() => null);
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Partial<OnboardingRecord> | null;
    if (!raw || typeof raw !== 'object') return { ...EMPTY_RECORD };
    return {
      tours: raw.tours && typeof raw.tours === 'object' ? raw.tours : {},
      tasks: raw.tasks && typeof raw.tasks === 'object' ? raw.tasks : {},
      autoOff: raw.autoOff === true,
      listHidden: raw.listHidden === true,
    };
  } catch {
    return { ...EMPTY_RECORD };
  }
}

export function writeRecord(platform: Pick<Platform, 'writeLocal'>, name: string, record: OnboardingRecord): Promise<void> {
  return platform.writeLocal(recordKey(name), JSON.stringify(record)).catch(() => {});
}

export function withTour(record: OnboardingRecord, id: TourId, how: 'done' | 'skipped'): OnboardingRecord {
  const tasks = id.startsWith('welcome') && how === 'done' ? { ...record.tasks, tour: true as const } : record.tasks;
  // Closing the welcome tour says "let me be": no more tours by themselves.
  const autoOff = record.autoOff || (id.startsWith('welcome') && how === 'skipped');
  return { ...record, tours: { ...record.tours, [id]: how }, tasks, autoOff };
}

export function withTask(record: OnboardingRecord, id: TaskId): OnboardingRecord {
  return record.tasks[id] ? record : { ...record, tasks: { ...record.tasks, [id]: true } };
}
