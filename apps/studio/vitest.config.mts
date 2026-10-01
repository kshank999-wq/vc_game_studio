import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __LICENSING__: JSON.stringify(false), __EDITION__: JSON.stringify('full'), __APP_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    // Node by default; component tests opt into jsdom with a docblock.
    environment: 'node',
    // Component tests import lazy views (three.js among them) for real; give a busy machine room.
    testTimeout: 20000,
  },
});
