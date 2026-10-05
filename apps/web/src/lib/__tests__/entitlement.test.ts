import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueEntitlement, OFFLINE_GRACE_DAYS, privateKeyFrom, publicKeyPem, readEntitlement } from '../entitlement';

const { privateKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const input = { serial: 'VCGS-AAAAA-BBBBB-CCCCC-DDDDD', plan: 'studio' as const, fingerprint: 'f'.repeat(64), email: 'a@b.c', paidThrough: null };

describe('entitlements', () => {
  it('signs a statement the public key reads back, good for the offline grace', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const { token, entitlement } = issueEntitlement(input, privateKey, now);
    expect(token.startsWith('vcgs1.')).toBe(true);
    expect(readEntitlement(token, publicKeyPem(privateKey))).toEqual(entitlement);
    expect(new Date(entitlement.validUntil).getTime() - now.getTime()).toBe(OFFLINE_GRACE_DAYS * 86_400_000);
  });

  it('refuses a token edited to last longer', () => {
    const { token, entitlement } = issueEntitlement(input, privateKey);
    const [prefix, payload, signature] = token.split('.');
    const edited = Buffer.from(Buffer.from(payload ?? '', 'base64url').toString().replace(entitlement.validUntil, '2099-01-01T00:00:00.000Z')).toString('base64url');
    expect(readEntitlement(`${prefix}.${edited}.${signature}`, publicKeyPem(privateKey))).toBeNull();
  });

  it('refuses a token signed by another key', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    const { token } = issueEntitlement(input, other);
    expect(readEntitlement(token, publicKeyPem(privateKey))).toBeNull();
  });

  it('takes the key as PEM, PEM with escaped newlines, or base64 of the PEM', () => {
    const pub = publicKeyPem(privateKey);
    for (const form of [pem, pem.replace(/\n/g, '\\n'), Buffer.from(pem).toString('base64')]) {
      expect(publicKeyPem(privateKeyFrom(form))).toBe(pub);
    }
  });
});
