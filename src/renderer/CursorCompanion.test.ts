import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CursorCompanion, companionImageUrl } from './CursorCompanion';

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

  it('preserves the existing default companion lifecycle markup', () => {
    const markup = renderToStaticMarkup(createElement(CursorCompanion));
    expect(markup).toContain('cursor-companion--idle');
    expect(markup).toContain('cursor-companion__ring');
    expect(markup).toContain('role="img"');
  });
});
