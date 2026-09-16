/*
 * 의존성 없는 테스트 러너:  node test/run-tests.js
 */
const H = require('../js/engine.js');
require('../js/ai.js');
require('../js/rng.js');
require('../js/ranges.js');
require('../js/equity.js');
require('../js/stats.js');
require('../js/tournament.js');
require('../js/review.js');
require('../js/history.js');
require('../js/i18n.js');
require('../js/format.js');
require('../js/profile.js');
require('../js/drill.js');
require('../js/preflop.js');
const C = H.cards;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '조건이 거짓입니다'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' 기대값 ' + JSON.stringify(b) + ', 실제 ' + JSON.stringify(a));
}
function hand(str) { return str.split(/\s+/).map(C.parseCard); }
function score(str) { return H.eval.evaluate(hand(str)); }

console.log('\n[핸드 평가기]');
test('로열 플러시 > 스트레이트 플러시', function () {
  assert(score('As Ks Qs Js 10s').value > score('9s 8s 7s 6s 5s').value);
});
test('A-5 휠 스트레이트 인식', function () {
  const r = score('As 2h 3d 4c 5s');
  eq(r.cat, H.eval.CAT.STRAIGHT);
  eq(r.tiebreak[0], 5);
});
test('휠 < 6하이 스트레이트', function () {
  assert(score('As 2h 3d 4c 5s').value < score('2h 3d 4c 5s 6h').value);
});
test('포카드 > 풀하우스', function () {
  assert(score('7s 7h 7d 7c 2s').value > score('Ks Kh Kd 2c 2s').value);
});
test('풀하우스 > 플러시', function () {
  assert(score('3s 3h 3d 2c 2s').value > score('As Qs 9s 5s 3s').value);
});
test('플러시 킥커 비교', function () {
  assert(score('As Qs 9s 5s 3s').value > score('Ks Qs 9s 5s 3s').value);
});
test('7장 중 최고 5장 선택', function () {
  const r = H.eval.evaluate(hand('As Ah 7d 7c 7s 2d 3h'));
  eq(r.cat, H.eval.CAT.FULL_HOUSE);
  eq(r.tiebreak[0], 7);
  eq(r.tiebreak[1], 14);
});
test('보드 플레이(동점) 처리', function () {
  const board = hand('As Ks Qs Js 10s');
  const a = H.eval.evaluate(hand('2c 3d').concat(board));
  const b = H.eval.evaluate(hand('4c 5d').concat(board));
  eq(a.value, b.value);
});
test('투페어 킥커', function () {
  assert(score('As Ah Ks Kh Qd').value > score('As Ah Ks Kh Jd').value);
});
test('describe 출력', function () {
  eq(H.eval.describe(score('As Ks Qs Js 10s')), '로열 플러시');
  eq(H.eval.describe(score('7s 7h 7d 7c 2s')), '포카드 (7)');
});

console.log('\n[덱]');
test('덱은 52장이고 중복이 없다', function () {
  const d = C.makeDeck();
  eq(d.length, 52);
  const set = new Set(d.map(C.cardToString));
  eq(set.size, 52);
});

console.log('\n[게임 엔진]');
function newGame(chips, n) {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20 });
  for (let i = 0; i < (n || 4); i++) {
    g.addPlayer({ name: 'P' + i, chips: Array.isArray(chips) ? chips[i] : chips, isHuman: i === 0 });
  }
  return g;
}

test('핸드 시작 시 블라인드와 홀카드 배분', function () {
  const g = newGame(1000);
  g.startHand();
  eq(g.totalPot(), 30);
  g.players.forEach(function (p) { eq(p.cards.length, 2, p.name + ' 홀카드'); });
  eq(g.phase, 'awaiting-action');
  // 4인 테이블: 버튼+3 (=UTG) 가 첫 액션
  eq(g.currentActor().name, 'P' + ((g.button + 3) % 4));
});

test('모두 폴드하면 빅블라인드가 팟 획득', function () {
  const g = newGame(1000);
  g.startHand();
  let guard = 0;
  while (g.phase === 'awaiting-action' && guard++ < 20) {
    g.act(g.currentActor().id, { type: 'fold' });
  }
  eq(g.phase, 'hand-over');
  eq(g.results.uncontested, true);
  eq(g.results.winners[0].amount, 30);
});

test('최소 레이즈 규칙', function () {
  const g = newGame(1000);
  g.startHand();
  const p = g.currentActor();
  const a = g.actionsFor(p);
  eq(a.toCall, 20);
  eq(a.minRaiseTo, 40);
  g.act(p.id, { type: 'raise', amount: 60 });
  const b = g.actionsFor(g.currentActor());
  eq(b.toCall, 60);
  eq(b.minRaiseTo, 100, '레이즈 폭 40이므로 최소 100까지');
});

test('빅블라인드는 프리플랍 옵션을 갖는다', function () {
  const g = newGame(1000);
  g.startHand();
  const bbIdx = (g.button + 2) % 4;
  let guard = 0;
  while (g.phase === 'awaiting-action' && g.currentActor() !== g.players[bbIdx] && guard++ < 10) {
    g.act(g.currentActor().id, { type: 'call' });
  }
  eq(g.currentActor(), g.players[bbIdx], 'BB에게 차례가 와야 한다');
  const a = g.actionsFor(g.players[bbIdx]);
  eq(a.canCheck, true, 'BB는 체크 가능');
});

test('전원 콜 후 플랍 3장, 다음은 SB부터', function () {
  const g = newGame(1000);
  g.startHand();
  let guard = 0;
  while (g.phase === 'awaiting-action' && guard++ < 10) {
    const a = g.actionsFor(g.currentActor());
    g.act(g.currentActor().id, { type: a.canCheck ? 'check' : 'call' });
  }
  eq(g.phase, 'need-street');
  g.dealNextStreet();
  eq(g.street, 'flop');
  eq(g.community.length, 3);
  eq(g.totalPot(), 80);
  eq(g.currentActor(), g.players[(g.button + 1) % 4], '플랍은 SB부터');
});

test('리버까지 진행하면 쇼다운', function () {
  const g = newGame(1000);
  g.startHand();
  let guard = 0;
  while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 100) {
    if (g.phase === 'awaiting-action') {
      const a = g.actionsFor(g.currentActor());
      g.act(g.currentActor().id, { type: a.canCheck ? 'check' : 'call' });
    } else if (g.phase === 'need-street') g.dealNextStreet();
    else if (g.phase === 'showdown') g.resolveShowdown();
  }
  eq(g.phase, 'hand-over');
  eq(g.community.length, 5);
  assert(g.results.winners.length >= 1, '승자가 있어야 한다');
  const total = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
  eq(total, 4000, '칩 총량 보존');
});

test('사이드팟 계산', function () {
  const g = newGame([100, 300, 1000], 3);
  g.players[0].totalBet = 100;
  g.players[1].totalBet = 300;
  g.players[2].totalBet = 300;
  const pots = g.buildPots();
  eq(pots.length, 2);
  eq(pots[0].amount, 300, '메인팟 100*3');
  eq(pots[0].eligible.length, 3);
  eq(pots[1].amount, 400, '사이드팟 200*2');
  eq(pots[1].eligible.length, 2);
});

test('폴드한 플레이어의 칩도 팟에 남는다', function () {
  const g = newGame(1000, 3);
  g.players[0].totalBet = 50; g.players[0].folded = true;
  g.players[1].totalBet = 200;
  g.players[2].totalBet = 200;
  const pots = g.buildPots();
  const total = pots.reduce(function (s, p) { return s + p.amount; }, 0);
  eq(total, 450);
  pots.forEach(function (p) { assert(p.eligible.indexOf(0) === -1, '폴드한 플레이어는 자격 없음'); });
});

test('올인 러너웃 후 칩 총량 보존 (숏스택 포함)', function () {
  for (let trial = 0; trial < 40; trial++) {
    const g = newGame([37, 1000, 250, 640], 4);
    const before = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
    g.startHand();
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 200) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        const a = g.actionsFor(p);
        const r = Math.random();
        if (r < 0.25 && a.canRaise) g.act(p.id, { type: 'raise', amount: a.maxRaiseTo });
        else if (r < 0.75) g.act(p.id, { type: a.canCheck ? 'check' : 'call' });
        else g.act(p.id, { type: a.canCheck ? 'check' : 'fold' });
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    eq(g.phase, 'hand-over', '핸드가 끝나야 한다');
    const after = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
    eq(after, before, '시도 ' + trial + ' 칩 총량');
    g.players.forEach(function (p) { assert(p.chips >= 0, '칩이 음수가 될 수 없다'); });
  }
});

test('헤즈업: 버튼이 SB이고 프리플랍 선행', function () {
  const g = newGame(1000, 2);
  g.startHand();
  eq(g.currentActor(), g.players[g.button], '프리플랍은 버튼(SB)부터');
  g.act(g.currentActor().id, { type: 'call' });
  g.act(g.currentActor().id, { type: 'check' });
  eq(g.phase, 'need-street');
  g.dealNextStreet();
  eq(g.currentActor(), g.players[(g.button + 1) % 2], '플랍은 BB부터');
});

test('장기 자동 플레이 안정성 (봇 100핸드)', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20 });
  for (let i = 0; i < 5; i++) {
    g.addPlayer({ name: 'B' + i, chips: 1000, profile: H.ai.PROFILES[i % H.ai.PROFILES.length] });
  }
  const start = 5000;
  let hands = 0;
  while (hands < 100 && g.players.length > 1) {
    g.startHand();
    if (g.phase === 'game-over') break;
    hands++;
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 300) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        const d = H.ai.decide(g, p);
        const res = g.act(p.id, d);
        assert(res.ok, '봇 액션 실패: ' + JSON.stringify(d) + ' / ' + res.error);
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    assert(guard < 300, '무한루프 감지');
    const total = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
    eq(total, start, '핸드 ' + hands + ' 이후 칩 총량');
  }
  assert(hands > 10, '충분히 많은 핸드가 진행되어야 한다 (진행: ' + hands + ')');
});

console.log('\n[숏 올인과 레이즈 재개 규칙]');
function threeWay(chips) {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(1) });
  chips.forEach(function (c, i) { g.addPlayer({ id: i, name: 'P' + i, chips: c }); });
  g.startHand();
  return g;
}
test('정식 레이즈에 못 미치는 올인은 이미 행동한 사람에게 레이즈를 다시 열지 않는다', function () {
  const g = threeWay([2000, 2000, 70]);       // BTN=0 오픈, SB=1 콜, BB=2 가 70 으로 숏 올인
  let p = g.currentActor();
  eq(g.act(p.id, { type: 'raise', amount: 60 }).ok, true);
  p = g.currentActor();
  eq(g.act(p.id, { type: 'call' }).ok, true);
  p = g.currentActor();
  eq(p.chips + p.bet, 70);
  eq(g.act(p.id, { type: 'raise', amount: 70 }).ok, true);
  assert(p.allIn, '올인이어야 한다');
  p = g.currentActor();
  eq(p.id, 0);
  const a = g.actionsFor(p);
  eq(a.toCall, 10);
  eq(a.canRaise, false, '오프너는 콜/폴드만 가능해야 한다');
  eq(g.act(p.id, { type: 'raise', amount: 200 }).ok, false);
  eq(g.act(p.id, { type: 'call' }).ok, true);
  p = g.currentActor();
  eq(p.id, 1);
  eq(g.actionsFor(p).canRaise, false, '콜했던 사람도 레이즈할 수 없다');
  eq(g.act(p.id, { type: 'call' }).ok, true);
  eq(g.phase, 'need-street');
});
test('아직 행동하지 않은 사람은 숏 올인 뒤에도 레이즈할 수 있다', function () {
  const g = threeWay([2000, 2000, 2000, 70]);  // UTG=3 오픈, BTN=0 콜, SB=1 숏 올인? -> SB 는 2000. 대신 BB 를 숏으로
  // 4인: BTN=0, SB=1, BB=2, UTG=3(70칩). UTG 가 70 으로 올인(오픈), BTN 은 아직 행동 전
  let p = g.currentActor();
  eq(p.id, 3);
  eq(g.act(p.id, { type: 'raise', amount: 70 }).ok, true);
  p = g.currentActor();
  eq(p.id, 0);
  eq(g.actionsFor(p).canRaise, true, '첫 행동이면 레이즈할 수 있다');
});
test('정식 레이즈가 나오면 다시 모두에게 레이즈가 열린다', function () {
  const g = threeWay([2000, 2000, 70, 2000]); // BTN=0, SB=1, BB=2(70), UTG=3
  let p = g.currentActor();                    // UTG
  g.act(p.id, { type: 'raise', amount: 60 });
  p = g.currentActor();                        // BTN 콜
  g.act(p.id, { type: 'call' });
  p = g.currentActor();                        // SB 콜
  g.act(p.id, { type: 'call' });
  p = g.currentActor();                        // BB 숏 올인 70
  g.act(p.id, { type: 'raise', amount: 70 });
  p = g.currentActor();                        // UTG: 닫혀 있다
  eq(p.id, 3);
  eq(g.actionsFor(p).canRaise, false);
  g.act(p.id, { type: 'call' });
  p = g.currentActor();                        // BTN: 닫혀 있다 — 저장/복원에도 남아야 한다
  eq(p.id, 0);
  eq(g.actionsFor(p).canRaise, false);
  const back = H.Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  eq(back.actionsFor(back.currentActor()).canRaise, false, 'raiseClosed 가 저장/복원되어야 한다');
});
test('플랍에서 정식 레이즈 뒤에는 모두 다시 레이즈할 수 있다', function () {
  const g = threeWay([2000, 2000, 2000]);
  let p = g.currentActor();
  g.act(p.id, { type: 'raise', amount: 60 });
  g.act(g.currentActor().id, { type: 'call' });
  g.act(g.currentActor().id, { type: 'call' });
  g.dealNextStreet();
  p = g.currentActor();
  g.act(p.id, { type: 'raise', amount: 40 });   // 벳
  p = g.currentActor();
  g.act(p.id, { type: 'raise', amount: 120 });  // 정식 레이즈
  p = g.currentActor();
  eq(g.actionsFor(p).canRaise, true);
  eq(g.actionsFor(p).minRaiseTo, 200);
});

