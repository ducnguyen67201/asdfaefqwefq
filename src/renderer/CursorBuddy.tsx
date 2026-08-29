import { useEffect, useState } from 'react';

import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';
import type { CompanionPosition } from '../shared/contracts';

const usesOverlayTracking =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('tracking') === 'overlay';

interface CursorBuddyViewProps {
  overlayTracking: boolean;
  position: CompanionPosition;
}

export function CursorBuddyView({
  overlayTracking,
  position,
}: CursorBuddyViewProps) {
  return (
    <div
      aria-label="Tro action cursor"
      className={`cursor-buddy${
        overlayTracking ? ' cursor-buddy--overlay' : ''
      }`}
      role="img"
      style={
        overlayTracking
          ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }
          : undefined
      }
    >
      <img
        alt=""
        className="cursor-buddy__image"
        draggable={false}
        src={cursorBuddyUrl}
      />
    </div>
  );
}

export function CursorBuddy() {
  const [position, setPosition] = useState<CompanionPosition>({ x: 0, y: 0 });

  useEffect(() => {
    if (!usesOverlayTracking) return undefined;
    return window.troCompanion.onCursorBuddyPositionChange(setPosition);
  }, []);

  return (
    <CursorBuddyView
      overlayTracking={usesOverlayTracking}
      position={position}
    />
  );
}
