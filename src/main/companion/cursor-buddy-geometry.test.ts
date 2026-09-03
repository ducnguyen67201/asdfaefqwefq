import { describe, expect, it } from 'vitest';

import {
  CURSOR_BUDDY_TIP_OFFSET,
  chooseCursorBuddyCalloutSide,
  placeCursorBuddyAtTarget,
  placeCursorBuddyCallout,
  placeCursorBuddyNearUserCursor,
} from './cursor-buddy-geometry';

describe('cursor-buddy geometry', () => {
  const cursorSize = { height: 44, width: 44 };
  const calloutSize = { height: 196, width: 380 };

  it('places the visual pointer tip on the desktop target', () => {
    const position = placeCursorBuddyAtTarget(
      { x: 500, y: 100 },
      { x: 0, y: 0, height: 500, width: 1000 },
      cursorSize,
    );

    expect(position).toEqual({
      x: 500 - CURSOR_BUDDY_TIP_OFFSET.x,
      y: 100 - CURSOR_BUDDY_TIP_OFFSET.y,
    });
  });

  it('keeps normal follow mode beside the student cursor', () => {
    expect(
      placeCursorBuddyNearUserCursor(
        { x: 500, y: 100 },
        { x: 0, y: 0, height: 500, width: 1000 },
        cursorSize,
      ),
    ).toEqual({ x: 508, y: 108 });
  });

  it('clamps the pointer and callout on a negative-origin display', () => {
    const bounds = { x: -1200, y: -80, height: 700, width: 1200 };
    const position = placeCursorBuddyAtTarget(
      { x: -1199, y: -79 },
      bounds,
      cursorSize,
    );
    const side = chooseCursorBuddyCalloutSide(
      position,
      bounds,
      calloutSize,
      cursorSize,
    );
    const callout = placeCursorBuddyCallout(
      position,
      bounds,
      calloutSize,
      cursorSize,
      side,
    );

    expect(position).toEqual({ x: -1200, y: -80 });
    expect(side).toBe('right');
    expect(callout.x).toBeGreaterThanOrEqual(bounds.x);
    expect(callout.y).toBeGreaterThanOrEqual(bounds.y);
    expect(callout.x + calloutSize.width).toBeLessThanOrEqual(
      bounds.x + bounds.width,
    );
  });

  it('locks the callout side near the right edge', () => {
    const bounds = { x: 0, y: 0, height: 700, width: 1200 };
    const side = chooseCursorBuddyCalloutSide(
      { x: 1140, y: 300 },
      bounds,
      calloutSize,
      cursorSize,
    );

    expect(side).toBe('left');
    expect(
      placeCursorBuddyCallout(
        { x: 1140, y: 300 },
        bounds,
        calloutSize,
        cursorSize,
        side,
      ).x,
    ).toBeLessThan(1140);
  });
});
