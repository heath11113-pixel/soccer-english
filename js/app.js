// 싸커 잉글리시 — 학습 루프/보상/카드/간격반복 핵심 로직 (서버 없음, localStorage 저장)
'use strict';

// ---------- 상태 ----------
const STORE_KEY = 'ke_state_v1';
let CUR = null;   // curriculum.json
let CUSTOM = [];  // custom_songs.json (부모가 추가한 곡)
let IMG_MAP = {}; // 단어 -> 생성된 그림 경로 (없으면 이모지 폴백)
let CARD_IMG = {}; // 카드 id -> FIFA 스타일 그림 경로
let S = null;     // 저장 상태

// 단어 그림: 생성된 이미지가 있으면 그림, 없으면 이모지 (학습 시각자료)
function visualHTML(wd) {
  const src = IMG_MAP[wd.en];
  if (src) return '<img class="wv" src="' + src + '" alt="" loading="lazy">';
  return '<span class="wv-emoji">' + (wd.emoji || '🔤') + '</span>';
}

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
// 빈칸(밑줄)을 소리내어 읽지 않도록 정리 ("Hi! I'm ___." -> "Hi! I'm.")
function speakable(t) {
  return (t || '').replace(/_+/g, ' ').replace(/\s+([.!?,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
// 원어민 발음 mp3가 있으면 우선 재생, 없거나 실패하면 기기 TTS 폴백
function speakEN(t) {
  const src = AUDIO_MAP[t];
  if (src) {
    try {
      if (curAudio) { curAudio.pause(); }
      if (window.speechSynthesis) speechSynthesis.cancel();
      curAudio = new Audio(src);
      curAudio.play().catch(() => speak(speakable(t), 'en-US'));
      return;
    } catch (e) { /* 폴백으로 진행 */ }
  }
  speak(speakable(t), 'en-US');
}
// 한국어 안내 기계음은 끔 (거슬림). 효과음과 영어 원어민 발음은 그대로 유지.
const KO_VOICE = false;
const speakKO = t => { if (KO_VOICE) speak(t, 'ko-KR'); };

// ---------- 따라 말하기 (음성 인식) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function speechSupported() { return !!SR; }
function norm(s) { return (s || '').toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim(); }
// 목표 문장을 듣고 비슷하면 onResult(true), 아니면 onResult(false, 들린말). 미지원/거부 시 onUnsupported()
function listenFor(target, onResult, onUnsupported, onStart) {
  if (!SR) { onUnsupported && onUnsupported(); return null; }
  let rec;
  try { rec = new SR(); } catch (e) { onUnsupported && onUnsupported(); return null; }
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 5;
  let done = false;
  rec.onstart = () => { onStart && onStart(); };
  rec.onresult = (ev) => {
    done = true;
    const want = norm(target);
    let ok = false, heard = '';
    for (let i = 0; i < ev.results[0].length; i++) {
      const alt = norm(ev.results[0][i].transcript);
      if (i === 0) heard = ev.results[0][i].transcript;
      if (alt === want || alt.indexOf(want) >= 0 || want.indexOf(alt) >= 0) { ok = true; break; }
      // 한 단어 목표면 들린 문장 안에 포함되는지도 확인
      if (want.split(' ').length === 1 && alt.split(' ').indexOf(want) >= 0) { ok = true; break; }
    }
    onResult(ok, heard);
  };
  rec.onerror = (e) => { if (!done) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onUnsupported && onUnsupported(); else onResult(false, ''); } };
  try { rec.start(); } catch (e) { onUnsupported && onUnsupported(); return null; }
  return rec;
}

// ---------- 내 발음 녹음 (MediaRecorder, 원어민과 비교 재생) ----------
function recordSupported() { return !!(navigator.mediaDevices && window.MediaRecorder); }
let recAudioUrl = null;
// onState(state) 로 ui 갱신: 'recording' | 'done' | 'error'
function recordVoice(seconds, onState) {
  if (!recordSupported()) { onState('error'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const chunks = [];
    let mr;
    try { mr = new MediaRecorder(stream); } catch (e) { onState('error'); stream.getTracks().forEach(t => t.stop()); return; }
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (recAudioUrl) { try { URL.revokeObjectURL(recAudioUrl); } catch (e) {} }
      recAudioUrl = URL.createObjectURL(new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' }));
      onState('done');
    };
    mr.start();
    onState('recording');
    setTimeout(() => { try { mr.stop(); } catch (e) {} }, seconds * 1000);
  }).catch(() => onState('error'));
}
function playRecording() {
  if (recAudioUrl) { try { new Audio(recAudioUrl).play(); } catch (e) {} }
}

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

// ---------- 유튜브 영상 (앱 안에서 바로 재생) ----------
// 썸네일을 눌러야 iframe을 띄움 (데이터 절약 + 자동재생 방지)
function videoCard(videoId, title) {
  const wrap = document.createElement('div');
  wrap.className = 'video-card';
  const thumb = document.createElement('div');
  thumb.className = 'video-thumb';
  thumb.style.backgroundImage = "url('https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg')";
  thumb.innerHTML = '<div class="video-play">▶</div>';
  thumb.onclick = () => {
    const ifr = document.createElement('iframe');
    ifr.className = 'video-frame';
    ifr.allow = 'autoplay; encrypted-media; picture-in-picture';
    ifr.allowFullscreen = true;
    ifr.src = 'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=1&rel=0&playsinline=1';
    wrap.innerHTML = '';
    wrap.appendChild(ifr);
  };
  wrap.appendChild(thumb);
  return wrap;
}

// ---------- 화면 전환 ----------
const $ = id => document.getElementById(id);
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// ---------- 홈 ----------
function renderHome() {
  if (!CUR) return;   // 데이터 로딩 전 진입 방어
  $('hud-coins').textContent = '🪙 ' + S.coins.toLocaleString();
  $('hud-coins').onclick = renderCards;   // 코인 누르면 카드(쓰는 곳)로
  $('hud-streak').textContent = '🔥 ' + S.streak + '일';
  const unused = S.coupons.filter(c => !c.used).length;
  $('btn-coupons').innerHTML = '<span class="ic">🎟️</span>내 쿠폰' + (unused ? ' (' + unused + ')' : '');
  const w = curWeek();
  const totalDays = 12 * 7;
  const dayNo = (S.week - 1) * 7 + S.day;
  const pct = Math.min(100, Math.round(((S.week - 1) * 7 + (S.day - 1)) / totalDays * 100));
  if (!w) {
    $('hero-day').textContent = '🏆 완주';
    $('home-progress').textContent = '12주 시즌 우승!';
    $('hero-bar').style.width = '100%';
    $('home-msg').textContent = (S.name || '친구') + ', 시즌 우승을 축하해!';
  } else {
    $('hero-day').textContent = 'DAY ' + dayNo;
    $('home-progress').textContent = S.week + '주차 · ' + dayLabel() + ' · ' + w.theme_ko;
    $('hero-bar').style.width = pct + '%';
    $('home-msg').textContent = S.lastDone === today()
      ? '오늘 훈련 끝! 내일 또 만나요 😊'
      : (S.name || '친구') + ', 오늘도 훈련하러 가요!';
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
    return { steps: ['boss', 'reward'], idx: 0, correct: 0, total: 0, newWords: [], phrase: null, weekWords };
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
  $('lesson-dots').innerHTML = L.steps.map((s, i) => '<span class="dot' + (i <= L.idx ? ' on' : '') + '"></span>').join('');
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
  if (step === 'boss') return uiBoss();
  if (step === 'phrase') return uiPhrase();
  if (step === 'song') return uiSongDay();
  if (step === 'reward') return uiReward();
}

// 1단계 — 오늘의 단어 (듣기 + 따라 말하기)
function uiWords() {
  const area = $('lesson-area');
  area.innerHTML = '<div class="quiz-q">오늘의 단어! 카드를 눌러 듣고, 🎤 따라 말해 봐 👇</div>';
  L.newWords.forEach(wd => {
    const c = document.createElement('div');
    c.className = 'word-card';
    c.innerHTML = '<div class="emoji">' + visualHTML(wd) + '</div><div class="en">' + wd.en + '</div><div class="ko">' + wd.ko + '</div>';
    const sayRow = document.createElement('div');
    sayRow.className = 'say-row';
    const hearBtn = document.createElement('button');
    hearBtn.className = 'say-btn';
    hearBtn.textContent = '🔊 듣기';
    hearBtn.onclick = (e) => { e.stopPropagation(); speakEN(wd.en); };
    const micBtn = document.createElement('button');
    micBtn.className = 'say-btn mic';
    micBtn.textContent = '🎤 따라 말하기';
    const fb = document.createElement('div');
    fb.className = 'say-fb';
    micBtn.onclick = (e) => {
      e.stopPropagation();
      micBtn.textContent = '🎤 듣는 중...';
      micBtn.disabled = true;
      listenFor(wd.en,
        (ok) => {
          micBtn.disabled = false;
          if (ok) {
            micBtn.textContent = '🎤 따라 말하기';
            fb.textContent = '⭐ 완벽해요!'; fb.className = 'say-fb good';
            sfxGood(); speakKO('잘했어요!');
          } else {
            micBtn.textContent = '🎤 다시 말하기';
            fb.textContent = '다시 한 번 또박또박! 🔊 듣기를 눌러 봐'; fb.className = 'say-fb retry';
          }
        },
        () => {  // 음성인식 미지원/마이크 거부 → 자기확인 모드
          micBtn.disabled = false;
          micBtn.textContent = '✅ 말했어요!';
          micBtn.classList.add('selfcheck');
          micBtn.onclick = (ev) => { ev.stopPropagation(); fb.textContent = '⭐ 잘했어요!'; fb.className = 'say-fb good'; sfxGood(); };
          fb.textContent = '이 기기는 마이크 채점이 안 돼요. 소리 내어 따라 말하고 눌러요'; fb.className = 'say-fb';
        },
        () => { fb.textContent = '🎙️ 지금 말해요!'; fb.className = 'say-fb'; }
      );
    };
    c.onclick = () => speakEN(wd.en);
    sayRow.appendChild(hearBtn);
    sayRow.appendChild(micBtn);
    // 내 발음 녹음 + 비교 재생
    const recRow = document.createElement('div');
    recRow.className = 'say-row';
    if (recordSupported()) {
      const recBtn = document.createElement('button');
      recBtn.className = 'say-btn';
      recBtn.textContent = '🎙️ 내 발음 녹음';
      recBtn.onclick = (e) => {
        e.stopPropagation();
        recordVoice(2.5, (st) => {
          if (st === 'recording') { recBtn.textContent = '● 녹음 중...'; recBtn.disabled = true; }
          else if (st === 'done') {
            recBtn.disabled = false; recBtn.textContent = '🎙️ 다시 녹음';
            recRow.querySelectorAll('.play-cmp').forEach(x => x.remove());
            const mine = document.createElement('button');
            mine.className = 'say-btn play-cmp';
            mine.textContent = '▶ 내 발음';
            mine.onclick = (ev) => { ev.stopPropagation(); playRecording(); };
            const nat = document.createElement('button');
            nat.className = 'say-btn play-cmp mic';
            nat.textContent = '🔊 원어민';
            nat.onclick = (ev) => { ev.stopPropagation(); speakEN(wd.en); };
            recRow.appendChild(mine); recRow.appendChild(nat);
          } else { recBtn.disabled = false; recBtn.textContent = '🎙️ 녹음 안 됨'; }
        });
      };
      recRow.appendChild(recBtn);
    }
    area.appendChild(c);
    area.appendChild(sayRow);
    if (recRow.children.length) area.appendChild(recRow);
    area.appendChild(fb);
  });
  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.textContent = '다 했어요! 👉';
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

// 6일차 — 주말 보스전 (한 주 단어 종합, 맞히면 보스 체력 깎기)
const BOSSES = ['👹', '🤖', '🐉', '👾', '🦖', '🦑', '👻', '🐲'];
function uiBoss() {
  const words = shuffle((L.weekWords || []).slice()).slice(0, 8);
  if (!words.length) { nextStep(); return; }
  const boss = BOSSES[(curWeek().week - 1) % BOSSES.length];
  const maxHp = words.length;
  let hp = maxHp, qi = 0;
  const area = $('lesson-area');
  function bar() { return '<div class="boss-bar"><i style="width:' + Math.round(hp / maxHp * 100) + '%"></i></div>'; }
  function ask() {
    if (qi >= words.length || hp <= 0) {
      area.innerHTML = '<div class="boss-wrap"><div class="boss win">' + boss + '</div></div>' +
        '<div class="quiz-q" style="font-size:1.2rem;color:var(--accent)">보스를 물리쳤다! 🏆</div>';
      sfxGoal(); goalFx();
      const b = document.createElement('button'); b.className = 'next-btn'; b.textContent = '계속 👉'; b.onclick = nextStep;
      area.appendChild(b);
      return;
    }
    const word = words[qi];
    const opts = shuffle([word].concat(pickOthers(word, 2)));
    area.innerHTML =
      '<div class="quiz-q">⚔️ 주말 보스전! 들리는 단어를 맞혀 보스를 공격! (' + (qi + 1) + '/' + words.length + ')</div>' +
      '<div class="boss-wrap"><div class="boss">' + boss + '</div>' + bar() + '</div>';
    const hear = document.createElement('button');
    hear.className = 'speak-btn'; hear.textContent = '🔊 다시 듣기';
    hear.onclick = () => speakEN(word.en);
    area.appendChild(hear);
    const box = document.createElement('div'); box.className = 'quiz-opts';
    opts.forEach(o => {
      const b = document.createElement('button'); b.className = 'opt'; b.innerHTML = visualHTML(o);
      b.onclick = () => {
        const ok = o.en === word.en; L.total++;
        if (ok) {
          L.correct++; hp--; b.classList.add('correct'); sfxGoal();
          const bw = document.querySelector('.boss'); if (bw) { bw.classList.add('hit'); setTimeout(() => bw.classList.remove('hit'), 300); }
        } else { b.classList.add('wrong'); sfxBad(); }
        setTimeout(() => { qi++; ask(); }, ok ? 800 : 1100);
      };
      box.appendChild(b);
    });
    area.appendChild(box);
    speakEN(word.en);
  }
  ask();
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
      b.innerHTML = visualHTML(o);
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

// 빈칸(___)을 아이 이름으로 채움. 이름 없으면 친근한 기본값.
function fillName(text) {
  if (text.indexOf('___') < 0) return text;
  const nm = (S && S.name && S.name.trim()) ? S.name.trim() : 'Sam';
  return text.replace(/_{2,}/g, nm);
}

// 4단계 — 오늘의 한 마디
function uiPhrase() {
  const p = L.phrase;
  if (!p) { nextStep(); return; }
  const en = fillName(p.en);
  const ko = fillName(p.ko).replace(/\(이\)/g, '');  // "___(이)야" 처리
  const hasBlank = p.en.indexOf('___') >= 0;
  const area = $('lesson-area');
  area.innerHTML =
    '<div class="quiz-q">오늘의 한 마디 🗣️</div>' +
    '<div class="word-card"><div class="en">' + en + '</div><div class="ko">' + ko + '</div></div>' +
    (hasBlank ? '<div class="quiz-q" style="font-size:.92rem">내 이름을 넣어 말해 봐요!</div>' : '');
  const hear = document.createElement('button');
  hear.className = 'speak-btn';
  hear.textContent = '🔊 들어 보기';
  hear.onclick = () => speakEN(en);
  area.appendChild(hear);
  const done = document.createElement('button');
  done.className = 'next-btn';
  done.textContent = '따라 말했어요! 👉';
  done.onclick = nextStep;
  area.appendChild(done);
  setTimeout(() => speakEN(en), 400);
}

// 노래의 날 — 영상 보기 + 노래 단어 + 가사 빈칸 게임
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
    '<div class="word-card"><div class="en" style="font-size:1.4rem">' + s.title + '</div>' +
    '<div class="ko">' + (s.artist || '') + '<br>' + (s.theme_ko || '') + '</div></div>';
  if (s.videoId) area.appendChild(videoCard(s.videoId, s.title));
  const q2 = document.createElement('div');
  q2.className = 'quiz-q';
  q2.textContent = '노래에 나오는 단어! 눌러서 들어 봐 👇';
  area.appendChild(q2);
  (s.words || []).forEach(wd => {
    const c = document.createElement('div');
    c.className = 'word-card';
    c.innerHTML = '<div class="emoji">' + visualHTML(wd) + '</div><div class="en" style="font-size:1.3rem">' + wd.en + '</div><div class="ko">' + wd.ko + '</div>';
    c.onclick = () => speakEN(wd.en);
    area.appendChild(c);
  });
  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.textContent = '🎮 가사 빈칸 게임 하기!';
  btn.onclick = () => lyricsGame(s.game || [], nextStep);
  area.appendChild(btn);
}

// 가사 빈칸 게임 — 한 줄을 듣고 빠진 단어를 보기에서 고르기
function lyricsGame(lines, onDone) {
  if (!lines.length) { onDone(); return; }
  let gi = 0;
  const area = $('lesson-area');
  function ask() {
    if (gi >= lines.length) { onDone(); return; }
    const ln = lines[gi];
    const shown = ln.full.replace(new RegExp('\\b' + ln.blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '＿＿＿');
    area.innerHTML =
      '<div class="quiz-q">🎤 노래 가사! 빠진 단어를 골라 봐 (' + (gi + 1) + '/' + lines.length + ')</div>' +
      '<div class="lyric-line">' + shown + '</div>' +
      '<div class="lyric-ko">' + ln.ko + '</div>';
    const hear = document.createElement('button');
    hear.className = 'speak-btn';
    hear.textContent = '🔊 가사 듣기';
    hear.onclick = () => speakEN(ln.full);
    area.appendChild(hear);
    const box = document.createElement('div');
    box.className = 'quiz-opts';
    shuffle(ln.opts.slice()).forEach(o => {
      const b = document.createElement('button');
      b.className = 'opt text';
      b.textContent = o;
      b.onclick = () => {
        const ok = o.toLowerCase() === ln.blank.toLowerCase();
        L.total++;
        if (ok) {
          L.correct++;
          b.classList.add('correct');
          sfxGoal(); goalFx();
          speakEN(ln.full);
        } else {
          b.classList.add('wrong');
          sfxBad();
        }
        setTimeout(() => { gi++; ask(); }, ok ? 1500 : 1100);
      };
      box.appendChild(b);
    });
    area.appendChild(box);
    setTimeout(() => speakEN(ln.full), 300);
  }
  ask();
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
    (doneBefore ? '' : '<div class="reward-hint">🪙 코인은 홈 위 🪙 에 모여요 (지금 ' + S.coins.toLocaleString() + '개)<br>100코인이면 <b>카드 뽑기</b>를 할 수 있어요!</div>') +
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
    let face;
    if (owned && CARD_IMG[c.id]) face = '<img class="cardimg" src="' + CARD_IMG[c.id] + '" alt="" loading="lazy">';
    else face = '<div class="face">' + (owned ? c.face : '🔒') + '</div>';
    d.innerHTML = face + '<div class="nm">' + (owned ? c.nm : '???') + '</div>';
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
  const dup = S.cards.includes(card.id);
  let sub;
  if (dup) { S.coins += 20; sub = '이미 있어서 코인 +20 돌려받았어!'; }
  else {
    S.cards.push(card.id);
    sub = card.r === 'legend' ? '🌟 레전드 카드!!' : card.r === 'rare' ? '💙 레어 카드!' : '획득!';
    goalFx(); sfxGoal();
  }
  save();
  revealCard(card, sub, !dup);
}
// 카드 뽑기 결과를 큰 그림으로 보여주는 오버레이
function revealCard(card, sub, isNew) {
  const ov = $('reveal-overlay');
  const img = CARD_IMG[card.id]
    ? '<img class="reveal-img ' + card.r + '" src="' + CARD_IMG[card.id] + '" alt="">'
    : '<div class="reveal-emoji">' + card.face + '</div>';
  ov.innerHTML = '<div class="reveal-box">' + img +
    '<div class="reveal-nm">' + card.nm + '</div>' +
    '<div class="reveal-sub">' + sub + '</div>' +
    '<button id="reveal-ok" class="cta">좋아!</button></div>';
  ov.classList.remove('hidden');
  if (isNew) speakKO('새 카드를 얻었어요!');
  $('reveal-ok').onclick = () => { ov.classList.add('hidden'); renderCards(); };
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
    d.innerHTML = '<div class="en" style="font-size:1.15rem">🎵 ' + w.song.title + '</div>' +
      '<div class="ko">' + w.song.artist + ' · ' + w.week + '주차 · ' + w.song.theme_ko + '</div>';
    d.onclick = () => openSong(w.song);
    area.appendChild(d);
  });
  // 부모가 추가한 곡 (내가 신청한 노래)
  if (CUSTOM.length) {
    const h = document.createElement('div');
    h.className = 'quiz-q';
    h.textContent = '⭐ 내가 신청한 노래';
    area.appendChild(h);
    CUSTOM.slice().reverse().forEach(s => {
      const d = document.createElement('div');
      d.className = 'word-card';
      d.innerHTML = '<div class="en" style="font-size:1.15rem">🎵 ' + s.title + '</div>' +
        '<div class="ko">' + (s.artist || '') + '</div>';
      d.onclick = () => openSong(s);
      area.appendChild(d);
    });
  }
  show('screen-song');
}

// 노래방에서 곡 하나 열기 — 앱 안에서 영상 재생 + 단어 + 가사 게임 연습
function openSong(s) {
  const area = $('songview-area');
  area.innerHTML =
    '<div class="word-card"><div class="en" style="font-size:1.3rem">' + s.title + '</div>' +
    '<div class="ko">' + s.artist + '<br>' + s.theme_ko + '</div></div>';
  if (s.videoId) area.appendChild(videoCard(s.videoId, s.title));
  if (s.videoId) {
    const kb = document.createElement('button');
    kb.className = 'speak-btn';
    kb.textContent = '🎤 가사 보며 노래방';
    kb.onclick = () => openKaraoke(s);
    area.appendChild(kb);
  }
  (s.words || []).forEach(wd => {
    const c = document.createElement('div');
    c.className = 'word-card';
    c.innerHTML = '<div class="emoji">' + visualHTML(wd) + '</div><div class="en" style="font-size:1.2rem">' + wd.en + '</div><div class="ko">' + wd.ko + '</div>';
    c.onclick = () => speakEN(wd.en);
    area.appendChild(c);
  });
  if (s.game && s.game.length) {
    const gb = document.createElement('button');
    gb.className = 'next-btn';
    gb.textContent = '🎮 가사 빈칸 게임 (연습)';
    gb.onclick = () => {
      L = { steps: [], idx: 0, correct: 0, total: 0 };  // 연습용 임시(보상/저장 없음)
      lyricsGame(s.game, () => openSong(s));
      show('screen-lesson');
    };
    area.appendChild(gb);
  }
  show('screen-songview');
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

// ---------- 노래방 가사 하이라이트 (재생 시 LRCLIB에서 받아옴, 앱에 가사 저장 안 함) ----------
let ytApiState = 0;  // 0 미로드 1 로딩중 2 준비됨
let ytReadyCbs = [];
function loadYTApi(cb) {
  if (ytApiState === 2) return cb();
  ytReadyCbs.push(cb);
  if (ytApiState === 1) return;
  ytApiState = 1;
  window.onYouTubeIframeAPIReady = () => { ytApiState = 2; ytReadyCbs.forEach(f => f()); ytReadyCbs = []; };
  const t = document.createElement('script');
  t.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(t);
}
function parseLRC(text) {
  const out = [];
  (text || '').split('\n').forEach(line => {
    const m = line.match(/^\[(\d+):(\d+)(?:\.(\d+))?\]\s*(.*)$/);
    if (m) {
      const t = (+m[1]) * 60 + (+m[2]) + (m[3] ? parseFloat('0.' + m[3]) : 0);
      const txt = (m[4] || '').trim();
      if (txt) out.push({ t: t, txt: txt });
    }
  });
  return out;
}
let kPlayer = null, kTimer = null, kLines = [], kOffset = 0, kActive = -1;
function stopKaraoke() {
  if (kTimer) { clearInterval(kTimer); kTimer = null; }
  try { if (kPlayer && kPlayer.destroy) kPlayer.destroy(); } catch (e) {}
  kPlayer = null;
  const wrap = $('k-player-wrap');
  if (wrap) wrap.innerHTML = '<div id="k-player"></div>';
}
function openKaraoke(s) {
  if (!s.videoId) { alert('이 곡은 영상이 없어 가사 따라보기를 할 수 없어요.'); return; }
  kOffset = 0; kActive = -1; kLines = [];
  $('karaoke-title').textContent = '🎤 ' + s.title;
  $('karaoke-lyrics').innerHTML = '<div class="klyric">가사를 불러오는 중...</div>';
  show('screen-karaoke');
  stopKaraoke();
  const q = s.title + ' ' + (s.artist || '');
  fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q))
    .then(r => r.json())
    .then(list => {
      const hit = (list || []).find(x => x.syncedLyrics);
      if (!hit) {
        $('karaoke-lyrics').innerHTML = '<div class="klyric">이 곡은 가사 따라보기가 준비되지 않았어요.<br>위 영상으로 즐겨요! 🎵</div>';
      } else {
        kLines = parseLRC(hit.syncedLyrics);
        renderKLyrics();
      }
      loadYTApi(() => {
        kPlayer = new YT.Player('k-player', {
          videoId: s.videoId,
          playerVars: { playsinline: 1, rel: 0, autoplay: 1 },
          events: { onReady: () => { if (kLines.length) startKaraokeLoop(); } }
        });
      });
    })
    .catch(() => {
      $('karaoke-lyrics').innerHTML = '<div class="klyric">가사를 불러오지 못했어요. 영상으로 즐겨요! 🎵</div>';
      loadYTApi(() => { kPlayer = new YT.Player('k-player', { videoId: s.videoId, playerVars: { playsinline: 1, rel: 0, autoplay: 1 } }); });
    });
}
function renderKLyrics() {
  const box = $('karaoke-lyrics');
  box.innerHTML = '';
  kLines.forEach((ln, i) => {
    const d = document.createElement('div');
    d.className = 'klyric';
    d.id = 'kl-' + i;
    d.textContent = ln.txt;
    d.onclick = () => { try { if (kPlayer && kPlayer.seekTo) kPlayer.seekTo(Math.max(0, ln.t - kOffset), true); } catch (e) {} };
    box.appendChild(d);
  });
}
function startKaraokeLoop() {
  if (kTimer) clearInterval(kTimer);
  kTimer = setInterval(() => {
    if (!kPlayer || !kPlayer.getCurrentTime) return;
    let now;
    try { now = kPlayer.getCurrentTime() + kOffset; } catch (e) { return; }
    let idx = -1;
    for (let i = 0; i < kLines.length; i++) { if (kLines[i].t <= now) idx = i; else break; }
    if (idx !== kActive) {
      const prev = $('kl-' + kActive); if (prev) prev.classList.remove('active');
      const cur = $('kl-' + idx);
      if (cur) {
        cur.classList.add('active');
        cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      kActive = idx;
    }
  }, 250);
}

// ---------- 부모 진행 현황 ----------
let gateAnswer = 0;
function openParentGate() {
  const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4);
  gateAnswer = a * b;
  $('gate-q').textContent = a + ' × ' + b;
  $('gate-input').value = '';
  $('gate-fb').textContent = '';
  $('parent-gate').classList.remove('hidden');
  $('parent-dash').classList.add('hidden');
  show('screen-parent');
}
function checkGate() {
  if (parseInt($('gate-input').value, 10) === gateAnswer) {
    $('parent-gate').classList.add('hidden');
    renderParentDash();
  } else {
    $('gate-fb').textContent = '답이 달라요. 다시 확인해 주세요.';
    $('gate-fb').className = 'say-fb retry';
  }
}
function statRow(lbl, val, cls) {
  return '<div class="stat-card"><span class="lbl">' + lbl + '</span><span class="val ' + (cls || '') + '">' + val + '</span></div>';
}
function renderParentDash() {
  const dash = $('parent-dash');
  const totalDays = 12 * 7;
  const doneDays = (S.week - 1) * 7 + (S.day - 1);
  const pct = Math.min(100, Math.round(doneDays / totalDays * 100));
  const dueCount = S.learned.filter(x => x.due <= today()).length;
  const unusedCoupon = S.coupons.filter(c => !c.used);
  const unusedAmt = unusedCoupon.reduce((a, c) => a + c.amount, 0);
  const totalAmt = S.coupons.reduce((a, c) => a + c.amount, 0);
  dash.innerHTML =
    '<div class="bubble"><b>' + (S.name || '우리 아이') + '</b> 의 학습 현황이에요</div>' +
    statRow('진도', S.week + '주차 ' + S.day + '일차 (' + pct + '%)', 'accent') +
    statRow('연속 출석', S.streak + '일', 'accent') +
    statRow('가진 코인', S.coins + ' 🪙', '') +
    statRow('배운 단어', S.learned.length + '개', '') +
    statRow('오늘 복습할 단어', dueCount + '개', '') +
    statRow('모은 카드', S.cards.length + ' / 12', '') +
    statRow('받은 쿠폰', S.coupons.length + '장 (누적 ' + totalAmt.toLocaleString() + '원)', 'gold') +
    statRow('아직 안 준 쿠폰', unusedCoupon.length + '장 (' + unusedAmt.toLocaleString() + '원)', 'gold') +
    statRow('마지막 학습일', (S.lastDone || '아직 없음'), '');
  const nameBtn = document.createElement('button');
  nameBtn.className = 'big';
  nameBtn.textContent = '✏️ 이름 바꾸기 (현재: ' + (S.name || '없음') + ')';
  nameBtn.onclick = () => {
    const n = prompt('아이 이름을 적어 주세요 (영어 문장 빈칸에 들어가요)', S.name || '');
    if (n !== null) { S.name = n.trim().slice(0, 8); save(); renderParentDash(); }
  };
  dash.appendChild(nameBtn);
  dash.classList.remove('hidden');
}

// ---------- 알파벳 따라 쓰기 ----------
let traceIdx = 0, traceCtx = null, traceDrawing = false;
const TRACE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
function openTrace() {
  show('screen-trace');
  setupTraceCanvas();
  renderTrace();
}
function setupTraceCanvas() {
  const cv = $('trace-canvas');
  const rect = cv.getBoundingClientRect();
  cv.width = rect.width || 320; cv.height = rect.height || 320;
  traceCtx = cv.getContext('2d');
  traceCtx.lineWidth = 14; traceCtx.lineCap = 'round'; traceCtx.lineJoin = 'round';
  traceCtx.strokeStyle = '#a3e635';
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (cv.width / r.width), y: (p.clientY - r.top) * (cv.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); traceDrawing = true; const o = pos(e); traceCtx.beginPath(); traceCtx.moveTo(o.x, o.y); };
  const move = (e) => { if (!traceDrawing) return; e.preventDefault(); const o = pos(e); traceCtx.lineTo(o.x, o.y); traceCtx.stroke(); };
  const end = () => { traceDrawing = false; };
  cv.onpointerdown = start; cv.onpointermove = move; cv.onpointerup = end; cv.onpointerleave = end;
  cv.ontouchstart = start; cv.ontouchmove = move; cv.ontouchend = end;
}
function clearTrace() { if (traceCtx) traceCtx.clearRect(0, 0, $('trace-canvas').width, $('trace-canvas').height); }
function renderTrace() {
  const L1 = TRACE_LETTERS[traceIdx];
  $('trace-guide').textContent = L1;
  $('trace-progress').textContent = (traceIdx + 1) + ' / 26';
  clearTrace();
  speakEN(L1);
}
function traceMove(d) {
  traceIdx = (traceIdx + d + 26) % 26;
  renderTrace();
}

// ---------- 영어 대화 (코치 바나나, 제미나이) — 키는 이 폰에만 저장 ----------
const GKEY_STORE = 'ke_gkey';
let chatHist = [];   // {role:'user'|'model', text}
const CHAT_SYS = [
  'You are Coach Banana, a cheerful soccer coach helping a young Korean child (age 7-9, beginner English).',
  'Reply in VERY simple English, ONE short sentence only (max 8 words).',
  'Be warm, playful, encouraging. Always end with one easy question to keep chatting.',
  'Use only easy topics: soccer, animals, colors, family, food, school, feelings.',
  'Never use scary or inappropriate content. If the child writes Korean, still answer in simple English.',
  'After your English sentence, add the Korean translation on a new line in parentheses.'
].join(' ');
function getGKey() { return localStorage.getItem(GKEY_STORE) || ''; }
function openChat() {
  if (!getGKey()) { $('chat-setup').classList.remove('hidden'); $('chat-main').classList.add('hidden'); }
  else { $('chat-setup').classList.add('hidden'); $('chat-main').classList.remove('hidden'); if (!chatHist.length) chatStart(); }
  show('screen-chat');
}
function saveGKey() {
  const k = $('chat-key-input').value.trim();
  if (k.length < 20) { alert('키가 올바르지 않아 보여요. 다시 확인해 주세요.'); return; }
  localStorage.setItem(GKEY_STORE, k);
  $('chat-key-input').value = '';
  openChat();
}
function splitReply(text) {
  // "English\n(한국어)" 분리
  const m = text.match(/^([\s\S]*?)[\(（]([\s\S]*?)[\)）]\s*$/);
  if (m) return { en: m[1].trim(), ko: m[2].trim() };
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  return { en: lines[0] || text.trim(), ko: lines[1] || '' };
}
function addMsg(role, en, ko) {
  const log = $('chat-log');
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'me' ? 'me' : 'bot');
  d.innerHTML = '<span class="t"></span>' + (role === 'bot' ? '<span class="say">🔊</span>' : '') +
    (ko ? '<span class="ko"></span>' : '');
  d.querySelector('.t').textContent = en;
  if (ko) d.querySelector('.ko').textContent = ko;
  if (role === 'bot') { d.querySelector('.say').onclick = () => speakEN(en); }
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}
function setQuick(chips) {
  const q = $('chat-quick');
  q.innerHTML = '';
  chips.forEach(c => {
    const b = document.createElement('button');
    b.className = 'qchip'; b.textContent = c;
    b.onclick = () => chatSend(c);
    q.appendChild(b);
  });
}
async function callGemini(historyForApi) {
  const key = getGKey();
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
  const body = {
    systemInstruction: { parts: [{ text: CHAT_SYS }] },
    contents: historyForApi.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { maxOutputTokens: 80, temperature: 0.8 }
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json();
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map(p => p.text || '').join(' ').trim();
}
function chatStart() {
  $('chat-log').innerHTML = '';
  chatHist = [];
  const hi = "Hi! I am Coach Banana!\n(안녕! 나는 코치 바나나야!)";
  const s = splitReply(hi);
  chatHist.push({ role: 'model', text: hi });
  addMsg('bot', s.en, s.ko);
  speakEN(s.en);
  setQuick(['Hello!', 'I like soccer!', 'How are you?']);
}
async function chatSend(text) {
  if (!text) return;
  setQuick([]);
  addMsg('me', text, '');
  chatHist.push({ role: 'user', text: text });
  const typing = addMsg('bot', '...', '');
  typing.classList.add('typing');
  try {
    const reply = await callGemini(chatHist.slice(-12));
    typing.remove();
    const s = splitReply(reply || "Good job! Let's keep going!\n(잘했어! 계속 해보자!)");
    chatHist.push({ role: 'model', text: reply });
    addMsg('bot', s.en, s.ko);
    speakEN(s.en);
    setQuick(['Yes!', 'No', 'I like it!', 'Why?']);
  } catch (e) {
    typing.remove();
    addMsg('bot', '앗, 연결이 안 돼요. 키나 인터넷을 확인해 주세요.', '');
  }
}
// 자유 발화 인식 (대화용)
function chatListen() {
  const SRk = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('chat-mic');
  if (!SRk) { chatType(); return; }
  let rec;
  try { rec = new SRk(); } catch (e) { chatType(); return; }
  rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
  mic.textContent = '🎙️ 듣는 중...'; mic.disabled = true;
  rec.onresult = (ev) => { const t = ev.results[0][0].transcript; mic.textContent = '🎤 말하기'; mic.disabled = false; if (t) chatSend(t); };
  rec.onerror = () => { mic.textContent = '🎤 말하기'; mic.disabled = false; };
  rec.onend = () => { mic.textContent = '🎤 말하기'; mic.disabled = false; };
  try { rec.start(); } catch (e) { mic.textContent = '🎤 말하기'; mic.disabled = false; chatType(); }
}
function chatType() {
  const t = prompt('영어로 써 보세요 (Type in English):');
  if (t && t.trim()) chatSend(t.trim());
}

// ---------- 시작/이벤트 ----------
function init() {
  load();
  fetch('data/audio_map.json')
    .then(r => r.json())
    .then(m => { AUDIO_MAP = m; })
    .catch(() => { AUDIO_MAP = {}; });
  fetch('data/custom_songs.json')
    .then(r => r.json())
    .then(c => { CUSTOM = Array.isArray(c) ? c : []; })
    .catch(() => { CUSTOM = []; });
  fetch('data/img_map.json')
    .then(r => r.json())
    .then(m => { IMG_MAP = m || {}; })
    .catch(() => { IMG_MAP = {}; });
  fetch('data/card_img.json')
    .then(r => r.json())
    .then(m => { CARD_IMG = m || {}; })
    .catch(() => { CARD_IMG = {}; });
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
  $('btn-songview-back').onclick = renderSongRoom;
  $('btn-songview-home').onclick = renderHome;
  $('btn-lesson-home').onclick = renderHome;
  $('btn-cards-home').onclick = renderHome;
  $('btn-song-home').onclick = renderHome;
  $('btn-coupons').onclick = renderCoupons;
  $('btn-coupons-home').onclick = renderHome;
  $('btn-pack').onclick = openPack;
  $('btn-parent').onclick = openParentGate;
  $('btn-parent-home').onclick = renderHome;
  $('btn-trace').onclick = openTrace;
  $('btn-trace-home').onclick = renderHome;
  $('trace-hear').onclick = () => speakEN(TRACE_LETTERS[traceIdx]);
  $('trace-clear').onclick = clearTrace;
  $('trace-prev').onclick = () => traceMove(-1);
  $('trace-next').onclick = () => traceMove(1);
  $('btn-chat').onclick = openChat;
  $('btn-chat-home').onclick = renderHome;
  $('btn-chat-key').onclick = () => { $('chat-setup').classList.remove('hidden'); $('chat-main').classList.add('hidden'); };
  $('chat-key-save').onclick = saveGKey;
  $('chat-mic').onclick = chatListen;
  $('chat-type').onclick = chatType;
  $('gate-ok').onclick = checkGate;
  $('btn-karaoke-back').onclick = () => { stopKaraoke(); renderSongRoom(); };
  $('btn-karaoke-home').onclick = () => { stopKaraoke(); renderHome(); };

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
