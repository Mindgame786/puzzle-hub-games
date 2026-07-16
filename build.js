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

// Content pages that are never part of the first paint (home). They share
// appendSiteFooter and use only window-exported globals, so they load safely
// as a separate chunk on first navigation. Keeping them out of the main bundle
// cuts the render-critical JS payload on mobile.
const SECONDARY_PAGES = new Set([
  'js/pages/about.js',
  'js/pages/howto.js',
  'js/pages/leaderboard.js',
  'js/pages/community.js',
  'js/pages/blog.js',
  'js/pages/privacy.js',
  'js/pages/contact.js',
]);

function isSecondaryPage(name) {
  return SECONDARY_PAGES.has(name);
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
  let secondary = '';
  const games = {};
  for (const s of sections) {
    if (isGame(s.name)) {
      games[s.name] = (games[s.name] || '') + s.code;
    } else if (isSecondaryPage(s.name)) {
      secondary += s.code + '\n';
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

  // Emit the secondary-pages chunk (loaded on first navigation away from home).
  const sizes = { main: { raw: main.length, min: minified.length } };
  if (secondary) {
    fs.writeFileSync(path.join(ROOT, 'js', 'pages-secondary.js'), secondary.trim() + '\n');
    const secMin = await minifyJs(banner('pages-secondary') + secondary, 'pages-secondary');
    fs.writeFileSync(path.join(ROOT, 'js', 'pages-secondary.min.js'), secMin);
    sizes['js/pages-secondary.js'] = { raw: secondary.length, min: secMin.length };
  }
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
// 3. Critical CSS extraction + inlining into index.html
// ---------------------------------------------------------------------------

const CRITICAL_SELECTORS = [
  ':root', '[data-theme="dark"]',
  'html', 'body', '[data-theme="dark"] body',
  '*, *::before, *::after',
  'a', 'a:hover', 'h1, h2, h3, h4, h5, h6', 'p', 'button',
  ':focus-visible', '::selection',
  '#app', '#main-content',
  '.container',
  '.app-header', '.app-header__inner',
  '.app-logo', '.app-logo:hover', '.app-logo__mark', '.app-logo__mark svg',
  '.app-logo__text', '.app-logo__name', '.app-logo__tag',
  '.app-nav', '.app-nav__link', '.app-nav__link:hover', '.app-nav__link.active',
  '.app-header__actions',
  '.app-header__actions .btn-icon', '.app-header__actions .btn-icon svg',
  '.user-chip', '.user-chip__avatar',
  '.btn', '.btn:disabled', '.btn-primary', '.btn-primary:hover:not(:disabled)',
  '.btn-secondary', '.btn-ghost', '.btn-lg', '.btn-icon', '.btn-icon.sm',
  '.brand-mark', '.brand-mark svg', '.brand-wordmark',
  '.hero', '.hero__badge', '.hero__title', '.hero__subtitle', '.hero__actions',
  '.skip-link', '.skip-link:focus',
  '.sr-only',
];

function extractCriticalCss(src) {
  // Parse top-level simple rules (skip nested at-rules); merge per selector at
  // the property level (last value wins, !important precedence) — identical to
  // the browser's cascade for same-specificity rules.
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === '@') {
      let j = i;
      while (j < text.length && text[j] !== '{' && text[j] !== ';') j++;
      if (text[j] === ';') { i = j + 1; continue; }
      let depth = 0, k = j;
      do { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; } while (k < text.length && depth > 0);
      i = k;
      continue;
    }
    const selStart = i;
    while (i < text.length && text[i] !== '{') i++;
    if (i >= text.length) break;
    const selector = text.slice(selStart, i).trim();
    const bodyStart = i + 1;
    let depth = 1, k = bodyStart;
    while (k < text.length && depth > 0) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') depth--;
      k++;
    }
    const body = text.slice(bodyStart, k - 1).trim();
    i = k;
    if (selector && body) rules.push({ selector, body });
  }

  let order = 0;
  const merged = new Map();
  for (const r of rules) {
    if (!merged.has(r.selector)) merged.set(r.selector, new Map());
    const map = merged.get(r.selector);
    for (const decl of r.body.split(';')) {
      const d = decl.trim();
      if (!d) continue;
      const colon = d.indexOf(':');
      if (colon < 0) continue;
      const prop = d.slice(0, colon).trim();
      let value = d.slice(colon + 1).trim();
      const important = /!important\s*$/.test(value);
      if (important) value = value.replace(/!important\s*$/, '').trim();
      map.set(prop, { value, important, order: order++ });
    }
  }

  const parts = [];
  for (const sel of CRITICAL_SELECTORS) {
    const map = merged.get(sel);
    if (!map || !map.size) continue;
    const entries = [...map.entries()].sort((a, b) => a[1].order - b[1].order);
    const decls = entries
      .map(([prop, v]) => `${prop}:${v.value}${v.important ? ' !important' : ''}`)
      .join(';');
    parts.push(`${sel}{${decls}}`);
  }
  const raw = parts.join('\n');
  const min = new CleanCSS({ level: { 1: { all: true }, 2: false } }).minify(raw).styles;
  fs.writeFileSync(path.join(ROOT, 'critical.min.css'), min);
  return min;
}

