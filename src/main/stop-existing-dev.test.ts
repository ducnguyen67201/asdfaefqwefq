import { describe, expect, it } from 'vitest';

import {
  collectProcessTreePostOrder,
  findTroDevelopmentRoots,
  parseProcessTable,
} from '../../scripts/stop-existing-dev.mts';

describe('Tro development process cleanup', () => {
  it('parses the macOS process table without splitting commands on spaces', () => {
    expect(
      parseProcessTable(
        '  41  20 /workspace/node modules/electron .\n  42  41 helper --type=renderer\n',
      ),
    ).toEqual([
      {
        command: '/workspace/node modules/electron .',
        parentPid: 20,
        pid: 41,
      },
      { command: 'helper --type=renderer', parentPid: 41, pid: 42 },
    ]);
  });

  it('selects only Electron Forge and orphan Electron roots from this repository', () => {
    const repositoryRoot = '/workspace/TroCode';
    expect(
      findTroDevelopmentRoots(
        [
          {
            command:
              '/node node_modules/@electron-forge/cli/dist/electron-forge-start.js',
            parentPid: 1,
            pid: 10,
          },
          {
            command:
              '/node /workspace/TroCode/node_modules/@electron-forge/cli/dist/electron-forge-start.js',
            parentPid: 1,
            pid: 11,
          },
          {
            command:
              '/workspace/TroCode/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .',
            parentPid: 1,
            pid: 12,
          },
          {
            command:
              '/workspace/Other/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .',
            parentPid: 1,
            pid: 13,
          },
          {
            command:
              '/workspace/TroCode/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper --type=renderer',
            parentPid: 12,
            pid: 14,
          },
        ],
        repositoryRoot,
      ),
    ).toEqual([11, 12]);
  });

  it('orders descendants before roots and de-duplicates overlapping roots', () => {
    expect(
      collectProcessTreePostOrder(
        [
          { command: 'root', parentPid: 1, pid: 10 },
          { command: 'child', parentPid: 10, pid: 11 },
          { command: 'grandchild', parentPid: 11, pid: 12 },
          { command: 'unrelated', parentPid: 1, pid: 20 },
        ],
        [10, 11],
      ),
    ).toEqual([12, 11, 10]);
  });
});
