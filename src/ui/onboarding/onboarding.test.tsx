// @vitest-environment jsdom
/**
 * Onboarding (1.1.7): the welcome tour after a first sign-in, the listing
 * tour, Help with the getting-started list, and Show me in What's new.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { version } from '../../../package.json';
import { SEEN_VERSION_KEY } from '../releaseNotes';
import { fakeServer, intern, manager, renderApp } from '../state/testing';
import { WhatsNew } from '../WhatsNew';
import { placeCard } from './place';
import { EMPTY_RECORD, recordKey, withTask, withTour } from './record';

const LONG = { timeout: 4000 };
const fresh = () => fakeServer({}, 'test-key', { onboarding: true });
const recordOf = async (platform: ReturnType<typeof fakeServer>, name: string) =>
  JSON.parse((await platform.readLocal(recordKey(name))) ?? 'null') as typeof EMPTY_RECORD | null;

describe('placeCard', () => {
  const view = { width: 1280, height: 800 };
  const card = { width: 340, height: 180 };

  it('sits to the right of something narrow, like a sidebar item', () => {
    expect(placeCard({ top: 100, left: 10, width: 200, height: 40 }, card, view)).toMatchObject({ side: 'right', left: 226 });
  });

  it('sits below something wide, like a section', () => {
    expect(placeCard({ top: 100, left: 300, width: 800, height: 200 }, card, view)).toMatchObject({ side: 'bottom', top: 316 });
  });

  it('is in the middle with nothing to point at, and always inside the window', () => {
    expect(placeCard(null, card, view)).toEqual({ side: 'center', top: 310, left: 470 });
    const low = placeCard({ top: 760, left: 1200, width: 60, height: 30 }, card, view);
    expect(low.left + card.width).toBeLessThanOrEqual(view.width - 12);
    expect(low.top).toBeGreaterThanOrEqual(12);
  });
});

describe('the record', () => {
  it('closing the welcome tour stops tours starting by themselves', () => {
    const next = withTour(EMPTY_RECORD, 'welcome-agent', 'skipped');
    expect(next).toMatchObject({ autoOff: true, tours: { 'welcome-agent': 'skipped' } });
    expect(next.tasks.tour).toBeUndefined();
  });

  it('finishing it ticks off Take the tour', () => {
    expect(withTour(EMPTY_RECORD, 'welcome-admin', 'done')).toMatchObject({ autoOff: false, tasks: { tour: true } });
  });

  it('closing the listing tour leaves the others on', () => {
    expect(withTour(EMPTY_RECORD, 'listing', 'skipped').autoOff).toBe(false);
  });

  it('a task done twice is the same record', () => {
    const once = withTask(EMPTY_RECORD, 'copy-text');
    expect(withTask(once, 'copy-text')).toBe(once);
  });
});

describe('the welcome tour', () => {
  it('starts once on My queue after a first sign-in, and shows how far along it is', async () => {
    const platform = fresh();
    renderApp({ platform, path: '/queue' });

    const card = await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    expect(within(card).getByText('1 of 5')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Close the tour' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Skip tour' })).toBeTruthy();

    await userEvent.click(within(card).getByRole('button', { name: 'Show me around' }));
    const step = await screen.findByRole('dialog', { name: 'My queue: what to post' });
    expect(within(step).getByText('2 of 5')).toBeTruthy();
    // Why first: the reason the queue matters.
    expect(within(step).getByText(/Post them before the due date/)).toBeTruthy();
  });

  it('passes over a step whose button is not on screen (an empty queue has no Next up)', async () => {
    renderApp({ platform: fresh(), path: '/queue' });
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).getByRole('button', { name: 'Show me around' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'My queue: what to post' })).getByRole('button', { name: 'Next' }));
    const find = await screen.findByRole('dialog', { name: 'Find any listing' }, LONG);
    expect(within(find).getByText('4 of 5')).toBeTruthy();
    // Back passes over it too.
    await userEvent.click(within(find).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: 'My queue: what to post' }, LONG)).toBeTruthy();
  });

  it('Skip closes it for good: no tour starts by itself again', async () => {
    const platform = fresh();
    renderApp({ platform, path: '/queue' });
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome to Post-It' })).toBeNull();
    await waitFor(async () => expect(await recordOf(platform, intern.name)).toMatchObject({ autoOff: true, tours: { 'welcome-agent': 'skipped' } }));
  });

  it('Esc closes it', async () => {
    renderApp({ platform: fresh(), path: '/queue' });
    await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull());
  });

  it('the arrows work after the page puts focus on its heading', async () => {
    renderApp({ platform: fresh(), path: '/queue' });
    await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    const heading = screen.getByRole('heading', { level: 1 });
    heading.focus();
    expect(document.activeElement).toBe(heading);
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('dialog', { name: 'My queue: what to post' })).toBeTruthy();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('dialog', { name: 'Welcome to Post-It' })).toBeTruthy();
  });

  it("doesn't start for someone who has been here before", async () => {
    renderApp({ platform: fakeServer(), path: '/queue' });
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByTestId('tour')).toBeNull();
  });

  it("doesn't start on an update's first launch: What's new offers it instead", async () => {
    const platform = fresh();
    await platform.writeLocal(SEEN_VERSION_KEY, '1.0.0');
    renderApp({ platform, path: '/queue' });
    await screen.findByRole('dialog', { name: `What's new in ${version}` }, LONG);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByTestId('tour')).toBeNull();
  });

  it("an admin's tour walks the admin screens", async () => {
    renderApp({ platform: fresh(), user: manager, path: '/tracker' });
    const card = await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    expect(within(card).getByText('1 of 7')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Show me around' }));
    expect(await screen.findByRole('dialog', { name: 'Tracker: the week at a glance' })).toBeTruthy();
  });
});

describe('the listing tour', () => {
  it('starts the first time a listing is opened, and not again', async () => {
    const platform = fakeServer({}, 'test-key', { onboarding: true });
    await platform.writeLocal(recordKey(intern.name), JSON.stringify({ ...EMPTY_RECORD, tours: { 'welcome-agent': 'done' } }));
    renderApp({ platform, path: '/property/1VerdantHillsLot12' });

    const card = await screen.findByRole('dialog', { name: 'The text to post' }, LONG);
    await userEvent.click(within(card).getByRole('button', { name: 'Close the tour' }));
    await waitFor(async () => expect((await recordOf(platform, intern.name))?.tours.listing).toBe('skipped'));
  });
});

describe('Help', () => {
  it('shows how far along the getting-started list is, and ticks off what was done', async () => {
    const platform = fresh();
    await platform.writeLocal(recordKey(intern.name), JSON.stringify({ ...EMPTY_RECORD, autoOff: true, tasks: { tour: true } }));
    renderApp({ platform, path: '/queue' });

    const help = await screen.findByRole('button', { name: /^Help/ });
    expect(help.textContent).toContain('1/4');
    await userEvent.click(help);
    const panel = await screen.findByRole('dialog', { name: 'Getting started' });
    expect(within(panel).getByText('1 of 4 done')).toBeTruthy();
    expect(within(panel).getByRole('progressbar', { name: 'Getting started' }).getAttribute('aria-valuenow')).toBe('1');
    expect(within(panel).getByText(': done')).toBeTruthy();
  });

  it('Show me points at where a thing starts', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await userEvent.click(await screen.findByRole('button', { name: /^Help/ }));
    const panel = await screen.findByRole('dialog', { name: 'Getting started' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Show me: Open a listing' }));
    const hint = await screen.findByRole('dialog', { name: 'Open a listing' }, LONG);
    await userEvent.click(within(hint).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull());
  });

  it('takes the tour again, and the list can be put away', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: '/find' });
    await userEvent.click(await screen.findByRole('button', { name: /^Help/ }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Getting started' })).getByRole('button', { name: 'Hide this list' }));
    expect(await screen.findByRole('dialog', { name: 'Help' })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /^Help/ })).textContent).not.toContain('/4');

    await userEvent.click(within(screen.getByRole('dialog', { name: 'Help' })).getByRole('button', { name: 'Take the tour' }));
    expect(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).toBeTruthy();
  });
});

describe("What's new: Show me", () => {
  it('closes and points at the new thing', async () => {
    const shown: string[] = [];
    const platform = fakeServer();
    render(<WhatsNew platform={platform} version="1.1.7" openNow onClosed={() => {}} onShow={(s) => shown.push(s)} />);
    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.1.7" });
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Show me' })[0]!);
    expect(shown).toEqual(['welcome']);
    expect(await platform.readLocal(SEEN_VERSION_KEY)).toBe('1.1.7');
  });
});
