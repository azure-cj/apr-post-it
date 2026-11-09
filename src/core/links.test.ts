import { facebookProfileProblem, isFacebookPostLink, normalizeProfileLink, postKeyOf, postLinkProblem } from './links';

const NOT_POST = "That's a Facebook link, but not a post's. Open the post (click its date) and copy that address.";

describe("a post link (v14: a post's address, not any Facebook page)", () => {
  it.each([
    ['https://www.facebook.com/groups/x/posts/1/', 'groups/x/posts/1'],
    ['https://web.facebook.com/groups/x/permalink/2', 'groups/x/posts/2'],
    ['https://m.facebook.com/groups/123456/posts/789?mibextid=abc', 'groups/123456/posts/789'],
    ['https://facebook.com/share/p/1AbCdEf/', 'share/p/1abcdef'],
    ['https://m.facebook.com/story.php?story_fbid=5&id=6', 'story/5'],
    ['https://www.facebook.com/permalink.php?story_fbid=pfbid0Ab&id=6', 'story/pfbid0ab'],
    ['https://www.facebook.com/photo/?fbid=7&set=a.8', 'photo/7'],
    ['https://www.facebook.com/photo.php?fbid=7', 'photo/7'],
    ['https://www.facebook.com/marketplace/item/9/', 'marketplace/9'],
    ['https://www.facebook.com/apg.realty/posts/pfbid02XyZ', 'apg.realty/posts/pfbid02xyz'],
    ['https://fb.com/groups/x/posts/1', 'groups/x/posts/1'],
    ['  https://WWW.Facebook.com/groups/X/posts/1/#top  ', 'groups/x/posts/1'],
  ])('%s is a post: %s', (url, key) => {
    expect(isFacebookPostLink(url)).toBe(true);
    expect(postLinkProblem(url)).toBeNull();
    expect(postKeyOf(url)).toBe(key);
  });

  it('gives every copy of one post the same key', () => {
    const copies = [
      'https://www.facebook.com/groups/apg/posts/123/',
      'https://m.facebook.com/groups/apg/permalink/123/?mibextid=Nif5oz',
      'https://web.facebook.com/groups/APG/posts/123',
    ];
    expect(new Set(copies.map(postKeyOf))).toEqual(new Set(['groups/apg/posts/123']));
  });

  it.each([
    'https://www.facebook.com',
    'https://www.facebook.com/',
    'https://www.facebook.com/cyrus.orbano',
    'https://facebook.com/profile.php?id=100012345',
    'https://www.facebook.com/groups/apg/',
    'https://www.facebook.com/groups/apg/posts/',
    'https://m.facebook.com/story.php?id=1',
    'https://www.facebook.com/photo/?set=a.8',
    'https://www.facebook.com/groups/x/posts/=1/',
    'https://www.facebook.com/x',
    'https://fb.com/1',
  ])('%s is Facebook, but not a post', (url) => {
    expect(isFacebookPostLink(url)).toBe(false);
    expect(postKeyOf(url)).toBeNull();
    expect(postLinkProblem(url)).toBe(NOT_POST);
  });

  it.each([
    'http://www.facebook.com/groups/x/posts/1/',
    'https://facebook.com.evil.example/x',
    'https://evilfacebook.com/x',
    'https://l.facebook.com/x',
    'https://www.fb.com/x',
    'https://fb.me/abc',
    'https://instagram.com/p/1',
    'facebook.com/groups/x',
    'https://www.facebook.com/a b',
    'not a link',
  ])('%s is not Facebook', (url) => {
    expect(isFacebookPostLink(url)).toBe(false);
    expect(postLinkProblem(url)).toBe("That isn't a Facebook link.");
  });

  it('blank asks for one', () => {
    expect(postLinkProblem('')).toBe("Paste the post's link.");
    expect(postLinkProblem('   ')).toBe("Paste the post's link.");
    expect(isFacebookPostLink('')).toBe(false);
  });
});

describe('what the server refuses, the app refuses', () => {
  it.each([
    ['https://www.facebook.com:8443/groups/x/posts/1/', 'a port'],
    ['https://www.facebook.com:443/groups/x/posts/1/', 'even the https port'],
    ['https://u@www.facebook.com/groups/x/posts/1/', 'a user name'],
    ['https://u:p@www.facebook.com/groups/x/posts/1/', 'a user name and password'],
    ['https://www.facebook.com\\evil.example/posts/1', 'a backslash'],
    ['https://www.facebook.com./posts/1', 'a trailing dot'],
  ])('%s (%s)', (link) => {
    expect(isFacebookPostLink(link)).toBe(false);
    expect(postLinkProblem(link)).toBe("That isn't a Facebook link.");
  });
});

describe('a Facebook profile link', () => {
  it.each([
    ['https://www.facebook.com/cyrus.orbano', 'https://www.facebook.com/cyrus.orbano'],
    ['https://facebook.com/profile.php?id=100012345', 'https://facebook.com/profile.php?id=100012345'],
    ['https://m.facebook.com/cyrus', 'https://m.facebook.com/cyrus'],
    ['https://web.facebook.com/cyrus', 'https://web.facebook.com/cyrus'],
    ['https://fb.com/cyrus', 'https://fb.com/cyrus'],
    ['https://www.facebook.com/groups/x/posts/1/', 'https://www.facebook.com/groups/x/posts/1/'],
    ['www.facebook.com/cyrus', 'https://www.facebook.com/cyrus'],
    ['  facebook.com/cyrus  ', 'https://facebook.com/cyrus'],
    ['https://WWW.Facebook.com/Cyrus', 'https://WWW.Facebook.com/Cyrus'],
  ])('%j is one, saved as %j', (typed, saved) => {
    expect(facebookProfileProblem(typed)).toBeNull();
    expect(normalizeProfileLink(typed)).toBe(saved);
  });

  it.each([
    'http://www.facebook.com/cyrus',
    'https://fb.me/cyrus',
    'https://www.fb.com/cyrus',
    'https://l.facebook.com/x',
    'https://facebook.com.evil.example/x',
    'https://instagram.com/cyrus',
    'ftp://facebook.com/cyrus',
    'https://www.facebook.com/a b',
    'cyrus orbano',
  ])('%j is not', (url) => {
    expect(facebookProfileProblem(url)).toBe("That isn't a Facebook profile link.");
  });

  it('is optional: blank is fine', () => {
    expect(facebookProfileProblem('')).toBeNull();
    expect(facebookProfileProblem('   ')).toBeNull();
    expect(normalizeProfileLink('  ')).toBe('');
  });
});
