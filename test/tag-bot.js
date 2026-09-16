/*
 * tag-bot.js - 벤치마크용 고정 규칙 상대 봇들
 *
 * 기본은 TAG(타이트-어그레시브). 그 밖에 lag · station · rock · balanced 를 style 로 고른다.
 * 모두 난수는 벤치마크가 넘겨주는 시드 rng 만 쓴다(재현 가능).
 *
 * AI 가 "실제로 강한지"를 재는 자(尺)다. 규칙이 고정되어 있고 난수를 쓰지 않으므로
 * AI 를 고칠 때마다 같은 상대와 같은 카드로 다시 잴 수 있다.
 *
 *   프리플랍  포지션별 타이트 오픈 · 3벳은 프리미엄만 · 림프 없음
 *   포스트플랍 보드 위 강도 백분위(상위 몇 %)로 밸류 벳 / 콜 / 폴드,
 *             드로우는 팟 오즈가 맞을 때만 콜, 프리플랍 어그레서면 플랍 C벳
 *
 * 일부러 착취할 구석을 남겨 두었다(블러프에 접는다, 밸류 이하로는 레이즈하지 않는다).
 * 레인지를 읽는 AI 라면 여기서 이겨야 한다.
 */
const H = require('../js/engine.js');
require('../js/ai.js');
require('../js/equity.js');
require('../js/ranges.js');
require('../js/preflop.js');
require('../js/i18n.js');

const R = H.ranges, E = H.equity;

/* 풀링(7~9인) 포지션 포함. 앞자리일수록 타이트 */
const OPEN = { UTG: 0.12, UTG1: 0.13, MP: 0.15, LJ: 0.17, HJ: 0.19, CO: 0.22, BTN: 0.32, SB: 0.28, BB: 0.30 };
const CALL_OPEN = { UTG: 0.10, UTG1: 0.10, MP: 0.10, LJ: 0.11, HJ: 0.11, CO: 0.12, BTN: 0.14, SB: 0.09, BB: 0.20 };

function preflop(g, p, a, pos) {
  const pct = R.percentile(R.classOf(p.cards[0], p.cards[1]));
  const bb = g.bigBlind;
  const raises = g.raisesThisStreet;
  const stackBb = (p.chips + p.bet) / bb;

  if (stackBb <= 12) {
    const push = (pos === 'BTN' || pos === 'CO') ? 0.25 : 0.15;
    if (pct <= push && a.canRaise) return { type: 'raise', amount: a.maxRaiseTo };
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }

  if (raises <= 1) {
    if (pct <= OPEN[pos] && a.canRaise) {
      let limpers = 0;
      g.handActions.forEach(function (x) { if (x.street === 'preflop' && x.type === 'call') limpers++; });
      const to = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, bb * (3 + limpers)));
      return { type: 'raise', amount: to };
    }
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }

  if (raises === 2) {
    if (pct <= 0.04 && a.canRaise) {
      return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, g.currentBet * 3)) };
    }
    if (pct <= CALL_OPEN[pos]) return { type: 'call' };
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }

  if (pct <= 0.015 && a.canRaise) return { type: 'raise', amount: a.maxRaiseTo };
  if (pct <= 0.04) return { type: 'call' };
  return a.canCheck ? { type: 'check' } : { type: 'fold' };
}

function betTo(g, a, pot, frac) {
  const t = g.currentBet + Math.round((pot + a.toCall) * frac);
  return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, t)) };
}

