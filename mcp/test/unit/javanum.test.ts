import { describe, expect, it } from 'vitest';
import { javaFloatToString } from '../../src/ddf/javanum.js';

describe('javaFloatToString (float)', () => {
  it.each([
    [0, '0.0'],
    [1, '1.0'],
    [-1000, '-1000.0'],
    [320, '320.0'],
    [0.5, '0.5'],
    [0.1, '0.1'],
    [-0.5, '-0.5'],
    [0.7854, '0.7854'],
    [0.5647059, '0.5647059'],
    [8.7722944e-4, '8.7722944E-4'],
    [0.0017476063, '0.0017476063'],
    [0.99999464, '0.99999464'],
    [1e7, '1.0E7'],
    [1234567, '1234567.0'],
    [0.001, '0.001'],
    [0.0001, '1.0E-4'],
    [22.5, '22.5'],
    [0.609204, '0.609204'],
  ])('%s → %s', (input, expected) => {
    expect(javaFloatToString(input)).toBe(expected);
  });
});

describe('javaFloatToString (double)', () => {
  it('formats doubles with shortest round-trip digits', () => {
    expect(javaFloatToString(0.1, false)).toBe('0.1');
    expect(javaFloatToString(1.2, false)).toBe('1.2');
    expect(javaFloatToString(1e-5, false)).toBe('1.0E-5');
    expect(javaFloatToString(12345678, false)).toBe('1.2345678E7');
  });
});
