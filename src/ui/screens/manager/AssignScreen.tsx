import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Button, Card, Icon, Notice, Spinner } from '../../components';
import { DEFAULT_PER_INTERN, planForIntern } from '@/core/planner';
import { normalize } from '@/core/matcher';
import {
  assignRules,
  firstName,
  heldBy,
  heldListings,
  keyOf,
  matchPasted,
  moveEntry,
  plural,
  samePerson,
  sameQueue,
  searchProperties,
  shortDate,
  type AssignRules,
  type DirectoryRow,
  type HeldListing,
  type QueueEntry,
  type Rules,
} from '@/core/summary';
import type { QueueItemInput } from '@/core/tracker';
import { UserFacingError, queueStatus, type Assignment, type PostLogEntry, type Property, type TeamMember } from '@/core/types';
import { Carried, type CarriedItem } from './AssignCarried';
import { LibraryPanel, QuickFill, tabLabel, type CategoryTab } from './AssignLibrary';
import { PastePanel, type Matched } from './AssignPaste';
import { AssignPicker, NoInterns } from './AssignPicker';
import { dayMonth, heldWords, listingState, type ListingState } from './assignListing';
import { DayPicker } from './DayPicker';
import { FillQueues, type FillQueuesProps } from './FillQueues';
import { ManagerIcon } from './ManagerIcon';
import { QueueRow } from './QueueRow';
import './AssignScreen.css';

/** What Save hands over: `tracker.saveQueue(save.date, save.assignedTo, save.items)` fits. */
export interface QueueSave {
  /** The queue's day, yyyy-MM-dd. */
  readonly date: string;
  /** Whose queue, exactly as the `intern` prop spelled it: the server matches names with ===. */
  readonly assignedTo: string;
  /** In posting order. An item already saved keeps its status; a new one is Not Shared. */
  readonly items: readonly QueueItemInput[];
  /**
   * Earlier days' queues to save first, each without the items moved to this
   * day or removed from it: that is what frees them. Missing or empty: none.
   */
  readonly releases?: readonly QueueSave[] | undefined;
}

export interface AssignScreenProps {
  /** Whose queues can be built: the team's interns, in the order to show them. */
  readonly interns: readonly string[];
  /** Whose queue is shown, or null: then the screen asks whose. */
  readonly intern: string | null;
  /** The queue's day, yyyy-MM-dd. */
  readonly date: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. */
  readonly today: string;
  /** Every listing in the directory. With its Issues text, a listing that can't be posted says so. */
  readonly properties: readonly DirectoryRow[];
  /** Every Posts row: the cooldown is judged from them. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row: this queue as saved, and who holds what. Read again after a save. */
  readonly assignments: readonly Assignment[];
  /** The cooldown, repost-due and per-intern rules. */
  readonly settings: Rules;
  /** The Team tab, for each intern's FB broker name. */
  readonly team?: readonly TeamMember[] | undefined;
  /** Show another intern's queue, or (null) the list of interns. Only called once unsaved changes are saved or discarded. */
  readonly onInternChange: (intern: string | null) => void;
  /** Show another day. Only called once unsaved changes are saved or discarded. */
  readonly onDateChange: (date: string) => void;
  /** Save the queue. Resolve once saved; reject with a UserFacingError to have its sentence shown. */
  readonly onSave: (save: QueueSave) => Promise<unknown>;
  /** Told when the draft gains or loses unsaved changes, so the shell can guard leaving the screen. */
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** The rows are being read and haven't arrived yet. Save waits for them. */
  readonly loading?: boolean | undefined;
  /** Why the rows couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  /** The directory's own search (Directory.search), so results match Find. Default: the same rule over `properties`. */
  readonly search?: ((query: string) => readonly Property[]) | undefined;
  /** Saves many queues at once (tracker.saveQueues). With it, step one offers Fill queues. */
  readonly onSaveQueues?: FillQueuesProps['onSave'] | undefined;
  /** Fill queues saved: what to say. */
  readonly onQueuesSaved?: ((note: string) => void) | undefined;
}

type Mode = 'library' | 'paste';

interface Draft {
  /** Whose queue and which day these entries are for. */
  readonly for: string;
  /** The saved queue they were last compared with. */
  readonly base: readonly QueueEntry[];
  readonly entries: readonly QueueEntry[];
  /** Keys of earlier days' items to remove from those days on save. */
  readonly dropped: readonly string[];
}

interface Pending {
  readonly kind: 'intern' | 'date';
  /** For 'intern', '' means the list of interns. */
  readonly value: string;
}

