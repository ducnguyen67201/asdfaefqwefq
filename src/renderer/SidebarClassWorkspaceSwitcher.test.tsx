import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeSpaceSummary } from '../shared/contracts';

import { SidebarClassWorkspaceSwitcher } from './SidebarClassWorkspaceSwitcher';

const spaces: KnowledgeSpaceSummary[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Design Lab',
    description: '',
    purposeLabel: 'Class',
    role: 'participant',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Scratch Club',
    description: '',
    purposeLabel: 'Class',
    role: 'facilitator',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  },
];

describe('SidebarClassWorkspaceSwitcher', () => {
  it('renders nothing while the classroom role is unassigned', () => {
    const markup = renderToStaticMarkup(
      <SidebarClassWorkspaceSwitcher
        appLanguage="en"
        classroomRole="unassigned"
        currentSpace={null}
        onOpen={vi.fn()}
        spaces={spaces}
      />,
    );

    expect(markup).toBe('');
    expect(markup).not.toContain('Role pending');
  });

  it('shows the assigned role and every available class below the plan', () => {
    const markup = renderToStaticMarkup(
      <SidebarClassWorkspaceSwitcher
        appLanguage="en"
        classroomRole="student"
        currentSpace={null}
        onOpen={vi.fn()}
        spaces={spaces}
      />,
    );

    expect(markup).toContain('Student');
    expect(markup).toContain('Choose a class');
    expect(markup).toContain('Design Lab');
    expect(markup).toContain('Scratch Club');
    expect(markup).toContain('Teaching');
    expect(markup).toContain('Learning');
  });
});
