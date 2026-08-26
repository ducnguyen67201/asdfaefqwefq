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
  onManageMembers,
  onOpen,
  onOpenAll,
  spaces,
}: {
  appLanguage: AppLanguage;
  classroomRole: ClassroomAccountRole;
  currentSpace: KnowledgeSpaceSummary | null;
  onManageMembers: (space: KnowledgeSpaceSummary) => void;
  onOpen: (space: KnowledgeSpaceSummary) => void;
  onOpenAll: () => void;
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
      <details className="sidebar-class-workspace__picker">
        <summary aria-label={t('Switch class workspace')}>
          <span>
            <small>{t('Class workspaces')}</small>
            <strong>
              {currentSpace?.name ?? t('All class workspaces')}
            </strong>
          </span>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m7 9 5 5 5-5" />
          </svg>
        </summary>
        <div className="sidebar-class-workspace__menu">
          <button
            aria-current={currentSpace === null ? 'page' : undefined}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              onOpenAll();
            }}
            type="button"
          >
            {t('All class workspaces')}
          </button>
          {groupedSpaces.teaching.length > 0 && (
            <section aria-label={t('Teaching')}>
              <span>{t('Teaching')}</span>
              {groupedSpaces.teaching.map((space) => (
                <div
                  className="sidebar-class-workspace__menu-item"
                  key={space.id}
                >
                  <button
                    aria-current={
                      currentSpace?.id === space.id ? 'page' : undefined
                    }
                    onClick={(event) => {
                      event.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                      onOpen(space);
                    }}
                    type="button"
                  >
                    {space.name}
                  </button>
                  <button
                    aria-label={`${t('Add members')} — ${space.name}`}
                    className="sidebar-class-workspace__manage"
                    onClick={(event) => {
                      event.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                      onManageMembers(space);
                    }}
                    type="button"
                  >
                    + {t('Add members')}
                  </button>
                </div>
              ))}
            </section>
          )}
          {groupedSpaces.learning.length > 0 && (
            <section aria-label={t('Learning')}>
              <span>{t('Learning')}</span>
              {groupedSpaces.learning.map((space) => (
                <button
                  aria-current={
                    currentSpace?.id === space.id ? 'page' : undefined
                  }
                  key={space.id}
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    onOpen(space);
                  }}
                  type="button"
                >
                  {space.name}
                </button>
              ))}
            </section>
          )}
        </div>
      </details>
    </div>
  );
}
