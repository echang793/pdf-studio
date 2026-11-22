import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages /pdf-studio/).
  base: './',
  plugins: [
    react(),
    {
      // onnxruntime-web's bundles reference their .wasm files, so Vite would copy ~43 MB of them into the
      // site. We never use those copies: src/render/lama.ts downloads the pinned files from jsDelivr,
      // checks their SHA-256 and hands them to the engine directly.
      name: 'drop-unused-ort-wasm',
      generateBundle(_, bundle) {
        for (const name of Object.keys(bundle)) if (name.endsWith('.wasm')) delete bundle[name]
      },
    },
  ],
})
