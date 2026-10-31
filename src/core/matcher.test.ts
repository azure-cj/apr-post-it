import { describe, expect, it } from 'vitest';
import { matchName, normalize } from './matcher';

const VERDANT = ['Verdant Hills Lot 12', 'Verdant Hills Lot 3', 'Verdant Hills Lot 7'];

describe('normalize — ported from PropertyNameMatcherTests', () => {
  it('ignores case, punctuation, accents and abbreviations', () => {
    expect(normalize('Sunrise Homes Blk. 3, Lt 9')).toBe('sunrise homes block 3 lot 9');
    expect(normalize('Casa Amara House & Lot')).toBe('casa amara house and lot');
    expect(normalize('casa amara house&lot')).toBe('casa amara house and lot');
    expect(normalize('  Sta. Rosa   Lot #22 ')).toBe('sta rosa lot 22');
    expect(normalize('Imus Townhomes Ph-2')).toBe('imus townhomes phase 2');
    expect(normalize('Mabini Bldg (Annex)')).toBe('mabini building annex');
    expect(normalize('Dasmariñas Agent’s Lot')).toBe('dasmarinas agents lot');
    expect(normalize('  ')).toBe('');
  });
});

describe('normalize — beyond the C# tests', () => {
  it('reads an accent the same whether it arrives composed or as a combining mark', () => {
    expect(normalize('Dasmarin\u{303}as')).toBe(normalize('Dasmariñas'));
  });

  it('treats non-breaking and ideographic spaces as spaces', () => {
    expect(normalize('Verdant\u{A0}Hills Lot\u{3000}12')).toBe('verdant hills lot 12');
  });

  it('spells out abbreviations only when they are whole words', () => {
    expect(normalize('PH2 Lots Blk')).toBe('ph2 lots block');
    expect(normalize('Lt. 4, Blk. 2')).toBe('lot 4 block 2');
  });

  it('does not mistake the word "constructor" for an abbreviation', () => {
    expect(normalize('Constructor Lot 5')).toBe('constructor lot 5');
  });

  it('drops "fancy" letters outside the BMP, as .NET did: it never took them for letters', () => {
    expect(normalize('𝗩𝗲𝗿𝗱𝗮𝗻𝘁 Hills Lot 12')).toBe('hills lot 12');
  });

  // Deliberately not as .NET: its ToLowerInvariant left İ alone and removing the dot
  // then left a capital I, so "İmus" could never equal "Imus".
  it('lowers the Turkish dotted İ to i', () => {
    expect(normalize('İmus Townhomes Phase 2')).toBe('imus townhomes phase 2');
  });
});

describe('matchName — ported from PropertyNameMatcherTests', () => {
  it('matches exactly after normalising', () => {
    expect(matchName('verdant hills lot 12', VERDANT)).toEqual({ kind: 'exact', name: 'Verdant Hills Lot 12' });
    expect(matchName('Sunrise Homes Blk 3 Lt 9', ['Sunrise Homes Block 3 Lot 9'])).toEqual({
      kind: 'exact',
      name: 'Sunrise Homes Block 3 Lot 9',
    });
  });

  it('suggests the name a typo meant, when the number is the same', () => {
    expect(matchName('Verdant Hils Lot 3', VERDANT)).toEqual({ kind: 'suggestion', name: 'Verdant Hills Lot 3' });
    expect(matchName('Verdnt Hills Lot 12', VERDANT)).toEqual({ kind: 'suggestion', name: 'Verdant Hills Lot 12' });
  });

  it('never suggests a different number', () => {
    expect(matchName('Verdant Hills Lot 13', VERDANT)).toEqual({ kind: 'notFound' });
    expect(matchName('Verdant Hills', VERDANT)).toEqual({ kind: 'notFound' });
  });

  it('suggests a name holding every typed word, and gives a tie to the first name', () => {
    expect(matchName('Casa Amara', ['Seaside Residences 2BR', 'Casa Amara House & Lot'])).toEqual({
      kind: 'suggestion',
      name: 'Casa Amara House & Lot',
    });
    expect(matchName('Casa Amara', ['Casa Amara North', 'Casa Amara South'])).toEqual({
      kind: 'suggestion',
      name: 'Casa Amara North',
    });
  });

  it('finds nothing for unrelated or blank text, or an empty list', () => {
    expect(matchName('Something Else Entirely', VERDANT).kind).toBe('notFound');
    expect(matchName('  ', VERDANT).kind).toBe('notFound');
    expect(matchName('Verdant Hills Lot 12', []).kind).toBe('notFound');
  });
});

describe('matchName — beyond the C# tests', () => {
  it('takes an exact match over a closer-looking name listed before it', () => {
    expect(matchName('verdant hills lot 7', ['Verdant Hill Lot 7', 'Verdant Hills Lot 7'])).toEqual({
      kind: 'exact',
      name: 'Verdant Hills Lot 7',
    });
  });

  it('reads a leading zero as the same number', () => {
    expect(matchName('Verdant Hills Lot 07', VERDANT)).toEqual({ kind: 'suggestion', name: 'Verdant Hills Lot 7' });
  });

  it('needs the numbers in the same order', () => {
    expect(matchName('Prime Tower 2 Unit 11', ['Prime Tower 11 Unit 2'])).toEqual({ kind: 'notFound' });
  });

  it('tells Lot 2 from Lot 22', () => {
    const names = ['Sta. Rosa Lot 22', 'Sta. Rosa Lot 2'];

    expect(matchName('Sta Rosa Lot 22', names)).toEqual({ kind: 'exact', name: 'Sta. Rosa Lot 22' });
    expect(matchName('Sta Rosa Lot 2', names)).toEqual({ kind: 'exact', name: 'Sta. Rosa Lot 2' });
    expect(matchName('Sta Rosa Lot 2 ', ['Sta. Rosa Lot 22'])).toEqual({ kind: 'notFound' });
  });

  it('suggests a name typed with its words in another order', () => {
    expect(matchName('Lot 22 Sta Rosa', ['Sta. Rosa Lot 22'])).toEqual({ kind: 'suggestion', name: 'Sta. Rosa Lot 22' });
  });

  it('suggests a name half typed in "fancy" letters from the plain words left over', () => {
    expect(matchName('𝗩𝗲𝗿𝗱𝗮𝗻𝘁 Hills Lot 12', VERDANT)).toEqual({ kind: 'suggestion', name: 'Verdant Hills Lot 12' });
  });

  it('matches the Turkish dotted İ exactly, where .NET could only suggest', () => {
    expect(matchName('İmus Townhomes Phase 2', ['Imus Townhomes Phase 2'])).toEqual({
      kind: 'exact',
      name: 'Imus Townhomes Phase 2',
    });
  });
});
