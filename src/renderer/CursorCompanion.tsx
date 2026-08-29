import { useEffect, useState, type CSSProperties } from 'react';

import desktopPetAtlasUrl from '../assets/tro-desktop-pet-atlas.png';
import desktopPetUrl from '../assets/tro-desktop-pet.png';
import type {
  CompanionAppearance,
  CompanionPetNudge,
  CompanionPosition,
  CompanionState,
} from '../shared/contracts';

import {
  COMPANION_ANIMATIONS,
  companionAnimationLabel,
  customCompanionHovered,
  selectCompanionAnimation,
} from './companion-animation';

const usesOverlayTracking =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('tracking') === 'overlay';

export function companionImageUrl(
  appearance: CompanionAppearance,
  defaultUrl = desktopPetUrl,
): string {
  return appearance.kind === 'custom' ? appearance.assetUrl : defaultUrl;
}

interface CursorCompanionViewProps {
  appearance: CompanionAppearance;
  hovered: boolean;
  nudge: CompanionPetNudge | null;
  overlayTracking: boolean;
  position: CompanionPosition;
  state: CompanionState;
}

export function CursorCompanionView({
  appearance,
  hovered,
  nudge,
  overlayTracking,
  position,
  state,
}: CursorCompanionViewProps) {
  const animation = selectCompanionAnimation({
    appearance,
    hovered,
    nudge,
    state,
  });
  const definition = COMPANION_ANIMATIONS[animation];
  const isCustomHovered = customCompanionHovered(appearance, state, hovered);
  const label = companionAnimationLabel(animation);
  const spriteStyle = {
    '--companion-duration': `${definition.durationMs}ms`,
    '--companion-row': definition.row,
    backgroundImage: `url("${desktopPetAtlasUrl}")`,
  } as CSSProperties;

  return (
    <div
      aria-label={label}
      className={`cursor-companion cursor-companion--${state}${
        overlayTracking ? ' cursor-companion--overlay' : ''
      } cursor-companion--animation-${animation}${
        isCustomHovered ? ' cursor-companion--hovered' : ''
      }`}
      role="img"
      style={
        overlayTracking
          ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }
          : undefined
      }
      title={
        overlayTracking
          ? label
          : `${label}. Drag to move Tro’s desktop pet`
      }
    >
      <div className="cursor-companion__visual">
        <span className="cursor-companion__ring" aria-hidden="true" />
        {appearance.kind === 'default' ? (
          <span
            aria-hidden="true"
            className="cursor-companion__sprite"
            key={`${animation}:${nudge?.mood === 'celebrating' ? nudge.id : ''}`}
            style={spriteStyle}
          />
        ) : (
          <img
            alt=""
            className="cursor-companion__image--custom"
            draggable={false}
            key={appearance.revision}
            src={companionImageUrl(appearance)}
          />
        )}
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

export function CursorCompanion() {
  const [position, setPosition] = useState<CompanionPosition>({ x: 0, y: 0 });
  const [state, setState] = useState<CompanionState>('idle');
  const [appearance, setAppearance] = useState<CompanionAppearance>({
    kind: 'default',
  });
  const [hovered, setHovered] = useState(false);
  const [nudge, setNudge] = useState<CompanionPetNudge | null>(null);

  useEffect(() => {
    if (!usesOverlayTracking) return undefined;

    return window.troCompanion.onPositionChange(setPosition);
  }, []);
  useEffect(() => window.troCompanion.onStateChange(setState), []);
  useEffect(
    () => window.troCompanion.onAppearanceChange(setAppearance),
    [],
  );
  useEffect(() => window.troCompanion.onHoverChange(setHovered), []);
  useEffect(() => window.troCompanion.onPetNudgeChange(setNudge), []);

  return (
    <CursorCompanionView
      appearance={appearance}
      hovered={hovered}
      nudge={nudge}
      overlayTracking={usesOverlayTracking}
      position={position}
      state={state}
    />
  );
}
