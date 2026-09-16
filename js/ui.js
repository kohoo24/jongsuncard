/*
 * ui.js - 화면 렌더링과 게임 루프
 */
(function (global) {
  const H = global.Holdem;
  const T = function (k, p) { return H.i18n.t(k, p); };
  const $ = function (id) { return document.getElementById(id); };
  const HERO_ID = 0;

  const SEAT_POS = {
    2: [[50, 86], [50, 16]],
    3: [[50, 86], [14, 34], [86, 34]],
    4: [[50, 86], [11, 52], [50, 16], [89, 52]],
    5: [[50, 86], [10, 56], [25, 18], [75, 18], [90, 56]],
    6: [[50, 86], [10, 58], [18, 22], [50, 15], [82, 22], [90, 58]]
  };
  /* 좁은 화면에서는 측면 좌석의 카드가 커뮤니티 카드와 겹치므로 위아래로 더 벌린다 */
  const SEAT_POS_NARROW = {
    2: [[50, 88], [50, 14]],
    3: [[50, 88], [16, 26], [84, 26]],
    4: [[50, 88], [15, 62], [50, 13], [85, 62]],
    5: [[50, 88], [14, 64], [24, 14], [76, 14], [86, 64]],
    6: [[50, 88], [13, 66], [17, 20], [50, 11], [83, 20], [87, 66]]
  };

  const AVATARS = ['🦅', '🦊', '🐺', '🐱', '🐸', '🦉', '🐻', '🦌'];

  /*
   * 표정은 "방금 한 액션"에만 반응한다. 패의 강도에 반응하게 만들면 그게 곧 텔이 되어
   * 봇이 역으로 읽히고, 어렵게 올려놓은 실력이 무의미해진다.
   */
  const FACE = {
    turn: '🤔', fold: '😕', check: '😐', call: '🙂',
    raise: '😤', allin: '😎', won: '🤑'
  };

  function faceFor(game, p, isTurn) {
    if (game.phase === 'hand-over' && p.won > 0) return FACE.won;
    if (isTurn && !p.isHuman) return FACE.turn;
    if (p.folded) return FACE.fold;
    if (p.allIn) return FACE.allin;
    switch (p.lastActionKey) {
      case 'act.fold': return FACE.fold;
      case 'act.check': return FACE.check;
      case 'act.call': return FACE.call;
      case 'act.bet':
      case 'act.raise': return FACE.raise;
      case 'act.allin': return FACE.allin;
      default: return null;
    }
  }

  const state = {
    game: null, tracker: null, recorder: null, settings: null,
    seatEls: {}, communityRendered: 0, timer: null, clockTimer: null,
    heroInfo: null, drawInfo: null, reviewItems: [], lastSummary: null, handFinalized: false,
    seatPos: {}, dealOrder: {}, dealing: false, deckSig: '', deckAt: null,
    tab: 'log', chartState: { position: 'BTN', playerCount: 6, heroKey: null, userPicked: false },
    sound: true, winningCards: [], busy: false
  };
  global.HoldemUI = state;

  /* ==================== 사운드 ==================== */
  let audioCtx = null;
  function tone(freq, dur, vol, type) {
    if (!state.sound) return;
    try {
      if (!audioCtx) audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.09));
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + (dur || 0.09) + 0.02);
    } catch (e) { /* 오디오 미지원 */ }
  }
  const SFX = {
    card: function () { tone(900, 0.05, 0.028); },
    chip: function () { tone(520, 0.07, 0.04); },
    raise: function () { tone(680, 0.10, 0.05); setTimeout(function () { tone(820, 0.08, 0.04); }, 60); },
    fold: function () { tone(210, 0.10, 0.03); },
    check: function () { tone(400, 0.05, 0.025); },
    allin: function () { tone(520, 0.1, 0.06); setTimeout(function () { tone(700, 0.1, 0.06); }, 80); setTimeout(function () { tone(900, 0.16, 0.06); }, 160); },
    win: function () { tone(660, 0.12, 0.06); setTimeout(function () { tone(880, 0.18, 0.06); }, 110); },
    lose: function () { tone(300, 0.2, 0.04, 'sine'); },
    tick: function () { tone(1200, 0.03, 0.02); }
  };
  function buzz(ms) {
    try { if (global.navigator && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 무시 */ }
  }

  /* ==================== 카드 ==================== */
  function cardEl(card, opts) {
    opts = opts || {};
    const e = document.createElement('div');
    e.className = 'card' + (opts.small ? ' small' : '');
    if (!card) {
      e.appendChild(H.cardart.back());
      e.setAttribute('aria-label', T('card.back'));
      return e;
    }
    e.dataset.suit = card.suit;
    e.appendChild(H.cardart.face(card, {
      compact: !!opts.small,
      fourColor: !!(state.settings && state.settings.fourColor)
    }));
    e.setAttribute('role', 'listitem');
    e.setAttribute('aria-label',
      H.cards.RANK_LABEL[card.rank] + ' ' + T('suit.' + card.suit));
    return e;
  }

  function cardKey(c) { return c ? H.cards.cardToString(c) : ''; }
  function sig(cards, hidden) {
    if (!cards.length) return 'none';
    const fc = (state.settings && state.settings.fourColor) ? '4' : '2';
    return (hidden ? 'back:' : fc + ':') + cards.map(cardKey).join(',');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function num(v) { return Math.round(v).toLocaleString(); }

  /* ==================== 좌석 ==================== */
  function buildSeats() {
    const g = state.game;
    const wrap = $('seats');
    wrap.innerHTML = '';
    state.seatEls = {};
    const n = g.players.length;
    const narrow = global.innerWidth < 720;
    const table = narrow ? SEAT_POS_NARROW : SEAT_POS;
    const pos = table[n] || table[6];
    const heroIdx = g.players.findIndex(function (p) { return p.isHuman; });
    const order = [];
    for (let i = 0; i < n; i++) order.push(g.players[(heroIdx + i + n) % n]);
    state.seatOrder = order;
    document.getElementById('felt').classList.toggle('narrow', narrow);

    order.forEach(function (p, i) {
      const xy = pos[i] || [50, 50];
      const x = xy[0];
      const seat = document.createElement('div');
      seat.className = 'seat ' + (xy[1] > 50 ? 'bottom' : 'top');
      seat.style.left = x + '%';
      seat.style.top = xy[1] + '%';

      const cards = document.createElement('div');
      cards.className = 'cards';

      const plate = document.createElement('div');
      plate.className = 'plate';
      const ring = document.createElement('div');
      ring.className = 'clock-ring';
      const av = document.createElement('div');
      av.className = 'avatar';
      const base = p.isHuman ? '🙂' : AVATARS[(g.players.indexOf(p) * 3) % AVATARS.length];
      av.textContent = base;
      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name';
      const chips = document.createElement('div');
      chips.className = 'chips';
      const last = document.createElement('div');
      last.className = 'last';
      info.appendChild(name); info.appendChild(chips); info.appendChild(last);
      plate.appendChild(ring); plate.appendChild(av); plate.appendChild(info);

      const bet = document.createElement('div');
      bet.className = 'bet hidden';
      const badge = document.createElement('div');
      badge.className = 'badge hidden';
      badge.textContent = 'D';
      badge.title = T('table.dealerButton');
      const think = document.createElement('div');
      think.className = 'think hidden';

      seat.appendChild(cards); seat.appendChild(plate);
      seat.appendChild(bet); seat.appendChild(badge); seat.appendChild(think);
      wrap.appendChild(seat);

      state.seatPos[p.id] = { x: x, y: xy[1], idx: i };
      state.seatEls[p.id] = {
        root: seat, cards: cards, name: name, chips: chips, last: last,
        bet: bet, badge: badge, think: think, ring: ring, avatar: av,
        baseAvatar: base, sig: ''
      };
    });
    buildDeck();
    positionDeck(true);
  }

  /* ==================== 덱과 딜링 ==================== */
  function reducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function buildDeck() {
    const host = $('deckSpot');
    if (host.childElementCount) return;
    /* 살짝 어긋나게 겹친 카드 뒷면 세 장 */
    [[-2.5, -1.5], [1.5, -0.5], [0, 0]].forEach(function (o, i) {
      const c = document.createElement('div');
      c.className = 'deck-card';
      c.style.transform = 'translate(' + o[0] + 'px,' + o[1] + 'px) rotate(' + (i * 2 - 2) + 'deg)';
      c.appendChild(H.cardart.back());
      host.appendChild(c);
    });
  }

  /*
   * 덱 자리 찾기.
   *
   * 원하는 자리는 "버튼 좌석과 그 옆 좌석 사이" — 실제 딜러가 앉는 곳이다.
   * 다만 그 지점이 늘 비어 있지는 않다(헤즈업이면 정중앙, 3인이면 보드 위).
   * 그래서 테이블 둘레의 타원 고리를 각도 순으로 훑어, 원하는 각도에서
   * 가장 가까우면서 보드·팟·좌석과 겹치지 않는 자리를 고른다.
   */
  /*
   * 레이아웃상의 상자를 잰다. getBoundingClientRect 는 자기 자신에게 걸린 transform 을
   * 포함하므로, 딜링 중(카드가 덱에서 날아오는 중)에 재면 엉뚱한 자리가 나온다.
   * 형제들이 같은 offsetParent 를 공유하는 흐름 안의 자식이라면 offset* 으로 되짚을 수 있다.
   */
  function layoutRect(child, parent) {
    const pr = parent.getBoundingClientRect();
    let dx, dy;
    if (child.offsetParent === parent) {
      dx = child.offsetLeft; dy = child.offsetTop;
    } else if (child.offsetParent === parent.offsetParent) {
      dx = child.offsetLeft - parent.offsetLeft; dy = child.offsetTop - parent.offsetTop;
    } else {
      return child.getBoundingClientRect();
    }
    const w = child.offsetWidth, h = child.offsetHeight;
    return { left: pr.left + dx, top: pr.top + dy,
             right: pr.left + dx + w, bottom: pr.top + dy + h, width: w, height: h };
  }

  function rectsOverlap(a, b, margin) {
    const m = margin || 0;
    return !(a.right < b.left - m || a.left > b.right + m ||
             a.bottom < b.top - m || a.top > b.bottom + m);
  }

  function positionDeck(force) {
    const g = state.game;
    const host = $('deckSpot');
    if (!g || !g.players.length || !state.seatOrder) return;
    const fr = $('felt').getBoundingClientRect();
    if (!fr.width) return;

    /* 좁은 테이블에는 덱을 놓을 자리가 없다 — 그림은 숨기고 출발점으로만 쓴다 */
    const roomy = fr.width >= 420 && fr.height >= 280;

    /* 피해야 할 것: 실제로 보이는 보드/팟/스트리트 라벨, 그리고 좌석의 플레이트와 카드 */
    const avoid = [];
    /* 컨테이너가 아니라 자식(실제 보이는 카드/배지)을 재야 한다.
       보드와 팟 줄은 가로로 꽉 찬 flex 박스여서, 통째로 피하면 띠 전체가 막힌다. */
    ['community', 'pots'].forEach(function (id) {
      const e = $(id);
      if (!e) return;
      for (let i = 0; i < e.children.length; i++) {
        const r = layoutRect(e.children[i], e);
        if (r.width > 0 && r.height > 0) avoid.push({ r: r, m: 12 });
      }
    });
    /* 스트리트 라벨은 상자가 가로로 꽉 차 있다 — 글자가 실제로 차지하는 폭만 잰다 */
    const label = document.querySelector('.street-label');
    if (label && label.textContent) {
      const range = document.createRange();
      range.selectNodeContents(label);
      const lr = range.getBoundingClientRect();
      avoid.push({ r: lr.width ? lr : label.getBoundingClientRect(), m: 6 });
    }
    g.players.forEach(function (p) {
      const e = state.seatEls[p.id];
      if (!e) return;
      /* 좌석 전체 발자국 — 베팅 칩이 나타났다 사라져도 덱이 흔들리지 않게 통째로 피한다 */
      avoid.push({ r: e.root.getBoundingClientRect(), m: 2 });
      const plate = e.root.querySelector('.plate');
      if (plate) avoid.push({ r: plate.getBoundingClientRect(), m: 6 });
      if (e.cards.childElementCount) avoid.push({ r: e.cards.getBoundingClientRect(), m: 6 });
      /* 베팅 칩·딜러 버튼·생각 말풍선도 좌석 밖으로 튀어나온다 */
      [e.bet, e.badge, e.think].forEach(function (x) {
        if (x && !x.classList.contains('hidden')) avoid.push({ r: x.getBoundingClientRect(), m: 6 });
      });
    });

    const cx = fr.left + fr.width / 2, cy = fr.top + fr.height / 2;

    /* 원하는 각도: 버튼 좌석과 다음 좌석의 중간 지점 방향 */
    const btn = g.players[g.button];
    const a = btn && state.seatPos[btn.id];
    let wantX = 50, wantY = 70;
    if (a) {
      const n = state.seatOrder.length;
      const next = state.seatOrder[(a.idx + 1) % n];
      const b2 = next && state.seatPos[next.id];
      wantX = b2 ? (a.x + b2.x) / 2 : a.x;
      wantY = b2 ? (a.y + b2.y) / 2 : Math.min(90, a.y + 8);
    }
    const wantPx = fr.left + fr.width * wantX / 100;
    const wantPy = fr.top + fr.height * wantY / 100;
    const preferred = Math.atan2(wantPy - cy, wantPx - cx);

    function moveTo(px, py) {
      host.style.left = (((px - fr.left) / fr.width) * 100).toFixed(2) + '%';
      host.style.top = (((py - fr.top) / fr.height) * 100).toFixed(2) + '%';
      state.deckAt = { x: px, y: py };
    }
    /*
     * 후보 자리는 계산으로만 따진다.
     * 덱에는 left/top 트랜지션이 걸려 있어서, 옮긴 직후 getBoundingClientRect 를 읽으면
     * 아직 움직이는 중인 예전 자리가 나온다 (그래서 탐색이 엉뚱한 답을 냈다).
     */
    const dw = host.offsetWidth || 30, dh = host.offsetHeight || 42;
    function clearAt(px, py) {
      const d = { left: px - dw / 2, right: px + dw / 2, top: py - dh / 2, bottom: py + dh / 2 };
      if (d.left < fr.left + 6 || d.right > fr.right - 6 ||
          d.top < fr.top + 6 || d.bottom > fr.bottom - 6) return false;
      for (let i = 0; i < avoid.length; i++) {
        if (rectsOverlap(d, avoid[i].r, avoid[i].m)) return false;
      }
      return true;
    }

    /* 지금 자리가 아직 멀쩡하면 건드리지 않는다 (매 렌더마다 옮기면 덱이 떨린다) */
    if (!force && state.deckAt && !host.classList.contains('ghost') &&
        clearAt(state.deckAt.x, state.deckAt.y)) return;

    /* 고리를 각도 순으로 훑는다 (원하는 각도에서 가까운 쪽부터) */
    const RADII = [0.34, 0.30, 0.38, 0.26];
    let found = false;
    for (let ri = 0; ri < RADII.length && !found; ri++) {
      const rx = fr.width * RADII[ri], ry = fr.height * RADII[ri] * 0.98;
      for (let step = 0; step <= 18 && !found; step++) {
        const dirs = step === 0 ? [1] : [1, -1];
        for (let di = 0; di < dirs.length && !found; di++) {
          const ang = preferred + dirs[di] * step * (Math.PI / 18);
          const px = cx + Math.cos(ang) * rx, py = cy + Math.sin(ang) * ry;
          if (clearAt(px, py)) { moveTo(px, py); found = true; }
        }
      }
    }
    if (!found) moveTo(wantPx, wantPy);   // 못 찾으면 원래 자리 (숨겨질 것)
    host.classList.toggle('ghost', !roomy || !found);
  }

  /*
   * 덱 주변 상황(버튼 위치, 보드 장수, 팟 배지 수)이 바뀌었을 때만 자리를 다시 잡는다.
   * 매 렌더마다 돌리면 해가 미세하게 달라져 덱이 떨린다.
   */
  function ensureDeckClear() {
    const g = state.game;
    if (!g) return;
    const sig = g.button + ':' + g.community.length + ':' + $('pots').childElementCount +
      ':' + ($('streetLabel').textContent ? 1 : 0);
    const changed = sig !== state.deckSig;
    state.deckSig = sig;
    /* 판이 바뀌면 다시 고르고, 그렇지 않으면 지금 자리가 막혔을 때만 옮긴다 */
    positionDeck(changed);
  }

  /* 카드가 덱에서 제자리로 날아오게 한다 (DOM 에 붙인 뒤 호출) */
  function animateDeal(cardEl, delayMs) {
    if (reducedMotion()) return;
    const deck = $('deckSpot');
    const dr = deck.getBoundingClientRect();
    const cr = cardEl.getBoundingClientRect();
    if (!dr.width || !cr.width) return;
    const dx = (dr.left + dr.width / 2) - (cr.left + cr.width / 2);
    const dy = (dr.top + dr.height / 2) - (cr.top + cr.height / 2);
    cardEl.style.setProperty('--dx', dx.toFixed(1) + 'px');
    cardEl.style.setProperty('--dy', dy.toFixed(1) + 'px');
    cardEl.style.setProperty('--dr', (dx > 0 ? 14 : -14) + 'deg');
    cardEl.style.animationDelay = delayMs + 'ms';
    cardEl.classList.add('dealing');
  }

  /* 버튼 다음 자리부터 도는 배분 순서 */
  function computeDealOrder() {
    const g = state.game;
    const n = g.players.length;
    state.dealOrder = {};
    for (let i = 1; i <= n; i++) {
      const p = g.players[(g.button + i) % n];
      state.dealOrder[p.id] = i - 1;
    }
  }

  function startDealAnimation() {
    if (reducedMotion()) return;
    state.dealing = true;
    const n = state.game.players.length;
    const total = n * 2 * 55 + 360;
    const deck = $('deckSpot');
    deck.classList.remove('dealing');
    void deck.offsetWidth;
    deck.classList.add('dealing');
    /* 카드 소리는 몇 번만 (전부 내면 시끄럽다) */
    for (let i = 0; i < Math.min(5, n * 2); i++) {
      setTimeout(SFX.card, i * 90);
    }
    setTimeout(function () { state.dealing = false; }, total);
  }

  function updateSeats() {
    const g = state.game;
    const actor = g.currentActor();
    const showThink = state.settings.showThinking;

    g.players.forEach(function (p) {
      const e = state.seatEls[p.id];
      if (!e) return;
      const tag = p.isHuman ? T('table.youPlayer') : (p.profile ? p.profile.name : 'AI');
      e.name.innerHTML = esc(p.name) + ' <span class="tag">' + esc(tag) + '</span>';
      e.chips.textContent = num(p.chips);

      if (p.allIn && !p.folded) e.last.innerHTML = '<span class="allin">' + T('table.allIn') + '</span>';
      else e.last.textContent = p.lastActionKey ? p.lastAction : '';

      const isTurn = actor === p && g.phase === 'awaiting-action';
      const face = faceFor(g, p, isTurn);
      const next = face || e.baseAvatar;
      if (e.avatar.textContent !== next) {
        e.avatar.textContent = next;
        e.avatar.classList.remove('pop');
        void e.avatar.offsetWidth;          // 애니메이션 재시작
        e.avatar.classList.add('pop');
      }
      e.root.classList.toggle('turn', isTurn);
      e.root.classList.toggle('folded', p.folded);
      e.root.classList.toggle('winner', g.phase === 'hand-over' && p.won > 0);
      if (!isTurn) e.ring.style.background = '';

      if (p.bet > 0) {
        const bsig = 'b' + p.bet;
        if (e.betSig !== bsig) {
          e.betSig = bsig;
          e.bet.innerHTML = '';
          e.bet.appendChild(H.cardart.chipStack(p.bet, { size: 20 }));
          const amt = document.createElement('span');
          amt.textContent = num(p.bet);
          e.bet.appendChild(amt);
        }
        e.bet.classList.remove('hidden');
      } else {
        e.bet.classList.add('hidden');
        e.betSig = '';
      }

      e.badge.classList.toggle('hidden', g.players.indexOf(p) !== g.button);

      /* AI 속마음 */
      const acts = g.actionsOf(p.id);
      const lastAct = acts[acts.length - 1];
      if (showThink && !p.isHuman && lastAct && lastAct.think && lastAct.think.equity != null) {
        const th = lastAct.think;
        const bits = [T('think.equity', { eq: Math.round(th.equity * 100) })];
        if (th.plan === 'bluff') bits.push(T('think.bluff', { fe: Math.round((th.foldEquity || 0) * 100) }));
        else if (th.plan === 'value') bits.push(T('think.value'));
        else if (th.plan === 'slowplay') bits.push(T('think.semiBluff'));
        e.think.textContent = bits.join(' · ');
        e.think.classList.remove('hidden');
      } else {
        e.think.classList.add('hidden');
      }

      /* 카드 */
      const hidden = !p.isHuman && !g.revealAll;
      const show = p.cards.length > 0 && (!p.folded || p.isHuman) && !(p.mucked && !p.isHuman);
      const s = show ? sig(p.cards, hidden) + (p.folded ? ':f' : '') : 'empty';
      if (s !== e.sig) {
        const wasHidden = e.sig.indexOf('back:') === 0;
        e.sig = s;
        e.cards.innerHTML = '';
        if (show) {
          const n = g.players.length;
          const order = state.dealOrder[p.id] || 0;
          p.cards.forEach(function (c, ci) {
            const ce = cardEl(hidden ? null : c, { small: !p.isHuman });
            if (p.folded) ce.classList.add('dim');
            if (wasHidden && !hidden) ce.classList.add('flip');
            if (state.winningCards.indexOf(cardKey(c)) >= 0) ce.classList.add('win-card');
            e.cards.appendChild(ce);
            /* 핸드가 막 시작됐으면 덱에서 날아오게 한다 */
            if (state.dealing && !p.folded) animateDeal(ce, (ci * n + order) * 55);
          });
        }
      } else if (state.winningCards.length && show && !hidden) {
        Array.prototype.forEach.call(e.cards.children, function (ce, i) {
          ce.classList.toggle('win-card', state.winningCards.indexOf(cardKey(p.cards[i])) >= 0);
        });
      }
    });
  }

  /* ==================== 보드 / 상단 ==================== */
  function updateBoard() {
    const g = state.game;
    const wrap = $('community');
    if (g.community.length < state.communityRendered) {
      wrap.innerHTML = '';
      state.communityRendered = 0;
    }
    const fresh = g.community.length - state.communityRendered;
    for (let i = state.communityRendered; i < g.community.length; i++) {
      const ce = cardEl(g.community[i]);
      const delay = (i - state.communityRendered) * 95;
      wrap.appendChild(ce);
      animateDeal(ce, delay);
      if (!ce.classList.contains('dealing')) ce.style.animationDelay = delay + 'ms';
      setTimeout(SFX.card, delay);
    }
    if (fresh > 0) {
      const deck = $('deckSpot');
      deck.classList.remove('dealing');
      void deck.offsetWidth;
      deck.classList.add('dealing');
      /* 보드가 커지면 덱이 가려질 수 있다 — 아래 ensureDeckClear 가 처리한다 */
    }
    state.communityRendered = g.community.length;
    Array.prototype.forEach.call(wrap.children, function (ce, i) {
      ce.classList.toggle('win-card', state.winningCards.indexOf(cardKey(g.community[i])) >= 0);
    });

    /* 팟 (메인 + 사이드) */
    const potsEl = $('pots');
    potsEl.innerHTML = '';
    /* 사이드 팟은 실제로 올인이 걸려 분리된 경우에만 나눠 보여준다.
       (그냥 buildPots 를 쓰면 누가 폴드만 해도 팟이 쪼개진 것처럼 보인다) */
    const hasAllIn = g.players.some(function (p) { return p.allIn && !p.folded; });
    const pots = (g.totalPot() > 0 && hasAllIn) ? g.buildPots() : [];
    if (pots.length <= 1) {
      const b = document.createElement('div');
      b.className = 'pot-badge';
      b.innerHTML = T('table.pot') + ' <b>' + num(g.totalPot()) + '</b>';
      potsEl.appendChild(b);
    } else {
      pots.forEach(function (p, i) {
        const b = document.createElement('div');
        b.className = 'pot-badge' + (i > 0 ? ' side' : '');
        b.innerHTML = (i === 0 ? T('pot.main') : T('pot.side', { n: i })) + ' <b>' + num(p.amount) + '</b>';
        b.title = p.eligible.map(function (id) {
          const pl = g.byId(id); return pl ? pl.name : '';
        }).join(', ');
        potsEl.appendChild(b);
      });
    }

    $('streetLabel').textContent = g.community.length ? T('street.' + g.street) : '';

    /* 상단 메타 — 구분점은 CSS 가 붙인다 (항목을 숨기면 구분점도 같이 사라진다) */
    const hero = g.byId(HERO_ID);
    const parts = [];
    function item(html, optional) {
      parts.push('<span class="meta-item' + (optional ? ' opt' : '') + '">' + html + '</span>');
    }
    /* 라벨은 아주 좁은 화면에서 숨긴다 ("핸드 #1" -> "#1") */
    function labeled(label, value) {
      return '<i class="lbl">' + label + '</i> <b>' + value + '</b>';
    }
    item(labeled(T('top.hand'), '#' + g.handNo));
    if (g.levelEvery) item(T('tour.level', { n: g.levelIndex + 1 }), true);
    item(labeled(T('top.blinds'), g.smallBlind + '/' + g.bigBlind + (g.ante ? '+' + g.ante : '')));
    if (hero) item(labeled(T('top.myChips'), num(hero.chips)));
    const nextLv = g.nextLevelIn();
    if (nextLv != null) item(T('tour.nextLevel', { n: nextLv }), true);
    if (g.players.length > 2) item(T('tour.remaining', { n: g.players.length }), true);
    $('topMeta').innerHTML = parts.join('');
  }

  /* ==================== 히어로 정보 ==================== */
  function refreshHeroInfo(full) {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero || hero.folded || !hero.cards.length) { state.heroInfo = null; state.drawInfo = null; return; }
    if (g.activePlayers().length < 2) { state.heroInfo = null; return; }
    try {
      state.heroInfo = H.ai.analyze(g, hero, { difficulty: 'hard', tracker: state.tracker });
    } catch (e) { state.heroInfo = null; }
    if (full && g.community.length >= 3 && g.community.length <= 4) {
      try { state.drawInfo = H.equity.analyzeDraws(hero.cards, g.community); }
      catch (e) { state.drawInfo = null; }
    } else if (g.community.length > 4 || g.community.length < 3) {
      state.drawInfo = null;
    }
    state.chartState.heroKey = H.ranges.classOf(hero.cards[0], hero.cards[1]);
  }

  function updateHeroReadout() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    const host = $('heroReadout');
    host.innerHTML = '';
    if (!hero) return;
    if (hero.folded) { host.appendChild(chip('muted', T('table.youFolded'))); return; }
    if (!hero.cards.length) return;

    /* 핸드 이름 */
    let handText;
    if (g.community.length >= 3) {
      handText = H.eval.describe(H.eval.evaluate(hero.cards.concat(g.community)));
    } else {
      const a = hero.cards[0], b = hero.cards[1];
      const L = H.cards.RANK_LABEL;
      const hi = a.rank >= b.rank ? a : b, lo = a.rank >= b.rank ? b : a;
      handText = hi.rank === lo.rank
        ? T('hole.pocket', { r: L[hi.rank] })
        : T(a.suit === b.suit ? 'hole.suited' : 'hole.offsuit', { a: L[hi.rank], b: L[lo.rank] });
    }
    host.appendChild(chip('hand', handText));

    if (state.settings.showEquity && state.heroInfo && g.phase !== 'hand-over' && g.phase !== 'show-choice') {
      host.appendChild(chip('equity', T('ctl.equity', { pct: Math.round(state.heroInfo.equity * 100) })));
      if (state.heroInfo.potOdds > 0) {
        host.appendChild(chip('odds', T('ctl.potOdds', { pct: Math.round(state.heroInfo.potOdds * 100) })));
      }
    }
    if (state.drawInfo && state.drawInfo.outs > 0) {
      host.appendChild(chip('outs', T('ctl.outs', {
        n: state.drawInfo.outs,
        name: state.drawInfo.labels[0] || '',
        pct: Math.round(state.drawInfo.byRiver * 100)
      })));
    } else if (state.drawInfo && state.drawInfo.labels.length) {
      host.appendChild(chip('outs', state.drawInfo.labels[0]));
    }
  }
  /* 스트리트별 내 액션 요약 — "프리플랍 콜 20 · 플랍 체크, 콜 40" */
  function updateStreetSummary() {
    const g = state.game;
    const host = $('streetSummary');
    const acts = g.actionsOf(HERO_ID);
    if (!acts.length) { host.textContent = ''; return; }
    const byStreet = {};
    const order = [];
    acts.forEach(function (a) {
      if (!byStreet[a.street]) { byStreet[a.street] = []; order.push(a.street); }
      const label = a.type === 'raise'
        ? T(a.currentBetBefore === 0 ? 'act.bet' : 'act.raise') + ' ' + num(a.amount)
        : a.type === 'call' ? T('act.call') + ' ' + num(a.paid)
          : T('act.' + a.type);
      byStreet[a.street].push(label);
    });
    host.innerHTML = '';
    order.forEach(function (st) {
      const seg = document.createElement('span');
      seg.className = 'sum-seg' + (st === g.street ? ' now' : '');
      const name = document.createElement('b');
      name.textContent = T('street.' + st);
      seg.appendChild(name);
      seg.appendChild(document.createTextNode(' ' + byStreet[st].join(', ')));
      host.appendChild(seg);
    });
  }

  function chip(cls, text) {
    const s = document.createElement('span');
    s.className = 'readout ' + cls;
    s.textContent = text;
    return s;
  }

  /* ==================== 컨트롤 ==================== */
  function hide(el, v) { el.classList.toggle('hidden', !!v); }

  function updateControls() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    const isHeroTurn = g.phase === 'awaiting-action' && g.currentActor() === hero;
    const handOver = g.phase === 'hand-over';
    const showChoice = g.phase === 'show-choice' && g.showChoicePlayer && g.showChoicePlayer.isHuman;

    hide($('btnRow'), !isHeroTurn);
    hide($('raiseRow'), !isHeroTurn);
    hide($('showRow'), !showChoice);
    const canAddon = handOver && hero && g.canAddon(hero);
    hide($('addonRow'), !canAddon);
    if (canAddon) $('btnAddon').textContent = T('tour.addon', { amount: num(g.addonChips) });
    hide($('nextRow'), !handOver);
    hide($('waiting'), isHeroTurn || handOver || showChoice);
    hide($('btnReview'), !state.lastSummary || !state.lastSummary.items.length);

    if (handOver) showBanner(); else $('resultBanner').classList.remove('show');

    if (!isHeroTurn) {
      if (!handOver && !showChoice) {
        const actor = g.currentActor();
        $('waiting').textContent = actor
          ? T('table.thinking', { name: actor.name })
          : T('table.dealing');
      }
      return;
    }

    const a = g.actionsFor(hero);
    $('btnFold').querySelector('span').textContent = T('ctl.fold');
    $('btnCall').querySelector('span').textContent = a.canCheck
      ? T('ctl.check')
      : T('ctl.call', { amount: num(Math.min(a.toCall, hero.chips)) });
    $('btnRaise').disabled = !a.canRaise;

    const slider = $('raiseSlider');
    if (a.canRaise) {
      slider.min = a.minRaiseTo;
      slider.max = a.maxRaiseTo;
      slider.step = Math.max(1, Math.round(g.bigBlind / 2));
      const cur = parseInt(slider.value, 10);
      if (!cur || cur < a.minRaiseTo || cur > a.maxRaiseTo) {
        const target = Math.round((g.currentBet + g.totalPot() * 0.6) / g.bigBlind) * g.bigBlind;
        slider.value = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, target));
      }
      slider.disabled = false;
    } else slider.disabled = true;
    updateRaiseLabel();
  }

  function updateRaiseLabel() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero) return;
    const a = g.actionsFor(hero);
    const v = parseInt($('raiseSlider').value, 10) || a.minRaiseTo;
    const key = v >= a.maxRaiseTo ? 'ctl.allin' : (a.isBet ? 'ctl.bet' : 'ctl.raise');
    $('btnRaise').querySelector('span').textContent = T(key, { amount: num(v) });
  }

  function showBanner() {
    const g = state.game;
    const banner = $('resultBanner');
    if (!g.results) return;
    banner.textContent = g.results.winners.map(function (w) {
      return w.desc
        ? T('table.winsWith', { name: w.name, amount: num(w.amount), desc: w.desc })
        : T('table.wins', { name: w.name, amount: num(w.amount) });
    }).join('   |   ');
    banner.classList.add('show');
  }

  /* ==================== 애니메이션 ==================== */
  function flyChip(fromEl, toEl, count, amount) {
    if (!fromEl || !toEl) return;
    const denom = H.cardart.denomFor(amount || 100);
    const layer = $('chipLayer');
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const lr = layer.getBoundingClientRect();
    const n = Math.min(count || 3, 5);
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'fly-chip';
      c.appendChild(H.cardart.chip(denom, 18));
      c.style.left = (fr.left - lr.left + fr.width / 2 - 9 + (i - n / 2) * 4) + 'px';
      c.style.top = (fr.top - lr.top + fr.height / 2 - 9) + 'px';
      layer.appendChild(c);
      const dx = (tr.left - fr.left) + (tr.width - fr.width) / 2;
      const dy = (tr.top - fr.top) + (tr.height - fr.height) / 2;
      /* 레이아웃을 한 번 강제한 뒤 트랜지션을 건다 */
      c.getBoundingClientRect();
      c.style.transitionDelay = (i * 45) + 'ms';
      c.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.7)';
      c.style.opacity = '0';
      setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 700 + i * 45);
    }
  }

  function collectBetsToPot() {
    const g = state.game;
    const pot = $('pots');
    g.players.forEach(function (p) {
      if (p.bet > 0) {
        const e = state.seatEls[p.id];
        if (e) flyChip(e.bet, pot, 3, p.bet);
      }
    });
  }

  function potToWinners() {
    const g = state.game;
    const pot = $('pots');
    g.players.forEach(function (p) {
      if (p.won > 0) {
        const e = state.seatEls[p.id];
        if (e) flyChip(pot, e.plate || e.root, 5, p.won);
      }
    });
  }

  function computeWinningCards() {
    const g = state.game;
    state.winningCards = [];
    if (!g.results || g.results.uncontested || g.community.length < 5) return;
    const winner = g.players.filter(function (p) { return p.won > 0 && !p.folded && p.cards.length; })[0];
    if (!winner) return;
    try {
      state.winningCards = H.eval.best5(winner.cards.concat(g.community)).map(cardKey);
    } catch (e) { state.winningCards = []; }
  }

  /* ==================== 액션 클락 ==================== */
  function startClockTick() {
    stopClockTick();
    const g = state.game;
    if (!g.actionClock) return;
    let lastWarn = -1;
    state.clockTimer = setInterval(function () {
      if (!state.game || state.game.phase !== 'awaiting-action') return;
      const left = state.game.clockRemaining();
      if (left == null) return;
      const actor = state.game.currentActor();
      const e = actor ? state.seatEls[actor.id] : null;
      if (e) {
        const total = state.game.actionClock + (actor.timeBankLeft || 0);
        const frac = Math.max(0, Math.min(1, left / total));
        const color = frac < 0.25 ? '#d9534f' : frac < 0.5 ? '#e3b95a' : '#6fe3a4';
        e.ring.style.background = 'conic-gradient(' + color + ' ' + (frac * 360) + 'deg, transparent 0)';
      }
      const secs = Math.ceil(left);
      if (actor && actor.isHuman && secs <= 5 && secs !== lastWarn) { lastWarn = secs; SFX.tick(); }
      if (left <= 0) {
        state.game.timeout();
        render();
        loop();
      }
    }, 120);
  }
  function stopClockTick() {
    if (state.clockTimer) { clearInterval(state.clockTimer); state.clockTimer = null; }
  }

  /* ==================== 렌더 ==================== */
  function render() {
    updateSeats();
    updateBoard();
    updateHeroReadout();
    updateStreetSummary();
    updateControls();
    ensureDeckClear();
    refreshPanel();
  }

  /* ==================== 루프 ==================== */
  function clearTimer() { if (state.timer) { clearTimeout(state.timer); state.timer = null; } }

  function loop() {
    clearTimer();
    const g = state.game;
    const speed = state.settings.speed;

    if (g.phase === 'awaiting-action') {
      const actor = g.currentActor();
      if (actor && actor.isHuman) { startClockTick(); render(); return; }
      stopClockTick();
      render();
      state.timer = setTimeout(function () {
        const p = g.currentActor();
        if (!p || g.phase !== 'awaiting-action') { loop(); return; }
        let d;
        try { d = H.ai.decide(g, p, { difficulty: state.settings.difficulty, tracker: state.tracker }); }
        catch (e) { d = { type: g.actionsFor(p).canCheck ? 'check' : 'fold' }; }
        playActionSound(d, p);
        const res = g.act(p.id, d);
        if (!res.ok) g.act(p.id, { type: g.actionsFor(p).canCheck ? 'check' : 'fold' });
        refreshHeroInfo(false);
        render();
        loop();
      }, speed + Math.random() * speed * 0.5);
      return;
    }

    stopClockTick();

    if (g.phase === 'need-street') {
      render();
      collectBetsToPot();
      state.timer = setTimeout(function () {
        g.dealNextStreet();
        refreshHeroInfo(true);
        render();
        loop();
      }, Math.max(520, speed * 0.9));
      return;
    }

    if (g.phase === 'showdown') {
      render();
      state.timer = setTimeout(function () {
        g.resolveShowdown();
        SFX.win();
        loop();
      }, Math.max(650, speed));
      return;
    }

    if (g.phase === 'show-choice') {
      const p = g.showChoicePlayer;
      if (!p || !p.isHuman) { g.chooseShow(false); loop(); return; }
      render();
      return;
    }

    if (g.phase === 'hand-over') {
      ensureFinished();
      render();
      const hero = g.byId(HERO_ID);
      saveSession();
      if (!hero || hero.chips <= 0) {
        if (g.canRebuy(hero)) { setTimeout(function () { gameOver(false, true); }, 900); }
        else setTimeout(function () { gameOver(false, false); }, 1100);
      } else if (g.players.filter(function (p) { return p.chips > 0; }).length < 2) {
        setTimeout(function () { gameOver(true, false); }, 1100);
      }
      return;
    }

    if (g.phase === 'game-over') {
      const hero = g.byId(HERO_ID);
      gameOver(!!(hero && hero.chips > 0), false);
    }
  }

  function playActionSound(d, p) {
    if (d.type === 'fold') SFX.fold();
    else if (d.type === 'check') SFX.check();
    else if (d.type === 'raise' || d.type === 'bet') {
      const a = state.game.actionsFor(p);
      if (d.amount >= a.maxRaiseTo) SFX.allin(); else SFX.raise();
    } else SFX.chip();
  }

  /*
   * 핸드 마무리는 반드시 한 번만, 그리고 빠짐없이 일어나야 한다.
   * (봇의 액션으로 모두 폴드되어 끝나는 경우가 있어서 액션 핸들러에만 두면 누락된다)
   */
  function ensureFinished() {
    if (state.handFinalized) return;
    state.handFinalized = true;
    computeWinningCards();
    finishHand();
    potToWinners();
  }

  /* 핸드 종료 시의 뒷정리: 통계, 히스토리, 리뷰 */
  function finishHand() {
    const g = state.game;
    state.tracker.endHand(g);
    state.lastSummary = H.review.summarize(state.reviewItems, g.bigBlind);
    state.recorder.record(g, { review: state.reviewItems.slice() });
    if (state.settings.autoReview && state.reviewItems.length
      && state.lastSummary.total > g.bigBlind * 0.6) {
      // 다음 핸드가 이미 시작됐다면 띄우지 않는다 (클릭을 가로채는 문제)
      setTimeout(function () {
        if (state.game && state.game.phase === 'hand-over') openReview();
      }, 900);
    }
    state.reviewItems = [];
  }

  /* ==================== 히어로 액션 ==================== */
  function heroAct(action) {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero || g.phase !== 'awaiting-action' || g.currentActor() !== hero) return;

    /* 액션 직전에 리뷰 스냅샷 */
    try {
      const item = H.review.evaluate(g, hero, action, {
        difficulty: 'hard', tracker: state.tracker
      });
      if (item) state.reviewItems.push(item);
    } catch (e) { /* 리뷰 실패가 게임을 막지는 않는다 */ }

    playActionSound(action, hero);
    buzz(action.type === 'fold' ? 12 : 20);
    const res = g.act(hero.id, action);
    if (!res.ok) return;
    refreshHeroInfo(false);
    render();
    loop();
  }

  function nextHand() {
    const g = state.game;
    if (g.phase !== 'hand-over') return;
    $('community').innerHTML = '';
    state.communityRendered = 0;
    state.winningCards = [];
    state.reviewItems = [];
    state.handFinalized = false;
    state.chartState.userPicked = false;
    g.startHand();
    if (g.phase === 'game-over') { loop(); return; }
    /* 블라인드·앤티를 낸 뒤에 잰다 — 트래커는 chips + totalBet 으로 핸드 시작 스택을 되돌린다 */
    state.tracker.startHand(g);
    computeDealOrder();
    state.deckSig = '';
    positionDeck(true);      // 딜링 출발점
    startDealAnimation();
    refreshHeroInfo(true);
    render();
    positionDeck(true);      // 컨트롤 높이가 확정된 뒤 최종 위치/표시 여부
    loop();
  }

  /* ==================== 패널 ==================== */
  function switchTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    refreshPanel();
  }

  function refreshPanel() {
    const host = $('tabBody');
    if (!state.game || $('sidePanel').classList.contains('hidden')) return;
    if (state.tab === 'log') H.panels.renderLog(state.game, host);
    else if (state.tab === 'stats') H.panels.renderStats(state.tracker, state.game, host, HERO_ID);
    else if (state.tab === 'hist') H.panels.renderHistory(state.recorder, host, HERO_ID, openReplay);
    else if (state.tab === 'chart') {
      state.chartState.playerCount = state.game.players.length;
      const hero = state.game.byId(HERO_ID);
      if (hero && hero.cards.length === 2) {
        state.chartState.heroKey = H.ranges.classOf(hero.cards[0], hero.cards[1]);
        // 사용자가 직접 포지션을 골랐다면 그대로 둔다
        if (!state.chartState.userPicked) {
          state.chartState.position = state.game.position(hero) || state.chartState.position;
        }
      }
      H.panels.renderChart(host, state.chartState);
    }
  }

  /* ==================== 모달 ==================== */
  function openModal(id) {
    $(id).classList.add('show');
    const focusable = $(id).querySelector('button, select, input');
    if (focusable) focusable.focus();
  }
  function closeModal(id) { $(id).classList.remove('show'); }

  function openReview() {
    if (!state.lastSummary) return;
    H.panels.renderReview(state.lastSummary, $('reviewBody'));
    openModal('reviewModal');
  }
  function openReplay(hand) {
    H.panels.createReplay(hand, $('replayBody'));
    openModal('replayModal');
  }

  function gameOver(won, canRebuy) {
    clearTimer();
    stopClockTick();
    const g = state.game;
    const place = (g.finished.filter(function (f) { return f.id === HERO_ID; })[0] || {}).place;
    $('overTitle').textContent = won ? T('over.win') : T('over.lose');
    $('overText').textContent = won
      ? T('over.winText', { n: g.handNo })
      : (place ? T('over.place', { place: place }) : T('over.loseText', { n: g.handNo }));
    const st = state.tracker.get(HERO_ID);
    $('overStats').innerHTML = st
      ? '<div class="over-stats">' +
      statBox(T('stats.hands'), st.hands) +
      statBox(T('stats.vpip'), Math.round(st.vpip * 100) + '%') +
      statBox(T('stats.pfr'), Math.round(st.pfr * 100) + '%') +
      statBox(T('stats.bb100'), (st.bb100 >= 0 ? '+' : '') + st.bb100.toFixed(1)) +
      '</div>' : '';
    const rb = $('btnRebuy');
    rb.hidden = !canRebuy;
    if (canRebuy) rb.textContent = T('over.rebuy', { amount: num(g.rebuyChips) });
    if (won) SFX.win(); else SFX.lose();
    H.storage.clearSession();
    openModal('overModal');
  }
  function statBox(label, value) {
    return '<div class="stat-box"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  /* ==================== 설정 ==================== */
  function fillSelect(id, items, value) {
    const sel = $(id);
    sel.innerHTML = '';
    items.forEach(function (it) {
      const o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.label;
      sel.appendChild(o);
    });
    sel.value = String(value);
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  }

  function buildSetup() {
    const s = state.settings;
    const bots = [];
    for (let i = 1; i <= 5; i++) {
      bots.push({ value: i, label: i === 1 ? T('setup.headsUp') : T('setup.opponentsN', { n: i }) });
    }
    fillSelect('optBots', bots, s.bots);
    fillSelect('optDifficulty', [
      { value: 'easy', label: T('setup.diffEasy') + ' — ' + T('setup.diffEasyDesc') },
      { value: 'normal', label: T('setup.diffNormal') + ' — ' + T('setup.diffNormalDesc') },
      { value: 'hard', label: T('setup.diffHard') + ' — ' + T('setup.diffHardDesc') }
    ], s.difficulty);
    fillSelect('optChips', [500, 1000, 2000, 5000].map(function (v) {
      return { value: v, label: v.toLocaleString() };
    }), s.chips);
    fillSelect('optBlinds', [5, 10, 25].map(function (v) {
      return { value: v, label: v + ' / ' + v * 2 };
    }), s.blind);
    fillSelect('optStructure', [
      { value: 0, label: T('setup.structFixed') },
      { value: 20, label: T('setup.structSlow') },
      { value: 10, label: T('setup.structStandard') },
      { value: 5, label: T('setup.structTurbo') }
    ], s.structure);
    fillSelect('optAnte', [
      { value: 'off', label: T('setup.anteOff') },
      { value: 'bb', label: T('setup.anteBB') },
      { value: 'all', label: T('setup.anteAll') }
    ], s.anteMode);
    fillSelect('optSpeed', [
      { value: 350, label: T('setup.speedFast') },
      { value: 750, label: T('setup.speedNormal') },
      { value: 1300, label: T('setup.speedSlow') }
    ], s.speed);
    fillSelect('optClock', [
      { value: 0, label: T('setup.clockOff') },
      { value: 15, label: T('setup.clockSec', { n: 15 }) },
      { value: 30, label: T('setup.clockSec', { n: 30 }) }
    ], s.actionClock);
    fillSelect('optLang', H.i18n.LANGS.map(function (l) {
      return { value: l, label: H.i18n.LANG_NAMES[l] };
    }), s.lang);
    $('optSeed').value = s.seed || '';
    $('optEquity').checked = s.showEquity;
    $('optThinking').checked = s.showThinking;
    $('optReview').checked = s.autoReview;
    $('optFourColor').checked = s.fourColor;
    $('optRebuy').checked = s.allowRebuy;
    applyI18nText();
    $('btnResume').hidden = !H.storage.loadSession();
  }

  function readSetup() {
    return {
      lang: $('optLang').value,
      bots: parseInt($('optBots').value, 10),
      difficulty: $('optDifficulty').value,
      chips: parseInt($('optChips').value, 10),
      blind: parseInt($('optBlinds').value, 10),
      structure: parseInt($('optStructure').value, 10),
      anteMode: $('optAnte').value,
      speed: parseInt($('optSpeed').value, 10),
      actionClock: parseInt($('optClock').value, 10),
      seed: $('optSeed').value.trim(),
      showEquity: $('optEquity').checked,
      showThinking: $('optThinking').checked,
      autoReview: $('optReview').checked,
      fourColor: $('optFourColor').checked,
      allowRebuy: $('optRebuy').checked,
      sound: state.sound
    };
  }

  function applyI18nText() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = T(el.dataset.i18n);
    });
  }

  /* ==================== 게임 시작 / 복원 ==================== */
  function applySettings(s) {
    state.settings = s;
    state.sound = s.sound !== false;
    H.i18n.setLang(s.lang);
    $('app').dataset.fourColor = String(!!s.fourColor);
    $('btnSound').textContent = state.sound ? '🔊' : '🔇';
    $('btnSound').setAttribute('aria-pressed', String(state.sound));
    H.storage.saveSettings(s);
    applyI18nText();
  }

  function startGame(s) {
    clearTimer(); stopClockTick();
    applySettings(s);
    H.storage.clearSession();

    const seed = s.seed ? H.rng.decode(s.seed) : H.rng.randomSeed();
    const rng = H.rng.create(seed);
    const levels = H.tournament.makeLevels(s.blind, s.anteMode, 4);
    const g = new H.Game({
      rng: rng, seed: seed, levels: levels, levelEvery: s.structure,
      smallBlind: s.blind, bigBlind: s.blind * 2, anteMode: s.anteMode,
      actionClock: s.actionClock, timeBank: s.actionClock ? 15 : 0,
      allowRebuy: s.allowRebuy,
      rebuyChips: s.allowRebuy ? s.chips : 0,
      addonChips: s.allowRebuy ? Math.round(s.chips * 1.5) : 0,
      askShowChoice: true
    });
    if (!s.structure) { g.smallBlind = s.blind; g.bigBlind = s.blind * 2; g.ante = 0; }

    g.addPlayer({ id: HERO_ID, name: T('common.you'), chips: s.chips, isHuman: true });
    const names = H.ai.NAMES.slice();
    H.cards.shuffle(names, rng);
    const profiles = H.ai.PROFILES.slice();
    H.cards.shuffle(profiles, rng);
    for (let i = 0; i < s.bots; i++) {
      g.addPlayer({
        id: i + 1, name: names[i % names.length], chips: s.chips,
        profile: profiles[i % profiles.length]
      });
    }

    state.game = g;
    state.tracker = H.stats.create({ bigBlind: g.bigBlind });
    state.recorder = H.history.create({ limit: 120 });
    state.reviewItems = [];
    state.lastSummary = null;
    state.winningCards = [];
    state.communityRendered = 0;
    state.handFinalized = false;
    $('community').innerHTML = '';
    H.equity.initWorker();

    buildSeats();
    g.startHand();
    state.tracker.startHand(g);   // 블라인드·앤티를 낸 뒤에 (위 주석 참고)
    computeDealOrder();
    state.deckSig = '';
    positionDeck(true);      // 딜링 출발점
    startDealAnimation();
    refreshHeroInfo(true);
    render();
    positionDeck(true);      // 컨트롤 높이가 확정된 뒤 최종 위치/표시 여부
    loop();
  }

  function saveSession() {
    if (!state.game) return;
    try {
      H.storage.saveSession({
        settings: state.settings,
        game: state.game.toJSON(),
        tracker: state.tracker.toJSON(),
        history: state.recorder.toJSON()
      });
    } catch (e) { /* 저장 실패는 무시 */ }
  }

  function resumeSession() {
    const saved = H.storage.loadSession();
    if (!saved) return false;
    try {
      applySettings(saved.settings);
      state.game = H.Game.fromJSON(saved.game);
      state.tracker = H.stats.Tracker.fromJSON(saved.tracker);
      state.recorder = H.history.Recorder.fromJSON(saved.history);
      state.reviewItems = [];
      state.lastSummary = null;
      state.winningCards = [];
      state.communityRendered = 0;
      state.handFinalized = state.game.phase === 'hand-over';
      $('community').innerHTML = '';
      H.equity.initWorker();
      buildSeats();
      computeDealOrder();
      positionDeck(true);
      refreshHeroInfo(true);
      render();
      loop();
      return true;
    } catch (e) {
      H.storage.clearSession();
      return false;
    }
  }

  /* ==================== 이벤트 ==================== */
  function bind() {
    $('btnStart').addEventListener('click', function () {
      closeModal('setupModal');
      startGame(readSetup());
    });
    $('btnResume').addEventListener('click', function () {
      closeModal('setupModal');
      if (!resumeSession()) startGame(readSetup());
    });
    $('btnMenu').addEventListener('click', function () {
      clearTimer(); stopClockTick();
      buildSetup();
      openModal('setupModal');
    });
    $('btnOverRestart').addEventListener('click', function () {
      closeModal('overModal');
      buildSetup();
      openModal('setupModal');
    });
    $('btnRebuy').addEventListener('click', function () {
      closeModal('overModal');
      state.game.rebuy(HERO_ID);
      render();
      loop();
    });
    $('btnPanel').addEventListener('click', function () {
      const p = $('sidePanel');
      p.classList.toggle('hidden');
      $('btnPanel').setAttribute('aria-expanded', String(!p.classList.contains('hidden')));
      refreshPanel();
    });
    $('btnSound').addEventListener('click', function () {
      state.sound = !state.sound;
      state.settings.sound = state.sound;
      H.storage.saveSettings(state.settings);
      $('btnSound').textContent = state.sound ? '🔊' : '🔇';
      $('btnSound').setAttribute('aria-pressed', String(state.sound));
    });

    $('btnFold').addEventListener('click', function () { heroAct({ type: 'fold' }); });
    $('btnCall').addEventListener('click', function () {
      const g = state.game, hero = g.byId(HERO_ID);
      heroAct({ type: g.actionsFor(hero).canCheck ? 'check' : 'call' });
    });
    $('btnRaise').addEventListener('click', function () {
      heroAct({ type: 'raise', amount: parseInt($('raiseSlider').value, 10) });
    });
    $('raiseSlider').addEventListener('input', updateRaiseLabel);
    $('btnNext').addEventListener('click', nextHand);
    $('btnAddon').addEventListener('click', function () {
      state.game.addon(HERO_ID);
      SFX.chip();
      render();
    });
    $('btnAddonSkip').addEventListener('click', function () {
      state.game.addonTaken[HERO_ID] = true;
      render();
    });
    $('btnReview').addEventListener('click', openReview);
    $('btnReviewClose').addEventListener('click', function () { closeModal('reviewModal'); });
    $('btnReplayClose').addEventListener('click', function () { closeModal('replayModal'); });
    $('btnShow').addEventListener('click', function () {
      state.game.chooseShow(true); render(); loop();
    });
    $('btnMuck').addEventListener('click', function () {
      state.game.chooseShow(false); render(); loop();
    });

    Array.prototype.forEach.call(document.querySelectorAll('#presets button'), function (b) {
      b.addEventListener('click', function () {
        const g = state.game, hero = g.byId(HERO_ID);
        if (!hero) return;
        const a = g.actionsFor(hero);
        const p = b.dataset.pct;
        let v;
        if (p === 'allin') v = a.maxRaiseTo;
        else if (p === 'min') v = a.minRaiseTo;
        else {
          const pot = g.totalPot();
          v = Math.round((g.currentBet + a.toCall + pot * parseFloat(p)) / g.bigBlind) * g.bigBlind;
        }
        $('raiseSlider').value = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, v));
        updateRaiseLabel();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    $('optLang').addEventListener('change', function () {
      H.i18n.setLang($('optLang').value);
      buildSetup();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const openM = document.querySelector('.modal.show');
      if (openM) {
        if (e.key === 'Escape' && openM.id !== 'setupModal') closeModal(openM.id);
        else if (e.key === 'Enter' && openM.id === 'setupModal') $('btnStart').click();
        else if (openM.id === 'replayModal' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          const nav = openM.querySelectorAll('.replay-nav button');
          (e.key === 'ArrowRight' ? nav[1] : nav[0]).click();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); $('btnFold').click(); }
      else if (k === 'c') { e.preventDefault(); $('btnCall').click(); }
      else if (k === 'r') { e.preventDefault(); if (!$('btnRaise').disabled) $('btnRaise').click(); }
      else if (k === 'v') { e.preventDefault(); openReview(); }
      else if (e.key === ' ') {
        e.preventDefault();
        if (!$('nextRow').classList.contains('hidden')) nextHand();
      }
    });

    let resizeTimer = null;
    global.addEventListener('resize', function () {
      if (!state.game) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { buildSeats(); positionDeck(true); render(); }, 200);
    });

    global.addEventListener('beforeunload', saveSession);
    H.i18n.onChange(function () { applyI18nText(); if (state.game) render(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    state.settings = H.storage.loadSettings();
    state.sound = state.settings.sound !== false;
    H.i18n.setLang(state.settings.lang);
    bind();
    if (global.innerWidth < 980) $('sidePanel').classList.add('hidden');
    switchTab('log');
    buildSetup();
    openModal('setupModal');
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 지원 실패는 무시 */ });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
