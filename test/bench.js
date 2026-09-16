/*
 * test/bench.js - AI 강도 벤치마크 (다중 시드)
 *
 *   npm run bench            # 4인: normal, hard × 6시드 × 1000핸드 (약 70초)
 *   npm run bench:9          # 9인: normal, hard × 6시드 × 500핸드
 *   node test/bench.js hard 4 600 9     # 난이도 · 시드 수 · 핸드 수 · 인원
 *
 * 고정 규칙 TAG 봇(test/tag-bot.js)을 상대로 한 bb/100 의 평균과 표준오차를 낸다.
 * AI 가 난수를 쓰는 횟수가 바뀌면 이후 카드도 전부 달라지므로 "같은 시드 = 같은 카드"가
 * 아니다. 그래서 단일 시드 수치는 표본 하나일 뿐이고, AI 를 고쳤을 때는 이 스크립트로
 * 평균을 비교해야 한다. 단위 테스트의 하한은 큰 퇴행만 잡는 안전망이다.
 */
const B = require('./tag-bot.js');

const diffs = process.argv[2] ? process.argv[2].split(',') : ['normal', 'hard'];
const nSeeds = parseInt(process.argv[3], 10) || 6;
const hands = parseInt(process.argv[4], 10) || 1000;
const players = parseInt(process.argv[5], 10) || 4;

diffs.forEach(function (d) {
  const rs = [];
  const t0 = Date.now();
  for (let s = 1; s <= nSeeds; s++) rs.push(B.benchmark({ difficulty: d, hands: hands, seed: s * 1000 + 7, players: players }).bb100);
  const mean = rs.reduce(function (a, b) { return a + b; }, 0) / rs.length;
  const sd = rs.length > 1
    ? Math.sqrt(rs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rs.length - 1))
    : 0;
  console.log(
    d.padEnd(7) + (mean >= 0 ? '+' : '') + mean.toFixed(1) + ' bb/100 vs TAG (' + players + '인)' +
    '  (±' + (sd / Math.sqrt(rs.length)).toFixed(1) + ' se, ' + nSeeds + '×' + hands + 'h, ' +
    ((Date.now() - t0) / 1000).toFixed(0) + 's)  ' +
    rs.map(function (x) { return (x >= 0 ? '+' : '') + x.toFixed(0); }).join(' ')
  );
});