console.log('\n[고속 평가기 교차검증]');
// 독립적인 레퍼런스 구현(21조합 브루트포스)과 순위가 일치하는지 검증한다.
function refEval5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every(c => c.suit === cards[0].suit);
  const counts = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
  const groups = Object.keys(counts).map(r => [+r, counts[r]])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let sh = 0;
  if (groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) sh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) sh = 5;
  }
  let cat, tb;
  if (isFlush && sh) { cat = 8; tb = [sh]; }
  else if (groups[0][1] === 4) { cat = 7; tb = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; tb = [groups[0][0], groups[1][0]]; }
  else if (isFlush) { cat = 5; tb = ranks.slice(); }
  else if (sh) { cat = 4; tb = [sh]; }
  else if (groups[0][1] === 3) { cat = 3; tb = [groups[0][0], groups[1][0], groups[2][0]]; }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; tb = [groups[0][0], groups[1][0], groups[2][0]]; }
  else if (groups[0][1] === 2) { cat = 1; tb = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]; }
  else { cat = 0; tb = ranks.slice(); }
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 15 + (tb[i] || 0);
  return v;
}
function refEval(cards) {
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const v = refEval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
      if (v > best) best = v;
    }
  return best;
}

test('레퍼런스 구현과 점수가 완전히 일치 (7장 x 20,000회)', function () {
  const deck = C.makeDeck();
  let bad = 0, sample = '';
  for (let i = 0; i < 20000; i++) {
    C.shuffle(deck);
    const seven = deck.slice(0, 7);
    const fast = H.eval.evaluate(seven).value;
    const slow = refEval(seven);
    if (fast !== slow) { bad++; if (!sample) sample = seven.map(C.cardToString).join(' ') + ' fast=' + fast + ' ref=' + slow; }
  }
  eq(bad, 0, '불일치 ' + bad + '건 ' + sample);
});

test('5장/6장 입력도 레퍼런스와 일치', function () {
  const deck = C.makeDeck();
  let bad = 0;
  for (let i = 0; i < 4000; i++) {
    C.shuffle(deck);
    for (const n of [5, 6]) {
      const hand = deck.slice(0, n);
      if (H.eval.evaluate(hand).value !== refEval(hand)) bad++;
    }
  }
  eq(bad, 0);
});

test('best5 는 실제로 최고 점수를 내는 5장', function () {
  const deck = C.makeDeck();
  for (let i = 0; i < 2000; i++) {
    C.shuffle(deck);
    const seven = deck.slice(0, 7);
    const five = H.eval.best5(seven);
    eq(five.length, 5);
    eq(H.eval.evaluate(five).value, H.eval.evaluate(seven).value, '시도 ' + i);
    // 돌려준 5장이 원본에 실제로 들어있는지
    five.forEach(function (c) {
      assert(seven.indexOf(c) >= 0, 'best5 가 원본에 없는 카드를 반환');
    });
  }
});

test('고속 평가기가 레퍼런스보다 최소 20배 빠르다', function () {
  const deck = C.shuffle(C.makeDeck());
  const seven = deck.slice(0, 7);
  let t = Date.now(), nFast = 0;
  while (Date.now() - t < 300) { H.eval.evaluate(seven); nFast++; }
  t = Date.now(); let nRef = 0;
  while (Date.now() - t < 300) { refEval(seven); nRef++; }
  const ratio = nFast / nRef;
  assert(ratio >= 20, '배속이 ' + ratio.toFixed(1) + '배에 그침');
  console.log('      (' + Math.round(nFast / 0.3).toLocaleString() + ' 회/초, 레퍼런스 대비 ' + ratio.toFixed(0) + '배)');
});

console.log('\n[시드 RNG]');
test('같은 시드는 같은 카드 순서를 만든다', function () {
  function firstCards(seed) {
    const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(seed) });
    for (let i = 0; i < 4; i++) g.addPlayer({ name: 'P' + i, chips: 1000 });
    g.startHand();
    return g.players.map(p => p.cards.map(C.cardToString).join('')).join('|');
  }
  eq(firstCards(42), firstCards(42), '같은 시드');
  assert(firstCards(42) !== firstCards(43), '다른 시드는 달라야 한다');
});
test('시드 문자열 왕복 변환', function () {
  for (let i = 0; i < 100; i++) {
    const s = H.rng.randomSeed();
    eq(H.rng.decode(H.rng.encode(s)), s);
  }
});

console.log('\n[i18n]');
test('모든 키가 ko/en 양쪽에 존재', function () {
  const keys = H.i18n.keys();
  assert(keys.length > 150, '키가 너무 적음');
  ['ko', 'en'].forEach(function (lang) {
    H.i18n.setLang(lang);
    keys.forEach(function (k) {
      const v = H.i18n.t(k);
      assert(v && v !== k, lang + ' 누락: ' + k);
    });
  });
  H.i18n.setLang('ko');
});
test('언어 전환이 핸드 설명에 반영된다', function () {
  const h = H.eval.evaluate('As Ks Qs Js 10s'.split(' ').map(C.parseCard));
  H.i18n.setLang('en');
  eq(H.eval.describe(h), 'Royal Flush');
  H.i18n.setLang('ko');
  eq(H.eval.describe(h), '로열 플러시');
});

console.log('\n[금액 단위 (칩 / bb)]');
test('칩 모드는 정수, bb 모드는 빅블라인드로 나눈다', function () {
  H.format.setBigBlind(20);
  H.format.setUnit('chips');
  eq(H.format.amount(1250), '1,250');
  H.format.setUnit('bb');
  eq(H.format.amount(1250), '62.5bb');
  eq(H.format.amount(60), '3bb');
  eq(H.format.amount(5), '0.25bb');
  eq(H.format.amount(2000), '100bb');
  eq(H.format.amount(4321), '216bb', '100bb 이상은 정수');
  eq(H.format.amount(-30), '-1.5bb');
  H.format.setUnit('chips');
});
test('입력칸은 표시 단위로 읽고 쓴다', function () {
  H.format.setBigBlind(20);
  H.format.setUnit('bb');
  eq(H.format.toInput(470), '23.5');
  eq(H.format.fromInput('23.5'), 470);
  eq(H.format.fromInput('2.25bb'), 45);
  H.format.setUnit('chips');
  eq(H.format.toInput(470), '470');
  eq(H.format.fromInput('470'), 470);
  assert(isNaN(H.format.fromInput('abc')));
});
test('i18n 의 amount 파라미터는 단위를 따른다 (과거 로그도 함께 바뀐다)', function () {
  H.format.setBigBlind(20);
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(1) });
  for (let i = 0; i < 2; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 1000 });
  g.startHand();
  g.act(g.currentActor().id, { type: 'raise', amount: 60 });
  const entry = g.log[g.log.length - 1];
  H.format.setUnit('chips');
  assert(entry.text.indexOf('60') >= 0, entry.text);
  H.format.setUnit('bb');
  assert(entry.text.indexOf('3bb') >= 0, entry.text);
  eq(H.review.actionLabel({ type: 'raise', amount: 60 }).indexOf('3bb') >= 0, true);
  H.format.setUnit('chips');
});

console.log('\n[프리플랍 레인지]');
const RG = H.ranges;
test('핸드 순위가 포커 상식과 맞는다', function () {
  // 표준 차트 순서: AA KK QQ JJ AKs TT AKo AQs ...
  const order = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'TT', 'AKo', 'AQs', '99', 'KQs', '77', 'A9o', '72o'];
  for (let i = 1; i < order.length; i++) {
    assert(RG.percentile(order[i - 1]) < RG.percentile(order[i]),
      order[i - 1] + ' 가 ' + order[i] + ' 보다 위여야 한다');
  }
  assert(RG.percentile('AA') < 0.01, 'AA 는 최상위');
  assert(RG.percentile('72o') > 0.98, '72o 는 최하위');
});
test('169개 클래스가 1326 콤보를 모두 덮는다', function () {
  eq(RG.RANKED.length, 169);
  const total = RG.RANKED.reduce(function (s, r) { return s + r[1]; }, 0);
  eq(total, 1326);
  assert(Math.abs(RG.RANKED[168][2] - 1) < 0.001, '누적 비율이 1 로 끝나야 한다');
});
test('포지션 판별', function () {
  eq(RG.positionOf(0, 0, 6), 'BTN');
  eq(RG.positionOf(1, 0, 6), 'SB');
  eq(RG.positionOf(2, 0, 6), 'BB');
  eq(RG.positionOf(3, 0, 6), 'UTG');
  eq(RG.positionOf(5, 0, 6), 'CO');
  eq(RG.positionOf(0, 0, 2), 'BTN');
  eq(RG.positionOf(1, 0, 2), 'BB');
});
test('오픈 레인지는 포지션이 좋을수록 넓다', function () {
  assert(RG.openPercent('UTG', 6) < RG.openPercent('MP', 6));
  assert(RG.openPercent('MP', 6) < RG.openPercent('CO', 6));
  assert(RG.openPercent('CO', 6) < RG.openPercent('BTN', 6));
  assert(RG.openPercent('BTN', 2) > RG.openPercent('BTN', 6), '인원이 적으면 넓어진다');
});
test('13x13 차트 격자', function () {
  const g = RG.chartGrid();
  eq(g.length, 13); eq(g[0].length, 13);
  eq(g[0][0], 'AA'); eq(g[0][1], 'AKs'); eq(g[1][0], 'AKo'); eq(g[12][12], '22');
});

console.log('\n[풀링 포지션 (7~9인)]');
test('인원별 포지션 순서', function () {
  eq(RG.positionsFor(6).join(' '), 'BTN SB BB UTG MP CO');
  eq(RG.positionsFor(7).join(' '), 'BTN SB BB UTG MP HJ CO');
  eq(RG.positionsFor(8).join(' '), 'BTN SB BB UTG UTG1 LJ HJ CO');
  eq(RG.positionsFor(9).join(' '), 'BTN SB BB UTG UTG1 MP LJ HJ CO');
  eq(RG.positionsFor(2).join(' '), 'BTN BB');
  eq(RG.positionsFor(4).join(' '), 'BTN SB BB CO');
});
test('9인 오픈 레인지는 앞자리일수록 좁고 6인보다 타이트하다', function () {
  const order = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN'];
  for (let i = 1; i < order.length; i++) {
    assert(RG.openPercent(order[i], 9) > RG.openPercent(order[i - 1], 9), order[i - 1] + ' < ' + order[i]);
  }
  assert(RG.openPercent('UTG', 9) < RG.openPercent('UTG', 6), '9인 UTG 가 6인 UTG 보다 좁다');
  assert(RG.openPercent('UTG', 9) < 0.14 && RG.openPercent('UTG', 9) > 0.09, '9인 UTG 약 12% (실제 ' + RG.openPercent('UTG', 9) + ')');
});
test('모든 포지션에 i18n 이름이 있다', function () {
  RG.POSITION_ORDER.forEach(function (p) { assert(H.i18n.has('pos.' + p), 'pos.' + p); });
});
test('9인 테이블 300핸드가 규칙 위반 없이 돌고 봇이 6인보다 타이트하다', function () {
  function run(nPlayers, hands, seed) {
    const BB = 20;
    const g = new H.Game({ smallBlind: BB / 2, bigBlind: BB, rng: H.rng.create(seed) });
    for (let i = 0; i < nPlayers; i++) g.addPlayer({ id: i, name: 'P' + i, chips: BB * 100, profile: H.ai.PROFILES[i % 5] });
    const tracker = H.stats.create({ bigBlind: BB });
    for (let h = 0; h < hands; h++) {
      g.players.forEach(function (p) { p.chips = BB * 100; });
      g.startHand();
      tracker.startHand(g);
      let guard = 0;
      while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 400) {
        if (g.phase === 'awaiting-action') {
          const p = g.currentActor();
          const d = H.ai.decide(g, p, { difficulty: 'hard', tracker: tracker });
          const res = g.act(p.id, d);
          assert(res.ok, '불가능한 액션: ' + JSON.stringify(d) + ' / ' + res.error);
        } else if (g.phase === 'need-street') g.dealNextStreet();
        else if (g.phase === 'showdown') g.resolveShowdown();
      }
      tracker.endHand(g);
      const total = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
      eq(total, BB * 100 * nPlayers, '칩 총량 보존');
    }
    const all = tracker.all();
    return all.reduce(function (s, x) { return s + x.vpip; }, 0) / all.length;
  }
  const v9 = run(9, 300, 909), v6 = run(6, 300, 606);
  console.log('      (VPIP 9인 ' + (v9 * 100).toFixed(0) + '% · 6인 ' + (v6 * 100).toFixed(0) + '%)');
  assert(v9 < v6, '9인 VPIP 가 6인보다 낮아야 한다');
  assert(v9 > 0.10 && v9 < 0.40, '9인 VPIP 가 현실적인 범위여야 한다: ' + (v9 * 100).toFixed(0) + '%');
});
test('9인 드릴에서 풀링 포지션이 나온다', function () {
  const seen = {};
  for (let s = 1; s <= 10; s++) seen[H.drill.generate({ target: 'preflop/open', seed: s, players: 9 }).spot.pos] = true;
  const keys = Object.keys(seen);
  assert(keys.length >= 4, '포지션이 다양해야 한다: ' + keys.join(','));
  assert(keys.some(function (k) { return k === 'UTG1' || k === 'LJ' || k === 'HJ'; }), '풀링 포지션이 하나는 나와야 한다: ' + keys.join(','));
});
test('9인에서 리뷰 항목의 포지션이 풀링 이름이다', function () {
  const g = makeGame(9);
  g.startHand();
  const p = g.currentActor();
  eq(g.position(p), 'UTG');
  g.act(p.id, { type: 'fold' });
  eq(g.position(g.currentActor()), 'UTG1');
});

