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
  /* 현재 핸드 탭: 이번 핸드의 로그만 (지난 핸드는 리뷰 탭의 과거 핸드에서 리플레이) */
  H.panels.renderLog = function (game, host, opts) {
    host.innerHTML = '';
    const list = el('div', 'loglist');
    let entries = game.log.slice(-200);
    if (opts && opts.currentHand) {
      let start = 0;
      for (let i = entries.length - 1; i >= 0; i--) { if (entries[i].kind === 'hand') { start = i; break; } }
      entries = entries.slice(start);
    }
    entries.forEach(function (e) {
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

  H.panels.renderStats = function (tracker, game, host, heroId, session) {
    host.innerHTML = '';
    /* 세션 성과 요약: 핸드 수 · EV 손실 · 가장 큰 누수 (학습 통계는 훈련 탭에) */
    if (session && session.hands) {
      const box = el('div', 'session-box');
      box.appendChild(el('div', 'ls-label', T('stats.session')));
      const line = el('div', 'session-line');
      line.appendChild(el('b', null, session.hands + ' ' + T('stats.hands')));
      line.appendChild(el('span', session.lossBb >= 1 ? 'neg' : null, T('stats.sessionLoss', { bb: (session.lossBb > 0 ? '-' : '') + session.lossBb.toFixed(1) })));
      let worstKey = null, worstLoss = 0;
      Object.keys(session.byKey || {}).forEach(function (k) { if (session.byKey[k] > worstLoss) { worstLoss = session.byKey[k]; worstKey = k; } });
      line.appendChild(el('span', 'muted', worstKey && worstLoss >= 0.6 ? T('stats.biggestLeak', { spot: spotLabel(worstKey) }) : T('stats.noLeak')));
      box.appendChild(line);
      host.appendChild(box);
    }
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
  /*
   * 핸드 히스토리 = 복기 큐. 필터(전체 · 큰 손실 · 승리 · 패배), 자동 태그, 카드마다 리뷰 · 리플레이 · 드릴 생성.
   */
  const HIST_FILTERS = ['all', 'loss', 'win', 'lose'];
  H.panels.renderHistory = function (recorder, host, heroId, onOpen, opts) {
    opts = opts || {};
    host.innerHTML = '';
    if (!recorder.length()) {
      host.appendChild(el('p', 'empty', T('hist.empty')));
      return;
    }
    const filter = opts.filter || 'all';
    const bar = el('div', 'hist-filters');
    HIST_FILTERS.forEach(function (f) {
      const b = el('button', 'flt-btn' + (f === filter ? ' on' : ''), T('hist.filter.' + f));
      b.type = 'button'; b.dataset.filter = f;
      b.addEventListener('click', function () { if (opts.onFilter) opts.onFilter(f); });
      bar.appendChild(b);
    });
    host.appendChild(bar);

    const list = el('div', 'hist-list');
    let shown = 0;
    recorder.hands.slice().reverse().forEach(function (hand) {
      const net = recorder.netOf(hand, heroId);
      const items = hand.review || [];
      const lossBb = items.reduce(function (a, it) { return a + (it.evLossBb || 0); }, 0);
      if (filter === 'loss' && lossBb < 0.6) return;
      if (filter === 'win' && net <= 0) return;
      if (filter === 'lose' && net >= 0) return;
      shown++;
      const row = el('div', 'hist-row' + (net > 0 ? ' win' : net < 0 ? ' lose' : ''));
      const head = el('div', 'hist-head');
      head.appendChild(el('span', 'hist-no', T('hist.handNo', { n: hand.no })));
      if (items.length) head.appendChild(el('span', 'hist-ev' + (lossBb >= 0.6 ? ' bad' : ''), T('hist.evLoss', { bb: (lossBb > 0 ? '-' : '') + lossBb.toFixed(1) })));
      head.appendChild(el('span', 'hist-net', (net > 0 ? '+' : '') + num(net)));
      row.appendChild(head);

      const board = el('div', 'hist-board');
      const seat = hand.seats.filter(function (x) { return x.id === heroId; })[0];
      if (seat && seat.cards.length) {
        seat.cards.forEach(function (c) { board.appendChild(miniCard(c)); });
        board.appendChild(el('span', 'muted', ' | '));
      }
      if (hand.community.length) hand.community.forEach(function (c) { board.appendChild(miniCard(c)); });
      else board.appendChild(el('span', 'muted', T('street.preflop')));
      row.appendChild(board);

      /* 한 줄 요약: 포지션 · 스트리트별 내 액션 · 태그 */
      const sub = el('div', 'hist-sub');
      if (seat) sub.appendChild(el('span', 'hist-pos', seat.position));
      const line = [];
      items.forEach(function (it) { line.push(T('street.' + it.street) + ' ' + H.review.actionLabel(it.chosen)); });
      if (line.length) sub.appendChild(el('span', 'hist-line', line.join(' · ')));
      row.appendChild(sub);
      const tags = H.review.tagsOf(items);
      if (tags.length) {
        const tg = el('div', 'hist-tags');
        tags.forEach(function (t) { tg.appendChild(el('span', 'hist-tag ' + t, T('hist.tag.' + t))); });
        row.appendChild(tg);
      }

      const acts = el('div', 'hist-actions');
      if (items.length && opts.onReview) {
        const b = el('button', 'mini-btn', T('hist.review')); b.type = 'button';
        b.addEventListener('click', function () { opts.onReview(hand); });
        acts.appendChild(b);
      }
      const rb = el('button', 'mini-btn', T('hist.replay')); rb.type = 'button'; rb.className = 'mini-btn hist-replay';
      rb.addEventListener('click', function () { if (onOpen) onOpen(hand); });
      acts.appendChild(rb);
      if (items.length && opts.onDrill) {
        let worst = items[0];
        items.forEach(function (it) { if (it.evLossBb > worst.evLossBb) worst = it; });
        if (worst.evLossBb >= 0.15) {
          const b = el('button', 'mini-btn', T('hist.drill')); b.type = 'button';
          b.addEventListener('click', function () { opts.onDrill(worst.street + '/' + worst.spot); });
          acts.appendChild(b);
        }
      }
      row.appendChild(acts);
      list.appendChild(row);
    });
    if (!shown) list.appendChild(el('p', 'empty', T('hist.noneFiltered')));
    host.appendChild(list);
  };

  /* ==================== 프리플랍 차트 ==================== */
  /*
   * 레인지 차트. 상황(오픈 · 오픈 직면 · 3벳 직면) × 포지션. 솔버 표가 있으면 셀마다 폴드/콜/레이즈
   * 빈도를 4색으로 — 주 액션이 배경, 혼합은 아래 비율 띠. 셀을 누르면 빈도 팝오버.
   */
  const CHART_SITS = ['open', 'vsOpen', 'vs3bet'];
  H.panels.renderChart = function (host, state) {
    host.innerHTML = '';
    const R = H.ranges;
    const positions = R.POSITION_ORDER.filter(function (p) {
      return R.positionsFor(state.playerCount || 6).indexOf(p) >= 0;
    });
    if (positions.indexOf(state.position) < 0) state.position = positions[0];
    if (CHART_SITS.indexOf(state.situation) < 0) state.situation = 'open';
    const n = state.playerCount || 6;
    const hasSolver = H.preflop && H.preflop.available();

    const sits = el('div', 'chart-sits');
    CHART_SITS.forEach(function (sit) {
      const b = el('button', 'sit-btn' + (state.situation === sit ? ' on' : ''), T('chart.sit.' + sit));
      b.type = 'button'; b.dataset.sit = sit;
      b.disabled = !hasSolver && sit !== 'open';
      b.addEventListener('click', function () { state.situation = sit; state.picked = null; H.panels.renderChart(host, state); });
      sits.appendChild(b);
    });
    host.appendChild(sits);
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

    /* 오픈 직면 · 3벳 직면은 상대 포지션이 필요하다 (표는 'vsOpen:BTN' 처럼 상대별) */
    const sit = state.situation;
    let sitKey = sit, vsOpts = [];
    if (sit !== 'open' && hasSolver) {
      vsOpts = H.preflop.situations(n, state.position)
        .filter(function (k) { return k.indexOf(sit + ':') === 0; })
        .map(function (k) { return k.split(':')[1]; })
        .sort(function (a, b) { return R.POSITION_ORDER.indexOf(a) - R.POSITION_ORDER.indexOf(b); });
      if (vsOpts.length) {
        if (vsOpts.indexOf(state.vsPos) < 0) state.vsPos = vsOpts.indexOf('BTN') >= 0 ? 'BTN' : vsOpts[vsOpts.length - 1];
        sitKey = sit + ':' + state.vsPos;
        const vbar = el('div', 'chart-vs');
        vbar.appendChild(el('span', 'chart-vs-label', T('chart.vsLabel')));
        vsOpts.forEach(function (vp) {
          const b = el('button', 'sit-btn vs-btn' + (state.vsPos === vp ? ' on' : ''), T('pos.' + vp));
          b.type = 'button'; b.dataset.vs = vp;
          b.addEventListener('click', function () { state.vsPos = vp; state.picked = null; H.panels.renderChart(host, state); });
          vbar.appendChild(b);
        });
        host.appendChild(vbar);
      }
    }
    const raiseW = hasSolver ? H.preflop.weights(n, state.position, sitKey, 'raise') : null;
    const callW = hasSolver ? H.preflop.weights(n, state.position, sitKey, 'call') : null;
    const solver = !!(raiseW && callW);
    const raiseIsThree = sit !== 'open';
    const sitLabel = T('chart.sit.' + sit) + (sit !== 'open' && solver ? ' (' + T('pos.' + state.vsPos) + ')' : '');
    let openPct = R.openPercent(state.position, n);
    if (solver) {
      let mass = 0;
      for (let i = 0; i < raiseW.length; i++) mass += (raiseW[i] + callW[i]) * R.INFO[R.RANKED[i][0]].combos;
      openPct = mass / 1326;
    }
    host.appendChild(el('p', 'chart-note',
      T('chart.ctx', { pos: T('pos.' + state.position), sit: sitLabel, n: n }) + ' · ' + T('chart.stack') + ' · ' +
      T('chart.pct', { pct: Math.round(openPct * 100) }) + (solver ? ' · ' + T('chart.solver') : '')));
    if (!solver && sit !== 'open') host.appendChild(el('p', 'learn-note', T('chart.noSolverSit')));

    const grid = el('div', 'range-grid');
    R.chartGrid().forEach(function (row) {
      row.forEach(function (key) {
        const info = R.INFO[key];
        let r, c;
        if (solver) { r = raiseW[info.index]; c = callW[info.index]; }
        else { r = info.pct <= openPct ? 1 : 0; c = 0; }
        const f = r + c;
        const main = f < 0.05 ? 'fold' : (r >= c ? 'raise' : 'call');
        let cls = 'range-cell';
        if (main === 'raise') cls += f >= 0.67 ? ' in' : ' mix';
        else if (main === 'call') cls += f >= 0.67 ? ' act-call' : ' mix';
        if (raiseIsThree && main === 'raise' && f >= 0.67) cls = 'range-cell act-three';
        const cell = el('div', cls, key);
        if (main !== 'fold' && f < 0.67) cell.style.setProperty('--f', f.toFixed(2));
        if (solver && f >= 0.05 && (r > 0.05 && c > 0.05 || f < 0.95)) {
          const barEl = el('div', 'rc-bar');
          if (r > 0.02) { const i1 = el('i', raiseIsThree ? 'b-three' : 'b-raise'); i1.style.width = Math.round(r * 100) + '%'; barEl.appendChild(i1); }
          if (c > 0.02) { const i2 = el('i', 'b-call'); i2.style.width = Math.round(c * 100) + '%'; barEl.appendChild(i2); }
          cell.appendChild(barEl);
        }
        if (state.heroKey === key) cell.classList.add('mine');
        if (state.picked === key) cell.classList.add('picked');
        cell.title = key + ' · ' + T('chart.pct', { pct: (info.pct * 100).toFixed(1) });
        cell.addEventListener('click', function () { state.picked = state.picked === key ? null : key; H.panels.renderChart(host, state); });
        grid.appendChild(cell);
      });
    });
    host.appendChild(grid);

    /* 팝오버: 고른 셀의 빈도 */
    if (state.picked) {
      const info = R.INFO[state.picked];
      const fq = solver ? H.preflop.freq(n, state.position, sitKey, state.picked) : { raise: info.pct <= openPct ? 1 : 0, call: 0, fold: info.pct <= openPct ? 0 : 1 };
      const pop = el('div', 'range-pop');
      pop.appendChild(el('div', 'rp-key', state.picked + ' · ' + T('chart.pct', { pct: (info.pct * 100).toFixed(1) })));
      const rows = [['fold', fq.fold], [raiseIsThree ? (sit === 'vs3bet' ? 'fourBet' : 'threeBet') : 'raise', fq.raise]];
      if (sit !== 'open') rows.splice(1, 0, ['call', fq.call]);
      rows.forEach(function (rw) {
        const line = el('div', 'rp-row');
        line.appendChild(el('span', null, T('chart.' + rw[0])));
        line.appendChild(el('b', null, Math.round(rw[1] * 100) + '%'));
        pop.appendChild(line);
      });
      pop.appendChild(el('div', 'rp-ctx', T('chart.ctx', { pos: T('pos.' + state.position), sit: sitLabel, n: n }) + ' · ' + T('chart.stack')));
      host.appendChild(pop);
    } else {
      host.appendChild(el('p', 'learn-note', T('chart.pickHint')));
    }

    const legend = el('div', 'legend');
    const item = function (cls, text) {
      const a = el('span', 'legend-item'); const i = el('i'); i.className = cls; a.appendChild(i);
      a.appendChild(document.createTextNode(text)); legend.appendChild(a);
    };
    item(raiseIsThree ? 'sw-three' : 'sw-in', raiseIsThree ? T(sit === 'vs3bet' ? 'chart.fourBet' : 'chart.threeBet') : T('chart.raise'));
    if (sit !== 'open') item('sw-call', T('chart.call'));
    if (solver) item('sw-mix', T('chart.mixed'));
    item('sw-out', T('chart.fold'));
    if (state.heroKey) item('sw-mine', T('chart.yourHand') + ' ' + state.heroKey);
    host.appendChild(legend);
  };

  /* ==================== 약점 프로파일 ==================== */
  function spotLabel(key) {
    const parts = key.split('/');
    return T('street.' + parts[0]) + ' · ' + T('spot.' + parts[1]);
  }
  H.panels.spotLabel = spotLabel;

  function bbText(v) { return T('learn.avgBb', { avg: v.toFixed(2) }); }

  /* 리크 심각도 배지 — 색과 글자 둘 다 (색만으로 구분하지 않는다) */
  function sevBadge(avg) {
    const sev = H.profile.severity(avg);
    return el('span', 'sev ' + sev, T('learn.severity.' + sev));
  }
  H.panels.sevBadge = sevBadge;

  function drillButton(key, onDrill) {
    const b = el('button', 'mini-btn', T('learn.drillThis'));
    b.type = 'button';
    b.setAttribute('aria-label', T('learn.drillThis') + ': ' + spotLabel(key));
    b.addEventListener('click', function () { onDrill(key); });
    return b;
  }

  /* 개인화 드릴 카드: "BB · 플랍 벳에 직면 · 최근 20회 정확도 42% · 목표" */
  H.panels.renderDrillCard = function (card, host, onDrill, opts) {
    opts = opts || {};
    const box = el('div', 'drill-card');
    box.appendChild(el('div', 'dc-title', T('drill.card.title')));
    if (!card) {
      box.appendChild(el('p', 'learn-note', T('drill.card.none')));
      host.appendChild(box);
      return box;
    }
    const head = el('div', 'dc-head');
    head.appendChild(sevBadge(card.avg));
    head.appendChild(el('span', 'dc-spot', (card.pos ? T('pos.' + card.pos) + ' · ' : '') + spotLabel(card.key)));
    box.appendChild(head);
    box.appendChild(el('div', 'dc-acc', card.accuracy != null && card.n >= 3
      ? T('drill.card.acc', { n: card.n, pct: Math.round(card.accuracy * 100) })
      : T('drill.card.noAcc', { n: card.n })));
    box.appendChild(el('div', 'dc-goal', T('drill.card.goal', { goal: T(card.goal) })));
    if (!opts.noButton) {
      const b = el('button', 'act gold', T('drill.card.start')); b.type = 'button'; b.id = opts.id || 'btnDrillCard';
      b.addEventListener('click', function () { onDrill(card.key); });
      box.appendChild(b);
    }
    host.appendChild(box);
    return box;
  };

  /* 학습 통계: 최근 7일 드릴 정확도(추이) · 스트리트별 정확도 · 반복 실수 · 연속 학습일 */
  H.panels.renderLearnStats = function (profile, host) {
    const card = el('div', 'learn-stats');
    card.appendChild(el('h4', 'panel-sub', T('learn.stats')));
    const grid = el('div', 'ls-grid');
    const tile = function (label, value, sub) {
      const t = el('div', 'ls-tile');
      t.appendChild(el('div', 'ls-label', label));
      t.appendChild(el('div', 'ls-value', value));
      if (sub) t.appendChild(el('div', 'ls-sub', sub));
      grid.appendChild(t);
    };
    const wk = profile.weekAccuracy();
    tile(T('learn.week'), wk.now.asked ? T('learn.weekVal', { pct: Math.round(wk.now.pct * 100), n: wk.now.asked }) : T('learn.weekNone'),
      (wk.before.asked && wk.now.asked) ? T('learn.weekTrend', { before: Math.round(wk.before.pct * 100), now: Math.round(wk.now.pct * 100) }) : null);
    tile(T('learn.streak'), T('learn.streakVal', { n: profile.streak() }));
    card.appendChild(grid);
    const streets = profile.byStreetAccuracy().filter(function (r) { return r.n > 0; });
    if (streets.length) {
      card.appendChild(el('div', 'ls-label', T('learn.byStreet')));
      const rows = el('div', 'style-rows');
      streets.forEach(function (r) {
        const row = el('div', 'style-row ' + (r.acc >= 0.8 ? 's-ok' : r.acc >= 0.6 ? 's-high' : 's-low'));
        row.appendChild(el('span', 'sr-name', T('street.' + r.street)));
        const bar = el('div', 'sr-bar');
        const fill = el('div', 'sr-band'); fill.style.left = '0'; fill.style.width = Math.round(r.acc * 100) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el('span', 'sr-val', Math.round(r.acc * 100) + '%'));
        rows.appendChild(row);
      });
      card.appendChild(rows);
    }
    const rep = profile.repeatMistakes(3);
    if (rep.length) {
      card.appendChild(el('div', 'ls-label', T('learn.repeat')));
      const ul = el('ul', 'style-tips');
      rep.forEach(function (r) { ul.appendChild(el('li', null, spotLabel(r.key) + ' · ' + T('learn.repeatN', { n: r.n }))); });
      card.appendChild(ul);
    }
    host.appendChild(card);
  };

  H.panels.renderLearn = function (profile, host, opts) {
    opts = opts || {};
    const onDrill = opts.onDrill || function () {};
    host.innerHTML = '';
    /* 스타일 진단 (이번 세션이 있으면 그것, 없으면 저장된 것) · 오늘의 10문제 */
    if (opts.style) H.panels.renderStyle(opts.style, host, { hands: opts.styleHands || 0 });
    else if (profile.lastStyle) H.panels.renderStyle(profile.lastStyle, host, { saved: true });
    else H.panels.renderStyle(null, host, { hands: opts.styleHands || 0 });
    H.panels.renderDrillCard(profile.drillCard(), host, onDrill);
    H.panels.renderDaily(profile, host, { onDaily: opts.onDaily });
    if (profile.decisions || profile.drillLog.length) H.panels.renderLearnStats(profile, host);
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
        card.appendChild(sevBadge(r.avg));
        card.appendChild(el('span', 'wk-name', spotLabel(r.key)));
        card.appendChild(el('span', 'wk-avg', bbText(r.avg)));
        const bb = el('span', 'wk-bb', T('learn.bb100', { bb: '-' + r.bb100.toFixed(1) }));
        bb.title = T('learn.bb100Hint');
        card.appendChild(bb);
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
      hr.appendChild(el('th', null, ''));
      hr.appendChild(el('th', null, T('learn.colN')));
      hr.appendChild(el('th', null, T('learn.colAvg')));
      const bbTh = el('th', null, T('learn.colBb100'));
      bbTh.title = T('learn.bb100Hint');
      hr.appendChild(bbTh);
      hr.appendChild(el('th', null, T('learn.colMistakes')));
      if (withDrill) hr.appendChild(el('th', null, ''));
      thead.appendChild(hr);
      t.appendChild(thead);
      const tbody = el('tbody');
      rows.forEach(function (r) {
        const tr = el('tr');
        tr.appendChild(el('td', 'spot-col', withDrill ? spotLabel(r.key) : T('pos.' + r.key)));
        const sevTd = el('td', 'sev-col');
        sevTd.appendChild(sevBadge(r.avg));
        tr.appendChild(sevTd);
        tr.appendChild(el('td', null, String(r.n)));
        const avg = el('td', r.avg > 0.6 ? 'neg' : r.avg < 0.15 ? 'pos' : null, r.avg.toFixed(2));
        if (r.drillN) avg.title = T('learn.drillAvg', { n: r.drillN, avg: r.drillAvg.toFixed(2) });
        tr.appendChild(avg);
        tr.appendChild(el('td', r.bb100 >= 3 ? 'neg' : null, '-' + r.bb100.toFixed(1)));
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
    host.appendChild(whyLine(item));
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

  /* "왜" 한 줄 — 숫자 뒤의 개념 */
  function whyLine(item) {
    const w = el('div', 'why-line');
    w.appendChild(el('b', null, T('why.label')));
    w.appendChild(document.createTextNode(' ' + (item.reason || H.review.reason(item))));
    return w;
  }
  H.panels.whyLine = whyLine;

  /* ==================== 코치 (플레이 도중 생각 정리) ==================== */
  H.panels.renderCoach = function (item, host, opts) {
    opts = opts || {};
    host.innerHTML = '';
    const head = el('div', 'coach-head');
    head.appendChild(el('span', 'coach-title', T('coach.title')));
    const spot = item.spotInfo || { key: item.street + '/' + item.spot, pos: item.position };
    head.appendChild(el('span', 'coach-spot', spotLabel(spot.key) + ' · ' + T('pos.' + spot.pos)));
    host.appendChild(head);
    const facts = el('div', 'coach-facts');
    if (item.street === 'preflop' && item.handPct != null) {
      facts.appendChild(el('span', 'chip', T('coach.hand', { pct: Math.round(item.handPct * 100) })));
    }
    facts.appendChild(el('span', 'chip', T('ctl.equity', { pct: Math.round(item.equity * 100) })));
    if (item.potOdds > 0) facts.appendChild(el('span', 'chip', T('ctl.potOdds', { pct: Math.round(item.potOdds * 100) })));
    if (item.draws && item.draws.outs > 0) {
      facts.appendChild(el('span', 'chip', T('ctl.outs', { n: item.draws.outs, name: item.draws.labels[0] || '', pct: Math.round(item.draws.byRiver * 100) })));
    }
    host.appendChild(facts);
    host.appendChild(whyLine(item));
    host.appendChild(el('div', 'coach-best', T('coach.best', { action: H.review.actionLabel(item.best) })));
    const cands = el('div', 'drill-cands');
    item.candidates.slice().sort(function (a, b) { return b.ev - a.ev; }).slice(0, 4).forEach(function (c) {
      const isBest = c.type === item.best.type && (c.amount || 0) === (item.best.amount || 0);
      cands.appendChild(el('span', 'drill-cand' + (isBest ? ' best' : ''),
        H.review.actionLabel(c) + ' · ' + (c.ev >= 0 ? '+' : '') + num(c.ev)));
    });
    host.appendChild(cands);
    const foot = el('div', 'coach-foot');
    foot.appendChild(el('span', 'muted', T('coach.note')));
    const close = el('button', 'mini-btn', T('coach.close'));
    close.type = 'button';
    close.id = 'btnCoachClose';
    close.addEventListener('click', function () { if (opts.onClose) opts.onClose(); });
    foot.appendChild(close);
    host.appendChild(foot);
  };

  /* ==================== 플레이 스타일 진단 ==================== */
  function fmtStat(v, fmt) { return fmt === 'pct' ? Math.round(v * 100) + '%' : v.toFixed(1); }

  /*
   * 4분면 차트: 가로 VPIP(타이트 → 루즈), 세로 공격성(PFR/VPIP, 패시브 → 어그레시브).
   * 경계선이 네 유형을 가르고, 탄탄한 범위는 초록 상자, 나는 금색 점. 한 점짜리 산점도라
   * 범례 대신 사분면 이름을 직접 적는다.
   */
  function quadrantChart(diag) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 260, Hh = 150, L = 34, R = 8, Tp = 8, B = 22;
    const pw = W - L - R, ph = Hh - Tp - B;
    const maxV = Math.max(0.6, Math.min(0.9, diag.bounds.vpipHi * 2));   // 축 끝: 루즈 경계의 두 배
    const x = function (v) { return L + Math.min(1, v / maxV) * pw; };
    const y = function (r) { return Tp + (1 - Math.min(1, r)) * ph; };
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    svg.setAttribute('class', 'style-quad');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', T('style.type.' + diag.type) + ' · VPIP ' + Math.round(diag.point.vpip * 100) + '%');
    const add = function (tag, attrs, text) {
      const n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    };
    add('rect', { x: L, y: Tp, width: pw, height: ph, rx: 6, 'class': 'q-bg' });
    const bx = x(diag.bounds.vpipHi), by = y(diag.bounds.ratioLo);
    add('line', { x1: bx, y1: Tp, x2: bx, y2: Tp + ph, 'class': 'q-line' });
    add('line', { x1: L, y1: by, x2: L + pw, y2: by, 'class': 'q-line' });
    /* 탄탄한 범위 */
    const vr = diag.bounds.vpipRange, rr = diag.bounds.ratioRange;
    add('rect', { x: x(vr[0]), y: y(rr[1]), width: x(vr[1]) - x(vr[0]), height: y(rr[0]) - y(rr[1]), rx: 3, 'class': 'q-zone' });
    add('text', { x: x(vr[1]) + 3, y: y(rr[1]) + 9, 'class': 'q-axis' }, T('style.target'));
    /* 사분면 이름 */
    const quads = [
      { key: 'tag', x: L + 6, y: Tp + 12, anchor: 'start' },
      { key: 'lag', x: L + pw - 6, y: Tp + 12, anchor: 'end' },
      { key: 'rock', x: L + 6, y: Tp + ph - 5, anchor: 'start' },
      { key: 'fish', x: L + pw - 6, y: Tp + ph - 5, anchor: 'end' }
    ];
    quads.forEach(function (q) {
      add('text', { x: q.x, y: q.y, 'text-anchor': q.anchor, 'class': 'q-label' + (q.key === diag.type ? ' on' : '') },
        H.style.TYPES[q.key].icon + ' ' + T('style.short.' + q.key));
    });
    /* 축 */
    add('text', { x: L, y: Hh - 6, 'text-anchor': 'start', 'class': 'q-axis' }, T('style.axisVpip'));
    add('text', { x: 10, y: Tp + ph / 2, 'text-anchor': 'middle', 'class': 'q-axis', transform: 'rotate(-90 10 ' + (Tp + ph / 2) + ')' }, T('style.axisAgg'));
    add('text', { x: bx, y: Hh - 6, 'text-anchor': 'middle', 'class': 'q-axis' }, Math.round(diag.bounds.vpipHi * 100) + '%');
    /* 나 */
    const px = x(diag.point.vpip), py = y(diag.point.ratio);
    add('circle', { cx: px, cy: py, r: 6, 'class': 'q-dot' });
    add('text', { x: px + (px > L + pw - 30 ? -9 : 9), y: py + 4, 'text-anchor': px > L + pw - 30 ? 'end' : 'start', 'class': 'q-you' }, T('style.you'));
    return svg;
  }
  H.panels.quadrantChart = quadrantChart;
  H.panels.renderStyle = function (diag, host, opts) {
    opts = opts || {};
    const card = el('div', 'style-card');
    card.appendChild(el('h4', 'panel-sub', T('style.title')));
    if (!diag) {
      card.appendChild(el('p', 'learn-note', T('style.need', { n: H.style.MIN_HANDS, h: opts.hands || 0 })));
      host.appendChild(card);
      return;
    }
    const conf = diag.confidence || (diag.hands >= 200 ? 'high' : diag.hands >= 60 ? 'mid' : 'low');
    const head = el('div', 'style-head');
    head.appendChild(el('span', 'style-icon', diag.icon));
    const names = el('div', 'style-names');
    if (conf === 'low') names.appendChild(el('div', 'style-est', T('style.estimated')));
    names.appendChild(el('div', 'style-type', T('style.type.' + diag.type)));
    names.appendChild(el('div', 'style-desc', T('style.typeDesc.' + diag.type)));
    head.appendChild(names);
    const score = el('div', 'style-score' + (diag.score >= 75 ? ' good' : diag.score < 45 ? ' bad' : ''));
    score.appendChild(el('b', null, String(diag.score)));
    score.appendChild(el('span', null, T('style.score', { score: '' }).trim()));
    head.appendChild(score);
    card.appendChild(head);
    card.appendChild(el('div', 'style-meta', (opts.saved ? T('style.saved') + ' · ' : '') + T('style.hands', { n: diag.hands })
      + ' · ' + T('style.confidence', { level: T('style.conf.' + conf) })));
    if (conf === 'low') card.appendChild(el('div', 'style-confnote', T('style.confNote', { n: diag.hands })));
    if (diag.point && diag.bounds) card.appendChild(quadrantChart(diag));

    /* 지표 막대: 기준 범위를 띠로, 내 값을 점으로 */
    const rows = el('div', 'style-rows');
    diag.rows.forEach(function (r) {
      const row = el('div', 'style-row s-' + r.status);
      row.appendChild(el('span', 'sr-name', T('style.stat.' + r.key)));
      const bar = el('div', 'sr-bar');
      const max = r.fmt === 'pct' ? 1 : 6;
      const band = el('div', 'sr-band');
      band.style.left = (r.lo / max * 100) + '%';
      band.style.width = ((r.hi - r.lo) / max * 100) + '%';
      bar.appendChild(band);
      if (r.status !== 'na') {
        const dot = el('div', 'sr-dot');
        dot.style.left = (Math.min(1, r.value / max) * 100) + '%';
        bar.appendChild(dot);
      }
      row.appendChild(bar);
      row.appendChild(el('span', 'sr-val', r.status === 'na' ? T('style.na') : fmtStat(r.value, r.fmt)));
      row.title = T('style.range', { lo: fmtStat(r.lo, r.fmt), hi: fmtStat(r.hi, r.fmt) });
      rows.appendChild(row);
    });
    card.appendChild(rows);
    if (diag.tips.length) {
      card.appendChild(el('div', 'style-tips-title', T('style.tips')));
      const ul = el('ul', 'style-tips');
      diag.tips.forEach(function (k) { ul.appendChild(el('li', null, T(k))); });
      card.appendChild(ul);
    }
    host.appendChild(card);
  };

  /* ==================== 오늘의 10문제 ==================== */
  H.panels.renderDaily = function (profile, host, opts) {
    opts = opts || {};
    const today = H.drill.dateKey();
    const rec = profile.dailyFor(today);
    const card = el('div', 'daily-card');
    card.appendChild(el('h4', 'panel-sub', T('daily.title')));
    card.appendChild(el('p', 'learn-note', T('daily.desc')));
    card.appendChild(el('div', 'daily-status' + (rec ? ' done' : ''), rec
      ? T('daily.done', { correct: rec.correct, asked: rec.asked, bb: rec.lossBb.toFixed(1) })
      : T('daily.todo')));
    const btn = el('button', 'act gold', rec ? T('daily.again') : T('daily.start'));
    btn.type = 'button';
    btn.id = 'btnDaily';
    btn.addEventListener('click', function () { if (opts.onDaily) opts.onDaily(); });
    card.appendChild(btn);
    const past = profile.daily.filter(function (d) { return d.date !== today; }).slice(0, 7);
    if (past.length) {
      card.appendChild(el('div', 'daily-hist-title', T('daily.history')));
      const list = el('div', 'daily-hist');
      past.forEach(function (d) {
        const row = el('div', 'daily-row');
        row.appendChild(el('span', 'dr-date', d.date.slice(5)));
        row.appendChild(el('span', 'dr-score', d.correct + '/' + d.asked));
        row.appendChild(el('span', 'dr-loss', '-' + d.lossBb.toFixed(1) + ' bb'));
        list.appendChild(row);
      });
      card.appendChild(list);
    }
    host.appendChild(card);
  };

  /* ==================== 리뷰 탭: 지난 핸드 리뷰 + 과거 핸드 ==================== */
  H.panels.renderReviewTab = function (summary, recorder, host, heroId, opts) {
    opts = opts || {};
    host.innerHTML = '';
    host.appendChild(el('h4', 'panel-sub', T('review.lastHand')));
    const box = el('div', 'review-tab-last');
    if (summary && summary.items.length) H.panels.renderReview(summary, box, opts);
    else box.appendChild(el('p', 'empty', T('review.noneYet')));
    host.appendChild(box);
    host.appendChild(el('h4', 'panel-sub', T('review.pastHands')));
    const past = el('div');
    H.panels.renderHistory(recorder, past, heroId, opts.onOpen, opts);
    host.appendChild(past);
  };

  /* ==================== 핸드 리뷰 ==================== */
  /*
   * 첫 화면은 "가장 중요한 학습 하나": 총 EV 손실 → 핵심 누수(가장 큰 손실 결정)와 권장·이유 →
   * 타임라인(3단계 Best · Fine · Leak, 핵심 누수만 펼침) → 레인지 보기 · 유사 상황 훈련
   */
  H.panels.renderReview = function (summary, host, opts) {
    opts = opts || {};
    host.innerHTML = '';
    if (!summary || !summary.items.length) {
      host.appendChild(el('p', 'empty', T('review.noData')));
      return;
    }
    const worst = summary.worst;
    const head = el('div', 'review-hero' + (summary.total > 0 ? ' loss' : ' clean'));
    const total = el('div', 'rh-total');
    total.appendChild(el('span', 'rh-label', T('review.evTotal')));
    total.appendChild(el('b', 'rh-num', (summary.totalBb > 0 ? '-' : '') + summary.totalBb.toFixed(1) + ' bb'));
    head.appendChild(total);
    if (worst) {
      const leak = el('div', 'rh-leak');
      leak.appendChild(el('div', 'rh-label', T('review.keyLeak')));
      leak.appendChild(el('div', 'rh-spot', T('street.' + worst.street) + ' · ' + T('spot.' + worst.spot) + (worst.position ? ' · ' + T('pos.' + worst.position) : '')));
      const line = el('div', 'rh-line');
      line.appendChild(el('span', 'rh-you', T('review.yourAction', { action: H.review.actionLabel(worst.chosen) })));
      line.appendChild(el('span', 'rh-arrow', '→'));
      line.appendChild(el('span', 'rh-best', T('review.recommend') + ': ' + H.review.actionLabel(worst.best)));
      leak.appendChild(line);
      leak.appendChild(whyLine(worst));
      head.appendChild(leak);
    } else {
      head.appendChild(el('div', 'rh-clean', T('review.cleanHand')));
    }
    const actions = el('div', 'rh-actions');
    if (worst && opts.onRange) {
      const b = el('button', 'mini-btn', T('review.showRange')); b.type = 'button'; b.id = 'btnReviewRange';
      b.addEventListener('click', function () { opts.onRange(worst); });
      actions.appendChild(b);
    }
    if (worst && opts.onDrill) {
      const b = el('button', 'mini-btn gold', T('review.drillSimilar')); b.type = 'button'; b.id = 'btnReviewDrill';
      b.addEventListener('click', function () { opts.onDrill(worst.street + '/' + worst.spot); });
      actions.appendChild(b);
    }
    if (actions.childElementCount) head.appendChild(actions);
    host.appendChild(head);

    host.appendChild(el('h4', 'panel-sub', T('review.timeline')));
    summary.items.forEach(function (it) {
      const lv = H.review.level(it.verdict);
      const open = it === worst;
      const row = el('div', 'review-row v-' + it.verdict + ' lv-' + lv + (open ? ' open' : ''));
      const top = el('button', 'review-top'); top.type = 'button';
      top.setAttribute('aria-expanded', String(open));
      top.appendChild(el('span', 'rv-level ' + lv, T('review.level.' + lv)));
      top.appendChild(el('span', 'rv-street', T('street.' + it.street)));
      top.appendChild(el('span', 'rv-action', H.review.actionLabel(it.chosen)));
      if (it.coached) top.appendChild(el('span', 'rv-coached', T('coach.used')));
      top.appendChild(el('span', 'rv-loss' + (it.evLossBb < 0.15 ? ' zero' : ''), (it.evLossBb >= 0.15 ? '-' : '') + it.evLossBb.toFixed(1) + ' bb'));
      row.appendChild(top);
      const detail = el('div', 'review-detail-wrap');
      const d1 = el('div', 'review-detail');
      d1.appendChild(el('span', null, H.review.explain(it)));
      if (it.best && (it.best.type !== it.chosen.type || it.best.amount !== it.chosen.amount)) {
        d1.appendChild(el('span', 'rv-best', '→ ' + H.review.actionLabel(it.best)));
      }
      detail.appendChild(d1);
      detail.appendChild(whyLine(it));
      if (it.draws && it.draws.outs > 0) {
        detail.appendChild(el('div', 'review-draws', T('ctl.outs', { n: it.draws.outs, name: it.draws.labels[0] || '', pct: Math.round(it.draws.byRiver * 100) })));
      }
      row.appendChild(detail);
      top.addEventListener('click', function () {
        const now = row.classList.toggle('open');
        top.setAttribute('aria-expanded', String(now));
      });
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
