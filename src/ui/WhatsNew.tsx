import { useEffect, useRef, useState } from 'react';
import type { Platform } from '@/platform';
import { Button } from './components';
import { Dialog } from './screens/manager/Dialog';
import { notesFor, noteText, SEEN_VERSION_KEY, type ShowMe } from './releaseNotes';
import './WhatsNew.css';

/**
 * What's new in this version: opened once after an update (the first launch of
 * a newer version than this PC last ran), and again on demand from the
 * sidebar. A fresh install only notes its version. Closing it remembers the
 * version, so it doesn't come back by itself.
 */
export function WhatsNew({
  platform,
  version,
  openNow,
  onClosed,
  onShow,
}: {
  readonly platform: Pick<Platform, 'readLocal' | 'writeLocal'>;
  readonly version: string;
  /** Asked for from the sidebar: shown whether or not it was seen. */
  readonly openNow: boolean;
  readonly onClosed: () => void;
  /** Show me (1.1.7): closes this and points at the thing in the app. Without it, no Show me. */
  readonly onShow?: ((show: ShowMe) => void) | undefined;
}) {
  const notes = notesFor(version);
  const [firstTime, setFirstTime] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const seen = await platform.readLocal(SEEN_VERSION_KEY).catch(() => null);
      if (!live || seen === version) return;
      // A first run on this PC is an install, not an update: noted, not shown.
      if (seen === null || !notes) {
        await platform.writeLocal(SEEN_VERSION_KEY, version).catch(() => {});
        return;
      }
      setFirstTime(true);
    })();
    return () => {
      live = false;
    };
  }, [platform, version, notes]);

  if (!notes || (!firstTime && !openNow)) return null;

  const close = () => {
    setFirstTime(false);
    void platform.writeLocal(SEEN_VERSION_KEY, version).catch(() => {});
    onClosed();
  };

  return (
    <Dialog
      title={`What's new in ${version}`}
      onClose={close}
      initialFocus={okRef}
      actions={
        <Button ref={okRef} variant="primary" onClick={close}>
          Got it
        </Button>
      }
    >
      <ul className="whats-new">
        {notes.items.map((item) => (
          <li key={noteText(item)}>
            {noteText(item)}
            {typeof item !== 'string' && onShow ? (
              <>
                {' '}
                <Button
                  variant="link"
                  size="small"
                  className="whats-new__show"
                  onClick={() => {
                    close();
                    onShow(item.show);
                  }}
                >
                  Show me
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
