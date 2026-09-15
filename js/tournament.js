/*
 * tournament.js - 블라인드 구조, ICM, 상금 분배
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  /* 블라인드 레벨 스케줄: 배수 시퀀스로 생성한다 */
  const MULTIPLIERS = [1, 1.5, 2.5, 4, 6, 10, 15, 25, 40, 60, 100, 150, 250, 400];

  function round5(n) {
    if (n < 25) return Math.max(1, Math.round(n));
    if (n < 100) return Math.round(n / 5) * 5;
    if (n < 1000) return Math.round(n / 25) * 25;
    return Math.round(n / 100) * 100;
  }

  /**
   * @param {number} baseSb   1레벨 스몰블라인드
   * @param {string} anteMode 'off' | 'bb' | 'all'
   * @param {number} anteFrom 앤티가 시작되는 레벨 (1부터)
   */
  function makeLevels(baseSb, anteMode, anteFrom) {
    const from = anteFrom || 4;
    return MULTIPLIERS.map(function (m, i) {
      const sb = round5(baseSb * m);
      const bb = sb * 2;
      let ante = 0;
      if (anteMode && anteMode !== 'off' && i + 1 >= from) {
        ante = anteMode === 'bb' ? bb : round5(bb / 5);
      }
      return { level: i + 1, sb: sb, bb: bb, ante: ante };
    });
  }

  /* 인원수별 상금 비율 */
  function payoutStructure(n) {
    if (n <= 4) return [1];
    if (n <= 6) return [0.65, 0.35];
    if (n <= 9) return [0.50, 0.30, 0.20];
    return [0.40, 0.25, 0.18, 0.10, 0.07];
  }

  /**
   * ICM (Malmuth-Harville) 지분 계산.
   * 스택 비율만으로 각 등수에 들 확률을 구해 상금 기대값을 낸다.
   * @param {number[]} stacks
   * @param {number[]} payouts 상금 (등수 순)
   */
  function icmEquity(stacks, payouts) {
    const n = stacks.length;
    const result = new Array(n).fill(0);
    if (!n || !payouts.length) return result;
    const depth = Math.min(payouts.length, n);

    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);

    function recurse(remaining, place, prob) {
      if (place >= depth) return;
      let sum = 0;
      for (let k = 0; k < remaining.length; k++) sum += stacks[remaining[k]];
      if (sum <= 0) return;
      for (let k = 0; k < remaining.length; k++) {
        const i = remaining[k];
        const p = prob * (stacks[i] / sum);
        if (p < 1e-9) continue;
        result[i] += p * payouts[place];
        if (place + 1 < depth && remaining.length > 1) {
          const next = remaining.slice(0, k).concat(remaining.slice(k + 1));
          recurse(next, place + 1, p);
        }
      }
    }
    recurse(idx, 0, 1);
    return result;
  }

  /* 칩 지분 대비 ICM 지분 (1 미만이면 칩 가치가 희석되는 구간) */
  function icmPressure(stacks, payouts) {
    const total = stacks.reduce(function (a, b) { return a + b; }, 0);
    const prize = payouts.reduce(function (a, b) { return a + b; }, 0);
    const icm = icmEquity(stacks, payouts);
    return stacks.map(function (s, i) {
      const chipShare = total > 0 ? (s / total) * prize : 0;
      return chipShare > 0 ? icm[i] / chipShare : 0;
    });
  }

  H.tournament = {
    MULTIPLIERS: MULTIPLIERS,
    makeLevels: makeLevels,
    payoutStructure: payoutStructure,
    icmEquity: icmEquity,
    icmPressure: icmPressure,
    round5: round5
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
