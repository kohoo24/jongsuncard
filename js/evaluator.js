/*
 * evaluator.js - 포커 핸드 평가기
 * 5~7장 중 최고의 5장을 찾아 비교 가능한 정수 점수로 변환한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') require('./cards.js');
  const RANK_LABEL = (global.Holdem.cards || {}).RANK_LABEL;

  const CAT = {
    HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
    FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8
  };
  const CAT_NAMES = [
    '하이카드', '원페어', '투페어', '트리플', '스트레이트',
    '플러시', '풀하우스', '포카드', '스트레이트 플러시'
  ];

  const BASE = 15; // 랭크 최대값(14)보다 큰 진법

  function encode(cat, tb) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * BASE + (tb[i] || 0);
    return v;
  }

  // 5장 정확히 평가
  function evaluate5(cards) {
    const ranks = cards.map(function (c) { return c.rank; }).sort(function (a, b) { return b - a; });
    const suit0 = cards[0].suit;
    let isFlush = true;
    for (let i = 1; i < 5; i++) if (cards[i].suit !== suit0) { isFlush = false; break; }

    // 랭크별 개수
    const counts = {};
    for (let i = 0; i < 5; i++) counts[ranks[i]] = (counts[ranks[i]] || 0) + 1;
    const groups = Object.keys(counts).map(function (r) {
      return [parseInt(r, 10), counts[r]];
    }).sort(function (a, b) { return b[1] - a[1] || b[0] - a[0]; });

    // 스트레이트 판정 (A-5 휠 포함)
    let straightHigh = 0;
    if (groups.length === 5) {
      if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
      else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) straightHigh = 5;
    }

    let cat, tb;
    if (isFlush && straightHigh) {
      cat = CAT.STRAIGHT_FLUSH; tb = [straightHigh];
    } else if (groups[0][1] === 4) {
      cat = CAT.QUADS; tb = [groups[0][0], groups[1][0]];
    } else if (groups[0][1] === 3 && groups[1][1] === 2) {
      cat = CAT.FULL_HOUSE; tb = [groups[0][0], groups[1][0]];
    } else if (isFlush) {
      cat = CAT.FLUSH; tb = ranks.slice();
    } else if (straightHigh) {
      cat = CAT.STRAIGHT; tb = [straightHigh];
    } else if (groups[0][1] === 3) {
      cat = CAT.TRIPS; tb = [groups[0][0], groups[1][0], groups[2][0]];
    } else if (groups[0][1] === 2 && groups[1][1] === 2) {
      cat = CAT.TWO_PAIR; tb = [groups[0][0], groups[1][0], groups[2][0]];
    } else if (groups[0][1] === 2) {
      cat = CAT.PAIR; tb = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
    } else {
      cat = CAT.HIGH; tb = ranks.slice();
    }

    return { value: encode(cat, tb), cat: cat, tiebreak: tb, cards: cards.slice() };
  }

  // n장 중 5장 조합 인덱스 (캐시)
  const comboCache = {};
  function combos5(n) {
    if (comboCache[n]) return comboCache[n];
    const out = [];
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) out.push([a, b, c, d, e]);
    comboCache[n] = out;
    return out;
  }

  // 5~7장에서 최고 핸드
  function evaluate(cards) {
    if (cards.length < 5) throw new Error('카드가 5장 미만입니다');
    if (cards.length === 5) return evaluate5(cards);
    const list = combos5(cards.length);
    let best = null;
    const buf = new Array(5);
    for (let i = 0; i < list.length; i++) {
      const idx = list[i];
      for (let k = 0; k < 5; k++) buf[k] = cards[idx[k]];
      const res = evaluate5(buf);
      if (!best || res.value > best.value) best = res;
    }
    return best;
  }

  // 점수만 빠르게 (시뮬레이션용)
  function score(cards) {
    return evaluate(cards).value;
  }

  function lbl(r) { return RANK_LABEL ? RANK_LABEL[r] : String(r); }

  function describe(res) {
    const t = res.tiebreak;
    switch (res.cat) {
      case CAT.STRAIGHT_FLUSH:
        return t[0] === 14 ? '로열 플러시' : '스트레이트 플러시 (' + lbl(t[0]) + ' 하이)';
      case CAT.QUADS: return '포카드 (' + lbl(t[0]) + ')';
      case CAT.FULL_HOUSE: return '풀하우스 (' + lbl(t[0]) + ' + ' + lbl(t[1]) + ')';
      case CAT.FLUSH: return '플러시 (' + lbl(t[0]) + ' 하이)';
      case CAT.STRAIGHT: return '스트레이트 (' + lbl(t[0]) + ' 하이)';
      case CAT.TRIPS: return '트리플 (' + lbl(t[0]) + ')';
      case CAT.TWO_PAIR: return '투페어 (' + lbl(t[0]) + ', ' + lbl(t[1]) + ')';
      case CAT.PAIR: return '원페어 (' + lbl(t[0]) + ')';
      default: return '하이카드 (' + lbl(t[0]) + ')';
    }
  }

  H.eval = {
    CAT: CAT,
    CAT_NAMES: CAT_NAMES,
    evaluate5: evaluate5,
    evaluate: evaluate,
    score: score,
    describe: describe
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
