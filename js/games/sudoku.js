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