function postflop(g, p, a) {
  const hole = [H.cards.code(p.cards[0]), H.cards.code(p.cards[1])];
  const board = g.community.map(H.cards.code);
  const dist = E.boardDistribution(board, hole);
  const s = E.pctOfValue(dist, H.eval.score(p.cards.concat(g.community)));   // 상위 s (작을수록 강함)
  const pot = g.totalPot();
  const potOdds = a.toCall > 0 ? a.toCall / (pot + a.toCall) : 0;
  const wasAggressor = g.lastAggressorId === p.id;

  if (s <= 0.20) {
    if (a.canRaise && (a.canCheck || s <= 0.08)) return betTo(g, a, pot, 0.66);
    return a.canCheck ? { type: 'check' } : { type: 'call' };
  }

  if (g.street !== 'river') {
    const d = E.analyzeDraws(p.cards, g.community);
    if (d.outs >= 8) {
      const chance = g.street === 'flop' ? d.byRiver : d.oneCard;
      if (a.canCheck) return { type: 'check' };
      return potOdds <= chance ? { type: 'call' } : { type: 'fold' };
    }
  }

  if (s <= 0.45) {
    if (a.canCheck) return { type: 'check' };
    return potOdds <= 0.30 ? { type: 'call' } : { type: 'fold' };
  }

  if (a.canCheck) {
    if (g.street === 'flop' && wasAggressor && a.canRaise && g.activePlayers().length === 2) {
      return betTo(g, a, pot, 0.5);
    }
    return { type: 'check' };
  }
  return { type: 'fold' };
}

/* ---------- 다른 성향들 ---------- */
function strengthOf(g, p) {
  const hole = [H.cards.code(p.cards[0]), H.cards.code(p.cards[1])];
  const board = g.community.map(H.cards.code);
  const dist = E.boardDistribution(board, hole);
  return E.pctOfValue(dist, H.eval.score(p.cards.concat(g.community)));
}
function drawOf(g, p) {
  if (g.street === 'river') return { outs: 0, chance: 0 };
  const d = E.analyzeDraws(p.cards, g.community);
  return { outs: d.outs, chance: g.street === 'flop' ? d.byRiver : d.oneCard };
}
function isAggressor(g, p) { return g.lastAggressorId === p.id; }

/* LAG: 넓게 열고 3벳·C벳·배럴·블러프 레이즈가 잦다 */
const LAG_OPEN = { UTG: 0.22, UTG1: 0.24, MP: 0.27, LJ: 0.30, HJ: 0.34, CO: 0.40, BTN: 0.55, SB: 0.45, BB: 0.45 };
function lagPre(g, p, a, pos, rng) {
  const pct = R.percentile(R.classOf(p.cards[0], p.cards[1]));
  const bb = g.bigBlind, raises = g.raisesThisStreet;
  const info = R.INFO[R.classOf(p.cards[0], p.cards[1])];
  if (raises <= 1) {
    if (pct <= LAG_OPEN[pos] && a.canRaise) return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, bb * 3)) };
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }
  if (raises === 2) {
    const bluff = info.suited && pct <= 0.30 && rng() < 0.5;
    if ((pct <= 0.08 || bluff) && a.canRaise) return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, g.currentBet * 3)) };
    if (pct <= 0.22) return { type: 'call' };
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }
  if (pct <= 0.03 && a.canRaise) return { type: 'raise', amount: a.maxRaiseTo };
  if (pct <= 0.08) return { type: 'call' };
  return a.canCheck ? { type: 'check' } : { type: 'fold' };
}
function lagPost(g, p, a, rng) {
  const s = strengthOf(g, p), d = drawOf(g, p), pot = g.totalPot();
  const potOdds = a.toCall > 0 ? a.toCall / (pot + a.toCall) : 0;
  if (a.canCheck) {
    if (s <= 0.30 || d.outs >= 8 || (isAggressor(g, p) && rng() < 0.85) || rng() < 0.25) {
      return a.canRaise ? betTo(g, a, pot, 0.66) : { type: 'check' };
    }
    return { type: 'check' };
  }
  if (s <= 0.10 && a.canRaise) return betTo(g, a, pot, 1.0);
  if (d.outs >= 8 && a.canRaise && rng() < 0.4) return betTo(g, a, pot, 1.0);   // 세미블러프 레이즈
  if (s <= 0.50 || d.outs >= 6) return { type: 'call' };
  if (rng() < 0.2 && potOdds < 0.3) return { type: 'call' };
  return { type: 'fold' };
}

