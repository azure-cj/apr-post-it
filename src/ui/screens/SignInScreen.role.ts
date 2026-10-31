import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@/core/types';
import type { Platform } from '@/platform';

/** Where the last role picked on the sign-in screen is kept. */
export const SIGN_IN_ROLE_KEY = 'signInRole';

/**
 * The role the sign-in screen starts on: the one picked last time on this
 * computer, Intern until then. Only the person's intent; the server decides.
 */
export function useSignInRole(platform: Platform): readonly [Role, (role: Role) => void] {
  const [role, setRole] = useState<Role>('Intern');
  useEffect(() => {
    let live = true;
    platform.readLocal(SIGN_IN_ROLE_KEY).then(
      (kept) => {
        if (live && (kept === 'Intern' || kept === 'Admin')) setRole(kept);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [platform]);
  const choose = useCallback(
    (next: Role) => {
      setRole(next);
      void platform.writeLocal(SIGN_IN_ROLE_KEY, next).catch(() => {});
    },
    [platform],
  );
  return [role, choose] as const;
}
