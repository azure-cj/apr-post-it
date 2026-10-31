import { dailyTotals, postsForProperty, searchPosts } from './records';
import type { PostLogEntry } from './types';

function post(over: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    date: '2026-10-30',
    time: '09:00',
    type: 'Group post',
    title: 'Sunrise Homes Blk 3 Lot 9',
    status: 'Posted',
    fbAccount: 'APG Homes',
    postLink: 'https://fb.com/1',
    postedBy: 'Jan',
    propertyId: 'F1',
    ...over,
  };
}

describe('daily totals', () => {
  it('counts every day in the range, zeros included, by status and by intern', () => {
    const posts = [
      post({ date: '2026-10-29', postedBy: 'Jan' }),
      post({ date: '2026-10-29', postedBy: ' Bea ', status: 'Pending' }),
      post({ date: '2026-10-31', postedBy: 'Jan' }),
      post({ date: '2026-10-31', postedBy: 'Jan', status: 'Pending' }),
      post({ date: '2026-10-31', postedBy: '' }),
      post({ date: '2026-11-01' }), // outside
      post({ date: '' }),
    ];
    expect(dailyTotals(posts, '2026-10-29', '2026-10-31')).toEqual([
      { date: '2026-10-29', posted: 1, pending: 1, byIntern: { Jan: 1, Bea: 1 } },
      { date: '2026-10-30', posted: 0, pending: 0, byIntern: {} },
      { date: '2026-10-31', posted: 2, pending: 1, byIntern: { Jan: 2, '': 1 } },
    ]);
  });

  it('crosses a month end, and is empty for a backwards or unreadable range', () => {
    expect(dailyTotals([], '2026-02-27', '2026-03-01').map((d) => d.date)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(dailyTotals([], '2026-03-02', '2026-03-01')).toEqual([]);
    expect(dailyTotals([], '2026-02-30', '2026-03-01')).toEqual([]);
  });

  it('treats a name such as __proto__ as a name', () => {
    const [day] = dailyTotals([post({ postedBy: '__proto__' })], '2026-10-30', '2026-10-30');
    expect(day!.byIntern['__proto__']).toBe(1);
  });
});

describe("a listing's posts", () => {
  const posts = [
    post({ date: '2026-10-01', propertyId: 'F1', title: 'Old name' }),
    post({ date: '2026-10-20', propertyId: '', title: 'Sunrise Homes Block 3, Lot 9' }),
    post({ date: '2026-10-20', time: '15:00', propertyId: 'F1' }),
    post({ date: '2026-10-25', propertyId: 'F2', title: 'Sunrise Homes Blk 3 Lot 9' }), // another folder of that name
    post({ date: '2026-10-26', propertyId: '', title: 'Something else' }),
  ];

  it('matches by id first, by name when a row has no id, newest first', () => {
    const found = postsForProperty(posts, { id: 'F1', name: 'Sunrise Homes Blk. 3 Lt 9' });
    expect(found.map((p) => `${p.date} ${p.time} ${p.title}`)).toEqual([
      '2026-10-20 15:00 Sunrise Homes Blk 3 Lot 9',
      '2026-10-20 09:00 Sunrise Homes Block 3, Lot 9',
      '2026-10-01 09:00 Old name',
    ]);
  });

  it('matches by name alone without an id, and finds nothing for nothing', () => {
    expect(postsForProperty(posts, { name: 'sunrise homes block 3 lot 9' })).toHaveLength(3);
    expect(postsForProperty(posts, {})).toEqual([]);
  });
});

describe('searching posts', () => {
  const posts = [
    post({ date: '2026-10-01', title: 'Casa Amara', postedBy: 'Jan' }),
    post({ date: '2026-10-15', title: 'Verdant Hills Lot 12', postedBy: 'Bea', status: 'Pending', fbAccount: 'APG Rentals' }),
    post({ date: '2026-10-20', title: 'Casa Amara Annex', postedBy: 'Bea' }),
    post({ date: 'soon', title: 'Casa Undated', postedBy: 'Jan' }),
  ];
  const titles = (list: readonly PostLogEntry[]) => list.map((p) => p.title);

  it('matches every word, ignoring case and punctuation, newest first', () => {
    expect(titles(searchPosts(posts, { query: 'casa' }))).toEqual(['Casa Undated', 'Casa Amara Annex', 'Casa Amara']);
    expect(titles(searchPosts(posts, { query: 'AMARA, casa' }))).toEqual(['Casa Amara Annex', 'Casa Amara']);
    expect(titles(searchPosts(posts, { query: 'rentals' }))).toEqual(['Verdant Hills Lot 12']);
  });

  it('narrows by dates, intern and status', () => {
    expect(titles(searchPosts(posts, { from: '2026-10-10', to: '2026-10-20' }))).toEqual(['Casa Amara Annex', 'Verdant Hills Lot 12']);
    expect(titles(searchPosts(posts, { intern: ' bea ' }))).toEqual(['Casa Amara Annex', 'Verdant Hills Lot 12']);
    expect(titles(searchPosts(posts, { status: 'Pending' }))).toEqual(['Verdant Hills Lot 12']);
    expect(titles(searchPosts(posts, { query: 'casa', intern: 'Jan', to: '2026-12-31' }))).toEqual(['Casa Amara']);
  });

  it('returns everything for an empty search', () => {
    expect(searchPosts(posts, {})).toHaveLength(4);
  });
});
