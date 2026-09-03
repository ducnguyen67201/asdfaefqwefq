import {
  guidanceGlideDuration,
  interpolateGuidancePosition,
  placeCompanionNearCursor,
  placeGuidanceCallout,
  type GuidanceAnimationSettings,
  type Point,
  type Rectangle,
  type Size,
} from './companion-position';

export type { GuidanceAnimationSettings, Point, Rectangle, Size };

/** Pixel offset from the Cursor Buddy window's top-left to its pointing tip. */
export const CURSOR_BUDDY_TIP_OFFSET = { x: 9, y: 9 } as const;

export function placeCursorBuddyAtTarget(
  target: Point,
  displayBounds: Rectangle,
  cursorSize: Size,
): Point {
  const maximumX = displayBounds.x + displayBounds.width - cursorSize.width;
  const maximumY = displayBounds.y + displayBounds.height - cursorSize.height;
  return {
    x: Math.round(
      Math.min(
        Math.max(target.x - CURSOR_BUDDY_TIP_OFFSET.x, displayBounds.x),
        Math.max(displayBounds.x, maximumX),
      ),
    ),
    y: Math.round(
      Math.min(
        Math.max(target.y - CURSOR_BUDDY_TIP_OFFSET.y, displayBounds.y),
        Math.max(displayBounds.y, maximumY),
      ),
    ),
  };
}

export function placeCursorBuddyNearUserCursor(
  cursor: Point,
  displayBounds: Rectangle,
  cursorSize: Size,
): Point {
  return placeCompanionNearCursor(cursor, displayBounds, cursorSize, 8);
}

export function chooseCursorBuddyCalloutSide(
  cursorPosition: Point,
  displayBounds: Rectangle,
  calloutSize: Size,
  cursorSize: Size,
): 'left' | 'right' {
  const rightSpace =
    displayBounds.x + displayBounds.width -
    (cursorPosition.x + cursorSize.width);
  const leftSpace = cursorPosition.x - displayBounds.x;
  if (rightSpace >= calloutSize.width + 12) return 'right';
  if (leftSpace >= calloutSize.width + 12) return 'left';
  return rightSpace >= leftSpace ? 'right' : 'left';
}

export function placeCursorBuddyCallout(
  cursorPosition: Point,
  displayBounds: Rectangle,
  calloutSize: Size,
  cursorSize: Size,
  side: 'left' | 'right',
): Point {
  const natural = placeGuidanceCallout(
    cursorPosition,
    displayBounds,
    calloutSize,
    cursorSize,
  );
  const gap = 12;
  const requestedX =
    side === 'left'
      ? cursorPosition.x - calloutSize.width - gap
      : cursorPosition.x + cursorSize.width + gap;
  const maximumX = displayBounds.x + displayBounds.width - calloutSize.width;
  return {
    x: Math.round(
      Math.min(
        Math.max(requestedX, displayBounds.x),
        Math.max(displayBounds.x, maximumX),
      ),
    ),
    y: natural.y,
  };
}

export const cursorBuddyGlideDuration = guidanceGlideDuration;
export const interpolateCursorBuddyPosition = interpolateGuidancePosition;
