import { describe, expect, it } from 'vitest';
import { runChecks } from './checks';
import { numberChanges, rewordProblem } from './reword';

const ORIGINAL = 'FOR SALE: 320 sqm lot in Verdant Hills\nPrice: ₱4,200,000\nContact: 0917 555 0142';
const checksOf = (text: string) => runChecks({ publicText: text, hasInternal: true });

describe('the numbers in a reword', () => {
  it('passes a reword that keeps every number, however it is spaced', () => {
    const reword = 'Lot for sale in Verdant Hills, 320 sqm.\nAsking ₱4200000.\nCall 0917 555 0142.';
    expect(numberChanges(ORIGINAL, reword)).toEqual({ added: [], missing: [] });
    expect(rewordProblem(ORIGINAL, reword, checksOf(reword))).toBeNull();
  });

  it('refuses a changed price', () => {
    const reword = 'Lot for sale in Verdant Hills, 320 sqm.\nAsking ₱4,100,000.\nCall 0917 555 0142.';
    expect(numberChanges(ORIGINAL, reword)).toEqual({ added: ['4,100,000'], missing: ['4,200,000'] });
    expect(rewordProblem(ORIGINAL, reword, checksOf(reword))).toBe('It changes the numbers: it adds “4,100,000” and leaves out “4,200,000”.');
  });

  it('refuses a number that was dropped', () => {
    const reword = 'Lot for sale in Verdant Hills.\nAsking ₱4,200,000.\nCall 0917 555 0142.';
    expect(rewordProblem(ORIGINAL, reword, checksOf(reword))).toBe('It changes the numbers: it leaves out “320”.');
  });

  it('reads styled digits as digits', () => {
    expect(numberChanges('Price: 4.2M', 'Price: 𝟰.𝟮M')).toEqual({ added: [], missing: [] });
  });
});

describe('the new numbers a caption may add', () => {
  const AGENCY = 'Alpha Premier Realty\n📞 0927 555 5803 | 0915 888 9482 | 0921 217 4555';

  it("passes the agency's numbers, however they are written", () => {
    const reword = `${ORIGINAL}\n${AGENCY}`;
    expect(numberChanges(ORIGINAL, reword)).toEqual({ added: [], missing: [] });
    expect(numberChanges(ORIGINAL, `${ORIGINAL}\n+63 927-555-5803, 09158889482`)).toEqual({ added: [], missing: [] });
  });

  it("refuses an agency number that's wrong, or one the original had and the reword dropped", () => {
    expect(numberChanges(ORIGINAL, `${ORIGINAL}\n0927 555 5804`).added).toEqual(['0927', '5804']);
    expect(numberChanges(`${ORIGINAL}\n0927 555 5803`, ORIGINAL)).toEqual({ added: [], missing: ['0927 555 5803'] });
  });

  it('passes a per-sqm rate worked out from the price and the area', () => {
    expect(numberChanges(ORIGINAL, `${ORIGINAL}\nJust ₱13,125/sqm`)).toEqual({ added: [], missing: [] });
    expect(numberChanges('Lot, 320 sqm. ₱4.2M', 'Lot, 320 sqm. ₱4.2M (about ₱13,125 per sqm)')).toEqual({ added: [], missing: [] });
    const lease = 'Office for lease, 240 sqm\nRent: ₱180,000 / month\nCall 0917 555 0142';
    expect(numberChanges(lease, `${lease}\n₱750/sqm`)).toEqual({ added: [], missing: [] });
  });

  it('passes a monthly total worked out from a rate and the area, rounded', () => {
    const lease = 'Warehouse, 1,250 sqm\n₱285/sqm per month\nCall 0917 555 0142';
    expect(numberChanges(lease, `${lease}\nAbout ₱356,250 a month`)).toEqual({ added: [], missing: [] });
    expect(numberChanges(lease, `${lease}\nAbout ₱356K a month`)).toEqual({ added: [], missing: [] });
  });

  it('refuses a rate that was worked out wrong', () => {
    expect(numberChanges(ORIGINAL, `${ORIGINAL}\nJust ₱14,125/sqm`)).toEqual({ added: ['14,125'], missing: [] });
  });
});

describe('the checks on a reword', () => {
  it('refuses commission wording Claude added', () => {
    const reword = `${ORIGINAL}\nCommission ready`;
    expect(rewordProblem(ORIGINAL, reword, checksOf(reword))).toBe('No commission wording: Found "Commission" — remove it before posting.');
  });
});