console.log('\n[레인지 기반 승률]');
const EQ = H.equity;
function codes(str) { return str.split(/\s+/).map(C.parseCard).map(C.code); }
function eqOf(hole, board, band, keepTop, nOpp, sims) {
  const h = codes(hole);
  const b = board ? codes(board) : [];
  const dist = b.length >= 3 ? EQ.boardDistribution(b, h) : null;
  const combos = [];
  for (let i = 0; i < nOpp; i++) combos.push(EQ.buildCombos({ band: band, keepTop: keepTop }, b, h, dist));
  return EQ.vsRanges({ hole: h, board: b, combos: combos, sims: sims || 6000, seed: 1234 }).equity;
}
test('AA 의 헤즈업 승률은 약 85%', function () {
  const e = eqOf('As Ad', '', RG.band(0, 1), 1, 1);
  assert(e > 0.83 && e < 0.88, '실제 ' + (e * 100).toFixed(1) + '%');
});
test('타이트한 레인지 상대면 투기적 핸드의 승률이 크게 떨어진다', function () {
  const cases = [['9s 9h', 0.12], ['Jh Th', 0.15], ['Ac 5c', 0.15]];
  cases.forEach(function (c) {
    const vsRandom = eqOf(c[0], '', RG.band(0, 1), 1, 1);
    const vsTight = eqOf(c[0], '', RG.band(0, 0.15), 1, 1);
    assert(vsRandom - vsTight > c[1],
      c[0] + ': 랜덤 ' + (vsRandom * 100).toFixed(1) + '% vs 타이트 ' + (vsTight * 100).toFixed(1) + '% (차이가 너무 작음)');
  });
});
test('상대가 많을수록 승률이 낮아진다', function () {
  const e1 = eqOf('Ks Qs', '', RG.band(0, 1), 1, 1);
  const e3 = eqOf('Ks Qs', '', RG.band(0, 1), 1, 3);
  const e5 = eqOf('Ks Qs', '', RG.band(0, 1), 1, 5);
  assert(e1 > e3 && e3 > e5, e1.toFixed(3) + ' > ' + e3.toFixed(3) + ' > ' + e5.toFixed(3));
});
test('keepTop 이 작을수록(강한 레인지) 내 승률이 낮아진다', function () {
  const wide = eqOf('As Kd', 'Ah 7c 2d', RG.band(0, 0.3), 1, 1);
  const strong = eqOf('As Kd', 'Ah 7c 2d', RG.band(0, 0.3), 0.25, 1);
  assert(wide > strong + 0.05, '넓은 ' + wide.toFixed(3) + ' vs 강한 ' + strong.toFixed(3));
});
test('보드 강도 분포 크기가 정확하다', function () {
  const b = codes('Ah 7c 2d'), h = codes('As Kd');
  const dist = EQ.boardDistribution(b, h);
  eq(dist.length, 47 * 46 / 2, '플랍 + 내 홀카드 제외 = 47장에서 2장');
  for (let i = 1; i < dist.length; i++) assert(dist[i] >= dist[i - 1], '정렬되어야 한다');
});
test('buildCombos 는 밴드 밖의 핸드를 제외한다', function () {
  const b = [], h = codes('As Kd');
  const list = EQ.buildCombos({ band: RG.band(0, 0.05), keepTop: 1 }, b, h, null);
  for (let i = 0; i < list.length; i += 2) {
    const pct = RG.percentile(RG.classOfCodes(list[i], list[i + 1]));
    assert(pct <= 0.05, '밴드 밖 핸드가 포함됨');
  }
  assert(list.length >= 8, '조합이 너무 적음');
});
test('폴드 확률은 베팅이 클수록 높다', function () {
  const r = { band: RG.band(0, 1), keepTop: 1 };
  const small = EQ.foldProbability(100, 30, r, 1.25);
  const big = EQ.foldProbability(100, 150, r, 1.25);
  assert(big > small, small.toFixed(2) + ' -> ' + big.toFixed(2));
  const strong = EQ.foldProbability(100, 70, { band: RG.band(0, 1), keepTop: 0.15 }, 1.25);
  const weak = EQ.foldProbability(100, 70, r, 1.25);
  assert(weak > strong, '강한 레인지는 덜 접는다');
});

console.log('\n[프리플랍 솔버 테이블]');
const PF = H.preflop;
function comboPct(weights) { let m = 0; for (let i = 0; i < weights.length; i++) m += weights[i] * RG.INFO[RG.RANKED[i][0]].combos; return m / 1326; }
test('표가 있고 2·3·6·9인을 담고 있다', function () {
  assert(PF.available());
  ['2', '3', '6', '9'].forEach(function (k) { assert(H.preflopTable.tables[k], k + '인 표'); });
  eq(PF.tableKey(4), '6'); eq(PF.tableKey(7), '9'); eq(PF.tableKey(2), '2');
});
test('AA 는 어디서나 레이즈, 72o 는 UTG 폴드', function () {
  ['UTG', 'CO', 'BTN', 'SB'].forEach(function (p) { assert(PF.freq(6, p, 'open', 'AA').raise >= 0.99, p + ' AA'); });
  eq(PF.freq(6, 'UTG', 'open', '72o').raise, 0);
  eq(PF.freq(9, 'UTG', 'open', '72o').raise, 0);
  assert(PF.freq(6, 'BB', 'vsOpen:BTN', 'AA').raise >= 0.9, 'BB 는 AA 로 3벳');
});
test('오픈 레인지는 뒷자리일수록 넓고 풀링은 6맥스보다 타이트하다', function () {
  const six = ['UTG', 'MP', 'CO', 'BTN'].map(function (p) { return comboPct(PF.weights(6, p, 'open', 'raise')); });
  for (let i = 1; i < six.length; i++) assert(six[i] > six[i - 1], '6인 ' + i + ': ' + six.join(','));
  const nine = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN'].map(function (p) { return comboPct(PF.weights(9, p, 'open', 'raise')); });
  for (let i = 1; i < nine.length; i++) assert(nine[i] >= nine[i - 1] - 0.01, '9인 ' + i + ': ' + nine.join(','));
  assert(nine[0] < six[0], '9인 UTG 가 6인 UTG 보다 좁다');
  assert(six[0] > 0.10 && six[0] < 0.25, '6인 UTG 오픈 ' + six[0]);
  assert(six[3] > 0.35 && six[3] < 0.55, '6인 BTN 오픈 ' + six[3]);
});
test('3벳 레인지는 프리미엄 + 블러프가 섞이고 콜 레인지에 페어가 있다', function () {
  const f = PF.freq(6, 'BTN', 'vsOpen:CO', 'AA');
  assert(f.raise >= 0.9, 'AA 3벳');
  const total = comboPct(PF.weights(6, 'BTN', 'vsOpen:CO', 'raise'));
  assert(total > 0.06 && total < 0.30, 'BTN vs CO 3벳 ' + total);
  assert(PF.freq(6, 'BB', 'vsOpen:BTN', '22').call > 0.5, 'BB 는 22 로 콜');
  assert(PF.freq(6, 'BB', 'vsOpen:BTN', '72o').fold > 0.8, 'BB 도 72o 는 접는다');
});
test('빈도 합이 1 을 넘지 않는다', function () {
  Object.keys(H.preflopTable.tables).forEach(function (k) {
    const t = H.preflopTable.tables[k];
    Object.keys(t).forEach(function (pos) {
      Object.keys(t[pos]).forEach(function (sit) {
        const row = t[pos][sit];
        for (let i = 0; i < 169; i++) {
          const c = row.c ? row.c.charCodeAt(i) - 48 : 0, r = row.r ? row.r.charCodeAt(i) - 48 : 0;
          assert(c + r <= 10, k + ' ' + pos + ' ' + sit + ' ' + i + ': ' + c + '+' + r);
        }
      });
    });
  });
});
test('situationOf 가 오프너·3벳터를 찾는다', function () {
  const g = makeGame(6);
  g.startHand();
  const utg = g.currentActor();
  eq(PF.situationOf(g, utg).sit, 'open');
  g.act(utg.id, { type: 'raise', amount: 50 });
  const mp = g.currentActor();
  eq(PF.situationOf(g, mp).sit, 'vsOpen:UTG');
  g.act(mp.id, { type: 'raise', amount: 150 });
  g.act(g.currentActor().id, { type: 'fold' });
  const co = g.currentActor();
  const s = PF.situationOf(g, co);
  eq(s.sit, 'vs3bet:MP'); eq(s.cold, true);
  ['fold', 'fold', 'fold'].forEach(function () { g.act(g.currentActor().id, { type: 'fold' }); });
  eq(g.currentActor(), utg);
  const s2 = PF.situationOf(g, utg);
  eq(s2.sit, 'vs3bet:MP'); eq(s2.cold, false);
});
test('솔버 결정 모드(TUNE.solver)에서 AI 가 표로 프리플랍을 친다 (AA 레이즈 · 72o 폴드)', function () {
  const prev = H.ai.TUNE.solver;
  H.ai.TUNE.solver = true;
  try {
    const g = makeGame(6);
    g.startHand();
    const p = g.currentActor();
    forceCards(p, 'As Ad');
    const d = H.ai.decide(g, p, { difficulty: 'hard' });
    eq(d.type, 'raise'); assert(d.think.solver, '솔버 경로');
    eq(d.amount, 50, '오픈 2.5bb');
    forceCards(p, '7d 2c');
    eq(H.ai.decide(g, p, { difficulty: 'hard' }).type, 'fold');
  } finally { H.ai.TUNE.solver = prev; }
});
test('기본값: 6인 이상은 상대가 루즈하다고 확인되기 전까지 휴리스틱', function () {
  eq(H.ai.TUNE.solver, false);
  const g = makeGame(6);
  g.startHand();
  const p = g.currentActor();
  forceCards(p, 'As Ad');
  const d = H.ai.decide(g, p, { difficulty: 'hard' });
  eq(d.type, 'raise'); assert(!d.think.solver, '휴리스틱 경로');
});
test('헤즈업은 솔버 표를 쓴다 — BB 가 오픈에 자주 접지 않고 BTN 이 3벳에 이어간다', function () {
  const cnt = { bbFold: 0, bbN: 0, btnFold: 0, btnN: 0 };
  for (let s = 1; s <= 60; s++) {
    const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(s) });
    g.addPlayer({ id: 0, name: 'A', chips: 2000, profile: H.ai.PROFILES[1] });
    g.addPlayer({ id: 1, name: 'B', chips: 2000, profile: H.ai.PROFILES[1] });
    g.startHand();
    const btn = g.currentActor();
    eq(g.position(btn), 'BTN');
    g.act(btn.id, { type: 'raise', amount: 50 });
    const bb = g.currentActor();
    const d = H.ai.decide(g, bb, { difficulty: 'hard', rng: H.rng.create(s + 100) });
    assert(d.think.solver, '헤즈업 BB 는 솔버 경로');
    cnt.bbN++; if (d.type === 'fold') cnt.bbFold++;
    g.act(bb.id, { type: 'raise', amount: 175 });
    const d2 = H.ai.decide(g, btn, { difficulty: 'hard', rng: H.rng.create(s + 200) });
    cnt.btnN++; if (d2.type === 'fold') cnt.btnFold++;
  }
  assert(cnt.bbFold / cnt.bbN < 0.5, 'BB 오픈 폴드 ' + cnt.bbFold + '/' + cnt.bbN + ' (예전 70%)');
  assert(cnt.btnFold / cnt.btnN < 0.75, 'BTN 3벳 폴드 ' + cnt.btnFold + '/' + cnt.btnN + ' (예전 92~100%)');
});
test('고급은 상대 평균 VPIP 가 높다고 확인되면 솔버로 전환한다', function () {
  const g = makeGame(4);
  const tracker = H.stats.create({ bigBlind: 20 });
  g.startHand();
  const ctx = { game: g, player: g.currentActor(), tracker: tracker, diff: H.ai.DIFFICULTY.hard, n: 4 };
  eq(H.ai.opponentsVpip(ctx), null, '표본이 없으면 null');
  eq(H.ai.shouldUseSolver(ctx), false);
  /* 상대 셋이 40핸드씩 루즈하게 친 것처럼 통계를 만든다 */
  g.players.forEach(function (p, i) {
    if (p === ctx.player) return;
    const d = tracker.ensure(p.id, p.name);
    d.hands = 40; d.vpip = i % 2 === 0 ? 20 : 16;   // 50% / 40%
  });
  assert(H.ai.opponentsVpip(ctx) > 0.4);
  eq(H.ai.shouldUseSolver(ctx), true);
  g.players.forEach(function (p) { if (p !== ctx.player) tracker.data[p.id].vpip = 6; });   // 15%
  eq(H.ai.shouldUseSolver(ctx), false, '타이트한 테이블은 휴리스틱');
  const ctxNormal = Object.assign({}, ctx, { diff: H.ai.DIFFICULTY.normal });
  g.players.forEach(function (p) { if (p !== ctx.player) tracker.data[p.id].vpip = 20; });
  eq(H.ai.shouldUseSolver(ctxNormal), false, '보통 난이도는 프로파일링이 없어 전환하지 않는다');
});
test('C벳 빈도를 센다', function () {
  const g = makeGame(3);
  const tracker = H.stats.create({ bigBlind: 20 });
  g.startHand(); tracker.startHand(g);
  const btn = g.currentActor();
  g.act(btn.id, { type: 'raise', amount: 60 });
  g.act(g.currentActor().id, { type: 'fold' });
  const bb = g.currentActor();
  g.act(bb.id, { type: 'call' });
  g.dealNextStreet();
  g.act(bb.id, { type: 'check' });
  g.act(btn.id, { type: 'raise', amount: 60 });   // C벳
  g.act(bb.id, { type: 'fold' });
  tracker.endHand(g);
  const st = tracker.get(btn.id);
  eq(st.samples.cbetOpp, 1); eq(st.cbetFlop, 1);
  eq(tracker.get(bb.id).samples.cbetOpp, 0, '어그레서가 아니면 기회가 아니다');
});
test('솔버 레인지 역산 모드(TUNE.solverRanges): 오픈한 상대의 가중치는 표의 오픈 빈도다', function () {
  const prev = H.ai.TUNE.solverRanges;
  H.ai.TUNE.solverRanges = true;
  try {
    const g = makeGame(6);
    g.startHand();
    const opener = g.currentActor();
    g.act(opener.id, { type: 'raise', amount: 50 });
    const ctx = { game: g, diff: H.ai.DIFFICULTY.hard, tracker: null };
    const r = H.ai.inferRange(ctx, opener);
    const w = PF.weights(6, 'UTG', 'open', 'raise');
    let same = true;
    for (let i = 0; i < 169; i++) if (Math.abs(r.weights[i] - w[i]) > 1e-6) { same = false; break; }
    assert(same, '솔버 오픈 빈도와 같아야 한다');
    assert(r.band.hi < 0.35, '오픈 레인지는 좁다');
  } finally { H.ai.TUNE.solverRanges = prev; }
});

