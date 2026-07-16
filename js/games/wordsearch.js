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
