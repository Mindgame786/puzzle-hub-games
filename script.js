
/* ===== js/core/config.js ===== */
/**
 * PuzzleHub — Application Configuration
 * Single source of truth for environment, features, and limits.
 * Override at runtime: window.PH_CONFIG = { ... }
 */
const Config = (() => {
  const defaults = Object.freeze({
    appName: 'PuzzleHub',
    version: '4.0.0',
    env: 'production',
    /** Optional API base for Cloud adapter */
    cloudEndpoint: null,
    features: Object.freeze({
      pwa: true,
      analytics: true,
      voice: true,
      ads: true,
      offlineSync: true,
      lazyGames: true,
      abTesting: true,
    }),
    performance: Object.freeze({
      gamePrefetchIdleMs: 3500,
      swRegisterIdleMs: 2500,
      autosaveIntervalMs: 15000,
      maxUndo: 100,
      maxLeaderboard: 100,
      maxSyncQueue: 200,
    }),
    security: Object.freeze({
      maxDisplayName: 20,
      allowedDifficulties: Object.freeze(['easy', 'medium', 'hard', 'expert', 'normal']),
    }),
    seo: Object.freeze({
      defaultTitle: 'PuzzleHub',
      titleTemplate: '%s — PuzzleHub',
    }),
  });

  function merge(base, over) {
    if (!over || typeof over !== 'object') return base;
    const out = { ...base };
    for (const k of Object.keys(over)) {
      if (
        over[k] &&
        typeof over[k] === 'object' &&
        !Array.isArray(over[k]) &&
        base[k] &&
        typeof base[k] === 'object'
      ) {
        out[k] = { ...base[k], ...over[k] };
      } else if (over[k] !== undefined) {
        out[k] = over[k];
      }
    }
    return out;
  }

  const runtime =
    typeof window !== 'undefined' && window.PH_CONFIG && typeof window.PH_CONFIG === 'object'
      ? window.PH_CONFIG
      : {};

  // Cloud endpoint convenience
  if (typeof window !== 'undefined' && window.PH_CLOUD_ENDPOINT && !runtime.cloudEndpoint) {
    runtime.cloudEndpoint = window.PH_CLOUD_ENDPOINT;
  }

  const value = Object.freeze(merge(defaults, runtime));

  function get(path, fallback) {
    if (!path) return value;
    const parts = String(path).split('.');
    let cur = value;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  }

  function isFeature(name) {
    return !!(value.features && value.features[name]);
  }

  return { defaults, value, get, isFeature };
})();

if (typeof window !== 'undefined') {
  window.Config = Config;
  window.PH = window.PH || {};
  window.PH.config = Config.value;
  window.PH.version = Config.value.version;
}



/* ===== js/core/globals.js ===== */
/**
 * PuzzleHub — Explicit window exports
 * Ensures globals work in every host (iframe previews, strict environments).
 * Call window.PH.export(name, value) or rely on auto-bridge below.
 */
window.PH = window.PH || { version: '3.0.0' };

window.PH.export = function (name, value) {
  window[name] = value;
  window.PH[name] = value;
  return value;
};

/** Bridge top-level script bindings if the host didn't attach them to window */
window.PH.bridge = function () {
  // no-op placeholder; individual modules call PH.export
};



/* ===== js/core/logger.js ===== */
/**
 * PuzzleHub — Structured Logger
 * Levels: debug | info | warn | error
 * Production defaults to warn+; set Config env development for debug.
 */
const Logger = (() => {
  const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
  let min = 30;

  function resolveLevel() {
    try {
      const env = (typeof Config !== 'undefined' && Config.get('env')) || 'production';
      min = env === 'development' || env === 'dev' ? 10 : 30;
      if (typeof window !== 'undefined' && window.PH_LOG_LEVEL && levels[window.PH_LOG_LEVEL] != null) {
        min = levels[window.PH_LOG_LEVEL];
      }
    } catch {
      min = 30;
    }
  }

  function log(level, msg, meta) {
    resolveLevel();
    if (levels[level] < min) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg: String(msg),
      ...(meta && typeof meta === 'object' ? meta : meta != null ? { data: meta } : {}),
    };
    const line = `[PH ${level}] ${payload.msg}`;
    try {
      if (level === 'error') console.error(line, meta || '');
      else if (level === 'warn') console.warn(line, meta || '');
      else if (level === 'info') console.info(line, meta || '');
      else console.debug(line, meta || '');
    } catch {
      /* ignore console failures */
    }
    try {
      if (typeof Events !== 'undefined') Events.emit('log', payload);
    } catch {
      /* */
    }
    return payload;
  }

  return {
    debug: (m, meta) => log('debug', m, meta),
    info: (m, meta) => log('info', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    error: (m, meta) => log('error', m, meta),
  };
})();

if (typeof window !== 'undefined') {
  window.Logger = Logger;
  if (window.PH) window.PH.Logger = Logger;
}



/* ===== js/core/errors.js ===== */
/**
 * PuzzleHub — Error Boundary & Recovery
 * Centralizes uncaught errors, promise rejections, and user-facing fallbacks.
 */
const ErrorBoundary = (() => {
  let installed = false;
  const recent = [];
  const MAX = 30;

  function record(err, context) {
    const entry = {
      at: Date.now(),
      message: err && err.message ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 800) : null,
      context: context || null,
    };
    recent.push(entry);
    if (recent.length > MAX) recent.shift();
    try {
      if (typeof Logger !== 'undefined') Logger.error(entry.message, { context, stack: entry.stack });
      else console.error('[PH]', entry);
    } catch {
      /* */
    }
    try {
      if (typeof Analytics !== 'undefined') {
        Analytics.track('js_error', {
          message: entry.message.slice(0, 120),
          context: context || 'unknown',
        });
      }
    } catch {
      /* */
    }
    return entry;
  }

  function showFatal(err) {
    const app = document.getElementById('app');
    if (!app) return;
    const msg = (err && err.message) ? err.message : String(err);
    const safe = String(msg)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    app.innerHTML =
      '<div style="max-width:480px;margin:10vh auto;padding:28px;font-family:system-ui,sans-serif;text-align:center">' +
      '<div style="width:56px;height:56px;margin:0 auto 16px;border-radius:14px;background:linear-gradient(165deg,#7c62f5,#4527d6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">!</div>' +
      '<h1 style="font-size:1.25rem;margin:0 0 8px;letter-spacing:-0.03em">Something went wrong</h1>' +
      '<p style="color:#64748b;font-size:14px;line-height:1.55;margin:0 0 16px">PuzzleHub hit an unexpected error. Your progress is usually safe on this device.</p>' +
      '<pre style="text-align:left;background:#f4f3f0;padding:12px;border-radius:12px;font-size:12px;overflow:auto;color:#b91c1c;max-height:140px">' +
      safe +
      '</pre>' +
      '<button type="button" onclick="location.reload()" style="margin-top:16px;padding:12px 18px;border:0;border-radius:12px;background:linear-gradient(180deg,#2f96f0,#4527d6);color:#fff;font-weight:600;cursor:pointer;font-size:14px">Reload app</button>' +
      '</div>';
  }

  function install() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    window.addEventListener('error', (e) => {
      record(e.error || e.message, 'window.error');
    });

    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason || 'unhandledrejection';
      record(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledrejection');
    });
  }

  function wrap(fn, context) {
    return function wrapped() {
      try {
        const result = fn.apply(this, arguments);
        if (result && typeof result.then === 'function') {
          return result.catch((err) => {
            record(err, context || 'async');
            throw err;
          });
        }
        return result;
      } catch (err) {
        record(err, context || 'sync');
        throw err;
      }
    };
  }

  function getRecent() {
    return recent.slice();
  }

  return { install, record, showFatal, wrap, getRecent };
})();

if (typeof window !== 'undefined') {
  window.ErrorBoundary = ErrorBoundary;
  if (window.PH) window.PH.ErrorBoundary = ErrorBoundary;
}



/* ===== js/core/storage.js ===== */
/**
 * PuzzleHub — Persistent Storage Layer
 * localStorage with namespacing, versioning, and safe JSON handling.
 */
const Storage = (() => {
  const PREFIX = 'ph_';
  const VERSION = 1;

  function key(k) {
    return PREFIX + k;
  }

  function get(k, fallback = null) {
    try {
      const raw = localStorage.getItem(key(k));
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function set(k, value) {
    try {
      localStorage.setItem(key(k), JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Storage set failed:', e);
      return false;
    }
  }

  function remove(k) {
    try {
      localStorage.removeItem(key(k));
    } catch { /* ignore */ }
  }

  function getGameState(gameId) {
    return get(`game_${gameId}`, null);
  }

  function setGameState(gameId, state) {
    return set(`game_${gameId}`, { ...state, savedAt: Date.now() });
  }

  function clearGameState(gameId) {
    remove(`game_${gameId}`);
  }

  function getSettings() {
    return get('settings', {
      theme: 'system',
      sound: true,
      soundVolume: 0.5,
      animations: true,
      showTimer: true,
      confirmRestart: true,
      highlightRelated: true,
      autoCheck: false,
      vibration: true,
      locale: 'en',
    });
  }

  function setSettings(settings) {
    return set('settings', settings);
  }

  function getStats() {
    return get('stats', {
      gamesPlayed: 0,
      gamesWon: 0,
      totalTime: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayDate: null,
      byGame: {},
    });
  }

  function setStats(stats) {
    return set('stats', stats);
  }

  function getAchievements() {
    return get('achievements', {});
  }

  function setAchievements(data) {
    return set('achievements', data);
  }

  function getProfile() {
    return get('profile', {
      name: 'Player',
      avatar: '🧩',
      createdAt: Date.now(),
    });
  }

  function setProfile(profile) {
    return set('profile', profile);
  }

  function getDailyProgress() {
    return get('daily', {});
  }

  function setDailyProgress(data) {
    return set('daily', data);
  }

  return {
    get, set, remove,
    getGameState, setGameState, clearGameState,
    getSettings, setSettings,
    getStats, setStats,
    getAchievements, setAchievements,
    getProfile, setProfile,
    getDailyProgress, setDailyProgress,
  };
})();
if (typeof window !== 'undefined') { window.Storage = Storage; if (window.PH) window.PH.Storage = Storage; }



/* ===== js/core/events.js ===== */
/**
 * PuzzleHub — Lightweight Event Bus
 */
const Events = (() => {
  const listeners = new Map();

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
  }

  function once(event, fn) {
    const wrap = (...args) => {
      off(event, wrap);
      fn(...args);
    };
    return on(event, wrap);
  }

  function off(event, fn) {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  }

  function emit(event, data) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch (e) {
        console.error(`Event handler error [${event}]:`, e);
      }
    }
  }

  function clear(event) {
    if (event) listeners.delete(event);
    else listeners.clear();
  }

  return { on, once, off, emit, clear };
})();
if (typeof window !== 'undefined') { window.Events = Events; if (window.PH) window.PH.Events = Events; }



/* ===== js/core/utils.js ===== */
/**
 * PuzzleHub — Shared Utilities
 */
const Utils = (() => {
  /** Fisher-Yates shuffle (mutates & returns) */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Random integer in [min, max] inclusive */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Pick random element */
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** Deep clone via JSON */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Format seconds as mm:ss or h:mm:ss */
  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** Format date as YYYY-MM-DD in local timezone */
  function dateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Seeded PRNG (mulberry32) for daily challenges */
  function seededRandom(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Hash string to 32-bit int */
  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return h;
  }

  /** Daily seed from date string */
  function dailySeed(dateStr = dateKey()) {
    return hashStr('puzzlehub-daily-' + dateStr);
  }

  /** Debounce */
  function debounce(fn, ms = 200) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /** Throttle */
  function throttle(fn, ms = 100) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn(...args);
      }
    };
  }

  /** Escape HTML */
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /** Create element with attributes and children */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k === 'innerHTML') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset') {
        Object.assign(node.dataset, v);
      } else if (v !== undefined && v !== null) {
        node.setAttribute(k, v);
      }
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  /** SVG icon helper — refined 1.75 stroke, optical center */
  function icon(name, size = 20) {
    const icons = {
      home: `<path d="M4 10.5L12 3.5l8 7V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9.5z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/>`,
      sun: `<circle cx="12" cy="12" r="3.75" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M12 2.5v1.75M12 19.75V21.5M4.4 4.4l1.25 1.25M18.35 18.35l1.25 1.25M2.5 12H4.25M19.75 12H21.5M4.4 19.6l1.25-1.25M18.35 5.65l1.25-1.25" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>`,
      moon: `<path d="M20.5 14.2A7.75 7.75 0 1110.3 3.5 6.5 6.5 0 0020.5 14.2z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/>`,
      settings: `<circle cx="12" cy="12" r="2.75" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M12 2.75v1.5M12 19.75v1.5M4.55 4.55l1.05 1.05M18.4 18.4l1.05 1.05M2.75 12h1.5M19.75 12h1.5M4.55 19.45l1.05-1.05M18.4 5.6l1.05-1.05" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>`,
      user: `<circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M5 19.5c0-3.45 3.15-6 7-6s7 2.55 7 6" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round"/>`,
      back: `<path d="M14.5 6L8.5 12l6 6" stroke="currentColor" stroke-width="1.85" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      undo: `<path d="M4 10.5h9a4.5 4.5 0 010 9H9.5" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round"/><path d="M7.5 7L4 10.5 7.5 14" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      redo: `<path d="M20 10.5h-9a4.5 4.5 0 000 9H14.5" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round"/><path d="M16.5 7L20 10.5 16.5 14" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      hint: `<path d="M9.5 17.5h5M10.25 20.5h3.5M12 3.5a5.5 5.5 0 00-3.6 9.6V15h7.2v-1.9A5.5 5.5 0 0012 3.5z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      erase: `<path d="M7.5 20.5h9M6 13.5l5.6-5.6a1.8 1.8 0 012.55 0l2.1 2.1a1.8 1.8 0 010 2.55L10.6 18.5H6v-5z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      pause: `<rect x="7" y="5" width="3.25" height="14" rx="1" fill="currentColor"/><rect x="13.75" y="5" width="3.25" height="14" rx="1" fill="currentColor"/>`,
      play: `<path d="M8.5 6.2v11.6L18 12 8.5 6.2z" fill="currentColor"/>`,
      restart: `<path d="M3.5 5v5.5H9" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 19v-5.5H15" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.7 9.2A7.5 7.5 0 006.4 6.8L3.5 10.5m17 3l-2.9 3.7A7.5 7.5 0 015.3 14.8" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      check: `<path d="M5.5 12.5l4 4L18.5 7.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="1.85" fill="none" stroke-linecap="round"/>`,
      trophy: `<path d="M8.5 20.5h7M12 17v3.5M7.5 4.5h9v4.5a4.5 4.5 0 01-9 0V4.5zM7.5 4.5H4.75A.75.75 0 004 5.25v.75a3.5 3.5 0 003.5 3.5M16.5 4.5h2.75a.75.75 0 01.75.75v.75a3.5 3.5 0 01-3.5 3.5" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      fire: `<path d="M12 3c0 3.5-2.5 4.5-2.5 8a2.5 2.5 0 005 0c0-1.8 1.8-2.8 1.8-5.5C14.8 6.2 13.5 7 12 3z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/>`,
      menu: `<path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>`,
      note: `<path d="M12.5 19.5H20.5M16.2 4.3a1.9 1.9 0 012.7 2.7L8 18.1l-3.5.9.9-3.5L16.2 4.3z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      info: `<circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M12 16v-4M12 8.25h.01" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"/>`,
      star: `<path d="M12 3.2l2.55 5.35 5.9.75-4.35 4 1.15 5.85L12 16.4l-5.25 2.75 1.15-5.85-4.35-4 5.9-.75L12 3.2z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`,
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${icons[name] || ''}</svg>`;
  }

  /** Confetti celebration */
  function confetti(duration = 2500) {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#3366ff', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: randInt(6, 12),
      h: randInt(8, 16),
      color: pick(colors),
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
    }));
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (elapsed > duration) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.vy += 0.05;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** Vibrate if supported and enabled */
  function vibrate(ms = 10) {
    const s = Storage.getSettings();
    if (s.vibration && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  }

  return {
    shuffle, randInt, pick, clone, formatTime, dateKey,
    seededRandom, hashStr, dailySeed, debounce, throttle,
    escapeHtml, el, icon, confetti, vibrate,
  };
})();
if (typeof window !== 'undefined') { window.Utils = Utils; if (window.PH) window.PH.Utils = Utils; }



/* ===== js/core/security.js ===== */
/**
 * PuzzleHub — Client security helpers
 * XSS-safe rendering, safe external links, CSP-friendly patterns.
 */
const Security = (() => {
  /** Escape HTML entities */
  function escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Sanitize user-provided display name */
  function sanitizeName(name, max = 20) {
    return escape(String(name || 'Player').trim().slice(0, max));
  }

  /** Open external URL safely */
  function openExternal(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
      const a = document.createElement('a');
      a.href = u.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    } catch { /* invalid url */ }
  }

  /** Validate difficulty against allowlist */
  function safeDifficulty(value, allowed = ['easy', 'medium', 'hard', 'expert', 'normal']) {
    return allowed.includes(value) ? value : allowed[0];
  }

  /** Validate game id against catalog */
  function safeGameId(id) {
    if (typeof GAME_MAP !== 'undefined' && GAME_MAP[id]) return id;
    return null;
  }

  return { escape, sanitizeName, openExternal, safeDifficulty, safeGameId };
})();
if (typeof window !== 'undefined') { window.Security = Security; if (window.PH) window.PH.Security = Security; }



/* ===== js/core/i18n.js ===== */
/**
 * PuzzleHub — Lightweight i18n (multi-language ready)
 * Default locale: en. Add packs via I18n.register('es', { ... }).
 * Usage: I18n.t('key') or I18n.t('key', { name: 'Sudoku' })
 */
const I18n = (() => {
  const dicts = {
    en: {
      'app.name': 'PuzzleHub',
      'nav.games': 'Games',
      'nav.guides': 'Guides',
      'nav.about': 'About',
      'nav.profile': 'Profile',
      'nav.settings': 'Settings',
      'hero.title': 'Puzzle your mind.',
      'hero.subtitle': 'Premium brain-training puzzles. Sudoku, crosswords, nonograms, and more — beautifully crafted for focus and fun.',
      'hero.daily': 'Play Daily Challenge',
      'hero.browse': 'Browse Games',
      'hero.badge': 'Free · Offline · Privacy-first',
      'daily.label': 'Daily Challenge',
      'daily.done': 'Completed today!',
      'daily.cta': 'Play Now',
      'daily.replay': 'Replay',
      'daily.desc': 'A fresh puzzle every day. Build your streak!',
      'games.heading': 'All Games',
      'filter.all': 'All',
      'filter.logic': 'Logic',
      'filter.word': 'Word',
      'filter.arcade': 'Arcade',
      'game.playAgain': 'Play Again',
      'game.home': 'Home',
      'game.solved': 'Puzzle Solved!',
      'game.time': 'Time',
      'game.moves': 'Moves',
      'game.hints': 'Hints',
      'game.share': 'Share',
      'game.pause': 'Pause',
      'game.resume': 'Resume',
      'game.paused': 'Paused',
      'game.loading': 'Loading puzzle…',
      'game.notFound': 'Game not found',
      'game.undo': 'Undo',
      'game.redo': 'Redo',
      'game.hint': 'Hint',
      'game.restart': 'Restart',
      'diff.easy': 'Easy',
      'diff.medium': 'Medium',
      'diff.hard': 'Hard',
      'diff.expert': 'Expert',
      'diff.normal': 'Normal',
      'toast.offline': 'You can keep playing — progress saves locally.',
      'toast.online': 'Connection restored.',
      'install.title': 'Install PuzzleHub',
      'install.body': 'Play offline from your home screen.',
      'install.cta': 'Install',
      'install.dismiss': 'Not now',
      'error.load': 'Could not load this game. Check your connection and try again.',
      'share.text': 'I solved {name} in {time} on PuzzleHub!',
    },
  };


  // Example secondary locale — extend freely via I18n.register()
  dicts.es = {
    'app.name': 'PuzzleHub',
    'nav.games': 'Juegos',
    'nav.guides': 'Guías',
    'nav.about': 'Acerca de',
    'nav.profile': 'Perfil',
    'nav.settings': 'Ajustes',
    'hero.title': 'Entrena tu mente.',
    'hero.subtitle': 'Puzzles premium para el cerebro. Sudoku, crucigramas, nonogramas y más.',
    'hero.daily': 'Reto diario',
    'hero.browse': 'Ver juegos',
    'hero.badge': 'Gratis · Offline · Privacidad',
    'daily.label': 'Reto diario',
    'daily.done': '¡Completado hoy!',
    'daily.cta': 'Jugar',
    'daily.replay': 'Repetir',
    'daily.desc': 'Un puzzle nuevo cada día. ¡Mantén tu racha!',
    'games.heading': 'Todos los juegos',
    'filter.all': 'Todos',
    'filter.logic': 'Lógica',
    'filter.word': 'Palabras',
    'filter.arcade': 'Arcade',
    'game.playAgain': 'Jugar de nuevo',
    'game.home': 'Inicio',
    'game.solved': '¡Puzzle resuelto!',
    'game.time': 'Tiempo',
    'game.moves': 'Movimientos',
    'game.hints': 'Pistas',
    'game.share': 'Compartir',
    'game.pause': 'Pausa',
    'game.resume': 'Continuar',
    'game.paused': 'En pausa',
    'game.loading': 'Cargando puzzle…',
    'game.notFound': 'Juego no encontrado',
    'game.undo': 'Deshacer',
    'game.redo': 'Rehacer',
    'game.hint': 'Pista',
    'game.restart': 'Reiniciar',
    'toast.offline': 'Puedes seguir jugando — el progreso se guarda aquí.',
    'toast.online': 'Conexión restaurada.',
    'install.title': 'Instalar PuzzleHub',
    'install.body': 'Juega sin conexión desde tu pantalla de inicio.',
    'install.cta': 'Instalar',
    'install.dismiss': 'Ahora no',
    'error.load': 'No se pudo cargar el juego. Revisa la conexión e inténtalo de nuevo.',
    'share.text': '¡Resolví {name} en {time} en PuzzleHub!',
  };


  // Extended language packs (shell UI; missing keys fall back to English)

  dicts.fr = Object.assign({}, dicts.en, {
    'nav.games': 'Jeux',
    'nav.guides': 'Guides',
    'nav.about': 'À propos',
    'nav.profile': 'Profil',
    'nav.settings': 'Réglages',
    'hero.title': 'Exercez votre esprit.',
    'hero.daily': 'Défi du jour',
    'hero.browse': 'Voir les jeux',
    'hero.badge': 'Gratuit · Hors ligne · Privé',
    'games.heading': 'Tous les jeux',
    'filter.all': 'Tous',
    'filter.logic': 'Logique',
    'filter.word': 'Mots',
    'filter.arcade': 'Arcade',
    'game.solved': 'Puzzle résolu !',
    'game.share': 'Partager',
    'game.pause': 'Pause',
    'game.resume': 'Reprendre',
    'daily.label': 'Défi quotidien',
    'daily.cta': 'Jouer',
  });

  dicts.de = Object.assign({}, dicts.en, {
    'nav.games': 'Spiele',
    'nav.guides': 'Anleitungen',
    'nav.about': 'Über uns',
    'nav.profile': 'Profil',
    'nav.settings': 'Einstellungen',
    'hero.title': 'Fordere deinen Geist.',
    'hero.daily': 'Tägliche Herausforderung',
    'hero.browse': 'Spiele entdecken',
    'hero.badge': 'Kostenlos · Offline · Privat',
    'games.heading': 'Alle Spiele',
    'filter.all': 'Alle',
    'filter.logic': 'Logik',
    'filter.word': 'Wörter',
    'filter.arcade': 'Arcade',
    'game.solved': 'Rätsel gelöst!',
    'game.share': 'Teilen',
    'game.pause': 'Pause',
    'game.resume': 'Weiter',
    'daily.label': 'Tägliche Herausforderung',
    'daily.cta': 'Spielen',
  });

  dicts.pt = Object.assign({}, dicts.en, {
    'nav.games': 'Jogos',
    'nav.guides': 'Guias',
    'nav.about': 'Sobre',
    'nav.profile': 'Perfil',
    'nav.settings': 'Definições',
    'hero.title': 'Desafie a sua mente.',
    'hero.daily': 'Desafio diário',
    'hero.browse': 'Ver jogos',
    'hero.badge': 'Grátis · Offline · Privado',
    'games.heading': 'Todos os jogos',
    'filter.all': 'Todos',
    'filter.logic': 'Lógica',
    'filter.word': 'Palavras',
    'filter.arcade': 'Arcade',
    'game.solved': 'Puzzle resolvido!',
    'game.share': 'Partilhar',
    'game.pause': 'Pausa',
    'game.resume': 'Continuar',
    'daily.label': 'Desafio diário',
    'daily.cta': 'Jogar',
  });

  dicts.it = Object.assign({}, dicts.en, {
    'nav.games': 'Giochi',
    'nav.guides': 'Guide',
    'nav.about': 'Info',
    'nav.profile': 'Profilo',
    'nav.settings': 'Impostazioni',
    'hero.title': 'Allena la mente.',
    'hero.daily': 'Sfida giornaliera',
    'hero.browse': 'Sfoglia giochi',
    'hero.badge': 'Gratis · Offline · Privacy',
    'games.heading': 'Tutti i giochi',
    'filter.all': 'Tutti',
    'filter.logic': 'Logica',
    'filter.word': 'Parole',
    'filter.arcade': 'Arcade',
    'game.solved': 'Puzzle risolto!',
    'game.share': 'Condividi',
    'game.pause': 'Pausa',
    'game.resume': 'Riprendi',
    'daily.label': 'Sfida del giorno',
    'daily.cta': 'Gioca',
  });

  dicts.hi = Object.assign({}, dicts.en, {
    'nav.games': 'खेल',
    'nav.guides': 'गाइड',
    'nav.about': 'परिचय',
    'nav.profile': 'प्रोफ़ाइल',
    'nav.settings': 'सेटिंग्स',
    'hero.title': 'दिमाग को रोमांच दें।',
    'hero.daily': 'दैनिक चुनौती',
    'hero.browse': 'खेल देखें',
    'hero.badge': 'मुफ़्त · ऑफ़लाइन · निजी',
    'games.heading': 'सभी खेल',
    'filter.all': 'सभी',
    'filter.logic': 'तर्क',
    'filter.word': 'शब्द',
    'filter.arcade': 'आर्केड',
    'game.solved': 'पहेली हल!',
    'game.share': 'शेयर',
    'game.pause': 'रोकें',
    'game.resume': 'जारी',
    'daily.label': 'दैनिक चुनौती',
    'daily.cta': 'खेलें',
  });

  dicts.ar = Object.assign({}, dicts.en, {
    'nav.games': 'ألعاب',
    'nav.guides': 'أدلة',
    'nav.about': 'حول',
    'nav.profile': 'الملف',
    'nav.settings': 'إعدادات',
    'hero.title': 'مرّن عقلك.',
    'hero.daily': 'تحدي اليوم',
    'hero.browse': 'تصفح الألعاب',
    'hero.badge': 'مجاني · دون اتصال · خصوصية',
    'games.heading': 'كل الألعاب',
    'filter.all': 'الكل',
    'filter.logic': 'منطق',
    'filter.word': 'كلمات',
    'filter.arcade': 'أركيد',
    'game.solved': 'تم الحل!',
    'game.share': 'مشاركة',
    'game.pause': 'إيقاف',
    'game.resume': 'متابعة',
    'daily.label': 'التحدي اليومي',
    'daily.cta': 'العب',
  });

  dicts.zh = Object.assign({}, dicts.en, {
    'nav.games': '游戏',
    'nav.guides': '指南',
    'nav.about': '关于',
    'nav.profile': '个人',
    'nav.settings': '设置',
    'hero.title': '锻炼你的思维。',
    'hero.daily': '每日挑战',
    'hero.browse': '浏览游戏',
    'hero.badge': '免费 · 离线 · 隐私',
    'games.heading': '全部游戏',
    'filter.all': '全部',
    'filter.logic': '逻辑',
    'filter.word': '文字',
    'filter.arcade': '街机',
    'game.solved': '已完成！',
    'game.share': '分享',
    'game.pause': '暂停',
    'game.resume': '继续',
    'daily.label': '每日挑战',
    'daily.cta': '开始',
  });

  dicts.ja = Object.assign({}, dicts.en, {
    'nav.games': 'ゲーム',
    'nav.guides': 'ガイド',
    'nav.about': '概要',
    'nav.profile': 'プロフィール',
    'nav.settings': '設定',
    'hero.title': '頭を鍛えよう。',
    'hero.daily': 'デイリーチャレンジ',
    'hero.browse': 'ゲームを見る',
    'hero.badge': '無料 · オフライン · プライバシー',
    'games.heading': 'すべてのゲーム',
    'filter.all': 'すべて',
    'filter.logic': '論理',
    'filter.word': '言葉',
    'filter.arcade': 'アーケード',
    'game.solved': 'クリア！',
    'game.share': '共有',
    'game.pause': '一時停止',
    'game.resume': '再開',
    'daily.label': 'デイリー',
    'daily.cta': 'プレイ',
  });

  dicts.ko = Object.assign({}, dicts.en, {
    'nav.games': '게임',
    'nav.guides': '가이드',
    'nav.about': '소개',
    'nav.profile': '프로필',
    'nav.settings': '설정',
    'hero.title': '두뇌를 단련하세요.',
    'hero.daily': '일일 도전',
    'hero.browse': '게임 보기',
    'hero.badge': '무료 · 오프라인 · 개인정보',
    'games.heading': '모든 게임',
    'filter.all': '전체',
    'filter.logic': '논리',
    'filter.word': '단어',
    'filter.arcade': '아케이드',
    'game.solved': '완료!',
    'game.share': '공유',
    'game.pause': '일시정지',
    'game.resume': '계속',
    'daily.label': '일일 도전',
    'daily.cta': '플레이',
  });

  dicts.tr = Object.assign({}, dicts.en, {
    'nav.games': 'Oyunlar',
    'nav.guides': 'Rehberler',
    'nav.about': 'Hakkında',
    'nav.profile': 'Profil',
    'nav.settings': 'Ayarlar',
    'hero.title': 'Zihnini çalıştır.',
    'hero.daily': 'Günün görevi',
    'hero.browse': 'Oyunlara göz at',
    'hero.badge': 'Ücretsiz · Çevrimdışı · Gizlilik',
    'games.heading': 'Tüm oyunlar',
    'filter.all': 'Tümü',
    'filter.logic': 'Mantık',
    'filter.word': 'Kelime',
    'filter.arcade': 'Arcade',
    'game.solved': 'Çözüldü!',
    'game.share': 'Paylaş',
    'game.pause': 'Duraklat',
    'game.resume': 'Devam',
    'daily.label': 'Günlük görev',
    'daily.cta': 'Oyna',
  });

  dicts.ru = Object.assign({}, dicts.en, {
    'nav.games': 'Игры',
    'nav.guides': 'Гайды',
    'nav.about': 'О нас',
    'nav.profile': 'Профиль',
    'nav.settings': 'Настройки',
    'hero.title': 'Тренируйте ум.',
    'hero.daily': 'Ежедневный вызов',
    'hero.browse': 'Все игры',
    'hero.badge': 'Бесплатно · Офлайн · Приватно',
    'games.heading': 'Все игры',
    'filter.all': 'Все',
    'filter.logic': 'Логика',
    'filter.word': 'Слова',
    'filter.arcade': 'Аркады',
    'game.solved': 'Решено!',
    'game.share': 'Поделиться',
    'game.pause': 'Пауза',
    'game.resume': 'Продолжить',
    'daily.label': 'Ежедневный вызов',
    'daily.cta': 'Играть',
  });

  dicts.ur = Object.assign({}, dicts.en, {
    'nav.games': 'کھیل',
    'nav.guides': 'رہنما',
    'nav.about': 'تعارف',
    'nav.profile': 'پروفائل',
    'nav.settings': 'ترتیبات',
    'hero.title': 'ذہن کو تیز کریں۔',
    'hero.daily': 'روزانہ چیلنج',
    'hero.browse': 'کھیل دیکھیں',
    'hero.badge': 'مفت · آف لائن · نجی',
    'games.heading': 'تمام کھیل',
    'filter.all': 'سب',
    'filter.logic': 'منطق',
    'filter.word': 'الفاظ',
    'filter.arcade': 'آرکیڈ',
    'game.solved': 'حل ہو گیا!',
    'game.share': 'شیئر',
    'game.pause': 'روکیں',
    'game.resume': 'جاری',
    'daily.label': 'روزانہ چیلنج',
    'daily.cta': 'کھیلیں',
  });

  dicts.nl = Object.assign({}, dicts.en, {
    'nav.games': 'Spellen',
    'hero.title': 'Train je geest.',
    'hero.daily': 'Dagelijkse uitdaging',
    'games.heading': 'Alle spellen',
    'filter.all': 'Alles',
    'game.share': 'Delen',
  });

  dicts.pl = Object.assign({}, dicts.en, {
    'nav.games': 'Gry',
    'hero.title': 'Ćwicz umysł.',
    'hero.daily': 'Dzienne wyzwanie',
    'games.heading': 'Wszystkie gry',
    'filter.all': 'Wszystkie',
    'game.share': 'Udostępnij',
  });

  dicts.sv = Object.assign({}, dicts.en, {
    'nav.games': 'Spel',
    'hero.title': 'Träna hjärnan.',
    'hero.daily': 'Dagens utmaning',
    'games.heading': 'Alla spel',
    'filter.all': 'Alla',
    'game.share': 'Dela',
  });

  dicts.id = Object.assign({}, dicts.en, {
    'nav.games': 'Game',
    'hero.title': 'Latih otakmu.',
    'hero.daily': 'Tantangan harian',
    'games.heading': 'Semua game',
    'filter.all': 'Semua',
    'game.share': 'Bagikan',
  });

  dicts.vi = Object.assign({}, dicts.en, {
    'nav.games': 'Trò chơi',
    'hero.title': 'Luyện trí não.',
    'hero.daily': 'Thử thách hàng ngày',
    'games.heading': 'Tất cả',
    'filter.all': 'Tất cả',
    'game.share': 'Chia sẻ',
  });

  dicts.th = Object.assign({}, dicts.en, {
    'nav.games': 'เกม',
    'hero.title': 'ฝึกสมองของคุณ',
    'hero.daily': 'ท้าทายรายวัน',
    'games.heading': 'เกมทั้งหมด',
    'filter.all': 'ทั้งหมด',
    'game.share': 'แชร์',
  });

  dicts.uk = Object.assign({}, dicts.en, {
    'nav.games': 'Ігри',
    'hero.title': 'Тренуй розум.',
    'hero.daily': 'Щоденний виклик',
    'games.heading': 'Усі ігри',
    'filter.all': 'Усі',
    'game.share': 'Поділитися',
  });

  dicts.cs = Object.assign({}, dicts.en, {
    'nav.games': 'Hry',
    'hero.title': 'Trénujte mysl.',
    'hero.daily': 'Denní výzva',
    'games.heading': 'Všechny hry',
    'filter.all': 'Vše',
    'game.share': 'Sdílet',
  });

  dicts.ro = Object.assign({}, dicts.en, {
    'nav.games': 'Jocuri',
    'hero.title': 'Antrenează-ți mintea.',
    'hero.daily': 'Provocarea zilei',
    'games.heading': 'Toate jocurile',
    'filter.all': 'Toate',
    'game.share': 'Distribuie',
  });

  dicts.el = Object.assign({}, dicts.en, {
    'nav.games': 'Παιχνίδια',
    'hero.title': 'Γύμνασε το μυαλό.',
    'hero.daily': 'Ημερήσια πρόκληση',
    'games.heading': 'Όλα',
    'filter.all': 'Όλα',
    'game.share': 'Κοινοποίηση',
  });

  dicts.he = Object.assign({}, dicts.en, {
    'nav.games': 'משחקים',
    'hero.title': 'אמנו את המוח.',
    'hero.daily': 'אתגר יומי',
    'games.heading': 'כל המשחקים',
    'filter.all': 'הכל',
    'game.share': 'שיתוף',
  });

  dicts.fa = Object.assign({}, dicts.en, {
    'nav.games': 'بازی\u200cها',
    'hero.title': 'ذهنت را ورز بده.',
    'hero.daily': 'چالش روزانه',
    'games.heading': 'همه بازی\u200cها',
    'filter.all': 'همه',
    'game.share': 'اشتراک',
  });

  dicts.bn = Object.assign({}, dicts.en, {
    'nav.games': 'গেমস',
    'hero.title': 'মস্তিষ্ককে চর্চা করুন।',
    'hero.daily': 'দৈনিক চ্যালেঞ্জ',
    'games.heading': 'সব গেম',
    'filter.all': 'সব',
    'game.share': 'শেয়ার',
  });

  dicts.ms = Object.assign({}, dicts.en, {
    'nav.games': 'Permainan',
    'hero.title': 'Latih minda anda.',
    'hero.daily': 'Cabaran harian',
    'games.heading': 'Semua permainan',
    'filter.all': 'Semua',
    'game.share': 'Kongsi',
  });

  dicts.hu = Object.assign({}, dicts.en, {
    'nav.games': 'Játékok',
    'hero.title': 'Edzd az agyad.',
    'hero.daily': 'Napi kihívás',
    'games.heading': 'Összes játék',
    'filter.all': 'Összes',
    'game.share': 'Megosztás',
  });

  dicts.fi = Object.assign({}, dicts.en, {
    'nav.games': 'Pelit',
    'hero.title': 'Treenaa aivojasi.',
    'hero.daily': 'Päivän haaste',
    'games.heading': 'Kaikki pelit',
    'filter.all': 'Kaikki',
    'game.share': 'Jaa',
  });

  dicts.da = Object.assign({}, dicts.en, {
    'nav.games': 'Spil',
    'hero.title': 'Træn din hjerne.',
    'hero.daily': 'Dagens udfordring',
    'games.heading': 'Alle spil',
    'filter.all': 'Alle',
    'game.share': 'Del',
  });

  dicts.no = Object.assign({}, dicts.en, {
    'nav.games': 'Spill',
    'hero.title': 'Tren hjernen.',
    'hero.daily': 'Dagens utfordring',
    'games.heading': 'Alle spill',
    'filter.all': 'Alle',
    'game.share': 'Del',
  });

  let locale = 'en';
  const listeners = new Set();

  function t(key, vars = {}) {
    const pack = dicts[locale] || dicts.en;
    let str = pack[key] ?? dicts.en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return str;
  }

  function register(loc, messages) {
    dicts[loc] = { ...(dicts[loc] || {}), ...messages };
  }

  function setLocale(loc) {
    if (!dicts[loc]) dicts[loc] = { ...dicts.en };
    locale = loc;
    document.documentElement.lang = loc.split('-')[0];
    try {
      const s = Storage.getSettings();
      s.locale = loc;
      Storage.setSettings(s);
    } catch { /* */ }
    listeners.forEach((fn) => fn(loc));
    Events.emit('i18n:change', { locale: loc });
  }

  function getLocale() {
    return locale;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function init() {
    const s = Storage.getSettings();
    const saved = s.locale;
    const browser = (navigator.language || 'en').slice(0, 2);
    const initial = saved || (dicts[browser] ? browser : 'en');
    locale = dicts[initial] ? initial : 'en';
    document.documentElement.lang = locale.split('-')[0];
  }

  function available() {
    return Object.keys(dicts);
  }

  return { t, register, setLocale, getLocale, onChange, init, available };
})();
if (typeof window !== 'undefined') { window.I18n = I18n; if (window.PH) window.PH.I18n = I18n; }



/* ===== js/core/theme.js ===== */
/**
 * PuzzleHub — Theme Manager (light / dark / system)
 */
const Theme = (() => {
  let mediaQuery = null;

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(theme) {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    // Update meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#0b0f1a' : '#f5f6fa';
    Events.emit('theme:change', { theme, resolved });
  }

  function set(theme) {
    const settings = Storage.getSettings();
    settings.theme = theme;
    Storage.setSettings(settings);
    apply(theme);
  }

  function toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    set(current === 'dark' ? 'light' : 'dark');
  }

  function get() {
    return Storage.getSettings().theme || 'system';
  }

  function getResolved() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function init() {
    apply(get());
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (get() === 'system') apply('system');
    });
  }

  return { init, set, toggle, get, getResolved, apply };
})();
if (typeof window !== 'undefined') { window.Theme = Theme; if (window.PH) window.PH.Theme = Theme; }



/* ===== js/core/audio.js ===== */
/**
 * PuzzleHub — Web Audio sound effects (no external files)
 * Generates short tones procedurally for zero-bandwidth SFX.
 */
const AudioEngine = (() => {
  let ctx = null;
  let enabled = true;
  let volume = 0.5;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, duration, type = 'sine', vol = 1, delay = 0) {
    if (!enabled) return;
    try {
      const c = ensureCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t = c.currentTime + delay;
      const v = volume * vol * 0.15;
      gain.gain.setValueAtTime(v, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + duration + 0.01);
    } catch { /* audio not available */ }
  }

  function play(name) {
    if (!enabled) return;
    switch (name) {
      case 'click':
        tone(800, 0.04, 'sine', 0.5);
        break;
      case 'place':
        tone(520, 0.06, 'triangle', 0.6);
        break;
      case 'error':
        tone(200, 0.12, 'square', 0.4);
        tone(150, 0.15, 'square', 0.3, 0.08);
        break;
      case 'success':
        tone(523, 0.1, 'sine', 0.5);
        tone(659, 0.1, 'sine', 0.5, 0.1);
        tone(784, 0.15, 'sine', 0.6, 0.2);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'sine', 0.5, i * 0.12));
        break;
      case 'flip':
        tone(400, 0.08, 'triangle', 0.4);
        tone(600, 0.08, 'triangle', 0.3, 0.05);
        break;
      case 'flag':
        tone(700, 0.05, 'sine', 0.4);
        break;
      case 'reveal':
        tone(350, 0.04, 'sine', 0.3);
        break;
      case 'merge':
        tone(440, 0.08, 'triangle', 0.5);
        tone(554, 0.1, 'triangle', 0.4, 0.06);
        break;
      case 'tick':
        tone(1000, 0.02, 'sine', 0.2);
        break;
      case 'hint':
        tone(880, 0.1, 'sine', 0.4);
        tone(1100, 0.12, 'sine', 0.3, 0.08);
        break;
      default:
        tone(600, 0.05, 'sine', 0.3);
    }
  }

  function setEnabled(v) {
    enabled = v;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
  }

  function init() {
    const s = Storage.getSettings();
    enabled = s.sound !== false;
    volume = s.soundVolume ?? 0.5;
    // Unlock audio on first interaction
    const unlock = () => {
      ensureCtx();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  return { play, setEnabled, setVolume, init };
})();
if (typeof window !== 'undefined') { window.AudioEngine = AudioEngine; if (window.PH) window.PH.AudioEngine = AudioEngine; }



/* ===== js/core/router.js ===== */
/**
 * PuzzleHub — Hash-based SPA Router
 */
const Router = (() => {
  const routes = new Map();
  let current = null;
  let currentCleanup = null;

  function register(path, handler) {
    routes.set(path, handler);
  }

  function parse() {
    const hash = location.hash.slice(1) || '/';
    const [path, queryStr] = hash.split('?');
    const params = {};
    if (queryStr) {
      for (const part of queryStr.split('&')) {
        const [k, v] = part.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      }
    }
    // Match dynamic segments like /game/:id
    for (const [pattern, handler] of routes) {
      const keys = [];
      const regex = new RegExp(
        '^' + pattern.replace(/:([^/]+)/g, (_, key) => {
          keys.push(key);
          return '([^/]+)';
        }) + '$'
      );
      const m = path.match(regex);
      if (m) {
        const routeParams = { ...params };
        keys.forEach((k, i) => { routeParams[k] = m[i + 1]; });
        return { path, handler, params: routeParams };
      }
    }
    // Exact match fallback
    if (routes.has(path)) {
      return { path, handler: routes.get(path), params };
    }
    // 404
    if (typeof ErrorPage !== 'undefined' && ErrorPage.render404) {
      return { path, handler: () => ErrorPage.render404(), params: {} };
    }
    return { path: '/', handler: routes.get('/'), params: {} };
  }

  async function navigate(to, replace = false) {
    if (to.startsWith('#')) to = to.slice(1);
    if (!to.startsWith('/')) to = '/' + to;
    if (replace) {
      location.replace('#' + to);
    } else {
      location.hash = to;
    }
  }

  async function resolve() {
    const { path, handler, params } = parse();

    // Cleanup previous page
    if (typeof currentCleanup === 'function') {
      try {
        const ret = currentCleanup();
        if (ret && typeof ret.then === 'function') await ret;
      } catch (e) { console.error(e); }
      currentCleanup = null;
    }

    current = path;
    try {
      Events.emit('route:change', { path, params });
    } catch (e) {
      console.error('route:change', e);
    }

    // Update active nav
    try {
      document.querySelectorAll('.app-nav__link').forEach((el) => {
        const href = el.getAttribute('href') || '';
        const linkPath = href.replace(/^#/, '') || '/';
        const active = linkPath === path || (path !== '/' && linkPath !== '/' && path.startsWith(linkPath));
        el.classList.toggle('active', active);
      });
    } catch (e) { /* */ }

    if (handler) {
      const main = document.getElementById('main-content');
      if (!main) {
        console.error('main-content missing');
        return;
      }
      try {
        main.classList.remove('page-enter');
        void main.offsetWidth;
        main.classList.add('page-enter');
        currentCleanup = (await handler(params)) || null;
      } catch (e) {
        console.error('Route handler error', e);
        main.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'empty-state';
        err.innerHTML = '<div class="empty-state__title">Something went wrong</div><p class="empty-state__desc">Please reload the page.</p>';
        main.appendChild(err);
      }
    }

    if (typeof window.scrollTo === 'function') {
      try { window.scrollTo(0, 0); } catch (e) { /* */ }
    }
  }

  function init() {
    window.addEventListener('hashchange', resolve);
    resolve();
  }

  function getCurrent() {
    return current;
  }

  return { register, navigate, init, getCurrent, resolve };
})();
if (typeof window !== 'undefined') { window.Router = Router; if (window.PH) window.PH.Router = Router; }



/* ===== js/core/seo.js ===== */
/**
 * PuzzleHub — Per-route SEO Manager
 * Updates title, meta description, canonical, OG tags, and JSON-LD on navigation.
 */
const SEO = (() => {
  const DEFAULT = {
    title: 'PuzzleHub — Premium Puzzle Games Online Free',
    description: 'Play free premium puzzle games online: Sudoku, Crossword, Word Search, Cryptogram, Kakuro, Nonogram, 2048, Minesweeper & Memory. Daily challenges, offline mode, achievements.',
    path: '/',
  };

  const ROUTES = {
    '/': DEFAULT,
    '/profile': {
      title: 'Your Profile & Stats — PuzzleHub',
      description: 'Track your puzzle stats, win streaks, achievements, and personal bests across Sudoku, Minesweeper, 2048, and more on PuzzleHub.',
      path: '/profile',
    },
    '/about': {
      title: 'About PuzzleHub — Free Premium Brain Games',
      description: 'PuzzleHub is a free, privacy-first puzzle platform. No account required. Play offline. Built for focus, accessibility, and pure puzzle joy.',
      path: '/about',
    },
    '/leaderboard': {
      title: 'Global Leaderboards — PuzzleHub',
      description: 'Public puzzle rankings, live tournaments, and competitive scores on PuzzleHub.',
      path: '/leaderboard',
    },
    '/community': {
      title: 'Community Puzzles & Challenges — PuzzleHub',
      description: 'Create Sudoku puzzles, publish to the community, and challenge friends on PuzzleHub.',
      path: '/community',
    },
    '/blog': {
      title: 'Puzzle Blog, Guides & Tutorials — PuzzleHub',
      description: 'Strategy guides, product deep-dives, and tutorials for Sudoku, Minesweeper, and more.',
      path: '/blog',
    },
    '/how-to-play': {
      title: 'How to Play — Puzzle Guides | PuzzleHub',
      description: 'Learn how to play Sudoku, Crossword, Word Search, Cryptogram, Kakuro, Nonogram, 2048, Minesweeper, and Memory with clear beginner-friendly guides.',
      path: '/how-to-play',
    },
  };

  function gameSEO(id, meta) {
    const name = meta?.name || id;
    return {
      title: `Play ${name} Online Free — PuzzleHub`,
      description: meta?.desc
        ? `${meta.desc} Free ${name} with multiple difficulties, hints, timer, and offline play.`
        : `Play ${name} free online. Multiple difficulties, hints, daily challenge, and offline mode.`,
      path: `/game/${id}`,
    };
  }

  function setMeta(name, content, prop = false) {
    const attr = prop ? 'property' : 'name';
    let el = document.querySelector(`meta[${attr}="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setCanonical(path) {
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    // Relative-safe absolute using current origin
    const base = location.href.split('#')[0].replace(/index\.html$/, '');
    const clean = path === '/' ? base : base.replace(/\/?$/, '/') + 'index.html#' + path;
    link.href = clean;
  }

  function updateJsonLd(data) {
    let el = document.getElementById('dynamic-jsonld');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = 'dynamic-jsonld';
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  function apply(path, params = {}) {
    let seo = ROUTES[path] || DEFAULT;

    if (path.startsWith('/game/') || params.id) {
      const id = params.id || path.split('/')[2];
      const meta = typeof GAME_MAP !== 'undefined' ? GAME_MAP[id] : null;
      seo = gameSEO(id, meta);
    }

    document.title = seo.title;
    setMeta('description', seo.description);
    setMeta('og:title', seo.title, true);
    setMeta('og:description', seo.description, true);
    setMeta('twitter:title', seo.title);
    setMeta('twitter:description', seo.description);
    setCanonical(seo.path);

    // Breadcrumb schema for crawlable structure awareness
    const items = [
      { '@type': 'ListItem', position: 1, name: 'Home', item: location.origin + location.pathname },
    ];
    if (seo.path !== '/') {
      items.push({
        '@type': 'ListItem',
        position: 2,
        name: seo.title.split('—')[0].trim().split('|')[0].trim(),
      });
    }
    updateJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items,
    });
  }

  return { apply, DEFAULT, ROUTES };
})();
if (typeof window !== 'undefined') { window.SEO = SEO; if (window.PH) window.PH.SEO = SEO; }



