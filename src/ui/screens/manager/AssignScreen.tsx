import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Card, Icon, Notice, Spinner } from '../../components';
import { planForIntern } from '@/core/planner';
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
import { DEFAULT_RULES, UserFacingError, type Assignment, type PostLogEntry, type Property } from '@/core/types';
import { addWeeks, isWeekOver, weekFriday, weekLabel, weekOf } from '@/core/week';
import { MenuButton, MoreIcon } from './AssignMenu';
import { LibraryPanel, QuickFill, tabLabel, type CategoryTab } from './AssignLibrary';
import { PastePanel, type Matched } from './AssignPaste';
import { AssignPicker, NoInterns } from './AssignPicker';
import { heldWords, listingState, type ListingState } from './assignListing';
import { FillQueues, type FillQueuesProps } from './FillQueues';
import { ManagerIcon } from './ManagerIcon';
import { DoneRow, QueueRow } from './QueueRow';
import { WeekPicker } from './WeekPicker';
import './AssignScreen.css';

/** What Save hands over: `tracker.saveQueue(save.week, save.assignedTo, save.items)` fits. */
export interface QueueSave {
  /** The queue's week, as its Monday (yyyy-MM-dd). */
  readonly week: string;
  /** Whose queue, exactly as the `intern` prop spelled it: the server matches names with ===. */
  readonly assignedTo: string;
  /** In posting order. An item already saved keeps its status; a new one is Not Shared. */
  readonly items: readonly QueueItemInput[];
}

export interface AssignScreenProps {
  /** Whose queues can be built: the team's interns, in the order to show them. */
  readonly interns: readonly string[];
  /** Whose queue is shown, or null: then the screen asks whose. */
  readonly intern: string | null;
  /** The week shown, as its Monday (yyyy-MM-dd). */
  readonly week: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. */
  readonly today: string;
  /** Every listing in the directory. With its Issues text, a listing that can't be posted says so. */
  readonly properties: readonly DirectoryRow[];
  /** Every Posts row: the cooldown, and the links to what was posted. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row: this queue as saved, and who holds what. Read again after a save. */
  readonly assignments: readonly Assignment[];
  /** The cooldown, repost-due and per-week rules. */
  readonly settings: Rules;
  /** Show another intern's queue, or (null) the list of interns. Only called once unsaved changes are saved or discarded. */
  readonly onInternChange: (intern: string | null) => void;
  /** Show another week (its Monday). Only called once unsaved changes are saved or discarded. */
  readonly onWeekChange: (week: string) => void;
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
  /** Opens a post's link. Default: the link opens as links do. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** The library's page, when the URL keeps it (?page=). Without it, the library keeps its own. */
  readonly libraryPage?: number | undefined;
  readonly onLibraryPageChange?: ((page: number) => void) | undefined;
}

type Mode = 'library' | 'paste';
type Group = 'pending' | 'open' | 'posted';

interface Draft {
  /** Whose queue and which week these entries are for. */
  readonly for: string;
  /** The saved queue they were last compared with. */
  readonly base: readonly QueueEntry[];
  readonly entries: readonly QueueEntry[];
}

interface Pending {
  readonly kind: 'intern' | 'week';
  /** For 'intern', '' means the list of interns. */
  readonly value: string;
}

interface FocusTarget {
  readonly key: string;
  readonly role: string;
}

/** Quick fill's (or Copy missed's) last batch, until it's saved or undone. */
interface Fill {
  readonly for: string;
  readonly keys: readonly string[];
}

/** Missed listings on their way to another week's queue. */
interface Seed {
  readonly for: string;
  readonly from: string;
  readonly properties: readonly Property[];
}

/** One held listing the server refused, as `error.held` carries it. */
interface HeldRefusal {
  readonly propertyName: string;
  readonly propertyId: string;
  readonly heldBy: string;
  readonly date: string;
}

const COULD_NOT_SAVE = "Couldn't save the queue. Check your connection, then save again.";

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

/** The rules, plus the held rule: a listing held by another intern, or in this intern's queue for another week, can't go in. */
function withHeld(rules: AssignRules, held: ReadonlyMap<string, HeldListing>, intern: string, week: string): AssignRules {
  return {
    ...rules,
    check(property) {
      const verdict = rules.check(property);
      if (!verdict.canAdd) return verdict;
      const hold = heldBy(held, property);
      if (!hold || (samePerson(hold.heldBy, intern) && hold.week === week)) return verdict;
      return { ...verdict, canAdd: false, block: 'otherQueue', holder: hold.heldBy, reason: `${heldWords(hold, intern)}.` };
    },
  };
}

