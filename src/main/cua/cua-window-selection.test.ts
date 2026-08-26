import { describe, expect, it } from 'vitest';

import type { CuaWindow } from './cua-semantic-contracts';
import {
  sameWindowIdentity,
  selectExternalWindow,
  selectFrontmostExternalWindow,
} from './cua-window-selection';

function windowFixture(
  overrides: Partial<CuaWindow> & Pick<CuaWindow, 'pid' | 'window_id'>,
): CuaWindow {
  return {
    app_name: 'Notes',
    bounds: { height: 600, width: 800, x: 0, y: 0 },
    is_on_screen: true,
    on_current_space: true,
    title: '',
    z_index: 0,
    ...overrides,
  };
}

describe('CUA external window selection', () => {
  it('selects the unique highest-z external window', () => {
    expect(
      selectFrontmostExternalWindow(
        [
          windowFixture({ pid: 10, window_id: 1, z_index: 2 }),
          windowFixture({ pid: 11, window_id: 2, z_index: 8 }),
        ],
        99,
      )?.window_id,
    ).toBe(2);
  });

  it('fails closed for ties, hidden windows, Tro, and the own process', () => {
    expect(
      selectFrontmostExternalWindow(
        [
          windowFixture({ pid: 10, window_id: 1, z_index: 8 }),
          windowFixture({ pid: 11, window_id: 2, z_index: 8 }),
          windowFixture({ pid: 99, window_id: 3, z_index: 20 }),
          windowFixture({
            app_name: 'Tro',
            pid: 12,
            window_id: 4,
            z_index: 30,
          }),
          windowFixture({
            app_name: 'Electron',
            pid: 14,
            title: 'Tro companion',
            window_id: 6,
            z_index: 31,
          }),
          windowFixture({
            is_on_screen: false,
            pid: 13,
            window_id: 5,
            z_index: 40,
          }),
        ],
        99,
      ),
    ).toBeUndefined();
  });

  it('uses a sole unranked candidate but refuses ambiguous unranked windows', () => {
    const sole = windowFixture({ pid: 10, window_id: 1, z_index: null });
    expect(selectFrontmostExternalWindow([sole], 99)).toEqual(sole);
    expect(
      selectFrontmostExternalWindow(
        [sole, windowFixture({ pid: 11, window_id: 2, z_index: null })],
        99,
      ),
    ).toBeUndefined();
    expect(
      selectFrontmostExternalWindow(
        [sole, windowFixture({ pid: 11, window_id: 2, z_index: 10 })],
        99,
      ),
    ).toBeUndefined();
  });

  it('rejects off-space and zero-sized candidates', () => {
    expect(
      selectFrontmostExternalWindow(
        [
          windowFixture({
            on_current_space: false,
            pid: 10,
            window_id: 1,
          }),
          windowFixture({
            bounds: { height: 600, width: 0, x: 0, y: 0 },
            pid: 11,
            window_id: 2,
          }),
        ],
        99,
      ),
    ).toBeUndefined();
  });

  it('lets semantic revalidation retain a previous external window', () => {
    const retained = windowFixture({ pid: 10, window_id: 1, z_index: 1 });
    expect(
      selectExternalWindow(
        [retained, windowFixture({ pid: 11, window_id: 2, z_index: 9 })],
        99,
        { processId: 10, windowId: 1 },
      ),
    ).toEqual(retained);
  });

  it('compares only private process/window identity', () => {
    expect(
      sameWindowIdentity(
        { processId: 10, windowId: 1 },
        { processId: 10, windowId: 1 },
      ),
    ).toBe(true);
    expect(
      sameWindowIdentity(
        { processId: 10, windowId: 1 },
        { processId: 11, windowId: 1 },
      ),
    ).toBe(false);
  });
});
