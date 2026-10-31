/**
 * Every screen's path. Screens link with these, never with string literals.
 * Kept apart from App.tsx, which re-exports them, so a screen can link to
 * another without importing the shell that imports it.
 */
export const paths = {
  signIn: '/sign-in',
  find: '/find',
  property: (id: string) => `/property/${encodeURIComponent(id)}`,
  logPost: (id: string) => `/property/${encodeURIComponent(id)}/log`,
  queue: '/queue',
  assign: '/assign',
  tracker: '/tracker',
  interns: '/interns',
  settings: '/settings',
} as const;

/** The nav's destinations. */
export type NavKey = 'queue' | 'find' | 'tracker' | 'assign' | 'interns' | 'settings';

export const navKeys: readonly NavKey[] = ['queue', 'find', 'tracker', 'assign', 'interns', 'settings'];

/**
 * What a property and its log page are told about how they were reached, as
 * router state: which list opened them, so the nav marks it and Back returns
 * to it. Reached any other way, they belong to Find.
 */
export interface FromList {
  readonly section: NavKey;
}

/** The list a property page was opened from: `state.section` when it names one, else Find. */
export function sectionOf(state: unknown): NavKey {
  const from = (state as { section?: unknown } | null)?.section;
  return navKeys.includes(from as NavKey) ? (from as NavKey) : 'find';
}
