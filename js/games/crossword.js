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
