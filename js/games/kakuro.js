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
