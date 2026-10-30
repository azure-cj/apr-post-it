import type { HTMLAttributes, ReactNode } from 'react';
import './Pill.css';

/** The status families. Gold is not one of them. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone | undefined;
  /** A dot before the word, in the tone's strong colour. */
  readonly dot?: boolean | undefined;
  readonly children: ReactNode;
}

/**
 * A status word on its tone: "Posted", "Pending", "In cooldown", "Intern".
 * The word carries the meaning; the colour only makes it quicker to find.
 */
export function Pill({ tone = 'neutral', dot = false, className, children, ...rest }: PillProps) {
  return (
    <span {...rest} className={['pill', `pill--${tone}`, className].filter(Boolean).join(' ')}>
      {dot ? <span className="pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly count: number;
  /** What the number counts, for screen readers: "6 to post". Defaults to the number. */
  readonly label?: string | undefined;
  readonly tone?: Tone | undefined;
}

/** A count beside a label: the open items in My queue. */
export function Badge({ count, label, tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={['badge', `badge--${tone}`, 'tabular', className].filter(Boolean).join(' ')}>
      <span aria-hidden={label ? true : undefined}>{count.toLocaleString('en-PH')}</span>
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  );
}

// ---- categories --------------------------------------------------------

/** The token families in tokens.css ("listing types"), one hue each. */
export type CategoryKind = 'commercial' | 'condo' | 'office' | 'warehouse' | 'unsorted';

const knownLabels: Record<Exclude<CategoryKind, 'unsorted'>, string> = {
  commercial: 'Commercial space',
  condo: 'Condo / house and lot',
  office: 'Office space',
  warehouse: 'Warehouse',
};

/** Capitals, "&" as "and", punctuation and runs of spaces as one space. */
const normalise = (name: string): string =>
  name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const knownFolders: Readonly<Record<string, Exclude<CategoryKind, 'unsorted'>>> = {
  'COMMERCIAL SPACE': 'commercial',
  'CONDO HOUSE AND LOT': 'condo',
  'OFFICE SPACE': 'office',
  WAREHOUSE: 'warehouse',
};

/**
 * Which of the four categories a Drive category folder is. Matched as whole
 * names, like the exclusion list (D11): "Virtual Office for posting" is not
 * an office space. Anything else is unsorted.
 */
export function categoryKind(category: string): CategoryKind {
  return knownFolders[normalise(category)] ?? 'unsorted';
}

/**
 * The category as the screen says it: sentence case, never the folder's
 * capitals. "CONDO / HOUSE AND LOT" → "Condo / house and lot".
 */
export function categoryLabel(category: string): string {
  const kind = categoryKind(category);
  if (kind !== 'unsorted') return knownLabels[kind];
  const trimmed = category.trim();
  if (trimmed === '') return 'Unsorted';
  const shouting = trimmed === trimmed.toUpperCase() && /[A-Z]{2}/.test(trimmed) && trimmed.includes(' ');
  if (!shouting) return trimmed;
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export interface CategoryDotProps {
  readonly kind: CategoryKind;
  readonly className?: string | undefined;
}

/**
 * A category's hue, as a dot and only as a dot: each hue sits near a status
 * colour or gold, so it is never used for text, fills or edges.
 */
export function CategoryDot({ kind, className }: CategoryDotProps) {
  return (
    <span
      className={['category-dot', `category-dot--${kind}`, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}

export interface CategoryTagProps extends HTMLAttributes<HTMLSpanElement> {
  /** The category as the directory has it, e.g. "COMMERCIAL SPACE". */
  readonly category: string;
}

/** A listing's category: its dot and its name. */
export function CategoryTag({ category, className, ...rest }: CategoryTagProps) {
  return (
    <span {...rest} className={['category-tag', className].filter(Boolean).join(' ')}>
      <CategoryDot kind={categoryKind(category)} />
      {categoryLabel(category)}
    </span>
  );
}
