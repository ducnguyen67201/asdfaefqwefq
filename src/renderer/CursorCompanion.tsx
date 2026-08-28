import { useEffect, useState } from 'react';

import desktopPetUrl from '../assets/tro-desktop-pet.png';
import type {
  CompanionAppearance,
  CompanionPosition,
  CompanionState,
} from '../shared/contracts';

const usesOverlayTracking =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('tracking') === 'overlay';

export function companionImageUrl(
  appearance: CompanionAppearance,
  defaultUrl = desktopPetUrl,
): string {
  return appearance.kind === 'custom' ? appearance.assetUrl : defaultUrl;
}

export function CursorCompanion() {
  const [position, setPosition] = useState<CompanionPosition>({ x: 0, y: 0 });
  const [state, setState] = useState<CompanionState>('idle');
  const [appearance, setAppearance] = useState<CompanionAppearance>({
    kind: 'default',
  });

  useEffect(() => {
    if (!usesOverlayTracking) return undefined;

    return window.troCompanion.onPositionChange(setPosition);
  }, []);
  useEffect(() => window.troCompanion.onStateChange(setState), []);
  useEffect(
    () => window.troCompanion.onAppearanceChange(setAppearance),
    [],
  );

  return (
    <div
      aria-label={`Tro desktop pet: ${state}`}
      className={`cursor-companion cursor-companion--${state}${
        usesOverlayTracking ? ' cursor-companion--overlay' : ''
      }`}
      role="img"
      style={
        usesOverlayTracking
          ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }
          : undefined
      }
      title={
        usesOverlayTracking ? undefined : 'Drag to move Tro’s desktop pet'
      }
    >
      <div className="cursor-companion__visual">
        <span className="cursor-companion__ring" aria-hidden="true" />
        <img
          alt=""
          className={
            appearance.kind === 'default'
              ? 'cursor-companion__image--default'
              : 'cursor-companion__image--custom'
          }
          draggable={false}
          key={appearance.kind === 'custom' ? appearance.revision : 'default'}
          src={companionImageUrl(appearance)}
        />
        <span className="cursor-companion__listening" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cursor-companion__processing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cursor-companion__error" aria-hidden="true">
          !
        </span>
        <span className="cursor-companion__completed" aria-hidden="true">
          <svg focusable="false" viewBox="0 0 16 16">
            <path d="m3.5 8.1 2.7 2.8 6.3-6.2" />
          </svg>
        </span>
      </div>
    </div>
  );
}
