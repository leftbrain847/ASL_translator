// Fold the web build into one standalone page: web/asl-translator.html (committed; the index repo publishes it
// as this app's "Latest" on the public sprint site and homepage). Rebuild with `npm run build:web`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const app = JSON.parse(readFileSync('app.config.json', 'utf8'));
const dir = 'dist/web';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const css = /<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/.exec(html)?.[1];
const js = /<script type="module"[^>]*src="\.\/([^"]+)"/.exec(html)?.[1];
if (!css || !js) throw new Error('web/inline: the build is missing its script or stylesheet');
const extra = readdirSync(join(dir, 'assets')).filter((f) => `assets/${f}` !== css && `assets/${f}` !== js);
if (extra.length) throw new Error(`web/inline: the page must stand alone, but the build also wrote ${extra.join(', ')}`);
const style = readFileSync(join(dir, css), 'utf8');
const script = readFileSync(join(dir, js), 'utf8');
if (/<\/style/i.test(style)) throw new Error('web/inline: stylesheet contains "</style"');
// Only the pinned hosts may appear as load targets (the index's publish gate checks each against its lock).
const hosts = [...new Set([...script.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]))];
const allowed = new Set(['cdn.jsdelivr.net', 'storage.googleapis.com', 'www.w3.org', 'leftbrain847.github.io', 'goo.gle', 'github.com', 'developers.google.com', 'ai.google.dev']);
const unknown = hosts.filter((h) => !allowed.has(h));
if (unknown.length) throw new Error(`web/inline: unexpected hosts in the script: ${unknown.join(', ')}`);
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const page = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  `<title>${escape(app.title)}</title>`,
  '<meta name="description" content="Prototype ASL translator: speech to an ASL-signing avatar, and camera signing to English text and speech.">',
  '<!-- Includes MediaPipe Tasks Vision (Apache-2.0, https://github.com/google-ai-edge/mediapipe). -->',
  `<style>\n${style}</style>`,
  '</head>',
  '<body>',
  '<div id="app"></div>',
  `<script type="module">\n${script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>`,
  '</body>',
  '</html>',
  '',
].join('\n');
writeFileSync('web/asl-translator.html', page);
console.log(`wrote web/asl-translator.html (${page.length} bytes); hosts referenced: ${hosts.join(', ')}`);
