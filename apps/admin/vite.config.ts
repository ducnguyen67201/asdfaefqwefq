import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const adminDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/source/admin/',
  cacheDir: path.resolve(adminDirectory, '../../node_modules/.vite/admin'),
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: path.resolve(adminDirectory, '../../services/api/admin-dist'),
    rollupOptions: {
      output: {
        assetFileNames: 'assets/admin.[ext]',
        chunkFileNames: 'assets/[name].js',
        entryFileNames: 'assets/admin.js',
      },
    },
    sourcemap: false,
  },
  plugins: [react()],
  root: adminDirectory,
  server: {
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
    },
  },
});
