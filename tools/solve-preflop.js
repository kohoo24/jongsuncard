/*
 * tools/solve-preflop.js - 프리플랍 솔버 (오프라인)
 *
 *   node tools/solve-preflop.js            # 2·3·6·9인을 풀어 js/preflop-table.js 를 만든다
 *   node tools/solve-preflop.js 6 200000   # 인원 · 반복 수 (확인용, 파일은 쓰지 않는다)
 *
 * 추상화:
 *   - 스택 100bb, 블라인드 0.5/1. 액션은 오픈(2.5bb, SB 3bb) · 3벳(오픈의 3배, 블라인드에선 3.5배) ·
 *     4벳(3벳의 2.3배) · 올인(100bb). 림프 없음.
 *   - 응답자는 한 명만: 누군가 콜/3벳하면 뒤의 사람들은 접는다고 본다(멀티웨이는 풀지 않는다).
 *   - 프리플랍이 콜로 끝나면 올인 승률(169×169 클래스 표, 시뮬레이션)로 팟을 나눈다.
 *     즉 포스트플랍 실현율은 1 로 본다 — 포지션 이점은 모델에 없다.
 *   - 외부 표본 MCCFR + 선형 가중. 정보집합 = (인원, 포지션, 상황, 핸드 클래스).
 *
 * 결과는 클래스별 액션 빈도다. 정확한 솔루션이 아니라 "고정 사이즈 · 응답자 한 명" 게임의 근사해이며,
 * 표준 차트와 비슷한 모양(앞자리 타이트, 버튼 넓고, 3벳은 프리미엄 + 수티드 에이스 블러프)이 나와야 한다.
 */
const fs = require('fs');
const path = require('path');
const H = require('../js/engine.js');
require('../js/ranges.js');
require('../js/evaluator.js');
require('../js/rng.js');

const R = H.ranges, K = H.eval.kernel;
const CLASSES = R.RANKED.map(function (row) { return row[0]; });
const N_CLASS = CLASSES.length;
const CLASS_INDEX = {};
CLASSES.forEach(function (k, i) { CLASS_INDEX[k] = i; });

/* ---------- 클래스별 콤보 목록 ---------- */
const COMBOS = CLASSES.map(function () { return []; });
for (let a = 0; a < 52; a++) {
  for (let b = a + 1; b < 52; b++) COMBOS[CLASS_INDEX[R.classOfCodes(a, b)]].push([a, b]);
}

/* ---------- 169×169 올인 승률표 ---------- */
function equityTable(sims, seed) {
  const cacheFile = path.join(__dirname, 'equity-169.json');
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.sims === sims) return cached.table;
  }
  const rand = H.rng.create(seed || 7);
  const E = [];
  const buf = new Int32Array(7), buf2 = new Int32Array(7);
  const used = new Uint8Array(52);
  const t0 = Date.now();
  for (let i = 0; i < N_CLASS; i++) {
    E.push(new Array(N_CLASS).fill(0));
  }
  for (let i = 0; i < N_CLASS; i++) {
    for (let j = i; j < N_CLASS; j++) {
      let win = 0, tie = 0, done = 0, guard = 0;
      while (done < sims && guard++ < sims * 4) {
        const ca = COMBOS[i][(rand() * COMBOS[i].length) | 0];
        const cb = COMBOS[j][(rand() * COMBOS[j].length) | 0];
        if (ca[0] === cb[0] || ca[0] === cb[1] || ca[1] === cb[0] || ca[1] === cb[1]) continue;
        used.fill(0);
        used[ca[0]] = used[ca[1]] = used[cb[0]] = used[cb[1]] = 1;
        let k = 0;
        while (k < 5) {
          const c = (rand() * 52) | 0;
          if (used[c]) continue;
          used[c] = 1; buf[2 + k] = c; buf2[2 + k] = c; k++;
        }
        buf[0] = ca[0]; buf[1] = ca[1]; buf2[0] = cb[0]; buf2[1] = cb[1];
        const va = K.evalCodes(buf, 7), vb = K.evalCodes(buf2, 7);
        if (va > vb) win++; else if (va === vb) tie++;
        done++;
      }
      const eq = done ? (win + tie / 2) / done : 0.5;
      E[i][j] = eq; E[j][i] = 1 - eq;
    }
  }
  console.error('승률표 ' + N_CLASS + '×' + N_CLASS + ' (' + sims + '회) ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  fs.writeFileSync(cacheFile, JSON.stringify({ sims: sims, table: E }));
  return E;
}

