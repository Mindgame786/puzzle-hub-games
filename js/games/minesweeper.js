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
