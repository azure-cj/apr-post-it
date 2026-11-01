// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLEAN, fakeServer, intern, manager, renderApp } from '../../state/testing';

const names = () => Array.from(document.querySelectorAll('.find-row__name')).map((n) => n.textContent);
const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name });
const row = (name: string) => screen.getByText(name, { selector: '.find-row__name' }).closest('a')!;
const pages = () => screen.queryByRole('navigation', { name: 'Pages' });
const box = () => screen.getByRole('searchbox', { name: 'Search listings' });

describe('Find, over the test library', () => {
  it('searches on every keystroke, from a box that has the focus on arrival', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');
    expect(names()).toHaveLength(5);
    expect(screen.getByRole('heading', { level: 1, name: 'Find' })).toBeTruthy();
    expect(document.activeElement).toBe(box());
    expect(box().getAttribute('aria-keyshortcuts')).toBe('/');

    // Best match while searching: a word that starts with it before one that only contains it.
    await userEvent.type(box(), 'w');
    await waitFor(() => expect(names()).toEqual(['Valenzuela Warehouse 1,200 sqm', 'BGC Uptown Office 18F, 240 sqm']));
    await userEvent.type(box(), 'are');
    await waitFor(() => expect(names()).toEqual(['Valenzuela Warehouse 1,200 sqm']));
    // The All chip counts what the search found; five or fewer have no pages.
    expect(chip(/^All/).textContent).toMatch(/1$/);
    expect(pages()).toBeNull();
  });

  it('opens the first result on Enter, and moves through them with the arrow keys', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('BGC Uptown Office 18F');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Kapitolyo');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(box());

    await userEvent.type(box(), 'verdant{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
  });

  it('goes back to the search with "/" from anywhere on the screen, but not while typing elsewhere', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');
    await userEvent.type(box(), 'pasig');
    chip(/Commercial space/).focus();
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(box());
    // Selected, so typing replaces it; the slash itself is not typed.
    expect((box() as HTMLInputElement).value).toBe('pasig');
    expect([(box() as HTMLInputElement).selectionStart, (box() as HTMLInputElement).selectionEnd]).toEqual([0, 5]);
  });

  it("shows the server's sentence when the list can't be loaded, with a way to try again", async () => {
    renderApp({
      platform: fakeServer({ properties: { ok: false, error: 'No "Directory" tab. Run BuildDirectory.gs first.' } }),
      path: '/find',
    });
    expect(await screen.findByText(/Google could not load the property list: No "Directory" tab/)).toBeTruthy();
    expect(screen.getByText("Listings didn't load")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows ten rows of placeholder while the list loads', async () => {
    renderApp({ platform: fakeServer({ properties: () => new Promise(() => undefined) }), path: '/find' });
    await waitFor(() => expect(document.querySelectorAll('.find-list--loading .find-row--skeleton')).toHaveLength(10));
    expect(document.querySelector('.find-list--loading')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Loading the listings…')).toBeTruthy();
    expect(names()).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ a larger library

const TODAY_WEEK = '2026-11-02'; // Sat 31 Oct belongs to the coming week.

function listing(id: string, name: string, extra: Readonly<Record<string, unknown>> = {}) {
  return {
    id,
    name,
    category: 'CONDO / HOUSE AND LOT',
    listingType: 'FOR SALE',
    subCategory: '',
    photoCount: 4,
    hasIssues: false,
    issues: '',
    ...extra,
  };
}

/** Five named listings, one of each status, and twenty more to page through: 25 in all. */
const LIBRARY = [
  listing('pReady', 'Alabang Loft 2BR', { city: 'Muntinlupa', size: '78', dealType: 'Sale', availability: 'Available', created: '2026-01-10' }),
  listing('pCool', 'Bonifacio Tower 12F', {
    category: 'OFFICE SPACE',
    listingType: 'FOR LEASE/ FOR RENT',
    city: 'Taguig',
    size: '240',
    dealType: 'Lease',
    created: '2026-06-01',
  }),
  listing('pSold', 'Cubao Corner Lot', { category: 'COMMERCIAL SPACE', city: 'Quezon City', availability: 'Sold', created: '2025-12-01' }),
  listing('pNoSep', 'Dasma Warehouse 1', {
    category: 'WAREHOUSE',
    listingType: 'FOR LEASE/ FOR RENT',
    city: 'Dasmarinas',
    hasIssues: true,
    issues: 'No separator line',
    photoCount: 0,
    created: '2026-09-01',
  }),
  listing('pNoDoc', 'Ermita Studio', { city: 'Manila', hasIssues: true, issues: 'No document · No photos', photoCount: 0 }),
  ...Array.from({ length: 20 }, (_, i) =>
    listing(`f${i}`, `Filler Unit ${String(i + 1).padStart(2, '0')}`, {
      city: 'Pasig',
      size: String(30 + i),
      dealType: i % 2 ? 'Lease' : 'Sale',
      listingType: i % 2 ? 'FOR LEASE/ FOR RENT' : 'FOR SALE',
    }),
  ),
];

function post(propertyId: string, title: string, date: string, postedBy = intern.name) {
  return { date, time: '10:00', type: 'Condo / House and Lot', title, status: 'Posted', fbAccount: 'APG Main', postLink: 'https://www.facebook.com/p/1', postedBy, propertyId };
}

const POSTS = [post('pCool', 'Bonifacio Tower 12F', '2026-10-30'), post('pReady', 'Alabang Loft 2BR', '2026-10-10')];
const QUEUE = [{ date: TODAY_WEEK, week: TODAY_WEEK, assignedTo: intern.name, property: 'Alabang Loft 2BR', propertyId: 'pReady', status: 'Not Shared' }];

function library(replies: Readonly<Record<string, unknown>> = {}) {
  return fakeServer({
    properties: { ok: true, properties: LIBRARY },
    posts: { ok: true, posts: POSTS },
    assignments: { ok: true, assignments: QUEUE },
    ...(replies as Record<string, never>),
  });
}

async function openFind(user = intern) {
  renderApp({ platform: library(), user, path: '/find' });
  await screen.findByText('Alabang Loft 2BR');
  // The posts arrive after the list: Ready waits for them.
  await waitFor(() => expect(within(row('Alabang Loft 2BR')).queryByText('Ready')).toBeTruthy());
}

const filter = async (label: string) => {
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: label }));
  await userEvent.keyboard('{Escape}');
};

const sortBy = async (label: string) => {
  await userEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
  await userEvent.click(screen.getByRole('radio', { name: label }));
};

describe('Find, a page at a time', () => {
  it('shows ten a page with the range and the pages, and goes to the next', async () => {
    await openFind();
    expect(names()).toHaveLength(10);
    expect(names()[0]).toBe('Alabang Loft 2BR');
    const nav = pages()!;
    expect(nav.closest('.pagination')!.textContent).toContain('1–10 of 25');
    expect(within(nav).getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');

    await userEvent.click(within(nav).getByRole('button', { name: 'Next page' }));
    expect(names()).toHaveLength(10);
    expect(names()[0]).toBe('Filler Unit 06');
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Listings, page 2 of 3' }));
    // From the list's top, Down is the first row.
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('Filler Unit 06'));

    await userEvent.click(within(pages()!).getByRole('button', { name: 'Page 3' }));
    expect(names()).toHaveLength(5);
    expect(pages()!.closest('.pagination')!.textContent).toContain('21–25 of 25');
  });

  it('starts again at page 1 when the search, the category or the filters change', async () => {
    await openFind();
    await userEvent.click(within(pages()!).getByRole('button', { name: 'Page 3' }));
    await userEvent.type(box(), 'filler');
    await waitFor(() => expect(names()[0]).toBe('Filler Unit 01'));
    expect(within(pages()!).getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');

    await userEvent.click(within(pages()!).getByRole('button', { name: 'Page 2' }));
    await filter('For lease');
    expect(names()).toEqual(['Filler Unit 02', 'Filler Unit 04', 'Filler Unit 06', 'Filler Unit 08', 'Filler Unit 10', 'Filler Unit 12', 'Filler Unit 14', 'Filler Unit 16', 'Filler Unit 18', 'Filler Unit 20']);
    expect(pages()).toBeNull();
  });
});

describe('Find, each row', () => {
  it('says the category, the place, the deal and the photos, and one status each', async () => {
    await openFind();
    const text = (name: string) => row(name).textContent;
    expect(text('Alabang Loft 2BR')).toContain('Condo / house and lot');
    expect(text('Alabang Loft 2BR')).toContain('Muntinlupa · 78 sqm');
    expect(text('Alabang Loft 2BR')).toContain('For sale');
    expect(text('Alabang Loft 2BR')).toContain('4 photos');
    expect(row('Alabang Loft 2BR').querySelector('.category-dot--condo')).toBeTruthy();
    expect(text('Bonifacio Tower 12F')).toContain('For lease');

    const pill = (name: string) => row(name).querySelector('.pill')!.textContent;
    expect(pill('Alabang Loft 2BR')).toBe('Ready');
    // Posted on Fri 30 Oct, with a seven-day cooldown.
    expect(pill('Bonifacio Tower 12F')).toBe('In cooldown until Fri 6 Nov');
    expect(pill('Cubao Corner Lot')).toBe('Sold');
    expect(pill('Dasma Warehouse 1')).toBe('No separator');
    expect(pill('Ermita Studio')).toBe('No document');
    expect(row('Bonifacio Tower 12F').querySelectorAll('.pill')).toHaveLength(1);
    expect(text('Dasma Warehouse 1')).toContain('No photos');
  });

  it("tells an intern what is in this week's queue", async () => {
    await openFind();
    expect(row('Alabang Loft 2BR').textContent).toContain('In your queue');
    expect(row('Bonifacio Tower 12F').textContent).not.toContain('In your queue');
    expect(screen.queryByText(/^With /)).toBeNull();
  });

  it('tells an admin who holds a listing', async () => {
    await openFind(manager);
    expect(row('Alabang Loft 2BR').textContent).toContain('With Jan');
    expect(screen.queryByText('In your queue')).toBeNull();
  });
});

describe('Find, narrowing and ordering', () => {
  it('narrows by category, counting what each would show with the search', async () => {
    await openFind();
    expect(chip(/^All/).textContent).toMatch(/25$/);
    expect(chip(/Office space/).textContent).toMatch(/1$/);
    // The chips keep their places, most listings first.
    expect(within(screen.getByRole('group', { name: 'Category' })).getAllByRole('button').map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual([
      'All',
      'Condo / house and lot',
      'Warehouse',
      'Commercial space',
      'Office space',
    ]);

    await userEvent.click(chip(/Warehouse/));
    expect(chip(/Warehouse/).getAttribute('aria-pressed')).toBe('true');
    expect(names()).toEqual(['Dasma Warehouse 1']);
    // In one category the row doesn't repeat its name; the dot stays.
    expect(row('Dasma Warehouse 1').querySelector('.find-row__cat--dot')).toBeTruthy();

    await userEvent.click(chip(/^All/));
    await userEvent.type(box(), 'pasig');
    await waitFor(() => expect(chip(/^All/).textContent).toMatch(/20$/));
    expect(chip(/Warehouse/).textContent).toMatch(/0$/);
  });

  it('filters: for sale or lease, ready to post, never posted, has photos', async () => {
    await openFind();
    await filter('Ready to post');
    expect(screen.getByRole('button', { name: 'Filter, 1 on' })).toBeTruthy();
    // Not sold, not in cooldown, has a document: one with no separator counts.
    expect(names().slice(0, 2)).toEqual(['Alabang Loft 2BR', 'Dasma Warehouse 1']);
    expect(names()).not.toContain('Bonifacio Tower 12F');
    expect(names()).not.toContain('Cubao Corner Lot');
    expect(names()).not.toContain('Ermita Studio');

    await filter('Has photos');
    expect(names()).not.toContain('Dasma Warehouse 1');
    await filter('Never posted');
    expect(names()).not.toContain('Alabang Loft 2BR');
    expect(chip(/^All/).textContent).toMatch(/20$/);
    await filter('For sale');
    expect(chip(/^All/).textContent).toMatch(/10$/);
    await filter('For lease');
    expect(chip(/^All/).textContent).toMatch(/20$/);
  });

  it('sorts by best match while searching, and by name, newest or last posted', async () => {
    await openFind();
    expect(screen.getByRole('button', { name: 'Sort: Name' })).toBeTruthy();

    await userEvent.type(box(), 'taguig');
    await waitFor(() => expect(names()).toEqual(['Bonifacio Tower 12F']));
    // A name with the word beats one that matched only by its category (condo / house and LOT).
    await userEvent.clear(box());
    await userEvent.type(box(), 'lot');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sort: Best match' })).toBeTruthy());
    expect(names().slice(0, 3)).toEqual(['Cubao Corner Lot', 'Alabang Loft 2BR', 'Ermita Studio']);
    await sortBy('Name');
    expect(names().slice(0, 2)).toEqual(['Alabang Loft 2BR', 'Cubao Corner Lot']);
    await userEvent.clear(box());

    await sortBy('Newest');
    await waitFor(() => expect(names().slice(0, 4)).toEqual(['Dasma Warehouse 1', 'Bonifacio Tower 12F', 'Alabang Loft 2BR', 'Cubao Corner Lot']));
    expect(row('Dasma Warehouse 1').textContent).toContain('Added 1 Sep');

    await sortBy('Last posted');
    // Never posted first (by name), then the longest since posted.
    const all = [...names()];
    expect(all[0]).toBe('Cubao Corner Lot');
    expect(row('Cubao Corner Lot').textContent).toContain('Never posted');
    await userEvent.click(within(pages()!).getByRole('button', { name: 'Page 3' }));
    expect(names().slice(-2)).toEqual(['Alabang Loft 2BR', 'Bonifacio Tower 12F']);
    expect(row('Bonifacio Tower 12F').textContent).toContain('Posted 1 day ago');
  });

  it('says so in one line when nothing matches, with a way to clear the filters', async () => {
    await openFind();
    await filter('Never posted');
    await userEvent.type(box(), 'zzz');
    expect(await screen.findByText('Nothing matches “zzz”.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(names()).toHaveLength(10));
    expect((box() as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(document.activeElement).toBe(box());
  });
});

describe('Find, coming back', () => {
  it('keeps the search, category, filters and page while a listing is open, and lands on its row', async () => {
    await openFind();
    await userEvent.type(box(), 'unit');
    await userEvent.click(chip(/Condo/));
    await filter('Has photos');
    await sortBy('Name');
    await userEvent.click(within(pages()!).getByRole('button', { name: 'Page 2' }));
    expect(names()[0]).toBe('Filler Unit 11');

    await userEvent.click(row('Filler Unit 13'));
    expect(await screen.findByRole('heading', { level: 1, name: CLEAN.name })).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: 'Results' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Find' })).toBeTruthy();
    expect((box() as HTMLInputElement).value).toBe('unit');
    expect(chip(/Condo/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Filter, 1 on' })).toBeTruthy();
    expect(within(pages()!).getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page');
    expect(names()[0]).toBe('Filler Unit 11');
    expect(document.activeElement).toBe(row('Filler Unit 13'));
  });
});

describe('Find, the list’s age', () => {
  it('says when the list was read, small, with Refresh', async () => {
    await openFind();
    const header = screen.getByRole('heading', { level: 1, name: 'Find' }).closest('header')!;
    expect(header.textContent).toMatch(/Updated \d{1,2}:\d{2}/);
    expect(within(header).getByRole('button', { name: 'Refresh the listings' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
