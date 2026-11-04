import { useState, type RefObject } from 'react';
import { Button, TextInput } from '../../components';
import { facebookProfileProblem, normalizeProfileLink } from '@/core/links';
import type { FbProfile, TeamMember } from '@/core/types';

/** The rows a person's FB accounts start from: theirs, or one empty row. */
export function profilesOf(member: TeamMember | null): FbProfile[] {
  const saved = member?.fbProfiles ?? (member?.fbAccounts ?? []).map((account, i) => ({ account, link: i === 0 ? (member?.fbProfileLink ?? '') : '' }));
  return saved.length > 0 ? saved.map((p) => ({ account: p.account, link: p.link })) : [{ account: '', link: '' }];
}

/** The rows as they will be saved: trimmed, links with https://, empty rows gone. */
export function cleanProfiles(rows: readonly FbProfile[]): FbProfile[] {
  return rows
    .map((r) => ({ account: r.account.trim(), link: normalizeProfileLink(r.link) }))
    .filter((r) => r.account || r.link);
}

export const sameProfiles = (a: readonly FbProfile[], b: readonly FbProfile[]) =>
  a.length === b.length && a.every((p, i) => p.account === b[i]!.account && p.link === b[i]!.link);

export interface ProfilesProblem {
  readonly index: number;
  readonly field: 'account' | 'link';
  readonly message: string;
}

/** The first thing wrong with the rows, or null. An intern needs at least one account. */
export function profilesProblem(rows: readonly FbProfile[], required: boolean): ProfilesProblem | null {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const account = row.account.trim();
    const linkProblem = facebookProfileProblem(row.link);
    if (linkProblem) return { index, field: 'link', message: linkProblem };
    if (!account && row.link.trim()) return { index, field: 'account', message: 'Type the account name.' };
    if (account.includes(',')) return { index, field: 'account', message: 'No commas in a name.' };
    if (account && seen.has(account.toLowerCase())) return { index, field: 'account', message: 'Already listed.' };
    if (account) seen.add(account.toLowerCase());
  }
  if (required && seen.size === 0) return { index: 0, field: 'account', message: 'Type their FB broker name.' };
  return null;
}

/**
 * A person's FB accounts, one row each: the broker name they post as and that
 * account's profile link. One person may run several accounts.
 */
export function FbAccountsField({
  rows,
  onChange,
  required,
  readOnly,
  problem,
  firstRef,
  onOpenLink,
}: {
  readonly rows: readonly FbProfile[];
  readonly onChange: (rows: FbProfile[]) => void;
  readonly required: boolean;
  readonly readOnly: boolean;
  /** Shown once Save or Add was pressed. */
  readonly problem: ProfilesProblem | null;
  readonly firstRef?: RefObject<HTMLInputElement> | undefined;
  /** Given when the rows are as saved: each good link gets an Open button. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  /** Links checked as typed once left, as the single field was. */
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set());
  const set = (index: number, change: Partial<FbProfile>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  const n = (i: number) => (i === 0 ? '' : ` ${i + 1}`);

  return (
    <div className="fb-accounts" role="group" aria-label="FB accounts">
      {rows.map((row, i) => {
        const linkProblem = facebookProfileProblem(row.link);
        const linkError = problem?.index === i && problem.field === 'link' ? problem.message : left.has(i) ? linkProblem : null;
        const accountError = problem?.index === i && problem.field === 'account' ? problem.message : null;
        const openable = onOpenLink && row.link.trim() && !linkProblem;
        return (
          <div className="fb-accounts__row" key={i}>
            <TextInput
              ref={i === 0 ? firstRef : undefined}
              label={
                <>
                  FB broker name{n(i)}
                  {required && i === 0 ? null : <span className="settings__optional"> (optional)</span>}
                </>
              }
              autoComplete="off"
              spellCheck={false}
              value={row.account}
              readOnly={readOnly}
              placeholder={i === 0 ? 'CYRUS ORBANO' : undefined}
              error={accountError ?? undefined}
              onChange={(e) => set(i, { account: e.target.value })}
            />
            <TextInput
              label={
                <>
                  FB profile link{n(i)}
                  <span className="settings__optional"> (optional)</span>
                </>
              }
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={row.link}
              readOnly={readOnly}
              placeholder="https://www.facebook.com/…"
              error={linkError ?? undefined}
              onBlur={() => setLeft((s) => new Set(s).add(i))}
              onChange={(e) => set(i, { link: e.target.value })}
              end={
                openable ? (
                  <Button variant="quiet" size="small" onClick={() => onOpenLink(normalizeProfileLink(row.link))} aria-label={`Open ${row.account || 'this'} profile`}>
                    Open
                  </Button>
                ) : undefined
              }
            />
            {rows.length > 1 && !readOnly ? (
              <Button
                variant="quiet"
                size="small"
                className="fb-accounts__remove"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${row.account.trim() || `account${n(i)}`}`}
              >
                Remove
              </Button>
            ) : null}
          </div>
        );
      })}
      {readOnly ? null : (
        <Button variant="quiet" size="small" className="fb-accounts__add" onClick={() => onChange([...rows, { account: '', link: '' }])}>
          Add account
        </Button>
      )}
    </div>
  );
}
