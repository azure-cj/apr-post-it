import { useRef, useState } from 'react';
import { Button, Icon, Notice } from '../../components';
import { firstName } from '@/core/summary';
import { UserFacingError } from '@/core/types';
import { Dialog } from './Dialog';

/** Said when a call fails without a sentence of its own. */
export const FAILED = "That didn't work. Check your connection, then try again.";

/** The error's own sentence when it has one; otherwise FAILED. */
export const sentence = (err: unknown) => (err instanceof UserFacingError ? err.message : FAILED);

/** Asked first. Focus starts on Cancel, so Enter or Escape changes nothing. */
export function ConfirmAction({
  title,
  body,
  confirmLabel,
  busyLabel,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(sentence(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={busy}
      initialFocus={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void confirm()}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

/** A key, shown this once. Closing forgets it. */
export function KeyOnce({
  name,
  keyText,
  added,
  warning,
  onCopy,
  onClose,
}: {
  readonly name: string;
  readonly keyText: string;
  readonly added: boolean;
  readonly warning?: string | undefined;
  readonly onCopy?: ((text: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  const doneRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={added ? `${name} added` : `New key for ${name}`}
      onClose={onClose}
      initialFocus={doneRef}
      actions={
        <Button ref={doneRef} variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="m-key">
        <span className="m-key__value" aria-label={`${firstName(name)}'s key`}>
          {keyText}
        </span>
        {onCopy ? (
          <Button size="small" variant="quiet" onClick={() => onCopy(keyText)} aria-label="Copy the key">
            Copy
          </Button>
        ) : null}
      </div>
      <p className="settings__once">
        <Icon name="warn" size={18} />
        You won&rsquo;t see this again. Send it to {firstName(name)} privately.
      </p>
      {warning ? (
        <Notice tone="warn" title="Profile link not saved">
          {warning}
        </Notice>
      ) : null}
    </Dialog>
  );
}
