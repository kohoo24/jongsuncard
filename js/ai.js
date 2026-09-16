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
    require('./ranges.js'); require('./equity.js'); require('./stats.js'); require('./preflop.js');
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

  /* ---------- 튜닝 상수 (벤치마크로 고른다) ---------- */
  const TUNE = {
    openBase: 2.2,          // 오픈 사이즈(bb)
    openPerPlayerOver6: 0.1, // 6인 초과 한 명당 오픈 사이즈 가산(bb) — 9인 2.5bb. 작은 오픈은 멀티웨이를 부른다
    multiwayRz: 1.0,         // 상대 한 명 추가될 때마다 곱하는 실현율 (줄이면 너무 수동적이 된다: 0.88 → -10bb/100)
    likelyCallers: false,    // 콜당했을 때의 승률을 기대 콜러 수만큼의 상대로만 계산 (9인 -8: 채택 안 함)
    overcallTighten: 0.12,   // 오픈에 이미 콜러가 있을 때 콜러 한 명당 콜 기준 축소 비율
    noSqueezeBluff: false,   // 콜러가 있는 팟에는 블러프 3벳을 하지 않는다 (스퀴즈 블러프는 드물어 효과 없음)
    multiwayClass: false,    // 멀티웨이 콜 판단에서 수티드 커넥터·페어는 올리고 오프수트 브로드웨이는 내린다 (나빠짐)
    /*
     * 멀티스트리트 룩어헤드: 플랍·턴의 체크/콜을 다음 카드 표본으로 평가한다.
     * 기본 꺼짐 — TAG 벤치마크(4인 고급 10시드 × 1000핸드)에서 어느 형태도 한 스트리트 EV 를
     * 넘지 못했다: 없음 +9.0 / v1(앞서는 비율 + 후속 정책) -5.3, 보수적 변형 +0.6~+9.2 /
     * v2(상대의 벳·체크 레인지 모델링) +2.2~+7.2. 리뷰 판정과 결정 시간(1.3ms)은 문제없었다.
     * 다음 시도는 레이즈 후보의 "콜당한 뒤" 가지에도 같은 모델을 적용해 일관성을 맞추는 것.
     */
    /*
     * 프리플랍 솔버 테이블(js/preflop-table.js). 결정에 쓰면 TAG 벤치마크(4인 고급 10시드)에서
     * +9.0 → -10.6 으로 나빠진다: 솔버의 넓은 블라인드 디펜스(BB 57% 콜)를 우리 포스트플랍이
     * 살리지 못하고 플랍에서 접는 손실이 -13.7 → -49.5 bb/100 로 는다. 실현율을 낮춰 다시 풀어도
     * (-12, -11, -10) 같다. 레인지 역산에만 써도 9인에서 +5.1 → -3.8. 둘 다 기본 꺼짐이고,
     * 표는 프리플랍 차트(학습)에 쓴다.
     */
    solver: false,           // 프리플랍 결정에 항상 솔버 빈도를 쓴다 (보통·고급)
    solverRanges: false,     // 상대 레인지 역산에 솔버 빈도를 가중치로
    /*
     * 상황별 전환. 솔버 프리플랍은 타이트한 상대(TAG·락)에게 손해, 루즈한 상대(LAG·밸런스드)에게
     * 이득이었다. 헤즈업은 6맥스용 콜 기준이 맞지 않아(BB 가 오픈에 70% 폴드, BTN 이 3벳에 92~100%
     * 폴드) 솔버 헤즈업 표를 쓴다. 그 외에는 프로파일링된 상대 평균 VPIP 가 높으면 솔버.
     */
    huSolver: true,          // 헤즈업(2인)은 솔버 표
    adaptiveSolver: true,    // 고급: 상대 평균 VPIP 가 adaptiveVpip 이상이면 솔버 (표본 adaptiveHands 이상)
    adaptiveVpip: 0.28,
    adaptiveVpipPerPlayer: 0.018,
    adaptiveHands: 30,
    cbetAware: false,        // 어그레서의 플랍 첫 벳을 넓게 본다 — 단독 +9.0 → +4.5, 효과 없음
    /* 벳 레인지 양극화: 벳은 밸류 + 공기(블러프)이고 중간 핸드는 체크한다. 진단: TAG 의 헤즈업
       C벳은 상위 20% 가 59%, 공기(상위 45% 밖)가 41% 였는데 선형 레인지로 보면 콜당했을 때의
       상대를 약하게 봐 중간 핸드로 레이즈해 -10.9bb/hand 를 잃었다. */
    polarCbet: 0.45,         // 플랍 C벳(어그레서의 첫 벳) 꼬리 가중치 (4인 20시드 +3.0 → +4.2)
    polarBet: 0,             // 그 밖의 벳 (0.3 이면 +2.1, 0.4 면 -3.7 — 쓰지 않는다)
    polarRaise: 0,           // 레이즈
    polarFrom: 0.60,         // 이 백분위(상위 %)부터 꼬리로 본다
    /* 리버스 임플라이드 오즈: 플랍·턴에서 콜당하면 뒤 스트리트에서 더 잃는다. 진단: C벳에 중간
       핸드로 레이즈해 강한 손에 콜당한 뒤 턴·리버에서 -15bb/hand. 콜당했을 때 지는 쪽의 비용에
       (1 + rio) 를 곱한다. 리버는 0. */
    rioRaise: 1.0,           // 레이즈가 콜당했을 때. 4인 20시드: 0 → +4.2, 0.6 → +6.5, 1.0 → +14.9
    rioCall: 0,              // 콜/체크 뒤 (승률 실현율과 겹친다. 0.3 은 0.6 과 합쳐 +10.4)
    cbetKeep: 0.55,          // 그때 벳 레인지 폭의 하한 (프로파일 없을 때)
    cbetMinSamples: 12,      // 프로파일링으로 실제 C벳 빈도를 쓰기 위한 최소 기회 수
    lookahead: false,
    lookCards: 10,           // 표본 카드 수
    lookCombos: 260,         // 상대별 볼 콤보 수 (가중치 상위)
    lookBlend: 0.5,          // 룩어헤드 EV 와 한 스트리트 EV 의 혼합 비율
    lookStrong: 0.65,        // 이 이상 앞서면 밸류를 뽑는다
    lookWeak: 0.35,          // 이 이하면 체크-폴드 라인
    lookExtract: 0.27,       // 밸류 추출 보너스 (팟 대비, 콜 확률 반영)
    lookWeakRz: 0.5,         // 약할 때 쇼다운까지 가는 몫
    lookMidRz: 0.75,         // 중간일 때
    /* v2: 상대의 다음 스트리트 행동을 모델링한다 */
    lookModel: 2,
    lookBetShare: 0.33,      // 상대가 벳하는 몫 (새 보드에서 강한 상위)
    lookBetSize: 0.6,        // 상대 벳 크기 (팟 대비)
    lookPayoff: 0.4,         // 내가 벳했을 때 상대(체크 레인지)가 콜하는 비율
    lookMultiway: 0.9        // 상대 한 명 추가될 때마다
  };

  /* 멀티웨이 팟용 핸드 가치 보정: 백분위 순위는 헤즈업 기준이라 상대가 많을수록 어긋난다 */
  function multiwayPct(pct, cards) {
    const info = R.INFO[R.classOf(cards[0], cards[1])];
    if (!info) return pct;
    if (info.pair) return pct * 0.85;
    if (info.suited && (info.hi - info.lo) <= 3) return pct * 0.85;
    if (info.suited && info.hi === 14) return pct * 0.9;
    if (!info.suited && info.hi >= 12 && info.lo >= 9) return pct * 1.25;   // 오프수트 브로드웨이
    if (!info.suited && info.hi === 14) return pct * 1.2;                    // 오프수트 약한 에이스
    return pct;
  }

  /* ---------- 난이도 ---------- */
  const DIFFICULTY = {
    easy: {
      key: 'easy', sims: 500, useRanges: false, useProfiling: false,
      mistakes: 0.22, bluffScale: 0.55, wideFactor: 1.55, sizeGrid: [0.75]
    },
    normal: {
      key: 'normal', sims: 1400, useRanges: true, useProfiling: false, useSolver: true,
      mistakes: 0.05, bluffScale: 1.00, wideFactor: 1.00, sizeGrid: [0.45, 0.72, 1.10]
    },
    hard: {
      key: 'hard', sims: 2800, useRanges: true, useProfiling: true, useSolver: true,
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
      /* 솔버 표가 있으면 상대의 마지막 프리플랍 액션이 놓였던 상황의 빈도를 가중치로 쓴다.
         프로파일링(VPIP 비율)은 오픈·콜 가중치를 비례 확대/축소한다. */
      const solverW = (ctx.diff.useSolver && TUNE.solverRanges && H.preflop && H.preflop.available() && pre.length)
        ? solverWeightsFor(game, opp, pre[pre.length - 1], openPct / R.openPercent(pos, n))
        : null;
      if (solverW) {
        weights = solverW;
      } else if (!pre.length) {
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

    let keepTop = 1, polar = 0;
    if (ctx.diff.useRanges) {
      const acts = game.handActions;
      /* 프리플랍 어그레서의 플랍 첫 벳(C벳)은 사이즈가 말하는 것보다 넓다 — 많은 상대가 손과 무관하게
         C벳한다. 프로파일링이 있으면 실제 C벳 빈도를, 없으면 기본값을 벳 레인지 폭의 하한으로 쓴다. */
      let pfrId = null, pfrRaises = -1;
      for (let i = 0; i < acts.length; i++) {
        if (acts[i].street === 'preflop' && acts[i].type === 'raise' && acts[i].raisesBefore > pfrRaises) { pfrRaises = acts[i].raisesBefore; pfrId = acts[i].playerId; }
      }
      let cbetKeep = TUNE.cbetKeep;
      if (ctx.diff.useProfiling && ctx.tracker) {
        const st = ctx.tracker.get(opp.id);
        if (st && st.samples.cbetOpp >= TUNE.cbetMinSamples) cbetKeep = Math.max(0.2, Math.min(0.95, st.cbetFlop));
      }
      let seenFlop = false;
      for (let i = 0; i < acts.length; i++) {
        const act = acts[i];
        if (act.playerId !== opp.id || act.street === 'preflop') continue;
        if (act.type === 'raise') {
          const ratio = act.potBefore > 0 ? (act.amount - act.currentBetBefore) / act.potBefore : 1;
          let k = act.raisesBefore > 0 ? 0.20 : keepForRatio(ratio);
          const cbetSpot = act.street === 'flop' && !seenFlop && act.currentBetBefore === 0 && opp.id === pfrId;
          if (TUNE.cbetAware && cbetSpot) k = Math.max(k, cbetKeep);
          keepTop = Math.min(keepTop, k);
          polar = act.raisesBefore > 0 ? TUNE.polarRaise : cbetSpot ? TUNE.polarCbet : TUNE.polarBet;
        } else if (act.type === 'call') {
          keepTop = Math.min(keepTop, 0.62);
          polar = 0;                       // 콜은 중간 핸드다 — 양극이 아니다
        }
        if (act.street === 'flop') seenFlop = true;
      }
    }
    return { weights: weights, band: band, keepTop: keepTop, polar: polar, polarFrom: TUNE.polarFrom, pos: pos, id: opp.id };
  }

  /* ---------- 프리플랍 솔버 ---------- */
  /* 상대가 act 를 했을 때의 상황에서 그 액션의 빈도 배열 */
  function solverWeightsFor(game, opp, act, vpipMult) {
    if (act.type !== 'raise' && act.type !== 'call') return null;
    const n = game.players.length;
    const pos = game.position(opp);
    const sit = H.preflop.situationOf(game, opp, act.raisesBefore);
    if (sit.sit === 'open' && act.type === 'call') return null;   // 림프: 휴리스틱
    const w = H.preflop.weights(n, pos, sit.sit, act.type === 'raise' ? 'raise' : 'call');
    if (!w) return null;
    let mass = 0;
    for (let i = 0; i < w.length; i++) mass += w[i];
    if (mass < 0.5) return null;     // 표가 거의 비어 있으면(드문 상황) 휴리스틱으로
    if (vpipMult && vpipMult !== 1 && (sit.sit === 'open' || sit.sit.indexOf('vsOpen') === 0)) {
      /* 넓게 치는 상대: 빈도가 0 인 클래스에도 조금 들어온다. 좁은 상대: 낮은 빈도가 먼저 빠진다 */
      const out = new Float32Array(w.length);
      for (let i = 0; i < w.length; i++) {
        out[i] = vpipMult > 1
          ? Math.min(1, w[i] * vpipMult + (vpipMult - 1) * 0.15)
          : Math.max(0, w[i] - (1 - vpipMult) * 0.6);
      }
      return out;
    }
    return w;
  }

  /*
   * 솔버 테이블로 프리플랍 결정. 빈도를 성향·난이도로 살짝 비틀고 난수로 섞어 친다.
   * 표에 없는 상황(림프 팟, 표 밖 인원)이면 null → 휴리스틱.
   */
  function solverPreflop(ctx) {
    const game = ctx.game, player = ctx.player, a = ctx.a, prof = ctx.prof, diff = ctx.diff, rand = ctx.rand;
    const bb = game.bigBlind;
    const sit = H.preflop.situationOf(game, player);
    const cls = R.classOf(player.cards[0], player.cards[1]);
    const f = H.preflop.freq(ctx.n, ctx.pos, sit.sit, cls);
    if (!f) return null;

    let raise = f.raise, call = f.call;
    if (sit.sit === 'open') raise *= prof.openMult * diff.wideFactor;
    else raise *= Math.sqrt(prof.bluffMult);
    call *= prof.callMult * diff.wideFactor;
    if (sit.cold) { call *= 0.5; raise *= 0.6; }          // 콜드 4벳/콜 자리는 표가 오프너 기준이라 보수적으로
    if (countLimpers(game) > 0 && sit.sit === 'open') raise = Math.min(1, raise * 1.1);   // 림퍼 아이솔
    raise = Math.max(0, Math.min(1, raise));
    call = Math.max(0, Math.min(1, call));
    if (raise + call > 1) { const s = 1 / (raise + call); raise *= s; call *= s; }

    ctx.think.handPct = R.percentile(cls);
    ctx.think.solver = { sit: sit.sit, raise: raise, call: call };
    const u = rand();
    if (u < raise && a.canRaise) {
      const sizes = H.preflop.sizes() || { open: 2.5, openSb: 3, threeBetIp: 3, threeBetOop: 3.5, fourBet: 2.3 };
      const inBlinds = ctx.pos === 'SB' || ctx.pos === 'BB';
      let target;
      if (sit.raises <= 1) {
        const base = (ctx.pos === 'SB' ? sizes.openSb : sizes.open) + TUNE.openPerPlayerOver6 * Math.max(0, ctx.n - 6);
        target = bb * (base + countLimpers(game)) * prof.sizeMult + (game.currentBet - bb);
        ctx.think.plan = 'open';
      } else if (sit.raises === 2) {
        target = game.currentBet * (inBlinds ? sizes.threeBetOop : sizes.threeBetIp);
        ctx.think.plan = R.percentile(cls) <= 0.06 ? '3bet-value' : '3bet-bluff';
      } else if (sit.raises === 3) {
        target = game.currentBet * sizes.fourBet;
        ctx.think.plan = '4bet-value';
      } else {
        target = a.maxRaiseTo;
        ctx.think.plan = 'push';
      }
      return raiseTo(ctx, target);
    }
    if (u < raise + call) {
      ctx.think.plan = a.canCheck ? 'check' : 'call';
      return { type: a.canCheck ? 'check' : 'call' };
    }
    ctx.think.plan = a.canCheck ? 'check' : 'fold';
    return { type: a.canCheck ? 'check' : 'fold' };
  }

  /* 이 자리에서 솔버 프리플랍을 쓸지 */
  /* 루즈 판정 기준 VPIP. 인원이 많을수록 자연 VPIP 가 낮아지므로 4인 기준에서 한 명당 낮춘다. */
  function adaptiveThreshold(n) {
    return Math.max(0.15, TUNE.adaptiveVpip - (n - 4) * TUNE.adaptiveVpipPerPlayer);
  }

  function shouldUseSolver(ctx) {
    if (TUNE.solver) return true;
    if (TUNE.huSolver && ctx.n === 2) return true;
    if (TUNE.adaptiveSolver && ctx.diff.useProfiling && ctx.tracker) {
      const v = opponentsVpip(ctx);
      if (v != null && v >= adaptiveThreshold(ctx.n)) return true;
    }
    return false;
  }

  /*
   * 이 결정에 관련된 상대의 VPIP (표본이 모자라면 null).
   * 레이즈에 직면했으면 그 어그레서, 아직 열리지 않았으면 뒤에 행동할 사람들의 평균.
   * 테이블 전체 평균을 쓰면 다른 봇 좌석에 희석되어 9인에서는 한 번도 넘지 못했다.
   */
  function opponentsVpip(ctx) {
    const game = ctx.game, tracker = ctx.tracker;
    const stat = function (p) {
      const st = tracker.get(p.id);
      return (st && st.hands >= TUNE.adaptiveHands) ? st.vpip : null;
    };
    if (game.raisesThisStreet >= 2 && game.aggressor && game.aggressor !== ctx.player) {
      return stat(game.aggressor);
    }
    let sum = 0, n = 0;
    const me = game.players.indexOf(ctx.player), total = game.players.length;
    for (let k = 1; k < total; k++) {
      const p = game.players[(me + k) % total];
      if (p.folded || p.allIn) continue;
      const v = stat(p);
      if (v == null) return null;
      sum += v; n++;
    }
    return n ? sum / n : null;
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

    /* 솔버 테이블 (보통·고급): 항상 / 헤즈업 / 루즈한 테이블일 때 */
    if (diff.useSolver && H.preflop && H.preflop.available() && shouldUseSolver(ctx)) {
      const sd = solverPreflop(ctx);
      if (sd) return sd;
    }

    /* 아직 아무도 레이즈하지 않음 */
    if (raises <= 1) {
      if (myPct <= openPct) {
        const limpers = countLimpers(game);
        ctx.think.plan = 'open';
        const base = TUNE.openBase + TUNE.openPerPlayerOver6 * Math.max(0, ctx.n - 6);
        return raiseTo(ctx, bb * (base + 0.9 * limpers) * prof.sizeMult + (game.currentBet - bb));
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
    let callersSoFar = 0;
    game.handActions.forEach(function (x) {
      if (x.street === 'preflop' && x.type === 'call' && x.raisesBefore >= 2) callersSoFar++;
    });
    const valueRe = (threeBetSpot ? 0.055 : 0.026) * (1 + (prof.bluffMult - 1) * 0.2);
    const bluffReHi = threeBetSpot ? 0.055 + 0.050 * prof.bluffMult * diff.bluffScale : 0;
    let callCap = callCapFor(raises, ctx.pos) * prof.callMult * diff.wideFactor;
    if (potOdds < 0.18) callCap *= 1.35;       // 아주 싼 콜이면 넓힌다
    else if (potOdds > 0.38) callCap *= 0.70;  // 비싸면 좁힌다
    callCap *= Math.max(0.5, 1 - TUNE.overcallTighten * callersSoFar);   // 오버콜은 더 좁게
    callCap = Math.min(0.60, callCap);
    ctx.think.callCap = callCap;
    const callPct = (TUNE.multiwayClass && callersSoFar > 0) ? multiwayPct(myPct, player.cards) : myPct;

    if (a.canRaise && myPct <= valueRe) {
      ctx.think.plan = threeBetSpot ? '3bet-value' : '4bet-value';
      return raiseTo(ctx, game.currentBet * 3 + pot * 0.12);
    }
    const squeezeOk = !(TUNE.noSqueezeBluff && callersSoFar > 0);
    if (a.canRaise && squeezeOk && myPct > callCap && myPct <= bluffReHi && rand() < 0.4 * prof.bluffMult * diff.bluffScale) {
      ctx.think.plan = '3bet-bluff';
      return raiseTo(ctx, game.currentBet * 2.8);
    }
    if (callPct <= callCap) { ctx.think.plan = 'call'; return { type: 'call' }; }
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
    // 에쿼티 실현율: 포지션이 나쁘면 끝까지 가기 어렵고, 상대가 많을수록 더 어렵다
    const rz = game.street === 'river' ? 1
      : (inPos ? 0.90 : 0.80) * Math.pow(TUNE.multiwayRz, Math.max(0, ctx.opponents.length - 1));

    /*
     * 멀티스트리트 룩어헤드 (플랍·턴): 다음 카드 표본마다 "그 카드가 깔린 뒤 상대 콜 레인지보다
     * 앞서는 비율" 을 실제로 평가하고, 그 비율에 따른 단순 후속 정책(강하면 밸류 추출, 약하면
     * 체크-폴드, 중간이면 쇼다운 일부)으로 기대 팟을 매긴다. 드로우는 히트 카드에서만 앞서므로
     * 임플라이드 오즈가, 중간 강도 핸드는 리버스 임플라이드 오즈가 자연히 생긴다.
     * 한 스트리트 EV(고정 실현율)와 lookBlend 로 섞는다.
     */
    let lookPotMult = null;   // "지금 팟 1 당 앞으로 기대되는 몫"
    if (TUNE.lookahead && (game.street === 'flop' || game.street === 'turn') && dist) {
      lookPotMult = lookaheadMultiplier(ctx, holeCodes, boardCodes, combos, seed);
    }
    function futureEv(potAfter, cost) {
      const rioC = (game.street === 'river' ? 0 : TUNE.rioCall) * cost * (1 - eq);
      const now = eq * potAfter * rz;
      if (lookPotMult == null) return now - cost - rioC;
      const look = lookPotMult * potAfter;
      return TUNE.lookBlend * look + (1 - TUNE.lookBlend) * now - cost - rioC;
    }

    const candidates = [];
    if (a.canCheck) {
      candidates.push({ type: 'check', ev: futureEv(pot, 0), tag: 'check' });
    } else {
      candidates.push({ type: 'fold', ev: 0, tag: 'fold' });
      candidates.push({ type: 'call', amount: toCall, ev: futureEv(pot + toCall, toCall), tag: 'call' });
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
           지금 레인지의 가중 질량 중 강한 쪽 (1-pf) 만 남긴다.
           멀티웨이: 전원이 동시에 콜한다고 보면 승률이 지나치게 낮아진다. 기대 콜러 수만큼,
           콜 확률이 높은 상대부터 넣는다. */
        let eqCalled = eq;
        if (dist && pFoldAll < 0.96) {
          let idx = combos.map(function (c, i) { return i; });
          if (TUNE.likelyCallers && ranges.length > 1) {
            const pCalledTmp = 1 - pFoldAll;
            const k = Math.max(1, Math.min(ranges.length, Math.round(expCallers / pCalledTmp)));
            idx.sort(function (a, b) { return shares[b] - shares[a]; });
            idx = idx.slice(0, k);
          }
          const cc = idx.map(function (i) { return E.continueRange(combos[i], shares[i]); });
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
        const rio = game.street === 'river' ? 0 : TUNE.rioRaise;
        const ev = pFoldAll * pot
          + pCalled * (eqCalled * (pot + callers * theirCall) - (1 - eqCalled) * myCost * (1 + rio));

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

  /* 다음 카드 표본을 뽑아 "팟 1 당 기대 몫"을 돌려준다 */
  function lookaheadMultiplier(ctx, holeCodes, boardCodes, combos, seed) {
    const dead = new Uint8Array(52);
    dead[holeCodes[0]] = 1; dead[holeCodes[1]] = 1;
    for (let i = 0; i < boardCodes.length; i++) dead[boardCodes[i]] = 1;
    const unseen = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) unseen.push(c);
    /* 리뷰는 매번 같은 결과가 나와야 하므로 표본은 seed 에서 결정한다 */
    let s = (seed + 0x9E3779B9) >>> 0;
    function rnd() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const n = Math.min(TUNE.lookCards, unseen.length);
    // 부분 셔플로 n 장
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (unseen.length - i));
      const t = unseen[i]; unseen[i] = unseen[j]; unseen[j] = t;
    }
    let sum = 0;
    const b = TUNE.lookBetSize;
    for (let i = 0; i < n; i++) {
      const card = unseen[i];
      let v;
      if (TUNE.lookModel === 2) {
        /* 상대별로 "그 상대와 헤즈업" 가치를 구해 가장 위험한 상대(최소값)를 쓰고 멀티웨이 할인 */
        v = Infinity;
        for (let o = 0; o < combos.length; o++) {
          const st = E.standingAfterCard(holeCodes, boardCodes, card, combos[o], TUNE.lookCombos, TUNE.lookBetShare);
          // 상대가 벳: 콜할 가치가 있으면 콜 (팟 1 기준), 아니면 폴드 (0)
          const callEv = st.vsBet * (1 + b) - (1 - st.vsBet) * b;
          const betBranch = Math.max(0, callEv);
          // 상대가 체크: 내가 앞서면 벳해서 일부 뽑고, 아니면 체크로 쇼다운
          const chkBranch = st.vsCheck >= TUNE.lookStrong
            ? st.vsCheck + (2 * st.vsCheck - 1) * b * TUNE.lookPayoff
            : st.vsCheck;
          const vo = st.pBet * betBranch + (1 - st.pBet) * chkBranch;
          if (vo < v) v = vo;
        }
        if (!isFinite(v)) v = 0.5;
        v *= Math.pow(TUNE.lookMultiway, Math.max(0, combos.length - 1));
      } else {
        let ahead = 1;
        for (let o = 0; o < combos.length; o++) {
          ahead *= E.aheadAfterCard(holeCodes, boardCodes, card, combos[o], TUNE.lookCombos);
        }
        if (ahead >= TUNE.lookStrong) v = ahead + (2 * ahead - 1) * TUNE.lookExtract;
        else if (ahead <= TUNE.lookWeak) v = ahead * TUNE.lookWeakRz;
        else v = ahead * TUNE.lookMidRz;
      }
      sum += v;
    }
    return sum / n;
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
    shouldUseSolver: shouldUseSolver,
    adaptiveThreshold: adaptiveThreshold,
    opponentsVpip: opponentsVpip,
    NAMES: NAMES,
    DIFFICULTY: DIFFICULTY,
    KEEP_FOR_RATIO: KEEP_FOR_RATIO,
    TUNE: TUNE,
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
