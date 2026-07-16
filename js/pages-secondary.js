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
