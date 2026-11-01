// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError, type Assignment, type PostLogEntry } from '@/core/types';
import type { DirectoryRow } from '@/core/summary';
import { AppShell, routerFuture } from '../../App';
import { AppStateProvider } from '../../state/AppState';
import { EXEC, NOW, fakeServer, intern as janUser, manager } from '../../state/testing';
import { AssignScreen, type AssignScreenProps, type QueueSave } from './index';

const TODAY = '2026-10-29';
const TOMORROW = '2026-10-30';
const JAN = 'Jan Dela Cruz';
const MIKA = 'Mika Reyes';

function listing(id: string, name: string, category: string, extra: Partial<DirectoryRow> = {}): DirectoryRow {
  return { id, name, category, listingType: 'FOR SALE', subCategory: '', photoCount: 5, hasIssues: false, ...extra };
}

const CONDO = 'CONDO / HOUSE AND LOT';
const LIBRARY: readonly DirectoryRow[] = [
  listing('f1', 'Verdant Hills Lot 12', CONDO),
  listing('f2', 'Verdant Hills Lot 7', CONDO),
  listing('f3', 'Casa Amara House & Lot', CONDO, { city: 'Tagaytay', size: '320' }),
  listing('f4', 'Seaside Residences 2BR', CONDO),
  listing('f5', 'Sta. Rosa Lot 22', CONDO),
  listing('w1', 'Valenzuela Warehouse A', 'WAREHOUSE'),
  listing('w2', 'Meycauayan Warehouse B', 'WAREHOUSE'),
  listing('w3', 'Calamba Warehouse C', 'WAREHOUSE'),
  listing('o1', 'BGC Office 18F', 'OFFICE SPACE'),
  listing('o2', 'Ortigas Office 9F', 'OFFICE SPACE'),
  listing('k1', 'Kapitolyo Retail', 'COMMERCIAL SPACE', { availability: 'Sold' }),
  listing('k2', 'Makati Retail', 'COMMERCIAL SPACE', { hasIssues: true, issues: 'No separator line' }),
];

function post(date: string, title: string, propertyId: string): PostLogEntry {
  return {
    date,
    time: '14:20',
    type: 'Warehouse',
    title,
    status: 'Posted',
    fbAccount: 'APG Main',
    postLink: 'https://www.facebook.com/groups/x/posts/1/',
    postedBy: JAN,
    propertyId,
  };
}

const POSTS: readonly PostLogEntry[] = [
  // Three days before tomorrow's queue: in its cooldown until 3 Nov.
  post('2026-10-27', 'Verdant Hills Lot 7', 'f2'),
  // Long ago: due for repost.
  post('2026-10-01', 'Calamba Warehouse C', 'w3'),
];

const row = (date: string, assignedTo: string, propertyName: string, propertyId: string, status: Assignment['status'] = 'Not Shared'): Assignment => ({
  date,
  assignedTo,
  propertyName,
  propertyId,
  status,
});

const ASSIGNMENTS: readonly Assignment[] = [
  row(TOMORROW, MIKA, 'Seaside Residences 2BR', 'f4'),
  row('2026-10-28', MIKA, 'BGC Office 18F', 'o1'),
  row(TOMORROW, JAN, 'Verdant Hills Lot 12', 'f1'),
  row(TOMORROW, JAN, 'Sta. Rosa Lot 22', 'f5'),
  // Still not shared from Wednesday: carried over.
  row('2026-10-28', JAN, 'Ortigas Office 9F', 'o2'),
  row('2026-10-28', JAN, 'Calamba Warehouse C', 'w3', 'Posted'),
];

type Overrides = Partial<AssignScreenProps>;

