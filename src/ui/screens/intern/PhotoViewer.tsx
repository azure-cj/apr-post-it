import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Photo } from '@/core/types';
import { Button } from '../../components';
import './PhotoViewer.css';

/**
 * The photo at a size worth looking at. Drive thumbnails are asked for at
 * w640 in the grid; the same link with a bigger size gives the large one.
 * Without a thumbnail link, the photo's own link stands in.
 */
export function largeOf(photo: Photo): string {
  if (photo.thumb && /[?&]sz=w\d+/.test(photo.thumb)) return photo.thumb.replace(/([?&]sz=)w\d+/, '$1w1600');
  return photo.thumb || photo.url;
}

/**
 * One photo, large, over the screen. ← and → move through them, Esc closes,
 * and focus goes back to the thumbnail it was opened from.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  readonly photos: readonly Photo[];
  readonly index: number;
  readonly onIndex: (index: number) => void;
  readonly onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const total = photos.length;
  const photo = photos[index];
  const go = (step: number) => onIndex((index + step + total) % total);

  // Latest handlers for the one document listener.
  const keys = useRef({ go, onClose });
  keys.current = { go, onClose };

  useLayoutEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') keys.current.go(1);
      else if (event.key === 'ArrowLeft') keys.current.go(-1);
      else if (event.key === 'Escape') keys.current.onClose();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const [failed, setFailed] = useState<string | null>(null);
  if (!photo) return null;
  const src = largeOf(photo);
  const label = `Photo ${index + 1} of ${total}`;

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="viewer__bar">
        <span className="viewer__count tabular" aria-live="polite">
          {index + 1} / {total}
        </span>
        <Button ref={closeRef} variant="quiet" size="small" onClick={onClose} aria-keyshortcuts="Escape">
          Close
        </Button>
      </div>

      <figure className="viewer__stage">
        {src && failed !== src ? (
          <img key={src} className="viewer__img" src={src} alt={label} onError={() => setFailed(src)} />
        ) : (
          <span className="viewer__missing" role="img" aria-label={label}>
            No preview
          </span>
        )}
      </figure>

      {total > 1 ? (
        <>
          <button type="button" className="viewer__step viewer__step--prev" aria-label="Previous photo" aria-keyshortcuts="ArrowLeft" onClick={() => go(-1)}>
            <Chevron d="m14.5 6-6 6 6 6" />
          </button>
          <button type="button" className="viewer__step viewer__step--next" aria-label="Next photo" aria-keyshortcuts="ArrowRight" onClick={() => go(1)}>
            <Chevron d="m9.5 6 6 6-6 6" />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function Chevron({ d }: { readonly d: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
