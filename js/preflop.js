/*
 * preflop.js - 프리플랍 솔버 테이블 조회
 *
 * tools/solve-preflop.js 가 만든 표(js/preflop-table.js)에서 (인원, 포지션, 상황, 핸드 클래스)의
 * 콜/레이즈 빈도를 꺼낸다. AI 는 이 빈도대로 섞어 치고(혼합 전략), 상대 레인지 역산은 같은
 * 빈도를 클래스 가중치로 쓴다. 표가 없는 인원·상황이면 null 을 돌려주고 호출자는 휴리스틱으로 돌아간다.
 *
 * 인원 매핑: 2 → 헤즈업 표, 3 → 3인 표, 4~6 → 6인 표, 7~9 → 9인 표.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') {
    require('./ranges.js');
    try { require('./preflop-table.js'); } catch (e) { /* 표가 없으면 휴리스틱만 쓴다 */ }
  }
  const R = H.ranges;

  function table() { return H.preflopTable || null; }
  function available() { return !!(table() && table().tables); }

  function tableKey(n) {
    const t = table();
    if (!t) return null;
    const key = n <= 2 ? '2' : n === 3 ? '3' : n <= 6 ? '6' : '9';
    if (t.tables[key]) return key;
    return t.tables['6'] ? '6' : null;
  }

  function row(n, pos, situation) {
    const key = tableKey(n);
    if (!key) return null;
    const posT = table().tables[key][pos];
    return posT && posT[situation] ? posT[situation] : null;
  }

  function digit(str, idx) { return str ? (str.charCodeAt(idx) - 48) / 9 : 0; }

  /** 클래스 하나의 빈도 {fold, call, raise} (없으면 null) */
  function freq(n, pos, situation, classKey) {
    const r = row(n, pos, situation);
    const info = R.INFO[classKey];
    if (!r || !info) return null;
    const call = digit(r.c, info.index), raise = digit(r.r, info.index);
    return { call: call, raise: raise, fold: Math.max(0, 1 - call - raise) };
  }

  /** 상황 전체의 액션 가중치 (169, RANKED 순서) — 레인지 역산용 */
  function weights(n, pos, situation, action) {
    const r = row(n, pos, situation);
    if (!r) return null;
    const str = action === 'raise' ? r.r : r.c;
    const w = new Float32Array(R.N_CLASS);
    if (!str) return w;
    for (let i = 0; i < R.N_CLASS; i++) w[i] = (str.charCodeAt(i) - 48) / 9;
    return w;
  }

  /* 이 핸드에서 raisesBefore 번째 레이즈를 한 사람 (1 = 오프너) */
  function raiserAt(game, raisesBefore) {
    const acts = game.handActions;
    for (let i = 0; i < acts.length; i++) {
      if (acts[i].street === 'preflop' && acts[i].type === 'raise' && acts[i].raisesBefore === raisesBefore) {
        return game.byId(acts[i].playerId);
      }
    }
    return null;
  }

  /**
   * 플레이어가 마주한 상황. raisesThisStreet 는 BB 를 1 로 센다.
   *   1  open       아직 레이즈 없음
   *   2  vsOpen:P   P 의 오픈에 직면
   *   3  vs3bet:Q   Q 의 3벳에 직면 (내가 오프너가 아니면 cold)
   *   4  vs4bet:P   P 의 4벳에 직면
   *   5+ vsShove:Q
   * raisesOverride 로 과거 시점(상대 액션의 raisesBefore)의 상황도 구한다.
   */
  function situationOf(game, player, raisesOverride) {
    const raises = raisesOverride != null ? raisesOverride : game.raisesThisStreet;
    if (raises <= 1) return { sit: 'open', raises: raises };
    const opener = raiserAt(game, 1);
    if (raises === 2) return { sit: 'vsOpen:' + (opener ? game.position(opener) : 'BTN'), raises: raises };
    const last = raiserAt(game, raises - 1);
    const lastPos = last ? game.position(last) : 'BTN';
    if (raises === 3) return { sit: 'vs3bet:' + lastPos, raises: raises, cold: opener !== player };
    if (raises === 4) return { sit: 'vs4bet:' + lastPos, raises: raises, cold: raiserAt(game, 2) !== player };
    return { sit: 'vsShove:' + lastPos, raises: raises };
  }

  H.preflop = {
    available: available,
    tableKey: tableKey,
    freq: freq,
    weights: weights,
    situationOf: situationOf,
    sizes: function () { return table() ? table().sizes : null; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
