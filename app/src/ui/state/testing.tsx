/**
 * For tests of the screens: the whole window (top bar, routes, toasts) over
 * the fake platform, signed in as someone, at a fixed moment, at a path.
 * Not a test itself, and not part of the app.
 */

import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@/core/types';
import { createFakePlatform, type FakePlatform, type FakeReply } from '@/platform/fake';
import { AppShell, routerFuture } from '../App';
import { AppStateProvider } from './AppState';

export const EXEC = 'https://script.google.com/macros/s/AKfy-test/exec';

/** Sat 31 Oct 2026, 10:00 in Manila. */
export const NOW = Date.parse('2026-10-31T02:00:00Z');
export const TODAY = '2026-10-31';

export const intern: User = { name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: ['APG Main', 'APG Rentals South'] };
export const internAnyAccount: User = { name: 'Paolo Reyes', role: 'Intern', fbAccounts: [] };
export const manager: User = { name: 'Maria Santos', role: 'Manager', fbAccounts: [] };
export const admin: User = { name: 'Ana Reyes', role: 'Admin', fbAccounts: [] };

/** A listing whose public text passes every check. */
export const CLEAN = {
  id: '1VerdantHillsLot12',
  name: 'Verdant Hills Lot 12, Tagaytay',
  category: 'CONDO / HOUSE AND LOT',
  listingType: 'FOR SALE',
  subCategory: 'Lot',
  publicText: 'FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4.2M\nContact: 0917 555 0142',
} as const;

/** The `property` reply for CLEAN, with any field changed. */
export function propertyReply(changes: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    ok: true,
    property: {
      id: CLEAN.id,
      name: CLEAN.name,
      category: CLEAN.category,
      listingType: CLEAN.listingType,
      subCategory: CLEAN.subCategory,
      folder: `https://drive.google.com/drive/folders/${CLEAN.id}`,
      publicText: CLEAN.publicText,
      hasInternal: true,
      withheld: false,
      cutAt: '--- line',
      issues: '',
      live: true,
      photos: [
        { id: 'ph1', name: 'photo 1', url: 'https://drive.google.com/uc?export=download&id=ph1', thumb: '' },
        { id: 'ph2', name: 'photo 2', url: 'https://drive.google.com/uc?export=download&id=ph2', thumb: '' },
      ],
      ...changes,
    },
  };
}

/** The `properties` reply: CLEAN and a few more. */
export const PROPERTIES = {
  ok: true,
  properties: [
    { id: CLEAN.id, name: CLEAN.name, category: CLEAN.category, listingType: CLEAN.listingType, subCategory: 'Lot', photoCount: 2, hasIssues: false },
    { id: '1Kapitolyo', name: 'Kapitolyo Ground Floor Retail, Pasig', category: 'COMMERCIAL SPACE', listingType: 'FOR LEASE/ FOR RENT', subCategory: '', photoCount: 6, hasIssues: false },
    { id: '1Seaside', name: 'Seaside Residences 2BR, Pasay', category: 'CONDO / HOUSE AND LOT', listingType: 'FOR SALE', subCategory: 'Condo', photoCount: 6, hasIssues: true },
    { id: '1Valenzuela', name: 'Valenzuela Warehouse 1,200 sqm', category: 'WAREHOUSE', listingType: 'FOR LEASE/ FOR RENT', subCategory: '', photoCount: 0, hasIssues: true },
    { id: '1BgcUptown', name: 'BGC Uptown Office 18F, 240 sqm', category: 'OFFICE SPACE', listingType: 'FOR LEASE/ FOR RENT', subCategory: '', photoCount: 6, hasIssues: false },
  ],
};

/** A web app that answers every read, with nothing posted and nothing queued unless told otherwise. */
export function fakeServer(replies: Readonly<Record<string, FakeReply>> = {}, key: string | null = 'test-key'): FakePlatform {
  return createFakePlatform({
    key,
    hasFileSystem: true,
    replies: {
      properties: PROPERTIES,
      property: propertyReply(),
      posts: { ok: true, posts: [] },
      assignments: { ok: true, assignments: [] },
      ...replies,
    },
  });
}

export interface RenderAppOptions {
  readonly platform: FakePlatform;
  /** Signed in from the start as this person; null starts as the app does, from what the platform kept. */
  readonly user?: User | null;
  readonly path?: string;
  /** Router state for the first entry: { section: 'queue' } as the queue passes it. */
  readonly state?: unknown;
}

/** The whole window at `path`, signed in as `user` (an intern by default). */
export function renderApp({ platform, user = intern, path = '/', state }: RenderAppOptions): RenderResult {
  return render(
    <AppStateProvider
      platform={platform}
      initialUser={user ?? undefined}
      initialSettings={user ? { scriptUrl: EXEC } : undefined}
      now={() => NOW}
    >
      <MemoryRouter initialEntries={[state === undefined ? path : { pathname: path, state }]} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
}
