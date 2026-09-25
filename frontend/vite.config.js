import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Where the dev proxy forwards /api. Override when 8000 is taken.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev proxy so the default (empty) VITE_API_URL works without CORS.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the heavy chart and map libraries out of the initial chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const path = id.split('\\').join('/').split('node_modules/').pop()
          if (path.startsWith('recharts') || path.startsWith('d3-')) return 'charts'
          if (path.startsWith('leaflet') || path.includes('react-leaflet')) return 'map'
          if (path.startsWith('react') || path.startsWith('scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: true,
    coverage: { reporter: ['text', 'html'], include: ['src/**/*.{js,jsx}'] },
  },
})
