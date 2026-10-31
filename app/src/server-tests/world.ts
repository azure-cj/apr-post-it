/**
 * The world the server tests run in: the three spreadsheets Code.gs opens
 * (the company tracker, the private admin sheet with the Team tab, and the
 * directory), the documents behind the listings, and the people on the team.
 *
 * Each is built the way the real one is. The tracker and the Team tab are
 * typed by people, so Sheets reads "TRUE" as a boolean and a date as a date.
 * The directory is written as plain text by BuildDirectory.gs, its posting
 * text cut by Separators.gs — the same file, linked as the app links it.
 */

import { splitAtSeparator_ } from '@server/Separators.gs';
import { createBackend, type Backend } from '../core/backend';
import { createTracker, type Tracker } from '../core/tracker';
import type { Book, Tab } from './fake-sheets';
import { loadProject, type Project, type ProjectOptions, type Reply } from './harness';

export const TRACKER_ID = 'tracker-sheet';
export const ADMIN_ID = 'admin-sheet';
export const DIRECTORY_ID = 'directory-sheet';

export const PEOPLE = {
  jan: { name: 'Jan Dela Cruz', key: 'key-jan', role: 'Intern', fbAccounts: 'APG Main, APG Rentals', active: 'TRUE' },
  ana: { name: 'Ana Reyes', key: 'key-ana', role: 'Intern', fbAccounts: '', active: 'TRUE' },
  maria: { name: 'Maria Santos', key: 'key-maria', role: 'Manager', fbAccounts: '', active: 'TRUE' },
  rico: { name: 'Rico Bautista', key: 'key-rico', role: 'Admin', fbAccounts: '', active: 'TRUE' },
  gone: { name: 'Former Intern', key: 'key-gone', role: 'Intern', fbAccounts: '', active: 'FALSE' },
} as const;

export type Person = keyof typeof PEOPLE;

export interface Listing {
  readonly id: string;
  readonly name: string;
  readonly docId: string;
  readonly category: string;
  readonly listingType: string;
  /** The document's paragraphs. */
  readonly doc: readonly string[];
  readonly photos: readonly string[];
}

/** Separated by "---", the commonest separator in the library (D5). */
export const CASA: Listing = {
  id: 'F-casa',
  name: 'Casa Amara',
  docId: 'D-casa',
  category: 'CONDO / HOUSE AND LOT',
  listingType: 'FOR SALE',
  doc: [
    'FOR SALE: Casa Amara, Antipolo',
    'Price: PHP 8,500,000',
    '3 bedrooms, 2 baths',
    'Call 0917 000 1111',
    '---',
    'Owner: Mr. Reyes 0917 123 4567',
    'Commission: 3%',
  ],
  photos: ['P-casa-1', 'P-casa-2'],
};

/** Nobody has separated it, and it carries a private mobile number: the 79 of D6. */
export const LOT_9: Listing = {
  id: 'F-lot9',
  name: 'Verdant Hills Lot 9',
  docId: 'D-lot9',
  category: 'LOT',
  listingType: 'FOR SALE',
  doc: ['FOR SALE: Verdant Hills Lot 9', 'Price: PHP 1,200,000', 'Call Juan 0918 765 4321'],
  photos: ['P-lot9-1'],
};

/** A folder named only with digits, cut at a commission heading. */
export const TOWER: Listing = {
  id: 'F-1201',
  name: '1201',
  docId: 'D-1201',
  category: 'OFFICE SPACE',
  listingType: 'FOR LEASE',
  doc: [
    'FOR LEASE: 1201 Tower, Ortigas',
    'Rent: PHP 45,000 a month',
    'Commission: 1 month, net to owner PHP 40,000',
    'Owner Mrs. Lim 0917 555 0000',
  ],
  photos: [],
};

export const LISTINGS: readonly Listing[] = [CASA, LOT_9, TOWER];

/** Strings that must never reach an intern, by listing. */
export const PRIVATE: Readonly<Record<string, readonly string[]>> = {
  [CASA.id]: ['Mr. Reyes', '0917 123 4567', '3%', 'Owner', 'Commission'],
  [LOT_9.id]: ['Juan', '0918 765 4321', 'Verdant Hills Lot 9\nPrice'],
  [TOWER.id]: ['1 month', '40,000', 'net to owner', 'Mrs. Lim', '0917 555 0000', 'Commission'],
};

