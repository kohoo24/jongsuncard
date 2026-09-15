/*
 * i18n.js - 다국어 문자열
 * 각 항목은 [한국어, English]. t('key', {param: value}) 로 사용한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  const LANGS = ['ko', 'en'];
  const LANG_NAMES = { ko: '한국어', en: 'English' };

  const S = {
    /* --- 공통 --- */
    'app.title': ['텍사스 홀덤', 'Texas Hold’em'],
    'app.subtitle': ['AI 상대와 즐기는 노리밋 홀덤', 'No-limit hold’em against AI opponents'],

    /* --- 핸드 이름 --- */
    'hand.royalFlush': ['로열 플러시', 'Royal Flush'],
    'hand.straightFlush': ['스트레이트 플러시 ({r} 하이)', 'Straight Flush ({r} high)'],
    'hand.quads': ['포카드 ({r})', 'Four of a Kind ({r})'],
    'hand.fullHouse': ['풀하우스 ({a} + {b})', 'Full House ({a} over {b})'],
    'hand.flush': ['플러시 ({r} 하이)', 'Flush ({r} high)'],
    'hand.straight': ['스트레이트 ({r} 하이)', 'Straight ({r} high)'],
    'hand.trips': ['트리플 ({r})', 'Three of a Kind ({r})'],
    'hand.twoPair': ['투페어 ({a}, {b})', 'Two Pair ({a} and {b})'],
    'hand.pair': ['원페어 ({r})', 'One Pair ({r})'],
    'hand.highCard': ['하이카드 ({r})', 'High Card ({r})'],

    /* --- 프리플랍 홀카드 설명 --- */
    'hole.pocket': ['포켓 페어 {r}', 'Pocket {r}s'],
    'hole.suited': ['{a}{b} 수딧', '{a}{b} suited'],
    'hole.offsuit': ['{a}{b} 오프수딧', '{a}{b} offsuit'],

    /* --- 스트리트 --- */
    'street.preflop': ['프리플랍', 'Preflop'],
    'street.flop': ['플랍', 'Flop'],
    'street.turn': ['턴', 'Turn'],
    'street.river': ['리버', 'River'],
    'street.showdown': ['쇼다운', 'Showdown'],

    /* --- 액션 라벨 --- */
    'act.fold': ['폴드', 'Fold'],
    'act.check': ['체크', 'Check'],
    'act.call': ['콜', 'Call'],
    'act.bet': ['벳', 'Bet'],
    'act.raise': ['레이즈', 'Raise'],
    'act.allin': ['올인', 'All in'],
    'act.sb': ['SB', 'SB'],
    'act.bb': ['BB', 'BB'],
    'act.ante': ['앤티', 'Ante'],
    'act.muck': ['머크', 'Muck'],
    'act.show': ['쇼', 'Show'],
    'act.timeout': ['시간 초과', 'Timed out'],

    /* --- 로그 --- */
    'log.handStart': ['--- 핸드 #{n} 시작 (블라인드 {sb}/{bb}{ante}) ---',
      '--- Hand #{n} (blinds {sb}/{bb}{ante}) ---'],
    'log.anteSuffix': [', 앤티 {a}', ', ante {a}'],
    'log.levelUp': ['레벨 {level}: 블라인드 {sb}/{bb}{ante}', 'Level {level}: blinds {sb}/{bb}{ante}'],
    'log.postAnte': ['{name} 앤티 {amount}', '{name} posts ante {amount}'],
    'log.postSb': ['{name} 스몰블라인드 {amount}', '{name} posts small blind {amount}'],
    'log.postBb': ['{name} 빅블라인드 {amount}', '{name} posts big blind {amount}'],
    'log.fold': ['{name} 폴드', '{name} folds'],
    'log.check': ['{name} 체크', '{name} checks'],
    'log.call': ['{name} 콜 {amount}', '{name} calls {amount}'],
    'log.callAllIn': ['{name} 콜 {amount} (올인)', '{name} calls {amount} (all in)'],
    'log.bet': ['{name} 벳 {amount}', '{name} bets {amount}'],
    'log.raise': ['{name} 레이즈 {amount}', '{name} raises to {amount}'],
    'log.betAllIn': ['{name} 올인 {amount}', '{name} is all in for {amount}'],
    'log.timeout': ['{name} 시간 초과 → {action}', '{name} timed out → {action}'],
    'log.street': ['{street}: {cards}', '{street}: {cards}'],
    'log.show': ['{name}: {cards} → {desc}', '{name}: {cards} → {desc}'],
    'log.muck': ['{name} 머크', '{name} mucks'],
    'log.potWin': ['{label} {amount} → {winners}', '{label} {amount} → {winners}'],
    'log.uncontested': ['{name} 님이 팟 {amount} 획득 (모두 폴드)', '{name} wins {amount} (everyone folded)'],
    'log.bust': ['{name} 님이 칩을 모두 잃고 테이블을 떠납니다.', '{name} busts out.'],
    'log.rebuy': ['{name} 리바이 +{amount}', '{name} rebuys +{amount}'],
    'log.addon': ['{name} 애드온 +{amount}', '{name} add-on +{amount}'],
    'log.finish': ['{name} → {place}위 ({prize})', '{name} finishes {place} ({prize})'],

    'pot.main': ['메인 팟', 'Main pot'],
    'pot.side': ['사이드 팟 {n}', 'Side pot {n}'],

    /* --- 상단바 --- */
    'top.hand': ['핸드', 'Hand'],
    'top.blinds': ['블라인드', 'Blinds'],
    'top.myChips': ['내 칩', 'My chips'],
    'top.level': ['레벨', 'Level'],
    'top.log': ['기록', 'Log'],
    'tab.log': ['기록', 'Log'],
    'tab.stats': ['통계', 'Stats'],
    'tab.hist': ['핸드', 'Hands'],
    'tab.chart': ['레인지', 'Range'],
    'top.stats': ['통계', 'Stats'],
    'top.newGame': ['새 게임', 'New game'],
    'top.sound': ['소리', 'Sound'],
    'top.menu': ['메뉴', 'Menu'],

    /* --- 테이블 --- */
    'table.pot': ['팟', 'Pot'],
    'table.youPlayer': ['플레이어', 'You'],
    'table.dealerButton': ['딜러 버튼', 'Dealer button'],
    'table.allIn': ['올인', 'ALL IN'],
    'table.sittingOut': ['대기', 'Sitting out'],
    'table.thinking': ['{name} 님이 생각 중…', '{name} is thinking…'],
    'table.dealing': ['카드를 여는 중…', 'Dealing…'],
    'table.youFolded': ['이번 핸드는 폴드했습니다', 'You folded this hand'],
    'table.winsWith': ['{name} +{amount} · {desc}', '{name} +{amount} · {desc}'],
    'table.wins': ['{name} +{amount}', '{name} +{amount}'],

    /* --- 컨트롤 --- */
    'ctl.fold': ['폴드', 'Fold'],
    'ctl.check': ['체크', 'Check'],
    'ctl.call': ['콜 {amount}', 'Call {amount}'],
    'ctl.bet': ['벳 {amount}', 'Bet {amount}'],
    'ctl.raise': ['레이즈 {amount}', 'Raise to {amount}'],
    'ctl.allin': ['올인 {amount}', 'All in {amount}'],
    'ctl.nextHand': ['다음 핸드', 'Next hand'],
    'ctl.halfPot': ['½ 팟', '½ pot'],
    'ctl.threeQuarterPot': ['¾ 팟', '¾ pot'],
    'ctl.pot': ['팟', 'Pot'],
    'ctl.min': ['최소', 'Min'],
    'ctl.showCards': ['카드 공개', 'Show cards'],
    'ctl.muckCards': ['머크', 'Muck'],
    'ctl.equity': ['예상 승률 {pct}%', 'Equity {pct}%'],
    'ctl.calculating': ['승률 계산 중…', 'Calculating…'],
    'ctl.outs': ['아웃 {n}장 · {name} {pct}%', '{n} outs · {name} {pct}%'],
    'ctl.potOdds': ['필요 승률 {pct}%', 'Need {pct}%'],

    /* --- 드로우 --- */
    'draw.flush': ['플러시 드로우', 'Flush draw'],
    'draw.oesd': ['양차 스트레이트 드로우', 'Open-ended straight draw'],
    'draw.gutshot': ['백도어/것샷', 'Gutshot'],
    'draw.overcards': ['오버카드', 'Overcards'],
    'draw.madeHand': ['완성된 핸드', 'Made hand'],

    /* --- 설정 --- */
    'setup.opponents': ['상대 수', 'Opponents'],
    'setup.opponentsN': ['{n}명', '{n}'],
    'setup.headsUp': ['1명 (헤즈업)', '1 (heads-up)'],
    'setup.startChips': ['시작 칩', 'Starting chips'],
    'setup.blinds': ['블라인드', 'Blinds'],
    'setup.difficulty': ['난이도', 'Difficulty'],
    'setup.diffEasy': ['초급', 'Easy'],
    'setup.diffNormal': ['중급', 'Normal'],
    'setup.diffHard': ['고급', 'Hard'],
    'setup.diffEasyDesc': ['실수가 잦고 힌트가 항상 보입니다', 'Bots misplay often; hints always on'],
    'setup.diffNormalDesc': ['레인지와 포지션을 고려합니다', 'Bots use ranges and position'],
    'setup.diffHardDesc': ['당신의 습관까지 학습합니다', 'Bots profile and exploit you'],
    'setup.structure': ['진행 방식', 'Structure'],
    'setup.structFixed': ['블라인드 고정', 'Fixed blinds'],
    'setup.structTurbo': ['터보 (5핸드마다 상승)', 'Turbo (level every 5 hands)'],
    'setup.structStandard': ['스탠다드 (10핸드마다)', 'Standard (level every 10 hands)'],
    'setup.structSlow': ['슬로우 (20핸드마다)', 'Slow (level every 20 hands)'],
    'setup.ante': ['앤티', 'Ante'],
    'setup.anteOff': ['없음', 'None'],
    'setup.anteBB': ['빅블라인드 앤티', 'Big blind ante'],
    'setup.anteAll': ['전원 앤티', 'Everyone antes'],
    'setup.rebuy': ['리바이 허용', 'Allow rebuys'],
    'setup.speed': ['AI 속도', 'AI speed'],
    'setup.speedFast': ['빠름', 'Fast'],
    'setup.speedNormal': ['보통', 'Normal'],
    'setup.speedSlow': ['느긋함', 'Relaxed'],
    'setup.clock': ['액션 제한 시간', 'Action clock'],
    'setup.clockOff': ['없음', 'Off'],
    'setup.clockSec': ['{n}초', '{n}s'],
    'setup.showEquity': ['내 승률 표시', 'Show my equity'],
    'setup.showThinking': ['AI 판단 근거 표시', 'Show AI reasoning'],
    'setup.autoReview': ['핸드 종료 후 자동 리뷰', 'Auto-review after each hand'],
    'setup.fourColor': ['4색 덱', 'Four-color deck'],
    'setup.seed': ['시드', 'Seed'],
    'setup.seedHint': ['같은 시드는 같은 카드 순서를 만듭니다', 'The same seed deals the same cards'],
    'setup.start': ['게임 시작', 'Start game'],
    'setup.language': ['언어', 'Language'],
    'setup.shortcuts': ['단축키 — F: 폴드 / C: 체크·콜 / R: 레이즈 / Space: 다음 핸드',
      'Shortcuts — F: fold / C: check·call / R: raise / Space: next hand'],

    /* --- 결과 --- */
    'over.win': ['🏆 우승!', '🏆 You win!'],
    'over.lose': ['게임 오버', 'Game over'],
    'over.winText': ['모든 상대의 칩을 획득했습니다. {n}핸드 만에 테이블을 정리했네요.',
      'You took every chip. {n} hands to clear the table.'],
    'over.loseText': ['{n}핸드 만에 칩을 모두 잃었습니다.', 'You lost your stack after {n} hands.'],
    'over.place': ['{place}위로 마쳤습니다.', 'You finished in place {place}.'],
    'over.restart': ['다시 시작', 'Play again'],
    'over.rebuy': ['리바이 ({amount})', 'Rebuy ({amount})'],

    /* --- 통계 --- */
    'stats.title': ['세션 통계', 'Session stats'],
    'stats.hands': ['핸드', 'Hands'],
    'stats.vpip': ['VPIP', 'VPIP'],
    'stats.pfr': ['PFR', 'PFR'],
    'stats.af': ['AF', 'AF'],
    'stats.threeBet': ['3벳', '3-bet'],
    'stats.wtsd': ['WTSD', 'WTSD'],
    'stats.wsd': ['WSD', 'WSD'],
    'stats.bb100': ['bb/100', 'bb/100'],
    'stats.net': ['순손익', 'Net'],
    'stats.chipGraph': ['칩 추이', 'Chip history'],
    'stats.vpipHint': ['자발적으로 팟에 들어간 비율', 'Voluntarily put money in pot'],
    'stats.pfrHint': ['프리플랍 레이즈 비율', 'Preflop raise frequency'],
    'stats.afHint': ['공격 지수 (벳+레이즈 / 콜)', 'Aggression factor (bet+raise / call)'],
    'stats.wtsdHint': ['플랍을 본 뒤 쇼다운까지 간 비율', 'Went to showdown after seeing flop'],
    'stats.wsdHint': ['쇼다운에서 이긴 비율', 'Won at showdown'],
    'stats.empty': ['아직 기록이 없습니다', 'No hands recorded yet'],

    /* --- 리뷰 --- */
    'review.title': ['핸드 리뷰', 'Hand review'],
    'review.good': ['좋은 판단입니다', 'Good decision'],
    'review.ok': ['무난합니다', 'Acceptable'],
    'review.mistake': ['더 좋은 선택이 있었습니다', 'There was a better line'],
    'review.blunder': ['큰 실수입니다', 'Costly mistake'],
    'review.evLoss': ['이번 핸드 EV 손실: {amount}', 'EV lost this hand: {amount}'],
    'review.evNone': ['EV 손실 없이 플레이했습니다', 'You played this hand without EV loss'],
    'review.shouldFold': ['승률 {eq}%, 필요 승률 {need}% — 폴드가 맞습니다',
      'Equity {eq}% vs {need}% needed — folding is correct'],
    'review.shouldCall': ['승률 {eq}%, 필요 승률 {need}% — 콜할 만했습니다',
      'Equity {eq}% vs {need}% needed — calling was fine'],
    'review.shouldBet': ['승률 {eq}% — 여기서는 밸류벳이 정답입니다',
      'Equity {eq}% — this is a value bet'],
    'review.thinBet': ['승률 {eq}% — 벳하기엔 얇습니다', 'Equity {eq}% — too thin to bet'],
    'review.shouldOpen': ['상위 {pct}% 핸드 — {pos}에서는 오픈 레이즈가 표준입니다',
      'Top {pct}% hand — a standard open from {pos}'],
    'review.shouldThreeBet': ['상위 {pct}% 핸드 — 3벳할 자리입니다', 'Top {pct}% hand — this is a 3-bet spot'],
    'review.shouldFoldPre': ['상위 {pct}% 핸드 — {pos}에서는 접는 게 맞습니다',
      'Top {pct}% hand — folding is correct from {pos}'],
    'review.shouldCallPre': ['상위 {pct}% 핸드 — 콜할 만합니다 (필요 승률 {need}%)',
      'Top {pct}% hand — a fine call (need {need}%)'],
    'review.noData': ['리뷰할 결정이 없습니다', 'No decisions to review'],
    'review.yourAction': ['당신: {action}', 'You: {action}'],

    /* --- 히스토리 / 리플레이 --- */
    'hist.title': ['핸드 히스토리', 'Hand history'],
    'hist.empty': ['저장된 핸드가 없습니다', 'No saved hands'],
    'hist.replay': ['리플레이', 'Replay'],
    'hist.handNo': ['핸드 #{n}', 'Hand #{n}'],
    'hist.result': ['{amount}', '{amount}'],
    'hist.prev': ['이전', 'Prev'],
    'hist.next': ['다음', 'Next'],
    'hist.close': ['닫기', 'Close'],
    'hist.export': ['내보내기', 'Export'],
    'hist.winner': ['결과', 'Result'],

    /* --- 프리플랍 차트 --- */
    'chart.title': ['프리플랍 오픈 레인지', 'Preflop opening ranges'],
    'chart.position': ['포지션', 'Position'],
    'chart.yourHand': ['내 핸드', 'Your hand'],
    'chart.inRange': ['레인지에 포함', 'In range'],
    'chart.outRange': ['레인지 밖', 'Out of range'],
    'chart.pct': ['상위 {pct}%', 'Top {pct}%'],

    /* --- 포지션 --- */
    'pos.BTN': ['버튼', 'Button'],
    'pos.SB': ['스몰블라인드', 'Small blind'],
    'pos.BB': ['빅블라인드', 'Big blind'],
    'pos.UTG': ['언더더건', 'UTG'],
    'pos.MP': ['미들', 'Middle'],
    'pos.CO': ['컷오프', 'Cutoff'],

    /* --- AI 속마음 --- */
    'think.equity': ['내 승률 {eq}%', 'My equity {eq}%'],
    'think.range': ['상대 레인지 상위 {pct}%', 'Opponent range: top {pct}%'],
    'think.value': ['밸류벳', 'Value bet'],
    'think.bluff': ['블러프 (폴드 기대 {fe}%)', 'Bluff (fold equity {fe}%)'],
    'think.semiBluff': ['세미 블러프', 'Semi-bluff'],
    'think.potOdds': ['팟 오즈 {odds}%', 'Pot odds {odds}%'],
    'think.pot': ['포지션 {pos}', 'Position {pos}'],
    'think.exploit': ['당신은 {trait} → {plan}', 'You are {trait} → {plan}'],
    'think.tooTight': ['자주 접음', 'folding too much'],
    'think.tooLoose': ['자주 콜함', 'calling too much'],
    'think.bluffMore': ['블러프 늘림', 'bluffing more'],
    'think.valueMore': ['밸류만 침', 'value only'],

    /* --- 토너먼트 --- */
    'tour.level': ['레벨 {n}', 'Level {n}'],
    'tour.nextLevel': ['다음 레벨까지 {n}핸드', '{n} hands to next level'],
    'tour.place': ['{n}위', 'Place {n}'],
    'tour.remaining': ['남은 인원 {n}명', '{n} players left'],
    'tour.rebuyPrompt': ['칩을 모두 잃었습니다. 리바이하시겠습니까?', 'You are out of chips. Rebuy?'],
    'tour.addonPrompt': ['애드온을 받으시겠습니까?', 'Take the add-on?'],
    'tour.icm': ['ICM 지분', 'ICM equity'],

    /* --- 기타 --- */
    'common.yes': ['예', 'Yes'],
    'common.no': ['아니오', 'No'],
    'common.close': ['닫기', 'Close'],
    'common.on': ['켜기', 'On'],
    'common.off': ['끄기', 'Off'],
    'common.you': ['나', 'You']
  };

  let lang = 'ko';
  const listeners = [];

  function setLang(l) {
    if (LANGS.indexOf(l) === -1) return;
    lang = l;
    for (let i = 0; i < listeners.length; i++) listeners[i](lang);
  }

  function t(key, params) {
    const row = S[key];
    let str = row ? row[LANGS.indexOf(lang)] : key;
    if (str == null) str = row ? row[0] : key;
    if (params) {
      str = str.replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] != null ? params[k] : '';
      });
    }
    return str;
  }

  function extend(more) {
    Object.keys(more).forEach(function (k) { S[k] = more[k]; });
  }

  H.i18n = {
    extend: extend,
    LANGS: LANGS,
    LANG_NAMES: LANG_NAMES,
    t: t,
    setLang: setLang,
    getLang: function () { return lang; },
    onChange: function (fn) { listeners.push(fn); },
    has: function (k) { return !!S[k]; },
    keys: function () { return Object.keys(S); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;

/* 성향 프로필 이름 (ranges/ai 에서 사용) */
(function (global) {
  const H = global.Holdem;
  const extra = {
    'profile.rock': ['타이트', 'The Rock'],
    'profile.rockDesc': ['좋은 패만 들어옵니다', 'Plays only premium hands'],
    'profile.shark': ['밸런스', 'The Shark'],
    'profile.sharkDesc': ['기본기가 탄탄합니다', 'Solid, balanced play'],
    'profile.maniac': ['어그레시브', 'The Maniac'],
    'profile.maniacDesc': ['자주 몰아붙입니다', 'Applies constant pressure'],
    'profile.station': ['콜링스테이션', 'The Station'],
    'profile.stationDesc': ['웬만하면 콜합니다', 'Calls far too often'],
    'profile.trap': ['트래퍼', 'The Trapper'],
    'profile.trapDesc': ['강한 패를 숨깁니다', 'Slow-plays big hands']
  };
  H.i18n.extend(extra);
})(typeof globalThis !== 'undefined' ? globalThis : this);
