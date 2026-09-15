import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Camera access (getUserMedia) requires a secure context.
// `npm run dev` on localhost is fine. To test on a phone on your
// wifi network, either use `vite --host` with HTTPS certs, or
// use a tunnel like `npx localtunnel --port 5173` / ngrok.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: true
  },
  resolve: {
    alias: {
      // mind-ar dist uses 'three/addons/...' path — map it to 'three/examples/jsm/...'
      'three/addons': path.resolve('./node_modules/three/examples/jsm'),
    },
  },
  optimizeDeps: {
    // Exclude mind-ar from Vite's pre-bundler — its ESM dist files should be
    // processed by rollup at build time, not pre-bundled by esbuild
    exclude: ['mind-ar'],
  },
})