/** The tracker's own column order and spellings, with a column Code.gs does not know. */
export const POSTS_HEADERS = ['Date', 'Title', 'Type', 'Time', 'Status', 'FB Account', 'Post Link', 'Posted By', 'PropertyId', 'Notes'];
export const ASSIGN_HEADERS = ['Date', 'Assigned To', 'Property', 'Status', 'PropertyId'];
export const TEAM_HEADERS = ['Name', 'Email', 'Role', 'Key', 'FB Accounts', 'Active'];
/** BuildDirectory.gs's HEADERS. */
export const DIRECTORY_HEADERS = [
  'Category', 'Listing type', 'Sub-category', 'Property', 'Folder', 'Photos', 'Photo links', 'Posting text',
  'Cut at', 'Owner section', 'Issues', 'FolderId', 'DocId',
];

/** A row as BuildDirectory.gs's describe_ writes it. */
export function directoryRow(listing: Listing): (string | number)[] {
  const split = splitAtSeparator_(listing.doc.join('\n'));
  const issues: string[] = [];
  if (!split.found) issues.push('No separator line — the whole document is treated as postable. Check it.');
  if (!listing.photos.length) issues.push('No photos');
  return [
    listing.category,
    listing.listingType,
    '',
    listing.name,
    `https://drive.google.com/drive/folders/${listing.id}`,
    listing.photos.length,
    listing.photos.map((p) => `https://drive.google.com/uc?export=download&id=${p}`).join('\n'),
    split.posting,
    split.cutAt,
    split.found ? 'Yes' : 'No',
    issues.join(' · '),
    listing.id,
    listing.docId,
  ];
}

export interface App {
  readonly backend: Backend;
  readonly tracker: Tracker;
}

export interface World {
  readonly project: Project;
  readonly tracker: Book;
  readonly admin: Book;
  readonly directory: Book;
  /** The tracker's Posts tab. */
  readonly posts: Tab;
  readonly assignments: Tab;
  readonly team: Tab;
  readonly directoryTab: Tab;
  /** One request, with this person's key. */
  call(person: Person, action: string, fields?: Readonly<Record<string, unknown>>): Reply;
  /** Logs a post of `listing` as `person`, the way the app sends it. */
  logPost(person: Person, listing: Listing, fields?: Readonly<Record<string, unknown>>): Reply;
  /** The app's own client, signed in as `person` and talking to this server. */
  app(person: Person): App;
}

export interface WorldOptions extends ProjectOptions {
  /** Directory rows to write instead of the listings'. */
  readonly listings?: readonly Listing[];
  /**
   * Makes Directory its spreadsheet's first tab, sheet id 0, like the Posts
   * tab. By default it is not: BuildDirectory.gs inserts it beside the
   * Sheet1 a new spreadsheet starts with.
   */
  readonly directoryFirst?: boolean;
}

export function createWorld(options: WorldOptions = {}): World {
  const project = loadProject(options);
  project.configure({ TRACKER_SHEET_ID: TRACKER_ID, ADMIN_SHEET_ID: ADMIN_ID, DIRECTORY_SHEET_ID: DIRECTORY_ID });

  const sheets = project.sheets;
  // Posts is the tracker's first tab and Team the admin sheet's: both are sheet id 0.
  const tracker = sheets.create(TRACKER_ID, { name: 'APG Posting Tracker' });
  const posts = tracker.addSheet('Posts', POSTS_HEADERS);
  const assignments = tracker.addSheet('Assignments', ASSIGN_HEADERS);

  const admin = sheets.create(ADMIN_ID, { name: 'Post-It admin (private)' });
  const team = admin.addSheet('Team', TEAM_HEADERS);
  for (const p of Object.values(PEOPLE)) {
    team.type([p.name, '', p.role, p.key, p.fbAccounts, p.active]);
  }

  const directory = sheets.create(DIRECTORY_ID, { name: 'APG listing directory' });
  if (!options.directoryFirst) directory.addSheet('Sheet1');
  const directoryTab = directory.addSheet('Directory');
  directoryTab.writeText(DIRECTORY_HEADERS);
  for (const listing of options.listings ?? LISTINGS) {
    directoryTab.writeText(directoryRow(listing));
    project.drive.addDoc(listing.docId, ...listing.doc);
  }

  const call = (person: Person, action: string, fields: Readonly<Record<string, unknown>> = {}): Reply =>
    project.post({ ...fields, action, key: PEOPLE[person].key });

  return {
    project,
    tracker,
    admin,
    directory,
    posts,
    assignments,
    team,
    directoryTab,
    call,
    logPost: (person, listing, fields = {}) =>
      call(person, 'logPost', {
        property: listing.name,
        propertyId: listing.id,
        fbAccount: 'APG Main',
        postLink: 'https://www.facebook.com/groups/apg/posts/1/',
        ...fields,
      }),
    app(person) {
      const backend = createBackend({
        post: async (_url, body) => project.postText(body),
        getConfig: () => ({ url: 'https://script.google.com/macros/s/AKfake/exec', key: PEOPLE[person].key }),
      });
      return { backend, tracker: createTracker({ backend }) };
    },
  };
}
