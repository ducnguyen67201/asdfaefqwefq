import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeSourceList } from '../shared/contracts';

import { SpaceLibrary } from './SpaceLibrary';

const source: KnowledgeSourceList['items'][number] = {
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'debugging-notes.md',
  relativePath: 'week-1/debugging-notes.md',
  role: 'reference',
  createdAt: '2026-08-25T00:00:00.000Z',
  latestVersion: {
    id: '00000000-0000-4000-8000-000000000003',
    state: 'ready',
    mediaType: 'text/markdown',
    byteSize: 1024,
    createdAt: '2026-08-25T00:00:00.000Z',
    errorCode: null,
  },
};

function render({
  loading = false,
  readOnly = false,
  sources = [],
}: {
  loading?: boolean;
  readOnly?: boolean;
  sources?: KnowledgeSourceList['items'];
} = {}): string {
  return renderToStaticMarkup(
    <SpaceLibrary
      appLanguage="en"
      loading={loading}
      onChanged={vi.fn()}
      readOnly={readOnly}
      sources={sources}
      spaceId="00000000-0000-4000-8000-000000000001"
    />,
  );
}

describe('SpaceLibrary', () => {
  it('offers one primary action and progressively discloses upload options', () => {
    const markup = render();

    expect(markup).toContain('Bring in your first material');
    expect(markup).toContain(
      'class="primary-button materials-add-files"',
    );
    expect(markup.match(/class="primary-button/g)).toHaveLength(1);
    expect(markup).toContain('<details class="material-upload-options">');
    expect(markup).toContain('Reference by default');
    expect(markup).toContain('<option value="reference" selected="">');
    expect(markup).not.toContain('Content role');
  });

  it('keeps upload controls out of the read-only student state', () => {
    const markup = render({ readOnly: true });

    expect(markup).toContain('No class materials yet');
    expect(markup).not.toContain('Add files');
    expect(markup).not.toContain('Add a folder');
    expect(markup).not.toContain('Upload options');
  });

  it('renders a calm loading state instead of an empty-state action', () => {
    const markup = render({ loading: true });

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Loading materials…');
    expect(markup).not.toContain('Bring in your first material');
  });

  it('keeps populated material details and actions available', () => {
    const markup = render({ sources: [source] });

    expect(markup).toContain('debugging-notes.md');
    expect(markup).toContain('week-1/debugging-notes.md');
    expect(markup).toContain('Add files');
    expect(markup).toContain('Add a folder');
    expect(markup).toContain('Upload options');
    expect(markup).toContain('Used as');
    expect(markup.match(/class="primary-button/g)).toHaveLength(1);
    expect(markup).toContain('class="materials-mobile-list" role="list"');
    expect(markup).toContain('class="materials-mobile-row"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('aria-label="Reference; status Ready"');
  });
});
