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
