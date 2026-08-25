import { describe, expect, it } from 'vitest';

import {
  isPublicClassroomHostname,
  validateClassroomUrl,
} from '../../shared/classroom-url-policy';

describe('classroom URL policy', () => {
  it('accepts public HTTPS links only when the published origin matches', () => {
    expect(
      validateClassroomUrl(
        'https://learn.example.com/loops?part=2',
        'https://learn.example.com',
      )?.toString(),
    ).toBe('https://learn.example.com/loops?part=2');
    expect(
      validateClassroomUrl(
        'https://other.example.com/loops',
        'https://learn.example.com',
      ),
    ).toBeNull();
  });

  it('fails closed for credentials, non-HTTPS, and local network targets', () => {
    for (const value of [
      'http://learn.example.com/loops',
      'https://user:secret@learn.example.com/loops',
      'https://localhost/loops',
      'https://127.0.0.1/loops',
      'https://10.2.3.4/loops',
      'https://192.168.1.10/loops',
      'https://224.0.0.1/loops',
      'https://[fc00::1]/loops',
      'https://[fe90::1]/loops',
      'https://[ff02::1]/loops',
      'https://host.docker.internal/loops',
      'https://printer.local/loops',
    ]) {
      expect(validateClassroomUrl(value)).toBeNull();
    }
    expect(isPublicClassroomHostname('learn.example.com')).toBe(true);
  });
});