/** The screen as the shell would hold it: intern and day are the shell's. */
function Harness(props: Overrides & { onSaveSpy?: (save: QueueSave) => void }) {
  const [intern, setIntern] = useState<string | null>(props.intern === undefined ? JAN : props.intern);
  const [date, setDate] = useState(props.date ?? TOMORROW);
  return (
    <AssignScreen
      interns={[JAN, MIKA]}
      today={TODAY}
      properties={LIBRARY}
      posts={POSTS}
      assignments={ASSIGNMENTS}
      settings={{ cooldownDays: 7, repostDueDays: 14, perIntern: 20 }}
      team={[
        { name: JAN, role: 'Intern', fbAccounts: ['APG Main'] },
        { name: MIKA, role: 'Intern', fbAccounts: [] },
      ]}
      onSave={async (save) => {
        props.onSaveSpy?.(save);
      }}
      {...props}
      intern={intern}
      date={date}
      onInternChange={(name) => {
        props.onInternChange?.(name);
        setIntern(name);
      }}
      onDateChange={(day) => {
        props.onDateChange?.(day);
        setDate(day);
      }}
    />
  );
}

const queueNames = () =>
  Array.from(document.querySelectorAll('.assign-queue .queue-row__name')).map((n) => n.textContent);
const listNames = () =>
  Array.from(document.querySelectorAll('.lib__list .lib-row__name')).map((n) => n.textContent?.replace("Can't add: ", ''));
const libRow = (name: string) =>
  Array.from(document.querySelectorAll('.lib__list .lib-row')).find((li) => li.querySelector('.lib-row__name')?.textContent?.endsWith(name)) as HTMLElement;
const chip = (name: RegExp | string) => within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name });

afterEach(cleanup);