/* ===== js/core/analytics.js ===== */
/**
 * PuzzleHub — Analytics-ready event layer
 * Dispatches structured events to dataLayer / gtag / custom sinks without requiring a vendor.
 * Wire your provider by listening: Events.on('analytics', handler)
 * or set window.PH_ANALYTICS = { track(event, props) {} }
 */
const Analytics = (() => {
  const queue = [];
  let ready = false;

  function track(event, props = {}) {
    const payload = {
      event,
      props: { ...props, ts: Date.now(), path: location.hash || '#/' },
    };

    // Google-style dataLayer
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...payload.props });

    // Optional gtag
    if (typeof window.gtag === 'function') {
      try { window.gtag('event', event, payload.props); } catch { /* */ }
    }

    // Custom sink
    if (window.PH_ANALYTICS && typeof window.PH_ANALYTICS.track === 'function') {
      try { window.PH_ANALYTICS.track(event, payload.props); } catch { /* */ }
    }

    Events.emit('analytics', payload);

    if (!ready) queue.push(payload);
    return payload;
  }

  function init() {
    ready = true;
    // Flush nothing special — events already pushed to dataLayer
    track('app_open', { referrer: document.referrer || 'direct' });

    Events.on('route:change', ({ path, params }) => {
      track('page_view', { page: path, ...params });
    });

    Events.on('game:win', (data) => {
      track('game_win', data);
    });

    Events.on('achievement:unlock', (def) => {
      track('achievement_unlock', { id: def.id, name: def.name });
    });
  }

  return { track, init, queue };
})();
if (typeof window !== 'undefined') { window.Analytics = Analytics; if (window.PH) window.PH.Analytics = Analytics; }



/* ===== js/core/performance.js ===== */
/**
 * PuzzleHub — Performance helpers
 * Lazy script loading, idle work, visibility-aware timers.
 */
