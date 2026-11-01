import { forwardRef, type DragEvent, type KeyboardEvent } from 'react';
import { CategoryTag, Icon, Pill } from '../../components';
import type { AssignRules, QueueEntry } from '@/core/summary';
import { PostingWarning, blockSentence } from './AssignParts';
import { ManagerIcon } from './ManagerIcon';

// ------------------------------------------------------------------ a queue row

export interface QueueRowProps {
  readonly entry: QueueEntry;
  readonly index: number;
  readonly count: number;
  readonly rules: AssignRules | null;
  /** Added in this draft: not saved yet. */
  readonly isNew: boolean;
  /** Put in by quick fill and not kept yet: shown highlighted until saved or undone. */
  readonly preview?: boolean | undefined;
  /** The server refused it on save: why, in a few words. */
  readonly refusal?: string | undefined;
  /** Moved from an earlier day's queue: "28 Oct". */
  readonly movedFrom?: string | undefined;
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

export const QueueRow = forwardRef<HTMLLIElement, QueueRowProps>(function QueueRow(
  { entry, index, count, rules, isNew, preview, refusal, movedFrom, dragging, dropMark, onMove, onRemove, onDragOver, onDrop, handle },
  ref,
) {
  const status = rules?.statusOf(entry.key);
  const started = rules?.isStarted(entry.key) ?? false;
  // A Not Shared item that has since become unpostable on this day: say so.
  const check = !started && entry.property && rules ? rules.check(entry.property) : null;
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
      <span className="queue-row__handle" title="Drag to change the order" aria-hidden="true" {...handle}>
        <ManagerIcon name="grip" size={18} />
      </span>
      <span className="queue-row__number tabular" aria-hidden="true">
        {index + 1}
      </span>
      <div className="queue-row__body">
        <p className="queue-row__name">{entry.propertyName}</p>
        <div className="queue-row__meta">
          {entry.property ? (
            <CategoryTag category={entry.property.category} />
          ) : (
            <Pill tone="danger">Folder not found</Pill>
          )}
          {status === 'Pending' ? (
            <Pill tone="warn" dot>
              Pending
            </Pill>
          ) : status === 'Posted' ? (
            <Pill tone="ok" dot>
              Posted
            </Pill>
          ) : movedFrom ? (
            <Pill tone="info">Moved from {movedFrom}</Pill>
          ) : isNew && !preview ? (
            <Pill tone="neutral">Not saved</Pill>
          ) : null}
        </div>
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
        {!entry.property && !started ? (
          <p className="assign-warning">
            <Icon name="warn" size={16} className="assign-warning__icon" />
            <span>Its folder isn&rsquo;t in the library any more. Remove it, then add the listing again under its new name.</span>
          </p>
        ) : null}
        {entry.property && !started ? <PostingWarning property={entry.property} className="assign-warning" /> : null}
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
      {started ? (
        <span className="queue-row__kept" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="queue-row__remove"
          data-role="remove"
          aria-label={`Remove ${entry.propertyName}`}
          title="Remove from the queue"
          onClick={onRemove}
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </li>
  );
});
