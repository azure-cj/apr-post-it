import { Button, CategoryTag } from '../../components';
import type { QueueEntry } from '@/core/summary';
import { dayMonth } from './assignListing';

/** One of the intern's Not Shared items from an earlier day: it still holds its listing. */
export interface CarriedItem extends QueueEntry {
  /** The queue it's in, yyyy-MM-dd. */
  readonly date: string;
}

export interface CarriedProps {
  readonly items: readonly CarriedItem[];
  readonly onMove: (item: CarriedItem) => void;
  readonly onRelease: (item: CarriedItem) => void;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
}

/** "Still not shared from earlier (3)": move each to this day, or remove it to free it. */
export function Carried({ items, onMove, onRelease, open, onToggle }: CarriedProps) {
  if (items.length === 0) return null;
  return (
    <details
      className="carried"
      open={open}
      onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="carried__summary">
        Still not shared from earlier <span className="tabular">({items.length})</span>
      </summary>
      <ul className="carried__list">
        {items.map((item) => (
          <li key={item.key} className="carried__row">
            <div className="carried__body">
              <p className="carried__name">{item.propertyName}</p>
              <p className="carried__meta">
                {item.property ? <CategoryTag category={item.property.category} /> : null}
                <span>Since {dayMonth(item.date)}</span>
              </p>
            </div>
            <div className="carried__actions">
              <Button size="small" aria-label={`Move ${item.propertyName} to this day`} onClick={() => onMove(item)}>
                Move to this day
              </Button>
              <Button
                size="small"
                variant="quiet"
                aria-label={`Remove ${item.propertyName} from ${dayMonth(item.date)}`}
                onClick={() => onRelease(item)}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
