import { describe, expect, it } from 'vitest';
import { generateSerial, isWellFormedSerial, normalizeSerial } from '../license';

describe('serials', () => {
  it('reads aloud: VCGS and four groups, no I, O, 0 or 1', () => {
    for (let i = 0; i < 50; i += 1) {
      const serial = generateSerial();
      expect(serial).toMatch(/^VCGS(-[A-HJ-NP-Z2-9]{5}){4}$/);
      expect(isWellFormedSerial(serial)).toBe(true);
    }
  });

  it('accepts one typed in lower case with spaces around it', () => {
    const serial = generateSerial();
    expect(isWellFormedSerial(`  ${serial.toLowerCase()} `)).toBe(true);
    expect(normalizeSerial(` ${serial.toLowerCase()}`)).toBe(serial);
    expect(isWellFormedSerial('VCW-AAAAA-AAAAA-AAAAA-AAAAA')).toBe(false);
  });
});
