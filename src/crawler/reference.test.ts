import { describe, expect, test } from 'bun:test';
import { parseReferenceMonth } from './reference.js';

describe('parseReferenceMonth', () => {
  test('parses FIPE reference month labels', () => {
    expect(parseReferenceMonth('dezembro/2025 ')).toEqual({ month: 12, year: 2025 });
    expect(parseReferenceMonth('Março/2024')).toEqual({ month: 3, year: 2024 });
  });
});