interface FocusTarget {
  readonly key: string;
  readonly role: string;
}

/** Quick fill's last batch, until it's saved or undone. */
interface Fill {
  readonly for: string;
  readonly keys: readonly string[];
}

/** One held listing the server refused, as `error.held` carries it. */
interface HeldRefusal {
  readonly propertyName: string;
  readonly propertyId: string;
  readonly heldBy: string;
  readonly date: string;
}

const COULD_NOT_SAVE = "Couldn't save the queue. Check your connection, then save again.";
const NONE: readonly string[] = [];

/** The draft's own copy after a save, until the rows are read again. */
interface Saved {
  readonly for: string;
  readonly entries: readonly QueueEntry[];
  readonly assignments: readonly Assignment[];
}

/** The `held` refusal's list, when the error is one. */
function heldOf(error: unknown): readonly HeldRefusal[] | null {
  if (!error || typeof error !== 'object') return null;
  const list = (error as { held?: unknown }).held;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => ({
      propertyName: String(row['propertyName'] ?? ''),
      propertyId: String(row['propertyId'] ?? ''),
      heldBy: String(row['heldBy'] ?? ''),
      date: String(row['date'] ?? ''),
    }));
}

/** The rules, plus the held rule: a listing another intern holds can't go in. */
function withHeld(rules: AssignRules, held: ReadonlyMap<string, HeldListing>, intern: string, date: string): AssignRules {
  return {
    ...rules,
    check(property) {
      const verdict = rules.check(property);
      if (!verdict.canAdd) return verdict;
      const hold = heldBy(held, property);
      if (!hold || samePerson(hold.heldBy, intern)) return verdict;
      return { ...verdict, canAdd: false, block: 'otherQueue', holder: hold.heldBy, reason: `${heldWords(hold, intern, date)}.` };
    },
  };
}

/**
 * Assign, in two steps. First, whose queue: a card per intern with what they
 * have open. Then their queue for a day: the library by category on the left,
 * the queue on the right, with what they still haven't shared from earlier
 * days. A listing held by another intern, in its cooldown, sold or without a
 * separator can't go in. Nothing is written until Save.
 */
