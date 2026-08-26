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

  it('makes Student workspace access roster-only', () => {
    const markup = renderToStaticMarkup(
      <SpacesPage
        appLanguage="en"
        classroomRole="student"
        error={null}
        loading={false}
        onJoined={vi.fn()}
        onOpen={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        spaces={[]}
      />,
    );

    expect(markup).toContain('Teacher-managed workspace access');
    expect(markup).toContain('A Teacher can add your registered account');
    expect(markup).not.toContain('Join a class');
    expect(markup).not.toContain('Join code');
  });

  it('lets a Teacher create a workspace without offering self-enrollment', () => {
    const markup = renderToStaticMarkup(
      <SpacesPage
        appLanguage="en"
        classroomRole="teacher"
        error={null}
        loading={false}
        onJoined={vi.fn()}
        onOpen={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        spaces={[]}
      />,
    );

    expect(markup).toContain('Create a class');
    expect(markup).not.toContain('Join a class');
  });
});
