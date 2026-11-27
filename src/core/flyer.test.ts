import { describe, expect, it } from 'vitest';
import { callToAction, flyerContent, laterPages, OFFICE_DEALS, priceOf, rects, withCallToAction } from './flyer';

const POST = `COMMERCIAL-INDUSTRIAL WAREHOUSE FOR SALE / LEASE – LIIP, MAMPLASAN, BIÑAN, LAGUNA

Property Details:
• Lot Area: 2,277 sqm
• For Sale: ₱120,000,000 Gross
• For Lease: ₱250/sqm
• Commercial-industrial warehouse with office
• With 3-storey office building

Property Highlights:
• With strong water source
• NWRB permit
• Code: MYPFS365

Property’s availability is upon owner’s confirmation.

Contact Alpha Premier Realty for Inquiries & Viewing:
realty@alphapremiergroup.com
0927 555 5803 | 0915 888 9482 | 0921 217 4555`;

const LISTING = { category: 'WAREHOUSE', listingType: 'FOR LEASE/ FOR RENT' };

describe('the flyer reads the post', () => {
  it('takes the kind, the deal, the size, both prices, the place and the contacts', () => {
    const c = flyerContent(POST, LISTING);
    expect(c.kind).toBe('Warehouse');
    expect(c.deal).toBe('Sale or lease');
    expect(c.size).toBe('2,277');
    expect(c.sizeLabel).toBe('Lot area');
    expect(c.sale).toEqual({ amount: '₱120M', unit: 'to buy' });
    expect(c.lease).toEqual({ amount: '₱250', unit: 'per sqm' });
    expect(c.place).toBe('LIIP, Mamplasan, Biñan, Laguna');
    expect(c.shortPlace).toBe('Biñan, Laguna');
    expect(c.title).toBe('Commercial-industrial warehouse');
    expect(c.email).toBe('realty@alphapremiergroup.com');
    expect(c.numbers).toEqual(['0927 555 5803', '0915 888 9482', '0921 217 4555']);
  });

  it('puts the Highlights first, then the other details, and leaves out codes and contacts', () => {
    expect(flyerContent(POST, LISTING).highlights).toEqual([
      'With strong water source',
      'NWRB permit',
      'Commercial-industrial warehouse with office',
      'With 3-storey office building',
    ]);
  });

  it('falls back to the listing when the text says little', () => {
    const c = flyerContent('Office space in Makati', { category: 'OFFICE SPACE', listingType: 'FOR LEASE', city: 'Makati', size: '120' });
    expect(c.kind).toBe('Office space');
    expect(c.deal).toBe('For lease');
    expect(c.place).toBe('Makati');
    expect(c.size).toBe('120');
    expect(c.sale).toBeNull();
    expect(c.numbers).toEqual([]);
  });

  it('reads bullets with no heading as details', () => {
    const c = flyerContent('HOUSE FOR SALE – ANTIPOLO, RIZAL\n- Floor Area: 180 sqm\n- Price: Php 12.5M\n- 3 bedrooms', { category: 'HOUSE AND LOT', listingType: '' });
    expect(c.size).toBe('180');
    expect(c.sizeLabel).toBe('Floor area');
    expect(c.sale).toEqual({ amount: '₱12.5M', unit: 'to buy' });
    expect(c.highlights).toEqual(['3 bedrooms']);
    expect(c.deal).toBe('For sale');
  });

  it('shortens prices for a picture', () => {
    expect(priceOf('₱85,000 per month', 'lease')).toEqual({ amount: '₱85K', unit: 'a month' });
    expect(priceOf('PHP 1,500/sqm/month', 'lease')).toEqual({ amount: '₱1,500', unit: 'per sqm' });
    expect(priceOf('to be discussed', 'sale')).toBeNull();
  });
});

describe('pages', () => {
  it('spreads the photos after the flyer evenly over as few pages as hold them', () => {
    const picked = Array.from({ length: 11 }, (_, i) => i + 1);
    expect(laterPages(picked, 'framed', 4).map((p) => p.length)).toEqual([4, 4]);
    expect(laterPages(picked, 'big', 4).map((p) => p.length)).toEqual([4, 3, 3]);
    expect(laterPages([1, 2], 'framed', 4)).toEqual([]);
  });

  it('lays out one to six photos inside the box', () => {
    for (let n = 1; n <= 6; n++) {
      const r = rects(n, 10, 20, 400, 300, 8);
      expect(r).toHaveLength(n);
      for (const box of r) {
        expect(box.x).toBeGreaterThanOrEqual(10);
        expect(box.y).toBeGreaterThanOrEqual(20);
        expect(box.x + box.w).toBeLessThanOrEqual(410.0001);
        expect(box.y + box.h).toBeLessThanOrEqual(320.0001);
      }
    }
  });
});

