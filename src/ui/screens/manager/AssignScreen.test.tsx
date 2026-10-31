// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, PostLogEntry, Property } from '@/core/types';
import { AssignScreen, type AssignScreenProps, type QueueSave } from './index';

const TODAY = '2026-10-29';
const TOMORROW = '2026-10-30';
const JAN = 'Jan Dela Cruz';
const MIKA = 'Mika Reyes';

function listing(id: string, name: string): Property {
  return {
    id,
    name,
    category: 'CONDO / HOUSE AND LOT',
    listingType: 'FOR SALE',
    subCategory: '',
    photoCount: 5,
    hasIssues: false,
  };
}

const LIBRARY: readonly Property[] = [
  listing('f1', 'Verdant Hills Lot 12'),
  listing('f2', 'Verdant Hills Lot 7'),
  listing('f3', 'Casa Amara House & Lot'),
  listing('f4', 'Seaside Residences 2BR'),
  listing('f5', 'Sta. Rosa Lot 22'),
];

const POSTS: readonly PostLogEntry[] = [
  // Two days before tomorrow's queue: in its cooldown until 4 Nov.
  {
    date: '2026-10-27',
    time: '14:20',
    type: 'Group post',
    title: 'Verdant Hills Lot 7',
    status: 'Posted',
    fbAccount: 'APG Main',
    postLink: 'https://www.facebook.com/groups/x/posts/1/',
    postedBy: JAN,
    propertyId: 'f2',
  },
];

const ASSIGNMENTS: readonly Assignment[] = [
  { date: TOMORROW, assignedTo: MIKA, propertyName: 'Seaside Residences 2BR', propertyId: 'f4', status: 'Not Shared' },
  { date: TOMORROW, assignedTo: JAN, propertyName: 'Verdant Hills Lot 12', propertyId: 'f1', status: 'Not Shared' },
  { date: TOMORROW, assignedTo: JAN, propertyName: 'Sta. Rosa Lot 22', propertyId: 'f5', status: 'Not Shared' },
];

type Overrides = Partial<AssignScreenProps>;

/** The screen as the shell would hold it: intern and day are the shell's. */
function Harness(props: Overrides & { onSaveSpy?: (save: QueueSave) => void }) {
  const [intern, setIntern] = useState<string | null>(props.intern === undefined ? JAN : props.intern);
  const [date, setDate] = useState(props.date ?? TOMORROW);
  return (
    <AssignScreen
      interns={[JAN, MIKA]}
      intern={intern}
      date={date}
      today={TODAY}
      properties={LIBRARY}
      posts={POSTS}
      assignments={ASSIGNMENTS}
      settings={{ cooldownDays: 7, repostDueDays: 14 }}
      onInternChange={setIntern}
      onDateChange={setDate}
      onSave={async (save) => {
        props.onSaveSpy?.(save);
      }}
      {...props}
    />
  );
}

const queueNames = () =>
  Array.from(document.querySelectorAll('.assign-queue .queue-row__name')).map((n) => n.textContent);

const resultRow = (name: string) => screen.getByText(name, { selector: '.assign-result__name' }).closest('li')!;

afterEach(cleanup);

describe('AssignScreen', () => {
  it("opens on the intern's saved queue for the day", () => {
    render(<Harness />);
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
    expect(screen.getByText(`Jan's queue for Fri 30 Oct is saved.`, { exact: false })).toBeTruthy();
  });

  it("won't add a listing in its cooldown, and says why and when it can go in", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the library' }), 'Verdant');
    const row = resultRow('Verdant Hills Lot 7');
    expect(within(row).getByText('In cooldown')).toBeTruthy();
    expect(row.textContent).toContain('It can go in a queue from');
    expect(row.textContent).toContain('It can go in a queue from Tue 3 Nov.');

    const add = within(row).getByRole('button', { name: 'Add Verdant Hills Lot 7' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    // The button points at the reason, so a screen reader hears why.
    const reasonId = add.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toContain('It can go in a queue from');
    await userEvent.click(add);
    expect(queueNames()).not.toContain('Verdant Hills Lot 7');
  });

  it("won't add a listing already in another intern's queue that day, and names them", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the library' }), 'Seaside');
    const row = resultRow('Seaside Residences 2BR');
    expect(row.textContent).toContain("Already in Mika's queue for Fri 30 Oct.");
    expect((within(row).getByRole('button', { name: 'Add Seaside Residences 2BR' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('matches a pasted list, offers a suggestion for a typo, and adds it once accepted', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
    const box = screen.getByRole('textbox', { name: 'Paste a list' });
    fireEvent.change(box, { target: { value: '1. Casa Amara House & Lot\n2. Verdnt Hills Lot 12\n- Nowhere Plaza' } });
    await userEvent.click(screen.getByRole('button', { name: 'Match to the library' }));

    const matches = screen.getByRole('region', { name: 'Matches' });
    expect(matches.textContent).toContain('Not found: “Nowhere Plaza”');
    // Lot 12 is already in the queue: the suggestion says so rather than offering it again.
    expect(matches.textContent).toContain('Did you mean Verdant Hills Lot 12?');

    // Casa Amara is an exact match: added with the rest of what was found.
    await userEvent.click(within(matches).getByRole('button', { name: 'Add 1 found listing' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Casa Amara House & Lot']);
  });

  it('accepts a did-you-mean suggestion', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste a list' }), { target: { value: 'Casa Amara Hous and Lot' } });
    await userEvent.click(screen.getByRole('button', { name: 'Match to the library' }));
    const matches = screen.getByRole('region', { name: 'Matches' });
    expect(matches.textContent).toContain('Did you mean Casa Amara House & Lot?');
    await userEvent.click(within(matches).getByRole('button', { name: 'Yes, add Casa Amara House & Lot' }));
    expect(queueNames()).toContain('Casa Amara House & Lot');
    expect(matches.textContent).toContain('You typed “Casa Amara Hous and Lot”.');
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

  it('saves the queue in its new order', async () => {
    const onSaveSpy = vi.fn();
    render(<Harness onSaveSpy={onSaveSpy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Sta. Rosa Lot 22 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save queue' }));
    expect(onSaveSpy).toHaveBeenCalledTimes(1);
    const save = onSaveSpy.mock.calls[0]?.[0] as QueueSave;
    expect(save.date).toBe(TOMORROW);
    expect(save.assignedTo).toBe(JAN);
    expect(save.items.map((i) => i.propertyName)).toEqual(['Sta. Rosa Lot 22', 'Verdant Hills Lot 12']);
    expect(await screen.findByText('Saved. Jan has 2 listings for Fri 30 Oct.')).toBeTruthy();
  });

  it('asks before throwing away unsaved changes when switching intern, and keeps them on request', async () => {
    const onInternChange = vi.fn();
    render(<Harness onInternChange={onInternChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12']);

    const mika = screen.getByRole('button', { name: MIKA });
    await userEvent.click(mika);
    expect(onInternChange).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes to Jan's queue for Fri 30 Oct")).toBeTruthy();
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);

    await userEvent.click(keep);
    expect(onInternChange).not.toHaveBeenCalled();
    expect(queueNames()).toEqual(['Verdant Hills Lot 12']);
    expect(document.activeElement).toBe(mika);

    await userEvent.click(mika);
    await userEvent.click(screen.getByRole('button', { name: "Discard and open Mika's queue" }));
    expect(onInternChange).toHaveBeenCalledWith(MIKA);
  });

  it('asks before switching day too, and moves on once discarded', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { name: /Discard and open Thu 29 Oct/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Discard and open Thu 29 Oct/ }));
    // Today, Jan has no queue.
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
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