const Perf = (() => {
  const loaded = new Set();

  /** Load a script once; resolves when executed */
  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', reject);
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.src = src;
      s.onload = () => { loaded.add(src); resolve(); };
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  /** Load multiple scripts in order */
  async function loadScripts(srcs) {
    for (const src of srcs) await loadScript(src);
  }

  /** Schedule non-critical work */
  function idle(fn, timeout = 2000) {
    if ('requestIdleCallback' in window) {
      return requestIdleCallback(fn, { timeout });
    }
    return setTimeout(fn, 1);
  }

  /** Prefetch a URL (low priority) */
  function prefetch(href) {
    if (document.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = href;
    l.as = href.endsWith('.js') ? 'script' : href.endsWith('.css') ? 'style' : 'fetch';
    document.head.appendChild(l);
  }

  /** Mark performance measures for debugging */
  function mark(name) {
    try { performance.mark('ph_' + name); } catch { /* */ }
  }

  function measure(name, startMark) {
    try {
      performance.measure('ph_' + name, 'ph_' + startMark);
    } catch { /* */ }
  }

  return { loadScript, loadScripts, idle, prefetch, mark, measure, loaded };
})();
if (typeof window !== 'undefined') { window.Perf = Perf; if (window.PH) window.PH.Perf = Perf; }



/* ===== js/core/registry.js ===== */
/**
 * PuzzleHub — Game Module Registry
 * Single registry for lazy-loaded game engines (Open/Closed for expansion).
 *
 * Register: GameRegistry.register('mygame', { src, cls, meta? })
 * Resolve:  await GameRegistry.resolve('sudoku')
 */
const GameRegistry = (() => {
  /** @type {Map<string, { src: string, cls: string, meta?: object }>} */
  const modules = new Map();
  const loading = new Map();

  const BUILTIN = [
    ['sudoku', { src: 'js/games/sudoku.min.js', cls: 'SudokuGame' }],
    ['minesweeper', { src: 'js/games/minesweeper.min.js', cls: 'MinesweeperGame' }],
    ['2048', { src: 'js/games/game2048.min.js', cls: 'Game2048' }],
    ['memory', { src: 'js/games/memory.min.js', cls: 'MemoryGame' }],
    ['wordsearch', { src: 'js/games/wordsearch.min.js', cls: 'WordSearchGame' }],
    ['cryptogram', { src: 'js/games/cryptogram.min.js', cls: 'CryptogramGame' }],
    ['crossword', { src: 'js/games/crossword.min.js', cls: 'CrosswordGame' }],
    ['kakuro', { src: 'js/games/kakuro.min.js', cls: 'KakuroGame' }],
    ['nonogram', { src: 'js/games/nonogram.min.js', cls: 'NonogramGame' }],
  ];

  function initBuiltins() {
    if (modules.size) return;
    for (const [id, def] of BUILTIN) modules.set(id, Object.freeze({ ...def }));
  }

  function register(id, def) {
    if (!id || !def || !def.src || !def.cls) {
      throw new Error('GameRegistry.register requires id, src, cls');
    }
    modules.set(String(id), Object.freeze({ src: def.src, cls: def.cls, meta: def.meta || null }));
    return true;
  }

  function has(id) {
    initBuiltins();
    return modules.has(id);
  }

  function list() {
    initBuiltins();
    return Array.from(modules.keys());
  }

  function get(id) {
    initBuiltins();
    return modules.get(id) || null;
  }

  /**
   * Resolve constructor for a game id (lazy script load when needed).
   * @returns {Promise<Function>}
   */
  async function resolve(gameId) {
    initBuiltins();
    const mod = modules.get(gameId);
    if (!mod) throw new Error(`Unknown game module: ${gameId}`);

    if (typeof window[mod.cls] === 'function') {
      return window[mod.cls];
    }

    // Deduplicate concurrent loads
    if (loading.has(gameId)) return loading.get(gameId);

    const task = (async () => {
      const perf = typeof Perf !== 'undefined' ? Perf : null;
      if (!perf || typeof perf.loadScript !== 'function') {
        throw new Error('Perf.loadScript unavailable');
      }
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      await perf.loadScript(mod.src);
      const Cls = window[mod.cls];
      if (typeof Cls !== 'function') {
        throw new Error(`Game class ${mod.cls} not found after loading ${mod.src}`);
      }
      if (typeof Logger !== 'undefined') {
        Logger.debug('game_module_loaded', {
          gameId,
          ms: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : null,
        });
      }
      return Cls;
    })().finally(() => loading.delete(gameId));

    loading.set(gameId, task);
    return task;
  }

  /** Prefetch module scripts without executing game logic */
  function prefetch(ids) {
    initBuiltins();
    const listIds = ids || Array.from(modules.keys()).slice(0, 3);
    const perf = typeof Perf !== 'undefined' ? Perf : null;
    if (!perf || !perf.prefetch) return;
    for (const id of listIds) {
      const mod = modules.get(id);
      if (mod) perf.prefetch(mod.src);
    }
  }

  return { register, has, list, get, resolve, prefetch, initBuiltins };
})();

if (typeof window !== 'undefined') {
  window.GameRegistry = GameRegistry;
  if (window.PH) window.PH.GameRegistry = GameRegistry;
}



/* ===== js/core/cloud.js ===== */
/**
 * PuzzleHub — Cloud Adapter (Accounts, Cloud Save, Sync)
 * Works fully offline with local simulation. Point PH_CLOUD_ENDPOINT
 * at your API to enable real backend without changing UI code.
 *
 * Expected REST (optional):
 *   POST /auth/guest | /auth/login | /auth/logout
 *   GET/PUT /me/profile  GET/PUT /me/save  GET /leaderboard/:game
 *   POST /scores  POST /challenges  GET /tournaments
 */
const Cloud = (() => {
  const ENDPOINT =
    (typeof Config !== 'undefined' && Config.get('cloudEndpoint')) ||
    (typeof window !== 'undefined' && window.PH_CLOUD_ENDPOINT) ||
    null;
  let session = null;

  function loadSession() {
    session = Storage.get('cloud_session', null);
    return session;
  }

  function saveSession(s) {
    session = s;
    if (s) Storage.set('cloud_session', s);
    else Storage.remove('cloud_session');
    Events.emit('cloud:session', { session });
    return session;
  }

  async function api(path, opts = {}) {
    if (!ENDPOINT) throw new Error('NO_CLOUD');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(ENDPOINT.replace(/\/$/, '') + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Cloud ${res.status}`);
    return res.json();
  }

  function uid() {
    return 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  async function signInGuest(displayName) {
    try {
      if (ENDPOINT) {
        const data = await api('/auth/guest', { method: 'POST', body: { name: displayName } });
        return saveSession(data);
      }
    } catch { /* fall through local */ }
    const profile = Storage.getProfile();
    const name = (displayName || profile.name || 'Player').slice(0, 20);
    const local = {
      token: 'local_' + uid(),
      userId: Storage.get('user_id') || uid(),
      name,
      avatar: profile.avatar || '🧩',
      provider: 'guest',
      createdAt: Date.now(),
      isPremium: false,
      country: Intl.DateTimeFormat().resolvedOptions().timeZone || '—',
    };
    Storage.set('user_id', local.userId);
    profile.name = name;
    Storage.setProfile(profile);
    return saveSession(local);
  }

  async function signInEmail(email, password) {
    try {
      if (ENDPOINT) {
        const data = await api('/auth/login', { method: 'POST', body: { email, password } });
        return saveSession(data);
      }
    } catch (e) {
      if (ENDPOINT) throw e;
    }
    // Local demo account
    return signInGuest(email.split('@')[0] || 'Player');
  }

  async function signOut() {
    try { if (ENDPOINT) await api('/auth/logout', { method: 'POST' }); } catch { /* */ }
    saveSession(null);
  }

  function isSignedIn() {
    return !!(session || loadSession());
  }

  function getUser() {
    return session || loadSession();
  }

  async function pushSave(blob) {
    const user = getUser();
    if (!user) return false;
    const payload = { ...blob, updatedAt: Date.now(), userId: user.userId };
    Storage.set('cloud_save_' + user.userId, payload);
    try {
      if (ENDPOINT) await api('/me/save', { method: 'PUT', body: payload });
    } catch { /* queue offline */ Sync.queue('save', payload); }
    return true;
  }

  async function pullSave() {
    const user = getUser();
    if (!user) return null;
    try {
      if (ENDPOINT) return await api('/me/save');
    } catch { /* */ }
    return Storage.get('cloud_save_' + user.userId, null);
  }

  async function submitScore({ gameId, time, difficulty, moves, hints, daily }) {
    const user = getUser() || (await signInGuest());
    const entry = {
      id: uid(),
      userId: user.userId,
      name: user.name,
      avatar: user.avatar,
      gameId,
      time,
      difficulty,
      moves,
      hints,
      daily: !!daily,
      score: scoreFrom(time, hints, moves, difficulty),
      at: Date.now(),
    };
    // Local leaderboard board
    const key = 'lb_' + gameId;
    const board = Storage.get(key, []);
    board.push(entry);
    board.sort((a, b) => b.score - a.score || a.time - b.time);
    Storage.set(key, board.slice(0, 100));
    // Global aggregate
    const global = Storage.get('lb_global', []);
    global.push(entry);
    global.sort((a, b) => b.score - a.score);
    Storage.set('lb_global', global.slice(0, 200));
    try {
      if (ENDPOINT) await api('/scores', { method: 'POST', body: entry });
    } catch { Sync.queue('score', entry); }
    Events.emit('leaderboard:update', entry);
    return entry;
  }

  function scoreFrom(time, hints, moves, difficulty) {
    const diffMul = { easy: 1, medium: 1.4, hard: 1.9, expert: 2.5, normal: 1.2 }[difficulty] || 1;
    const base = Math.max(100, 10000 - time * 12 - (hints || 0) * 400 - Math.max(0, (moves || 0) - 20) * 5);
    return Math.round(base * diffMul);
  }

  async function getLeaderboard(gameId = 'global', limit = 20) {
    try {
      if (ENDPOINT) return await api(`/leaderboard/${gameId}?limit=${limit}`);
    } catch { /* */ }
    const key = gameId === 'global' ? 'lb_global' : 'lb_' + gameId;
    return Storage.get(key, []).slice(0, limit);
  }

  return {
    loadSession, signInGuest, signInEmail, signOut, isSignedIn, getUser,
    pushSave, pullSave, submitScore, getLeaderboard, scoreFrom, api, ENDPOINT,
  };
})();

if (typeof window !== 'undefined') { window.Cloud = Cloud; if (window.PH) window.PH.Cloud = Cloud; }



/* ===== js/core/sync.js ===== */
/**
 * PuzzleHub — Offline Sync Queue
 * Queues mutations while offline; flushes when online / on demand.
 */
const Sync = (() => {
  const KEY = 'sync_queue';

  function queue(type, payload) {
    const q = Storage.get(KEY, []);
    q.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 7), type, payload, at: Date.now() });
    Storage.set(KEY, q.slice(-200));
    Events.emit('sync:queued', { type, size: q.length });
  }

  function pending() {
    return Storage.get(KEY, []);
  }

  async function flush() {
    if (!navigator.onLine) return { flushed: 0, remaining: pending().length };
    const q = pending();
    if (!q.length) return { flushed: 0, remaining: 0 };
    if (!Cloud.ENDPOINT) {
      // Local mode: just clear — already applied locally
      Storage.set(KEY, []);
      Events.emit('sync:flushed', { flushed: q.length });
      return { flushed: q.length, remaining: 0 };
    }
    const remain = [];
    let flushed = 0;
    for (const item of q) {
      try {
        if (item.type === 'score') await Cloud.api('/scores', { method: 'POST', body: item.payload });
        else if (item.type === 'save') await Cloud.api('/me/save', { method: 'PUT', body: item.payload });
        else if (item.type === 'challenge') await Cloud.api('/challenges', { method: 'POST', body: item.payload });
        else if (item.type === 'community') await Cloud.api('/community', { method: 'POST', body: item.payload });
        flushed++;
      } catch {
        remain.push(item);
      }
    }
    Storage.set(KEY, remain);
    Events.emit('sync:flushed', { flushed, remaining: remain.length });
    return { flushed, remaining: remain.length };
  }

  function init() {
    window.addEventListener('online', () => { flush(); });
    // Periodic
    setInterval(() => { if (navigator.onLine) flush(); }, 60000);
  }

  return { queue, pending, flush, init };
})();

if (typeof window !== 'undefined') { window.Sync = Sync; if (window.PH) window.PH.Sync = Sync; }



/* ===== js/core/ai-engine.js ===== */
/**
 * PuzzleHub — AI Puzzle / Hint / Difficulty Engine (client-side)
 * Unlimited seeded generation + smart hints + difficulty analysis.
 * Swap internals for server LLM later without changing callers.
 */
const AIEngine = (() => {
  /** Analyze a result and return difficulty rating 1–5 + labels */
  function analyzeDifficulty({ time, hints, moves, difficulty, gameId }) {
    const expected = {
      easy: 120, medium: 240, hard: 420, expert: 720, normal: 180,
    }[difficulty] || 240;
    const timeRatio = time / expected;
    let rating = 3;
    if (timeRatio < 0.45 && hints === 0) rating = 1;
    else if (timeRatio < 0.75 && hints <= 1) rating = 2;
    else if (timeRatio < 1.2) rating = 3;
    else if (timeRatio < 1.8 || hints >= 3) rating = 4;
    else rating = 5;

    const labels = ['Trivial', 'Comfortable', 'Balanced', 'Challenging', 'Brutal'];
    const advice = [
      'Try a harder difficulty — you crushed this.',
      'Solid pace. Bump difficulty or cut hints next run.',
      'Good match for your skill. Keep the streak going.',
      'Tough one. Review patterns or use Notes mode.',
      'Very hard for your current pace — practice medium first.',
    ][rating - 1];

    return {
      rating,
      label: labels[rating - 1],
      advice,
      expectedTime: expected,
      efficiency: Math.round(Math.max(0, Math.min(100, (1 - (hints * 0.15) - Math.max(0, timeRatio - 1) * 0.3) * 100))),
      gameId,
    };
  }

  /** Smart hint strategies by game */
  function hintStrategy(gameId, context = {}) {
    const strategies = {
      sudoku: [
        'Look for naked singles — cells with only one candidate.',
        'Scan a box for a digit that can only go in one cell.',
        'Check rows/columns where a digit is almost complete.',
        'Use Notes: eliminate candidates using locked pairs.',
      ],
      minesweeper: [
        'If a number equals its hidden neighbors, all are mines — flag them.',
        'If a number equals its flags, open the remaining cells.',
        'Open corners and edges first to expand safe areas.',
      ],
      crossword: [
        'Fill short words and plurals first.',
        'Use crossing letters to constrain long answers.',
        'Revisit clues after every new letter.',
      ],
      cryptogram: [
        'Start with 1-letter words (A/I) and THE/AND patterns.',
        'Double letters often are LL, EE, SS, OO.',
        'Apostrophe patterns: \'T, \'S, \'RE, \'LL.',
      ],
      nonogram: [
        'Fill forced blocks from large clue numbers first.',
        'Mark definite empties when a block cannot reach a cell.',
        'Work from edges inward for long runs.',
      ],
      kakuro: [
        'High sums with few cells force large digits (no repeats).',
        'Low sums force small digits — list combinations.',
        'Cross-check across and down runs for unique digits.',
      ],
      wordsearch: [
        'Search for rare letters (Q, Z, X) first.',
        'Scan edges — many words start on borders.',
        'Try diagonals after horizontals/verticals.',
      ],
      memory: [
        'Memorize positions in groups of four.',
        'Open new cards only after checking known matches.',
      ],
      '2048': [
        'Keep your highest tile in a corner.',
        'Build a monotonic snake toward that corner.',
        'Avoid up/down thrashing that breaks the stack.',
      ],
    };
    const list = strategies[gameId] || ['Break the puzzle into smaller regions and eliminate impossibilities.'];
    const idx = (context.hintsUsed || 0) % list.length;
    return { tip: list[idx], strategyId: idx, confidence: 0.72 + (idx % 3) * 0.08 };
  }

  /** Personalized next-game recommendation */
  function recommend(stats) {
    const by = stats?.byGame || {};
    const games = (typeof GAMES_META !== 'undefined' ? GAMES_META : []).map((g) => g.id);
    if (!games.length) return { gameId: 'sudoku', reason: 'A classic place to start.' };

    // Prefer unplayed
    const unplayed = games.filter((id) => !by[id] || !by[id].played);
    if (unplayed.length) {
      return {
        gameId: unplayed[0],
        reason: 'You have not tried this yet — expand your explorer badge.',
        difficulty: 'easy',
      };
    }

    // Prefer lowest win rate for practice
    let worst = games[0];
    let worstRate = 2;
    for (const id of games) {
      const g = by[id] || { played: 1, won: 1 };
      const rate = g.played ? g.won / g.played : 1;
      if (rate < worstRate) { worstRate = rate; worst = id; }
    }
    if (worstRate < 0.5) {
      return { gameId: worst, reason: 'Practice area — your win rate is lowest here.', difficulty: 'easy' };
    }

    // Else featured / daily rotation
    const day = Math.floor(Date.now() / 86400000);
    const id = games[day % games.length];
    return { gameId: id, reason: 'Picked for variety based on your play history.', difficulty: 'medium' };
  }

  /** Unlimited puzzle seed factory */
  function unlimitedSeed(gameId, difficulty, salt = Date.now()) {
    const base = Utils.hashStr(`${gameId}|${difficulty}|${salt}|ph-ai`);
    return base >>> 0;
  }

  /** Generate meta for a new infinite puzzle instance */
  function generatePuzzleSpec(gameId, difficulty = 'medium') {
    const seed = unlimitedSeed(gameId, difficulty, Date.now() ^ (Math.random() * 1e9));
    const analysis = {
      estimatedMinutes: { easy: 3, medium: 6, hard: 12, expert: 20, normal: 5 }[difficulty] || 6,
      techniques: hintStrategy(gameId, { hintsUsed: 0 }).tip,
      seed,
      infinite: true,
    };
    return { gameId, difficulty, seed, analysis, id: `ai_${gameId}_${seed.toString(36)}` };
  }

  return { analyzeDifficulty, hintStrategy, recommend, unlimitedSeed, generatePuzzleSpec };
})();

if (typeof window !== 'undefined') { window.AIEngine = AIEngine; if (window.PH) window.PH.AIEngine = AIEngine; }



/* ===== js/core/game-base.js ===== */
/**
 * PuzzleHub — Abstract Game Base Class
 * Timer, undo/redo, stats, save/load, win, pause, share.
 */
class GameBase {
  constructor(gameId, options = {}) {
    this.gameId = gameId;
    this.difficulty = options.difficulty || 'medium';
    this.isDaily = options.isDaily || false;
    this.seed = options.seed || null;

    this.elapsed = 0;
    this.timerInterval = null;
    this.paused = false;
    this._pausedByVisibility = false;
    this.won = false;
    this.started = false;
    this.hintsUsed = 0;
    this.moves = 0;

    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo =
      (typeof Config !== 'undefined' && Config.get('performance.maxUndo')) || 100;

    this.container = null;
    this.timerEl = null;
    this.pauseBtn = null;
    this.pauseOverlay = null;
    this._boundKeyHandler = this.onKeyDown.bind(this);
  }

  /* ---- Lifecycle ---- */
  async mount(container) {
    this.container = container;
    await this.init();
    this.render();
    this.bindEvents();
    this.startTimer();
    this.started = true;
    Stats.recordGameStart(this.gameId);
    return this;
  }

  async init() {}
  render() {}

  bindEvents() {
    document.addEventListener('keydown', this._boundKeyHandler);
  }

  destroy() {
    this.stopTimer();
    document.removeEventListener('keydown', this._boundKeyHandler);
    this.save();
  }

  onKeyDown(e) {
    if (this.won) return;
    // Global pause toggle
    if (e.key === 'p' || e.key === 'P') {
      if (!e.ctrlKey && !e.metaKey && !e.target.matches('input, textarea')) {
        e.preventDefault();
        this.togglePause();
        return;
      }
    }
    if (this.paused) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    }
  }

  /* ---- Timer ---- */
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      if (!this.paused && !this.won) {
        this.elapsed++;
        this.updateTimerDisplay();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  setPaused(paused, { silent = false, reason = 'user' } = {}) {
    this.paused = !!paused;
    this._pausedByVisibility = reason === 'visibility' && this.paused;
    if (this.pauseBtn) {
      this.pauseBtn.setAttribute('aria-label', this.paused ? I18n.t('game.resume') : I18n.t('game.pause'));
      this.pauseBtn.setAttribute('data-tooltip', this.paused ? I18n.t('game.resume') : I18n.t('game.pause'));
      this.pauseBtn.innerHTML = Utils.icon(this.paused ? 'play' : 'pause', 18);
    }
    this.renderPauseOverlay();
    if (!silent) {
      AudioEngine.play('click');
      Events.emit('game:pause', { paused: this.paused, reason });
    }
    return this.paused;
  }

  togglePause() {
    return this.setPaused(!this.paused, { reason: 'user' });
  }

  renderPauseOverlay() {
    if (this.pauseOverlay) {
      this.pauseOverlay.remove();
      this.pauseOverlay = null;
    }
    if (!this.paused || this.won) return;
    const host = this.container.querySelector('.board-wrap') ||
      this.container.querySelector('.game-stage') ||
      this.container;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    this.pauseOverlay = Utils.el('div', {
      className: 'pause-overlay',
      role: 'status',
      'aria-live': 'polite',
    }, [
      Utils.el('div', { className: 'pause-overlay__icon', 'aria-hidden': 'true', innerHTML: Utils.icon('pause', 32) }),
      Utils.el('div', { className: 'pause-overlay__title', textContent: I18n.t('game.paused') }),
      Utils.el('button', {
        className: 'btn btn-primary',
        type: 'button',
        textContent: I18n.t('game.resume'),
        onClick: () => this.setPaused(false),
      }),
    ]);
    host.appendChild(this.pauseOverlay);
  }

  updateTimerDisplay() {
    if (this.timerEl) {
      this.timerEl.textContent = Utils.formatTime(this.elapsed);
    }
  }

  /* ---- Undo / Redo ---- */
  pushUndo(state) {
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0 || this.won || this.paused) return;
    const current = this.snapshot();
    const prev = this.undoStack.pop();
    this.redoStack.push(current);
    this.restore(prev);
    AudioEngine.play('click');
    // Do not count undo as a move or re-check win via afterMove
    this.save();
  }

  redo() {
    if (this.redoStack.length === 0 || this.won || this.paused) return;
    const current = this.snapshot();
    const next = this.redoStack.pop();
    this.undoStack.push(current);
    this.restore(next);
    AudioEngine.play('click');
    if (this.checkWin()) this.onWin();
    else this.save();
  }

  snapshot() { return {}; }
  restore() {}

  /* ---- Win ---- */
  checkWin() { return false; }

  onWin() {
    if (this.won) return;
    this.won = true;
    this.paused = false;
    this.stopTimer();
    if (this.pauseOverlay) {
      this.pauseOverlay.remove();
      this.pauseOverlay = null;
    }
    AudioEngine.play('win');
    Utils.confetti();
    Utils.vibrate([50, 30, 50]);

    const stats = Stats.recordWin(this.gameId, this.elapsed, this.difficulty);
    if (this.isDaily) {
      const daily = Storage.getDailyProgress();
      daily[Utils.dateKey()] = { gameId: this.gameId, time: this.elapsed, completed: true };
      Storage.setDailyProgress(daily);
      Achievements.check(this.gameId, this.elapsed, this.difficulty, stats, { daily: true });
    }

    Storage.clearGameState(this.gameId);
    const payload = {
      gameId: this.gameId,
      time: this.elapsed,
      difficulty: this.difficulty,
      hints: this.hintsUsed,
      moves: this.moves,
      daily: this.isDaily,
    };
    // Competitive + rewards pipeline
    try {
      if (typeof Cloud !== 'undefined') {
        Cloud.submitScore(payload).then((entry) => {
          if (typeof Tournaments !== 'undefined' && entry) Tournaments.recordScore(entry);
        }).catch(() => {});
      }
      if (typeof Rewards !== 'undefined') Rewards.onWin(payload);
      if (typeof AIEngine !== 'undefined') {
        payload.analysis = AIEngine.analyzeDifficulty(payload);
      }
      if (typeof Voice !== 'undefined') {
        Voice.speak(`Puzzle solved in ${Utils.formatTime(this.elapsed)}`);
      }
      if (this.challengeId && typeof Social !== 'undefined') {
        Social.completeChallenge(this.challengeId, this.elapsed);
      }
    } catch (e) { console.warn(e); }
    this.lastWinPayload = payload;
    this.showWinOverlay();
    Events.emit('game:win', payload);
    if (typeof Analytics !== 'undefined') Analytics.track('game_complete', payload);
  }

  async shareResult() {
    const meta = GAME_MAP[this.gameId] || { name: this.gameId };
    const text = I18n.t('share.text', {
      name: meta.name,
      time: Utils.formatTime(this.elapsed),
    });
    const url = location.href.split('#')[0] + '#/game/' + this.gameId;
    Analytics.track('share_attempt', { game: this.gameId });

    try {
      if (navigator.share) {
        await navigator.share({ title: 'PuzzleHub', text, url });
        Analytics.track('share_success', { method: 'native' });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      Toast.show({ type: 'success', message: 'Result copied to clipboard' });
      Analytics.track('share_success', { method: 'clipboard' });
    } catch {
      Toast.show({ type: 'info', message: text });
    }
  }

  showWinOverlay() {
    const overlay = Utils.el('div', {
      className: 'win-overlay',
      role: 'status',
      'aria-live': 'polite',
    }, [
      Utils.el('div', { className: 'win-overlay__emoji', textContent: '🎉' }),
      Utils.el('div', { className: 'win-overlay__title', textContent: I18n.t('game.solved') }),
      (this.lastWinPayload && this.lastWinPayload.analysis)
        ? Utils.el('div', { className: 'ai-tip', style: 'margin:8px 0;text-align:left' }, [
            Utils.el('div', {}, [
              Utils.el('strong', { textContent: 'AI: ' + this.lastWinPayload.analysis.label + ' · ' }),
              Utils.el('span', { textContent: this.lastWinPayload.analysis.advice }),
            ]),
          ])
        : null,
      Utils.el('div', { className: 'win-overlay__stats' }, [
        Utils.el('div', { className: 'stat-item' }, [
          Utils.el('div', { className: 'stat-item__value', textContent: Utils.formatTime(this.elapsed) }),
          Utils.el('div', { className: 'stat-item__label', textContent: I18n.t('game.time') }),
        ]),
        Utils.el('div', { className: 'stat-item' }, [
          Utils.el('div', { className: 'stat-item__value', textContent: String(this.moves) }),
          Utils.el('div', { className: 'stat-item__label', textContent: I18n.t('game.moves') }),
        ]),
        Utils.el('div', { className: 'stat-item' }, [
          Utils.el('div', { className: 'stat-item__value', textContent: String(this.hintsUsed) }),
          Utils.el('div', { className: 'stat-item__label', textContent: I18n.t('game.hints') }),
        ]),
      ]),
      Utils.el('div', { className: 'win-overlay__actions' }, [
        Utils.el('button', {
          className: 'btn btn-primary',
          type: 'button',
          textContent: I18n.t('game.playAgain'),
          onClick: () => this.restart(),
        }),
        Utils.el('button', {
          className: 'btn btn-secondary',
          type: 'button',
          textContent: I18n.t('game.share'),
          onClick: () => this.shareResult(),
        }),
        Utils.el('button', {
          className: 'btn btn-ghost',
          type: 'button',
          textContent: I18n.t('game.home'),
          onClick: () => Router.navigate('/'),
        }),
      ]),
    ]);

    const wrap = this.container.querySelector('.board-wrap');
    if (wrap) {
      wrap.style.position = 'relative';
      wrap.appendChild(overlay);
    } else {
      this.container.appendChild(overlay);
    }
  }

  /* ---- Save / Load ---- */
  save() {
    if (this.won || !this.started) return;
    Storage.setGameState(this.gameId, {
      difficulty: this.difficulty,
      elapsed: this.elapsed,
      moves: this.moves,
      hintsUsed: this.hintsUsed,
      isDaily: this.isDaily,
      state: this.snapshot(),
    });
  }

  loadSaved() {
    const saved = Storage.getGameState(this.gameId);
    if (!saved || saved.isDaily !== this.isDaily) return false;
    this.difficulty = saved.difficulty || this.difficulty;
    this.elapsed = saved.elapsed || 0;
    this.moves = saved.moves || 0;
    this.hintsUsed = saved.hintsUsed || 0;
    if (saved.state) this.restore(saved.state);
    return true;
  }

  afterMove() {
    this.moves++;
    if (this.checkWin()) this.onWin();
    else this.save();
  }

  async restart() {
    const settings = Storage.getSettings();
    if (settings.confirmRestart && this.started && !this.won && this.moves > 0) {
      const ok = await Modal.confirm({
        title: 'Restart Puzzle?',
        message: 'Your current progress will be lost.',
        confirmLabel: 'Restart',
        danger: true,
      });
      if (!ok) return;
    }
    this.stopTimer();
    document.removeEventListener('keydown', this._boundKeyHandler);
    Storage.clearGameState(this.gameId);
    this.elapsed = 0;
    this.moves = 0;
    this.hintsUsed = 0;
    this.won = false;
    this.paused = false;
    this._pausedByVisibility = false;
    this.undoStack = [];
    this.redoStack = [];
    this.pauseOverlay = null;
    this.container.innerHTML = '';
    await this.mount(this.container);
  }

  /* ---- Toolbar ---- */
  buildToolbar(title) {
    const toolbar = Utils.el('div', { className: 'game-toolbar' });

    const left = Utils.el('div', { className: 'game-toolbar__left' }, [
      Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        type: 'button',
        'aria-label': 'Back to home',
        'data-tooltip': 'Home',
        innerHTML: Utils.icon('back', 18),
        onClick: () => { this.destroy(); Router.navigate('/'); },
      }),
      Utils.el('span', { className: 'game-toolbar__title', textContent: title }),
    ]);

    const center = Utils.el('div', { className: 'game-toolbar__center' });
    this.timerEl = Utils.el('span', {
      className: 'stat-item__value game-timer',
      textContent: Utils.formatTime(this.elapsed),
      'aria-label': 'Elapsed time',
    });
    if (Storage.getSettings().showTimer !== false) {
      center.appendChild(this.timerEl);
    }

    this.pauseBtn = Utils.el('button', {
      className: 'btn btn-ghost btn-icon sm',
      type: 'button',
      'aria-label': I18n.t('game.pause'),
      'data-tooltip': I18n.t('game.pause') + ' (P)',
      innerHTML: Utils.icon('pause', 18),
      onClick: () => this.togglePause(),
    });

    const right = Utils.el('div', { className: 'game-toolbar__right' }, [
      this.pauseBtn,
      Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        type: 'button',
        'aria-label': I18n.t('game.undo'),
        'data-tooltip': 'Undo (Ctrl+Z)',
        innerHTML: Utils.icon('undo', 18),
        onClick: () => this.undo(),
      }),
      Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        type: 'button',
        'aria-label': I18n.t('game.redo'),
        'data-tooltip': 'Redo (Ctrl+Y)',
        innerHTML: Utils.icon('redo', 18),
        onClick: () => this.redo(),
      }),
      Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        type: 'button',
        'aria-label': I18n.t('game.hint'),
        'data-tooltip': I18n.t('game.hint'),
        innerHTML: Utils.icon('hint', 18),
        onClick: () => { if (!this.paused && !this.won) this.hint(); },
      }),
      Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        type: 'button',
        'aria-label': I18n.t('game.restart'),
        'data-tooltip': I18n.t('game.restart'),
        innerHTML: Utils.icon('restart', 18),
        onClick: () => this.restart(),
      }),
    ]);

    toolbar.append(left, center, right);
    return toolbar;
  }

  hint() {
    this.hintsUsed++;
    AudioEngine.play('hint');
    try {
      if (typeof AIEngine !== 'undefined') {
        const h = AIEngine.hintStrategy(this.gameId, { hintsUsed: this.hintsUsed });
        if (typeof Toast !== 'undefined') Toast.show({ type: 'info', title: 'AI Tip', message: h.tip, duration: 4500 });
        if (typeof Voice !== 'undefined') Voice.speak(h.tip);
      }
    } catch (e) { /* */ }
  }
}
if (typeof window !== 'undefined') { window.GameBase = GameBase; if (window.PH) window.PH.GameBase = GameBase; }



/* ===== js/features/toast.js ===== */
/**
 * PuzzleHub — Toast Notifications
 */
const Toast = (() => {
  let container = null;

  function ensure() {
    if (!container) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
      }
    }
    return container;
  }

  function show({ type = 'info', title = '', message = '', duration = 3000 } = {}) {
    const c = ensure();
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const toast = Utils.el('div', {
      className: `toast toast--${type}`,
      role: 'status',
    }, [
      Utils.el('div', { className: 'toast__icon', textContent: icons[type] || 'ℹ' }),
      Utils.el('div', {}, [
        title ? Utils.el('div', { style: 'font-weight:600;margin-bottom:1px', textContent: title }) : null,
        Utils.el('div', { style: 'color:var(--text-secondary)', textContent: message }),
      ].filter(Boolean)),
    ]);
    c.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  return { show };
})();
if (typeof window !== 'undefined') { window.Toast = Toast; if (window.PH) window.PH.Toast = Toast; }



/* ===== js/features/modal.js ===== */
/**
 * PuzzleHub — Modal Dialog System
 */
const Modal = (() => {
  let active = null;
  let previousFocus = null;

  function open({ title = '', body = '', footer = null, size = '', onClose = null, closable = true } = {}) {
    close();
    previousFocus = document.activeElement;

    const backdrop = Utils.el('div', {
      className: 'modal-backdrop',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    });

    const modal = Utils.el('div', { className: `modal${size ? ' modal--' + size : ''}` });

    const header = Utils.el('div', { className: 'modal__header' }, [
      Utils.el('h2', { className: 'modal__title', textContent: title }),
    ]);
    if (closable) {
      const closeBtn = Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        'aria-label': 'Close',
        innerHTML: Utils.icon('close', 18),
        onClick: () => close(),
      });
      header.appendChild(closeBtn);
    }
    modal.appendChild(header);

    const bodyEl = Utils.el('div', { className: 'modal__body' });
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body instanceof HTMLElement) bodyEl.appendChild(body);
    modal.appendChild(bodyEl);

    if (footer) {
      const footerEl = Utils.el('div', { className: 'modal__footer' });
      if (typeof footer === 'string') footerEl.innerHTML = footer;
      else if (footer instanceof HTMLElement) footerEl.appendChild(footer);
      else if (Array.isArray(footer)) footer.forEach(f => footerEl.appendChild(f));
      modal.appendChild(footerEl);
    }

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    active = { backdrop, onClose };

    if (closable) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
      });
    }

    // Focus trap
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();

    document.addEventListener('keydown', onKey);
    return { close, bodyEl, backdrop };
  }

  function onKey(e) {
    if (e.key === 'Escape' && active) close();
  }

  function close() {
    if (!active) return;
    document.removeEventListener('keydown', onKey);
    const { backdrop, onClose } = active;
    backdrop.remove();
    active = null;
    if (previousFocus) {
      try { previousFocus.focus(); } catch { /* */ }
    }
    if (onClose) onClose();
  }

  function confirm({ title = 'Confirm', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      const footer = [
        Utils.el('button', {
          className: 'btn btn-secondary',
          textContent: cancelLabel,
          onClick: () => { close(); resolve(false); },
        }),
        Utils.el('button', {
          className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
          textContent: confirmLabel,
          onClick: () => { close(); resolve(true); },
        }),
      ];
      open({
        title,
        body: `<p style="color:var(--text-secondary)">${Utils.escapeHtml(message)}</p>`,
        footer,
        size: 'sm',
        onClose: () => resolve(false),
      });
    });
  }

  return { open, close, confirm };
})();
if (typeof window !== 'undefined') { window.Modal = Modal; if (window.PH) window.PH.Modal = Modal; }



/* ===== js/features/stats.js ===== */
/**
 * PuzzleHub — Statistics & Streak Tracking
 */
const Stats = (() => {
  function recordGameStart(gameId) {
    const stats = Storage.getStats();
    if (!stats.byGame[gameId]) {
      stats.byGame[gameId] = { played: 0, won: 0, bestTime: null, totalTime: 0 };
    }
    stats.byGame[gameId].played++;
    stats.gamesPlayed++;
    Storage.setStats(stats);
  }

  function recordWin(gameId, timeSeconds, difficulty = 'medium') {
    const stats = Storage.getStats();
    if (!stats.byGame[gameId]) {
      stats.byGame[gameId] = { played: 0, won: 0, bestTime: null, totalTime: 0 };
    }
    const g = stats.byGame[gameId];
    g.won++;
    g.totalTime += timeSeconds;
    if (g.bestTime === null || timeSeconds < g.bestTime) {
      g.bestTime = timeSeconds;
    }
    stats.gamesWon++;
    stats.totalTime += timeSeconds;

    // Streak
    const today = Utils.dateKey();
    if (stats.lastPlayDate !== today) {
      const yesterday = Utils.dateKey(new Date(Date.now() - 86400000));
      if (stats.lastPlayDate === yesterday) {
        stats.currentStreak++;
      } else {
        stats.currentStreak = 1;
      }
      stats.lastPlayDate = today;
      if (stats.currentStreak > stats.bestStreak) {
        stats.bestStreak = stats.currentStreak;
      }
    }

    Storage.setStats(stats);
    Events.emit('stats:win', { gameId, timeSeconds, difficulty, stats });
    Achievements.check(gameId, timeSeconds, difficulty, stats);
    return stats;
  }

  function get() {
    return Storage.getStats();
  }

  function getGameStats(gameId) {
    const stats = Storage.getStats();
    return stats.byGame[gameId] || { played: 0, won: 0, bestTime: null, totalTime: 0 };
  }

  function winRate() {
    const s = get();
    if (s.gamesPlayed === 0) return 0;
    return Math.round((s.gamesWon / s.gamesPlayed) * 100);
  }

  return { recordGameStart, recordWin, get, getGameStats, winRate };
})();
if (typeof window !== 'undefined') { window.Stats = Stats; if (window.PH) window.PH.Stats = Stats; }



/* ===== js/features/achievements.js ===== */
/**
 * PuzzleHub — Achievement System
 */
const Achievements = (() => {
  const DEFINITIONS = [
    { id: 'first_win', name: 'First Victory', desc: 'Win your first puzzle', icon: '🏆', check: (s) => s.gamesWon >= 1 },
    { id: 'wins_10', name: 'Puzzle Adept', desc: 'Win 10 puzzles', icon: '⭐', check: (s) => s.gamesWon >= 10 },
    { id: 'wins_50', name: 'Puzzle Master', desc: 'Win 50 puzzles', icon: '👑', check: (s) => s.gamesWon >= 50 },
    { id: 'wins_100', name: 'Grandmaster', desc: 'Win 100 puzzles', icon: '💎', check: (s) => s.gamesWon >= 100 },
    { id: 'streak_3', name: 'On Fire', desc: '3-day play streak', icon: '🔥', check: (s) => s.currentStreak >= 3 },
    { id: 'streak_7', name: 'Week Warrior', desc: '7-day play streak', icon: '💪', check: (s) => s.currentStreak >= 7 },
    { id: 'streak_30', name: 'Unstoppable', desc: '30-day play streak', icon: '🌟', check: (s) => s.currentStreak >= 30 },
    { id: 'speed_demon', name: 'Speed Demon', desc: 'Solve any puzzle under 60 seconds', icon: '⚡', check: (_s, t) => t !== undefined && t < 60 },
    { id: 'sudoku_pro', name: 'Sudoku Pro', desc: 'Win 10 Sudoku puzzles', icon: '🔢', check: (s) => (s.byGame.sudoku?.won || 0) >= 10 },
    { id: 'memory_king', name: 'Memory King', desc: 'Win 10 Memory games', icon: '🧠', check: (s) => (s.byGame.memory?.won || 0) >= 10 },
    { id: 'minesweeper_hero', name: 'Mine Sweeper', desc: 'Win 10 Minesweeper games', icon: '💣', check: (s) => (s.byGame.minesweeper?.won || 0) >= 10 },
    { id: 'all_games', name: 'Explorer', desc: 'Play every game at least once', icon: '🗺️', check: (s) => {
      const games = ['sudoku','crossword','wordsearch','cryptogram','kakuro','nonogram','2048','minesweeper','memory'];
      return games.every(g => (s.byGame[g]?.played || 0) >= 1);
    }},
    { id: 'night_owl', name: 'Night Owl', desc: 'Play after midnight', icon: '🦉', check: () => new Date().getHours() < 5 },
    { id: 'perfect_day', name: 'Perfect Day', desc: 'Complete the Daily Challenge', icon: '📅', check: (_s, _t, _d, extra) => extra?.daily === true },
  ];

  function getUnlocked() {
    return Storage.getAchievements();
  }

  function unlock(id) {
    const data = getUnlocked();
    if (data[id]) return false;
    data[id] = { unlockedAt: Date.now() };
    Storage.setAchievements(data);
    const def = DEFINITIONS.find(d => d.id === id);
    if (def) {
      Events.emit('achievement:unlock', def);
      Toast.show({ type: 'success', title: 'Achievement Unlocked!', message: `${def.icon} ${def.name}`, duration: 4000 });
      AudioEngine.play('success');
    }
    return true;
  }

  function check(gameId, timeSeconds, difficulty, stats, extra = {}) {
    for (const def of DEFINITIONS) {
      if (def.check(stats, timeSeconds, difficulty, extra)) {
        unlock(def.id);
      }
    }
  }

  function getAll() {
    const unlocked = getUnlocked();
    return DEFINITIONS.map(d => ({
      ...d,
      unlocked: !!unlocked[d.id],
      unlockedAt: unlocked[d.id]?.unlockedAt || null,
    }));
  }

  function count() {
    return Object.keys(getUnlocked()).length;
  }

  return { DEFINITIONS, getUnlocked, unlock, check, getAll, count };
})();
if (typeof window !== 'undefined') { window.Achievements = Achievements; if (window.PH) window.PH.Achievements = Achievements; }



/* ===== js/features/settings.js ===== */
/**
 * PuzzleHub — Settings Panel
 */
const SettingsUI = (() => {
  function open() {
    const settings = Storage.getSettings();
    const body = Utils.el('div');

    function row(label, desc, control) {
      const r = Utils.el('div', { className: 'settings-row' }, [
        Utils.el('div', {}, [
          Utils.el('div', { className: 'settings-row__label', textContent: label }),
          desc ? Utils.el('div', { className: 'settings-row__desc', textContent: desc }) : null,
        ].filter(Boolean)),
        control,
      ]);
      body.appendChild(r);
      return r;
    }

    // Theme
    const themeGroup = Utils.el('div', { className: 'pill-group' });
    ['system', 'light', 'dark'].forEach(t => {
      const pill = Utils.el('button', {
        className: `pill${settings.theme === t ? ' active' : ''}`,
        type: 'button',
        textContent: t.charAt(0).toUpperCase() + t.slice(1),
        onClick: () => {
          themeGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          Theme.set(t);
          settings.theme = t;
          Storage.setSettings(settings);
        },
      });
      themeGroup.appendChild(pill);
    });
    row('Theme', 'Choose your preferred appearance', themeGroup);

    // Language (i18n-ready)
    const langGroup = Utils.el('div', { className: 'pill-group' });
    const locales = I18n.available();
    const localeLabels = { en:'English', es:'Español', fr:'Français', de:'Deutsch', pt:'Português', it:'Italiano', hi:'हिन्दी', ar:'العربية', zh:'中文', ja:'日本語', ko:'한국어', tr:'Türkçe', ru:'Русский', ur:'اردو', nl:'Nederlands', pl:'Polski', sv:'Svenska', id:'Indonesia', vi:'Tiếng Việt', th:'ไทย', uk:'Українська', cs:'Čeština', ro:'Română', el:'Ελληνικά', he:'עברית', fa:'فارسی', bn:'বাংলা', ms:'Melayu', hu:'Magyar', fi:'Suomi', da:'Dansk', no:'Norsk' };
    locales.forEach((loc) => {
      const pill = Utils.el('button', {
        className: `pill${I18n.getLocale() === loc ? ' active' : ''}`,
        type: 'button',
        textContent: localeLabels[loc] || loc.toUpperCase(),
        onClick: () => {
          langGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          I18n.setLocale(loc);
          settings.locale = loc;
          Storage.setSettings(settings);
          Toast.show({ type: 'info', message: 'Language updated. Some labels apply on next navigation.' });
        },
      });
      langGroup.appendChild(pill);
    });
    row('Language', 'Interface language (more packs coming soon)', langGroup);

    // Sound
    const soundToggle = makeToggle(settings.sound, (v) => {
      settings.sound = v;
      Storage.setSettings(settings);
      AudioEngine.setEnabled(v);
    });
    
    // Voice
    if (typeof Voice !== 'undefined' && Voice.supported()) {
      const voiceToggle = makeToggle(!!settings.voice, (v) => {
        settings.voice = v;
        Storage.setSettings(settings);
        Voice.setEnabled(v);
      });
      row('Voice Support', 'Spoken AI tips and win announcements', voiceToggle);
    }

    // Premium themes
    if (typeof Rewards !== 'undefined') {
      const sw = Utils.el('div', { className: 'theme-swatches' });
      Rewards.themes().forEach((th) => {
        sw.appendChild(Utils.el('button', {
          className: 'theme-swatch' + (th.active ? ' active' : ''),
          type: 'button',
          title: th.name + (th.premium && !th.unlocked ? ' (premium)' : ''),
          onClick: () => { Rewards.setTheme(th.id); SettingsUI.open(); },
        }, [
          Utils.el('div', { className: 'theme-swatch__preview', style: 'background:' + th.preview }),
          Utils.el('div', { className: 'theme-swatch__name', textContent: th.name + (th.unlocked ? '' : ' 🔒') }),
        ]));
      });
      row('Premium Themes', 'Unlock with coins from play & rewards', sw);
    }

    row('Sound Effects', 'Play audio feedback during games', soundToggle);

    // Animations
    const animToggle = makeToggle(settings.animations, (v) => {
      settings.animations = v;
      Storage.setSettings(settings);
    });
    row('Animations', 'Enable motion and transitions', animToggle);

    // Timer
    const timerToggle = makeToggle(settings.showTimer, (v) => {
      settings.showTimer = v;
      Storage.setSettings(settings);
    });
    row('Show Timer', 'Display elapsed time during puzzles', timerToggle);

    // Highlight related
    const hlToggle = makeToggle(settings.highlightRelated !== false, (v) => {
      settings.highlightRelated = v;
      Storage.setSettings(settings);
    });
    row('Highlight Related', 'Highlight row, column, and box cells', hlToggle);

    // Auto-check
    const acToggle = makeToggle(settings.autoCheck, (v) => {
      settings.autoCheck = v;
      Storage.setSettings(settings);
    });
    row('Auto-Check Errors', 'Highlight incorrect entries immediately', acToggle);

    // Vibration
    const vibToggle = makeToggle(settings.vibration !== false, (v) => {
      settings.vibration = v;
      Storage.setSettings(settings);
    });
    row('Haptic Feedback', 'Vibrate on mobile interactions', vibToggle);

    Modal.open({ title: 'Settings', body, size: '' });
  }

  function makeToggle(checked, onChange) {
    const t = Utils.el('button', {
      className: 'toggle',
      role: 'switch',
      'aria-checked': String(!!checked),
      onClick: () => {
        const next = t.getAttribute('aria-checked') !== 'true';
        t.setAttribute('aria-checked', String(next));
        onChange(next);
        AudioEngine.play('click');
      },
    }, [Utils.el('div', { className: 'toggle__thumb' })]);
    return t;
  }

  return { open };
})();
if (typeof window !== 'undefined') { window.SettingsUI = SettingsUI; if (window.PH) window.PH.SettingsUI = SettingsUI; }



/* ===== js/features/install.js ===== */
/**
 * PuzzleHub — PWA Install Prompt
 */
const InstallPrompt = (() => {
  let deferred = null;
  let banner = null;

  function init() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      // Only show if not dismissed recently
      const dismissed = Storage.get('install_dismissed', 0);
      if (Date.now() - dismissed < 7 * 86400000) return;
      // Delay so it doesn't compete with first interaction
      setTimeout(show, 8000);
    });

    window.addEventListener('appinstalled', () => {
      deferred = null;
      hide();
      Analytics.track('pwa_installed');
      Toast.show({ type: 'success', title: 'Installed!', message: 'PuzzleHub is on your home screen.' });
    });
  }

  function show() {
    if (!deferred || banner || window.matchMedia('(display-mode: standalone)').matches) return;

    banner = Utils.el('div', {
      className: 'install-banner',
      role: 'dialog',
      'aria-label': I18n.t('install.title'),
    }, [
      Utils.el('div', { className: 'install-banner__icon', 'aria-hidden': 'true', textContent: '🧩' }),
      Utils.el('div', { className: 'install-banner__text' }, [
        Utils.el('div', { className: 'install-banner__title', textContent: I18n.t('install.title') }),
        Utils.el('div', { className: 'install-banner__body', textContent: I18n.t('install.body') }),
      ]),
      Utils.el('button', {
        className: 'btn btn-primary btn-sm',
        type: 'button',
        textContent: I18n.t('install.cta'),
        onClick: async () => {
          Analytics.track('pwa_install_click');
          deferred.prompt();
          const { outcome } = await deferred.userChoice;
          Analytics.track('pwa_install_outcome', { outcome });
          deferred = null;
          hide();
        },
      }),
      Utils.el('button', {
        className: 'btn btn-ghost btn-icon sm',
        type: 'button',
        'aria-label': I18n.t('install.dismiss'),
        innerHTML: Utils.icon('close', 16),
        onClick: () => {
          Storage.set('install_dismissed', Date.now());
          Analytics.track('pwa_install_dismiss');
          hide();
        },
      }),
    ]);

    document.getElementById('app')?.appendChild(banner);
  }

  function hide() {
    if (banner) {
      banner.classList.add('install-banner--out');
      setTimeout(() => { banner?.remove(); banner = null; }, 250);
    }
  }

  return { init, show, hide };
})();
if (typeof window !== 'undefined') { window.InstallPrompt = InstallPrompt; if (window.PH) window.PH.InstallPrompt = InstallPrompt; }



/* ===== js/features/social.js ===== */
/**
 * PuzzleHub — Social: share, referrals, friend challenges, community
 */
const Social = (() => {
  function referralCode() {
    const user = Cloud.getUser();
    const id = user?.userId || Storage.get('user_id') || 'guest';
    let code = Storage.get('referral_code');
    if (!code) {
      code = 'PH' + Utils.hashStr(id).toString(36).toUpperCase().replace(/-/g, '').slice(0, 6);
      Storage.set('referral_code', code);
    }
    return code;
  }

  function applyReferral(code) {
    if (!code || code === referralCode()) return false;
    const applied = Storage.get('referral_applied');
    if (applied) return false;
    Storage.set('referral_applied', code);
    // Reward both sides locally
    const rewards = Storage.get('daily_rewards', { streak: 0, last: null, coins: 0 });
    rewards.coins = (rewards.coins || 0) + 50;
    Storage.set('daily_rewards', rewards);
    Toast.show({ type: 'success', title: 'Referral applied!', message: '+50 coins' });
    Analytics.track('referral_applied', { code });
    return true;
  }

  function referralLink() {
    const base = location.href.split('#')[0];
    return `${base}#/?ref=${referralCode()}`;
  }

  async function share({ title, text, url } = {}) {
    const payload = {
      title: title || 'PuzzleHub',
      text: text || 'Come play premium free puzzles on PuzzleHub!',
      url: url || location.href.split('#')[0] + (location.hash || '#/'),
    };
    Analytics.track('share_open', { hasNative: !!navigator.share });
    try {
      if (navigator.share) {
        await navigator.share(payload);
        Analytics.track('share_success', { method: 'native' });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    try {
      await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
      Toast.show({ type: 'success', message: 'Link copied to clipboard' });
      Analytics.track('share_success', { method: 'clipboard' });
      return true;
    } catch {
      Toast.show({ type: 'info', message: payload.url });
      return false;
    }
  }

  function createChallenge({ gameId, difficulty = 'medium', friendName = 'Friend' }) {
    const user = Cloud.getUser();
    const challenge = {
      id: 'ch_' + Date.now().toString(36),
      from: user?.name || 'Player',
      fromId: user?.userId || 'local',
      to: friendName,
      gameId,
      difficulty,
      seed: AIEngine.unlimitedSeed(gameId, difficulty, Date.now()),
      createdAt: Date.now(),
      status: 'open',
      myTime: null,
      theirTime: null,
    };
    const list = Storage.get('challenges', []);
    list.unshift(challenge);
    Storage.set('challenges', list.slice(0, 50));
    Sync.queue('challenge', challenge);
    Analytics.track('challenge_create', { gameId, difficulty });
    return challenge;
  }

  function listChallenges() {
    return Storage.get('challenges', []);
  }

  function completeChallenge(id, time) {
    const list = listChallenges();
    const c = list.find((x) => x.id === id);
    if (!c) return null;
    c.myTime = time;
    c.status = 'completed';
    Storage.set('challenges', list);
    return c;
  }

  function publishCommunityPuzzle(spec) {
    const user = Cloud.getUser() || { name: 'Player', userId: 'local' };
    const item = {
      ...spec,
      author: user.name,
      authorId: user.userId,
      likes: 0,
      plays: 0,
      createdAt: Date.now(),
      id: spec.id || ('comm_' + Date.now().toString(36)),
    };
    const feed = Storage.get('community_feed', []);
    feed.unshift(item);
    Storage.set('community_feed', feed.slice(0, 100));
    Sync.queue('community', item);
    Analytics.track('community_publish', { gameId: item.gameId });
    return item;
  }

  function communityFeed() {
    return Storage.get('community_feed', []);
  }

  return {
    referralCode, applyReferral, referralLink, share,
    createChallenge, listChallenges, completeChallenge,
    publishCommunityPuzzle, communityFeed,
  };
})();

if (typeof window !== 'undefined') { window.Social = Social; if (window.PH) window.PH.Social = Social; }



/* ===== js/features/tournaments.js ===== */
/**
 * PuzzleHub — Daily / Weekly / Monthly Tournaments + Seasonal Events
 */
const Tournaments = (() => {
  function periodKey(type, d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (type === 'daily') return `d-${y}-${m}-${day}`;
    if (type === 'weekly') {
      const tmp = new Date(d);
      tmp.setHours(0, 0, 0, 0);
      tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
      const week1 = new Date(tmp.getFullYear(), 0, 4);
      const week = 1 + Math.round(((tmp - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
      return `w-${tmp.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    if (type === 'monthly') return `m-${y}-${m}`;
    return `d-${y}-${m}-${day}`;
  }

  function activeTournaments() {
    const now = new Date();
    return [
      {
        id: 'tour_daily_' + periodKey('daily'),
        type: 'daily',
        name: 'Daily Sprint',
        desc: 'Best score today across any puzzle.',
        endsAt: endOfDay(now),
        icon: '⚡',
        reward: '50 coins + badge XP',
      },
      {
        id: 'tour_weekly_' + periodKey('weekly'),
        type: 'weekly',
        name: 'Weekly Masters',
        desc: 'Climb the weekly leaderboard.',
        endsAt: endOfWeek(now),
        icon: '🏆',
        reward: '200 coins + title',
      },
      {
        id: 'tour_monthly_' + periodKey('monthly'),
        type: 'monthly',
        name: 'Monthly Grand Prix',
        desc: 'Month-long ranking by total score.',
        endsAt: endOfMonth(now),
        icon: '👑',
        reward: 'Seasonal badge',
      },
    ];
  }

  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x.getTime();
  }
  function endOfWeek(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() + (6 - day));
    x.setHours(23, 59, 59, 999);
    return x.getTime();
  }
  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  }

  function recordScore(entry) {
    for (const t of activeTournaments()) {
      const key = 'tour_scores_' + t.id;
      const list = Storage.get(key, []);
      list.push({ ...entry, tournamentId: t.id });
      // Best score per user
      const best = {};
      for (const row of list) {
        const prev = best[row.userId];
        if (!prev || row.score > prev.score) best[row.userId] = row;
      }
      const merged = Object.values(best).sort((a, b) => b.score - a.score).slice(0, 100);
      Storage.set(key, merged);
    }
  }

  function standings(tournamentId, limit = 20) {
    return Storage.get('tour_scores_' + tournamentId, []).slice(0, limit);
  }

  function seasonalEvent() {
    const month = new Date().getMonth();
    const seasons = [
      { name: 'New Year Nexus', theme: 'aurora', months: [0], bonus: 'Double daily coins' },
      { name: 'Spring Logic Festival', theme: 'blossom', months: [2, 3], bonus: '+10% XP on logic games' },
      { name: 'Summer Speed Trials', theme: 'solar', months: [5, 6], bonus: 'Timed challenges' },
      { name: 'Autumn Cipher Night', theme: 'ember', months: [8, 9], bonus: 'Word games featured' },
      { name: 'Winter Grand Puzzle', theme: 'frost', months: [11], bonus: 'Exclusive freeze theme' },
    ];
    return seasons.find((s) => s.months.includes(month)) || {
      name: 'Evergreen Season',
      theme: 'default',
      months: [],
      bonus: 'Standard rewards',
    };
  }

  return { activeTournaments, recordScore, standings, seasonalEvent, periodKey };
})();

if (typeof window !== 'undefined') { window.Tournaments = Tournaments; if (window.PH) window.PH.Tournaments = Tournaments; }



/* ===== js/features/rewards.js ===== */
/**
 * PuzzleHub — Daily Rewards, Coins, Achievement Levels, Premium Themes
 */
const Rewards = (() => {
  const THEMES = [
    { id: 'default', name: 'Classic', premium: false, preview: 'linear-gradient(135deg,#3366ff,#764ba2)' },
    { id: 'midnight', name: 'Midnight', premium: false, preview: 'linear-gradient(135deg,#0f172a,#1e3a8a)' },
    { id: 'sunrise', name: 'Sunrise', premium: false, preview: 'linear-gradient(135deg,#f59e0b,#ec4899)' },
    { id: 'forest', name: 'Forest', premium: true, preview: 'linear-gradient(135deg,#059669,#14532d)' },
    { id: 'aurora', name: 'Aurora', premium: true, preview: 'linear-gradient(135deg,#06b6d4,#8b5cf6,#ec4899)' },
    { id: 'gold', name: 'Royal Gold', premium: true, preview: 'linear-gradient(135deg,#fbbf24,#b45309)' },
    { id: 'frost', name: 'Frost', premium: true, preview: 'linear-gradient(135deg,#e0f2fe,#38bdf8,#1e3a8a)' },
    { id: 'ember', name: 'Ember', premium: true, preview: 'linear-gradient(135deg,#7c2d12,#ea580c,#fbbf24)' },
  ];

  function state() {
    return Storage.get('rewards', {
      coins: 0,
      xp: 0,
      level: 1,
      lastClaim: null,
      claimStreak: 0,
      unlockedThemes: ['default', 'midnight', 'sunrise'],
      activeTheme: 'default',
      claimedToday: false,
    });
  }

  function save(s) {
    Storage.set('rewards', s);
    Events.emit('rewards:update', s);
    return s;
  }

  function xpForLevel(level) {
    return Math.round(100 * Math.pow(level, 1.45));
  }

  function addXp(amount) {
    const s = state();
    s.xp += amount;
    while (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level);
      s.level += 1;
      s.coins += 25;
      Toast.show({ type: 'success', title: 'Level up!', message: `You reached level ${s.level}` });
      Analytics.track('level_up', { level: s.level });
    }
    return save(s);
  }

  function addCoins(n) {
    const s = state();
    s.coins += n;
    return save(s);
  }

  function canClaimDaily() {
    const s = state();
    return s.lastClaim !== Utils.dateKey();
  }

  function claimDaily() {
    if (!canClaimDaily()) {
      Toast.show({ type: 'info', message: 'Already claimed today. Come back tomorrow!' });
      return null;
    }
    const s = state();
    const yesterday = Utils.dateKey(new Date(Date.now() - 86400000));
    s.claimStreak = s.lastClaim === yesterday ? s.claimStreak + 1 : 1;
    s.lastClaim = Utils.dateKey();
    const reward = 20 + Math.min(30, s.claimStreak * 5);
    s.coins += reward;
    save(s);
    addXp(15 + s.claimStreak * 2);
    Analytics.track('daily_reward_claim', { reward, streak: s.claimStreak });
    Toast.show({ type: 'success', title: 'Daily reward!', message: `+${reward} coins · ${s.claimStreak}-day claim streak` });
    return { reward, streak: s.claimStreak };
  }

  function themes() {
    const s = state();
    return THEMES.map((t) => ({
      ...t,
      unlocked: s.unlockedThemes.includes(t.id) || !t.premium,
      active: s.activeTheme === t.id,
    }));
  }

  function unlockTheme(id) {
    const s = state();
    const theme = THEMES.find((t) => t.id === id);
    if (!theme) return false;
    if (s.unlockedThemes.includes(id)) return true;
    const cost = 100;
    if (s.coins < cost) {
      Toast.show({ type: 'warning', message: `Need ${cost} coins to unlock` });
      return false;
    }
    s.coins -= cost;
    s.unlockedThemes.push(id);
    save(s);
    Toast.show({ type: 'success', message: `Unlocked ${theme.name}` });
    return true;
  }

  function setTheme(id) {
    const s = state();
    const list = themes();
    const t = list.find((x) => x.id === id);
    if (!t) return;
    if (!t.unlocked) {
      if (!unlockTheme(id)) return;
    }
    s.activeTheme = id;
    save(s);
    document.documentElement.setAttribute('data-accent', id);
    Analytics.track('theme_premium_set', { id });
  }

  function applyActive() {
    const s = state();
    document.documentElement.setAttribute('data-accent', s.activeTheme || 'default');
  }

  function onWin(payload) {
    const base = 10;
    const bonus = payload.daily ? 15 : 0;
    const hintPenalty = Math.min(8, (payload.hints || 0) * 2);
    const coins = Math.max(3, base + bonus - hintPenalty);
    addCoins(coins);
    addXp(20 + bonus - hintPenalty);
  }

  return {
    THEMES, state, addXp, addCoins, canClaimDaily, claimDaily,
    themes, unlockTheme, setTheme, applyActive, onWin, xpForLevel,
  };
})();

if (typeof window !== 'undefined') { window.Rewards = Rewards; if (window.PH) window.PH.Rewards = Rewards; }



/* ===== js/features/editor.js ===== */
/**
 * PuzzleHub — User Puzzle Editor (Sudoku-focused + generic export)
 * Users create puzzles, validate, publish to community feed.
 */
const PuzzleEditor = (() => {
  function emptySudoku() {
    return Array.from({ length: 9 }, () => Array(9).fill(0));
  }

  function isValidPlacement(grid, r, c, n) {
    if (n === 0) return true;
    for (let i = 0; i < 9; i++) {
      if (i !== c && grid[r][i] === n) return false;
      if (i !== r && grid[i][c] === n) return false;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const rr = br + i, cc = bc + j;
        if ((rr !== r || cc !== c) && grid[rr][cc] === n) return false;
      }
    return true;
  }

  function countClues(grid) {
    return grid.flat().filter((x) => x > 0).length;
  }

  function solveCount(grid, limit = 2) {
    const g = grid.map((r) => r.slice());
    let count = 0;
    function solve() {
      if (count >= limit) return;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (g[r][c] === 0) {
            for (let n = 1; n <= 9; n++) {
              if (isValidPlacement(g, r, c, n)) {
                g[r][c] = n;
                solve();
                g[r][c] = 0;
              }
            }
            return;
          }
        }
      }
      count++;
    }
    solve();
    return count;
  }

  function validateSudoku(grid) {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (grid[r][c] && !isValidPlacement(grid, r, c, grid[r][c])) {
          return { ok: false, error: `Conflict at row ${r + 1}, col ${c + 1}` };
        }
    const clues = countClues(grid);
    if (clues < 17) return { ok: false, error: 'Need at least 17 clues for a proper Sudoku.' };
    const solutions = solveCount(grid, 2);
    if (solutions === 0) return { ok: false, error: 'No solution — check your clues.' };
    if (solutions > 1) return { ok: false, error: 'Multiple solutions — add more clues.' };
    return { ok: true, clues, difficulty: clues >= 36 ? 'easy' : clues >= 28 ? 'medium' : clues >= 24 ? 'hard' : 'expert' };
  }

  function publishSudoku(grid, title) {
    const v = validateSudoku(grid);
    if (!v.ok) {
      Toast.show({ type: 'error', message: v.error });
      return null;
    }
    const spec = {
      gameId: 'sudoku',
      type: 'user',
      title: (title || 'Community Sudoku').slice(0, 40),
      difficulty: v.difficulty,
      puzzle: grid.map((r) => r.slice()),
      seed: Utils.hashStr(JSON.stringify(grid)),
    };
    return Social.publishCommunityPuzzle(spec);
  }

  function draft() {
    return Storage.get('editor_draft', { gameId: 'sudoku', grid: emptySudoku(), title: '' });
  }

  function saveDraft(d) {
    Storage.set('editor_draft', d);
  }

  return {
    emptySudoku, isValidPlacement, validateSudoku, publishSudoku, draft, saveDraft, countClues,
  };
})();

if (typeof window !== 'undefined') { window.PuzzleEditor = PuzzleEditor; if (window.PH) window.PH.PuzzleEditor = PuzzleEditor; }



/* ===== js/features/ab.js ===== */
/**
 * PuzzleHub — Lightweight A/B Testing
 */
const AB = (() => {
  const experiments = {
    home_cta: ['Play Daily Challenge', 'Start Today\'s Puzzle', 'Claim Your Daily Win'],
    card_style: ['default', 'compact'],
  };

  function userBucket() {
    let id = Storage.get('user_id');
    if (!id) {
      id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      Storage.set('user_id', id);
    }
    return Math.abs(Utils.hashStr(id));
  }

  function variant(experiment) {
    const options = experiments[experiment];
    if (!options || !options.length) return null;
    const idx = userBucket() % options.length;
    const value = options[idx];
    Analytics.track('ab_exposure', { experiment, variant: String(value), idx });
    return value;
  }

  function register(name, options) {
    experiments[name] = options;
  }

  return { variant, register, experiments };
})();

if (typeof window !== 'undefined') { window.AB = AB; if (window.PH) window.PH.AB = AB; }



/* ===== js/features/voice.js ===== */
/**
 * PuzzleHub — Voice Support (Web Speech API)
 * Speak tips / results; optional voice commands where supported.
 */
const Voice = (() => {
  let enabled = false;

  function supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  function init() {
    const s = Storage.getSettings();
    enabled = !!s.voice;
  }

  function setEnabled(v) {
    enabled = !!v;
    const s = Storage.getSettings();
    s.voice = enabled;
    Storage.setSettings(s);
  }

  function speak(text, { force = false } = {}) {
    if (!supported()) return false;
    if (!enabled && !force) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.rate = 1;
      u.lang = (I18n.getLocale && I18n.getLocale() === 'es') ? 'es-ES' : 'en-US';
      window.speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  function stop() {
    if (supported()) window.speechSynthesis.cancel();
  }

  return { supported, init, setEnabled, speak, stop, isEnabled: () => enabled };
})();

if (typeof window !== 'undefined') { window.Voice = Voice; if (window.PH) window.PH.Voice = Voice; }



/* ===== js/features/api.js ===== */
/**
 * PuzzleHub — Public Client API surface for embeds & partners
 * window.PuzzleHubAPI
 */
const PuzzleHubAPI = (() => {
  function getCatalog() {
    return (typeof GAMES_META !== 'undefined' ? GAMES_META : []).map((g) => ({
      id: g.id, name: g.name, desc: g.desc, difficulties: g.difficulties, category: g.category,
    }));
  }

  function play(gameId, opts = {}) {
    const id = Security.safeGameId(gameId);
    if (!id) throw new Error('Unknown game');
    const d = Security.safeDifficulty(opts.difficulty || 'medium', GAME_MAP[id].difficulties);
    Router.navigate(`/game/${id}?d=${d}${opts.daily ? '&daily=1' : ''}`);
  }

  async function leaderboard(gameId = 'global', limit = 10) {
    return Cloud.getLeaderboard(gameId, limit);
  }

  function recommend() {
    return AIEngine.recommend(Stats.get());
  }

  function share(opts) {
    return Social.share(opts);
  }

  function version() {
    return (
      (typeof Config !== 'undefined' && Config.get('version')) ||
      (window.PH && window.PH.version) ||
      '4.0.0'
    );
  }

  function on(event, fn) {
    return Events.on(event, fn);
  }

  function registerGame(id, def) {
    if (typeof GameRegistry === 'undefined') throw new Error('GameRegistry unavailable');
    return GameRegistry.register(id, def);
  }

  function health() {
    return {
      version: version(),
      games: typeof GameRegistry !== 'undefined' ? GameRegistry.list() : [],
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      signedIn: typeof Cloud !== 'undefined' ? Cloud.isSignedIn() : false,
      recentErrors:
        typeof ErrorBoundary !== 'undefined' ? ErrorBoundary.getRecent().slice(-5) : [],
    };
  }

  return { getCatalog, play, leaderboard, recommend, share, version, on, registerGame, health };
})();

if (typeof window !== 'undefined') {
  window.PuzzleHubAPI = PuzzleHubAPI;
  if (window.PH) window.PH.API = PuzzleHubAPI;
}



/* ===== js/data/games-meta.js ===== */
/**
 * PuzzleHub — Game Catalog Metadata
 */
const GAMES_META = [
  {
    id: 'sudoku',
    name: 'Sudoku',
    desc: 'Fill the 9×9 grid so every row, column, and 3×3 box contains digits 1–9.',
    icon: '🔢',
    art: 'art-sudoku',
    difficulties: ['easy', 'medium', 'hard', 'expert'],
    category: 'logic',
    featured: true,
  },
  {
    id: 'crossword',
    name: 'Crossword',
    desc: 'Classic word puzzle. Fill in words from the clues across and down.',
    icon: '📝',
    art: 'art-crossword',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'word',
    featured: true,
  },
  {
    id: 'wordsearch',
    name: 'Word Search',
    desc: 'Find hidden words in a grid of letters. Swipe or drag to select.',
    icon: '🔍',
    art: 'art-wordsearch',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'word',
  },
  {
    id: 'cryptogram',
    name: 'Cryptogram',
    desc: 'Decode famous quotes by substituting letters. A classic cipher puzzle.',
    icon: '🔐',
    art: 'art-cryptogram',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'word',
  },
  {
    id: 'kakuro',
    name: 'Kakuro',
    desc: 'Cross-sums number puzzle. Fill cells so each run adds up to its clue.',
    icon: '➕',
    art: 'art-kakuro',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'logic',
  },
  {
    id: 'nonogram',
    name: 'Nonogram',
    desc: 'Picture logic puzzles. Paint cells to reveal a hidden image.',
    icon: '🖼️',
    art: 'art-nonogram',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'logic',
  },
  {
    id: '2048',
    name: '2048',
    desc: 'Slide numbered tiles to combine them. Reach 2048 to win!',
    icon: '🎯',
    art: 'art-2048',
    difficulties: ['normal'],
    category: 'arcade',
    featured: true,
  },
  {
    id: 'minesweeper',
    name: 'Minesweeper',
    desc: 'Clear the board without detonating any mines. Use number clues carefully.',
    icon: '💣',
    art: 'art-minesweeper',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'logic',
  },
  {
    id: 'memory',
    name: 'Memory',
    desc: 'Flip cards to find matching pairs. Test your memory and concentration.',
    icon: '🧠',
    art: 'art-memory',
    difficulties: ['easy', 'medium', 'hard'],
    category: 'arcade',
  },
];

const GAME_MAP = Object.fromEntries(GAMES_META.map(g => [g.id, g]));
if (typeof window !== 'undefined') { window.GAMES_META = GAMES_META; window.GAME_MAP = GAME_MAP; }



/* ===== js/games/sudoku.js ===== */
/**
 * PuzzleHub — Sudoku Engine
 * Full generator with uniqueness validation, notes, hints, error checking.
 */
class SudokuGame extends GameBase {
  constructor(opts) {
    super('sudoku', opts);
    this.SIZE = 9;
    this.solution = [];
    this.puzzle = [];
    this.grid = [];
    this.notes = [];
    this.selected = null; // {r,c}
    this.noteMode = false;
    this.DIFFICULTY_CLUES = { easy: 40, medium: 32, hard: 26, expert: 22 };
  }

  async init() {
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    this.rng = seed != null ? Utils.seededRandom(seed) : Math.random;

    if (!this.isDaily && this.loadSaved()) {
      // restored
    } else {
      this.generate();
      this.grid = this.puzzle.map(row => row.slice());
      this.notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    }
  }

  /* ---- Generation ---- */
  generate() {
    // Fill diagonal boxes then solve
    this.solution = Array.from({ length: 9 }, () => Array(9).fill(0));
    this.fillDiagonal();
    this.solve(this.solution);
    // Deep copy solution for puzzle
    this.puzzle = this.solution.map(r => r.slice());
    const clues = this.DIFFICULTY_CLUES[this.difficulty] || 32;
    this.removeCells(81 - clues);
  }

  fillDiagonal() {
    for (let b = 0; b < 9; b += 3) {
      this.fillBox(b, b);
    }
  }

  fillBox(row, col) {
    const arr = [1,2,3,4,5,6,7,8,9];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    let idx = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this.solution[row + r][col + c] = arr[idx++];
      }
    }
  }

  isValid(grid, r, c, n) {
    for (let i = 0; i < 9; i++) {
      if (grid[r][i] === n || grid[i][c] === n) return false;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (grid[br + i][bc + j] === n) return false;
      }
    }
    return true;
  }

  solve(grid) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] === 0) {
          const nums = [1,2,3,4,5,6,7,8,9];
          for (let i = nums.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [nums[i], nums[j]] = [nums[j], nums[i]];
          }
          for (const n of nums) {
            if (this.isValid(grid, r, c, n)) {
              grid[r][c] = n;
              if (this.solve(grid)) return true;
              grid[r][c] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  countSolutions(grid, limit = 2) {
    let count = 0;
    const solve = (g) => {
      if (count >= limit) return;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (g[r][c] === 0) {
            for (let n = 1; n <= 9; n++) {
              if (this.isValid(g, r, c, n)) {
                g[r][c] = n;
                solve(g);
                g[r][c] = 0;
              }
            }
            return;
          }
        }
      }
      count++;
    };
    solve(grid.map(r => r.slice()));
    return count;
  }

  removeCells(count) {
    const positions = [];
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        positions.push([r, c]);
    // Shuffle with rng
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    let removed = 0;
    for (const [r, c] of positions) {
      if (removed >= count) break;
      const backup = this.puzzle[r][c];
      this.puzzle[r][c] = 0;
      // For harder difficulties, skip uniqueness for speed on last cells
      if (this.difficulty === 'expert' && removed > count - 5) {
        removed++;
        continue;
      }
      if (this.countSolutions(this.puzzle, 2) !== 1) {
        this.puzzle[r][c] = backup;
      } else {
        removed++;
      }
    }
  }

  /* ---- State ---- */
  snapshot() {
    return {
      grid: this.grid.map(r => r.slice()),
      notes: this.notes.map(r => r.map(s => [...s])),
      puzzle: this.puzzle.map(r => r.slice()),
      solution: this.solution.map(r => r.slice()),
    };
  }

  restore(state) {
    this.grid = state.grid.map(r => r.slice());
    this.notes = state.notes.map(r => r.map(arr => new Set(arr)));
    this.puzzle = state.puzzle.map(r => r.slice());
    this.solution = state.solution.map(r => r.slice());
    if (this.container) this.renderBoard();
  }

  isFixed(r, c) {
    return this.puzzle[r][c] !== 0;
  }

  /* ---- Actions ---- */
  select(r, c) {
    this.selected = { r, c };
    this.renderBoard();
  }

  place(n) {
    if (!this.selected || this.won) return;
    const { r, c } = this.selected;
    if (this.isFixed(r, c)) return;

    this.pushUndo(this.snapshot());

    if (this.noteMode) {
      if (this.grid[r][c] !== 0) {
        this.grid[r][c] = 0;
      }
      if (this.notes[r][c].has(n)) this.notes[r][c].delete(n);
      else this.notes[r][c].add(n);
      AudioEngine.play('click');
    } else {
      if (this.grid[r][c] === n) {
        this.grid[r][c] = 0;
      } else {
        this.grid[r][c] = n;
        this.notes[r][c].clear();
        // Clear notes of n in related cells
        for (let i = 0; i < 9; i++) {
          this.notes[r][i].delete(n);
          this.notes[i][c].delete(n);
        }
        const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++)
            this.notes[br + i][bc + j].delete(n);
      }
      const correct = this.grid[r][c] === 0 || this.grid[r][c] === this.solution[r][c];
      AudioEngine.play(correct ? 'place' : 'error');
      if (!correct) Utils.vibrate(30);
    }
    this.renderBoard();
    this.afterMove();
  }

  erase() {
    if (!this.selected || this.won) return;
    const { r, c } = this.selected;
    if (this.isFixed(r, c)) return;
    this.pushUndo(this.snapshot());
    this.grid[r][c] = 0;
    this.notes[r][c].clear();
    this.renderBoard();
    AudioEngine.play('click');
    this.afterMove();
  }

  hint() {
    if (this.won) return;
    // Find empty or wrong cell
    const empties = [];
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (!this.isFixed(r, c) && this.grid[r][c] !== this.solution[r][c])
          empties.push([r, c]);
    if (empties.length === 0) return;
    const [r, c] = Utils.pick(empties);
    this.pushUndo(this.snapshot());
    this.grid[r][c] = this.solution[r][c];
    this.notes[r][c].clear();
    this.selected = { r, c };
    this.hintsUsed++;
    AudioEngine.play('hint');
    this.renderBoard();
    this.afterMove();
  }

  checkWin() {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (this.grid[r][c] !== this.solution[r][c]) return false;
    return true;
  }

  /* ---- Input ---- */
  onKeyDown(e) {
    super.onKeyDown(e);
    if (this.won || this.paused) return;
    if (e.key >= '1' && e.key <= '9') {
      this.place(parseInt(e.key));
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      this.erase();
    } else if (e.key === 'n' || e.key === 'N') {
      this.noteMode = !this.noteMode;
      this.updateNoteBtn();
    } else if (this.selected) {
      let { r, c } = this.selected;
      if (e.key === 'ArrowUp') { r = Math.max(0, r - 1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { r = Math.min(8, r + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { c = Math.max(0, c - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { c = Math.min(8, c + 1); e.preventDefault(); }
      else return;
      this.select(r, c);
    }
  }

  /* ---- Render ---- */
  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Sudoku'));

    const stage = Utils.el('div', { className: 'game-stage' });

    // Difficulty badge
    const diffBadge = Utils.el('div', { className: 'badge badge-brand', textContent: this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1) });
    if (this.isDaily) {
      stage.appendChild(Utils.el('div', { className: 'badge badge-warning', textContent: '📅 Daily Challenge', style: 'margin-bottom:8px' }));
    }
    stage.appendChild(diffBadge);

    const boardWrap = Utils.el('div', { className: 'board-wrap' });
    this.boardEl = Utils.el('div', {
      className: 'puzzle-board sudoku-board',
      role: 'grid',
      'aria-label': 'Sudoku grid',
    });
    boardWrap.appendChild(this.boardEl);
    stage.appendChild(boardWrap);

    // Controls
    const controls = Utils.el('div', { className: 'game-controls' });
    this.noteBtn = Utils.el('button', {
      className: 'btn btn-secondary',
      innerHTML: Utils.icon('note', 16) + ' Notes',
      onClick: () => {
        this.noteMode = !this.noteMode;
        this.updateNoteBtn();
        AudioEngine.play('click');
      },
    });
    controls.appendChild(this.noteBtn);
    controls.appendChild(Utils.el('button', {
      className: 'btn btn-secondary',
      innerHTML: Utils.icon('erase', 16) + ' Erase',
      onClick: () => this.erase(),
    }));
    stage.appendChild(controls);

    // Number pad
    const pad = Utils.el('div', { className: 'game-numpad', role: 'group', 'aria-label': 'Number pad' });
    for (let n = 1; n <= 9; n++) {
      pad.appendChild(Utils.el('button', {
        className: 'btn btn-secondary',
        textContent: String(n),
        'aria-label': `Place ${n}`,
        onClick: () => this.place(n),
      }));
    }
    stage.appendChild(pad);

    this.container.appendChild(stage);
    this.renderBoard();
  }

  updateNoteBtn() {
    if (this.noteBtn) {
      this.noteBtn.classList.toggle('note-active', this.noteMode);
    }
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.innerHTML = '';
    const settings = Storage.getSettings();
    const sel = this.selected;
    const selVal = sel ? this.grid[sel.r][sel.c] : 0;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = this.grid[r][c];
        const fixed = this.isFixed(r, c);
        const cell = Utils.el('div', {
          className: 'puzzle-cell',
          role: 'gridcell',
          tabindex: '0',
          'aria-label': `Row ${r + 1} Column ${c + 1}${val ? ', ' + val : ', empty'}${fixed ? ', given' : ''}`,
          dataset: { r: String(r), c: String(c) },
        });

        // Selection / highlight
        if (sel && sel.r === r && sel.c === c) cell.classList.add('selected');
        else if (settings.highlightRelated !== false && sel) {
          if (sel.r === r || sel.c === c ||
              (Math.floor(sel.r / 3) === Math.floor(r / 3) && Math.floor(sel.c / 3) === Math.floor(c / 3))) {
            cell.classList.add('highlight');
          }
          if (selVal && val === selVal) cell.classList.add('highlight');
        }

        if (fixed) cell.classList.add('fixed');
        else if (val) cell.classList.add('user');

        // Error check
        if (val && settings.autoCheck && val !== this.solution[r][c]) {
          cell.classList.add('error');
        }

        if (val) {
          cell.textContent = val;
        } else if (this.notes[r][c].size > 0) {
          const notesEl = Utils.el('div', { className: 'sudoku-notes' });
          for (let n = 1; n <= 9; n++) {
            notesEl.appendChild(Utils.el('span', {
              textContent: this.notes[r][c].has(n) ? String(n) : '',
            }));
          }
          cell.appendChild(notesEl);
        }

        cell.addEventListener('click', () => this.select(r, c));
        this.boardEl.appendChild(cell);
      }
    }
  }
}

if (typeof window !== 'undefined') { window.SudokuGame = SudokuGame; }



/* ===== js/games/minesweeper.js ===== */
/**
 * PuzzleHub — Minesweeper
 */
class MinesweeperGame extends GameBase {
  constructor(opts) {
    super('minesweeper', opts);
    this.CONFIG = {
      easy: { rows: 9, cols: 9, mines: 10 },
      medium: { rows: 16, cols: 16, mines: 40 },
      hard: { rows: 16, cols: 30, mines: 99 },
    };
    this.cfg = this.CONFIG[this.difficulty] || this.CONFIG.easy;
    this.rows = this.cfg.rows;
    this.cols = this.cfg.cols;
    this.mineCount = this.cfg.mines;
    this.grid = []; // -1 mine, 0-8 count
    this.revealed = [];
    this.flagged = [];
    this.firstClick = true;
    this.flagsLeft = this.mineCount;
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    this.revealed = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
    this.flagged = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));
    this.firstClick = true;
    this.flagsLeft = this.mineCount;
  }

  placeMines(safeR, safeC) {
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    const rng = seed != null ? Utils.seededRandom(seed + safeR * 100 + safeC) : Math.random;
    let placed = 0;
    while (placed < this.mineCount) {
      const r = Math.floor(rng() * this.rows);
      const c = Math.floor(rng() * this.cols);
      if (this.grid[r][c] === -1) continue;
      if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
      this.grid[r][c] = -1;
      placed++;
    }
    // Calculate numbers
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] === -1) continue;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols && this.grid[nr][nc] === -1) count++;
          }
        this.grid[r][c] = count;
      }
    }
  }

  snapshot() {
    return {
      grid: this.grid.map(r => r.slice()),
      revealed: this.revealed.map(r => r.slice()),
      flagged: this.flagged.map(r => r.slice()),
      firstClick: this.firstClick,
      flagsLeft: this.flagsLeft,
      rows: this.rows, cols: this.cols, mineCount: this.mineCount,
    };
  }

  restore(state) {
    this.grid = state.grid.map(r => r.slice());
    this.revealed = state.revealed.map(r => r.slice());
    this.flagged = state.flagged.map(r => r.slice());
    this.firstClick = state.firstClick;
    this.flagsLeft = state.flagsLeft;
    this.rows = state.rows; this.cols = state.cols; this.mineCount = state.mineCount;
    if (this.container) this.renderBoard();
  }

  reveal(r, c) {
    if (this.won || this.revealed[r][c] || this.flagged[r][c]) return;
    if (this.firstClick) {
      this.placeMines(r, c);
      this.firstClick = false;
    }
    this.pushUndo(this.snapshot());

    if (this.grid[r][c] === -1) {
      // Boom
      this.revealed[r][c] = true;
      this.exploded = { r, c };
      this.revealAll();
      this.renderBoard();
      AudioEngine.play('error');
      Utils.vibrate([100, 50, 100]);
      this.stopTimer();
      Toast.show({ type: 'error', title: 'Game Over', message: 'You hit a mine!' });
      return;
    }

    this.floodReveal(r, c);
    AudioEngine.play('reveal');
    this.renderBoard();
    this.afterMove();
  }

  floodReveal(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
    if (this.revealed[r][c] || this.flagged[r][c]) return;
    this.revealed[r][c] = true;
    if (this.grid[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (dr || dc) this.floodReveal(r + dr, c + dc);
    }
  }

  toggleFlag(r, c) {
    if (this.won || this.revealed[r][c]) return;
    this.pushUndo(this.snapshot());
    this.flagged[r][c] = !this.flagged[r][c];
    this.flagsLeft += this.flagged[r][c] ? -1 : 1;
    AudioEngine.play('flag');
    this.updateFlagDisplay();
    this.renderBoard();
    this.afterMove();
  }

  revealAll() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.grid[r][c] === -1) this.revealed[r][c] = true;
  }

  checkWin() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.grid[r][c] !== -1 && !this.revealed[r][c]) return false;
    return true;
  }

  onKeyDown(e) {
    super.onKeyDown(e);
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Minesweeper'));
    const stage = Utils.el('div', { className: 'game-stage' });

    this.flagDisplay = Utils.el('div', {
      className: 'badge badge-warning',
      textContent: `🚩 ${this.flagsLeft}`,
      style: 'font-size:14px;padding:6px 14px',
    });
    stage.appendChild(this.flagDisplay);

    this.boardEl = Utils.el('div', {
      className: 'minesweeper-board',
      role: 'grid',
      'aria-label': 'Minesweeper board',
      style: `grid-template-columns: repeat(${this.cols}, auto)`,
    });
    const wrap = Utils.el('div', { className: 'board-wrap', style: 'aspect-ratio:auto;max-width:100%;width:auto' });
    wrap.appendChild(this.boardEl);
    stage.appendChild(wrap);

    // Long-press support note
    stage.appendChild(Utils.el('p', {
      style: 'font-size:12px;color:var(--text-tertiary);text-align:center',
      textContent: 'Left-click to reveal · Right-click / long-press to flag',
    }));

    this.container.appendChild(stage);
    this.renderBoard();
  }

  updateFlagDisplay() {
    if (this.flagDisplay) this.flagDisplay.textContent = `🚩 ${this.flagsLeft}`;
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.innerHTML = '';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = Utils.el('div', {
          className: 'ms-cell',
          role: 'gridcell',
          tabindex: '0',
          'aria-label': this.cellLabel(r, c),
        });
        if (this.revealed[r][c]) {
          cell.classList.add('revealed');
          if (this.grid[r][c] === -1) {
            cell.classList.add('mine');
            cell.textContent = '💣';
            if (this.exploded && this.exploded.r === r && this.exploded.c === c) {
              cell.classList.add('exploded');
              cell.textContent = '💥';
            }
          } else if (this.grid[r][c] > 0) {
            cell.textContent = this.grid[r][c];
            cell.classList.add('ms-n' + this.grid[r][c]);
          }
        } else if (this.flagged[r][c]) {
          cell.classList.add('flagged');
          cell.textContent = '🚩';
        }

        cell.addEventListener('click', (e) => {
          e.preventDefault();
          this.reveal(r, c);
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.toggleFlag(r, c);
        });

        // Long press for mobile flag
        let pressTimer;
        cell.addEventListener('touchstart', (e) => {
          pressTimer = setTimeout(() => {
            this.toggleFlag(r, c);
            pressTimer = null;
          }, 400);
        }, { passive: true });
        cell.addEventListener('touchend', () => {
          if (pressTimer) { clearTimeout(pressTimer); }
        });
        cell.addEventListener('touchmove', () => {
          if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        }, { passive: true });

        this.boardEl.appendChild(cell);
      }
    }
  }

  cellLabel(r, c) {
    if (this.flagged[r][c]) return `Flagged, row ${r + 1} col ${c + 1}`;
    if (!this.revealed[r][c]) return `Hidden, row ${r + 1} col ${c + 1}`;
    if (this.grid[r][c] === -1) return 'Mine';
    return `${this.grid[r][c]} adjacent mines, row ${r + 1} col ${c + 1}`;
  }
}

if (typeof window !== 'undefined') { window.MinesweeperGame = MinesweeperGame; }



/* ===== js/games/game2048.js ===== */
/**
 * PuzzleHub — 2048
 */
class Game2048 extends GameBase {
  constructor(opts) {
    super('2048', opts);
    this.size = 4;
    this.board = [];
    this.score = 0;
    this.bestScore = 0;
    this.won2048 = false;
    this.continueAfterWin = false;
  }

  async init() {
    const gStats = Stats.getGameStats('2048');
    this.bestScore = Storage.get('best_2048', 0);
    if (!this.isDaily && this.loadSaved()) return;
    this.board = Array.from({ length: 4 }, () => Array(4).fill(0));
    this.score = 0;
    this.won2048 = false;
    this.continueAfterWin = false;
    this.addTile();
    this.addTile();
  }

  addTile() {
    const empty = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (this.board[r][c] === 0) empty.push([r, c]);
    if (empty.length === 0) return false;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    this.board[r][c] = Math.random() < 0.9 ? 2 : 4;
    this.lastNew = { r, c };
    return true;
  }

  snapshot() {
    return {
      board: this.board.map(r => r.slice()),
      score: this.score,
      won2048: this.won2048,
      continueAfterWin: this.continueAfterWin,
    };
  }

  restore(state) {
    this.board = state.board.map(r => r.slice());
    this.score = state.score;
    this.won2048 = state.won2048;
    this.continueAfterWin = state.continueAfterWin;
    if (this.container) this.renderBoard();
  }

  move(dir) {
    if (this.won && !this.continueAfterWin) return;
    this.pushUndo(this.snapshot());
    const prev = JSON.stringify(this.board);
    this.lastMerged = [];

    // dir: 0=up, 1=right, 2=down, 3=left
    const rotated = this.rotateBoard(this.board, dir);
    let moved = false;
    let scoreGain = 0;

    for (let r = 0; r < 4; r++) {
      const row = rotated[r].filter(v => v !== 0);
      const newRow = [];
      for (let i = 0; i < row.length; i++) {
        if (i + 1 < row.length && row[i] === row[i + 1]) {
          const merged = row[i] * 2;
          newRow.push(merged);
          scoreGain += merged;
          this.lastMerged.push(merged);
          if (merged === 2048 && !this.won2048) this.won2048 = true;
          i++;
        } else {
          newRow.push(row[i]);
        }
      }
      while (newRow.length < 4) newRow.push(0);
      rotated[r] = newRow;
    }

    this.board = this.rotateBoard(rotated, (4 - dir) % 4);
    this.score += scoreGain;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      Storage.set('best_2048', this.bestScore);
    }

    if (JSON.stringify(this.board) !== prev) {
      this.addTile();
      AudioEngine.play(scoreGain > 0 ? 'merge' : 'place');
      this.renderBoard();
      this.updateScores();
      this.afterMove();

      if (this.won2048 && !this.continueAfterWin && !this.won) {
        this.continueAfterWin = true;
        this.onWin();
      } else if (!this.canMove()) {
        this.gameOver();
      }
    } else {
      // No move — pop the undo we just pushed
      this.undoStack.pop();
    }
  }

  rotateBoard(board, times) {
    let b = board.map(r => r.slice());
    for (let t = 0; t < times; t++) {
      const n = Array.from({ length: 4 }, () => Array(4).fill(0));
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
          n[c][3 - r] = b[r][c];
      b = n;
    }
    return b;
  }

  canMove() {
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        if (this.board[r][c] === 0) return true;
        if (c < 3 && this.board[r][c] === this.board[r][c + 1]) return true;
        if (r < 3 && this.board[r][c] === this.board[r + 1][c]) return true;
      }
    return false;
  }

  checkWin() {
    // Win is handled specially for 2048 (reaching tile)
    return false;
  }

  gameOver() {
    this.stopTimer();
    AudioEngine.play('error');
    Toast.show({ type: 'error', title: 'Game Over', message: `Score: ${this.score}` });
    const wrap = this.container.querySelector('.board-wrap') || this.boardContainer;
    if (wrap) {
      const overlay = Utils.el('div', { className: 'win-overlay' }, [
        Utils.el('div', { className: 'win-overlay__emoji', textContent: '😢' }),
        Utils.el('div', { className: 'win-overlay__title', textContent: 'Game Over' }),
        Utils.el('div', { className: 'stat-item__value', textContent: String(this.score), style: 'font-size:2rem;margin:8px 0' }),
        Utils.el('button', {
          className: 'btn btn-primary',
          textContent: 'Try Again',
          onClick: () => this.restart(),
        }),
      ]);
      wrap.style.position = 'relative';
      wrap.appendChild(overlay);
    }
  }

  onKeyDown(e) {
    super.onKeyDown(e);
    if (this.won && !this.continueAfterWin) return;
    const map = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
    if (e.key in map) {
      e.preventDefault();
      this.move(map[e.key]);
    }
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('2048'));
    const stage = Utils.el('div', { className: 'game-stage' });

    const game = Utils.el('div', { className: 'game-2048' });
    const scoreRow = Utils.el('div', { className: 'game-2048__score-row' });
    this.scoreEl = Utils.el('div', { className: 'game-2048__score-box' }, [
      Utils.el('div', { className: 'label', textContent: 'Score' }),
      Utils.el('div', { className: 'value', textContent: String(this.score) }),
    ]);
    this.bestEl = Utils.el('div', { className: 'game-2048__score-box' }, [
      Utils.el('div', { className: 'label', textContent: 'Best' }),
      Utils.el('div', { className: 'value', textContent: String(this.bestScore) }),
    ]);
    scoreRow.append(this.scoreEl, this.bestEl);
    game.appendChild(scoreRow);

    this.boardContainer = Utils.el('div', { className: 'board-wrap', style: 'max-width:400px' });
    this.boardEl = Utils.el('div', { className: 'board-2048', role: 'grid', 'aria-label': '2048 board' });
    // Background cells
    for (let i = 0; i < 16; i++) {
      this.boardEl.appendChild(Utils.el('div', { className: 'cell-2048-bg' }));
    }
    this.boardContainer.appendChild(this.boardEl);
    game.appendChild(this.boardContainer);

    game.appendChild(Utils.el('p', {
      style: 'font-size:13px;color:var(--text-tertiary);text-align:center',
      textContent: 'Use arrow keys or swipe to move tiles',
    }));

    stage.appendChild(game);
    this.container.appendChild(stage);
    this.renderBoard();
    this.setupTouch();
  }

  updateScores() {
    if (this.scoreEl) this.scoreEl.querySelector('.value').textContent = String(this.score);
    if (this.bestEl) this.bestEl.querySelector('.value').textContent = String(this.bestScore);
  }

  renderBoard() {
    if (!this.boardEl) return;
    // Remove old tiles
    this.boardEl.querySelectorAll('.tile-2048').forEach(t => t.remove());
    const gap = 8;
    const pad = 8;
    const size = this.boardEl.clientWidth || 300;
    const cellSize = (size - pad * 2 - gap * 3) / 4;

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = this.board[r][c];
        if (!val) continue;
        const cls = val > 2048 ? 'tile-super' : `tile-${val}`;
        const isNew = this.lastNew && this.lastNew.r === r && this.lastNew.c === c;
        const tile = Utils.el('div', {
          className: `tile-2048 ${cls}${isNew ? ' new' : ''}`,
          textContent: String(val),
          style: `width:${cellSize}px;height:${cellSize}px;left:${pad + c * (cellSize + gap)}px;top:${pad + r * (cellSize + gap)}px;`,
        });
        this.boardEl.appendChild(tile);
      }
    }
    this.lastNew = null;
  }

  setupTouch() {
    let startX, startY;
    const el = this.boardEl;
    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        this.move(dx > 0 ? 1 : 3);
      } else {
        this.move(dy > 0 ? 2 : 0);
      }
      startX = startY = null;
    });
  }
}

if (typeof window !== 'undefined') { window.Game2048 = Game2048; }



/* ===== js/games/memory.js ===== */
/**
 * PuzzleHub — Memory Match Game
 */
class MemoryGame extends GameBase {
  constructor(opts) {
    super('memory', opts);
    this.CONFIG = {
      easy: { pairs: 6, cols: 4 },
      medium: { pairs: 8, cols: 4 },
      hard: { pairs: 12, cols: 6 },
    };
    this.cfg = this.CONFIG[this.difficulty] || this.CONFIG.medium;
    this.EMOJIS = ['🍎','🍊','🍋','🍇','🍓','🍒','🥝','🍑','🍍','🥥','🍉','🍌','🥑','🌽','🥕','🌶️','🍄','🧀','🥨','🍪','🍩','🎂','🍫','🍬'];
    this.cards = [];
    this.flipped = [];
    this.matched = new Set();
    this.locked = false;
    this.matches = 0;
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    const rng = seed != null ? Utils.seededRandom(seed) : Math.random;
    const emojis = this.EMOJIS.slice(0, this.cfg.pairs);
    const deck = [...emojis, ...emojis];
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.cards = deck;
    this.flipped = [];
    this.matched = new Set();
    this.locked = false;
    this.matches = 0;
  }

  snapshot() {
    return {
      cards: this.cards.slice(),
      matched: [...this.matched],
      matches: this.matches,
      cfg: this.cfg,
    };
  }

  restore(state) {
    this.cards = state.cards;
    this.matched = new Set(state.matched);
    this.matches = state.matches;
    this.cfg = state.cfg;
    this.flipped = [];
    this.locked = false;
    if (this.container) this.renderBoard();
  }

  flip(idx) {
    if (this.locked || this.won || this.matched.has(idx) || this.flipped.includes(idx)) return;
    this.flipped.push(idx);
    AudioEngine.play('flip');
    this.renderBoard();

    if (this.flipped.length === 2) {
      this.locked = true;
      const [a, b] = this.flipped;
      if (this.cards[a] === this.cards[b]) {
        this.matched.add(a);
        this.matched.add(b);
        this.matches++;
        this.flipped = [];
        this.locked = false;
        AudioEngine.play('success');
        this.renderBoard();
        this.afterMove();
      } else {
        setTimeout(() => {
          this.flipped = [];
          this.locked = false;
          this.renderBoard();
          this.afterMove();
        }, 700);
      }
    }
  }

  checkWin() {
    return this.matched.size === this.cards.length;
  }

  onKeyDown(e) {
    super.onKeyDown(e);
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Memory'));
    const stage = Utils.el('div', { className: 'game-stage' });

    stage.appendChild(Utils.el('div', {
      className: 'badge badge-brand',
      textContent: `${this.matches} / ${this.cfg.pairs} pairs`,
    }));
    this.matchBadge = stage.lastChild;

    this.boardEl = Utils.el('div', {
      className: 'memory-board',
      role: 'grid',
      'aria-label': 'Memory cards',
      style: `grid-template-columns: repeat(${this.cfg.cols}, 1fr)`,
    });
    const wrap = Utils.el('div', { className: 'board-wrap', style: 'aspect-ratio:auto;max-width:480px' });
    wrap.appendChild(this.boardEl);
    stage.appendChild(wrap);
    this.container.appendChild(stage);
    this.renderBoard();
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.innerHTML = '';
    if (this.matchBadge) this.matchBadge.textContent = `${this.matches} / ${this.cfg.pairs} pairs`;

    this.cards.forEach((emoji, idx) => {
      const isFlipped = this.flipped.includes(idx) || this.matched.has(idx);
      const card = Utils.el('button', {
        className: `memory-card${isFlipped ? ' flipped' : ''}${this.matched.has(idx) ? ' matched' : ''}`,
        'aria-label': isFlipped ? emoji : `Card ${idx + 1}, face down`,
        'aria-pressed': String(isFlipped),
      });
      const inner = Utils.el('div', { className: 'memory-card__inner' }, [
        Utils.el('div', { className: 'memory-card__face memory-card__front', textContent: '?' }),
        Utils.el('div', { className: 'memory-card__face memory-card__back', textContent: emoji }),
      ]);
      card.appendChild(inner);
      card.addEventListener('click', () => this.flip(idx));
      this.boardEl.appendChild(card);
    });
  }
}

if (typeof window !== 'undefined') { window.MemoryGame = MemoryGame; }



/* ===== js/games/wordsearch.js ===== */
/**
 * PuzzleHub — Word Search
 */
class WordSearchGame extends GameBase {
  constructor(opts) {
    super('wordsearch', opts);
    this.WORD_LISTS = {
      easy: ['CAT','DOG','BIRD','FISH','LION','BEAR','FROG','DUCK','WOLF','DEER'],
      medium: ['PUZZLE','SEARCH','LETTER','HIDDEN','GRID','FIND','WORD','GAME','BRAIN','LOGIC','SMART','SOLVE'],
      hard: ['ALGORITHM','CHALLENGE','DISCOVER','EXPLORER','KNOWLEDGE','MYSTERY','PATTERN','SEQUENCE','STRATEGY','VICTORY','WISDOM','ZEPHYR'],
    };
    this.DIRS = [[0,1],[1,0],[1,1],[1,-1],[0,-1],[-1,0],[-1,-1],[-1,1]];
    this.size = { easy: 8, medium: 12, hard: 15 }[this.difficulty] || 12;
    this.grid = [];
    this.words = [];
    this.found = new Set();
    this.placements = {}; // word -> [{r,c},...]
    this.selecting = false;
    this.selStart = null;
    this.selCells = [];
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    this.rng = seed != null ? Utils.seededRandom(seed) : Math.random;
    const pool = this.WORD_LISTS[this.difficulty] || this.WORD_LISTS.medium;
    const count = { easy: 6, medium: 8, hard: 10 }[this.difficulty] || 8;
    // Pick words
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.words = shuffled.slice(0, count).map(w => w.toUpperCase());
    this.found = new Set();
    this.placements = {};
    this.generateGrid();
  }

  generateGrid() {
    const n = this.size;
    this.grid = Array.from({ length: n }, () => Array(n).fill(''));
    for (const word of this.words) {
      this.placeWord(word);
    }
    // Fill empty
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (!this.grid[r][c]) this.grid[r][c] = letters[Math.floor(this.rng() * 26)];
  }

  placeWord(word) {
    const n = this.size;
    const dirs = this.DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      const [dr, dc] = dirs[attempt % dirs.length];
      const r = Math.floor(this.rng() * n);
      const c = Math.floor(this.rng() * n);
      const endR = r + dr * (word.length - 1);
      const endC = c + dc * (word.length - 1);
      if (endR < 0 || endR >= n || endC < 0 || endC >= n) continue;
      // Check fit
      let ok = true;
      const cells = [];
      for (let i = 0; i < word.length; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (this.grid[nr][nc] && this.grid[nr][nc] !== word[i]) { ok = false; break; }
        cells.push({ r: nr, c: nc });
      }
      if (!ok) continue;
      for (let i = 0; i < word.length; i++) {
        this.grid[cells[i].r][cells[i].c] = word[i];
      }
      this.placements[word] = cells;
      return true;
    }
    return false;
  }

  snapshot() {
    return {
      grid: this.grid.map(r => r.slice()),
      words: this.words.slice(),
      found: [...this.found],
      placements: this.placements,
      size: this.size,
    };
  }

  restore(state) {
    this.grid = state.grid.map(r => r.slice());
    this.words = state.words;
    this.found = new Set(state.found);
    this.placements = state.placements;
    this.size = state.size;
    if (this.container) this.renderBoard();
  }

  getLineCells(r1, c1, r2, c2) {
    const dr = r2 - r1, dc = c2 - c1;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    if (steps === 0) return [{ r: r1, c: c1 }];
    // Must be straight line (horizontal, vertical, or diagonal)
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return [];
    const sr = dr === 0 ? 0 : dr / Math.abs(dr);
    const sc = dc === 0 ? 0 : dc / Math.abs(dc);
    const cells = [];
    for (let i = 0; i <= steps; i++) {
      cells.push({ r: r1 + sr * i, c: c1 + sc * i });
    }
    return cells;
  }

  checkSelection() {
    if (this.selCells.length < 2) return;
    const letters = this.selCells.map(({ r, c }) => this.grid[r][c]).join('');
    const rev = letters.split('').reverse().join('');
    for (const word of this.words) {
      if (this.found.has(word)) continue;
      if (letters === word || rev === word) {
        this.found.add(word);
        AudioEngine.play('success');
        Utils.vibrate(20);
        this.renderBoard();
        this.renderWords();
        this.afterMove();
        return;
      }
    }
    AudioEngine.play('click');
  }

  checkWin() {
    return this.found.size === this.words.length;
  }

  hint() {
    super.hint();
    for (const word of this.words) {
      if (!this.found.has(word)) {
        this.found.add(word);
        this.renderBoard();
        this.renderWords();
        this.afterMove();
        return;
      }
    }
  }

  onKeyDown(e) {
    super.onKeyDown(e);
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Word Search'));
    const stage = Utils.el('div', { className: 'game-stage' });
    const layout = Utils.el('div', { className: 'wordsearch-layout' });

    this.boardEl = Utils.el('div', {
      className: 'wordsearch-board',
      role: 'grid',
      'aria-label': 'Word search grid',
      style: `grid-template-columns: repeat(${this.size}, 1fr); width: min(100%, ${this.size * 32}px)`,
    });
    layout.appendChild(this.boardEl);

    this.wordsEl = Utils.el('div', { className: 'wordsearch-words' });
    layout.appendChild(this.wordsEl);

    stage.appendChild(layout);
    this.container.appendChild(stage);
    this.renderBoard();
    this.renderWords();
    this.setupPointer();
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.innerHTML = '';
    const foundCells = new Set();
    for (const word of this.found) {
      const cells = this.placements[word] || [];
      cells.forEach(({ r, c }) => foundCells.add(`${r},${c}`));
    }
    const selSet = new Set(this.selCells.map(({ r, c }) => `${r},${c}`));

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const key = `${r},${c}`;
        const cell = Utils.el('div', {
          className: `wordsearch-cell${foundCells.has(key) ? ' found' : ''}${selSet.has(key) ? ' selecting' : ''}`,
          textContent: this.grid[r][c],
          dataset: { r: String(r), c: String(c) },
          role: 'gridcell',
        });
        this.boardEl.appendChild(cell);
      }
    }
  }

  renderWords() {
    if (!this.wordsEl) return;
    this.wordsEl.innerHTML = '';
    for (const word of this.words) {
      this.wordsEl.appendChild(Utils.el('span', {
        className: `wordsearch-word${this.found.has(word) ? ' found' : ''}`,
        textContent: word,
      }));
    }
  }

  setupPointer() {
    const el = this.boardEl;
    const getCell = (e) => {
      const target = document.elementFromPoint(
        e.touches ? e.touches[0].clientX : e.clientX,
        e.touches ? e.touches[0].clientY : e.clientY
      );
      if (!target || !target.dataset.r) return null;
      return { r: +target.dataset.r, c: +target.dataset.c };
    };

    const start = (e) => {
      const cell = getCell(e);
      if (!cell) return;
      this.selecting = true;
      this.selStart = cell;
      this.selCells = [cell];
      this.renderBoard();
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.selecting || !this.selStart) return;
      const cell = getCell(e);
      if (!cell) return;
      this.selCells = this.getLineCells(this.selStart.r, this.selStart.c, cell.r, cell.c);
      this.renderBoard();
      e.preventDefault();
    };
    const end = () => {
      if (!this.selecting) return;
      this.selecting = false;
      this.checkSelection();
      this.selCells = [];
      this.selStart = null;
      this.renderBoard();
    };

    el.addEventListener('mousedown', start);
    el.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    this._wsCleanup = () => {
      el.removeEventListener('mousedown', start);
      el.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
  }

  destroy() {
    if (this._wsCleanup) this._wsCleanup();
    super.destroy();
  }
}

if (typeof window !== 'undefined') { window.WordSearchGame = WordSearchGame; }



/* ===== js/games/cryptogram.js ===== */
/**
 * PuzzleHub — Cryptogram
 */
class CryptogramGame extends GameBase {
  constructor(opts) {
    super('cryptogram', opts);
    this.QUOTES = [
      { text: 'THE ONLY WAY TO DO GREAT WORK IS TO LOVE WHAT YOU DO', author: 'Steve Jobs' },
      { text: 'IN THE MIDDLE OF DIFFICULTY LIES OPPORTUNITY', author: 'Albert Einstein' },
      { text: 'LIFE IS WHAT HAPPENS WHEN YOU ARE BUSY MAKING OTHER PLANS', author: 'John Lennon' },
      { text: 'THE FUTURE BELONGS TO THOSE WHO BELIEVE IN THE BEAUTY OF THEIR DREAMS', author: 'Eleanor Roosevelt' },
      { text: 'IT DOES NOT MATTER HOW SLOWLY YOU GO AS LONG AS YOU DO NOT STOP', author: 'Confucius' },
      { text: 'THE JOURNEY OF A THOUSAND MILES BEGINS WITH ONE STEP', author: 'Lao Tzu' },
      { text: 'BE YOURSELF EVERYONE ELSE IS ALREADY TAKEN', author: 'Oscar Wilde' },
      { text: 'TWO THINGS ARE INFINITE THE UNIVERSE AND HUMAN STUPIDITY', author: 'Albert Einstein' },
      { text: 'A PERSON WHO NEVER MADE A MISTAKE NEVER TRIED ANYTHING NEW', author: 'Albert Einstein' },
      { text: 'THE BEST TIME TO PLANT A TREE WAS TWENTY YEARS AGO THE SECOND BEST TIME IS NOW', author: 'Chinese Proverb' },
      { text: 'HAPPINESS IS NOT SOMETHING READY MADE IT COMES FROM YOUR OWN ACTIONS', author: 'Dalai Lama' },
      { text: 'THE ONLY IMPOSSIBLE JOURNEY IS THE ONE YOU NEVER BEGIN', author: 'Tony Robbins' },
      { text: 'SUCCESS IS NOT FINAL FAILURE IS NOT FATAL IT IS THE COURAGE TO CONTINUE THAT COUNTS', author: 'Winston Churchill' },
      { text: 'BELIEVE YOU CAN AND YOU ARE HALFWAY THERE', author: 'Theodore Roosevelt' },
      { text: 'EVERYTHING YOU CAN IMAGINE IS REAL', author: 'Pablo Picasso' },
    ];
    this.plaintext = '';
    this.author = '';
    this.cipher = {}; // plain -> cipher
    this.mapping = {}; // cipher letter -> player guess
    this.selectedCipher = null;
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    this.rng = seed != null ? Utils.seededRandom(seed) : Math.random;
    const idx = Math.floor(this.rng() * this.QUOTES.length);
    const q = this.QUOTES[idx];
    this.plaintext = q.text.toUpperCase();
    this.author = q.author;
    this.generateCipher();
    this.mapping = {};
    this.selectedCipher = null;

    // For easy: pre-fill a few letters
    if (this.difficulty === 'easy') {
      const letters = [...new Set(this.plaintext.replace(/[^A-Z]/g, ''))];
      const count = Math.min(3, letters.length);
      for (let i = 0; i < count; i++) {
        const p = letters[i];
        this.mapping[this.cipher[p]] = p;
      }
    }
  }

  generateCipher() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    let shuffled;
    do {
      shuffled = alphabet.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    } while (shuffled.some((c, i) => c === alphabet[i])); // no fixed points
    this.cipher = {};
    this.reverseCipher = {};
    alphabet.forEach((p, i) => {
      this.cipher[p] = shuffled[i];
      this.reverseCipher[shuffled[i]] = p;
    });
  }

  encode(ch) {
    if (ch >= 'A' && ch <= 'Z') return this.cipher[ch];
    return ch;
  }

  snapshot() {
    return {
      plaintext: this.plaintext,
      author: this.author,
      cipher: { ...this.cipher },
      reverseCipher: { ...this.reverseCipher },
      mapping: { ...this.mapping },
    };
  }

  restore(state) {
    this.plaintext = state.plaintext;
    this.author = state.author;
    this.cipher = state.cipher;
    this.reverseCipher = state.reverseCipher;
    this.mapping = state.mapping;
    if (this.container) this.renderQuote();
  }

  setMapping(cipherLetter, plainLetter) {
    this.pushUndo(this.snapshot());
    // Remove any existing mapping to this plain letter
    for (const [c, p] of Object.entries(this.mapping)) {
      if (p === plainLetter) delete this.mapping[c];
    }
    if (plainLetter) {
      this.mapping[cipherLetter] = plainLetter;
    } else {
      delete this.mapping[cipherLetter];
    }
    AudioEngine.play('place');
    this.renderQuote();
    this.renderKeyboard();
    this.afterMove();
  }

  checkWin() {
    const letters = new Set(this.plaintext.replace(/[^A-Z]/g, ''));
    for (const p of letters) {
      const c = this.cipher[p];
      if (this.mapping[c] !== p) return false;
    }
    return true;
  }

  hint() {
    super.hint();
    const letters = [...new Set(this.plaintext.replace(/[^A-Z]/g, ''))];
    for (const p of letters) {
      const c = this.cipher[p];
      if (this.mapping[c] !== p) {
        this.setMapping(c, p);
        return;
      }
    }
  }

  onKeyDown(e) {
    super.onKeyDown(e);
    if (this.won || !this.selectedCipher) return;
    if (e.key >= 'a' && e.key <= 'z' || e.key >= 'A' && e.key <= 'Z') {
      this.setMapping(this.selectedCipher, e.key.toUpperCase());
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      this.setMapping(this.selectedCipher, null);
    }
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Cryptogram'));
    const stage = Utils.el('div', { className: 'game-stage' });

    const container = Utils.el('div', { className: 'cryptogram-container' });
    this.quoteEl = Utils.el('div', { className: 'cryptogram-quote', role: 'group', 'aria-label': 'Cryptogram puzzle' });
    container.appendChild(this.quoteEl);

    container.appendChild(Utils.el('p', {
      style: 'text-align:center;font-size:13px;color:var(--text-tertiary);font-style:italic',
      textContent: '— decode the quote —',
    }));

    this.keyboardEl = Utils.el('div', { className: 'crypto-keyboard', role: 'group', 'aria-label': 'Letter keyboard' });
    container.appendChild(this.keyboardEl);

    stage.appendChild(container);
    this.container.appendChild(stage);
    this.renderQuote();
    this.renderKeyboard();
  }

  renderQuote() {
    if (!this.quoteEl) return;
    this.quoteEl.innerHTML = '';
    const words = this.plaintext.split(' ');
    for (const word of words) {
      const wordEl = Utils.el('div', { className: 'crypto-word' });
      for (const ch of word) {
        if (ch >= 'A' && ch <= 'Z') {
          const cipher = this.encode(ch);
          const guess = this.mapping[cipher] || '';
          const isCorrect = guess === ch;
          const letterEl = Utils.el('div', { className: 'crypto-letter' }, [
            Utils.el('div', { className: 'crypto-letter__cipher', textContent: cipher }),
          ]);
          const input = Utils.el('input', {
            className: `crypto-letter__input${guess && isCorrect ? ' correct' : ''}${guess && !isCorrect && Storage.getSettings().autoCheck ? ' error' : ''}`,
            type: 'text',
            maxlength: '1',
            value: guess,
            'aria-label': `Cipher ${cipher}`,
            readonly: 'readonly',
            onClick: () => {
              this.selectedCipher = cipher;
              this.renderQuote();
              this.renderKeyboard();
            },
          });
          if (this.selectedCipher === cipher) {
            input.style.borderBottomColor = 'var(--brand-500)';
            input.style.background = 'var(--cell-selected)';
          }
          letterEl.appendChild(input);
          wordEl.appendChild(letterEl);
        } else {
          wordEl.appendChild(Utils.el('div', { className: 'crypto-letter punct' }, [
            Utils.el('div', { className: 'crypto-letter__cipher', textContent: '' }),
            Utils.el('div', { className: 'crypto-letter__input', textContent: ch, style: 'border:none;cursor:default' }),
          ]));
        }
      }
      this.quoteEl.appendChild(wordEl);
    }
  }

  renderKeyboard() {
    if (!this.keyboardEl) return;
    this.keyboardEl.innerHTML = '';
    const used = new Set(Object.values(this.mapping));
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      const isUsed = used.has(letter);
      const isMapped = this.selectedCipher && this.mapping[this.selectedCipher] === letter;
      const key = Utils.el('button', {
        className: `crypto-key${isUsed ? ' used' : ''}${isMapped ? ' mapped' : ''}`,
        textContent: letter,
        'aria-label': `Letter ${letter}`,
        onClick: () => {
          if (!this.selectedCipher) {
            Toast.show({ type: 'info', message: 'Select a cipher letter first' });
            return;
          }
          if (this.mapping[this.selectedCipher] === letter) {
            this.setMapping(this.selectedCipher, null);
          } else {
            this.setMapping(this.selectedCipher, letter);
          }
        },
      });
      this.keyboardEl.appendChild(key);
    }
  }
}

if (typeof window !== 'undefined') { window.CryptogramGame = CryptogramGame; }



/* ===== js/games/crossword.js ===== */
/**
 * PuzzleHub — Crossword Puzzle
 */
class CrosswordGame extends GameBase {
  constructor(opts) {
    super('crossword', opts);
    // Mini crossword puzzles (handcrafted for quality)
    this.PUZZLES = {
      easy: [
        {
          size: 5,
          // grid: 0=block, letter=answer
          answer: [
            'HAPPY',
            'APPLE',
            'PEAR#',
            'YELLS',
            'YES##',
          ],
          clues: {
            across: {
              1: 'Feeling joy',
              6: 'Fruit that keeps the doctor away',
              7: 'Fruit of the tree',
              8: 'Shouts',
              9: 'Affirmative',
            },
            down: {
              1: 'Cheerful',
              2: 'Fruit pie fruit',
              3: 'Church seats',
              4: 'Soft metal',
              5: 'Yes, slangily',
            },
          },
        },
        {
          size: 5,
          answer: [
            'WATER',
            'ABODE',
            'TRAIN',
            'EARTH',
            'REEDS',
          ],
          clues: {
            across: {
              1: 'H2O',
              6: 'Dwelling place',
              7: 'Locomotive vehicle',
              8: 'Third planet',
              9: 'Marsh plants',
            },
            down: {
              1: 'H2O',
              2: 'Above',
              3: 'Drag behind',
              4: 'Garden tools',
              5: 'Tints',
            },
          },
        },
      ],
      medium: [
        {
          size: 7,
          answer: [
            'PUZZLE#',
            'A#O#O#G',
            'RIDDLE#',
            'A#I#I#N',
            'DO#LOGIC',
            'O#E#E#U',
            'X#S#S##',
          ],
          clues: {
            across: {
              1: 'A brain teaser',
              5: 'Enigma or conundrum',
              8: 'Perform',
              9: 'Reasoning system',
            },
            down: {
              1: 'Walk back and forth',
              2: 'Zodiac sign',
              3: 'Does',
              4: 'Legend',
              6: 'Idea',
              7: 'Hint or clue',
            },
          },
        },
      ],
      hard: [
        {
          size: 9,
          answer: [
            'ALGORITHM',
            'L#O#N#A#A',
            'G#G#T#T#C',
            'O#I#E#H#H',
            'RHYTHMIC#',
            'I#H#L#M#I',
            'T#M#L#A#N',
            'H#I#I#T#E',
            'M#C#G#I##',
          ],
          clues: {
            across: {
              1: 'Step-by-step procedure',
              10: 'Having a strong regular repeated pattern',
            },
            down: {
              1: 'Computer program',
              2: 'Reasoning',
              3: 'Number puzzle',
              4: 'School subject',
              5: 'Puzzle type with ships',
              6: 'Computer device',
              7: 'Engine',
              8: 'Achieve',
              9: 'Fine',
            },
          },
        },
      ],
    };
    this.size = 5;
    this.answer = [];
    this.grid = [];
    this.numbers = [];
    this.clues = { across: {}, down: {} };
    this.selected = null;
    this.direction = 'across';
    this.cellNumbers = {};
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    const rng = seed != null ? Utils.seededRandom(seed) : Math.random;
    const pool = this.PUZZLES[this.difficulty] || this.PUZZLES.easy;
    const puzzle = pool[Math.floor(rng() * pool.length)];
    this.loadPuzzle(puzzle);
  }

  loadPuzzle(puzzle) {
    this.size = puzzle.size;
    this.answer = puzzle.answer.map(row => row.padEnd(this.size, '#').slice(0, this.size).split(''));
    this.clues = puzzle.clues;
    this.grid = this.answer.map(row => row.map(ch => ch === '#' ? '#' : ''));
    this.numberCells();
  }

  numberCells() {
    this.cellNumbers = {};
    let num = 1;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.answer[r][c] === '#') continue;
        const startAcross = (c === 0 || this.answer[r][c - 1] === '#') &&
          c + 1 < this.size && this.answer[r][c + 1] !== '#';
        const startDown = (r === 0 || this.answer[r - 1][c] === '#') &&
          r + 1 < this.size && this.answer[r + 1][c] !== '#';
        // Also number single-letter if it's a clue start conceptually
        const isStart = startAcross || startDown ||
          ((c === 0 || this.answer[r][c - 1] === '#') && this.answer[r][c] !== '#') ||
          ((r === 0 || this.answer[r - 1][c] === '#') && this.answer[r][c] !== '#');
        if (startAcross || startDown) {
          this.cellNumbers[`${r},${c}`] = num++;
        }
      }
    }
  }

  snapshot() {
    return {
      size: this.size,
      answer: this.answer.map(r => r.slice()),
      grid: this.grid.map(r => r.slice()),
      clues: this.clues,
      cellNumbers: this.cellNumbers,
      direction: this.direction,
    };
  }

  restore(state) {
    this.size = state.size;
    this.answer = state.answer.map(r => r.slice());
    this.grid = state.grid.map(r => r.slice());
    this.clues = state.clues;
    this.cellNumbers = state.cellNumbers;
    this.direction = state.direction || 'across';
    if (this.container) this.renderBoard();
  }

  select(r, c, toggleDir = false) {
    if (this.answer[r][c] === '#') return;
    if (this.selected && this.selected.r === r && this.selected.c === c && toggleDir) {
      this.direction = this.direction === 'across' ? 'down' : 'across';
    }
    this.selected = { r, c };
    this.renderBoard();
    this.highlightClue();
  }

  place(letter) {
    if (!this.selected || this.won) return;
    const { r, c } = this.selected;
    if (this.answer[r][c] === '#') return;
    this.pushUndo(this.snapshot());
    this.grid[r][c] = letter.toUpperCase();
    AudioEngine.play('place');
    // Advance
    this.advance();
    this.renderBoard();
    this.afterMove();
  }

  erase() {
    if (!this.selected || this.won) return;
    const { r, c } = this.selected;
    if (this.answer[r][c] === '#') return;
    this.pushUndo(this.snapshot());
    if (this.grid[r][c]) {
      this.grid[r][c] = '';
    } else {
      this.retreat();
      const { r: nr, c: nc } = this.selected;
      this.grid[nr][nc] = '';
    }
    AudioEngine.play('click');
    this.renderBoard();
    this.afterMove();
  }

  advance() {
    if (!this.selected) return;
    let { r, c } = this.selected;
    if (this.direction === 'across') {
      c++;
      while (c < this.size && this.answer[r][c] === '#') c++;
      if (c < this.size) this.selected = { r, c };
    } else {
      r++;
      while (r < this.size && this.answer[r][c] === '#') r++;
      if (r < this.size) this.selected = { r, c };
    }
  }

  retreat() {
    if (!this.selected) return;
    let { r, c } = this.selected;
    if (this.direction === 'across') {
      c--;
      while (c >= 0 && this.answer[r][c] === '#') c--;
      if (c >= 0) this.selected = { r, c };
    } else {
      r--;
      while (r >= 0 && this.answer[r][c] === '#') r--;
      if (r >= 0) this.selected = { r, c };
    }
  }

  getWordCells(r, c, dir) {
    const cells = [];
    if (dir === 'across') {
      let sc = c;
      while (sc > 0 && this.answer[r][sc - 1] !== '#') sc--;
      while (sc < this.size && this.answer[r][sc] !== '#') {
        cells.push({ r, c: sc });
        sc++;
      }
    } else {
      let sr = r;
      while (sr > 0 && this.answer[sr - 1][c] !== '#') sr--;
      while (sr < this.size && this.answer[sr][c] !== '#') {
        cells.push({ r: sr, c });
        sr++;
      }
    }
    return cells;
  }

  checkWin() {
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.answer[r][c] !== '#' && this.grid[r][c] !== this.answer[r][c]) return false;
    return true;
  }

  hint() {
    super.hint();
    // Fill one empty cell
    const empties = [];
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.answer[r][c] !== '#' && this.grid[r][c] !== this.answer[r][c])
          empties.push([r, c]);
    if (empties.length === 0) return;
    const [r, c] = Utils.pick(empties);
    this.pushUndo(this.snapshot());
    this.grid[r][c] = this.answer[r][c];
    this.selected = { r, c };
    this.renderBoard();
    this.afterMove();
  }

  onKeyDown(e) {
    super.onKeyDown(e);
    if (this.won || this.paused) return;
    if (e.key >= 'a' && e.key <= 'z' || e.key >= 'A' && e.key <= 'Z') {
      this.place(e.key);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      this.erase();
    } else if (e.key === ' ' || e.key === 'Tab') {
      e.preventDefault();
      this.direction = this.direction === 'across' ? 'down' : 'across';
      this.renderBoard();
      this.highlightClue();
    } else if (this.selected) {
      let { r, c } = this.selected;
      const moves = { ArrowUp: [-1,0], ArrowDown: [1,0], ArrowLeft: [0,-1], ArrowRight: [0,1] };
      if (e.key in moves) {
        e.preventDefault();
        const [dr, dc] = moves[e.key];
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
          if (this.answer[nr][nc] !== '#') { this.select(nr, nc); return; }
          nr += dr; nc += dc;
        }
      }
    }
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Crossword'));
    const stage = Utils.el('div', { className: 'game-stage' });

    this.boardEl = Utils.el('div', {
      className: 'crossword-board',
      role: 'grid',
      'aria-label': 'Crossword grid',
      style: `grid-template-columns: repeat(${this.size}, 1fr)`,
    });
    stage.appendChild(this.boardEl);

    this.cluesEl = Utils.el('div', { className: 'crossword-clues' });
    stage.appendChild(this.cluesEl);

    this.container.appendChild(stage);
    this.renderBoard();
    this.renderClues();

    // Select first cell
    for (let r = 0; r < this.size && !this.selected; r++)
      for (let c = 0; c < this.size && !this.selected; c++)
        if (this.answer[r][c] !== '#') this.select(r, c);
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.innerHTML = '';
    const wordCells = this.selected
      ? new Set(this.getWordCells(this.selected.r, this.selected.c, this.direction).map(({ r, c }) => `${r},${c}`))
      : new Set();
    const settings = Storage.getSettings();

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.answer[r][c] === '#') {
          this.boardEl.appendChild(Utils.el('div', { className: 'crossword-cell block' }));
          continue;
        }
        const key = `${r},${c}`;
        const val = this.grid[r][c];
        const cell = Utils.el('div', {
          className: 'crossword-cell',
          role: 'gridcell',
          tabindex: '0',
          'aria-label': `Row ${r + 1} Col ${c + 1}${val ? ', ' + val : ''}`,
        });
        if (this.selected && this.selected.r === r && this.selected.c === c) cell.classList.add('selected');
        else if (wordCells.has(key)) cell.classList.add('highlight');
        if (val && settings.autoCheck && val !== this.answer[r][c]) cell.classList.add('error');
        if (val && val === this.answer[r][c]) cell.classList.add('correct');

        if (this.cellNumbers[key]) {
          cell.appendChild(Utils.el('span', { className: 'crossword-cell__num', textContent: String(this.cellNumbers[key]) }));
        }
        if (val) {
          const span = document.createElement('span');
          span.textContent = val;
          cell.appendChild(span);
        }
        cell.addEventListener('click', () => this.select(r, c, true));
        this.boardEl.appendChild(cell);
      }
    }
  }

  renderClues() {
    if (!this.cluesEl) return;
    this.cluesEl.innerHTML = '';
    for (const dir of ['across', 'down']) {
      const col = Utils.el('div', { className: 'crossword-clues__col' }, [
        Utils.el('h4', { textContent: dir }),
      ]);
      const list = this.clues[dir] || {};
      for (const [num, text] of Object.entries(list)) {
        const clue = Utils.el('div', {
          className: 'crossword-clue',
          dataset: { dir, num },
          onClick: () => this.jumpToClue(+num, dir),
        }, [
          Utils.el('span', { className: 'crossword-clue__num', textContent: num }),
          Utils.el('span', { textContent: text }),
        ]);
        col.appendChild(clue);
      }
      this.cluesEl.appendChild(col);
    }
  }

  jumpToClue(num, dir) {
    for (const [key, n] of Object.entries(this.cellNumbers)) {
      if (n === num) {
        const [r, c] = key.split(',').map(Number);
        this.direction = dir;
        this.select(r, c);
        return;
      }
    }
  }

  highlightClue() {
    if (!this.cluesEl || !this.selected) return;
    this.cluesEl.querySelectorAll('.crossword-clue').forEach(el => el.classList.remove('active'));
    // Find number for current word start
    const cells = this.getWordCells(this.selected.r, this.selected.c, this.direction);
    if (cells.length) {
      const key = `${cells[0].r},${cells[0].c}`;
      const num = this.cellNumbers[key];
      if (num) {
        const el = this.cluesEl.querySelector(`[data-dir="${this.direction}"][data-num="${num}"]`);
        if (el) el.classList.add('active');
      }
    }
  }
}

if (typeof window !== 'undefined') { window.CrosswordGame = CrosswordGame; }



/* ===== js/games/kakuro.js ===== */
/**
 * PuzzleHub — Kakuro (Cross-Sums)
 */
class KakuroGame extends GameBase {
  constructor(opts) {
    super('kakuro', opts);
    // Pre-designed puzzles: cell types
    // 'B' = black block, 'W' = white (fillable),
    // clue cells: { down: n, across: n } or partial
    this.PUZZLES = {
      easy: {
        size: 5,
        // rows of cells: null=black, number=clue object, 0=empty white
        cells: [
          [null, {d:16}, {d:17}, null, null],
          [{a:16}, 0, 0, {d:20}, null],
          [{a:17}, 0, 0, 0, {d:4}],
          [null, {a:20}, 0, 0, 0],
          [null, null, {a:4}, 0, 0],
        ],
        solution: [
          [null, null, null, null, null],
          [null, 9, 7, null, null],
          [null, 8, 6, 3, null],
          [null, null, 9, 8, 3],
          [null, null, null, 1, 3],
        ],
      },
      medium: {
        size: 7,
        cells: [
          [null, {d:23}, {d:30}, null, {d:27}, {d:12}, {d:16}],
          [{a:16}, 0, 0, {d:17,a:24}, 0, 0, 0],
          [{a:17}, 0, 0, 0, 0, {d:15}, null],
          [{a:35}, 0, 0, 0, 0, 0, {d:12}],
          [null, {d:7}, {a:7}, 0, 0, 0, 0],
          [{a:11}, 0, 0, {a:10}, 0, 0, 0],
          [{a:22}, 0, 0, 0, null, null, null],
        ],
        solution: [
          [null,null,null,null,null,null,null],
          [null,9,7,null,8,9,7],
          [null,8,9,6,3,null,null],
          [null,6,8,9,7,5,null],
          [null,null,null,2,5,1,3],
          [null,3,8,null,1,6,3],
          [null,4,9,9,null,null,null],
        ],
      },
      hard: {
        size: 8,
        cells: [
          [null,{d:16},{d:17},{d:21},null,{d:28},{d:17},{d:16}],
          [{a:16},0,0,0,{d:17,a:24},0,0,0],
          [{a:17},0,0,0,0,{d:30},null,null],
          [{a:21},0,0,0,0,0,{d:16},null],
          [null,{d:17},{a:28},0,0,0,0,{d:12}],
          [null,null,{d:16,a:17},0,0,0,0,0],
          [{a:16},0,0,{a:17},0,0,0,0],
          [{a:17},0,0,0,null,null,null,null],
        ],
        solution: [
          [null,null,null,null,null,null,null,null],
          [null,9,2,5,null,9,8,7],
          [null,7,6,3,1,null,null,null],
          [null,8,9,4,7,2,null,null],
          [null,null,null,9,8,6,5,null],
          [null,null,null,7,6,9,3,1],
          [null,9,7,null,3,8,4,2],
          [null,9,7,1,null,null,null,null],
        ],
      },
    };
    this.size = 5;
    this.cells = [];
    this.solution = [];
    this.grid = [];
    this.selected = null;
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    // Use difficulty puzzle (could randomize among variants)
    let p = this.PUZZLES[this.difficulty] || this.PUZZLES.easy;
    // For daily, pick based on seed among difficulties
    if (this.isDaily) {
      const diffs = ['easy', 'medium', 'hard'];
      const rng = Utils.seededRandom(seed);
      p = this.PUZZLES[diffs[Math.floor(rng() * diffs.length)]];
    }
    this.size = p.size;
    this.cells = p.cells;
    this.solution = p.solution;
    this.grid = this.cells.map(row =>
      row.map(cell => (cell === 0 ? 0 : null))
    );
  }

  isWhite(r, c) {
    return this.cells[r] && this.cells[r][c] === 0;
  }

  snapshot() {
    return {
      size: this.size,
      cells: this.cells,
      solution: this.solution,
      grid: this.grid.map(r => r.slice()),
    };
  }

  restore(state) {
    this.size = state.size;
    this.cells = state.cells;
    this.solution = state.solution;
    this.grid = state.grid.map(r => r.slice());
    if (this.container) this.renderBoard();
  }

  select(r, c) {
    if (!this.isWhite(r, c)) return;
    this.selected = { r, c };
    this.renderBoard();
  }

  place(n) {
    if (!this.selected || this.won) return;
    const { r, c } = this.selected;
    this.pushUndo(this.snapshot());
    this.grid[r][c] = this.grid[r][c] === n ? 0 : n;
    const correct = !this.grid[r][c] || this.grid[r][c] === this.solution[r][c];
    AudioEngine.play(correct ? 'place' : 'error');
    this.renderBoard();
    this.afterMove();
  }

  erase() {
    if (!this.selected || this.won) return;
    const { r, c } = this.selected;
    this.pushUndo(this.snapshot());
    this.grid[r][c] = 0;
    AudioEngine.play('click');
    this.renderBoard();
    this.afterMove();
  }

  checkWin() {
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.isWhite(r, c) && this.grid[r][c] !== this.solution[r][c]) return false;
    return true;
  }

  hint() {
    super.hint();
    const empties = [];
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.isWhite(r, c) && this.grid[r][c] !== this.solution[r][c])
          empties.push([r, c]);
    if (!empties.length) return;
    const [r, c] = Utils.pick(empties);
    this.pushUndo(this.snapshot());
    this.grid[r][c] = this.solution[r][c];
    this.selected = { r, c };
    this.renderBoard();
    this.afterMove();
  }

  onKeyDown(e) {
    super.onKeyDown(e);
    if (this.won || this.paused) return;
    if (e.key >= '1' && e.key <= '9') this.place(+e.key);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') this.erase();
    else if (this.selected) {
      let { r, c } = this.selected;
      const moves = { ArrowUp: [-1,0], ArrowDown: [1,0], ArrowLeft: [0,-1], ArrowRight: [0,1] };
      if (e.key in moves) {
        e.preventDefault();
        const [dr, dc] = moves[e.key];
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
          if (this.isWhite(nr, nc)) { this.select(nr, nc); return; }
          nr += dr; nc += dc;
        }
      }
    }
  }

  // Highlight related run
  getRun(r, c) {
    const cells = new Set([`${r},${c}`]);
    // Horizontal
    let cc = c - 1;
    while (cc >= 0 && this.isWhite(r, cc)) { cells.add(`${r},${cc}`); cc--; }
    cc = c + 1;
    while (cc < this.size && this.isWhite(r, cc)) { cells.add(`${r},${cc}`); cc++; }
    // Vertical
    let rr = r - 1;
    while (rr >= 0 && this.isWhite(rr, c)) { cells.add(`${rr},${c}`); rr--; }
    rr = r + 1;
    while (rr < this.size && this.isWhite(rr, c)) { cells.add(`${rr},${c}`); rr++; }
    return cells;
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Kakuro'));
    const stage = Utils.el('div', { className: 'game-stage' });

    this.boardEl = Utils.el('div', {
      className: 'kakuro-board',
      role: 'grid',
      'aria-label': 'Kakuro grid',
      style: `grid-template-columns: repeat(${this.size}, 1fr); max-width: ${this.size * 48}px`,
    });
    const wrap = Utils.el('div', { className: 'board-wrap', style: 'aspect-ratio:auto;width:100%;max-width:480px' });
    wrap.appendChild(this.boardEl);
    stage.appendChild(wrap);

    // Number pad
    const pad = Utils.el('div', { className: 'num-pad' });
    for (let n = 1; n <= 9; n++) {
      pad.appendChild(Utils.el('button', {
        className: 'btn btn-secondary',
        textContent: String(n),
        onClick: () => this.place(n),
      }));
    }
    pad.appendChild(Utils.el('button', {
      className: 'btn btn-secondary',
      innerHTML: Utils.icon('erase', 16),
      onClick: () => this.erase(),
    }));
    stage.appendChild(pad);

    this.container.appendChild(stage);
    this.renderBoard();
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.innerHTML = '';
    const run = this.selected ? this.getRun(this.selected.r, this.selected.c) : new Set();
    const settings = Storage.getSettings();

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const cellData = this.cells[r][c];
        if (cellData === null) {
          this.boardEl.appendChild(Utils.el('div', { className: 'kakuro-cell block' }));
        } else if (cellData === 0) {
          // White cell
          const val = this.grid[r][c];
          const cell = Utils.el('div', {
            className: 'kakuro-cell',
            role: 'gridcell',
            tabindex: '0',
            textContent: val || '',
            'aria-label': `Row ${r+1} Col ${c+1}${val ? ', ' + val : ', empty'}`,
          });
          if (this.selected && this.selected.r === r && this.selected.c === c) cell.classList.add('selected');
          else if (run.has(`${r},${c}`)) cell.classList.add('highlight');
          if (val && settings.autoCheck && val !== this.solution[r][c]) cell.classList.add('error');
          cell.addEventListener('click', () => this.select(r, c));
          this.boardEl.appendChild(cell);
        } else {
          // Clue cell
          const cell = Utils.el('div', { className: 'kakuro-cell clue' });
          const diag = Utils.el('div', { className: 'kakuro-clue-diag' });
          cell.appendChild(diag);
          if (cellData.d) {
            cell.appendChild(Utils.el('span', { className: 'kakuro-clue-down', textContent: String(cellData.d) }));
          }
          if (cellData.a) {
            cell.appendChild(Utils.el('span', { className: 'kakuro-clue-across', textContent: String(cellData.a) }));
          }
          this.boardEl.appendChild(cell);
        }
      }
    }
  }
}

if (typeof window !== 'undefined') { window.KakuroGame = KakuroGame; }



/* ===== js/games/nonogram.js ===== */
/**
 * PuzzleHub — Nonogram (Picross)
 */
class NonogramGame extends GameBase {
  constructor(opts) {
    super('nonogram', opts);
    this.PATTERNS = {
      easy: [
        // 5x5 heart-ish
        [
          [0,1,0,1,0],
          [1,1,1,1,1],
          [1,1,1,1,1],
          [0,1,1,1,0],
          [0,0,1,0,0],
        ],
        // 5x5 smiley
        [
          [0,1,1,1,0],
          [1,0,1,0,1],
          [1,1,1,1,1],
          [1,0,0,0,1],
          [0,1,1,1,0],
        ],
        // 5x5 plus
        [
          [0,0,1,0,0],
          [0,0,1,0,0],
          [1,1,1,1,1],
          [0,0,1,0,0],
          [0,0,1,0,0],
        ],
      ],
      medium: [
        // 8x8 tree
        [
          [0,0,0,1,1,0,0,0],
          [0,0,1,1,1,1,0,0],
          [0,1,1,1,1,1,1,0],
          [1,1,1,1,1,1,1,1],
          [0,0,0,1,1,0,0,0],
          [0,0,0,1,1,0,0,0],
          [0,0,1,1,1,1,0,0],
          [0,1,1,1,1,1,1,0],
        ],
        // 8x8 house
        [
          [0,0,0,1,1,0,0,0],
          [0,0,1,1,1,1,0,0],
          [0,1,1,1,1,1,1,0],
          [1,1,1,1,1,1,1,1],
          [1,0,1,1,1,1,0,1],
          [1,0,1,1,1,1,0,1],
          [1,1,1,0,0,1,1,1],
          [1,1,1,0,0,1,1,1],
        ],
      ],
      hard: [
        // 10x10 cat
        [
          [0,1,0,0,0,0,0,0,1,0],
          [1,1,1,0,0,0,0,1,1,1],
          [1,0,1,1,1,1,1,1,0,1],
          [1,1,1,1,1,1,1,1,1,1],
          [1,1,0,1,1,1,1,0,1,1],
          [1,1,1,1,1,1,1,1,1,1],
          [0,1,1,0,0,0,0,1,1,0],
          [0,0,1,1,1,1,1,1,0,0],
          [0,0,1,0,1,1,0,1,0,0],
          [0,0,1,0,0,0,0,1,0,0],
        ],
      ],
    };
    this.size = 5;
    this.solution = [];
    this.grid = []; // 0=empty, 1=filled, 2=marked
    this.rowHints = [];
    this.colHints = [];
    this.paintMode = 1; // 1=fill, 2=mark
    this.drawing = false;
    this.drawValue = 1;
  }

  async init() {
    if (!this.isDaily && this.loadSaved()) return;
    const seed = this.seed ?? (this.isDaily ? Utils.dailySeed() : null);
    const rng = seed != null ? Utils.seededRandom(seed) : Math.random;
    const pool = this.PATTERNS[this.difficulty] || this.PATTERNS.easy;
    this.solution = pool[Math.floor(rng() * pool.length)].map(r => r.slice());
    this.size = this.solution.length;
    this.grid = Array.from({ length: this.size }, () => Array(this.size).fill(0));
    this.computeHints();
  }

  computeHints() {
    this.rowHints = this.solution.map(row => this.runs(row));
    this.colHints = [];
    for (let c = 0; c < this.size; c++) {
      const col = this.solution.map(row => row[c]);
      this.colHints.push(this.runs(col));
    }
  }

  runs(arr) {
    const result = [];
    let count = 0;
    for (const v of arr) {
      if (v) count++;
      else if (count) { result.push(count); count = 0; }
    }
    if (count) result.push(count);
    return result.length ? result : [0];
  }

  snapshot() {
    return {
      size: this.size,
      solution: this.solution.map(r => r.slice()),
      grid: this.grid.map(r => r.slice()),
      rowHints: this.rowHints,
      colHints: this.colHints,
    };
  }

  restore(state) {
    this.size = state.size;
    this.solution = state.solution.map(r => r.slice());
    this.grid = state.grid.map(r => r.slice());
    this.rowHints = state.rowHints;
    this.colHints = state.colHints;
    if (this.container) this.renderGrid();
  }

  setCell(r, c, value) {
    if (this.won) return;
    if (this.grid[r][c] === value) return;
    this.grid[r][c] = value;
  }

  paint(r, c) {
    if (this.won) return;
    this.pushUndo(this.snapshot());
    if (this.grid[r][c] === this.drawValue) {
      this.grid[r][c] = 0;
    } else {
      this.grid[r][c] = this.drawValue;
    }
    AudioEngine.play('click');
    this.renderGrid();
    this.afterMove();
  }

  checkWin() {
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++) {
        const filled = this.grid[r][c] === 1;
        if (filled !== !!this.solution[r][c]) return false;
      }
    return true;
  }

  hint() {
    super.hint();
    const wrong = [];
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++) {
        const shouldFill = !!this.solution[r][c];
        const isFilled = this.grid[r][c] === 1;
        if (shouldFill !== isFilled) wrong.push([r, c]);
      }
    if (!wrong.length) return;
    const [r, c] = Utils.pick(wrong);
    this.pushUndo(this.snapshot());
    this.grid[r][c] = this.solution[r][c] ? 1 : 2;
    this.renderGrid();
    this.afterMove();
  }

  onKeyDown(e) {
    super.onKeyDown(e);
    if (e.key === 'x' || e.key === 'X') {
      this.paintMode = 2;
      this.updateModeBtns();
    } else if (e.key === 'z' || e.key === 'f' || e.key === 'F') {
      this.paintMode = 1;
      this.updateModeBtns();
    }
  }

  render() {
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar('Nonogram'));
    const stage = Utils.el('div', { className: 'game-stage' });

    // Mode buttons
    const modes = Utils.el('div', { className: 'pill-group' });
    this.fillBtn = Utils.el('button', {
      className: 'pill active',
      textContent: '⬛ Fill',
      onClick: () => { this.paintMode = 1; this.updateModeBtns(); },
    });
    this.markBtn = Utils.el('button', {
      className: 'pill',
      textContent: '✕ Mark',
      onClick: () => { this.paintMode = 2; this.updateModeBtns(); },
    });
    modes.append(this.fillBtn, this.markBtn);
    stage.appendChild(modes);

    const layout = Utils.el('div', { className: 'nonogram-layout' });
    this.gridWrap = Utils.el('div', {
      className: 'nonogram-grid-wrap',
      style: `display:grid; grid-template-columns: auto repeat(${this.size}, auto); gap: 0;`,
    });
    layout.appendChild(this.gridWrap);
    stage.appendChild(layout);

    stage.appendChild(Utils.el('p', {
      style: 'font-size:12px;color:var(--text-tertiary);text-align:center',
      textContent: 'Left-click fill · Right-click mark · Drag to paint',
    }));

    this.container.appendChild(stage);
    this.renderGrid();
    this.setupPointer();
  }

  updateModeBtns() {
    if (this.fillBtn) this.fillBtn.classList.toggle('active', this.paintMode === 1);
    if (this.markBtn) this.markBtn.classList.toggle('active', this.paintMode === 2);
  }

  renderGrid() {
    if (!this.gridWrap) return;
    this.gridWrap.innerHTML = '';

    // Corner
    this.gridWrap.appendChild(Utils.el('div', { className: 'nonogram-corner' }));

    // Col hints
    for (let c = 0; c < this.size; c++) {
      const hints = Utils.el('div', { className: 'nonogram-col-hints' });
      for (const h of this.colHints[c]) {
        hints.appendChild(Utils.el('span', { textContent: String(h) }));
      }
      this.gridWrap.appendChild(hints);
    }

    // Rows
    this.boardEl = null;
    for (let r = 0; r < this.size; r++) {
      // Row hints
      const rh = Utils.el('div', { className: 'nonogram-row-hints' });
      for (const h of this.rowHints[r]) {
        rh.appendChild(Utils.el('span', { textContent: String(h) }));
      }
      this.gridWrap.appendChild(rh);

      // Cells for this row — we'll put board as one grid spanning
      // Actually simpler: each cell individually
      for (let c = 0; c < this.size; c++) {
        if (c === 0 && r === 0) {
          // Create board container that spans
        }
      }
    }

    // Rebuild with board as subgrid
    this.gridWrap.innerHTML = '';
    this.gridWrap.style.gridTemplateColumns = `auto auto`;
    this.gridWrap.style.gridTemplateRows = `auto auto`;

    this.gridWrap.appendChild(Utils.el('div')); // corner

    // Col hints row
    const colHintsRow = Utils.el('div', {
      style: `display:grid; grid-template-columns: repeat(${this.size}, auto); gap: 1px;`,
    });
    for (let c = 0; c < this.size; c++) {
      const h = Utils.el('div', { className: 'nonogram-col-hints' });
      this.colHints[c].forEach(n => h.appendChild(Utils.el('span', { textContent: String(n) })));
      colHintsRow.appendChild(h);
    }
    this.gridWrap.appendChild(colHintsRow);

    // Row hints col
    const rowHintsCol = Utils.el('div', {
      style: `display:grid; grid-template-rows: repeat(${this.size}, auto); gap: 1px;`,
    });
    for (let r = 0; r < this.size; r++) {
      const h = Utils.el('div', { className: 'nonogram-row-hints' });
      this.rowHints[r].forEach(n => h.appendChild(Utils.el('span', { textContent: String(n) })));
      rowHintsCol.appendChild(h);
    }
    this.gridWrap.appendChild(rowHintsCol);

    // Board
    this.boardEl = Utils.el('div', {
      className: 'nonogram-board',
      role: 'grid',
      'aria-label': 'Nonogram grid',
      style: `grid-template-columns: repeat(${this.size}, auto)`,
    });
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const val = this.grid[r][c];
        const cell = Utils.el('div', {
          className: `nonogram-cell${val === 1 ? ' filled' : ''}${val === 2 ? ' marked' : ''}`,
          role: 'gridcell',
          dataset: { r: String(r), c: String(c) },
          'aria-label': `Row ${r+1} Col ${c+1}`,
        });
        this.boardEl.appendChild(cell);
      }
    }
    this.gridWrap.appendChild(this.boardEl);
  }

  setupPointer() {
    const getCell = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      const target = document.elementFromPoint(pt.clientX, pt.clientY);
      if (!target || !target.dataset.r) return null;
      return { r: +target.dataset.r, c: +target.dataset.c };
    };

    let drawing = false;
    let drawVal = 1;
    let pushed = false;

    const start = (e, rightClick = false) => {
      const cell = getCell(e);
      if (!cell) return;
      drawing = true;
      pushed = false;
      drawVal = rightClick || this.paintMode === 2 ? 2 : 1;
      // Toggle logic
      if (this.grid[cell.r][cell.c] === drawVal) drawVal = 0;
      this.pushUndo(this.snapshot());
      pushed = true;
      this.grid[cell.r][cell.c] = drawVal;
      this.renderGrid();
      e.preventDefault();
    };
    const move = (e) => {
      if (!drawing) return;
      const cell = getCell(e);
      if (!cell) return;
      if (this.grid[cell.r][cell.c] !== drawVal) {
        this.grid[cell.r][cell.c] = drawVal;
        this.renderGrid();
      }
      e.preventDefault();
    };
    const end = () => {
      if (drawing && pushed) {
        AudioEngine.play('click');
        this.afterMove();
      }
      drawing = false;
    };

    // Use event delegation on gridWrap
    this.gridWrap.addEventListener('mousedown', (e) => start(e, e.button === 2));
    this.gridWrap.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    this.gridWrap.addEventListener('contextmenu', (e) => e.preventDefault());
    this.gridWrap.addEventListener('touchstart', (e) => start(e), { passive: false });
    this.gridWrap.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    this._ngCleanup = () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
    };
  }

  destroy() {
    if (this._ngCleanup) this._ngCleanup();
    super.destroy();
  }
}

if (typeof window !== 'undefined') { window.NonogramGame = NonogramGame; }



/* ===== js/pages/home.js ===== */
/**
 * PuzzleHub — Home Page
 */
const HomePage = (() => {
  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    SEO.apply('/');

    const page = Utils.el('div', { className: 'page-enter' });
    const container = Utils.el('div', { className: 'container' });

    // Hero
    const hero = Utils.el('section', { className: 'hero', 'aria-labelledby': 'hero-title' }, [
      Utils.el('div', { className: 'hero__badge' }, [
        Utils.el('span', { 'aria-hidden': 'true', textContent: '✨' }),
        Utils.el('span', { textContent: I18n.t('hero.badge') }),
      ]),
      Utils.el('h1', { className: 'hero__title', id: 'hero-title', textContent: I18n.t('hero.title') }),
      Utils.el('p', {
        className: 'hero__subtitle',
        textContent: I18n.t('hero.subtitle'),
      }),
      Utils.el('div', { className: 'hero__actions' }, [
        Utils.el('button', {
          className: 'btn btn-primary btn-lg',
          type: 'button',
          textContent: (typeof AB !== 'undefined' && AB.variant('home_cta')) || I18n.t('hero.daily'),
          onClick: () => { Analytics.track('cta_daily'); startDaily(); },
        }),
        Utils.el('button', {
          className: 'btn btn-secondary btn-lg',
          type: 'button',
          textContent: I18n.t('hero.browse'),
          onClick: () => document.getElementById('games-section')?.scrollIntoView({ behavior: 'smooth' }),
        }),
      ]),
    ]);
    container.appendChild(hero);

    // Daily banner
    const dailyDone = Storage.getDailyProgress()[Utils.dateKey()]?.completed;
    const dailyBanner = Utils.el('button', {
      className: 'daily-banner',
      type: 'button',
      onClick: () => { Analytics.track('daily_banner_click'); startDaily(); },
      'aria-label': dailyDone ? 'Replay daily challenge' : 'Start daily challenge',
    }, [
      Utils.el('div', { className: 'daily-banner__icon', 'aria-hidden': 'true', textContent: dailyDone ? '✅' : '📅' }),
      Utils.el('div', { className: 'daily-banner__content' }, [
        Utils.el('div', { className: 'daily-banner__label', textContent: I18n.t('daily.label') }),
        Utils.el('div', { className: 'daily-banner__title', textContent: dailyDone ? I18n.t('daily.done') : todaysDailyName() }),
        Utils.el('div', {
          className: 'daily-banner__desc',
          textContent: dailyDone
            ? `Solved in ${Utils.formatTime(Storage.getDailyProgress()[Utils.dateKey()].time)} · Come back tomorrow`
            : I18n.t('daily.desc'),
        }),
      ]),
      Utils.el('div', { className: 'daily-banner__cta', textContent: dailyDone ? I18n.t('daily.replay') : I18n.t('daily.cta') }),
    ]);
    container.appendChild(dailyBanner);

    // World-class hub widgets: rewards, AI recommend, season, account
    try {
      if (typeof Rewards !== 'undefined') Rewards.applyActive();
      const ref = new URLSearchParams((location.hash.split('?')[1] || ''));
      if (ref.get('ref') && typeof Social !== 'undefined') Social.applyReferral(ref.get('ref'));

      const rw = (typeof Rewards !== 'undefined') ? Rewards.state() : { coins: 0, level: 1, xp: 0 };
      const rec = (typeof AIEngine !== 'undefined') ? AIEngine.recommend(Stats.get()) : null;
      const season = (typeof Tournaments !== 'undefined') ? Tournaments.seasonalEvent() : null;

      const rewardsBar = Utils.el('div', { className: 'rewards-bar' }, [
        Utils.el('div', { className: 'rewards-chip', textContent: `⭐ Lv ${rw.level}` }),
        Utils.el('div', { className: 'rewards-chip', textContent: `🪙 ${rw.coins}` }),
        Utils.el('button', {
          className: 'rewards-chip',
          type: 'button',
          textContent: (typeof Rewards !== 'undefined' && Rewards.canClaimDaily()) ? '🎁 Claim daily reward' : '🎁 Claimed today',
          onClick: () => { if (typeof Rewards !== 'undefined') Rewards.claimDaily(); render(); },
        }),
        Utils.el('button', {
          className: 'rewards-chip',
          type: 'button',
          textContent: Cloud.isSignedIn() ? `👤 ${Cloud.getUser()?.name || 'Player'}` : '👤 Guest sign-in',
          onClick: () => openAuth(),
        }),
      ]);
      container.appendChild(rewardsBar);

      if (season) {
        container.appendChild(Utils.el('div', { className: 'season-banner' }, [
          Utils.el('div', { style: 'font-size:2rem', textContent: '🎊' }),
          Utils.el('div', { style: 'flex:1' }, [
            Utils.el('h2', { textContent: season.name }),
            Utils.el('p', { textContent: season.bonus }),
          ]),
          Utils.el('a', { className: 'btn btn-secondary btn-sm', href: '#/leaderboard', textContent: 'Rankings' }),
        ]));
      }

      const widgets = Utils.el('div', { className: 'hub-widgets' });
      if (rec) {
        const meta = GAME_MAP[rec.gameId];
        widgets.appendChild(Utils.el('div', { className: 'hub-widget' }, [
          Utils.el('div', { className: 'hub-widget__title', textContent: 'AI recommends' }),
          Utils.el('div', { className: 'hub-widget__value', textContent: (meta?.icon || '') + ' ' + (meta?.name || rec.gameId) }),
          Utils.el('div', { className: 'hub-widget__sub', textContent: rec.reason }),
          Utils.el('button', {
            className: 'btn btn-primary btn-sm',
            type: 'button',
            style: 'margin-top:12px',
            textContent: 'Play infinite puzzle',
            onClick: () => {
              Analytics.track('ai_recommend_click', { game: rec.gameId });
              Router.navigate(`/game/${rec.gameId}?d=${rec.difficulty || 'medium'}&infinite=1`);
            },
          }),
        ]));
      }
      widgets.appendChild(Utils.el('div', { className: 'hub-widget' }, [
        Utils.el('div', { className: 'hub-widget__title', textContent: 'Your referral' }),
        Utils.el('div', { className: 'hub-widget__value', style: 'font-size:1.25rem', textContent: typeof Social !== 'undefined' ? Social.referralCode() : '—' }),
        Utils.el('div', { className: 'hub-widget__sub', textContent: 'Invite friends · earn coins' }),
        Utils.el('button', {
          className: 'btn btn-secondary btn-sm',
          type: 'button',
          style: 'margin-top:12px',
          textContent: 'Share invite',
          onClick: () => Social.share({ text: 'Join me on PuzzleHub!', url: Social.referralLink() }),
        }),
      ]));
      widgets.appendChild(Utils.el('div', { className: 'hub-widget' }, [
        Utils.el('div', { className: 'hub-widget__title', textContent: 'Community' }),
        Utils.el('div', { className: 'hub-widget__value', style: 'font-size:1.25rem', textContent: 'Create puzzles' }),
        Utils.el('div', { className: 'hub-widget__sub', textContent: 'Editor · challenges · feed' }),
        Utils.el('a', { className: 'btn btn-secondary btn-sm', href: '#/community', style: 'margin-top:12px', textContent: 'Open community' }),
      ]));
      container.appendChild(widgets);
    } catch (e) { console.warn('hub widgets', e); }


    // Streak
    const stats = Stats.get();
    if (stats.currentStreak > 0) {
      container.appendChild(Utils.el('div', {
        className: 'streak-chip',
        role: 'status',
      }, [
        Utils.el('span', { 'aria-hidden': 'true', textContent: '🔥' }),
        Utils.el('span', { textContent: `${stats.currentStreak}-day streak` }),
        stats.bestStreak > stats.currentStreak
          ? Utils.el('span', { className: 'streak-chip__best', textContent: `· Best: ${stats.bestStreak}` })
          : null,
      ].filter(Boolean)));
    }

    // Featured row
    const featured = Utils.el('div', { className: 'featured-strip', 'aria-label': 'Featured' });
    featured.appendChild(Utils.el('button', {
      className: 'featured-card featured-card--daily',
      type: 'button',
      onClick: () => startDaily(),
    }, [
      Utils.el('div', { className: 'featured-card__kicker', textContent: 'Daily' }),
      Utils.el('div', { className: 'featured-card__title', textContent: todaysDailyName() }),
      Utils.el('div', { className: 'featured-card__desc', textContent: 'Same puzzle for everyone today. Build your streak.' }),
    ]));
    const rec = (typeof AIEngine !== 'undefined') ? AIEngine.recommend(Stats.get()) : { gameId: 'sudoku', difficulty: 'medium', reason: '' };
    const recMeta = GAME_MAP[rec.gameId] || { name: 'Sudoku', icon: '🔢' };
    featured.appendChild(Utils.el('button', {
      className: 'featured-card featured-card--ai',
      type: 'button',
      onClick: () => Router.navigate(`/game/${rec.gameId}?d=${rec.difficulty || 'medium'}&infinite=1`),
    }, [
      Utils.el('div', { className: 'featured-card__kicker', textContent: 'For you' }),
      Utils.el('div', { className: 'featured-card__title', textContent: `${recMeta.icon || ''} ${recMeta.name}` }),
      Utils.el('div', { className: 'featured-card__desc', textContent: rec.reason || 'AI-picked infinite puzzle' }),
    ]));
    featured.appendChild(Utils.el('button', {
      className: 'featured-card featured-card--rank',
      type: 'button',
      onClick: () => Router.navigate('/leaderboard'),
    }, [
      Utils.el('div', { className: 'featured-card__kicker', textContent: 'Compete' }),
      Utils.el('div', { className: 'featured-card__title', textContent: 'Global rankings' }),
      Utils.el('div', { className: 'featured-card__desc', textContent: 'Climb daily, weekly, and monthly boards.' }),
    ]));
    container.appendChild(featured);

    // Category filters + search
    const categories = [
      { id: 'all', label: I18n.t('filter.all') },
      { id: 'logic', label: I18n.t('filter.logic') },
      { id: 'word', label: I18n.t('filter.word') },
      { id: 'arcade', label: I18n.t('filter.arcade') },
    ];
    let activeCat = 'all';
    let query = '';

    const section = Utils.el('section', { className: 'section', id: 'games-section', 'aria-labelledby': 'games-heading' });
    const header = Utils.el('div', { className: 'section__header' }, [
      Utils.el('h2', { className: 'section__title', id: 'games-heading', textContent: I18n.t('games.heading') }),
    ]);
    section.appendChild(header);

    const toolbar = Utils.el('div', {
      style: 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:var(--space-5)',
    });

    const filters = Utils.el('div', {
      className: 'pill-group',
      role: 'tablist',
      'aria-label': 'Filter games by category',
    });

    const search = Utils.el('div', { className: 'search-field', style: 'flex:1;min-width:200px;max-width:320px' });
    search.appendChild(Utils.el('span', {
      className: 'search-field__icon',
      'aria-hidden': 'true',
      innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.75"/><path d="M16.2 16.2L20.5 20.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
    }));
    const searchInput = Utils.el('input', {
      type: 'search',
      placeholder: 'Search games…',
      'aria-label': 'Search games',
      onInput: (e) => {
        query = (e.target.value || '').trim().toLowerCase();
        renderGrid();
      },
    });
    search.appendChild(searchInput);

    const grid = Utils.el('div', { className: 'games-grid', role: 'list' });

    function renderGrid() {
      grid.innerHTML = '';
      const list = GAMES_META.filter((g) => {
        const catOk = activeCat === 'all' || g.category === activeCat;
        const qOk = !query || g.name.toLowerCase().includes(query) || g.desc.toLowerCase().includes(query) || g.category.includes(query);
        return catOk && qOk;
      });
      if (!list.length) {
        grid.appendChild(Utils.el('div', {
          className: 'empty-state',
          style: 'grid-column:1/-1;padding:48px 16px',
        }, [
          Utils.el('div', { className: 'empty-state__icon', textContent: '🔍' }),
          Utils.el('div', { className: 'empty-state__title', textContent: 'No games match' }),
          Utils.el('div', { className: 'empty-state__desc', textContent: 'Try another category or clear search.' }),
        ]));
      } else {
        list.forEach((game) => grid.appendChild(createGameCard(game)));
      }
      countEl.textContent = `${list.length} puzzle${list.length === 1 ? '' : 's'}`;
    }

    const countEl = Utils.el('span', { className: 'section__count', textContent: '' });
    header.appendChild(countEl);

    categories.forEach((cat) => {
      const pill = Utils.el('button', {
        className: `pill${cat.id === activeCat ? ' active' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(cat.id === activeCat),
        textContent: cat.label,
        onClick: () => {
          activeCat = cat.id;
          filters.querySelectorAll('.pill').forEach((p) => {
            p.classList.remove('active');
            p.setAttribute('aria-selected', 'false');
          });
          pill.classList.add('active');
          pill.setAttribute('aria-selected', 'true');
          renderGrid();
          Analytics.track('filter_category', { category: cat.id });
        },
      });
      filters.appendChild(pill);
    });
    toolbar.appendChild(filters);
    toolbar.appendChild(search);
    section.appendChild(toolbar);
    section.appendChild(grid);
    container.appendChild(section);
    renderGrid();

    // SEO content block (indexable value + internal links)
    container.appendChild(Utils.el('section', { className: 'section home-seo' }, [
      Utils.el('h2', { className: 'section__title', textContent: 'Free online puzzle games' }),
      Utils.el('p', {
        className: 'home-seo__text',
        textContent: 'PuzzleHub is a free collection of classic brain games you can play in your browser. No downloads, no account. Choose a difficulty, use hints when you need them, and track your streaks on your profile.',
      }),
      Utils.el('p', { className: 'home-seo__text' }, [
        document.createTextNode('New here? Read our '),
        Utils.el('a', { href: '#/how-to-play', textContent: 'how to play guides' }),
        document.createTextNode(' or learn '),
        Utils.el('a', { href: '#/about', textContent: 'about PuzzleHub' }),
        document.createTextNode('.'),
      ]),
    ]));

    // Google AdSense - Advertisement Section (before footer)
    const adContainer = Utils.el('div', {
      id: 'adsense-advertisement',
      style: 'margin: 30px auto; max-width: 728px; min-height: 90px; text-align: center;'
    });
    
    const adIns = Utils.el('ins', {
      className: 'adsbygoogle',
      style: 'display:block',
      'data-ad-client': 'ca-pub-5809071932668146',
      'data-ad-slot': '8306713464',
      'data-ad-format': 'auto',
      'data-full-width-responsive': 'true'
    });
    
    adContainer.appendChild(adIns);
    container.appendChild(adContainer);
    
    // Initialize Google AdSense (silently — no console noise)
    setTimeout(function () {
      try {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      } catch (_err) {
        adContainer.style.display = 'none';
      }
    }, 1500);

    page.appendChild(container);
    main.appendChild(page);
    renderFooter(main);
  }

  function createGameCard(game) {
    const gStats = Stats.getGameStats(game.id);
    const playIcon =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 7.2v9.6L17.5 12 9 7.2z"/></svg>';
    return Utils.el('button', {
      className: 'game-card',
      type: 'button',
      role: 'listitem',
      'aria-label': `Play ${game.name}. ${game.desc}`,
      onClick: () => {
        Analytics.track('game_card_click', { game: game.id });
        openGame(game);
      },
    }, [
      Utils.el('div', { className: `game-card__art ${game.art}`, 'aria-hidden': 'true' }, [
        Utils.el('div', { className: 'art-texture' }),
        Utils.el('span', { className: 'game-card__icon', textContent: game.icon }),
        Utils.el('span', { className: 'game-card__play', innerHTML: playIcon }),
      ]),
      Utils.el('div', { className: 'game-card__body' }, [
        Utils.el('div', { className: 'game-card__title', textContent: game.name }),
        Utils.el('div', { className: 'game-card__desc', textContent: game.desc }),
        Utils.el('div', { className: 'game-card__meta' }, [
          game.featured
            ? Utils.el('span', { className: 'game-card__badge game-card__badge--new', textContent: 'Popular' })
            : Utils.el('span', { className: 'game-card__badge', textContent: game.category }),
          gStats.won > 0
            ? Utils.el('span', { className: 'game-card__badge', textContent: `${gStats.won} won` })
            : Utils.el('span', { className: 'game-card__badge', textContent: 'Play' }),
        ].filter(Boolean)),
      ]),
    ]);
  }

  function openGame(game) {
    if (game.difficulties.length === 1) {
      Router.navigate(`/game/${game.id}?d=${game.difficulties[0]}`);
      return;
    }

    const body = Utils.el('div');
    body.appendChild(Utils.el('p', {
      style: 'color:var(--text-secondary);margin-bottom:16px;font-size:14px',
      textContent: game.desc,
    }));
    const pills = Utils.el('div', { className: 'pill-group', style: 'margin-bottom:8px', role: 'group', 'aria-label': 'Difficulty' });
    let selected = game.difficulties.includes('medium') ? 'medium' : game.difficulties[0];

    game.difficulties.forEach((d) => {
      const pill = Utils.el('button', {
        className: `pill${d === selected ? ' active' : ''}`,
        type: 'button',
        textContent: d.charAt(0).toUpperCase() + d.slice(1),
        onClick: () => {
          selected = d;
          pills.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
        },
      });
      pills.appendChild(pill);
    });
    body.appendChild(pills);

    const saved = Storage.getGameState(game.id);
    const footer = [];
    if (saved && !saved.isDaily) {
      footer.push(Utils.el('button', {
        className: 'btn btn-secondary',
        type: 'button',
        textContent: 'Resume',
        onClick: () => {
          Modal.close();
          Router.navigate(`/game/${game.id}?d=${Security.safeDifficulty(saved.difficulty || selected, game.difficulties)}&resume=1`);
        },
      }));
    }
    footer.push(Utils.el('button', {
      className: 'btn btn-primary',
      type: 'button',
      textContent: 'New Game',
      onClick: () => {
        Modal.close();
        Storage.clearGameState(game.id);
        Router.navigate(`/game/${game.id}?d=${Security.safeDifficulty(selected, game.difficulties)}`);
      },
    }));

    Modal.open({
      title: `${game.icon} ${game.name}`,
      body,
      footer,
    });
  }

  function todaysDailyName() {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const dailyGames = ['sudoku', 'minesweeper', 'memory', 'wordsearch', 'cryptogram', 'nonogram', '2048'];
    const id = dailyGames[dayOfYear % dailyGames.length];
    return GAME_MAP[id]?.name || 'Sudoku';
  }

  function startDaily() {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const dailyGames = ['sudoku', 'minesweeper', 'memory', 'wordsearch', 'cryptogram', 'nonogram', '2048'];
    const id = dailyGames[dayOfYear % dailyGames.length];
    Router.navigate(`/game/${id}?d=medium&daily=1`);
  }

  function renderFooter(parent) {
    if (parent.querySelector('.app-footer')) return;
    const markSvg =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">' +
      '<path d="M8.5 4.5h4.2a3.3 3.3 0 010 6.6H8.5V4.5z" fill="white" fill-opacity="0.95"/>' +
      '<path d="M8.5 12.9h5.1a3.3 3.3 0 010 6.6H8.5v-6.6z" fill="white" fill-opacity="0.8"/>' +
      '<circle cx="17.2" cy="7.8" r="1.55" fill="white" fill-opacity="0.95"/>' +
      '<circle cx="18.1" cy="16.2" r="1.55" fill="white" fill-opacity="0.8"/>' +
      '</svg>';

    const brandCol = Utils.el('div', { className: 'app-footer__brand' }, [
      Utils.el('div', { className: 'app-footer__mark', innerHTML: markSvg }),
      Utils.el('div', { className: 'app-footer__brand-name', textContent: 'PuzzleHub' }),
      Utils.el('p', {
        className: 'app-footer__brand-desc',
        textContent: 'A premium free puzzle product. Crafted for focus, calm, and daily mastery.',
      }),
    ]);

    function col(title, links) {
      const c = Utils.el('div', { className: 'app-footer__col' }, [
        Utils.el('div', { className: 'app-footer__col-title', textContent: title }),
      ]);
      const list = Utils.el('div', { className: 'app-footer__col-links' });
      links.forEach((l) => {
        if (l.onClick) {
          list.appendChild(Utils.el('a', {
            href: l.href || '#',
            textContent: l.label,
            onClick: (e) => { e.preventDefault(); l.onClick(); },
          }));
        } else {
          list.appendChild(Utils.el('a', { href: l.href, textContent: l.label }));
        }
      });
      c.appendChild(list);
      return c;
    }

    const newsCol = Utils.el('div', { className: 'app-footer__col' }, [
      Utils.el('div', { className: 'app-footer__col-title', textContent: 'Stay sharp' }),
      Utils.el('p', {
        className: 'app-footer__brand-desc',
        style: 'margin-bottom:12px',
        textContent: 'Product notes and puzzle tips. No spam.',
      }),
    ]);
    const form = Utils.el('form', {
      className: 'app-footer__newsletter',
      onSubmit: (e) => {
        e.preventDefault();
        Toast.show({ type: 'success', title: 'You\'re on the list', message: 'Thanks for joining PuzzleHub updates.' });
        e.target.reset();
      },
    });
    form.appendChild(Utils.el('input', {
      type: 'email',
      required: 'required',
      placeholder: 'Email address',
      'aria-label': 'Email for updates',
      autocomplete: 'email',
    }));
    form.appendChild(Utils.el('button', {
      className: 'btn btn-primary btn-sm',
      type: 'submit',
      textContent: 'Join',
    }));
    newsCol.appendChild(form);

    const grid = Utils.el('div', { className: 'app-footer__grid' }, [
      brandCol,
      col('Product', [
        { href: '#/', label: 'All games' },
        { href: '#/leaderboard', label: 'Rankings' },
        { href: '#/community', label: 'Community' },
        { href: '#/profile', label: 'Profile' },
      ]),
      col('Learn', [
        { href: '#/how-to-play', label: 'How to play' },
        { href: '#/blog', label: 'Blog & guides' },
        { href: '#/about', label: 'About' },
        { href: '#', label: 'Settings', onClick: () => SettingsUI.open() },
      ]),
      col('Legal', [
        { href: '#/privacy-policy', label: 'Privacy Policy' },
        { href: '#/contact', label: 'Contact Us' },
      ]),
      newsCol,
    ]);

    const socialIcon = (path) =>
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">${path}</svg>`;

    const bottom = Utils.el('div', { className: 'app-footer__bottom' }, [
      Utils.el('div', { className: 'app-footer__copy', textContent: '© 2026 PuzzleHub. Free forever. Built with care.' }),
      Utils.el('div', { className: 'app-footer__social', 'aria-label': 'Social' }, [
        Utils.el('a', {
          href: '#/',
          'aria-label': 'Share PuzzleHub',
          title: 'Share',
          onClick: (e) => {
            e.preventDefault();
            if (typeof Social !== 'undefined') Social.share({ text: 'Play free premium puzzles on PuzzleHub' });
          },
          innerHTML: socialIcon('<path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>'),
        }),
        Utils.el('a', {
          href: '#/blog',
          'aria-label': 'Blog',
          title: 'Blog',
          innerHTML: socialIcon('<path d="M4 5h16v14H4z" stroke="currentColor" stroke-width="1.75"/><path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>'),
        }),
        Utils.el('a', {
          href: '#/community',
          'aria-label': 'Community',
          title: 'Community',
          innerHTML: socialIcon('<circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.75"/><circle cx="16" cy="10" r="2.5" stroke="currentColor" stroke-width="1.75"/><path d="M4 18c0-2.5 2.2-4 5-4s5 1.5 5 4M14 18c0-1.8 1.3-3 3.5-3S21 16.2 21 18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>'),
        }),
      ]),
    ]);

    parent.appendChild(Utils.el('footer', { className: 'app-footer', role: 'contentinfo' }, [
      Utils.el('div', { className: 'container' }, [grid, bottom]),
    ]));
  }


  function openAuth() {
    const body = Utils.el('div');
    const nameInput = Utils.el('input', { className: 'auth-field', type: 'text', maxlength: '20', placeholder: 'Display name', value: Storage.getProfile().name || '' });
    const emailInput = Utils.el('input', { className: 'auth-field', type: 'email', placeholder: 'Email (optional demo)' });
    body.appendChild(nameInput); body.appendChild(emailInput);
    body.appendChild(Utils.el('p', {
      style: 'font-size:12px;color:var(--text-tertiary);margin-top:4px',
      textContent: Cloud.ENDPOINT ? 'Connected to cloud API.' : 'Local guest mode — set window.PH_CLOUD_ENDPOINT for real accounts.',
    }));
    Modal.open({
      title: 'Sign in',
      body,
      footer: [
        Utils.el('button', {
          className: 'btn btn-secondary', type: 'button', textContent: 'Guest',
          onClick: async () => {
            await Cloud.signInGuest(nameInput.value);
            Modal.close();
            Toast.show({ type: 'success', message: 'Signed in as guest' });
            // refresh home if there
            if (Router.getCurrent() === '/') render();
          },
        }),
        Utils.el('button', {
          className: 'btn btn-primary', type: 'button', textContent: 'Continue',
          onClick: async () => {
            if (emailInput.value) await Cloud.signInEmail(emailInput.value, 'demo');
            else await Cloud.signInGuest(nameInput.value);
            Modal.close();
            Toast.show({ type: 'success', message: 'Welcome!' });
            if (Router.getCurrent() === '/') render();
          },
        }),
      ],
    });
  }

  return { render, openGame, startDaily, openAuth };
})();
if (typeof window !== 'undefined') { window.HomePage = HomePage; if (window.PH) window.PH.HomePage = HomePage; }



/* ===== js/pages/game.js ===== */
/**
 * PuzzleHub — Game Page
 * Lazy-loads game engines via GameRegistry (scalable Open/Closed design).
 */
const GamePage = (() => {
  let currentGame = null;
  let visibilityHandler = null;
  let saveInterval = null;

  function showLoader(page, meta) {
    const loader = Utils.el('div', {
      className: 'game-loader',
      role: 'status',
      'aria-live': 'polite',
    }, [
      Utils.el('div', {
        className: 'game-loader__icon',
        'aria-hidden': 'true',
        textContent: meta.icon || '🧩',
      }),
      Utils.el('div', { className: 'game-loader__title', textContent: meta.name }),
      Utils.el('div', {
        className: 'game-loader__text',
        textContent: (typeof I18n !== 'undefined' && I18n.t) ? I18n.t('game.loading') : 'Loading puzzle…',
      }),
      Utils.el('div', { className: 'game-loader__bar', 'aria-hidden': 'true' }, [
        Utils.el('div', { className: 'game-loader__fill' }),
      ]),
    ]);
    page.appendChild(loader);
    return loader;
  }

  function clearTimers() {
    if (saveInterval) {
      clearInterval(saveInterval);
      saveInterval = null;
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  }

  function destroyCurrent() {
    clearTimers();
    if (currentGame) {
      try {
        currentGame.destroy();
      } catch (e) {
        if (typeof ErrorBoundary !== 'undefined') ErrorBoundary.record(e, 'game.destroy');
      }
      currentGame = null;
    }
  }

  async function render(params) {
    const main = document.getElementById('main-content');
    main.innerHTML = '';

    const gameId = Security.safeGameId(params.id);
    const meta = gameId && typeof GAME_MAP !== 'undefined' ? GAME_MAP[gameId] : null;
    const registryReady = typeof GameRegistry !== 'undefined' && gameId && GameRegistry.has(gameId);

    if (!meta || !registryReady) {
      if (typeof SEO !== 'undefined') SEO.apply('/');
      main.appendChild(Utils.el('div', { className: 'empty-state' }, [
        Utils.el('div', { className: 'empty-state__icon', textContent: '❓' }),
        Utils.el('div', {
          className: 'empty-state__title',
          textContent: (typeof I18n !== 'undefined' && I18n.t) ? I18n.t('game.notFound') : 'Game not found',
        }),
        Utils.el('p', {
          className: 'empty-state__desc',
          textContent: 'That puzzle doesn’t exist. Pick another from the home page.',
        }),
        Utils.el('a', {
          href: '#/',
          className: 'btn btn-primary',
          style: 'margin-top:16px',
          textContent: (typeof I18n !== 'undefined' && I18n.t) ? I18n.t('game.home') : 'Home',
        }),
      ]));
      return;
    }

    if (typeof SEO !== 'undefined') SEO.apply(`/game/${gameId}`, { id: gameId });

    const difficulty = Security.safeDifficulty(
      params.d,
      meta.difficulties || (typeof Config !== 'undefined' ? Config.get('security.allowedDifficulties') : undefined)
    );
    const isDaily = params.daily === '1';
    const resume = params.resume === '1';

    if (!resume && !isDaily) {
      Storage.clearGameState(gameId);
    }

    if (typeof Analytics !== 'undefined') {
      Analytics.track('game_start', { game: gameId, difficulty, daily: isDaily, resume });
    }
    if (typeof Perf !== 'undefined' && Perf.mark) Perf.mark('game_load_start');

    const page = Utils.el('div', { className: 'game-page' });
    page.appendChild(Utils.el('nav', {
      className: 'game-breadcrumb container',
      'aria-label': 'Breadcrumb',
    }, [
      Utils.el('a', {
        href: '#/',
        textContent: (typeof I18n !== 'undefined' && I18n.t) ? I18n.t('nav.games') : 'Games',
      }),
      Utils.el('span', { textContent: ' / ', 'aria-hidden': 'true' }),
      Utils.el('span', { className: 'game-breadcrumb__current', textContent: meta.name }),
    ]));

    const loader = showLoader(page, meta);
    main.appendChild(page);

    try {
      const GameClass = await GameRegistry.resolve(gameId);
      loader.remove();

      const seedParam = params.seed ? parseInt(params.seed, 10) : null;
      const infinite = params.infinite === '1';
      let seed = null;
      if (isDaily) seed = Utils.dailySeed();
      else if (Number.isFinite(seedParam)) seed = seedParam;
      else if (infinite && typeof AIEngine !== 'undefined') {
        seed = AIEngine.unlimitedSeed(gameId, difficulty);
      }

      const opts = {
        difficulty,
        isDaily,
        seed,
        challengeId: params.challenge || null,
      };

      currentGame = new GameClass(opts);
      await currentGame.mount(page);

      if (typeof Perf !== 'undefined' && Perf.mark) {
        Perf.mark('game_load_end');
        Perf.measure('game_load', 'game_load_start');
      }

      // Prefetch related modules on idle
      if (typeof Perf !== 'undefined' && Perf.idle && typeof GameRegistry !== 'undefined') {
        Perf.idle(() => {
          const related = (typeof GAMES_META !== 'undefined' ? GAMES_META : [])
            .filter((g) => g.category === meta.category && g.id !== gameId)
            .slice(0, 2)
            .map((g) => g.id);
          GameRegistry.prefetch(related);
        }, 3000);
      }

      // Pause timer when tab hidden (battery + fairness)
      visibilityHandler = () => {
        if (!currentGame || currentGame.won) return;
        if (document.hidden) {
          if (!currentGame.paused && typeof currentGame.setPaused === 'function') {
            currentGame.setPaused(true, { silent: true, reason: 'visibility' });
          }
        } else if (currentGame._pausedByVisibility && typeof currentGame.setPaused === 'function') {
          currentGame.setPaused(false, { silent: true, reason: 'visibility' });
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);

      const interval =
        (typeof Config !== 'undefined' && Config.get('performance.autosaveIntervalMs')) || 15000;
      saveInterval = setInterval(() => {
        if (currentGame && !currentGame.won) {
          try {
            currentGame.save();
          } catch (e) {
            if (typeof ErrorBoundary !== 'undefined') ErrorBoundary.record(e, 'game.autosave');
          }
        }
      }, interval);

      return () => {
        destroyCurrent();
      };
    } catch (err) {
      if (typeof ErrorBoundary !== 'undefined') ErrorBoundary.record(err, 'game.load');
      if (typeof Logger !== 'undefined') Logger.error('Game load failed', { gameId, err: String(err && err.message) });
      if (typeof Analytics !== 'undefined') {
        Analytics.track('game_load_error', {
          game: gameId,
          message: String((err && err.message) || err).slice(0, 120),
        });
      }
      loader.remove();
      page.appendChild(Utils.el('div', { className: 'empty-state' }, [
        Utils.el('div', { className: 'empty-state__icon', textContent: '⚠️' }),
        Utils.el('div', { className: 'empty-state__title', textContent: 'Load failed' }),
        Utils.el('p', {
          className: 'empty-state__desc',
          textContent:
            (typeof I18n !== 'undefined' && I18n.t)
              ? I18n.t('error.load')
              : 'Could not load this game. Check your connection and try again.',
        }),
        Utils.el('button', {
          className: 'btn btn-primary',
          type: 'button',
          style: 'margin-top:16px',
          textContent: 'Retry',
          onClick: () => Router.resolve(),
        }),
      ]));
    }
  }

  return { render };
})();

if (typeof window !== 'undefined') {
  window.GamePage = GamePage;
  if (window.PH) window.PH.GamePage = GamePage;
}



/* ===== js/pages/profile.js ===== */
/**
 * PuzzleHub — Profile / Stats / Achievements Page
 */
const ProfilePage = (() => {
  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    SEO.apply('/profile');

    const page = Utils.el('div', { className: 'page-enter' });
    const container = Utils.el('div', { className: 'container' });

    const profile = Storage.getProfile();
    const stats = Stats.get();

    // Header
    const header = Utils.el('div', { className: 'profile-header' }, [
      Utils.el('div', {
        className: 'profile-avatar',
        textContent: profile.avatar || '🧩',
        role: 'button',
        tabindex: '0',
        'aria-label': 'Change avatar',
        onClick: () => changeAvatar(),
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); changeAvatar(); }
        },
        style: 'cursor:pointer',
      }),
      Utils.el('div', { className: 'profile-info' }, [
        Utils.el('h1', {
          textContent: profile.name,
          role: 'button',
          tabindex: '0',
          style: 'cursor:pointer',
          'aria-label': 'Edit name',
          onClick: () => editName(),
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editName(); }
          },
        }),
        Utils.el('p', {
          textContent: `Member since ${new Date(profile.createdAt || Date.now()).toLocaleDateString()}`,
        }),
        stats.currentStreak > 0
          ? Utils.el('div', { className: 'profile-streak' }, [
              Utils.el('span', { textContent: '🔥' }),
              Utils.el('span', { textContent: `${stats.currentStreak}-day streak` }),
            ])
          : null,
      ].filter(Boolean)),
    ]);
    container.appendChild(header);

    // Stats grid
    container.appendChild(Utils.el('div', { className: 'section__header' }, [
      Utils.el('h2', { className: 'section__title', textContent: 'Statistics' }),
    ]));

    const statsGrid = Utils.el('div', { className: 'stats-grid' }, [
      statCard(stats.gamesPlayed, 'Played'),
      statCard(stats.gamesWon, 'Won'),
      statCard(Stats.winRate() + '%', 'Win Rate'),
      statCard(Utils.formatTime(stats.totalTime), 'Total Time'),
      statCard(stats.currentStreak, 'Streak'),
      statCard(stats.bestStreak, 'Best Streak'),
      statCard(Achievements.count(), 'Achievements'),
    ]);
    container.appendChild(statsGrid);

    // Per-game stats
    container.appendChild(Utils.el('div', { className: 'section__header' }, [
      Utils.el('h2', { className: 'section__title', textContent: 'By Game' }),
    ]));

    const byGame = Utils.el('div', { className: 'stats-grid' });
    for (const game of GAMES_META) {
      const g = stats.byGame[game.id];
      if (!g || g.played === 0) continue;
      const card = Utils.el('div', { className: 'stat-card', style: 'text-align:left' }, [
        Utils.el('div', { style: 'font-size:1.5rem;margin-bottom:4px', textContent: game.icon }),
        Utils.el('div', { style: 'font-weight:700;font-size:14px;margin-bottom:4px', textContent: game.name }),
        Utils.el('div', { style: 'font-size:12px;color:var(--text-tertiary)', textContent: `${g.won}/${g.played} won` }),
        g.bestTime != null
          ? Utils.el('div', { style: 'font-size:12px;color:var(--text-brand);font-family:var(--font-mono);margin-top:2px', textContent: `Best ${Utils.formatTime(g.bestTime)}` })
          : null,
      ].filter(Boolean));
      byGame.appendChild(card);
    }
    if (!byGame.children.length) {
      byGame.appendChild(Utils.el('p', {
        style: 'color:var(--text-tertiary);grid-column:1/-1',
        textContent: 'Play some games to see stats here!',
      }));
    }
    container.appendChild(byGame);

    // Achievements
    container.appendChild(Utils.el('div', { className: 'section__header', style: 'margin-top:32px' }, [
      Utils.el('h2', { className: 'section__title', textContent: 'Achievements' }),
      Utils.el('span', {
        style: 'font-size:13px;color:var(--text-tertiary)',
        textContent: `${Achievements.count()} / ${Achievements.DEFINITIONS.length}`,
      }),
    ]));

    const achGrid = Utils.el('div', { className: 'achievements-grid' });
    for (const a of Achievements.getAll()) {
      achGrid.appendChild(Utils.el('div', {
        className: `achievement${a.unlocked ? ' unlocked' : ''}`,
      }, [
        Utils.el('div', { className: 'achievement__icon', textContent: a.icon }),
        Utils.el('div', {}, [
          Utils.el('div', { className: 'achievement__name', textContent: a.name }),
          Utils.el('div', { className: 'achievement__desc', textContent: a.desc }),
        ]),
      ]));
    }
    container.appendChild(achGrid);

    // Reset data
    container.appendChild(Utils.el('div', { style: 'margin:48px 0 24px;text-align:center' }, [
      Utils.el('button', {
        className: 'btn btn-ghost btn-sm',
        style: 'color:var(--danger)',
        textContent: 'Reset All Data',
        onClick: async () => {
          const ok = await Modal.confirm({
            title: 'Reset All Data?',
            message: 'This will permanently delete your stats, achievements, and saved games. This cannot be undone.',
            confirmLabel: 'Reset Everything',
            danger: true,
          });
          if (ok) {
            ['stats', 'achievements', 'profile', 'daily', 'settings', 'best_2048'].forEach(k => Storage.remove(k));
            GAMES_META.forEach(g => Storage.clearGameState(g.id));
            Toast.show({ type: 'info', message: 'All data reset' });
            render();
          }
        },
      }),
    ]));

    page.appendChild(container);
    main.appendChild(page);
  }

  function statCard(value, label) {
    return Utils.el('div', { className: 'stat-card' }, [
      Utils.el('div', { className: 'stat-card__value', textContent: String(value) }),
      Utils.el('div', { className: 'stat-card__label', textContent: label }),
    ]);
  }

  function editName() {
    const profile = Storage.getProfile();
    const input = Utils.el('input', {
      type: 'text',
      value: profile.name,
      maxlength: '20',
      autocomplete: 'nickname',
      'aria-label': 'Display name',
      style: 'width:100%;padding:10px 14px;border:1px solid var(--border-default);border-radius:var(--radius-lg);background:var(--bg-sunken);font-size:16px',
    });
    Modal.open({
      title: 'Edit Name',
      body: input,
      footer: [
        Utils.el('button', { className: 'btn btn-secondary', type: 'button', textContent: 'Cancel', onClick: () => Modal.close() }),
        Utils.el('button', {
          className: 'btn btn-primary',
          type: 'button',
          textContent: 'Save',
          onClick: () => {
            const name = Security.sanitizeName(input.value, 20).replace(/&[^;]+;/g, '') || 'Player';
            // sanitizeName escapes HTML entities; for storage keep plain trimmed text
            profile.name = String(input.value || 'Player').trim().slice(0, 20).replace(/[<>]/g, '') || 'Player';
            Storage.setProfile(profile);
            Modal.close();
            render();
          },
        }),
      ],
      size: 'sm',
    });
    setTimeout(() => input.focus(), 100);
  }

  function changeAvatar() {
    const emojis = ['🧩','🎮','🧠','⭐','🚀','🦊','🐱','🐼','🦄','🎯','💎','🔥','🌟','👾','🎨'];
    const grid = Utils.el('div', {
      style: 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px',
    });
    emojis.forEach(e => {
      grid.appendChild(Utils.el('button', {
        className: 'btn btn-secondary',
        style: 'font-size:1.5rem;aspect-ratio:1;padding:0',
        textContent: e,
        onClick: () => {
          const profile = Storage.getProfile();
          profile.avatar = e;
          Storage.setProfile(profile);
          Modal.close();
          render();
        },
      }));
    });
    Modal.open({ title: 'Choose Avatar', body: grid, size: 'sm' });
  }

  return { render };
})();
if (typeof window !== 'undefined') { window.ProfilePage = ProfilePage; if (window.PH) window.PH.ProfilePage = ProfilePage; }



/* ===== js/pages/about.js ===== */
/**
 * PuzzleHub — About page (SEO content + trust)
 */
const AboutPage = (() => {
  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    SEO.apply('/about');

    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container content-narrow' });

    container.innerHTML = `
      <article itemscope itemtype="https://schema.org/AboutPage">
        <header class="content-hero">
          <p class="content-kicker">About</p>
          <h1 itemprop="name">Built for focus. Free forever.</h1>
          <p class="content-lead" itemprop="description">
            PuzzleHub is a premium, privacy-first puzzle platform — no accounts, no installs,
            no clutter. Just carefully crafted brain games that work offline and respect your time.
          </p>
        </header>

        <section class="content-section">
          <h2>Why PuzzleHub?</h2>
          <div class="feature-grid">
            <div class="feature-tile">
              <div class="feature-tile__icon" aria-hidden="true">⚡</div>
              <h3>Instant play</h3>
              <p>Open the site and start. Games load fast, run smoothly, and save progress automatically.</p>
            </div>
            <div class="feature-tile">
              <div class="feature-tile__icon" aria-hidden="true">🔒</div>
              <h3>Privacy first</h3>
              <p>Your stats stay on your device. We don’t require sign-up or personal data to play.</p>
            </div>
            <div class="feature-tile">
              <div class="feature-tile__icon" aria-hidden="true">♿</div>
              <h3>Accessible</h3>
              <p>Keyboard navigation, screen-reader labels, focus states, and reduced-motion support.</p>
            </div>
            <div class="feature-tile">
              <div class="feature-tile__icon" aria-hidden="true">📴</div>
              <h3>Works offline</h3>
              <p>Install as a PWA and keep playing without a connection — perfect for travel and focus time.</p>
            </div>
          </div>
        </section>

        <section class="content-section">
          <h2>Games we craft</h2>
          <p>
            From classic <a href="#/game/sudoku?d=medium">Sudoku</a> and
            <a href="#/game/crossword?d=easy">Crossword</a> to
            <a href="#/game/nonogram?d=easy">Nonogram</a>,
            <a href="#/game/kakuro?d=easy">Kakuro</a>,
            <a href="#/game/minesweeper?d=easy">Minesweeper</a>,
            <a href="#/game/2048?d=normal">2048</a>,
            <a href="#/game/wordsearch?d=easy">Word Search</a>,
            <a href="#/game/cryptogram?d=easy">Cryptogram</a>, and
            <a href="#/game/memory?d=easy">Memory</a> —
            each title includes difficulty levels, hints, undo, timers, and polished touch + keyboard controls.
          </p>
        </section>

        <section class="content-section">
          <h2>Daily challenge</h2>
          <p>
            Every day brings a seeded puzzle shared by all players. Build a streak, beat your time,
            and come back tomorrow. <a href="#/" class="text-link">Start today’s challenge →</a>
          </p>
        </section>

        <section class="content-section">
          <h2>Our principles</h2>
          <ul class="content-list">
            <li><strong>Quality over quantity</strong> — fewer gimmicks, better puzzles.</li>
            <li><strong>Performance over spectacle</strong> — buttery UI without heavy frameworks.</li>
            <li><strong>Accessibility over decoration</strong> — everyone should be able to play.</li>
            <li><strong>SEO &amp; openness</strong> — semantic markup, structured data, crawlable structure.</li>
          </ul>
        </section>

        <footer class="content-footer">
          <a class="btn btn-primary" href="#/">Play now</a>
          <a class="btn btn-secondary" href="#/how-to-play">How to play</a>
        </footer>
      </article>
    `;

    page.appendChild(container);
    main.appendChild(page);
    appendSiteFooter(main);
  }

  return { render };
})();

