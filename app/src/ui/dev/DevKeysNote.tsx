import { Notice } from '../components';
import './DevKeysNote.css';

/**
 * Under the sign-in card in `npm run dev`: which keys the in-browser web app
 * answers to. Loaded only in development (main.tsx), so neither this nor its
 * styles are in a production build.
 */
export function DevKeysNote() {
  return (
    <div className="dev-keys-note">
      <Notice tone="info" title="Development build, in the browser">
        Sign in with the key <code>intern</code>, <code>paolo</code> (an intern with no FB accounts listed),{' '}
        <code>manager</code> or <code>admin</code>.
      </Notice>
    </div>
  );
}
