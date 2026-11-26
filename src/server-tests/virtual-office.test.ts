/**
 * The virtual office (v20, D35): the "Virtual Office for posting" folder's
 * ready-made posts, one per folder inside it, offered in the list beside the
 * listings, marked onRequest, and opened like a listing, read from Drive now.
 * The folder is only ever read.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from './world';

const VO = 'vo-root';

/** The folder as Drive has it: two posts, one with a Google Doc and photos in a folder inside, one with a Word file. */
function withVirtualOffice() {
  const w = createWorld();
  w.project.configure({ VIRTUAL_OFFICE_FOLDER_ID: VO });
  w.project.drive
    .addDocText('vo1-doc', 'VIRTUAL OFFICE IN MAKATI\nP2,500 a month\n---\nOwner: Lim, 0918 555 0135')
    .addFile('vo1-b', { name: 'b 10.jpg', mimeType: 'image/jpeg' })
    .addFile('vo1-a', { name: 'a 2.jpg', mimeType: 'image/png' })
    .addFile('vo1-clip', { name: 'tour.mov', mimeType: 'video/quicktime' })
    .addFolder('vo1-pics', 'Pics', { files: ['vo1-b', 'vo1-a'] })
    .addFolder('vo1', '2026 NEW VIRTUAL OFFICE', { files: ['vo1-doc', 'vo1-clip'], folders: ['vo1-pics'] })
    .addFile('vo2-doc', { name: 'post.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    .addFolder('vo2', '2026 V2.0 NEW VIRTUAL OFFICE', { files: ['vo2-doc'] })
    .addFolder(VO, 'Virtual Office for posting', { folders: ['vo2', 'vo1'] });
  return w;
}

describe('the virtual office', () => {
  it('adds its posts to the list, after the listings, marked onRequest', () => {
    const w = withVirtualOffice();
    const list = w.call('jan', 'properties')['properties'] as Record<string, unknown>[];
    const vo = list.filter((p) => p['onRequest'] === true);
    expect(vo).toEqual([
      expect.objectContaining({ id: 'vo1', name: '2026 NEW VIRTUAL OFFICE', category: 'Virtual Office for posting', photoCount: 2, hasIssues: false }),
      expect.objectContaining({ id: 'vo2', name: '2026 V2.0 NEW VIRTUAL OFFICE', photoCount: 0, hasIssues: true, issues: 'Word file — save it as a Google Doc · No photos' }),
    ]);
    expect(list.slice(-2)).toEqual(vo);
  });

  it('opens a post like a listing, its text whole (it is all for posting) and its photos in name order', () => {
    const w = withVirtualOffice();
    const p = w.call('jan', 'property', { id: 'vo1' })['property'] as Record<string, unknown>;
    expect(p).toMatchObject({
      id: 'vo1',
      category: 'Virtual Office for posting',
      // No separator is looked for and no line flagged, even ones that look like a separator.
      publicText: 'VIRTUAL OFFICE IN MAKATI\nP2,500 a month\n---\nOwner: Lim, 0918 555 0135',
      hasInternal: true,
      withheld: false,
      cutAt: '',
      live: true,
      onRequest: true,
    });
    expect(p).not.toHaveProperty('internalText');
    expect(p).not.toHaveProperty('flaggedLines');
    expect(p).not.toHaveProperty('unseparated');
    expect((p['photos'] as { id: string }[]).map((x) => x.id)).toEqual(['vo1-a', 'vo1-b']);
    expect((p['photos'] as { url: string }[])[0]?.url).toBe('https://drive.google.com/uc?export=download&id=vo1-a');
  });

  it("withholds a Word file's text from an agent, and never converts it", () => {
    const w = withVirtualOffice();
    const p = w.call('jan', 'property', { id: 'vo2' })['property'] as Record<string, unknown>;
    expect(p).toMatchObject({ publicText: '', withheld: true, live: false });
  });

  it('is left out when the folder is turned off or cannot be opened', () => {
    const w = withVirtualOffice();
    w.project.configure({ VIRTUAL_OFFICE_FOLDER_ID: 'gone' });
    const list = w.call('jan', 'properties')['properties'] as Record<string, unknown>[];
    expect(list.some((p) => p['onRequest'])).toBe(false);
    expect(w.call('jan', 'property', { id: 'nothing' })).toMatchObject({ ok: false });
  });
});
