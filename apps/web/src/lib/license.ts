import { randomBytes } from 'node:crypto';

/**
 * License serials, VC Writer's format with this product's prefix:
 * `VCGS-XXXXX-XXXXX-XXXXX-XXXXX` from an alphabet without I, O, 0 or 1, so one
 * can be read over the phone. A serial names a license row; it is not a secret
 * and grants nothing by itself — activation always checks the account.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LENGTH = 5;

export const generateSerial = (): string => {
  const bytes = randomBytes(GROUPS * GROUP_LENGTH);
  const characters = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    groups.push(characters.slice(group * GROUP_LENGTH, (group + 1) * GROUP_LENGTH).join(''));
  }
  return `VCGS-${groups.join('-')}`;
};

const SERIAL_PATTERN = /^VCGS(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}){4}$/;

export const normalizeSerial = (serial: string): string => serial.trim().toUpperCase();

export const isWellFormedSerial = (serial: string): boolean => SERIAL_PATTERN.test(normalizeSerial(serial));
