/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works under any GitHub Pages path (/<repo>/) or at a root.
  base: './',
  // Per-checkout cache: agent worktrees share node_modules via a junction, so the default
  // node_modules/.vite cache would collide between parallel dev servers.
  cacheDir: '.vite-cache',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
