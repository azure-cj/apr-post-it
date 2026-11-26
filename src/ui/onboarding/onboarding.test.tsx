// @vitest-environment jsdom
/**
 * Onboarding (1.1.7): the welcome tour right after a first sign-in, the
 * listing tour, Help with the getting-started list, and Show me in What's new.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakePlatform } from '@/platform/fake';
import { version } from '../../../package.json';
import { AppShell, routerFuture } from '../App';
import { SEEN_VERSION_KEY } from '../releaseNotes';
import { AppStateProvider } from '../state';
import { EXEC, fakeServer, intern, manager, NOW, PROPERTIES, propertyReply, renderApp, TODAY } from '../state/testing';
import { WhatsNew } from '../WhatsNew';
import { placeCard } from './place';
import { EMPTY_RECORD, NEW_RECORD, recordKey, withTask, withTour } from './record';
import { guideFor, matchesTopic } from './guide';
import { pageTourOf, tasksFor, tourFor, type ScreenTourId } from './tours';

const LONG = { timeout: 4000 };
const fresh = (replies = {}) => fakeServer(replies, 'test-key', { onboarding: true });
const recordOf = async (platform: ReturnType<typeof fakeServer>, name: string) =>
  JSON.parse((await platform.readLocal(recordKey(name))) ?? 'null') as typeof EMPTY_RECORD | null;

/** The admin's tour from Tracker to Agents. */
const ADMIN_SCREENS = ['Tracker', 'Assign', 'Agents'];
const titles = (tour: { readonly steps: readonly { readonly title: string }[] }) => tour.steps.map((s) => s.title);
/** Next, on each of these steps in turn. */
const walk = async (titles: readonly string[]) => {
  for (const title of titles) {
    await userEvent.click(within(await screen.findByRole('dialog', { name: title })).getByRole('button', { name: 'Next' }));
  }
};

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

  it('the welcome tour stays due until it is finished or closed', () => {
    expect(NEW_RECORD.welcomeDue).toBe(true);
    expect(withTour(NEW_RECORD, 'listing', 'skipped').welcomeDue).toBe(true);
    expect(withTour(NEW_RECORD, 'welcome-agent', 'done').welcomeDue).toBe(false);
    expect(withTour(NEW_RECORD, 'welcome-admin', 'skipped').welcomeDue).toBe(false);
  });

  it('a task done twice is the same record', () => {
    const once = withTask(EMPTY_RECORD, 'copy-text');
    expect(withTask(once, 'copy-text')).toBe(once);
  });
});

describe('the step lists', () => {
  it("an agent's welcome: where to start, in 4 steps", () => {
    expect(titles(tourFor('welcome-agent', intern))).toEqual(['Welcome to Post-It', 'My queue', 'Open Next up', 'Help']);
  });

  it("an admin's welcome: the admin screens, My queue only while they have one (D31)", () => {
    expect(titles(tourFor('welcome-admin', manager, false))).toEqual(['Welcome to Post-It', 'Tracker', 'Assign', 'Agents', 'Settings', 'Help']);
    expect(titles(tourFor('welcome-admin', manager, true))).toEqual([
      'Welcome to Post-It',
      'Tracker',
      'Assign',
      'Agents',
      'My queue',
      'Settings',
      'Help',
    ]);
  });

  it('the listing tour walks one post, from caption to logged link, with Highlight for admins', () => {
    const before = ['Ready to post?', 'Copy the caption', 'Add a call to action', 'Posted it before? Reword it', 'Download the photos', 'Make a flyer or a poster'];
    const after = ['The cooldown', 'Post it, then log the link', 'Waiting for approval?'];
    expect(titles(tourFor('listing', intern))).toEqual([...before, ...after]);
    expect(titles(tourFor('listing', manager))).toEqual([...before, 'Highlight it', ...after]);
  });

  it('every screen has its own tour, admin screens and Settings by role (1.1.8)', () => {
    expect(titles(tourFor('find', intern))).toEqual(['Search every listing', 'Categories', 'Show only', 'Sort', 'Open a listing']);
    expect(titles(tourFor('queue', intern))[0]).toBe('My queue');
    expect(titles(tourFor('settings', intern))).toEqual(['Your settings']);
    expect(titles(tourFor('settings', manager))).toEqual(['Four tabs']);
    expect(pageTourOf('/find')).toBe('find');
    expect(pageTourOf('/property/abc')).toBe('listing');
    expect(pageTourOf('/property/abc/log')).toBeNull();
    expect(pageTourOf('/constructor')).toBeNull();
  });

  it('every step is short sentences, with its count filled in', () => {
    const screens: ScreenTourId[] = ['queue', 'find', 'tracker', 'assign', 'interns', 'records', 'settings'];
    for (const tour of [
      tourFor('welcome-agent', intern),
      tourFor('welcome-admin', manager),
      tourFor('listing', manager),
      tourFor('paste', intern),
      ...screens.map((id) => tourFor(id, manager)),
    ]) {
      for (const step of tour.steps) {
        expect(step.body).not.toContain('{steps}');
        for (const sentence of step.body.split(/(?<=[.?]) /)) expect(sentence.split(' ').length).toBeLessThanOrEqual(25);
      }
    }
  });

  it('the getting-started list is the work itself, not the tour', () => {
    expect(tasksFor(intern).map((t) => t.label)).toEqual(['Open a listing', 'Copy its caption', "Log the post's link"]);
    expect(tasksFor(manager).map((t) => t.label)).toEqual(["Give out a week's listings", 'Highlight a listing', 'Spot check a post']);
  });
});

