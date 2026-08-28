import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'gan-harness/class-workspace-simplification/render-preview.test.tsx',
    ],
  },
});
