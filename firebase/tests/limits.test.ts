import { describe, expect, it } from "vitest";
import { costOf, dollars, limitsOf, manilaDates, refusalOf } from "../functions/src/limits.ts";
import { rewordOf } from "../functions/src/prompt.ts";

describe("Manila's day and month", () => {
  it("is UTC+8", () => {
    expect(manilaDates(Date.parse("2026-11-30T15:59:59Z"))).toEqual({ day: "2026-11-30", month: "2026-11" });
    expect(manilaDates(Date.parse("2026-11-30T16:00:00Z"))).toEqual({ day: "2026-12-01", month: "2026-12" });
  });
});

describe("what a call costs", () => {
  it.each([
    ["claude-haiku-5-5", 0.1, 0.5],
    ["claude-sonnet-5-5", 2, 10],
    ["claude-opus-5-5", 4, 20],
    ["claude-something-else", 5, 25],
  ])("%s at $%s in and $%s out per million", (model, priceIn, priceOut) => {
    expect(costOf(model, 1_000_000, 0)).toBe(priceIn);
    expect(costOf(model, 0, 1_000_000)).toBe(priceOut);
    expect(costOf(model, 2000, 400)).toBeCloseTo((2000 * priceIn + 400 * priceOut) / 1_000_000, 12);
  });
});

describe("config/claude", () => {
  it("defaults each missing field", () => {
    expect(limitsOf(undefined)).toEqual({ on: true, dailyUsd: 5, monthlyBudgetUsd: 50 });
    expect(limitsOf({ dailyUsd: 3 })).toEqual({ on: true, dailyUsd: 3, monthlyBudgetUsd: 50 });
    expect(limitsOf({ on: "no", dailyUsd: "7" })).toEqual({ on: true, dailyUsd: 5, monthlyBudgetUsd: 50 });
  });

  it("refuses off first, then the day, then the month", () => {
    const limits = { on: true, dailyUsd: 5, monthlyBudgetUsd: 50 };
    expect(refusalOf({ ...limits, on: false }, 9, 99)?.message).toBe("Claude is switched off for now.");
    expect(refusalOf(limits, 5, 99)?.message).toBe("You've used today's $5 of Claude. Claude is back tomorrow.");
    expect(refusalOf(limits, 4.99, 50)?.message).toBe("This month's Claude budget is used up.");
    expect(refusalOf(limits, 4.99, 49.99)).toBeNull();
  });

  it("writes the limit as dollars", () => {
    expect(dollars(5)).toBe("$5");
    expect(dollars(2.5)).toBe("$2.50");
  });
});

describe("the reply", () => {
  it("is the reword alone", () => {
    expect(rewordOf("  <post>\nHello\n</post>  ")).toBe("Hello");
    expect(rewordOf("Hello\nthere\n")).toBe("Hello\nthere");
  });
});