/* ---------- 게임 ---------- */
const OPEN = 2.5, OPEN_SB = 3.0, THREE_IP = 3.0, THREE_OOP = 3.5, FOUR = 2.3, STACK = 100;
const SITUATIONS = {
  open: ['fold', 'raise'],
  vsOpen: ['fold', 'call', 'raise'],
  vs3bet: ['fold', 'call', 'raise'],
  vs4bet: ['fold', 'call', 'raise'],
  vsShove: ['fold', 'call']
};

function actionOrder(n) {
  /* 프리플랍 순서: UTG ... CO, BTN, SB, BB (헤즈업: BTN(SB), BB) */
  const pos = R.positionsFor(n);   // 버튼 기준 [BTN, SB, BB, UTG, ...]
  if (n === 2) return ['BTN', 'BB'];
  const order = pos.slice(3).concat(['BTN', 'SB', 'BB']);
  return order;
}

function Solver(n, equity) {
  this.n = n;
  this.E = equity;
  this.order = actionOrder(n);
  this.regret = {};
  this.strategySum = {};
  this.rand = H.rng.create(1234 + n);
}

Solver.prototype.key = function (situation, pos, vsPos, cls) {
  return situation + '|' + pos + '|' + (vsPos || '') + '|' + cls;
};
Solver.prototype.node = function (key, nActions) {
  let r = this.regret[key];
  if (!r) { r = this.regret[key] = new Float64Array(nActions); this.strategySum[key] = new Float64Array(nActions); }
  return r;
};
Solver.prototype.strategy = function (key, nActions) {
  const r = this.node(key, nActions);
  const s = new Float64Array(nActions);
  let sum = 0;
  for (let a = 0; a < nActions; a++) { s[a] = r[a] > 0 ? r[a] : 0; sum += s[a]; }
  if (sum <= 0) { for (let a = 0; a < nActions; a++) s[a] = 1 / nActions; }
  else for (let a = 0; a < nActions; a++) s[a] /= sum;
  return s;
};

/* 딜: n 명에게 두 장씩, 클래스 인덱스로 */
Solver.prototype.deal = function () {
  const used = new Uint8Array(52);
  const hands = [];
  for (let i = 0; i < this.n; i++) {
    let a, b;
    do { a = (this.rand() * 52) | 0; } while (used[a]);
    used[a] = 1;
    do { b = (this.rand() * 52) | 0; } while (used[b]);
    used[b] = 1;
    hands.push(CLASS_INDEX[R.classOfCodes(a, b)]);
  }
  return hands;
};

/*
 * 상태: { stage, k(행동 차례 인덱스), opener, responder, committed[], hands[] }
 * 페이오프: 승자 몫 - 자기 투입액 (bb)
 */
Solver.prototype.blindsCommitted = function () {
  const c = new Float64Array(this.n);
  const order = this.order;
  if (this.n === 2) { c[order.indexOf('BTN')] = 0.5; c[order.indexOf('BB')] = 1; }
  else { c[order.indexOf('SB')] = 0.5; c[order.indexOf('BB')] = 1; }
  return c;
};

Solver.prototype.payoffFold = function (committed, winner, traverser) {
  let pot = 0;
  for (let i = 0; i < this.n; i++) pot += committed[i];
  return (traverser === winner ? pot : 0) - committed[traverser];
};
/*
 * 승률 실현율. 올인 승률 그대로 팟을 나누면 포지션과 플레이어빌리티가 사라져 BB 가 72o 로도
 * 콜하고 수티드 커넥터는 오픈하지 않는다. 포지션(포스트플랍에 늦게 행동할수록) · 어그레서 ·
 * 핸드 유형별 계수를 곱한 뒤 두 사람 몫을 정규화한다.
 */
/* 환경변수로 실험할 수 있다: REAL_OOP, REAL_COLD, REAL_AGG, REAL_CALLER */
const envNum = function (k, d) { const v = parseFloat(process.env[k]); return isFinite(v) ? v : d; };
const REAL = {
  ip: 1.0, oop: envNum('REAL_OOP', 0.83),
  aggressor: envNum('REAL_AGG', 1.06), caller: envNum('REAL_CALLER', 0.97),
  coldCall: envNum('REAL_COLD', 0.93),   // 블라인드 밖에서의 콜드콜: 뒤에 스퀴즈 위험이 있다 (모델에는 없으므로 계수로)
  cls: function (info) {
    if (info.pair) return info.hi >= 10 ? 1.0 : 0.95;
    const gap = info.hi - info.lo;
    if (info.suited) {
      if (info.hi === 14) return 1.0;
      if (gap <= 1 && info.hi <= 12 && info.lo >= 4) return 1.12;
      if (gap <= 2 && info.lo >= 4) return 1.05;
      return 0.98;
    }
    if (info.lo >= 10) return 0.95;      // 오프수트 브로드웨이
    if (info.hi === 14) return 0.90;     // 오프수트 에이스
    return 0.82;                         // 오프수트 잡패
  }
};
const CLASS_R = CLASSES.map(function (k) { return REAL.cls(R.INFO[k]); });

