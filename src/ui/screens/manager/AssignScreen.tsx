import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Button, Card, Chip, EmptyState, Icon, Notice, Spinner } from '../../components';
import {
  assignRules,
  firstName,
  matchPasted,
  moveEntry,
  plural,
  samePerson,
  sameQueue,
  searchProperties,
  shortDate,
  type AssignRules,
  type DirectoryRow,
  type QueueEntry,
  type Rules,
} from '@/core/summary';
import type { QueueItemInput } from '@/core/tracker';
import { UserFacingError, type Assignment, type PostLogEntry, type Property } from '@/core/types';
import { PastePanel, type Matched } from './AssignPaste';
import { SearchPanel } from './AssignSearch';
import { DayPicker } from './DayPicker';
import { QueueRow } from './QueueRow';
import './AssignScreen.css';

/** What Save hands over: `tracker.saveQueue(save.date, save.assignedTo, save.items)` fits. */
export interface QueueSave {
  /** The queue's day, yyyy-MM-dd. */
  readonly date: string;
  /** Whose queue, exactly as the `intern` prop spelled it: the server matches names with ===. */
  readonly assignedTo: string;
  /** In posting order. An item already saved keeps its status; a new one is To post. */
  readonly items: readonly QueueItemInput[];
}

export interface AssignScreenProps {
  /** Whose queues can be built: the team's interns, in the order to show them. */
  readonly interns: readonly string[];
  /** Whose queue is shown, or null before anyone is chosen. */
  readonly intern: string | null;
  /** The queue's day, yyyy-MM-dd. The prototype opened on tomorrow. */
  readonly date: string;
  /** Today on the tracker's calendar, yyyy-MM-dd: for the Today and Tomorrow picks and "posted 2 days ago". */
  readonly today: string;
  /** Every listing in the directory. With its Issues text, a listing that can't be posted says so. */
  readonly properties: readonly DirectoryRow[];
  /** Every Posts row: the cooldown is judged from them. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row: this queue as saved, and who else has what that day. Read again after a save. */
  readonly assignments: readonly Assignment[];
  /** The cooldown and repost-due days. */
  readonly settings: Rules;
  /** Show another intern's queue. Only called once unsaved changes are saved or discarded. */
  readonly onInternChange: (intern: string) => void;
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
}

type Mode = 'search' | 'paste';

interface Draft {
  /** Whose queue and which day these entries are for. */
  readonly for: string;
  /** The saved queue they were last compared with. */
  readonly base: readonly QueueEntry[];
  readonly entries: readonly QueueEntry[];
}

interface Pending {
  readonly kind: 'intern' | 'date';
  readonly value: string;
}

interface FocusTarget {
  readonly key: string;
  readonly role: string;
}

const COULD_NOT_SAVE = "Couldn't save the queue. Check your connection, then save again.";

/** The draft's own copy after a save, until the rows are read again. */
interface Saved {
  readonly for: string;
  readonly entries: readonly QueueEntry[];
  readonly assignments: readonly Assignment[];
}

