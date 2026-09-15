/*
 * 의존성 없는 테스트 러너:  node test/run-tests.js
 */
const H = require('../js/engine.js');
require('../js/ai.js');
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

console.log('\n결과: ' + passed + ' 통과, ' + failed + ' 실패\n');
process.exit(failed ? 1 : 0);
