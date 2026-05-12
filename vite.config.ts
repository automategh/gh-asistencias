import fs from 'fs'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path"
import { VitePWA } from 'vite-plugin-pwa'

const tailwindPlugin = tailwindcss as () => PluginOption

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') // Carga variables de entorno sin prefijo
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8')) as { version?: string }

  const appVersion = env.VITE_APP_VERSION || packageJson.version || '0.0.0'
  const appPublishedAt = env.VITE_APP_PUBLISHED_AT || new Date().toISOString()

  return {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_APP_PUBLISHED_AT': JSON.stringify(appPublishedAt),
    },
    plugins: [
      react(),
      tailwindPlugin(),
      VitePWA({
        injectRegister: 'auto',
        registerType: 'autoUpdate',
        manifestFilename: 'manifest.webmanifest',
        includeAssets: ['Icon_gh.svg', 'Icon_gh180x180.png'],
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          skipWaiting: true,
          navigateFallbackDenylist: [/^\/api\//],
        },
        manifest: {
          name: 'GH Asistencias',
          short_name: 'GH Asistencias',
          start_url: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#000000',
          icons: [
            {
              src: '/Icon_gh180x180.png',
              sizes: '180x180',
              type: 'image/png',
            },
            {
              src: '/Icon_gh.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
            },
          ],
        },
      })
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