console.log('\n[클래스별 가중치 레인지]');
function wOf(weights, key) { return weights[RG.INFO[key].index]; }
test('경계가 부드럽게 기울고 오프수트 잡패는 빠진다', function () {
  const w = RG.ACTION_WEIGHTS.open(0.20);
  eq(wOf(w, 'AA'), 1);
  assert(wOf(w, '72o') === 0, '72o 는 오픈 레인지에 없다');
  const edge = RG.taper(0.20, 0, 0.20, 0.04);
  assert(edge > 0 && edge < 1, '경계 핸드는 0 과 1 사이여야 한다 (실제 ' + edge + ')');
  assert(RG.taper(0.10, 0, 0.20, 0.04) === 1);
  assert(RG.taper(0.30, 0, 0.20, 0.04) === 0);
});
test('3벳 레인지에는 프리미엄과 수티드 에이스 블러프가 섞인다', function () {
  const w = RG.ACTION_WEIGHTS.threeBet();
  eq(wOf(w, 'AA'), 1);
  assert(wOf(w, 'A5s') > 0 && wOf(w, 'A5s') < 1, 'A5s 는 일부만 3벳한다');
  eq(wOf(w, 'A5o'), 0);
  eq(wOf(w, 'J4o'), 0);
});
test('콜 레인지는 포켓페어·수티드가 앞서고 약한 오프수트 에이스는 드물다', function () {
  const w = RG.ACTION_WEIGHTS.call(0.25);
  assert(wOf(w, '55') >= 0.9, '작은 포켓페어는 세트 마이닝으로 콜한다');
  assert(wOf(w, '87s') > wOf(w, 'A7o'), '수티드 커넥터가 약한 오프수트 에이스보다 자주 콜한다');
  assert(wOf(w, 'AA') < 1, '프리미엄은 대부분 3벳으로 빠진다');
});
test('support() 는 가중치의 지지 구간을 밴드로 돌려준다', function () {
  const b = RG.support(RG.ACTION_WEIGHTS.open(0.14));
  assert(b.lo === RG.INFO.AA.pct && b.hi > 0.14 && b.hi < 0.25, JSON.stringify(b));
});
test('buildCombos 는 가중치에 비례해 콤보를 복제한다', function () {
  const w = RG.makeWeights(function (info) { return info.key === 'AA' ? 1 : info.key === 'KK' ? 0.5 : 0; });
  const list = EQ.buildCombos({ weights: w, keepTop: 1 }, [], [], null);
  let aa = 0, kk = 0;
  for (let i = 0; i < list.length; i += 2) {
    const k = RG.classOfCodes(list[i], list[i + 1]);
    if (k === 'AA') aa++; else if (k === 'KK') kk++; else throw new Error('밖의 클래스: ' + k);
  }
  eq(aa, kk * 2, 'AA 가 KK 의 두 배로 샘플링돼야 한다 (' + aa + ' vs ' + kk + ')');
  assert(list.meta && Math.abs(list.meta.mass - 9) < 1e-6, '가중 질량 = 6×1 + 6×0.5');
});
test('균등 레인지는 복제 없이 1벌이다', function () {
  const list = EQ.buildCombos({ weights: RG.ACTION_WEIGHTS.any(), keepTop: 1 }, [], [], null);
  eq(list.length, 1326 * 2);
});
test('포스트플랍 소프트 컷: 강한 콤보는 온전히, 약한 꼬리는 바닥값만 남는다', function () {
  eq(EQ.strengthWeight(0.10, 0.36), 1);
  const tail = EQ.strengthWeight(0.90, 0.36);
  assert(tail > 0 && tail < 0.15, '꼬리는 작은 바닥값 (' + tail + ')');
  assert(EQ.strengthWeight(0.45, 0.36) < 1 && EQ.strengthWeight(0.45, 0.36) > tail, '중간은 기울기 위');
  eq(EQ.strengthWeight(0.9, 1), 1, 'keepTop=1 이면 자르지 않는다');
});
test('양극 가중치: 벳 레인지의 약한 꼬리가 중간 핸드보다 무겁다 (U 자)', function () {
  const mid = EQ.strengthWeight(0.50, 0.36, 0.45, 0.6), tail = EQ.strengthWeight(0.80, 0.36, 0.45, 0.6);
  assert(tail > mid, '꼬리 ' + tail + ' > 중간 ' + mid);
  eq(EQ.strengthWeight(0.10, 0.36, 0.45, 0.6), 1, '밸류는 그대로');
  assert(EQ.strengthWeight(0.80, 0.36, 0, 0.6) < 0.15, '양극이 없으면 꼬리는 바닥값');
  const h = hand('Qs Jd').map(C.code), b = hand('Ah 7c 2d').map(C.code);
  const dist = EQ.boardDistribution(b, h);
  const linear = EQ.buildCombos({ weights: RG.ACTION_WEIGHTS.any(), keepTop: 0.36 }, b, h, dist);
  const polar = EQ.buildCombos({ weights: RG.ACTION_WEIGHTS.any(), keepTop: 0.36, polar: 0.45 }, b, h, dist);
  assert(polar.meta.strongShare < linear.meta.strongShare, '양극 레인지는 강한 몫이 작다');
});
test('C벳은 양극으로, 콜은 선형으로 역산한다', function () {
  const g = makeGame(3);
  g.startHand();
  const btn = g.currentActor();
  g.act(btn.id, { type: 'raise', amount: 60 });
  g.act(g.currentActor().id, { type: 'fold' });
  const bb = g.currentActor();
  g.act(bb.id, { type: 'call' });
  g.dealNextStreet();
  g.act(bb.id, { type: 'check' });
  g.act(btn.id, { type: 'raise', amount: 60 });   // C벳
  const ctx = { game: g, diff: H.ai.DIFFICULTY.hard, tracker: null };
  const rBtn = H.ai.inferRange(ctx, btn);
  assert(rBtn.polar === H.ai.TUNE.polarCbet && rBtn.polar > 0, 'C벳 양극 ' + rBtn.polar);
  const rBb = H.ai.inferRange(ctx, bb);
  eq(rBb.polar, 0, '콜한 사람은 양극이 아니다');
});
test('continueRange 는 남는 몫이 작을수록 강한 레인지가 된다', function () {
  const h = hand('Qs Jd').map(C.code), b = hand('Ah 7c 2d').map(C.code);
  const dist = EQ.boardDistribution(b, h);
  const all = EQ.buildCombos({ weights: RG.ACTION_WEIGHTS.any(), keepTop: 1 }, b, h, dist);
  function avgStrength(list) {
    const m = list.meta; let s = 0, n = 0;
    for (let i = 0; i < m.w.length; i++) { if (m.w[i] > 0) { s += m.s[i] * m.w[i]; n += m.w[i]; } }
    return s / n;
  }
  const half = EQ.continueRange(all, 0.5), quarter = EQ.continueRange(all, 0.25);
  assert(avgStrength(quarter) < avgStrength(half) && avgStrength(half) < avgStrength(all),
    [avgStrength(all), avgStrength(half), avgStrength(quarter)].map(function (x) { return x.toFixed(2); }).join(' > '));
  const pre = EQ.buildCombos({ weights: RG.ACTION_WEIGHTS.any(), keepTop: 1 }, [], h, null);
  eq(EQ.continueRange(pre, 0.3), pre, '프리플랍(강도 없음)은 그대로');
});
test('폴드 확률은 상대 레인지의 실제 보드 강도를 본다', function () {
  const h = hand('Qs Jd').map(C.code), b = hand('Ah 7c 2d').map(C.code);
  const dist = EQ.boardDistribution(b, h);
  const wide = EQ.buildCombos({ weights: RG.ACTION_WEIGHTS.any(), keepTop: 1 }, b, h, dist);
  const strong = EQ.continueRange(wide, 0.2);
  const pfWide = EQ.foldProbability(100, 70, { keepTop: 1 }, 1.25, wide);
  const pfStrong = EQ.foldProbability(100, 70, { keepTop: 1 }, 1.25, strong);
  assert(pfStrong < pfWide, '강한 레인지가 덜 접어야 한다 (' + pfWide.toFixed(2) + ' vs ' + pfStrong.toFixed(2) + ')');
});
test('블로커: 내가 에이스를 들면 상대 레인지의 AA 콤보가 줄어든다', function () {
  const w = RG.ACTION_WEIGHTS.threeBet();
  const noAce = EQ.buildCombos({ weights: w, keepTop: 1 }, [], hand('Ks Qd').map(C.code), null);
  const withAce = EQ.buildCombos({ weights: w, keepTop: 1 }, [], hand('As Qd').map(C.code), null);
  function count(list, cls) { let n = 0; for (let i = 0; i < list.length; i += 2) if (RG.classOfCodes(list[i], list[i + 1]) === cls) n++; return n; }
  assert(count(withAce, 'AA') < count(noAce, 'AA'), 'AA 콤보 6 -> 3');
});

