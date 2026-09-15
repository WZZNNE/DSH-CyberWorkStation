// Build README.zh.md and the two showcase HTML files from the content modules.
// README.zh.md is GENERATED: edit content/*.mjs, then run `node docs/showcase-src/build.mjs` from anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import meta from './meta.mjs';
import diagrams from './diagrams.mjs';
import { renderMarkdown } from './render-md.mjs';
import { renderHtml } from './render-html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const contentDir = path.join(here, 'content');
const files = fs.readdirSync(contentDir).filter((f) => f.endsWith('.mjs')).sort();
const sections = [];
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(contentDir, f)).href);
  const v = mod.default;
  if (Array.isArray(v)) sections.push(...v); else sections.push(v);
}
const doc = { meta, sections };

const mdOut = path.join(REPO, 'README.zh.md');
const GENERATED = '<!-- GENERATED FILE: built by docs/showcase-src/build.mjs from docs/showcase-src/content/*.mjs. Edit the sources, then run: node docs/showcase-src/build.mjs -->\n\n';
fs.writeFileSync(mdOut, GENERATED + renderMarkdown(doc), 'utf8');

const css = fs.readFileSync(path.join(here, 'shell.css'), 'utf8');
const js = fs.readFileSync(path.join(here, 'shell.js'), 'utf8');
const outDir = path.join(REPO, 'docs/showcase');
fs.mkdirSync(outDir, { recursive: true });
const linked = renderHtml(doc, { css, js, diagrams, inline: false, imgBase: '../screenshots/2026-09' });
fs.writeFileSync(path.join(outDir, 'index.html'), linked, 'utf8');
const inlined = renderHtml(doc, { css, js, diagrams, inline: true });
fs.writeFileSync(path.join(outDir, 'DSH-CyberWorkStation-showcase.html'), inlined, 'utf8');

const figs = sections.reduce((n, s) => n + s.blocks.filter((b) => b.type === 'figure').length, 0);
const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log(`sections ${sections.length} · figures ${figs}`);
console.log(`README.zh.md ${kb(mdOut)}`);
console.log(`docs/showcase/index.html ${kb(path.join(outDir, 'index.html'))}`);
console.log(`docs/showcase/DSH-CyberWorkStation-showcase.html ${kb(path.join(outDir, 'DSH-CyberWorkStation-showcase.html'))}`);
