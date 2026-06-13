// 싸커 잉글리시 — 학습 루프/보상/카드/간격반복 핵심 로직 (서버 없음, localStorage 저장)
'use strict';

// ---------- 상태 ----------
const STORE_KEY = 'ke_state_v1';
let CUR = null;   // curriculum.json
let S = null;     // 저장 상태

const DEFAULT_STATE = {
  v: 1, name: '', week: 1, day: 1,
  coins: 0, streak: 0, lastDone: null,
  cards: [], learned: [],  // learned: {en, ko, emoji, box, due}
  coupons: []              // 주간 완주 현금 쿠폰 {week, amount, date, used}
};
const COUPON_AMOUNT = 5000;

const CARDS = [
  { id: 'c1', nm: '번개 스트라이커', face: '⚡', r: 'common' },
  { id: 'c2', nm: '강철 수비수',     face: '🛡️', r: 'common' },
  { id: 'c3', nm: '거미손 골키퍼',   face: '🧤', r: 'common' },
  { id: 'c4', nm: '명중 슈터',       face: '🎯', r: 'common' },
  { id: 'c5', nm: '회오리 드리블러', face: '🌪️', r: 'common' },
  { id: 'c6', nm: '로켓 윙어',       face: '🚀', r: 'common' },
  { id: 'r1', nm: '캡틴 리더',       face: '👑', r: 'rare' },
  { id: 'r2', nm: '유니콘 패서',     face: '🦄', r: 'rare' },
  { id: 'r3', nm: '불꽃 에이스',     face: '🔥', r: 'rare' },
  { id: 'r4', nm: '아이스 미드필더', face: '❄️', r: 'rare' },
  { id: 'l1', nm: '갤럭시 레전드',   face: '🌟', r: 'legend' },
  { id: 'l2', nm: '골든부츠 킹',     face: '🏆', r: 'legend' }
];
const PRAISES = ['정말 잘했어!', '최고야!', '와, 대단해!', '오늘도 해냈구나!'];
const PACK_COST = 100;
const BOX_DAYS = { 1: 1, 2: 3, 3: 7 };

function load() {
  try { S = JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch (e) { S = null; }
  if (!S) S = JSON.parse(JSON.stringify(DEFAULT_STATE));
  if (!S.coupons) S.coupons = [];   // 구버전 저장본 마이그레이션
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- 음성 ----------
let AUDIO_MAP = {};   // 영어 텍스트 -> 원어민 발음 mp3 경로
let curAudio = null;
function speak(text, lang) {
  try {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = lang === 'en-US' ? 0.85 : 1.0;
    const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.startsWith(lang.slice(0, 2)));
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* 음성 미지원 기기에서도 앱은 동작해야 함 */ }
}
// 원어민 발음 mp3가 있으면 우선 재생, 없거나 실패하면 기기 TTS 폴백
function speakEN(t) {
  const src = AUDIO_MAP[t];
  if (src) {
    try {
      if (curAudio) { curAudio.pause(); }
      if (window.speechSynthesis) speechSynthesis.cancel();
      curAudio = new Audio(src);
      curAudio.play().catch(() => speak(t, 'en-US'));
      return;
    } catch (e) { /* 폴백으로 진행 */ }
  }
  speak(t, 'en-US');
}
const speakKO = t => speak(t, 'ko-KR');

// ---------- 효과음 (파일 없이 WebAudio) ----------
let AC = null;
function beep(freqs, dur) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    let t = AC.currentTime;
    freqs.forEach(f => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.frequency.value = f; o.type = 'triangle';
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(AC.destination);
      o.start(t); o.stop(t + dur);
      t += dur * 0.7;
    });
  } catch (e) { /* 무음 폴백 */ }
}
const sfxGood = () => beep([523, 659, 784], 0.18);
const sfxBad = () => beep([196], 0.25);
const sfxGoal = () => beep([523, 659, 784, 1047], 0.2);

