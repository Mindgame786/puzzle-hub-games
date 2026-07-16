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