function appendSiteFooter(parent) {
  if (parent.querySelector('.app-footer')) return;
  parent.appendChild(Utils.el('footer', { className: 'app-footer', role: 'contentinfo' }, [
    Utils.el('div', { className: 'container app-footer__inner' }, [
      Utils.el('div', { className: 'app-footer__copy', textContent: '© 2026 PuzzleHub · Free puzzle games for everyone' }),
      Utils.el('nav', { className: 'app-footer__links', 'aria-label': 'Footer' }, [
        Utils.el('a', { href: '#/', textContent: 'Games' }),
        Utils.el('a', { href: '#/how-to-play', textContent: 'How to Play' }),
        Utils.el('a', { href: '#/blog', textContent: 'Blog' }),
        Utils.el('a', { href: '#/leaderboard', textContent: 'Rankings' }),
        Utils.el('a', { href: '#/community', textContent: 'Community' }),
        Utils.el('a', { href: '#/about', textContent: 'About' }),
        Utils.el('a', { href: '#/profile', textContent: 'Profile' }),
        Utils.el('a', { href: '#/privacy-policy', textContent: 'Privacy Policy' }),
        Utils.el('a', { href: '#/contact', textContent: 'Contact' }),
      ]),
    ]),
  ]));
}
if (typeof window !== 'undefined') { window.AboutPage = AboutPage; window.appendSiteFooter = appendSiteFooter; }