console.log('\n[아웃 카운터]');
test('교과서 값과 일치한다', function () {
  function outs(h, b) { return EQ.analyzeDraws(h.split(/\s+/).map(C.parseCard), b.split(/\s+/).map(C.parseCard)).outs; }
  eq(outs('As Kd', 'Qh 7c 2s'), 6, '오버카드 2장 = 6아웃');
  const fd = outs('Ah Kh', 'Qh 7h 2s');
  assert(fd >= 12 && fd <= 15, '플러시 드로우 + 오버카드 = 12~15아웃 (실제 ' + fd + ')');
  eq(outs('As Ad', 'Ah 7c 2s'), 0, '이미 완성된 핸드는 아웃 0');
});
test('드로우 라벨', function () {
  function labels(h, b) { return EQ.analyzeDraws(h.split(/\s+/).map(C.parseCard), b.split(/\s+/).map(C.parseCard)).labels.join(','); }
  assert(labels('Ah Kh', 'Qh 7h 2s').indexOf('플러시') >= 0);
  assert(labels('9s 8s', '7h 6d 2c').indexOf('양차') >= 0);
  assert(labels('As Ad', 'Ah 7c 2s').indexOf('완성') >= 0);
});

console.log('\n[AI 의사결정]');
function makeGame(nPlayers, chips, diff) {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(777) });
  for (let i = 0; i < nPlayers; i++) {
    g.addPlayer({ id: i, name: 'P' + i, chips: chips || 2000, profile: H.ai.PROFILES[1] });
  }
  return g;
}
function forceCards(player, str) { player.cards = str.split(/\s+/).map(C.parseCard); }

test('UTG 에서 72o 는 접고 AA 는 레이즈한다', function () {
  for (let trial = 0; trial < 6; trial++) {
    const g = makeGame(6);
    g.startHand();
    const p = g.currentActor();
    forceCards(p, '7d 2c');
    eq(H.ai.decide(g, p, { difficulty: 'normal' }).type, 'fold', '72o 는 폴드');
    forceCards(p, 'As Ad');
    eq(H.ai.decide(g, p, { difficulty: 'normal' }).type, 'raise', 'AA 는 레이즈');
  }
});
test('AA 는 레이즈에 직면해도 3벳한다', function () {
  const g = makeGame(6);
  g.startHand();
  const opener = g.currentActor();
  g.act(opener.id, { type: 'raise', amount: 60 });
  const p = g.currentActor();
  forceCards(p, 'Ah Ac');
  const d = H.ai.decide(g, p, { difficulty: 'normal' });
  eq(d.type, 'raise');
  assert(d.amount > 60, '3벳 금액이 오픈보다 커야 한다');
});
test('버튼 오픈 레인지가 UTG 보다 넓다', function () {
  function opensFrom(pos) {
    let opens = 0, total = 0;
    const deck = C.makeDeck();
    for (let i = 0; i < 60; i++) {
      const g = makeGame(6);
      g.startHand();
      // 원하는 포지션까지 폴드시킨다
      let guard = 0;
      while (g.phase === 'awaiting-action' && guard++ < 10) {
        const cur = g.currentActor();
        if (RG.positionOf(g.players.indexOf(cur), g.button, 6) === pos) break;
        g.act(cur.id, { type: 'fold' });
      }
      if (g.phase !== 'awaiting-action') continue;
      const p = g.currentActor();
      if (RG.positionOf(g.players.indexOf(p), g.button, 6) !== pos) continue;
      C.shuffle(deck);
      p.cards = [deck[0], deck[1]];
      total++;
      if (H.ai.decide(g, p, { difficulty: 'normal' }).type === 'raise') opens++;
    }
    return total ? opens / total : 0;
  }
  const utg = opensFrom('UTG'), btn = opensFrom('BTN');
  assert(btn > utg, 'BTN ' + (btn * 100).toFixed(0) + '% 가 UTG ' + (utg * 100).toFixed(0) + '% 보다 넓어야 한다');
});
test('숏스택은 푸시 오어 폴드로 전환한다', function () {
  let pushes = 0;
  for (let i = 0; i < 40; i++) {
    const g = makeGame(4, 120);   // 6bb
    g.startHand();
    if (g.phase !== 'awaiting-action') continue;
    const p = g.currentActor();
    forceCards(p, 'As Kh');
    const d = H.ai.decide(g, p, { difficulty: 'normal' });
    if (d.type === 'raise' && d.amount === g.actionsFor(p).maxRaiseTo) pushes++;
  }
  assert(pushes > 25, 'AK 숏스택이면 대부분 올인해야 한다 (실제 ' + pushes + '/40)');
});
test('레인지를 액션에서 역산한다', function () {
  const g = makeGame(6);
  g.startHand();
  const opener = g.currentActor();
  g.act(opener.id, { type: 'raise', amount: 60 });
  const me = g.currentActor();
  const ctx = { game: g, diff: H.ai.DIFFICULTY.normal, tracker: null };
  const r = H.ai.inferRange(ctx, opener);
  assert(r.band.hi < 0.35, '오픈 레이즈한 상대의 레인지는 좁아야 한다 (실제 상위 ' + (r.band.hi * 100).toFixed(0) + '%)');
  const folder = g.players.filter(function (p) { return p !== opener && p !== me; })[0];
  const rf = H.ai.inferRange(ctx, folder);
  assert(rf.band.hi > r.band.hi, '아직 액션하지 않은 상대의 레인지가 더 넓어야 한다');
});

console.log('\n[AI 플레이 스타일 회귀 검사]');
test('봇 통계가 현실적인 범위에 들어온다', function () {
  const BB = 20;
  const g = new H.Game({ smallBlind: BB / 2, bigBlind: BB, rng: H.rng.create(20240101) });
  H.ai.PROFILES.forEach(function (prof, i) {
    g.addPlayer({ id: i, name: prof.key, chips: BB * 100, profile: prof });
  });
  const tracker = H.stats.create({ bigBlind: BB });
  for (let h = 0; h < 300; h++) {
    g.players.forEach(function (p) { p.chips = BB * 100; });
    g.startHand();
    tracker.startHand(g);
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 300) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        const d = H.ai.decide(g, p, { difficulty: 'normal', tracker: tracker });
        const res = g.act(p.id, d);
        assert(res.ok, '봇이 불가능한 액션을 냈다: ' + JSON.stringify(d) + ' / ' + res.error);
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    tracker.endHand(g);
  }
  const all = tracker.all();
  const avgVpip = all.reduce(function (s, x) { return s + x.vpip; }, 0) / all.length;
  const avgPfr = all.reduce(function (s, x) { return s + x.pfr; }, 0) / all.length;
  const avgAf = all.reduce(function (s, x) { return s + x.af; }, 0) / all.length;
  console.log('      (VPIP ' + (avgVpip * 100).toFixed(0) + '% · PFR ' + (avgPfr * 100).toFixed(0) +
    '% · AF ' + avgAf.toFixed(1) + ')');
  // 이전 구현은 VPIP 48~58% / PFR 0~8% 의 루즈-패시브였다
  assert(avgVpip > 0.15 && avgVpip < 0.55, 'VPIP 가 범위를 벗어남: ' + (avgVpip * 100).toFixed(0) + '%');
  assert(avgPfr > 0.12, 'PFR 이 너무 낮음(패시브): ' + (avgPfr * 100).toFixed(0) + '%');
  assert(avgVpip / avgPfr < 2.6, 'VPIP/PFR 비율이 너무 높음(림프 과다): ' + (avgVpip / avgPfr).toFixed(2));
  assert(avgAf > 1.0, 'AF 가 너무 낮음(패시브): ' + avgAf.toFixed(2));

  const tight = all.find(function (x) { return x.name === 'rock'; });
  const loose = all.find(function (x) { return x.name === 'station'; });
  assert(tight.vpip < loose.vpip, '타이트 성향이 콜링스테이션보다 좁아야 한다');
});

test('난이도가 높을수록 강하다 (normal vs easy, 800핸드)', function () {
  const BB = 20, START = BB * 100;
  const g = new H.Game({ smallBlind: BB / 2, bigBlind: BB, rng: H.rng.create(5150) });
  const diffs = ['normal', 'easy', 'normal', 'easy'];
  for (let i = 0; i < 4; i++) g.addPlayer({ id: i, name: diffs[i] + i, chips: START, profile: H.ai.PROFILES[1] });
  const tracker = H.stats.create({ bigBlind: BB });
  const net = [0, 0, 0, 0];
  const hands = 800;
  for (let h = 0; h < hands; h++) {
    g.players.forEach(function (p) { p.chips = START; });
    g.startHand();
    tracker.startHand(g);
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 300) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        g.act(p.id, H.ai.decide(g, p, { difficulty: diffs[g.players.indexOf(p)], tracker: tracker }));
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    tracker.endHand(g);
    g.players.forEach(function (p, i) { net[i] += p.chips - START; });
  }
  const normalBb = (net[0] + net[2]) / BB / (hands * 2) * 100;
  console.log('      (normal ' + (normalBb >= 0 ? '+' : '') + normalBb.toFixed(0) + 'bb/100)');
  assert(normalBb > 10, 'normal 이 easy 를 이겨야 한다 (실제 ' + normalBb.toFixed(0) + 'bb/100)');
});

console.log('\n[TAG 벤치마크]');
/*
 * 고정 규칙 TAG 봇(test/tag-bot.js)을 자로 삼아 난이도별 bb/100 을 잰다.
 * 여기는 안전망이다: 하한은 "이전의 루즈-패시브 구현(-149bb/100)으로 되돌아가지 않는다"
 * 를 지키는 선이고, 800핸드 한 시드의 표준편차가 약 25bb/100 이라 우열은 가리지 못한다.
 * AI 를 고쳤을 때의 진짜 비교는 `npm run bench`(6시드 × 1000핸드)로 한다.
 */
const TAG = require('./tag-bot.js');
const tagBench = {};
test('hard 가 TAG 에게 크게 지지 않는다 (800핸드, 안전망)', function () {
  tagBench.hard = TAG.benchmark({ difficulty: 'hard', hands: 800, seed: 4242 }).bb100;
  console.log('      (hard ' + (tagBench.hard >= 0 ? '+' : '') + tagBench.hard.toFixed(0) + 'bb/100 vs TAG — 정밀 비교는 npm run bench)');
  assert(tagBench.hard > -80, 'hard 가 TAG 에게 너무 진다 (실제 ' + tagBench.hard.toFixed(0) + 'bb/100)');
});
test('normal 이 TAG 에게 크게 지지 않는다 (800핸드, 안전망)', function () {
  tagBench.normal = TAG.benchmark({ difficulty: 'normal', hands: 800, seed: 4242 }).bb100;
  console.log('      (normal ' + (tagBench.normal >= 0 ? '+' : '') + tagBench.normal.toFixed(0) + 'bb/100 vs TAG)');
  assert(tagBench.normal > -90, 'normal 이 TAG 에게 너무 진다 (실제 ' + tagBench.normal.toFixed(0) + 'bb/100)');
});
test('9인 테이블에서도 hard 가 TAG 에게 크게 지지 않는다 (400핸드, 안전망)', function () {
  const r = TAG.benchmark({ difficulty: 'hard', hands: 400, seed: 4242, players: 9 });
  eq(r.players, 9);
  console.log('      (hard 9인 ' + (r.bb100 >= 0 ? '+' : '') + r.bb100.toFixed(0) + 'bb/100 vs TAG — 정밀 비교는 npm run bench:9)');
  assert(r.bb100 > -80, 'hard 가 9인 TAG 에게 너무 진다 (실제 ' + r.bb100.toFixed(0) + 'bb/100)');
  const tags = r.tracker.all().filter(function (x) { return x.name.indexOf('tag') === 0; });
  tags.forEach(function (t) { assert(t.vpip > 0.08 && t.vpip < 0.28, '9인 TAG VPIP 범위 밖: ' + (t.vpip * 100).toFixed(0) + '%'); });
});
test('벤치마크 상대 5종이 규칙 위반 없이 돌고 성향 순서가 맞는다 (VPIP: 락 < TAG < LAG < 스테이션)', function () {
  const vpip = {};
  TAG.STYLES.forEach(function (st) {
    const r = TAG.benchmark({ difficulty: 'normal', hands: 120, seed: 31, style: st });
    const bots = r.tracker.all().filter(function (x) { return x.name.indexOf('tag') === 0; });
    vpip[st] = bots.reduce(function (a, x) { return a + x.vpip; }, 0) / bots.length;
  });
  assert(vpip.rock < vpip.tag && vpip.tag < vpip.lag && vpip.lag < vpip.station,
    JSON.stringify(vpip));
  assert(vpip.balanced > vpip.tag, '밸런스드(솔버 레인지)는 TAG 보다 넓다');
});
test('easy 는 TAG 에게 확실히 진다 (300핸드)', function () {
  tagBench.easy = TAG.benchmark({ difficulty: 'easy', hands: 300, seed: 4242 }).bb100;
  console.log('      (easy ' + tagBench.easy.toFixed(0) + 'bb/100 vs TAG)');
  assert(tagBench.easy < -40, 'easy 가 너무 강하다 — 초급의 의도적 실수가 사라졌나? (실제 ' + tagBench.easy.toFixed(0) + 'bb/100)');
  assert(tagBench.easy < tagBench.normal - 40, 'easy 가 normal 과 구별되지 않는다');
});
test('TAG 봇 자체가 타이트-어그레시브다', function () {
  const tr = TAG.benchmark({ difficulty: 'normal', hands: 200, seed: 99 }).tracker.all();
  const tags = tr.filter(function (x) { return x.name.indexOf('tag') === 0; });
  tags.forEach(function (t) {
    assert(t.vpip > 0.12 && t.vpip < 0.30, 'TAG VPIP 가 범위 밖: ' + (t.vpip * 100).toFixed(0) + '%');
    assert(t.vpip / Math.max(0.01, t.pfr) < 1.7, 'TAG 가 림프한다: VPIP/PFR ' + (t.vpip / t.pfr).toFixed(2));
    assert(t.af > 1.3, 'TAG AF 가 낮다: ' + t.af.toFixed(2));
  });
});

