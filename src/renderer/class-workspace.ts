import type {
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
} from '../shared/contracts';

export function hasAssignedClassroomRole(
  role: ClassroomAccountRole,
): role is Exclude<ClassroomAccountRole, 'unassigned'> {
  return role !== 'unassigned';
}

export function canCreateClassWorkspace(role: ClassroomAccountRole): boolean {
  return role === 'teacher';
}

export function canManageClassPeople(
  role: KnowledgeSpaceSummary['role'],
): boolean {
  return role === 'owner' || role === 'facilitator';
}

export function rolesAvailableToMemberManager(
  role: KnowledgeSpaceSummary['role'],
): Array<'facilitator' | 'participant'> {
  if (role === 'owner') return ['participant', 'facilitator'];
  if (role === 'facilitator') return ['participant'];
  return [];
}

function compareClassWorkspaces(
  left: KnowledgeSpaceSummary,
  right: KnowledgeSpaceSummary,
): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

export function groupClassWorkspaces(spaces: KnowledgeSpaceSummary[]): {
  learning: KnowledgeSpaceSummary[];
  teaching: KnowledgeSpaceSummary[];
} {
  return {
    learning: spaces
      .filter((space) => space.role === 'participant')
      .sort(compareClassWorkspaces),
    teaching: spaces
      .filter((space) => space.role === 'owner' || space.role === 'facilitator')
      .sort(compareClassWorkspaces),
  };
}

export function parseClassMemberEmails(value: string): {
  emails: string[];
  invalid: string[];
} {
  const entries = value
    .split(/[\s,;]+/u)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(entries)];
  const emails = unique.filter((entry) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(entry));
  return {
    emails,
    invalid: unique.filter((entry) => !emails.includes(entry)),
  };
}
