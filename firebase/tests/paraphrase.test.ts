import { getAuth } from "firebase-admin/auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { manilaDates } from "../functions/src/limits.ts";
import { MODEL } from "../functions/src/prompt.ts";
import { admin, call, db, makeAccount, refusal, resetEmulator, signIn } from "./emulator.ts";
import { startFakeClaude, type FakeClaude } from "./fake-claude.ts";

// Rewording a post (AID-129) on the hub's key and within the hub's limits: config/claude, read only, and usage added
// to claudeUsage beside the hub's own jobs, so a person's day counts both apps.

const POST = "FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4.2M\nContact: 0917 555 0142";

let claude: FakeClaude;
let cj = "";
let token = "";
let dates = manilaDates();

const monthDoc = () => db().doc(`claudeUsage/${dates.month}`);
const dayDoc = (uid = cj) => monthDoc().collection("days").doc(`${dates.day}_${uid}`);
const reword = (as: string | null = token, text: string = POST) => call<{ text: string }>("paraphrase", { text }, as);

beforeAll(async () => {
  claude = await startFakeClaude();
});

afterAll(async () => {
  await claude.close();
});

beforeEach(async () => {
  claude.reset();
  await resetEmulator();
  cj = await makeAccount("cj", "agent", "CJ Aureo");
  token = await signIn("cj");
  dates = manilaDates();
});

describe("who may reword", () => {
  it("refuses a signed-out caller", async () => {
    expect(await refusal(reword(null))).toMatchObject({ code: "functions/unauthenticated" });
    expect(claude.received).toHaveLength(0);
  });

  it.each([["scanner"], [null]])("refuses an account whose role is %s", async (role) => {
    await makeAccount("someone", role);
    expect(await refusal(reword(await signIn("someone")))).toMatchObject({ code: "functions/permission-denied" });
    expect(claude.received).toHaveLength(0);
  });

  // A sign-in lasts an hour; a change on the hub's People screen counts at once (D30).
  describe("asks Firebase about the account on every call", () => {
    const auth = () => getAuth(admin());

    it("refuses an account turned off after signing in, and records nothing", async () => {
      await auth().updateUser(cj, { disabled: true });
      expect(await refusal(reword())).toEqual({
        code: "functions/unauthenticated",
        message: "This sign-in has ended. Sign in again.",
      });
      expect(claude.received).toHaveLength(0);
      expect((await monthDoc().get()).exists).toBe(false);
      expect((await dayDoc().get()).exists).toBe(false);
    });

    it("refuses a sign-in from before the account's sign-ins were ended", async () => {
      // Firebase keeps the end to the second: a sign-in in the same second would still count.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await auth().revokeRefreshTokens(cj);
      expect(await refusal(reword())).toMatchObject({ code: "functions/unauthenticated" });
      expect(claude.received).toHaveLength(0);
    });

    it("refuses an account whose role was taken away after signing in", async () => {
      await auth().setCustomUserClaims(cj, {});
      expect(await refusal(reword())).toEqual({
        code: "functions/permission-denied",
        message: "Rewording is for agents and admins.",
      });
      expect(claude.received).toHaveLength(0);
    });

    it("still rewords for an agent in good standing", async () => {
      await expect(reword()).resolves.toEqual({ text: "A reworded post." });
      expect(claude.received).toHaveLength(1);
    });
  });

  it("refuses an empty text", async () => {
    expect(await refusal(reword(token, "  \n "))).toMatchObject({ code: "functions/invalid-argument" });
  });
});

describe("the hub's limits", () => {
  it("refuses while Claude is switched off, and never asks it", async () => {
    await db().doc("config/claude").set({ on: false, dailyUsd: 5, monthlyBudgetUsd: 50 });
    expect(await refusal(reword())).toEqual({ code: "functions/failed-precondition", message: "Claude is switched off for now." });
    expect(claude.received).toHaveLength(0);
  });

  it("refuses a person whose day is used up, counting what the hub spent for them", async () => {
    // Written by the hub's own Claude jobs: Post-It reads the same document.
    await dayDoc().set({ uid: cj, day: dates.day, calls: 12, costUsd: 5 });
    expect(await refusal(reword())).toEqual({
      code: "functions/resource-exhausted",
      message: "You've used today's $5 of Claude. Claude is back tomorrow.",
    });
    expect(claude.received).toHaveLength(0);
  });

  it("names the owner's daily limit, not the default", async () => {
    await db().doc("config/claude").set({ dailyUsd: 2.5 });
    await dayDoc().set({ uid: cj, day: dates.day, calls: 3, costUsd: 2.6 });
    expect((await refusal(reword())).message).toBe("You've used today's $2.50 of Claude. Claude is back tomorrow.");
  });

  it("refuses everyone once the month's budget is used up", async () => {
    await monthDoc().set({ month: dates.month, calls: 900, costUsd: 50 });
    expect(await refusal(reword())).toEqual({ code: "functions/resource-exhausted", message: "This month's Claude budget is used up." });
    expect(claude.received).toHaveLength(0);
  });

  it("lets a person under the limits through, and doesn't count someone else's day", async () => {
    const ana = await makeAccount("ana", "agent");
    await dayDoc(ana).set({ uid: ana, day: dates.day, calls: 50, costUsd: 9 });
    await dayDoc().set({ uid: cj, day: dates.day, calls: 1, costUsd: 4.99 });
    await expect(reword()).resolves.toEqual({ text: "A reworded post." });
  });

  it("never writes config/claude", async () => {
    await reword();
    expect((await db().doc("config/claude").get()).exists).toBe(false);
  });
});

