/*
 * test/e2e.js - 브라우저 엔드투엔드 테스트
 *
 *   npm run test:e2e
 *
 * Playwright 가 없으면 건너뛴다(로컬에서 단위 테스트만 돌려도 되도록).
 * CI 에서는 chromium 을 설치한 뒤 실행한다.
 */
const path = require('path');

let chromium = null;
for (const p of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
  try { chromium = require(p).chromium; break; } catch (e) { /* 다음 후보 */ }
}
if (!chromium) {
  console.log('Playwright 가 없어 E2E 테스트를 건너뜁니다. (npm i -D playwright && npx playwright install chromium)');
  process.exit(0);
}

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let passed = 0, failed = 0;

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

/* 자동 리뷰 모달은 핸드가 끝난 뒤 언제든 뜰 수 있으므로, 클릭 전에 치워 준다 */
async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(function () {
      const m = document.querySelector('.modal.show');
      return m ? m.id : null;
    });
    if (!open || open === 'setupModal' || open === 'overModal') return open;
    if (open === 'reviewModal') await page.click('#btnReviewClose');
    else if (open === 'replayModal') await page.click('#btnReplayClose');
    else return open;
    await page.waitForTimeout(150);
  }
  return null;
}

/* 모달을 치운 뒤 클릭한다 */
async function safeClick(page, selector) {
  await dismissModals(page);
  await page.click(selector);
}

function collectErrors(page, sink) {
  page.on('pageerror', function (e) { sink.push('pageerror: ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error') sink.push('console: ' + m.text()); });
}

/* 자동 플레이: 히어로는 보수적으로 (칩을 오래 유지해 많은 화면을 거치도록) */
async function playHands(page, target, opts) {
  opts = opts || {};
  let hands = 0;
  const deadline = Date.now() + (opts.timeout || 90000);
  while (hands < target && Date.now() < deadline) {
    if (await page.$eval('#overModal', function (e) { return e.classList.contains('show'); })) break;
    if (await page.$eval('#reviewModal', function (e) { return e.classList.contains('show'); })) {
      await page.click('#btnReviewClose');
      continue;
    }
    const st = await page.evaluate(function () {
      const g = window.HoldemUI.game;
      return {
        phase: g.phase,
        hero: !!(g.currentActor() && g.currentActor().isHuman),
        showChoice: g.phase === 'show-choice'
      };
    });
    if (st.showChoice) { await page.click('#btnMuck'); }
    else if (st.phase === 'awaiting-action' && st.hero) {
      const r = Math.random();
      if (r < 0.35) await page.click('#btnFold');
      else await page.click('#btnCall');
    } else if (st.phase === 'hand-over') {
      hands++;
      await page.click('#btnNext');
    }
    await page.waitForTimeout(110);
  }
  return hands;
}