describe('the welcome tour', () => {
  it('opens by itself right after a first sign-in', async () => {
    const platform = createFakePlatform({
      hasFileSystem: true,
      replies: {
        ping: { ok: true, name: intern.name, role: 'Intern', fbAccounts: intern.fbAccounts },
        properties: PROPERTIES,
        posts: { ok: true, posts: [] },
        assignments: { ok: true, assignments: [] },
      },
    });
    render(
      <AppStateProvider platform={platform} now={() => NOW}>
        <MemoryRouter initialEntries={['/']} future={routerFuture}>
          <AppShell />
        </MemoryRouter>
      </AppStateProvider>,
    );
    await userEvent.type(await screen.findByLabelText('Web app link'), EXEC);
    await userEvent.type(screen.getByLabelText('Your key'), 'key-1');
    // Not over the sign-in screen.
    expect(screen.queryByTestId('tour')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' }, LONG)).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).toBeTruthy();
    expect(await recordOf(platform, intern.name)).toMatchObject({ welcomeDue: true });
  });

  it('opens on the next sign-in when it never got to show (the app was closed first)', async () => {
    const platform = fresh();
    await platform.writeLocal(recordKey(intern.name), JSON.stringify(NEW_RECORD));
    renderApp({ platform, path: '/queue' });
    expect(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).toBeTruthy();
  });


  it('starts once on My queue after a first sign-in, and shows how far along it is', async () => {
    const platform = fresh();
    renderApp({ platform, path: '/queue' });

    const card = await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    expect(within(card).getByText('1 of 4')).toBeTruthy();
    expect(within(card).getByText(/where to start, in 4 steps\./)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Close the tour' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Skip tour' })).toBeTruthy();

    await userEvent.click(within(card).getByRole('button', { name: 'Show me around' }));
    const step = await screen.findByRole('dialog', { name: 'My queue' });
    expect(within(step).getByText('2 of 4')).toBeTruthy();
    // What it is, then what to do with it.
    expect(within(step).getByText(/Post each one by its due date/)).toBeTruthy();
  });

  it('passes over a step whose button is not on screen (an empty queue has no Next up)', async () => {
    renderApp({ platform: fresh(), path: '/queue' });
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).getByRole('button', { name: 'Show me around' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'My queue' })).getByRole('button', { name: 'Next' }));
    const help = await screen.findByRole('dialog', { name: 'Help' }, LONG);
    expect(within(help).getByText('4 of 4')).toBeTruthy();
    // Back passes over it too.
    await userEvent.click(within(help).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: 'My queue' }, LONG)).toBeTruthy();
  });

  it('Skip closes it for good: no tour starts by itself again', async () => {
    const platform = fresh();
    renderApp({ platform, path: '/queue' });
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG)).getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome to Post-It' })).toBeNull();
    await waitFor(async () =>
      expect(await recordOf(platform, intern.name)).toMatchObject({ autoOff: true, welcomeDue: false, tours: { 'welcome-agent': 'skipped' } }),
    );
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
    expect(await screen.findByRole('dialog', { name: 'My queue' })).toBeTruthy();
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
    // They used the app before tours came: not new, so it won't start later either.
    await waitFor(async () => expect(await recordOf(platform, intern.name)).toMatchObject({ welcomeDue: false }));
  });

  it("an admin's tour walks the admin screens, without My queue when they have none (D31)", async () => {
    renderApp({ platform: fresh(), user: manager, path: '/tracker' });
    const card = await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    expect(within(card).getByText('1 of 6')).toBeTruthy();
    expect(within(card).getByText(/where everything is, in 6 steps\./)).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Show me around' }));
    await walk(ADMIN_SCREENS);
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByText('5 of 6')).toBeTruthy();
  });

  it('shows an admin given a queue My queue too, after Agents (D31)', async () => {
    const theirs = {
      ok: true,
      assignments: [{ date: TODAY, assignedTo: manager.name, property: 'Seaside Residences 2BR, Pasay', status: 'Not Shared', propertyId: '' }],
    };
    renderApp({ platform: fresh({ assignments: theirs }), user: manager, path: '/tracker' });
    const card = await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    expect(within(card).getByText('1 of 7')).toBeTruthy();
    expect(within(card).getByText(/where everything is, in 7 steps\./)).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Show me around' }));
    await walk(ADMIN_SCREENS);
    const step = await screen.findByRole('dialog', { name: 'My queue' });
    expect(within(step).getByText('5 of 7')).toBeTruthy();
    // Said for both reasons it can be there: listings, or a post waiting.
    expect(within(step).getByText(/listings to post yourself, or a post waiting for approval/)).toBeTruthy();
    await walk(['My queue']);
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByText('6 of 7')).toBeTruthy();
  });

  it("waits for an admin's own queue to be read, so My queue isn't left out (D31)", async () => {
    const theirs = {
      ok: true,
      assignments: [{ date: TODAY, assignedTo: manager.name, property: 'Seaside Residences 2BR, Pasay', status: 'Not Shared', propertyId: '' }],
    };
    let arrive = () => {};
    const read = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    renderApp({ platform: fresh({ assignments: async () => (await read, theirs) }), user: manager, path: '/tracker' });
    // Longer than a tour takes to start by itself.
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByTestId('tour')).toBeNull();

    arrive();
    const card = await screen.findByRole('dialog', { name: 'Welcome to Post-It' }, LONG);
    expect(within(card).getByText('1 of 7')).toBeTruthy();
  });
});