describe("a reword", () => {
  it("asks Haiku with the hub's key, and returns only the reworded text", async () => {
    claude.answer.text = "<post>\nVerdant Hills lot, 320 sqm\n</post>\n";
    expect(await reword()).toEqual({ text: "Verdant Hills lot, 320 sqm" });
    expect(claude.received).toHaveLength(1);
    const [request] = claude.received;
    expect(request).toMatchObject({ path: "/v1/messages", apiKey: "stand-in-key-not-a-real-one" });
    expect(request?.body).toMatchObject({ model: MODEL, messages: [{ role: "user", content: `<post>\n${POST}\n</post>` }] });
    expect(String(request?.body["system"])).toContain("same language");
  });

  it("is recorded once, under paraphrase, with the right cost", async () => {
    await reword();
    // claude-haiku-5-5: $0.1 in and $0.5 out per million tokens; 1,000 in and 200 out.
    const cost = (1000 * 0.1 + 200 * 0.5) / 1_000_000;

    const month = (await monthDoc().get()).data();
    expect(month).toEqual({
      month: dates.month,
      calls: 1,
      costUsd: cost,
      inputTokens: 1000,
      outputTokens: 200,
      jobs: { paraphrase: { calls: 1, costUsd: cost } },
      people: { [cj]: { name: "CJ Aureo", calls: 1, costUsd: cost } },
    });
    expect((await dayDoc().get()).data()).toEqual({ uid: cj, day: dates.day, calls: 1, costUsd: cost });
  });

  it("adds to what the hub recorded, without touching its jobs", async () => {
    await monthDoc().set({
      month: dates.month,
      calls: 4,
      costUsd: 0.5,
      inputTokens: 10,
      outputTokens: 20,
      jobs: { check: { calls: 4, costUsd: 0.5 } },
      people: { [cj]: { name: "CJ Aureo", calls: 4, costUsd: 0.5 } },
    });
    await dayDoc().set({ uid: cj, day: dates.day, calls: 4, costUsd: 0.5 });
    await reword();
    await reword();

    const month = (await monthDoc().get()).data()!;
    expect(month["calls"]).toBe(6);
    expect(month["jobs"]).toEqual({ check: { calls: 4, costUsd: 0.5 }, paraphrase: { calls: 2, costUsd: 0.0004 } });
    expect(month["people"][cj]).toMatchObject({ calls: 6 });
    expect(month["people"][cj].costUsd).toBeCloseTo(0.5004, 10);
    const day = (await dayDoc().get()).data()!;
    expect(day["calls"]).toBe(6);
    expect(day["costUsd"]).toBeCloseTo(0.5004, 10);
  });

  it("names a person with no users document by their email", async () => {
    await makeAccount("noname", "admin", null);
    await reword(await signIn("noname"));
    const people = (await monthDoc().get()).get("people") as Record<string, { name: string }>;
    expect(Object.values(people).map((p) => p.name)).toEqual(["noname@post-it.test"]);
  });

  it("isn't recorded when Claude refuses it", async () => {
    claude.answer.stopReason = "refusal";
    expect(await refusal(reword())).toEqual({
      code: "functions/failed-precondition",
      message: "Claude wouldn't reword this post. Post the original.",
    });
    expect((await monthDoc().get()).exists).toBe(false);
    expect((await dayDoc().get()).exists).toBe(false);
  });

  it("isn't recorded when the call fails", async () => {
    claude.answer.status = 500;
    expect(await refusal(reword())).toMatchObject({ code: "functions/unavailable" });
    expect((await monthDoc().get()).exists).toBe(false);
  });
});
