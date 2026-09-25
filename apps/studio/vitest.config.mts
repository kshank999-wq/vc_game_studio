import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __EDITION__: JSON.stringify('full') },
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    // Node by default; component tests opt into jsdom with a docblock.
    environment: 'node',
  },
});
