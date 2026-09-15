/*
 * equity.js - 레인지 기반 승률 추정
 *
 * 기존 구현은 상대 홀카드를 덱에서 완전 무작위로 뽑았다. 그 가정은
 * 실측 결과 최대 23.8%p 까지 틀렸다(포켓 99: 랜덤 상대 72.8% vs 타이트 레인지 49.3%).
 * 여기서는 상대가 지금까지 한 액션과 모순되지 않는 홀카드 조합만 샘플링한다.
 *
 * 상대 레인지 = 프리플랍 백분위 밴드 + 보드 위 핸드 강도 하한(minStrength).
 * 보드가 깔리면 가능한 모든 홀카드 조합(플랍이면 1,081가지)을 실제로 평가해
 * 강도 분포를 만들고, 그 분포 위에서 레인지를 자른다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./evaluator.js'); require('./ranges.js'); }

  const K = H.eval.kernel;

  /* ---------- 워커에 그대로 옮겨지는 시뮬레이션 커널 ---------- */
  function simKernel(K) {
    const used = new Int32Array(52);
    let gen = 0;
    const hero = new Int32Array(7);
    const opp2 = new Int32Array(7);
    const opp = new Int32Array(24);
    const board = new Int32Array(5);

    function mulberry32(a) {
      a = (a >>> 0) || 1;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /*
     * req = {
     *   hole: [c1, c2],
     *   board: Int32Array, boardLen: n,
     *   combos: [Int32Array...]  상대별 (콤보 2개씩 평탄화된) 허용 조합
     *   sims, seed
     * }
     */
    function run(req) {
      const rand = mulberry32(req.seed);
      const nOpp = req.combos.length;
      const boardLen = req.boardLen;
      const need = 5 - boardLen;
      const sims = req.sims;
      let win = 0, tie = 0, done = 0, guard = 0;

      while (done < sims && guard++ < sims * 20) {
        gen++;
        used[req.hole[0]] = gen;
        used[req.hole[1]] = gen;
        for (let i = 0; i < boardLen; i++) { board[i] = req.board[i]; used[board[i]] = gen; }

        // 상대별 홀카드 배정 (카드 충돌 시 재시도)
        let ok = true;
        for (let o = 0; o < nOpp; o++) {
          const list = req.combos[o];
          const pairs = list.length >> 1;
          let got = false;
          for (let tryN = 0; tryN < 48 && !got; tryN++) {
            const p = (rand() * pairs) | 0;
            const a = list[p << 1], b = list[(p << 1) + 1];
            if (used[a] !== gen && used[b] !== gen) {
              used[a] = gen; used[b] = gen;
              opp[o * 2] = a; opp[o * 2 + 1] = b;
              got = true;
            }
          }
          if (!got) { ok = false; break; }
        }
        if (!ok) continue;   // 레인지가 겹쳐 카드 배정에 실패하면 이 시도는 버린다

        // 남은 보드 카드
        for (let i = 0; i < need; i++) {
          let c;
          do { c = (rand() * 52) | 0; } while (used[c] === gen);
          used[c] = gen;
          board[boardLen + i] = c;
        }

        hero[0] = req.hole[0]; hero[1] = req.hole[1];
        for (let i = 0; i < 5; i++) hero[2 + i] = board[i];
        const mine = K.evalCodes(hero, 7);

        let best = -1;
        for (let o = 0; o < nOpp; o++) {
          opp2[0] = opp[o * 2]; opp2[1] = opp[o * 2 + 1];
          for (let i = 0; i < 5; i++) opp2[2 + i] = board[i];
          const v = K.evalCodes(opp2, 7);
          if (v > best) best = v;
        }
        if (mine > best) win++;
        else if (mine === best) tie++;
        done++;
      }
      return {
        win: win, tie: tie, sims: done,
        equity: done > 0 ? (win + tie * 0.5) / done : 0.5
      };
    }

    return { run: run };
  }

  const sim = simKernel(K);

  /* ---------- 보드 위 핸드 강도 분포 ---------- */
  const distBuf = new Int32Array(7);

  /**
   * 주어진 보드에서 (죽은 카드를 제외한) 모든 홀카드 조합의 핸드 점수를 구해
   * 정렬한 배열을 돌려준다. 플랍이면 1,081가지, 턴이면 990가지.
   */
  function boardDistribution(boardCodes, deadCodes) {
    const boardLen = boardCodes.length;
    if (boardLen < 3) return null;
    const dead = new Uint8Array(52);
    for (let i = 0; i < boardLen; i++) dead[boardCodes[i]] = 1;
    for (let i = 0; i < deadCodes.length; i++) dead[deadCodes[i]] = 1;
    const live = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) live.push(c);

    for (let i = 0; i < boardLen; i++) distBuf[2 + i] = boardCodes[i];
    const out = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        distBuf[0] = live[i]; distBuf[1] = live[j];
        out.push(K.evalCodes(distBuf, boardLen + 2));
      }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /** 분포에서 상위 pct 에 해당하는 점수 하한 (pct=0.3 이면 상위 30% 경계) */
  function valueAtTopPct(dist, pct) {
    if (!dist || !dist.length) return -1;
    const idx = Math.floor((1 - pct) * (dist.length - 1));
    return dist[Math.max(0, Math.min(dist.length - 1, idx))];
  }

  /** 점수가 분포에서 상위 몇 %인지 */
  function pctOfValue(dist, value) {
    if (!dist || !dist.length) return 0.5;
    let lo = 0, hi = dist.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (dist[m] < value) lo = m + 1; else hi = m; }
    return 1 - (lo / dist.length);
  }

  /* ---------- 상대 레인지 -> 허용 홀카드 조합 목록 ---------- */
  const comboBuf = new Int32Array(7);

  /**
   * @param {object} range  {band:{lo,hi}, keepTop:0~1}  keepTop 이 작을수록 강한 레인지
   * @param {Array}  boardCodes
   * @param {Array}  deadCodes  이미 알려진 카드(내 홀카드 등)
   * @param {Array}  dist  boardDistribution 결과 (없으면 강도 필터 생략)
   */
  function buildCombos(range, boardCodes, deadCodes, dist) {
    const R = H.ranges;
    const dead = new Uint8Array(52);
    for (let i = 0; i < boardCodes.length; i++) dead[boardCodes[i]] = 1;
    for (let i = 0; i < deadCodes.length; i++) dead[deadCodes[i]] = 1;
    const live = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) live.push(c);

    const band = range.band || { lo: 0, hi: 1 };
    const keepTop = range.keepTop == null ? 1 : range.keepTop;
    const boardLen = boardCodes.length;
    const threshold = (keepTop < 0.999 && dist) ? valueAtTopPct(dist, keepTop) : -1;

    for (let i = 0; i < boardLen; i++) comboBuf[2 + i] = boardCodes[i];

    const out = [];
    const bandOnly = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const pct = R.percentile(R.classOfCodes(a, b));
        if (pct < band.lo || pct > band.hi) continue;
        bandOnly.push(a, b);
        if (threshold >= 0) {
          comboBuf[0] = a; comboBuf[1] = b;
          if (K.evalCodes(comboBuf, boardLen + 2) < threshold) continue;
        }
        out.push(a, b);
      }
    }
    // 레인지가 지나치게 좁아지면 단계적으로 완화한다
    if (out.length >= 8) return new Int32Array(out);
    if (bandOnly.length >= 8) return new Int32Array(bandOnly);
    const all = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) all.push(live[i], live[j]);
    return new Int32Array(all);
  }

  /* ---------- 동기 승률 계산 ---------- */
  function vsRanges(opts) {
    const holeCodes = opts.hole;
    const boardCodes = opts.board || [];
    const sims = opts.sims || 1000;
    const seed = opts.seed != null ? opts.seed : ((Math.random() * 4294967295) >>> 0);
    if (!opts.combos.length) return { equity: 1, win: sims, tie: 0, sims: sims };
    return sim.run({
      hole: Int32Array.from(holeCodes),
      board: Int32Array.from(boardCodes),
      boardLen: boardCodes.length,
      combos: opts.combos,
      sims: sims,
      seed: seed
    });
  }

  /* ---------- Web Worker ---------- */
  let worker = null, workerReady = false, nextId = 1;
  const pending = {};

  function buildWorkerSource() {
    return 'var makeKernel = ' + H.eval.kernelSource + ';\n' +
      'var K = makeKernel();\n' +
      'var makeSim = ' + simKernel.toString() + ';\n' +
      'var S = makeSim(K);\n' +
      'self.onmessage = function (e) {\n' +
      '  var d = e.data;\n' +
      '  self.postMessage({ id: d.id, result: S.run(d.req) });\n' +
      '};';
  }

  function initWorker() {
    if (worker !== null || typeof global.Worker !== 'function' || typeof Blob !== 'function') return;
    try {
      const blob = new Blob([buildWorkerSource()], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      worker.onmessage = function (e) {
        const cb = pending[e.data.id];
        if (cb) { delete pending[e.data.id]; cb(e.data.result); }
      };
      worker.onerror = function () { worker = null; workerReady = false; };
      workerReady = true;
    } catch (e) {
      worker = null;
      workerReady = false;
    }
  }

  /** 워커가 있으면 워커에서, 없으면 동기로 계산한다. 항상 Promise 를 돌려준다. */
  function vsRangesAsync(opts) {
    if (typeof Promise !== 'function') return null;
    if (!workerReady) initWorker();
    if (!worker || !workerReady) {
      return Promise.resolve(vsRanges(opts));
    }
    const id = nextId++;
    const req = {
      hole: Int32Array.from(opts.hole),
      board: Int32Array.from(opts.board || []),
      boardLen: (opts.board || []).length,
      combos: opts.combos,
      sims: opts.sims || 1000,
      seed: opts.seed != null ? opts.seed : ((Math.random() * 4294967295) >>> 0)
    };
    return new Promise(function (resolve) {
      pending[id] = resolve;
      try {
        worker.postMessage({ id: id, req: req });
      } catch (e) {
        delete pending[id];
        resolve(vsRanges(opts));
      }
      // 워커가 응답하지 않으면 동기 계산으로 되돌린다
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; resolve(vsRanges(opts)); }
      }, 4000);
    });
  }

  /* ---------- 폴드 에쿼티 ---------- */
  /**
   * 팟 p 에 b 만큼 베팅했을 때 상대 한 명이 접을 확률.
   * MDF(최소 방어 빈도) b/(p+b) 를 기준으로, 실제 플레이어는 그보다 더 접으므로
   * overFold 계수를 곱한다. 레인지가 강할수록(minStrength 높을수록) 덜 접는다.
   */
  function foldProbability(potSize, betSize, range, overFold) {
    if (betSize <= 0) return 0;
    const mdf = betSize / (potSize + betSize);          // 최소 방어 빈도
    const keepTop = range && range.keepTop != null ? range.keepTop : 1;
    const strength = 1 - keepTop;                        // 0=넓고 약함, 1=아주 강함
    let p = mdf * (overFold != null ? overFold : 1.35) * (1 - strength * 0.55);
    return Math.max(0.02, Math.min(0.92, p));
  }

  /* ---------- 아웃 / 드로우 ---------- */

  /**
   * 아웃 계산.
   *
   * "카테고리가 올라가는 카드"를 세면 보드 페어까지 아웃으로 잡혀 과다 계산된다
   * (AhKh on Qh7h2s 가 23아웃으로 나온다). 대신 그 카드가 떨어졌을 때
   * 내 핸드가 "그 보드에서 가능한 모든 홀카드 중 상위 STRONG_PCT" 안에 드는지를 본다.
   * 보드가 페어되면 상대 분포도 같이 올라가므로 자동으로 걸러진다.
   */
  const STRONG_PCT = 0.82;
  const outBuf = new Int32Array(7);

  function analyzeDraws(holeCards, boardCards) {
    const T = H.i18n.t;
    const boardLen = boardCards.length;
    if (boardLen < 3 || boardLen > 4) return { outs: 0, oneCard: 0, byRiver: 0, labels: [], cat: 0 };

    const holeCodes = holeCards.map(H.cards.code);
    const boardCodes = boardCards.map(H.cards.code);
    const dead = new Uint8Array(52);
    holeCodes.concat(boardCodes).forEach(function (c) { dead[c] = 1; });

    const cur = H.eval.evaluate(holeCards.concat(boardCards));
    const curDist = boardDistribution(boardCodes, holeCodes);
    const curPct = pctOfValue(curDist, cur.value);
    const alreadyStrong = curPct <= (1 - STRONG_PCT);

    outBuf[0] = holeCodes[0]; outBuf[1] = holeCodes[1];
    for (let i = 0; i < boardLen; i++) outBuf[2 + i] = boardCodes[i];

    let outs = 0;
    const nextBoard = boardCodes.slice();
    nextBoard.push(0);
    for (let c = 0; c < 52; c++) {
      if (dead[c]) continue;
      outBuf[2 + boardLen] = c;
      const myValue = K.evalCodes(outBuf, boardLen + 3);
      nextBoard[boardLen] = c;
      const d = boardDistribution(nextBoard, holeCodes);
      const threshold = valueAtTopPct(d, 1 - STRONG_PCT);
      if (myValue >= threshold && !alreadyStrong) outs++;
    }

    const unknown = 52 - 2 - boardLen;
    const oneCard = outs / unknown;
    let byRiver = oneCard;
    if (boardLen === 3) {
      const miss = ((unknown - outs) / unknown) * ((unknown - 1 - outs) / (unknown - 1));
      byRiver = 1 - miss;
    }

    /* 드로우 종류 라벨 */
    const labels = [];
    const all = holeCards.concat(boardCards);
    const suitCount = {};
    all.forEach(function (c) { suitCount[c.suit] = (suitCount[c.suit] || 0) + 1; });
    let maxSuit = 0;
    Object.keys(suitCount).forEach(function (s) { maxSuit = Math.max(maxSuit, suitCount[s]); });
    if (maxSuit === 4) labels.push(T('draw.flush'));

    let mask = 0;
    all.forEach(function (c) { mask |= (1 << (c.rank - 2)); });
    let straightOuts = 0;
    for (let r = 0; r < 13; r++) {
      if (mask & (1 << r)) continue;
      const m2 = mask | (1 << r);
      let made = false;
      for (let hi = 12; hi >= 4; hi--) {
        const need = (1 << hi) | (1 << (hi - 1)) | (1 << (hi - 2)) | (1 << (hi - 3)) | (1 << (hi - 4));
        if ((m2 & need) === need) { made = true; break; }
      }
      const wheel = (1 << 12) | 1 | 2 | 4 | 8;
      if (!made && (m2 & wheel) === wheel) made = true;
      if (made) straightOuts++;
    }
    const hasStraight = cur.cat >= H.eval.CAT.STRAIGHT;
    if (!hasStraight) {
      if (straightOuts >= 2) labels.push(T('draw.oesd'));
      else if (straightOuts === 1) labels.push(T('draw.gutshot'));
    }

    if (alreadyStrong) labels.unshift(T('draw.madeHand'));
    else if (cur.cat < H.eval.CAT.PAIR) {
      const boardHigh = Math.max.apply(null, boardCards.map(function (c) { return c.rank; }));
      const over = holeCards.filter(function (c) { return c.rank > boardHigh; }).length;
      if (over === 2) labels.push(T('draw.overcards'));
    }

    return {
      outs: outs, oneCard: oneCard, byRiver: byRiver,
      labels: labels, cat: cur.cat, strong: alreadyStrong, topPct: curPct
    };
  }

  H.equity = {
    simKernel: simKernel,
    boardDistribution: boardDistribution,
    valueAtTopPct: valueAtTopPct,
    pctOfValue: pctOfValue,
    buildCombos: buildCombos,
    vsRanges: vsRanges,
    vsRangesAsync: vsRangesAsync,
    foldProbability: foldProbability,
    analyzeDraws: analyzeDraws,
    initWorker: initWorker,
    hasWorker: function () { return !!worker && workerReady; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
