import { useEffect, useState } from 'react';

import type {
  AppLanguage,
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
} from '../shared/contracts';

import { translate } from './app-language';
import { groupClassWorkspaces } from './class-workspace';

export function ClassWorkspaceSwitcher({
  appLanguage,
  currentSpace,
  onOpen,
}: {
  appLanguage: AppLanguage;
  currentSpace: KnowledgeSpaceSummary;
  onOpen: (space: KnowledgeSpaceSummary) => void;
}) {
  const [classroomRole, setClassroomRole] =
    useState<ClassroomAccountRole>('unassigned');
  const [spaces, setSpaces] = useState<KnowledgeSpaceSummary[]>([currentSpace]);
  const t = (message: string) => translate(appLanguage, message);
  const groupedSpaces = groupClassWorkspaces(spaces);
  const initials = currentSpace.name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    let active = true;
    void window.tro
      .listKnowledgeSpaces()
      .then((result) => {
        if (!active) return;
        setClassroomRole(result.classroomRole);
        setSpaces(result.items);
      })
      .catch(() => {
        // Keep the known current class visible if a background refresh fails.
      });
    return () => {
      active = false;
    };
  }, [currentSpace.id]);

  return (
    <div className="class-workspace-switcher">
      <div className="class-workspace-switcher__identity">
        <span className="class-workspace-switcher__mark" aria-hidden="true">
          {initials || 'C'}
        </span>
        <div className="class-workspace-switcher__copy">
          <span>{t('Current class')}</span>
          <strong>{currentSpace.name}</strong>
          <p>
            {currentSpace.description ||
              t('Resources, activities, and people for this class.')}
          </p>
        </div>
      </div>
      <span
        className={`space-role space-role--${classroomRole}`}
        aria-label={t('Your classroom role')}
      >
        <i aria-hidden="true" />
        {t(
          classroomRole === 'teacher'
            ? 'Teacher'
            : classroomRole === 'student'
              ? 'Student'
              : 'Role pending',
        )}
      </span>
      <label>
        <span>{t('Switch class')}</span>
        <select
          aria-label={t('Switch class workspace')}
          onChange={(event) => {
            const next = spaces.find(
              (space) => space.id === event.target.value,
            );
            if (next) onOpen(next);
          }}
          value={currentSpace.id}
        >
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
    </div>
  );
}
