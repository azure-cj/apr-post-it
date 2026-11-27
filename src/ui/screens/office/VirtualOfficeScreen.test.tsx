// @vitest-environment jsdom
/**
 * Virtual office: the designs fill the page, the editor opens only on Edit, and the chosen design
 * is copied or saved through the platform. jsdom can't draw a design, so the picture-making is
 * stood in for by a tiny PNG.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { fakeServer, manager, renderApp } from '../../state/testing';
import { paths } from '../../state';

vi.mock('html-to-image', () => ({
  toBlob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: 'image/png' }),
}));

const stage = () => document.querySelector<HTMLElement>('.vo__stage')!;

describe('Virtual office', () => {
  it('is in every sidebar, and shows the designs with the editor closed', async () => {
    renderApp({ platform: fakeServer(), path: paths.virtualOffice });
    expect(await screen.findByRole('heading', { name: 'Virtual office' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Virtual office' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelectorAll('.vo__strip figure')).toHaveLength(12);
    expect(screen.queryByRole('complementary', { name: 'Edit the offer' })).toBeNull();
    expect(stage().textContent).toContain('Ortigas');
  });

  it('opens the editor on Edit, follows the offer, and closes on Done or Esc', async () => {
    renderApp({ platform: fakeServer(), user: manager, path: paths.virtualOffice });
    const edit = await screen.findByRole('button', { name: 'Edit' });
    await userEvent.click(edit);
    const editor = screen.getByRole('complementary', { name: 'Edit the offer' });
    expect(screen.getByRole('button', { name: 'Done' }).getAttribute('aria-expanded')).toBe('true');

    const city = within(editor).getByLabelText('City or building');
    fireEvent.change(city, { target: { value: 'Makati' } });
    expect(stage().textContent).toContain('Makati');

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('complementary', { name: 'Edit the offer' })).toBeNull();
    expect(stage().textContent).toContain('Makati');

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Offer' }), { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Edit the offer' })).toBeNull();
  });

  it('copies the chosen design to paste into a post', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: paths.virtualOffice });
    await userEvent.click(await screen.findByRole('button', { name: 'Plans' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    await waitFor(() => expect(platform.copiedImages).toHaveLength(1));
    expect(platform.copiedImages[0]!.name).toBe('Plans');
    expect(await screen.findByText('Plans copied. Paste it into your post with Ctrl+V.')).toBeTruthy();
  });

  it('saves the chosen design in its own folder', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: paths.virtualOffice });
    await userEvent.click(await screen.findByRole('button', { name: 'Save PNG' }));
    await waitFor(() => expect(platform.imageSaves).toHaveLength(1));
    expect(platform.imageSaves[0]!.property).toBe('Virtual office');
    expect(platform.imageSaves[0]!.images.map((i) => i.name)).toEqual(['Lead post.png']);
    expect(await screen.findByText(/Lead post\.png saved\./)).toBeTruthy();
  });
});
