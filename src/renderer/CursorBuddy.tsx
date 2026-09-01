import { useEffect, useState } from 'react';

import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';
import type {
  CompanionPosition,
  CompanionState,
} from '../shared/contracts';

const usesOverlayTracking =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('tracking') === 'overlay';

interface CursorBuddyViewProps {
  overlayTracking: boolean;
  position: CompanionPosition;
  state: CompanionState;
}

interface CursorBuddyProps {
  overlayTracking?: boolean;
}

const BUSY_CURSOR_STATES: ReadonlySet<CompanionState> = new Set([
  'sending',
  'processing',
  'working',
]);

const BUSY_CURSOR_LABELS: Readonly<Partial<Record<CompanionState, string>>> = {
  sending: 'Sending',
  processing: 'Thinking',
  working: 'Working',
};

export function CursorBuddyView({
  overlayTracking,
  position,
  state,
}: CursorBuddyViewProps) {
  const busy = BUSY_CURSOR_STATES.has(state);
  const label = busy
    ? `Tro action cursor: ${BUSY_CURSOR_LABELS[state]}`
    : 'Tro action cursor';

  return (
    <div
      aria-busy={busy || undefined}
      aria-label={label}
      className={`cursor-buddy${
        overlayTracking ? ' cursor-buddy--overlay' : ''
      } cursor-buddy--${state}${busy ? ' cursor-buddy--busy' : ''}`}
      role="img"
      style={
        overlayTracking
          ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }
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
  const [position, setPosition] = useState<CompanionPosition>({ x: 0, y: 0 });
  const [state, setState] = useState<CompanionState>('idle');

  useEffect(() => {
    if (!overlayTracking) return undefined;
    let active = true;
    const unsubscribe =
      window.troCompanion.onCursorBuddyPositionChange(setPosition);
    void window.troCompanion
      .getCursorBuddyPosition()
      .then((currentPosition) => {
        if (active) setPosition(currentPosition);
      })
      .catch((error: unknown) => {
        console.error('[cursor-buddy] Could not load initial position.', error);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [overlayTracking]);
  useEffect(() => window.troCompanion.onStateChange(setState), []);

  return (
    <CursorBuddyView
      overlayTracking={overlayTracking}
      position={position}
      state={state}
    />
  );
}
