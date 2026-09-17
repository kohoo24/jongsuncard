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
  if (typeof require === 'function') { require('./ai.js'); require('./i18n.js'); require('./format.js'); }
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

  /*
   * 결정이 놓인 자리. 약점 프로파일과 드릴이 같은 분류를 쓴다.
   *   프리플랍  open (아직 레이즈 없음) · vsOpen (오픈에 직면) · vs3bet (3벳 이상에 직면)
   *   포스트플랍 cbet (내가 어그레서, 체크 받음) · checkedTo (체크 받음) · vsBet (벳에 직면)
   */
  function spotOf(game, player) {
    const a = game.actionsFor(player);
    let spot;
    if (game.street === 'preflop') {
      spot = game.raisesThisStreet <= 1 ? 'open' : game.raisesThisStreet === 2 ? 'vsOpen' : 'vs3bet';
    } else if (a.toCall > 0) {
      spot = 'vsBet';
    } else {
      spot = game.lastAggressorId === player.id ? 'cbet' : 'checkedTo';
    }
    return {
      street: game.street,
      spot: spot,
      key: game.street + '/' + spot,
      pos: game.position(player)
    };
  }

  function actionLabel(c) {
    if (!c) return '?';
    if (c.type === 'fold') return T('act.fold');
    if (c.type === 'check') return T('act.check');
    if (c.type === 'call') return T('act.call') + ' ' + H.format.amount(c.amount || 0);
    return T('act.raise') + ' ' + H.format.amount(c.amount || 0);
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
      spot: spotOf(game, player).spot,
      position: o.position,
      handPct: o.handPct,
      raisesBefore: game.raisesThisStreet,
      pot: game.totalPot(),
      toCall: o.context.a.toCall,
      board: game.community.slice(),
      cards: player.cards.slice(),
      equity: o.equity,
      potOdds: o.potOdds,
      topPct: o.topPct,
      draws: draws,
      chosen: { type: chosen.type, amount: chosen.amount, ev: chosen.ev },
      best: { type: best.type, amount: best.amount, ev: best.ev, tag: best.tag, fe: best.fe },
      candidates: o.candidates.map(function (c) {
        return { type: c.type, amount: c.amount, ev: c.ev, tag: c.tag, fe: c.fe };
      }),
      opponents: o.context.opponents ? o.context.opponents.length : null,
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

    /* 프리플랍은 승률보다 "이 핸드가 이 포지션의 레인지에 드는가"로 설명해야 읽힌다 */
    if (item.street === 'preflop' && item.handPct != null) {
      const top = item.handPct < 0.1 ? item.handPct * 100 < 1
        ? (item.handPct * 100).toFixed(1) : Math.round(item.handPct * 100)
        : Math.round(item.handPct * 100);
      const pos = T('pos.' + item.position);
      if (item.best.type === 'raise') {
        return item.raisesBefore >= 2
          ? T('review.shouldThreeBet', { pct: top })
          : T('review.shouldOpen', { pct: top, pos: pos });
      }
      if (item.best.type === 'fold') return T('review.shouldFoldPre', { pct: top, pos: pos });
      if (item.best.type === 'call') return T('review.shouldCallPre', { pct: top, need: needPct });
    }

    if (item.best.type === 'raise') return T('review.shouldBet', { eq: eqPct });
    if (item.toCall > 0) {
      return item.best.type === 'fold'
        ? T('review.shouldFold', { eq: eqPct, need: needPct })
        : T('review.shouldCall', { eq: eqPct, need: needPct });
    }
    return T('review.thinBet', { eq: eqPct });
  }

  /*
   * "왜 그런가" 한 줄 — 숫자 뒤의 개념. 리뷰·드릴·코치가 같이 쓴다.
   * 결정 하나에 개념 하나만 고른다 (포지션 · 레인지 우위 · 팟 오즈 · 임플라이드 오즈 · 폴드 에쿼티 ·
   * 팟 컨트롤 · 멀티웨이 · 3벳 도미네이션). 우선순위는 그 자리에서 가장 결정을 좌우한 요인 순이다.
   */
  const EARLY = { UTG: 1, UTG1: 1, MP: 1, LJ: 1 };
  const LATE = { CO: 1, BTN: 1 };
  function reason(item) {
    const best = item.best || {};
    const pos = item.position;
    const posName = pos ? T('pos.' + pos) : '';
    const eqPct = Math.round((item.equity || 0) * 100);
    const needPct = Math.round((item.potOdds || 0) * 100);
    const multiway = (item.opponents || 0) >= 2;

    if (item.street === 'preflop') {
      if (item.raisesBefore >= 3) {
        return best.type === 'fold' ? T('why.vs3betFold') : best.type === 'call' ? T('why.vs3betCall') : T('why.fourBet');
      }
      if (item.raisesBefore === 2) {
        if (best.type === 'raise') return T('why.threeBet');
        if (best.type === 'call') return pos === 'BB' ? T('why.bbDefend') : T('why.coldCall');
        return T('why.vsOpenFold');
      }
      if (best.type === 'raise') {
        if (EARLY[pos]) return T('why.openEarly', { pos: posName });
        if (LATE[pos]) return T('why.openLate', { pos: posName });
        if (pos === 'SB') return T('why.openSb');
        return T('why.openMid', { pos: posName });
      }
      if (best.type === 'fold') return EARLY[pos] ? T('why.openEarly', { pos: posName }) : T('why.foldPre');
      return T('why.limp');
    }

    /* 포스트플랍 */
    const draw = item.draws && item.draws.outs > 0 ? item.draws : null;
    if (item.toCall > 0) {
      if (best.type === 'raise') return best.tag === 'bluff' ? T('why.raiseBluff', { fe: Math.round((best.fe || 0) * 100) }) : T('why.raiseValue');
      if (best.type === 'call') {
        if (draw && item.equity < item.potOdds + 0.05) return T('why.impliedOdds', { outs: draw.outs, pct: Math.round(draw.byRiver * 100) });
        return multiway ? T('why.callMultiway', { eq: eqPct, need: needPct }) : T('why.potOdds', { eq: eqPct, need: needPct });
      }
      if (draw) return T('why.foldDraw', { outs: draw.outs, eq: eqPct, need: needPct });
      return multiway ? T('why.foldMultiway', { eq: eqPct, need: needPct }) : T('why.foldOdds', { eq: eqPct, need: needPct });
    }
    if (best.type === 'raise') {
      if (best.tag === 'bluff') return draw ? T('why.semiBluff', { outs: draw.outs, fe: Math.round((best.fe || 0) * 100) }) : T('why.bluff', { fe: Math.round((best.fe || 0) * 100) });
      return item.spot === 'cbet' ? T('why.cbet', { eq: eqPct }) : T('why.valueBet', { eq: eqPct });
    }
    /* 체크 */
    if (item.spot === 'cbet') return T('why.checkBack', { eq: eqPct });
    if (item.equity >= 0.7) return T('why.trap');
    return draw ? T('why.checkDraw', { outs: draw.outs }) : T('why.potControl', { eq: eqPct });
  }

  /*
   * 코치: 액션을 하기 전에 "이 자리의 생각 정리"를 만든다. 기록하지 않는다.
   * evaluate 와 같은 계산이지만 기준선(탄탄한 플레이어의 선택)을 정답으로 두고 그 이유를 붙인다.
   */
  function preview(game, player, opts) {
    const o = H.ai.analyze(game, player, {
      difficulty: (opts && opts.difficulty) || 'hard',
      tracker: (opts && opts.tracker) || null
    });
    if (!o) return null;
    const baseline = H.ai.decide(game, player, {
      difficulty: (opts && opts.difficulty) || 'hard',
      tracker: (opts && opts.tracker) || null,
      profile: H.ai.PROFILES[1],
      rng: function () { return 0.5; }
    });
    const item = evaluate(game, player, baseline, opts);
    if (!item) return null;
    item.spotInfo = spotOf(game, player);
    item.reason = reason(item);
    item.explanation = explain(item);
    return item;
  }

  /*
   * 핸드 태그 (히스토리의 복기 큐용). 리뷰 항목에서 자동으로 뽑는다.
   *   3벳 팟 · 과콜(콜 → 폴드 권장) · 과다 폴드(폴드 → 콜/레이즈 권장) · 미스 밸류(체크/콜 → 레이즈 권장)
   */
  function tagsOf(items) {
    const tags = {};
    (items || []).forEach(function (it) {
      if (!it || !it.best || !it.chosen) return;
      if (it.street === 'preflop' && it.raisesBefore >= 3) tags.threeBetPot = true;
      const leak = it.evLossBb >= 0.6;
      if (!leak) return;
      if (it.chosen.type === 'call' && it.best.type === 'fold') tags.overCall = true;
      else if (it.chosen.type === 'fold' && (it.best.type === 'call' || it.best.type === 'raise')) tags.overFold = true;
      else if ((it.chosen.type === 'check' || it.chosen.type === 'call') && it.best.type === 'raise') tags.missedValue = true;
    });
    return Object.keys(tags);
  }

  /** 표시용 3단계: Best(좋음) · Fine(무난) · Leak(실수·큰 실수) */
  function level(verdict) {
    return verdict === 'good' ? 'best' : verdict === 'ok' ? 'fine' : 'leak';
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
        : T('review.evLoss', { amount: '-' + H.format.amount(total) })
    };
  }

  H.review = {
    evaluate: evaluate,
    explain: explain,
    reason: reason,
    preview: preview,
    tagsOf: tagsOf,
    level: level,
    classify: classify,
    summarize: summarize,
    actionLabel: actionLabel,
    matchCandidate: matchCandidate,
    spotOf: spotOf,
    THRESHOLDS: THRESHOLDS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
