import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['gan-harness/settings-modal/render-preview.test.tsx'],
  },
});
