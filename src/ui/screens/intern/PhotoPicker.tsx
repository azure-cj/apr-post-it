import { useRef, useState } from 'react';
import type { Photo } from '@/core/types';
import { Button } from '../../components';
import { sentenceOf } from '../../state';
import { Dialog } from '../manager/Dialog';
import { count } from './format';
import './PhotoPicker.css';

export interface PhotoPickerProps {
  readonly property: string;
  readonly photos: readonly Photo[];
  /** The ticked photos, in the folder's order. */
  readonly onDownload: (photos: readonly Photo[]) => void;
  readonly onClose: () => void;
  /**
   * Puts one photo on the clipboard, full size from Drive (AID-245). `label`
   * is how the dialog names it, "Photo 3". Rejects with why when it can't.
   * Without it, no Copy buttons.
   */
  readonly onCopy?: ((photo: Photo, label: string) => Promise<void>) | undefined;
}

/**
 * Pick which photos to download. All start ticked, so Enter on the open dialog
 * still downloads them all, as the old "Download all" did.
 */
export function PhotoPicker({ property, photos, onDownload, onClose, onCopy }: PhotoPickerProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(photos.map((p) => p.id)));
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  const all = ticked.size === photos.length;
  const chosen = photos.filter((p) => ticked.has(p.id));

  const copy = async (photo: Photo, label: string) => {
    if (!onCopy || copying) return;
    setCopying(photo.id);
    setCopied(null);
    try {
      await onCopy(photo, label);
      setCopied({ ok: true, text: `${label} copied. Paste it into Facebook with Ctrl+V.` });
    } catch (err) {
      setCopied({ ok: false, text: sentenceOf(err) });
    } finally {
      setCopying(null);
    }
  };

  const toggle = (id: string) =>
    setTicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      title="Download photos"
      size="wide"
      className="picker"
      onClose={onClose}
      initialFocus={downloadRef}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button ref={downloadRef} variant="primary" disabled={chosen.length === 0} onClick={() => onDownload(chosen)}>
            {chosen.length === 0 ? 'Download' : `Download ${count(chosen.length, 'photo', 'photos')}`}
          </Button>
        </>
      }
    >
      <p className="picker__property">{property}</p>
      <div className="picker__bar">
        <p className="meta" aria-live="polite">
          <strong className="tabular">{chosen.length}</strong> of {count(photos.length, 'photo', 'photos')} ticked, full size from Drive.
        </p>
        <Button size="small" variant="quiet" onClick={() => setTicked(all ? new Set() : new Set(photos.map((p) => p.id)))}>
          {all ? 'Untick all' : 'Tick all'}
        </Button>
      </div>
      {onCopy ? (
        <p className={copied && !copied.ok ? 'picker__copied picker__copied--failed' : 'picker__copied meta'} role="status">
          {copied ? copied.text : 'Copy puts one photo on the clipboard, to paste straight into Facebook.'}
        </p>
      ) : null}
      <ul className="picker__grid">
        {photos.map((photo, i) => (
          <li key={photo.id} className="picker__item">
            <label className={ticked.has(photo.id) ? 'picker__tile picker__tile--on' : 'picker__tile'}>
              <input
                type="checkbox"
                className="picker__check"
                checked={ticked.has(photo.id)}
                onChange={() => toggle(photo.id)}
                aria-label={`Photo ${i + 1} of ${photos.length}`}
              />
              <Thumb photo={photo} label={`Photo ${i + 1}`} />
              <span className="picker__mark" aria-hidden="true" />
            </label>
            {onCopy ? (
              <Button
                size="small"
                className="picker__copy"
                busy={copying === photo.id}
                disabled={copying !== null}
                aria-label={`Copy photo ${i + 1}`}
                onClick={() => void copy(photo, `Photo ${i + 1}`)}
              >
                {copying === photo.id ? 'Copying…' : 'Copy'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** A photo's thumbnail, or its number when Drive gives none or it fails to load. */
export function Thumb({ photo, label }: { readonly photo: Photo; readonly label: string }) {
  const [failed, setFailed] = useState(false);
  if (!photo.thumb || failed) {
    return (
      <span className="photos__tile" aria-hidden="true">
        {label}
      </span>
    );
  }
  return <img className="photos__img" src={photo.thumb} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
