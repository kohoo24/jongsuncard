/*
 * ai.js - 컴퓨터 플레이어 두뇌
 *
 * 이전 구현은 "상대는 무작위 홀카드"라는 가정 위에서 승률을 계산했다.
 * 그 가정이 최대 23.8%p 틀린 탓에 레이즈 기준은 AA급에서만 충족되고
 * 콜 기준은 아무 패나 통과해, 봇들이 VPIP 48~58% / PFR 0~8% 의
 * 루즈-패시브 림퍼가 되어 있었다(단순 TAG 전략에 -149bb/100).
 *
 * 지금은:
 *   1) 상대 레인지를 액션에서 역산하고 그 레인지로만 승률을 계산한다
 *   2) 포지션별 오픈 레인지를 쓴다
 *   3) 베팅 사이즈로 레인지를 좁힌다
 *   4) 폴드 에쿼티를 계산해 EV 가 양수인 블러프만 한다
 *   5) 고급 난이도에서는 상대의 실제 통계(VPIP, 폴드율)로 레인지를 보정한다
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') {
    require('./cards.js'); require('./evaluator.js'); require('./rng.js');
    require('./ranges.js'); require('./equity.js'); require('./stats.js');
  }
  const R = H.ranges, E = H.equity;

  /* ---------- 성향 프로필 ---------- */
  const RAW_PROFILES = [
    { key: 'rock',    openMult: 0.72, callMult: 0.78, bluffMult: 0.35, sizeMult: 0.95, overFold: 1.55, slowplay: 0.10 },
    { key: 'shark',   openMult: 1.00, callMult: 1.00, bluffMult: 1.00, sizeMult: 1.00, overFold: 1.25, slowplay: 0.12 },
    { key: 'maniac',  openMult: 1.50, callMult: 1.18, bluffMult: 2.10, sizeMult: 1.25, overFold: 0.95, slowplay: 0.05 },
    { key: 'station', openMult: 1.35, callMult: 1.70, bluffMult: 0.30, sizeMult: 0.85, overFold: 0.65, slowplay: 0.08 },
    { key: 'trap',    openMult: 0.88, callMult: 1.02, bluffMult: 0.70, sizeMult: 1.05, overFold: 1.30, slowplay: 0.38 }
  ];
  const PROFILES = RAW_PROFILES.map(function (p) {
    Object.defineProperty(p, 'name', { get: function () { return H.i18n.t('profile.' + this.key); }, enumerable: true });
    Object.defineProperty(p, 'desc', { get: function () { return H.i18n.t('profile.' + this.key + 'Desc'); }, enumerable: true });
    return p;
  });

  /*
   * 이름 풀은 넉넉해야 한다. 열 개뿐이면 판마다 섞어도 같은 얼굴이 자꾸 돌아와,
   * 이름과 성향이 묶여 있는 것처럼 느껴진다.
   */
  const NAMES = [
    '민수', '지연', '태호', '수빈', '현우', '다은', '준영', '세라', '강훈', '유나',
    '지호', '서연', '도윤', '하늘', '재원', '민호', '은서', '시우', '채원', '민재',
    '예림', '건우', '소율', '지훈', '나윤', '성민', '가온', '윤아', '태민', '보람',
    '승현', '아린', '주원', '한결', '유진', '동하'
  ];

  /* ---------- 난이도 ---------- */
  const DIFFICULTY = {
    easy: {
      key: 'easy', sims: 500, useRanges: false, useProfiling: false,
      mistakes: 0.22, bluffScale: 0.55, wideFactor: 1.55, sizeGrid: [0.75]
    },
    normal: {
      key: 'normal', sims: 1400, useRanges: true, useProfiling: false,
      mistakes: 0.05, bluffScale: 1.00, wideFactor: 1.00, sizeGrid: [0.45, 0.72, 1.10]
    },
    hard: {
      key: 'hard', sims: 2800, useRanges: true, useProfiling: true,
      mistakes: 0.00, bluffScale: 1.15, wideFactor: 0.98, sizeGrid: [0.30, 0.50, 0.75, 1.05, 1.45]
    }
  };

  /* ---------- 보조 ---------- */
  function effectiveStack(game, player, opponents) {
    let maxOpp = 0;
    for (let i = 0; i < opponents.length; i++) {
      maxOpp = Math.max(maxOpp, opponents[i].chips + opponents[i].bet);
    }
    return Math.min(player.chips + player.bet, maxOpp);
  }

  function countLimpers(game) {
    let n = 0;
    const pre = game.handActions;
    for (let i = 0; i < pre.length; i++) {
      if (pre[i].street === 'preflop' && pre[i].type === 'call' && pre[i].raisesBefore <= 1) n++;
    }
    return n;
  }

  /* 숏스택 푸시 레인지 */
  function pushRange(bbLeft, pos, n) {
    const base = Math.max(0.08, Math.min(0.90, 0.85 - bbLeft * 0.055));
    const posMult = { BTN: 1.5, CO: 1.25, HJ: 1.1, LJ: 0.95, SB: 1.35, BB: 1.0, MP: 0.85, UTG1: 0.78, UTG: 0.7 }[pos] || 1;
    let m = posMult;
    if (n <= 3) m *= 1.4; else if (n <= 4) m *= 1.2;
    return Math.min(0.95, base * m);
  }

  /*
   * 레이즈에 직면했을 때의 콜 레인지.
   * (상대 모델링용 ACTION_BANDS 를 그대로 쓰면 BB 가 85% 를 디펜스하게 되어
   *  VPIP 가 60% 까지 치솟는다. 콜 기준은 따로 둔다.)
   */
  const CALL_CAP = {
    vsOpen:   { BB: 0.33, SB: 0.11, BTN: 0.17, CO: 0.15, HJ: 0.14, LJ: 0.135, MP: 0.13, UTG1: 0.125, UTG: 0.12 },
    vsThree:  { BB: 0.060, SB: 0.045, BTN: 0.065, CO: 0.060, HJ: 0.055, LJ: 0.052, MP: 0.050, UTG1: 0.048, UTG: 0.045 },
    vsFour:   { BB: 0.022, SB: 0.020, BTN: 0.024, CO: 0.022, HJ: 0.021, LJ: 0.020, MP: 0.020, UTG1: 0.019, UTG: 0.018 }
  };

  function callCapFor(raises, pos) {
    const table = raises === 2 ? CALL_CAP.vsOpen : raises === 3 ? CALL_CAP.vsThree : CALL_CAP.vsFour;
    return table[pos] != null ? table[pos] : 0.14;
  }

  /* 이 인원수에서 기대되는 평균 VPIP (프로파일링 보정의 기준선) */
  function expectedVpip(n) {
    const positions = R.positionsFor(n);
    let sum = 0;
    for (let i = 0; i < positions.length; i++) sum += R.openPercent(positions[i], n);
    return Math.max(0.12, Math.min(0.6, (sum / positions.length) * 1.15));
  }

  /*
   * 베팅 사이즈(팟 대비) -> 남는 레인지 비율 (소프트 컷의 중심).
   * 예전 표(0.58/0.45/0.34/0.26)는 벳 레인지를 너무 넓게 봐서 밸류벳에 콜을 남발했다.
   * 6시드 × 1000핸드 TAG 벤치마크: 옛 표 normal -2 / hard -15 → 이 표 +6 / +8 bb/100.
   */
  const KEEP_FOR_RATIO = [[0.40, 0.50], [0.70, 0.36], [1.10, 0.28], [Infinity, 0.20]];
  function keepForRatio(r) {
    const table = H.ai && H.ai.KEEP_FOR_RATIO ? H.ai.KEEP_FOR_RATIO : KEEP_FOR_RATIO;
    for (let i = 0; i < table.length; i++) if (r < table[i][0]) return table[i][1];
    return table[table.length - 1][1];
  }

  /*
   * 상대가 평균보다 얼마나 자주 접는가.
   *
   * 주의: 전체 폴드율을 쓰면 안 된다. 프리플랍에서 나쁜 패를 접는 것까지 포함되어
   * 누구나 70% 안팎이 나오고, 봇들이 "무엇이든 접는 상대"로 오판해 블러프를
   * 남발하게 된다(실측: 타이트한 상대에게 TAG 기준 -69 -> +231bb/100).
   * 블러프가 통할지는 '포스트플랍 폴드율'만이 말해준다.
   */
  function overFoldOf(ctx, opp) {
    if (ctx.diff.useProfiling && ctx.tracker) {
      const st = ctx.tracker.get(opp.id);
      if (st && st.samples.facedBetPost >= 25) {
        const mult = st.foldToBetPost / 0.45;   // 0.45 ≈ 일반적인 포스트플랍 폴드율
        return Math.max(0.70, Math.min(1.60, mult * 1.15));
      }
    }
    return opp.profile ? opp.profile.overFold : 1.25;
  }

  /* ---------- 상대 레인지 역산 ---------- */
  function inferRange(ctx, opp) {
    const game = ctx.game;
    const n = game.players.length;
    const pos = R.positionOf(game.players.indexOf(opp), game.button, n);
    let openPct = R.openPercent(pos, n);

    if (ctx.diff.useProfiling && ctx.tracker) {
      const st = ctx.tracker.get(opp.id);
      if (st && st.hands >= 25) {
        // 기준선은 이론값이 아니라 이 테이블에서 실제로 관측된 평균을 쓴다
        const baseline = ctx.tracker.populationVpip(opp.id) || expectedVpip(n);
        openPct *= Math.max(0.65, Math.min(1.70, st.vpip / baseline));
      }
    }

    /* 클래스별 가중치. 밴드는 지지 구간(호환용) */
    let weights;
    if (!ctx.diff.useRanges) {
      weights = R.ACTION_WEIGHTS.any();
    } else {
      const pre = game.actionsOf(opp.id, 'preflop');
      const W = R.ACTION_WEIGHTS;
      if (!pre.length) {
        weights = W.open(Math.min(1, openPct * 2.2));
      } else {
        let raises = 0, called = false, facedRaise = false;
        for (let i = 0; i < pre.length; i++) {
          const act = pre[i];
          if (act.type === 'raise') raises++;
          else if (act.type === 'call') called = true;
          if (act.raisesBefore >= 2) facedRaise = true;
        }
        if (raises >= 2) weights = W.fourBet();
        else if (raises === 1 && facedRaise) weights = W.threeBet();
        else if (raises === 1) weights = W.open(openPct);
        else if (called && facedRaise) weights = W.callThree();
        else if (called) weights = pos === 'BB' ? W.defendBB(openPct) : W.call(openPct);
        else weights = W.limp(openPct);
      }
    }
    const band = R.support(weights);

    let keepTop = 1;
    if (ctx.diff.useRanges) {
      const acts = game.handActions;
      for (let i = 0; i < acts.length; i++) {
        const act = acts[i];
        if (act.playerId !== opp.id || act.street === 'preflop') continue;
        if (act.type === 'raise') {
          const ratio = act.potBefore > 0 ? (act.amount - act.currentBetBefore) / act.potBefore : 1;
          const k = act.raisesBefore > 0 ? 0.20 : keepForRatio(ratio);
          keepTop = Math.min(keepTop, k);
        } else if (act.type === 'call') {
          keepTop = Math.min(keepTop, 0.62);
        }
      }
    }
    return { weights: weights, band: band, keepTop: keepTop, pos: pos, id: opp.id };
  }

  /* ---------- 레이즈 금액 정리 ---------- */
  function raiseTo(ctx, target) {
    const a = ctx.a, game = ctx.game;
    const unit = Math.max(1, Math.round(game.bigBlind / 2));
    let v = Math.round(target / unit) * unit;
    v = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, v));
    // 스택 대부분을 넣게 되면 그냥 올인
    if (v > ctx.player.bet + ctx.player.chips * 0.78) v = a.maxRaiseTo;
    return { type: 'raise', amount: v };
  }

  /* ---------- 프리플랍 ---------- */
  function preflop(ctx) {
    const game = ctx.game, player = ctx.player, a = ctx.a, prof = ctx.prof, diff = ctx.diff, rand = ctx.rand;
    const myPct = R.percentile(R.classOf(player.cards[0], player.cards[1]));
    const bb = game.bigBlind;
    const pot = ctx.pot;
    const openPct = Math.min(0.95, R.openPercent(ctx.pos, ctx.n) * prof.openMult * diff.wideFactor);
    const bbLeft = effectiveStack(game, player, ctx.opponents) / bb;
    const raises = game.raisesThisStreet;
    const potOdds = a.toCall > 0 ? a.toCall / (pot + a.toCall) : 0;

    ctx.think.handPct = myPct;
    ctx.think.openPct = openPct;
    ctx.think.potOdds = potOdds;

    /* 숏스택: 푸시 오어 폴드 */
    if (bbLeft <= 12 && a.canRaise) {
      const push = pushRange(bbLeft, ctx.pos, ctx.n) * prof.openMult;
      ctx.think.plan = 'push';
      ctx.think.pushPct = push;
      if (myPct <= push) return { type: 'raise', amount: a.maxRaiseTo };
      if (a.canCheck) return { type: 'check' };
      if (myPct <= push * 1.7 && a.toCall <= bb * 1.5) return { type: 'call' };
      return { type: 'fold' };
    }

    /* 아직 아무도 레이즈하지 않음 */
    if (raises <= 1) {
      if (myPct <= openPct) {
        const limpers = countLimpers(game);
        ctx.think.plan = 'open';
        return raiseTo(ctx, bb * (2.2 + 0.9 * limpers) * prof.sizeMult + (game.currentBet - bb));
      }
      if (a.canCheck) { ctx.think.plan = 'check'; return { type: 'check' }; }
      if (a.toCall <= bb && myPct <= openPct * 1.9 && rand() < prof.callMult * 0.22) {
        ctx.think.plan = 'limp';
        return { type: 'call' };
      }
      ctx.think.plan = 'fold';
      return { type: 'fold' };
    }

    /* 레이즈에 직면 */
    const threeBetSpot = raises === 2;
    const valueRe = (threeBetSpot ? 0.055 : 0.026) * (1 + (prof.bluffMult - 1) * 0.2);
    const bluffReHi = threeBetSpot ? 0.055 + 0.050 * prof.bluffMult * diff.bluffScale : 0;
    let callCap = callCapFor(raises, ctx.pos) * prof.callMult * diff.wideFactor;
    if (potOdds < 0.18) callCap *= 1.35;       // 아주 싼 콜이면 넓힌다
    else if (potOdds > 0.38) callCap *= 0.70;  // 비싸면 좁힌다
    callCap = Math.min(0.60, callCap);
    ctx.think.callCap = callCap;

    if (a.canRaise && myPct <= valueRe) {
      ctx.think.plan = threeBetSpot ? '3bet-value' : '4bet-value';
      return raiseTo(ctx, game.currentBet * 3 + pot * 0.12);
    }
    if (a.canRaise && myPct > callCap && myPct <= bluffReHi && rand() < 0.4 * prof.bluffMult * diff.bluffScale) {
      ctx.think.plan = '3bet-bluff';
      return raiseTo(ctx, game.currentBet * 2.8);
    }
    if (myPct <= callCap) { ctx.think.plan = 'call'; return { type: 'call' }; }
    if (a.canCheck) { ctx.think.plan = 'check'; return { type: 'check' }; }
    ctx.think.plan = 'fold';
    return { type: 'fold' };
  }

  /* ---------- 포스트플랍 ---------- */

  /**
   * 현재 상황의 모든 선택지를 EV 와 함께 평가한다.
   * AI 의 의사결정과 핸드 리뷰가 같은 계산을 공유한다.
   */
  function evaluateOptions(ctx) {
    const game = ctx.game, player = ctx.player, a = ctx.a, prof = ctx.prof, diff = ctx.diff;
    const pot = ctx.pot, toCall = a.toCall;

    const holeCodes = [H.cards.code(player.cards[0]), H.cards.code(player.cards[1])];
    const boardCodes = game.community.map(H.cards.code);
    const dist = boardCodes.length >= 3 ? E.boardDistribution(boardCodes, holeCodes) : null;

    const ranges = ctx.opponents.map(function (o) { return inferRange(ctx, o); });
    const combos = ranges.map(function (r) { return E.buildCombos(r, boardCodes, holeCodes, dist); });
    const seed = (ctx.rand() * 4294967295) >>> 0;
    const eq = E.vsRanges({
      hole: holeCodes, board: boardCodes, combos: combos, sims: diff.sims, seed: seed
    }).equity;

    const topPct = dist ? E.pctOfValue(dist, H.eval.score(player.cards.concat(game.community))) : null;
    const inPos = isInPosition(ctx);
    // 에쿼티 실현율: 포지션이 나쁘면 끝까지 가기 어렵다
    const rz = game.street === 'river' ? 1 : (inPos ? 0.90 : 0.80);

    const candidates = [];
    if (a.canCheck) {
      candidates.push({ type: 'check', ev: eq * pot * rz, tag: 'check' });
    } else {
      candidates.push({ type: 'fold', ev: 0, tag: 'fold' });
      candidates.push({ type: 'call', amount: toCall, ev: eq * pot * rz - (1 - eq) * toCall, tag: 'call' });
    }

    if (a.canRaise) {
      const targets = [];
      (diff.sizeGrid || [0.45, 0.72, 1.10]).forEach(function (f) {
        const t = game.currentBet + Math.round((pot + toCall) * f * prof.sizeMult);
        const c = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, t));
        if (targets.indexOf(c) === -1) targets.push(c);
      });
      if (targets.indexOf(a.maxRaiseTo) === -1 && a.maxRaiseTo <= pot * 2.2) targets.push(a.maxRaiseTo);
      // 리뷰에서 "실제로 낸 금액"의 EV 도 필요하므로 외부에서 사이즈를 추가할 수 있다
      (ctx.opts.extraSizes || []).forEach(function (v) {
        const c = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, Math.round(v)));
        if (targets.indexOf(c) === -1) targets.push(c);
      });

      targets.forEach(function (target) {
        const myCost = target - player.bet;
        const theirCall = target - game.currentBet;
        if (theirCall <= 0) return;

        let pFoldAll = 1, expCallers = 0;
        const shares = [];
        for (let i = 0; i < ranges.length; i++) {
          const pf = E.foldProbability(pot, theirCall, ranges[i], overFoldOf(ctx, ctx.opponents[i]), combos[i]);
          pFoldAll *= pf;
          expCallers += (1 - pf);
          shares.push(Math.max(0.08, 1 - pf));
        }

        /* 콜당했을 때의 승률은 따로 계산한다 (상대는 좋은 패로만 콜한다) —
           지금 레인지의 가중 질량 중 강한 쪽 (1-pf) 만 남긴다 */
        let eqCalled = eq;
        if (dist && pFoldAll < 0.96) {
          const cc = combos.map(function (c, i) { return E.continueRange(c, shares[i]); });
          eqCalled = E.vsRanges({
            hole: holeCodes, board: boardCodes, combos: cc,
            sims: Math.max(400, diff.sims >> 1), seed: seed + 1
          }).equity;
        }

        /* (1-pFoldAll) 은 "적어도 한 명이 콜" 확률이다. 전원이 콜한다고 보면
           이길 때 받는 팟을 과대평가하게 되므로 기대 콜러 수로 환산해 쓴다. */
        const pCalled = 1 - pFoldAll;
        const callers = pCalled > 0
          ? Math.max(1, Math.min(ranges.length, expCallers / pCalled))
          : 1;
        const ev = pFoldAll * pot
          + pCalled * (eqCalled * (pot + callers * theirCall) - (1 - eqCalled) * myCost);

        candidates.push({
          type: 'raise', amount: target, ev: ev,
          tag: eqCalled >= 0.55 ? 'value' : 'bluff',
          fe: pFoldAll, eqCalled: eqCalled, cost: myCost
        });
      });
    }

    candidates.sort(function (x, y) { return y.ev - x.ev; });
    return {
      candidates: candidates, equity: eq, topPct: topPct, ranges: ranges,
      dist: dist, inPosition: inPos, realization: rz,
      potOdds: toCall > 0 ? toCall / (pot + toCall) : 0
    };
  }

  function postflop(ctx) {
    const game = ctx.game, a = ctx.a, prof = ctx.prof, diff = ctx.diff, rand = ctx.rand;
    const o = evaluateOptions(ctx);
    const candidates = o.candidates;

    ctx.think.equity = o.equity;
    ctx.think.topPct = o.topPct;
    ctx.think.rangeHi = o.ranges[0] ? o.ranges[0].band.hi : 1;
    ctx.think.potOdds = o.potOdds;
    ctx.think.inPosition = o.inPosition;

    /* 트래퍼: 아주 강할 때 가끔 체크로 함정 */
    if (a.canCheck && o.topPct != null && o.topPct <= 0.06 && rand() < prof.slowplay) {
      ctx.think.plan = 'slowplay';
      return { type: 'check' };
    }

    /*
     * 블러프 통제: EV 추정에는 오차가 있으므로, 블러프가 최선의 비블러프 선택지를
     * 일정 마진 이상 이길 때만 실행한다. 공격적인 성향일수록 마진이 작다.
     */
    const bestSolid = candidates.find(function (c) { return c.tag !== 'bluff'; }) || candidates[candidates.length - 1];
    const margin = game.bigBlind * (0.85 / Math.max(0.3, prof.bluffMult * diff.bluffScale));
    let pick = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.tag === 'bluff' && c.ev < bestSolid.ev + margin) continue;
      pick = c;
      break;
    }
    if (!pick) pick = bestSolid;

    /* EV 가 비슷한 후보들 사이에서는 약간의 무작위성 (읽히지 않도록) */
    const close = candidates.filter(function (c) {
      return c.tag !== 'bluff' && c.ev > pick.ev - Math.abs(pick.ev) * 0.06 - 1;
    });
    if (close.length > 1 && rand() < 0.28) pick = close[(rand() * close.length) | 0];

    ctx.think.plan = pick.tag;
    ctx.think.foldEquity = pick.fe;
    ctx.think.eqCalled = pick.eqCalled;
    ctx.think.ev = pick.ev;

    if (pick.type === 'raise') return { type: 'raise', amount: pick.amount };
    return { type: pick.type };
  }

  function isInPosition(ctx) {
    const game = ctx.game, n = game.players.length;
    const me = ((game.players.indexOf(ctx.player) - game.button) % n + n) % n;
    for (let i = 0; i < ctx.opponents.length; i++) {
      const o = ((game.players.indexOf(ctx.opponents[i]) - game.button) % n + n) % n;
      if (o > me) return false;   // 나보다 늦게 행동하는 상대가 있다
    }
    return true;
  }

  /* ---------- 초급 난이도의 의도적인 실수 ---------- */
  function applyMistakes(ctx, d) {
    const diff = ctx.diff, rand = ctx.rand, a = ctx.a;
    if (!diff.mistakes || rand() >= diff.mistakes) return d;
    ctx.think.mistake = true;
    const roll = rand();
    if (d.type === 'fold' && roll < 0.55) return { type: a.canCheck ? 'check' : 'call' };
    if (d.type === 'raise' && roll < 0.5) return { type: a.canCheck ? 'check' : 'call' };
    if ((d.type === 'check' || d.type === 'call') && roll > 0.72 && a.canRaise) {
      return raiseTo(ctx, ctx.game.currentBet + ctx.pot * 0.6);
    }
    return d;
  }

  /* ---------- 진입점 ---------- */
  function makeContext(game, player, opts) {
    opts = opts || {};
    const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    const prof = opts.profile || player.profile || PROFILES[1];
    const rand = opts.rng || game.rng || Math.random;
    const a = game.actionsFor(player);
    const opponents = game.activePlayers().filter(function (p) { return p !== player; });
    if (!opponents.length) return null;

    const ctx = {
      game: game, player: player, opts: opts, diff: diff, prof: prof, rand: rand,
      a: a, opponents: opponents, n: game.players.length, pot: game.totalPot(),
      pos: R.positionOf(game.players.indexOf(player), game.button, game.players.length),
      tracker: opts.tracker || null,
      think: { difficulty: diff.key, profile: prof.key }
    };
    ctx.think.pos = ctx.pos;
    return ctx;
  }

  /** 리뷰/힌트용: 선택지별 EV 를 그대로 돌려준다 */
  function analyze(game, player, opts) {
    const ctx = makeContext(game, player, opts);
    if (!ctx) return null;
    const o = evaluateOptions(ctx);
    o.context = ctx;
    o.position = ctx.pos;
    o.handPct = R.percentile(R.classOf(player.cards[0], player.cards[1]));
    return o;
  }

  function decide(game, player, opts) {
    const ctx = makeContext(game, player, opts);
    if (!ctx) {
      const a0 = game.actionsFor(player);
      return { type: a0.canCheck ? 'check' : 'call', think: {} };
    }
    const a = ctx.a;

    let d = game.street === 'preflop' ? preflop(ctx) : postflop(ctx);
    d = applyMistakes(ctx, d);

    /* 규칙상 불가능한 액션은 안전하게 대체한다 */
    if (d.type === 'check' && !a.canCheck) d = { type: 'fold' };
    if (d.type === 'raise' && !a.canRaise) d = { type: a.canCheck ? 'check' : 'call' };
    if (d.type === 'fold' && a.canCheck) d = { type: 'check' };

    d.think = ctx.think;
    return d;
  }

  /* 단순 승률 계산 (화면 표시용 호환 API) */
  function equity(holeCards, boardCards, opponents, sims) {
    if (opponents <= 0) return 1;
    const hole = holeCards.map(H.cards.code);
    const board = (boardCards || []).map(H.cards.code);
    const dist = board.length >= 3 ? E.boardDistribution(board, hole) : null;
    const combos = [];
    const wide = { weights: R.ACTION_WEIGHTS.any(), keepTop: 1 };
    for (let i = 0; i < opponents; i++) combos.push(E.buildCombos(wide, board, hole, dist));
    return E.vsRanges({ hole: hole, board: board, combos: combos, sims: sims || 1000 }).equity;
  }

  H.ai = {
    PROFILES: PROFILES,
    NAMES: NAMES,
    DIFFICULTY: DIFFICULTY,
    KEEP_FOR_RATIO: KEEP_FOR_RATIO,
    decide: decide,
    analyze: analyze,
    evaluateOptions: evaluateOptions,
    makeContext: makeContext,
    equity: equity,
    inferRange: inferRange,
    pushRange: pushRange
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
