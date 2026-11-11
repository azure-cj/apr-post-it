// @vitest-environment jsdom
/**
 * The property page carries the app's most important promise: an intern
 * never sees or copies the owner's details or the commission. These tests
 * hold the screen to it even when the server's reply is wrong.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { splitAtSeparator_ } from '@server/Separators.gs';
import { CLEAN, fakeServer, intern, manager, PROPERTIES, propertyReply, renderApp, TODAY } from '../../state/testing';

const PATH = `/property/${CLEAN.id}`;

/** The list's reply, with the checker's fields added to CLEAN's row. */
const listWith = (changes: Readonly<Record<string, unknown>>) => ({
  ...PROPERTIES,
  properties: PROPERTIES.properties.map((p) => (p.id === CLEAN.id ? { ...p, ...changes } : p)),
});

const copyButton = () => screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;

/** The sentence beside Copy: what it says about why it is on or off. */
const reason = () => document.getElementById((copyButton().getAttribute('aria-describedby') ?? '').split(' ')[0] ?? '')?.textContent ?? '';

/** Waits until the document and the posts are in, so Copy has its final state. A busy PC (the whole suite, a release build) can take more than a second. */
async function settled() {
  await waitFor(() => expect(reason()).toMatch(/Every check passed|^Copy is blocked/), { timeout: 5000 });
}

describe('Copy', () => {
  it('is enabled when every check passes, and copies the public text and nothing else', async () => {
    const platform = fakeServer({ property: propertyReply({ internalText: 'Owner: Mrs. Navarro, 0918 555 0199' }) });
    renderApp({ platform, user: manager, path: PATH });
    await settled();

    expect(copyButton().disabled).toBe(false);
    expect(reason()).toContain('Ready to copy');
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([CLEAN.publicText]));
    expect(platform.copied.join()).not.toContain('Navarro');
    expect(await screen.findByText('Copied. Paste it into Facebook.')).toBeTruthy();
  });

  it('stays enabled for a warning: a missing price asks for a second look, it does not block', async () => {
    const platform = fakeServer({
      property: propertyReply({ publicText: 'FOR SALE: 320 sqm lot\nPrice upon request.\nContact: 0917 555 0142' }),
    });
    renderApp({ platform, path: PATH });
    await settled();
    expect(copyButton().disabled).toBe(false);
    expect(screen.getByText('No price found in the public text')).toBeTruthy();
  });

  const failing: readonly { readonly case: string; readonly user: typeof intern; readonly reply: Record<string, unknown>; readonly says: RegExp }[] = [
    {
      case: 'commission wording in the public text',
      user: intern,
      reply: { publicText: `${CLEAN.publicText}\nReferral fee for co-brokers: half a month's rent.` },
      says: /mentions “Referral fee”/,
    },
    {
      case: 'an agent’s share in the public text',
      user: manager,
      reply: { publicText: `${CLEAN.publicText}\n2% to the agent who closes.` },
      says: /mentions “2% to the agent”/,
    },
  ];

  it.each(failing)('is disabled, with the reason beside it, for $case', async ({ user, reply, says }) => {
    const platform = fakeServer({ property: propertyReply(reply) });
    renderApp({ platform, user, path: PATH });
    await settled();

    expect(copyButton().disabled).toBe(true);
    expect(reason()).toMatch(/^Copy is blocked: /);
    expect(reason()).toMatch(says);
    // The failing line is in the checks too, marked as failed.
    expect(screen.getByRole('list', { name: 'Pre-post checks' }).textContent).toMatch(/failed\./);

    // Neither the button, nor its shortcut, nor copying the text by hand gets it out.
    fireEvent.click(copyButton());
    await userEvent.keyboard('{Alt>}c{/Alt}');
    const body = screen.getByRole('document', { name: 'Public text, blocked from copying' });
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    body.dispatchEvent(copyEvent);
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(platform.copied).toEqual([]);
  });

  it('is disabled while the listing is in a cooldown this screen can see', async () => {
    const platform = fakeServer({
      posts: {
        ok: true,
        posts: [
          { date: '2026-10-29', time: '13:37', type: '', title: CLEAN.name, status: 'Posted', fbAccount: 'APG Main', postLink: 'https://www.facebook.com/x', postedBy: intern.name, propertyId: CLEAN.id },
        ],
      },
    });
    renderApp({ platform, path: PATH });
    await settled();
    expect(copyButton().disabled).toBe(true);
    expect(reason()).toBe('Copy is blocked: it is in its cooldown until Thu 5 Nov 2026.');
    expect(screen.getByText('In cooldown', { selector: '.verdict__word' })).toBeTruthy();
  });

  it('copies with Alt+C when it may', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await settled();
    await userEvent.keyboard('{Alt>}c{/Alt}');
    await waitFor(() => expect(platform.copied).toEqual([CLEAN.publicText]));
  });
});