/** Where a saved status puts a row: Pending, then Not shared, then Posted. */
const RANK: Record<Group, number> = { pending: 0, open: 1, posted: 2 };

/**
 * Assign, in two steps, a week at a time. First, whose queue: a card per
 * intern with the week's progress. Then their queue for the week: the library
 * by category on the left, the queue on the right, grouped Not shared,
 * Pending, Posted. A week that is over is read only, with what was missed.
 * Nothing is written until Save.
 */
export function AssignScreen({
  interns,
  intern,
  week,
  today,
  properties,
  posts,
  assignments,
  settings,
  onInternChange,
  onWeekChange,
  onSave,
  onDirtyChange,
  loading = false,
  error,
  search,
  onSaveQueues,
  onQueuesSaved,
  onOpenLink,
  libraryPage,
  onLibraryPageChange,
}: AssignScreenProps) {
  const [filling, setFilling] = useState(false);
  const { cooldownDays, repostDueDays } = settings;
  const perWeek = settings.perWeek ?? settings.perIntern ?? DEFAULT_RULES.perWeek;
  const over = isWeekOver(week, today);
  const held = useMemo(() => heldListings(assignments, today), [assignments, today]);
  const rules = useMemo<AssignRules | null>(() => {
    if (intern === null) return null;
    const base = assignRules({
      intern,
      week,
      today,
      posts,
      assignments,
      properties,
      settings: { cooldownDays, repostDueDays },
    });
    return withHeld(base, held, intern, week);
  }, [intern, week, today, posts, assignments, properties, cooldownDays, repostDueDays, held]);

  const queueFor = `${intern ?? ''}|${week}`;
  const first = intern === null ? '' : firstName(intern);

  // ---- every listing's state for this queue ------------------------------

  const states = useMemo<readonly ListingState[]>(() => {
    if (!rules || intern === null) return [];
    const input = { rules, held, intern, week, today };
    return properties.map((p) => listingState(p, input));
  }, [rules, held, intern, week, today, properties]);
  const stateByKey = useMemo(() => new Map(states.map((s) => [keyOf(s.property), s])), [states]);

  const byId = useMemo(() => {
    const map = new Map<string, DirectoryRow>();
    for (const p of properties) if (p.id && !map.has(p.id)) map.set(p.id, p);
    return map;
  }, [properties]);

  const groupOf = useCallback(
    (key: string): Group => {
      const status = rules?.statusOf(key);
      return status === 'Pending' ? 'pending' : status === 'Posted' ? 'posted' : 'open';
    },
    [rules],
  );
  /** Pending first, then Not shared in its order, then Posted, as the rules keep a saved queue. */
  const ordered = useCallback(
    (list: readonly QueueEntry[]): QueueEntry[] => [...list].sort((a, b) => RANK[groupOf(a.key)] - RANK[groupOf(b.key)]),
    [groupOf],
  );

  // ---- the draft, and what it is compared with --------------------------

  const [saved, setSaved] = useState<Saved | null>(null);
  const baseline: readonly QueueEntry[] =
    saved && saved.for === queueFor && saved.assignments === assignments ? saved.entries : (rules?.saved ?? []);

  const [draftState, setDraftState] = useState<Draft>(() => ({ for: queueFor, base: baseline, entries: baseline }));
  let draft = draftState;
  if (draft.for !== queueFor) {
    // Another intern or week: start from what is saved there.
    draft = { for: queueFor, base: baseline, entries: baseline };
    setDraftState(draft);
  } else if (!sameQueue(draft.base, baseline)) {
    // The rows were read again. Untouched, the draft follows them; edited, it is kept.
    const untouched = sameQueue(draft.entries, draft.base);
    draft = { for: queueFor, base: baseline, entries: untouched ? baseline : draft.entries };
    setDraftState(draft);
  }
  const entries = draft.entries;
  const dirty = intern !== null && !over && !sameQueue(entries, baseline);
  const inQueue = useMemo(() => new Set(entries.map((e) => e.key)), [entries]);
  const open = useMemo(() => entries.filter((e) => groupOf(e.key) === 'open'), [entries, groupOf]);

  const setEntries = useCallback(
    (change: (entries: readonly QueueEntry[]) => readonly QueueEntry[]) => {
      setDraftState((d) => ({ ...d, entries: ordered(change(d.entries)) }));
    },
    [ordered],
  );

  // ---- what the screen says ---------------------------------------------

  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // A repeat of the same words is still news.
    setAnnouncement((now) => (now === text ? `${text} ` : text));
  }, []);

  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const [savedNote, setSavedNote] = useState(false);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<Mode>('library');
  const [tab, setTab] = useState<CategoryTab>('all');
  const [fillCount, setFillCount] = useState(perWeek);
  const [pasteText, setPasteText] = useState('');
  const [matched, setMatched] = useState<Matched | null>(null);
  const [seed, setSeed] = useState<Seed | null>(null);

  // A different queue starts clean: its own notes, no matches from the last one.
  const lastQueue = useRef(queueFor);
  useEffect(() => {
    if (lastQueue.current === queueFor) return;
    lastQueue.current = queueFor;
    setProblems([]);
    setRefused(new Map());
    setSavedNote(false);
    setAddedNote(null);
    setFillNote(null);
    setFill(null);
    setPending(null);
    setMatched(null);
  }, [queueFor]);

  useEffect(() => {
    if (dirty) setSavedNote(false);
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
      if (!rules || over) return [];
      const fresh: QueueEntry[] = [];
      for (const property of picked) {
        const entry = rules.entryFor(property);
        if (inQueue.has(entry.key) || fresh.some((e) => e.key === entry.key)) continue;
        const state = stateByKey.get(entry.key);
        if (state?.unavailable) continue;
        if (!state && !rules.check(property).canAdd) continue;
        fresh.push(entry);
      }
      return fresh;
    },
    [rules, over, inQueue, stateByKey],
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
          ? `Added ${fresh[0]?.propertyName}. ${plural(total, 'listing', 'listings')} queued.`
          : `Added ${fresh.length}. ${total} queued.`,
      );
      return fresh.length;
    },
    [addable, setEntries, entries.length, announce],
  );

  // ---- quick fill -----------------------------------------------------------

  const quickFill = (count: number, scope: CategoryTab) => {
    if (!rules || intern === null || count <= 0 || over) return;
    const inScope = scope === 'all' ? states : states.filter((s) => s.kind === scope);
    const names = [...new Set(inScope.map((s) => s.property.category))];
    // One folder name: the planner narrows to it. Several (the unsorted ones): ask wide, then narrow here.
    const category = scope !== 'all' && names.length === 1 ? names[0] : undefined;
    const wide = scope !== 'all' && names.length !== 1;
    const items = planForIntern({
      properties,
      posts,
      assignments,
      week,
      today,
      rules: { cooldownDays, repostDueDays },
      intern,
      count: wide ? properties.length : count,
      ...(category ? { category } : {}),
      exclude: entries.map((e) => ({ propertyName: e.propertyName, propertyId: e.propertyId })),
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
      setFillNote(`Nothing${where} is free.`);
      announce(`Nothing${where} is free.`);
      return;
    }
    setEntries((now) => [...now, ...fresh.filter((e) => !now.some((n) => n.key === e.key))]);
    setProblems([]);
    setFill({ for: queueFor, keys: fresh.map((e) => e.key) });
    const note = fresh.length < count ? `Added ${fresh.length}${where}. That's all that's free.` : `Added ${fresh.length}${where}.`;
    setFillNote(note);
    announce(`${note} ${entries.length + fresh.length} queued.`);
  };

  const fillKeys = fill && fill.for === queueFor ? new Set(fill.keys.filter((k) => inQueue.has(k))) : null;

  const undoFill = () => {
    if (!fillKeys) return;
    const n = fillKeys.size;
    setEntries((now) => now.filter((e) => !fillKeys.has(e.key)));
    setFill(null);
    setFillNote(null);
    announce(`Removed the ${plural(n, 'listing', 'listings')} just added.`);
  };

  // ---- missed, copied to the next open week -----------------------------------

  const nextOpen = (() => {
    const next = addWeeks(week, 1);
    const current = weekOf(today);
    return next < current ? current : next;
  })();

  const copyMissed = (missed: readonly QueueEntry[]) => {
    if (intern === null) return;
    const props = missed.flatMap((e) => (e.property ? [e.property] : []));
    setSeed({ for: `${intern}|${nextOpen}`, from: week, properties: props });
    onWeekChange(nextOpen);
  };

  // Once the next week's queue is showing, the copied listings go in, tinted, with Undo.
  useEffect(() => {
    if (!seed || seed.for !== queueFor || !rules || loading) return;
    setSeed(null);
    const fresh = addable(seed.properties);
    if (fresh.length > 0) {
      setEntries((now) => [...now, ...fresh.filter((e) => !now.some((n) => n.key === e.key))]);
      setFill({ for: queueFor, keys: fresh.map((e) => e.key) });
    }
    const note =
      fresh.length === seed.properties.length
        ? `Copied ${fresh.length} from ${weekLabel(seed.from)}.`
        : `Copied ${fresh.length} of ${seed.properties.length} from ${weekLabel(seed.from)}. The rest aren't free.`;
    setFillNote(note);
    announce(note);
  }, [seed, queueFor, rules, loading, addable, setEntries, announce]);

  // ---- moving and removing ------------------------------------------------

  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const focusAfter = useRef<FocusTarget | null>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  /** The queue with its Not shared rows in a new order. */
  const reorder = useCallback(
    (key: string, to: (at: number) => number) => {
      setEntries((now) => {
        const rows = now.filter((e) => groupOf(e.key) === 'open');
        const at = rows.findIndex((e) => e.key === key);
        if (at < 0) return now;
        const moved = moveEntry(rows, at, to(at));
        return [...now.filter((e) => groupOf(e.key) === 'pending'), ...moved, ...now.filter((e) => groupOf(e.key) === 'posted')];
      });
    },
    [setEntries, groupOf],
  );

  const move = useCallback(
    (key: string, by: number, role: string) => {
      const from = open.findIndex((e) => e.key === key);
      const to = from + by;
      const entry = open[from];
      if (!entry) return;
      if (to < 0 || to >= open.length) {
        announce(`${entry.propertyName} is already ${to < 0 ? 'first' : 'last'}.`);
        return;
      }
      reorder(key, (at) => at + by);
      focusAfter.current = { key, role };
      announce(`${entry.propertyName} moved to ${to + 1} of ${open.length}.`);
    },
    [open, reorder, announce],
  );

  const moveTo = useCallback(
    (key: string, to: number) => {
      const from = open.findIndex((e) => e.key === key);
      const entry = open[from];
      if (!entry || from === to || to < 0 || to >= open.length) return;
      reorder(key, () => to);
      announce(`${entry.propertyName} moved to ${to + 1} of ${open.length}.`);
    },
    [open, reorder, announce],
  );

  const remove = useCallback(
    (key: string) => {
      if (!rules || rules.isStarted(key)) return;
      const index = open.findIndex((e) => e.key === key);
      const entry = open[index];
      if (!entry) return;
      setEntries((now) => now.filter((e) => e.key !== key));
      setRefused((now) => {
        if (!now.has(key)) return now;
        const next = new Map(now);
        next.delete(key);
        return next;
      });
      const next = open[index + 1] ?? open[index - 1];
      focusAfter.current = next ? { key: next.key, role: 'remove' } : { key: '', role: 'empty' };
      announce(`Removed ${entry.propertyName}.`);
    },
    [rules, open, setEntries, announce],
  );

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
    for (const entry of open) {
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
  }, [open, queueFor]);

  // ---- dragging -----------------------------------------------------------

  const [drag, setDrag] = useState<{ readonly key: string; readonly over: number | null } | null>(null);

  const dragProps = (entry: QueueEntry, index: number) => ({
    onDragOver: (event: DragEvent<HTMLLIElement>) => {
      if (!drag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      const at = index + (event.clientY > box.top + box.height / 2 ? 1 : 0);
      if (drag.over !== at) setDrag({ key: drag.key, over: at });
    },
    onDrop: (event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      if (!drag || drag.over === null) return;
      const from = open.findIndex((e) => e.key === drag.key);
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
    const from = open.findIndex((e) => e.key === drag.key);
    if (drag.over === from || drag.over === from + 1) return null; // it wouldn't move
    if (drag.over === index) return 'before';
    if (drag.over === open.length && index === open.length - 1) return 'after';
    return null;
  };

  // ---- switching intern or week ---------------------------------------------

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

  const requestWeek = (next: string) => {
    if (next === week) return;
    if (dirty) ask({ kind: 'week', value: next });
    else onWeekChange(next);
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
    setDraftState((d) => ({ ...d, entries: baseline }));
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
    else if (next) onWeekChange(next.value);
  };

  // ---- saving ---------------------------------------------------------------

  const save = async () => {
    if (!rules || intern === null || saving || loading || over) return;
    const result = rules.validate(entries);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    const snapshot = entries;
    const forQueue = queueFor;
    const rowsWhenSaved = assignments;
    setSaving(true);
    setProblems([]);
    setRefused(new Map());
    try {
      await onSave({ week, assignedTo: intern, items: result.items });
      if (!mounted.current) return;
      setSaved({ for: forQueue, entries: snapshot, assignments: rowsWhenSaved });
      setAddedNote(null);
      setFill(null);
      setFillNote(null);
      setSavedNote(true);
      announce(`Saved. ${plural(snapshot.length, 'listing', 'listings')} for ${weekLabel(week)}.`);
    } catch (e) {
      if (!mounted.current) return;
      const refusals = heldOf(e);
      if (refusals) {
        const marks = new Map<string, string>();
        for (const h of refusals) {
          const entry = entries.find(
            (en) => (h.propertyId !== '' && en.propertyId === h.propertyId) || normalize(en.propertyName) === normalize(h.propertyName),
          );
          if (entry) marks.set(entry.key, heldWords(h, intern));
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

  // ---- links to what was posted ---------------------------------------------

  const linkOf = useMemo(() => {
    if (intern === null) return () => undefined;
    const theirs = posts
      .filter((p) => p.postLink && samePerson(p.postedBy, intern) && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && weekOf(p.date) === week)
      .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
    return (entry: QueueEntry): string | undefined => {
      const name = normalize(entry.propertyName);
      return theirs.find((p) => (entry.propertyId !== '' && p.propertyId === entry.propertyId) || normalize(p.title) === name)?.postLink;
    };
  }, [posts, intern, week]);

  // ---- the page -----------------------------------------------------------

  const waiting = loading && properties.length === 0;

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
          <div className="assign__header-end">
            <WeekPicker week={week} today={today} onChange={onWeekChange} />
            {onSaveQueues ? (
              <Button icon={<Icon name="assign" size={18} />} onClick={() => setFilling(true)} disabled={waiting}>
                Fill queues
              </Button>
            ) : null}
          </div>
        </header>
        {filling && onSaveQueues ? (
          <FillQueues
            interns={interns}
            properties={properties}
            posts={posts}
            assignments={assignments}
            rules={{ cooldownDays, repostDueDays, perWeek }}
            today={today}
            week={over ? weekOf(today) : week}
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
          <AssignPicker
            interns={interns}
            week={week}
            assignments={assignments}
            posts={posts}
            today={today}
            onPick={(name) => onInternChange(name)}
          />
        )}
        {announcer}
      </div>
    );
  }

  const pendingRows = entries.filter((e) => groupOf(e.key) === 'pending');
  const postedRows = entries.filter((e) => groupOf(e.key) === 'posted');
  const friday = shortDate(weekFriday(week));

  const header = (
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
        <p className="assign__due">{over ? `Ended ${friday}` : `Due ${friday}`}</p>
      </div>
      <WeekPicker week={week} today={today} onChange={requestWeek} />
    </header>
  );

  // Step two, a week that is over: what happened, read only.
  if (over) {
    const missed = open;
    return (
      <div className="page assign">
        {header}
        {errorNotice}
        <Card className="assign__review" padding="tight">
          {loading && entries.length === 0 ? (
            <div className="assign__waiting">
              <Spinner label="Loading the queue" />
              <span>Loading…</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="assign__quiet assign__empty">No queue that week.</p>
          ) : (
            <>
              <div className="assign-review__head">
                <p className="assign-review__sum tabular" role="status">
                  {postedRows.length} posted
                  {pendingRows.length > 0 ? ` · ${pendingRows.length} pending` : ''}
                  {' · '}
                  <span className={missed.length > 0 ? 'assign-review__missed' : undefined}>{missed.length} missed</span>
                </p>
                {missed.some((e) => e.property) ? (
                  <Button size="small" onClick={() => copyMissed(missed)}>
                    {nextOpen === addWeeks(week, 1) ? 'Copy missed to next week' : 'Copy missed to this week'}
                  </Button>
                ) : null}
              </div>
              <QueueGroup title="Missed" tone="danger" rows={missed} linkOf={() => undefined} onOpenLink={onOpenLink} />
              <QueueGroup title="Pending" tone="warn" rows={pendingRows} linkOf={linkOf} onOpenLink={onOpenLink} />
              <QueueGroup title="Posted" tone="ok" rows={postedRows} linkOf={linkOf} onOpenLink={onOpenLink} />
            </>
          )}
        </Card>
        {announcer}
      </div>
    );
  }

  // Step two: their queue for a week.
  const scope = tabLabel(tab, states);
  return (
    <div className="page assign">
      {header}

      {errorNotice}

      {pending ? (
        <Notice
          tone="warn"
          live
          className="assign__notice"
          title="Unsaved changes"
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
                Discard
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
          padding="tight"
          title={mode === 'library' ? 'Listings' : 'Paste a list'}
          actions={
            mode === 'library' ? (
              <div className="assign__add-actions">
                <QuickFill
                  count={fillCount}
                  onCount={setFillCount}
                  scope={scope}
                  onFill={(n) => quickFill(n, tab)}
                  disabled={rules === null || loading}
                />
                <MenuButton label="More actions" icon={<MoreIcon />} className="assign__more">
                  {(close) => (
                    <button
                      type="button"
                      className="menu__item"
                      onClick={() => {
                        close();
                        setMode('paste');
                      }}
                    >
                      Paste a list
                    </button>
                  )}
                </MenuButton>
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
              <span>Loading…</span>
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
              page={libraryPage}
              onPageChange={onLibraryPageChange}
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
                if (n > 0) setAddedNote(`Added ${n}.`);
              }}
              addedNote={addedNote}
            />
          )}
        </Card>

        <Card
          className="assign__queue"
          padding="tight"
          title="Queue"
          actions={<Badge count={entries.length} label={plural(entries.length, 'listing', 'listings')} />}
        >
          <div className="assign-queue__body">
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
              <span>Loading…</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="assign__empty">
              <p className="assign__quiet" ref={emptyRef} tabIndex={-1}>
                Nothing queued.
              </p>
              <Button size="small" disabled={rules === null || loading} onClick={() => quickFill(fillCount, tab)}>
                {scope === 'All' ? `Add ${fillCount}` : `Add ${fillCount} from ${scope}`}
              </Button>
            </div>
          ) : (
            <>
              {open.length > 0 ? (
                <section className="qgroup" aria-label="Not shared">
                  <h3 className="qgroup__title">
                    <span className="qgroup__dot qgroup__dot--neutral" aria-hidden="true" />
                    Not shared <span className="qgroup__count tabular">{open.length}</span>
                  </h3>
                  <ol className="assign-queue" aria-label="Not shared, in posting order">
                    {open.map((entry, index) => {
                      const dnd = dragProps(entry, index);
                      return (
                        <QueueRow
                          key={entry.key}
                          ref={(el) => {
                            if (el) rowRefs.current.set(entry.key, el);
                            else rowRefs.current.delete(entry.key);
                          }}
                          entry={entry}
                          index={index}
                          count={open.length}
                          rules={rules}
                          preview={fillKeys?.has(entry.key) ?? false}
                          refusal={refused.get(entry.key)}
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
                </section>
              ) : (
                <p className="assign__quiet assign__all-out" ref={emptyRef} tabIndex={-1}>
                  All shared.
                </p>
              )}
              <QueueGroup title="Pending" tone="warn" rows={pendingRows} linkOf={linkOf} onOpenLink={onOpenLink} />
              <QueueGroup title="Posted" tone="ok" rows={postedRows} linkOf={linkOf} onOpenLink={onOpenLink} />
            </>
          )}
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
              ) : dirty ? (
                <>
                  <Icon name="warn" size={18} className="assign-savebar__icon assign-savebar__icon--warn" />
                  Unsaved changes
                </>
              ) : savedNote ? (
                <>
                  <Icon name="pass" size={18} className="assign-savebar__icon assign-savebar__icon--ok" />
                  Saved
                </>
              ) : null}
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
        </Card>
      </div>
      {announcer}
    </div>
  );
}

interface QueueGroupProps {
  readonly title: 'Pending' | 'Posted' | 'Missed';
  readonly tone: 'warn' | 'ok' | 'danger';
  readonly rows: readonly QueueEntry[];
  readonly linkOf: (entry: QueueEntry) => string | undefined;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/** Pending, Posted or Missed: a heading with its count, then the listings. Nothing in it: not shown. */
function QueueGroup({ title, tone, rows, linkOf, onOpenLink }: QueueGroupProps) {
  if (rows.length === 0) return null;
  return (
    <section className="qgroup" aria-label={title}>
      <h3 className="qgroup__title">
        <span className={`qgroup__dot qgroup__dot--${tone}`} aria-hidden="true" />
        {title} <span className="qgroup__count tabular">{rows.length}</span>
      </h3>
      <ul className="done-list">
        {rows.map((entry) => (
          <DoneRow key={entry.key} entry={entry} link={title === 'Missed' ? undefined : linkOf(entry)} onOpenLink={onOpenLink} />
        ))}
      </ul>
    </section>
  );
}
