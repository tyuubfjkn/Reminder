import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests run in a host timezone far from UTC so date-only shifts would surface.
process.env.TZ = 'Pacific/Kiritimati';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
});
