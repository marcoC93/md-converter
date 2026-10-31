import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [vue()],
  server: {
    // Solo loopback, come il backend: il server di sviluppo non è raggiungibile dalla LAN.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // Il browser vede un'unica origine: niente CORS da configurare.
      // changeOrigin resta false: Host e Origin devono coincidere per superare il controllo anti-CSRF del backend.
      '/api': { target: backendUrl, changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
