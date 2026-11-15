import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:3198/' } },
    setupFiles: './src/test-setup.js',
    include: ['src/live.frontend.test.jsx'],
    testTimeout: 90000,
    hookTimeout: 30000,
  },
});
