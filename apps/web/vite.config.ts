import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin in dev, so the API needs no CORS configuration.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
