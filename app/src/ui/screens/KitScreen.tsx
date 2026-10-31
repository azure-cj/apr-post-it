import { useState } from 'react';
import type { CheckResult } from '@/core/types';
import {
  Badge,
  Button,
  Card,
  CategoryDot,
  CategoryTag,
  CheckList,
  Chip,
  EmptyState,
  Icon,
  Notice,
  Pill,
  SearchBox,
  Spinner,
  TextInput,
  Toast,
  ToastRegion,
  TopBar,
  categoryKind,
  categoryLabel,
  useToasts,
  type TopBarNavItem,
} from '../components';
import './KitScreen.css';

/**
 * Every component in each of its variants, with the product's own words.
 * Development only (`#/kit`): it is how a screen's builder sees what exists,
 * and how the system is checked by eye. Not reachable in the production build.
 */

const categories = [
  { name: 'COMMERCIAL SPACE', count: 412 },
  { name: 'CONDO / HOUSE AND LOT', count: 538 },
  { name: 'OFFICE SPACE', count: 301 },
  { name: 'WAREHOUSE', count: 223 },
] as const;

const checks: readonly CheckResult[] = [
  { name: 'Price present', status: 'pass', detail: '₱4.2M' },
  { name: 'Contact numbers present', status: 'warn', detail: 'No contact number found' },
  { name: 'No commission wording', status: 'pass', detail: 'Clean' },
  {
    name: 'Internal section hidden',
    status: 'fail',
    detail: "No separator in the document, so none of this text is confirmed safe to post. Add one above the owner's details.",
  },
];

const internNav: TopBarNavItem[] = [
  { key: 'queue', label: 'My queue', href: '#/kit', count: 6, countLabel: '6 to post' },
  { key: 'find', label: 'Find', href: '#/kit' },
];

const adminNav: TopBarNavItem[] = [
  { key: 'tracker', label: 'Tracker', href: '#/kit' },
  { key: 'assign', label: 'Assign', href: '#/kit' },
  { key: 'find', label: 'Find', href: '#/kit' },
  { key: 'settings', label: 'Settings', href: '#/kit' },
];

