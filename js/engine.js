/*
 * engine.js - 텍사스 홀덤 게임 엔진
 * 블라인드, 베팅 라운드, 사이드팟, 쇼다운까지 규칙 전체를 담당한다.
 * UI는 phase 값을 보고 다음 단계를 진행시킨다.
 *
 *   phase:
 *     'idle'            핸드 시작 전
 *     'awaiting-action' 현재 actor의 액션 대기
 *     'need-street'     다음 커뮤니티 카드를 열어야 함 (dealNextStreet)
 *     'showdown'        쇼다운 처리 필요 (resolveShowdown)
 *     'hand-over'       핸드 종료 (startHand 로 다음 핸드)
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./cards.js'); require('./evaluator.js'); }

  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const STREET_NAMES = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };

  function Player(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.chips = opts.chips;
    this.isHuman = !!opts.isHuman;
    this.profile = opts.profile || null;
    this.cards = [];
    this.bet = 0;        // 현재 스트리트에 넣은 금액
    this.totalBet = 0;   // 이번 핸드에 넣은 총액
    this.folded = false;
    this.allIn = false;
    this.acted = false;
    this.lastAction = '';
    this.handResult = null;
    this.won = 0;
  }

  function Game(opts) {
    opts = opts || {};
    this.players = [];
    this.smallBlind = opts.smallBlind || 10;
    this.bigBlind = opts.bigBlind || 20;
    this.blindUpEvery = opts.blindUpEvery || 0; // 0이면 블라인드 상승 없음
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
    this.log = [];
    this.results = null;
    this.rng = opts.rng || Math.random;
    this.onEvent = opts.onEvent || function () {};
  }

  Game.prototype.addPlayer = function (opts) {
    const p = new Player({
      id: opts.id != null ? opts.id : this.players.length,
      name: opts.name,
      chips: opts.chips,
      isHuman: opts.isHuman,
      profile: opts.profile
    });
    this.players.push(p);
    return p;
  };

  Game.prototype.emit = function (type, data) {
    this.onEvent({ type: type, data: data || {} });
  };

  Game.prototype.say = function (msg, kind) {
    const entry = { hand: this.handNo, text: msg, kind: kind || 'info' };
    this.log.push(entry);
    if (this.log.length > 400) this.log.shift();
    this.emit('log', entry);
  };

  /* ---------- 상태 조회 ---------- */

  Game.prototype.byId = function (id) {
    for (let i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
    return null;
  };

  Game.prototype.activePlayers = function () {
    return this.players.filter(function (p) { return !p.folded; });
  };

  // 아직 베팅 액션이 가능한 플레이어
  Game.prototype.livePlayers = function () {
    return this.players.filter(function (p) { return !p.folded && !p.allIn; });
  };

  Game.prototype.totalPot = function () {
    return this.players.reduce(function (s, p) { return s + p.totalBet; }, 0);
  };

  // 이전 스트리트까지 모인 팟 (현재 스트리트 베팅 제외)
  Game.prototype.mainPot = function () {
    return this.players.reduce(function (s, p) { return s + p.totalBet - p.bet; }, 0);
  };

  Game.prototype.currentActor = function () {
    return this.actor >= 0 ? this.players[this.actor] : null;
  };

  Game.prototype.actionsFor = function (player) {
    const toCall = Math.max(0, Math.min(this.currentBet - player.bet, player.chips));
    const maxRaiseTo = player.bet + player.chips;
    let minRaiseTo = this.currentBet + this.minRaise;
    if (minRaiseTo > maxRaiseTo) minRaiseTo = maxRaiseTo; // 숏스택은 올인만 가능
    return {
      toCall: toCall,
      canCheck: toCall === 0,
      canRaise: player.chips > toCall,
      minRaiseTo: minRaiseTo,
      maxRaiseTo: maxRaiseTo,
      isBet: this.currentBet === 0
    };
  };

  /* ---------- 핸드 진행 ---------- */

  Game.prototype.removeBusted = function () {
    const out = this.players.filter(function (p) { return p.chips <= 0; });
    for (let i = 0; i < out.length; i++) this.say(out[i].name + ' 님이 칩을 모두 잃고 테이블을 떠납니다.', 'bust');
    this.players = this.players.filter(function (p) { return p.chips > 0; });
  };

  Game.prototype.startHand = function () {
    this.removeBusted();
    if (this.players.length < 2) {
      this.phase = 'game-over';
      this.emit('game-over', {});
      return;
    }

    this.handNo++;
    if (this.blindUpEvery && this.handNo > 1 && (this.handNo - 1) % this.blindUpEvery === 0) {
      this.smallBlind *= 2;
      this.bigBlind *= 2;
      this.say('블라인드 상승: ' + this.smallBlind + ' / ' + this.bigBlind, 'blind');
    }

    const n = this.players.length;
    this.button = (this.button + 1) % n;
    this.community = [];
    this.street = 'preflop';
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.revealAll = false;
    this.results = null;

    for (let i = 0; i < n; i++) {
      const p = this.players[i];
      p.cards = []; p.bet = 0; p.totalBet = 0;
      p.folded = false; p.allIn = false; p.acted = false;
      p.lastAction = ''; p.handResult = null; p.won = 0;
    }

    this.deck = H.cards.shuffle(H.cards.makeDeck(), this.rng);
    this.say('--- 핸드 #' + this.handNo + ' 시작 (블라인드 ' + this.smallBlind + '/' + this.bigBlind + ') ---', 'hand');

    // 블라인드 포지션
    const sbIdx = n === 2 ? this.button : (this.button + 1) % n;
    const bbIdx = n === 2 ? (this.button + 1) % n : (this.button + 2) % n;
    const sb = this.players[sbIdx];
    const bb = this.players[bbIdx];
    this.putIn(sb, this.smallBlind);
    sb.lastAction = 'SB';
    this.putIn(bb, this.bigBlind);
    bb.lastAction = 'BB';
    this.currentBet = this.bigBlind;
    this.say(sb.name + ' 스몰블라인드 ' + Math.min(this.smallBlind, sb.totalBet), 'blind');
    this.say(bb.name + ' 빅블라인드 ' + Math.min(this.bigBlind, bb.totalBet), 'blind');

    // 홀카드 2장씩
    for (let round = 0; round < 2; round++) {
      for (let i = 1; i <= n; i++) {
        const p = this.players[(this.button + i) % n];
        p.cards.push(this.deck.pop());
      }
    }

    this.emit('hand-start', { handNo: this.handNo });

    // 첫 액션 위치
    this.actor = n === 2 ? sbIdx : (bbIdx + 1) % n;
    if (this.livePlayers().length < 2) {
      this.phase = 'need-street';
      this.revealAll = true;
    } else {
      // actor가 올인 상태면 다음 사람으로
      this.phase = 'awaiting-action';
      const cur = this.players[this.actor];
      if (cur.folded || cur.allIn) { this.actor = (this.actor - 1 + n) % n; this.advance(); }
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

  Game.prototype.act = function (playerId, action) {
    if (this.phase !== 'awaiting-action') return { ok: false, error: '지금은 액션을 받을 수 없습니다.' };
    const p = this.currentActor();
    if (!p || p.id !== playerId) return { ok: false, error: '차례가 아닙니다.' };

    const a = this.actionsFor(p);
    const type = action.type;

    if (type === 'fold') {
      p.folded = true;
      p.acted = true;
      p.lastAction = '폴드';
      this.say(p.name + ' 폴드', 'fold');
    } else if (type === 'check') {
      if (!a.canCheck) return { ok: false, error: '체크할 수 없습니다.' };
      p.acted = true;
      p.lastAction = '체크';
      this.say(p.name + ' 체크', 'check');
    } else if (type === 'call') {
      if (a.toCall <= 0) return this.act(playerId, { type: 'check' });
      const paid = this.putIn(p, a.toCall);
      p.acted = true;
      p.lastAction = p.allIn ? '올인 콜 ' + paid : '콜 ' + paid;
      this.say(p.name + ' 콜 ' + paid + (p.allIn ? ' (올인)' : ''), 'call');
    } else if (type === 'raise' || type === 'bet' || type === 'allin') {
      if (!a.canRaise) return { ok: false, error: '레이즈할 수 없습니다.' };
      let target = type === 'allin' ? a.maxRaiseTo : Math.round(action.amount);
      if (!isFinite(target)) return { ok: false, error: '금액이 올바르지 않습니다.' };
      if (target > a.maxRaiseTo) target = a.maxRaiseTo;
      if (target < a.minRaiseTo) {
        // 올인이 최소 레이즈보다 작은 경우만 허용
        if (target !== a.maxRaiseTo) target = a.minRaiseTo;
      }
      const prevBet = this.currentBet;
      const paid = this.putIn(p, target - p.bet);
      const raiseBy = p.bet - prevBet;
      if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
      if (p.bet > this.currentBet) {
        this.currentBet = p.bet;
        // 레이즈가 나오면 나머지는 다시 액션해야 한다
        for (let i = 0; i < this.players.length; i++) {
          const o = this.players[i];
          if (o !== p && !o.folded && !o.allIn) o.acted = false;
        }
      }
      p.acted = true;
      const verb = prevBet === 0 ? '벳' : '레이즈';
      p.lastAction = (p.allIn ? '올인 ' : verb + ' ') + p.bet;
      this.say(p.name + ' ' + verb + ' ' + p.bet + (p.allIn ? ' (올인, +' + paid + ')' : ''), 'raise');
    } else {
      return { ok: false, error: '알 수 없는 액션: ' + type };
    }

    this.emit('action', { player: p, type: type });
    this.advance();
    this.emit('state', {});
    return { ok: true };
  };

  Game.prototype.roundComplete = function () {
    if (this.activePlayers().length < 2) return true;
    const live = this.livePlayers();
    const cb = this.currentBet;
    for (let i = 0; i < live.length; i++) {
      if (!live[i].acted || live[i].bet < cb) return false;
    }
    return true;
  };

  Game.prototype.advance = function () {
    const n = this.players.length;
    if (this.activePlayers().length < 2) {
      this.awardUncontested();
      return;
    }
    if (this.roundComplete()) {
      this.closeStreet();
      return;
    }
    let i = this.actor;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      const p = this.players[i];
      if (!p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet)) {
        this.actor = i;
        this.phase = 'awaiting-action';
        this.emit('turn', { player: p });
        return;
      }
    }
    this.closeStreet();
  };

  Game.prototype.closeStreet = function () {
    // 스트리트 종료: 베팅 초기화
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.bet = 0;
      p.acted = false;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actor = -1;

    if (this.livePlayers().length < 2 && this.activePlayers().length > 1) this.revealAll = true;

    if (this.street === 'river') this.phase = 'showdown';
    else this.phase = 'need-street';
    this.emit('street-end', { street: this.street });
  };

  Game.prototype.dealNextStreet = function () {
    if (this.phase !== 'need-street') return;
    const idx = STREETS.indexOf(this.street);
    this.street = STREETS[idx + 1];
    this.deck.pop(); // 버닝 카드
    const count = this.street === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) this.community.push(this.deck.pop());

    const shown = this.community.map(H.cards.cardToString).join(' ');
    this.say(STREET_NAMES[this.street] + ': ' + shown, 'street');
    this.emit('street', { street: this.street });

    if (this.livePlayers().length >= 2) {
      // 버튼 다음부터 첫 액션
      const n = this.players.length;
      this.actor = this.button;
      this.phase = 'awaiting-action';
      this.advance();
      if (this.phase === 'awaiting-action') this.emit('state', {});
    } else {
      this.phase = this.street === 'river' ? 'showdown' : 'need-street';
    }
    this.emit('state', {});
  };

  /* ---------- 팟 분배 ---------- */

  // 사이드팟 계산: [{amount, eligible:[id...]}]
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
        const c = contribs[i];
        amount += Math.max(0, Math.min(c.totalBet, lvl) - prev);
      }
      const eligible = this.players.filter(function (p) {
        return !p.folded && p.totalBet >= lvl;
      }).map(function (p) { return p.id; });
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
    this.say(winner.name + ' 님이 팟 ' + pot + ' 획득 (모두 폴드)', 'win');
    this.results = {
      uncontested: true,
      winners: [{ id: winner.id, name: winner.name, amount: pot, desc: '' }],
      pots: []
    };
    this.phase = 'hand-over';
    this.actor = -1;
    this.emit('hand-end', { results: this.results });
    this.emit('state', {});
  };

  Game.prototype.resolveShowdown = function () {
    if (this.phase !== 'showdown') return;
    this.revealAll = true;

    const self = this;
    const contenders = this.activePlayers();
    for (let i = 0; i < contenders.length; i++) {
      const p = contenders[i];
      p.handResult = H.eval.evaluate(p.cards.concat(this.community));
    }

    const pots = this.buildPots();
    const summary = [];
    const n = this.players.length;

    for (let i = 0; i < pots.length; i++) {
      const pot = pots[i];
      const elig = pot.eligible.map(function (id) { return self.byId(id); })
        .filter(function (p) { return p && !p.folded; });
      if (!elig.length) continue;

      let best = -1;
      for (let k = 0; k < elig.length; k++) best = Math.max(best, elig[k].handResult.value);
      const winners = elig.filter(function (p) { return p.handResult.value === best; });

      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;

      // 홀수 칩은 버튼 다음 자리부터
      const ordered = winners.slice().sort(function (a, b) {
        const ia = (self.players.indexOf(a) - self.button + n) % n;
        const ib = (self.players.indexOf(b) - self.button + n) % n;
        return ia - ib;
      });
      for (let k = 0; k < ordered.length; k++) {
        let amt = share;
        if (remainder > 0) { amt++; remainder--; }
        ordered[k].chips += amt;
        ordered[k].won += amt;
      }

      summary.push({
        label: i === 0 ? '메인 팟' : '사이드 팟 ' + i,
        amount: pot.amount,
        winners: ordered.map(function (p) {
          return { id: p.id, name: p.name, desc: H.eval.describe(p.handResult) };
        })
      });
    }

    for (let i = 0; i < contenders.length; i++) {
      const p = contenders[i];
      this.say(p.name + ': ' + H.cards.cardToString(p.cards[0]) + ' ' + H.cards.cardToString(p.cards[1]) +
        ' → ' + H.eval.describe(p.handResult), 'show');
    }
    for (let i = 0; i < summary.length; i++) {
      const s = summary[i];
      this.say(s.label + ' ' + s.amount + ' → ' + s.winners.map(function (w) {
        return w.name + ' (' + w.desc + ')';
      }).join(', '), 'win');
    }

    const winnersFlat = [];
    for (let i = 0; i < contenders.length; i++) {
      if (contenders[i].won > 0) {
        winnersFlat.push({
          id: contenders[i].id,
          name: contenders[i].name,
          amount: contenders[i].won,
          desc: H.eval.describe(contenders[i].handResult)
        });
      }
    }

    this.results = { uncontested: false, winners: winnersFlat, pots: summary };
    this.phase = 'hand-over';
    this.emit('hand-end', { results: this.results });
    this.emit('state', {});
  };

  H.Game = Game;
  H.STREETS = STREETS;
  H.STREET_NAMES = STREET_NAMES;
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
