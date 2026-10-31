/**
 * Development only: the three manager screens with realistic sample props,
 * inside the app's shell, for looking at them before they are routed. Opened
 * through a temporary manager-preview.html; never imported by the app, so it
 * is never in the production build.
 */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/tokens.css';
import '@/theme/base.css';
import '../../App.css';
import { ToastRegion, TopBar, useToasts, type TopBarNavItem } from '../../components';
import { addDays, type DirectoryRow, type TeamMember } from '@/core/summary';
import type { Assignment, AssignmentStatus, PostLogEntry, PostStatus, Property } from '@/core/types';
import { AssignScreen, type QueueSave } from './AssignScreen';
import { SettingsScreen } from './SettingsScreen';
import { TrackerScreen } from './TrackerScreen';

// ------------------------------------------------------------------ sample data

const TODAY = '2026-10-29';
const TOMORROW = addDays(TODAY, 1);
const RULES = { cooldownDays: 7, repostDueDays: 14 };

const JAN = 'Jan Dela Cruz';
const MIKA = 'Mika Reyes';
const BEA = 'Bea Lim';
const PAOLO = 'Paolo Garcia';

const TEAM: readonly TeamMember[] = [
  { name: 'Maria Santos', role: 'Admin' },
  { name: 'Ramon Villanueva', role: 'Manager' },
  { name: JAN, role: 'Intern', fbAccounts: ['APG Homes Cavite', 'APG Main'] },
  { name: MIKA, role: 'Intern', fbAccounts: ['APG Properties PH'] },
  { name: BEA, role: 'Intern', fbAccounts: ['Alpha Premier Listings', 'APG Main'] },
  { name: PAOLO, role: 'Intern' },
  { name: 'Carlo Mendoza', role: 'Intern', active: false },
];

