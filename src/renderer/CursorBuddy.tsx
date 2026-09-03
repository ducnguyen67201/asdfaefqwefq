import { useEffect, useState } from 'react';

import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';
import type {
  CursorBuddySnapshot,
} from '../shared/contracts';

const usesOverlayTracking =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('tracking') === 'overlay';

interface CursorBuddyViewProps {
  overlayTracking: boolean;
  snapshot: CursorBuddySnapshot;
}

interface CursorBuddyProps {
  overlayTracking?: boolean;
}

const CURSOR_PHASE_LABELS: Readonly<Record<CursorBuddySnapshot['phase'], string>> = {
  following: 'Tro teaching cursor',
  thinking: 'Tro teaching cursor: Thinking',
  gliding: 'Tro teaching cursor: Moving to the next step',
  demonstrating: 'Tro teaching cursor: Showing where to click',
  explaining: 'Tro teaching cursor: Explaining',
  waiting: 'Tro teaching cursor: Waiting for you',
  paused: 'Tro teaching cursor: Paused',
  checking: 'Tro teaching cursor: Checking your work',
};

export function CursorBuddyView({
  overlayTracking,
  snapshot,
}: CursorBuddyViewProps) {
  return (
    <div
      aria-busy={snapshot.busy || undefined}
      aria-label={CURSOR_PHASE_LABELS[snapshot.phase]}
      className={`cursor-buddy${
        overlayTracking ? ' cursor-buddy--overlay' : ''
      } cursor-buddy--${snapshot.phase}${
        snapshot.busy ? ' cursor-buddy--busy' : ''
      }`}
      role="img"
      style={
        overlayTracking
          ? {
              transform: `translate3d(${snapshot.position.x}px, ${snapshot.position.y}px, 0)`,
            }
          : undefined
      }
    >
      <span className="cursor-buddy__loading" aria-hidden="true" />
      <img
        alt=""
        className="cursor-buddy__image"
        draggable={false}
        src={cursorBuddyUrl}
      />
    </div>
  );
}

export function CursorBuddy({
  overlayTracking = usesOverlayTracking,
}: CursorBuddyProps) {
  const [snapshot, setSnapshot] = useState<CursorBuddySnapshot>({
    busy: false,
    phase: 'following',
    position: { x: 0, y: 0 },
  });

  useEffect(() => {
    let active = true;
    const unsubscribe =
      window.troCompanion.onCursorBuddySnapshotChange(setSnapshot);
    void window.troCompanion
      .getCursorBuddySnapshot()
      .then((currentSnapshot) => {
        if (active) setSnapshot(currentSnapshot);
      })
      .catch((error: unknown) => {
        console.error('[cursor-buddy] Could not load initial position.', error);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <CursorBuddyView
      overlayTracking={overlayTracking}
      snapshot={snapshot}
    />
  );
}
