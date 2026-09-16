/*
 * drill.js - 드릴 모드
 *
 * 특정 자리(예: "플랍에서 벳에 직면")를 반복해서 출제한다. 봇들로 핸드를 진행시키다가
 * 히어로가 목표 자리에 서는 순간 멈추고 결정을 묻는다. 그 자리에 이르기까지의
 * 히어로의 앞선 결정은 고급 AI 가 대신 둔다 — 그래야 포스트플랍 자리가 나온다.
 *
 * 채점은 핸드 리뷰와 같은 기준(H.review.evaluate, 고급 AI 의 EV)이다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  if (typeof require === 'function') {
    require('./engine.js'); require('./ai.js'); require('./review.js'); require('./rng.js');
  }

  const HERO_ID = 0;
  const BB = 20;
  const STACK_BB = 100;
  const MAX_ATTEMPTS = 300;
  const TIME_BUDGET_MS = 2500;

  function parseTarget(key) {
    if (!key) return null;
    const parts = key.split('/');
    return { street: parts[0], spot: parts[1], key: key };
  }

  function makeGame(opts, rng) {
    const players = opts.players || 6;
    const g = new H.Game({ smallBlind: BB / 2, bigBlind: BB, rng: rng, alwaysShow: true });
    g.addPlayer({ id: HERO_ID, name: opts.heroName || 'You', chips: BB * STACK_BB, isHuman: true });
    const names = H.ai.NAMES.slice();
    H.cards.shuffle(names, rng);
    const profiles = H.ai.PROFILES.slice();
    H.cards.shuffle(profiles, rng);
    for (let i = 1; i < players; i++) {
      g.addPlayer({ id: i, name: names[i % names.length], chips: BB * STACK_BB, profile: profiles[i % profiles.length] });
    }
    // 게임마다 버튼이 0 에서 시작하면 히어로가 늘 버튼에 앉는다 — 자리를 무작위로 돌린다
    g.button = Math.floor(rng() * players) - 1;
    return g;
  }

  function botAct(g, p, diff, tracker) {
    const d = H.ai.decide(g, p, { difficulty: diff, tracker: tracker });
    if (!g.act(p.id, d).ok) g.act(p.id, { type: g.actionsFor(p).canCheck ? 'check' : 'fold' });
  }

  /* 한 핸드를 돌리다 히어로가 조건에 맞는 자리에 서면 그 상태로 돌려준다 */
  function runHand(opts, rng, tracker, botDiff, match) {
    const g = makeGame(opts, rng);
    g.startHand();
    let guard = 0;
    while (g.phase !== 'hand-over' && g.phase !== 'game-over' && guard++ < 200) {
      if (g.phase === 'awaiting-action') {
        const p = g.currentActor();
        if (p.isHuman) {
          const here = H.review.spotOf(g, p);
          if (match(here)) return { game: g, hero: p, spot: here };
          // 목표 자리가 아니면 고급 AI 가 대신 두고 계속 간다
          botAct(g, p, 'hard', tracker);
        } else {
          botAct(g, p, botDiff, tracker);
        }
      } else if (g.phase === 'need-street') g.dealNextStreet();
      else if (g.phase === 'showdown') g.resolveShowdown();
      else break;
    }
    return null;
  }

  /**
   * 목표 자리에 선 히어로를 만든다.
   * @returns {{game, hero, target, reached, attempts}}  reached=false 면 대체 출제(아무 자리)
   */
  function generate(opts) {
    opts = opts || {};
    const target = parseTarget(opts.target);
    const seed = opts.seed != null ? opts.seed : H.rng.randomSeed();
    const rng = H.rng.create(seed);
    const botDiff = opts.botDifficulty || 'normal';
    const tracker = opts.tracker || H.stats.create({ bigBlind: BB });
    const started = Date.now();

    /* 정확한 자리 -> 같은 상황(스트리트 무관) -> 아무 자리 순으로 눈높이를 낮춘다 */
    const tiers = [];
    if (target) {
      tiers.push({ exact: true, match: function (h) {
        return h.street === target.street && h.spot === target.spot && (!opts.position || h.pos === opts.position);
      } });
      tiers.push({ exact: false, match: function (h) { return h.spot === target.spot; } });
    }
    tiers.push({ exact: !target, match: function () { return true; } });

    let attempts = 0;
    for (let t = 0; t < tiers.length; t++) {
      const budget = t === tiers.length - 1 ? 50 : MAX_ATTEMPTS;
      for (let i = 0; i < budget; i++) {
        attempts++;
        const r = runHand(opts, rng, tracker, botDiff, tiers[t].match);
        if (r) {
          r.target = target; r.reached = tiers[t].exact; r.attempts = attempts; r.seed = seed;
          return r;
        }
        if (t < tiers.length - 1 && Date.now() - started > TIME_BUDGET_MS) break;
      }
    }
    return null;
  }

  /** 답을 채점한다. 게임 상태는 바꾸지 않는다 (액션 적용은 호출자가 한다) */
  function grade(game, hero, action, opts) {
    opts = opts || {};
    const item = H.review.evaluate(game, hero, action, { difficulty: 'hard', tracker: opts.tracker || null });
    if (!item) return null;
    item.explanation = H.review.explain(item);
    return item;
  }

  /** 드릴 세션 집계 */
  function Session(target) {
    this.target = target || null;
    this.asked = 0;
    this.counts = { good: 0, ok: 0, mistake: 0, blunder: 0 };
    this.lossBb = 0;
  }
  Session.prototype.record = function (item) {
    this.asked++;
    this.counts[item.verdict] = (this.counts[item.verdict] || 0) + 1;
    this.lossBb += item.evLossBb;
  };
  Session.prototype.correct = function () { return this.counts.good + this.counts.ok; };

  H.drill = {
    HERO_ID: HERO_ID,
    BB: BB,
    generate: generate,
    grade: grade,
    parseTarget: parseTarget,
    Session: Session
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
