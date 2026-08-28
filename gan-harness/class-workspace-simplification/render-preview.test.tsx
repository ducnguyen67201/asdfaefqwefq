import { readFileSync, writeFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, vi } from 'vitest';

import { SpaceLibrary } from '../../src/renderer/SpaceLibrary';
import type { KnowledgeSourceList } from '../../src/shared/contracts';

const sources: KnowledgeSourceList['items'] = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    displayName: 'Week 1 debugging notes.md',
    relativePath: 'week-1/debugging-notes.md',
    role: 'reference',
    createdAt: '2026-08-25T00:00:00.000Z',
    latestVersion: {
      id: '00000000-0000-4000-8000-000000000003',
      state: 'ready',
      mediaType: 'text/markdown',
      byteSize: 15360,
      createdAt: '2026-08-25T00:00:00.000Z',
      errorCode: null,
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    displayName: 'Temperature converter starter',
    relativePath: 'activities/temperature-converter',
    role: 'starter',
    createdAt: '2026-08-25T00:00:00.000Z',
    latestVersion: {
      id: '00000000-0000-4000-8000-000000000005',
      state: 'processing',
      mediaType: 'application/zip',
      byteSize: 28672,
      createdAt: '2026-08-25T00:00:00.000Z',
      errorCode: null,
    },
  },
];

function library({
  readOnly = false,
  withSources = false,
}: {
  readOnly?: boolean;
  withSources?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <SpaceLibrary
      appLanguage="en"
      onChanged={vi.fn()}
      readOnly={readOnly}
      sources={withSources ? sources : []}
      spaceId="00000000-0000-4000-8000-000000000001"
    />,
  );
}

function page(content: string, readOnly = false): string {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const tabs = readOnly
    ? '<button aria-selected="true" role="tab">Materials</button><button aria-selected="false" role="tab">Activities</button>'
    : '<button aria-selected="true" role="tab">Materials</button><button aria-selected="false" role="tab">Activities</button><button aria-selected="false" role="tab">People</button>';
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>${css}</style>
        <style>
          html, body { min-width: 0; min-height: 100%; }
          body { margin: 0; overflow: auto; background: #f4f2eb; }
          .gan-preview-frame { box-sizing: border-box; width: min(1180px, calc(100% - 48px)); min-height: calc(100vh - 48px); margin: 24px auto; padding: clamp(24px, 4vw, 52px); border: 1px solid rgba(46, 48, 40, .12); border-radius: 24px; background: #fffefa; box-shadow: 0 24px 80px rgba(42, 40, 31, .08); }
          @media (max-width: 620px) { .gan-preview-frame { width: 100%; min-height: 100vh; margin: 0; padding: 24px 20px; border: 0; border-radius: 0; } }
        </style>
      </head>
      <body>
        <main class="gan-preview-frame knowledge-page knowledge-page--class-detail">
          <div class="space-detail-toolbar"><button class="back-link" type="button"><span aria-hidden="true">←</span> Classes</button></div>
          <header class="class-workspace-identity">
            <span class="class-workspace-identity__mark" aria-hidden="true">P</span>
            <div class="class-workspace-identity__copy">
              <p class="eyebrow">Class workspace</p>
              <h1>Python Foundations</h1>
              <p>${readOnly ? 'Materials and activities shared with this class.' : 'Materials, activities, and people for this class.'}</p>
            </div>
            <span class="class-workspace-identity__role"><i aria-hidden="true"></i>${readOnly ? 'Learning' : 'Teaching'}</span>
          </header>
          <div aria-label="Class workspace sections" class="space-tabs" role="tablist">${tabs}</div>
          ${content}
        </main>
      </body>
    </html>`;
}

describe('class workspace simplification visual preview', () => {
  it('renders representative states for browser evaluation', () => {
    writeFileSync(
      new URL('./preview-empty.html', import.meta.url),
      page(library()),
    );
    writeFileSync(
      new URL('./preview-populated.html', import.meta.url),
      page(library({ withSources: true })),
    );
    writeFileSync(
      new URL('./preview-student.html', import.meta.url),
      page(library({ readOnly: true }), true),
    );
  });
});
