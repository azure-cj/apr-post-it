// @vitest-environment jsdom
/**
 * The property page carries the app's most important promise: an intern
 * never sees or copies the owner's details or the commission. These tests
 * hold the screen to it even when the server's reply is wrong.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLEAN, fakeServer, intern, manager, propertyReply, renderApp, TODAY } from '../../state/testing';

const PATH = `/property/${CLEAN.id}`;

const copyButton = () => screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;

/** The sentence beside Copy: what it says about why it is on or off. */
const reason = () => document.getElementById(copyButton().getAttribute('aria-describedby') ?? '')?.textContent ?? '';

/** Waits until the document and the posts are in, so Copy has its final state. */
async function settled() {
  await waitFor(() => expect(reason()).toMatch(/Every check passed|^Copy is blocked/));
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
    {
      case: 'no separator in the document (a manager, who is sent all of it)',
      user: manager,
      reply: { hasInternal: false, cutAt: '', publicText: `${CLEAN.publicText}\nMr. Lim 0918 555 0135` },
      says: /no separator yet/,
    },
    {
      case: 'two checks at once',
      user: manager,
      reply: { hasInternal: false, cutAt: '', publicText: `${CLEAN.publicText}\nRebate for agents.` },
      says: /1 more check failed too/,
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

describe('a document nobody has separated', () => {
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

  it('shows an intern none of it even when the reply wrongly carried the text', async () => {
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
    expect(copyButton().disabled).toBe(true);
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
  it('never reaches an intern, even when the reply wrongly contained it', async () => {
    const platform = fakeServer({
      property: propertyReply({ internalText: 'Owner: Mrs. Lourdes Navarro, 0918 555 0199\nCommission: 3%' }),
    });
    renderApp({ platform, path: PATH });
    await settled();

    expect(document.body.textContent).not.toContain('Navarro');
    expect(document.body.textContent).not.toContain('Commission: 3%');
    expect(screen.queryByText(/Internal section: never posted/)).toBeNull();
    expect(screen.queryByText(/Cut at/)).toBeNull();

    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([CLEAN.publicText]));
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

describe('photos', () => {
  it('downloads them all, then offers to open the folder they went to', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Download all' }));
    expect(await screen.findByText(/2 photos saved to Downloads\\APG Post-It\\Verdant Hills Lot 12, Tagaytay/)).toBeTruthy();
    expect(platform.saves.at(-1)?.photos.map((p) => p.name)).toEqual(['photo 1', 'photo 2']);

    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() =>
      expect(platform.opened).toEqual(['C:\\Users\\Intern\\Downloads\\APG Post-It\\Verdant Hills Lot 12, Tagaytay']),
    );
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
    expect(screen.getByText(/You see your own posts only/)).toBeTruthy();
    expect(TODAY).toBe('2026-10-31');
  });
});
