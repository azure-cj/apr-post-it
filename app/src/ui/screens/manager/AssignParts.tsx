import type { ReactNode } from 'react';
import { Button, Icon, Pill } from '../../components';
import { ago, daysBetween, holderName, postingProblem, type AssignCheck, type IssueKind } from '@/core/summary';
import type { Property } from '@/core/types';

// ------------------------------------------------------------------ status words

/** "In cooldown", "In Mika's queue", "Never posted", "Due for repost": the word carries it, the tone helps find it. */
export function StatusWord({ check, today, intern }: { check: AssignCheck; today: string; intern: string | null }) {
  if (check.block === 'cooldown') {
    return (
      <Pill tone="danger" dot>
        In cooldown
      </Pill>
    );
  }
  if (check.block === 'otherQueue' && check.holder) {
    return <Pill tone="neutral">In {holderName(check.holder, intern ?? '')}&rsquo;s queue</Pill>;
  }
  const last = check.lastPost;
  if (!last) return <Pill tone="info">Never posted</Pill>;
  const when = `Last posted ${ago(Math.max(0, daysBetween(last.date, today)))}`;
  if (check.due) {
    return (
      <>
        <Pill tone="info">Due for repost</Pill>
        <span className="assign-meta">{when}</span>
      </>
    );
  }
  return <span className="assign-meta">{when}</span>;
}

/** Where an Add button was: focus stays put, and it says what happened. */
export function AddedButton({ children }: { children: ReactNode }) {
  return (
    <Button
      size="small"
      className="assign-added"
      aria-disabled="true"
      icon={<Icon name="check" size={16} />}
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </Button>
  );
}


/** Why a listing can't go in this queue, as one sentence. */
export function blockSentence(check: AssignCheck, intern: string | null): string {
  if (check.block === 'cooldown') return `In cooldown. ${check.reason}`;
  return check.reason || `Already in ${holderName(check.holder ?? '', intern ?? '')}'s queue.`;
}

const cantBePosted: Partial<Record<IssueKind, string>> = {
  noSeparator: "Copy is blocked: its document has no separator. Fix the document first, or it can't be posted.",
  noDocument: "There's nothing to post: the folder has no document. Add one first, or it can't be posted.",
  wordFile: "There's nothing to post: its document is a Word file. Save it as a Google Doc first, or it can't be posted.",
};

/**
 * A listing the intern couldn't post if it were queued: its document blocks
 * Copy, or there is none. Said only when the directory list carries the
 * Issues text; a plain Property says nothing.
 */
export function PostingWarning({ property, className }: { property: Property; className: string }) {
  const problem = postingProblem(property);
  const said = problem ? cantBePosted[problem] : undefined;
  if (!said) return null;
  return (
    <p className={className}>
      <Icon name="warn" size={16} className="assign-warning__icon" />
      <span>{said}</span>
    </p>
  );
}
