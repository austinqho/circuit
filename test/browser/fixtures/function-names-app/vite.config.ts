// Neutral fixture (TypeScript + Vite): the app's own config. The test adds
// Tracer's plugins on top of it, as a one-line install would.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
});
