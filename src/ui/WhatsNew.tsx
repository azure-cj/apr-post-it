import { useEffect, useRef, useState } from 'react';
import type { Platform } from '@/platform';
import { Button } from './components';
import { Dialog } from './screens/manager/Dialog';
import { notesFor, SEEN_VERSION_KEY } from './releaseNotes';
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
}: {
  readonly platform: Pick<Platform, 'readLocal' | 'writeLocal'>;
  readonly version: string;
  /** Asked for from the sidebar: shown whether or not it was seen. */
  readonly openNow: boolean;
  readonly onClosed: () => void;
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
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Dialog>
  );
}
