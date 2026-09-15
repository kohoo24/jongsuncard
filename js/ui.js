/*
 * ui.js - 화면 렌더링 & 게임 루프
 */
(function (global) {
  const H = global.Holdem;
  const $ = function (id) { return document.getElementById(id); };

  const HERO_ID = 0;

  const SEAT_POS = {
    2: [[50, 86], [50, 16]],
    3: [[50, 86], [12, 34], [88, 34]],
    4: [[50, 86], [9, 52], [50, 16], [91, 52]],
    5: [[50, 86], [7, 56], [24, 18], [76, 18], [93, 56]],
    6: [[50, 86], [7, 58], [16, 22], [50, 15], [84, 22], [93, 58]]
  };

  const state = {
    game: null,
    opts: null,
    seatEls: {},
    seatOrder: [],
    communityRendered: 0,
    timer: null,
    heroEquity: null,
    equityToken: 0,
    sound: true
  };

  /* ---------------- 사운드 ---------------- */
  let audioCtx = null;
  function beep(freq, dur, vol) {
    if (!state.sound) return;
    try {
      if (!audioCtx) audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.09));
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + (dur || 0.09) + 0.02);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  const SFX = {
    card: function () { beep(880, 0.05, 0.03); },
    chip: function () { beep(520, 0.07, 0.04); },
    raise: function () { beep(680, 0.11, 0.05); },
    fold: function () { beep(220, 0.10, 0.035); },
    win: function () { beep(660, 0.12, 0.06); setTimeout(function () { beep(880, 0.16, 0.06); }, 110); }
  };

  /* ---------------- 카드 렌더 ---------------- */
  function cardEl(card, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (opts.small ? ' small' : '');
    if (!card) {
      el.classList.add('back');
      return el;
    }
    if (H.cards.isRed(card)) el.classList.add('red');
    const r = document.createElement('div');
    r.className = 'r';
    r.textContent = H.cards.RANK_LABEL[card.rank];
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = H.cards.SUIT_LABEL[card.suit];
    el.appendChild(r);
    el.appendChild(s);
    return el;
  }

  function cardsSignature(cards, hidden) {
    if (!cards.length) return 'none';
    if (hidden) return 'back:' + cards.length;
    return cards.map(H.cards.cardToString).join(',');
  }

  /* ---------------- 좌석 ---------------- */
  function buildSeats() {
    const g = state.game;
    const wrap = $('seats');
    wrap.innerHTML = '';
    state.seatEls = {};

    const n = g.players.length;
    const pos = SEAT_POS[n] || SEAT_POS[6];

    // 히어로를 0번 좌석(하단)에 두고 시계방향으로 배치
    const heroIdx = g.players.findIndex(function (p) { return p.isHuman; });
    const order = [];
    for (let i = 0; i < n; i++) order.push(g.players[(heroIdx + i + n) % n]);
    state.seatOrder = order;

    const narrow = global.innerWidth < 720;
    order.forEach(function (p, i) {
      const seat = document.createElement('div');
      const xy = pos[i] || [50, 50];
      const x = narrow ? 50 + (xy[0] - 50) * 0.74 : xy[0];
      seat.className = 'seat ' + (xy[1] > 50 ? 'bottom' : 'top');
      seat.style.left = x + '%';
      seat.style.top = xy[1] + '%';

      const cards = document.createElement('div');
      cards.className = 'cards';

      const plate = document.createElement('div');
      plate.className = 'plate';
      const name = document.createElement('div');
      name.className = 'name';
      const chips = document.createElement('div');
      chips.className = 'chips';
      const last = document.createElement('div');
      last.className = 'last';
      plate.appendChild(name);
      plate.appendChild(chips);
      plate.appendChild(last);

      const bet = document.createElement('div');
      bet.className = 'bet hidden';
      const badge = document.createElement('div');
      badge.className = 'badge hidden';
      badge.textContent = 'D';

      seat.appendChild(cards);
      seat.appendChild(plate);
      seat.appendChild(bet);
      seat.appendChild(badge);
      wrap.appendChild(seat);

      state.seatEls[p.id] = {
        root: seat, cards: cards, name: name, chips: chips,
        last: last, bet: bet, badge: badge, sig: ''
      };
    });
  }

  function updateSeats() {
    const g = state.game;
    const actor = g.currentActor();

    g.players.forEach(function (p) {
      const el = state.seatEls[p.id];
      if (!el) return;

      const tag = p.isHuman ? '플레이어' : (p.profile ? p.profile.name : 'AI');
      el.name.innerHTML = escapeHtml(p.name) + ' <span class="tag">' + tag + '</span>';
      el.chips.textContent = p.chips.toLocaleString();
      el.last.innerHTML = p.allIn && !p.folded
        ? '<span class="allin">ALL IN</span>'
        : escapeHtml(p.lastAction || '');

      el.root.classList.toggle('turn', actor === p && g.phase === 'awaiting-action');
      el.root.classList.toggle('folded', p.folded);
      el.root.classList.toggle('winner', g.phase === 'hand-over' && p.won > 0);

      if (p.bet > 0) {
        el.bet.textContent = p.bet.toLocaleString();
        el.bet.classList.remove('hidden');
      } else {
        el.bet.classList.add('hidden');
      }

      const isButton = g.players.indexOf(p) === g.button;
      el.badge.classList.toggle('hidden', !isButton);

      const hidden = !p.isHuman && !g.revealAll;
      const showCards = p.cards.length > 0 && (!p.folded || p.isHuman);
      const sig = showCards ? cardsSignature(p.cards, hidden) + (p.folded ? ':f' : '') : 'empty';
      if (sig !== el.sig) {
        el.sig = sig;
        el.cards.innerHTML = '';
        if (showCards) {
          p.cards.forEach(function (c) {
            const ce = cardEl(hidden ? null : c, { small: !p.isHuman });
            if (p.folded) ce.classList.add('dim');
            el.cards.appendChild(ce);
          });
        }
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ---------------- 보드 / 상단 ---------------- */
  function updateBoard() {
    const g = state.game;
    const wrap = $('community');
    if (g.community.length < state.communityRendered) {
      wrap.innerHTML = '';
      state.communityRendered = 0;
    }
    for (let i = state.communityRendered; i < g.community.length; i++) {
      wrap.appendChild(cardEl(g.community[i]));
      SFX.card();
    }
    state.communityRendered = g.community.length;

    $('potAmt').textContent = g.totalPot().toLocaleString();
    $('streetLabel').textContent = g.community.length ? (H.STREET_NAMES[g.street] || '') : '';
    $('handNo').textContent = '#' + g.handNo;
    $('blinds').textContent = g.smallBlind + ' / ' + g.bigBlind;
    const hero = g.byId(HERO_ID);
    $('heroChips').textContent = hero ? hero.chips.toLocaleString() : '0';
  }

  function renderLog() {
    const list = $('logList');
    const g = state.game;
    list.innerHTML = '';
    const items = g.log.slice(-160);
    items.forEach(function (e) {
      const d = document.createElement('div');
      d.className = 'l-' + e.kind;
      d.textContent = e.text;
      list.appendChild(d);
    });
    list.scrollTop = list.scrollHeight;
  }

  /* ---------------- 히어로 정보 ---------------- */
  function updateHeroReadout() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    const handEl = $('heroHand');
    const eqEl = $('heroEquity');

    if (!hero || !hero.cards.length || hero.folded) {
      handEl.textContent = hero && hero.folded ? '폴드' : '';
      eqEl.textContent = '';
      return;
    }
    if (g.community.length >= 3) {
      const res = H.eval.evaluate(hero.cards.concat(g.community));
      handEl.textContent = H.eval.describe(res);
    } else {
      const a = hero.cards[0], b = hero.cards[1];
      const L = H.cards.RANK_LABEL;
      const hi = a.rank >= b.rank ? a : b;
      const lo = a.rank >= b.rank ? b : a;
      handEl.textContent = hi.rank === lo.rank
        ? '포켓 페어 ' + L[hi.rank]
        : L[hi.rank] + L[lo.rank] + (a.suit === b.suit ? ' 수딧' : ' 오프수딧');
    }

    if (!state.opts.showEquity || g.phase === 'hand-over') {
      eqEl.textContent = '';
      return;
    }
    eqEl.textContent = state.heroEquity == null
      ? '승률 계산 중\u2026'
      : '예상 승률 ' + Math.round(state.heroEquity * 100) + '%';
  }

  function refreshEquity() {
    if (!state.opts.showEquity) { state.heroEquity = null; return; }
    const g = state.game;
    const hero = g.byId(HERO_ID);
    const opponents = g.activePlayers().length - 1;
    if (!hero || hero.folded || !hero.cards.length || opponents < 1) {
      state.heroEquity = null;
      return;
    }
    const token = ++state.equityToken;
    state.heroEquity = null;
    updateHeroReadout();
    // 계산이 UI를 막지 않도록 다음 틱에서 실행
    setTimeout(function () {
      if (token !== state.equityToken) return;
      const sims = g.community.length ? 400 : 300;
      state.heroEquity = H.ai.equity(hero.cards, g.community, opponents, sims);
      if (token === state.equityToken) updateHeroReadout();
    }, 0);
  }

  /* ---------------- 컨트롤 ---------------- */
  function hide(el, v) { el.classList.toggle('hidden', v); }

  function updateControls() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    const isHeroTurn = g.phase === 'awaiting-action' && g.currentActor() === hero;
    const handOver = g.phase === 'hand-over';

    hide($('btnRow'), !isHeroTurn);
    hide($('raiseRow'), !isHeroTurn);
    hide($('btnNext'), !handOver);
    hide($('waiting'), isHeroTurn || handOver);

    if (handOver) {
      showBanner();
    } else {
      $('resultBanner').classList.remove('show');
    }

    if (!isHeroTurn) {
      if (!handOver) {
        const actor = g.currentActor();
        $('waiting').textContent = actor
          ? actor.name + ' 님이 생각 중…'
          : (hero && hero.folded ? '이번 핸드는 폴드했습니다' : '카드를 여는 중…');
      }
      return;
    }

    const a = g.actionsFor(hero);
    $('btnCall').innerHTML = a.canCheck
      ? '체크 <kbd>C</kbd>'
      : '콜 ' + Math.min(a.toCall, hero.chips).toLocaleString() + ' <kbd>C</kbd>';
    $('btnFold').disabled = false;
    $('btnRaise').disabled = !a.canRaise;

    const slider = $('raiseSlider');
    if (a.canRaise) {
      slider.min = a.minRaiseTo;
      slider.max = a.maxRaiseTo;
      slider.step = Math.max(1, Math.round(g.bigBlind / 2));
      const cur = parseInt(slider.value, 10);
      if (!cur || cur < a.minRaiseTo || cur > a.maxRaiseTo) {
        const pot = g.totalPot();
        const target = Math.min(a.maxRaiseTo,
          Math.max(a.minRaiseTo, Math.round((g.currentBet + pot * 0.6) / g.bigBlind) * g.bigBlind));
        slider.value = target;
      }
      slider.disabled = false;
    } else {
      slider.disabled = true;
    }
    updateRaiseLabel();
  }

  function updateRaiseLabel() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero) return;
    const a = g.actionsFor(hero);
    const v = parseInt($('raiseSlider').value, 10) || a.minRaiseTo;
    const allIn = v >= a.maxRaiseTo;
    const verb = a.isBet ? '벳' : '레이즈';
    $('btnRaise').innerHTML = (allIn ? '올인 ' : verb + ' ') + v.toLocaleString() + ' <kbd>R</kbd>';
  }

  function showBanner() {
    const g = state.game;
    const banner = $('resultBanner');
    if (!g.results) return;
    const txt = g.results.winners.map(function (w) {
      return w.name + ' +' + w.amount.toLocaleString() + (w.desc ? ' · ' + w.desc : '');
    }).join('   |   ');
    banner.textContent = txt;
    banner.classList.add('show');
  }

  /* ---------------- 렌더 ---------------- */
  function render() {
    updateSeats();
    updateBoard();
    updateHeroReadout();
    updateControls();
    renderLog();
  }

  /* ---------------- 게임 루프 ---------------- */
  function clearTimer() {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  }

  function loop() {
    clearTimer();
    const g = state.game;
    const speed = state.opts.speed;

    if (g.phase === 'awaiting-action') {
      const actor = g.currentActor();
      if (actor && actor.isHuman) { render(); return; }
      render();
      state.timer = setTimeout(function () {
        const p = g.currentActor();
        if (!p || g.phase !== 'awaiting-action') { loop(); return; }
        const decision = H.ai.decide(g, p);
        if (decision.type === 'fold') SFX.fold();
        else if (decision.type === 'raise') SFX.raise();
        else if (decision.type === 'call') SFX.chip();
        const res = g.act(p.id, decision);
        if (!res.ok) g.act(p.id, { type: g.actionsFor(p).canCheck ? 'check' : 'fold' });
        render();
        loop();
      }, speed + Math.random() * speed * 0.5);
      return;
    }

    if (g.phase === 'need-street') {
      render();
      state.timer = setTimeout(function () {
        g.dealNextStreet();
        refreshEquity();
        render();
        loop();
      }, Math.max(450, speed * 0.9));
      return;
    }

    if (g.phase === 'showdown') {
      render();
      state.timer = setTimeout(function () {
        g.resolveShowdown();
        SFX.win();
        render();
        loop();
      }, Math.max(600, speed));
      return;
    }

    if (g.phase === 'hand-over') {
      state.heroEquity = null;
      state.equityToken++;
      render();
      const hero = g.byId(HERO_ID);
      if (!hero || hero.chips <= 0) {
        setTimeout(function () { gameOver(false); }, 1200);
      } else if (g.players.filter(function (p) { return p.chips > 0; }).length < 2) {
        setTimeout(function () { gameOver(true); }, 1200);
      }
      return;
    }

    if (g.phase === 'game-over') {
      const hero = g.byId(HERO_ID);
      gameOver(!!(hero && hero.chips > 0));
    }
  }

  function nextHand() {
    const g = state.game;
    if (g.phase !== 'hand-over') return;
    $('community').innerHTML = '';
    state.communityRendered = 0;
    g.startHand();
    if (g.phase === 'game-over') { loop(); return; }
    SFX.card();
    refreshEquity();
    render();
    loop();
  }

  function heroAct(action) {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero || g.phase !== 'awaiting-action' || g.currentActor() !== hero) return;
    if (action.type === 'fold') SFX.fold();
    else if (action.type === 'raise') SFX.raise();
    else SFX.chip();
    const res = g.act(hero.id, action);
    if (!res.ok) return;
    if (!hero.folded) refreshEquity();
    render();
    loop();
  }

  function gameOver(won) {
    clearTimer();
    const g = state.game;
    $('overTitle').textContent = won ? '🏆 우승!' : '게임 오버';
    $('overText').textContent = won
      ? '모든 상대의 칩을 획득했습니다. ' + g.handNo + '핸드 만에 테이블을 정리했네요.'
      : g.handNo + '핸드 만에 칩을 모두 잃었습니다. 다시 도전해 보세요.';
    $('overModal').classList.add('show');
  }

  /* ---------------- 시작 ---------------- */
  function startGame(opts) {
    clearTimer();
    state.opts = opts;
    state.heroEquity = null;
    state.equityToken++;
    state.communityRendered = 0;
    $('community').innerHTML = '';

    const g = new H.Game({
      smallBlind: opts.blind,
      bigBlind: opts.blind * 2,
      blindUpEvery: opts.blindUp
    });
    g.addPlayer({ id: HERO_ID, name: '나', chips: opts.chips, isHuman: true });

    const names = H.ai.NAMES.slice();
    H.cards.shuffle(names);
    const profiles = H.ai.PROFILES.slice();
    H.cards.shuffle(profiles);
    for (let i = 0; i < opts.bots; i++) {
      g.addPlayer({
        id: i + 1,
        name: names[i % names.length],
        chips: opts.chips,
        profile: profiles[i % profiles.length]
      });
    }

    state.game = g;
    buildSeats();
    g.startHand();
    SFX.card();
    refreshEquity();
    render();
    loop();
  }

  function readOpts() {
    return {
      bots: parseInt($('optBots').value, 10),
      chips: parseInt($('optChips').value, 10),
      blind: parseInt($('optBlinds').value, 10),
      blindUp: parseInt($('optBlindUp').value, 10),
      speed: parseInt($('optSpeed').value, 10),
      showEquity: $('optEquity').checked
    };
  }

  /* ---------------- 이벤트 바인딩 ---------------- */
  function bind() {
    $('btnStart').addEventListener('click', function () {
      $('setupModal').classList.remove('show');
      startGame(readOpts());
    });
    $('btnOverRestart').addEventListener('click', function () {
      $('overModal').classList.remove('show');
      $('setupModal').classList.add('show');
    });
    $('btnRestart').addEventListener('click', function () {
      clearTimer();
      $('setupModal').classList.add('show');
    });
    $('btnLogToggle').addEventListener('click', function () {
      $('logPanel').classList.toggle('hidden');
    });
    $('btnSound').addEventListener('click', function () {
      state.sound = !state.sound;
      $('btnSound').classList.toggle('off', !state.sound);
      $('btnSound').textContent = state.sound ? '🔊' : '🔇';
    });

    $('btnFold').addEventListener('click', function () { heroAct({ type: 'fold' }); });
    $('btnCall').addEventListener('click', function () {
      const g = state.game;
      const hero = g.byId(HERO_ID);
      heroAct({ type: g.actionsFor(hero).canCheck ? 'check' : 'call' });
    });
    $('btnRaise').addEventListener('click', function () {
      heroAct({ type: 'raise', amount: parseInt($('raiseSlider').value, 10) });
    });
    $('btnNext').addEventListener('click', nextHand);
    $('raiseSlider').addEventListener('input', updateRaiseLabel);

    document.querySelectorAll('.presets button').forEach(function (b) {
      b.addEventListener('click', function () {
        const g = state.game;
        const hero = g.byId(HERO_ID);
        if (!hero) return;
        const a = g.actionsFor(hero);
        const pct = b.dataset.pct;
        let v;
        if (pct === 'allin') v = a.maxRaiseTo;
        else {
          const pot = g.totalPot();
          v = Math.round((g.currentBet + a.toCall + pot * parseFloat(pct)) / g.bigBlind) * g.bigBlind;
        }
        v = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, v));
        $('raiseSlider').value = v;
        updateRaiseLabel();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if ($('setupModal').classList.contains('show')) {
        if (e.key === 'Enter') $('btnStart').click();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); $('btnFold').click(); }
      else if (k === 'c') { e.preventDefault(); $('btnCall').click(); }
      else if (k === 'r') { e.preventDefault(); if (!$('btnRaise').disabled) $('btnRaise').click(); }
      else if (e.key === ' ') {
        e.preventDefault();
        if (!$('btnNext').classList.contains('hidden')) nextHand();
      }
    });
  }

  let resizeTimer = null;
  global.addEventListener('resize', function () {
    if (!state.game) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      buildSeats();
      render();
    }, 200);
  });

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    // 좁은 화면에서는 기록 패널을 기본으로 접어 둔다
    if (global.innerWidth < 980) $('logPanel').classList.add('hidden');
    $('setupModal').classList.add('show');
  });

  global.HoldemUI = state;
})(typeof globalThis !== 'undefined' ? globalThis : this);