export function AssignScreen({
  interns,
  intern,
  date,
  today,
  properties,
  posts,
  assignments,
  settings,
  team,
  onInternChange,
  onDateChange,
  onSave,
  onDirtyChange,
  loading = false,
  error,
  search,
  onSaveQueues,
  onQueuesSaved,
}: AssignScreenProps) {
  const [filling, setFilling] = useState(false);
  const { cooldownDays, repostDueDays } = settings;
  const held = useMemo(() => heldListings(assignments), [assignments]);
  const rules = useMemo<AssignRules | null>(() => {
    if (intern === null) return null;
    const base = assignRules({
      intern,
      date,
      today,
      posts,
      assignments,
      properties,
      settings: { cooldownDays, repostDueDays },
    });
    return withHeld(base, held, intern, date);
  }, [intern, date, today, posts, assignments, properties, cooldownDays, repostDueDays, held]);

  const queueFor = `${intern ?? ''}|${date}`;
  const first = intern === null ? '' : firstName(intern);
  const day = shortDate(date);

  // ---- every listing's state for this queue ------------------------------

  const states = useMemo<readonly ListingState[]>(() => {
    if (!rules || intern === null) return [];
    const input = { rules, held, intern, date, today };
    return properties.map((p) => listingState(p, input));
  }, [rules, held, intern, date, today, properties]);
  const stateByKey = useMemo(() => new Map(states.map((s) => [keyOf(s.property), s])), [states]);

  const byId = useMemo(() => {
    const map = new Map<string, DirectoryRow>();
    for (const p of properties) if (p.id && !map.has(p.id)) map.set(p.id, p);
    return map;
  }, [properties]);

  // ---- what's still open from earlier days -------------------------------

  const carried = useMemo<readonly CarriedItem[]>(() => {
    if (!rules || intern === null) return [];
    const out: CarriedItem[] = [];
    const seen = new Set<string>();
    const rows = assignments
      .filter((a) => a.date < date && samePerson(a.assignedTo, intern) && queueStatus(a.status) === 'Not Shared')
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const row of rows) {
      const property = (row.propertyId ? byId.get(row.propertyId) : undefined) ?? rules.entryNamed(row.propertyName).property;
      const key = property ? keyOf(property) : row.propertyId ? `id:${row.propertyId}` : `name:${normalize(row.propertyName)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, propertyName: row.propertyName, propertyId: property?.id ?? row.propertyId, property, date: row.date });
    }
    return out;
  }, [rules, intern, assignments, date, byId]);

  // ---- the draft, and what it is compared with --------------------------

  const [saved, setSaved] = useState<Saved | null>(null);
  const baseline: readonly QueueEntry[] =
    saved && saved.for === queueFor && saved.assignments === assignments ? saved.entries : (rules?.saved ?? []);

  const [draftState, setDraftState] = useState<Draft>(() => ({ for: queueFor, base: baseline, entries: baseline, dropped: NONE }));
  let draft = draftState;
  if (draft.for !== queueFor) {
    // Another intern or day: start from what is saved there.
    draft = { for: queueFor, base: baseline, entries: baseline, dropped: NONE };
    setDraftState(draft);
  } else if (!sameQueue(draft.base, baseline)) {
    // The rows were read again. Untouched, the draft follows them; edited, it is kept.
    const untouched = sameQueue(draft.entries, draft.base) && draft.dropped.length === 0;
    draft = { for: queueFor, base: baseline, entries: untouched ? baseline : draft.entries, dropped: draft.dropped };
    setDraftState(draft);
  }
  const entries = draft.entries;
  const dropped = draft.dropped;
  const dirty = intern !== null && (!sameQueue(entries, baseline) || dropped.length > 0);
  const inQueue = useMemo(() => new Set(entries.map((e) => e.key)), [entries]);

  const carriedFrom = useMemo(() => new Map(carried.map((c) => [c.key, c.date])), [carried]);
  const carriedLeft = carried.filter((c) => !inQueue.has(c.key) && !dropped.includes(c.key));
  const released = carried.filter((c) => inQueue.has(c.key) || dropped.includes(c.key));

  const setEntries = useCallback((change: (entries: readonly QueueEntry[]) => readonly QueueEntry[]) => {
    setDraftState((d) => ({ ...d, entries: change(d.entries) }));
  }, []);

  // ---- what the screen says ---------------------------------------------

  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // A repeat of the same words is still news.
    setAnnouncement((now) => (now === text ? `${text} ` : text));
  }, []);

  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<Mode>('library');
  const [tab, setTab] = useState<CategoryTab>('all');
  const [fillCount, setFillCount] = useState(() => String(settings.perIntern ?? DEFAULT_PER_INTERN));
  const [carriedOpen, setCarriedOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [matched, setMatched] = useState<Matched | null>(null);

  // A different queue starts clean: its own notes, no matches from the last one.
  const lastQueue = useRef(queueFor);
  useEffect(() => {
    if (lastQueue.current === queueFor) return;
    lastQueue.current = queueFor;
    setProblems([]);
    setRefused(new Map());
    setSavedNote(null);
    setAddedNote(null);
    setFillNote(null);
    setFill(null);
    setPending(null);
    setMatched(null);
  }, [queueFor]);

  useEffect(() => {
    if (dirty) setSavedNote(null);
  }, [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The shell guards leaving the screen with this.
  const dirtyListener = useRef(onDirtyChange);
  dirtyListener.current = onDirtyChange;
  useEffect(() => {
    dirtyListener.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyListener.current?.(false), []);

  // ---- adding -------------------------------------------------------------

  /** What of `picked` may go in now, as entries, in order. */
  const addable = useCallback(
    (picked: readonly Property[]): QueueEntry[] => {
      if (!rules) return [];
      const fresh: QueueEntry[] = [];
      for (const property of picked) {
        const entry = rules.entryFor(property);
        if (inQueue.has(entry.key) || fresh.some((e) => e.key === entry.key)) continue;
        // An earlier day's own item may come over: that is a move.
        const state = stateByKey.get(entry.key);
        const mine = carriedFrom.has(entry.key) && !dropped.includes(entry.key);
        if (state?.unavailable && !mine) continue;
        if (!state && !rules.check(property).canAdd) continue;
        fresh.push(entry);
      }
      return fresh;
    },
    [rules, inQueue, stateByKey, carriedFrom, dropped],
  );

  const add = useCallback(
    (picked: readonly Property[]): number => {
      const fresh = addable(picked);
      if (fresh.length === 0) return 0;
      setEntries((now) => [...now, ...fresh.filter((e) => !now.some((n) => n.key === e.key))]);
      setProblems([]);
      const total = entries.length + fresh.length;
      announce(
        fresh.length === 1
          ? `Added ${fresh[0]?.propertyName}. ${first}'s queue has ${plural(total, 'listing', 'listings')}.`
          : `Added ${plural(fresh.length, 'listing', 'listings')}. ${first}'s queue has ${total}.`,
      );
      return fresh.length;
    },
    [addable, setEntries, entries.length, first, announce],
  );

  // ---- quick fill -----------------------------------------------------------

  const quickFill = (count: number, scope: CategoryTab) => {
    if (!rules || intern === null || count <= 0) return;
    const inScope = scope === 'all' ? states : states.filter((s) => s.kind === scope);
    const names = [...new Set(inScope.map((s) => s.property.category))];
    // One folder name: the planner narrows to it. Several (the unsorted ones): ask wide, then narrow here.
    const category = scope !== 'all' && names.length === 1 ? names[0] : undefined;
    const wide = scope !== 'all' && names.length !== 1;
    const items = planForIntern({
      properties,
      posts,
      assignments,
      date,
      rules: { cooldownDays, repostDueDays },
      intern,
      count: wide ? properties.length : count,
      ...(category ? { category } : {}),
      exclude: [...entries, ...carried].map((e) => ({ propertyName: e.propertyName, propertyId: e.propertyId })),
    });
    const picked: Property[] = [];
    for (const item of items) {
      const property = (item.propertyId ? byId.get(item.propertyId) : undefined) ?? rules.entryNamed(item.propertyName).property;
      if (!property) continue;
      const state = stateByKey.get(keyOf(property));
      if (!state || state.unavailable || (scope !== 'all' && state.kind !== scope)) continue;
      picked.push(property);
      if (picked.length >= count) break;
    }
    const fresh = addable(picked);
    const where = scope === 'all' ? '' : ` from ${tabLabel(scope, states)}`;
    if (fresh.length === 0) {
      setFill(null);
      setFillNote(`Nothing${where} is free to add.`);
      announce(`Nothing${where} is free to add.`);
      return;
    }
    setEntries((now) => [...now, ...fresh.filter((e) => !now.some((n) => n.key === e.key))]);
    setProblems([]);
    setFill({ for: queueFor, keys: fresh.map((e) => e.key) });
    const note =
      fresh.length < count
        ? `Added ${fresh.length}${where}. That's all that's free.`
        : `Added ${fresh.length}${where}.`;
    setFillNote(note);
    announce(`${note} ${first}'s queue has ${entries.length + fresh.length}.`);
  };

  const fillKeys = fill && fill.for === queueFor ? new Set(fill.keys.filter((k) => inQueue.has(k))) : null;

  const undoFill = () => {
    if (!fillKeys) return;
    const n = fillKeys.size;
    setEntries((now) => now.filter((e) => !fillKeys.has(e.key)));
    setFill(null);
    setFillNote(null);
    announce(`Removed the ${plural(n, 'listing', 'listings')} quick fill added.`);
  };

  // ---- moving and removing ------------------------------------------------

  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const focusAfter = useRef<FocusTarget | null>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  const move = useCallback(
    (key: string, by: number, role: string) => {
      const from = entries.findIndex((e) => e.key === key);
      const to = from + by;
      const entry = entries[from];
      if (!entry) return;
      if (to < 0 || to >= entries.length) {
        announce(`${entry.propertyName} is already ${to < 0 ? 'first' : 'last'}.`);
        return;
      }
      setEntries((now) => {
        const at = now.findIndex((e) => e.key === key);
        return at < 0 ? now : moveEntry(now, at, at + by);
      });
      focusAfter.current = { key, role };
      announce(`${entry.propertyName} moved to ${to + 1} of ${entries.length}.`);
    },
    [entries, setEntries, announce],
  );

  const moveTo = useCallback(
    (key: string, to: number) => {
      const from = entries.findIndex((e) => e.key === key);
      const entry = entries[from];
      if (!entry || from === to || to < 0 || to >= entries.length) return;
      setEntries((now) => {
        const at = now.findIndex((e) => e.key === key);
        return at < 0 ? now : moveEntry(now, at, to);
      });
      announce(`${entry.propertyName} moved to ${to + 1} of ${entries.length}.`);
    },
    [entries, setEntries, announce],
  );

  const remove = useCallback(
    (key: string) => {
      if (!rules || rules.isStarted(key)) return;
      const index = entries.findIndex((e) => e.key === key);
      const entry = entries[index];
      if (!entry) return;
      setEntries((now) => now.filter((e) => e.key !== key));
      setRefused((now) => {
        if (!now.has(key)) return now;
        const next = new Map(now);
        next.delete(key);
        return next;
      });
      const next = entries[index + 1] ?? entries[index - 1];
      focusAfter.current = next ? { key: next.key, role: 'remove' } : { key: '', role: 'empty' };
      announce(
        carriedFrom.has(key)
          ? `Removed ${entry.propertyName}. It's back in its queue for ${dayMonth(carriedFrom.get(key) ?? '')}.`
          : `Removed ${entry.propertyName}.`,
      );
    },
    [rules, entries, setEntries, announce, carriedFrom],
  );

  const moveCarried = (item: CarriedItem) => {
    setEntries((now) => (now.some((e) => e.key === item.key) ? now : [...now, item]));
    announce(`Moved ${item.propertyName} to ${day}.`);
  };

  const releaseCarried = (item: CarriedItem) => {
    setDraftState((d) => (d.dropped.includes(item.key) ? d : { ...d, dropped: [...d.dropped, item.key] }));
    announce(`${item.propertyName} will be removed from ${dayMonth(item.date)} when you save.`);
  };

  // Keep focus on the control that moved, or on the row that took a removed one's place.
  useLayoutEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    if (want.role === 'empty') {
      emptyRef.current?.focus();
      return;
    }
    const row = rowRefs.current.get(want.key);
    const target =
      row?.querySelector<HTMLElement>(`[data-role="${want.role}"]`) ??
      row?.querySelector<HTMLElement>('[data-role="up"]') ??
      null;
    if (target && document.activeElement !== target) target.focus();
  });

  // Rows that change place glide there (FLIP), at --dur-move: 0 with reduced motion.
  const positions = useRef(new Map<string, number>());
  const positionsFor = useRef(queueFor);
  useLayoutEffect(() => {
    const sameQueueShown = positionsFor.current === queueFor;
    positionsFor.current = queueFor;
    const next = new Map<string, number>();
    for (const entry of entries) {
      const row = rowRefs.current.get(entry.key);
      if (!row) continue;
      const top = row.offsetTop;
      next.set(entry.key, top);
      const before = positions.current.get(entry.key);
      if (!sameQueueShown || before === undefined || before === top || typeof row.animate !== 'function') continue;
      const ms = parseFloat(getComputedStyle(row).getPropertyValue('--dur-move')) || 0;
      if (ms > 0) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], {
          duration: ms,
          easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
        });
      }
    }
    positions.current = next;
  }, [entries, queueFor]);

  // ---- dragging -----------------------------------------------------------

  const [drag, setDrag] = useState<{ readonly key: string; readonly over: number | null } | null>(null);

  const dragProps = (entry: QueueEntry, index: number) => ({
    onDragOver: (event: DragEvent<HTMLLIElement>) => {
      if (!drag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      const over = index + (event.clientY > box.top + box.height / 2 ? 1 : 0);
      if (drag.over !== over) setDrag({ key: drag.key, over });
    },
    onDrop: (event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      if (!drag || drag.over === null) return;
      const from = entries.findIndex((e) => e.key === drag.key);
      const to = drag.over > from ? drag.over - 1 : drag.over;
      setDrag(null);
      if (from >= 0) moveTo(drag.key, to);
    },
    handle: {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLSpanElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', entry.propertyName);
        const row = rowRefs.current.get(entry.key);
        if (row) event.dataTransfer.setDragImage(row, 24, 24);
        setDrag({ key: entry.key, over: null });
      },
      onDragEnd: () => setDrag(null),
    },
  });

  const dropMark = (index: number): 'before' | 'after' | null => {
    if (!drag || drag.over === null) return null;
    const from = entries.findIndex((e) => e.key === drag.key);
    if (drag.over === from || drag.over === from + 1) return null; // it wouldn't move
    if (drag.over === index) return 'before';
    if (drag.over === entries.length && index === entries.length - 1) return 'after';
    return null;
  };

  // ---- switching intern or day --------------------------------------------

  const returnFocus = useRef<HTMLElement | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const ask = (next: Pending) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(next);
  };

  const goIntern = (name: string) => onInternChange(name === '' ? null : name);

  const requestIntern = (name: string) => {
    if (intern !== null && name !== '' && samePerson(name, intern)) return;
    if (dirty) ask({ kind: 'intern', value: name });
    else goIntern(name);
  };

  const requestDate = (next: string) => {
    if (next === date) return;
    if (dirty) ask({ kind: 'date', value: next });
    else onDateChange(next);
  };

  useEffect(() => {
    if (pending) keepRef.current?.focus();
  }, [pending]);

  const keepEditing = () => {
    setPending(null);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back?.isConnected) back.focus();
  };

  const resetDraft = () => {
    setDraftState((d) => ({ ...d, entries: baseline, dropped: NONE }));
    setProblems([]);
    setRefused(new Map());
    setAddedNote(null);
    setFill(null);
    setFillNote(null);
  };

  const discard = () => {
    const next = pending;
    setPending(null);
    resetDraft();
    if (next?.kind === 'intern') goIntern(next.value);
    else if (next) onDateChange(next.value);
  };

  // ---- saving ---------------------------------------------------------------

  /** Each earlier day touched, saved again without what was moved or removed. */
  const releasesOf = (): QueueSave[] => {
    if (intern === null || released.length === 0) return [];
    const gone = new Set(released.map((c) => c.key));
    const days = [...new Set(released.map((c) => c.date))].sort();
    return days.map((d) => {
      const items: QueueItemInput[] = [];
      for (const row of assignments) {
        if (row.date !== d || !samePerson(row.assignedTo, intern)) continue;
        const property = (row.propertyId ? byId.get(row.propertyId) : undefined) ?? rules?.entryNamed(row.propertyName).property;
        const key = property ? keyOf(property) : row.propertyId ? `id:${row.propertyId}` : `name:${normalize(row.propertyName)}`;
        if (gone.has(key) && queueStatus(row.status) === 'Not Shared') continue;
        items.push({
          propertyName: row.propertyName,
          ...(row.propertyId.trim() ? { propertyId: row.propertyId } : {}),
          status: queueStatus(row.status),
        });
      }
      return { date: d, assignedTo: intern, items };
    });
  };

  const save = async () => {
    if (!rules || intern === null || saving || loading) return;
    const result = rules.validate(entries);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    const snapshot = entries;
    const forQueue = queueFor;
    const rowsWhenSaved = assignments;
    const releases = releasesOf();
    setSaving(true);
    setProblems([]);
    setRefused(new Map());
    try {
      await onSave({ date, assignedTo: intern, items: result.items, ...(releases.length > 0 ? { releases } : {}) });
      if (!mounted.current) return;
      setSaved({ for: forQueue, entries: snapshot, assignments: rowsWhenSaved });
      setDraftState((d) => ({ ...d, dropped: NONE }));
      setAddedNote(null);
      setFill(null);
      setFillNote(null);
      setSavedNote(
        snapshot.length === 0
          ? `Saved. ${first} has nothing queued for ${day}.`
          : `Saved. ${first} has ${plural(snapshot.length, 'listing', 'listings')} for ${day}.`,
      );
    } catch (e) {
      if (!mounted.current) return;
      const refusals = heldOf(e);
      if (refusals) {
        const marks = new Map<string, string>();
        for (const h of refusals) {
          const entry = entries.find(
            (en) => (h.propertyId !== '' && en.propertyId === h.propertyId) || normalize(en.propertyName) === normalize(h.propertyName),
          );
          if (entry) marks.set(entry.key, heldWords(h, intern, date));
        }
        setRefused(marks);
        const n = marks.size || refusals.length;
        setProblems([
          n === 1
            ? 'One listing is held by another intern. Remove it, then save again.'
            : `${n} listings are held by other interns. Remove them, then save again.`,
        ]);
      } else {
        setProblems([e instanceof UserFacingError ? e.message : COULD_NOT_SAVE]);
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const removeRefused = () => {
    const keys = new Set(refused.keys());
    setEntries((now) => now.filter((e) => !keys.has(e.key) || (rules?.isStarted(e.key) ?? false)));
    setRefused(new Map());
    setProblems([]);
    announce(`Removed ${plural(keys.size, 'held listing', 'held listings')}.`);
  };

  const undo = () => {
    resetDraft();
    announce('Changes undone.');
  };

  // ---- search and paste -----------------------------------------------------

  const searchKeys = useCallback(
    (query: string): ReadonlySet<string> | null => {
      if (query.trim() === '') return null;
      const found = search ? search(query) : searchProperties(properties, query);
      return new Set(found.map((p) => p.id || p.name));
    },
    [search, properties],
  );

  const shownMatches = matched && matched.for === queueFor ? matched : null;

  const runMatch = () => {
    setMatched({ for: queueFor, matches: matchPasted(pasteText, properties), accepted: new Set() });
    setAddedNote(null);
  };

  const accept = (index: number, property: Property) => {
    if (add([property]) === 0 && !inQueue.has(rules?.entryFor(property).key ?? '')) return;
    setMatched((m) => (m ? { ...m, accepted: new Set([...m.accepted, index]) } : m));
  };

  // ---- the page -----------------------------------------------------------

  const waiting = loading && properties.length === 0;
  const member = intern === null ? undefined : team?.find((m) => samePerson(m.name, intern));
  const accounts = (member?.fbAccounts ?? []).filter((a) => a.trim());

  const announcer = (
    <p className="visually-hidden" aria-live="polite">
      {announcement}
    </p>
  );

  const errorNotice = error ? (
    <Notice tone="danger" live className="assign__notice">
      {error}
    </Notice>
  ) : null;

  // Step one: whose queue.
  if (intern === null) {
    return (
      <div className="page assign">
        <header className="page-header assign__header">
          <h1 className="page-header__title" tabIndex={-1}>
            Assign
          </h1>
          {onSaveQueues ? (
            <Button icon={<Icon name="assign" size={18} />} onClick={() => setFilling(true)} disabled={waiting}>
              Fill queues
            </Button>
          ) : null}
        </header>
        {filling && onSaveQueues ? (
          <FillQueues
            interns={interns}
            properties={properties}
            posts={posts}
            assignments={assignments}
            rules={{ cooldownDays, repostDueDays, perIntern: settings.perIntern }}
            today={today}
            onSave={onSaveQueues}
            onSaved={(note) => {
              setFilling(false);
              onQueuesSaved?.(note);
            }}
            onClose={() => setFilling(false)}
          />
        ) : null}
        {errorNotice}
        {interns.length === 0 ? (
          <NoInterns />
        ) : (
          <AssignPicker interns={interns} team={team} assignments={assignments} today={today} onPick={(name) => onInternChange(name)} />
        )}
        {announcer}
      </div>
    );
  }

  // Step two: their queue for a day.
  return (
    <div className="page assign">
      <header className="page-header assign__header assign__header--queue">
        <div className="assign__who">
          <Button
            variant="quiet"
            size="small"
            className="assign__back"
            icon={<ManagerIcon name="chevronLeft" size={18} />}
            onClick={() => requestIntern('')}
          >
            All interns
          </Button>
          <h1 className="page-header__title" tabIndex={-1}>
            {intern}
          </h1>
          <p className="assign__fb">
            {accounts.length === 0 ? 'Any FB account' : accounts.join(', ')}
          </p>
        </div>
        <DayPicker date={date} today={today} onChange={requestDate} label="Day" quick={['today', 'tomorrow']} />
      </header>

      {errorNotice}

      {pending ? (
        <Notice
          tone="warn"
          live
          className="assign__notice"
          title={`Unsaved changes to ${first}'s queue for ${day}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              keepEditing();
            }
          }}
          action={
            <div className="assign__notice-actions">
              <Button ref={keepRef} size="small" onClick={keepEditing}>
                Keep editing
              </Button>
              <Button size="small" onClick={discard}>
                {pending.kind === 'intern'
                  ? pending.value === ''
                    ? 'Discard and choose an intern'
                    : `Discard and open ${firstName(pending.value)}'s queue`
                  : `Discard and open ${shortDate(pending.value)}`}
              </Button>
            </div>
          }
        >
          Save them first, or discard them.
        </Notice>
      ) : null}

      <div className="assign__panes">
        <Card
          className="assign__add"
          title={mode === 'library' ? 'Listings' : 'Paste a list'}
          actions={
            mode === 'library' ? (
              <div className="assign__add-actions">
                <Button variant="quiet" size="small" onClick={() => setMode('paste')}>
                  Paste a list
                </Button>
                <QuickFill
                  count={fillCount}
                  onCount={setFillCount}
                  scope={tabLabel(tab, states)}
                  onFill={(n) => quickFill(n, tab)}
                  disabled={rules === null || loading}
                />
              </div>
            ) : (
              <Button
                variant="quiet"
                size="small"
                icon={<ManagerIcon name="chevronLeft" size={18} />}
                onClick={() => setMode('library')}
              >
                Back to listings
              </Button>
            )
          }
        >
          {waiting ? (
            <div className="assign__waiting">
              <Spinner label="Loading the library" />
              <span>Loading the library…</span>
            </div>
          ) : mode === 'library' ? (
            <LibraryPanel
              states={states}
              inQueue={inQueue}
              keyOf={keyOf}
              today={today}
              search={searchKeys}
              onAdd={(p) => add([p])}
              tab={tab}
              onTab={(next) => setTab(next)}
            />
          ) : (
            <PastePanel
              text={pasteText}
              onText={setPasteText}
              onMatch={runMatch}
              matched={shownMatches}
              rules={rules}
              inQueue={inQueue}
              today={today}
              intern={intern}
              onAccept={accept}
              onAddAll={(picked) => {
                const n = add(picked);
                if (n > 0) {
                  setAddedNote(
                    `Added ${plural(n, 'listing', 'listings')} to ${first}'s queue. Save to keep ${n === 1 ? 'it' : 'them'}.`,
                  );
                }
              }}
              addedNote={addedNote}
            />
          )}
        </Card>

        <Card
          className="assign__queue"
          padding="tight"
          title={`Queue for ${day}`}
          description={plural(entries.length, 'listing', 'listings')}
        >
          <Carried
            items={carriedLeft}
            onMove={moveCarried}
            onRelease={releaseCarried}
            open={carriedOpen}
            onToggle={setCarriedOpen}
          />
          {released.some((c) => dropped.includes(c.key)) ? (
            <p className="assign__released">
              {plural(dropped.length, 'earlier listing', 'earlier listings')} will be freed on save.
            </p>
          ) : null}

          {fillNote ? (
            <div className="assign-fill" role="status">
              <span>{fillNote}</span>
              {fillKeys && fillKeys.size > 0 ? (
                <Button size="small" variant="quiet" onClick={undoFill}>
                  Undo
                </Button>
              ) : null}
            </div>
          ) : null}

          {loading && entries.length === 0 ? (
            <div className="assign__waiting">
              <Spinner label="Loading the queue" />
              <span>Loading the queue…</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="assign__quiet assign__empty" ref={emptyRef} tabIndex={-1}>
              Nothing queued for {day} yet.
            </p>
          ) : (
            <ol className="assign-queue" aria-label={`${first}'s queue, in posting order`}>
              {entries.map((entry, index) => {
                const dnd = dragProps(entry, index);
                const from = carriedFrom.get(entry.key);
                return (
                  <QueueRow
                    key={entry.key}
                    ref={(el) => {
                      if (el) rowRefs.current.set(entry.key, el);
                      else rowRefs.current.delete(entry.key);
                    }}
                    entry={entry}
                    index={index}
                    count={entries.length}
                    rules={rules}
                    isNew={!baseline.some((b) => b.key === entry.key)}
                    preview={fillKeys?.has(entry.key) ?? false}
                    refusal={refused.get(entry.key)}
                    movedFrom={from ? dayMonth(from) : undefined}
                    dragging={drag?.key === entry.key}
                    dropMark={dropMark(index)}
                    onMove={(by, role) => move(entry.key, by, role)}
                    onRemove={() => remove(entry.key)}
                    onDragOver={dnd.onDragOver}
                    onDrop={dnd.onDrop}
                    handle={dnd.handle}
                  />
                );
              })}
            </ol>
          )}
          {entries.length > 1 ? <p className="assign__hint">Top to bottom. Drag or Alt+Up/Down to reorder.</p> : null}
        </Card>
      </div>

      {problems.length > 0 ? (
        <Notice
          tone="danger"
          live
          className="assign__notice"
          title="The queue wasn't saved"
          action={
            refused.size > 0 ? (
              <Button size="small" onClick={removeRefused}>
                {refused.size === 1 ? 'Remove it' : `Remove ${refused.size}`}
              </Button>
            ) : undefined
          }
        >
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </Notice>
      ) : null}

      <div className="assign-savebar">
        <p className="assign-savebar__state" role="status">
          {saving ? (
            'Saving…'
          ) : savedNote && !dirty ? (
            <>
              <Icon name="pass" size={18} className="assign-savebar__icon assign-savebar__icon--ok" />
              {savedNote}
            </>
          ) : dirty ? (
            <>
              <Icon name="warn" size={18} className="assign-savebar__icon assign-savebar__icon--warn" />
              Unsaved changes to {first}&rsquo;s queue for {day}.
            </>
          ) : (
            `${first}'s queue for ${day} is saved.`
          )}
        </p>
        <div className="assign-savebar__actions">
          <Button variant="quiet" disabled={!dirty || saving} onClick={undo}>
            Undo changes
          </Button>
          <Button variant="primary" busy={saving} disabled={!dirty || rules === null || loading} onClick={() => void save()}>
            {saving ? 'Saving…' : `Save queue (${entries.length})`}
          </Button>
        </div>
      </div>
      {announcer}
    </div>
  );
}
