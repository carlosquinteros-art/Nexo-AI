import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Configuración de Vite para Nexo.
 *
 * Notas de despliegue:
 *  · Cloudflare Pages sirve `dist/` como estático. No hay servidor propio,
 *    así que todo lo sensible vive en Supabase (RLS) o en Edge Functions.
 *  · Solo las variables con prefijo VITE_ llegan al bundle. Están pensadas
 *    para ser públicas: URL del proyecto y anon key.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icono.svg', 'icono-maskable.svg'],
      manifest: {
        name: 'Nexo — Asistente de Carlos',
        short_name: 'Nexo',
        description: 'Trabajo, universidad y vida personal en un solo lugar.',
        lang: 'es-CL',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#F4F6F9',
        theme_color: '#0D5C63',
        categories: ['productivity', 'education'],
        icons: [
          { src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icono-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        /* Nunca se cachean las llamadas a datos ni a autenticación. */
        navigateFallbackDenylist: [/^\/auth/, /^\/rest/, /^\/functions/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'tipografias', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/'),
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  },
  server: { port: 5173, host: true },
  preview: { port: 4173 }
});