describe('Assign, step one: choose an intern', () => {
  it('lists the interns with their FB name, what they have open and today, and moves to step two on a pick', async () => {
    const onInternChange = vi.fn();
    render(<Harness intern={null} onInternChange={onInternChange} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assign');
    const list = screen.getByRole('list', { name: 'Interns' });
    const jan = within(list).getByRole('button', { name: /Jan Dela Cruz/ });
    expect(jan.textContent).toContain('APG Main');
    expect(jan.textContent).toContain('3 not shared · 28 Oct, 30 Oct');
    expect(jan.textContent).toContain('No queue today');
    expect(within(list).getByRole('button', { name: /Mika Reyes/ }).textContent).toContain('Any FB account');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search interns' }), 'mik');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search interns' }));

    await userEvent.click(within(screen.getByRole('list', { name: 'Interns' })).getByRole('button', { name: /Jan Dela Cruz/ }));
    expect(onInternChange).toHaveBeenCalledWith(JAN);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(JAN);
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
  });

  it('puts the chosen intern in the link, and All interns goes back', async () => {
    let path = '';
    function Spy() {
      const location = useLocation();
      path = location.pathname + location.search;
      return null;
    }
    render(
      <AppStateProvider platform={fakeServer()} initialUser={manager} initialSettings={{ scriptUrl: EXEC }} now={() => NOW}>
        <MemoryRouter initialEntries={['/assign']} future={routerFuture}>
          <AppShell />
          <Spy />
        </MemoryRouter>
      </AppStateProvider>,
    );
    const list = await screen.findByRole('list', { name: 'Interns' });
    await userEvent.click(await within(list).findByRole('button', { name: new RegExp(janUser.name) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(janUser.name);
    expect(new URLSearchParams(path.split('?')[1]).get('intern')).toBe(janUser.name);

    await userEvent.click(screen.getByRole('button', { name: 'All interns' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assign');
    expect(path).not.toContain('intern=');
  });
});

describe('Assign, step two: the library by category', () => {
  it('counts what can go in, per category, and filters by tab, Fresh and Due for repost', async () => {
    render(<Harness />);
    // Lot 12 and Sta. Rosa are in the queue already; Casa Amara is free. Lot 7 is in its cooldown, Seaside is Mika's.
    expect(chip(/^All/).textContent).toContain('6');
    expect(chip(/Warehouse/).textContent).toContain('3');
    expect(chip(/Condo/).textContent).toContain('3');
    expect(chip(/Office space/).textContent).toContain('0');
    expect(chip(/Commercial space/).textContent).toContain('0');

    await userEvent.click(chip(/Warehouse/));
    expect(chip(/Warehouse/).getAttribute('aria-pressed')).toBe('true');
    // Never posted first, then the longest since posted.
    expect(listNames()).toEqual(['Meycauayan Warehouse B', 'Valenzuela Warehouse A', 'Calamba Warehouse C']);
    expect(libRow('Calamba Warehouse C').textContent).toContain('Posted 28 days ago');
    expect(libRow('Meycauayan Warehouse B').textContent).toContain('Never posted');

    await userEvent.click(screen.getByRole('button', { name: 'Due for repost' }));
    expect(listNames()).toEqual(['Calamba Warehouse C']);
    await userEvent.click(screen.getByRole('button', { name: 'Due for repost' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fresh' }));
    expect(listNames()).toEqual(['Meycauayan Warehouse B', 'Valenzuela Warehouse A']);

    // Adding: a click (or Enter), and the row says it's in.
    await userEvent.click(screen.getByRole('button', { name: 'Add Valenzuela Warehouse A' }));
    expect(queueNames()).toContain('Valenzuela Warehouse A');
    expect(screen.getByRole('button', { name: 'Valenzuela Warehouse A, in the queue' }).getAttribute('aria-disabled')).toBe('true');
    screen.getByRole('button', { name: 'Add Meycauayan Warehouse B' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(queueNames()).toContain('Meycauayan Warehouse B');
  });

  it('searches within the tab', async () => {
    render(<Harness />);
    await userEvent.click(chip(/Condo/));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search listings' }), 'casa');
    expect(listNames()).toEqual(['Casa Amara House & Lot']);
    expect(libRow('Casa Amara House & Lot').textContent).toContain('Tagaytay · 320 sqm');
  });

  it('hides what can’t go in, and shows it greyed with the reason on request, without an Add', async () => {
    render(<Harness />);
    expect(listNames()).not.toContain('Seaside Residences 2BR');
    expect(listNames()).not.toContain('Verdant Hills Lot 7');

    await userEvent.click(screen.getByRole('button', { name: 'Show unavailable' }));
    expect(libRow('Seaside Residences 2BR').textContent).toContain('With Mika since 30 Oct');
    expect(libRow('BGC Office 18F').textContent).toContain('With Mika since 28 Oct');
    expect(libRow('Verdant Hills Lot 7').textContent).toContain('Posted 2 days ago');
    expect(libRow('Kapitolyo Retail').textContent).toContain('Sold');
    expect(libRow('Makati Retail').textContent).toContain('No separator');
    expect(libRow('Ortigas Office 9F').textContent).toContain('Still not shared from 28 Oct');
    for (const name of ['Seaside Residences 2BR', 'BGC Office 18F', 'Verdant Hills Lot 7', 'Kapitolyo Retail']) {
      expect(screen.queryByRole('button', { name: `Add ${name}` })).toBeNull();
      expect(libRow(name).classList.contains('lib-row--off')).toBe(true);
    }
    // Where they'd be in posting order: never posted first, so a posted one comes after.
    expect(listNames().indexOf('Seaside Residences 2BR')).toBeLessThan(listNames().indexOf('Verdant Hills Lot 7'));
  });
});

describe('Assign, quick fill', () => {
  it('adds N from the chosen category, never posted first, highlighted, with Undo', async () => {
    render(<Harness />);
    await userEvent.click(chip(/Warehouse/));
    const count = screen.getByRole('spinbutton', { name: 'How many to add from Warehouse' });
    expect((count as HTMLInputElement).value).toBe('20');
    await userEvent.clear(count);
    await userEvent.type(count, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 for posting' }));

    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Meycauayan Warehouse B', 'Valenzuela Warehouse A']);
    expect(document.querySelectorAll('.queue-row--preview')).toHaveLength(2);
    expect(screen.getByText('Added 2 from Warehouse.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
  });

  it('never adds a held, sold or cooling listing, and says when it ran out', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Add 20 for posting' }));
    const names = queueNames();
    expect(names).toEqual(expect.arrayContaining(['Casa Amara House & Lot', 'Meycauayan Warehouse B', 'Valenzuela Warehouse A', 'Calamba Warehouse C']));
    for (const no of ['Seaside Residences 2BR', 'BGC Office 18F', 'Verdant Hills Lot 7', 'Kapitolyo Retail', 'Makati Retail', 'Ortigas Office 9F']) {
      expect(names).not.toContain(no);
    }
    expect(screen.getByText("Added 4. That's all that's free.")).toBeTruthy();
  });
});

describe('Assign, still not shared from earlier', () => {
  it('moves an earlier item to this day, and frees it from its old day on save', async () => {
    const onSaveSpy = vi.fn();
    render(<Harness onSaveSpy={onSaveSpy} />);
    const carried = screen.getByText('Still not shared from earlier', { exact: false }).closest('details')!;
    expect(carried.textContent).toContain('(1)');
    await userEvent.click(within(carried).getByText('Still not shared from earlier', { exact: false }));
    await userEvent.click(within(carried).getByRole('button', { name: 'Move Ortigas Office 9F to this day' }));
    expect(queueNames()).toContain('Ortigas Office 9F');
    expect(screen.getByText('Moved from 28 Oct')).toBeTruthy();
    expect(screen.queryByText('Still not shared from earlier', { exact: false })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^Save queue/ }));
    const save = onSaveSpy.mock.calls[0]?.[0] as QueueSave;
    expect(save.items.map((i) => i.propertyName)).toContain('Ortigas Office 9F');
    // Wednesday's queue is saved again without it; the posted row stays.
    expect(save.releases).toEqual([
      { date: '2026-10-28', assignedTo: JAN, items: [{ propertyName: 'Calamba Warehouse C', propertyId: 'w3', status: 'Posted' }] },
    ]);
  });

  it('removes an earlier item, releasing it on save', async () => {
    const onSaveSpy = vi.fn();
    render(<Harness onSaveSpy={onSaveSpy} />);
    await userEvent.click(screen.getByText('Still not shared from earlier', { exact: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ortigas Office 9F from 28 Oct' }));
    expect(screen.getByText('1 earlier listing will be freed on save.')).toBeTruthy();
    expect(queueNames()).not.toContain('Ortigas Office 9F');
    await userEvent.click(screen.getByRole('button', { name: /^Save queue/ }));
    const save = onSaveSpy.mock.calls[0]?.[0] as QueueSave;
    expect(save.items.map((i) => i.propertyName)).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
    expect(save.releases?.[0]?.items.map((i) => i.propertyName)).toEqual(['Calamba Warehouse C']);
  });
});

describe('Assign, saving', () => {
  it('marks the rows a held refusal names, keeps the rest, and removes them on request', async () => {
    const refusal = Object.assign(new UserFacingError('Casa Amara House & Lot is with Bea.'), {
      held: [{ propertyName: 'Casa Amara House & Lot', propertyId: 'f3', heldBy: 'Bea Lim', date: '2026-10-29' }],
    });
    const onSave = vi.fn().mockRejectedValue(refusal);
    render(<Harness onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Casa Amara House & Lot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Meycauayan Warehouse B' }));
    await userEvent.click(screen.getByRole('button', { name: /^Save queue/ }));

    await screen.findByText('One listing is held by another intern. Remove it, then save again.');
    const refused = document.querySelector('.queue-row--refused')!;
    expect(refused.textContent).toContain('Casa Amara House & Lot');
    expect(refused.textContent).toContain('With Bea since 29 Oct');
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Casa Amara House & Lot', 'Meycauayan Warehouse B']);

    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Meycauayan Warehouse B']);
  });

  it('saves the queue in its new order, and the button says how many', async () => {
    const onSaveSpy = vi.fn();
    render(<Harness onSaveSpy={onSaveSpy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Sta. Rosa Lot 22 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save queue (2)' }));
    expect(onSaveSpy).toHaveBeenCalledTimes(1);
    const save = onSaveSpy.mock.calls[0]?.[0] as QueueSave;
    expect(save.date).toBe(TOMORROW);
    expect(save.assignedTo).toBe(JAN);
    expect(save.items.map((i) => i.propertyName)).toEqual(['Sta. Rosa Lot 22', 'Verdant Hills Lot 12']);
    expect(save.releases).toBeUndefined();
    expect(await screen.findByText('Saved. Jan has 2 listings for Fri 30 Oct.')).toBeTruthy();
  });
});

describe('Assign, kept from before', () => {
  it("opens on the intern's saved queue for the day", () => {
    render(<Harness />);
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
    expect(screen.getByText(`Jan's queue for Fri 30 Oct is saved.`, { exact: false })).toBeTruthy();
  });

  it('matches a pasted list, offers a suggestion for a typo, and adds it once accepted', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
    const box = screen.getByRole('textbox', { name: 'Paste a list' });
    fireEvent.change(box, { target: { value: '1. Casa Amara House & Lot\n2. Verdnt Hills Lot 12\n- Nowhere Plaza' } });
    await userEvent.click(screen.getByRole('button', { name: 'Match to the library' }));

    const matches = screen.getByRole('region', { name: 'Matches' });
    expect(matches.textContent).toContain('Not found: “Nowhere Plaza”');
    expect(matches.textContent).toContain('Did you mean Verdant Hills Lot 12?');
    await userEvent.click(within(matches).getByRole('button', { name: 'Add 1 found listing' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Casa Amara House & Lot']);
    await userEvent.click(screen.getByRole('button', { name: 'Back to listings' }));
    expect(screen.getByRole('searchbox', { name: 'Search listings' })).toBeTruthy();
  });

  it('a pasted listing another intern holds is refused, and says whose it is', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste a list' }), { target: { value: 'BGC Office 18F' } });
    await userEvent.click(screen.getByRole('button', { name: 'Match to the library' }));
    expect(screen.getByRole('region', { name: 'Matches' }).textContent).toContain('With Mika since 28 Oct.');
  });

  it('reorders from the keyboard, keeping the focus on the arrow that moved', async () => {
    render(<Harness />);
    const down = screen.getByRole('button', { name: 'Move Verdant Hills Lot 12 down' });
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(queueNames()).toEqual(['Sta. Rosa Lot 22', 'Verdant Hills Lot 12']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Verdant Hills Lot 12 down' }));

    // Alt+Up from anywhere in the row moves it back.
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);

    // Already first: nothing moves.
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
    expect(screen.getByText('Verdant Hills Lot 12 is already first.')).toBeTruthy();
  });

  it('asks before throwing away unsaved changes when going back to the interns, and keeps them on request', async () => {
    const onInternChange = vi.fn();
    render(<Harness onInternChange={onInternChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12']);

    const back = screen.getByRole('button', { name: 'All interns' });
    await userEvent.click(back);
    expect(onInternChange).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes to Jan's queue for Fri 30 Oct")).toBeTruthy();
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);

    await userEvent.click(keep);
    expect(onInternChange).not.toHaveBeenCalled();
    expect(queueNames()).toEqual(['Verdant Hills Lot 12']);
    expect(document.activeElement).toBe(back);

    await userEvent.click(back);
    await userEvent.click(screen.getByRole('button', { name: 'Discard and choose an intern' }));
    expect(onInternChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole('list', { name: 'Interns' })).toBeTruthy();
  });

  it('asks before switching day too, and moves on once discarded', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await userEvent.click(screen.getByRole('button', { name: /Discard and open Thu 29 Oct/ }));
    expect(queueNames()).toEqual([]);
    expect(screen.getByText('Nothing queued for Thu 29 Oct yet.')).toBeTruthy();
  });

  it('tells the shell when there are unsaved changes, so it can guard leaving', async () => {
    const onDirtyChange = vi.fn();
    const { unmount } = render(<Harness onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    act(() => unmount());
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});