/* 콜링스테이션: 넓게 콜, 어지간하면 안 접고, 레이즈는 거의 없다 */
function stationPre(g, p, a, pos) {
  const pct = R.percentile(R.classOf(p.cards[0], p.cards[1]));
  const bb = g.bigBlind, raises = g.raisesThisStreet;
  if (raises <= 1) {
    if (pct <= 0.12 && a.canRaise) return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, bb * 3)) };
    if (pct <= 0.55) return a.canCheck ? { type: 'check' } : { type: 'call' };   // 림프
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }
  if (pct <= 0.01 && a.canRaise) return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, g.currentBet * 3)) };
  if (pct <= (raises === 2 ? 0.55 : 0.20)) return { type: 'call' };
  return a.canCheck ? { type: 'check' } : { type: 'fold' };
}
function stationPost(g, p, a) {
  const s = strengthOf(g, p), d = drawOf(g, p), pot = g.totalPot();
  if (a.canCheck) return (s <= 0.10 && a.canRaise) ? betTo(g, a, pot, 0.5) : { type: 'check' };
  if (s <= 0.65 || d.outs >= 4) return { type: 'call' };
  return { type: 'fold' };
}

/* 락(니트): 프리미엄만, 포스트플랍도 강할 때만 */
function rockPre(g, p, a, pos) {
  const pct = R.percentile(R.classOf(p.cards[0], p.cards[1]));
  const bb = g.bigBlind, raises = g.raisesThisStreet;
  if (raises <= 1) {
    if (pct <= 0.08 && a.canRaise) return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, bb * 3)) };
    return a.canCheck ? { type: 'check' } : { type: 'fold' };
  }
  if (pct <= 0.03 && a.canRaise) return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, g.currentBet * 3)) };
  if (pct <= 0.06) return { type: 'call' };
  return a.canCheck ? { type: 'check' } : { type: 'fold' };
}
function rockPost(g, p, a) {
  const s = strengthOf(g, p), pot = g.totalPot();
  if (a.canCheck) return (s <= 0.12 && a.canRaise) ? betTo(g, a, pot, 0.66) : { type: 'check' };
  if (s <= 0.05 && a.canRaise) return betTo(g, a, pot, 1.0);
  if (s <= 0.25) return { type: 'call' };
  return { type: 'fold' };
}

/* 밸런스드: 프리플랍은 솔버 표(혼합 전략), 포스트플랍은 양극 정책(밸류 + 블러프 빈도) */
function balancedPre(g, p, a, pos, rng) {
  if (!H.preflop || !H.preflop.available()) return preflop(g, p, a, pos);
  const n = g.players.length;
  const sit = H.preflop.situationOf(g, p);
  const cls = R.classOf(p.cards[0], p.cards[1]);
  const f = H.preflop.freq(n, pos, sit.sit, cls);
  if (!f) return preflop(g, p, a, pos);
  const bb = g.bigBlind;
  let raise = f.raise, call = f.call;
  if (sit.cold) { call *= 0.5; raise *= 0.6; }
  const u = rng();
  if (u < raise && a.canRaise) {
    const inBlinds = pos === 'SB' || pos === 'BB';
    let target;
    if (sit.raises <= 1) target = bb * (pos === 'SB' ? 3 : 2.5);
    else if (sit.raises === 2) target = g.currentBet * (inBlinds ? 3.5 : 3);
    else if (sit.raises === 3) target = g.currentBet * 2.3;
    else target = a.maxRaiseTo;
    return { type: 'raise', amount: Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, Math.round(target))) };
  }
  if (u < raise + call) return a.canCheck ? { type: 'check' } : { type: 'call' };
  return a.canCheck ? { type: 'check' } : { type: 'fold' };
}
function balancedPost(g, p, a, rng) {
  const s = strengthOf(g, p), d = drawOf(g, p), pot = g.totalPot();
  const potOdds = a.toCall > 0 ? a.toCall / (pot + a.toCall) : 0;
  const river = g.street === 'river';
  if (a.canCheck) {
    const value = s <= (river ? 0.22 : 0.28);
    const bluff = river ? (s > 0.6 && rng() < 0.3) : (d.outs >= 8 ? rng() < 0.6 : (s > 0.6 && rng() < 0.35));
    if ((value || bluff) && a.canRaise) return betTo(g, a, pot, 0.66);
    return { type: 'check' };
  }
  if (s <= 0.07 && a.canRaise) return betTo(g, a, pot, 1.0);
  if (!river && d.outs >= 8 && a.canRaise && rng() < 0.3) return betTo(g, a, pot, 1.0);
  if (s <= 0.40) return { type: 'call' };
  if (!river && d.outs >= 6 && potOdds <= d.chance + 0.08) return { type: 'call' };
  if (s <= 0.55 && potOdds < 0.28 && rng() < 0.4) return { type: 'call' };   // 블러프 캐치
  return { type: 'fold' };
}

