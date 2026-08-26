import { describe, expect, it } from 'vitest';

import type { OrganizationSummary } from '../shared/contracts';

import {
  navigationTitle,
  organizationSettingsAvailable,
} from './app-navigation';

const organization = (role: 'organizer' | 'member'): OrganizationSummary => ({
  capacity: {
    assignedSeats: 2,
    maxSeats: 10,
    remainingSeats: 8,
    state: 'available',
  },
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Greenfield School',
  plan: 'pro',
  role,
});

describe('organization settings navigation', () => {
  it('is available to every organization member but not an unlinked account', () => {
    expect(organizationSettingsAvailable(null)).toBe(false);
    expect(organizationSettingsAvailable(organization('organizer'))).toBe(true);
    expect(organizationSettingsAvailable(organization('member'))).toBe(true);
  });

  it('presents Organization as account settings in both app languages', () => {
    expect(navigationTitle('organization', 'en')).toEqual({
      kicker: 'Account settings',
      title: 'Organization',
    });
    expect(navigationTitle('organization', 'vi').title).toBe('Tổ chức');
  });
});
