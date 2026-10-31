// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeServer, renderApp } from '../../state/testing';

const names = () => Array.from(document.querySelectorAll('.result__name')).map((n) => n.textContent);
const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('Find', () => {
  it('searches on every keystroke, from a box that has the focus on arrival', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');
    expect(names()).toHaveLength(5);

    const box = screen.getByRole('searchbox', { name: 'Search listings' });
    expect(document.activeElement).toBe(box);

    await userEvent.type(box, 'w');
    await waitFor(() => expect(names()).toEqual(['BGC Uptown Office 18F, 240 sqm', 'Valenzuela Warehouse 1,200 sqm']));
    await userEvent.type(box, 'are');
    await waitFor(() => expect(names()).toEqual(['Valenzuela Warehouse 1,200 sqm']));
    expect(screen.getByText('1 match of 5 listings')).toBeTruthy();
  });

  it('shows each result’s folder line, photos and whether it was flagged', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    const row = (await screen.findByText('Valenzuela Warehouse 1,200 sqm')).closest('a')!;
    expect(row.textContent).toContain('Warehouse · For lease / for rent');
    expect(row.textContent).toContain('No photos');
    expect(within(row).getByText('Has issues')).toBeTruthy();
    expect(row.querySelector('.category-dot--warehouse')).toBeTruthy();

    const clean = screen.getByText('Verdant Hills Lot 12, Tagaytay').closest('a')!;
    expect(clean.textContent).toContain('Condo / house and lot · Lot · For sale');
    expect(clean.textContent).toContain('2 photos');
    expect(within(clean).queryByText('Has issues')).toBeNull();
  });

  it('narrows by category and listing type, counting what each choice would show', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');

    expect(chip(/Condo \/ house and lot/).textContent).toMatch(/2$/);
    expect(chip(/For lease \/ for rent/).textContent).toMatch(/3$/);

    await userEvent.click(chip(/Condo \/ house and lot/));
    expect(chip(/Condo \/ house and lot/).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(names()).toEqual(['Seaside Residences 2BR, Pasay', 'Verdant Hills Lot 12, Tagaytay']));
    // The listing types now count within the category.
    expect(chip(/For lease \/ for rent/).textContent).toMatch(/0$/);
    expect(chip(/For sale/).textContent).toMatch(/2$/);

    await userEvent.click(chip(/Condo \/ house and lot/));
    await waitFor(() => expect(names()).toHaveLength(5));
  });

  it('opens the first result on Enter, and moves through them with the arrow keys', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('BGC Uptown Office 18F');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Kapitolyo');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));

    await userEvent.type(screen.getByRole('searchbox'), 'verdant{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
  });

  it('says what to do when nothing matches', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText('No listing matches “zzz”')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    await waitFor(() => expect(names()).toHaveLength(5));
  });

  it("shows the server's sentence when the list can't be loaded", async () => {
    renderApp({
      platform: fakeServer({ properties: { ok: false, error: 'No "Directory" tab. Run BuildDirectory.gs first.' } }),
      path: '/find',
    });
    expect(await screen.findByText(/Google could not load the property list: No "Directory" tab/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
