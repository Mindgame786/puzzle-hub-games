/* Runtime smoke test: boot the minified main bundle in jsdom, then lazily
 * resolve each game module through GameRegistry and confirm the constructor
 * attaches. This proves the code-split did not break the dependency graph. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  // Point the script src at the built minified bundle.
  .replace('src="script.js"', 'src="script.min.js"');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://puzzle-hub.netlify.app/',
  pretendToBeVisual: true,
});
const { window } = dom;

// Polyfills the bundle expects.
window.matchMedia = window.matchMedia || (() => ({
  matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
}));
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.Perf = undefined; // allow bundle to define
if (!window.performance) window.performance = { now: () => Date.now(), mark() {}, measure() {} };

global.window = window;
global.document = window.document;
try { global.navigator = window.navigator; } catch (_) { /* read-only; bundle uses window.navigator */ }
global.requestIdleCallback = (fn) => setTimeout(() => fn({ didTimeout:false, timeRemaining(){return 5;} }), 0);
window.requestIdleCallback = global.requestIdleCallback;

// Inject & execute the main bundle inside the window context.
const mainJs = fs.readFileSync(path.join(__dirname, 'script.min.js'), 'utf8');
const scriptEl = window.document.createElement('script');
scriptEl.textContent = mainJs;
window.document.body.appendChild(scriptEl);

const errors = [];
window.addEventListener('error', (e) => errors.push(e.error || e.message));

setTimeout(() => {
  const PH = window.PH || {};
  const checks = [];
  const ok = (name, cond) => checks.push({ name, ok: !!cond });

  ok('window.Config defined', typeof window.Config === 'object');
  ok('window.Router defined', typeof window.Router === 'object');
  ok('window.GameRegistry defined', typeof window.GameRegistry === 'object');
  ok('window.GameBase defined', typeof window.GameBase === 'function');
  ok('9 games registered', window.GameRegistry.list().length === 9);
  ok('GamePage registered', typeof window.GamePage === 'object');
  ok('HomePage registered', typeof window.HomePage === 'object');

  // Now load each game module as the registry would and confirm the class.
  let pending = Promise.resolve();
  for (const id of window.GameRegistry.list()) {
    pending = pending.then(async () => {
      const def = window.GameRegistry.get(id);
      const file = path.join(__dirname, def.src);
      const code = fs.readFileSync(file, 'utf8');
      const s = window.document.createElement('script');
      s.textContent = code;
      window.document.body.appendChild(s);
      ok(`module ${id} -> ${def.cls}`, typeof window[def.cls] === 'function');
      ok(`${def.cls} extends GameBase`,
        typeof window[def.cls] === 'function' && window[def.cls].prototype instanceof window.GameBase);
    });
  }

  pending.then(async () => {
    const prevLen = checks.length;
    let allOk = true;
    for (const c of checks) {
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
      if (!c.ok) allOk = false;
    }

    // End-to-end render: home page + a live Sudoku mount.
    try {
      window.location.hash = '';
      await new Promise((r) => setTimeout(r, 50));
      window.Router.resolve();
      await new Promise((r) => setTimeout(r, 80));
      const main = window.document.getElementById('main-content');
      ok('Home page rendered hero', !!main && !!main.querySelector('.hero__title'));
      ok('Home rendered 9 game cards', main && main.querySelectorAll('.game-card').length === 9);
      ok('Footer present', !!window.document.querySelector('.app-footer'));
    } catch (e) { ok('Home render', false); console.log('  home err', e.message); }

    // Secondary pages must NOT be in the main bundle: load the chunk and verify
    // each secondary route renders. This mirrors the lazy load path.
    try {
      const secCode = fs.readFileSync(path.join(__dirname, 'js', 'pages-secondary.min.js'), 'utf8');
      const ss = window.document.createElement('script');
      ss.textContent = secCode;
      window.document.body.appendChild(ss);
      // Mark the chunk as loaded so the router's lazy loader resolves
      // synchronously (in jsdom there is no HTTP to fetch it).
      if (window.Perf && window.Perf.loaded) window.Perf.loaded.add('js/pages-secondary.min.js');
      ok('Secondary chunk parses + exports pages', typeof window.AboutPage === 'object');
      const secRoutes = [
        ['/about', '.content-page'],
        ['/how-to-play', '.guide-card'],
        ['/leaderboard', '.lb-list'],
        ['/community', '.tabs'],
        ['/blog', '.blog-grid'],
        ['/privacy-policy', '.content-page'],
        ['/contact', 'form'],
      ];
      for (const [route, selector] of secRoutes) {
        window.location.hash = '#' + route;
        try { await window.Router.resolve(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 40));
        const m = window.document.getElementById('main-content');
        ok(`route ${route} renders ${selector}`, !!m && !!m.querySelector(selector));
      }
    } catch (e) { ok('secondary chunk load', false); console.log('  sec err', e.message); }

    try {
      const Sudoku = window.SudokuGame;
      const host = window.document.createElement('div');
      const game = new Sudoku({ difficulty: 'easy', isDaily: false });
      await game.mount(host);
      ok('Sudoku mounted board', !!host.querySelector('.sudoku-board'));
      ok('Sudoku toolbar present', !!host.querySelector('.game-toolbar'));
    } catch (e) { ok('Sudoku mount', false); console.log('  sudoku err', e.message); }

    // Re-print only the end-to-end results.
    for (const c of checks.slice(prevLen)) {
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
      if (!c.ok) allOk = false;
    }
    if (errors.length) {
      console.log('\nWindow errors captured:');
      errors.forEach((e) => console.log('  -', e && e.message ? e.message : e));
      allOk = false;
    }
    console.log('===================================================');
    process.exit(allOk ? 0 : 1);
  }).catch((e) => { console.error('Test threw:', e); process.exit(1); });
}, 300);
