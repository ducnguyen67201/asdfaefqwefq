import type {
  AppLanguage,
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
} from '../shared/contracts';

import { translate } from './app-language';
import {
  groupClassWorkspaces,
  hasAssignedClassroomRole,
} from './class-workspace';

export function SidebarClassWorkspaceSwitcher({
  appLanguage,
  classroomRole,
  currentSpace,
  onOpen,
  spaces,
}: {
  appLanguage: AppLanguage;
  classroomRole: ClassroomAccountRole;
  currentSpace: KnowledgeSpaceSummary | null;
  onOpen: (space: KnowledgeSpaceSummary) => void;
  spaces: KnowledgeSpaceSummary[];
}) {
  if (!hasAssignedClassroomRole(classroomRole)) return null;

  const t = (message: string) => translate(appLanguage, message);
  const groupedSpaces = groupClassWorkspaces(spaces);

  return (
    <div className="sidebar-class-workspace">
      <span
        aria-label={t('Your classroom role')}
        className={`sidebar-class-workspace__role sidebar-class-workspace__role--${classroomRole}`}
      >
        <i aria-hidden="true" />
        {t(classroomRole === 'teacher' ? 'Teacher' : 'Student')}
      </span>
      {spaces.length > 0 && (
        <label>
          <span>{t('Class workspace')}</span>
          <select
            aria-label={t('Switch class workspace')}
            onChange={(event) => {
              const next = spaces.find(
                (space) => space.id === event.target.value,
              );
              if (next) onOpen(next);
            }}
            value={currentSpace?.id ?? ''}
          >
            {!currentSpace && (
              <option disabled value="">
                {t('Choose a class')}
              </option>
            )}
            {groupedSpaces.teaching.length > 0 && (
              <optgroup label={t('Teaching')}>
                {groupedSpaces.teaching.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </optgroup>
            )}
            {groupedSpaces.learning.length > 0 && (
              <optgroup label={t('Learning')}>
                {groupedSpaces.learning.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}
    </div>
  );
}
