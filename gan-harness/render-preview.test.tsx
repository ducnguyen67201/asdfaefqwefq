import { readFileSync, writeFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';

import { CompanionCustomizationCard } from '../src/renderer/CompanionCustomizationCard';
import type { CompanionCustomizationStatus } from '../src/shared/contracts';

const baseStatus: CompanionCustomizationStatus = {
  appearance: { kind: 'default' },
  candidate: null,
  quota: {
    limit: 5,
    periodEndsAt: '2026-09-01T00:00:00.000Z',
    periodStartsAt: '2026-08-01T00:00:00.000Z',
    remaining: 3,
    used: 2,
  },
  state: 'available',
  summary: 'Companion generation is available.',
};

function card(status: CompanionCustomizationStatus): string {
  return renderToStaticMarkup(
    createElement(CompanionCustomizationCard, {
      appLanguage: 'en',
      busy: null,
      error: null,
      onActivate: async () => undefined,
      onGenerate: async () => true,
      onUseDefault: async () => undefined,
      status,
    }),
  );
}

function page(content: string): string {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>${css}</style>
        <style>
          body { min-width: 0; min-height: 100vh; margin: 0; background: #ece9df; }
          .gan-preview-shell { box-sizing: border-box; width: min(900px, 100%); margin: 0 auto; padding: 34px 28px; }
          .gan-preview-shell > h1 { margin: 0 0 20px; font-size: 28px; }
        </style>
      </head>
      <body>
        <main class="gan-preview-shell">
          <h1>Settings</h1>
          ${content}
        </main>
      </body>
    </html>`;
}

describe('GAN visual preview', () => {
  it('renders representative companion states for browser evaluation', () => {
    writeFileSync(
      new URL('./preview-available.html', import.meta.url),
      page(card(baseStatus)),
    );
    writeFileSync(
      new URL('./preview-candidate.html', import.meta.url),
      page(
        card({
          ...baseStatus,
          candidate: {
            assetUrl: '/src/assets/tro-cursor-buddy.png',
            expiresAt: '2026-08-25T16:30:00.000Z',
            id: 'b17a61bb-6d35-4db4-8d7e-95268663c1e9',
          },
        }),
      ),
    );
  });
});
