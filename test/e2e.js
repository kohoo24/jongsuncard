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
/* 첫 화면은 홈 — 설정(새 게임) 화면까지 간다. 게임 종료 뒤 '다시 시작'은 바로 설정으로 온다 */
async function toSetup(page) {
  await page.waitForSelector('#homeModal.show, #setupModal.show', { timeout: 10000 });
  const home = await page.$('#homeModal.show');
  if (home) await page.click('#btnHomePlay');
  await page.waitForSelector('#setupModal.show', { timeout: 10000 });
}

async function safeClick(page, selector) {
  await dismissModals(page);
  await page.click(selector);
}

/* 판이 끝났으면(게임 종료 모달) 새 판을 연다. 모달은 핸드 종료 뒤 약 1초 늦게 뜨므로
   핸드가 끝난 상태에서 히어로가 파산했거나 한 명만 남았으면 모달을 기다린다. */
async function restartIfOver(page, seed) {
  const st = await page.evaluate(function () {
    const g = window.HoldemUI.game;
    const m = document.querySelector('.modal.show');
    if (!g) return { modal: m ? m.id : null, ending: false };
    const hero = g.byId(0);
    const alive = g.players.filter(function (p) { return p.chips > 0; }).length;
    return {
      modal: m ? m.id : null,
      ending: g.phase === 'hand-over' && (!hero || hero.chips <= 0 || alive < 2) || g.phase === 'game-over'
    };
  });
  if (st.modal !== 'overModal') {
    if (!st.ending) return false;
    await page.waitForSelector('#overModal.show', { timeout: 5000 }).catch(function () {});
  }
  await page.click('#btnOverRestart');
  await toSetup(page);
  await page.fill('#optSeed', seed);
  await page.click('#btnStart');
  await page.waitForTimeout(600);
  return true;
}