describe('a document nobody has separated, shown to be checked (D15)', () => {
  /** A v7 server's reply: the whole document, with the owner's line flagged. */
  const UNSEPARATED = propertyReply({
    hasInternal: false,
    withheld: false,
    unseparated: true,
    cutAt: '',
    issues: 'No separator line — the whole document is treated as postable. Check it.',
    publicText: 'FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4.2M\n\nCall the owner, Mr. Lim, 0918 555 0135\n\nTitle clean, ready for transfer.',
    flaggedLines: [3],
  });
  const tick = () => screen.getByRole('checkbox', { name: 'I checked it' }) as HTMLInputElement;
  const flaggedRows = () => Array.from(document.querySelectorAll('.post-text__row--flag'));

  it('shows the whole text with the flagged line marked, and Copy waits for the tick', async () => {
    const platform = fakeServer({ property: UNSEPARATED });
    renderApp({ platform, path: PATH });

    expect(await screen.findByText('No separator. Check before posting.')).toBeTruthy();
    expect(screen.getByText(/marked and won’t be copied/)).toBeTruthy();
    const body = screen.getByRole('document', { name: 'Whole document, marked lines not copied' });
    expect(body.textContent).toContain('Mr. Lim, 0918 555 0135');
    expect(flaggedRows().map((r) => r.textContent)).toEqual(['Not copied: Call the owner, Mr. Lim, 0918 555 0135']);

    await waitFor(() => expect(reason()).toBe('Tick “I checked it” to copy.'));
    expect(copyButton().disabled).toBe(true);
    expect(screen.getByText('Check before posting', { selector: '.verdict__word' })).toBeTruthy();
    expect(document.querySelector('.verdict--danger')).toBeNull();

    // Before the tick, neither the shortcut nor copying by hand gets anything out.
    await userEvent.keyboard('{Alt>}c{/Alt}');
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    body.dispatchEvent(copyEvent);
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(platform.copied).toEqual([]);

    await userEvent.click(tick());
    await waitFor(() => expect(copyButton().disabled).toBe(false));
    expect(reason()).toBe('Ready to copy. Marked lines stay out.');
    await userEvent.click(copyButton());
    await waitFor(() =>
      expect(platform.copied).toEqual(['FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4.2M\n\nTitle clean, ready for transfer.']),
    );
  });

  it('runs the checks on what would be copied, and says nothing contradictory', async () => {
    renderApp({ platform: fakeServer({ property: UNSEPARATED }), path: PATH });
    await waitFor(() => expect(reason()).toBe('Tick “I checked it” to copy.'));

    const checks = screen.getByRole('list', { name: 'Pre-post checks' }).textContent ?? '';
    expect(checks).toContain('₱4.2M');
    expect(checks).not.toContain('No price found');
    // The owner's number is not in the copy, so it is not counted as a contact.
    expect(checks).toContain('No contact number found');
    expect(checks).toContain('No separator. Marked lines are left out.');

    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/nothing above its separator/);
    expect(page).not.toMatch(/Copy is blocked/);
    expect(page).not.toMatch(/no separator yet/);
    expect(page).not.toMatch(/nothing safe to show/);
    // The directory's "No separator line" is the notice's to say, once.
    expect(screen.queryByText('Flagged by the directory')).toBeNull();
  });

  it('marks a line the app flags itself, even when the server missed it', async () => {
    const platform = fakeServer({
      property: propertyReply({
        hasInternal: false,
        withheld: false,
        unseparated: true,
        cutAt: '',
        publicText: 'FOR LEASE: 2BR, Pasig\nRent: ₱38,000 a month\nViber 0917 222 3333',
        flaggedLines: [],
      }),
    });
    renderApp({ platform, path: PATH });
    await waitFor(() => expect(flaggedRows()).toHaveLength(1));
    expect(flaggedRows()[0]!.textContent).toContain('0917 222 3333');

    await userEvent.click(tick());
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual(['FOR LEASE: 2BR, Pasig\nRent: ₱38,000 a month']));
  });

  it('still blocks on commission wording the flags missed, and shows the line', async () => {
    const platform = fakeServer({
      property: propertyReply({
        hasInternal: false,
        withheld: false,
        unseparated: true,
        cutAt: '',
        publicText: `${CLEAN.publicText}\n3 percent to whoever closes.`,
        flaggedLines: [2],
      }),
    });
    renderApp({ platform, path: PATH });
    await waitFor(() => expect(reason()).toMatch(/^Copy is blocked: /));

    expect(reason()).toBe('Copy is blocked: line 4 mentions “3 percent to whoever closes”. Ask your admin to remove it from the document.');
    expect(document.querySelector('.post-text__row--hit')?.textContent).toContain('3 percent to whoever closes.');
    expect(copyButton().disabled).toBe(true);
    expect(tick().disabled).toBe(true);
    expect(screen.getByText('Copy is blocked', { selector: '.verdict__word' })).toBeTruthy();
    await userEvent.keyboard('{Alt>}c{/Alt}');
    expect(platform.copied).toEqual([]);
  });

  it('is shown to an admin the same way, flagged by the app, with how to fix it', async () => {
    const platform = fakeServer({
      property: propertyReply({ hasInternal: false, withheld: false, internalText: '', cutAt: '', publicText: `${CLEAN.publicText}\nMr. Lim 0918 555 0135` }),
    });
    renderApp({ platform, user: manager, path: PATH });

    expect(await screen.findByText('No separator. Check before posting.')).toBeTruthy();
    expect(screen.getByText(/Add a separator to fix it:/)).toBeTruthy();
    // Both numbers are flagged: the app can't tell the agent's from the owner's.
    expect(flaggedRows().map((r) => r.textContent)).toEqual(['Not copied: Contact: 0917 555 0142', 'Not copied: Mr. Lim 0918 555 0135']);
    expect(screen.queryByText(/Interns see none of it/)).toBeNull();

    await userEvent.click(tick());
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual(['FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4.2M']));
  });

  it("gives an admin the separator to paste, Separators.gs's own, which cuts the text (AID-176)", async () => {
    const platform = fakeServer({
      property: propertyReply({ hasInternal: false, withheld: false, internalText: '', cutAt: '', publicText: `${CLEAN.publicText}\nMr. Lim 0918 555 0135` }),
    });
    renderApp({ platform, user: manager, path: PATH });
    await screen.findByText('No separator. Check before posting.');

    await userEvent.click(screen.getByRole('button', { name: 'Copy separator' }));
    await waitFor(() => expect(platform.copied).toEqual(['---']));
    expect(await screen.findByText('Separator copied. Paste it on its own line where the public text ends.')).toBeTruthy();
    // Pasted on its own line, it is a separator: the owner's line is cut off.
    expect(splitAtSeparator_(`For sale\n${platform.copied[0]}\nMr. Lim 0918 555 0135`)).toMatchObject({ found: true, posting: 'For sale' });
  });

  it('gives an intern no separator to copy', async () => {
    renderApp({ platform: fakeServer({ property: UNSEPARATED }), path: PATH });
    await screen.findByText('No separator. Check before posting.');
    expect(screen.queryByRole('button', { name: 'Copy separator' })).toBeNull();
  });
});

