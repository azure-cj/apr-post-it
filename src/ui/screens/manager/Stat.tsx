import { Card } from '../../components';
import './Stat.css';

export interface StatProps {
  readonly label: string;
  readonly value: number;
  /** "2 of 4": the second number. */
  readonly of?: number | undefined;
  readonly note?: string | undefined;
}

/**
 * A number and what it counts, as a tile in a `<dl className="tracker-stats">`.
 * Zero is shown, in the muted colour, never hidden.
 */
export function Stat({ label, value, of, note }: StatProps) {
  return (
    <Card padding="tight" className="tracker-stat">
      <dt className="tracker-stat__label">{label}</dt>
      <dd className={['tracker-stat__value', 'tabular', value === 0 ? 'tracker-stat__value--zero' : null].filter(Boolean).join(' ')}>
        {value.toLocaleString('en-PH')}
        {of !== undefined ? <span className="tracker-stat__of"> of {of.toLocaleString('en-PH')}</span> : null}
      </dd>
      {note ? <dd className="tracker-stat__note">{note}</dd> : null}
    </Card>
  );
}
