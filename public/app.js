const state = {
  player: null,
  questions: [],
  currentIndex: 0,
  timerId: null,
  roomPollId: null,
  questionStartedAt: 0,
  questionTimeLimitMs: 15000,
  answered: false,
  status: 'waiting',
  finished: false,
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  lobbyPanel: $('#lobbyPanel'),
  waitingPanel: $('#waitingPanel'),
  gamePanel: $('#gamePanel'),
  resultPanel: $('#resultPanel'),
  joinForm: $('#joinForm'),
  nameInput: $('#nameInput'),
  joinHint: $('#joinHint'),
  waitingName: $('#waitingName'),
  waitingStatus: $('#waitingStatus'),
  waitingCountdown: $('#waitingCountdown'),
  waitingLeaveButton: $('#waitingLeaveButton'),
  joinedBar: $('#joinedBar'),
  joinedName: $('#joinedName'),
  joinedScore: $('#joinedScore'),
  questionCounter: $('#questionCounter'),
  timerRing: $('#timerRing'),
  timerText: $('#timerText'),
  progressFill: $('#progressFill'),
  questionCard: $('#questionCard'),
  questionPrompt: $('#questionPrompt'),
  options: $('#options'),
  feedback: $('#feedback'),
  leaderboard: $('#leaderboard'),
  qrImage: $('#qrImage'),
  shareLink: $('#shareLink'),
  resetLocalButton: $('#resetLocalButton'),
  resultScore: $('#resultScore'),
  resultRank: $('#resultRank'),
  resultRate: $('#resultRate'),
  resultTitle: $('#resultTitle'),
  resultNote: $('#resultNote'),
};

function getStoredPlayerId() {
  return window.localStorage.getItem('anti-fraud-player-id') || '';
}

function clearStoredPlayer() {
  window.localStorage.removeItem('anti-fraud-player-id');
  window.localStorage.removeItem('anti-fraud-player-name');
}

