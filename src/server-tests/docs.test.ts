/**
 * The two documents that describe the web app, held to what it does. Both
 * once described an `internal=true` parameter (the role decides, never the
 * client) and `reindex` and `texts` actions that no longer exist.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProject, readServerFile } from './harness';

const README = readServerFile('README.md');
const DATA_FLOW = readFileSync(new URL('../../docs/DATA-FLOW.md', import.meta.url), 'utf8');

/** The actions Code.gs's route() answers. */
function routedActions(): string[] {
  const code = readServerFile('Code.gs');
  const route = code.slice(code.indexOf('function route_('), code.indexOf('function json_('));
  return Array.from(route.matchAll(/case '(\w+)':/g), (m) => m[1]!).sort();
}

/** The README's action table: action -> who. */
function documentedActions(): Map<string, string> {
  return new Map(Array.from(README.matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm), (m) => [m[1]!, m[2]!.trim()]));
}

describe.each([
  ['server/README.md', README],
  ['docs/DATA-FLOW.md', DATA_FLOW],
])('%s', (_name, doc) => {
  it('describes no parameter or action the server does not have', () => {
    expect(doc).not.toMatch(/internal=true/);
    expect(doc).not.toMatch(/\breindex\b/i);
    expect(doc).not.toMatch(/action=texts|['`]texts['`]/);
    expect(doc).not.toMatch(/INTERNAL_MARKERS|splitPosting|buildIndex|PUBLISH_PHOTOS|Index tab/);
  });

  it('says Separators.gs is required, and that an intern is never sent unseparated text', () => {
    expect(doc).toMatch(/Separators\.gs[\s\S]{0,20}\*\*required/i);
    expect(doc).toMatch(/withheld: true/);
  });
});

describe('the README\'s actions', () => {
  it('are exactly the ones Code.gs answers', () => {
    expect([...documentedActions().keys()].sort()).toEqual(routedActions());
  });

  it('say who may call each, as PERMISSIONS does', () => {
    const permissions = loadProject().evaluate('PERMISSIONS') as Record<string, string[]>;

    for (const [action, who] of documentedActions()) {
      // Two roles (D14): what an Intern may call, everyone may; the rest is the Admin's.
      expect(Object.keys(permissions).sort()).toEqual(['Admin', 'Intern']);
      const intern = permissions['Intern']!.includes(action);
      expect(who, action).toBe(intern ? 'everyone' : 'Admin');
    }
  });
});
