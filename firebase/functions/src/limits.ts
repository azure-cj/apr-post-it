import { HttpsError } from "firebase-functions/https";

// Claude's limits and what a call costs. The owner sets the limits on the Listing Hub, in Firestore config/claude; Post-It
// only reads them. Usage is kept in claudeUsage, the hub's documents, so a person's day and the month count both apps.

/** config/claude, with the defaults for anything missing. */
export interface ClaudeLimits {
  /** False switches Claude off for everyone. */
  readonly on: boolean;
  /** Each person's spend per Manila day, in US dollars, across both apps. */
  readonly dailyUsd: number;
  /** Everyone's spend per Manila month, in US dollars, across both apps. */
  readonly monthlyBudgetUsd: number;
}

export const DEFAULT_LIMITS: ClaudeLimits = Object.freeze({ on: true, dailyUsd: 5, monthlyBudgetUsd: 50 });

/** config/claude as it was read (undefined when there is none), each field falling back to its default. */
export function limitsOf(data: Readonly<Record<string, unknown>> | undefined): ClaudeLimits {
  const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    on: data?.["on"] !== false,
    dailyUsd: number(data?.["dailyUsd"], DEFAULT_LIMITS.dailyUsd),
    monthlyBudgetUsd: number(data?.["monthlyBudgetUsd"], DEFAULT_LIMITS.monthlyBudgetUsd),
  };
}

/** Manila's day (yyyy-MM-dd) and month (yyyy-MM) at `now`. Manila has no daylight saving: always UTC+8. */
export function manilaDates(now: number = Date.now()): { readonly day: string; readonly month: string } {
  const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7) };
}

/** US dollars per million tokens, in and out. */
const PRICES: Readonly<Record<string, readonly [number, number]>> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const OTHER_MODEL: readonly [number, number] = [5, 25];

/** What a call cost, in US dollars. */
export function costOf(model: string, tokensIn: number, tokensOut: number): number {
  const [priceIn, priceOut] = PRICES[model] ?? OTHER_MODEL;
  return (tokensIn * priceIn + tokensOut * priceOut) / 1_000_000;
}

/** "$5", "$2.50". */
export function dollars(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * Why Claude can't be asked now, or null when it can. `dayUsd` is what the caller has spent today and `monthUsd` what
 * everyone has spent this month, both apps together.
 */
export function refusalOf(limits: ClaudeLimits, dayUsd: number, monthUsd: number): HttpsError | null {
  if (!limits.on) return new HttpsError("failed-precondition", "Claude is switched off for now.");
  if (dayUsd >= limits.dailyUsd) {
    return new HttpsError("resource-exhausted", `You've used today's ${dollars(limits.dailyUsd)} of Claude. Claude is back tomorrow.`);
  }
  if (monthUsd >= limits.monthlyBudgetUsd) return new HttpsError("resource-exhausted", "This month's Claude budget is used up.");
  return null;
}

/** The costUsd of a usage document, or 0 when there is none yet. */
export function spentIn(data: Readonly<Record<string, unknown>> | undefined): number {
  const cost = data?.["costUsd"];
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}