/* ===== js/pages/howto.js ===== */
/**
 * PuzzleHub — How to Play guides (SEO + engagement content)
 */
const HowToPage = (() => {
  const GUIDES = [
    {
      id: 'sudoku',
      title: 'How to Play Sudoku',
      body: `Fill a 9×9 grid so each row, column, and 3×3 box contains the digits 1–9 exactly once. Given numbers (bold) cannot be changed. Use Notes mode to pencil-mark candidates. Start with easy singles, then eliminate candidates until the grid is complete.`,
    },
    {
      id: 'crossword',
      title: 'How to Play Crossword',
      body: `Read the Across and Down clues and fill letters into the white squares. Click a cell twice (or press Space) to switch direction. Black squares separate words. Every letter must fit both its across and down words.`,
    },
    {
      id: 'wordsearch',
      title: 'How to Play Word Search',
      body: `Find every listed word in the letter grid. Words may run horizontally, vertically, or diagonally — forward or backward. Drag (or swipe) along the letters to select. Found words are highlighted and crossed off the list.`,
    },
    {
      id: 'cryptogram',
      title: 'How to Play Cryptogram',
      body: `Each letter in the quote is replaced by another letter using a fixed substitution cipher. Click a cipher letter, then choose its plain letter from the keyboard. Frequency of common letters (E, T, A) and short words (THE, AND) are great starting points.`,
    },
    {
      id: 'kakuro',
      title: 'How to Play Kakuro',
      body: `Fill white cells with digits 1–9 so each “run” adds up to the clue shown in the black triangle cell. Digits cannot repeat within a run. Use the across clue (top-right of a clue cell) and down clue (bottom-left) to constrain possibilities.`,
    },
    {
      id: 'nonogram',
      title: 'How to Play Nonogram',
      body: `Paint cells to match the number clues on each row and column. Numbers list contiguous filled blocks in order. Use Mark (×) for cells you know are empty. When every row and column matches its clues, the hidden picture appears.`,
    },
    {
      id: '2048',
      title: 'How to Play 2048',
      body: `Swipe or use arrow keys to slide all tiles. When two tiles with the same number collide, they merge into one with double the value. After every move a new 2 or 4 appears. Reach the 2048 tile to win — then keep going for a high score.`,
    },
    {
      id: 'minesweeper',
      title: 'How to Play Minesweeper',
      body: `Click to reveal a cell. Numbers show how many mines are adjacent. Right-click (or long-press) to place a flag on suspected mines. Reveal all safe cells to win. Your first click is always safe.`,
    },
    {
      id: 'memory',
      title: 'How to Play Memory',
      body: `Flip two cards per turn. If they match, they stay face-up. If not, they flip back. Remember positions and clear the board with as few moves as possible. Higher difficulties add more pairs.`,
    },
  ];

  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    SEO.apply('/how-to-play');

    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container content-narrow' });

    const header = Utils.el('header', { className: 'content-hero' }, [
      Utils.el('p', { className: 'content-kicker', textContent: 'Guides' }),
      Utils.el('h1', { textContent: 'How to play every game' }),
      Utils.el('p', {
        className: 'content-lead',
        textContent: 'Clear, beginner-friendly rules for all PuzzleHub games. Jump in when you’re ready — each guide links straight to play.',
      }),
    ]);
    container.appendChild(header);

    // TOC for internal linking / a11y
    const toc = Utils.el('nav', {
      className: 'content-toc',
      'aria-label': 'Guide table of contents',
    });
    toc.appendChild(Utils.el('h2', { className: 'sr-only', textContent: 'Contents' }));
    const tocList = Utils.el('div', { className: 'content-toc__list' });
    GUIDES.forEach((g) => {
      tocList.appendChild(Utils.el('a', {
        href: `#guide-${g.id}`,
        className: 'content-toc__link',
        textContent: GAME_MAP[g.id]?.name || g.id,
      }));
    });
    toc.appendChild(tocList);
    container.appendChild(toc);

    GUIDES.forEach((g) => {
      const meta = GAME_MAP[g.id];
      const section = Utils.el('section', {
        className: 'content-section guide-card',
        id: `guide-${g.id}`,
      });
      section.appendChild(Utils.el('h2', {
        textContent: `${meta?.icon || '🧩'} ${g.title}`,
      }));
      section.appendChild(Utils.el('p', { textContent: g.body }));
      section.appendChild(Utils.el('a', {
        className: 'btn btn-secondary btn-sm',
        href: `#/game/${g.id}?d=${(meta?.difficulties || ['easy'])[0]}`,
        textContent: `Play ${meta?.name || g.id}`,
        onClick: () => Analytics.track('guide_play_click', { game: g.id }),
      }));
      container.appendChild(section);
    });

    container.appendChild(Utils.el('footer', { className: 'content-footer' }, [
      Utils.el('a', { className: 'btn btn-primary', href: '#/', textContent: 'Browse all games' }),
      Utils.el('a', { className: 'btn btn-secondary', href: '#/about', textContent: 'About PuzzleHub' }),
    ]));

    page.appendChild(container);
    main.appendChild(page);
    if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
  }

  return { render };
})();
if (typeof window !== 'undefined') { window.HowToPage = HowToPage; if (window.PH) window.PH.HowToPage = HowToPage; }



