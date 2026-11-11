// What Claude is told when it rewords a post (AID-129). The app runs its pre-post checks on the reword and refuses one
// whose numbers differ from the original's, so a reword that breaks these rules is never copied; the rules are here so
// that it rarely happens.

export const MODEL = "claude-haiku-5-5";

/** The longest posting text that may be sent, in characters. The longest in the library is about 4,000. */
export const MAX_TEXT = 10_000;

export const SYSTEM = `You reword Facebook posts that advertise real estate listings in the Philippines, so the same listing can be posted again without reading the same as before.

The user message holds one post inside <post> tags. Reword it.

Rules:
- Keep every fact: price, size, location, address, floor and lot area, rooms, terms, payment terms, availability, contact details and names.
- Copy every number, amount, unit, phone number and name exactly as the original writes it.
- Add nothing: no new facts, features, claims, hashtags or calls to action.
- Leave nothing out.
- Write in the same language as the original. Keep a mix of English and Filipino if the original mixes them.
- Keep about the same length and layout: lists stay lists, and the original's emoji may stay.

Reply with the reworded post only: no introduction, no notes, no tags and no quotation marks around it.`;

/** The user message for `text`. */
export function postMessage(text: string): string {
  return `<post>\n${text}\n</post>`;
}

/** The reword from Claude's reply text: trimmed, and without <post> tags should Claude echo them. */
export function rewordOf(reply: string): string {
  return reply
    .trim()
    .replace(/^<post>\s*/i, "")
    .replace(/\s*<\/post>$/i, "")
    .trim();
}