/** A small, seeded generator, so every load shows the same library. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMED: readonly (readonly [string, string, string])[] = [
  ['Verdant Hills Lot 12', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Verdant Hills Lot 7', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Verdant Hills Lot 3', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Seaside Residences 2BR', 'CONDO / HOUSE AND LOT', 'FOR LEASE/ FOR RENT'],
  ['Casa Amara House & Lot', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Sunrise Homes Block 3 Lot 9', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Greenfield Farm Lot', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Sta. Rosa Lot 22', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Antipolo Ridge Lot 18', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Lakeshore Villas Unit 7', 'CONDO / HOUSE AND LOT', 'FOR LEASE/ FOR RENT'],
  ['Imus Townhomes Phase 2', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Villa Rosario Unit 4B', 'CONDO / HOUSE AND LOT', 'FOR LEASE/ FOR RENT'],
  ['Pinewood Heights Lot 3', 'CONDO / HOUSE AND LOT', 'FOR SALE'],
  ['Mabini Commercial Space', 'COMMERCIAL SPACE', 'FOR LEASE/ FOR RENT'],
  ['Ortigas Center Retail Unit 2F', 'COMMERCIAL SPACE', 'FOR LEASE/ FOR RENT'],
  ['BGC High Street Kiosk 14', 'COMMERCIAL SPACE', 'FOR LEASE/ FOR RENT'],
  ['Prime Tower Office 1201', 'OFFICE SPACE', 'FOR LEASE/ FOR RENT'],
  ['Eastwood IT Hub Suite 905', 'OFFICE SPACE', 'FOR LEASE/ FOR RENT'],
  ['Valenzuela Warehouse 2,400 sqm', 'WAREHOUSE', 'FOR LEASE/ FOR RENT'],
  ['Cavite Ecozone Warehouse B', 'WAREHOUSE', 'FOR LEASE/ FOR RENT'],
];

const PLACES: Record<string, readonly string[]> = {
  'CONDO / HOUSE AND LOT': [
    'Avida Towers Makati', 'The Grove by Rockwell', 'Tagaytay Highlands', 'Camella Bacoor', 'Lancaster New City',
    'Vista Verde Cainta', 'Ponticelli Daang Hari', 'Amaia Scapes Laguna', 'Bria Homes Calamba', 'Celina Plains',
    'Ayala Westgrove', 'Nuvali Treveia', 'SMDC Light Residences', 'Urban Deca Ortigas', 'Brittany Bay',
  ],
  'COMMERCIAL SPACE': [
    'Quezon Avenue Shop', 'Kapitolyo Corner Space', 'Alabang Town Center Stall', 'Cubao Expo Unit', 'Banawe Retail',
    'Marikina Riverbanks Lot', 'Paseo de Magallanes Unit', 'Tomas Morato Ground Floor',
  ],
  'OFFICE SPACE': [
    'Ayala Avenue Office', 'Filinvest Alabang Office', 'Cebu IT Park Unit', 'Eton Centris Suite', 'One Ayala Tower',
    'Robinsons Cyberscape', 'Megaworld McKinley Office',
  ],
  WAREHOUSE: [
    'Laguna Techno Park Bay', 'Pampanga Logistics Hub', 'Meycauayan Cold Storage', 'Calamba Warehouse',
    'Batangas Port Warehouse', 'Taguig FTI Warehouse',
  ],
};

const CATEGORY_SHARE: readonly (readonly [string, number])[] = [
  ['CONDO / HOUSE AND LOT', 538],
  ['COMMERCIAL SPACE', 412],
  ['OFFICE SPACE', 301],
  ['WAREHOUSE', 223],
];

const NO_SEPARATOR = 'No separator line — the whole document is treated as postable. Check it.';

function buildLibrary(): DirectoryRow[] {
  const random = seeded(1474);
  const out: DirectoryRow[] = [];
  const names = new Set<string>();
  const add = (name: string, category: string, listingType: string) => {
    if (names.has(name)) return;
    names.add(name);
    out.push({
      id: `folder-${out.length + 1}`,
      name,
      category,
      listingType,
      subCategory: category === 'CONDO / HOUSE AND LOT' && /lot/i.test(name) ? 'Lot' : '',
      photoCount: 3 + Math.floor(random() * 12),
      hasIssues: false,
    });
  };
  for (const [name, category, type] of NAMED) add(name, category, type);
  for (const [category, total] of CATEGORY_SHARE) {
    const places = PLACES[category] ?? [];
    let n = 0;
    while (out.filter((p) => p.category === category).length < total && n < 20000) {
      n++;
      const place = places[Math.floor(random() * places.length)] ?? 'Listing';
      const unit = category === 'CONDO / HOUSE AND LOT' ? (random() < 0.5 ? `Lot ${1 + Math.floor(random() * 60)}` : `Unit ${1 + Math.floor(random() * 30)}${'ABCD'[Math.floor(random() * 4)]}`) : `${1 + Math.floor(random() * 90)}${random() < 0.3 ? 'AB'[Math.floor(random() * 2)] : ''}`;
      add(`${place} ${unit}`, category, random() < 0.6 ? 'FOR LEASE/ FOR RENT' : 'FOR SALE');
    }
  }
  // What the directory flags: 79 without a separator, as in the real library.
  const issueOf = (i: number): string => {
    if (i % 18 === 5) return NO_SEPARATOR;
    if (i % 61 === 9) return 'No document · No photos';
    if (i % 97 === 13) return 'Could not read document: Word file — enable the Drive advanced service, or save it as a Google Doc';
    if (i % 251 === 40) return 'Document is empty above the separator';
    if (i % 11 === 3) return 'No photos';
    return '';
  };
  const sorted = out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  return sorted.map((p, i) => {
    let issues = issueOf(i);
    if (p.name === 'Verdant Hills Lot 3') issues = NO_SEPARATOR;
    if (p.name === 'Mabini Commercial Space') issues = 'No photos';
    return issues ? { ...p, hasIssues: true, issues, photoCount: issues.includes('No photos') ? 0 : p.photoCount } : p;
  });
}

const ACCOUNTS = ['APG Homes Cavite', 'APG Properties PH', 'Alpha Premier Listings', 'APG Main'];

function row(title: string, daysAgo: number, by: string, time: string, status: PostStatus = 'Posted', id = ''): PostLogEntry {
  return {
    date: addDays(TODAY, -daysAgo),
    time,
    type: 'Group post',
    title,
    status,
    fbAccount: by === MIKA ? 'APG Properties PH' : by === BEA ? 'Alpha Premier Listings' : 'APG Homes Cavite',
    postLink: status === 'Posted' ? `https://www.facebook.com/groups/apgproperties/posts/${(daysAgo + 3) * 7919}${time.replace(':', '')}/` : '',
    postedBy: by,
    propertyId: id,
  };
}

function buildPosts(library: readonly Property[]): PostLogEntry[] {
  const random = seeded(29);
  const people = [JAN, MIKA, BEA, PAOLO];
  const posts: PostLogEntry[] = [];
  // History: a few hundred posts over the last two months, none inside the cooldown.
  for (let i = 0; i < 420; i++) {
    const p = library[Math.floor(random() * library.length)];
    if (!p) continue;
    const by = people[Math.floor(random() * people.length)] ?? JAN;
    const hour = 8 + Math.floor(random() * 9);
    const minute = Math.floor(random() * 60);
    posts.push({
      ...row(p.name, 8 + Math.floor(random() * 55), by, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`),
      fbAccount: ACCOUNTS[Math.floor(random() * ACCOUNTS.length)] ?? 'APG Main',
      propertyId: p.id,
    });
  }
  const id = (name: string) => library.find((p) => p.name === name)?.id ?? '';
  posts.push(
    row('Verdant Hills Lot 12', 20, JAN, '10:05', 'Posted', id('Verdant Hills Lot 12')),
    row('Verdant Hills Lot 7', 2, JAN, '14:20', 'Posted', id('Verdant Hills Lot 7')),
    row('Villa Rosario Unit 4B', 1, MIKA, '09:12', 'Posted', id('Villa Rosario Unit 4B')),
    row('Mabini Commercial Space', 32, BEA, '11:40', 'Posted', id('Mabini Commercial Space')),
    row('Greenfield Farm Lot', 18, PAOLO, '13:02', 'Posted', id('Greenfield Farm Lot')),
    row('Casa Amara House & Lot', 3, BEA, '15:00', 'Pending', id('Casa Amara House & Lot')),
    // Today.
    row('Pinewood Heights Lot 3', 0, MIKA, '09:55', 'Posted', id('Pinewood Heights Lot 3')),
    row('Imus Townhomes Phase 2', 0, BEA, '10:58', 'Posted', id('Imus Townhomes Phase 2')),
    row('Sunrise Homes Block 3 Lot 9', 0, JAN, '10:17', 'Posted', id('Sunrise Homes Block 3 Lot 9')),
    row('Antipolo Ridge Lot 18', 0, MIKA, '11:36', 'Posted', id('Antipolo Ridge Lot 18')),
    row('Lakeshore Villas Unit 7', 0, PAOLO, '11:20', 'Posted', id('Lakeshore Villas Unit 7')),
    row('Ortigas Center Retail Unit 2F', 0, JAN, '10:31', 'Pending', id('Ortigas Center Retail Unit 2F')),
    row('Prime Tower Office 1201', 0, BEA, '11:52', 'Pending', id('Prime Tower Office 1201')),
    row('Eastwood IT Hub Suite 905', 0, JAN, '09:41', 'Posted', id('Eastwood IT Hub Suite 905')),
    row('BGC High Street Kiosk 14', 0, MIKA, '13:05', 'Posted', id('BGC High Street Kiosk 14')),
    row('Cavite Ecozone Warehouse B', 0, PAOLO, '13:47', 'Posted', id('Cavite Ecozone Warehouse B')),
    row('Valenzuela Warehouse 2,400 sqm', 0, MIKA, '14:22', 'Posted', id('Valenzuela Warehouse 2,400 sqm')),
  );
  return posts;
}

function q(date: string, who: string, items: readonly (readonly [string, AssignmentStatus])[], library: readonly Property[]): Assignment[] {
  return items.map(([name, status]) => ({
    date,
    assignedTo: who,
    propertyName: name,
    propertyId: library.find((p) => p.name === name)?.id ?? '',
    status,
  }));
}

function buildAssignments(library: readonly Property[]): Assignment[] {
  return [
    ...q(TODAY, JAN, [
      ['Eastwood IT Hub Suite 905', 'Posted'],
      ['Sunrise Homes Block 3 Lot 9', 'Posted'],
      ['Ortigas Center Retail Unit 2F', 'Pending'],
      ['Seaside Residences 2BR', 'To post'],
      ['Sta. Rosa Lot 22', 'To post'],
    ], library),
    ...q(TODAY, MIKA, [
      ['Pinewood Heights Lot 3', 'Posted'],
      ['Antipolo Ridge Lot 18', 'Posted'],
      ['BGC High Street Kiosk 14', 'Posted'],
      ['Valenzuela Warehouse 2,400 sqm', 'Posted'],
    ], library),
    ...q(TODAY, BEA, [
      ['Imus Townhomes Phase 2', 'Posted'],
      ['Prime Tower Office 1201', 'Pending'],
      ['Greenfield Farm Lot', 'To post'],
    ], library),
    ...q(TODAY, PAOLO, [
      ['Lakeshore Villas Unit 7', 'Posted'],
      ['Cavite Ecozone Warehouse B', 'Posted'],
    ], library),
    ...q(TOMORROW, JAN, [
      ['Verdant Hills Lot 12', 'To post'],
      ['Mabini Commercial Space', 'To post'],
      ['Folder Since Renamed Lot 5', 'To post'],
    ], library),
    ...q(TOMORROW, MIKA, [
      ['Seaside Residences 2BR', 'To post'],
      ['Greenfield Farm Lot', 'To post'],
    ], library),
  ];
}

// ------------------------------------------------------------------ the preview

type ScreenKey = 'tracker' | 'assign' | 'settings';

const NAV: TopBarNavItem[] = [
  { key: 'tracker', label: 'Tracker', href: '#tracker' },
  { key: 'assign', label: 'Assign', href: '#assign' },
  { key: 'find', label: 'Find', href: '#tracker' },
  { key: 'settings', label: 'Settings', href: '#settings' },
];

function screenFromHash(): ScreenKey {
  const key = window.location.hash.replace('#', '');
  return key === 'assign' || key === 'settings' ? key : 'tracker';
}

export function ManagerPreview() {
  const library = useMemo(buildLibrary, []);
  const posts = useMemo(() => buildPosts(library), [library]);
  const [assignments, setAssignments] = useState(() => buildAssignments(library));
  const [screen, setScreen] = useState<ScreenKey>(screenFromHash);
  const [trackerDate, setTrackerDate] = useState(TODAY);
  const [intern, setIntern] = useState<string | null>(JAN);
  const [assignDate, setAssignDate] = useState(TOMORROW);
  const [refreshing, setRefreshing] = useState(false);
  const toasts = useToasts();
  const interns = TEAM.filter((m) => m.role === 'Intern' && m.active !== false).map((m) => m.name);

  const go = (key: string) => {
    if (key !== 'tracker' && key !== 'assign' && key !== 'settings') return;
    window.location.hash = key;
    setScreen(key);
  };

  const save = (s: QueueSave) =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => {
        setAssignments((rows) => [
          ...rows.filter((r) => !(r.date === s.date && r.assignedTo === s.assignedTo)),
          ...s.items.map((i) => ({
            date: s.date,
            assignedTo: s.assignedTo,
            propertyName: i.propertyName,
            propertyId: i.propertyId ?? '',
            status: i.status ?? ('To post' as const),
          })),
        ]);
        resolve();
      }, 700);
    });

  return (
    <>
      <div className="shell">
        <TopBar
          nav={NAV}
          currentKey={screen}
          user={{ name: 'Maria Santos', role: 'Admin' }}
          onNavigate={go}
          onSignOut={() => toasts.show('Signing out is not part of the preview.', 'info')}
        />
        <main id="main" className="shell__main" tabIndex={-1}>
          {screen === 'tracker' ? (
            <TrackerScreen
              date={trackerDate}
              today={TODAY}
              posts={posts}
              assignments={assignments}
              properties={library}
              team={TEAM}
              settings={RULES}
              onDateChange={setTrackerDate}
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                window.setTimeout(() => setRefreshing(false), 900);
              }}
              updatedAt="14:31"
              onOpenLink={(url) => toasts.show(`Would open ${url}`, 'info')}
              onOpenProperty={(id) => toasts.show(`Would open ${library.find((p) => p.id === id)?.name ?? id}`, 'info')}
              onAssign={(who, date) => {
                if (who) setIntern(who);
                setAssignDate(date);
                go('assign');
              }}
            />
          ) : screen === 'assign' ? (
            <AssignScreen
              interns={interns}
              intern={intern}
              date={assignDate}
              today={TODAY}
              properties={library}
              posts={posts}
              assignments={assignments}
              settings={RULES}
              onInternChange={setIntern}
              onDateChange={setAssignDate}
              onSave={save}
            />
          ) : (
            <SettingsScreen
              settings={{
                scriptUrl: 'https://script.google.com/macros/s/AKfycbx3Qm7pVt9eLr2Wk8uH4sN1dJ6cY0aZ5gT/exec',
                ...RULES,
              }}
              team={TEAM}
              onCopy={() => toasts.show('Copied the web app link.')}
            />
          )}
        </main>
      </div>
      <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </>
  );
}

/** Mounts the preview: what the temporary manager-preview.html calls. */
export function mountManagerPreview(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <ManagerPreview />
    </StrictMode>,
  );
}
