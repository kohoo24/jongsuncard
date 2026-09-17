/*
 * style.js - 플레이 스타일 진단
 *
 * 세션 통계(VPIP · PFR · AF · 벳에 대한 폴드 · WTSD · 3벳)를 "탄탄한 플레이어"의 범위와 견주어
 * 성향 유형 하나와 밸런스 점수(0~100), 개선 포인트 몇 줄을 만든다. 약점 프로파일이 "어느 자리에서
 * 흘리는가"라면 이것은 "어떤 버릇으로 흘리는가"다.
 *
 * 기준 범위는 인원수에 따라 움직인다 — 9인 풀링의 정상 VPIP 는 6맥스보다 낮다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  const MIN_HANDS = 20;

  /* 유형: 루즈/타이트 × 어그레시브/패시브. 이름은 i18n 키 */
  const TYPES = {
    tag: { key: 'tag', icon: '🦈' },      // 타이트-어그레시브
    lag: { key: 'lag', icon: '🦅' },      // 루즈-어그레시브
    rock: { key: 'rock', icon: '🐢' },    // 타이트-패시브
    fish: { key: 'fish', icon: '🐟' }     // 루즈-패시브
  };

  /* 탄탄한 범위 [lo, hi] — 6맥스 기준. VPIP/PFR 은 인원수로 보정한다 */
  function ranges(players) {
    const n = Math.max(2, Math.min(9, players || 6));
    const k = n <= 2 ? 1.9 : n <= 4 ? 1.3 : n <= 6 ? 1.0 : 0.75;   // 헤즈업은 넓게, 풀링은 좁게
    return {
      vpip: [0.20 * k, 0.30 * k],
      pfr: [0.14 * k, 0.24 * k],
      ratio: [0.6, 0.85],           // PFR / VPIP
      af: [1.8, 3.5],
      foldToBet: [0.35, 0.55],
      wtsd: [0.22, 0.34],
      threeBet: [0.05, 0.11]
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /*
   * 값이 범위 안이면 0, 벗어나면 범위 폭 대비 얼마나 벗어났는지 (1 = 범위 폭만큼).
   * 점수는 이 편차들의 가중 합에서 뺀다.
   */
  function deviation(v, range) {
    if (v == null || isNaN(v)) return 0;
    const w = range[1] - range[0];
    if (v < range[0]) return (range[0] - v) / w;
    if (v > range[1]) return (v - range[1]) / w;
    return 0;
  }

  /**
   * @param stats  H.stats Tracker.get() 결과
   * @param players 테이블 인원수
   * @returns {object|null}  { type, icon, score, hands, rows: [{key, value, lo, hi, status}], tips: [key] }
   */
  function diagnose(stats, players) {
    if (!stats || stats.hands < MIN_HANDS) return null;
    const R = ranges(players);
    const ratio = stats.vpip > 0 ? stats.pfr / stats.vpip : 0;
    const enoughPost = stats.samples && stats.samples.facedBet >= 8;
    const enoughSd = stats.samples && stats.samples.showdown >= 4;
    const enough3b = stats.samples && stats.samples.threeBetOpp >= 8;

    const rows = [
      { key: 'vpip', value: stats.vpip, range: R.vpip, weight: 1.0, fmt: 'pct' },
      { key: 'pfr', value: stats.pfr, range: R.pfr, weight: 0.8, fmt: 'pct' },
      { key: 'af', value: stats.af, range: R.af, weight: 0.8, fmt: 'num', skip: !enoughPost },
      { key: 'foldToBet', value: stats.foldToBet, range: R.foldToBet, weight: 0.9, fmt: 'pct', skip: !enoughPost },
      { key: 'wtsd', value: stats.wtsd, range: R.wtsd, weight: 0.6, fmt: 'pct', skip: !enoughSd },
      { key: 'threeBet', value: stats.threeBet, range: R.threeBet, weight: 0.5, fmt: 'pct', skip: !enough3b }
    ];

    let penalty = 0, weightSum = 0;
    rows.forEach(function (r) {
      r.lo = r.range[0]; r.hi = r.range[1];
      r.dev = r.skip ? 0 : deviation(r.value, r.range);
      r.status = r.skip ? 'na' : r.dev === 0 ? 'ok' : r.value < r.lo ? 'low' : 'high';
      if (!r.skip) { penalty += r.weight * clamp(r.dev, 0, 1.5); weightSum += r.weight; }
    });
    /* 범위 폭만큼 벗어난 지표 하나(가중치 1)가 -22점. 네 지표가 크게 벗어난 물고기는 30 안팎 */
    const score = weightSum ? Math.round(100 - 22 * penalty) : 50;

    /* 유형: VPIP 가 범위 위면 루즈, 아래·안이면 타이트 쪽. 어그레시브는 PFR/VPIP 나 AF */
    const loose = stats.vpip > R.vpip[1];
    const aggressive = ratio >= R.ratio[0] || (enoughPost && stats.af >= R.af[0]);
    const type = loose ? (aggressive ? TYPES.lag : TYPES.fish) : (aggressive ? TYPES.tag : TYPES.rock);

    /* 개선 포인트: 편차가 큰 순으로 최대 3개 */
    const tips = rows.filter(function (r) { return r.status === 'low' || r.status === 'high'; })
      .sort(function (a, b) { return b.dev * b.weight - a.dev * a.weight; })
      .slice(0, 3)
      .map(function (r) { return 'style.tip.' + r.key + '.' + r.status; });

    return {
      type: type.key, icon: type.icon, score: clamp(score, 0, 100), hands: stats.hands,
      loose: loose, aggressive: aggressive,
      rows: rows.map(function (r) { return { key: r.key, value: r.value, lo: r.lo, hi: r.hi, status: r.status, fmt: r.fmt }; }),
      tips: tips
    };
  }

  H.style = { diagnose: diagnose, ranges: ranges, MIN_HANDS: MIN_HANDS, TYPES: TYPES };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
