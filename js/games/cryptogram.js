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
