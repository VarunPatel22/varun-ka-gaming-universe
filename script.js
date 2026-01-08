// ================== SOCKET CONNECTION ==================
const socket = io("https://truth-comes-out-backend.onrender.com");

// ================== GLOBAL STATE ==================
let currentPhase = "lobby";
let roomCode = null;
let isHost = false;
let mySocketId = null;
let hasSubmitted = false;
let hasVoted = false;

// ================== SOCKET ID ==================
socket.on("connect", () => {
  mySocketId = socket.id;
});

// ================== HELPERS ==================
function updateScoreboard(scores) {
  // scores is { playerName: score }
  const text = Object.entries(scores)
    .map(([name, s]) => `${name}: ${s}`)
    .join("  |  ");

  const roundInfo = document.getElementById("roundInfo");
  if (roundInfo) roundInfo.innerText = `Scores — ${text}`;

  const scoreBoard = document.getElementById("scoreBoard");
  if (scoreBoard) scoreBoard.innerText = `Scores — ${text}`;

  const scoresPre = document.getElementById("scores");
  if (scoresPre) scoresPre.innerText = text;
}

function disableAnswerInput(disabled = true) {
  const answerBox = document.getElementById("answerBox") || document.getElementById("answer");
  if (answerBox) answerBox.disabled = disabled;

  const submitBtn = document.querySelector("#game button") || document.getElementById("submit") || document.getElementById("submitButton");
  if (submitBtn) {
    submitBtn.disabled = disabled;
    if (disabled) submitBtn.innerText = submitBtn.dataset.disabledText || "Submitted";
    else submitBtn.innerText = submitBtn.dataset.enabledText || "Submit";
  }
}

// ================== SCREEN HANDLER ==================
function show(screenId) {
  document.querySelectorAll(".screen").forEach(s =>
    s.classList.remove("active")
  );
  const el = document.getElementById(screenId);
  if (el) el.classList.add("active");
}

// ================== HOME ACTIONS ==================
function createRoom() {
  const name =
    document.getElementById("username").value.trim() || "Host";
  isHost = true;
  socket.emit("create-room", { name });
}

function joinRoom() {
  const name =
    document.getElementById("username").value.trim() || "Player";
  const code = document.getElementById("roomInput").value.trim();
  if (!code) return alert("Enter room code");
  isHost = false;

  // Ensure global roomCode is set so subsequent emits include it
  roomCode = code;

  socket.emit("join-room", { roomCode: code, name });

  // show lobby quickly; server will also emit player-update
  show("lobby");
}

// ================== ROOM CREATED ==================
socket.on("room-created", data => {
  roomCode = data.roomCode;
  currentPhase = "lobby";
  show("lobby");
  updatePlayerList(data.players);
});

// ================== PLAYER UPDATE ==================
socket.on("player-update", players => {
  updatePlayerList(players);

  // Keep lobby visible only when phase is lobby
  if (currentPhase === "lobby") {
    show("lobby");
  }
});

function updatePlayerList(players) {
  const roomCodeText = document.getElementById("roomCodeText");
  if (roomCodeText) roomCodeText.innerText = roomCode || "—";

  const list = document.getElementById("playerList");
  if (list) {
    list.innerHTML = "";
    players.forEach(p => {
      const li = document.createElement("li");
      li.innerText = p;
      list.appendChild(li);
    });
  }

  const hostControls = document.getElementById("hostControls");
  if (hostControls) {
    hostControls.style.display = isHost ? "flex" : "none";
  }

  // toggle any host-only elements
  document.querySelectorAll(".host-only").forEach(el => {
    el.style.display = isHost ? "inline-flex" : "none";
  });
}

// ================== HOST ACTIONS ==================
function startGame() {
  if (!isHost) return;
  const roundsSel = document.getElementById("roundSelect");
  const rounds = roundsSel ? parseInt(roundsSel.value) : 10;
  socket.emit("set-rounds", { roomCode, rounds });
  socket.emit("start-game", roomCode);
}

// ================== NEW QUESTION ==================
socket.on("new-question", q => {
  currentPhase = "answer";
  hasSubmitted = false;
  hasVoted = false;

  show("game");

  const qText = document.getElementById("questionText") || document.getElementById("question");
  if (qText) qText.innerText = q?.text || "Say something funny 😄";

  // Clear inputs and enable submit
  const box = document.getElementById("answerBox") || document.getElementById("answer");
  if (box) {
    box.value = "";
    box.disabled = false;
  }

  const btn = document.querySelector("#game button") || document.getElementById("submit") || document.getElementById("submitButton");
  if (btn) {
    btn.disabled = false;
    btn.innerText = "Submit";
    // store original text for later toggling
    btn.dataset.enabledText = btn.dataset.enabledText || "Submit";
    btn.dataset.disabledText = btn.dataset.disabledText || "Submitted";
  }

  // Reset timer UI and start timer
  startTimer(60);
});