// ---------- 화면 전환 ----------
const $ = id => document.getElementById(id);
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// ---------- 홈 ----------
function renderHome() {
  if (!CUR) return;   // 데이터 로딩 전 진입 방어
  $('hud-coins').textContent = '🪙 ' + S.coins;
  $('hud-streak').textContent = '🔥 ' + S.streak + '일';
  const unused = S.coupons.filter(c => !c.used).length;
  $('btn-coupons').textContent = '🎟️ 내 쿠폰' + (unused ? ' (' + unused + '장!)' : '');
  const w = curWeek();
  if (!w) {
    $('home-progress').textContent = '시즌 완료! 🏆';
    $('home-msg').innerHTML = (S.name || '친구') + ', 12주 시즌 우승을 축하해! 🏆';
  } else {
    $('home-progress').textContent = S.week + '주차 · ' + dayLabel() + ' · ' + w.theme_ko;
    $('home-msg').innerHTML = S.lastDone === today()
      ? '오늘 훈련 끝! 내일 또 만나~ 😊'
      : (S.name || '친구') + ', 오늘도 훈련하러 가자!';
  }
  show('screen-home');
}
function curWeek() { return CUR.weeks.find(w => w.week === S.week) || null; }
function dayLabel() {
  if (S.day === 6) return '복습 게임의 날';
  if (S.day === 7) return '노래의 날';
  return S.day + '일째 훈련';
}

// ---------- 단어 풀 ----------
function allWords() {
  const out = [];
  CUR.weeks.forEach(w => w.days.forEach(d => d.words.forEach(x => out.push(x))));
  return out;
}
function pickOthers(word, n) {
  const pool = allWords().filter(x => x.en !== word.en && x.emoji !== word.emoji);
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 학습 루프 ----------
let L = null; // 진행 중 레슨 {steps, idx, correct, total, newWords, phrase}

function buildLesson() {
  const w = curWeek();
  if (!w) return null;
  if (S.day >= 1 && S.day <= 5) {
    const d = w.days[S.day - 1];
    return {
      steps: ['words', 'review', 'shoot', 'phrase', 'reward'],
      idx: 0, correct: 0, total: 0,
      newWords: d.words, phrase: d.phrase, weekWords: null
    };
  }
  if (S.day === 6) {
    const weekWords = [];
    w.days.forEach(d => d.words.forEach(x => weekWords.push(x)));
    return { steps: ['shoot', 'reward'], idx: 0, correct: 0, total: 0, newWords: [], phrase: null, weekWords };
  }
  // day 7 = 노래의 날 (노래 핵심 단어도 그날의 새 단어로 학습)
  const weekWords = [];
  w.days.forEach(d => d.words.forEach(x => weekWords.push(x)));
  const songWords = (w.song && w.song.title && w.song.words) ? w.song.words : [];
  return { steps: ['song', 'reward'], idx: 0, correct: 0, total: 0, newWords: songWords, phrase: null, weekWords };
}

function startLesson() {
  L = buildLesson();
  if (!L) { renderHome(); return; }
  show('screen-lesson');
  renderStep();
}
function dots() {
  $('lesson-dots').textContent = L.steps.map((s, i) => i <= L.idx ? '🟢' : '⚪').join(' ');
}
function nextStep() {
  L.idx++;
  if (L.idx >= L.steps.length) { finishDay(); return; }
  renderStep();
}
function renderStep() {
  dots();
  const step = L.steps[L.idx];
  if (step === 'words') return uiWords();
  if (step === 'review') return uiReview();
  if (step === 'shoot') return uiShoot();
  if (step === 'phrase') return uiPhrase();
  if (step === 'song') return uiSongDay();
  if (step === 'reward') return uiReward();
}

// 1단계 — 오늘의 단어
function uiWords() {
  const area = $('lesson-area');
  area.innerHTML = '<div class="quiz-q">오늘의 단어! 카드를 눌러 소리를 들어 봐 👇</div>';
  L.newWords.forEach(wd => {
    const c = document.createElement('div');
    c.className = 'word-card';
    c.innerHTML = '<div class="emoji">' + wd.emoji + '</div><div class="en">' + wd.en + '</div><div class="ko">' + wd.ko + '</div>';
    c.onclick = () => speakEN(wd.en);
    area.appendChild(c);
  });
  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.textContent = '다 들었어요! 👉';
  btn.onclick = nextStep;
  area.appendChild(btn);
  setTimeout(() => { if (L.newWords[0]) speakEN(L.newWords[0].en); }, 400);
}

// 2단계 — 복습 카드 (간격반복: 기한 도래분 최대 5개)
function uiReview() {
  const due = S.learned.filter(x => x.due <= today()).slice(0, 5);
  if (!due.length) { nextStep(); return; }
  runQuiz(due, '🔁 복습 카드! 들리는 단어를 골라 봐', (word, ok) => {
    const item = S.learned.find(x => x.en === word.en);
    if (item) {
      item.box = ok ? Math.min(3, item.box + 1) : 1;
      item.due = addDays(today(), BOX_DAYS[item.box]);
    }
  }, nextStep);
}

// 3단계 — 슛 미니게임 (오늘 단어 + 최근 배운 단어 섞기)
function uiShoot() {
  let qs;
  if (L.weekWords) {
    qs = shuffle(L.weekWords.slice()).slice(0, 8);
  } else {
    const recent = S.learned.slice(-6).map(x => ({ en: x.en, ko: x.ko, emoji: x.emoji }));
    qs = shuffle(L.newWords.concat(recent)).slice(0, 5);
  }
  runQuiz(qs, '⚽ 슛 게임! 맞히면 골이야!', null, nextStep, true);
}

// 공용 퀴즈 — 영어 음성 듣고 그림 3개 중 고르기 (글 못 읽어도 가능)
function runQuiz(words, title, onAnswer, onDone, goalMode) {
  let qi = 0;
  const area = $('lesson-area');
  function ask() {
    if (qi >= words.length) { onDone(); return; }
    const word = words[qi];
    const opts = shuffle([word].concat(pickOthers(word, 2)));
    area.innerHTML = '<div class="quiz-q">' + title + ' (' + (qi + 1) + '/' + words.length + ')</div>';
    const hear = document.createElement('button');
    hear.className = 'speak-btn';
    hear.textContent = '🔊 다시 듣기';
    hear.onclick = () => speakEN(word.en);
    area.appendChild(hear);
    const box = document.createElement('div');
    box.className = 'quiz-opts';
    opts.forEach(o => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = o.emoji;
      b.onclick = () => {
        const ok = o.en === word.en;
        L.total++;
        if (ok) {
          L.correct++;
          b.classList.add('correct');
          if (goalMode) { sfxGoal(); goalFx(); } else { sfxGood(); }
        } else {
          b.classList.add('wrong');
          sfxBad();
          speakKO('괜찮아, 다시 차 보자!');
        }
        if (onAnswer) onAnswer(word, ok);
        setTimeout(() => { qi++; ask(); }, ok ? 900 : 1300);
      };
      box.appendChild(b);
    });
    area.appendChild(box);
    speakEN(word.en);
  }
  ask();
}

