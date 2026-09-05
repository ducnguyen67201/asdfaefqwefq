import type {
  AppLanguage,
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
  PlanId,
} from '../shared/contracts';

import { translate } from './app-language';
import {
  displayedClassroomRole,
  hasAssignedClassroomRole,
} from './class-workspace';
import { planTitle } from './usage-presentation';

export function SidebarPlanTitle({
  appLanguage,
  classroomRole,
  currentSpace,
  plan,
}: {
  appLanguage: AppLanguage;
  classroomRole: ClassroomAccountRole;
  currentSpace: KnowledgeSpaceSummary | null;
  plan: PlanId;
}) {
  const role = displayedClassroomRole(classroomRole, currentSpace);
  return (
    <strong className="brand-plan-title">
      {planTitle(plan)}
      {hasAssignedClassroomRole(role) && (
        <small className="brand-plan-role">
          ({translate(appLanguage, role === 'teacher' ? 'Teacher' : 'Student')})
        </small>
      )}
    </strong>
  );
}