/* 포스트플랍 행동 순서: SB, BB, UTG ... BTN. 늦을수록 IP */
Solver.prototype.postflopRank = function (idx) {
  const pos = this.order[idx];
  const seq = ['SB', 'BB'].concat(this.order.filter(function (p) { return p !== 'SB' && p !== 'BB'; }));
  if (this.n === 2) return pos === 'BB' ? 0 : 1;
  return seq.indexOf(pos);
};

Solver.prototype.payoffShowdown = function (committed, a, b, hands, traverser, aggressor) {
  let pot = 0;
  for (let i = 0; i < this.n; i++) pot += committed[i];
  if (traverser !== a && traverser !== b) return -committed[traverser];
  const eqA = this.E[hands[a]][hands[b]];
  const ipA = this.postflopRank(a) > this.postflopRank(b);
  const coldA = aggressor !== a && !this.isBlind(a) ? REAL.coldCall : 1;
  const coldB = aggressor !== b && !this.isBlind(b) ? REAL.coldCall : 1;
  const rA = (ipA ? REAL.ip : REAL.oop) * (aggressor === a ? REAL.aggressor : REAL.caller) * CLASS_R[hands[a]] * coldA;
  const rB = (ipA ? REAL.oop : REAL.ip) * (aggressor === b ? REAL.aggressor : REAL.caller) * CLASS_R[hands[b]] * coldB;
  const wA = eqA * rA, wB = (1 - eqA) * rB;
  const shareA = wA / (wA + wB);
  const share = traverser === a ? shareA : 1 - shareA;
  return share * pot - committed[traverser];
};

Solver.prototype.isBlind = function (idx) { const p = this.order[idx]; return p === 'SB' || p === 'BB' || (this.n === 2 && p === 'BTN'); };

Solver.prototype.cfr = function (st, traverser, t) {
  const n = this.n, order = this.order, hands = st.hands, c = st.committed;

  if (st.stage === 'open') {
    if (st.k >= n) {   // 아무도 열지 않음: BB 워크
      return this.payoffFold(c, order.indexOf('BB'), traverser);
    }
    const pos = order[st.k];
    if (pos === 'BB') return this.payoffFold(c, st.k, traverser);   // BB 는 걸어간다
    const key = this.key('open', pos, '', hands[st.k]);
    const acts = SITUATIONS.open;
    return this.decide(st, traverser, t, key, acts, st.k, function (a) {
      if (a === 'fold') return { stage: 'open', k: st.k + 1, committed: c, hands: hands };
      const c2 = Float64Array.from(c);
      c2[st.k] = pos === 'SB' ? OPEN_SB : OPEN;
      return { stage: 'vsOpen', k: st.k + 1, opener: st.k, committed: c2, hands: hands, openSize: c2[st.k] };
    });
  }

  if (st.stage === 'vsOpen') {
    if (st.k >= n) return this.payoffFold(c, st.opener, traverser);   // 모두 접음
    const pos = order[st.k];
    const key = this.key('vsOpen', pos, order[st.opener], hands[st.k]);
    const acts = SITUATIONS.vsOpen;
    const self = this;
    return this.decide(st, traverser, t, key, acts, st.k, function (a) {
      if (a === 'fold') return { stage: 'vsOpen', k: st.k + 1, opener: st.opener, committed: c, hands: hands, openSize: st.openSize };
      const c2 = Float64Array.from(c);
      if (a === 'call') { c2[st.k] = st.openSize; return { stage: 'showdown', a: st.opener, b: st.k, aggressor: st.opener, committed: c2, hands: hands }; }
      c2[st.k] = st.openSize * (self.isBlind(st.k) ? THREE_OOP : THREE_IP);
      return { stage: 'vs3bet', opener: st.opener, responder: st.k, committed: c2, hands: hands, threeSize: c2[st.k] };
    });
  }

  if (st.stage === 'vs3bet') {
    const pos = order[st.opener];
    const key = this.key('vs3bet', pos, order[st.responder], hands[st.opener]);
    const acts = SITUATIONS.vs3bet;
    return this.decide(st, traverser, t, key, acts, st.opener, function (a) {
      if (a === 'fold') return { stage: 'fold', winner: st.responder, committed: c, hands: hands };
      const c2 = Float64Array.from(c);
      if (a === 'call') { c2[st.opener] = st.threeSize; return { stage: 'showdown', a: st.opener, b: st.responder, aggressor: st.responder, committed: c2, hands: hands }; }
      c2[st.opener] = Math.min(STACK, st.threeSize * FOUR);
      return { stage: 'vs4bet', opener: st.opener, responder: st.responder, committed: c2, hands: hands, fourSize: c2[st.opener] };
    });
  }

  if (st.stage === 'vs4bet') {
    const pos = order[st.responder];
    const key = this.key('vs4bet', pos, order[st.opener], hands[st.responder]);
    const acts = SITUATIONS.vs4bet;
    return this.decide(st, traverser, t, key, acts, st.responder, function (a) {
      if (a === 'fold') return { stage: 'fold', winner: st.opener, committed: c, hands: hands };
      const c2 = Float64Array.from(c);
      if (a === 'call') { c2[st.responder] = st.fourSize; return { stage: 'showdown', a: st.opener, b: st.responder, aggressor: st.opener, committed: c2, hands: hands }; }
      c2[st.responder] = STACK;
      return { stage: 'vsShove', opener: st.opener, responder: st.responder, committed: c2, hands: hands };
    });
  }

  if (st.stage === 'vsShove') {
    const pos = order[st.opener];
    const key = this.key('vsShove', pos, order[st.responder], hands[st.opener]);
    const acts = SITUATIONS.vsShove;
    return this.decide(st, traverser, t, key, acts, st.opener, function (a) {
      if (a === 'fold') return { stage: 'fold', winner: st.responder, committed: c, hands: hands };
      const c2 = Float64Array.from(c);
      c2[st.opener] = STACK;
      return { stage: 'showdown', a: st.opener, b: st.responder, aggressor: st.responder, committed: c2, hands: hands };
    });
  }

  if (st.stage === 'fold') return this.payoffFold(c, st.winner, traverser);
  if (st.stage === 'showdown') return this.payoffShowdown(c, st.a, st.b, hands, traverser, st.aggressor);
  throw new Error('unknown stage ' + st.stage);
};