// 골 세리머니 + 색종이
function goalFx() {
  const ov = $('goal-overlay');
  ov.classList.remove('hidden');
  for (let i = 0; i < 12; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.textContent = ['🎉', '⭐', '⚽', '✨'][i % 4];
    c.style.left = Math.random() * 95 + 'vw';
    c.style.animationDelay = (Math.random() * 0.3) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1800);
  }
  setTimeout(() => ov.classList.add('hidden'), 900);
}

// 4단계 — 오늘의 한 마디
function uiPhrase() {
  const p = L.phrase;
  if (!p) { nextStep(); return; }
  const area = $('lesson-area');
  area.innerHTML =
    '<div class="quiz-q">오늘의 한 마디 🗣️</div>' +
    '<div class="word-card"><div class="en">' + p.en + '</div><div class="ko">' + p.ko + '</div></div>';
  const hear = document.createElement('button');
  hear.className = 'speak-btn';
  hear.textContent = '🔊 들어 보기';
  hear.onclick = () => speakEN(p.en);
  area.appendChild(hear);
  const done = document.createElement('button');
  done.className = 'next-btn';
  done.textContent = '따라 말했어요! 👉';
  done.onclick = nextStep;
  area.appendChild(done);
  setTimeout(() => speakEN(p.en), 400);
}

// 노래의 날 — 이주의 노래 듣기 + 노래 핵심 단어 배우기
function uiSongDay() {
  const w = curWeek();
  const s = w.song || {};
  const area = $('lesson-area');
  if (!s.title) {
    area.innerHTML =
      '<div class="mascot small">🎤</div>' +
      '<div class="bubble">이번 주 노래는 아직 준비 중!<br>대신 보너스 슛 게임을 하자!</div>';
    const btn = document.createElement('button');
    btn.className = 'next-btn';
    btn.textContent = '⚽ 보너스 게임 가자!';
    btn.onclick = () => { L.steps.splice(L.idx + 1, 0, 'shoot'); nextStep(); };
    area.appendChild(btn);
    return;
  }
  area.innerHTML =
    '<div class="quiz-q">🎵 이주의 노래</div>' +
    '<div class="word-card"><div class="en" style="font-size:1.5rem">' + s.title + '</div>' +
    '<div class="ko">' + (s.artist || '') + '<br>' + (s.theme_ko || '') + '</div></div>' +
    '<div class="quiz-q">노래에 나오는 단어! 눌러서 들어 봐 👇</div>';
  (s.words || []).forEach(wd => {
    const c = document.createElement('div');
    c.className = 'word-card';
    c.innerHTML = '<div class="emoji" style="font-size:48px">' + wd.emoji + '</div><div class="en" style="font-size:1.4rem">' + wd.en + '</div><div class="ko">' + wd.ko + '</div>';
    c.onclick = () => speakEN(wd.en);
    area.appendChild(c);
  });
  const yt = document.createElement('button');
  yt.className = 'speak-btn';
  yt.textContent = '▶️ 유튜브에서 노래 듣기';
  yt.onclick = () => {
    const q = s.title + ' ' + (s.artist && s.artist.indexOf('OST') < 0 ? s.artist : '') + ' lyrics';
    window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), '_blank');
  };
  area.appendChild(yt);
  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.textContent = '노래 들었어요! 👉';
  btn.onclick = nextStep;
  area.appendChild(btn);
}