describe('a document nobody has separated, from an older server or with no document', () => {
  it('shows an intern the explanation and none of the text', async () => {
    const platform = fakeServer({
      property: propertyReply({ hasInternal: false, withheld: true, cutAt: '', publicText: '', issues: 'No separator line' }),
    });
    renderApp({ platform, path: PATH });

    expect(await screen.findByText("There's nothing safe to show yet")).toBeTruthy();
    expect(screen.getByText(/An admin has to add a separator above the owner's details/)).toBeTruthy();
    expect(screen.queryByRole('document')).toBeNull();
    expect(copyButton().disabled).toBe(true);
    expect(reason()).toBe('Copy is blocked: nobody has separated this document yet.');
  });

  it('shows an intern none of it when an older server, without `unseparated`, carried the text', async () => {
    const platform = fakeServer({
      property: propertyReply({
        hasInternal: false,
        withheld: false,
        cutAt: '',
        publicText: `${CLEAN.publicText}\nMr. Edgardo Lim, 0918 555 0135. 3 percent to whoever closes.`,
      }),
    });
    renderApp({ platform, path: PATH });

    expect(await screen.findByText("There's nothing safe to show yet")).toBeTruthy();
    expect(document.body.textContent).not.toContain('Edgardo Lim');
    expect(document.body.textContent).not.toContain('0918 555 0135');
    expect(document.body.textContent).not.toContain('Price: ₱4.2M');
    expect(screen.queryByRole('checkbox', { name: 'I checked it' })).toBeNull();
    expect(copyButton().disabled).toBe(true);
  });

  it('shows none of it when a reply says both unseparated and withheld', async () => {
    const platform = fakeServer({
      property: propertyReply({ hasInternal: false, withheld: true, unseparated: true, cutAt: '', publicText: 'Mr. Edgardo Lim, 0918 555 0135' }),
    });
    renderApp({ platform, path: PATH });

    expect(await screen.findByText("There's nothing safe to show yet")).toBeTruthy();
    expect(document.body.textContent).not.toContain('Edgardo Lim');
  });

  it('says so differently when the folder has no document at all', async () => {
    const platform = fakeServer({
      property: propertyReply({ hasInternal: false, withheld: true, cutAt: '', publicText: '', issues: 'No document' }),
    });
    renderApp({ platform, path: PATH });
    expect(await screen.findByText("There's no posting document yet")).toBeTruthy();
    expect(reason()).toBe('Copy is blocked: this listing has no posting document yet.');
  });
});

describe('the internal section', () => {
  it('is shown to an intern folded away, and never copied (D1)', async () => {
    const platform = fakeServer({
      property: propertyReply({ internalText: 'Owner: Mrs. Lourdes Navarro, 0918 555 0199\nCommission: 3%' }),
    });
    renderApp({ platform, path: PATH });

    const summary = await screen.findByText('Internal section: never posted, never copied');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);

    await userEvent.click(summary);
    expect(details.textContent).toContain('Mrs. Lourdes Navarro');

    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([CLEAN.publicText]));
  });

  it('cancels a copy made by hand from the internal section', async () => {
    const platform = fakeServer({ property: propertyReply({ internalText: 'Commission: 3%' }) });
    renderApp({ platform, path: PATH });

    const details = (await screen.findByText('Internal section: never posted, never copied')).closest('details')!;
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    details.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
  });

  it('is shown to a manager folded away under a warning, with where the text was cut', async () => {
    const platform = fakeServer({
      property: propertyReply({ internalText: 'Owner: Mrs. Lourdes Navarro, 0918 555 0199', cutAt: '--- line' }),
    });
    renderApp({ platform, user: manager, path: PATH });

    const summary = await screen.findByText('Internal section: never posted, never copied');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Cut at --- line');

    await userEvent.click(summary);
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('Mrs. Lourdes Navarro');
    expect(platform.copied).toEqual([]);
  });
});