console.log('\n[통계 추적]');
test('VPIP/PFR/폴드율을 정확히 센다', function () {
  const g = makeGame(4);
  const tr = H.stats.create({ bigBlind: 20 });
  g.startHand();
  tr.startHand(g);
  const first = g.currentActor();
  g.act(first.id, { type: 'raise', amount: 60 });     // PFR + VPIP
  const second = g.currentActor();
  g.act(second.id, { type: 'fold' });                  // 폴드 (프리플랍)
  let guard = 0;
  while (g.phase !== 'hand-over' && guard++ < 50) {
    if (g.phase === 'awaiting-action') {
      const a = g.actionsFor(g.currentActor());
      g.act(g.currentActor().id, { type: a.canCheck ? 'check' : 'fold' });
    } else if (g.phase === 'need-street') g.dealNextStreet();
    else if (g.phase === 'showdown') g.resolveShowdown();
  }
  tr.endHand(g);
  const s1 = tr.get(first.id);
  eq(s1.vpip, 1, '레이즈했으므로 VPIP 100%');
  eq(s1.pfr, 1, 'PFR 100%');
  const s2 = tr.get(second.id);
  eq(s2.vpip, 0, '폴드했으므로 VPIP 0%');
  eq(s2.foldToBetPre, 1, '프리플랍 폴드율 100%');
});
test('프리플랍/포스트플랍 폴드율을 분리한다', function () {
  const tr = H.stats.create({ bigBlind: 20 });
  tr.ensure(1, 'X');
  const d = tr.data[1];
  d.hands = 10;
  d.facedBetPre = 8; d.foldedToBetPre = 7;
  d.facedBetPost = 6; d.foldedToBetPost = 2;
  d.facedBet = 14; d.foldedToBet = 9;
  const s = tr.get(1);
  assert(Math.abs(s.foldToBetPre - 0.875) < 0.001);
  assert(Math.abs(s.foldToBetPost - 0.3333) < 0.001);
  assert(s.foldToBetPre > s.foldToBetPost, '두 값이 확실히 구분되어야 한다');
});
test('손익이 제로섬이고 실제 스택 변화와 맞는다', function () {
  /*
   * 예전에는 트래커를 g.startHand() 앞에서 불러서, chipsStart 가
   * '지금 칩 + 지난 핸드에 넣은 돈' 이 됐다. 그러면 매 핸드 손익이 지난 핸드의
   * 투자만큼 깎여, 모두가 지는(bb/100 이 전원 마이너스) 표가 나왔다.
   */
  const BB = 20, START = BB * 100;
  const g = new H.Game({ smallBlind: BB / 2, bigBlind: BB, rng: H.rng.create(4242) });
  for (let i = 0; i < 4; i++) {
    g.addPlayer({ id: i, name: 'P' + i, chips: START, profile: H.ai.PROFILES[1] });
  }
  const tr = H.stats.create({ bigBlind: BB });
  const final = [START, START, START, START];   // 탈락하면 g.players 에서 빠지므로 따로 센다
  for (let h = 0; h < 60 && g.phase !== 'game-over'; h++) {
    g.startHand();
    if (g.phase === 'game-over') break;
    tr.startHand(g);
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 300) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        g.act(p.id, H.ai.decide(g, p, { difficulty: 'normal' }));
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
      else if (g.phase === 'show-choice') g.chooseShow(false);
    }
    tr.endHand(g);
    for (let i = 0; i < 4; i++) {
      const p = g.players.find(function (q) { return q.id === i; });
      final[i] = p ? p.chips : 0;
    }
  }
  let sum = 0, anyWinner = false;
  for (let i = 0; i < 4; i++) {
    const x = tr.get(i);
    sum += x.net;
    eq(x.net, final[i] - START, 'P' + i + ' 의 손익이 실제 스택 변화와 다르다');
    if (x.bb100 > 0) anyWinner = true;
  }
  eq(sum, 0, '손익 합계가 0 이 아니다');
  assert(anyWinner, '이긴 사람이 하나도 없다');
});
test('이름 풀이 넉넉하고 겹치지 않는다', function () {
  /* 이름이 적으면 판마다 섞어도 같은 얼굴이 돌아와, 이름과 성향이 묶인 것처럼 보인다 */
  const names = H.ai.NAMES;
  assert(names.length >= 30, '이름이 너무 적다: ' + names.length);
  eq(names.length, new Set(names).size, '이름 풀에 중복이 있다');
  assert(names.length > H.ai.PROFILES.length * 6,
    '이름 수가 성향 수에 비해 적어 짝이 고정처럼 보인다');
});

test('all() 이 숫자 id 를 그대로 돌려준다 (좌석 색 매칭)', function () {
  /*
   * Object.keys 는 키를 문자열로 바꾼다. all() 이 그걸 쓰면 통계표의
   * order.indexOf(s.id) 가 늘 -1 이 되어, 좌석 색 점이 전부 같은 색으로 찍혔다.
   */
  const tr = H.stats.create({ bigBlind: 20 });
  [0, 1, 2].forEach(function (i) { tr.ensure(i, 'P' + i); });
  const ids = tr.all().map(function (x) { return x.id; });
  ids.forEach(function (id, i) {
    assert(id === i, i + '번 id 가 숫자가 아니다: ' + JSON.stringify(id));
  });
  const back = H.stats.Tracker.fromJSON(JSON.parse(JSON.stringify(tr.toJSON())));
  back.all().forEach(function (x, i) {
    assert(x.id === i, '저장/복원 뒤 id 타입이 바뀌었다: ' + JSON.stringify(x.id));
  });
});

console.log('\n[에쿼티 워커 커널]');
test('워커용 소스가 문법적으로 유효하고 동일한 결과를 낸다', function () {
  const src = 'var makeKernel = ' + H.eval.kernelSource + ';\n' +
    'var K = makeKernel();\n' +
    'var makeSim = ' + H.equity.simKernel.toString() + ';\n' +
    'var S = makeSim(K);\n' +
    'return S;';
  const S = new Function(src)();
  const h = codes('As Kd'), b = codes('Ah 7c 2d');
  const dist = EQ.boardDistribution(b, h);
  const combos = [EQ.buildCombos({ band: RG.band(0, 0.2), keepTop: 1 }, b, h, dist)];
  const req = {
    hole: Int32Array.from(h), board: Int32Array.from(b), boardLen: 3,
    combos: combos, sims: 3000, seed: 999
  };
  const viaWorkerSrc = S.run(req).equity;
  const direct = EQ.vsRanges({ hole: h, board: b, combos: combos, sims: 3000, seed: 999 });
  eq(viaWorkerSrc, direct.equity, '직렬화한 커널이 같은 결과를 내야 한다');
});

console.log('\n[앤티]');
function anteGame(mode, chips, n) {
  const g = new H.Game({
    smallBlind: 10, bigBlind: 20, anteMode: mode, anteFrom: 1,
    levels: [{ level: 1, sb: 10, bb: 20, ante: 5 }], rng: H.rng.create(11)
  });
  for (let i = 0; i < (n || 4); i++) {
    g.addPlayer({ id: i, name: 'P' + i, chips: Array.isArray(chips) ? chips[i] : (chips || 1000) });
  }
  return g;
}
test('전원 앤티: 모두가 내고 팟에 정확히 더해진다', function () {
  const g = anteGame('all');
  g.startHand();
  eq(g.totalPot(), 4 * 5 + 30, '앤티 20 + 블라인드 30');
  g.players.forEach(function (p) { assert(p.totalBet >= 5, p.name + ' 앤티 미납'); });
  eq(g.currentBet, 20, '앤티는 현재 베팅액에 영향을 주지 않는다');
  const bbIdx = (g.button + 2) % 4;
  eq(g.players[bbIdx].bet, 20, 'BB 의 스트리트 베팅은 블라인드만');
});
test('빅블라인드 앤티: BB 만 낸다', function () {
  const g = anteGame('bb');
  g.startHand();
  eq(g.totalPot(), 5 + 30);
  const bbIdx = (g.button + 2) % 4;
  eq(g.players[bbIdx].totalBet, 25, 'BB 는 앤티 5 + 블라인드 20');
});
test('앤티를 낼 칩이 모자라면 올인 처리된다', function () {
  const g = anteGame('all', [3, 1000, 1000, 1000]);
  g.startHand();
  eq(g.players[0].chips, 0);
  eq(g.players[0].allIn, true);
  eq(g.players[0].totalBet, 3);
});
test('앤티가 있어도 칩 총량이 보존된다', function () {
  for (let trial = 0; trial < 20; trial++) {
    const g = anteGame('all', [500, 800, 120, 2000]);
    const before = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
    g.startHand();
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 200) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor(), a = g.actionsFor(p);
        const r = Math.random();
        if (r < 0.25 && a.canRaise) g.act(p.id, { type: 'raise', amount: a.maxRaiseTo });
        else if (r < 0.7) g.act(p.id, { type: a.canCheck ? 'check' : 'call' });
        else g.act(p.id, { type: a.canCheck ? 'check' : 'fold' });
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    eq(g.players.reduce(function (s, p) { return s + p.chips; }, 0), before, '시도 ' + trial);
  }
});

console.log('\n[토너먼트 구조]');
test('블라인드 레벨이 예정대로 오른다', function () {
  const g = new H.Game({ smallBlind: 10, levelEvery: 3, rng: H.rng.create(5) });
  for (let i = 0; i < 3; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 100000 });
  const seen = [];
  for (let h = 0; h < 7; h++) {
    g.startHand();
    seen.push(g.smallBlind + '/' + g.bigBlind);
    let guard = 0;
    while (g.phase !== 'hand-over' && guard++ < 200) {
      if (g.phase === 'awaiting-action') g.act(g.currentActor().id, { type: 'fold' });
      else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
  }
  eq(seen[0], '10/20'); eq(seen[2], '10/20');
  eq(seen[3], '15/30', '4번째 핸드에서 레벨업');
  eq(seen[6], '25/50', '7번째 핸드에서 한 번 더');
});
test('레벨 스케줄이 단조 증가한다', function () {
  const lv = H.tournament.makeLevels(25, 'all', 4);
  for (let i = 1; i < lv.length; i++) {
    assert(lv[i].bb > lv[i - 1].bb, '레벨 ' + (i + 1) + ' 블라인드가 오르지 않음');
    eq(lv[i].bb, lv[i].sb * 2);
  }
  eq(lv[0].ante, 0, '1레벨엔 앤티 없음');
  assert(lv[3].ante > 0, '4레벨부터 앤티');
});
test('탈락 순서가 등수로 기록된다', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(3) });
  g.addPlayer({ id: 0, name: 'Big', chips: 5000 });
  g.addPlayer({ id: 1, name: 'Mid', chips: 300 });
  g.addPlayer({ id: 2, name: 'Small', chips: 100 });
  g.players[1].chips = 0; g.players[1].bustStack = 300;
  g.players[2].chips = 0; g.players[2].bustStack = 100;
  g.startHand();
  // 2명이 탈락하고 마지막 생존자는 1위로 기록된다
  eq(g.finished.length, 3);
  eq(g.finished[0].name, 'Mid', '스택이 컸던 쪽이 상위 등수');
  eq(g.finished[0].place, 2);
  eq(g.finished[1].name, 'Small');
  eq(g.finished[1].place, 3);
  eq(g.finished[2].name, 'Big');
  eq(g.finished[2].place, 1);
  eq(g.phase, 'game-over');
});
test('리바이', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, allowRebuy: true, rebuyChips: 1000, rebuyUntilLevel: 4 });
  g.addPlayer({ id: 0, name: 'A', chips: 0, isHuman: true });
  g.addPlayer({ id: 1, name: 'B', chips: 1000 });
  assert(g.canRebuy(g.players[0]), '칩이 0이면 리바이 가능');
  assert(!g.canRebuy(g.players[1]), '칩이 있으면 불가');
  eq(g.rebuy(0), true);
  eq(g.players[0].chips, 1000);
  eq(g.players[0].rebuys, 1);
});