/* ===== js/pages/leaderboard.js ===== */
/**
 * PuzzleHub — Public Rankings / Leaderboards
 */
const LeaderboardPage = (() => {
  async function render(params) {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    SEO.apply('/leaderboard');

    const gameId = params.game || 'global';
    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container' });

    container.appendChild(Utils.el('header', { className: 'content-hero' }, [
      Utils.el('p', { className: 'content-kicker', textContent: 'Compete' }),
      Utils.el('h1', { textContent: 'Global Leaderboards' }),
      Utils.el('p', {
        className: 'content-lead',
        textContent: 'Public rankings across PuzzleHub. Sign in as a guest to post scores from any device profile.',
      }),
    ]));

    // Game filter
    const filters = Utils.el('div', { className: 'pill-group', style: 'margin-bottom:20px' });
    const options = [{ id: 'global', name: 'Global' }].concat(GAMES_META.map((g) => ({ id: g.id, name: g.name })));
    options.forEach((opt) => {
      filters.appendChild(Utils.el('button', {
        className: `pill${opt.id === gameId ? ' active' : ''}`,
        type: 'button',
        textContent: opt.name,
        onClick: () => Router.navigate(opt.id === 'global' ? '/leaderboard' : `/leaderboard?game=${opt.id}`),
      }));
    });
    container.appendChild(filters);

    const board = await Cloud.getLeaderboard(gameId, 25);
    const list = Utils.el('div', { className: 'lb-list', role: 'list' });

    if (!board.length) {
      list.appendChild(Utils.el('div', { className: 'empty-state' }, [
        Utils.el('div', { className: 'empty-state__icon', textContent: '🏁' }),
        Utils.el('div', { className: 'empty-state__title', textContent: 'No scores yet' }),
        Utils.el('p', { className: 'empty-state__desc', textContent: 'Win a puzzle to claim the top spot.' }),
        Utils.el('a', { href: '#/', className: 'btn btn-primary', style: 'margin-top:12px', textContent: 'Play now' }),
      ]));
    } else {
      board.forEach((row, i) => {
        list.appendChild(Utils.el('div', { className: 'lb-row', role: 'listitem' }, [
          Utils.el('div', { className: 'lb-rank', textContent: String(i + 1) }),
          Utils.el('div', { className: 'lb-avatar', textContent: row.avatar || '🧩' }),
          Utils.el('div', { className: 'lb-meta' }, [
            Utils.el('div', { className: 'lb-name', textContent: row.name || 'Player' }),
            Utils.el('div', {
              className: 'lb-sub',
              textContent: `${GAME_MAP[row.gameId]?.name || row.gameId} · ${row.difficulty || ''} · ${Utils.formatTime(row.time || 0)}`,
            }),
          ]),
          Utils.el('div', { className: 'lb-score', textContent: String(row.score || 0) }),
        ]));
      });
    }
    container.appendChild(list);

    // Tournaments snapshot
    container.appendChild(Utils.el('h2', { className: 'section__title', style: 'margin:32px 0 16px', textContent: 'Live Tournaments' }));
    const tours = Utils.el('div', { className: 'tour-grid' });
    Tournaments.activeTournaments().forEach((t) => {
      const remaining = Math.max(0, t.endsAt - Date.now());
      const hrs = Math.floor(remaining / 3600000);
      tours.appendChild(Utils.el('div', { className: 'tour-card' }, [
        Utils.el('div', { style: 'font-size:1.75rem', textContent: t.icon }),
        Utils.el('div', { className: 'tour-card__name', textContent: t.name }),
        Utils.el('div', { className: 'tour-card__desc', textContent: t.desc }),
        Utils.el('div', { className: 'tour-card__meta', textContent: `Ends in ~${hrs}h · ${t.reward}` }),
      ]));
    });
    container.appendChild(tours);

    page.appendChild(container);
    main.appendChild(page);
    if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
  }

  return { render };
})();

