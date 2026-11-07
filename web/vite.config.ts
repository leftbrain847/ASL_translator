import { defineConfig } from 'vite';

// The public web page: the whole app, live camera included, as one HTML file (web/inline.mjs folds it).
// MediaPipe's JavaScript is bundled in; its WebAssembly runtime and models load from pinned CDN URLs, and
// only after the viewer allows the camera.
export default defineConfig({
  root: 'web',
  base: './',
  define: { 'import.meta.env.VITE_TARGET': JSON.stringify('web') },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: { polyfill: false },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
