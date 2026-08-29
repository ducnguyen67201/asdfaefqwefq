// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionApi } from '../shared/desktop-api';

import { CursorBuddy, CursorBuddyView } from './CursorBuddy';
import { CursorCompanion } from './CursorCompanion';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

  it('subscribes to overlay positions, renders updates, and cleans up', async () => {
    const container = document.createElement('div');
    const unsubscribe = vi.fn();
    let publishPosition: ((position: { x: number; y: number }) => void) | null =
      null;
    const onCursorBuddyPositionChange = vi.fn((listener) => {
      publishPosition = listener;
      return unsubscribe;
    });
    Object.defineProperty(window, 'troCompanion', {
      configurable: true,
      value: { onCursorBuddyPositionChange } as unknown as CompanionApi,
    });
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(CursorBuddy, { overlayTracking: true }));
    });
    expect(onCursorBuddyPositionChange).toHaveBeenCalledOnce();

    await act(async () => {
      publishPosition?.({ x: 31, y: 47 });
    });
    expect(container.innerHTML).toContain('translate3d(31px, 47px, 0)');

    await act(async () => root?.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
