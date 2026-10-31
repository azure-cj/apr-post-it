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

/**
 * A Facebook profile's link, Code.gs's profileLinkIn_ rule: https, on
 * facebook.com, www.facebook.com, m.facebook.com, web.facebook.com or fb.com,
 * any path (a post's link is not looked for). Typed without a scheme, it gets
 * "https://" in front before it is checked, as the server does.
 */
const PROFILE_HOSTS: ReadonlySet<string> = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.com',
]);

export const PROFILE_LINK_NOT_FACEBOOK = "That isn't a Facebook profile link.";

/** The profile link as it will be saved: trimmed, with https:// in front when it had no scheme. '' stays ''. */
export function normalizeProfileLink(url: string): string {
  const text = url.trim();
  if (!text) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
}

/** What is wrong with `url` as a Facebook profile link, as a short sentence, or null. Blank is fine: the link is optional. */
export function facebookProfileProblem(url: string): string | null {
  const text = normalizeProfileLink(url);
  if (!text) return null;
  const m = LINK.exec(text);
  return m !== null && PROFILE_HOSTS.has(m[1]!.toLowerCase()) ? null : PROFILE_LINK_NOT_FACEBOOK;
}
