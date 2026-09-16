/*
 * engine.js - 텍사스 홀덤 게임 엔진
 *
 * 규칙 전체(블라인드/앤티, 베팅 라운드, 사이드팟, 쇼다운, 머크)를 담당하며
 * 화면에 대해서는 아무것도 모른다. UI 는 phase 를 보고 다음 단계를 진행시킨다.
 *
 *   phase
 *     'idle'             핸드 시작 전
 *     'awaiting-action'  현재 actor 의 액션 대기
 *     'need-street'      다음 커뮤니티 카드를 열 차례   -> dealNextStreet()
 *     'showdown'         쇼다운 처리 필요               -> resolveShowdown()
 *     'show-choice'      무쇼다운 승자의 공개/머크 선택 -> chooseShow()
 *     'hand-over'        핸드 종료                      -> startHand()
 *     'game-over'        플레이어가 1명 남음
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') {
    require('./cards.js'); require('./i18n.js'); require('./rng.js');
    require('./evaluator.js'); require('./tournament.js');
  }
  const T = function (k, p) { return H.i18n.t(k, p); };

  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  /* ---------- 플레이어 ---------- */
  function Player(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.chips = opts.chips;
    this.isHuman = !!opts.isHuman;
    this.profile = opts.profile || null;
    this.avatar = opts.avatar || null;
    this.cards = [];
    this.bet = 0;          // 현재 스트리트에 넣은 금액
    this.totalBet = 0;     // 이번 핸드에 넣은 총액
    this.folded = false;
    this.allIn = false;
    this.acted = false;
    this.raiseClosed = false;   // 정식 레이즈에 못 미치는 올인을 받은 뒤에는 콜/폴드만 가능
    this.mucked = false;
    this.lastAction = '';
    this.lastActionKey = '';
    this.lastActionAmount = 0;   // 화면이 표시 단위(칩/bb)로 다시 조합할 수 있도록 금액은 따로 둔다
    this.handResult = null;
    this.won = 0;
    this.rebuys = 0;
    this.timeBankLeft = 0;
  }

  /* ---------- 게임 ---------- */
  function Game(opts) {
    opts = opts || {};
    this.players = [];
    this.rng = opts.rng || Math.random;

    // 블라인드 구조
    this.levels = opts.levels || H.tournament.makeLevels(opts.smallBlind || 10, opts.anteMode || 'off', opts.anteFrom || 4);
    this.levelIndex = 0;
    this.levelEvery = opts.levelEvery || 0;      // 0 = 블라인드 고정
    this.anteMode = opts.anteMode || 'off';      // 'off' | 'bb' | 'all'
    this.smallBlind = opts.smallBlind || this.levels[0].sb;
    this.bigBlind = opts.bigBlind || this.smallBlind * 2;
    this.ante = 0;
    if (opts.levels || opts.levelEvery) {
      this.smallBlind = this.levels[0].sb;
      this.bigBlind = this.levels[0].bb;
      this.ante = this.levels[0].ante;
    }

    // 토너먼트
    this.allowRebuy = !!opts.allowRebuy;
    this.rebuyChips = opts.rebuyChips || 0;
    this.rebuyUntilLevel = opts.rebuyUntilLevel || 4;
    this.addonChips = opts.addonChips || 0;      // 리바이 기간이 끝날 때 한 번 받을 수 있다
    this.addonTaken = {};
    this.finished = [];                          // 탈락 기록 [{id, name, place}]
    this.startingField = 0;

    // 액션 클락
    this.actionClock = opts.actionClock || 0;    // 초, 0 = 없음
    this.timeBank = opts.timeBank || 0;
    this.actionStartedAt = 0;

    // 진행 상태
    this.button = -1;
    this.handNo = 0;
    this.phase = 'idle';
    this.street = 'preflop';
    this.community = [];
    this.deck = [];
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actor = -1;
    this.revealAll = false;
    this.alwaysShow = !!opts.alwaysShow;         // 학습용: 항상 전부 공개
    this.askShowChoice = !!opts.askShowChoice;   // 무쇼다운 승리 시 사람에게 공개 여부를 묻는다
    this.log = [];
    this.results = null;
    this.handActions = [];
    this.raisesThisStreet = 0;
    this.aggressor = null;
    this.lastAggressorId = null;
    this.showChoicePlayer = null;
    this.seed = opts.seed || null;
    this.onEvent = opts.onEvent || function () {};
  }

  Game.prototype.addPlayer = function (opts) {
    const p = new Player({
      id: opts.id != null ? opts.id : this.players.length,
      name: opts.name,
      chips: opts.chips,
      isHuman: opts.isHuman,
      profile: opts.profile,
      avatar: opts.avatar
    });
    p.timeBankLeft = this.timeBank;
    this.players.push(p);
    this.startingField = this.players.length;
    return p;
  };

  Game.prototype.emit = function (type, data) {
    this.onEvent({ type: type, data: data || {} });
  };

  /* 로그는 i18n 키로 저장한다. 언어를 바꾸면 과거 로그도 같이 바뀐다. */
  Game.prototype.say = function (key, params, kind) {
    const entry = { hand: this.handNo, key: key, params: params || {}, kind: kind || 'info' };
    Object.defineProperty(entry, 'text', {
      get: function () { return T(this.key, this.params); },
      enumerable: true
    });
    this.log.push(entry);
    if (this.log.length > 500) this.log.shift();
    this.emit('log', entry);
    return entry;
  };

  /* ---------- 조회 ---------- */
  Game.prototype.byId = function (id) {
    for (let i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
    return null;
  };
  Game.prototype.activePlayers = function () {
    return this.players.filter(function (p) { return !p.folded; });
  };
  Game.prototype.livePlayers = function () {
    return this.players.filter(function (p) { return !p.folded && !p.allIn; });
  };
  Game.prototype.totalPot = function () {
    return this.players.reduce(function (s, p) { return s + p.totalBet; }, 0);
  };
  Game.prototype.mainPot = function () {
    return this.players.reduce(function (s, p) { return s + p.totalBet - p.bet; }, 0);
  };
  Game.prototype.currentActor = function () {
    return this.actor >= 0 ? this.players[this.actor] : null;
  };
  Game.prototype.actionsOf = function (playerId, street) {
    return this.handActions.filter(function (a) {
      return a.playerId === playerId && (!street || a.street === street);
    });
  };
  Game.prototype.actionsFor = function (player) {
    const toCall = Math.max(0, Math.min(this.currentBet - player.bet, player.chips));
    const maxRaiseTo = player.bet + player.chips;
    let minRaiseTo = this.currentBet + this.minRaise;
    if (minRaiseTo > maxRaiseTo) minRaiseTo = maxRaiseTo;
    return {
      toCall: toCall,
      canCheck: toCall === 0,
      canRaise: player.chips > toCall && !player.raiseClosed,
      minRaiseTo: minRaiseTo,
      maxRaiseTo: maxRaiseTo,
      isBet: this.currentBet === 0
    };
  };
  Game.prototype.position = function (player) {
    return H.ranges
      ? H.ranges.positionOf(this.players.indexOf(player), this.button, this.players.length)
      : '';
  };

  /* ---------- 토너먼트 ---------- */
  Game.prototype.payouts = function () {
    // 탈락자의 칩은 이미 남은 플레이어들에게 넘어가 있으므로 현재 스택 합이 곧 총 칩이다
    const totalChips = this.players.reduce(function (s, p) { return s + p.chips; }, 0);
    const struct = H.tournament.payoutStructure(this.startingField);
    return struct.map(function (f) { return Math.round(f * totalChips); });
  };

  Game.prototype.icm = function () {
    const stacks = this.players.map(function (p) { return p.chips; });
    return H.tournament.icmEquity(stacks, this.payouts());
  };

  Game.prototype.canRebuy = function (player) {
    return this.allowRebuy
      && this.rebuyChips > 0
      && player.chips <= 0
      && this.levelIndex < this.rebuyUntilLevel;
  };

  Game.prototype.rebuy = function (playerId) {
    const p = this.byId(playerId);
    if (!p || !this.canRebuy(p)) return false;
    p.chips += this.rebuyChips;
    p.rebuys++;
    this.say('log.rebuy', { name: p.name, amount: this.rebuyChips }, 'blind');
    this.emit('rebuy', { player: p });
    return true;
  };

  /* 애드온: 리바이 기간이 끝나는 레벨에 딱 한 번, 칩이 남아 있어도 받을 수 있다 */
  Game.prototype.canAddon = function (player) {
    return this.allowRebuy
      && this.addonChips > 0
      && !this.addonTaken[player.id]
      && this.levelIndex === this.rebuyUntilLevel - 1
      && player.chips > 0;
  };

  Game.prototype.addon = function (playerId) {
    const p = this.byId(playerId);
    if (!p || !this.canAddon(p)) return false;
    p.chips += this.addonChips;
    this.addonTaken[p.id] = true;
    this.say('log.addon', { name: p.name, amount: this.addonChips }, 'blind');
    this.emit('addon', { player: p });
    return true;
  };

  Game.prototype.applyLevel = function () {
    const lv = this.levels[Math.min(this.levelIndex, this.levels.length - 1)];
    this.smallBlind = lv.sb;
    this.bigBlind = lv.bb;
    this.ante = lv.ante;
    this.say('log.levelUp', {
      level: lv.level, sb: lv.sb, bb: lv.bb,
      ante: lv.ante ? T('log.anteSuffix', { a: lv.ante }) : ''
    }, 'blind');
    this.emit('level', { level: lv });
  };

  Game.prototype.nextLevelIn = function () {
    if (!this.levelEvery) return null;
    return this.levelEvery - (this.handNo % this.levelEvery);
  };

  /* ---------- 핸드 시작 ---------- */
  Game.prototype.removeBusted = function () {
    const busted = this.players.filter(function (p) { return p.chips <= 0; });
    if (!busted.length) return;
    // 같은 핸드에 여러 명이 탈락하면 시작 스택이 큰 쪽이 상위 등수
    busted.sort(function (a, b) { return (b.bustStack || 0) - (a.bustStack || 0); });
    const survivors = this.players.length - busted.length;
    const self = this;
    busted.forEach(function (p, i) {
      // 스택이 컸던 순서대로 상위 등수를 받는다 (생존자 아래부터)
      const place = survivors + 1 + i;
      self.finished.push({ id: p.id, name: p.name, place: place });
      self.say('log.bust', { name: p.name }, 'bust');
      self.emit('bust', { player: p, place: place });
    });
    this.players = this.players.filter(function (p) { return p.chips > 0; });
  };

  Game.prototype.startHand = function () {
    this.removeBusted();
    if (this.players.length < 2) {
      this.phase = 'game-over';
      if (this.players.length === 1) {
        this.finished.push({ id: this.players[0].id, name: this.players[0].name, place: 1 });
      }
      this.emit('game-over', {});
      return;
    }

    this.handNo++;
    if (this.levelEvery && this.handNo > 1 && (this.handNo - 1) % this.levelEvery === 0
      && this.levelIndex < this.levels.length - 1) {
      this.levelIndex++;
      this.applyLevel();
    }

    const n = this.players.length;
    this.button = (this.button + 1) % n;
    this.community = [];
    this.street = 'preflop';
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.revealAll = false;
    this.results = null;
    this.handActions = [];
    this.raisesThisStreet = 0;
    this.aggressor = null;
    this.lastAggressorId = null;
    this.showChoicePlayer = null;

    for (let i = 0; i < n; i++) {
      const p = this.players[i];
      p.cards = []; p.bet = 0; p.totalBet = 0;
      p.folded = false; p.allIn = false; p.acted = false; p.raiseClosed = false; p.mucked = false;
      p.lastAction = ''; p.lastActionKey = ''; p.lastActionAmount = 0; p.handResult = null; p.won = 0;
      p.bustStack = p.chips;
    }

    this.deck = H.cards.shuffle(H.cards.makeDeck(), this.rng);
    this.say('log.handStart', {
      n: this.handNo, sb: this.smallBlind, bb: this.bigBlind,
      ante: this.ante ? T('log.anteSuffix', { a: this.ante }) : ''
    }, 'hand');

    /* 앤티 */
    if (this.ante > 0 && this.anteMode !== 'off') {
      if (this.anteMode === 'bb') {
        const bbIdx = n === 2 ? (this.button + 1) % n : (this.button + 2) % n;
        const bb = this.players[bbIdx];
        const paid = this.putIn(bb, this.ante);
        if (paid > 0) this.say('log.postAnte', { name: bb.name, amount: paid }, 'blind');
        bb.bet = 0;                    // 앤티는 현재 스트리트 베팅이 아니다
      } else {
        for (let i = 0; i < n; i++) {
          const p = this.players[i];
          const paid = this.putIn(p, this.ante);
          if (paid > 0) this.say('log.postAnte', { name: p.name, amount: paid }, 'blind');
          p.bet = 0;
        }
      }
    }

    /* 블라인드 */
    const sbIdx = n === 2 ? this.button : (this.button + 1) % n;
    const bbIdx = n === 2 ? (this.button + 1) % n : (this.button + 2) % n;
    const sb = this.players[sbIdx];
    const bb = this.players[bbIdx];
    const sbPaid = this.putIn(sb, this.smallBlind);
    sb.lastActionKey = 'act.sb';
    sb.lastAction = T('act.sb');
    const bbPaid = this.putIn(bb, this.bigBlind);
    bb.lastActionKey = 'act.bb';
    bb.lastAction = T('act.bb');
    this.currentBet = Math.max(sb.bet, bb.bet);
    this.minRaise = this.bigBlind;
    this.raisesThisStreet = 1;   // 빅블라인드를 최초 베팅으로 취급
    this.say('log.postSb', { name: sb.name, amount: sbPaid }, 'blind');
    this.say('log.postBb', { name: bb.name, amount: bbPaid }, 'blind');

    /* 홀카드 */
    for (let round = 0; round < 2; round++) {
      for (let i = 1; i <= n; i++) {
        this.players[(this.button + i) % n].cards.push(this.deck.pop());
      }
    }

    this.emit('hand-start', { handNo: this.handNo });

    this.actor = n === 2 ? sbIdx : (bbIdx + 1) % n;
    if (this.livePlayers().length < 2) {
      this.phase = 'need-street';
      this.revealAll = true;
    } else {
      this.phase = 'awaiting-action';
      const cur = this.players[this.actor];
      if (cur.folded || cur.allIn) { this.actor = (this.actor - 1 + n) % n; this.advance(); }
      else this.startClock();
    }
    this.emit('state', {});
  };

  Game.prototype.putIn = function (player, amount) {
    const amt = Math.max(0, Math.min(amount, player.chips));
    player.chips -= amt;
    player.bet += amt;
    player.totalBet += amt;
    if (player.chips === 0) player.allIn = true;
    return amt;
  };

  /* ---------- 액션 클락 ---------- */
  Game.prototype.startClock = function () {
    this.actionStartedAt = this.actionClock ? Date.now() : 0;
  };
  Game.prototype.clockRemaining = function () {
    if (!this.actionClock || !this.actionStartedAt) return null;
    const p = this.currentActor();
    const total = this.actionClock + (p ? p.timeBankLeft : 0);
    return Math.max(0, total - (Date.now() - this.actionStartedAt) / 1000);
  };
  /** 시간 초과: 체크할 수 있으면 체크, 아니면 폴드 */
  Game.prototype.timeout = function () {
    if (this.phase !== 'awaiting-action') return;
    const p = this.currentActor();
    if (!p) return;
    const a = this.actionsFor(p);
    const type = a.canCheck ? 'check' : 'fold';
    p.timeBankLeft = 0;
    this.say('log.timeout', { name: p.name, action: T('act.' + type) }, 'fold');
    this.act(p.id, { type: type, timedOut: true });
  };

  /* ---------- 액션 ---------- */
  Game.prototype.act = function (playerId, action) {
    if (this.phase !== 'awaiting-action') return { ok: false, error: 'phase' };
    const p = this.currentActor();
    if (!p || p.id !== playerId) return { ok: false, error: 'turn' };

    const a = this.actionsFor(p);
    const type = action.type;
    const snapshot = {
      playerId: p.id,
      street: this.street,
      potBefore: this.totalPot(),
      currentBetBefore: this.currentBet,
      toCall: a.toCall,
      raisesBefore: this.raisesThisStreet,
      stackBefore: p.chips,
      cards: p.cards.slice()
    };

    if (type === 'fold') {
      p.folded = true; p.acted = true;
      p.lastActionKey = 'act.fold'; p.lastAction = T('act.fold'); p.lastActionAmount = 0;
      this.say('log.fold', { name: p.name }, 'fold');
    } else if (type === 'check') {
      if (!a.canCheck) return { ok: false, error: 'cannot-check' };
      p.acted = true;
      p.lastActionKey = 'act.check'; p.lastAction = T('act.check'); p.lastActionAmount = 0;
      this.say('log.check', { name: p.name }, 'check');
    } else if (type === 'call') {
      if (a.toCall <= 0) return this.act(playerId, { type: 'check' });
      const paid = this.putIn(p, a.toCall);
      p.acted = true;
      p.lastActionKey = 'act.call';
      p.lastAction = T('act.call') + ' ' + paid;
      p.lastActionAmount = paid;
      this.say(p.allIn ? 'log.callAllIn' : 'log.call', { name: p.name, amount: paid }, 'call');
    } else if (type === 'raise' || type === 'bet' || type === 'allin') {
      if (!a.canRaise) return { ok: false, error: 'cannot-raise' };
      let target = type === 'allin' ? a.maxRaiseTo : Math.round(action.amount);
      if (!isFinite(target)) return { ok: false, error: 'bad-amount' };
      if (target > a.maxRaiseTo) target = a.maxRaiseTo;
      if (target < a.minRaiseTo && target !== a.maxRaiseTo) target = a.minRaiseTo;
      const prevBet = this.currentBet;
      this.putIn(p, target - p.bet);
      const raiseBy = p.bet - prevBet;
      /*
       * 정식 레이즈(최소 레이즈 이상)만 액션을 다시 연다. 그에 못 미치는 올인은
       * 이미 행동한 사람에게 콜/폴드만 남긴다 — 그 사람이 다시 레이즈할 수는 없다.
       * 아직 행동하지 않은 사람은 물론 레이즈할 수 있다.
       */
      const fullRaise = raiseBy >= this.minRaise;
      if (fullRaise) this.minRaise = raiseBy;
      if (p.bet > this.currentBet) {
        this.currentBet = p.bet;
        this.raisesThisStreet++;
        this.aggressor = p;
        this.lastAggressorId = p.id;
        for (let i = 0; i < this.players.length; i++) {
          const o = this.players[i];
          if (o === p || o.folded || o.allIn) continue;
          if (fullRaise) { o.acted = false; o.raiseClosed = false; }
          else if (o.acted) o.raiseClosed = true;
        }
      }
      p.acted = true;
      const isBet = prevBet === 0;
      p.lastActionKey = p.allIn ? 'act.allin' : (isBet ? 'act.bet' : 'act.raise');
      p.lastAction = T(p.lastActionKey) + ' ' + p.bet;
      p.lastActionAmount = p.bet;
      this.say(p.allIn ? 'log.betAllIn' : (isBet ? 'log.bet' : 'log.raise'),
        { name: p.name, amount: p.bet }, 'raise');
    } else {
      return { ok: false, error: 'unknown-action' };
    }

    snapshot.type = (type === 'bet' || type === 'allin') ? 'raise' : type;
    snapshot.amount = (type === 'fold' || type === 'check') ? 0 : p.bet;
    snapshot.paid = snapshot.stackBefore - p.chips;
    snapshot.allIn = p.allIn;
    snapshot.timedOut = !!action.timedOut;
    snapshot.think = action.think || null;
    this.handActions.push(snapshot);

    this.emit('action', { player: p, type: type, record: snapshot });
    this.advance();
    this.emit('state', {});
    return { ok: true };
  };

  Game.prototype.roundComplete = function () {
    if (this.activePlayers().length < 2) return true;
    const live = this.livePlayers();
    for (let i = 0; i < live.length; i++) {
      if (!live[i].acted || live[i].bet < this.currentBet) return false;
    }
    return true;
  };

  Game.prototype.advance = function () {
    const n = this.players.length;
    if (this.activePlayers().length < 2) { this.awardUncontested(); return; }
    if (this.roundComplete()) { this.closeStreet(); return; }
    let i = this.actor;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      const p = this.players[i];
      if (!p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet)) {
        this.actor = i;
        this.phase = 'awaiting-action';
        this.startClock();
        this.emit('turn', { player: p });
        return;
      }
    }
    this.closeStreet();
  };

  Game.prototype.closeStreet = function () {
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].bet = 0;
      this.players[i].acted = false;
      this.players[i].raiseClosed = false;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actor = -1;
    this.raisesThisStreet = 0;
    this.aggressor = null;
    this.actionStartedAt = 0;

    if (this.livePlayers().length < 2 && this.activePlayers().length > 1) this.revealAll = true;
    this.phase = this.street === 'river' ? 'showdown' : 'need-street';
    this.emit('street-end', { street: this.street });
  };

  Game.prototype.dealNextStreet = function () {
    if (this.phase !== 'need-street') return;
    const idx = STREETS.indexOf(this.street);
    this.street = STREETS[idx + 1];
    this.deck.pop();                                   // 버닝 카드
    const count = this.street === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) this.community.push(this.deck.pop());

    this.say('log.street', {
      street: T('street.' + this.street),
      cards: this.community.map(H.cards.cardToString).join(' ')
    }, 'street');
    this.emit('street', { street: this.street });

    if (this.livePlayers().length >= 2) {
      this.actor = this.button;
      this.phase = 'awaiting-action';
      this.advance();
    } else {
      this.phase = this.street === 'river' ? 'showdown' : 'need-street';
    }
    this.emit('state', {});
  };

  /* ---------- 팟 분배 ---------- */
  Game.prototype.buildPots = function () {
    const contribs = this.players.filter(function (p) { return p.totalBet > 0; });
    const levels = [];
    for (let i = 0; i < contribs.length; i++) {
      if (levels.indexOf(contribs[i].totalBet) === -1) levels.push(contribs[i].totalBet);
    }
    levels.sort(function (a, b) { return a - b; });

    const pots = [];
    let prev = 0;
    for (let L = 0; L < levels.length; L++) {
      const lvl = levels[L];
      let amount = 0;
      for (let i = 0; i < contribs.length; i++) {
        amount += Math.max(0, Math.min(contribs[i].totalBet, lvl) - prev);
      }
      const eligible = this.players
        .filter(function (p) { return !p.folded && p.totalBet >= lvl; })
        .map(function (p) { return p.id; });
      if (amount > 0) {
        const last = pots[pots.length - 1];
        if (last && last.eligible.join(',') === eligible.join(',')) last.amount += amount;
        else pots.push({ amount: amount, eligible: eligible });
      }
      prev = lvl;
    }
    return pots;
  };

  Game.prototype.awardUncontested = function () {
    const winner = this.activePlayers()[0];
    const pot = this.totalPot();
    winner.chips += pot;
    winner.won = pot;
    this.say('log.uncontested', { name: winner.name, amount: pot }, 'win');
    this.results = {
      uncontested: true,
      winners: [{ id: winner.id, name: winner.name, amount: pot, desc: '' }],
      pots: []
    };
    this.actor = -1;
    this.actionStartedAt = 0;

    // 카드를 보여줄지 선택할 수 있다 (정보를 주는 대신 테이블 이미지를 만든다)
    if (this.alwaysShow) {
      winner.mucked = false;
      this.revealAll = true;
      this.finishHand();
    } else if (!this.askShowChoice || !winner.isHuman) {
      winner.mucked = true;     // 봇은 정보를 주지 않는다
      this.finishHand();
    } else {
      this.showChoicePlayer = winner;
      this.phase = 'show-choice';
      this.emit('show-choice', { player: winner });
      this.emit('state', {});
    }
  };

  /** 무쇼다운 승자의 공개/머크 선택 */
  Game.prototype.chooseShow = function (show) {
    if (this.phase !== 'show-choice') return;
    const p = this.showChoicePlayer;
    if (p) {
      p.mucked = !show;
      if (show) {
        this.say('log.show', {
          name: p.name,
          cards: p.cards.map(H.cards.cardToString).join(' '),
          desc: this.community.length >= 3
            ? H.eval.describe(H.eval.evaluate(p.cards.concat(this.community)))
            : ''
        }, 'show');
      } else {
        this.say('log.muck', { name: p.name }, 'fold');
      }
    }
    this.showChoicePlayer = null;
    this.finishHand();
  };

  /** 쇼다운 공개 순서: 리버 마지막 공격자부터, 없으면 버튼 다음부터 */
  Game.prototype.showdownOrder = function () {
    const active = this.activePlayers();
    const n = this.players.length;
    let startIdx;
    if (this.lastAggressorId != null && this.byId(this.lastAggressorId) && !this.byId(this.lastAggressorId).folded) {
      startIdx = this.players.indexOf(this.byId(this.lastAggressorId));
    } else {
      startIdx = (this.button + 1) % n;
    }
    const order = [];
    for (let i = 0; i < n; i++) {
      const p = this.players[(startIdx + i) % n];
      if (active.indexOf(p) >= 0) order.push(p);
    }
    return order;
  };

  Game.prototype.resolveShowdown = function () {
    if (this.phase !== 'showdown') return;
    this.revealAll = true;
    const self = this;
    const contenders = this.activePlayers();
    contenders.forEach(function (p) {
      p.handResult = H.eval.evaluate(p.cards.concat(self.community));
    });

    const pots = this.buildPots();
    const summary = [];
    const n = this.players.length;

    pots.forEach(function (pot, i) {
      const elig = pot.eligible.map(function (id) { return self.byId(id); })
        .filter(function (p) { return p && !p.folded; });
      if (!elig.length) return;
      let best = -1;
      elig.forEach(function (p) { best = Math.max(best, p.handResult.value); });
      const winners = elig.filter(function (p) { return p.handResult.value === best; });

      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // 나누어떨어지지 않는 칩은 버튼 다음 자리부터
      const ordered = winners.slice().sort(function (a, b) {
        const ia = (self.players.indexOf(a) - self.button + n) % n;
        const ib = (self.players.indexOf(b) - self.button + n) % n;
        return ia - ib;
      });
      ordered.forEach(function (p) {
        let amt = share;
        if (remainder > 0) { amt++; remainder--; }
        p.chips += amt;
        p.won += amt;
      });

      summary.push({
        label: i === 0 ? T('pot.main') : T('pot.side', { n: i }),
        labelKey: i === 0 ? 'pot.main' : 'pot.side',
        labelParams: { n: i },
        amount: pot.amount,
        eligible: pot.eligible,
        winners: ordered.map(function (p) {
          return { id: p.id, name: p.name, desc: H.eval.describe(p.handResult) };
        })
      });
    });

    /* 머크: 이길 수 없는 패는 굳이 공개하지 않는다 */
    let bestShown = -1;
    this.showdownOrder().forEach(function (p) {
      const mustShow = p.won > 0 || self.alwaysShow;
      if (mustShow || p.handResult.value > bestShown) {
        p.mucked = false;
        bestShown = Math.max(bestShown, p.handResult.value);
        self.say('log.show', {
          name: p.name,
          cards: p.cards.map(H.cards.cardToString).join(' '),
          desc: H.eval.describe(p.handResult)
        }, 'show');
      } else {
        p.mucked = true;
        self.say('log.muck', { name: p.name }, 'fold');
      }
    });

    summary.forEach(function (s) {
      self.say('log.potWin', {
        label: s.label, amount: s.amount,
        winners: s.winners.map(function (w) { return w.name + ' (' + w.desc + ')'; }).join(', ')
      }, 'win');
    });

    const winnersFlat = contenders.filter(function (p) { return p.won > 0; }).map(function (p) {
      return { id: p.id, name: p.name, amount: p.won, desc: H.eval.describe(p.handResult) };
    });

    this.results = { uncontested: false, winners: winnersFlat, pots: summary };
    this.finishHand();
  };

  Game.prototype.finishHand = function () {
    this.phase = 'hand-over';
    this.emit('hand-end', { results: this.results });
    this.emit('state', {});
  };

  /* 다음 핸드로 넘어갈 수 있는가 (리바이 대기 등) */
  Game.prototype.pendingRebuys = function () {
    const self = this;
    return this.players.filter(function (p) { return self.canRebuy(p); });
  };

  H.Game = Game;
  H.Player = Player;
  H.STREETS = STREETS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;

