import { defineConfig } from 'vite';
import config from '../app.config.json';

// The sprint demo: the whole app in one page that runs with no server (a Claude artifact, or the public sprint
// site). One JS chunk and one stylesheet, which demo/inline.mjs folds into a single file. Solo apps build their
// offline Play client; invite apps run the platform's real room in the page (src/client/demo.ts).
export default defineConfig({
  root: 'demo',
  base: './',
  mode: 'demo',
  define: config.mode === 'solo' ? { 'import.meta.env.VITE_TARGET': JSON.stringify('play') } : {},
  build: {
    outDir: '../dist/demo',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,   // images and fonts go inside the page: it must stand alone
    modulePreload: { polyfill: false },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
