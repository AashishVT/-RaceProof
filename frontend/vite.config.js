import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: './src/test-setup.js',
    exclude: ['src/live.frontend.test.jsx', '**/node_modules/**', '**/dist/**'],
    css: false,
  },
  server: { host: '0.0.0.0' },
});
