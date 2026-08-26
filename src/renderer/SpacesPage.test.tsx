import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SpacesPage } from './SpacesPage';

describe('SpacesPage access', () => {
  it('does not render a pending-role page for an unassigned account', () => {
    const markup = renderToStaticMarkup(
      <SpacesPage
        appLanguage="en"
        classroomRole="unassigned"
        error={null}
        loading={false}
        onJoined={vi.fn()}
        onOpen={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        spaces={[]}
      />,
    );

    expect(markup).toBe('');
    expect(markup).not.toContain('Role pending');
  });
});
