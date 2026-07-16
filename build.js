#!/usr/bin/env node
/**
 * PuzzleHub — Production Build Pipeline
 *
 * Reads the human-readable source bundles (script.js / style.css) and emits a
 * fully optimized, production-ready asset tree:
 *
 *   • Splits the single concatenated script.js into a lean "main" bundle
 *     (core + features + data + pages + bootstrap) and per-game modules
 *     (js/games/*.min.js). Games are loaded on demand via GameRegistry,
 *     eliminating the ~214 KB of unused JS reported by Lighthouse.
 *   • Minifies the main bundle + every game module with Terser (ES2020,
 *     strips comments/console-free, mangles safely).
 *   • Minifies style.css with clean-css (merges layered overrides, removes
 *     whitespace, collapses redundant declarations).
 *
 * Usage:  node build.js
 * Output: script.min.js, style.min.css, js/games/*.min.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const terser = require('terser');
const CleanCSS = require('clean-css');

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// 1. JavaScript split + minify
// ---------------------------------------------------------------------------

const SECTION_RE = /\/\*\s*=====\s*(js\/[^\s*]+\.js|[^*]+?)\s*=====\s*\*\//g;

function readSrc(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function splitModules(src) {
  // Find all section markers and their byte offsets.
  const marks = [];
  let m;
  const re = new RegExp(SECTION_RE.source, 'g');
  while ((m = re.exec(src)) !== null) {
    marks.push({ name: m[1].trim(), index: m.index, end: re.lastIndex });
  }
  const sections = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const stop = i + 1 < marks.length ? marks[i + 1].index : src.length;
    sections.push({ name: marks[i].name, code: src.slice(start, stop) });
  }
  // Anything before the first marker (leading newline) is harmless preamble.
  return sections;
}

function isGame(name) {
  return name.startsWith('js/games/');
}

function banner(label) {
  return `/*! PuzzleHub ${label} — built ${new Date().toISOString().slice(0, 10)} */\n`;
}

async function minifyJs(code, label) {
  const out = await terser.minify(code, {
    compress: {
      passes: 2,
      drop_console: false, // keep guarded logger; console only fires in dev
      pure_funcs: null,
    },
    format: { comments: /^!/, max_line_len: false },
    ecma: 2020,
    safari10: true,
  });
  if (out.error) throw out.error;
  return out.code;
}

async function buildJs() {
  const src = readSrc('script.js');
  const sections = splitModules(src);

  let main = '';
  const games = {};
  for (const s of sections) {
    if (isGame(s.name)) {
      games[s.name] = (games[s.name] || '') + s.code;
    } else {
      main += s.code + '\n';
    }
  }

  // Emit game modules (both readable source + minified) so the registry can
  // load them on demand.
  const gamesDir = path.join(ROOT, 'js', 'games');
  fs.mkdirSync(gamesDir, { recursive: true });

  const minified = await minifyJs(banner('app') + main, 'app');
  fs.writeFileSync(path.join(ROOT, 'script.min.js'), minified);

  const sizes = { main: { raw: main.length, min: minified.length } };
  for (const [modName, code] of Object.entries(games)) {
    const base = path.basename(modName, '.js'); // e.g. sudoku
    fs.writeFileSync(path.join(gamesDir, base + '.js'), code.trim() + '\n');
    const min = await minifyJs(banner(modName) + code, modName);
    fs.writeFileSync(path.join(gamesDir, base + '.min.js'), min);
    sizes[modName] = { raw: code.length, min: min.length };
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// 2. CSS minify
// ---------------------------------------------------------------------------

async function buildCss() {
  const src = readSrc('style.css');
  const result = await new CleanCSS({
    level: {
      1: { all: true, specialComments: '1' },
      2: { mergeMediaQueries: true, restructureRules: true },
    },
  }).minify(src);

  if (result.errors && result.errors.length) {
    throw new Error('clean-css errors: ' + result.errors.join('; '));
  }
  const out =
    '/*! PuzzleHub styles — built ' +
    new Date().toISOString().slice(0, 10) +
    ' */\n' +
    result.styles;
  fs.writeFileSync(path.join(ROOT, 'style.min.css'), out);
  return { raw: src.length, min: out.length };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  console.log('• Building JavaScript bundles (code-split + minify)…');
  const jsSizes = await buildJs();
  console.log('• Minifying CSS…');
  const cssSizes = await buildCss();

  console.log('\n================ Build summary ================');
  let jsRawTotal = 0, jsMinTotal = 0;
  for (const [k, v] of Object.entries(jsSizes)) {
    jsRawTotal += v.raw; jsMinTotal += v.min;
    console.log(
      `  ${k.padEnd(28)} ${(v.raw / 1024).toFixed(1).padStart(7)} KB  ->  ${(v.min / 1024).toFixed(1).padStart(6)} KB`
    );
  }
  console.log(
    `  ${'JS TOTAL'.padEnd(28)} ${(jsRawTotal / 1024).toFixed(1).padStart(7)} KB  ->  ${(jsMinTotal / 1024).toFixed(1).padStart(6)} KB`
  );
  console.log(
    `  ${'style.css'.padEnd(28)} ${(cssSizes.raw / 1024).toFixed(1).padStart(7)} KB  ->  ${(cssSizes.min / 1024).toFixed(1).padStart(6)} KB`
  );
  console.log('==============================================');
})().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
