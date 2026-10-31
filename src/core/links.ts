/**
 * Is this a Facebook post's link? The same rule as Code.gs's logPost, so the
 * app can say so before asking, and the server's refusal is the rare case.
 *
 * The rule: trimmed, https, and the host is facebook.com, www.facebook.com,
 * m.facebook.com, web.facebook.com, fb.com or fb.me.
 */

const HOSTS: ReadonlySet<string> = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.com',
  'fb.me',
]);

export const LINK_MISSING = "Paste the post's link.";
export const LINK_NOT_FACEBOOK = "That isn't a Facebook link.";

/**
 * Code.gs's postLinkProblem_ pattern, character for character: "https://",
 * then the host up to the first / ? or #, then anything without a space. The
 * host part must be one of HOSTS exactly, so a port (":8443"), a user name
 * ("u@") or a backslash makes it some other host and the link is refused.
 * A URL parser is not used: it would read those as Facebook, and the server
 * does not.
 */
const LINK = /^https:\/\/([^/?#\s]+)(?:[/?#][^\s]*)?$/i;

/** True for an https link on one of Facebook's hosts, once trimmed. */
export function isFacebookPostLink(url: string): boolean {
  const m = LINK.exec(url.trim());
  return m !== null && HOSTS.has(m[1]!.toLowerCase());
}

/** What is wrong with `url` as a post's link, as a short sentence, or null when nothing is. */
export function postLinkProblem(url: string): string | null {
  if (!url.trim()) return LINK_MISSING;
  return isFacebookPostLink(url) ? null : LINK_NOT_FACEBOOK;
}