// 5단계 — 보상 정산
function uiReward() {
  let coin = 30;
  const perfect = L.total > 0 && L.correct === L.total;
  if (perfect) coin += 10;
  const doneBefore = S.lastDone === today();
  let gotCoupon = false;
  if (!doneBefore) {
    S.coins += coin;
    // 스트릭
    if (S.lastDone === addDays(today(), -1)) S.streak += 1;
    else S.streak = 1;
    S.lastDone = today();
    if (S.streak > 0 && S.streak % 7 === 0) S.coins += 50;
    // 오늘 새 단어를 복습 큐에 등록
    L.newWords.forEach(wd => {
      if (!S.learned.find(x => x.en === wd.en)) {
        S.learned.push({ en: wd.en, ko: wd.ko, emoji: wd.emoji, box: 1, due: addDays(today(), 1) });
      }
    });
    // 다음 날로 전진 (한 주 7일 완주 시 현금 쿠폰 발급)
    S.day += 1;
    if (S.day > 7) {
      S.day = 1; S.week += 1;
      S.coupons.push({ week: S.week - 1, amount: COUPON_AMOUNT, date: today(), used: false });
      gotCoupon = true;
    }
    save();
  }
  const praise = PRAISES[Math.floor(Math.random() * PRAISES.length)];
  const area = $('lesson-area');
  area.innerHTML =
    '<div class="reward-box"><div class="big-coin">🪙</div>' +
    '<b>' + (S.name || '친구') + ', ' + praise + '</b><br>' +
    (doneBefore
      ? '오늘 보상은 이미 받았어!<br>내일 또 만나~'
      : '+' + coin + ' 코인' + (perfect ? ' (퍼펙트 보너스 포함!)' : '') +
        '<br>🔥 연속 ' + S.streak + '일째!' +
        (S.streak % 7 === 0 && S.streak > 0 ? '<br>🎁 7일 보너스 +50!' : '') +
        (gotCoupon ? '<br><br>🎟️ <b>한 주 완주! 현금 ' + COUPON_AMOUNT.toLocaleString() + '원 쿠폰 획득!</b><br>부모님께 보여 드리자!' : '')) +
    '</div>';
  if (gotCoupon) { goalFx(); sfxGoal(); }
  speakKO(praise);
  sfxGood();
  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.textContent = S.coins >= PACK_COST ? '🎁 카드 뽑으러 가기!' : '🏠 홈으로';
  btn.onclick = () => { S.coins >= PACK_COST ? renderCards() : renderHome(); };
  area.appendChild(btn);
}

function finishDay() { renderHome(); }

// ---------- 카드 도감 ----------
function renderCards() {
  $('cards-coins').textContent = '🪙 ' + S.coins;
  const grid = $('card-grid');
  grid.innerHTML = '';
  CARDS.forEach(c => {
    const owned = S.cards.includes(c.id);
    const d = document.createElement('div');
    d.className = 'pcard ' + c.r + (owned ? '' : ' locked');
    d.innerHTML = '<div class="face">' + (owned ? c.face : '❓') + '</div><div class="nm">' + (owned ? c.nm : '???') + '</div>';
    grid.appendChild(d);
  });
  $('btn-pack').disabled = S.coins < PACK_COST;
  $('btn-pack').style.opacity = S.coins < PACK_COST ? 0.5 : 1;
  show('screen-cards');
}
function openPack() {
  if (S.coins < PACK_COST) { speakKO('코인을 더 모아 보자!'); return; }
  S.coins -= PACK_COST;
  const roll = Math.random();
  let pool;
  if (roll < 0.08) pool = CARDS.filter(c => c.r === 'legend');
  else if (roll < 0.35) pool = CARDS.filter(c => c.r === 'rare');
  else pool = CARDS.filter(c => c.r === 'common');
  const card = pool[Math.floor(Math.random() * pool.length)];
  let msg;
  if (S.cards.includes(card.id)) {
    S.coins += 20;
    msg = card.face + ' ' + card.nm + ' — 이미 있어서 코인 +20 돌려받았어!';
  } else {
    S.cards.push(card.id);
    msg = card.face + ' ' + card.nm + ' 획득!' + (card.r === 'legend' ? ' 🌟레전드!!' : card.r === 'rare' ? ' 💙레어!' : '');
    goalFx(); sfxGoal();
  }
  save();
  renderCards();
  speakKO(S.cards.includes(card.id) ? '카드를 확인해 봐!' : '');
  alert(msg);
}