/* ---------- 직렬화 (진행 중인 게임 저장/복원) ---------- */
(function (global) {
  const H = global.Holdem;
  const Game = H.Game;

  function cardsOut(arr) {
    return arr.map(function (c) { return { rank: c.rank, suit: c.suit }; });
  }

  Game.prototype.toJSON = function () {
    return {
      v: 1,
      seed: this.seed,
      rngState: typeof this.rng.state === 'number' ? this.rng.state : null,
      levels: this.levels,
      levelIndex: this.levelIndex,
      levelEvery: this.levelEvery,
      anteMode: this.anteMode,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      ante: this.ante,
      allowRebuy: this.allowRebuy,
      rebuyChips: this.rebuyChips,
      rebuyUntilLevel: this.rebuyUntilLevel,
      addonChips: this.addonChips,
      addonTaken: this.addonTaken,
      actionClock: this.actionClock,
      timeBank: this.timeBank,
      alwaysShow: this.alwaysShow,
      askShowChoice: this.askShowChoice,
      startingField: this.startingField,
      finished: this.finished,
      button: this.button,
      handNo: this.handNo,
      phase: this.phase,
      street: this.street,
      community: cardsOut(this.community),
      deck: cardsOut(this.deck),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      actor: this.actor,
      revealAll: this.revealAll,
      raisesThisStreet: this.raisesThisStreet,
      lastAggressorId: this.lastAggressorId,
      results: this.results,
      handActions: this.handActions.map(function (a) {
        const o = {};
        Object.keys(a).forEach(function (k) { if (k !== 'cards') o[k] = a[k]; });
        o.cards = cardsOut(a.cards || []);
        return o;
      }),
      log: this.log.map(function (e) { return { hand: e.hand, key: e.key, params: e.params, kind: e.kind }; }),
      players: this.players.map(function (p) {
        return {
          id: p.id, name: p.name, chips: p.chips, isHuman: p.isHuman,
          profileKey: p.profile ? p.profile.key : null,
          avatar: p.avatar,
          cards: cardsOut(p.cards),
          bet: p.bet, totalBet: p.totalBet,
          folded: p.folded, allIn: p.allIn, acted: p.acted, raiseClosed: !!p.raiseClosed, mucked: p.mucked,
          lastActionKey: p.lastActionKey, lastActionAmount: p.lastActionAmount || 0, won: p.won, rebuys: p.rebuys,
          timeBankLeft: p.timeBankLeft, bustStack: p.bustStack
        };
      })
    };
  };

  Game.fromJSON = function (obj, opts) {
    opts = opts || {};
    const rng = H.rng.create(obj.seed || H.rng.randomSeed());
    if (obj.rngState != null) rng.state = obj.rngState;

    const g = new Game({
      rng: rng, seed: obj.seed, levels: obj.levels, levelEvery: obj.levelEvery,
      anteMode: obj.anteMode, allowRebuy: obj.allowRebuy, rebuyChips: obj.rebuyChips,
      rebuyUntilLevel: obj.rebuyUntilLevel, addonChips: obj.addonChips, actionClock: obj.actionClock,
      timeBank: obj.timeBank, alwaysShow: obj.alwaysShow, askShowChoice: obj.askShowChoice,
      onEvent: opts.onEvent
    });
    g.levelIndex = obj.levelIndex || 0;
    g.addonTaken = obj.addonTaken || {};
    g.smallBlind = obj.smallBlind;
    g.bigBlind = obj.bigBlind;
    g.ante = obj.ante || 0;
    g.startingField = obj.startingField || (obj.players || []).length;
    g.finished = obj.finished || [];
    g.button = obj.button;
    g.handNo = obj.handNo;
    g.phase = obj.phase;
    g.street = obj.street;
    g.community = (obj.community || []).slice();
    g.deck = (obj.deck || []).slice();
    g.currentBet = obj.currentBet;
    g.minRaise = obj.minRaise;
    g.actor = obj.actor;
    g.revealAll = obj.revealAll;
    g.raisesThisStreet = obj.raisesThisStreet || 0;
    g.lastAggressorId = obj.lastAggressorId != null ? obj.lastAggressorId : null;
    g.results = obj.results || null;
    g.handActions = obj.handActions || [];

    const profiles = {};
    if (H.ai) H.ai.PROFILES.forEach(function (pr) { profiles[pr.key] = pr; });

    g.players = (obj.players || []).map(function (s) {
      const p = new H.Player({
        id: s.id, name: s.name, chips: s.chips, isHuman: s.isHuman,
        profile: s.profileKey ? profiles[s.profileKey] : null, avatar: s.avatar
      });
      p.cards = s.cards.slice();
      p.bet = s.bet; p.totalBet = s.totalBet;
      p.folded = s.folded; p.allIn = s.allIn; p.acted = s.acted; p.raiseClosed = !!s.raiseClosed; p.mucked = s.mucked;
      p.lastActionKey = s.lastActionKey || '';
      p.lastActionAmount = s.lastActionAmount || 0;
      p.lastAction = p.lastActionKey ? H.i18n.t(p.lastActionKey) + (p.lastActionAmount ? ' ' + p.lastActionAmount : '') : '';
      p.won = s.won; p.rebuys = s.rebuys || 0;
      p.timeBankLeft = s.timeBankLeft || 0;
      p.bustStack = s.bustStack || s.chips;
      if (p.folded || g.phase === 'hand-over') p.handResult = null;
      return p;
    });

    (obj.log || []).forEach(function (e) {
      const entry = { hand: e.hand, key: e.key, params: e.params, kind: e.kind };
      Object.defineProperty(entry, 'text', {
        get: function () { return H.i18n.t(this.key, this.params); },
        enumerable: true
      });
      g.log.push(entry);
    });

    // 쇼다운이 끝난 상태로 복원되면 핸드 결과 표시를 위해 평가를 다시 붙인다
    if (g.phase === 'hand-over' && g.community.length === 5) {
      g.players.forEach(function (p) {
        if (!p.folded && p.cards.length === 2) {
          p.handResult = H.eval.evaluate(p.cards.concat(g.community));
        }
      });
    }
    if (g.phase === 'awaiting-action') g.startClock();
    return g;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