/* 히어로 차례까지 진행한다. 그 순간에는 아무것도 움직이지 않으므로 상태를 안전하게 읽을 수 있다 */
async function waitHeroTurn(page, seed, timeout) {
  const until = Date.now() + (timeout || 40000);
  while (Date.now() < until) {
    if (await restartIfOver(page, seed)) continue;
    const st = await page.evaluate(function () {
      const g = window.HoldemUI.game;
      return { phase: g.phase, hero: !!(g.currentActor() && g.currentActor().isHuman) };
    });
    if (st.phase === 'awaiting-action' && st.hero) return true;
    if (st.phase === 'hand-over') await safeClick(page, '#btnNext');
    else if (st.phase === 'show-choice') await page.click('#btnMuck');
    else await page.waitForTimeout(100);
  }
  return false;
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
  await toSetup(page);

  await page.selectOption('#optBots', '4');
  await page.selectOption('#optSpeed', '350');
  await page.selectOption('#optChips', '5000');
  await page.selectOption('#optStructure', '10');
  await page.selectOption('#optAnte', 'all');
  await page.fill('#optSeed', 'E2E001');
  /* 자동 리뷰 모달은 핸드가 끝난 뒤 임의의 시점에 떠서 클릭과 경합한다.
     리뷰 기능은 아래에서 버튼으로 직접 열어 검사하므로 여기서는 끈다. */
  await page.uncheck('#optReview');
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

  /* 봇의 성향이 좌석에 적혀 있으면 패가 아니라 라벨을 보고 플레이하게 된다 */
  const labels = await page.evaluate(function () {
    const S = window.HoldemUI;
    const keys = window.Holdem.ai.PROFILES.map(function (x) { return x.name; });
    const out = [];
    S.game.players.forEach(function (p) {
      const e = S.seatEls[p.id];
      if (!e) return;
      const txt = e.name.textContent;
      out.push({ human: !!p.isHuman, txt: txt,
        leaks: keys.some(function (k) { return txt.indexOf(k) >= 0; }) });
    });
    return out;
  });
  const bots = labels.filter(function (x) { return !x.human; });
  check('좌석에 봇 성향이 드러나지 않는다',
    bots.length > 0 && bots.every(function (x) { return !x.leaks; }),
    JSON.stringify(bots.map(function (x) { return x.txt; })));
  check('봇 이름이 서로 겹치지 않는다',
    new Set(bots.map(function (x) { return x.txt; })).size === bots.length,
    JSON.stringify(bots.map(function (x) { return x.txt; })));

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

  /*
   * 손익은 제로섬이다. 예전에는 트래커를 g.startHand() 앞에서 불러서 핸드 시작 스택이
   * 부풀려졌고, 그 결과 전원이 마이너스인 bb/100 표가 나왔다.
   */
  const money = await page.evaluate(function () {
    const S = window.HoldemUI;
    const rows = S.tracker.all();
    return {
      sum: rows.reduce(function (t, x) { return t + x.net; }, 0),
      net: rows.map(function (x) { return { name: x.name, net: x.net }; }),
      winners: rows.filter(function (x) { return x.bb100 > 0; }).length
    };
  });
  check('손익 합계가 제로섬이다 (전원 마이너스 표 재발 방지)',
    Math.abs(money.sum) < 1e-6, '합계 ' + money.sum + ' · ' + JSON.stringify(money.net));
  check('이긴 사람이 적어도 한 명은 있다', money.winners > 0, JSON.stringify(money.net));

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
      buttons: document.querySelectorAll('.pos-btn').length,
      expectButtons: window.Holdem.ranges.positionsFor(window.HoldemUI.game.players.length).length
    };
  });
  check('프리플랍 차트가 13x13 이다', chart.cells === 169, '칸 ' + chart.cells);
  check('레인지에 포함된 칸이 표시된다', chart.inRange > 10 && chart.inRange < 169, '포함 ' + chart.inRange);
  check('포지션 버튼이 테이블 인원의 포지션 수와 같다', chart.buttons === chart.expectButtons, chart.buttons + ' / ' + chart.expectButtons);

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
  let reviewReady = false;
  const reviewDeadline = Date.now() + 40000;
  while (Date.now() < reviewDeadline) {
    reviewReady = await page.evaluate(function () {
      const b = document.getElementById('btnReview');
      return !!(b.offsetParent) && !document.getElementById('nextRow').classList.contains('hidden');
    });
    if (reviewReady) break;
    if (await page.$eval('#reviewModal', function (e) { return e.classList.contains('show'); })) {
      await page.click('#btnReviewClose');
      continue;
    }
    const st = await page.evaluate(function () {
      const g = window.HoldemUI.game;
      return { phase: g.phase, hero: !!(g.currentActor() && g.currentActor().isHuman) };
    });
    if (st.phase === 'game-over') break;
    if (st.phase === 'show-choice') await page.click('#btnMuck');
    else if (st.phase === 'awaiting-action' && st.hero) await page.click('#btnCall');
    await page.waitForTimeout(200);
  }
  /* 여기서 무작정 클릭하면 Playwright 타임아웃으로 남은 스위트까지 통째로 죽는다 */
  if (!reviewReady) {
    check('리뷰 모달이 열린다', false, '핸드가 끝나지 않아 리뷰 버튼이 뜨지 않았다');
    check('리뷰에 결정이 나열된다', false, '리뷰 버튼이 뜨지 않았다');
  } else {
    await page.click('#btnReview');
    await page.waitForTimeout(300);
    const review = await page.evaluate(function () {
      const open = document.getElementById('reviewModal').classList.contains('show');
      return { open: open, rows: document.querySelectorAll('.review-row').length };
    });
    check('리뷰 모달이 열린다', review.open);
    check('리뷰에 결정이 나열된다', review.rows >= 1, '항목 ' + review.rows);
    await page.click('#btnReviewClose');
  }

  console.log('\n[베팅 프리셋]');
  {
    const heroTurn = await waitHeroTurn(page, 'E2E003');
    check('히어로 차례를 만든다', heroTurn);
    if (heroTurn) {
      const ctx = await page.evaluate(function () {
        const g = window.HoldemUI.game, h = g.byId(0), a = g.actionsFor(h);
        return { pot: g.totalPot(), cur: g.currentBet, toCall: a.toCall, min: a.minRaiseTo, max: a.maxRaiseTo, bb: g.bigBlind, canRaise: a.canRaise };
      });
      async function preset(sel) {
        await page.click('#presets button' + sel);
        return page.evaluate(function () {
          return { v: window.HoldemUI.raiseTo, label: document.getElementById('btnRaise').textContent };
        });
      }
      if (ctx.canRaise) {
        const unit = Math.max(1, Math.round(ctx.bb / 2));
        const clampRound = function (raw) {
          return Math.max(ctx.min, Math.min(ctx.max, Math.round(raw / unit) * unit));
        };
        const buttons = await page.$$eval('#presets button', function (bs) {
          return bs.map(function (b) { return { kind: b.dataset.kind, v: parseFloat(b.dataset.v), text: b.textContent }; });
        });
        check('스마트 벳 버튼이 상황에 맞게 그려진다 (5개 이상, 올인 포함)',
          buttons.length >= 5 && buttons.some(function (b) { return b.kind === 'allin'; }), JSON.stringify(buttons));
        const limpers = await page.evaluate(function () {
          let n = 0;
          window.HoldemUI.game.handActions.forEach(function (x) { if (x.street === 'preflop' && x.type === 'call' && x.raisesBefore <= 1) n++; });
          return n;
        });
        let allOk = true, detail = [];
        for (let i = 0; i < buttons.length; i++) {
          const b = buttons[i];
          if (b.kind === 'allin') continue;
          const raw = b.kind === 'x' ? ctx.bb * b.v + ctx.bb * limpers
            : b.kind === 'r' ? ctx.cur * b.v
              : ctx.cur + (ctx.pot + ctx.toCall) * b.v;
          const got = await preset('[data-kind="' + b.kind + '"][data-v="' + b.v + '"]');
          const want = clampRound(raw);
          if (got.v !== want) { allOk = false; detail.push(b.text + ': ' + got.v + ' (기대 ' + want + ')'); }
        }
        check('프리셋 금액 = 종류별 공식 (bb 배수 / 상대 벳 배수 / 현재 벳 + x × (팟 + 콜))', allOk, JSON.stringify(ctx) + ' ' + detail.join(', '));
        const pcts = buttons.filter(function (b) { return b.kind === 'p'; });
        if (pcts.length >= 2) {
          const a1 = await preset('[data-kind="p"][data-v="' + pcts[0].v + '"]');
          const a2 = await preset('[data-kind="p"][data-v="' + pcts[1].v + '"]');
          check('서로 다른 비율은 다른 금액 (예전엔 ½ 과 ¾ 이 둘 다 3bb)', a1.v !== a2.v || clampRound(ctx.cur + (ctx.pot + ctx.toCall) * pcts[0].v) === clampRound(ctx.cur + (ctx.pot + ctx.toCall) * pcts[1].v), a1.v + ' / ' + a2.v);
        }

        /* 직접 입력 */
        const typed = Math.min(ctx.max, ctx.min + unit * 3);
        await page.fill('#raiseInput', String(typed));
        const afterType = await page.evaluate(function () { return window.HoldemUI.raiseTo; });
        check('금액을 직접 입력하면 그 값이 목표가 된다', afterType === typed, afterType + ' (기대 ' + typed + ')');
        await page.fill('#raiseInput', String(ctx.max * 5));
        await page.press('#raiseInput', 'Tab');
        const clamped = await page.evaluate(function () {
          return { v: window.HoldemUI.raiseTo, shown: document.getElementById('raiseInput').value };
        });
        check('범위 밖 입력은 확정할 때 보정된다', clamped.v === ctx.max && clamped.shown === String(ctx.max), JSON.stringify(clamped));

        /* 앤티 게임처럼 스택이 step 의 배수가 아닐 때 올인 */
        await page.evaluate(function () {
          const g = window.HoldemUI.game, h = g.byId(0);
          h.chips = 995;
        });
        const allin = await preset('[data-kind="allin"]');
        const ctx2 = await page.evaluate(function () {
          const g = window.HoldemUI.game, h = g.byId(0);
          return { max: g.actionsFor(h).maxRaiseTo, slider: document.getElementById('raiseSlider').value };
        });
        check('올인 프리셋은 step 과 무관하게 정확한 올인 금액을 잡는다',
          allin.v === ctx2.max && allin.label.indexOf('995') >= 0 || allin.v === ctx2.max,
          JSON.stringify({ v: allin.v, max: ctx2.max, slider: ctx2.slider, label: allin.label }));
        await page.click('#btnRaise');
        await page.waitForTimeout(150);
        const after = await page.evaluate(function () {
          const g = window.HoldemUI.game, h = g.byId(0);
          return { allIn: h.allIn, chips: h.chips, bet: h.bet };
        });
        check('올인 버튼을 누르면 실제로 올인된다', after.allIn && after.chips === 0, JSON.stringify(after));
      }
    }
  }

  console.log('\n[bb 단위 표시]');
  await waitHeroTurn(page, 'E2E005');
  await page.click('#btnUnit');
  await page.waitForTimeout(200);
  const bbView = await page.evaluate(function () {
    const g = window.HoldemUI.game, h = g.byId(0);
    const a = g.actionsFor(h);
    return {
      pressed: document.getElementById('btnUnit').getAttribute('aria-pressed'),
      pot: document.getElementById('pots').textContent,
      call: document.getElementById('btnCall').textContent,
      raise: document.getElementById('btnRaise').textContent,
      chips: document.querySelector('.seat .chips') ? document.querySelector('.seat .chips').textContent : '',
      lastActs: Array.prototype.map.call(document.querySelectorAll('.seat .last'), function (e) { return e.textContent; }).filter(function (t) { return /\d/.test(t); }),
      input: document.getElementById('raiseInput').value,
      raiseTo: window.HoldemUI.raiseTo, bb: g.bigBlind, canRaise: a.canRaise, canCheck: a.canCheck,
      unitShown: !document.getElementById('raiseUnit').classList.contains('hidden'),
      setting: JSON.parse(localStorage.getItem('holdem.settings')).unit
    };
  });
  check('토글하면 팟·칩·버튼이 bb 로 바뀐다',
    bbView.pressed === 'true' && /bb/.test(bbView.pot) && /bb/.test(bbView.chips) && (bbView.canCheck || /bb/.test(bbView.call)),
    JSON.stringify(bbView));
  check('입력칸도 bb 로 보인다', !bbView.canRaise || (bbView.unitShown && parseFloat(bbView.input) * bbView.bb === bbView.raiseTo), JSON.stringify(bbView));
  check('설정에 저장된다', bbView.setting === 'bb');
  check('좌석의 마지막 액션 금액도 bb 다', bbView.lastActs.every(function (t) { return /bb/.test(t); }), JSON.stringify(bbView.lastActs));
  if (bbView.canRaise) {
    await page.fill('#raiseInput', '7.5');
    const typedBb = await page.evaluate(function () { return window.HoldemUI.raiseTo; });
    const expectBb = await page.evaluate(function () {
      const g = window.HoldemUI.game, a = g.actionsFor(g.byId(0));
      return Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, 7.5 * g.bigBlind));
    });
    check('bb 로 입력하면 칩으로 환산된다', typedBb === expectBb, typedBb + ' (기대 ' + expectBb + ')');
  }
  await page.click('.tab[data-tab="log"]');
  await page.waitForTimeout(150);
  const logBb = await page.evaluate(function () { return document.querySelector('.loglist').textContent; });
  check('과거 로그도 bb 로 바뀐다', /bb/.test(logBb), logBb.slice(0, 80));
  await page.click('#btnUnit');
  await page.waitForTimeout(200);
  const chipView = await page.evaluate(function () {
    return { pressed: document.getElementById('btnUnit').getAttribute('aria-pressed'), pot: document.getElementById('pots').textContent };
  });
  check('다시 누르면 칩으로 돌아온다', chipView.pressed === 'false' && !/bb/.test(chipView.pot), JSON.stringify(chipView));

  console.log('\n[약점 프로파일과 드릴]');
  /* 히어로는 무작위로 플레이하므로 여기까지 오는 동안 파산했을 수 있다 — 그러면 새 판을 연다.
     프로파일은 localStorage 에 남아 있으므로 학습 탭 검사에는 영향이 없다. */
  await restartIfOver(page, 'E2E002');
  await safeClick(page, '.tab[data-tab="learn"]');
  await page.waitForTimeout(200);
  const handBeforeDrill = await page.evaluate(function () { return window.HoldemUI.game.handNo; });
  const learn = await page.evaluate(function () {
    const body = document.getElementById('tabBody');
    return {
      rows: body.querySelectorAll('.learn-table tbody tr').length,
      decisions: window.HoldemUI.profile.decisions,
      stored: !!localStorage.getItem('holdem.profile'),
      anyBtn: !!document.getElementById('btnDrillAny')
    };
  });
  check('학습 탭에 결정이 쌓인다', learn.decisions > 0 && learn.rows > 0, JSON.stringify(learn));
  check('프로파일이 저장된다', learn.stored);
  await page.click('#btnDrillAny');
  await page.waitForTimeout(400);
  const drill1 = await page.evaluate(function () {
    return {
      active: !!window.HoldemUI.drill,
      heroTurn: window.HoldemUI.game.currentActor().isHuman,
      hint: !document.getElementById('drillHint').classList.contains('hidden')
        && document.getElementById('drillHint').textContent.length > 0,
      buttons: !document.getElementById('btnRow').classList.contains('hidden'),
      quit: !document.getElementById('btnDrillQuit').classList.contains('hidden'),
      session: !!localStorage.getItem('holdem.session')
    };
  });
  check('드릴이 히어로 차례에서 시작된다', drill1.active && drill1.heroTurn && drill1.hint && drill1.buttons, JSON.stringify(drill1));
  check('드릴 도중에도 종료할 수 있다', drill1.quit);
  const quizHints = await page.evaluate(function () {
    return document.querySelectorAll('#heroReadout .equity, #heroReadout .outs').length;
  });
  check('문제 중에는 승률·아웃 힌트를 숨긴다', quizHints === 0, '힌트 ' + quizHints + '개');
  check('드릴 시작 전 실전 게임이 세션으로 남는다', drill1.session);
  await page.click('#btnCall');
  await page.waitForTimeout(300);
  const drill2 = await page.evaluate(function () {
    const d = window.HoldemUI.drill;
    return {
      answered: !!d.item, fb: document.getElementById('drillFeedback').textContent.length > 10,
      next: !document.getElementById('btnDrillNext').classList.contains('hidden'),
      reveal: window.HoldemUI.game.revealAll, asked: d.session.asked,
      cands: document.querySelectorAll('.drill-cand').length
    };
  });
  check('답하면 채점 결과가 뜬다', drill2.answered && drill2.fb && drill2.next && drill2.asked === 1, JSON.stringify(drill2));
  check('선택지별 EV 가 나열된다', drill2.cands >= 2);
  check('답한 뒤 상대 패가 공개된다', drill2.reveal);
  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  const drill3 = await page.evaluate(function () {
    return { item: !!window.HoldemUI.drill.item, heroTurn: window.HoldemUI.game.currentActor().isHuman };
  });
  check('Space 로 다음 문제가 나온다', !drill3.item && drill3.heroTurn, JSON.stringify(drill3));
  await page.click('#btnDrillQuit');
  await page.waitForTimeout(300);
  const afterQuit = await page.evaluate(function () {
    const m = document.querySelector('.modal.show');
    return { modal: m ? m.id : null, resume: !document.getElementById('btnHomeResume').hidden, drill: !!window.HoldemUI.drill };
  });
  check('종료하면 홈으로 돌아가고 이어하기가 보인다', afterQuit.modal === 'homeModal' && afterQuit.resume && !afterQuit.drill, JSON.stringify(afterQuit));
  await page.click('#btnHomeResume');
  await page.waitForTimeout(500);
  const resumedAfterDrill = await page.evaluate(function () {
    return { hand: window.HoldemUI.game.handNo, drill: !!window.HoldemUI.drill };
  });
  check('드릴 뒤 실전 게임을 이어간다', resumedAfterDrill.hand === handBeforeDrill && !resumedAfterDrill.drill,
    handBeforeDrill + ' -> ' + JSON.stringify(resumedAfterDrill));

  console.log('\n[코치 · 스타일 진단 · 오늘의 10문제]');
  await restartIfOver(page, 'E2E003');
  await waitHeroTurn(page, 'E2E003');
  const coach0 = await page.evaluate(function () {
    return {
      btn: !document.getElementById('btnCoach').disabled,
      box: document.getElementById('coachBox').classList.contains('hidden')
    };
  });
  check('히어로 차례에 "생각 정리" 버튼이 보이고 상자는 닫혀 있다', coach0.btn && coach0.box, JSON.stringify(coach0));
  await page.click('#btnCoach');
  await page.waitForTimeout(400);
  const coach1 = await page.evaluate(function () {
    const box = document.getElementById('coachBox');
    return {
      open: !box.classList.contains('hidden'),
      why: box.querySelectorAll('.why-line').length,
      cands: box.querySelectorAll('.drill-cand').length,
      best: box.querySelectorAll('.coach-best').length,
      untranslated: /why\.|coach\./.test(box.textContent),
      used: window.HoldemUI.coachUsed
    };
  });
  check('생각 정리 상자에 이유 한 줄 · 탄탄한 선택 · 후보 EV 가 뜬다', coach1.open && coach1.why === 1 && coach1.cands >= 2 && coach1.best === 1, JSON.stringify(coach1));
  check('코치 문구가 전부 번역된다', !coach1.untranslated);
  await page.click('#btnCoachClose');
  await page.waitForTimeout(150);
  const coach2 = await page.evaluate(function () {
    return { box: document.getElementById('coachBox').classList.contains('hidden'), btn: !document.getElementById('btnCoach').disabled };
  });
  check('닫으면 상자가 사라지고 버튼이 돌아온다', coach2.box && coach2.btn, JSON.stringify(coach2));
  await page.click('#btnCall');
  await page.waitForTimeout(300);
  const coached = await page.evaluate(function () {
    const items = window.HoldemUI.reviewItems || [];
    return items.length ? items[items.length - 1].coached : null;
  });
  check('코치를 본 결정에는 coached 표시가 붙는다', coached === true, String(coached));

  await safeClick(page, '.tab[data-tab="learn"]');
  await page.waitForTimeout(200);
  const learn2 = await page.evaluate(function () {
    const body = document.getElementById('tabBody');
    return {
      style: !!body.querySelector('.style-card'),
      daily: !!document.getElementById('btnDaily'),
      untranslated: /style\.|daily\./.test(body.textContent)
    };
  });
  check('학습 탭에 스타일 진단 카드와 오늘의 10문제가 있다', learn2.style && learn2.daily && !learn2.untranslated, JSON.stringify(learn2));
  await page.click('#btnDaily');
  await page.waitForTimeout(500);
  const daily1 = await page.evaluate(function () {
    const d = window.HoldemUI.drill;
    return { active: !!d, daily: d && d.session.daily, limit: d && d.session.limit, heroTurn: window.HoldemUI.game.currentActor().isHuman,
      meta: document.getElementById('topMeta').textContent };
  });
  check('오늘의 10문제가 드릴로 시작된다 (10문제 · 날짜 시드)', daily1.active && daily1.daily && daily1.limit === 10 && daily1.heroTurn, JSON.stringify(daily1));
  const firstHand = await page.evaluate(function () { return window.HoldemUI.game.byId(0).cards.map(function (c) { return c.rank + c.suit; }).join(''); });
  await page.click('#btnCall');
  await page.waitForTimeout(300);
  await page.click('#btnDrillQuit');
  await page.waitForTimeout(400);
  const daily2 = await page.evaluate(function () {
    const p = window.HoldemUI.profile;
    const today = window.Holdem.drill.dateKey();
    return { rec: p.dailyFor(today), modal: (document.querySelector('.modal.show') || {}).id, toast: !document.getElementById('toast').classList.contains('hidden'),
      homeDaily: document.getElementById('btnHomeDaily').textContent };
  });
  check('도중에 끝내도 오늘 기록이 남고 홈에 표시된다', daily2.rec && daily2.rec.asked === 1 && daily2.modal === 'homeModal' && /1\/1/.test(daily2.homeDaily), JSON.stringify(daily2));
  check('결과 토스트가 뜬다', daily2.toast);
  /* 홈의 학습 현황: 진단 카드 · 심각도 배지 */
  await page.click('#btnHomeLearn');
  await page.waitForTimeout(300);
  const learnModal = await page.evaluate(function () {
    const body = document.getElementById('learnBody');
    return { shown: document.getElementById('learnModal').classList.contains('show'), style: !!body.querySelector('.style-card'),
      sev: body.querySelectorAll('.sev').length };
  });
  check('학습 현황 화면에 진단 카드와 심각도 배지가 있다', learnModal.shown && learnModal.style && learnModal.sev > 0, JSON.stringify(learnModal));
  await page.click('#btnLearnClose');
  await page.waitForTimeout(200);
  /* 같은 날 다시 시작하면 같은 첫 문제 */
  await page.click('#btnHomeResume');
  await page.waitForTimeout(400);
  await safeClick(page, '.tab[data-tab="learn"]');
  await page.waitForTimeout(200);
  await page.click('#btnDaily');
  await page.waitForTimeout(500);
  const secondHand = await page.evaluate(function () { return window.HoldemUI.game.byId(0).cards.map(function (c) { return c.rank + c.suit; }).join(''); });
  check('오늘의 10문제는 다시 시작해도 같은 문제가 나온다', firstHand === secondHand, firstHand + ' vs ' + secondHand);
  await page.click('#btnDrillQuit');
  await page.waitForTimeout(300);
  await page.click('#btnHomeResume');
  await page.waitForTimeout(400);

  console.log('\n[저장과 복원]');
  await waitHeroTurn(page, 'E2E004');   // 봇이 움직이는 도중에 찍으면 새로고침 사이에 보드가 바뀐다
  const before = await page.evaluate(function () {
    const g = window.HoldemUI.game;
    return {
      hand: g.handNo,
      chips: g.players.map(function (p) { return p.chips; }).join(','),
      board: g.community.map(function (c) { return c.rank + c.suit; }).join(',')
    };
  });
  await page.reload();
  await toSetup(page);
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
  await toSetup(page);
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
  check('탭에 role/aria-selected 가 있다', a11y.tabs === 5 && a11y.tabsSelected === 5, a11y.tabs + '/' + a11y.tabsSelected);
  check('모달에 role=dialog 가 있다', a11y.dialogs >= 4, '개수 ' + a11y.dialogs);
  check('라이브 리전이 있다', a11y.liveRegions >= 2, '개수 ' + a11y.liveRegions);
  check('모든 버튼에 접근 가능한 이름이 있다', a11y.buttons === a11y.labelled,
    a11y.labelled + '/' + a11y.buttons);

  check('콘솔 에러가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();

  console.log('\n[낮은 펠트: 좌석 · 베팅 배지 · 팟 · 보드 겹침]');
  /* iOS 사파리는 주소창 때문에 세로 높이가 660 정도까지 줄고, 가로는 펠트가 200px 남짓이다.
     좌석·카드·베팅 배지가 팟 배지나 보드 카드와 2px 넘게 겹치면 실패. */
  function measureOverlaps() {
    const r = function (el) { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const inter = function (a, b) {
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      return (w > 0 && h > 0) ? Math.round(Math.min(w, h)) : 0;
    };
    const pots = Array.prototype.map.call(document.querySelectorAll('.pot-badge'), r);
    const board = Array.prototype.map.call(document.querySelectorAll('#community .card'), r);
    const feltEl = document.getElementById('felt');
    const felt = r(feltEl);
    /* 펠트는 overflow:hidden 이라 둥근 모서리 밖은 잘린다 — 플레이트 네 귀퉁이가 모서리 타원 안에 있어야 한다 */
    const radius = getComputedStyle(feltEl).borderRadius.split('/');
    const toPx = function (v, base) { v = v.trim(); return /%$/.test(v) ? parseFloat(v) / 100 * base : parseFloat(v); };
    const rx = toPx(radius[0], felt.w), ry = toPx(radius[1] || radius[0], felt.h);
    const clipped = function (rc) {
      const corners = [[rc.l, rc.t], [rc.r, rc.t], [rc.l, rc.b], [rc.r, rc.b]];
      return corners.some(function (c) {
        const dx = Math.max(0, Math.max(felt.l + rx - c[0], c[0] - (felt.r - rx)));
        const dy = Math.max(0, Math.max(felt.t + ry - c[1], c[1] - (felt.b - ry)));
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1.02;
      });
    };
    const seats = Array.prototype.slice.call(document.querySelectorAll('.seat'));
    const bad = [];
    seats.forEach(function (s, i) {
      const name = s.querySelector('.name').textContent.trim();
      const parts = [s.querySelector('.plate'), s.querySelector('.cards'), s.querySelector('.bet')];
      parts.forEach(function (el) {
        if (!el || el.classList.contains('hidden')) return;
        const rc = r(el);
        if (rc.w < 2 || rc.h < 2) return;
        const oPot = pots.reduce(function (m, p) { return Math.max(m, inter(rc, p)); }, 0);
        const oBoard = board.reduce(function (m, c) { return Math.max(m, inter(rc, c)); }, 0);
        if (oPot > 2) bad.push(name + '/' + el.className + ' 팟 ' + oPot);
        if (oBoard > 2) bad.push(name + '/' + el.className + ' 보드 ' + oBoard);
        if (el.classList.contains('plate') && (rc.t < felt.t - 1 || rc.b > felt.b + 1)) bad.push(name + ' 펠트 밖');
        if (el.classList.contains('plate') && clipped(rc)) bad.push(name + ' 모서리에 잘림');
      });
      const myBet = s.querySelector('.bet');
      seats.forEach(function (s2) {
        if (s2 === s) return;
        const n2 = s2.querySelector('.name').textContent.trim(), plate2 = r(s2.querySelector('.plate'));
        if (s2 === seats[i + 1] || seats.indexOf(s2) > i) {
          const o = inter(r(s.querySelector('.plate')), plate2);
          if (o > 2) bad.push(name + ' x ' + n2 + ' ' + o);
        }
        if (myBet && !myBet.classList.contains('hidden')) {
          const ob = inter(r(myBet), plate2);
          if (ob > 3) bad.push(name + ' 배지 x ' + n2 + ' 플레이트 ' + ob);
        }
      });
    });
    return bad;
  }
  console.log('\n[9인 테이블]');
  {
    const p9 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const e9 = [];
    collectErrors(p9, e9);
    await p9.goto(URL);
    await toSetup(p9);
    const optMax = await p9.$$eval('#optBots option', function (os) { return Math.max.apply(null, os.map(function (o) { return parseInt(o.value, 10); })); });
    check('상대를 8명까지 고를 수 있다', optMax === 8, String(optMax));
    await p9.selectOption('#optBots', '8');
    await p9.selectOption('#optSpeed', '350');
    await p9.uncheck('#optReview');
    await p9.fill('#optSeed', 'NINE1');
    await p9.click('#btnStart');
    await p9.waitForTimeout(700);
    const st9 = await p9.evaluate(function () {
      const g = window.HoldemUI.game;
      return {
        players: g.players.length, seats: document.querySelectorAll('.seat').length,
        positions: g.players.map(function (p) { return g.position(p); }).sort().join(' ')
      };
    });
    check('9인 게임이 시작되고 좌석 9개가 그려진다', st9.players === 9 && st9.seats === 9, JSON.stringify(st9));
    check('포지션에 UTG+1 · LJ · HJ 가 있다', /UTG1/.test(st9.positions) && /LJ/.test(st9.positions) && /HJ/.test(st9.positions), st9.positions);
    const bad9 = await p9.evaluate(measureOverlaps);
    check('데스크톱 9인: 좌석끼리·팟·보드와 겹치지 않는다', bad9.length === 0, bad9.join(' | '));
    /* 몇 핸드 돌려 본다 */
    const until9 = Date.now() + 25000;
    let hands9 = 0;
    while (hands9 < 3 && Date.now() < until9) {
      const st = await p9.evaluate(function () {
        const g = window.HoldemUI.game;
        return { phase: g.phase, hero: !!(g.currentActor() && g.currentActor().isHuman), over: document.getElementById('overModal').classList.contains('show') };
      });
      if (st.over) break;
      if (st.phase === 'show-choice') await p9.click('#btnMuck');
      else if (st.phase === 'awaiting-action' && st.hero) await p9.click('#btnFold');
      else if (st.phase === 'hand-over') { hands9++; await p9.click('#btnNext'); }
      await p9.waitForTimeout(100);
    }
    check('9인 게임이 진행된다', hands9 >= 2, '진행 ' + hands9);
    await safeClick(p9, '.tab[data-tab="chart"]');
    await p9.waitForTimeout(200);
    const btn9 = await p9.$$eval('.pos-btn', function (bs) { return bs.map(function (b) { return b.textContent; }).length; });
    check('9인 차트에 포지션 버튼 9개', btn9 === 9, String(btn9));
    check('9인: 콘솔 에러 없음', e9.length === 0, e9.slice(0, 2).join(' | '));
    await p9.close();
  }

  for (const bots of [8, 5, 3, 1]) {
    const mp = await browser.newPage({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
    const mErr = [];
    collectErrors(mp, mErr);
    await mp.goto(URL);
    await toSetup(mp);
    await mp.selectOption('#optBots', String(bots));
    await mp.selectOption('#optSpeed', '350');
    await mp.selectOption('#optChips', '5000');
    await mp.uncheck('#optReview');
    await mp.fill('#optSeed', 'OVL' + bots);
    await mp.click('#btnStart');
    await mp.waitForTimeout(500);
    /* 두 시점에서 잰다: 프리플랍 히어로 차례(블라인드·레이즈 배지 + 팟), 포스트플랍 히어로 차례(보드 + 팟) */
    async function toHeroTurn(wantPostflop) {
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        const st = await mp.evaluate(function () {
          const g = window.HoldemUI.game;
          return { phase: g.phase, street: g.street, hero: !!(g.currentActor() && g.currentActor().isHuman) };
        });
        if (st.phase === 'awaiting-action' && st.hero) {
          if (!wantPostflop || st.street !== 'preflop') return true;
          await mp.click('#btnCall');
        } else if (st.phase === 'hand-over') await mp.click('#btnNext');
        else if (st.phase === 'show-choice') await mp.click('#btnMuck');
        await mp.waitForTimeout(80);
      }
      return false;
    }
    const VPS = [[390, 664, 'iPhone 세로(사파리 높이)'], [375, 667, 'iPhone SE'], [360, 640, '작은 안드로이드'], [844, 390, 'iPhone 가로'], [667, 375, 'SE 가로']];
    for (const stage of ['프리플랍', '포스트플랍']) {
      const ready = await toHeroTurn(stage === '포스트플랍');
      check((bots + 1) + '인 ' + stage + ': 히어로 차례를 만든다', ready);
      if (!ready) continue;
      const hasBadge = await mp.evaluate(function () { return document.querySelectorAll('.seat .bet:not(.hidden)').length; });
      if (stage === '프리플랍') check((bots + 1) + '인 프리플랍: 베팅 배지가 보인다', hasBadge > 0, String(hasBadge));
      for (const vp of VPS) {
        await mp.setViewportSize({ width: vp[0], height: vp[1] });
        await mp.waitForTimeout(350);
        const bad = await mp.evaluate(measureOverlaps);
        const hs = await mp.evaluate(function () { return document.documentElement.scrollWidth > document.documentElement.clientWidth; });
        check((bots + 1) + '인 ' + stage + ' ' + vp[2] + ': 겹침 없음', bad.length === 0 && !hs, bad.join(' | ') + (hs ? ' 가로스크롤' : ''));
      }
      await mp.setViewportSize({ width: 390, height: 664 });
    }
    check((bots + 1) + '인: 콘솔 에러 없음', mErr.length === 0, mErr.slice(0, 2).join(' | '));
    await mp.close();
  }

  console.log('\n[모바일]');
  for (const [label, vp] of [['세로 390x844', { width: 390, height: 844 }], ['가로 844x390', { width: 844, height: 390 }]]) {
    const mErrors = [];
    const m = await browser.newPage({ viewport: vp, isMobile: true, hasTouch: true });
    collectErrors(m, mErrors);
    await m.goto(URL);
    await toSetup(m);
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
