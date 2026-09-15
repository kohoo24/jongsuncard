/*
 * ai.js - 컴퓨터 플레이어 두뇌
 * 몬테카를로 시뮬레이션으로 승률(에쿼티)을 추정하고,
 * 팟 오즈 + 성향(profile)에 따라 폴드/콜/레이즈를 결정한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./cards.js'); require('./evaluator.js'); }

  // 성향 프로필
  const PROFILES = [
    { key: 'rock',    name: '타이트',     aggression: 0.30, bluff: 0.03, loose: 0.75, desc: '좋은 패만 들어옵니다' },
    { key: 'shark',   name: '밸런스',     aggression: 0.55, bluff: 0.10, loose: 1.00, desc: '기본기가 탄탄합니다' },
    { key: 'maniac',  name: '어그레시브', aggression: 0.85, bluff: 0.22, loose: 1.25, desc: '자주 몰아붙입니다' },
    { key: 'station', name: '콜링스테이션', aggression: 0.25, bluff: 0.05, loose: 1.45, desc: '웬만하면 콜합니다' },
    { key: 'trap',    name: '트래퍼',     aggression: 0.45, bluff: 0.08, loose: 0.95, desc: '강한 패를 숨깁니다' }
  ];

  const NAMES = ['민수', '지연', '태호', '수빈', '현우', '다은', '준영', '세라', '강훈', '유나'];

  function keyOf(c) { return c.rank * 4 + 'shdc'.indexOf(c.suit); }

  /**
   * 몬테카를로 승률 추정
   * @param {Array} hole   내 홀카드 2장
   * @param {Array} board  공개된 커뮤니티 카드
   * @param {number} opponents 상대 수
   * @param {number} sims  시뮬레이션 횟수
   */
  function equity(hole, board, opponents, sims, rng) {
    const rand = rng || Math.random;
    if (opponents <= 0) return 1;

    const used = {};
    const known = hole.concat(board);
    for (let i = 0; i < known.length; i++) used[keyOf(known[i])] = true;

    const full = H.cards.makeDeck();
    const deck = [];
    for (let i = 0; i < full.length; i++) if (!used[keyOf(full[i])]) deck.push(full[i]);

    const needBoard = 5 - board.length;
    const needed = needBoard + opponents * 2;
    let wins = 0, ties = 0;

    const heroCards = new Array(7);
    const oppCards = new Array(7);

    for (let s = 0; s < sims; s++) {
      // 필요한 만큼만 부분 셔플
      for (let i = 0; i < needed; i++) {
        const j = i + Math.floor(rand() * (deck.length - i));
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      let ptr = 0;
      const fullBoard = board.slice();
      for (let i = 0; i < needBoard; i++) fullBoard.push(deck[ptr++]);

      heroCards[0] = hole[0]; heroCards[1] = hole[1];
      for (let i = 0; i < 5; i++) heroCards[2 + i] = fullBoard[i];
      const heroScore = H.eval.evaluate(heroCards).value;

      let best = -1, tieCount = 0;
      for (let o = 0; o < opponents; o++) {
        oppCards[0] = deck[ptr++];
        oppCards[1] = deck[ptr++];
        for (let i = 0; i < 5; i++) oppCards[2 + i] = fullBoard[i];
        const sc = H.eval.evaluate(oppCards).value;
        if (sc > best) best = sc;
      }
      if (heroScore > best) wins++;
      else if (heroScore === best) ties++;
    }
    return (wins + ties * 0.5) / sims;
  }

  function simCount(street, opponents) {
    const base = street === 'preflop' ? 220 : street === 'flop' ? 260 : 320;
    return Math.max(120, Math.round(base / Math.max(1, opponents * 0.6)));
  }

  function round2bb(x, bb) {
    const unit = Math.max(1, Math.round(bb / 2));
    return Math.round(x / unit) * unit;
  }

  /**
   * 봇의 결정을 반환한다. {type:'fold'|'check'|'call'|'raise', amount?}
   */
  function decide(game, player) {
    const prof = player.profile || PROFILES[1];
    const a = game.actionsFor(player);
    const opponents = game.activePlayers().length - 1;
    const pot = game.totalPot();
    const toCall = a.toCall;
    const rand = game.rng || Math.random;

    if (opponents <= 0) return { type: a.canCheck ? 'check' : 'call' };

    const sims = simCount(game.street, opponents);
    let eq = equity(player.cards, game.community, opponents, sims, rand);

    // 성향 보정 + 약간의 노이즈(예측 불가능성)
    const noise = (rand() - 0.5) * 0.05;
    const eqAdj = Math.max(0, Math.min(1, eq + noise + (prof.aggression - 0.5) * 0.04));

    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const stack = player.chips;
    const commitRatio = toCall / Math.max(1, stack + toCall);

    // 레이즈/벳 기준선
    const raiseLine = 0.62 - (prof.aggression - 0.5) * 0.18;
    const bluffing = rand() < prof.bluff && opponents <= 2 && eqAdj < 0.42;

    function makeRaise(sizePct) {
      const target = Math.max(
        a.minRaiseTo,
        round2bb(game.currentBet + (pot + toCall) * sizePct, game.bigBlind)
      );
      let amount = Math.min(target, a.maxRaiseTo);
      // 스택의 대부분을 넣을 거면 그냥 올인
      if (amount > player.bet + stack * 0.75) amount = a.maxRaiseTo;
      return { type: 'raise', amount: amount, equity: eq };
    }

    /* --- 체크 가능한 상황 --- */
    if (a.canCheck) {
      if (!a.canRaise) return { type: 'check', equity: eq };
      if (eqAdj > raiseLine + 0.12 && rand() < 0.85) {
        // 트래퍼는 가끔 슬로우 플레이
        if (prof.key === 'trap' && eqAdj > 0.8 && rand() < 0.4) return { type: 'check', equity: eq };
        return makeRaise(0.55 + prof.aggression * 0.3);
      }
      if (eqAdj > raiseLine && rand() < 0.5) return makeRaise(0.45 + prof.aggression * 0.25);
      if (bluffing) return makeRaise(0.4 + prof.aggression * 0.3);
      return { type: 'check', equity: eq };
    }

    /* --- 콜/레이즈/폴드 --- */
    const callThreshold = potOdds * (1.05 - (prof.loose - 1) * 0.35);

    // 아주 강할 때는 레이즈
    if (a.canRaise && eqAdj > raiseLine + 0.15 && rand() < 0.75) {
      return makeRaise(0.6 + prof.aggression * 0.35);
    }
    if (a.canRaise && eqAdj > raiseLine && rand() < 0.35 * (0.5 + prof.aggression)) {
      return makeRaise(0.5 + prof.aggression * 0.3);
    }
    // 세미 블러프 / 순수 블러프 레이즈
    if (a.canRaise && bluffing && commitRatio < 0.5 && rand() < 0.5) {
      return makeRaise(0.55);
    }

    if (eqAdj >= callThreshold) {
      // 콜 비용이 스택 대부분이면 더 확실할 때만
      if (commitRatio > 0.55 && eqAdj < 0.55 + (1 - prof.loose) * 0.1) {
        return { type: 'fold', equity: eq };
      }
      return { type: 'call', equity: eq };
    }

    // 아주 싼 콜은 성향에 따라 받아준다
    if (toCall <= game.bigBlind && eqAdj > potOdds * 0.72 && rand() < prof.loose * 0.55) {
      return { type: 'call', equity: eq };
    }

    return { type: 'fold', equity: eq };
  }

  H.ai = {
    PROFILES: PROFILES,
    NAMES: NAMES,
    equity: equity,
    decide: decide
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
