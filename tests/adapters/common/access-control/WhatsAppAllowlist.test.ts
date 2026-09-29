import { describe, it, expect } from 'vitest';
import { WhatsAppAllowlist } from '../../../../src/adapters/common/access-control/WhatsAppAllowlist';

describe('WhatsAppAllowlist', () => {
  it('allows access for an authorized user', () => {
    const allowlist = new WhatsAppAllowlist(['919876543210']);
    expect(allowlist.isAllowed('919876543210@s.whatsapp.net')).toBe(true);
  });

  it('denies access for an unauthorized user', () => {
    const allowlist = new WhatsAppAllowlist(['919876543210']);
    expect(allowlist.isAllowed('919876543211@s.whatsapp.net')).toBe(false);
  });

  it('supports multiple authorized users in the allowlist', () => {
    const allowlist = new WhatsAppAllowlist(['919876543210', '919876543211@s.whatsapp.net']);
    expect(allowlist.isAllowed('919876543210')).toBe(true);
    expect(allowlist.isAllowed('919876543211')).toBe(true);
    expect(allowlist.isAllowed('919876500000')).toBe(false);
  });

  it('denies access when initialized with an empty allowlist', () => {
    const allowlist = new WhatsAppAllowlist([]);
    expect(allowlist.isAllowed('919876543210')).toBe(false);
  });

  it('denies access when input fails JID normalization', () => {
    const allowlist = new WhatsAppAllowlist(['919876543210']);
    expect(allowlist.isAllowed('invalid-jid')).toBe(false);
  });

  it('filters out unnormalizable entries during initialization', () => {
    const allowlist = new WhatsAppAllowlist(['', 'status@broadcast', 'invalid-entry', '919876543210']);
    expect(allowlist.isAllowed('919876543210')).toBe(true);
    expect(allowlist.isAllowed('status@broadcast')).toBe(false);
  });
});
