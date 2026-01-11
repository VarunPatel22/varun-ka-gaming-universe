// Final script.js — crown playback made robust; leaderboard avatars fixed to avoid collapsing
// Socket server fixed remote URL as requested
const BACKEND_LOCAL = "http://localhost:3000";
const BACKEND_REMOTE = "https://truth-comes-out-backend.onrender.com";
// Use remote backend by default (you can switch to BACKEND_LOCAL when developing locally)
const SOCKET_SERVER_URL = "https://truth-comes-out-backend.onrender.com";

console.log("[app] socket target:", SOCKET_SERVER_URL);

/* ----- Globals ----- */
let socket = null;
let mySocketId = null;
let currentPhase = "lobby";
let roomCode = null;
let isHost = false;
let hasSubmitted = false;
let hasVoted = false;
let myName = null;

const ICON_BASE = "/icons";
const ICON_COUNT = 20;
let selectedAvatar = `${ICON_BASE}/icon-1.jpg`;
const avatarImages = Array.from({ length: ICON_COUNT }, (_, i) => `${ICON_BASE}/icon-${i+1}.jpg`);
const playersIconMap = {};
let crownAnimationInstance = null;

/* ----- Small helpers ----- */
function log(...a){ console.log("[app]", ...a); }
function warn(...a){ console.warn("[app]", ...a); }
function err(...a){ console.error("[app]", ...a); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function makeAvatarPlaceholder(i){ const colors=['#ffd166','#ef476f','#06d6a0','#118ab2','#073b4c','#8e44ad']; const c=colors[i%colors.length]; const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' rx='16' fill='${c}'/><text x='50%' y='54%' text-anchor='middle' fill='#04243B' font-family='Inter,Arial' font-size='48'>${i}</text></svg>`; return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`; }
async function urlExists(url){ try { const r = await fetch(url, { method:'HEAD' }); return r.ok; } catch(e) { return false; } }

/* ----- Dynamic script loader (used for lottie fallback) ----- */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      // already present - wait a tick
      return resolve();
    }
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
}

/* ----- Avatars UI ----- */
async function ensureAvatars() {
  if (!await urlExists(avatarImages[0])) {
    warn("Avatar icons missing; using placeholders.");
    for (let i=0;i<avatarImages.length;i++) avatarImages[i] = makeAvatarPlaceholder(i+1);
    selectedAvatar = avatarImages[0];
  } else {
    selectedAvatar = avatarImages[0];
  }
}

function renderAvatars() {
  const track = document.getElementById("avatarStrip");
  if (!track) return;
  track.innerHTML = "";
  avatarImages.forEach((src, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-btn";
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.padding = "0";
    btn.style.cursor = "pointer";
    btn.setAttribute("aria-label", `Avatar ${idx+1}`);

    const img = document.createElement("img");
    img.src = src;
    img.alt = `avatar-${idx+1}`;
    img.className = "avatar";
    if (src === selectedAvatar) img.classList.add("selected");

    btn.appendChild(img);
    btn.addEventListener("click", () => {
      selectedAvatar = src;
      document.querySelectorAll(".avatar-track .avatar").forEach(a => a.classList.remove("selected"));
      img.classList.add("selected");
      log("avatar selected", src);
    });

    track.appendChild(btn);
  });
}

function scrollAvatarTrack(direction=1){
  const track = document.getElementById("avatarStrip");
  if (!track) return;
  const amount = Math.round(track.clientWidth * 0.6) * direction;
  track.scrollBy({ left: amount, behavior: 'smooth' });
}

/* ----- UI helpers ----- */
function show(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(screenId);
  if (el) el.classList.add("active");
  currentPhase = screenId;
}

function disableAnswerInput(disabled = true) {
  const answerBox = document.getElementById("answerBox") || document.getElementById("answer");
  if (answerBox) answerBox.disabled = disabled;
  const submitBtn = document.getElementById("submitButton") || document.getElementById("submit");
  if (submitBtn) submitBtn.disabled = disabled;
}

