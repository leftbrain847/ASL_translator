import { defineConfig } from 'vite';
import config from './app.config.json';

// Friends build: served at /<id>/ on the shared hostname. Play build: bundled into the app, relative paths.
const play = process.env.VITE_TARGET === 'play';

export default defineConfig({
  base: play ? './' : `/${config.id}/`,
  build: {
    outDir: play ? 'dist/play' : 'dist/friends',
    emptyOutDir: true,
    // The host's CSP forbids inline scripts and styles; keep every asset a separate file.
    assetsInlineLimit: 0,
    // Vite's preload polyfill calls fetch(); every target browser supports modulepreload natively.
    modulePreload: { polyfill: false },
  },
});
