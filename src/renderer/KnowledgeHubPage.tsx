import { useState } from 'react';

import type {
  AppLanguage,
  KnowledgeSpaceSummary,
  SubmitTaskRequest,
} from '../shared/contracts';

import { AssignedActivitiesPage } from './AssignedActivitiesPage';
import { AttemptLaunchPage } from './AttemptLaunchPage';
import { SpaceDetailPage } from './SpaceDetailPage';
import { SpacesPage } from './SpacesPage';

export function KnowledgeHubPage({
  appLanguage,
  focusAttemptId = null,
  mode,
  onAttemptFocusCleared,
  onLaunch,
}: {
  appLanguage: AppLanguage;
  focusAttemptId?: string | null;
  mode: 'spaces' | 'assigned';
  onAttemptFocusCleared?: () => void;
  onLaunch: (request: SubmitTaskRequest) => Promise<void>;
}) {
  const [space, setSpace] = useState<KnowledgeSpaceSummary | null>(null);
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
        onBack={() => setSpace(null)}
        onOpen={setSpace}
        space={space}
      />
    );
  }
  return (
    <SpacesPage
      appLanguage={appLanguage}
      onJoined={setSelectedAttemptId}
      onOpen={setSpace}
    />
  );
}