/* ----- Host UI ----- */
function updateHostControls() {
  document.querySelectorAll(".host-only").forEach(el => {
    if (isHost) {
      if (el.classList && el.classList.contains('rounds-row')) el.style.display = 'flex';
      else if (el.tagName && el.tagName.toLowerCase() === 'button') el.style.display = 'inline-block';
      else el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
  const roundsSel = document.getElementById("roundSelect");
  if (roundsSel) roundsSel.disabled = !isHost;
}

/* ----- Scoreboard / players ----- */
function updatePlayerList(players) {
  const list = document.getElementById("playerList");
  if (!list) return;
  list.innerHTML = "";
  players.forEach(p => {
    const li = document.createElement("li");
    li.style.display = 'flex'; li.style.gap='12px'; li.style.alignItems='center';
    const img = document.createElement("img");
    img.src = p.avatar || selectedAvatar;
    img.alt = "avatar";
    img.className = "player-avatar";
    // ensure stable sizing
    img.style.width = '48px'; img.style.height = '48px'; img.style.flex = '0 0 48px'; img.style.objectFit = 'cover'; img.style.borderRadius = '12px';
    const span = document.createElement("span"); span.innerText = p.name || "Player";
    li.appendChild(img); li.appendChild(span); list.appendChild(li);
    playersIconMap[p.name] = p.avatar;
  });
}

/* ----- Update scoreboard (simple) ----- */
function updateScoreboard(scores) {
  const entries = Object.entries(scores || {});
  const inline = entries.map(([name, s]) => {
    const ic = playersIconMap[name] || selectedAvatar;
    return `<span class="score-inline"><img src="${ic}" class="avatar-xs" alt="avatar"> ${escapeHtml(name)}: <strong>${s}</strong></span>`;
  }).join("  |  ");
  const top = document.getElementById("topScoreboard"); if (top) top.innerHTML = inline || "Scores — —";
  const voteArea = document.getElementById("scoreBoard"); if (voteArea) voteArea.innerHTML = inline || "Scores — —";
}

/* ----- Robust crown playback ----- */
const REMOTE_LOTTIE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.9.6/lottie.min.js';

async function playCrownOnElement(containerElement) {
  if (!containerElement) return;

  // ensure lottie is available
  if (typeof window.lottie === 'undefined' || !window.lottie.loadAnimation) {
    try {
      await loadScript(REMOTE_LOTTIE_CDN);
      log('lottie loaded dynamically');
    } catch (e) {
      warn('failed to load lottie:', e);
      return;
    }
  }

  // destroy previous
  try { if (crownAnimationInstance && crownAnimationInstance.destroy) crownAnimationInstance.destroy(); } catch(e){}

  // fetch animation JSON (handle spaces in filename)
  try {
    const res = await fetch(encodeURI('/animations/Loading Crown.json'));
    if (!res.ok) throw new Error('crown JSON not found: ' + res.status);
    const data = await res.json();

    crownAnimationInstance = window.lottie.loadAnimation({
      container: containerElement,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: data
    });
    // ensure container uses full size
    containerElement.style.width = containerElement.style.width || '88px';
    containerElement.style.height = containerElement.style.height || '88px';
    containerElement.style.display = 'block';
  } catch (err) {
    warn('Could not play crown animation:', err);
  }
}

/* ----- Socket event wiring ----- */
function wireSocketHandlers() {
  if (!socket) return;
  socket.on('connect', () => {
    mySocketId = socket.id;
    log('socket connected', mySocketId);
  });

  socket.on('room-created', data => {
    log('room-created', data);
    roomCode = data.roomCode;
    isHost = data.host && mySocketId ? (data.host === mySocketId) : isHost;
    document.getElementById("roomCodeText").innerText = roomCode || '—';
    show('lobby');
    updatePlayerList(Array.isArray(data.players) ? data.players : []);
    updateHostControls();
  });

  socket.on('player-update', payload => {
    let players = [];
    let hostId = null;
    if (Array.isArray(payload)) players = payload;
    else if (payload && payload.players) { players = payload.players; hostId = payload.host; }
    if (hostId && mySocketId) isHost = (hostId === mySocketId);
    updatePlayerList(players);
    updateHostControls();
  });

  socket.on('new-question', q => {
    // reset state/UI
    currentPhase = 'answer';
    hasSubmitted = false;
    hasVoted = false;
    show('game');

    const qText = document.getElementById('questionText');
    if (qText) qText.innerText = q?.text || 'Say something funny 😄';

    const answerBox = document.getElementById('answerBox') || document.getElementById('answer');
    if (answerBox) { answerBox.value = ''; answerBox.disabled = false; }

    const submitBtn = document.getElementById('submitButton') || document.getElementById('submit');
    if (submitBtn) { submitBtn.disabled = false; if (submitBtn.tagName.toLowerCase() === 'button') submitBtn.innerText = 'Submit'; }

    // start timer if server sends duration or default 60
    const duration = (q && q.duration && Number.isFinite(q.duration)) ? Number(q.duration) : 60;
    if (typeof startTimer === 'function') startTimer(duration);
  });

  socket.on('submission-update', ({ submitted, total }) => {
    const txt = `Waiting for others... (${submitted}/${total})`;
    const top = document.getElementById('topScoreboard'); if (top) top.innerText = txt;
    const voteScore = document.getElementById('scoreBoard'); if (voteScore) voteScore.innerText = txt;
  });

  socket.on('phase-vote', answers => {
    // stop timer if running
    if (typeof clearTimer === 'function') clearTimer();
    currentPhase = 'vote'; show('vote'); disableAnswerInput(true);
    const box = document.getElementById('options'); if (!box) return;
    box.innerHTML = ''; box.classList.add('vote-list');
    if (!answers || !answers.length) { box.innerHTML = '<p>No answers to vote 😄</p>'; return; }
    answers.forEach((a, idx) => {
      const btn = document.createElement('button');
      btn.className = 'vote-option bounce-down';
      btn.style.animationDelay = `${idx * 80}ms`;
      btn.textContent = a.text || '—';
      if (a.author === mySocketId) { btn.setAttribute('aria-disabled','true'); btn.onclick = () => alert('You cannot vote for your own answer.'); }
      else { btn.onclick = () => { if (hasVoted) return; hasVoted = true; box.innerHTML = '<p>Vote submitted ✅</p>'; socket.emit('vote', { roomCode, votedFor: a.author }); }; }
      box.appendChild(btn);
    });
  });

  socket.on('scores-update', scores => updateScoreboard(scores));

  socket.on('game-over', scores => {
    // ensure timer cleared
    if (typeof clearTimer === 'function') clearTimer();

    currentPhase = 'results';
    show('results');

    const winnerArea = document.getElementById('winnerArea');
    if (winnerArea) {
      winnerArea.innerHTML = '';
      const arr = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
      if (arr.length) {
        const [name, pts] = arr[0];

        // Winner center (crown + big avatar)
        const center = document.createElement('div');
        center.className = 'winner-center';

        const crownWrap = document.createElement('div');
        crownWrap.className = 'winner-crown';
        const crownInner = document.createElement('div');
        crownInner.className = 'winner-crown-inner';
        crownWrap.appendChild(crownInner);

        const img = document.createElement('img');
        img.src = playersIconMap[name] || selectedAvatar;
        img.alt = 'winner';
        img.className = 'winner-avatar';

        const nameEl = document.createElement('div');
        nameEl.className = 'winner-name-large';
        nameEl.innerText = `${name}`;

        const points = document.createElement('div');
        points.className = 'winner-pts';
        points.innerText = `${pts} pts`;

        center.appendChild(crownWrap);
        center.appendChild(img);
        center.appendChild(nameEl);
        center.appendChild(points);
        winnerArea.appendChild(center);

        // Play crown animation (robust)
        setTimeout(() => {
          playCrownOnElement(crownInner);
        }, 40);
      }
    }

    // remaining players list (leaderboard) — ensure small fixed avatars
    const list = document.getElementById('leaderboard');
    if (list) {
      list.innerHTML = '';
      const arr = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
      arr.slice(1).forEach(([name, score]) => {
        const li = document.createElement('li');
        li.className = 'leader-row';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.justifyContent = 'space-between';
        li.style.gap = '12px';
        li.style.padding = '8px 12px';
        li.style.borderRadius = '10px';
        li.style.background = 'rgba(255,255,255,0.02)';
        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '12px';

        const img = document.createElement('img');
        img.src = playersIconMap[name] || selectedAvatar;
        img.alt = name;
        img.className = 'leader-avatar';
        // force conservative inline size in case global rules clash
        img.style.width = '48px';
        img.style.height = '48px';
        img.style.minWidth = '48px';
        img.style.minHeight = '48px';
        img.style.flex = '0 0 48px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '10px';

        const txt = document.createElement('span');
        txt.innerText = name;
        txt.style.fontWeight = '700';

        left.appendChild(img);
        left.appendChild(txt);

        const right = document.createElement('span');
        right.innerText = `${score}`;
        right.style.fontWeight = '900';

        li.appendChild(left);
        li.appendChild(right);
        list.appendChild(li);
      });
    }
  });

  socket.on('connect_error', err => warn('connect_error', err));
  socket.on('disconnect', reason => warn('socket disconnected', reason));
}

/* ----- Socket / actions ----- */
function initSocket() {
  if (typeof io === 'undefined') {
    err('socket.io client (io) not loaded. Ensure script tag is present in index.html.');
    return false;
  }
  try {
    socket = io(SOCKET_SERVER_URL, { transports: ['websocket','polling'] });
    wireSocketHandlers();
    return true;
  } catch (e) {
    err('init socket failed', e);
    return false;
  }
}

window.createRoom = function() {
  if (!socket || socket.connected === false) { alert('Not connected to server'); return; }
  const name = (document.getElementById("username")?.value || "").trim() || "Host";
  myName = name;
  const avatar = selectedAvatar || avatarImages[0];
  socket.emit('create-room', { name, avatar });
};

window.joinRoom = function() {
  if (!socket || socket.connected === false) { alert('Not connected to server'); return; }
  const name = (document.getElementById("username")?.value || "").trim() || "Player";
  myName = name;
  const code = (document.getElementById("roomInput")?.value || "").trim();
  if (!code) return alert('Enter room code');
  const avatar = selectedAvatar || avatarImages[0];
  socket.emit('join-room', { roomCode: code, name, avatar });
  roomCode = code;
  show('lobby');
};

window.startGame = function() {
  if (!isHost) return alert('Only the host can start');
  if (!socket || socket.connected === false) return alert('Not connected to server');
  const roundsSel = document.getElementById('roundSelect');
  const rounds = roundsSel ? parseInt(roundsSel.value, 10) : 5;
  socket.emit('set-rounds', { roomCode, rounds });
  socket.emit('start-game', roomCode);
};

window.submitAnswer = function() {
  const answerInput = document.getElementById("answerBox") || document.getElementById("answer");
  const val = answerInput ? (answerInput.value || "") : "";
  if (hasSubmitted) return;
  if (val.trim().length < 1) { alert("Please enter at least 1 character"); return; }
  hasSubmitted = true;
  if (answerInput) answerInput.disabled = true;
  const btn = document.getElementById("submitButton") || document.getElementById("submit");
  if (btn) { btn.disabled = true; btn.innerText = "Submitted"; }
  const waitingText = "You submitted — waiting for others...";
  const top = document.getElementById("topScoreboard");
  if (top) { top.innerText = waitingText; top.title = waitingText; }
  const voteScore = document.getElementById("scoreBoard");
  if (voteScore) voteScore.innerText = waitingText;
  socket.emit('submit-answer', { roomCode, answer: val });
};

/* ----- Timer implementation (exposed for new-question) ----- */
let timerInterval = null;
let timerSecondsTotal = 60;
function clearTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
function setTimerText(text) {
  const idTimer = document.getElementById("timer");
  if (idTimer) idTimer.textContent = text;
  document.querySelectorAll(".timer-text").forEach(el => el.textContent = text);
}
function setTimerRingPercent(pct) {
  const ring = document.getElementById("timerRing");
  if (!ring) return;
  const r = 45;
  const circumference = 2 * Math.PI * r;
  ring.style.strokeDasharray = `${circumference}`;
  const offset = circumference * (1 - pct);
  ring.style.strokeDashoffset = `${offset}`;
}
function startTimer(seconds = 60) {
  clearTimer();
  timerSecondsTotal = seconds;
  let time = seconds;
  setTimerText(`⏳ ${time}s`);
  setTimerRingPercent(1);
  const answerBox = document.getElementById('answerBox') || document.getElementById('answer');
  const submitBtn = document.getElementById('submitButton') || document.getElementById('submit');
  if (answerBox) { answerBox.disabled = false; }
  if (submitBtn) { submitBtn.disabled = false; if (submitBtn.tagName.toLowerCase()==='button') submitBtn.innerText = 'Submit'; }
  timerInterval = setInterval(() => {
    time--;
    if (time < 0) {
      clearTimer();
      setTimerText("⏱ Time’s up!");
      setTimerRingPercent(0);
      hasSubmitted = true;
      if (answerBox) answerBox.disabled = true;
      if (submitBtn) { submitBtn.disabled = true; if (submitBtn.tagName.toLowerCase()==='button') submitBtn.innerText = 'Submitted'; }
      return;
    }
    setTimerText(`⏳ ${time}s`);
    setTimerRingPercent(Math.max(0, time / timerSecondsTotal));
  }, 1000);
}

/* ----- bootstrap ----- */
window.addEventListener('DOMContentLoaded', async () => {
  await ensureAvatars().catch(e => warn('ensureAvatars failed', e));
  renderAvatars();
  document.getElementById('avatarPrev')?.addEventListener('click', ()=>scrollAvatarTrack(-1));
  document.getElementById('avatarNext')?.addEventListener('click', ()=>scrollAvatarTrack(1));

  const ok = initSocket();
  if (!ok) {
    alert('Socket initialization failed. Ensure backend is running and socket.io client is loaded in index.html.');
  }
});