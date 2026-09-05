import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { KnowledgeSpaceSummary } from '../shared/contracts';

import { SidebarPlanTitle } from './SidebarPlanTitle';

const space: KnowledgeSpaceSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Python',
  description: '',
  purposeLabel: 'Class',
  role: 'participant',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

describe('SidebarPlanTitle', () => {
  it.each([
    ['owner', 'Teacher'],
    ['facilitator', 'Teacher'],
    ['participant', 'Student'],
  ] as const)('uses the selected class membership for %s', (role, label) => {
    const markup = renderToStaticMarkup(
      <SidebarPlanTitle
        appLanguage="en"
        classroomRole="teacher"
        currentSpace={{ ...space, role }}
        plan="free"
      />,
    );

    expect(markup).toContain('Tro Free');
    expect(markup).toContain(`(${label})`);
  });

  it.each([
    ['en', 'teacher', '(Teacher)'],
    ['en', 'student', '(Student)'],
    ['vi', 'teacher', '(Giáo viên)'],
    ['vi', 'student', '(Học sinh)'],
  ] as const)('localizes the %s account role %s without a selected class', (appLanguage, classroomRole, label) => {
    const markup = renderToStaticMarkup(
      <SidebarPlanTitle
        appLanguage={appLanguage}
        classroomRole={classroomRole}
        currentSpace={null}
        plan="basic"
      />,
    );

    expect(markup).toContain('Tro Basic');
    expect(markup).toContain(label);
  });

  it('does not invent a role before one is assigned or loaded', () => {
    const markup = renderToStaticMarkup(
      <SidebarPlanTitle
        appLanguage="en"
        classroomRole="unassigned"
        currentSpace={null}
        plan="free"
      />,
    );

    expect(markup).toContain('Tro Free');
    expect(markup).not.toContain('brand-plan-role');
  });
});
