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
        onManageMembers={vi.fn()}
        onOpen={vi.fn()}
        onOpenAll={vi.fn()}
        spaces={spaces}
      />,
    );

    expect(markup).toBe('');
    expect(markup).not.toContain('Role pending');
  });

  it('lets a Student switch among Teacher-added learning workspaces', () => {
    const markup = renderToStaticMarkup(
      <SidebarClassWorkspaceSwitcher
        appLanguage="en"
        classroomRole="student"
        currentSpace={null}
        onManageMembers={vi.fn()}
        onOpen={vi.fn()}
        onOpenAll={vi.fn()}
        spaces={spaces.filter((space) => space.role === 'participant')}
      />,
    );

    expect(markup).toContain('Student');
    expect(markup).toContain('Class workspaces');
    expect(markup).toContain('All class workspaces');
    expect(markup).toContain('Design Lab');
    expect(markup).toContain('Learning');
    expect(markup).not.toContain('Teaching');
    expect(markup).not.toContain('Add members');
  });

  it('gives a Teacher a direct member action for teaching workspaces', () => {
    const markup = renderToStaticMarkup(
      <SidebarClassWorkspaceSwitcher
        appLanguage="en"
        classroomRole="teacher"
        currentSpace={spaces[1] ?? null}
        onManageMembers={vi.fn()}
        onOpen={vi.fn()}
        onOpenAll={vi.fn()}
        spaces={spaces.filter((space) => space.role !== 'participant')}
      />,
    );

    expect(markup).toContain('Scratch Club');
    expect(markup).toContain('Teaching');
    expect(markup).toContain('Add members');
  });

  it('keeps the class workspace entry available before a Teacher owns a class', () => {
    const markup = renderToStaticMarkup(
      <SidebarClassWorkspaceSwitcher
        appLanguage="en"
        classroomRole="teacher"
        currentSpace={null}
        onManageMembers={vi.fn()}
        onOpen={vi.fn()}
        onOpenAll={vi.fn()}
        spaces={[]}
      />,
    );

    expect(markup).toContain('Teacher');
    expect(markup).toContain('Switch class workspace');
    expect(markup).toContain('All class workspaces');
  });

  it('shows Student for a Teacher account learning in the selected class', () => {
    const markup = renderToStaticMarkup(
      <SidebarClassWorkspaceSwitcher
        appLanguage="en"
        classroomRole="teacher"
        currentSpace={spaces[0] ?? null}
        onManageMembers={vi.fn()}
        onOpen={vi.fn()}
        onOpenAll={vi.fn()}
        spaces={spaces}
      />,
    );

    expect(markup).toContain('sidebar-class-workspace__role--student');
    expect(markup).toContain('Student</span>');
    expect(markup).not.toContain('Teacher</span>');
    expect(markup).toContain('Teaching');
    expect(markup).toContain('Learning');
  });
});
