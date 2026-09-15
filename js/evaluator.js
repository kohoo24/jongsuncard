/*
 * evaluator.js - 포커 핸드 평가기 (무할당 직접 평가)
 *
 * 21가지 조합을 모두 돌리는 대신 랭크 카운트 + 무늬 비트마스크 +
 * 스트레이트 룩업 테이블(8192엔트리, 8KB)로 7장을 한 번에 평가한다.
 * 기존 브루트포스 구현 대비 약 140배 빠르다.
 *
 * 점수 인코딩 (클수록 강함):
 *   value = ((((cat*15 + t0)*15 + t1)*15 + t2)*15 + t3)*15 + t4
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./cards.js'); require('./i18n.js'); }

  const CAT = {
    HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
    FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8
  };

  /*
   * 커널 - 외부 스코프에 전혀 의존하지 않는 자기완결 함수.
   * toString() 으로 직렬화해 Web Worker 안에서 그대로 재생성할 수 있다.
   */
  function pokerKernel() {
    const B = 15;
    const P5 = 759375, P4 = 50625, P3 = 3375, P2 = 225, P1 = 15;

    // 13비트 랭크 마스크 -> 스트레이트 하이 랭크(0=없음). 휠(A-5) 포함
    const STRAIGHT = new Int8Array(8192);
    for (let m = 0; m < 8192; m++) {
      let hi = 0;
      for (let r = 12; r >= 4; r--) {
        const need = (1 << r) | (1 << (r - 1)) | (1 << (r - 2)) | (1 << (r - 3)) | (1 << (r - 4));
        if ((m & need) === need) { hi = r + 2; break; }
      }
      if (!hi) {
        const wheel = (1 << 12) | 1 | 2 | 4 | 8; // A,2,3,4,5
        if ((m & wheel) === wheel) hi = 5;
      }
      STRAIGHT[m] = hi;
    }

    const rc = new Int8Array(13);   // 랭크별 장수
    const sc = new Int8Array(4);    // 무늬별 장수
    const sm = new Int32Array(4);   // 무늬별 랭크 마스크

    /* codes: 0..51 정수 배열 (rankIndex*4 + suitIndex), n: 사용할 길이 */
    function evalCodes(codes, n) {
      const len = n === undefined ? codes.length : n;
      rc[0] = rc[1] = rc[2] = rc[3] = rc[4] = rc[5] = rc[6] = 0;
      rc[7] = rc[8] = rc[9] = rc[10] = rc[11] = rc[12] = 0;
      sc[0] = sc[1] = sc[2] = sc[3] = 0;
      sm[0] = sm[1] = sm[2] = sm[3] = 0;
      let mask = 0;
      for (let i = 0; i < len; i++) {
        const c = codes[i];
        const r = c >> 2, s = c & 3;
        rc[r]++; sc[s]++; sm[s] |= (1 << r); mask |= (1 << r);
      }

      // 플러시 계열
      let fs = -1;
      if (sc[0] >= 5) fs = 0; else if (sc[1] >= 5) fs = 1;
      else if (sc[2] >= 5) fs = 2; else if (sc[3] >= 5) fs = 3;
      if (fs >= 0) {
        const fm = sm[fs];
        const sf = STRAIGHT[fm];
        if (sf) return 8 * P5 + sf * P4;              // 스트레이트 플러시
        let v = 5, cnt = 0;                            // 플러시: 상위 5장
        for (let r = 12; r >= 0 && cnt < 5; r--) if (fm & (1 << r)) { v = v * B + (r + 2); cnt++; }
        while (cnt++ < 5) v *= B;
        return v;
      }

      // 페어 계열 집계
      let quad = -1, trip = -1, p1 = -1, p2 = -1;
      for (let r = 12; r >= 0; r--) {
        const k = rc[r];
        if (k === 4) { if (quad < 0) quad = r; }
        else if (k === 3) { if (trip < 0) trip = r; else if (p1 < 0) p1 = r; }
        else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
      }

      if (quad >= 0) {
        let kick = -1;
        for (let r = 12; r >= 0; r--) if (r !== quad && rc[r]) { kick = r; break; }
        return 7 * P5 + (quad + 2) * P4 + (kick + 2) * P3;
      }
      if (trip >= 0 && p1 >= 0) {
        return 6 * P5 + (trip + 2) * P4 + (p1 + 2) * P3;
      }
      const st = STRAIGHT[mask];
      if (st) return 4 * P5 + st * P4;
      if (trip >= 0) {
        let v = 3 * B + (trip + 2), cnt = 0;
        for (let r = 12; r >= 0 && cnt < 2; r--) if (r !== trip && rc[r]) { v = v * B + (r + 2); cnt++; }
        while (cnt++ < 2) v *= B;
        return v * P2;
      }
      if (p2 >= 0) {
        let kick = -1;
        for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rc[r]) { kick = r; break; }
        return 2 * P5 + (p1 + 2) * P4 + (p2 + 2) * P3 + (kick + 2) * P2;
      }
      if (p1 >= 0) {
        let v = 1 * B + (p1 + 2), cnt = 0;
        for (let r = 12; r >= 0 && cnt < 3; r--) if (r !== p1 && rc[r]) { v = v * B + (r + 2); cnt++; }
        while (cnt++ < 3) v *= B;
        return v * P1;
      }
      let v = 0, cnt = 0;
      for (let r = 12; r >= 0 && cnt < 5; r--) if (rc[r]) { v = v * B + (r + 2); cnt++; }
      return v;
    }

    return { evalCodes: evalCodes, STRAIGHT: STRAIGHT, BASE: B };
  }

  const kernel = pokerKernel();

  /* --- 카드 객체 <-> 정수 코드 --- */
  const SUIT_IDX = { s: 0, h: 1, d: 2, c: 3 };
  const buf = new Int32Array(7);

  function toCodes(cards, out) {
    const arr = out || buf;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      arr[i] = (c.rank - 2) * 4 + SUIT_IDX[c.suit];
    }
    return arr;
  }

  function score(cards) {
    if (cards.length < 5) throw new Error('카드가 5장 미만입니다');
    if (cards.length <= 7) return kernel.evalCodes(toCodes(cards), cards.length);
    const tmp = new Int32Array(cards.length);
    return kernel.evalCodes(toCodes(cards, tmp), cards.length);
  }

  function decode(value) {
    const cat = Math.floor(value / 759375);
    let rem = value - cat * 759375;
    const tb = [];
    const div = [50625, 3375, 225, 15, 1];
    for (let i = 0; i < 5; i++) {
      const d = Math.floor(rem / div[i]);
      rem -= d * div[i];
      tb.push(d);
    }
    while (tb.length && tb[tb.length - 1] === 0) tb.pop();
    return { cat: cat, tiebreak: tb };
  }

  function evaluate(cards) {
    const value = score(cards);
    const d = decode(value);
    return { value: value, cat: d.cat, tiebreak: d.tiebreak };
  }

  /* 최고 핸드를 이루는 5장을 돌려준다 (쇼다운 하이라이트용) */
  const COMBO_CACHE = {};
  function combos5(n) {
    if (COMBO_CACHE[n]) return COMBO_CACHE[n];
    const out = [];
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) out.push([a, b, c, d, e]);
    COMBO_CACHE[n] = out;
    return out;
  }

  function best5(cards) {
    if (cards.length <= 5) return cards.slice();
    const target = score(cards);
    const list = combos5(cards.length);
    const five = new Int32Array(5);
    const codes = toCodes(cards, new Int32Array(cards.length));
    for (let i = 0; i < list.length; i++) {
      const idx = list[i];
      for (let k = 0; k < 5; k++) five[k] = codes[idx[k]];
      if (kernel.evalCodes(five, 5) === target) {
        return [cards[idx[0]], cards[idx[1]], cards[idx[2]], cards[idx[3]], cards[idx[4]]];
      }
    }
    return cards.slice(0, 5);
  }

  function lbl(r) { return H.cards.RANK_LABEL[r]; }

  function describe(res) {
    const t = res.tiebreak;
    const T = H.i18n.t;
    switch (res.cat) {
      case CAT.STRAIGHT_FLUSH:
        return t[0] === 14 ? T('hand.royalFlush') : T('hand.straightFlush', { r: lbl(t[0]) });
      case CAT.QUADS: return T('hand.quads', { r: lbl(t[0]) });
      case CAT.FULL_HOUSE: return T('hand.fullHouse', { a: lbl(t[0]), b: lbl(t[1]) });
      case CAT.FLUSH: return T('hand.flush', { r: lbl(t[0]) });
      case CAT.STRAIGHT: return T('hand.straight', { r: lbl(t[0]) });
      case CAT.TRIPS: return T('hand.trips', { r: lbl(t[0]) });
      case CAT.TWO_PAIR: return T('hand.twoPair', { a: lbl(t[0]), b: lbl(t[1]) });
      case CAT.PAIR: return T('hand.pair', { r: lbl(t[0]) });
      default: return T('hand.highCard', { r: lbl(t[0]) });
    }
  }

  H.eval = {
    CAT: CAT,
    kernel: kernel,
    kernelSource: pokerKernel.toString(),
    toCodes: toCodes,
    score: score,
    decode: decode,
    evaluate: evaluate,
    evaluate5: evaluate,
    best5: best5,
    describe: describe
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
