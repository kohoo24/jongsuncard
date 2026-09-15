/*
 * history.js - 핸드 기록과 리플레이
 *
 * 핸드가 끝날 때마다 전체 상태를 저장하고, 스트리트/액션 단위로 되감아 볼 수
 * 있는 스텝 목록을 만들어 준다. 텍스트로 내보내기도 지원한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./cards.js'); require('./i18n.js'); require('./evaluator.js'); }
  const T = function (k, p) { return H.i18n.t(k, p); };
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const STREET_CARDS = { preflop: 0, flop: 3, turn: 4, river: 5 };

  function Recorder(opts) {
    opts = opts || {};
    this.hands = [];
    this.limit = opts.limit || 200;
  }

  /** 핸드 종료 직후 호출한다 */
  Recorder.prototype.record = function (game, extra) {
    const rec = {
      no: game.handNo,
      seed: game.seed,
      level: game.levelIndex + 1,
      sb: game.smallBlind,
      bb: game.bigBlind,
      ante: game.ante,
      button: game.button,
      street: game.street,
      community: game.community.map(function (c) { return { rank: c.rank, suit: c.suit }; }),
      seats: game.players.map(function (p, i) {
        return {
          id: p.id, name: p.name, isHuman: p.isHuman, seat: i,
          profile: p.profile ? p.profile.key : null,
          chipsEnd: p.chips,
          chipsStart: p.chips - p.won + p.totalBet,
          cards: p.cards.map(function (c) { return { rank: c.rank, suit: c.suit }; }),
          folded: p.folded, mucked: p.mucked, won: p.won, totalBet: p.totalBet,
          position: H.ranges ? H.ranges.positionOf(i, game.button, game.players.length) : ''
        };
      }),
      actions: game.handActions.map(function (a) {
        return {
          playerId: a.playerId, street: a.street, type: a.type, amount: a.amount,
          paid: a.paid, toCall: a.toCall, potBefore: a.potBefore,
          currentBetBefore: a.currentBetBefore, raisesBefore: a.raisesBefore,
          allIn: a.allIn, timedOut: a.timedOut,
          think: a.think ? { equity: a.think.equity, plan: a.think.plan, potOdds: a.think.potOdds } : null
        };
      }),
      pot: game.totalPot(),
      results: game.results ? JSON.parse(JSON.stringify(game.results)) : null,
      review: (extra && extra.review) || null,
      time: Date.now()
    };
    this.hands.push(rec);
    if (this.hands.length > this.limit) this.hands.shift();
    return rec;
  };

  Recorder.prototype.length = function () { return this.hands.length; };
  Recorder.prototype.get = function (i) { return this.hands[i]; };
  Recorder.prototype.last = function () { return this.hands[this.hands.length - 1]; };
  Recorder.prototype.forPlayer = function (id) {
    return this.hands.filter(function (h) {
      return h.seats.some(function (s) { return s.id === id; });
    });
  };

  /* 히어로 기준 손익 */
  Recorder.prototype.netOf = function (hand, id) {
    const seat = hand.seats.filter(function (s) { return s.id === id; })[0];
    if (!seat) return 0;
    return seat.won - seat.totalBet;
  };

  /**
   * 리플레이 스텝 생성.
   * 각 스텝은 그 시점의 보드/팟/베팅 상태를 담는다.
   */
  function buildReplay(hand) {
    const steps = [];
    const bets = {};
    const committed = {};
    hand.seats.forEach(function (s) { bets[s.id] = 0; committed[s.id] = 0; });

    /* 앤티 + 블라인드 */
    const firstActionPot = hand.actions.length ? hand.actions[0].potBefore : hand.pot;
    steps.push({
      kind: 'start',
      street: 'preflop',
      community: [],
      pot: firstActionPot,
      bets: Object.assign({}, bets),
      label: T('log.handStart', {
        n: hand.no, sb: hand.sb, bb: hand.bb,
        ante: hand.ante ? T('log.anteSuffix', { a: hand.ante }) : ''
      })
    });

    let pot = firstActionPot;
    STREETS.forEach(function (st, idx) {
      const need = STREET_CARDS[st];
      const actions = hand.actions.filter(function (a) { return a.street === st; });
      if (idx > 0) {
        if (hand.community.length < need) return;
        Object.keys(bets).forEach(function (k) { bets[k] = 0; });
        steps.push({
          kind: 'street',
          street: st,
          community: hand.community.slice(0, need),
          pot: pot,
          bets: Object.assign({}, bets),
          label: T('log.street', {
            street: T('street.' + st),
            cards: hand.community.slice(0, need).map(H.cards.cardToString).join(' ')
          })
        });
      }
      actions.forEach(function (a) {
        const seat = hand.seats.filter(function (s) { return s.id === a.playerId; })[0];
        const name = seat ? seat.name : '?';
        if (a.type === 'fold') {
          steps.push(makeStep('fold', st, need, pot, bets, T('log.fold', { name: name }), a));
        } else if (a.type === 'check') {
          steps.push(makeStep('check', st, need, pot, bets, T('log.check', { name: name }), a));
        } else {
          bets[a.playerId] = a.amount;
          pot += a.paid;
          const key = a.type === 'call'
            ? (a.allIn ? 'log.callAllIn' : 'log.call')
            : (a.allIn ? 'log.betAllIn' : (a.currentBetBefore === 0 ? 'log.bet' : 'log.raise'));
          const amount = a.type === 'call' ? a.paid : a.amount;
          steps.push(makeStep(a.type, st, need, pot, bets, T(key, { name: name, amount: amount }), a));
        }
      });

      function makeStep(kind, street, cards, potNow, betsNow, label, act) {
        return {
          kind: kind, street: street,
          community: hand.community.slice(0, cards),
          pot: potNow, bets: Object.assign({}, betsNow),
          actor: act.playerId, label: label
        };
      }
    });

    /* 결과 */
    if (hand.results) {
      const winners = hand.results.winners.map(function (w) {
        return w.desc ? T('table.winsWith', { name: w.name, amount: w.amount, desc: w.desc })
          : T('table.wins', { name: w.name, amount: w.amount });
      }).join('   ');
      steps.push({
        kind: 'result',
        street: hand.street,
        community: hand.community.slice(),
        pot: hand.pot,
        bets: {},
        reveal: true,
        label: winners
      });
    }
    return steps;
  }

  /** 텍스트로 내보내기 */
  function toText(hand) {
    const lines = [];
    lines.push('=== ' + T('hist.handNo', { n: hand.no }) + ' (' + hand.sb + '/' + hand.bb +
      (hand.ante ? ' ante ' + hand.ante : '') + ') ===');
    hand.seats.forEach(function (s) {
      const cards = s.cards.length && (!s.mucked || s.isHuman)
        ? s.cards.map(H.cards.cardToString).join(' ') : '??';
      lines.push('  ' + (s.seat === hand.button ? '[D] ' : '    ') +
        s.name + ' (' + s.position + ') ' + s.chipsStart.toLocaleString() + ' : ' + cards);
    });
    let cur = null;
    hand.actions.forEach(function (a) {
      if (a.street !== cur) {
        cur = a.street;
        const n = STREET_CARDS[cur];
        lines.push('-- ' + T('street.' + cur) +
          (n ? ': ' + hand.community.slice(0, n).map(H.cards.cardToString).join(' ') : ''));
      }
      const seat = hand.seats.filter(function (s) { return s.id === a.playerId; })[0];
      const label = a.type === 'raise' ? T('act.raise') + ' ' + a.amount
        : a.type === 'call' ? T('act.call') + ' ' + a.paid
          : T('act.' + a.type);
      lines.push('   ' + (seat ? seat.name : '?') + ' ' + label + (a.allIn ? ' (all in)' : ''));
    });
    if (hand.results) {
      lines.push('-- ' + (hand.results.uncontested ? T('hist.winner') : T('street.showdown')));
      hand.results.winners.forEach(function (w) {
        lines.push('   ' + w.name + ' +' + w.amount.toLocaleString() + (w.desc ? ' (' + w.desc + ')' : ''));
      });
    }
    return lines.join('\n');
  }

  Recorder.prototype.exportAll = function () {
    return this.hands.map(toText).join('\n\n');
  };
  Recorder.prototype.toJSON = function () { return { hands: this.hands }; };
  Recorder.fromJSON = function (obj) {
    const r = new Recorder();
    r.hands = (obj && obj.hands) || [];
    return r;
  };

  H.history = {
    Recorder: Recorder,
    create: function (opts) { return new Recorder(opts); },
    buildReplay: buildReplay,
    toText: toText,
    STREET_CARDS: STREET_CARDS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