console.log('\n[ICM]');
test('ICM 지분 합계가 상금 총액과 같다', function () {
  const stacks = [5000, 3000, 1500, 500];
  const pay = [6500, 3500];
  const icm = H.tournament.icmEquity(stacks, pay);
  const sum = icm.reduce(function (a, b) { return a + b; }, 0);
  assert(Math.abs(sum - 10000) < 1, '합계 ' + sum.toFixed(0));
});
test('빅스택의 칩 가치가 희석된다 (ICM 압박)', function () {
  const stacks = [5000, 3000, 1500, 500];
  const pr = H.tournament.icmPressure(stacks, [6500, 3500]);
  assert(pr[0] < 1, '빅스택 칩지분 대비 ' + pr[0].toFixed(2) + ' 은 1 미만이어야 한다');
  assert(pr[3] > 1, '숏스택은 1 초과여야 한다');
  for (let i = 1; i < pr.length; i++) assert(pr[i] > pr[i - 1], '스택이 작을수록 비율이 높다');
});
test('상금이 하나뿐이면 ICM 은 칩 비율과 같다', function () {
  const stacks = [6000, 4000];
  const icm = H.tournament.icmEquity(stacks, [1000]);
  assert(Math.abs(icm[0] - 600) < 1 && Math.abs(icm[1] - 400) < 1, JSON.stringify(icm));
});

console.log('\n[머크 / 쇼]');
function setupShowdown(cardMap, boardStr) {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(9) });
  for (let i = 0; i < 3; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 1000 });
  g.startHand();
  let guard = 0;
  while (g.phase === 'awaiting-action' && guard++ < 20) {
    const a = g.actionsFor(g.currentActor());
    g.act(g.currentActor().id, { type: a.canCheck ? 'check' : 'call' });
  }
  while (g.phase === 'need-street') {
    g.dealNextStreet();
    let gg = 0;
    while (g.phase === 'awaiting-action' && gg++ < 20) {
      const a = g.actionsFor(g.currentActor());
      g.act(g.currentActor().id, { type: a.canCheck ? 'check' : 'call' });
    }
  }
  g.community = boardStr.split(/\s+/).map(C.parseCard);
  Object.keys(cardMap).forEach(function (id) {
    g.byId(+id).cards = cardMap[id].split(/\s+/).map(C.parseCard);
  });
  return g;
}
test('쇼다운에서 이길 수 없는 패는 머크한다', function () {
  const g = setupShowdown({ 0: 'As Ad', 1: '7c 7h', 2: '3c 2h' }, 'Ah Kd 9s 4c 2s');
  eq(g.phase, 'showdown');
  g.resolveShowdown();
  const winner = g.players.find(function (p) { return p.won > 0; });
  eq(winner.id, 0, 'AAA 가 이긴다');
  eq(winner.mucked, false, '승자는 반드시 공개');
  const mucked = g.players.filter(function (p) { return p.mucked; });
  assert(mucked.length >= 1, '진 쪽 중 최소 한 명은 머크해야 한다');
});
test('alwaysShow 면 전부 공개한다', function () {
  const g = setupShowdown({ 0: 'As Ad', 1: '7c 7h', 2: '3c 2h' }, 'Ah Kd 9s 4c 2s');
  g.alwaysShow = true;
  g.resolveShowdown();
  g.players.forEach(function (p) { eq(p.mucked, false, p.name); });
});
test('공개 순서는 마지막 공격자부터', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(77) });
  for (let i = 0; i < 3; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 1000 });
  g.startHand();
  const raiser = g.currentActor();
  g.act(raiser.id, { type: 'raise', amount: 60 });
  let guard = 0;
  while (g.phase === 'awaiting-action' && guard++ < 10) {
    const a = g.actionsFor(g.currentActor());
    g.act(g.currentActor().id, { type: a.canCheck ? 'check' : 'call' });
  }
  eq(g.lastAggressorId, raiser.id);
  const order = g.showdownOrder();
  eq(order[0].id, raiser.id, '마지막 공격자가 먼저 공개');
});
test('무쇼다운 승리 시 사람에게 공개 여부를 묻는다', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, askShowChoice: true, rng: H.rng.create(12) });
  g.addPlayer({ id: 0, name: 'Me', chips: 1000, isHuman: true });
  g.addPlayer({ id: 1, name: 'Bot', chips: 1000 });
  g.startHand();
  // 헤즈업: 버튼(=사람이 아닐 수도 있음)부터. 사람이 아닌 쪽이 폴드하도록 진행
  let guard = 0;
  while (g.phase === 'awaiting-action' && guard++ < 6) {
    const p = g.currentActor();
    if (!p.isHuman) { g.act(p.id, { type: 'fold' }); break; }
    g.act(p.id, { type: 'raise', amount: 60 });
  }
  eq(g.phase, 'show-choice');
  eq(g.showChoicePlayer.id, 0);
  g.chooseShow(true);
  eq(g.phase, 'hand-over');
  eq(g.players.find(function (p) { return p.id === 0; }).mucked, false);
});
test('봇은 무쇼다운 승리 시 자동으로 머크한다', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, askShowChoice: true, rng: H.rng.create(13) });
  g.addPlayer({ id: 0, name: 'Bot1', chips: 1000 });
  g.addPlayer({ id: 1, name: 'Bot2', chips: 1000 });
  g.startHand();
  let guard = 0;
  while (g.phase === 'awaiting-action' && guard++ < 6) g.act(g.currentActor().id, { type: 'fold' });
  eq(g.phase, 'hand-over', '봇은 선택 단계를 거치지 않는다');
});

console.log('\n[액션 클락]');
test('시간 초과 시 체크 가능하면 체크, 아니면 폴드', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, actionClock: 15, rng: H.rng.create(21) });
  for (let i = 0; i < 3; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 1000 });
  g.startHand();
  const p = g.currentActor();
  assert(g.clockRemaining() > 0 && g.clockRemaining() <= 15, '남은 시간 ' + g.clockRemaining());
  g.timeout();
  eq(g.byId(p.id).folded, true, '콜해야 하는 상황이면 폴드');

  // BB 는 체크할 수 있어야 한다
  const g2 = new H.Game({ smallBlind: 10, bigBlind: 20, actionClock: 15, rng: H.rng.create(22) });
  for (let i = 0; i < 3; i++) g2.addPlayer({ id: i, name: 'Q' + i, chips: 1000 });
  g2.startHand();
  let guard = 0;
  const bbIdx = (g2.button + 2) % 3;
  while (g2.phase === 'awaiting-action' && g2.currentActor() !== g2.players[bbIdx] && guard++ < 6) {
    g2.act(g2.currentActor().id, { type: 'call' });
  }
  const bb = g2.currentActor();
  g2.timeout();
  eq(bb.folded, false, 'BB 는 체크로 처리되어야 한다');
});
test('클락이 꺼져 있으면 남은 시간은 null', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20 });
  for (let i = 0; i < 2; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 1000 });
  g.startHand();
  eq(g.clockRemaining(), null);
});

console.log('\n[로그 i18n]');
test('언어를 바꾸면 과거 로그도 함께 바뀐다', function () {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(31) });
  for (let i = 0; i < 3; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 1000 });
  g.startHand();
  g.act(g.currentActor().id, { type: 'fold' });
  const foldEntry = g.log.filter(function (e) { return e.kind === 'fold'; })[0];
  H.i18n.setLang('ko');
  assert(foldEntry.text.indexOf('폴드') >= 0, '한국어: ' + foldEntry.text);
  H.i18n.setLang('en');
  assert(foldEntry.text.indexOf('folds') >= 0, '영어: ' + foldEntry.text);
  H.i18n.setLang('ko');
});

console.log('\n[핸드 리뷰]');
function reviewSetup() {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(101) });
  for (let i = 0; i < 4; i++) {
    g.addPlayer({ id: i, name: 'P' + i, chips: 2000, isHuman: i === 0, profile: H.ai.PROFILES[1] });
  }
  g.startHand();
  let guard = 0;
  while (g.phase === 'awaiting-action' && !g.currentActor().isHuman && guard++ < 10) {
    g.act(g.currentActor().id, H.ai.decide(g, g.currentActor()));
  }
  return g;
}
test('72o 는 폴드가 정답, 콜은 EV 손실', function () {
  const g = reviewSetup();
  const hero = g.currentActor();
  hero.cards = '7d 2c'.split(' ').map(C.parseCard);
  const folded = H.review.evaluate(g, hero, { type: 'fold' }, { difficulty: 'hard' });
  eq(folded.best.type, 'fold', '기준선이 폴드여야 한다');
  eq(folded.verdict, 'good');
  eq(folded.evLoss, 0);
  const called = H.review.evaluate(g, hero, { type: 'call' }, { difficulty: 'hard' });
  assert(called.evLoss > 0, '콜에는 EV 손실이 있어야 한다');
});
test('AA 를 접으면 실수로 판정된다', function () {
  const g = reviewSetup();
  const hero = g.currentActor();
  hero.cards = 'As Ad'.split(' ').map(C.parseCard);
  const r = H.review.evaluate(g, hero, { type: 'fold' }, { difficulty: 'hard' });
  eq(r.best.type, 'raise', 'AA 는 레이즈가 정답');
  assert(r.verdict === 'mistake' || r.verdict === 'blunder', '판정: ' + r.verdict);
  assert(r.evLoss > g.bigBlind, 'EV 손실이 1bb 를 넘어야 한다 (' + r.evLoss.toFixed(1) + ')');
});
test('리뷰 기준선은 블러프 최대 EV 가 아니다', function () {
  // 원시 EV 만 쓰면 폴드 에쿼티 때문에 72o 레이즈가 "정답"으로 나온다
  const g = reviewSetup();
  const hero = g.currentActor();
  hero.cards = '7d 2c'.split(' ').map(C.parseCard);
  const r = H.review.evaluate(g, hero, { type: 'fold' }, { difficulty: 'hard' });
  assert(r.best.type !== 'raise', '72o 로 레이즈를 추천하면 안 된다');
  const rawBest = r.candidates[0];
  assert(rawBest.type === 'raise' || rawBest.ev >= 0, '원시 EV 최대값은 별도로 남아 있어야 한다');
});
test('리뷰는 같은 상황에서 같은 결과를 낸다', function () {
  const g = reviewSetup();
  const hero = g.currentActor();
  hero.cards = 'Kh Qh'.split(' ').map(C.parseCard);
  const a = H.review.evaluate(g, hero, { type: 'call' }, { difficulty: 'hard' });
  const b = H.review.evaluate(g, hero, { type: 'call' }, { difficulty: 'hard' });
  eq(a.best.type, b.best.type, '기준선이 흔들리면 안 된다');
});
test('요약', function () {
  const g = reviewSetup();
  const hero = g.currentActor();
  hero.cards = 'As Ad'.split(' ').map(C.parseCard);
  const bad = H.review.evaluate(g, hero, { type: 'fold' }, { difficulty: 'hard' });
  const good = H.review.evaluate(g, hero, { type: 'raise', amount: 60 }, { difficulty: 'hard' });
  const sum = H.review.summarize([bad, good], 20);
  assert(sum.total > 0);
  assert(sum.worst === bad, '가장 큰 손실이 지목되어야 한다');
  const clean = H.review.summarize([good], 20);
  eq(clean.total, 0);
  assert(clean.text.indexOf('없이') >= 0 || clean.text.indexOf('without') >= 0, clean.text);
});
test('EV 손실 구간별 판정', function () {
  eq(H.review.classify(0.05).verdict, 'good');
  eq(H.review.classify(0.4).verdict, 'ok');
  eq(H.review.classify(1.5).verdict, 'mistake');
  eq(H.review.classify(10).verdict, 'blunder');
});

