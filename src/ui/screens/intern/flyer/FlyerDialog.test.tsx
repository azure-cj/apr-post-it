// @vitest-environment jsdom
/**
 * The flyer (1.1.8): offered under the photos, made only from the text Copy
 * takes, copied a page at a time or saved with the photos. jsdom can't draw a
 * page, so the picture-making is stood in for by a tiny PNG.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { CLEAN, fakeServer, manager, propertyReply, renderApp } from '../../../state/testing';

vi.mock('html-to-image', () => ({
  toBlob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: 'image/png' }),
}));

const PATH = `/property/${CLEAN.id}`;

async function openFlyer() {
  const offer = await screen.findByRole('button', { name: 'Make a flyer' }, { timeout: 5000 });
  await userEvent.click(offer);
  return screen.findByRole('dialog', { name: 'Flyer' });
}

describe('the flyer', () => {
  it('reads the copied text only, and saves the flyer next to the photos', async () => {
    const platform = fakeServer({ property: propertyReply({ internalText: 'Owner: Mrs. Navarro, 0918 555 0199' }) });
    renderApp({ platform, user: manager, path: PATH });
    const dialog = await openFlyer();

    expect(dialog.textContent).toContain('₱4.2M to buy');
    expect(dialog.textContent).not.toContain('Navarro');
    expect(dialog.textContent).not.toContain('0918 555 0199');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the flyer' }));
    await waitFor(() => expect(platform.imageSaves).toHaveLength(1), { timeout: 5000 });
    expect(platform.imageSaves[0]!.property).toBe(CLEAN.name);
    expect(platform.imageSaves[0]!.images.map((i) => i.name)).toEqual(['Flyer.png']);
    expect(await within(dialog).findByText('Flyer saved with the photos.')).toBeTruthy();
  });

  it('copies the page shown, from the full photos', async () => {
    const platform = fakeServer();
    renderApp({ platform, user: manager, path: PATH });
    const dialog = await openFlyer();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy image' }));
    await waitFor(() => expect(platform.copiedImages).toHaveLength(1), { timeout: 5000 });
    expect(platform.photosRead.length).toBeGreaterThan(0);
    expect(await within(dialog).findByText('Page 1 copied. Paste it into Facebook with Ctrl+V.')).toBeTruthy();
  });

  it('makes the poster in the size chosen, saved to go up before the photos', async () => {
    const platform = fakeServer();
    renderApp({ platform, user: manager, path: PATH });
    const dialog = await openFlyer();

    await userEvent.click(within(dialog).getByRole('button', { name: /Poster$/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Story' }));
    expect(within(dialog).getByText('Made at 1080 × 1920, for a story.')).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox', { name: /Add a satellite map page/ })).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the poster' }));
    await waitFor(() => expect(platform.imageSaves).toHaveLength(1), { timeout: 5000 });
    expect(platform.imageSaves[0]!.images.map((i) => i.name)).toEqual(['00 Poster.png']);
    expect(await within(dialog).findByText('Poster saved first in the photos folder. Post it first, then the photos.')).toBeTruthy();
  });

  it('fits a virtual office post: its own heading and deals, no sale or lease, no map, asked to inquire (D42)', async () => {
    const platform = fakeServer({
      property: propertyReply({
        category: 'Virtual Office for posting',
        listingType: '',
        subCategory: '',
        cutAt: '',
        onRequest: true,
        publicText: '2026 NEW VIRTUAL OFFICE\n• Business address in Makati\n• Rate: ₱2,500/month\nCall 0927 555 5803',
      }),
    });
    renderApp({ platform, user: manager, path: PATH });
    expect(await screen.findByText(/Set up your virtual office today: message us here, or call the numbers above\./, {}, { timeout: 5000 })).toBeTruthy();
    const dialog = await openFlyer();

    expect((within(dialog).getByRole('textbox', { name: 'What it is' }) as HTMLInputElement).value).toBe('Virtual office');
    const deals = within(dialog).getByRole('group', { name: 'Deal' });
    expect(within(deals).getAllByRole('button').map((b) => b.textContent)).toEqual(['Now available', 'Monthly plan', 'Yearly plan']);
    expect(within(deals).getByRole('button', { name: 'Monthly plan' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).queryByRole('group', { name: 'Sale or lease' })).toBeNull();
    expect(within(dialog).queryByRole('checkbox', { name: /Add a satellite map page/ })).toBeNull();
    expect(dialog.textContent).toContain('₱2,500 a month');
    expect(dialog.textContent).not.toMatch(/For lease|For sale|viewing/);
  });

  it("says why there's no map when the server can't make one", async () => {
    const sentence = "The location map isn't set up yet. Ask your admin.";
    const platform = fakeServer({ locationRing: { ok: false, error: sentence, message: sentence, reason: 'no-secret' } });
    renderApp({ platform, user: manager, path: PATH });
    const dialog = await openFlyer();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Add a satellite map page/ }));
    expect((await within(dialog).findAllByText(sentence, {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save all 2 pages' }));
    expect(await within(dialog).findByText('The map page has no map. Turn it off, or try again.')).toBeTruthy();
    expect(platform.imageSaves).toHaveLength(0);
  });
});