const STYLES = {
  tag: { pre: function (g, p, a, pos) { return preflop(g, p, a, pos); }, post: function (g, p, a) { return postflop(g, p, a); } },
  lag: { pre: lagPre, post: lagPost },
  station: { pre: stationPre, post: stationPost },
  rock: { pre: rockPre, post: rockPost },
  balanced: { pre: balancedPre, post: balancedPost }
};

function decide(g, p, style, rng) {
  const st = STYLES[style || 'tag'] || STYLES.tag;
  const r = rng || Math.random;
  const a = g.actionsFor(p);
  const pos = R.positionOf(g.players.indexOf(p), g.button, g.players.length);
  let d = g.street === 'preflop' ? st.pre(g, p, a, pos, r) : st.post(g, p, a, r);
  if (d.type === 'check' && !a.canCheck) d = { type: 'fold' };
  if (d.type === 'raise' && !a.canRaise) d = { type: a.canCheck ? 'check' : 'call' };
  if (d.type === 'fold' && a.canCheck) d = { type: 'check' };
  return d;
}

/**
 * AI 와 TAG 를 번갈아 앉혀(포지션 편향 제거) 스택을 매 핸드 100bb 로 되돌리며
 * hands 핸드를 돌린다. AI 쪽의 한 자리당 bb/100 을 돌려준다.
 * players 기본 4 (AI 2 · TAG 2). 9 이면 AI 5 · TAG 4 — 버튼이 돌아가므로 공평하다.
 */
function benchmark(opts) {
  const BB = 20, START = BB * 100;
  const difficulty = opts.difficulty, hands = opts.hands;
  const players = opts.players || 4;
  const style = opts.style || 'tag';
  const botRng = H.rng.create((opts.seed || 4242) * 7 + 3);
  const g = new H.Game({ smallBlind: BB / 2, bigBlind: BB, rng: H.rng.create(opts.seed || 4242) });
  const kinds = [];
  for (let i = 0; i < players; i++) kinds.push(i % 2 === 0 ? 'ai' : 'tag');
  const nAi = kinds.filter(function (k) { return k === 'ai'; }).length;
  kinds.forEach(function (k, i) {
    g.addPlayer({ id: i, name: k + i, chips: START, profile: H.ai.PROFILES[1] });
  });
  const tracker = H.stats.create({ bigBlind: BB });
  let aiNet = 0;
  for (let h = 0; h < hands; h++) {
    g.players.forEach(function (p) { p.chips = START; });
    g.startHand();
    tracker.startHand(g);
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 300) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        const d = kinds[p.id] === 'ai'
          ? H.ai.decide(g, p, { difficulty: difficulty, tracker: tracker })
          : decide(g, p, style, botRng);
        const res = g.act(p.id, d);
        if (!res.ok) throw new Error(kinds[p.id] + ' 가 불가능한 액션: ' + JSON.stringify(d) + ' / ' + res.error);
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    tracker.endHand(g);
    g.players.forEach(function (p) { if (kinds[p.id] === 'ai') aiNet += p.chips - START; });
  }
  return { bb100: aiNet / BB / (hands * nAi) * 100, tracker: tracker, players: players, style: style };
}

module.exports = { decide: decide, benchmark: benchmark, STYLES: Object.keys(STYLES) };
