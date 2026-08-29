import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CursorCompanion } from './CursorCompanion';
import { CursorBuddy, CursorBuddyView } from './CursorBuddy';

describe('CursorBuddy', () => {
  it('renders the original action cursor independently from the desktop pet', () => {
    const buddyMarkup = renderToStaticMarkup(createElement(CursorBuddy));
    const petMarkup = renderToStaticMarkup(createElement(CursorCompanion));

    expect(buddyMarkup).toContain('Tro action cursor');
    expect(buddyMarkup).toContain('cursor-buddy__image');
    expect(buddyMarkup).toContain('tro-cursor-buddy');
    expect(buddyMarkup).not.toContain('tro-desktop-pet');
    expect(petMarkup).toContain('Tro desktop pet: Idle');
    expect(petMarkup).not.toContain('tro-cursor-buddy');
  });

  it('applies pointer coordinates only in full-desktop overlay mode', () => {
    const overlayMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: true,
        position: { x: 10, y: 20 },
      }),
    );
    const nativeMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        position: { x: 10, y: 20 },
      }),
    );

    expect(overlayMarkup).toContain('cursor-buddy--overlay');
    expect(overlayMarkup).toContain('translate3d(10px, 20px, 0)');
    expect(nativeMarkup).not.toContain('cursor-buddy--overlay');
    expect(nativeMarkup).not.toContain('translate3d');
  });
});