async function requestJson(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

async function getJoinUrl() {
  try {
    const payload = await requestJson('/api/meta');
    return payload.accessUrl || (window.location.origin + window.location.pathname);
  } catch {
    return window.location.origin + window.location.pathname;
  }
}

async function setupShareCode() {
  const url = await getJoinUrl();
  elements.shareLink.textContent = url;
  try {
    const payload = await requestJson(`/api/qr?text=${encodeURIComponent(url)}`);
    elements.qrImage.src = payload.dataUrl;
  } catch {
    elements.qrImage.removeAttribute('src');
    elements.shareLink.textContent = `${url}（可复制打开）`;
  }
}

function setPanel(panel) {
  [elements.lobbyPanel, elements.waitingPanel, elements.gamePanel, elements.resultPanel]
    .forEach((item) => item.classList.toggle('hidden', item !== panel));
}

function showFeedback(message, tone = '') {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback ${tone}`.trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderLeaderboard(players = []) {
  if (!players.length) {
    elements.leaderboard.innerHTML = '<li class="rankRow"><span class="rankIndex">-</span><span class="rankName">等待同学加入</span><strong class="rankScore">0 分</strong></li>';
    return;
  }

  elements.leaderboard.innerHTML = players.slice(0, 10).map((player) => `
    <li class="rankRow ${state.player?.id === player.id ? 'is-me' : ''}">
      <span class="rankIndex">${player.rank}</span>
      <span class="rankName">${escapeHtml(player.name)}</span>
      <strong class="rankScore">${player.score} 分</strong>
    </li>
  `).join('');
}

function updateJoinedBar() {
  if (!state.player) {
    elements.joinedBar.classList.add('hidden');
    return;
  }
  elements.joinedName.textContent = state.player.name;
  elements.joinedScore.textContent = `${state.player.score} 分`;
  elements.joinedBar.classList.remove('hidden');
}

function showWaiting(payload) {
  state.status = payload.status;
  elements.waitingName.textContent = state.player?.name || '';
  elements.waitingStatus.textContent = payload.status === 'countdown'
    ? '管理员已开始，马上进入答题'
    : '等待管理员点击“开始游戏”';
  elements.waitingCountdown.textContent = payload.status === 'countdown'
    ? `${Math.max(0, Math.ceil((payload.countdownRemainingMs || 0) / 1000))}`
    : '—';
  setPanel(elements.waitingPanel);
  updateJoinedBar();
}

function renderQuestion() {
  const question = state.questions[state.currentIndex];
  if (!question) {
    finishGame();
    return;
  }

  state.answered = false;
  elements.questionCounter.textContent = `第 ${state.currentIndex + 1} 题 / 共 ${state.questions.length} 题`;
  elements.progressFill.style.width = `${((state.currentIndex + 1) / state.questions.length) * 100}%`;
  elements.questionPrompt.textContent = question.prompt;
  elements.options.innerHTML = question.options.map((option, index) => `
    <button class="optionButton" type="button" data-index="${index}">
      <span class="optionKey">${String.fromCharCode(65 + index)}</span>
      <span class="optionText">${escapeHtml(option)}</span>
    </button>
  `).join('');
  elements.options.querySelectorAll('.optionButton').forEach((button) => {
    button.addEventListener('click', () => submitAnswer(Number(button.dataset.index)));
  });

  elements.questionCard.classList.remove('shimmer');
  void elements.questionCard.offsetWidth;
  elements.questionCard.classList.add('shimmer');
  showFeedback('请选择最稳妥的处理方式。');
  startTimer();
}

function startTimer() {
  window.clearInterval(state.timerId);
  state.questionStartedAt = Date.now();
  let lastSecond = -1;

  const tick = () => {
    const elapsed = Date.now() - state.questionStartedAt;
    const remaining = Math.max(0, state.questionTimeLimitMs - elapsed);
    const seconds = remaining / 1000;
    const rounded = Math.ceil(seconds);
    elements.timerText.textContent = seconds.toFixed(1);
    elements.timerRing.style.setProperty('--progress', `${(remaining / state.questionTimeLimitMs) * 360}deg`);
    elements.timerText.classList.toggle('urgent', seconds <= 5);

    if (rounded !== lastSecond && rounded <= 5) {
      lastSecond = rounded;
      elements.timerRing.classList.remove('shake');
      void elements.timerRing.offsetWidth;
      elements.timerRing.classList.add('shake');
    }

    if (remaining <= 0) {
      window.clearInterval(state.timerId);
      submitAnswer(null, true);
    }
  };

  tick();
  state.timerId = window.setInterval(tick, 100);
}

async function submitAnswer(choiceIndex, timedOut = false) {
  if (state.answered || !state.player || state.status !== 'running') return;
  state.answered = true;
  window.clearInterval(state.timerId);

  const question = state.questions[state.currentIndex];
  const elapsedMs = Math.min(state.questionTimeLimitMs, Date.now() - state.questionStartedAt);
  const buttons = [...elements.options.querySelectorAll('.optionButton')];
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const payload = await requestJson('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: state.player.id,
        questionId: question.id,
        choiceIndex,
        elapsedMs,
      }),
    });

    state.player = payload.player;
    renderLeaderboard(payload.players);
    updateJoinedBar();

    if (choiceIndex !== null) {
      buttons[choiceIndex]?.classList.add(payload.correct ? 'correct' : 'wrong');
    }
    buttons[payload.correctIndex]?.classList.add('correct');

    if (timedOut) {
      showFeedback(`时间到！${payload.tip}`, 'bad');
    } else if (payload.correct) {
      showFeedback(`答对了！${payload.tip}`, 'good');
    } else {
      showFeedback(`再接再厉。${payload.tip}`, 'bad');
    }

    window.setTimeout(() => {
      state.currentIndex += 1;
      renderQuestion();
    }, timedOut ? 450 : 650);
  } catch (error) {
    state.answered = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
    showFeedback(error.message, 'bad');
  }
}

function beginRunning(payload) {
  state.status = 'running';
  state.questions = payload.questions?.length ? payload.questions : state.questions;
  state.currentIndex = payload.player?.answered || state.player?.answered || 0;
  state.questionTimeLimitMs = payload.questionTimeLimitMs || state.questionTimeLimitMs;
  if (payload.player) state.player = payload.player;
  updateJoinedBar();
  if (state.currentIndex >= state.questions.length) {
    finishGame();
  } else {
    setPanel(elements.gamePanel);
    renderQuestion();
  }
}

function applyRoomPayload(payload) {
  state.status = payload.status;
  if (payload.player) {
    state.player = payload.player;
    if (payload.questions?.length) state.questions = payload.questions;
    state.questionTimeLimitMs = payload.questionTimeLimitMs || state.questionTimeLimitMs;
    updateJoinedBar();
  }
  renderLeaderboard(payload.players);

  if (!state.player || state.finished) return;
  if (payload.status === 'waiting' || payload.status === 'countdown') {
    showWaiting(payload);
    return;
  }
  if (payload.status === 'running' && !state.timerId && !state.answered) {
    beginRunning(payload);
    return;
  }
  if (payload.status === 'ended') {
    finishGame();
  }
}

async function refreshRoom() {
  if (!state.player || state.finished) return;
  try {
    const payload = await requestJson(`/api/room?playerId=${encodeURIComponent(state.player.id)}`);
    applyRoomPayload(payload);
  } catch {
    // Keep the last visible state during a short network interruption.
  }
}

async function joinGame(event) {
  event.preventDefault();
  const name = elements.nameInput.value.trim() || '匿名同学';
  elements.joinHint.textContent = '正在加入答题场，请稍候...';

  try {
    const payload = await requestJson('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, playerId: getStoredPlayerId() }),
    });

    state.finished = false;
    state.player = payload.player;
    state.questions = payload.questions || [];
    state.questionTimeLimitMs = payload.questionTimeLimitMs || state.questionTimeLimitMs;
    window.localStorage.setItem('anti-fraud-player-id', payload.player.id);
    window.localStorage.setItem('anti-fraud-player-name', payload.player.name);
    applyRoomPayload(payload);
    window.clearInterval(state.roomPollId);
    state.roomPollId = window.setInterval(refreshRoom, 1000);
  } catch (error) {
    elements.joinHint.textContent = error.message;
  }
}

async function leaveCurrentPlayer() {
  if (!state.player) {
    clearStoredPlayer();
    window.location.reload();
    return;
  }
  if (state.status !== 'waiting') {
    elements.joinHint.textContent = '游戏已经开始，不能清除参赛记录；如需处理请联系管理员。';
    return;
  }

  try {
    await requestJson('/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: state.player.id }),
    });
    clearStoredPlayer();
    window.location.reload();
  } catch (error) {
    elements.joinHint.textContent = error.message;
  }
}

async function finishGame() {
  if (state.finished || !state.player) return;
  state.finished = true;
  state.status = 'ended';
  window.clearInterval(state.timerId);
  window.clearInterval(state.roomPollId);
  const leaderboardPayload = await requestJson('/api/leaderboard').catch(() => ({ players: [] }));
  const me = leaderboardPayload.players.find((player) => player.id === state.player.id);
  const rank = me?.rank || '-';
  const score = me?.score ?? state.player.score ?? 0;
  const rate = Math.round((score / Math.max(1, state.questions.length)) * 100);

  elements.resultScore.textContent = score;
  elements.resultRank.textContent = rank;
  elements.resultRate.textContent = `${rate}%`;
  elements.resultTitle.textContent = `${state.player.name}，本局结束`;
  elements.resultNote.textContent = '感谢参与反诈知识闯关。记住：不轻信、不透露、不转账。';
  renderLeaderboard(leaderboardPayload.players);
  setPanel(elements.resultPanel);
}

elements.joinForm.addEventListener('submit', joinGame);
elements.resetLocalButton.addEventListener('click', leaveCurrentPlayer);
elements.waitingLeaveButton.addEventListener('click', leaveCurrentPlayer);
elements.nameInput.value = window.localStorage.getItem('anti-fraud-player-name') || '';
setupShareCode();
renderLeaderboard();