describe('a plain post, no bullets', () => {
  it('still finds the price, the size in the heading, and the kind from the sub-category', () => {
    const c = flyerContent('FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4.2M\nContact: 0917 555 0142', {
      category: 'CONDO / HOUSE AND LOT',
      subCategory: 'Lot',
      listingType: 'FOR SALE',
    });
    expect(c.sale).toEqual({ amount: '₱4.2M', unit: 'to buy' });
    expect(c.size).toBe('320');
    expect(c.sizeLabel).toBe('Lot area');
    expect(c.kind).toBe('Lot');
    expect(c.title).toBe('320 sqm lot in Verdant Hills');
    expect(c.numbers).toEqual(['0917 555 0142']);
    expect(flyerContent('x', { category: 'CONDO / HOUSE AND LOT', listingType: '' }).kind).toBe('Condo / house and lot');
  });
});

describe('the poster and the call to action', () => {
  it('finds the Facebook page the post names, as a link or a line', () => {
    expect(flyerContent('OFFICE FOR LEASE\nVisit https://www.facebook.com/AlphaPremierRealty for more', LISTING).facebook).toBe('fb.com/AlphaPremierRealty');
    expect(flyerContent('OFFICE FOR LEASE\n• FB Page: Alpha Premier Realty', LISTING).facebook).toBe('Alpha Premier Realty');
    expect(flyerContent('OFFICE FOR LEASE\nfacebook.com/share/abc', LISTING).facebook).toBeNull();
    expect(flyerContent(POST, LISTING).facebook).toBeNull();
  });

  it('puts no photo pages after the poster: the photos go up as they are', () => {
    expect(laterPages(['a', 'b', 'c'], 'poster', 4)).toEqual([]);
  });

  it('asks for a viewing in words only, pointing at the numbers only when the post has some', () => {
    expect(callToAction(POST)).toContain('call the numbers above');
    expect(callToAction('OFFICE FOR LEASE')).toBe('Schedule a site viewing today: message us here.');
    expect(callToAction(POST)).not.toMatch(/\d/);
    const once = withCallToAction('OFFICE FOR LEASE\n');
    expect(once).toBe('OFFICE FOR LEASE\n\nSchedule a site viewing today: message us here.');
    expect(withCallToAction(once)).toBe(once);
    expect(withCallToAction('')).toBe('');
  });
});

describe('a virtual office post (D42)', () => {
  const VO_POST = `2026 NEW VIRTUAL OFFICE – MAKATI CITY
• Business address in Makati
• Mail and package handling
• Rate: ₱2,500/month
• Annual plan: ₱27,000 a year

Contact Alpha Premier Realty:
0927 555 5803`;
  const VO = { category: 'Virtual Office for posting', listingType: '', onRequest: true };

  it('is headed Virtual office, its first price the plan, and the deal said by that price', () => {
    const c = flyerContent(VO_POST, VO);
    expect(c.virtualOffice).toBe(true);
    expect(c.kind).toBe('Virtual office');
    expect(c.deal).toBe('Monthly plan');
    expect(c.lease).toEqual({ amount: '₱2,500', unit: 'a month' });
    expect(c.sale).toBeNull();
    // Another plan's price is kept, as a highlight, rather than lost.
    expect(c.highlights).toEqual(['Business address in Makati', 'Mail and package handling', 'Annual plan: ₱27,000 a year']);
    expect(c.numbers).toEqual(['0927 555 5803']);
  });

  it('reads a plain Price as the plan, never as a price to buy, and says a year when the post does', () => {
    const plain = flyerContent('VIRTUAL OFFICE\nPrice: ₱3,000', VO);
    expect(plain.sale).toBeNull();
    expect(plain.lease).toEqual({ amount: '₱3,000', unit: '' });
    expect(plain.deal).toBe('Now available');
    const yearly = flyerContent('VIRTUAL OFFICE\nRate: ₱27,000 a year', VO);
    expect(yearly.lease).toEqual({ amount: '₱27K', unit: 'a year' });
    expect(yearly.deal).toBe('Yearly plan');
    expect(OFFICE_DEALS).toEqual(['Now available', 'Monthly plan', 'Yearly plan']);
  });

  it('asks them to set one up, not to view a site, still in words only', () => {
    const line = 'Set up your virtual office today: message us here, or call the numbers above.';
    expect(callToAction(VO_POST, true)).toBe(line);
    expect(callToAction('VIRTUAL OFFICE', true)).toBe('Set up your virtual office today: message us here.');
    expect(withCallToAction(VO_POST, true)).toBe(`${VO_POST}\n\n${line}`);
  });

  it('leaves a listing as it was', () => {
    const c = flyerContent(POST, LISTING);
    expect(c.virtualOffice).toBe(false);
    expect(c.kind).toBe('Warehouse');
    expect(flyerContent(POST, { ...LISTING, onRequest: false }).deal).toBe('Sale or lease');
    expect(callToAction(POST)).toBe('Schedule a site viewing today: message us here, or call the numbers above.');
  });
});
