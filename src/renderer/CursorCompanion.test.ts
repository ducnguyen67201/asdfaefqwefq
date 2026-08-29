import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CursorCompanion,
  CursorCompanionView,
  companionImageUrl,
} from './CursorCompanion';

describe('CursorCompanion appearance', () => {
  it('selects the bundled default or exact private custom URL', () => {
    const customUrl = `trocode-companion://asset/active/${'a'.repeat(64)}`;
    expect(companionImageUrl({ kind: 'default' }, 'default.png')).toBe(
      'default.png',
    );
    expect(
      companionImageUrl(
        { assetUrl: customUrl, kind: 'custom', revision: 'a'.repeat(64) },
        'default.png',
      ),
    ).toBe(customUrl);
  });

  it('renders the independent desktop pet lifecycle markup', () => {
    const markup = renderToStaticMarkup(createElement(CursorCompanion));
    expect(markup).toContain('cursor-companion--idle');
    expect(markup).toContain('cursor-companion--animation-idle');
    expect(markup).toContain('cursor-companion__ring');
    expect(markup).toContain('cursor-companion__sprite');
    expect(markup).toContain('tro-desktop-pet-atlas');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('Tro desktop pet: Idle');
    expect(markup).toContain('Drag to move Tro’s desktop pet');
    expect(markup).toContain('role="img"');
  });

  it('keeps an exact private custom image with the idle hover fallback', () => {
    const customUrl = `trocode-companion://asset/active/${'b'.repeat(64)}`;
    const markup = renderToStaticMarkup(
      createElement(CursorCompanionView, {
        appearance: {
          assetUrl: customUrl,
          kind: 'custom',
          revision: 'b'.repeat(64),
        },
        hovered: true,
        nudge: null,
        overlayTracking: true,
        position: { x: 10, y: 20 },
        state: 'idle',
      }),
    );

    expect(markup).toContain('cursor-companion--hovered');
    expect(markup).toContain('cursor-companion__image--custom');
    expect(markup).toContain(`src="${customUrl}"`);
    expect(markup).toContain('translate3d(10px, 20px, 0)');
    expect(markup).not.toContain('cursor-companion__sprite');
  });
});
