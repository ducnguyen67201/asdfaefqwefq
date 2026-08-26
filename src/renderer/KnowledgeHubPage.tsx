import { useState } from 'react';

import type {
  AppLanguage,
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
  SubmitTaskRequest,
} from '../shared/contracts';

import { AssignedActivitiesPage } from './AssignedActivitiesPage';
import { AttemptLaunchPage } from './AttemptLaunchPage';
import { SpaceDetailPage } from './SpaceDetailPage';
import { SpacesPage } from './SpacesPage';

export function KnowledgeHubPage({
  appLanguage,
  classroomError,
  classroomLoading,
  classroomRole,
  classSpaces,
  focusAttemptId = null,
  mode,
  onAttemptFocusCleared,
  onLaunch,
  onRefreshClassSpaces,
  onSelectSpace,
  space,
}: {
  appLanguage: AppLanguage;
  classroomError: string | null;
  classroomLoading: boolean;
  classroomRole: ClassroomAccountRole;
  classSpaces: KnowledgeSpaceSummary[];
  focusAttemptId?: string | null;
  mode: 'spaces' | 'assigned';
  onAttemptFocusCleared?: () => void;
  onLaunch: (request: SubmitTaskRequest) => Promise<void>;
  onRefreshClassSpaces: () => Promise<void>;
  onSelectSpace: (space: KnowledgeSpaceSummary | null) => void;
  space: KnowledgeSpaceSummary | null;
}) {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null,
  );
  const attemptId = focusAttemptId ?? selectedAttemptId;

  if (attemptId) {
    return (
      <AttemptLaunchPage
        appLanguage={appLanguage}
        attemptId={attemptId}
        onBack={() => {
          setSelectedAttemptId(null);
          onAttemptFocusCleared?.();
        }}
        onLaunch={onLaunch}
      />
    );
  }
  if (mode === 'assigned') {
    return (
      <AssignedActivitiesPage
        appLanguage={appLanguage}
        onOpen={setSelectedAttemptId}
      />
    );
  }
  if (space) {
    return (
      <SpaceDetailPage
        appLanguage={appLanguage}
        key={space.id}
        onBack={() => onSelectSpace(null)}
        space={space}
      />
    );
  }
  return (
    <SpacesPage
      appLanguage={appLanguage}
      classroomRole={classroomRole}
      error={classroomError}
      loading={classroomLoading}
      onJoined={setSelectedAttemptId}
      onOpen={onSelectSpace}
      onRefresh={onRefreshClassSpaces}
      spaces={classSpaces}
    />
  );
}
