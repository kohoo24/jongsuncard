/*
 * stats.js - 플레이어 통계 추적
 *
 * 핸드가 끝날 때마다 액션 기록을 훑어 표준 포커 지표를 누적한다.
 * 화면의 통계 패널과, 고급 난이도 AI 의 상대 프로파일링이 같은 데이터를 쓴다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  function blank() {
    return {
      hands: 0,
      vpip: 0,          // 프리플랍에 자발적으로 칩을 넣은 핸드 수
      pfr: 0,           // 프리플랍 레이즈 핸드 수
      threeBetOpp: 0, threeBet: 0,
      cbetOpp: 0, cbet: 0,   // 프리플랍 어그레서로 플랍에서 먼저 벳할 기회 / 실제 C벳
      bets: 0,          // 벳/레이즈 횟수
      calls: 0,         // 콜 횟수
      facedBet: 0, foldedToBet: 0,
      facedBetPre: 0, foldedToBetPre: 0,
      facedBetPost: 0, foldedToBetPost: 0,
      sawFlop: 0, showdown: 0, wonShowdown: 0,
      wonHands: 0,
      net: 0,
      chipsStart: 0,
      initialChips: null   // 세션 첫 핸드 시작 시의 스택 (그래프 기준선)
    };
  }

  function Tracker(opts) {
    opts = opts || {};
    this.bigBlind = opts.bigBlind || 20;
    this.data = {};
    this.names = {};
    this.chipHistory = {};   // id -> [{hand, chips}]
    this.ids = [];           // 원래 타입 그대로의 id (Object.keys 는 문자열로 바꿔 버린다)
    this.handCount = 0;
  }

  Tracker.prototype.ensure = function (id, name) {
    if (!this.data[id]) {
      this.data[id] = blank();
      this.chipHistory[id] = [];
      this.ids.push(id);
    }
    if (name) this.names[id] = name;
    return this.data[id];
  };

  Tracker.prototype.startHand = function (game) {
    const self = this;
    game.players.forEach(function (p) {
      const d = self.ensure(p.id, p.name);
      d.chipsStart = p.chips + p.totalBet;
      if (d.initialChips == null) d.initialChips = d.chipsStart;
    });
  };

  Tracker.prototype.endHand = function (game) {
    const self = this;
    this.handCount = game.handNo;
    const reachedFlop = game.community.length >= 3;
    const wentToShowdown = !!(game.results && !game.results.uncontested);

    /* 프리플랍 어그레서 = 마지막 프리플랍 레이저 */
    let pfrId = null, pfrRaises = -1;
    game.handActions.forEach(function (a) {
      if (a.street === 'preflop' && a.type === 'raise' && a.raisesBefore > pfrRaises) { pfrRaises = a.raisesBefore; pfrId = a.playerId; }
    });

    game.players.forEach(function (p) {
      const d = self.ensure(p.id, p.name);
      const acts = game.actionsOf(p.id);
      if (!acts.length && p.totalBet === 0) return;   // 참여하지 않은 핸드

      d.hands++;

      /* C벳: 어그레서가 플랍에서 아직 벳이 없을 때 처음 행동한 경우 */
      if (p.id === pfrId) {
        const firstFlop = acts.filter(function (a) { return a.street === 'flop'; })[0];
        if (firstFlop && firstFlop.currentBetBefore === 0) {
          d.cbetOpp = (d.cbetOpp || 0) + 1;
          if (firstFlop.type === 'raise') d.cbet = (d.cbet || 0) + 1;
        }
      }

      const pre = acts.filter(function (a) { return a.street === 'preflop'; });
      let voluntary = false, raisedPre = false, foldedPre = false;
      pre.forEach(function (a) {
        if (a.type === 'raise') { voluntary = true; raisedPre = true; }
        else if (a.type === 'call') voluntary = true;
        else if (a.type === 'fold') foldedPre = true;
        if (a.raisesBefore === 2) {
          d.threeBetOpp++;
          if (a.type === 'raise') d.threeBet++;
        }
      });
      if (voluntary) d.vpip++;
      if (raisedPre) d.pfr++;

      acts.forEach(function (a) {
        if (a.type === 'raise') d.bets++;
        else if (a.type === 'call') d.calls++;
        if (a.toCall > 0) {
          const folded = a.type === 'fold';
          d.facedBet++;
          if (folded) d.foldedToBet++;
          if (a.street === 'preflop') {
            d.facedBetPre++;
            if (folded) d.foldedToBetPre++;
          } else {
            d.facedBetPost++;
            if (folded) d.foldedToBetPost++;
          }
        }
      });

      if (reachedFlop && !foldedPre) d.sawFlop++;
      if (wentToShowdown && !p.folded) {
        d.showdown++;
        if (p.won > 0) d.wonShowdown++;
      }
      if (p.won > 0) d.wonHands++;

      const end = p.chips;
      d.net += end - d.chipsStart;
      const hist = self.chipHistory[p.id];
      hist.push({ hand: game.handNo, chips: end });
      if (hist.length > 500) hist.shift();
    });
  };

  function pct(a, b) { return b > 0 ? a / b : 0; }

  Tracker.prototype.get = function (id) {
    const d = this.data[id];
    if (!d) return null;
    return {
      id: id,
      name: this.names[id] || String(id),
      hands: d.hands,
      vpip: pct(d.vpip, d.hands),
      pfr: pct(d.pfr, d.hands),
      threeBet: pct(d.threeBet, d.threeBetOpp),
      cbetFlop: pct(d.cbet || 0, d.cbetOpp || 0),
      af: d.calls > 0 ? d.bets / d.calls : (d.bets > 0 ? d.bets : 0),
      foldToBet: pct(d.foldedToBet, d.facedBet),
      foldToBetPre: pct(d.foldedToBetPre, d.facedBetPre),
      foldToBetPost: pct(d.foldedToBetPost, d.facedBetPost),
      wtsd: pct(d.showdown, d.sawFlop),
      wsd: pct(d.wonShowdown, d.showdown),
      winRate: pct(d.wonHands, d.hands),
      net: d.net,
      initialChips: d.initialChips,
      bb100: d.hands > 0 ? (d.net / this.bigBlind) / d.hands * 100 : 0,
      samples: {
        cbetOpp: d.cbetOpp || 0,
        facedBet: d.facedBet, facedBetPre: d.facedBetPre, facedBetPost: d.facedBetPost,
        threeBetOpp: d.threeBetOpp, showdown: d.showdown
      }
    };
  };

  /* 추적 중인 플레이어들의 평균 VPIP (프로파일링 보정의 자체 기준선) */
  Tracker.prototype.populationVpip = function (excludeId) {
    let sum = 0, n = 0;
    const self = this;
    Object.keys(this.data).forEach(function (id) {
      if (String(id) === String(excludeId)) return;
      const d = self.data[id];
      if (d.hands < 10) return;
      sum += d.vpip / d.hands;
      n++;
    });
    return n > 0 ? sum / n : null;
  };

  Tracker.prototype.all = function () {
    const self = this;
    return this.ids.map(function (id) { return self.get(id); });
  };

  Tracker.prototype.history = function (id) {
    return this.chipHistory[id] || [];
  };

  Tracker.prototype.toJSON = function () {
    /* ids 는 배열로 저장해야 숫자 id 가 살아남는다 (객체 키는 문자열이 된다) */
    return { bigBlind: this.bigBlind, data: this.data, names: this.names,
      chipHistory: this.chipHistory, ids: this.ids, handCount: this.handCount };
  };

  Tracker.fromJSON = function (obj) {
    const t = new Tracker({ bigBlind: obj.bigBlind });
    t.data = obj.data || {};
    t.names = obj.names || {};
    t.chipHistory = obj.chipHistory || {};
    t.ids = obj.ids || Object.keys(t.data);
    t.handCount = obj.handCount || 0;
    return t;
  };

  H.stats = {
    Tracker: Tracker,
    create: function (opts) { return new Tracker(opts); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
