import { useId } from 'react';
import { Button, CategoryTag, Icon } from '../../components';
import type { AssignCheck, AssignRules, PasteMatch } from '@/core/summary';
import type { Property } from '@/core/types';
import { AddedButton, PostingWarning, StatusWord, blockSentence } from './AssignParts';

/** The matches of the list as last matched, for one intern and day. */
export interface Matched {
  readonly for: string;
  readonly matches: readonly PasteMatch[];
  /** Lines whose suggestion was accepted. */
  readonly accepted: ReadonlySet<number>;
}

// ------------------------------------------------------------------ paste

export interface PastePanelProps {
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly onMatch: () => void;
  readonly matched: Matched | null;
  readonly rules: AssignRules | null;
  readonly inQueue: ReadonlySet<string>;
  readonly today: string;
  readonly intern: string | null;
  readonly onAccept: (index: number, property: Property) => void;
  readonly onAddAll: (properties: readonly Property[]) => void;
  readonly addedNote: string | null;
}

export function PastePanel({
  text,
  onText,
  onMatch,
  matched,
  rules,
  inQueue,
  today,
  intern,
  onAccept,
  onAddAll,
  addedNote,
}: PastePanelProps) {
  const fieldId = useId();
  const hintId = useId();
  const isIn = (p: Property) => rules !== null && inQueue.has(rules.entryFor(p).key);

  const matches = matched?.matches ?? [];
  const found = matches.filter((m, i) => m.kind === 'exact' || matched?.accepted.has(i)).length;
  const addable: Property[] = [];
  for (const m of matches) {
    if (m.kind !== 'exact' || !m.property || !rules) continue;
    if (!isIn(m.property) && rules.check(m.property).canAdd && !addable.includes(m.property)) addable.push(m.property);
  }
  const anyExactAddable = matches.some((m) => m.kind === 'exact' && m.property && rules?.check(m.property).canAdd);

  return (
    <div className="assign-paste">
      <div className="field">
        <label className="field__label" htmlFor={fieldId}>
          Paste a list
        </label>
        <textarea
          id={fieldId}
          className="field__input assign-paste__input"
          rows={6}
          spellCheck={false}
          placeholder={'One listing name per line'}
          aria-describedby={hintId}
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
        <p className="field__hint" id={hintId}>
          Numbers, bullets and small typos are fine.
        </p>
      </div>
      <div className="assign-paste__run">
        <Button disabled={text.trim() === '' || rules === null} onClick={onMatch}>
          Match to the library
        </Button>
      </div>

      {matched ? (
        <section className="assign-matches" aria-label="Matches">
          <div className="assign-matches__head">
            <p className="assign__count" role="status">
              {matches.length === 0 ? 'Nothing to match: the list has no names in it.' : `${found} of ${matches.length} found`}
            </p>
            {addable.length > 0 ? (
              <Button size="small" onClick={() => onAddAll(addable)}>
                {addable.length === 1 ? 'Add 1 found listing' : `Add ${addable.length} found listings`}
              </Button>
            ) : anyExactAddable ? (
              <AddedButton>Found listings added</AddedButton>
            ) : null}
          </div>
          {addedNote ? (
            <p className="assign-matches__note" role="status">
              {addedNote}
            </p>
          ) : null}
          <ul className="assign-matches__list">
            {matches.map((m, index) => (
              <MatchRow
                key={`${index}-${m.typed}`}
                match={m}
                check={m.property && rules ? rules.check(m.property) : null}
                added={m.property ? isIn(m.property) : false}
                accepted={matched.accepted.has(index)}
                today={today}
                intern={intern}
                onAccept={() => {
                  if (m.property) onAccept(index, m.property);
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

interface MatchRowProps {
  readonly match: PasteMatch;
  readonly check: AssignCheck | null;
  readonly added: boolean;
  readonly accepted: boolean;
  readonly today: string;
  readonly intern: string | null;
  readonly onAccept: () => void;
}

function MatchRow({ match, check, added, accepted, today, intern, onAccept }: MatchRowProps) {
  const { property } = match;

  if (match.kind === 'notFound' || !property) {
    return (
      <li className="assign-match assign-match--fail">
        <Icon name="fail" size={20} className="assign-match__icon" />
        <div className="assign-match__body">
          <p className="assign-match__line">
            <span className="visually-hidden">Not found: </span>“{match.typed}” isn&rsquo;t in the library.
          </p>
          <p className="assign-match__detail">Check the spelling, or search for it.</p>
        </div>
      </li>
    );
  }

  if (match.kind === 'suggestion' && !accepted) {
    const blocked = check !== null && !check.canAdd && !added;
    return (
      <li className="assign-match assign-match--warn">
        <Icon name="warn" size={20} className="assign-match__icon" />
        <div className="assign-match__body">
          <p className="assign-match__line">
            <span className="visually-hidden">Not found, with a suggestion: </span>“{match.typed}” isn&rsquo;t in the
            library.
          </p>
          <p className="assign-match__detail">
            Did you mean <strong className="assign-match__name">{property.name}</strong>?
          </p>
          {blocked && check ? <p className="assign-match__reason">{blockSentence(check, intern)}</p> : null}
          {!blocked ? <PostingWarning property={property} className="assign-warning" /> : null}
          {added ? <p className="assign-match__detail">It&rsquo;s already in the queue.</p> : null}
        </div>
        {!blocked && !added ? (
          <Button size="small" className="assign-match__action" aria-label={`Yes, add ${property.name}`} onClick={onAccept}>
            Yes, add it
          </Button>
        ) : null}
      </li>
    );
  }

  const blocked = check !== null && !check.canAdd && !added;
  return (
    <li className={['assign-match', blocked ? 'assign-match--fail' : 'assign-match--pass'].join(' ')}>
      <Icon name={blocked ? 'fail' : 'pass'} size={20} className="assign-match__icon" />
      <div className="assign-match__body">
        <p className="assign-match__line">
          <span className="visually-hidden">{blocked ? "Found, but can't be added: " : 'Found: '}</span>
          <span className="assign-match__name">{property.name}</span>
        </p>
        <div className="assign-match__meta">
          <CategoryTag category={property.category} />
          {accepted ? <span className="assign-meta">You typed “{match.typed}”.</span> : null}
          {added ? <span className="assign-meta">In the queue</span> : check && !blocked ? <StatusWord check={check} today={today} intern={intern} /> : null}
        </div>
        {blocked && check ? <p className="assign-match__reason">{blockSentence(check, intern)}</p> : null}
        {!blocked ? <PostingWarning property={property} className="assign-warning" /> : null}
      </div>
    </li>
  );
}
