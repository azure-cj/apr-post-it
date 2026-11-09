/**
 * Is this a Facebook post's link? The same rule as Code.gs's postKey_ and
 * postLinkProblem_, so the app can say so before asking, and the server's
 * refusal is the rare case.
 *
 * The rule (v14): trimmed, https, the host is facebook.com, www.facebook.com,
 * m.facebook.com, web.facebook.com or fb.com, and the address is one post's:
 *   /groups/<group>/posts/<id>      /groups/<group>/permalink/<id>
 *   /<page or person>/posts/<id>    /share/p/<id>
 *   /permalink.php or /story.php with story_fbid
 *   /photo.php or /photo/ with fbid /marketplace/item/<id>
 * A profile, a group's front page or Facebook's home page is not a post.
 */

const HOSTS: ReadonlySet<string> = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com']);

export const LINK_MISSING = "Paste the post's link.";
export const LINK_NOT_FACEBOOK = "That isn't a Facebook link.";
export const LINK_NOT_POST = "That's a Facebook link, but not a post's. Open the post (click its date) and copy that address.";

/**
 * Code.gs's pattern, character for character: "https://", the host up to the
 * first / ? or #, then the path, the query and the fragment, none with a
 * space. The host must be one of HOSTS exactly, so a port (":8443"), a user
 * name ("u@") or a backslash makes it some other host and the link is
 * refused. A URL parser is not used: it would read those as Facebook, and
 * the server does not.
 */
const LINK = /^https:\/\/([^/?#\s]+)(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i;
const ID = /^[A-Za-z0-9_.-]+$/;

/** The query's values by name, lower-cased names. */
function queryOf(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of query.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const at = part.indexOf('=');
    const name = (at === -1 ? part : part.slice(0, at)).toLowerCase();
    if (!out.has(name)) out.set(name, at === -1 ? '' : part.slice(at + 1));
  }
  return out;
}

/** True when the link is https on one of Facebook's hosts, whatever the page. */
export function isFacebookLink(url: string): boolean {
  const m = LINK.exec(url.trim());
  return m !== null && HOSTS.has(m[1]!.toLowerCase());
}

/**
 * The post a link is to, as a key that is the same for every copy of that
 * link (any of the hosts, m. or web., a tracking query such as ?mibextid=, a
 * trailing slash, letter case, /permalink/ or /posts/): "groups/apg/posts/123".
 * Null when it isn't a post's link. One post is credited to one person (v14).
 */
export function postKeyOf(url: string): string | null {
  const m = LINK.exec(url.trim());
  if (!m || !HOSTS.has(m[1]!.toLowerCase())) return null;
  const parts = (m[2] ?? '').split('/').filter(Boolean).map((p) => p.toLowerCase());
  const query = queryOf(m[3] ?? '');
  const id = (value: string | undefined) => (value !== undefined && ID.test(value) ? value.toLowerCase() : null);
  const [a, b, c, d] = parts;

  if (a === 'groups' && (c === 'posts' || c === 'permalink')) {
    const group = id(b);
    const post = id(d);
    return group && post ? `groups/${group}/posts/${post}` : null;
  }
  if (a === 'share' && b === 'p') {
    const post = id(c);
    return post ? `share/p/${post}` : null;
  }
  if (a === 'marketplace' && b === 'item') {
    const item = id(c);
    return item ? `marketplace/${item}` : null;
  }
  if (parts.length === 1 && (a === 'permalink.php' || a === 'story.php')) {
    const story = id(query.get('story_fbid'));
    return story ? `story/${story}` : null;
  }
  if (parts.length <= 2 && (a === 'photo.php' || a === 'photo') && (b === undefined || b === '')) {
    const photo = id(query.get('fbid'));
    return photo ? `photo/${photo}` : null;
  }
  if (a !== undefined && a !== 'groups' && b === 'posts') {
    const who = id(a);
    const post = id(c);
    return who && post ? `${who}/posts/${post}` : null;
  }
  return null;
}

/** True for a Facebook post's link, once trimmed. */
export function isFacebookPostLink(url: string): boolean {
  return postKeyOf(url) !== null;
}

/** What is wrong with `url` as a post's link, as a short sentence, or null when nothing is. */
export function postLinkProblem(url: string): string | null {
  if (!url.trim()) return LINK_MISSING;
  if (!isFacebookLink(url)) return LINK_NOT_FACEBOOK;
  return isFacebookPostLink(url) ? null : LINK_NOT_POST;
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
