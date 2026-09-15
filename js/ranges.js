/*
 * ranges.js - 프리플랍 핸드 레인지
 *
 * 169개 핸드 클래스의 순위는 시뮬레이션으로 계산했다:
 *   랜덤 상대 승률 40% + 상위 15% 레인지 상대 승률 60% + 플레이어빌리티 보정
 * (순수 올인 승률만 쓰면 작은 포켓페어가 과대평가되어 실제 오프닝 차트와 어긋난다)
 *
 * 레인지는 [lo, hi] 백분위 밴드로 표현한다.
 * 예: 오픈 레인지 [0, 0.20] = 상위 20%, 콜 레인지 [0.04, 0.30] = 상위 4~30%
 * (가장 강한 구간은 3벳으로 빠지므로 콜 레인지에서 제외된다)
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  const RL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };
  const RANK_OF = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

  /* [클래스, 콤보 수, 누적 상위 비율] */
  const RANKED = [
    ['AA', 6, 0.0045],
    ['KK', 6, 0.0090],
    ['QQ', 6, 0.0136],
    ['JJ', 6, 0.0181],
    ['AKs', 4, 0.0211],
    ['TT', 6, 0.0256],
    ['AKo', 12, 0.0347],
    ['AQs', 4, 0.0377],
    ['99', 6, 0.0422],
    ['AJs', 4, 0.0452],
    ['AQo', 12, 0.0543],
    ['88', 6, 0.0588],
    ['ATs', 4, 0.0618],
    ['AJo', 12, 0.0709],
    ['KQs', 4, 0.0739],
    ['77', 6, 0.0784],
    ['ATo', 12, 0.0875],
    ['KJs', 4, 0.0905],
    ['A9s', 4, 0.0935],
    ['66', 6, 0.0980],
    ['KQo', 12, 0.1071],
    ['A8s', 4, 0.1101],
    ['QJs', 4, 0.1131],
    ['KTs', 4, 0.1161],
    ['A7s', 4, 0.1192],
    ['QTs', 4, 0.1222],
    ['A5s', 4, 0.1252],
    ['JTs', 4, 0.1282],
    ['55', 6, 0.1327],
    ['A6s', 4, 0.1357],
    ['A4s', 4, 0.1388],
    ['KJo', 12, 0.1478],
    ['A9o', 12, 0.1569],
    ['A3s', 4, 0.1599],
    ['K9s', 4, 0.1629],
    ['A2s', 4, 0.1659],
    ['44', 6, 0.1704],
    ['T9s', 4, 0.1735],
    ['Q9s', 4, 0.1765],
    ['J9s', 4, 0.1795],
    ['A8o', 12, 0.1885],
    ['QJo', 12, 0.1976],
    ['K8s', 4, 0.2006],
    ['Q8s', 4, 0.2036],
    ['A7o', 12, 0.2127],
    ['KTo', 12, 0.2217],
    ['K7s', 4, 0.2247],
    ['T8s', 4, 0.2278],
    ['98s', 4, 0.2308],
    ['33', 6, 0.2353],
    ['QTo', 12, 0.2443],
    ['J8s', 4, 0.2474],
    ['K6s', 4, 0.2504],
    ['A5o', 12, 0.2594],
    ['JTo', 12, 0.2685],
    ['87s', 4, 0.2715],
    ['K5s', 4, 0.2745],
    ['A6o', 12, 0.2836],
    ['A4o', 12, 0.2926],
    ['22', 6, 0.2971],
    ['K4s', 4, 0.3002],
    ['A3o', 12, 0.3092],
    ['97s', 4, 0.3122],
    ['T7s', 4, 0.3152],
    ['J7s', 4, 0.3183],
    ['K3s', 4, 0.3213],
    ['Q5s', 4, 0.3243],
    ['Q7s', 4, 0.3273],
    ['Q6s', 4, 0.3303],
    ['K9o', 12, 0.3394],
    ['A2o', 12, 0.3484],
    ['K2s', 4, 0.3514],
    ['76s', 4, 0.3544],
    ['Q4s', 4, 0.3575],
    ['T9o', 12, 0.3665],
    ['86s', 4, 0.3695],
    ['Q9o', 12, 0.3786],
    ['Q3s', 4, 0.3816],
    ['T6s', 4, 0.3846],
    ['J9o', 12, 0.3937],
    ['Q2s', 4, 0.3967],
    ['J6s', 4, 0.3997],
    ['65s', 4, 0.4027],
    ['96s', 4, 0.4057],
    ['J5s', 4, 0.4087],
    ['Q8o', 12, 0.4178],
    ['K8o', 12, 0.4268],
    ['J4s', 4, 0.4299],
    ['75s', 4, 0.4329],
    ['98o', 12, 0.4419],
    ['54s', 4, 0.4449],
    ['J8o', 12, 0.4540],
    ['T8o', 12, 0.4630],
    ['K7o', 12, 0.4721],
    ['95s', 4, 0.4751],
    ['85s', 4, 0.4781],
    ['J3s', 4, 0.4811],
    ['T5s', 4, 0.4842],
    ['K6o', 12, 0.4932],
    ['J2s', 4, 0.4962],
    ['64s', 4, 0.4992],
    ['T4s', 4, 0.5023],
    ['87o', 12, 0.5113],
    ['K5o', 12, 0.5204],
    ['T3s', 4, 0.5234],
    ['84s', 4, 0.5264],
    ['K4o', 12, 0.5354],
    ['J7o', 12, 0.5445],
    ['43s', 4, 0.5475],
    ['74s', 4, 0.5505],
    ['Q7o', 12, 0.5596],
    ['97o', 12, 0.5686],
    ['T2s', 4, 0.5716],
    ['53s', 4, 0.5747],
    ['T7o', 12, 0.5837],
    ['Q6o', 12, 0.5928],
    ['K3o', 12, 0.6018],
    ['94s', 4, 0.6048],
    ['Q5o', 12, 0.6139],
    ['93s', 4, 0.6169],
    ['76o', 12, 0.6259],
    ['K2o', 12, 0.6350],
    ['63s', 4, 0.6380],
    ['73s', 4, 0.6410],
    ['Q4o', 12, 0.6501],
    ['92s', 4, 0.6531],
    ['86o', 12, 0.6621],
    ['T6o', 12, 0.6712],
    ['83s', 4, 0.6742],
    ['42s', 4, 0.6772],
    ['82s', 4, 0.6802],
    ['52s', 4, 0.6833],
    ['Q3o', 12, 0.6923],
    ['32s', 4, 0.6953],
    ['J6o', 12, 0.7044],
    ['96o', 12, 0.7134],
    ['65o', 12, 0.7225],
    ['62s', 4, 0.7255],
    ['J5o', 12, 0.7345],
    ['Q2o', 12, 0.7436],
    ['75o', 12, 0.7526],
    ['54o', 12, 0.7617],
    ['72s', 4, 0.7647],
    ['J4o', 12, 0.7738],
    ['85o', 12, 0.7828],
    ['J3o', 12, 0.7919],
    ['T5o', 12, 0.8009],
    ['95o', 12, 0.8100],
    ['J2o', 12, 0.8190],
    ['T4o', 12, 0.8281],
    ['64o', 12, 0.8371],
    ['T3o', 12, 0.8462],
    ['84o', 12, 0.8552],
    ['74o', 12, 0.8643],
    ['53o', 12, 0.8733],
    ['43o', 12, 0.8824],
    ['T2o', 12, 0.8914],
    ['94o', 12, 0.9005],
    ['63o', 12, 0.9095],
    ['93o', 12, 0.9186],
    ['73o', 12, 0.9276],
    ['92o', 12, 0.9367],
    ['82o', 12, 0.9457],
    ['52o', 12, 0.9548],
    ['32o', 12, 0.9638],
    ['83o', 12, 0.9729],
    ['42o', 12, 0.9819],
    ['62o', 12, 0.9910],
    ['72o', 12, 1.0000]
  ];

  /* 클래스 -> {index, combos, pct(누적 상위 비율), hi, lo, suited, pair} */
  const INFO = {};
  RANKED.forEach(function (row, i) {
    const key = row[0];
    const hi = RANK_OF[key[0]], lo = RANK_OF[key[1]];
    INFO[key] = {
      key: key, index: i, combos: row[1], pct: row[2],
      hi: hi, lo: lo, suited: key[2] === 's', pair: hi === lo
    };
  });

  function classOfRanks(r1, r2, suited) {
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    return hi === lo ? RL[hi] + RL[lo] : RL[hi] + RL[lo] + (suited ? 's' : 'o');
  }

  function classOf(a, b) {
    return classOfRanks(a.rank, b.rank, a.suit === b.suit);
  }

  function classOfCodes(c1, c2) {
    return classOfRanks((c1 >> 2) + 2, (c2 >> 2) + 2, (c1 & 3) === (c2 & 3));
  }

  /* 이 핸드가 상위 몇 %인가 (0=최강, 1=최약) */
  function percentile(key) {
    const info = INFO[key];
    return info ? info.pct : 1;
  }

  /* 포지션별 레이즈 퍼스트 인 레인지 (6맥스 기준, 인원수로 보정) */
  const OPEN_PCT = { UTG: 0.14, MP: 0.18, CO: 0.26, BTN: 0.44, SB: 0.36, BB: 0.44 };

  function openPercent(pos, playerCount) {
    let base = OPEN_PCT[pos] != null ? OPEN_PCT[pos] : 0.22;
    // 인원이 적을수록 레인지가 넓어진다
    if (playerCount <= 2) base = pos === 'BTN' ? 0.60 : 0.50;
    else if (playerCount === 3) base *= 1.35;
    else if (playerCount === 4) base *= 1.18;
    else if (playerCount >= 7) base *= 0.88;
    return Math.min(0.92, base);
  }

  /* 포지션 판별: 0=버튼 기준 상대 좌석 */
  function positionOf(seatIndex, button, playerCount) {
    const n = playerCount;
    const rel = ((seatIndex - button) % n + n) % n;
    if (n === 2) return rel === 0 ? 'BTN' : 'BB';
    if (rel === 0) return 'BTN';
    if (rel === 1) return 'SB';
    if (rel === 2) return 'BB';
    if (rel === n - 1) return 'CO';
    if (rel === 3) return 'UTG';
    return 'MP';
  }

  /* 밴드 연산 */
  function band(lo, hi) { return { lo: Math.max(0, lo), hi: Math.min(1, Math.max(lo, hi)) }; }
  function inBand(b, pct) { return pct >= b.lo && pct <= b.hi; }
  function bandWidth(b) { return Math.max(0, b.hi - b.lo); }

  /* 밴드에 속하는 클래스 목록 */
  function classesIn(b) {
    const out = [];
    for (let i = 0; i < RANKED.length; i++) {
      const info = INFO[RANKED[i][0]];
      if (inBand(b, info.pct)) out.push(info.key);
    }
    return out;
  }

  /* 프리플랍 액션에 따른 레인지 갱신 */
  const ACTION_BANDS = {
    open:      function (openPct) { return band(0, openPct); },
    limp:      function (openPct) { return band(openPct * 0.45, Math.min(0.75, openPct * 2.2)); },
    call:      function (openPct) { return band(openPct * 0.22, Math.min(0.80, openPct * 1.9)); },
    threeBet:  function () { return band(0, 0.065); },
    fourBet:   function () { return band(0, 0.030); },
    callThree: function () { return band(0.02, 0.11); },
    defendBB:  function (openPct) { return band(openPct * 0.25, Math.min(0.85, openPct * 2.6)); }
  };

  /* 13x13 차트용 격자 (행=높은 랭크, 열=낮은 랭크, 위쪽 삼각형=수딧) */
  function chartGrid() {
    const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const grid = [];
    for (let i = 0; i < 13; i++) {
      const row = [];
      for (let j = 0; j < 13; j++) {
        const a = ranks[i], b = ranks[j];
        const key = i === j ? classOfRanks(a, b, false)
          : i < j ? classOfRanks(a, b, true)      // 우상단: 수딧
            : classOfRanks(b, a, false);          // 좌하단: 오프수딧
        row.push(key);
      }
      grid.push(row);
    }
    return grid;
  }

  H.ranges = {
    RANKED: RANKED,
    INFO: INFO,
    OPEN_PCT: OPEN_PCT,
    ACTION_BANDS: ACTION_BANDS,
    classOf: classOf,
    classOfCodes: classOfCodes,
    classOfRanks: classOfRanks,
    percentile: percentile,
    openPercent: openPercent,
    positionOf: positionOf,
    band: band,
    inBand: inBand,
    bandWidth: bandWidth,
    classesIn: classesIn,
    chartGrid: chartGrid
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