/**
 * Build one intern's queue for one day: search the library or paste a typed
 * list, put the listings in posting order, and save. A listing in its
 * cooldown on that day, or already in someone else's queue, can't be added,
 * and says why. Nothing is written until Save.
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
  onInternChange,
  onDateChange,
  onSave,
  onDirtyChange,
  loading = false,
  error,
  search,
}: AssignScreenProps) {
  const { cooldownDays, repostDueDays } = settings;
  const rules = useMemo<AssignRules | null>(
    () =>
      intern === null
        ? null
        : assignRules({
            intern,
            date,
            today,
            posts,
            assignments,
            properties,
            settings: { cooldownDays, repostDueDays },
          }),
    [intern, date, today, posts, assignments, properties, cooldownDays, repostDueDays],
  );

  const queueFor = `${intern ?? ''}|${date}`;
  const first = intern === null ? '' : firstName(intern);
  const day = shortDate(date);

  // ---- the draft, and what it is compared with --------------------------

  const [saved, setSaved] = useState<Saved | null>(null);
  const baseline: readonly QueueEntry[] =
    saved && saved.for === queueFor && saved.assignments === assignments ? saved.entries : (rules?.saved ?? []);

  const [draftState, setDraftState] = useState<Draft>(() => ({ for: queueFor, base: baseline, entries: baseline }));
  let draft = draftState;
  if (draft.for !== queueFor) {
    // Another intern or day: start from what is saved there.
    draft = { for: queueFor, base: baseline, entries: baseline };
    setDraftState(draft);
  } else if (!sameQueue(draft.base, baseline)) {
    // The rows were read again. Untouched, the draft follows them; edited, it is kept.
    draft = { for: queueFor, base: baseline, entries: sameQueue(draft.entries, draft.base) ? baseline : draft.entries };
    setDraftState(draft);
  }
  const entries = draft.entries;
  const dirty = intern !== null && !sameQueue(entries, baseline);
  const inQueue = useMemo(() => new Set(entries.map((e) => e.key)), [entries]);

  const setEntries = useCallback((change: (entries: readonly QueueEntry[]) => readonly QueueEntry[]) => {
    setDraftState((d) => ({ ...d, entries: change(d.entries) }));
  }, []);

  // ---- what the screen says ---------------------------------------------

  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // A repeat of the same words is still news.
    setAnnouncement((now) => (now === text ? `${text} ` : text));
  }, []);

  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [matched, setMatched] = useState<Matched | null>(null);

  // A different queue starts clean: its own notes, no matches from the last one.
  const lastQueue = useRef(queueFor);
  useEffect(() => {
    if (lastQueue.current === queueFor) return;
    lastQueue.current = queueFor;
    setProblems([]);
    setSavedNote(null);
    setAddedNote(null);
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

  const add = useCallback(
    (picked: readonly Property[]): number => {
      if (!rules) return 0;
      const fresh: QueueEntry[] = [];
      for (const property of picked) {
        const entry = rules.entryFor(property);
        if (inQueue.has(entry.key) || fresh.some((e) => e.key === entry.key)) continue;
        if (!rules.check(property).canAdd) continue;
        fresh.push(entry);
      }
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
    [rules, inQueue, setEntries, entries.length, first, announce],
  );

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
      const next = entries[index + 1] ?? entries[index - 1];
      focusAfter.current = next ? { key: next.key, role: 'remove' } : { key: '', role: 'empty' };
      announce(`Removed ${entry.propertyName}.`);
    },
    [rules, entries, setEntries, announce],
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

  const requestIntern = (name: string) => {
    if (intern !== null && samePerson(name, intern)) return;
    if (dirty) ask({ kind: 'intern', value: name });
    else onInternChange(name);
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

  const discard = () => {
    const next = pending;
    setPending(null);
    setEntries(() => baseline);
    setProblems([]);
    setAddedNote(null);
    if (next?.kind === 'intern') onInternChange(next.value);
    else if (next) onDateChange(next.value);
  };

  // ---- saving ---------------------------------------------------------------

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
    setSaving(true);
    setProblems([]);
    try {
      await onSave({ date, assignedTo: intern, items: result.items });
      if (!mounted.current) return;
      setSaved({ for: forQueue, entries: snapshot, assignments: rowsWhenSaved });
      setAddedNote(null);
      setSavedNote(
        snapshot.length === 0
          ? `Saved. ${first} has nothing queued for ${day}.`
          : `Saved. ${first} has ${plural(snapshot.length, 'listing', 'listings')} for ${day}.`,
      );
    } catch (e) {
      if (mounted.current) setProblems([e instanceof UserFacingError ? e.message : COULD_NOT_SAVE]);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const undo = () => {
    setEntries(() => baseline);
    setProblems([]);
    setAddedNote(null);
    announce('Changes undone.');
  };

  // ---- search and paste -----------------------------------------------------

  const results = useMemo(
    () => (search ? search(query) : searchProperties(properties, query)),
    [search, properties, query],
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

  const people = intern !== null && !interns.some((n) => samePerson(n, intern)) ? [...interns, intern] : interns;
  const waiting = loading && properties.length === 0;

  return (
    <div className="page assign">
      <header className="page-header">
        <h1 className="page-header__title" tabIndex={-1}>
          Assign
        </h1>
        <p className="page-header__description">
          Build each intern&rsquo;s queue for a day. A listing in its cooldown, or already in someone else&rsquo;s
          queue that day, can&rsquo;t be added.
        </p>
      </header>

      {error ? (
        <Notice tone="danger" live className="assign__notice">
          {error}
        </Notice>
      ) : null}

      {people.length === 0 ? (
        <Card>
          <EmptyState title="Nobody to assign yet">
            Interns are added on the Team tab of the private admin sheet. Once someone is there, you can build their
            queue here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="assign__controls">
            <div className="assign__control">
              <span className="assign__label" id="assign-intern-label">
                Intern
              </span>
              <div className="assign__interns" role="group" aria-labelledby="assign-intern-label">
                {people.map((name) => (
                  <Chip
                    key={name}
                    selected={intern !== null && samePerson(name, intern)}
                    onSelectedChange={() => requestIntern(name)}
                  >
                    {name}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="assign__control">
              <span className="assign__label" aria-hidden="true">
                Day
              </span>
              <DayPicker date={date} today={today} onChange={requestDate} label="Day" quick={['today', 'tomorrow']} />
            </div>
          </div>

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
                      ? `Discard and open ${firstName(pending.value)}'s queue`
                      : `Discard and open ${shortDate(pending.value)}`}
                  </Button>
                </div>
              }
            >
              Save them first, or discard them to move on.
            </Notice>
          ) : null}

          <div className="assign__panes">
            <Card
              className="assign__add"
              title="Add listings"
              actions={
                <div className="assign__modes" role="group" aria-label="How to add">
                  <Chip selected={mode === 'search'} onSelectedChange={() => setMode('search')}>
                    Search
                  </Chip>
                  <Chip selected={mode === 'paste'} onSelectedChange={() => setMode('paste')}>
                    Paste a list
                  </Chip>
                </div>
              }
            >
              {waiting ? (
                <div className="assign__waiting">
                  <Spinner label="Loading the library" />
                  <span>Loading the library…</span>
                </div>
              ) : mode === 'search' ? (
                <SearchPanel
                  query={query}
                  onQuery={setQuery}
                  results={results}
                  total={properties.length}
                  rules={rules}
                  inQueue={inQueue}
                  today={today}
                  intern={intern}
                  onAdd={(p) => add([p])}
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
              title={intern === null ? 'Queue' : `${first}'s queue`}
              description={
                intern === null ? 'Choose an intern.' : `${day} · ${plural(entries.length, 'listing', 'listings')}, in posting order`
              }
            >
              {intern === null ? (
                <p className="assign__quiet">Choose whose queue to build.</p>
              ) : loading && entries.length === 0 ? (
                <div className="assign__waiting">
                  <Spinner label="Loading the queue" />
                  <span>Loading the queue…</span>
                </div>
              ) : entries.length === 0 ? (
                <p className="assign__quiet assign__empty" ref={emptyRef} tabIndex={-1}>
                  Nothing in {first}&rsquo;s queue for {day} yet. Search the library or paste a list to add listings.
                </p>
              ) : (
                <ol className="assign-queue" aria-label={`${first}'s queue, in posting order`}>
                  {entries.map((entry, index) => {
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
                        count={entries.length}
                        rules={rules}
                        isNew={!baseline.some((b) => b.key === entry.key)}
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
              {intern !== null ? (
                <p className="assign__hint">
                  {first} works this list top to bottom on {day}. To reorder, drag a handle or use the arrows (Alt+Up,
                  Alt+Down).
                </p>
              ) : null}
            </Card>
          </div>

          {problems.length > 0 ? (
            <Notice tone="danger" live className="assign__notice" title="The queue wasn't saved">
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
              ) : intern !== null ? (
                `${first}'s queue for ${day} is saved.`
              ) : (
                'Choose an intern to build a queue.'
              )}
            </p>
            <div className="assign-savebar__actions">
              <Button variant="quiet" disabled={!dirty || saving} onClick={undo}>
                Undo changes
              </Button>
              <Button
                variant="primary"
                busy={saving}
                disabled={!dirty || rules === null || loading}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save queue'}
              </Button>
            </div>
          </div>
        </>
      )}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