describe('the header', () => {
  it('shows the category, and the city, size and deal when the checker has them', async () => {
    const platform = fakeServer({ properties: listWith({ city: 'Tagaytay', size: '320', dealType: 'For sale' }) });
    renderApp({ platform, path: PATH });
    await settled();
    await waitFor(() => expect(document.querySelector('.property__facts')!.textContent).toContain('Tagaytay'));
    const facts = document.querySelector('.property__facts')!.textContent;
    expect(facts).toContain('Condo / house and lot');
    expect(facts).toContain('Tagaytay');
    expect(facts).toContain('320 sqm');
    expect(facts).toContain('For sale');
  });

  it("prefers the detail's checker fields to the list row's", async () => {
    const platform = fakeServer({
      properties: listWith({ city: 'Old City', size: '100' }),
      property: propertyReply({ city: 'Tagaytay', size: '320', dealType: 'Lease', availability: 'Available', inChecker: true }),
    });
    renderApp({ platform, path: PATH });
    await settled();
    await waitFor(() => expect(document.querySelector('.property__facts')!.textContent).toContain('Tagaytay'));
    const facts = document.querySelector('.property__facts')!.textContent;
    expect(facts).toContain('320 sqm');
    expect(facts).not.toContain('Old City');
  });
});

describe('a sold listing', () => {
  it('is blocked when only the detail says Sold', async () => {
    const platform = fakeServer({ property: propertyReply({ availability: 'Sold', inChecker: true }) });
    renderApp({ platform, path: PATH });
    await waitFor(() => expect(reason()).toBe('Copy is blocked: this listing is sold.'));
    expect(copyButton().disabled).toBe(true);
  });

  it('says Sold, and blocks both Copy and the log step', async () => {
    const platform = fakeServer({ properties: listWith({ availability: 'Sold' }) });
    renderApp({ platform, path: PATH });
    await waitFor(() => expect(reason()).toBe('Copy is blocked: this listing is sold.'));

    expect(document.querySelector('.property__sold')?.textContent).toContain('Sold');
    expect(screen.getByText('Sold', { selector: '.verdict__word' })).toBeTruthy();
    expect(copyButton().disabled).toBe(true);
    await userEvent.keyboard('{Alt>}c{/Alt}');
    expect(platform.copied).toEqual([]);

    // The log step is there but off: no link can be typed, nothing can be saved.
    const link = screen.getByLabelText('Post link') as HTMLInputElement;
    expect(link.closest('fieldset')?.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Posted' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Pending approval' }) as HTMLButtonElement).disabled).toBe(true);
    expect(platform.posts.some((p) => p.action === 'logPost')).toBe(false);
  });
});

