/*
 * panels.js - 사이드 패널과 모달 (로그 / 통계 / 히스토리 / 프리플랍 차트 / 리뷰 / 리플레이)
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  const T = function (k, p) { return H.i18n.t(k, p); };

  /* 시리즈 색: 레퍼런스 카테고리 팔레트의 다크 스텝 1~6.
     좌석 순서에 고정 배정하며 절대 순환시키지 않는다 (색 = 플레이어 정체성).
     검증: node scripts/validate_palette.js "..." --mode dark --surface "#0f2018" -> 전 항목 PASS */
  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function pct(v) { return Math.round(v * 100) + '%'; }

  /* 목록용 작은 카드 표기 — 무늬는 SVG 로 그린다 */
  function miniCard(c) {
    const m = el('span', 'mini-card');
    m.dataset.suit = c.suit;
    m.appendChild(document.createTextNode(H.cards.RANK_LABEL[c.rank]));
    const icon = H.cardart.suitIcon(c.suit, 8, H.cardart.inkOf(c.suit, false));
    icon.style.marginLeft = '2px';
    icon.style.verticalAlign = '-1px';
    m.appendChild(icon);
    return m;
  }
  function num(v) { return H.format.amount(v); }

  H.panels = { SERIES: SERIES };

  /* ==================== 로그 ==================== */
  H.panels.renderLog = function (game, host) {
    host.innerHTML = '';
    const list = el('div', 'loglist');
    game.log.slice(-200).forEach(function (e) {
      const d = el('div', 'l-' + e.kind, e.text);
      list.appendChild(d);
    });
    host.appendChild(list);
    list.scrollTop = list.scrollHeight;
  };

  /* ==================== 통계 ==================== */
  const STAT_COLS = [
    { key: 'vpip', label: 'stats.vpip', hint: 'stats.vpipHint', fmt: pct },
    { key: 'pfr', label: 'stats.pfr', hint: 'stats.pfrHint', fmt: pct },
    { key: 'af', label: 'stats.af', hint: 'stats.afHint', fmt: function (v) { return v.toFixed(1); } },
    { key: 'threeBet', label: 'stats.threeBet', hint: null, fmt: pct },
    { key: 'wtsd', label: 'stats.wtsd', hint: 'stats.wtsdHint', fmt: pct },
    { key: 'wsd', label: 'stats.wsd', hint: 'stats.wsdHint', fmt: pct }
  ];

  /* ICM 지분: 상금 자리보다 사람이 많이 남아 있을 때만 의미가 있다.
     핸드 기록과 무관한 정보라 통계 표보다 먼저 그린다. */
  function renderIcm(game, host, heroId) {
    if (!game || game.players.length <= 2 || !H.tournament) return;
    const payouts = game.payouts();
    if (payouts.length <= 1 || payouts.length >= game.players.length) return;
    const icm = game.icm();
    const pressure = H.tournament.icmPressure(
      game.players.map(function (p) { return p.chips; }), payouts);
    host.appendChild(el('h4', 'panel-sub', T('tour.icm')));
    const icmList = el('div', 'icm-list');
    game.players.forEach(function (p, i) {
      const row = el('div', 'icm-row' + (p.id === heroId ? ' hero' : ''));
      row.appendChild(el('span', 'icm-name', p.name));
      row.appendChild(el('span', 'icm-val', num(icm[i])));
      const pr = el('span', 'icm-pressure' + (pressure[i] < 1 ? ' down' : ' up'),
        (pressure[i] >= 1 ? '+' : '') + ((pressure[i] - 1) * 100).toFixed(0) + '%');
      row.appendChild(pr);
      icmList.appendChild(row);
    });
    host.appendChild(icmList);
  }

  H.panels.renderStats = function (tracker, game, host, heroId) {
    host.innerHTML = '';
    const rows = tracker.all().filter(function (s) { return s.hands > 0; });
    if (!rows.length) {
      host.appendChild(el('p', 'empty', T('stats.empty')));
      renderIcm(game, host, heroId);
      return;
    }

    const table = el('table', 'stats-table');
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', 'name-col', ''));
    hr.appendChild(el('th', null, T('stats.hands')));
    STAT_COLS.forEach(function (c) {
      const th = el('th', null, T(c.label));
      if (c.hint) th.title = T(c.hint);
      hr.appendChild(th);
    });
    hr.appendChild(el('th', null, T('stats.bb100')));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    const order = game ? game.players.map(function (p) { return p.id; }) : [];
    /* 탈락한 사람은 game.players 에 없다 (-1) — 색도 자리도 산 사람 뒤로 뺀다 */
    const rank = function (id) { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    rows.sort(function (a, b) { return rank(a.id) - rank(b.id); });
    rows.forEach(function (s) {
      const tr = el('tr', s.id === heroId ? 'hero' : null);
      const nameCell = el('td', 'name-col');
      const seat = order.indexOf(s.id);
      const dot = el('span', 'series-dot');
      dot.style.background = seat < 0 ? 'rgba(255,255,255,.22)' : SERIES[seat % SERIES.length];
      nameCell.appendChild(dot);
      nameCell.appendChild(document.createTextNode(s.name));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', null, String(s.hands)));
      STAT_COLS.forEach(function (c) { tr.appendChild(el('td', null, c.fmt(s[c.key]))); });
      /* 핸드 수가 적으면 bb/100 이 수천까지 나온다 — 자릿수를 줄여 열이 붙지 않게 */
      const v = s.bb100;
      const txt = Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
      const bb = el('td', v >= 0 ? 'pos' : 'neg', (v >= 0 ? '+' : '') + txt);
      bb.title = v.toFixed(1) + ' bb/100';
      tr.appendChild(bb);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const scroller = el('div', 'stats-wrap');
    scroller.appendChild(table);
    host.appendChild(scroller);

    renderIcm(game, host, heroId);

    host.appendChild(el('h4', 'panel-sub', T('stats.chipGraph')));
    const d = tracker.data[heroId];
    host.appendChild(chipChart(tracker, game, heroId, {
      startChips: d ? d.initialChips : null
    }));
  };

  /*
   * 칩 추이 — 시간에 따른 변화 + 플레이어 정체성이므로 다중 시리즈 라인.
   * 2px 라인, 옅은 그리드, 범례 + 끝점 직접 라벨, 크로스헤어 툴팁.
   * 시작 스택은 기준선(점선)으로 표시한다.
   */
  function chipChart(tracker, game, heroId, opts) {
    const wrap = el('div', 'chart-wrap');
    const players = game ? game.players.slice() : [];
    const series = [];
    players.forEach(function (p, seat) {
      const hist = tracker.history(p.id);
      if (hist.length < 2) return;
      series.push({
        id: p.id, name: p.name, seat: seat,
        color: SERIES[seat % SERIES.length],
        points: hist,
        hero: p.id === heroId
      });
    });
    if (!series.length) {
      wrap.appendChild(el('p', 'empty', T('stats.empty')));
      return wrap;
    }

    const W = 520, Hh = 250, PAD = { l: 48, r: 60, t: 16, b: 28 };
    let maxHand = 0, maxChips = -Infinity, minChips = Infinity;
    series.forEach(function (s) {
      s.points.forEach(function (pt) {
        maxHand = Math.max(maxHand, pt.hand);
        maxChips = Math.max(maxChips, pt.chips);
        minChips = Math.min(minChips, pt.chips);
      });
    });
    const minHand = 1;

    /*
     * 스택 추이는 부분-전체가 아니라 변화를 읽는 그래프이므로 0 부터 그리지 않는다.
     * (0 기준으로 그리면 모든 선이 위쪽에 뭉쳐 변화가 보이지 않는다)
     * 데이터 범위에 맞추되 시작 스택을 기준선으로 함께 그린다.
     */
    const startChips = opts && opts.startChips ? opts.startChips : null;
    let lo = minChips, hi = maxChips;
    if (startChips) { lo = Math.min(lo, startChips); hi = Math.max(hi, startChips); }
    const span = Math.max(hi - lo, Math.max(1, hi * 0.06));
    lo -= span * 0.12;
    hi += span * 0.12;
    lo = Math.max(0, lo);

    const x = function (h) {
      return PAD.l + (maxHand <= minHand ? 0 : (h - minHand) / (maxHand - minHand)) * (W - PAD.l - PAD.r);
    };
    const y = function (c) { return PAD.t + (1 - (c - lo) / (hi - lo)) * (Hh - PAD.t - PAD.b); };

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    svg.setAttribute('class', 'chip-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', T('stats.chipGraph'));

    function add(tag, attrs, parent) {
      const n = document.createElementNS(svgNS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      (parent || svg).appendChild(n);
      return n;
    }
    function fmt(v) {
      if (H.format.unit() === 'bb') return H.format.amount(v);
      return v >= 10000 ? (v / 1000).toFixed(0) + 'k'
        : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
    }

    /* 그리드 (뒤로 물러나 있어야 한다) */
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (hi - lo) * i / ticks;
      add('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'grid' });
      add('text', { x: PAD.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }).textContent = fmt(v);
    }
    /* 시작 스택 기준선 */
    if (startChips && startChips > lo && startChips < hi) {
      add('line', {
        x1: PAD.l, x2: W - PAD.r, y1: y(startChips), y2: y(startChips), class: 'baseline'
      });
    }
    add('text', { x: PAD.l, y: Hh - 8, class: 'axis' }).textContent = '#' + minHand;
    add('text', { x: W - PAD.r, y: Hh - 8, class: 'axis', 'text-anchor': 'end' }).textContent = '#' + maxHand;

    /* 라인 */
    series.forEach(function (s) {
      const d = s.points.map(function (pt, i) {
        return (i ? 'L' : 'M') + x(pt.hand).toFixed(1) + ' ' + y(pt.chips).toFixed(1);
      }).join(' ');
      add('path', {
        d: d, fill: 'none', stroke: s.color,
        'stroke-width': s.hero ? 2.6 : 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        opacity: s.hero ? 1 : 0.85
      });
      const last = s.points[s.points.length - 1];
      add('circle', { cx: x(last.hand), cy: y(last.chips), r: 3, fill: s.color });
      /* 끝점 직접 라벨 (4개 이하일 때만 — 그 이상은 범례로) */
      if (series.length <= 4) {
        add('text', {
          x: x(last.hand) + 7, y: y(last.chips) + 4,
          class: 'series-label' + (s.hero ? ' hero' : '')
        }).textContent = s.name;
      }
    });

    /* 크로스헤어 + 툴팁 */
    const cross = add('line', { x1: 0, x2: 0, y1: PAD.t, y2: Hh - PAD.b, class: 'crosshair', opacity: 0 });
    const dots = series.map(function (s) {
      return add('circle', { r: 4.5, fill: s.color, stroke: 'var(--panel)', 'stroke-width': 2, opacity: 0 });
    });
    const tip = el('div', 'chart-tip');
    tip.hidden = true;
    wrap.appendChild(svg);
    wrap.appendChild(tip);

    svg.addEventListener('mousemove', function (ev) {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * W;
      if (px < PAD.l || px > W - PAD.r) { hideTip(); return; }
      const ratio = (px - PAD.l) / (W - PAD.l - PAD.r);
      const hand = Math.round(minHand + ratio * (maxHand - minHand));
      cross.setAttribute('x1', x(hand)); cross.setAttribute('x2', x(hand));
      cross.setAttribute('opacity', 1);
      const lines = [];
      series.forEach(function (s, i) {
        let best = null;
        for (let k = 0; k < s.points.length; k++) {
          if (s.points[k].hand <= hand) best = s.points[k]; else break;
        }
        if (!best) { dots[i].setAttribute('opacity', 0); return; }
        dots[i].setAttribute('cx', x(hand));
        dots[i].setAttribute('cy', y(best.chips));
        dots[i].setAttribute('opacity', 1);
        lines.push('<span class="k"><i style="background:' + s.color + '"></i>' + esc(s.name) +
          '</span><span class="v">' + num(best.chips) + '</span>');
      });
      tip.innerHTML = '<div class="tip-title">' + T('hist.handNo', { n: hand }) + '</div>' + lines.join('');
      tip.hidden = false;
      const left = Math.min(Math.max(0, (x(hand) / W) * rect.width - 60), rect.width - 130);
      tip.style.left = left + 'px';
      tip.style.top = '4px';
    });
    svg.addEventListener('mouseleave', hideTip);
    function hideTip() {
      cross.setAttribute('opacity', 0);
      dots.forEach(function (d) { d.setAttribute('opacity', 0); });
      tip.hidden = true;
    }

    /* 범례 (시리즈 2개 이상이면 항상) */
    if (series.length >= 2) {
      const legend = el('div', 'legend');
      series.forEach(function (s) {
        const item = el('span', 'legend-item' + (s.hero ? ' hero' : ''));
        const sw = el('i');
        sw.style.background = s.color;
        item.appendChild(sw);
        item.appendChild(document.createTextNode(s.name));
        legend.appendChild(item);
      });
      wrap.appendChild(legend);
    }
    return wrap;
  }
  H.panels.chipChart = chipChart;


  /* ==================== 핸드 히스토리 ==================== */
  H.panels.renderHistory = function (recorder, host, heroId, onOpen) {
    host.innerHTML = '';
    if (!recorder.length()) {
      host.appendChild(el('p', 'empty', T('hist.empty')));
      return;
    }
    const list = el('div', 'hist-list');
    recorder.hands.slice().reverse().forEach(function (hand) {
      const net = recorder.netOf(hand, heroId);
      const row = el('button', 'hist-row' + (net > 0 ? ' win' : net < 0 ? ' lose' : ''));
      row.type = 'button';
      const head = el('div', 'hist-head');
      head.appendChild(el('span', 'hist-no', T('hist.handNo', { n: hand.no })));
      head.appendChild(el('span', 'hist-net', (net > 0 ? '+' : '') + num(net)));
      row.appendChild(head);

      const board = el('div', 'hist-board');
      if (hand.community.length) {
        hand.community.forEach(function (c) { board.appendChild(miniCard(c)); });
      } else {
        board.appendChild(el('span', 'muted', T('street.preflop')));
      }
      row.appendChild(board);

      const seat = hand.seats.filter(function (s) { return s.id === heroId; })[0];
      if (seat && seat.cards.length) {
        const mine = el('div', 'hist-mine');
        seat.cards.forEach(function (c) { mine.appendChild(miniCard(c)); });
        mine.appendChild(el('span', 'muted', seat.position));
        row.appendChild(mine);
      }
      row.addEventListener('click', function () { onOpen(hand); });
      list.appendChild(row);
    });
    host.appendChild(list);
  };

  /* ==================== 프리플랍 차트 ==================== */
  H.panels.renderChart = function (host, state) {
    host.innerHTML = '';
    const R = H.ranges;
    /* 이 테이블 인원에 등장하는 포지션만 (6인: 6개, 9인: 9개) */
    const positions = R.POSITION_ORDER.filter(function (p) {
      return R.positionsFor(state.playerCount || 6).indexOf(p) >= 0;
    });
    if (positions.indexOf(state.position) < 0) state.position = positions[0];
    const bar = el('div', 'chart-controls');
    positions.forEach(function (pos) {
      const b = el('button', 'pos-btn' + (state.position === pos ? ' on' : ''), T('pos.' + pos));
      b.type = 'button';
      b.addEventListener('click', function () {
        state.position = pos;
        state.userPicked = true;   // 내 포지션으로 되돌아가지 않게 한다
        H.panels.renderChart(host, state);
      });
      bar.appendChild(b);
    });
    host.appendChild(bar);

    const n = state.playerCount || 6;
    /* 솔버 표가 있으면 오픈 빈도(혼합 전략)를 음영으로, 없으면 휴리스틱 임계값 */
    const solver = H.preflop && H.preflop.available() ? H.preflop.weights(n, state.position, 'open', 'raise') : null;
    let openPct = R.openPercent(state.position, n);
    if (solver) {
      let mass = 0;
      for (let i = 0; i < solver.length; i++) mass += solver[i] * R.INFO[R.RANKED[i][0]].combos;
      openPct = mass / 1326;
    }
    host.appendChild(el('p', 'chart-note',
      T('pos.' + state.position) + ' · ' + T('chart.pct', { pct: Math.round(openPct * 100) }) +
      (solver ? ' · ' + T('chart.solver') : '')));

    const grid = el('div', 'range-grid');
    R.chartGrid().forEach(function (row) {
      row.forEach(function (key) {
        const info = R.INFO[key];
        const f = solver ? solver[info.index] : (info.pct <= openPct ? 1 : 0);
        const cell = el('div', 'range-cell' + (f >= 0.67 ? ' in' : f > 0.05 ? ' mix' : ''), key);
        if (f > 0.05 && f < 0.67) cell.style.setProperty('--f', f.toFixed(2));
        if (state.heroKey === key) cell.classList.add('mine');
        cell.title = key + ' · ' + T('chart.pct', { pct: (info.pct * 100).toFixed(1) }) +
          (solver ? ' · ' + T('chart.freq', { pct: Math.round(f * 100) }) : '');
        grid.appendChild(cell);
      });
    });
    host.appendChild(grid);

    const legend = el('div', 'legend');
    const a = el('span', 'legend-item');
    const ai = el('i'); ai.className = 'sw-in'; a.appendChild(ai);
    a.appendChild(document.createTextNode(T('chart.inRange')));
    const b2 = el('span', 'legend-item');
    const bi = el('i'); bi.className = 'sw-out'; b2.appendChild(bi);
    b2.appendChild(document.createTextNode(T('chart.outRange')));
    legend.appendChild(a);
    if (solver) {
      const m = el('span', 'legend-item');
      const mi = el('i'); mi.className = 'sw-mix'; m.appendChild(mi);
      m.appendChild(document.createTextNode(T('chart.mixed')));
      legend.appendChild(m);
    }
    legend.appendChild(b2);
    if (state.heroKey) {
      const c = el('span', 'legend-item');
      const ci = el('i'); ci.className = 'sw-mine'; c.appendChild(ci);
      c.appendChild(document.createTextNode(T('chart.yourHand') + ' ' + state.heroKey));
      legend.appendChild(c);
    }
    host.appendChild(legend);
  };

  /* ==================== 약점 프로파일 ==================== */
  function spotLabel(key) {
    const parts = key.split('/');
    return T('street.' + parts[0]) + ' · ' + T('spot.' + parts[1]);
  }
  H.panels.spotLabel = spotLabel;

  function bbText(v) { return T('learn.avgBb', { avg: v.toFixed(2) }); }

  function drillButton(key, onDrill) {
    const b = el('button', 'mini-btn', T('learn.drillThis'));
    b.type = 'button';
    b.setAttribute('aria-label', T('learn.drillThis') + ': ' + spotLabel(key));
    b.addEventListener('click', function () { onDrill(key); });
    return b;
  }

  H.panels.renderLearn = function (profile, host, opts) {
    opts = opts || {};
    const onDrill = opts.onDrill || function () {};
    host.innerHTML = '';
    host.appendChild(el('h4', 'panel-sub', T('learn.title')));

    const target = profile.drillTarget();
    const actions = el('div', 'learn-actions');
    const weakBtn = el('button', 'act gold', T('learn.drillWeakest'));
    weakBtn.type = 'button';
    weakBtn.id = 'btnDrillWeakest';
    weakBtn.disabled = !target;
    weakBtn.addEventListener('click', function () { onDrill(target); });
    const anyBtn = el('button', 'act', T('learn.drillAny'));
    anyBtn.type = 'button';
    anyBtn.id = 'btnDrillAny';
    anyBtn.addEventListener('click', function () { onDrill(null); });
    actions.appendChild(weakBtn);
    actions.appendChild(anyBtn);
    host.appendChild(actions);

    if (!profile.decisions) {
      host.appendChild(el('p', 'empty', T('learn.empty')));
      return;
    }

    host.appendChild(el('div', 'learn-summary', T('learn.summary', {
      hands: profile.hands, n: profile.decisions,
      avg: (profile.loss / profile.decisions).toFixed(2)
    })));

    /* 가장 약한 자리 (표본이 충분한 곳만) */
    const weak = profile.weakSpots().slice(0, 3);
    if (weak.length) {
      host.appendChild(el('h4', 'panel-sub', T('learn.weakest')));
      weak.forEach(function (r) {
        const card = el('div', 'weak-card');
        card.appendChild(el('span', 'wk-name', spotLabel(r.key)));
        card.appendChild(el('span', 'wk-avg', bbText(r.avg)));
        if (r.drillN) {
          card.appendChild(el('span', 'wk-drill', T('learn.drillAvg', { n: r.drillN, avg: r.drillAvg.toFixed(2) })));
        }
        card.appendChild(drillButton(r.key, onDrill));
        host.appendChild(card);
      });
    } else {
      host.appendChild(el('p', 'learn-note', T('learn.fewSamples', { n: H.profile.MIN_SAMPLE })));
    }

    /* 자리별 표 */
    function table(title, rows, withDrill) {
      host.appendChild(el('h4', 'panel-sub', title));
      const t = el('table', 'stats-table learn-table');
      const thead = el('thead');
      const hr = el('tr');
      hr.appendChild(el('th', 'spot-col', ''));
      hr.appendChild(el('th', null, T('learn.colN')));
      hr.appendChild(el('th', null, T('learn.colAvg')));
      hr.appendChild(el('th', null, T('learn.colMistakes')));
      if (withDrill) hr.appendChild(el('th', null, ''));
      thead.appendChild(hr);
      t.appendChild(thead);
      const tbody = el('tbody');
      rows.forEach(function (r) {
        const tr = el('tr');
        tr.appendChild(el('td', 'spot-col', withDrill ? spotLabel(r.key) : T('pos.' + r.key)));
        tr.appendChild(el('td', null, String(r.n)));
        const avg = el('td', r.avg > 0.6 ? 'neg' : r.avg < 0.15 ? 'pos' : null, r.avg.toFixed(2));
        if (r.drillN) avg.title = T('learn.drillAvg', { n: r.drillN, avg: r.drillAvg.toFixed(2) });
        tr.appendChild(avg);
        tr.appendChild(el('td', null, Math.round(r.mistakeRate * 100) + '%'));
        if (withDrill) {
          const td = el('td', 'drill-col');
          td.appendChild(drillButton(r.key, onDrill));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      t.appendChild(tbody);
      const wrap = el('div', 'stats-wrap');
      wrap.appendChild(t);
      host.appendChild(wrap);
    }
    table(T('learn.bySpot'), profile.table().filter(function (r) { return r.n > 0; }), true);
    table(T('learn.byPos'), profile.byPosition().filter(function (r) { return r.n > 0; }), false);

    /* 최근 실수 */
    if (profile.recent.length) {
      host.appendChild(el('h4', 'panel-sub', T('learn.recent')));
      profile.recent.slice(-8).reverse().forEach(function (m) {
        const row = el('div', 'recent-row');
        const cards = el('span', 'rc-cards');
        m.cards.forEach(function (c) { cards.appendChild(miniCardStr(c)); });
        if (m.board.length) {
          cards.appendChild(el('span', 'muted', ' | '));
          m.board.forEach(function (c) { cards.appendChild(miniCardStr(c)); });
        }
        row.appendChild(cards);
        row.appendChild(el('span', 'rc-spot', spotLabel(m.key) + (m.pos ? ' · ' + T('pos.' + m.pos) : '')));
        row.appendChild(el('span', 'rc-line',
          H.review.actionLabel(m.chosen) + ' → ' + H.review.actionLabel(m.best)));
        row.appendChild(el('span', 'rc-loss', '-' + m.lossBb.toFixed(1) + ' bb'));
        host.appendChild(row);
      });
    }

    const reset = el('button', 'mini-btn danger', T('learn.reset'));
    reset.type = 'button';
    reset.id = 'btnProfileReset';
    reset.style.marginTop = '12px';
    reset.addEventListener('click', function () { if (opts.onReset) opts.onReset(); });
    host.appendChild(reset);
  };

  function miniCardStr(str) {
    const c = H.cards.parseCard(str);
    const m = el('span', 'mini-card' + (H.cards.isRed(c) ? ' red' : ''));
    m.textContent = H.cards.RANK_LABEL[c.rank] + H.cards.SUIT_LABEL[c.suit];
    return m;
  }

  /* ==================== 드릴 피드백 ==================== */
  H.panels.renderDrillFeedback = function (item, session, host, opts) {
    opts = opts || {};
    host.innerHTML = '';
    const v = el('div', 'drill-verdict v-' + item.verdict);
    v.appendChild(el('span', 'rv-icon', item.verdictIcon));
    v.appendChild(el('span', null, item.verdictText));
    if (item.evLossBb >= 0.15) {
      v.appendChild(el('span', 'rv-loss', T('drill.loss', { bb: item.evLossBb.toFixed(1) })));
    }
    host.appendChild(v);
    host.appendChild(el('div', 'drill-explain', item.explanation || H.review.explain(item)));
    if (item.best.type !== item.chosen.type || item.best.amount !== item.chosen.amount) {
      host.appendChild(el('div', 'drill-best', T('drill.bestWas', { action: H.review.actionLabel(item.best) })));
    }
    const cands = el('div', 'drill-cands');
    cands.setAttribute('aria-label', T('drill.options'));
    const same = function (a, b) { return a.type === b.type && (a.amount || 0) === (b.amount || 0); };
    const shown = item.candidates.slice(0, 3);
    item.candidates.forEach(function (c) {
      if ((same(c, item.best) || same(c, item.chosen)) && shown.indexOf(c) < 0) shown.push(c);
    });
    shown.sort(function (a, b) { return b.ev - a.ev; });
    shown.forEach(function (c) {
      const isBest = same(c, item.best);
      const isMine = same(c, item.chosen);
      const chip = el('span', 'drill-cand' + (isBest ? ' best' : '') + (isMine ? ' mine' : ''),
        H.review.actionLabel(c) + ' · ' + (c.ev >= 0 ? '+' : '') + num(c.ev));
      cands.appendChild(chip);
    });
    host.appendChild(cands);
    if (session) {
      host.appendChild(el('div', 'drill-session', T('drill.summary', {
        asked: session.asked, correct: session.correct(), bb: session.lossBb.toFixed(1)
      })));
    }
  };

  /* ==================== 핸드 리뷰 ==================== */
  H.panels.renderReview = function (summary, host) {
    host.innerHTML = '';
    if (!summary || !summary.items.length) {
      host.appendChild(el('p', 'empty', T('review.noData')));
      return;
    }
    const head = el('div', 'review-head' + (summary.total > 0 ? ' loss' : ' clean'), summary.text);
    host.appendChild(head);

    summary.items.forEach(function (it) {
      const row = el('div', 'review-row v-' + it.verdict);
      const top = el('div', 'review-top');
      top.appendChild(el('span', 'rv-icon', it.verdictIcon));
      top.appendChild(el('span', 'rv-street', T('street.' + it.street)));
      top.appendChild(el('span', 'rv-action',
        T('review.yourAction', { action: H.review.actionLabel(it.chosen) })));
      if (it.evLoss > 0.15 * it.bb) {
        top.appendChild(el('span', 'rv-loss', '-' + num(it.evLoss)));
      }
      row.appendChild(top);

      const detail = el('div', 'review-detail');
      detail.appendChild(el('span', null, H.review.explain(it)));
      if (it.best && (it.best.type !== it.chosen.type || it.best.amount !== it.chosen.amount)) {
        detail.appendChild(el('span', 'rv-best', '→ ' + H.review.actionLabel(it.best)));
      }
      row.appendChild(detail);

      if (it.draws && it.draws.outs > 0) {
        row.appendChild(el('div', 'review-draws',
          T('ctl.outs', {
            n: it.draws.outs,
            name: it.draws.labels[0] || '',
            pct: Math.round(it.draws.byRiver * 100)
          })));
      }
      host.appendChild(row);
    });
  };

  /* ==================== 리플레이 ==================== */
  H.panels.createReplay = function (hand, host) {
    const steps = H.history.buildReplay(hand);
    let idx = 0;
    host.innerHTML = '';

    const title = el('h3', null, T('hist.handNo', { n: hand.no }) + ' · ' + hand.sb + '/' + hand.bb);
    host.appendChild(title);

    const board = el('div', 'replay-board');
    const potEl = el('div', 'replay-pot');
    const seatsEl = el('div', 'replay-seats');
    const labelEl = el('div', 'replay-label');
    host.appendChild(potEl);
    host.appendChild(board);
    host.appendChild(seatsEl);
    host.appendChild(labelEl);

    const nav = el('div', 'replay-nav');
    const prev = el('button', 'act', T('hist.prev'));
    const pos = el('span', 'replay-pos');
    const next = el('button', 'act', T('hist.next'));
    prev.type = next.type = 'button';
    nav.appendChild(prev); nav.appendChild(pos); nav.appendChild(next);
    host.appendChild(nav);

    function draw() {
      const s = steps[idx];
      potEl.textContent = T('table.pot') + ' ' + num(s.pot);
      board.innerHTML = '';
      if (!s.community.length) {
        // 프리플랍에는 보드가 비어 빈 칸처럼 보이므로 스트리트 이름을 대신 둔다
        board.appendChild(el('span', 'replay-preflop', T('street.preflop')));
      } else {
        s.community.forEach(function (c) {
          const card = el('div', 'card small');
          card.dataset.suit = c.suit;
          card.appendChild(H.cardart.face(c, { compact: true }));
          board.appendChild(card);
        });
      }
      seatsEl.innerHTML = '';
      hand.seats.forEach(function (seat) {
        const folded = hand.actions.some(function (a) {
          return a.playerId === seat.id && a.type === 'fold'
            && stepIndexOf(a) <= idx;
        });
        const row = el('div', 'replay-seat' + (folded ? ' folded' : '') +
          (s.actor === seat.id ? ' active' : ''));
        row.appendChild(el('span', 'rs-name', seat.name + ' (' + seat.position + ')'));
        const cards = el('span', 'rs-cards');
        const reveal = s.reveal || seat.isHuman;
        seat.cards.forEach(function (c) {
          const mini = el('span', 'mini-card' + (H.cards.isRed(c) ? ' red' : ''));
          mini.textContent = reveal
            ? H.cards.RANK_LABEL[c.rank] + H.cards.SUIT_LABEL[c.suit]
            : '░░';
          cards.appendChild(mini);
        });
        row.appendChild(cards);
        const bet = s.bets[seat.id] || 0;
        row.appendChild(el('span', 'rs-bet', bet ? num(bet) : ''));
        seatsEl.appendChild(row);
      });
      labelEl.textContent = s.label;
      pos.textContent = (idx + 1) + ' / ' + steps.length;
      prev.disabled = idx === 0;
      next.disabled = idx === steps.length - 1;
    }
    function stepIndexOf(action) {
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].actor === action.playerId && steps[i].kind === action.type
          && steps[i].street === action.street) return i;
      }
      return Infinity;
    }

    prev.addEventListener('click', function () { if (idx > 0) { idx--; draw(); } });
    next.addEventListener('click', function () { if (idx < steps.length - 1) { idx++; draw(); } });
    draw();
    return {
      next: function () { if (idx < steps.length - 1) { idx++; draw(); } },
      prev: function () { if (idx > 0) { idx--; draw(); } }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
