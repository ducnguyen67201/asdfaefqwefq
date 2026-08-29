import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionCustomizationStatus } from '../shared/contracts';

import { CompanionCustomizationCard } from './CompanionCustomizationCard';

const ACTIVE_ASSET = `trocode-companion://asset/active/${'a'.repeat(64)}`;
const CANDIDATE_ID = 'b17a61bb-6d35-4db4-8d7e-95268663c1e9';

function renderCard(
  status: CompanionCustomizationStatus,
  options: {
    appLanguage?: 'en' | 'vi';
    busy?:
      | 'loading'
      | 'generating'
      | 'activating'
      | 'selecting'
      | 'resetting'
      | null;
    error?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(CompanionCustomizationCard, {
      appLanguage: options.appLanguage ?? 'en',
      busy: options.busy ?? null,
      error: options.error ?? null,
      onActivate: vi.fn(),
      onActivateSaved: vi.fn(),
      onGenerate: vi.fn(),
      onUseDefault: vi.fn(),
      status,
    }),
  );
}

function availableStatus(
  overrides: Partial<CompanionCustomizationStatus> = {},
): CompanionCustomizationStatus {
  return {
    appearance: { kind: 'default' },
    candidate: null,
    quota: {
      limit: 5,
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      periodStartsAt: '2026-08-01T00:00:00.000Z',
      remaining: 3,
      used: 2,
    },
    savedCompanions: [],
    state: 'available',
    summary: 'Companion generation is available.',
    ...overrides,
  };
}

describe('CompanionCustomizationCard', () => {
  it('shows the source, prompt, privacy, and monthly quota controls', () => {
    const markup = renderCard(availableStatus());

    expect(markup).toContain('Custom companion');
    expect(markup).toContain('Pick a pet');
    expect(markup).toContain('Animated default pet');
    expect(markup).toContain('Create your own pet');
    expect(markup).toContain('Drop, paste, or click to choose');
    expect(markup).toContain('Describe the vibe');
    expect(markup).toContain('2 of 5 previews used');
    expect(markup).toContain('Tro does not save them');
    expect(markup).toContain('Add an image to continue');
    expect(markup).toMatch(/companion-customization-generate" disabled=""/u);
  });

  it('offers activation for a generated candidate', () => {
    const markup = renderCard(
      availableStatus({
        candidate: {
          assetUrl: `trocode-companion://asset/candidate/${CANDIDATE_ID}`,
          expiresAt: '2026-08-25T10:10:00.000Z',
          id: CANDIDATE_ID,
        },
      }),
    );

    expect(markup).toContain('Meet your new companion');
    expect(markup).toContain('Nothing changes until you choose to use it.');
    expect(markup).toContain('Use this companion');
  });

  it('offers previously created companions without using another preview', () => {
    const markup = renderCard(
      availableStatus({
        appearance: {
          assetUrl: ACTIVE_ASSET,
          kind: 'custom',
          revision: 'a'.repeat(64),
        },
        savedCompanions: [
          {
            assetUrl: ACTIVE_ASSET,
            createdAt: '2026-08-24T00:00:00.000Z',
            id: 'a'.repeat(64),
          },
          {
            assetUrl: `trocode-companion://asset/active/${'b'.repeat(64)}`,
            createdAt: '2026-08-23T00:00:00.000Z',
            id: 'b'.repeat(64),
          },
        ],
      }),
    );

    expect(markup).toContain('Pick a pet');
    expect(markup).toContain(
      'Choose Tro or a pet you generated. Switching does not use a preview.',
    );
    expect(markup).toContain('2 custom pets');
    expect(markup).toContain('Generated pet 2');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Generated pets stay encrypted on this device.');
  });

  it('disables generation after the monthly limit is exhausted', () => {
    const markup = renderCard(
      availableStatus({
        quota: {
          limit: 5,
          periodEndsAt: '2026-09-01T00:00:00.000Z',
          periodStartsAt: '2026-08-01T00:00:00.000Z',
          remaining: 0,
          used: 5,
        },
      }),
    );

    expect(markup).toContain('0 of 5 left this month');
    expect(markup).toContain('All previews used this month');
    expect(markup).toContain('You can create more on');
    expect(markup).not.toContain('Choose a picture');
  });

  it('announces progress and visible errors', () => {
    const progressMarkup = renderCard(availableStatus(), {
      busy: 'generating',
    });
    const errorMarkup = renderCard(availableStatus(), {
      error: 'Tro could not generate this companion.',
    });

    expect(progressMarkup).toContain('Creating your preview…');
    expect(progressMarkup).toContain(
      'This can take up to 2 minutes. Keep Tro open.',
    );
    expect(progressMarkup).toContain('aria-busy="true"');
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain('Tro could not generate this companion.');
  });

  it('keeps reset available when generation is unavailable', () => {
    const markup = renderCard({
      appearance: {
        assetUrl: ACTIVE_ASSET,
        kind: 'custom',
        revision: 'a'.repeat(64),
      },
      candidate: null,
      quota: null,
      savedCompanions: [],
      state: 'unavailable',
      summary: 'Companion image generation is disabled.',
    });

    expect(markup).toContain('Your custom companion is active.');
    expect(markup).toContain('Use default companion');
    expect(markup).toContain('Generation unavailable');
    expect(markup).toContain('Companion image generation is disabled.');
  });

  it('localizes the visible first-use path in Vietnamese', () => {
    const markup = renderCard(availableStatus(), { appLanguage: 'vi' });

    expect(markup).toContain('Chọn một bức ảnh');
    expect(markup).toContain('Chọn thú cưng');
    expect(markup).toContain('Tạo thú cưng riêng');
    expect(markup).toContain('Mô tả phong cách');
    expect(markup).toContain('Thêm ảnh để tiếp tục');
    expect(markup).not.toContain('Drop, paste, or click to choose');
  });
});
