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

describe('the checks on a reword', () => {
  it('refuses commission wording Claude added', () => {
    const reword = `${ORIGINAL}\nCommission ready`;
    expect(rewordProblem(ORIGINAL, reword, checksOf(reword))).toBe('No commission wording: Found "Commission" — remove it before posting.');
  });
});
