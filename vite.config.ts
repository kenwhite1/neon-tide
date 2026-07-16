import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // GG_HUB_URL нужен клиенту (своего сервера с окружением у игры нет), поэтому
  // пускаем этот префикс в бандл наравне с VITE_.
  envPrefix: ['VITE_', 'GG_'],
  server: { port: 4740, strictPort: true, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