describe('photos', () => {
  const thumb = (id: string) => `https://drive.google.com/thumbnail?id=${id}&sz=w640`;
  const withThumbs = propertyReply({
    photos: ['ph1', 'ph2', 'ph3'].map((id, i) => ({
      id,
      name: `photo ${i + 1}`,
      url: `https://drive.google.com/uc?export=download&id=${id}`,
      thumb: thumb(id),
    })),
  });

  it('shows real thumbnails that open large, and the arrow keys move through them', async () => {
    renderApp({ platform: fakeServer({ property: withThumbs }), path: PATH });
    await settled();

    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.photos__img'));
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([thumb('ph1'), thumb('ph2'), thumb('ph3')]);

    const second = screen.getByRole('button', { name: 'Photo 2 of 3, view large' });
    await userEvent.click(second);
    const viewer = screen.getByRole('dialog', { name: 'Photo 2 of 3' });
    const large = () => viewer.querySelector('img')!.getAttribute('src');
    expect(large()).toBe('https://drive.google.com/thumbnail?id=ph2&sz=w1600');

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'Photo 3 of 3' })).toBeTruthy();
    expect(large()).toContain('id=ph3');
    await userEvent.keyboard('{ArrowRight}'); // round to the first
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 3' })).toBeTruthy();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'Photo 3 of 3' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByRole('dialog', { name: 'Photo 2 of 3' })).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(second);
  });

  it('downloads them all, then offers to open the folder they went to', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    const picker = screen.getByRole('dialog', { name: 'Download photos' });
    expect(within(picker).getByText(/of 2 photos ticked/)).toBeTruthy();
    await userEvent.click(within(picker).getByRole('button', { name: 'Download 2 photos' }));
    expect(await screen.findByText(/2 photos saved to Downloads\\APG Post-It\\Verdant Hills Lot 12, Tagaytay/)).toBeTruthy();
    expect(platform.saves.at(-1)?.photos.map((p) => p.name)).toEqual(['photo 1', 'photo 2']);

    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() =>
      expect(platform.opened).toEqual(['C:\\Users\\Intern\\Downloads\\APG Post-It\\Verdant Hills Lot 12, Tagaytay']),
    );
  });

  it('shows a WebP being turned into a JPG while it saves, then says it was', async () => {
    const platform = fakeServer();
    const real = platform.savePhotos.bind(platform);
    let finish: () => void = () => {};
    platform.savePhotos = async (property, photos, onProgress) => {
      onProgress?.({ name: 'photo 1', step: 'saved', done: 0, total: 2 });
      onProgress?.({ name: 'photo 2', step: 'converting', done: 1, total: 2 });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      const saved = await real(property, photos);
      return saved.map((s) => (s.name === 'photo 2' ? { ...s, converted: true } : s));
    };
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download 2 photos' }));

    const cue = await screen.findByText('Converting photo 2 of 2 from WebP to JPG… The file on Drive is not changed.');
    expect(cue.closest('.photos__progress--converting')?.getAttribute('role')).toBe('status');

    act(() => finish());
    expect(
      await screen.findByText(/^2 photos saved to .+\. 1 WebP photo was saved as JPG; the files on Drive are not changed\.$/),
    ).toBeTruthy();
    expect(document.querySelector('.photos__progress')).toBeNull();
  });

  it('downloads only the ticked photos, and none until one is ticked', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    const picker = screen.getByRole('dialog', { name: 'Download photos' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Untick all' }));
    expect((within(picker).getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Photo 2 of 2' }));
    expect(within(picker).getByRole('button', { name: 'Tick all' })).toBeTruthy();
    await userEvent.click(within(picker).getByRole('button', { name: 'Download 1 photo' }));

    expect(await screen.findByText(/1 photo saved to/)).toBeTruthy();
    expect(platform.saves.at(-1)?.photos.map((p) => p.name)).toEqual(['photo 2']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('copies one photo, full size from Drive, to paste into Facebook (AID-245)', async () => {
    const platform = fakeServer({ property: withThumbs });
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    const picker = screen.getByRole('dialog', { name: 'Download photos' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Copy photo 2' }));

    expect(await within(picker).findByText('Photo 2 copied. Paste it into Facebook with Ctrl+V.')).toBeTruthy();
    expect(platform.copiedPhotos).toEqual(['https://drive.google.com/uc?export=download&id=ph2']);
    // Copying ticks nothing and downloads nothing.
    expect(within(picker).getByText(/of 3 photos ticked/)).toBeTruthy();
    expect(platform.saves).toEqual([]);
  });

  it('says why a photo could not be copied, in the dialog', async () => {
    const elsewhere = propertyReply({ photos: [{ id: 'x1', name: 'photo 1', url: 'https://example.com/a.jpg', thumb: '' }] });
    const platform = fakeServer({ property: elsewhere });
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    const picker = screen.getByRole('dialog', { name: 'Download photos' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Copy photo 1' }));

    expect(await within(picker).findByText(/^Refused to download "Photo 1": its address /)).toBeTruthy();
    expect(platform.copiedPhotos).toEqual([]);
  });

  it('cancels without saving anything', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download photos' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Download photos' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(platform.saves).toEqual([]);
  });
});

describe('the cooldown', () => {
  it('tells an intern it sees only their own posts', async () => {
    const platform = fakeServer({
      posts: {
        ok: true,
        posts: [
          { date: '2026-10-03', time: '10:31', type: '', title: CLEAN.name, status: 'Posted', fbAccount: 'APG Main', postLink: '', postedBy: intern.name, propertyId: CLEAN.id },
        ],
      },
    });
    renderApp({ platform, path: PATH });
    expect(await screen.findByText('Last posted 3 Oct, 28 days ago. Outside the 7-day cooldown.')).toBeTruthy();
    expect(screen.getByText(/Your posts only/)).toBeTruthy();
    expect(TODAY).toBe('2026-10-31');
  });
});
