import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev and preview servers proxy /api to the API so the browser sees one origin,
// exactly like Caddy in production. changeOrigin stays false so Better Auth sees the browser's Host.
// xfwd adds X-Forwarded-For (like Caddy) so the API's per-IP rate limits work locally.
const apiProxy = { '/api': { target: 'http://localhost:3000', changeOrigin: false, xfwd: true } };

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
