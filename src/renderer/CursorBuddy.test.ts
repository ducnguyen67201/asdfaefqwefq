// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        state: 'idle',
      }),
    );
    const nativeMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        position: { x: 10, y: 20 },
        state: 'idle',
      }),
    );

    expect(overlayMarkup).toContain('cursor-buddy--overlay');
    expect(overlayMarkup).toContain('translate3d(10px, 20px, 0)');
    expect(nativeMarkup).not.toContain('cursor-buddy--overlay');
    expect(nativeMarkup).not.toContain('translate3d');
  });

  it('shows an accessible loading ring while a submitted task is active', () => {
    const workingMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        position: { x: 0, y: 0 },
        state: 'working',
      }),
    );
    const idleMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        position: { x: 0, y: 0 },
        state: 'idle',
      }),
    );

    expect(workingMarkup).toContain('Tro action cursor: Working');
    expect(workingMarkup).toContain('cursor-buddy--working');
    expect(workingMarkup).toContain('cursor-buddy--busy');
    expect(workingMarkup).toContain('cursor-buddy__loading');
    expect(idleMarkup).toContain('cursor-buddy--idle');
    expect(idleMarkup).not.toContain('cursor-buddy--busy');
  });

  it('uses a transform-only spinner and leaves a static reduced-motion signal', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

    expect(css).toContain('@keyframes cursor-buddy-loading-spin');
    expect(css).toContain('transform: rotate(1turn);');
    expect(css).toMatch(
      /\.cursor-buddy--busy \.cursor-buddy__loading\s*\{[^}]*animation: cursor-buddy-loading-spin/u,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.cursor-buddy__loading[^{]*\{[^}]*animation: none;/u,
    );
  });

  it('subscribes to overlay positions, renders updates, and cleans up', async () => {
    const container = document.createElement('div');
    const unsubscribe = vi.fn();
    const unsubscribeState = vi.fn();
    let publishPosition: ((position: { x: number; y: number }) => void) | null =
      null;
    let publishState: ((state: 'working') => void) | null = null;
    const onCursorBuddyPositionChange = vi.fn((listener) => {
      publishPosition = listener;
      return unsubscribe;
    });
    const onStateChange = vi.fn((listener) => {
      publishState = listener;
      return unsubscribeState;
    });
    Object.defineProperty(window, 'troCompanion', {
      configurable: true,
      value: {
        getCursorBuddyPosition: vi.fn(async () => ({ x: 0, y: 0 })),
        onCursorBuddyPositionChange,
        onStateChange,
      } as unknown as CompanionApi,
    });
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(CursorBuddy, { overlayTracking: true }));
    });
    expect(onCursorBuddyPositionChange).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenCalledOnce();

    await act(async () => {
      publishPosition?.({ x: 31, y: 47 });
    });
    expect(container.innerHTML).toContain('translate3d(31px, 47px, 0)');

    await act(async () => {
      publishState?.('working');
    });
    expect(container.innerHTML).toContain('cursor-buddy--busy');

    await act(async () => root?.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribeState).toHaveBeenCalledOnce();
  });

  it('requests the current overlay position after subscribing', async () => {
    const container = document.createElement('div');
    const callOrder: string[] = [];
    const getCursorBuddyPosition = vi.fn(async () => {
      callOrder.push('request');
      return { x: 31, y: 47 };
    });
    const onCursorBuddyPositionChange = vi.fn(() => {
      callOrder.push('subscribe');
      return vi.fn();
    });
    Object.defineProperty(window, 'troCompanion', {
      configurable: true,
      value: {
        getCursorBuddyPosition,
        onCursorBuddyPositionChange,
        onStateChange: vi.fn(() => vi.fn()),
      } as unknown as CompanionApi,
    });
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(CursorBuddy, { overlayTracking: true }));
    });

    expect(callOrder).toEqual(['subscribe', 'request']);
    expect(container.innerHTML).toContain('translate3d(31px, 47px, 0)');

    await act(async () => root?.unmount());
  });
});
