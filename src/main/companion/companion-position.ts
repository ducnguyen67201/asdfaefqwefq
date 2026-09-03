export interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  height: number;
  width: number;
}

export interface Size {
  height: number;
  width: number;
}

export interface GuidanceAnimationSettings {
  prefersReducedMotion: boolean;
  shouldRenderRichAnimation: boolean;
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

export function shouldUseCompanionOverlay(platform: string): boolean {
  return platform === 'win32';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function clampCompanionPosition(
  position: Point,
  displayBounds: Rectangle,
  companionSize: Size,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;

  return {
    x: Math.round(
      clamp(
        position.x,
        displayBounds.x,
        displayRight - companionSize.width,
      ),
    ),
    y: Math.round(
      clamp(
        position.y,
        displayBounds.y,
        displayBottom - companionSize.height,
      ),
    ),
  };
}

export function interpolateCompanionPosition(
  from: Point,
  to: Point,
  progress: number,
): Point {
  const normalizedProgress = clampUnit(progress);
  const easedProgress = 1 - Math.pow(1 - normalizedProgress, 3);

  return {
    x: Math.round(from.x + (to.x - from.x) * easedProgress),
    y: Math.round(from.y + (to.y - from.y) * easedProgress),
  };
}

export function guidanceGlideDuration(
  from: Point,
  to: Point,
  settings: GuidanceAnimationSettings,
): number {
  if (settings.prefersReducedMotion) return 0;
  if (!settings.shouldRenderRichAnimation) return 180;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return clamp(Math.round((260 + distance * 0.4) / 20) * 20, 300, 720);
}

/** A restrained upward arc makes the companion read as a teacher pointer. */
export function interpolateGuidancePosition(
  from: Point,
  to: Point,
  progress: number,
): Point {
  const normalized = clampUnit(progress);
  const eased = normalized * normalized * (3 - 2 * normalized);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const horizontalDirection = to.x >= from.x ? -1 : 1;
  const control = {
    x: (from.x + to.x) / 2 + horizontalDirection * Math.min(44, distance * 0.05),
    y: (from.y + to.y) / 2 - Math.min(112, distance * 0.125),
  };
  const inverse = 1 - eased;
  return {
    x: Math.round(
      inverse * inverse * from.x +
        2 * inverse * eased * control.x +
        eased * eased * to.x,
    ),
    y: Math.round(
      inverse * inverse * from.y +
        2 * inverse * eased * control.y +
        eased * eased * to.y,
    ),
  };
}

export function interpolateCompanionWanderPosition(
  from: Point,
  to: Point,
  progress: number,
): Point {
  const normalizedProgress = clampUnit(progress);
  const easedProgress =
    (1 - Math.cos(Math.PI * normalizedProgress)) / 2;

  return {
    x: Math.round(from.x + (to.x - from.x) * easedProgress),
    y: Math.round(from.y + (to.y - from.y) * easedProgress),
  };
}

export function placeCompanionNearCursor(
  cursor: Point,
  displayBounds: Rectangle,
  companionSize: Size,
  gap = 8,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  let x = cursor.x + gap;
  let y = cursor.y + gap;

  if (x + companionSize.width > displayRight) {
    x = cursor.x - companionSize.width - gap;
  }

  if (y + companionSize.height > displayBottom) {
    y = cursor.y - companionSize.height - gap;
  }

  return {
    x: Math.round(
      clamp(x, displayBounds.x, displayRight - companionSize.width),
    ),
    y: Math.round(
      clamp(y, displayBounds.y, displayBottom - companionSize.height),
    ),
  };
}

export function placeCompanionAtRest(
  displayBounds: Rectangle,
  companionSize: Size,
  edgeGap = 24,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;

  return {
    x: Math.round(
      clamp(
        displayRight - companionSize.width - edgeGap,
        displayBounds.x,
        displayRight - companionSize.width,
      ),
    ),
    y: Math.round(
      clamp(
        displayBottom - companionSize.height - edgeGap,
        displayBounds.y,
        displayBottom - companionSize.height,
      ),
    ),
  };
}

export function placeCompanionWanderTarget(
  current: Point,
  displayBounds: Rectangle,
  companionSize: Size,
  horizontalProgress: number,
  verticalProgress: number,
  edgeGap = 24,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  const minimumX = clamp(
    displayBounds.x + edgeGap,
    displayBounds.x,
    displayRight - companionSize.width,
  );
  const maximumX = Math.max(
    minimumX,
    displayRight - companionSize.width - edgeGap,
  );
  const midpointX = minimumX + (maximumX - minimumX) / 2;
  const movingRight = current.x < midpointX;
  const targetStartX = movingRight ? midpointX : minimumX;
  const targetEndX = movingRight ? maximumX : midpointX;
  const minimumY = clamp(
    displayBounds.y + displayBounds.height * 0.58,
    displayBounds.y,
    displayBottom - companionSize.height,
  );
  const maximumY = Math.max(
    minimumY,
    displayBottom - companionSize.height - edgeGap,
  );

  return {
    x: Math.round(
      targetStartX +
        (targetEndX - targetStartX) * clampUnit(horizontalProgress),
    ),
    y: Math.round(
      minimumY +
        (maximumY - minimumY) * clampUnit(verticalProgress),
    ),
  };
}

export function placeCompanionForBrowserNavigation(
  displayBounds: Rectangle,
  companionSize: Size,
  gap = 8,
): Point {
  const toolbarTarget = {
    x: displayBounds.x + Math.round(displayBounds.width / 2),
    y:
      displayBounds.y +
      Math.min(
        88,
        Math.max(48, Math.round(displayBounds.height * 0.08)),
      ),
  };

  return placeCompanionNearCursor(
    toolbarTarget,
    displayBounds,
    companionSize,
    gap,
  );
}

export function placeGuidanceCallout(
  target: Point,
  displayBounds: Rectangle,
  calloutSize: Size,
  companionSize: Size,
  gap = 12,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  let x = target.x + companionSize.width + gap;
  let y = target.y - Math.round(calloutSize.height * 0.2);

  if (x + calloutSize.width > displayRight) {
    x = target.x - calloutSize.width - gap;
  }
  if (y + calloutSize.height > displayBottom) {
    y = target.y - calloutSize.height - gap;
  }

  return {
    x: Math.round(clamp(x, displayBounds.x, displayRight - calloutSize.width)),
    y: Math.round(clamp(y, displayBounds.y, displayBottom - calloutSize.height)),
  };
}

export function placeGuidanceTargetMarker(
  target: Point,
  region: Rectangle | undefined,
  displayBounds: Rectangle,
  padding = 18,
): Rectangle {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  if (!region) {
    const diameter = Math.min(76, displayBounds.width, displayBounds.height);
    return {
      x: Math.round(
        clamp(
          target.x - diameter / 2,
          displayBounds.x,
          displayRight - diameter,
        ),
      ),
      y: Math.round(
        clamp(
          target.y - diameter / 2,
          displayBounds.y,
          displayBottom - diameter,
        ),
      ),
      width: Math.round(diameter),
      height: Math.round(diameter),
    };
  }

  const visibleLeft = clamp(region.x, displayBounds.x, displayRight);
  const visibleTop = clamp(region.y, displayBounds.y, displayBottom);
  const visibleRight = clamp(
    region.x + region.width,
    displayBounds.x,
    displayRight,
  );
  const visibleBottom = clamp(
    region.y + region.height,
    displayBounds.y,
    displayBottom,
  );
  const width = Math.min(
    displayBounds.width,
    Math.max(76, visibleRight - visibleLeft + padding * 2),
  );
  const height = Math.min(
    displayBounds.height,
    Math.max(76, visibleBottom - visibleTop + padding * 2),
  );
  return {
    x: Math.round(
      clamp(
        visibleLeft - padding,
        displayBounds.x,
        displayRight - width,
      ),
    ),
    y: Math.round(
      clamp(
        visibleTop - padding,
        displayBounds.y,
        displayBottom - height,
      ),
    ),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function placeVoiceIsland(
  displayBounds: Rectangle,
  islandSize: Size,
  topGap = 10,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;

  return {
    x: Math.round(
      clamp(
        displayBounds.x + (displayBounds.width - islandSize.width) / 2,
        displayBounds.x,
        displayRight - islandSize.width,
      ),
    ),
    y: Math.round(
      clamp(
        displayBounds.y + topGap,
        displayBounds.y,
        displayBottom - islandSize.height,
      ),
    ),
  };
}

export function getVirtualDisplayBounds(displays: readonly Rectangle[]): Rectangle {
  if (displays.length === 0) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }

  const left = Math.min(...displays.map((display) => display.x));
  const top = Math.min(...displays.map((display) => display.y));
  const right = Math.max(
    ...displays.map((display) => display.x + display.width),
  );
  const bottom = Math.max(
    ...displays.map((display) => display.y + display.height),
  );

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function sizeEqual(left: Size, right: Size): boolean {
  return left.width === right.width && left.height === right.height;
}

export function resolveDesktopCaptureBounds(
  captureSize: Size,
  displays: readonly Rectangle[],
  primaryDisplayBounds: Rectangle,
): Rectangle | undefined {
  const virtualBounds = getVirtualDisplayBounds(displays);
  if (sizeEqual(captureSize, virtualBounds)) return virtualBounds;
  if (sizeEqual(captureSize, primaryDisplayBounds)) {
    return primaryDisplayBounds;
  }

  const matchingDisplays = displays.filter((display) =>
    sizeEqual(captureSize, display),
  );
  return matchingDisplays.length === 1 ? matchingDisplays[0] : undefined;
}

export function placeCompanionInOverlay(
  cursor: Point,
  overlayBounds: Rectangle,
  companionSize: Size,
  gap = 8,
  placementBounds = overlayBounds,
): Point {
  const screenPosition = placeCompanionNearCursor(
    cursor,
    placementBounds,
    companionSize,
    gap,
  );

  return {
    x: screenPosition.x - overlayBounds.x,
    y: screenPosition.y - overlayBounds.y,
  };
}
