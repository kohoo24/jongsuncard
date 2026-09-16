/*
 * test/sw.js - 서비스 워커 갱신 테스트
 *
 *   npm run test:sw
 *
 * 묻는 것은 하나다: 한 번 접속한 사람에게 새 배포가 도달하는가.
 *
 * 예전에는 도달하지 않았다. 브라우저는 sw.js 의 바이트가 달라져야 install 을
 * 다시 돌리는데, sw.js 는 배포해도 늘 같은 파일이었다. 그래서 캐시는 첫 방문
 * 때 받은 셸에 영영 멈춰 있었다. 지금은 배포마다 커밋 SHA 가 박히므로 sw.js 가
 * 매번 달라지고, install 이 셸을 통째로 다시 받는다.
 *
 * 즉 이 구조는 배포 워크플로의 sed 에 기대고 있다. 그것까지 같이 확인한다.
 *
 * file:// 에서는 서비스 워커가 아예 등록되지 않으므로 E2E 와 따로 둔다.
 * Playwright 가 없으면 건너뛴다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let chromium = null;
for (const p of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
  try { chromium = require(p).chromium; break; } catch (e) { /* 다음 후보 */ }
}
if (!chromium) {
  console.log('Playwright 가 없어 서비스 워커 테스트를 건너뜁니다.');
  process.exit(0);
}

const REPO = path.resolve(__dirname, '..');
const PORT = 8731;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

/* 배포 워크플로가 하는 일을 그대로 흉내 낸다 */
function build(root, stamp) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  ['index.html', 'manifest.webmanifest', 'icon.svg', 'sw.js'].forEach(function (f) {
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  });
  ['css', 'js', 'fonts'].forEach(function (d) {
    fs.cpSync(path.join(REPO, d), path.join(root, d), { recursive: true });
  });
  const p = path.join(root, 'sw.js');
  const src = fs.readFileSync(p, 'utf8')
    .replace(/^const BUILD = 'dev';$/m, "const BUILD = '" + stamp + "';");
  if (src.indexOf("const BUILD = '" + stamp + "';") < 0) {
    throw new Error('sw.js 의 BUILD 를 바꾸지 못했다 — 배포 워크플로의 sed 도 같이 깨진다');
  }
  fs.writeFileSync(p, src);
}

function serve(root) {
  return http.createServer(function (rq, rs) {
    let rel = decodeURIComponent(rq.url.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const fp = path.join(root, rel);
    if (fp.indexOf(root) !== 0 || !fs.existsSync(fp)) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, {
      'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    rs.end(fs.readFileSync(fp));
  }).listen(PORT);
}

(async function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holdem-sw-'));
  try {
    build(root, 'build-AAA');
  } catch (e) {
    console.log('\n[서비스 워커]');
    check('배포 워크플로가 sw.js 의 BUILD 를 바꿀 수 있다', false, e.message);
    console.log('\n서비스 워커 결과: ' + passed + ' 통과, ' + failed + ' 실패\n');
    process.exit(1);
  }
  const srv = serve(root);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function (e) { errs.push(String(e)); });
  page.on('console', function (m) { if (m.type() === 'error') errs.push(m.text()); });

  try {
    console.log('\n[서비스 워커]');
    await page.goto('http://localhost:' + PORT + '/');
    await page.waitForFunction(function () {
      return navigator.serviceWorker.controller !== null;
    }, { timeout: 20000 });
    await page.waitForTimeout(800);

    const first = await page.evaluate(function () { return caches.keys(); });
    check('첫 방문에 빌드 스탬프가 박힌 캐시가 하나 생긴다',
      first.length === 1 && first[0] === 'holdem-build-AAA', JSON.stringify(first));

    await ctx.setOffline(true);
    await page.reload();
    const offline = await page.evaluate(function () {
      return !!document.getElementById('setupModal');
    });
    check('오프라인에서도 앱이 뜬다', offline);
    await ctx.setOffline(false);

    /* 새 배포: 코드도 바뀌고 빌드 스탬프도 바뀐다 */
    build(root, 'build-BBB');
    fs.appendFileSync(path.join(root, 'js/cards.js'),
      '\nglobalThis.__DEPLOY__ = "BBB";\n');

    await page.reload();                    // 새 sw.js 를 발견하고 설치·활성화
    await page.waitForTimeout(2500);
    await page.reload();                    // 새 셸로 뜬다
    await page.waitForTimeout(1200);

    const after = await page.evaluate(function () { return caches.keys(); });
    check('새 배포 뒤 옛 캐시가 지워진다',
      after.length === 1 && after[0] === 'holdem-build-BBB', JSON.stringify(after));

    const marker = await page.evaluate(function () {
      return globalThis.__DEPLOY__ || null;
    });
    check('이미 접속했던 사람에게 새 코드가 도달한다', marker === 'BBB', '표식: ' + marker);

    check('콘솔 에러가 없다', errs.length === 0, errs.slice(0, 3).join(' / '));

    /*
     * 워크플로에서 sed 가 빠지면 sw.js 가 배포마다 같은 파일이 되고, 옛 버그가
     * 소리 없이 돌아온다. 여기서만 잡을 수 있다.
     */
    const wf = fs.readFileSync(
      path.join(REPO, '.github/workflows/pages.yml'), 'utf8');
    check('배포 워크플로가 빌드 스탬프를 박는다',
      wf.indexOf("const BUILD = 'dev';") >= 0 && wf.indexOf('GITHUB_SHA') >= 0,
      'pages.yml 의 sed 단계가 사라졌다');
    check('스탬프를 못 박으면 배포가 실패한다',
      /exit 1/.test(wf.split('빌드 스탬프')[1] || ''), 'sed 실패를 조용히 넘긴다');
  } finally {
    await b.close();
    srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('\n서비스 워커 결과: ' + passed + ' 통과, ' + failed + ' 실패\n');
  process.exit(failed ? 1 : 0);
})();
