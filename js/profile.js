/*
 * profile.js - 약점 프로파일
 *
 * 핸드 리뷰는 "이번 핸드에서 몇 칩을 흘렸는지"를 보여주고 끝난다. 여기서는 그 결정들을
 * 자리(스트리트 × 상황)와 포지션별로 세션을 넘어 쌓아, "어디서 가장 많이 흘리는지"를
 * 찾는다. 드릴 모드가 이 표에서 가장 약한 자리를 골라 출제한다.
 *
 * 손실은 빅블라인드 단위로 쌓는다 — 블라인드 레벨이 달라도 비교할 수 있어야 한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') { require('./storage.js'); require('./review.js'); }

  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const SPOTS = { preflop: ['open', 'vsOpen', 'vs3bet'], post: ['cbet', 'checkedTo', 'vsBet'] };
  const POSITIONS = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const RECENT_LIMIT = 30;
  const MIN_SAMPLE = 5;       // 이보다 적으면 "약점"이라 부르지 않는다
  const WEAK_MIN_AVG = 0.15;  // 결정당 평균 손실이 이보다 작으면 약점이 아니다 (리뷰의 '좋은 판단' 경계)
  const STORAGE_KEY = 'profile';
  const VERSION = 1;

  /** 분류 가능한 자리 키 전부 (표를 고정 순서로 그리기 위해) */
  function allKeys() {
    const out = [];
    STREETS.forEach(function (st) {
      (st === 'preflop' ? SPOTS.preflop : SPOTS.post).forEach(function (sp) { out.push(st + '/' + sp); });
    });
    return out;
  }

  function emptyBucket() {
    return { n: 0, loss: 0, mistakes: 0, drillN: 0, drillLoss: 0 };
  }

  function Profile(data) {
    this.version = VERSION;
    this.cats = {};
    this.pos = {};
    this.decisions = 0;
    this.loss = 0;
    this.hands = 0;
    this.recent = [];
    this.updated = 0;
    this.lastStyle = null;    // 마지막 플레이 스타일 진단 (H.style.diagnose 결과 + 시각)
    this.daily = [];          // 오늘의 10문제 기록 [{date, asked, correct, lossBb}] 최근 순
    this.acc = {};            // 자리별 최근 결과 창 (1 = 좋음·무난, 0 = 실수) 최대 ACC_WINDOW
    this.accPos = {};         // 자리별 최근 포지션 목록 (드릴 카드 라벨용)
    this.drillLog = [];       // 날짜별 드릴·오늘의 10문제 결과 [{date, asked, correct}]
    this.cross = {};          // 포지션|스트리트 교차 누수 (히트맵)
    this.days = {};           // 날짜별 실전 기록 {hands, decisions, loss} (주간 리포트)
    if (data && data.version === VERSION) {
      this.cats = data.cats || {};
      this.pos = data.pos || {};
      this.decisions = data.decisions || 0;
      this.loss = data.loss || 0;
      this.hands = data.hands || 0;
      this.recent = data.recent || [];
      this.updated = data.updated || 0;
      this.lastStyle = data.lastStyle || null;
      this.daily = data.daily || [];
      this.acc = data.acc || {};
      this.accPos = data.accPos || {};
      this.drillLog = data.drillLog || [];
      this.cross = data.cross || {};
      this.days = data.days || {};
    }
  }
  const DAYS_LIMIT = 60;
  const DAILY_LIMIT = 14;
  const ACC_WINDOW = 20;
  const LOG_LIMIT = 60;

  Profile.prototype.bucket = function (map, key) {
    if (!map[key]) map[key] = emptyBucket();
    // 옛 데이터에 새 필드가 없을 수 있다
    const b = map[key];
    if (b.drillN == null) { b.drillN = 0; b.drillLoss = 0; }
    return b;
  };

  function isMistake(item) { return item.verdict === 'mistake' || item.verdict === 'blunder'; }

  /** 핸드가 끝난 뒤, 그 핸드의 리뷰 항목들을 넣는다 */
  Profile.prototype.addHand = function (items, opts) {
    if (!items || !items.length) return;
    const self = this;
    this.hands++;
    const date = (opts && opts.date) || todayKey();
    const day = this.days[date] || (this.days[date] = { hands: 0, decisions: 0, loss: 0 });
    day.hands++;
    const keys = Object.keys(this.days).sort();
    if (keys.length > DAYS_LIMIT) keys.slice(0, keys.length - DAYS_LIMIT).forEach(function (k) { delete self.days[k]; });
    items.forEach(function (it) {
      if (!it || it.evLossBb == null || !it.spot) return;
      if (it.coached) return;   // 코치를 보고 한 결정은 실력이 아니다
      const key = it.street + '/' + it.spot;
      const c = self.bucket(self.cats, key);
      c.n++; c.loss += it.evLossBb; if (isMistake(it)) c.mistakes++;
      if (it.position) {
        const p = self.bucket(self.pos, it.position);
        p.n++; p.loss += it.evLossBb; if (isMistake(it)) p.mistakes++;
      }
      if (it.position) {
        const x = self.bucket(self.cross, it.position + '|' + it.street);
        x.n++; x.loss += it.evLossBb; if (isMistake(it)) x.mistakes++;
      }
      day.decisions++; day.loss += it.evLossBb;
      /* 최근 창: 드릴 카드의 "최근 20회 정확도" */
      const w = self.acc[key] || (self.acc[key] = []);
      w.push(isMistake(it) ? 0 : 1);
      if (w.length > ACC_WINDOW) w.shift();
      if (it.position) {
        const wp = self.accPos[key] || (self.accPos[key] = []);
        wp.push(it.position);
        if (wp.length > ACC_WINDOW) wp.shift();
      }
      self.decisions++;
      self.loss += it.evLossBb;
      if (isMistake(it)) {
        self.recent.push({
          key: key, pos: it.position, lossBb: it.evLossBb, verdict: it.verdict,
          cards: it.cards.map(H.cards.cardToString),
          board: it.board.map(H.cards.cardToString),
          chosen: it.chosen, best: it.best, t: Date.now()
        });
        if (self.recent.length > RECENT_LIMIT) self.recent.shift();
      }
    });
    this.updated = Date.now();
  };

  /** 드릴 정답은 실전 통계와 따로 센다 — 드릴을 많이 한 자리가 약점처럼 보이면 안 된다 */
  Profile.prototype.addDrill = function (key, evLossBb, opts) {
    const c = this.bucket(this.cats, key);
    c.drillN++; c.drillLoss += evLossBb;
    this.logDrill((opts && opts.date) || todayKey(), evLossBb < 0.6 ? 1 : 0);
    this.updated = Date.now();
  };
  function todayKey() {
    const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  /** 날짜별 드릴 정답 집계 (오늘의 10문제 포함) */
  Profile.prototype.logDrill = function (date, correct) {
    let rec = this.drillLog.filter(function (d) { return d.date === date; })[0];
    if (!rec) { rec = { date: date, asked: 0, correct: 0 }; this.drillLog.push(rec); }
    rec.asked++; rec.correct += correct ? 1 : 0;
    this.drillLog.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (this.drillLog.length > LOG_LIMIT) this.drillLog.splice(0, this.drillLog.length - LOG_LIMIT);
  };

  /** 최근 7일(오늘 포함) 드릴 정확도와 그 전 7일 — 개선 추이 */
  Profile.prototype.weekAccuracy = function (today) {
    const t = today ? new Date(today + 'T00:00:00') : new Date();
    const dayMs = 86400000;
    const inRange = function (d, from, to) { const x = new Date(d.date + 'T00:00:00').getTime(); return x >= from && x <= to; };
    const end = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const sum = function (from, to) {
      let a = 0, c = 0;
      this.drillLog.forEach(function (d) { if (inRange(d, from, to)) { a += d.asked; c += d.correct; } });
      return { asked: a, correct: c, pct: a ? c / a : null };
    }.bind(this);
    return { now: sum(end - 6 * dayMs, end), before: sum(end - 13 * dayMs, end - 7 * dayMs) };
  };

  /** 연속 학습일: 오늘(또는 어제)부터 거슬러 드릴 기록이 있는 날 수 */
  Profile.prototype.streak = function (today) {
    const dates = {};
    this.drillLog.forEach(function (d) { if (d.asked > 0) dates[d.date] = true; });
    this.daily.forEach(function (d) { dates[d.date] = true; });
    const t = today ? new Date(today + 'T00:00:00') : new Date();
    let cur = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const key = function (d) { const m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; };
    if (!dates[key(cur)]) cur = new Date(cur.getTime() - 86400000);   // 오늘 아직 안 했으면 어제까지의 연속
    let n = 0;
    while (dates[key(cur)]) { n++; cur = new Date(cur.getTime() - 86400000); }
    return n;
  };

  /** 스트리트별 정확도 (실전 결정 기준) */
  Profile.prototype.byStreetAccuracy = function () {
    const self = this;
    return STREETS.map(function (st) {
      let n = 0, m = 0;
      Object.keys(self.cats).forEach(function (k) {
        if (k.indexOf(st + '/') !== 0) return;
        n += self.cats[k].n; m += self.cats[k].mistakes;
      });
      return { street: st, n: n, acc: n ? (n - m) / n : null };
    });
  };

  /** 반복되는 실수 Top N (최근 실수 목록을 자리별로 센다) */
  Profile.prototype.repeatMistakes = function (limit) {
    const count = {};
    this.recent.forEach(function (m) { count[m.key] = (count[m.key] || 0) + 1; });
    return Object.keys(count).map(function (k) { return { key: k, n: count[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, limit || 3);
  };

  /** 포지션 × 스트리트 히트맵 행렬 (기록 있는 포지션만) */
  Profile.prototype.heatmap = function () {
    const self = this;
    const rows = [];
    POSITIONS.forEach(function (pos) {
      const cells = STREETS.map(function (st) {
        const b = self.cross[pos + '|' + st];
        return b && b.n ? { n: b.n, avg: b.loss / b.n, bb100: self.hands ? b.loss / self.hands * 100 : 0 } : null;
      });
      if (cells.some(function (c) { return c; })) rows.push({ pos: pos, cells: cells });
    });
    return { streets: STREETS, rows: rows };
  };

  /** 주간 리포트: 이번 7일과 지난 7일의 실전 핸드 · 결정당 손실 · 학습일 수 */
  Profile.prototype.weekReport = function (today) {
    const t = today ? new Date(today + 'T00:00:00') : new Date();
    const end = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const dayMs = 86400000;
    const self = this;
    const studied = {};
    this.drillLog.forEach(function (d) { if (d.asked > 0) studied[d.date] = true; });
    this.daily.forEach(function (d) { studied[d.date] = true; });
    const sum = function (from, to) {
      let hands = 0, decisions = 0, loss = 0, studyDays = 0;
      Object.keys(self.days).forEach(function (k) {
        const x = new Date(k + 'T00:00:00').getTime();
        if (x >= from && x <= to) { hands += self.days[k].hands; decisions += self.days[k].decisions; loss += self.days[k].loss; }
      });
      Object.keys(studied).forEach(function (k) {
        const x = new Date(k + 'T00:00:00').getTime();
        if (x >= from && x <= to) studyDays++;
      });
      return { hands: hands, decisions: decisions, loss: loss, avg: decisions ? loss / decisions : null, studyDays: studyDays };
    };
    return { now: sum(end - 6 * dayMs, end), before: sum(end - 13 * dayMs, end - 7 * dayMs) };
  };

  /*
   * 개인화 드릴 카드: 가장 약한 자리, 그 자리에서 가장 잦은 포지션, 최근 창의 정확도, 목표 문구 키.
   * 약점이 없으면 null (홈은 무작위 드릴을 권한다)
   */
  Profile.prototype.drillCard = function () {
    const key = this.drillTarget();
    if (!key) return null;
    const w = this.acc[key] || [];
    const correct = w.reduce(function (a, b) { return a + b; }, 0);
    const posList = this.accPos[key] || [];
    const posCount = {};
    posList.forEach(function (p) { posCount[p] = (posCount[p] || 0) + 1; });
    const pos = Object.keys(posCount).sort(function (a, b) { return posCount[b] - posCount[a]; })[0] || null;
    const row = this.table().filter(function (r) { return r.key === key; })[0];
    return {
      key: key, pos: pos, n: w.length, accuracy: w.length ? correct / w.length : null,
      avg: row ? row.avg : 0, bb100: row ? row.bb100 : 0,
      goal: 'drill.goal.' + key.split('/')[1]
    };
  };

  function row(key, b, hands) {
    return {
      key: key,
      n: b.n, loss: b.loss, mistakes: b.mistakes,
      avg: b.n ? b.loss / b.n : 0,
      bb100: hands ? b.loss / hands * 100 : 0,      // 이 자리에서 100핸드당 잃는 bb
      mistakeRate: b.n ? b.mistakes / b.n : 0,
      drillN: b.drillN || 0,
      drillAvg: b.drillN ? b.drillLoss / b.drillN : null
    };
  }

  /** 자리별 표 (고정 순서, 기록 없는 자리도 포함) */
  Profile.prototype.table = function () {
    const self = this;
    return allKeys().map(function (k) { return row(k, self.cats[k] || emptyBucket(), self.hands); });
  };

  Profile.prototype.byPosition = function () {
    const self = this;
    return POSITIONS.map(function (p) { return row(p, self.pos[p] || emptyBucket(), self.hands); });
  };

  /**
   * 약한 자리부터. 결정당 평균 손실이 기준이고, 표본이 MIN_SAMPLE 미만인 자리는
   * 뒤로 보낸다 (두 번 실수한 자리를 "최대 약점"이라 부를 수는 없다).
   */
  Profile.prototype.weakest = function (minSample) {
    const min = minSample == null ? MIN_SAMPLE : minSample;
    return this.table()
      .filter(function (r) { return r.n > 0; })
      .sort(function (a, b) {
        const ea = a.n >= min, eb = b.n >= min;
        if (ea !== eb) return ea ? -1 : 1;
        if (b.avg !== a.avg) return b.avg - a.avg;
        return b.loss - a.loss;
      });
  };

  /** 드릴 출제 대상: 표본이 충분한 자리 중 가장 약한 곳. 없으면 null (아무 자리나) */
  Profile.prototype.drillTarget = function () {
    const w = this.weakest();
    if (!w.length || w[0].n < MIN_SAMPLE || w[0].avg < WEAK_MIN_AVG) return null;
    return w[0].key;
  };

  /** 약점이라 부를 만한 자리들 (표본 충분 + 평균 손실이 기준 이상) */
  Profile.prototype.weakSpots = function () {
    return this.weakest().filter(function (r) { return r.n >= MIN_SAMPLE && r.avg >= WEAK_MIN_AVG; });
  };

  /** 스타일 진단을 저장한다 (세션이 끝나도 학습 탭에 남게) */
  Profile.prototype.setStyle = function (diag) {
    if (!diag) return;
    this.lastStyle = Object.assign({}, diag, { t: Date.now() });
    this.updated = Date.now();
  };

  /** 오늘의 10문제 결과. 같은 날짜는 덮어쓴다 */
  Profile.prototype.setDaily = function (rec) {
    if (!rec || !rec.date) return;
    this.daily = this.daily.filter(function (d) { return d.date !== rec.date; });
    this.daily.unshift({ date: rec.date, asked: rec.asked, correct: rec.correct, lossBb: rec.lossBb });
    this.daily.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });   // 최근 날짜부터
    if (this.daily.length > DAILY_LIMIT) this.daily.length = DAILY_LIMIT;
    this.updated = Date.now();
  };
  Profile.prototype.dailyFor = function (date) {
    return this.daily.filter(function (d) { return d.date === date; })[0] || null;
  };

  Profile.prototype.toJSON = function () {
    return {
      version: this.version, cats: this.cats, pos: this.pos,
      decisions: this.decisions, loss: this.loss, hands: this.hands,
      recent: this.recent, updated: this.updated,
      lastStyle: this.lastStyle, daily: this.daily,
      acc: this.acc, accPos: this.accPos, drillLog: this.drillLog,
      cross: this.cross, days: this.days
    };
  };

  function load() {
    const raw = H.storage ? H.storage.get(STORAGE_KEY, null) : null;
    return new Profile(raw);
  }
  function save(profile) {
    if (!H.storage) return false;
    return H.storage.set(STORAGE_KEY, profile.toJSON());
  }
  function reset() {
    if (H.storage) H.storage.remove(STORAGE_KEY);
    return new Profile(null);
  }

  /* 리크 심각도: 결정당 평균 손실(bb). 리뷰의 '실수' 경계(0.6)와 '무난' 경계(0.15)의 중간을 주의로 */
  function severity(avg) {
    return avg >= 0.6 ? 'critical' : avg >= 0.3 ? 'warn' : 'ok';
  }

  H.profile = {
    Profile: Profile,
    severity: severity,
    STREETS: STREETS,
    SPOTS: SPOTS,
    POSITIONS: POSITIONS,
    MIN_SAMPLE: MIN_SAMPLE,
    WEAK_MIN_AVG: WEAK_MIN_AVG,
    allKeys: allKeys,
    create: function (data) { return new Profile(data || null); },
    load: load,
    save: save,
    reset: reset
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
