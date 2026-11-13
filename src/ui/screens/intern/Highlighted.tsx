import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Highlight } from '@/core/highlights';
import { Button, Card } from '../../components';
import { paths, sentenceOf, type FromList } from '../../state';
import './Highlighted.css';

export interface HighlightedProps {
  /** The listings to advertise first, newest first. Nothing is shown when empty. */
  readonly highlights: readonly Highlight[];
  /** Where a listing's page goes back to. */
  readonly from: FromList;
  /** Admins: take one off the list. Resolve once saved; reject to have the sentence shown. */
  readonly onRemove?: ((highlight: Highlight) => Promise<unknown>) | undefined;
}

/**
 * The listings an admin highlighted (1.1.6): they need advertising now. On
 * My queue for every agent; on Assign for admins, with Remove. Fill queues
 * and Add give them out first.
 */
export function Highlighted({ highlights, from, onRemove }: HighlightedProps) {
  if (highlights.length === 0) return null;
  return (
    <Card className="highlighted" title={highlights.length === 1 ? 'Highlighted listing' : `${highlights.length} highlighted listings`} description="Advertise these first.">
      <ol className="highlighted__list">
        {highlights.map((h) => (
          <HighlightRow key={h.propertyId} highlight={h} from={from} onRemove={onRemove} />
        ))}
      </ol>
    </Card>
  );
}

function HighlightRow({ highlight, from, onRemove }: { readonly highlight: Highlight; readonly from: FromList; readonly onRemove?: HighlightedProps['onRemove'] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = highlight.property || highlight.propertyId;

  const remove = async () => {
    if (!onRemove || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove(highlight);
    } catch (err) {
      setError(sentenceOf(err));
      setBusy(false);
    }
  };

  return (
    <li className="highlighted__row">
      <div className="highlighted__what">
        <Link className="highlighted__name" to={paths.property(highlight.propertyId)} state={from}>
          {name}
        </Link>
        {highlight.note ? <span className="highlighted__note">{highlight.note}</span> : null}
        {onRemove && highlight.by ? <span className="highlighted__meta">By {highlight.by}</span> : null}
        {error ? <span className="highlighted__error">{error}</span> : null}
      </div>
      {onRemove ? (
        <Button size="small" variant="quiet" busy={busy} onClick={() => void remove()} aria-label={`Remove the highlight on ${name}`}>
          Remove
        </Button>
      ) : null}
    </li>
  );
}