console.log('\n[핸드 히스토리 / 리플레이]');
function playHands(n, seed) {
  const g = new H.Game({ smallBlind: 10, bigBlind: 20, rng: H.rng.create(seed || 55) });
  for (let i = 0; i < 4; i++) g.addPlayer({ id: i, name: 'P' + i, chips: 3000, profile: H.ai.PROFILES[i % 5] });
  const rec = H.history.create();
  for (let h = 0; h < n; h++) {
    g.startHand();
    if (g.phase === 'game-over') break;
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 300) {
      if (g.phase === 'awaiting-action') g.act(g.currentActor().id, H.ai.decide(g, g.currentActor()));
      else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
    }
    rec.record(g);
  }
  return { g: g, rec: rec };
}
test('핸드가 빠짐없이 기록된다', function () {
  const r = playHands(8);
  eq(r.rec.length(), 8);
  let prevSeats = 5;
  r.rec.hands.forEach(function (h, i) {
    eq(h.no, i + 1);
    assert(h.seats.length >= 2 && h.seats.length <= prevSeats,
      '좌석 수는 줄어들기만 해야 한다 (' + prevSeats + ' -> ' + h.seats.length + ')');
    prevSeats = h.seats.length;
    assert(h.actions.length > 0, '핸드 ' + h.no + ' 에 액션이 없다');
    assert(h.results, '결과가 없다');
  });
});
test('리플레이 스텝의 팟이 단조 증가한다', function () {
  const r = playHands(10);
  r.rec.hands.forEach(function (h) {
    const steps = H.history.buildReplay(h);
    assert(steps.length >= 2, '스텝이 너무 적다');
    eq(steps[0].kind, 'start');
    for (let i = 1; i < steps.length; i++) {
      assert(steps[i].pot >= steps[i - 1].pot - 0.001,
        '핸드 ' + h.no + ' 스텝 ' + i + ': 팟이 줄었다 ' + steps[i - 1].pot + ' -> ' + steps[i].pot);
    }
    const last = steps[steps.length - 1];
    if (h.results) eq(last.kind, 'result');
  });
});
test('리플레이의 보드 카드 수가 스트리트와 맞는다', function () {
  const r = playHands(12);
  const counts = { preflop: 0, flop: 3, turn: 4, river: 5 };
  r.rec.hands.forEach(function (h) {
    H.history.buildReplay(h).forEach(function (s) {
      if (s.kind === 'result') return;
      eq(s.community.length, counts[s.street], '핸드 ' + h.no + ' ' + s.street);
    });
  });
});
test('최종 팟이 실제 팟과 일치한다', function () {
  const r = playHands(12);
  r.rec.hands.forEach(function (h) {
    const steps = H.history.buildReplay(h);
    const lastAction = steps.filter(function (s) { return s.kind !== 'result'; }).pop();
    eq(lastAction.pot, h.pot, '핸드 ' + h.no);
  });
});
test('텍스트 내보내기', function () {
  const r = playHands(3);
  const txt = H.history.toText(r.rec.hands[0]);
  assert(txt.indexOf('핸드 #1') >= 0, txt.slice(0, 40));
  assert(txt.indexOf('[D]') >= 0, '딜러 버튼 표시');
  assert(txt.indexOf('프리플랍') >= 0);
  const all = r.rec.exportAll();
  assert(all.split('===').length - 1 >= 3, '핸드 3개가 모두 들어가야 한다');
});
test('머크한 카드는 기록에 남되 텍스트에서는 가려진다', function () {
  const r = playHands(20);
  const muckedHand = r.rec.hands.filter(function (h) {
    return h.seats.some(function (s) { return s.mucked && !s.isHuman && s.cards.length; });
  })[0];
  if (!muckedHand) return;   // 20핸드 안에 없으면 통과
  const seat = muckedHand.seats.filter(function (s) { return s.mucked && !s.isHuman; })[0];
  eq(seat.cards.length, 2, '기록에는 남아 있어야 리플레이가 가능하다');
  const txt = H.history.toText(muckedHand);
  assert(txt.indexOf('??') >= 0, '텍스트에서는 가려져야 한다');
});
test('JSON 왕복', function () {
  const r = playHands(4);
  const restored = H.history.Recorder.fromJSON(JSON.parse(JSON.stringify(r.rec.toJSON())));
  eq(restored.length(), 4);
  eq(restored.get(0).no, 1);
  eq(H.history.buildReplay(restored.get(0)).length, H.history.buildReplay(r.rec.get(0)).length);
});

console.log('\n[약점 프로파일]');
require('../js/profile.js');
require('../js/drill.js');
function fakeItem(street, spot, pos, lossBb) {
  const verdict = H.review.classify(lossBb).verdict;
  return {
    street: street, spot: spot, position: pos, evLossBb: lossBb, verdict: verdict,
    cards: hand('As Kd'), board: street === 'preflop' ? [] : hand('2c 7d Jh'),
    chosen: { type: 'call', amount: 40 }, best: { type: 'fold', amount: 0 }
  };
}
test('자리 분류: 프리플랍 open / vsOpen / vs3bet', function () {
  const g = makeGame(6);
  g.startHand();
  const p1 = g.currentActor();
  eq(H.review.spotOf(g, p1).spot, 'open');
  g.act(p1.id, { type: 'raise', amount: 60 });
  const p2 = g.currentActor();
  eq(H.review.spotOf(g, p2).spot, 'vsOpen');
  g.act(p2.id, { type: 'raise', amount: 180 });
  const p3 = g.currentActor();
  eq(H.review.spotOf(g, p3).spot, 'vs3bet');
  eq(H.review.spotOf(g, p3).key, 'preflop/vs3bet');
  assert(H.review.spotOf(g, p3).pos, '포지션이 있어야 한다');
});
test('자리 분류: 포스트플랍 cbet / checkedTo / vsBet', function () {
  const g = makeGame(3);
  g.startHand();
  // BTN 오픈, SB 폴드, BB 콜 -> 플랍은 BB 부터
  const btn = g.currentActor();
  g.act(btn.id, { type: 'raise', amount: 60 });
  g.act(g.currentActor().id, { type: 'fold' });
  const bb = g.currentActor();
  g.act(bb.id, { type: 'call' });
  g.dealNextStreet();
  eq(g.street, 'flop');
  eq(g.currentActor(), bb);
  eq(H.review.spotOf(g, bb).spot, 'checkedTo', 'BB 는 어그레서가 아니다');
  g.act(bb.id, { type: 'check' });
  eq(H.review.spotOf(g, btn).spot, 'cbet', '프리플랍 어그레서가 체크를 받으면 C벳 자리');
  g.act(btn.id, { type: 'raise', amount: 60 });
  eq(H.review.spotOf(g, bb).spot, 'vsBet');
});
test('리뷰 항목에 spot 이 붙는다', function () {
  const g = makeGame(6);
  g.startHand();
  const p = g.currentActor();
  const it = H.review.evaluate(g, p, { type: 'fold' }, { difficulty: 'normal' });
  eq(it.spot, 'open');
});
test('결정을 자리·포지션별로 쌓고 약한 자리를 고른다', function () {
  const pr = H.profile.create();
  for (let i = 0; i < 6; i++) pr.addHand([fakeItem('flop', 'vsBet', 'BB', 2.0)]);
  for (let i = 0; i < 6; i++) pr.addHand([fakeItem('preflop', 'open', 'BTN', 0.1)]);
  pr.addHand([fakeItem('river', 'vsBet', 'SB', 9.0)]);   // 표본 1개 — 최대 약점이 되면 안 된다
  eq(pr.decisions, 13);
  eq(pr.hands, 13);
  const w = pr.weakest();
  eq(w[0].key, 'flop/vsBet', '표본이 충분한 자리 중 평균 손실이 큰 곳');
  assert(Math.abs(w[0].avg - 2.0) < 1e-9);
  eq(w[w.length - 1].key === 'river/vsBet' || w[1].key === 'preflop/open', true);
  eq(pr.drillTarget(), 'flop/vsBet');
  const pos = pr.byPosition().filter(function (r) { return r.n > 0; });
  eq(pos.length, 3);
  eq(pr.recent.length, 7, '실수/블런더만 최근 목록에 남는다');
  eq(pr.table().length, 12, '자리 12개가 고정 순서로 나온다');
});
test('표본이 부족하면 드릴 목표가 없다', function () {
  const pr = H.profile.create();
  pr.addHand([fakeItem('turn', 'vsBet', 'BB', 5.0)]);
  eq(pr.drillTarget(), null);
});
test('평균 손실이 "좋은 판단" 경계 아래면 약점이 아니다', function () {
  const pr = H.profile.create();
  for (let i = 0; i < 8; i++) pr.addHand([fakeItem('preflop', 'vsOpen', 'BB', 0.1)]);
  eq(pr.drillTarget(), null);
  eq(pr.weakSpots().length, 0);
  for (let i = 0; i < 8; i++) pr.addHand([fakeItem('flop', 'vsBet', 'BB', 0.5)]);
  eq(pr.drillTarget(), 'flop/vsBet');
});
test('드릴 결과는 실전 통계와 분리된다', function () {
  const pr = H.profile.create();
  for (let i = 0; i < 5; i++) pr.addHand([fakeItem('flop', 'vsBet', 'BB', 1.0)]);
  pr.addDrill('flop/vsBet', 0);
  pr.addDrill('flop/vsBet', 0.5);
  const r = pr.table().filter(function (x) { return x.key === 'flop/vsBet'; })[0];
  eq(r.n, 5); eq(r.drillN, 2);
  assert(Math.abs(r.avg - 1.0) < 1e-9, '드릴이 실전 평균을 바꾸면 안 된다');
  assert(Math.abs(r.drillAvg - 0.25) < 1e-9);
});
test('JSON 왕복', function () {
  const pr = H.profile.create();
  for (let i = 0; i < 3; i++) pr.addHand([fakeItem('flop', 'cbet', 'CO', 0.8)]);
  const back = H.profile.create(JSON.parse(JSON.stringify(pr.toJSON())));
  eq(back.decisions, 3);
  eq(back.table().filter(function (x) { return x.key === 'flop/cbet'; })[0].n, 3);
  eq(back.recent.length, 3);
});

console.log('\n[드릴]');
test('모든 자리를 목표로 문제를 만들 수 있다', function () {
  /* 리버 자리는 시간 예산(2.5초) 안에 못 만날 수 있어 대체 출제가 나온다 — 대부분은 정확하거나 같은 상황이어야 한다 */
  let loose = 0;
  H.profile.allKeys().forEach(function (key) {
    const r = H.drill.generate({ target: key, seed: 77 });
    assert(r, key + ': 생성 실패');
    assert(r.hero.isHuman && r.game.currentActor() === r.hero, key + ': 히어로 차례여야 한다');
    eq(r.game.phase, 'awaiting-action');
    if (r.reached) eq(r.spot.key, key, key + ': 목표 자리');
    else if (r.spot.spot !== key.split('/')[1]) loose++;
  });
  assert(loose <= 2, '같은 상황조차 못 만든 자리가 너무 많다: ' + loose);
});
test('같은 시드면 같은 문제', function () {
  const a = H.drill.generate({ target: 'flop/vsBet', seed: 4242 });
  const b = H.drill.generate({ target: 'flop/vsBet', seed: 4242 });
  eq(a.hero.cards.map(C.cardToString).join(' '), b.hero.cards.map(C.cardToString).join(' '));
  eq(a.game.community.map(C.cardToString).join(' '), b.game.community.map(C.cardToString).join(' '));
});
test('히어로가 늘 버튼에 앉지 않는다', function () {
  const seen = {};
  for (let s = 1; s <= 12; s++) seen[H.drill.generate({ target: 'preflop/open', seed: s }).spot.pos] = true;
  assert(Object.keys(seen).length >= 3, '포지션이 골고루 나와야 한다: ' + Object.keys(seen).join(','));
});
test('채점은 핸드 리뷰와 같은 기준이다', function () {
  const r = H.drill.generate({ target: 'preflop/open', seed: 5 });
  const hero = r.hero;
  hero.cards = hand('7d 2c');
  const bad = H.drill.grade(r.game, hero, { type: 'raise', amount: r.game.actionsFor(hero).minRaiseTo });
  const good = H.drill.grade(r.game, hero, { type: r.game.actionsFor(hero).canCheck ? 'check' : 'fold' });
  assert(bad.evLossBb > good.evLossBb, '72o 레이즈가 폴드보다 손실이 커야 한다');
  assert(bad.explanation, '설명문이 있어야 한다');
  eq(bad.spot, 'open');
  const ses = new H.drill.Session('preflop/open');
  ses.record(bad); ses.record(good);
  eq(ses.asked, 2);
  assert(ses.correct() >= 1);
});

console.log('\n[애드온]');
test('애드온은 리바이 마지막 레벨에 한 번만', function () {
  const g = new H.Game({
    smallBlind: 10, bigBlind: 20, allowRebuy: true,
    rebuyChips: 1000, addonChips: 1500, rebuyUntilLevel: 3, levelEvery: 1
  });
  g.addPlayer({ id: 0, name: 'A', chips: 500, isHuman: true });
  g.addPlayer({ id: 1, name: 'B', chips: 1000 });
  eq(g.canAddon(g.players[0]), false, '초반 레벨에는 불가');
  g.levelIndex = 2;
  eq(g.canAddon(g.players[0]), true, '리바이 마지막 레벨에는 가능');
  eq(g.addon(0), true);
  eq(g.players[0].chips, 2000);
  eq(g.addon(0), false, '두 번은 불가');
  eq(g.canAddon(g.players[0]), false);
});
test('칩이 없으면 애드온이 아니라 리바이 대상', function () {
  const g = new H.Game({
    smallBlind: 10, bigBlind: 20, allowRebuy: true,
    rebuyChips: 1000, addonChips: 1500, rebuyUntilLevel: 3
  });
  g.addPlayer({ id: 0, name: 'A', chips: 0, isHuman: true });
  g.addPlayer({ id: 1, name: 'B', chips: 1000 });
  g.levelIndex = 2;
  eq(g.canAddon(g.players[0]), false);
  eq(g.canRebuy(g.players[0]), true);
});
test('애드온 상태가 저장/복원된다', function () {
  const g = new H.Game({
    smallBlind: 10, bigBlind: 20, seed: 5, rng: H.rng.create(5),
    allowRebuy: true, rebuyChips: 1000, addonChips: 1500, rebuyUntilLevel: 3
  });
  g.addPlayer({ id: 0, name: 'A', chips: 800, isHuman: true });
  g.addPlayer({ id: 1, name: 'B', chips: 1000 });
  g.levelIndex = 2;
  g.addon(0);
  const g2 = H.Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  eq(g2.addonChips, 1500);
  eq(g2.canAddon(g2.players[0]), false, '이미 받았다는 사실이 유지되어야 한다');
});

console.log('\n결과: ' + passed + ' 통과, ' + failed + ' 실패\n');
process.exit(failed ? 1 : 0);
