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
    6: [[50, 86], [10, 58], [18, 22], [50, 15], [82, 22], [90, 58]],
    7: [[50, 86], [10, 60], [13, 27], [36, 14], [64, 14], [87, 27], [90, 60]],
    8: [[50, 86], [9, 62], [11, 32], [30, 15], [50, 12], [70, 15], [89, 32], [91, 62]],
    9: [[50, 86], [10, 66], [8, 40], [20, 18], [40, 12], [60, 12], [80, 18], [92, 40], [90, 66]]
  };
  /* 좁은 화면에서는 측면 좌석의 카드가 커뮤니티 카드와 겹치므로 위아래로 더 벌린다 */
  const SEAT_POS_NARROW = {
    2: [[50, 88], [50, 12]],
    3: [[50, 88], [16, 26], [84, 26]],
    4: [[50, 88], [15, 62], [50, 13], [85, 62]],
    5: [[50, 88], [14, 64], [24, 14], [76, 14], [86, 64]],
    6: [[50, 88], [13, 66], [17, 20], [50, 11], [83, 20], [87, 66]],
    7: [[50, 88], [12, 66], [14, 30], [35, 12], [65, 12], [86, 30], [88, 66]],
    8: [[50, 88], [11, 68], [12, 38], [28, 14], [50, 10], [72, 14], [88, 38], [89, 68]],
    9: [[50, 88], [11, 70], [9, 44], [19, 19], [39, 10], [61, 10], [81, 19], [91, 44], [89, 70]]
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
    sound: true, winningCards: [], busy: false,
    profile: null, drill: null,
    coach: null, coachUsed: false, coachSig: '',   // 플레이 도중 "생각 정리" (결정 하나에 한 번)
    allinArmed: false, allinTimer: null,
    betOpen: false,        // 좁은 화면: 베팅 패널은 레이즈를 누를 때만 펼친다
    session: { hands: 0, lossBb: 0, byKey: {} },   // 이번 세션 성과 (세션 탭 요약)
    histFilter: 'all',
    raiseTo: 0     // 레이즈 목표 금액 — 슬라이더는 step 에 맞춰 값을 깎으므로 정확한 값은 따로 든다
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
    e.className = 'card' + (opts.small ? ' small' : '') + (card ? '' : ' back');
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
  function num(v) { return H.format.amount(v); }

  /* ==================== 좌석 ==================== */
  function buildSeats() {
    const g = state.game;
    const wrap = $('seats');
    wrap.innerHTML = '';
    state.seatEls = {};
    const n = g.players.length;
    const narrow = global.innerWidth < 720;
    const table = narrow ? SEAT_POS_NARROW : SEAT_POS;
    const pos = table[n] || table[9];
    const heroIdx = g.players.findIndex(function (p) { return p.isHuman; });
    const order = [];
    for (let i = 0; i < n; i++) order.push(g.players[(heroIdx + i + n) % n]);
    state.seatOrder = order;
    document.getElementById('felt').classList.toggle('narrow', narrow);

    order.forEach(function (p, i) {
      const xy = pos[i] || [50, 50];
      const x = xy[0];
      const seat = document.createElement('div');
      seat.className = 'seat ' + (xy[1] > 50 ? 'bottom' : 'top') + (p.isHuman ? ' hero' : ' bot');
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

      state.seatPos[p.id] = { x: x, y: xy[1], x0: x, y0: xy[1], idx: i };
      state.seatEls[p.id] = {
        root: seat, cards: cards, name: name, chips: chips, last: last,
        bet: bet, badge: badge, think: think, ring: ring, avatar: av,
        baseAvatar: base, sig: ''
      };
    });
    buildDeck();
    state.feltLayoutSig = '';
    layoutSeats(true);
    positionDeck(true);
  }

  /*
   * 낮은 펠트용 배치. 봇은 위쪽 한 줄(T) 또는 히어로 양옆(B)에, 히어로는 아래 중앙에.
   * 좌석 행의 y 와 보드의 y 를 실제 픽셀로 계산해 팟·보드와 부딪히지 않게 한다.
   * 펠트가 충분히 높으면(데스크톱) 퍼센트 표를 그대로 쓴다.
   */
  const SHORT_SLOTS = {
    2: ['T50'],
    3: ['T30', 'T70'],
    4: ['T18', 'T50', 'T82'],
    5: ['B15', 'T28', 'T72', 'B85'],
    6: ['B15', 'T18', 'T50', 'T82', 'B85'],
    7: ['B15', 'U18', 'T30', 'T70', 'U82', 'B85'],
    8: ['B15', 'U16', 'T18', 'T50', 'T82', 'U84', 'B85'],
    /* 9인은 팔각 고리: 히어로 → 왼쪽 아래(B) → 왼쪽 중간(M) → 왼쪽 위(S) → 위 둘(T) → 오른쪽 위(S) →
       오른쪽 중간(M) → 오른쪽 아래(B). 3×2 격자(가운데 U50)는 액션 순서를 읽을 수 없다는 제보 */
    9: ['B15', 'M15', 'S15', 'T36', 'T64', 'S85', 'M85', 'B85']
  };
  /* 가로(폭은 넉넉, 높이는 200px 남짓): 둘째 행(U)은 보드 양옆, 상단 행은 최대 4석 */
  const SHORT_SLOTS_LAND = {
    7: ['B15', 'U7', 'T30', 'T70', 'U93', 'B85'],
    8: ['B15', 'U7', 'T20', 'T50', 'T80', 'U93', 'B85'],
    9: ['B15', 'U7', 'T10', 'T36', 'T64', 'T90', 'U93', 'B85']   // 배지가 옆에 붙으므로 넓게 벌린다 (SE 가로 639px 기준)
  };
  /* 좁은 화면은 퍼센트 표가 520px 까지도 팟과 부딪히므로 계산 배치를 더 넓게 쓴다 */
  function shortMaxH() { return global.innerWidth < 720 ? 520 : 430; }

  function layoutSeats(force) {
    const g = state.game;
    if (!g) return;
    const felt = $('felt');
    const fh = felt.clientHeight, fw = felt.clientWidth;
    if (!fh || !fw) return;
    const n = g.players.length;
    const narrowScreen = global.innerWidth < 720;
    /* 좁은 화면의 7인 이상은 퍼센트 표로는 좌석끼리 겹친다 — 항상 계산 배치 */
    const short = fh < shortMaxH() || (narrowScreen && n >= 7);
    const land = short && global.innerWidth > global.innerHeight;
    const dense = short && !land && n >= 7;   // 세로 7인 이상: 마지막 액션 줄 숨김 · 작은 카드
    /* 계산 배치는 좌석 행이 펠트 맨 위·아래에 붙는데, 타원 모서리(반지름 40~46% / 26~32%)는 그 높이에서
       폭이 절반뿐이라 양끝 좌석이 잘린다(9인 세로 화면 제보, 가로도 같다). 펠트와 레일을 둥근 사각형으로 */
    const rect = short;
    felt.classList.toggle('short', short);
    felt.classList.toggle('land', land);
    felt.classList.toggle('dense', dense);
    felt.classList.toggle('rect', rect);
    if (felt.parentElement) felt.parentElement.classList.toggle('rect', rect);
    const center = felt.querySelector('.table-center');
    const heroEl = state.seatEls[state.seatOrder[0].id];

    /* 높이는 가정하지 않고 잰다 — 플레이트는 이름·칩·마지막 액션 세 줄이라 폰트에 따라 다르고,
       리사이즈 직후에는 카드가 아직 없어 작게 나온다. 잰 값을 서명에 넣어 채워지면 다시 배치한다. */
    let botBlock = 44;
    state.seatOrder.forEach(function (p, i) {
      if (i > 0 && state.seatEls[p.id]) botBlock = Math.max(botBlock, state.seatEls[p.id].root.offsetHeight);
    });
    const hadCompact = felt.classList.contains('hcompact');
    if (hadCompact) felt.classList.remove('hcompact');
    const heroTall = heroEl ? heroEl.root.offsetHeight : 112;
    if (hadCompact) felt.classList.add('hcompact');

    const sig = [short, land, fh, fw, g.players.length, botBlock, heroTall].join(':');
    if (!force && sig === state.feltLayoutSig) return;
    state.feltLayoutSig = sig;

    if (!short) {
      felt.classList.remove('hcompact');
      center.style.top = '';
      state.seatOrder.forEach(function (p) {
        const e = state.seatEls[p.id], sp = state.seatPos[p.id];
        if (!e || !sp) return;
        e.root.style.left = sp.x0 + '%';
        e.root.style.top = sp.y0 + '%';
        sp.x = sp.x0; sp.y = sp.y0;
        e.root.classList.toggle('top', sp.y0 <= 50);
        e.root.classList.toggle('bottom', sp.y0 > 50);
      });
      return;
    }

    const cardH = parseFloat(global.getComputedStyle(felt).getPropertyValue('--card-h')) || 63;
    const badge = 38;                                  // 베팅 배지가 차지하는 높이 (여백 포함)
    const margin = 6;
    const potH = 31;
    const slots = (land && SHORT_SLOTS_LAND[n]) || SHORT_SLOTS[n] || SHORT_SLOTS[9];
    const topCy = margin + botBlock / 2;
    /* U: 둘째 행이 윗줄과 같은 열에 있어 윗줄 배지(22px)만큼 띄우고 보드는 그 아래.
       S: 둘째 행이 양옆 열에만 있어 윗줄 바로 아래 붙이고, 보드는 윗줄 아래부터 (S 좌석과 열이 다르다) */
    const hasU = !land && slots.some(function (s) { return s[0] === 'U'; });
    const hasS = !land && slots.some(function (s) { return s[0] === 'S'; });
    const row2Cy = topCy + botBlock + (hasU ? 22 : 4);
    const lowestTop = hasU ? row2Cy : topCy;
    /* 보드: 가장 낮은 상단 행(과 배지) 아래부터. 가로에서는 배지가 옆에 붙어 여백이 작다 */
    const boardTop = lowestTop + botBlock / 2 + (land ? 6 : ((hasU || hasS) ? 26 : badge));
    const boardBottom = boardTop + (land ? cardH : potH + cardH + 4);   // 낮은 펠트에선 스트리트 라벨을 숨긴다
    const boardMidY = boardTop + (land ? cardH / 2 : potH + 5 + cardH / 2);
    /* 히어로: 카드가 보드에 닿을 만큼 낮으면 카드를 플레이트 옆으로 (가로는 항상) */
    const hcompact = land || (fh - margin - heroTall < boardBottom + 4);
    felt.classList.toggle('hcompact', hcompact);
    const heroH = heroEl ? heroEl.root.offsetHeight : heroTall;
    const heroCy = fh - margin - heroH / 2;
    /* 양옆 좌석: 보통은 히어로와 같은 행. 히어로가 압축되면 폭이 넓어져 부딪히므로
       히어로 행 바로 위(보드와 히어로 사이에 생긴 여유)로 올린다. 가로는 폭이 넉넉하다. */
    let sideCy = (hcompact && !land) ? heroCy - heroH / 2 - botBlock / 2 - 2 : heroCy - (hcompact ? 0 : 12);
    if (hcompact && !land) sideCy = Math.max(sideCy, boardBottom + botBlock / 2 + 2);   // 보드 아래로
    /* 중간 좌석(M): 둘째 행과 히어로 행 사이, 단 보드 카드 행보다는 아래 (폭 328 펠트에서는 카드가 옆 플레이트까지 닿는다) */
    const row2Bottom = row2Cy + botBlock / 2, sideTop = sideCy - botBlock / 2;
    let midCy = (row2Bottom + sideTop) / 2;
    midCy = Math.max(midCy, boardBottom + botBlock / 2 + 4);
    midCy = Math.min(midCy, sideTop - botBlock / 2 - 4);
    center.style.top = boardTop + 'px';

    state.seatOrder.forEach(function (p, i) {
      const e = state.seatEls[p.id], sp = state.seatPos[p.id];
      if (!e || !sp) return;
      let x, cy, top, xPx, kind = 'H';
      if (i === 0) { x = 50; cy = heroCy; top = false; xPx = fw / 2; }
      else {
        const s = slots[i - 1] || 'T50';
        x = parseInt(s.slice(1), 10);
        kind = s[0];
        if (kind === 'T') { cy = topCy; top = true; }
        else if (kind === 'U' || kind === 'S') { cy = land ? boardMidY : row2Cy; top = true; }
        else if (kind === 'M') { cy = midCy; top = true; }
        else { cy = sideCy; top = false; }
        /* 좁은 펠트에서 15% 는 플레이트 반폭보다 작아 밖으로 나간다 — 여백을 두고 안으로 민다.
           맨 윗줄은 둥근 모서리(26px)에 걸리지 않게 조금 더 */
        const half = e.root.offsetWidth / 2, pad = (s[0] === 'T') ? 10 : 4;
        xPx = Math.min(Math.max(fw * x / 100, half + pad), fw - half - pad);
      }
      e.root.style.left = xPx + 'px';
      e.root.style.top = cy + 'px';
      e.root.classList.toggle('top', top);
      e.root.classList.toggle('bottom', !top);
      e.root.classList.toggle('right', x > 50);
      /* 배지 방향: S 는 플레이트 아래 바깥쪽 정렬(보드 카드를 피함), M 은 안쪽 옆 */
      e.root.classList.toggle('sideseat', kind === 'S');
      e.root.classList.toggle('midseat', kind === 'M');
      sp.x = xPx / fw * 100; sp.y = cy / fh * 100;
    });
  }
  function reducedMotion() {
    if (state.settings && state.settings.motion === false) return true;
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
      /*
       * 봇의 성향은 이름 옆에 쓰지 않는다. 라벨이 보이면 패가 아니라 라벨을 보고
       * 플레이하게 된다 — 상대가 어떤 사람인지는 액션으로 읽어야 한다.
       */
      e.name.innerHTML = esc(p.name) +
        (p.isHuman ? ' <span class="tag">' + esc(T('table.youPlayer')) + '</span>' : '');
      e.chips.textContent = num(p.chips);

      if (p.allIn && !p.folded) e.last.innerHTML = '<span class="allin">' + T('table.allIn') + '</span>';
      else e.last.textContent = p.lastActionKey
        ? T(p.lastActionKey) + (p.lastActionAmount ? ' ' + num(p.lastActionAmount) : '')
        : '';

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
    if (state.drill) {
      const d = state.drill;
      if (d.session.daily) {
        item(labeled(T('daily.title'), T('daily.progress', { i: Math.min(d.session.asked + (d.item ? 0 : 1), d.session.limit), n: d.session.limit })));
      } else {
        item(labeled(T('drill.title'), d.target ? H.panels.spotLabel(d.target) : T('drill.targetAny')));
      }
      item(T('drill.progress', { correct: d.session.correct(), asked: d.session.asked }));
      item(labeled(T('top.blinds'), g.smallBlind + '/' + g.bigBlind), true);
      $('topMeta').innerHTML = parts.join('');
      return;
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

    /* 드릴 문제 중에는 승률·아웃이 곧 답이다 — 답한 뒤에만 보여준다 */
    const quiz = state.drill && !state.drill.item;
    if (quiz) return;
    updateCoachButton();
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

  /*
   * 액션 영역의 높이를 고정한다. 내 차례에 버튼 줄이 나타나면 컨트롤이 커지고 펠트가 줄어
   * 좌석·카드가 통째로 움직였다(가로 폰에서 42px). 버튼 줄이 보일 때의 높이를 재서 min-height 로
   * 잡아 두면 상대 차례에도 펠트 크기가 같다. 화면 크기와 접힘 여부가 바뀌면 다시 잰다.
   */
  function reserveActionHeight() {
    const area = document.querySelector('.action-area');
    if (!area) return;
    const sig = global.innerWidth + 'x' + global.innerHeight + ':' + (betCollapsible() ? 'c' : 'f');
    if (state.actionSig !== sig) {
      state.actionSig = sig;
      /* 버튼 줄(+ 펼친 베팅 줄)을 보이지 않게 잠깐 펼쳐 자연 높이를 잰다 */
      const rows = [$('btnRow')].concat(betCollapsible() ? [] : [$('raiseRow')]);
      const others = ['showRow', 'addonRow', 'nextRow', 'drillRow', 'drillHint', 'coachBox', 'waiting'].map(function (id) { return $(id); });
      const saved = rows.concat(others).map(function (e) { return { e: e, hidden: e.classList.contains('hidden'), vis: e.style.visibility }; });
      others.forEach(function (e) { e.classList.add('hidden'); });
      rows.forEach(function (e) { e.classList.remove('hidden'); e.style.visibility = 'hidden'; });
      area.style.minHeight = '';
      state.actionH = area.offsetHeight;
      saved.forEach(function (x) { x.e.classList.toggle('hidden', x.hidden); x.e.style.visibility = x.vis; });
    }
    area.style.minHeight = state.actionH ? state.actionH + 'px' : '';
  }

  function updateControls() {
    if (state.drill) { updateDrillControls(); return; }
    hide($('drillRow'), true);
    hide($('drillHint'), true);
    const g = state.game;
    const hero = g.byId(HERO_ID);
    const isHeroTurn = g.phase === 'awaiting-action' && g.currentActor() === hero;
    const handOver = g.phase === 'hand-over';
    const showChoice = g.phase === 'show-choice' && g.showChoicePlayer && g.showChoicePlayer.isHuman;

    hide($('btnRow'), !isHeroTurn);
    refreshCoachSig();
    hide($('raiseRow'), !isHeroTurn || betPanelHidden());
    $('raiseRow').classList.toggle('collapsible', betCollapsible());
    hide($('showRow'), !showChoice);
    hide($('coachBox'), !isHeroTurn || !state.coach);
    const canAddon = handOver && hero && g.canAddon(hero);
    hide($('addonRow'), !canAddon);
    if (canAddon) $('btnAddon').textContent = T('tour.addon', { amount: num(g.addonChips) });
    hide($('nextRow'), !handOver);
    hide($('waiting'), isHeroTurn || handOver || showChoice);
    hide($('btnReview'), !state.lastSummary || !state.lastSummary.items.length);

    if (handOver) showBanner(); else $('resultBanner').classList.remove('show');
    reserveActionHeight();

    if (!isHeroTurn) {
      if (!handOver && !showChoice) {
        const actor = g.currentActor();
        $('waiting').textContent = actor
          ? T('table.thinking', { name: actor.name })
          : T('table.dealing');
      }
      return;
    }

    setupActionButtons(g, hero);
  }

  /* 폴드/콜/레이즈 버튼과 슬라이더를 현재 상황에 맞춘다 (실전과 드릴이 함께 쓴다) */
  function setupActionButtons(g, hero) {
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
      slider.step = raiseUnit(g);
      const cur = state.raiseTo;
      if (!cur || cur < a.minRaiseTo || cur > a.maxRaiseTo) {
        setRaiseTo(g, a, g.currentBet + (g.totalPot() + a.toCall) * 0.6);
      } else {
        slider.value = cur;
      }
      slider.disabled = false;
      $('raiseInput').disabled = false;
      $('raiseInput').min = H.format.toInput(a.minRaiseTo);
      $('raiseInput').max = H.format.toInput(a.maxRaiseTo);
      $('raiseInput').placeholder = T('ctl.amount');
      renderPresets(g, a);
    } else {
      slider.disabled = true;
      $('raiseInput').disabled = true;
    }
    updateRaiseLabel();
  }

  function raiseUnit(g) { return Math.max(1, Math.round(g.bigBlind / 2)); }

  /*
   * 스마트 벳 버튼. 상황마다 쓰는 단위가 다르다:
   *   프리플랍 오픈      bb 배수 (2x · 2.5x · 3x, 림퍼 한 명당 +1bb)
   *   프리플랍 레이즈 직면 상대 벳 배수 (2.5x · 3x · 4x)
   *   포스트플랍          팟 비율 (33% · 50% · 75% · 100% · 150%)
   * 거기에 팟(프리플랍)과 올인.
   */
  function presetSpec(g, a) {
    if (g.street === 'preflop') {
      if (g.raisesThisStreet <= 1) {
        return { title: T('ctl.presetsOpen'), items: [
          { kind: 'x', v: 2, label: '2x' }, { kind: 'x', v: 2.5, label: '2.5x' }, { kind: 'x', v: 3, label: '3x' },
          { kind: 'p', v: 1, label: T('ctl.pot') }, { kind: 'allin', label: T('act.allin') }
        ] };
      }
      return { title: T('ctl.presetsRaise'), items: [
        { kind: 'r', v: 2.5, label: '2.5x' }, { kind: 'r', v: 3, label: '3x' }, { kind: 'r', v: 4, label: '4x' },
        { kind: 'p', v: 1, label: T('ctl.pot') }, { kind: 'allin', label: T('act.allin') }
      ] };
    }
    return { title: T('ctl.presetsPot'), items: [
      { kind: 'p', v: 0.33, label: '33%' }, { kind: 'p', v: 0.5, label: '50%' }, { kind: 'p', v: 0.75, label: '75%' },
      { kind: 'p', v: 1, label: '100%' }, { kind: 'p', v: 1.5, label: '150%' }, { kind: 'allin', label: T('act.allin') }
    ] };
  }

  function countLimpers(g) {
    let n = 0;
    g.handActions.forEach(function (x) { if (x.street === 'preflop' && x.type === 'call' && x.raisesBefore <= 1) n++; });
    return n;
  }

  /* 프리셋 하나가 가리키는 금액 (반올림 전) */
  function presetTarget(g, a, kind, v) {
    if (kind === 'allin') return a.maxRaiseTo;
    if (kind === 'x') return g.bigBlind * v + g.bigBlind * countLimpers(g);
    if (kind === 'r') return g.currentBet * v;
    /* "팟의 x%" 레이즈 = 현재 벳 + x × (팟 + 내가 콜할 금액). 예전 공식은 콜 금액을
       한 번 더 더하고 bb 단위로 반올림해 ½ 과 ¾ 이 같은 금액(3bb)이 됐다. */
    return g.currentBet + (g.totalPot() + a.toCall) * v;
  }

  function renderPresets(g, a) {
    const spec = presetSpec(g, a);
    const host = $('presets');
    const sigNow = spec.items.map(function (it) { return it.kind + it.v; }).join(',');
    if (host.dataset.sig !== sigNow) {
      host.dataset.sig = sigNow;
      host.innerHTML = '';
      spec.items.forEach(function (it) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.kind = it.kind;
        if (it.v != null) b.dataset.v = String(it.v);
        b.textContent = it.label;
        b.addEventListener('click', function () {
          const gg = state.game, hero = gg.byId(HERO_ID);
          if (!hero) return;
          const aa = gg.actionsFor(hero);
          if (!aa.canRaise) return;
          setRaiseTo(gg, aa, presetTarget(gg, aa, it.kind, it.v), it.kind === 'allin');
          updateRaiseLabel();
        });
        host.appendChild(b);
      });
    }
    host.setAttribute('aria-label', spec.title);
    host.title = spec.title;
    markPreset(g, a);
  }

  /* 현재 금액과 일치하는 프리셋을 표시한다 */
  function markPreset(g, a) {
    Array.prototype.forEach.call($('presets').children, function (b) {
      const unit = raiseUnit(g);
      let t = presetTarget(g, a, b.dataset.kind, parseFloat(b.dataset.v));
      if (b.dataset.kind !== 'allin') t = Math.round(t / unit) * unit;
      t = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, Math.round(t)));
      b.classList.toggle('on', t === state.raiseTo);
    });
  }

  /* 목표 금액을 정한다. 슬라이더는 step 에 맞춰 값을 깎을 수 있으므로 정확한 값은 state 에 둔다.
     (앤티가 있으면 스택이 10의 배수가 아니라 올인 금액이 step 에 안 맞는다) */
  function setRaiseTo(g, a, v, exact) {
    const unit = raiseUnit(g);
    if (!exact) v = Math.round(v / unit) * unit;
    v = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, Math.round(v)));
    state.raiseTo = v;
    $('raiseSlider').value = v;
    if (document.activeElement !== $('raiseInput')) $('raiseInput').value = H.format.toInput(v);
    return v;
  }

  function applyUnitUi() {
    const bb = H.format.unit() === 'bb';
    $('btnUnit').textContent = bb ? T('top.unitBb') : T('top.unitChips');
    $('btnUnit').setAttribute('aria-pressed', String(bb));
    $('btnUnit').title = T('top.unitTitle');
    hide($('raiseUnit'), !bb);
    $('raiseInput').parentNode.classList.toggle('bb', bb);
    $('raiseInput').step = bb ? '0.5' : '1';
  }

  function toggleUnit() {
    state.settings.unit = H.format.unit() === 'bb' ? 'chips' : 'bb';
    H.format.setUnit(state.settings.unit);
    H.storage.saveSettings(state.settings);
    applyUnitUi();
    if (state.game) {
      state.seatEls = {};
      buildSeats();           // 칩 텍스트가 캐시된 서명으로 걸러지지 않도록 다시 그린다
      $('raiseInput').value = H.format.toInput(state.raiseTo);
      render();
    }
  }

  function updateRaiseLabel() {
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero) return;
    if (state.allinArmed) { state.allinArmed = false; $('btnRaise').classList.remove('confirm'); }
    const a = g.actionsFor(hero);
    const v = state.raiseTo || a.minRaiseTo;
    let key = v >= a.maxRaiseTo ? 'ctl.allin' : (a.isBet ? 'ctl.bet' : 'ctl.raise');
    if (betCollapsible()) key = !state.betOpen ? 'ctl.raiseOpen' : (v >= a.maxRaiseTo ? 'ctl.confirmAllin' : 'ctl.confirm');
    $('btnRaise').querySelector('span').textContent = T(key, { amount: num(v) });
    if (a.canRaise) markPreset(g, a);
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
    if (state.game) H.format.setBigBlind(state.game.bigBlind);
    updateSeats();
    layoutSeats(false);
    updateBoard();
    updateHeroReadout();
    updateStreetSummary();
    updateControls();
    layoutSeats(false);
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
    state.session.hands++;
    state.session.lossBb += state.lastSummary.totalBb;
    state.reviewItems.forEach(function (it) {
      const k = it.street + '/' + it.spot;
      state.session.byKey[k] = (state.session.byKey[k] || 0) + it.evLossBb;
    });
    if (state.profile && state.reviewItems.length) {
      state.profile.addHand(state.reviewItems);
      H.profile.save(state.profile);
    }
    /* 플레이 스타일 진단 — 세션 통계가 충분해지면 매 핸드 갱신해 저장한다 */
    if (state.profile && H.style) {
      const diag = H.style.diagnose(state.tracker.get(HERO_ID), g.players.length);
      if (diag) { state.profile.setStyle(diag); H.profile.save(state.profile); }
    }
    /* 핸드가 끝나면 옆 패널은 리뷰 탭으로 (실전 모드의 "끝나면 리뷰") */
    if (state.settings.reviewTab !== false && state.reviewItems.length) switchTab('review');
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
    if (state.drill) { drillAnswer(action); return; }
    const g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero || g.phase !== 'awaiting-action' || g.currentActor() !== hero) return;

    /* 액션 직전에 리뷰 스냅샷 */
    try {
      const item = H.review.evaluate(g, hero, action, {
        difficulty: 'hard', tracker: state.tracker
      });
      if (item) { item.coached = !!state.coachUsed; state.reviewItems.push(item); }
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
    state.raiseTo = 0;
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

  /* ==================== 드릴 ==================== */
  function startDrill(target, opts) {
    opts = opts || {};
    clearTimer(); stopClockTick();
    if (state.game && !state.drill) saveSession();   // 진행 중이던 실전은 이어하기로 남긴다
    closeModal('setupModal');
    state.drill = {
      target: target || null,
      session: new H.drill.Session(target || null, { daily: !!opts.daily }),
      tracker: H.stats.create({ bigBlind: H.drill.BB }),
      current: null, item: null
    };
    nextDrillSpot();
  }
  /* 오늘의 10문제: 날짜로 시드가 고정된 무작위 자리 10개. 6인 테이블로 고정해 누구나 같은 문제 */
  function startDaily() { startDrill(null, { daily: true }); }

  function finishDaily() {
    const d = state.drill;
    if (!d || !d.session.daily) return;
    const sess = d.session;
    if (state.profile) {
      state.profile.setDaily({ date: sess.date, asked: sess.asked, correct: sess.correct(), lossBb: sess.lossBb });
      H.profile.save(state.profile);
    }
    const msg = T('daily.finished', { correct: sess.correct(), asked: sess.asked, bb: sess.lossBb.toFixed(1) });
    quitDrill();
    switchTab('learn');
    toast(msg);
  }

  function nextDrillSpot() {
    const d = state.drill;
    if (!d) return;
    if (d.session.finished()) { finishDaily(); return; }
    let r = null;
    try {
      r = H.drill.generate({
        target: d.target, tracker: d.tracker, heroName: T('common.you'),
        seed: d.session.nextSeed(),
        players: d.session.daily ? 6 : Math.max(2, Math.min(9, (state.settings.bots || 5) + 1))
      });
    }
    catch (e) { r = null; }
    if (!r) { if (d.session.daily && d.session.asked) finishDaily(); else quitDrill(); return; }
    d.current = r;
    d.item = null;
    state.game = r.game;
    state.tracker = d.tracker;
    state.recorder = H.history.create({ limit: 1 });
    state.reviewItems = [];
    state.lastSummary = null;
    state.winningCards = [];
    state.communityRendered = 0;
    state.handFinalized = false;
    state.raiseTo = 0;
    state.dealing = false;
    state.chartState.userPicked = false;
    $('community').innerHTML = '';
    H.equity.initWorker();
    buildSeats();
    computeDealOrder();
    state.deckSig = '';
    positionDeck(true);
    refreshHeroInfo(true);
    render();
    positionDeck(true);
  }

  function drillAnswer(action) {
    const d = state.drill, g = state.game;
    const hero = g.byId(HERO_ID);
    if (!hero || d.item || g.phase !== 'awaiting-action' || g.currentActor() !== hero) return;
    let item = null;
    try { item = H.drill.grade(g, hero, action, { tracker: d.tracker }); }
    catch (e) { item = null; }
    playActionSound(action, hero);
    buzz(action.type === 'fold' ? 12 : 20);
    if (!g.act(hero.id, action).ok) return;
    g.revealAll = true;                    // 답한 뒤에는 상대 패를 보여준다
    if (item) {
      d.session.record(item);
      d.item = item;
      state.profile.addDrill(d.current.spot.key, item.evLossBb);
      H.profile.save(state.profile);
    }
    render();
  }

  /* 코치: 히어로 차례마다 새 결정 — 서명이 바뀌면 이전 생각 정리는 닫는다 */
  function heroTurnNow() {
    const g = state.game;
    return !!g && !state.drill && g.phase === 'awaiting-action' && g.currentActor() === g.byId(HERO_ID);
  }
  function refreshCoachSig() {
    const g = state.game;
    const sig = heroTurnNow() ? g.handNo + ':' + g.street + ':' + g.actionsOf(HERO_ID).length : '';
    if (sig !== state.coachSig) { state.coachSig = sig; state.coach = null; state.coachUsed = false; state.betOpen = false; }
  }
  /* 좁은 화면(폰)에서는 베팅 패널을 접어 두고 레이즈를 누르면 펼친다 — 컨트롤 높이가 펠트를 잡아먹는다 */
  function betCollapsible() { return global.innerWidth < 720; }
  function betPanelHidden() { return betCollapsible() && !state.betOpen; }
  function openBetPanel(open) {
    state.betOpen = !!open;
    if (state.game) render();
  }
  /* 코치 버튼은 상단 바에 — 컨트롤에 줄을 더하면 작은 폰에서 펠트가 줄어든다. 히어로 차례에만 켜진다 */
  function updateCoachButton() {
    const b = $('btnCoach');
    if (!b) return;
    refreshCoachSig();
    const coachMode = state.settings.mode === 'coach';
    b.disabled = !coachMode || !heroTurnNow();
    b.classList.toggle('hidden', !coachMode);
    b.setAttribute('aria-pressed', String(!!state.coach));
    b.title = T('coach.btn');
  }
  /* 코치 버튼: 이 자리의 생각 정리를 보여준다. 본 뒤의 결정은 프로파일에 넣지 않는다 */
  function openCoach() {
    if (state.coach) { closeCoach(); return; }
    const g = state.game;
    if (!g || state.drill) return;
    const hero = g.byId(HERO_ID);
    if (!hero || g.phase !== 'awaiting-action' || g.currentActor() !== hero) return;
    let item = null;
    try { item = H.review.preview(g, hero, { difficulty: 'hard', tracker: state.tracker }); }
    catch (e) { item = null; }
    if (!item) return;
    state.coach = item;
    state.coachUsed = true;
    H.panels.renderCoach(item, $('coachBox'), { onClose: closeCoach });
    hide($('coachBox'), false);
    updateCoachButton();
  }
  function closeCoach() {
    state.coach = null;            // 닫아도 coachUsed 는 남는다 — 이미 봤다
    hide($('coachBox'), true);
    updateCoachButton();
  }

  function updateDrillControls() {
    const g = state.game, d = state.drill;
    const hero = g.byId(HERO_ID);
    const answered = !!d.item;
    hide($('coachBox'), true);
    updateCoachButton();
    const isHeroTurn = !answered && g.phase === 'awaiting-action' && g.currentActor() === hero;
    hide($('btnRow'), !isHeroTurn);
    hide($('raiseRow'), !isHeroTurn || betPanelHidden());
    $('raiseRow').classList.toggle('collapsible', betCollapsible());
    hide($('showRow'), true);
    hide($('addonRow'), true);
    hide($('nextRow'), true);
    hide($('waiting'), true);
    hide($('btnReview'), true);
    hide($('drillHint'), !isHeroTurn);
    hide($('drillRow'), false);              // 종료 버튼은 문제 도중에도 보인다
    hide($('drillFeedback'), !answered);
    hide($('btnDrillNext'), !answered);
    $('resultBanner').classList.remove('show');
    reserveActionHeight();
    if (isHeroTurn) {
      const spot = d.current.spot;
      const hint = $('drillHint');
      hint.innerHTML = '';
      hint.appendChild(document.createTextNode(T('drill.question', {
        spot: H.panels.spotLabel(spot.key), pos: T('pos.' + spot.pos)
      })));
      if (!d.current.reached) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = T('drill.fallback');
        hint.appendChild(sub);
      }
      setupActionButtons(g, hero);
    } else if (answered) {
      H.panels.renderDrillFeedback(d.item, d.session, $('drillFeedback'));
      $('btnDrillNext').querySelector('span').textContent = d.session.finished() ? T('daily.finish') : T('drill.next');
      $('btnDrillNext').focus();
    }
  }

  function quitDrill() {
    clearTimer(); stopClockTick();
    state.drill = null;
    state.game = null;
    $('seats').innerHTML = '';
    $('community').innerHTML = '';
    $('pots').innerHTML = '';
    $('topMeta').innerHTML = '';
    $('heroReadout').innerHTML = '';
    $('streetSummary').textContent = '';
    ['btnRow', 'raiseRow', 'showRow', 'addonRow', 'nextRow', 'drillRow', 'drillHint'].forEach(function (id) {
      hide($(id), true);
    });
    hide($('waiting'), false);
    $('waiting').textContent = '';
    openHome();
  }

  /* ==================== 앱으로 설치하기 ==================== */
  /*
   * Android Chrome · 데스크톱 Chrome/Edge 는 beforeinstallprompt 를 붙잡아 두었다가 버튼에서 띄운다.
   * iPhone Safari 는 설치 API 가 없어 "공유 → 홈 화면에 추가" 안내를 보여준다.
   * 그 밖의 경우(앱 안 브라우저 · 삼성 인터넷 · 이벤트가 아직 안 온 Chrome · 데스크톱)에도 카드는 두고
   * 환경별 설치 방법을 안내한다. 이미 설치된(standalone) 상태에서만 숨긴다.
   */
  let installPrompt = null;
  let installed = false;      // 이 세션에서 설치를 마쳤다 — 카드를 더 보이지 않는다
  function isStandalone() {
    try { return global.matchMedia('(display-mode: standalone)').matches || global.navigator.standalone === true; } catch (e) { return false; }
  }
  /* 어떤 환경인지: ios · inapp(카카오톡 등 앱 안 브라우저) · samsung · android · desktop */
  function browserKind() {
    const ua = global.navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/kakaotalk|naver\(inapp|instagram|fban|fbav|line\/|daumapps|everytimeapp/i.test(ua)) return 'inapp';
    if (/samsungbrowser/i.test(ua)) return 'samsung';
    if (/android/i.test(ua)) return 'android';
    return 'desktop';
  }
  const INSTALL_STEPS = {
    ios: ['home.installIos1', 'home.installIos2', 'home.installIos3'],
    inapp: ['home.installInapp1', 'home.installInapp2', 'home.installInapp3'],
    samsung: ['home.installSamsung1', 'home.installSamsung2', 'home.installSamsung3'],
    android: ['home.installAndroid1', 'home.installAndroid2', 'home.installAndroid3'],
    desktop: ['home.installDesktop1', 'home.installDesktop2', 'home.installDesktop3']
  };
  function updateInstallCard() {
    const card = $('homeInstall');
    if (!card) return;
    const desc = $('homeInstallDesc'), btn = $('btnInstall'), steps = $('homeInstallSteps');
    if (isStandalone() || installed) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    if (installPrompt) {
      /* 브라우저가 설치 이벤트를 줬다 — 버튼 한 번으로 바로 설치 */
      desc.textContent = T('home.installDesc');
      btn.textContent = T('home.installBtn');
      steps.classList.add('hidden');
      card.dataset.kind = 'prompt';
      return;
    }
    /* 이벤트가 없다(iPhone · 앱 안 브라우저 · 이미 설치됨 · 아직 안 옴) — 환경별 설치 방법을 안내 */
    const kind = browserKind();
    desc.textContent = T(kind === 'ios' ? 'home.installIosDesc' : kind === 'inapp' ? 'home.installInappDesc' : 'home.installManualDesc');
    btn.textContent = steps.classList.contains('hidden') ? T('home.installIosBtn') : T('home.installIosHide');
    card.dataset.kind = kind;
  }
  function onInstallClick() {
    const card = $('homeInstall');
    if (card.dataset.kind === 'prompt' && installPrompt) {
      const p = installPrompt;
      p.prompt();
      const done = function (choice) {
        if (choice && choice.outcome === 'accepted') { installPrompt = null; installed = true; toast(T('home.installed')); }
        else toast(T('home.installDismissed'));
        updateInstallCard();
      };
      if (p.userChoice && p.userChoice.then) p.userChoice.then(done, function () { done(null); });
      else done(null);
      return;
    }
    const steps = $('homeInstallSteps');
    if (steps.classList.contains('hidden')) {
      steps.innerHTML = '';
      (INSTALL_STEPS[card.dataset.kind] || INSTALL_STEPS.desktop).forEach(function (k) {
        const li = document.createElement('li'); li.textContent = T(k); steps.appendChild(li);
      });
      steps.classList.remove('hidden');
    } else steps.classList.add('hidden');
    updateInstallCard();
  }
  /* 테스트·다른 모듈에서 설치 이벤트를 흉내 낼 수 있게 노출 */
  state.setInstallPrompt = function (ev) { installPrompt = ev; updateInstallCard(); };

  /* ==================== 홈 (플레이 / 교육) ==================== */
  function openHome() {
    buildSetup();
    closeModal('setupModal');
    closeModal('learnModal');
    $('btnHomeResume').hidden = !H.storage.loadSession();
    const today = H.drill.dateKey();
    const rec = state.profile ? state.profile.dailyFor(today) : null;
    $('btnHomeDaily').textContent = rec
      ? T('home.dailyDone', { correct: rec.correct, asked: rec.asked })
      : T('home.dailyTodo');
    $('btnHomeDrillWeak').disabled = !(state.profile && state.profile.drillTarget());
    const cardHost = $('homeDrill');
    if (cardHost) {
      cardHost.innerHTML = '';
      const card = state.profile ? state.profile.drillCard() : null;
      if (card) H.panels.renderDrillCard(card, cardHost, function (k) { closeModal('homeModal'); startDrill(k); }, { noButton: true });
    }
    const st = state.profile && state.profile.lastStyle;
    const line = $('homeStyle');
    line.textContent = st
      ? T('home.styleLine', { icon: st.icon, type: T('style.type.' + st.type), score: st.score })
      : T('home.noStyle');
    line.classList.toggle('muted', !st);
    updateInstallCard();
    openModal('homeModal');
  }
  function openLearnModal() {
    closeModal('homeModal');
    H.panels.renderLearn(state.profile, $('learnBody'), {
      onDrill: function (t) { closeModal('learnModal'); startDrill(t); },
      onDaily: function () { closeModal('learnModal'); startDaily(); },
      onReset: function () { resetProfile(); openLearnModal(); }
    });
    openModal('learnModal');
  }

  /* 가로 폰·태블릿에서는 옆 패널이 테이블 옆에 붙는다 (CSS 와 같은 조건) */
  const DOCK_MQ = '(orientation: landscape) and (max-height: 640px) and (min-width: 800px)';
  function panelDocked() {
    try { return global.matchMedia(DOCK_MQ).matches; } catch (e) { return false; }
  }
  function setPanelOpen(open) {
    const p = $('sidePanel');
    p.classList.toggle('hidden', !open);
    $('btnPanel').setAttribute('aria-expanded', String(open));
    refreshPanel();
    if (state.game) { state.feltLayoutSig = ''; layoutSeats(true); positionDeck(true); }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 5000);
  }

  function resetProfile() {
    if (!global.confirm(T('learn.resetConfirm'))) return;
    state.profile = H.profile.reset();
    refreshPanel();
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
    if ($('sidePanel').classList.contains('hidden')) return;
    if (state.tab === 'learn') {
      const heroStats = state.game && !state.drill && state.tracker ? state.tracker.get(HERO_ID) : null;
      const diag = heroStats && H.style ? H.style.diagnose(heroStats, state.game.players.length) : null;
      H.panels.renderLearn(state.profile, host, {
        onDrill: startDrill, onReset: resetProfile, onDaily: startDaily,
        style: diag, styleHands: heroStats ? heroStats.hands : 0
      });
      return;
    }
    if (!state.game) return;
    if (state.tab === 'log') H.panels.renderLog(state.game, host, { currentHand: true });
    else if (state.tab === 'stats') H.panels.renderStats(state.tracker, state.game, host, HERO_ID, state.drill ? null : state.session);
    else if (state.tab === 'review') H.panels.renderReviewTab(state.lastSummary, state.recorder, host, HERO_ID, reviewOpts());
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

  /* 리뷰에서 이어지는 행동: 레인지 보기(그 포지션의 차트 탭) · 유사 상황 훈련(그 자리 드릴) */
  function reviewOpts() {
    return {
      onRange: function (item) {
        closeModal('reviewModal');
        if (item && item.position) { state.chartState.position = item.position; state.chartState.userPicked = true; }
        state.chartState.situation = item && item.street === 'preflop' ? (item.raisesBefore >= 3 ? 'vs3bet' : item.raisesBefore === 2 ? 'vsOpen' : 'open') : 'open';
        if ($('sidePanel').classList.contains('hidden')) setPanelOpen(true);
        switchTab('chart');
      },
      onDrill: function (key) { closeModal('reviewModal'); startDrill(key); },
      onOpen: openReplay,
      onReview: function (hand) {
        const sum = H.review.summarize(hand.review || [], hand.bb);
        H.panels.renderReview(sum, $('reviewBody'), reviewOpts());
        openModal('reviewModal');
      },
      filter: state.histFilter,
      onFilter: function (f) { state.histFilter = f; refreshPanel(); }
    };
  }
  function openReview() {
    if (!state.lastSummary) return;
    H.panels.renderReview(state.lastSummary, $('reviewBody'), reviewOpts());
    openModal('reviewModal');
  }
  function openReplay(hand) {
    if (state.replayCtl && state.replayCtl.stop) state.replayCtl.stop();
    state.replayCtl = H.panels.createReplay(hand, $('replayBody'), {
      onDrill: function (key) { closeModal('replayModal'); startDrill(key); }
    });
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
    for (let i = 1; i <= 8; i++) {
      bots.push({ value: i, label: i === 1 ? T('setup.headsUp') : T('setup.opponentsN', { n: i }) });
    }
    fillSelect('optBots', bots, s.bots);
    fillSelect('optDifficulty', [
      { value: 'easy', label: T('setup.diffEasy') + ' — ' + T('setup.diffEasyDesc') },
      { value: 'normal', label: T('setup.diffNormal') + ' — ' + T('setup.diffNormalDesc') },
      { value: 'hard', label: T('setup.diffHard') + ' — ' + T('setup.diffHardDesc') }
    ], s.difficulty);
    fillSelect('optBlinds', [5, 10, 25].map(function (v) {
      return { value: v, label: v + ' / ' + v * 2 };
    }), s.blind);
    fillChipsSelect(s.chips);
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
    fillSelect('optMode', [
      { value: 'play', label: T('setup.modePlay') },
      { value: 'coach', label: T('setup.modeCoach') }
    ], s.mode || 'play');
    $('optReviewTab').checked = s.reviewTab !== false;
    $('optMotion').checked = s.motion !== false;
    $('optSound').checked = s.sound !== false;
    $('optFourColor').checked = s.fourColor;
    $('optUnitBb').checked = s.unit === 'bb';
    $('optRebuy').checked = s.allowRebuy;
    applyI18nText();
    $('btnResume').hidden = !H.storage.loadSession();
  }

  /* 시작 칩은 블라인드에 따라 "1,000 (50bb)" 처럼 깊이를 병기한다 */
  function fillChipsSelect(selected) {
    const bb = parseInt($('optBlinds').value, 10) * 2 || 20;
    const cur = selected != null ? selected : parseInt($('optChips').value, 10);
    fillSelect('optChips', [500, 1000, 2000, 5000].map(function (v) {
      const depth = v / bb;
      return {
        value: v,
        label: T('setup.chipsBb', { chips: v.toLocaleString(), bb: Number.isInteger(depth) ? depth : depth.toFixed(1) })
      };
    }), cur);
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
      mode: $('optMode').value,
      reviewTab: $('optReviewTab').checked,
      /* 코치 모드에서 파생 — 옛 코드 경로가 그대로 읽는다 */
      showEquity: $('optMode').value === 'coach',
      showThinking: $('optMode').value === 'coach',
      autoReview: $('optMode').value === 'coach',
      fourColor: $('optFourColor').checked,
      motion: $('optMotion').checked,
      unit: $('optUnitBb').checked ? 'bb' : 'chips',
      allowRebuy: $('optRebuy').checked,
      sound: $('optSound').checked
    };
  }

  function applyI18nText() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = T(el.dataset.i18n);
    });
  }

  /* ==================== 게임 시작 / 복원 ==================== */
  function resetSession() { state.session = { hands: 0, lossBb: 0, byKey: {} }; state.histFilter = 'all'; }

  /* 세로 폰에서 게임을 시작하면 "가로 권장" 안내 — 강제하지 않고, 닫으면 다시 띄우지 않는다 */
  let rotateHintTimer = null;
  function portraitPhone() {
    try { return global.innerWidth < 720 && global.matchMedia('(orientation: portrait)').matches; } catch (e) { return false; }
  }
  function showRotateHint() {
    if (state.settings.rotateHintSeen || !portraitPhone()) return;
    $('rotateHint').classList.remove('hidden');
    clearTimeout(rotateHintTimer);
    rotateHintTimer = setTimeout(hideRotateHint, 12000);
  }
  function hideRotateHint() { $('rotateHint').classList.add('hidden'); clearTimeout(rotateHintTimer); }
  function dismissRotateHint() {
    hideRotateHint();
    state.settings.rotateHintSeen = true;
    H.storage.saveSettings(state.settings);
  }

  function applySettings(s) {
    state.settings = s;
    state.sound = s.sound !== false;
    H.i18n.setLang(s.lang);
    $('app').dataset.fourColor = String(!!s.fourColor);
    document.body.classList.toggle('no-motion', s.motion === false);
    H.format.setUnit(s.unit);
    applyUnitUi();
    $('btnSound').textContent = state.sound ? '🔊' : '🔇';
    $('btnSound').setAttribute('aria-pressed', String(state.sound));
    H.storage.saveSettings(s);
    applyI18nText();
  }

  function startGame(s) {
    resetSession();
    showRotateHint();
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
    state.raiseTo = 0;
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
    if (!state.game || state.drill) return;   // 드릴 판을 실전 세션 위에 덮어쓰면 안 된다
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
      openHome();
    });
    $('btnHomePlay').addEventListener('click', function () {
      closeModal('homeModal');
      buildSetup();
      openModal('setupModal');
    });
    $('btnHomeResume').addEventListener('click', function () {
      closeModal('homeModal');
      if (!resumeSession()) { buildSetup(); openModal('setupModal'); }
    });
    $('btnHomeDaily').addEventListener('click', function () { closeModal('homeModal'); startDaily(); });
    $('btnHomeDrillWeak').addEventListener('click', function () {
      closeModal('homeModal');
      startDrill(state.profile ? state.profile.drillTarget() : null);
    });
    $('btnHomeDrillAny').addEventListener('click', function () { closeModal('homeModal'); startDrill(null); });
    $('btnHomeLearn').addEventListener('click', openLearnModal);
    $('btnLearnClose').addEventListener('click', function () { closeModal('learnModal'); openHome(); });
    $('btnSetupHome').addEventListener('click', function () { closeModal('setupModal'); openHome(); });
    $('btnSetupX').addEventListener('click', function () { closeModal('setupModal'); openHome(); });
    $('btnReviewX').addEventListener('click', function () { closeModal('reviewModal'); });
    $('btnReplayX').addEventListener('click', function () { if (state.replayCtl) state.replayCtl.stop(); closeModal('replayModal'); });
    $('btnLearnX').addEventListener('click', function () { closeModal('learnModal'); openHome(); });
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
      setPanelOpen($('sidePanel').classList.contains('hidden'));
    });
    /* 가로 ↔ 세로: 붙은 패널은 가로에서 기본으로 열고, 세로로 돌아가면 서랍이 테이블을 가리지 않게 닫는다 */
    try {
      const mq = global.matchMedia(DOCK_MQ);
      const onDock = function (e) { if (global.innerWidth < 980) setPanelOpen(e.matches); };
      if (mq.addEventListener) mq.addEventListener('change', onDock); else if (mq.addListener) mq.addListener(onDock);
    } catch (e) { /* matchMedia 없는 환경 */ }
    $('btnUnit').addEventListener('click', toggleUnit);
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
      const g = state.game, hero = g.byId(HERO_ID);
      if (!hero) return;
      const a = g.actionsFor(hero);
      const v = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, state.raiseTo || a.minRaiseTo));
      if (betPanelHidden()) { openBetPanel(true); return; }
      /* 올인은 두 번: 첫 클릭은 확인 상태, 3초 안에 다시 누르면 실행 */
      if (v >= a.maxRaiseTo && v > a.minRaiseTo && !state.allinArmed) {
        state.allinArmed = true;
        $('btnRaise').classList.add('confirm');
        $('btnRaise').querySelector('span').textContent = T('ctl.allinConfirm');
        clearTimeout(state.allinTimer);
        state.allinTimer = setTimeout(function () { state.allinArmed = false; $('btnRaise').classList.remove('confirm'); if (state.game) updateRaiseLabel(); }, 3000);
        return;
      }
      state.allinArmed = false; $('btnRaise').classList.remove('confirm');
      heroAct({ type: 'raise', amount: v });
    });
    $('raiseSlider').addEventListener('input', function () {
      state.raiseTo = parseInt($('raiseSlider').value, 10) || 0;
      $('raiseInput').value = H.format.toInput(state.raiseTo);
      updateRaiseLabel();
    });
    /* 직접 입력: 치는 동안은 그대로 두고, 확정(변경·Enter)할 때 범위로 보정한다 */
    $('raiseInput').addEventListener('input', function () {
      const g = state.game, hero = g && g.byId(HERO_ID);
      if (!hero) return;
      const a = g.actionsFor(hero);
      const v = H.format.fromInput($('raiseInput').value);
      if (!isFinite(v)) return;
      state.raiseTo = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, v));
      $('raiseSlider').value = state.raiseTo;
      updateRaiseLabel();
    });
    function commitRaiseInput() {
      const g = state.game, hero = g && g.byId(HERO_ID);
      if (!hero) return;
      const a = g.actionsFor(hero);
      const v = H.format.fromInput($('raiseInput').value);
      setRaiseTo(g, a, isFinite(v) ? v : a.minRaiseTo, true);
      $('raiseInput').value = H.format.toInput(state.raiseTo);
      updateRaiseLabel();
    }
    $('raiseInput').addEventListener('change', commitRaiseInput);
    $('raiseInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRaiseInput();
        if (!$('btnRaise').disabled) $('btnRaise').click();
      }
    });
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
    $('btnCoach').addEventListener('click', openCoach);
    $('btnBetCancel').addEventListener('click', function () { openBetPanel(false); });
    $('btnRotateHintClose').addEventListener('click', dismissRotateHint);
    $('btnInstall').addEventListener('click', onInstallClick);
    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();          // 브라우저 기본 배너 대신 홈 카드에서 띄운다
      installPrompt = e;
      updateInstallCard();
    });
    global.addEventListener('appinstalled', function () { installPrompt = null; installed = true; toast(T('home.installed')); updateInstallCard(); });
    try {
      const pmq = global.matchMedia('(orientation: portrait)');
      const onTurn = function (e) { if (!e.matches) hideRotateHint(); };
      if (pmq.addEventListener) pmq.addEventListener('change', onTurn); else if (pmq.addListener) pmq.addListener(onTurn);
    } catch (e) { /* matchMedia 없는 환경 */ }
    $('btnDrillNext').addEventListener('click', nextDrillSpot);
    $('btnDrillQuit').addEventListener('click', function () { if (state.drill && state.drill.session.daily && state.drill.session.asked) finishDaily(); else quitDrill(); });
    $('btnDrillFromSetup').addEventListener('click', function () {
      startDrill(state.profile ? state.profile.drillTarget() : null);
    });
    $('btnReviewClose').addEventListener('click', function () { closeModal('reviewModal'); });
    $('btnReplayClose').addEventListener('click', function () { if (state.replayCtl) state.replayCtl.stop(); closeModal('replayModal'); });
    $('btnShow').addEventListener('click', function () {
      state.game.chooseShow(true); render(); loop();
    });
    $('btnMuck').addEventListener('click', function () {
      state.game.chooseShow(false); render(); loop();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    $('optBlinds').addEventListener('change', function () { fillChipsSelect(null); });
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
        if (state.drill && !$('btnDrillNext').classList.contains('hidden')) nextDrillSpot();
        else if (!$('nextRow').classList.contains('hidden')) nextHand();
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
    /* 옛 저장값(승률 표시 체크박스)에서 모드를 이전한다. 새 사용자는 실전이 기본 */
    const raw = H.storage.get('settings', null);
    if (raw && !raw.mode) state.settings.mode = raw.showEquity ? 'coach' : 'play';
    state.settings.showEquity = state.settings.showThinking = state.settings.autoReview = state.settings.mode === 'coach';
    document.body.classList.toggle('no-motion', state.settings.motion === false);
    state.profile = H.profile.load();
    state.sound = state.settings.sound !== false;
    H.format.setUnit(state.settings.unit);
    H.i18n.setLang(state.settings.lang);
    bind();
    if (global.innerWidth < 980 && !panelDocked()) $('sidePanel').classList.add('hidden');
    $('btnPanel').setAttribute('aria-expanded', String(!$('sidePanel').classList.contains('hidden')));
    switchTab('log');
    openHome();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 지원 실패는 무시 */ });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
