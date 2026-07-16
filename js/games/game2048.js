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
