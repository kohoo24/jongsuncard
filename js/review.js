/*
 * review.js - 핸드 종료 후 의사결정 리뷰
 *
 * 플레이어가 액션하기 직전에 스냅샷을 찍어, 그 시점의 모든 선택지를
 * EV 와 함께 기록한다. 핸드가 끝나면 실제 선택과 최선의 선택을 비교해
 * "이 결정에서 몇 칩을 흘렸는지"를 보여준다.
 *
 * EV 계산은 AI 와 완전히 같은 코드(H.ai.evaluateOptions)를 쓴다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./ai.js'); require('./i18n.js'); }
  const T = function (k, p) { return H.i18n.t(k, p); };

  /* EV 손실(빅블라인드 단위) -> 판정 */
  const THRESHOLDS = [
    { max: 0.15, verdict: 'good', key: 'review.good', icon: '✓' },
    { max: 0.60, verdict: 'ok', key: 'review.ok', icon: '–' },
    { max: 2.50, verdict: 'mistake', key: 'review.mistake', icon: '⚠' },
    { max: Infinity, verdict: 'blunder', key: 'review.blunder', icon: '✗' }
  ];

  function classify(evLossBb) {
    for (let i = 0; i < THRESHOLDS.length; i++) {
      if (evLossBb < THRESHOLDS[i].max) return THRESHOLDS[i];
    }
    return THRESHOLDS[THRESHOLDS.length - 1];
  }

  /** 후보 목록에서 실제로 한 액션에 해당하는 항목을 찾는다 */
  function matchCandidate(candidates, action) {
    const type = (action.type === 'bet' || action.type === 'allin') ? 'raise' : action.type;
    let best = null, bestDiff = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.type !== type) continue;
      if (type !== 'raise') return c;
      const diff = Math.abs((c.amount || 0) - (action.amount || 0));
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    }
    return best;
  }

  function actionLabel(c) {
    if (!c) return '?';
    if (c.type === 'fold') return T('act.fold');
    if (c.type === 'check') return T('act.check');
    if (c.type === 'call') return T('act.call') + ' ' + (c.amount || 0).toLocaleString();
    return T('act.raise') + ' ' + (c.amount || 0).toLocaleString();
  }

  /**
   * 액션 직전에 호출한다. 실제로 낼 금액을 함께 넘기면 그 금액의 EV 도 계산한다.
   * @returns {object|null} 리뷰 항목
   */
  function evaluate(game, player, action, opts) {
    opts = opts || {};
    const o = H.ai.analyze(game, player, {
      difficulty: opts.difficulty || 'hard',
      tracker: opts.tracker || null,
      profile: opts.profile || null,
      extraSizes: action && action.amount ? [action.amount] : []
    });
    if (!o) return null;

    /*
     * 기준선은 "EV 가 가장 높은 후보"가 아니라 "탄탄한 플레이어라면 했을 선택"이다.
     * 원시 EV 최대값을 쓰면 폴드 에쿼티 때문에 72o 프리플랍 레이즈 같은 것이
     * 정답으로 나온다. AI 와 같은 판단(블러프 마진 포함)을 기준으로 삼는다.
     */
    const baseline = H.ai.decide(game, player, {
      difficulty: opts.difficulty || 'hard',
      tracker: opts.tracker || null,
      profile: H.ai.PROFILES[1],          // 밸런스 성향을 기준으로
      rng: function () { return 0.5; }    // 리뷰는 매번 같은 결과가 나와야 한다
    });
    const best = matchCandidate(o.candidates, baseline) || o.candidates[0];
    const chosen = matchCandidate(o.candidates, action) || { type: action.type, amount: action.amount, ev: 0 };
    const evLoss = Math.max(0, best.ev - chosen.ev);
    const bb = game.bigBlind;
    const verdict = classify(evLoss / bb);

    let draws = null;
    if (game.community.length >= 3 && game.community.length <= 4) {
      draws = H.equity.analyzeDraws(player.cards, game.community);
    }

    return {
      handNo: game.handNo,
      street: game.street,
      position: o.position,
      pot: game.totalPot(),
      toCall: o.context.a.toCall,
      board: game.community.slice(),
      cards: player.cards.slice(),
      equity: o.equity,
      potOdds: o.potOdds,
      topPct: o.topPct,
      draws: draws,
      chosen: { type: chosen.type, amount: chosen.amount, ev: chosen.ev },
      best: { type: best.type, amount: best.amount, ev: best.ev, tag: best.tag },
      candidates: o.candidates.map(function (c) {
        return { type: c.type, amount: c.amount, ev: c.ev, tag: c.tag, fe: c.fe };
      }),
      evLoss: evLoss,
      evLossBb: evLoss / bb,
      verdict: verdict.verdict,
      verdictIcon: verdict.icon,
      verdictText: T(verdict.key),
      bb: bb
    };
  }

  /** 한 줄 설명문 */
  function explain(item) {
    const eqPct = Math.round(item.equity * 100);
    const needPct = Math.round(item.potOdds * 100);
    if (item.best.type === 'raise') return T('review.shouldBet', { eq: eqPct });
    if (item.toCall > 0) {
      return item.best.type === 'fold'
        ? T('review.shouldFold', { eq: eqPct, need: needPct })
        : T('review.shouldCall', { eq: eqPct, need: needPct });
    }
    return T('review.thinBet', { eq: eqPct });
  }

  /** 핸드 전체 요약 */
  function summarize(items, bigBlind) {
    if (!items || !items.length) {
      return { total: 0, totalBb: 0, worst: null, items: [], text: T('review.noData') };
    }
    let total = 0, worst = items[0];
    items.forEach(function (it) {
      total += it.evLoss;
      if (it.evLoss > worst.evLoss) worst = it;
    });
    const bb = bigBlind || items[0].bb || 1;
    return {
      total: total,
      totalBb: total / bb,
      worst: worst.evLoss > 0.15 * bb ? worst : null,
      items: items,
      text: total < 0.15 * bb
        ? T('review.evNone')
        : T('review.evLoss', { amount: '-' + Math.round(total).toLocaleString() })
    };
  }

  H.review = {
    evaluate: evaluate,
    explain: explain,
    classify: classify,
    summarize: summarize,
    actionLabel: actionLabel,
    matchCandidate: matchCandidate,
    THRESHOLDS: THRESHOLDS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