describe('the listing tour', () => {
  it('starts the first time a listing is opened, and not again', async () => {
    const platform = fakeServer({}, 'test-key', { onboarding: true });
    await platform.writeLocal(recordKey(intern.name), JSON.stringify({ ...EMPTY_RECORD, tours: { 'welcome-agent': 'done' } }));
    renderApp({ platform, path: '/property/1VerdantHillsLot12' });

    const card = await screen.findByRole('dialog', { name: 'Ready to post?' }, LONG);
    await userEvent.click(within(card).getByRole('button', { name: 'Close the tour' }));
    await waitFor(async () => expect((await recordOf(platform, intern.name))?.tours.listing).toBe('skipped'));
  });
});

describe('the paste walkthrough (1.1.8)', () => {
  const NO_TEXT = { property: propertyReply({ hasInternal: false, withheld: true, cutAt: '', publicText: '' }) };
  const showMeHow = () => screen.findByRole('button', { name: 'Show me how' }, LONG);

  it('never starts by itself: Show me how glows until it is taken, then stops', async () => {
    const platform = fresh(NO_TEXT);
    await platform.writeLocal(recordKey(intern.name), JSON.stringify({ ...EMPTY_RECORD, tours: { 'welcome-agent': 'done', listing: 'done' } }));
    renderApp({ platform, path: '/property/1VerdantHillsLot12' });

    const button = await showMeHow();
    await waitFor(() => expect(button.className).toContain('button--nudge'));
    expect(screen.queryByTestId('tour')).toBeNull();

    await userEvent.click(button);
    await walk(['No text to copy yet', 'Open the document', 'Paste it here']);
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Use this text' })).getByRole('button', { name: 'Done' }));
    await waitFor(async () => expect((await recordOf(platform, intern.name))?.tours.paste).toBe('done'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show me how' }).className).not.toContain('button--nudge'));
    // Open in Drive is the next step now, and the one thing that glows.
    expect(screen.getByRole('button', { name: 'Open in Drive' }).className).toContain('button--nudge');
  }, 15_000);

  it('is the same steps for everyone, the Drive step passed over when there is no folder', () => {
    expect(titles(tourFor('paste', intern))).toEqual(['No text to copy yet', 'Open the document', 'Paste it here', 'Use this text']);
    expect(titles(tourFor('paste', manager))).toEqual(titles(tourFor('paste', intern)));
    expect(tourFor('paste', intern).steps.find((s) => s.target === 'paste-drive')?.optional).toBe(true);
  });
});

describe('Help', () => {
  it('shows how far along the getting-started list is, and ticks off what was done', async () => {
    const platform = fresh();
    await platform.writeLocal(recordKey(intern.name), JSON.stringify({ ...EMPTY_RECORD, autoOff: true, tasks: { tour: true, 'open-listing': true } }));
    renderApp({ platform, path: '/queue' });

    const help = await screen.findByRole('button', { name: /^Help/ });
    // The tour, done, no longer counts: it isn't on the list.
    expect(help.textContent).toContain('1/3');
    await userEvent.click(help);
    const panel = await screen.findByRole('dialog', { name: 'Getting started' });
    expect(within(panel).getByText('1 of 3 done')).toBeTruthy();
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
    expect((await screen.findByRole('button', { name: /^Help/ })).textContent).not.toContain('/3');

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

describe("each screen's tour (1.1.8)", () => {
  it('starts the first time Find is opened, and not again', async () => {
    const platform = fakeServer({}, 'test-key', { onboarding: true });
    await platform.writeLocal(recordKey(intern.name), JSON.stringify({ ...EMPTY_RECORD, tours: { 'welcome-agent': 'done' } }));
    renderApp({ platform, path: '/find' });

    const card = await screen.findByRole('dialog', { name: 'Search every listing' }, LONG);
    await userEvent.click(within(card).getByRole('button', { name: 'Close the tour' }));
    await waitFor(async () => expect((await recordOf(platform, intern.name))?.tours.find).toBe('skipped'));
  });

  it('starts from Help with Tour this page', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: '/find' });
    await userEvent.click(await screen.findByRole('button', { name: /^Help/ }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Getting started' })).getByRole('button', { name: 'Tour this page' }));
    expect(await screen.findByRole('dialog', { name: 'Search every listing' }, LONG)).toBeTruthy();
  });
});

describe("Help's guide (1.1.8)", () => {
  it('admins see the admin topics, agents do not, and every step is short', () => {
    const agent = guideFor(false);
    const admin = guideFor(true);
    expect(agent.some((t) => t.adminOnly)).toBe(false);
    expect(admin.length).toBeGreaterThan(agent.length);
    expect(new Set(admin.map((t) => t.id)).size).toBe(admin.length);
    for (const topic of admin) {
      for (const step of topic.steps) for (const sentence of step.split(/(?<=[.?:]) /)) expect(sentence.split(' ').length).toBeLessThanOrEqual(25);
    }
  });

  it('search finds a topic by any of its words', () => {
    const titlesFor = (q: string) => guideFor(true).filter((t) => matchesTopic(t, q)).map((t) => t.title);
    expect(titlesFor('poster')).toContain('Make a poster');
    expect(titlesFor('cooldown')).toContain("Why can't I post this one yet? (cooldown)");
    expect(titlesFor('zzz')).toEqual([]);
  });

  it('opens a topic, and Show me starts its tour', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: '/queue' });
    await userEvent.click(await screen.findByRole('button', { name: /^Help/ }));
    const panel = await screen.findByRole('dialog', { name: 'Getting started' });
    await userEvent.type(within(panel).getByRole('searchbox', { name: 'Search help' }), 'find any');
    expect(within(panel).getByText(/Press \/ to jump to the search box/)).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Show me: Find any listing' }));
    expect(await screen.findByRole('dialog', { name: 'Search every listing' }, LONG)).toBeTruthy();
  });
});
