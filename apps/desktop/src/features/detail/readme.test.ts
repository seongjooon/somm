import { expect, test } from 'vitest';
import { firstParagraph } from './readme';

test.each([
  ['# Title\n\nFirst paragraph.\n\nSecond.', 'First paragraph.'],
  ['# Title\nFirst paragraph.\n\nSecond.', 'First paragraph.'],
  ['# Title', ''],
  ['', ''],
  ['# Title\r\nFirst line\r\nsecond line\r\n\r\nOther', 'First line\nsecond line'],
])('extracts first body paragraph from %j', (input, expected) => expect(firstParagraph(input)).toBe(expected));
