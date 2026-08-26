import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationSummary } from '../shared/contracts';

import { OrganizationPage } from './OrganizationPage';

const BANNER_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function organization(
  overrides: Partial<OrganizationSummary> = {},
): OrganizationSummary {
  return {
    capacity: {
      assignedSeats: 1,
      maxSeats: 10,
      remainingSeats: 9,
      state: 'available',
    },
    homeBanner: null,
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Math Teachers',
    plan: 'pro',
    role: 'organizer',
    ...overrides,
  };
}

function renderPage(
  input: {
    appLanguage?: 'en' | 'vi';
    error?: string | null;
    isLoading?: boolean;
    organization?: OrganizationSummary | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <OrganizationPage
      appLanguage={input.appLanguage ?? 'en'}
      error={input.error ?? null}
      isLoading={input.isLoading ?? false}
      onOpenClasses={vi.fn()}
      onOrganizationChange={vi.fn()}
      onRefresh={vi.fn(async () => undefined)}
      organization={
        'organization' in input ? (input.organization ?? null) : organization()
      }
    />,
  );
}

describe('OrganizationPage', () => {
  it('shows assigned, maximum, and remaining capacity with progress semantics', () => {
    const markup = renderPage();

    expect(markup).toContain('1 of 10 seats assigned');
    expect(markup).toContain('9 remaining');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuemax="10"');
    expect(markup).toContain('aria-valuenow="1"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('id="organization-name"');
    expect(markup).toContain('Save name');
    expect(markup).toContain('Organization home banner');
    expect(markup).toContain('Choose an image');
    expect(markup).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(markup).toContain('Default Tro banner');
    expect(markup).toContain('Invite a student or staff member');
    expect(markup).toContain('does not send an invitation email');
    expect(markup).toContain('does not need your organization code');
    expect(markup).toContain('Open Class workspaces');
  });

  it('keeps a full-capacity alert visible and disables seat reservation', () => {
    const markup = renderPage({
      organization: organization({
        capacity: {
          assignedSeats: 10,
          maxSeats: 10,
          remainingSeats: 0,
          state: 'full',
        },
      }),
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('All seats are assigned');
    expect(markup).toMatch(
      /<input(?=[^>]*id="organization-member-email")(?=[^>]*disabled)[^>]*>/u,
    );
    expect(markup).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*disabled)[^>]*>/u,
    );
  });

  it('previews the organization image and keeps reset available', () => {
    const markup = renderPage({
      organization: organization({
        homeBanner: { imageDataUrl: BANNER_DATA_URL },
      }),
    });

    expect(markup).toContain('Organization home banner preview');
    expect(markup).toContain(BANNER_DATA_URL);
    expect(markup).toContain('Choose another image');
    expect(markup).toContain('Use default Tro banner');
  });

  it('renders Vietnamese labels and a persistent server error', () => {
    const markup = renderPage({
      appLanguage: 'vi',
      error: 'Không thể kết nối dịch vụ.',
    });

    expect(markup).toContain('Cài đặt tổ chức');
    expect(markup).toContain('Mời học sinh hoặc nhân viên');
    expect(markup).toContain('Email tài khoản Google');
    expect(markup).toContain('Giữ chỗ');
    expect(markup).toContain('Không thể kết nối dịch vụ.');
    expect(markup).toContain('role="alert"');
  });

  it('renders loading and no-organization states without organizer authority', () => {
    expect(
      renderPage({ isLoading: true, organization: null }),
    ).toContain('Loading organization…');
    expect(renderPage({ organization: null })).toContain(
      'No organization to manage',
    );
  });

  it('shows members a bounded summary without organizer controls or identities', () => {
    const markup = renderPage({
      organization: organization({ role: 'member' }),
    });

    expect(markup).toContain('Member');
    expect(markup).toContain('Your access is managed by this organization');
    expect(markup).toContain('1 of 10 seats assigned');
    expect(markup).not.toContain('id="organization-name"');
    expect(markup).not.toContain('Save name');
    expect(markup).not.toContain('Organization home banner');
    expect(markup).not.toContain('type="file"');
    expect(markup).not.toContain('type="email"');
    expect(markup).not.toContain('Reserve seat');
    expect(markup).not.toContain('organization-members');
    expect(markup).not.toContain('Cancel reservation');
    expect(markup).not.toContain('Open Class workspaces');
  });
});