(async function () {
  const browser = await chromium.launch();
  console.log('\n[기본 진행]');
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  collectErrors(page, errors);
  await page.goto(URL);
  await page.waitForSelector('#setupModal.show', { timeout: 10000 });

  await page.selectOption('#optBots', '4');
  await page.selectOption('#optSpeed', '350');
  await page.selectOption('#optChips', '5000');
  await page.selectOption('#optStructure', '10');
  await page.selectOption('#optAnte', 'all');
  await page.fill('#optSeed', 'E2E001');
  await page.click('#btnStart');
  await page.waitForTimeout(600);

  const started = await page.evaluate(function () {
    const g = window.HoldemUI.game;
    return { players: g.players.length, hand: g.handNo, worker: window.Holdem.equity.hasWorker() };
  });
  check('게임이 시작된다 (5인)', started.players === 5 && started.hand === 1, JSON.stringify(started));
  check('에쿼티 워커가 file:// 에서도 뜬다', started.worker === true);

  const hands = await playHands(page, 12);
  check('여러 핸드가 진행된다', hands >= 6, '진행: ' + hands);

  const inv = await page.evaluate(function () {
    const g = window.HoldemUI.game;
    const chips = g.players.reduce(function (s, p) { return s + p.chips; }, 0);
    const pot = g.phase === 'hand-over' ? 0 : g.totalPot();
    return { total: chips + pot, hand: g.handNo, level: g.levelIndex + 1, players: g.players.length };
  });
  check('칩 총량이 보존된다', inv.total + (5 - inv.players) * 0 <= 25000 && inv.total > 0,
    '총 ' + inv.total);
  check('블라인드 레벨이 올라간다', inv.level >= 2, '레벨 ' + inv.level);

  const noScroll = await page.evaluate(function () {
    return document.documentElement.scrollWidth <= window.innerWidth + 1;
  });
  check('가로 스크롤이 생기지 않는다', noScroll);

  console.log('\n[패널]');
  await safeClick(page, '.tab[data-tab="stats"]');
  await page.waitForTimeout(400);
  const stats = await page.evaluate(function () {
    return {
      rows: document.querySelectorAll('.stats-table tbody tr').length,
      chart: !!document.querySelector('.chip-chart path'),
      legend: document.querySelectorAll('.legend-item').length
    };
  });
  check('통계 표에 모든 플레이어가 나온다', stats.rows >= 4, '행 ' + stats.rows);
  check('칩 추이 차트가 그려진다', stats.chart);
  check('시리즈가 2개 이상이면 범례가 있다', stats.legend >= 2, '범례 ' + stats.legend);

  await dismissModals(page);
  const box = await page.locator('.chip-chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  const tipShown = await page.evaluate(function () {
    const t = document.querySelector('.chart-tip');
    return !!t && !t.hidden && t.textContent.length > 0;
  });
  check('차트 호버 툴팁이 뜬다', tipShown);

  await safeClick(page, '.tab[data-tab="chart"]');
  await page.waitForTimeout(300);
  const chart = await page.evaluate(function () {
    return {
      cells: document.querySelectorAll('.range-cell').length,
      inRange: document.querySelectorAll('.range-cell.in').length,
      buttons: document.querySelectorAll('.pos-btn').length
    };
  });
  check('프리플랍 차트가 13x13 이다', chart.cells === 169, '칸 ' + chart.cells);
  check('레인지에 포함된 칸이 표시된다', chart.inRange > 10 && chart.inRange < 169, '포함 ' + chart.inRange);
  check('포지션 버튼 6개', chart.buttons === 6);

  async function rangeSizeAt(index) {
    await safeClick(page, '.pos-btn:nth-child(' + index + ')');
    await page.waitForTimeout(220);
    return page.evaluate(function () { return document.querySelectorAll('.range-cell.in').length; });
  }
  const utgIn = await rangeSizeAt(1);   // UTG
  const btnIn = await rangeSizeAt(4);   // 버튼
  check('UTG 레인지가 버튼보다 좁다', utgIn < btnIn, 'UTG ' + utgIn + ' vs BTN ' + btnIn);
  check('포지션 선택이 유지된다 (내 포지션으로 되돌아가지 않는다)',
    await page.evaluate(function () {
      return document.querySelector('.pos-btn:nth-child(4)').classList.contains('on');
    }));

  console.log('\n[핸드 히스토리와 리플레이]');
  await safeClick(page, '.tab[data-tab="hist"]');
  await page.waitForTimeout(300);
  const histRows = await page.evaluate(function () { return document.querySelectorAll('.hist-row').length; });
  check('히스토리에 핸드가 쌓인다', histRows >= 5, '행 ' + histRows);

  await safeClick(page, '.hist-row');
  await page.waitForTimeout(300);
  const replay1 = await page.evaluate(function () {
    return document.querySelector('.replay-pos').textContent.trim();
  });
  await page.click('.replay-nav button:nth-child(3)');
  await page.waitForTimeout(150);
  const replay2 = await page.evaluate(function () {
    return document.querySelector('.replay-pos').textContent.trim();
  });
  check('리플레이를 앞으로 넘길 수 있다', replay1 !== replay2, replay1 + ' -> ' + replay2);
  await page.click('#btnReplayClose');

  console.log('\n[핸드 리뷰]');
  /* 리뷰 버튼은 핸드가 끝났을 때만 보인다 */
  await safeClick(page, '.tab[data-tab="log"]');
  for (let i = 0; i < 40; i++) {
    const vis = await page.evaluate(function () {
      const b = document.getElementById('btnReview');
      return !!(b.offsetParent) && !document.getElementById('nextRow').classList.contains('hidden');
    });
    if (vis) break;
    if (await page.$eval('#reviewModal', function (e) { return e.classList.contains('show'); })) {
      await page.click('#btnReviewClose');
      continue;
    }
    const st = await page.evaluate(function () {
      const g = window.HoldemUI.game;
      return { phase: g.phase, hero: !!(g.currentActor() && g.currentActor().isHuman) };
    });
    if (st.phase === 'show-choice') await page.click('#btnMuck');
    else if (st.phase === 'awaiting-action' && st.hero) await page.click('#btnCall');
    await page.waitForTimeout(200);
  }
  await page.click('#btnReview');
  await page.waitForTimeout(300);
  const review = await page.evaluate(function () {
    const open = document.getElementById('reviewModal').classList.contains('show');
    return { open: open, rows: document.querySelectorAll('.review-row').length };
  });
  check('리뷰 모달이 열린다', review.open);
  check('리뷰에 결정이 나열된다', review.rows >= 1, '항목 ' + review.rows);
  await page.click('#btnReviewClose');

  console.log('\n[저장과 복원]');
  const before = await page.evaluate(function () {
    const g = window.HoldemUI.game;
    return {
      hand: g.handNo,
      chips: g.players.map(function (p) { return p.chips; }).join(','),
      board: g.community.map(function (c) { return c.rank + c.suit; }).join(',')
    };
  });
  await page.reload();
  await page.waitForSelector('#setupModal.show');
  const hasResume = await page.evaluate(function () { return !document.getElementById('btnResume').hidden; });
  check('이어하기 버튼이 나타난다', hasResume);
  if (hasResume) {
    await page.click('#btnResume');
    await page.waitForTimeout(700);
    const after = await page.evaluate(function () {
      const g = window.HoldemUI.game;
      return {
        hand: g.handNo,
        chips: g.players.map(function (p) { return p.chips; }).join(','),
        board: g.community.map(function (c) { return c.rank + c.suit; }).join(',')
      };
    });
    check('핸드 번호와 칩이 그대로 복원된다',
      after.hand === before.hand && after.chips === before.chips,
      JSON.stringify(before) + ' -> ' + JSON.stringify(after));
    check('보드도 그대로 복원된다', after.board === before.board, before.board + ' -> ' + after.board);
  }

  console.log('\n[언어 전환]');
  await safeClick(page, '#btnMenu');
  await page.waitForSelector('#setupModal.show');
  await page.selectOption('#optLang', 'en');
  await page.waitForTimeout(200);
  const enLabel = await page.evaluate(function () {
    return document.getElementById('btnStart').textContent.trim();
  });
  check('영어로 바뀐다', /start/i.test(enLabel), enLabel);
  await page.selectOption('#optLang', 'ko');
  await page.waitForTimeout(200);

  console.log('\n[접근성]');
  const a11y = await page.evaluate(function () {
    const tabs = document.querySelectorAll('[role="tab"]');
    let labelled = 0;
    document.querySelectorAll('button').forEach(function (b) {
      if ((b.textContent || '').trim() || b.getAttribute('aria-label') || b.title) labelled++;
    });
    return {
      tabs: tabs.length,
      tabsSelected: document.querySelectorAll('[role="tab"][aria-selected]').length,
      dialogs: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
      liveRegions: document.querySelectorAll('[aria-live]').length,
      buttons: document.querySelectorAll('button').length,
      labelled: labelled,
      lang: document.documentElement.lang
    };
  });
  check('탭에 role/aria-selected 가 있다', a11y.tabs === 4 && a11y.tabsSelected === 4);
  check('모달에 role=dialog 가 있다', a11y.dialogs >= 4, '개수 ' + a11y.dialogs);
  check('라이브 리전이 있다', a11y.liveRegions >= 2, '개수 ' + a11y.liveRegions);
  check('모든 버튼에 접근 가능한 이름이 있다', a11y.buttons === a11y.labelled,
    a11y.labelled + '/' + a11y.buttons);

  check('콘솔 에러가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();

  console.log('\n[모바일]');
  for (const [label, vp] of [['세로 390x844', { width: 390, height: 844 }], ['가로 844x390', { width: 844, height: 390 }]]) {
    const mErrors = [];
    const m = await browser.newPage({ viewport: vp, isMobile: true, hasTouch: true });
    collectErrors(m, mErrors);
    await m.goto(URL);
    await m.waitForSelector('#setupModal.show');
    await m.selectOption('#optBots', '3');
    await m.selectOption('#optSpeed', '350');
    await m.click('#btnStart');
    await m.waitForTimeout(500);
    await playHands(m, 3, { timeout: 25000 });
    const ok = await m.evaluate(function () {
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const seats = document.querySelectorAll('.seat').length;
      const felt = document.getElementById('felt').getBoundingClientRect();
      let outside = 0;
      document.querySelectorAll('.seat').forEach(function (s) {
        const r = s.getBoundingClientRect();
        if (r.left < felt.left - 12 || r.right > felt.right + 12) outside++;
      });
      return { overflow: overflow, seats: seats, outside: outside };
    });
    check(label + ' 가로 스크롤 없음', !ok.overflow);
    check(label + ' 좌석이 테이블 밖으로 나가지 않는다', ok.outside === 0, '벗어남 ' + ok.outside);
    check(label + ' 콘솔 에러 없음', mErrors.length === 0, mErrors.slice(0, 2).join(' | '));
    await m.close();
  }

  await browser.close();
  console.log('\nE2E 결과: ' + passed + ' 통과, ' + failed + ' 실패\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error('E2E 실행 오류:', e);
  process.exit(1);
});
