import { forwardRef, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { CategoryDot, Icon, Pill, categoryKind } from '../../components';
import type { AssignRules, QueueEntry } from '@/core/summary';
import { PostingWarning, blockSentence } from './AssignParts';
import { ManagerIcon } from './ManagerIcon';

// ------------------------------------------------------------------ a Not shared row

export interface QueueRowProps {
  readonly entry: QueueEntry;
  /** Its place among the Not shared rows (the list is ordered: its number is read with it). */
  readonly index: number;
  readonly count: number;
  readonly rules: AssignRules | null;
  /** Put in by quick fill (or copied from last week) and not kept yet: tinted until saved or undone. */
  readonly preview?: boolean | undefined;
  /** The server refused it on save: why, in a few words. */
  readonly refusal?: string | undefined;
  readonly dragging: boolean;
  readonly dropMark: 'before' | 'after' | null;
  readonly onMove: (by: number, role: string) => void;
  readonly onRemove: () => void;
  readonly onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLLIElement>) => void;
  readonly handle: {
    readonly draggable: boolean;
    readonly onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
    readonly onDragEnd: () => void;
  };
}

/** One listing still to be shared: it can be dragged, moved with Alt+Up/Down, or removed. */
export const QueueRow = forwardRef<HTMLLIElement, QueueRowProps>(function QueueRow(
  { entry, index, count, rules, preview, refusal, dragging, dropMark, onMove, onRemove, onDragOver, onDrop, handle },
  ref,
) {
  // A listing that has since become unpostable this week: say so.
  const check = entry.property && rules ? rules.check(entry.property) : null;
  const warning = check && !check.canAdd ? blockSentence(check, rules?.intern ?? null) : null;
  const first = index === 0;
  const last = index === count - 1;

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const role = (event.target as HTMLElement).dataset['role'] ?? 'up';
    onMove(event.key === 'ArrowUp' ? -1 : 1, role);
  };

  return (
    <li
      ref={ref}
      className={[
        'queue-row',
        preview ? 'queue-row--preview' : null,
        refusal ? 'queue-row--refused' : null,
        dragging ? 'queue-row--dragging' : null,
        dropMark ? `queue-row--drop-${dropMark}` : null,
      ]
        .filter(Boolean)
        .join(' ')}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="queue-row__handle" title="Drag to reorder" aria-hidden="true" {...handle}>
        <ManagerIcon name="grip" size={18} />
      </span>
      <div className="queue-row__body">
        <p className="queue-row__name">
          {entry.property ? <CategoryDot kind={categoryKind(entry.property.category)} /> : null}
          <span>{entry.propertyName}</span>
        </p>
        {!entry.property ? (
          <div className="queue-row__meta">
            <Pill tone="danger">Not in the library</Pill>
          </div>
        ) : null}
        {refusal ? (
          <p className="assign-refusal">
            <Icon name="fail" size={16} className="assign-warning__icon" />
            <span>{refusal}</span>
          </p>
        ) : null}
        {warning && !refusal ? (
          <p className="assign-warning">
            <Icon name="warn" size={16} className="assign-warning__icon" />
            <span>{warning}</span>
          </p>
        ) : null}
        {entry.property ? <PostingWarning property={entry.property} className="assign-warning" /> : null}
      </div>
      <div className="queue-row__move">
        <button
          type="button"
          className="queue-row__arrow"
          data-role="up"
          aria-label={`Move ${entry.propertyName} up`}
          aria-keyshortcuts="Alt+ArrowUp"
          aria-disabled={first || undefined}
          title="Move up (Alt+Up)"
          onClick={() => {
            if (!first) onMove(-1, 'up');
          }}
        >
          <ManagerIcon name="chevronUp" size={18} />
        </button>
        <button
          type="button"
          className="queue-row__arrow"
          data-role="down"
          aria-label={`Move ${entry.propertyName} down`}
          aria-keyshortcuts="Alt+ArrowDown"
          aria-disabled={last || undefined}
          title="Move down (Alt+Down)"
          onClick={() => {
            if (!last) onMove(1, 'down');
          }}
        >
          <ManagerIcon name="chevronDown" size={18} />
        </button>
      </div>
      <button
        type="button"
        className="queue-row__remove"
        data-role="remove"
        aria-label={`Remove ${entry.propertyName}`}
        title="Remove"
        onClick={onRemove}
      >
        <Icon name="close" size={18} />
      </button>
    </li>
  );
});

// ------------------------------------------------------------------ a read-only row

export interface DoneRowProps {
  readonly entry: QueueEntry;
  /** The post on Facebook, when the Posts tab has its link. */
  readonly link?: string | undefined;
  /** Opens the link (the desktop app opens it in the browser). Default: the link's own behaviour. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/** Pending, Posted or Missed: the listing, and for a post its link. Nothing to change. */
export function DoneRow({ entry, link, onOpenLink }: DoneRowProps) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenLink || !link) return;
    event.preventDefault();
    onOpenLink(link);
  };
  return (
    <li className="done-row">
      <p className="queue-row__name done-row__name">
        {entry.property ? <CategoryDot kind={categoryKind(entry.property.category)} /> : null}
        <span>{entry.propertyName}</span>
      </p>
      {link ? (
        <a
          className="done-row__link"
          href={link}
          target="_blank"
          rel="noreferrer"
          onClick={open}
          aria-label={`Open the post of ${entry.propertyName}`}
        >
          Open post
        </a>
      ) : null}
    </li>
  );
}
