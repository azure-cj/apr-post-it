import { facebookProfileProblem, isFacebookPostLink, normalizeProfileLink, postLinkProblem } from './links';

describe('a post link', () => {
  it.each([
    'https://www.facebook.com/groups/x/posts/1/',
    'https://facebook.com/share/p/abc',
    'https://m.facebook.com/story.php?id=1',
    'https://web.facebook.com/groups/x/permalink/2',
    'https://fb.com/1',
    'https://fb.me/abc',
    '  https://WWW.Facebook.com/x  ',
  ])('%s is a Facebook link', (url) => {
    expect(isFacebookPostLink(url)).toBe(true);
    expect(postLinkProblem(url)).toBeNull();
  });

  it.each([
    'http://www.facebook.com/groups/x/posts/1/',
    'https://facebook.com.evil.example/x',
    'https://evilfacebook.com/x',
    'https://l.facebook.com/x',
    'https://www.fb.com/x',
    'https://instagram.com/p/1',
    'facebook.com/groups/x',
    'https://www.facebook.com/a b',
    'not a link',
  ])('%s is not', (url) => {
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
