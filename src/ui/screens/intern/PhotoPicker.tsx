import { useRef, useState } from 'react';
import type { Photo } from '@/core/types';
import { Button } from '../../components';
import { Dialog } from '../manager/Dialog';
import { count } from './format';
import './PhotoPicker.css';

export interface PhotoPickerProps {
  readonly property: string;
  readonly photos: readonly Photo[];
  /** The ticked photos, in the folder's order. */
  readonly onDownload: (photos: readonly Photo[]) => void;
  readonly onClose: () => void;
}

/**
 * Pick which photos to download. All start ticked, so Enter on the open dialog
 * still downloads them all, as the old "Download all" did.
 */
export function PhotoPicker({ property, photos, onDownload, onClose }: PhotoPickerProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(photos.map((p) => p.id)));
  const downloadRef = useRef<HTMLButtonElement>(null);
  const all = ticked.size === photos.length;
  const chosen = photos.filter((p) => ticked.has(p.id));

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