// ---------- 노래방 (지나온 주차의 노래 목록) ----------
function renderSongRoom() {
  const area = $('song-list');
  area.innerHTML = '';
  const avail = CUR.weeks.filter(w => w.week <= S.week && w.song && w.song.title);
  if (!avail.length) {
    area.innerHTML = '<div class="bubble">훈련을 시작하면 노래가 열려!</div>';
  }
  avail.forEach(w => {
    const d = document.createElement('div');
    d.className = 'word-card';
    d.innerHTML = '<div class="en" style="font-size:1.2rem">🎵 ' + w.song.title + '</div>' +
      '<div class="ko">' + w.song.artist + ' · ' + w.week + '주차 · ' + w.song.theme_ko + '</div>';
    d.onclick = () => {
      const q = w.song.title + ' ' + (w.song.artist.indexOf('OST') < 0 ? w.song.artist : '') + ' lyrics';
      window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), '_blank');
    };
    area.appendChild(d);
  });
  show('screen-song');
}

// ---------- 현금 쿠폰 ----------
function renderCoupons() {
  const area = $('coupon-list');
  area.innerHTML = '';
  if (!S.coupons.length) {
    area.innerHTML = '<div class="bubble">아직 쿠폰이 없어!<br>한 주(7일)를 완주하면<br>현금 ' + COUPON_AMOUNT.toLocaleString() + '원 쿠폰을 받아! 💪</div>';
  }
  S.coupons.slice().reverse().forEach(cp => {
    const d = document.createElement('div');
    d.className = 'reward-box' + (cp.used ? ' used' : '');
    d.innerHTML = '🎟️ <b>' + cp.week + '주차 완주 — 현금 ' + cp.amount.toLocaleString() + '원</b><br>' +
      '<span style="font-size:.95rem">' + cp.date + (cp.used ? ' · 받기 완료 ✔' : '') + '</span>';
    if (!cp.used) {
      const b = document.createElement('button');
      b.className = 'next-btn';
      b.style.marginTop = '10px';
      b.textContent = '💵 부모님께 받았어요!';
      b.onclick = () => { cp.used = true; save(); renderCoupons(); speakKO('축하해! 다음 주도 화이팅!'); };
      d.appendChild(b);
    }
    area.appendChild(d);
  });
  show('screen-coupons');
}

// ---------- 시작/이벤트 ----------
function init() {
  load();
  fetch('data/audio_map.json')
    .then(r => r.json())
    .then(m => { AUDIO_MAP = m; })
    .catch(() => { AUDIO_MAP = {}; });
  fetch('data/curriculum.json')
    .then(r => r.json())
    .then(j => {
      CUR = j;
      if (S.name === '' && S.coins === 0 && S.learned.length === 0 && !S.lastDone) {
        show('screen-start');
      } else {
        renderHome();
      }
    });

  $('btn-level-new').onclick = () => beginGame(1);
  $('btn-level-abc').onclick = () => beginGame(4);
  $('btn-train').onclick = startLesson;
  $('btn-cards').onclick = renderCards;
  $('btn-song').onclick = renderSongRoom;
  $('btn-lesson-home').onclick = renderHome;
  $('btn-cards-home').onclick = renderHome;
  $('btn-song-home').onclick = renderHome;
  $('btn-coupons').onclick = renderCoupons;
  $('btn-coupons-home').onclick = renderHome;
  $('btn-pack').onclick = openPack;

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
function beginGame(startWeek) {
  S.name = $('inp-name').value.trim();
  S.week = startWeek;
  S.day = 1;
  save();
  speakKO((S.name || '친구') + ', 반가워! 같이 훈련하자!');
  renderHome();
}

document.addEventListener('DOMContentLoaded', init);