// ================== TIMER ==================
let timerInterval = null;
let timerSecondsTotal = 60;
function startTimer(seconds) {
  clearInterval(timerInterval);
  timerSecondsTotal = seconds;
  let time = seconds;

  // Support updating both the SVG text element and any plain div/span with id="timer"
  const timerElements = [];
  const byId = document.getElementById("timer");
  if (byId) timerElements.push(byId);
  // also include any element with class "timer-text" (SVG <text> typically)
  document.querySelectorAll(".timer-text").forEach(el => {
    if (!timerElements.includes(el)) timerElements.push(el);
  });

  function setTimerText(text) {
    timerElements.forEach(el => {
      // Use textContent for broader compatibility (SVG <text> updates reliably)
      el.textContent = text;
    });
  }

  setTimerText(`⏳ ${time}s`);

  const ring = document.getElementById("timerRing");
  const circumference = 2 * Math.PI * 45; // r=45 used in SVG
  if (ring) {
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = "0";
  }

  // Ensure inputs enabled for new round
  disableAnswerInput(false);
  hasSubmitted = false;

  timerInterval = setInterval(() => {
    time--;
    setTimerText(`⏳ ${time}s`);

    if (ring) {
      const pct = Math.max(0, time / timerSecondsTotal);
      ring.style.strokeDashoffset = String(circumference * (1 - pct));
    }

    if (time <= 0) {
      clearInterval(timerInterval);
      setTimerText("⏱ Time’s up!");
      // local UI: disable input and submit so user can't submit after time is up
      disableAnswerInput(true);
      // mark submitted to prevent re-submission locally
      hasSubmitted = true;
      // The server will emit "phase-vote" when its timer expires;
      // client waits for that authoritative event to show vote options.
    }
  }, 1000);
}

// ================== SUBMIT ANSWER ==================
function submitAnswer() {
  if (hasSubmitted) return;
  hasSubmitted = true;

  const answerInput = document.getElementById("answerBox") || document.getElementById("answer");
  const val = answerInput ? answerInput.value : "";

  if (answerInput) answerInput.disabled = true;

  const btn = document.querySelector("#game button") || document.getElementById("submit") || document.getElementById("submitButton");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Submitted";
  }

  const qText = document.getElementById("questionText") || document.getElementById("question");
  if (qText) qText.innerText = "Waiting for others...";

  socket.emit("submit-answer", { roomCode, answer: val });
}

// ================== SUBMISSION UPDATE ==================
socket.on("submission-update", ({ submitted, total }) => {
  if (currentPhase !== "answer") return;

  const qText = document.getElementById("questionText") || document.getElementById("question");
  if (qText) qText.innerText = `Waiting for others... (${submitted}/${total})`;
});

// ================== START VOTING ==================
socket.on("phase-vote", answers => {
  currentPhase = "vote";
  clearInterval(timerInterval);

  // ensure local UI shows vote screen
  show("vote");

  // disable answer input if still open
  disableAnswerInput(true);

  const box = document.getElementById("options");
  if (!box) return;
  box.innerHTML = "";

  if (!answers || !answers.length) {
    box.innerHTML = "<p>No answers to vote 😄</p>";
    return;
  }

  // Build options excluding the current player's own answer
  const eligible = answers.filter(a => a.author !== mySocketId);

  if (eligible.length === 0) {
    box.innerHTML = "<p>No eligible answers to vote on.</p>";
    return;
  }

  eligible.forEach(a => {
    const btn = document.createElement("button");
    btn.className = "vote-option";
    btn.innerText = a.text;
    btn.onclick = () => {
      if (hasVoted) return;
      hasVoted = true;
      // disable further interaction immediately
      box.innerHTML = "<p>Vote submitted ✅</p>";
      socket.emit("vote", { roomCode, votedFor: a.author });
    };
    box.appendChild(btn);
  });
});

// ================== SCORES UPDATE (live) ==================
socket.on("scores-update", scores => {
  updateScoreboard(scores);
});

// ================== GAME OVER ==================
socket.on("game-over", scores => {
  currentPhase = "results";
  show("results");

  const list = document.getElementById("leaderboard");
  if (!list) return;
  list.innerHTML = "";

  Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, score]) => {
      const li = document.createElement("li");
      li.innerText = `${name}: ${score}`;
      list.appendChild(li);
    });
});