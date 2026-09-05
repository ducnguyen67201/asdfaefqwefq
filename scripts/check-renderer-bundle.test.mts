import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkRendererBundle } from './check-renderer-bundle.mts';

test('renderer bundle check rejects missing CSS assets and accepts existing assets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tro-renderer-bundle-'));
  try {
    const css = join(directory, 'style.css');
    writeFileSync(css, 'body { background: url("./image.png"); }');
    await assert.rejects(checkRendererBundle(css, join(directory, 'out')), /image\.png/);
    writeFileSync(join(directory, 'image.png'), 'asset fixture');
    await checkRendererBundle(css, join(directory, 'out'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