export default function KitScreen() {
  const [query, setQuery] = useState('Verdant Hills');
  const [emptyQuery, setEmptyQuery] = useState('');
  const [picked, setPicked] = useState<readonly string[]>(['CONDO / HOUSE AND LOT']);
  const [status, setStatus] = useState('To post');
  const [internNavKey, setInternNavKey] = useState('queue');
  const [adminNavKey, setAdminNavKey] = useState('tracker');
  const [showKey, setShowKey] = useState(false);
  const toasts = useToasts();

  const toggleCategory = (name: string) =>
    setPicked((now) => (now.includes(name) ? now.filter((n) => n !== name) : [...now, name]));

  return (
    <div className="page kit">
      <header className="page-header">
        <h1 className="page-header__title" tabIndex={-1}>
          UI kit
        </h1>
        <p className="page-header__description">
          Every component in <code>src/ui/components</code>, in each of its variants. Development only. The rules
          are in DESIGN.md.
        </p>
      </header>

      <div className="kit__sections">
        <Card title="Top bar" description="The first arrangement that fits: one row, then two. Measured, not set by breakpoints.">
          <div className="kit__stack">
            <p className="kit__caption">An intern, at the width of this page</p>
            <div className="kit-frame">
              <TopBar
                nav={internNav}
                currentKey={internNavKey}
                user={{ name: 'Jan Dela Cruz', role: 'Intern' }}
                onNavigate={setInternNavKey}
                onSignOut={() => toasts.show('Signed out.', 'info')}
              />
            </div>
            <p className="kit__caption">An admin, in a 620px frame</p>
            <div className="kit-frame kit-frame--narrow">
              <TopBar
                nav={adminNav}
                currentKey={adminNavKey}
                user={{ name: 'Maria Santos', role: 'Admin' }}
                onNavigate={setAdminNavKey}
                onSignOut={() => toasts.show('Signed out.', 'info')}
              />
            </div>
            <p className="kit__caption">Before sign-in</p>
            <div className="kit-frame">
              <TopBar />
            </div>
          </div>
        </Card>

        <Card title="Buttons" description="Gold is the one primary action on a screen. Everything else is ghost, quiet or a link.">
          <div className="kit__stack">
            <div className="kit__row">
              <Button variant="primary">Next: log this post</Button>
              <Button>Open Drive folder</Button>
              <Button variant="quiet">Show internal section</Button>
              <Button variant="link">Download all</Button>
            </div>
            <div className="kit__row">
              <Button size="small">Add</Button>
              <Button size="small" variant="quiet" icon={<Icon name="signOut" size={18} />}>
                Sign out
              </Button>
              <Button size="small" icon={<Icon name="search" size={18} />}>
                Search again
              </Button>
            </div>
            <div className="kit__row">
              <Button variant="primary" busy>
                Signing in…
              </Button>
              <Button variant="primary" disabled>
                Copy
              </Button>
              <Button disabled>Save queue</Button>
              <Button variant="link" disabled>
                Download all
              </Button>
            </div>
          </div>
        </Card>

        <div className="kit__grid">
          <Card title="Fields">
            <div className="kit__stack kit__stack--loose">
              <TextInput label="Post link" placeholder="https://www.facebook.com/…" hint="Paste the link from the post's timestamp." />
              <TextInput
                label="FB account"
                defaultValue="APG Rentals South"
                error="You can post from APG Main or APG Rentals. Pick one of those."
              />
              <TextInput
                label="Your key"
                type={showKey ? 'text' : 'password'}
                defaultValue="9b2c-41fe-8a7d"
                end={
                  <Button variant="quiet" size="small" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                    {showKey ? 'Hide' : 'Show'}
                  </Button>
                }
              />
              <TextInput label="Cooldown in days" defaultValue="7" disabled hint="Only an admin can change this." />
            </div>
          </Card>

          <Card title="Search and filters">
            <div className="kit__stack kit__stack--loose">
              <SearchBox label="Search listings" placeholder="Search by name, city or building" value={emptyQuery} onValueChange={setEmptyQuery} />
              <SearchBox label="Search listings" placeholder="Search by name, city or building" value={query} onValueChange={setQuery} />
              <div className="kit__row kit__row--tight" role="group" aria-label="Categories">
                {categories.map((c) => (
                  <Chip
                    key={c.name}
                    selected={picked.includes(c.name)}
                    onSelectedChange={() => toggleCategory(c.name)}
                    leading={<CategoryDot kind={categoryKind(c.name)} />}
                    count={c.count}
                  >
                    {categoryLabel(c.name)}
                  </Chip>
                ))}
              </div>
              <div className="kit__row kit__row--tight" role="group" aria-label="Status">
                {['To post', 'Pending', 'Posted'].map((s) => (
                  <Chip key={s} selected={status === s} onSelectedChange={() => setStatus(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <div className="kit__grid">
          <Card title="Pills, badges and categories">
            <div className="kit__stack">
              <div className="kit__row kit__row--tight">
                <Pill tone="neutral">To post</Pill>
                <Pill tone="warn" dot>
                  Pending
                </Pill>
                <Pill tone="ok" dot>
                  Posted
                </Pill>
                <Pill tone="danger" dot>
                  In cooldown
                </Pill>
                <Pill tone="info">Due for repost</Pill>
              </div>
              <div className="kit__row kit__row--tight">
                <Pill>Intern</Pill>
                <Pill>Admin</Pill>
                <Badge count={6} label="6 to post" />
                <Badge count={12} tone="warn" label="12 pending" />
                <Badge count={1474} tone="info" label="1,474 listings" />
              </div>
              <ul className="kit__categories">
                {[...categories.map((c) => c.name), 'Virtual Office for posting'].map((name) => (
                  <li key={name}>
                    <CategoryTag category={name} />
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title="Pre-post checks" description="A fail blocks Copy; a warn asks for a second look.">
            <CheckList checks={checks} label="Pre-post checks" />
          </Card>
        </div>

        <Card title="Notices">
          <div className="kit__stack">
            <Notice tone="danger" title="Copy is blocked">
              This document has no separator, so none of its text is confirmed safe to post. Ask an admin to add one
              above the owner's details.
            </Notice>
            <Notice tone="danger" title="In cooldown: posted 2 days ago by Jan Dela Cruz">
              You can post Verdant Hills Lot 7 again on Thu 6 Nov.
            </Notice>
            <Notice tone="warn" title="No contact number in the public text">
              Buyers will have no way to reach you. Check the document before you post.
            </Notice>
            <Notice tone="info" action={<Button size="small">Refresh</Button>}>
              The directory was rebuilt at 2:00 this morning. Opening a listing re-reads its document.
            </Notice>
            <Notice tone="ok">Logged. Verdant Hills Lot 12 was posted from APG Main at 10:42.</Notice>
          </div>
        </Card>

        <div className="kit__grid">
          <Card
            title="Toasts"
            description="Short confirmations. They pause while hovered or focused."
            actions={
              <Button size="small" onClick={() => toasts.show('Copied. Paste it into Facebook.')}>
                Show a toast
              </Button>
            }
          >
            <div className="kit__stack">
              <Toast onDismiss={() => undefined} duration={null}>
                Copied. Paste it into Facebook.
              </Toast>
              <Toast tone="info" onDismiss={() => undefined} duration={null}>
                8 photos saved to Downloads\APG Post-It\Verdant Hills Lot 12.
              </Toast>
              <Toast tone="danger" onDismiss={() => undefined} duration={null}>
                Couldn't save the photos. The Downloads folder is full.
              </Toast>
            </div>
          </Card>

          <Card title="Empty state and spinner">
            <EmptyState
              headingLevel={3}
              title="Nothing in your queue today"
              action={<Button>Find a property</Button>}
            >
              Your admin hasn't assigned anything for Fri 31 Oct. You can still find a listing and post it.
            </EmptyState>
            <div className="kit__row kit__row--center">
              <Spinner label="Loading listings" />
              <Spinner size="small" label="Loading" />
              <span className="kit__caption">Loading listings…</span>
            </div>
          </Card>
        </div>

        <Card title="Cards" description="Raised by a gradient and a top-lit edge. No shadow.">
          <div className="kit__grid">
            <Card headingLevel={3} title="Verdant Hills Lot 12" description="Lot · Tagaytay · 320 sqm" actions={<Button size="small">Open</Button>}>
              <p className="kit__muted">Last posted 3 Oct 2026, 28 days ago.</p>
            </Card>
            <Card headingLevel={3} padding="tight" title="Tight padding" description="For dense lists and narrow panes.">
              <p className="kit__muted">16px inside instead of 24.</p>
            </Card>
          </div>
        </Card>
      </div>

      <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
