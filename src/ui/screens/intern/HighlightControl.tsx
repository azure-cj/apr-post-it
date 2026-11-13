import { useState, type FormEvent } from 'react';
import { HIGHLIGHT_NOTE_MAX } from '@/core/highlights';
import { Button, Card, Notice, TextInput } from '../../components';
import { sentenceOf, useApp, useHighlights, useNotify } from '../../state';

export interface HighlightControlProps {
  readonly propertyId: string;
  readonly property: string;
  /** An admin: may highlight it, change the note, or remove it. */
  readonly manager: boolean;
}

/**
 * A listing's highlight (1.1.6). An agent sees it when it is highlighted, with
 * the admin's note. An admin highlights it, changes the note, or removes it:
 * a highlighted listing tops every agent's My queue and is given out first.
 */
export function HighlightControl({ propertyId, property, manager }: HighlightControlProps) {
  const app = useApp();
  const notify = useNotify();
  const highlights = useHighlights({ maxAgeMs: 60_000 });
  const current = (highlights.data ?? []).find((h) => h.propertyId === propertyId) ?? null;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!manager) {
    if (!current) return null;
    return (
      <Notice tone="info" title="Highlighted" className="highlight-control">
        {current.note || 'Advertise this one first.'}
      </Notice>
    );
  }
  // An admin's control waits for the list, so it never offers Highlight on one already highlighted.
  if (highlights.data === null) return null;

  const save = async (on: boolean, text = '') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await app.tracker.setHighlight({ propertyId, property, on, note: text.trim() });
      notify(on ? (current ? 'Note saved.' : `Highlighted: ${property}.`) : `No longer highlighted: ${property}.`, 'ok');
      setEditing(false);
    } catch (err) {
      setError(sentenceOf(err));
    } finally {
      setBusy(false);
    }
  };

  const startEditing = () => {
    setNote(current?.note ?? '');
    setError(null);
    setEditing(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(true, note);
  };

  return (
    <Card title="Highlight" headingLevel={2} padding="tight" className="highlight-control">
      {editing ? (
        <form className="highlight-control__form" onSubmit={submit}>
          <TextInput
            label="Note for the agents (optional)"
            value={note}
            maxLength={HIGHLIGHT_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Owner wants it out this week"
            autoFocus
          />
          <div className="highlight-control__actions">
            <Button type="submit" variant="primary" size="small" busy={busy}>
              {current ? 'Save note' : 'Highlight'}
            </Button>
            <Button size="small" variant="quiet" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : current ? (
        <>
          <p className="highlight-control__line">
            Highlighted{current.by ? ` by ${current.by}` : ''}. {current.note ? `“${current.note}”` : 'No note.'}
          </p>
          <div className="highlight-control__actions">
            <Button size="small" onClick={startEditing} disabled={busy}>
              Edit note
            </Button>
            <Button size="small" variant="quiet" busy={busy} onClick={() => void save(false)}>
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="highlight-control__line meta">Tops every agent's My queue and goes out first in Fill queues.</p>
          <div className="highlight-control__actions">
            <Button size="small" onClick={startEditing}>
              Highlight
            </Button>
          </div>
        </>
      )}
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
    </Card>
  );
}