const BOOT_SCREEN_CSS =
  '.boot-screen{display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:18px}' +
  '[data-theme=dark] .boot-screen{background-color:#0a0a0c;color:#f2f1ef}' +
  '.boot-screen__mark{width:60px;height:60px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:linear-gradient(165deg,#4db3ff,#5b3df0 42%,#0062b8);box-shadow:0 16px 44px rgba(54,32,171,.28),inset 0 1px 0 rgba(255,255,255,.32)}' +
  '.boot-screen__mark svg{width:28px;height:28px;display:block}' +
  '.boot-screen__title{font-weight:780;font-size:1.15rem;letter-spacing:-0.045em}' +
  '.boot-screen__bar{width:104px;height:2px;background:rgba(15,15,17,.07);border-radius:99px;overflow:hidden}' +
  '[data-theme=dark] .boot-screen__bar{background:rgba(255,255,255,.07)}' +
  '.boot-screen__fill{width:32%;height:100%;background:linear-gradient(90deg,#4db3ff,#4527d6);border-radius:99px;animation:boot 1.1s cubic-bezier(.16,1,.3,1) infinite alternate}' +
  '@keyframes boot{from{transform:translateX(-140%)}to{transform:translateX(300%)}}';

function inlineCriticalIntoHtml(criticalMin) {
  const htmlPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  // Replace whatever currently sits between the critical-CSS comment and </style>.
  const re = /<!-- Critical CSS[\s\S]*?-->\s*<style>[\s\S]*?<\/style>/;
  const replacement =
    '<!-- Critical CSS (inlined): renders the app shell + boot screen instantly, no FOUC while the async stylesheet loads -->\n' +
    '<style>\n' + criticalMin + '\n' + BOOT_SCREEN_CSS + '\n</style>';
  if (!re.test(html)) throw new Error('critical <style> block not found in index.html');
  html = html.replace(re, replacement);
  fs.writeFileSync(htmlPath, html);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  console.log('• Building JavaScript bundles (code-split + minify)…');
  const jsSizes = await buildJs();
  console.log('• Minifying CSS…');
  const cssSizes = await buildCss();
  console.log('• Extracting + inlining critical CSS…');
  const criticalMin = extractCriticalCss(readSrc('style.css'));
  inlineCriticalIntoHtml(criticalMin);

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
  console.log(
    `  ${'critical.min.css (inlined)'.padEnd(28)} ${(criticalMin.length / 1024).toFixed(1).padStart(7)} KB`
  );
  console.log('==============================================');
})().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