/* 외부 표본: 내 노드는 모든 액션, 남의 노드는 전략대로 하나 */
Solver.prototype.decide = function (st, traverser, t, key, acts, actor, next) {
  const s = this.strategy(key, acts.length);
  if (actor === traverser) {
    const util = new Float64Array(acts.length);
    let node = 0;
    for (let a = 0; a < acts.length; a++) {
      util[a] = this.cfr(next(acts[a]), traverser, t);
      node += s[a] * util[a];
    }
    const r = this.regret[key];
    for (let a = 0; a < acts.length; a++) r[a] += (util[a] - node) * t;   // 선형 CFR
    return node;
  }
  const sum = this.strategySum[key];
  for (let a = 0; a < acts.length; a++) sum[a] += s[a] * t;
  let u = this.rand(), pick = acts.length - 1;
  for (let a = 0; a < acts.length; a++) { u -= s[a]; if (u <= 0) { pick = a; break; } }
  return this.cfr(next(acts[pick]), traverser, t);
};

Solver.prototype.run = function (iterations) {
  const t0 = Date.now();
  for (let t = 1; t <= iterations; t++) {
    const hands = this.deal();
    for (let p = 0; p < this.n; p++) {
      this.cfr({ stage: 'open', k: 0, committed: this.blindsCommitted(), hands: hands }, p, t);
    }
  }
  console.error(this.n + '인 ' + iterations + '회 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's, 정보집합 ' + Object.keys(this.regret).length);
};

/* 평균 전략 -> 클래스별 빈도 표 */
Solver.prototype.table = function () {
  const out = {};
  const self = this;
  Object.keys(this.strategySum).forEach(function (key) {
    const parts = key.split('|');
    const situation = parts[0], pos = parts[1], vs = parts[2], cls = parseInt(parts[3], 10);
    const acts = SITUATIONS[situation];
    const sum = self.strategySum[key];
    let tot = 0;
    for (let a = 0; a < acts.length; a++) tot += sum[a];
    const sit = situation + (vs ? ':' + vs : '');
    const posT = out[pos] || (out[pos] = {});
    const row = posT[sit] || (posT[sit] = { call: new Float64Array(N_CLASS), raise: new Float64Array(N_CLASS), n: new Float64Array(N_CLASS) });
    row.n[cls] = tot;
    for (let a = 0; a < acts.length; a++) {
      const f = tot > 0 ? sum[a] / tot : (acts[a] === 'fold' ? 1 : 0);
      if (acts[a] === 'call') row.call[cls] = f;
      if (acts[a] === 'raise') row.raise[cls] = f;
    }
  });
  return out;
};

/* 빈도 -> 한 자리 숫자 문자열 (0~9, 0.11 단위) */
function digits(arr) {
  let s = '';
  for (let i = 0; i < N_CLASS; i++) s += String(Math.max(0, Math.min(9, Math.round(arr[i] * 9))));
  return s;
}

function encode(table) {
  const out = {};
  Object.keys(table).forEach(function (pos) {
    out[pos] = {};
    Object.keys(table[pos]).forEach(function (sit) {
      const row = table[pos][sit];
      const enc = {};
      const c = digits(row.call), r = digits(row.raise);
      if (/[1-9]/.test(c)) enc.c = c;
      if (/[1-9]/.test(r)) enc.r = r;
      out[pos][sit] = enc;
    });
  });
  return out;
}

function summarize(n, table) {
  const pct = function (arr) { let s = 0; for (let i = 0; i < N_CLASS; i++) s += arr[i] * COMBOS[i].length; return (s / 1326 * 100).toFixed(1) + '%'; };
  const lines = [];
  actionOrder(n).forEach(function (pos) {
    const t = table[pos];
    if (!t) return;
    const parts = [];
    if (t.open) parts.push('오픈 ' + pct(t.open.raise));
    Object.keys(t).forEach(function (sit) {
      if (sit.indexOf('vsOpen:') === 0) parts.push('vs ' + sit.slice(7) + ' 콜 ' + pct(t[sit].call) + ' 3벳 ' + pct(t[sit].raise));
    });
    lines.push('  ' + pos.padEnd(5) + parts.join(' · '));
  });
  return lines.join('\n');
}

/* ---------- 실행 ---------- */
/* 인자: [인원 2~9] [반복 수]  또는  [반복 수] */
let argN = parseInt(process.argv[2], 10);
let iterations = parseInt(process.argv[3], 10);
if (argN && (argN < 2 || argN > 9)) { iterations = argN; argN = 0; }
iterations = iterations || 300000;
const E = equityTable(800, 7);

if (argN) {
  const s = new Solver(argN, E);
  s.run(iterations);
  const t = s.table();
  console.log(summarize(argN, t));
  const i = function (k) { return CLASS_INDEX[k]; };
  const show = function (pos, sit, cls) { const row = t[pos] && t[pos][sit]; return row ? '콜 ' + (row.call[i(cls)] * 100).toFixed(0) + '% 레이즈 ' + (row.raise[i(cls)] * 100).toFixed(0) + '%' : '-'; };
  ['AA', 'AKs', 'A5s', 'KQo', '76s', '72o', 'JJ', '22'].forEach(function (cls) {
    console.log('  ' + cls.padEnd(4) + ' UTG open ' + show('UTG', 'open', cls) + ' | BTN open ' + show('BTN', 'open', cls) + ' | BB vs BTN ' + show('BB', 'vsOpen:BTN', cls) + ' | BTN vs CO ' + show('BTN', 'vsOpen:CO', cls));
  });
} else {
  const tables = {};
  [2, 3, 6, 9].forEach(function (n) {
    const s = new Solver(n, E);
    s.run(n >= 9 ? iterations : Math.round(iterations * 0.8));
    const t = s.table();
    console.error(summarize(n, t));
    tables[String(n)] = encode(t);
  });
  const out = {
    version: 1,
    classes: CLASSES,
    sizes: { open: OPEN, openSb: OPEN_SB, threeBetIp: THREE_IP, threeBetOop: THREE_OOP, fourBet: FOUR },
    iterations: iterations,
    tables: tables
  };
  const js = '/*\n * preflop-table.js - 프리플랍 솔버 테이블 (자동 생성: node tools/solve-preflop.js)\n' +
    ' * 인원별 · 포지션별 · 상황별 클래스 액션 빈도. c = 콜, r = 레이즈, 한 자리(0~9 = 0~100%), 나머지는 폴드.\n' +
    ' * 클래스 순서는 ranges.js 의 RANKED 와 같다. 손으로 고치지 말 것.\n */\n' +
    '(function (global) {\n  const H = global.Holdem || (global.Holdem = {});\n  H.preflopTable = ' +
    JSON.stringify(out) + ';\n})(typeof globalThis !== \'undefined\' ? globalThis : this);\n\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports = globalThis.Holdem;\n';
  const outFile = process.env.OUT || path.join(__dirname, '..', 'js', 'preflop-table.js');
  fs.writeFileSync(outFile, js);
  console.error(outFile + ' ' + (js.length / 1024).toFixed(0) + 'KB');
}
