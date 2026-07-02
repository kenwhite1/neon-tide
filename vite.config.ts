import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 4740, strictPort: true, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