if (typeof window !== 'undefined') { window.LeaderboardPage = LeaderboardPage; if (window.PH) window.PH.LeaderboardPage = LeaderboardPage; }



/* ===== js/pages/community.js ===== */
/**
 * PuzzleHub — Community Challenges + Puzzle Editor
 */
const CommunityPage = (() => {
  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    SEO.apply('/community');

    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container' });

    container.appendChild(Utils.el('header', { className: 'content-hero' }, [
      Utils.el('p', { className: 'content-kicker', textContent: 'Community' }),
      Utils.el('h1', { textContent: 'Create & Challenge' }),
      Utils.el('p', {
        className: 'content-lead',
        textContent: 'Build Sudoku puzzles, publish to the community feed, and challenge friends with shared seeds.',
      }),
    ]));

    // Tabs
    let tab = 'feed';
    const tabs = Utils.el('div', { className: 'tabs', style: 'max-width:420px;margin-bottom:20px' });
    const panels = Utils.el('div');

    function setTab(id) {
      tab = id;
      tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
      renderPanel();
    }

    ['feed', 'editor', 'challenges'].forEach((id) => {
      const labels = { feed: 'Feed', editor: 'Puzzle Editor', challenges: 'Friend Challenges' };
      tabs.appendChild(Utils.el('button', {
        className: `tab${id === tab ? ' active' : ''}`,
        type: 'button',
        dataset: { id },
        textContent: labels[id],
        onClick: () => setTab(id),
      }));
    });
    container.appendChild(tabs);
    container.appendChild(panels);

    function renderPanel() {
      panels.innerHTML = '';
      if (tab === 'feed') renderFeed(panels);
      else if (tab === 'editor') renderEditor(panels);
      else renderChallenges(panels);
    }

    function renderFeed(host) {
      const feed = Social.communityFeed();
      if (!feed.length) {
        host.appendChild(Utils.el('div', { className: 'empty-state' }, [
          Utils.el('div', { className: 'empty-state__icon', textContent: '📰' }),
          Utils.el('div', { className: 'empty-state__title', textContent: 'No community puzzles yet' }),
          Utils.el('p', { className: 'empty-state__desc', textContent: 'Be the first — open the Puzzle Editor and publish.' }),
        ]));
        return;
      }
      const list = Utils.el('div', { className: 'community-feed' });
      feed.forEach((item) => {
        list.appendChild(Utils.el('div', { className: 'community-card' }, [
          Utils.el('div', { className: 'community-card__title', textContent: item.title || 'Untitled puzzle' }),
          Utils.el('div', {
            className: 'community-card__meta',
            textContent: `by ${item.author || 'Player'} · ${item.gameId} · ${item.difficulty || ''}`,
          }),
          Utils.el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [
            Utils.el('button', {
              className: 'btn btn-primary btn-sm',
              type: 'button',
              textContent: 'Play',
              onClick: () => {
                // Store puzzle override for sudoku resume path
                if (item.puzzle) Storage.set('community_play', item);
                Router.navigate(`/game/${item.gameId}?d=${item.difficulty || 'medium'}&community=1`);
              },
            }),
            Utils.el('button', {
              className: 'btn btn-secondary btn-sm',
              type: 'button',
              textContent: 'Share',
              onClick: () => Social.share({
                text: `Try this community ${item.gameId} on PuzzleHub: ${item.title || ''}`,
              }),
            }),
          ]),
        ]));
      });
      host.appendChild(list);
    }

    function renderEditor(host) {
      const draft = PuzzleEditor.draft();
      let grid = draft.grid || PuzzleEditor.emptySudoku();
      let title = draft.title || '';
      let selected = { r: 0, c: 0 };

      const wrap = Utils.el('div', { className: 'editor-wrap' });
      const titleInput = Utils.el('input', {
        type: 'text',
        maxlength: '40',
        value: title,
        placeholder: 'Puzzle title',
        'aria-label': 'Puzzle title',
        style: 'width:100%;max-width:420px;padding:10px 14px;margin-bottom:12px;border:1px solid var(--border-default);border-radius:var(--radius-lg);background:var(--bg-elevated)',
        onInput: (e) => { title = e.target.value; },
      });
      wrap.appendChild(titleInput);

      const board = Utils.el('div', {
        className: 'puzzle-board sudoku-board editor-board',
        role: 'grid',
        style: 'max-width:420px;aspect-ratio:1;margin-bottom:12px',
      });

      function paint() {
        board.innerHTML = '';
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const cell = Utils.el('div', {
              className: 'puzzle-cell' + (selected.r === r && selected.c === c ? ' selected' : '') + (grid[r][c] ? ' fixed' : ''),
              textContent: grid[r][c] || '',
              role: 'gridcell',
              tabindex: '0',
              onClick: () => { selected = { r, c }; paint(); },
            });
            board.appendChild(cell);
          }
        }
      }
      paint();
      wrap.appendChild(board);

      const pad = Utils.el('div', { className: 'game-numpad', style: 'max-width:420px' });
      for (let n = 1; n <= 9; n++) {
        pad.appendChild(Utils.el('button', {
          className: 'btn btn-secondary',
          type: 'button',
          textContent: String(n),
          onClick: () => {
            if (!PuzzleEditor.isValidPlacement(grid, selected.r, selected.c, n) && n) {
              Toast.show({ type: 'error', message: 'Invalid placement' });
              return;
            }
            grid[selected.r][selected.c] = grid[selected.r][selected.c] === n ? 0 : n;
            PuzzleEditor.saveDraft({ gameId: 'sudoku', grid, title });
            paint();
          },
        }));
      }
      wrap.appendChild(pad);

      const actions = Utils.el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:16px' }, [
        Utils.el('button', {
          className: 'btn btn-secondary',
          type: 'button',
          textContent: 'Validate',
          onClick: () => {
            const v = PuzzleEditor.validateSudoku(grid);
            if (v.ok) Toast.show({ type: 'success', message: `Valid ${v.difficulty} puzzle · ${v.clues} clues` });
            else Toast.show({ type: 'error', message: v.error });
          },
        }),
        Utils.el('button', {
          className: 'btn btn-primary',
          type: 'button',
          textContent: 'Publish',
          onClick: () => {
            const item = PuzzleEditor.publishSudoku(grid, title);
            if (item) {
              Toast.show({ type: 'success', message: 'Published to community!' });
              setTab('feed');
            }
          },
        }),
        Utils.el('button', {
          className: 'btn btn-ghost',
          type: 'button',
          textContent: 'Clear',
          onClick: () => {
            grid = PuzzleEditor.emptySudoku();
            PuzzleEditor.saveDraft({ gameId: 'sudoku', grid, title });
            paint();
          },
        }),
      ]);
      wrap.appendChild(actions);
      wrap.appendChild(Utils.el('p', {
        style: 'margin-top:12px;font-size:13px;color:var(--text-tertiary);max-width:420px',
        textContent: 'Editor validates uniqueness (single solution) before publish. More game types coming soon.',
      }));
      host.appendChild(wrap);
    }

    function renderChallenges(host) {
      const box = Utils.el('div');
      const form = Utils.el('div', { className: 'card', style: 'padding:16px;margin-bottom:16px;max-width:480px' });
      let gameId = 'sudoku';
      let difficulty = 'medium';
      let friend = 'Friend';

      form.appendChild(Utils.el('h2', { textContent: 'New friend challenge', style: 'margin-bottom:12px;font-size:1.5rem' }));
      const nameInput = Utils.el('input', {
        type: 'text',
        placeholder: 'Friend name',
        maxlength: '20',
        style: 'width:100%;padding:10px;margin-bottom:10px;border:1px solid var(--border-default);border-radius:8px;background:var(--bg-sunken)',
        onInput: (e) => { friend = e.target.value || 'Friend'; },
      });
      form.appendChild(nameInput);

      const gPills = Utils.el('div', { className: 'pill-group', style: 'margin-bottom:10px' });
      GAMES_META.slice(0, 6).forEach((g) => {
        const pill = Utils.el('button', {
          className: `pill${g.id === gameId ? ' active' : ''}`,
          type: 'button',
          textContent: g.name,
          onClick: () => {
            gameId = g.id;
            gPills.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
            pill.classList.add('active');
          },
        });
        gPills.appendChild(pill);
      });
      form.appendChild(gPills);

      form.appendChild(Utils.el('button', {
        className: 'btn btn-primary',
        type: 'button',
        textContent: 'Create challenge link',
        onClick: () => {
          const ch = Social.createChallenge({ gameId, difficulty, friendName: friend });
          const url = `${location.href.split('#')[0]}#/game/${gameId}?d=${difficulty}&seed=${ch.seed}&challenge=${ch.id}`;
          Social.share({ text: `${Cloud.getUser()?.name || 'I'} challenged you on PuzzleHub!`, url });
          Toast.show({ type: 'success', message: 'Challenge created' });
          renderChallenges(host);
        },
      }));
      box.appendChild(form);

      const list = Social.listChallenges();
      if (!list.length) {
        box.appendChild(Utils.el('p', { style: 'color:var(--text-tertiary)', textContent: 'No challenges yet.' }));
      } else {
        list.forEach((ch) => {
          box.appendChild(Utils.el('div', { className: 'community-card' }, [
            Utils.el('div', { className: 'community-card__title', textContent: `vs ${ch.to}` }),
            Utils.el('div', {
              className: 'community-card__meta',
              textContent: `${ch.gameId} · ${ch.difficulty} · ${ch.status}${ch.myTime != null ? ' · ' + Utils.formatTime(ch.myTime) : ''}`,
            }),
            Utils.el('button', {
              className: 'btn btn-secondary btn-sm',
              type: 'button',
              style: 'margin-top:8px',
              textContent: 'Play',
              onClick: () => Router.navigate(`/game/${ch.gameId}?d=${ch.difficulty}&seed=${ch.seed}&challenge=${ch.id}`),
            }),
          ]));
        });
      }
      host.innerHTML = '';
      host.appendChild(box);
    }

    renderPanel();
    page.appendChild(container);
    main.appendChild(page);
    if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
  }

  return { render };
})();

