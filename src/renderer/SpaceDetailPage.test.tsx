import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeSpaceSummary } from '../shared/contracts';

import { SpaceDetailPage } from './SpaceDetailPage';

const space: KnowledgeSpaceSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Saturday Scratch',
  description: 'Build and review Scratch projects.',
  purposeLabel: 'Scratch class',
  role: 'participant',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

function render(role: KnowledgeSpaceSummary['role']): string {
  return renderToStaticMarkup(
    <SpaceDetailPage
      appLanguage="en"
      onBack={vi.fn()}
      space={{ ...space, role }}
    />,
  );
}

describe('SpaceDetailPage role presentation', () => {
  it('keeps teacher material and room controls out of the student surface', () => {
    const markup = render('participant');

    expect(markup).toContain('Student access');
    expect(markup).toContain('Join · Work · Help · Check · Submit');
    expect(markup).not.toContain('Add class material');
    expect(markup).not.toContain('Publish Activity');
    expect(markup).not.toContain('Create live room');
    expect(markup).not.toContain('People');
  });

  it.each(['owner', 'facilitator'] as const)(
    'shows the intentional teacher progression for %s',
    (role) => {
      const markup = render(role);

      expect(markup).toContain('Teacher flow: Materials, Activity, Live room');
      expect(markup).toContain('Materials');
      expect(markup).toContain('Activities &amp; rooms');
      expect(markup).toContain('People');
      expect(markup).toContain('Add class material');
    },
  );
});
