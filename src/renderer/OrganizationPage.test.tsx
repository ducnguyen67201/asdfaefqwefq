import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationSummary } from '../shared/contracts';

import { OrganizationPage } from './OrganizationPage';

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

  it('renders Vietnamese labels and a persistent server error', () => {
    const markup = renderPage({
      appLanguage: 'vi',
      error: 'Không thể kết nối dịch vụ.',
    });

    expect(markup).toContain('Quyền truy cập tổ chức');
    expect(markup).toContain('Thêm người bằng email');
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
});