if (typeof window !== 'undefined') { window.CommunityPage = CommunityPage; if (window.PH) window.PH.CommunityPage = CommunityPage; }



/* ===== js/pages/blog.js ===== */
/**
 * PuzzleHub — Blog / Guides / Tutorials (SEO content hub)
 */
const BlogPage = (() => {
  const POSTS = [
    {
      id: 'sudoku-techniques',
      title: '7 Sudoku techniques from beginner to expert',
      excerpt: 'Naked singles, hidden pairs, pointing pairs, X-Wing and more — explained simply.',
      tag: 'Tutorial',
      read: '6 min',
      body: `Start with scanning for naked singles. Then mark candidates (Notes). Hidden singles appear when a digit can only live in one cell of a unit. Pairs and triples let you eliminate candidates elsewhere. Advanced players use X-Wing and Swordfish on digit patterns across rows and columns. Practice one technique at a time on medium puzzles.`,
    },
    {
      id: 'daily-habit',
      title: 'How a 10-minute daily puzzle habit boosts focus',
      excerpt: 'Why short, consistent sessions beat marathon cramming for brain training.',
      tag: 'Wellness',
      read: '4 min',
      body: `Pick one daily challenge. Play without multitasking. Track streaks, not perfection. Stop after one win or one focused attempt — leaving desire to return tomorrow is a feature. PuzzleHub's daily seed makes the habit social: everyone shares the same puzzle that day.`,
    },
    {
      id: 'minesweeper-logic',
      title: 'Minesweeper without guessing: edge logic',
      excerpt: 'Learn deterministic patterns so you only open safe cells.',
      tag: 'Tutorial',
      read: '5 min',
      body: `When a number equals the count of adjacent hidden cells, they are all mines. When a number equals adjacent flags, the rest are safe. 1-2-1 patterns on edges often force a mine in the center. Open large zero-regions early to reduce combinatorics.`,
    },
    {
      id: 'create-community',
      title: 'Publishing your first community Sudoku',
      excerpt: 'Use the Puzzle Editor to craft a unique puzzle with a single solution.',
      tag: 'Community',
      read: '3 min',
      body: `Open Community → Puzzle Editor. Place at least 17 clues. Hit Validate — PuzzleHub checks for conflicts and uniqueness. Publish with a clear title. Share the feed card with friends. Fair puzzles avoid forced guessing; uniqueness is enforced on publish.`,
    },
    {
      id: 'offline-sync',
      title: 'Offline play and cloud sync explained',
      excerpt: 'How progress queues while offline and flushes when you reconnect.',
      tag: 'Product',
      read: '3 min',
      body: `Scores and saves write locally first. If the cloud endpoint is configured, mutations queue in Sync and flush on online events. Guest accounts keep a stable user id in localStorage so leaderboards stay consistent on one device; connect a backend for multi-device auth.`,
    },
  ];

  function render(params) {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    const postId = params.id;
    const post = POSTS.find((p) => p.id === postId);

    if (post) {
      SEO.apply('/blog/' + post.id);
      document.title = `${post.title} — PuzzleHub Blog`;
      const page = Utils.el('div', { className: 'page-enter content-page' });
      const container = Utils.el('div', { className: 'container content-narrow' });
      container.appendChild(Utils.el('a', {
        href: '#/blog',
        style: 'font-size:13px;font-weight:600',
        textContent: '← All articles',
      }));
      container.appendChild(Utils.el('header', { className: 'content-hero', style: 'padding-top:16px' }, [
        Utils.el('p', { className: 'content-kicker', textContent: `${post.tag} · ${post.read}` }),
        Utils.el('h1', { textContent: post.title }),
      ]));
      post.body.split('\n\n').forEach((para) => {
        container.appendChild(Utils.el('p', { style: 'margin-bottom:1rem;color:var(--text-secondary);line-height:1.7', textContent: para }));
      });
      container.appendChild(Utils.el('div', { className: 'content-footer' }, [
        Utils.el('button', {
          className: 'btn btn-secondary',
          type: 'button',
          textContent: 'Share article',
          onClick: () => Social.share({ title: post.title, text: post.excerpt }),
        }),
        Utils.el('a', { className: 'btn btn-primary', href: '#/', textContent: 'Play a puzzle' }),
      ]));
      page.appendChild(container);
      main.appendChild(page);
      if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
      return;
    }

    SEO.apply('/blog');
    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container' });
    container.appendChild(Utils.el('header', { className: 'content-hero' }, [
      Utils.el('p', { className: 'content-kicker', textContent: 'Learn' }),
      Utils.el('h1', { textContent: 'Blog, guides & tutorials' }),
      Utils.el('p', {
        className: 'content-lead',
        textContent: 'Original strategy guides and product deep-dives — written for humans, structured for search.',
      }),
    ]));

    const grid = Utils.el('div', { className: 'blog-grid' });
    POSTS.forEach((p) => {
      grid.appendChild(Utils.el('a', {
        className: 'blog-card',
        href: `#/blog/${p.id}`,
      }, [
        Utils.el('div', { className: 'blog-card__tag', textContent: p.tag }),
        Utils.el('div', { className: 'blog-card__title', textContent: p.title }),
        Utils.el('div', { className: 'blog-card__excerpt', textContent: p.excerpt }),
        Utils.el('div', { className: 'blog-card__read', textContent: p.read + ' read' }),
      ]));
    });
    container.appendChild(grid);
    page.appendChild(container);
    main.appendChild(page);
    if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
  }

  return { render, POSTS };
})();

if (typeof window !== 'undefined') { window.BlogPage = BlogPage; if (window.PH) window.PH.BlogPage = BlogPage; }



/* ===== js/pages/error.js ===== */
/**
 * PuzzleHub — Elite empty / error / 404 surfaces
 */
const ErrorPage = (() => {
  function render404() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    document.title = 'Page not found — PuzzleHub';

    const page = Utils.el('div', { className: 'page-enter elite-state' });
    page.appendChild(Utils.el('div', { className: 'elite-state__orb', 'aria-hidden': 'true' }));
    page.appendChild(Utils.el('p', { className: 'elite-state__code', textContent: '404' }));
    page.appendChild(Utils.el('h1', { className: 'elite-state__title', textContent: 'This path doesn’t exist.' }));
    page.appendChild(Utils.el('p', {
      className: 'elite-state__desc',
      textContent: 'The page may have moved, or the link is incomplete. Head home and pick a puzzle.',
    }));
    page.appendChild(Utils.el('div', { className: 'elite-state__actions' }, [
      Utils.el('a', { className: 'btn btn-primary', href: '#/', textContent: 'Back to games' }),
      Utils.el('a', { className: 'btn btn-secondary', href: '#/how-to-play', textContent: 'How to play' }),
    ]));
    main.appendChild(page);
  }

  return { render404 };
})();

if (typeof window !== 'undefined') { window.ErrorPage = ErrorPage; if (window.PH) window.PH.ErrorPage = ErrorPage; }



/* ===== js/pages/privacy.js ===== */
/**
 * PuzzleHub — Privacy Policy (Required for AdSense + GDPR compliance)
 */
const PrivacyPage = (() => {
  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    if (typeof SEO !== 'undefined') SEO.apply('/privacy-policy');
    document.title = 'Privacy Policy — PuzzleHub';

    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container content-narrow' });

    container.appendChild(Utils.el('header', { className: 'content-hero' }, [
      Utils.el('p', { className: 'content-kicker', textContent: 'Legal' }),
      Utils.el('h1', { textContent: 'Privacy Policy' }),
      Utils.el('p', { className: 'content-lead', textContent: 'Last updated: July 15, 2026. Your privacy matters to us. This policy explains what data PuzzleHub collects and how we use it.' }),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '1. Overview' }),
      Utils.el('p', { textContent: 'PuzzleHub ("we", "our", "us") operates the website at https://puzzle-hub.netlify.app/. This Privacy Policy explains how we collect, use, and protect your information when you use our free online puzzle games.' }),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '2. Information We Collect' }),
      Utils.el('h3', { textContent: '2.1 Local Data (stored on your device only)' }),
      Utils.el('ul', { className: 'content-list' }, [
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Game progress: ' }), document.createTextNode('Saved game states, scores, and statistics stored in your browser\'s localStorage.')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Preferences: ' }), document.createTextNode('Theme settings, display name, and avatar choices.')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Achievements: ' }), document.createTextNode('Unlocked badges and milestone records.')]),
      ]),
      Utils.el('p', { textContent: 'This data never leaves your device unless you explicitly use cloud sync features.' }),
      Utils.el('h3', { textContent: '2.2 Automatically Collected Data' }),
      Utils.el('ul', { className: 'content-list' }, [
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Usage analytics: ' }), document.createTextNode('Anonymous page views and game interactions to improve the product.')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Cookies: ' }), document.createTextNode('We use cookies for Google AdSense advertising and basic analytics.')]),
      ]),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '3. Third-Party Services' }),
      Utils.el('h3', { textContent: '3.1 Google AdSense' }),
      Utils.el('p', {}, [document.createTextNode('We use Google AdSense to display advertisements. Google may use cookies to personalize ads based on your browsing history. You can opt out of personalized advertising by visiting '), Utils.el('a', { href: 'https://www.google.com/settings/ads', target: '_blank', rel: 'noopener noreferrer', textContent: 'Google Ads Settings' }), document.createTextNode('.')]),
      Utils.el('h3', { textContent: '3.2 Google Fonts' }),
      Utils.el('p', {}, [document.createTextNode('We load fonts from Google Fonts CDN. Google may collect your IP address when loading font files. See '), Utils.el('a', { href: 'https://policies.google.com/privacy', target: '_blank', rel: 'noopener noreferrer', textContent: 'Google Privacy Policy' }), document.createTextNode('.')]),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '4. Your Rights (GDPR / CCPA)' }),
      Utils.el('ul', { className: 'content-list' }, [
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Right to access: ' }), document.createTextNode('All your data is stored locally. You can view it in your browser\'s Developer Tools.')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Right to delete: ' }), document.createTextNode('Use the "Reset All Data" button in your Profile page to permanently erase all local data.')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Right to opt out: ' }), document.createTextNode('You can disable cookies in your browser settings or use an ad blocker.')]),
      ]),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '5. Children\'s Privacy' }),
      Utils.el('p', { textContent: 'PuzzleHub is a general audience website. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, please contact us.' }),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '6. Changes to This Policy' }),
      Utils.el('p', { textContent: 'We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date. Continued use of the site constitutes acceptance of the updated policy.' }),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: '7. Contact Us' }),
      Utils.el('p', {}, [document.createTextNode('If you have questions about this Privacy Policy, please visit our '), Utils.el('a', { href: '#/contact', textContent: 'Contact page' }), document.createTextNode('.')]),
    ]));

    container.appendChild(Utils.el('footer', { className: 'content-footer' }, [
      Utils.el('a', { className: 'btn btn-primary', href: '#/', textContent: 'Play games' }),
      Utils.el('a', { className: 'btn btn-secondary', href: '#/contact', textContent: 'Contact us' }),
    ]));

    page.appendChild(container);
    main.appendChild(page);
    if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
  }

  return { render };
})();
if (typeof window !== 'undefined') { window.PrivacyPage = PrivacyPage; }



/* ===== js/pages/contact.js ===== */
/**
 * PuzzleHub — Contact Page (Required for AdSense approval)
 */
const ContactPage = (() => {
  function render() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    if (typeof SEO !== 'undefined') SEO.apply('/contact');
    document.title = 'Contact Us — PuzzleHub';

    const page = Utils.el('div', { className: 'page-enter content-page' });
    const container = Utils.el('div', { className: 'container content-narrow' });

    container.appendChild(Utils.el('header', { className: 'content-hero' }, [
      Utils.el('p', { className: 'content-kicker', textContent: 'Get in touch' }),
      Utils.el('h1', { textContent: 'Contact Us' }),
      Utils.el('p', { className: 'content-lead', textContent: 'Have a question, feedback, or bug report? We\'d love to hear from you.' }),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: 'Send Us a Message' }),
      Utils.el('p', { textContent: 'Fill out the form below and we\'ll get back to you as soon as possible.' }),
    ]));

    const form = Utils.el('form', {
      style: 'max-width:480px',
      onSubmit: (e) => {
        e.preventDefault();
        if (typeof Toast !== 'undefined') {
          Toast.show({ type: 'success', title: 'Message sent!', message: 'Thanks for reaching out. We\'ll respond within 48 hours.' });
        }
        e.target.reset();
      },
    });

    const nameField = Utils.el('div', { style: 'margin-bottom:16px' }, [
      Utils.el('label', { style: 'display:block;font-weight:600;font-size:14px;margin-bottom:6px', textContent: 'Your Name' }),
      Utils.el('input', { type: 'text', required: 'required', placeholder: 'Enter your name', 'aria-label': 'Your name', autocomplete: 'name' }),
    ]);

    const emailField = Utils.el('div', { style: 'margin-bottom:16px' }, [
      Utils.el('label', { style: 'display:block;font-weight:600;font-size:14px;margin-bottom:6px', textContent: 'Email Address' }),
      Utils.el('input', { type: 'email', required: 'required', placeholder: 'you@example.com', 'aria-label': 'Email address', autocomplete: 'email' }),
    ]);

    const subjectField = Utils.el('div', { style: 'margin-bottom:16px' }, [
      Utils.el('label', { style: 'display:block;font-weight:600;font-size:14px;margin-bottom:6px', textContent: 'Subject' }),
      Utils.el('select', { 'aria-label': 'Subject' }, [
        Utils.el('option', { value: 'general', textContent: 'General Inquiry' }),
        Utils.el('option', { value: 'bug', textContent: 'Bug Report' }),
        Utils.el('option', { value: 'feature', textContent: 'Feature Request' }),
        Utils.el('option', { value: 'ads', textContent: 'Advertising' }),
        Utils.el('option', { value: 'privacy', textContent: 'Privacy Concern' }),
      ]),
    ]);

    const messageField = Utils.el('div', { style: 'margin-bottom:16px' }, [
      Utils.el('label', { style: 'display:block;font-weight:600;font-size:14px;margin-bottom:6px', textContent: 'Message' }),
      Utils.el('textarea', { required: 'required', rows: '5', placeholder: 'Tell us what\'s on your mind...', 'aria-label': 'Your message', style: 'width:100%;min-height:120px;padding:10px 14px;border:1px solid var(--border-default);border-radius:var(--radius-lg);background:var(--bg-elevated);font-family:inherit;font-size:15px;resize:vertical' }),
    ]);

    const submitBtn = Utils.el('button', { className: 'btn btn-primary btn-lg', type: 'submit', textContent: 'Send Message' });

    form.appendChild(nameField);
    form.appendChild(emailField);
    form.appendChild(subjectField);
    form.appendChild(messageField);
    form.appendChild(submitBtn);
    container.appendChild(form);

    container.appendChild(Utils.el('section', { className: 'content-section', style: 'margin-top:48px' }, [
      Utils.el('h2', { textContent: 'Other Ways to Reach Us' }),
      Utils.el('ul', { className: 'content-list' }, [
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Email: ' }), document.createTextNode('hello@puzzle-hub.netlify.app')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Response time: ' }), document.createTextNode('We aim to respond within 48 hours.')]),
        Utils.el('li', {}, [Utils.el('strong', { textContent: 'Social media: ' }), document.createTextNode('Follow us for updates and announcements.')]),
      ]),
    ]));

    container.appendChild(Utils.el('section', { className: 'content-section' }, [
      Utils.el('h2', { textContent: 'Frequently Asked Questions' }),
      Utils.el('h3', { textContent: 'Do I need an account to play?' }),
      Utils.el('p', { textContent: 'No! PuzzleHub is completely free and requires no sign-up. Just open the site and start playing.' }),
      Utils.el('h3', { textContent: 'Can I play offline?' }),
      Utils.el('p', { textContent: 'Yes! Install PuzzleHub as a Progressive Web App (PWA) from your browser to play offline.' }),
      Utils.el('h3', { textContent: 'Is my data safe?' }),
      Utils.el('p', {}, [document.createTextNode('Absolutely. All game data is stored locally on your device. Read our '), Utils.el('a', { href: '#/privacy-policy', textContent: 'Privacy Policy' }), document.createTextNode(' for details.')]),
    ]));

    container.appendChild(Utils.el('footer', { className: 'content-footer' }, [
      Utils.el('a', { className: 'btn btn-primary', href: '#/', textContent: 'Play games' }),
      Utils.el('a', { className: 'btn btn-secondary', href: '#/privacy-policy', textContent: 'Privacy Policy' }),
    ]));

    page.appendChild(container);
    main.appendChild(page);
    if (typeof appendSiteFooter === 'function') appendSiteFooter(main);
  }

  return { render };
})();
if (typeof window !== 'undefined') { window.ContactPage = ContactPage; }



/* ===== js/core/bootstrap.js ===== */
/**
 * PuzzleHub — Application Bootstrap (enterprise)
 * Ordered init, feature flags, error boundary, idle work.
 */
(function () {
  'use strict';

  function need(name) {
    const v = window[name];
    if (v == null) throw new Error('Missing dependency: ' + name);
    return v;
  }

  function buildShell() {
    const Utils = need('Utils');
    const Theme = need('Theme');
    const I18n = need('I18n');
    const SettingsUI = need('SettingsUI');
    const Analytics = need('Analytics');
    const Events = need('Events');
    const AudioEngine = need('AudioEngine');

    const app = document.getElementById('app');
    if (!app) throw new Error('#app element not found');
    app.innerHTML = '';

    app.appendChild(Utils.el('a', {
      className: 'skip-link',
      href: '#main-content',
      textContent: 'Skip to content',
    }));

    app.appendChild(Utils.el('div', {
      id: 'aria-status',
      className: 'sr-only',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }));

    const header = Utils.el('header', { className: 'app-header', role: 'banner' });
    const inner = Utils.el('div', { className: 'app-header__inner' });

    const logoMark = Utils.el('div', {
      className: 'app-logo__mark brand-mark',
      'aria-hidden': 'true',
      innerHTML:
        '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M7.2 4h5.1c2.55 0 4.4 1.7 4.4 4.05S14.85 12.1 12.3 12.1H7.2V4z" fill="#fff" fill-opacity="0.96"/>' +
        '<path d="M7.2 12.9h5.8c2.55 0 4.4 1.65 4.4 4.05S15.55 21 13 21H7.2v-8.1z" fill="#fff" fill-opacity="0.82"/>' +
        '<circle cx="17.6" cy="8.05" r="1.65" fill="#fff" fill-opacity="0.96"/>' +
        '<circle cx="18.35" cy="16.95" r="1.65" fill="#fff" fill-opacity="0.82"/>' +
        '</svg>',
    });
    const logoText = Utils.el('div', { className: 'app-logo__text' }, [
      Utils.el('span', { className: 'app-logo__name brand-wordmark', textContent: 'PuzzleHub' }),
      Utils.el('span', { className: 'app-logo__tag', textContent: 'Lumen' }),
    ]);
    inner.appendChild(Utils.el('a', {
      className: 'app-logo',
      href: '#/',
      'aria-label': 'PuzzleHub Home',
    }, [logoMark, logoText]));

    const nav = Utils.el('nav', {
      className: 'app-nav',
      id: 'main-nav',
      'aria-label': 'Primary',
    }, [
      Utils.el('a', { className: 'app-nav__link', href: '#/', textContent: I18n.t('nav.games') }),
      Utils.el('a', { className: 'app-nav__link', href: '#/leaderboard', textContent: 'Rankings' }),
      Utils.el('a', { className: 'app-nav__link', href: '#/community', textContent: 'Community' }),
      Utils.el('a', { className: 'app-nav__link', href: '#/blog', textContent: 'Blog' }),
      Utils.el('a', { className: 'app-nav__link app-nav__link--more', href: '#/how-to-play', textContent: I18n.t('nav.guides') }),
      Utils.el('a', { className: 'app-nav__link app-nav__link--more', href: '#/about', textContent: I18n.t('nav.about') }),
    ]);
    inner.appendChild(nav);

    const actions = Utils.el('div', { className: 'app-header__actions' });
    const ICON = 24;

    const headerSearch = Utils.el('div', { className: 'header-search' });
    headerSearch.appendChild(Utils.el('span', {
      'aria-hidden': 'true',
      innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.25" stroke="currentColor" stroke-width="1.75"/><path d="M16.2 16.2L20.5 20.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
    }));
    const hsInput = Utils.el('input', {
      type: 'search',
      placeholder: 'Search games',
      'aria-label': 'Search games',
      onFocus: function () {
        if (Router.getCurrent() !== '/') Router.navigate('/');
        setTimeout(function () {
          const el = document.querySelector('#games-section input[type="search"]');
          if (el) {
            el.focus();
            el.value = hsInput.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 80);
      },
      onInput: function () {
        const el = document.querySelector('#games-section input[type="search"]');
        if (el) {
          el.value = hsInput.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
    });
    headerSearch.appendChild(hsInput);
    actions.appendChild(headerSearch);

    const themeBtn = Utils.el('button', {
      className: 'btn btn-ghost btn-icon',
      'aria-label': 'Toggle color theme',
      'data-tooltip': 'Theme',
      type: 'button',
      innerHTML: Utils.icon(Theme.getResolved() === 'dark' ? 'sun' : 'moon', ICON),
      onClick: function () {
        Theme.toggle();
        themeBtn.innerHTML = Utils.icon(Theme.getResolved() === 'dark' ? 'sun' : 'moon', ICON);
        AudioEngine.play('click');
        Analytics.track('theme_toggle', { theme: Theme.getResolved() });
      },
    });
    actions.appendChild(themeBtn);

    const profile = Storage.getProfile();
    const userWrap = Utils.el('div', { style: 'position:relative' });
    const userBtn = Utils.el('button', {
      className: 'user-chip',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Account menu',
    }, [
      Utils.el('span', { className: 'user-chip__avatar', textContent: profile.avatar || '🧩' }),
      Utils.el('span', { className: 'user-chip__name', textContent: profile.name || 'Player' }),
      Utils.el('span', {
        className: 'user-chip__caret',
        'aria-hidden': 'true',
        innerHTML: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      }),
    ]);
    let userMenu = null;
    function closeUserMenu() {
      if (userMenu) {
        userMenu.remove();
        userMenu = null;
      }
      userBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) {
      if (userWrap.contains(e.target)) return;
      closeUserMenu();
    }
    function openUserMenu() {
      if (userMenu) {
        closeUserMenu();
        return;
      }
      userMenu = Utils.el('div', { className: 'dropdown', role: 'menu' }, [
        Utils.el('button', {
          className: 'dropdown__item', type: 'button', role: 'menuitem', textContent: 'Profile',
          onClick: function () { closeUserMenu(); Router.navigate('/profile'); },
        }),
        Utils.el('button', {
          className: 'dropdown__item', type: 'button', role: 'menuitem', textContent: 'Settings',
          onClick: function () { closeUserMenu(); SettingsUI.open(); },
        }),
        Utils.el('div', { className: 'dropdown__sep', role: 'separator' }),
        Utils.el('button', {
          className: 'dropdown__item', type: 'button', role: 'menuitem', textContent: 'Rankings',
          onClick: function () { closeUserMenu(); Router.navigate('/leaderboard'); },
        }),
        Utils.el('button', {
          className: 'dropdown__item', type: 'button', role: 'menuitem', textContent: 'Community',
          onClick: function () { closeUserMenu(); Router.navigate('/community'); },
        }),
        Utils.el('div', { className: 'dropdown__sep', role: 'separator' }),
        Utils.el('button', {
          className: 'dropdown__item', type: 'button', role: 'menuitem',
          textContent: (window.Cloud && Cloud.isSignedIn()) ? 'Switch account' : 'Sign in',
          onClick: function () {
            closeUserMenu();
            if (window.HomePage && HomePage.openAuth) HomePage.openAuth();
            else SettingsUI.open();
          },
        }),
      ]);
      userWrap.appendChild(userMenu);
      userBtn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
      AudioEngine.play('click');
    }
    userBtn.addEventListener('click', openUserMenu);
    userWrap.appendChild(userBtn);
    actions.appendChild(userWrap);

    const menuBtn = Utils.el('button', {
      className: 'btn btn-ghost btn-icon menu-toggle',
      'aria-label': 'Open menu',
      'aria-expanded': 'false',
      'aria-controls': 'main-nav',
      type: 'button',
      innerHTML: Utils.icon('menu', ICON),
      onClick: function () {
        const open = nav.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      },
    });
    actions.appendChild(menuBtn);

    nav.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) {
        nav.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });

    inner.appendChild(actions);
    header.appendChild(inner);
    app.appendChild(header);

    app.appendChild(Utils.el('main', {
      id: 'main-content',
      tabindex: '-1',
    }));

    app.appendChild(Utils.el('div', {
      id: 'toast-container',
      className: 'toast-container',
      'aria-live': 'polite',
    }));

    app.appendChild(Utils.el('canvas', {
      id: 'confetti-canvas',
      'aria-hidden': 'true',
    }));

    Events.on('theme:change', function (data) {
      themeBtn.innerHTML = Utils.icon(data.resolved === 'dark' ? 'sun' : 'moon', ICON);
    });
  }

  // Lazy-load secondary content pages on first navigation. These pages share
  // appendSiteFooter and only use window-exported globals, so they load safely
  // as a separate chunk — keeping the render-critical main bundle lean.
  const SECONDARY_SRC = 'js/pages-secondary.min.js';
  let secondaryLoaded = false;
  function ensureSecondary() {
    if (secondaryLoaded) return Promise.resolve();
    const perf = window.Perf;
    if (perf && perf.loadScript) {
      return perf.loadScript(SECONDARY_SRC).then(() => { secondaryLoaded = true; });
    }
    secondaryLoaded = true;
    return Promise.resolve();
  }
  function lazyPage(globalName) {
    return async function (params) {
      await ensureSecondary();
      const Page = window[globalName];
      if (Page && typeof Page.render === 'function') return Page.render(params);
    };
  }

  function registerRoutes() {
    const Router = need('Router');
    need('HomePage');   // home: first paint
    need('ProfilePage'); // common first nav (header avatar)
    need('GamePage');   // game cards
    // Secondary content pages load on demand:
    Router.register('/', window.HomePage.render);
    Router.register('/profile', window.ProfilePage.render);
    Router.register('/game/:id', window.GamePage.render);
    Router.register('/about', lazyPage('AboutPage'));
    Router.register('/how-to-play', lazyPage('HowToPage'));
    Router.register('/leaderboard', lazyPage('LeaderboardPage'));
    Router.register('/community', lazyPage('CommunityPage'));
    Router.register('/blog', lazyPage('BlogPage'));
    Router.register('/blog/:id', lazyPage('BlogPage'));
    Router.register('/privacy-policy', lazyPage('PrivacyPage'));
    Router.register('/contact', lazyPage('ContactPage'));
  }

  function registerSW() {
    if (typeof Config !== 'undefined' && !Config.isFeature('pwa')) return;
    try {
      if (!navigator.serviceWorker || typeof navigator.serviceWorker.register !== 'function') return;
    } catch (e) {
      return;
    }
    const delay = (typeof Config !== 'undefined' && Config.get('performance.swRegisterIdleMs')) || 2500;
    const run = function () {
      try {
        navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
      } catch (e) { /* ignore */ }
    };
    if (window.Perf && window.Perf.idle) window.Perf.idle(run, delay);
    else setTimeout(run, delay);
  }

  function wireSEO() {
    const Events = need('Events');
    const SEO = need('SEO');
    Events.on('route:change', function (data) {
      try {
        SEO.apply(data.path, data.params || {});
      } catch (e) {
        if (window.Logger) Logger.warn('SEO.apply failed', { err: String(e && e.message) });
      }
      const status = document.getElementById('aria-status');
      if (status) {
        status.textContent = 'Navigated to ' + (document.title.split('—')[0] || '').trim();
      }
      const nav = document.getElementById('main-nav');
      if (nav) nav.classList.remove('open');
    });
  }

  function initPlatformServices() {
    need('Storage');
    need('Events');
    need('Utils');
    need('I18n');
    need('Theme');
    need('AudioEngine');
    need('Router');
    need('Analytics');

    if (window.ErrorBoundary) ErrorBoundary.install();
    if (window.GameRegistry) GameRegistry.initBuiltins();

    if (window.Perf && window.Perf.mark) window.Perf.mark('init_start');

    window.I18n.init();
    window.Theme.init();
    window.AudioEngine.init();
    if (typeof Config === 'undefined' || Config.isFeature('analytics')) {
      window.Analytics.init();
    }
    if (window.Cloud) window.Cloud.loadSession();
    if (window.Sync && (typeof Config === 'undefined' || Config.isFeature('offlineSync'))) {
      window.Sync.init();
    }
    if (window.Voice && (typeof Config === 'undefined' || Config.isFeature('voice'))) {
      window.Voice.init();
    }
    if (window.Rewards) window.Rewards.applyActive();
  }

  function init() {
    try {
      initPlatformServices();
      buildShell();
      registerRoutes();
      wireSEO();
      window.Router.init();
      registerSW();

      if (window.InstallPrompt && window.InstallPrompt.init) {
        window.InstallPrompt.init();
      }

      const prefetchMs =
        (typeof Config !== 'undefined' && Config.get('performance.gamePrefetchIdleMs')) || 3500;
      if (window.Perf && window.Perf.idle && window.GameRegistry) {
        window.Perf.idle(function () {
          GameRegistry.prefetch(['sudoku', 'memory', '2048']);
        }, prefetchMs);
      }

      if (window.Perf && window.Perf.mark) {
        window.Perf.mark('init_end');
        window.Perf.measure('bootstrap', 'init_start');
      }

      document.addEventListener('keydown', function (e) {
        if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
        const path = window.Router.getCurrent();
        if (e.key === ',' && (path === '/' || path === '/profile' || path === '/about' || path === '/how-to-play')) {
          window.SettingsUI.open();
        }
        if (e.key === 'Escape') {
          const nav = document.getElementById('main-nav');
          if (nav) nav.classList.remove('open');
        }
      });

      window.addEventListener('offline', function () {
        if (window.Toast) {
          window.Toast.show({
            type: 'warning',
            title: 'Offline',
            message: window.I18n.t('toast.offline'),
          });
        }
      });
      window.addEventListener('online', function () {
        if (window.Toast) {
          window.Toast.show({
            type: 'success',
            title: 'Back online',
            message: window.I18n.t('toast.online'),
          });
        }
        if (window.Sync && Sync.flush) Sync.flush();
      });

      if (window.Logger) {
        Logger.info('app_ready', {
          version: (window.Config && Config.get('version')) || (window.PH && PH.version),
        });
      }
    } catch (err) {
      if (window.ErrorBoundary) ErrorBoundary.showFatal(err);
    }
  }

  // Prefer bootstrap.js as entry; keep app.js as thin alias for bundle order
  window.PHBootstrap = { init: init, buildShell: buildShell };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();



/* ===== js/app.js ===== */
/**
 * PuzzleHub — App entry (thin)
 * Full bootstrap lives in js/core/bootstrap.js for maintainability.
 * This file remains for historical bundle order / dual-entry safety.
 */
(function () {
  'use strict';
  // If bootstrap already scheduled init, do nothing.
  if (window.PHBootstrap && window.__PH_BOOTED) return;
  // When bootstrap.js is present and loaded first, it owns init.
  // Fallback: if only app.js is present (legacy), load minimal fatal UI.
  if (!window.PHBootstrap) {
    console.warn('[PH] bootstrap.js missing — ensure enterprise entry order');
  }
})();

/* ===== Google AdSense Integration ===== */
/**
 * AdSense Horizontal Ad Integration
 * Shows ads at strategic locations for maximum visibility
 */
(function() {
  'use strict';

  // Wait for DOM to be ready
  function initAdSense() {
    const adContainer = document.getElementById('adsense-advertisement');
    if (!adContainer) return;

    // Show the ad container
    adContainer.style.display = 'block';
    adContainer.classList.add('ad-loaded');

    // Push the ad (silently — avoids console errors when ad blockers are present)
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch (_err) {
      // Hide container if ad fails to load
      adContainer.classList.remove('ad-loaded');
      adContainer.style.display = 'none';
    }
  }

  // Initialize after page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Wait a bit for the app to render
      setTimeout(initAdSense, 1000);
    });
  } else {
    setTimeout(initAdSense, 1000);
  }

  // Also re-initialize on route changes (SPA navigation)
  window.addEventListener('hashchange', function() {
    setTimeout(initAdSense, 500);
  });
})();

