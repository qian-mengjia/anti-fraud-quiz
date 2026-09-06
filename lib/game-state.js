const QUESTION_TIME_LIMIT_MS = 15000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assignRandomQuestions(questions, count = 15, rng = Math.random) {
  const shuffled = clone(questions);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function createGameState(questions, createdAt = Date.now()) {
  return {
    createdAt,
    questions: clone(questions),
    players: [],
    nextPlayerNumber: 1,
    status: 'waiting',
    started: false,
    completed: false,
    startedAt: null,
    countdownEndsAt: null,
    endedAt: null,
    currentQuestionIndex: -1,
    questionEndsAt: null,
    activity: [],
  };
}

function addPlayer(state, name, joinedAt = Date.now(), rng = Math.random) {
  const next = clone(state);
  const assignedQuestions = assignRandomQuestions(next.questions, 15, rng);
  const player = {
    id: `player-${next.nextPlayerNumber}`,
    name,
    joinedAt,
    score: 0,
    elapsedMs: 0,
    assignedQuestionIds: assignedQuestions.map((question) => question.id),
    answeredQuestionIds: [],
    completed: false,
  };

  next.players.push(player);
  next.nextPlayerNumber += 1;
  return next;
}

function startGame(state, startedAt = Date.now(), countdownMs = 0) {
  const next = clone(state);
  if (next.status !== 'waiting') return state;

  next.started = true;
  next.completed = false;
  next.endedAt = null;

  if (countdownMs > 0) {
    next.status = 'countdown';
    next.startedAt = null;
    next.countdownEndsAt = startedAt + countdownMs;
    next.currentQuestionIndex = -1;
    next.questionEndsAt = null;
    return next;
  }

  next.status = 'running';
  next.countdownEndsAt = null;
  next.startedAt = startedAt;
  next.currentQuestionIndex = next.questions.length ? 0 : -1;
  next.questionEndsAt = next.currentQuestionIndex >= 0
    ? startedAt + QUESTION_TIME_LIMIT_MS
    : null;
  if (next.currentQuestionIndex < 0) {
    next.status = 'ended';
    next.completed = true;
    next.endedAt = startedAt;
  }
  return next;
}

function syncRoomState(state, now = Date.now()) {
  if (state.status !== 'countdown' || now < state.countdownEndsAt) return state;

  const next = clone(state);
  next.status = next.questions.length ? 'running' : 'ended';
  next.startedAt = next.countdownEndsAt;
  next.countdownEndsAt = null;
  next.currentQuestionIndex = next.questions.length ? 0 : -1;
  next.questionEndsAt = next.questions.length
    ? next.startedAt + QUESTION_TIME_LIMIT_MS
    : null;
  next.completed = next.status === 'ended';
  next.endedAt = next.completed ? now : null;
  return next;
}

function advanceQuestion(state, at = Date.now()) {
  const next = clone(state);
  if (next.status !== 'running' || next.completed) return next;

  const nextIndex = next.currentQuestionIndex + 1;
  if (nextIndex >= next.questions.length) {
    next.status = 'ended';
    next.completed = true;
    next.endedAt = at;
    next.questionEndsAt = null;
    return next;
  }

  next.currentQuestionIndex = nextIndex;
  next.questionEndsAt = at + QUESTION_TIME_LIMIT_MS;
  return next;
}

function recordAnswer(state, playerId, questionId, choiceIndex, elapsedMs) {
  if (state.status !== 'running') return state;

  const next = clone(state);

  const player = next.players.find((item) => item.id === playerId);
  if (!player) return state;

  if (player.answeredQuestionIds.includes(questionId)) {
    return state;
  }

  if (!player.assignedQuestionIds.includes(questionId)) {
    return state;
  }

  const question = next.questions.find((item) => item.id === questionId);
  if (!question) return state;

  const spentMs = Math.max(0, Math.min(elapsedMs ?? 0, QUESTION_TIME_LIMIT_MS));
  player.answeredQuestionIds.push(questionId);
  player.elapsedMs += spentMs;
  player.completed = player.answeredQuestionIds.length >= player.assignedQuestionIds.length;

  if (choiceIndex !== null && choiceIndex === question.answer) {
    player.score += 1;
  }

  next.activity.push({
    name: player.name,
    playerId,
    questionId,
    correct: choiceIndex !== null && choiceIndex === question.answer,
    score: player.score,
    at: Date.now(),
  });

  return next;
}

function rankPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.answeredQuestionIds?.length !== b.answeredQuestionIds?.length) {
      return (b.answeredQuestionIds?.length || 0) - (a.answeredQuestionIds?.length || 0);
    }
    if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    return a.joinedAt - b.joinedAt;
  });
}

function getMonitorSnapshot(state) {
  const ranked = rankPlayers(state.players);
  const totalPlayers = state.players.length;
  const completedPlayers = state.players.filter((player) => player.completed).length;
  const maxScore = totalPlayers
    ? Math.max(...state.players.map((player) => player.score))
    : 0;

  return {
    status: state.status,
    countdownEndsAt: state.countdownEndsAt,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    totalPlayers,
    activePlayers: ['countdown', 'running'].includes(state.status)
      ? totalPlayers - completedPlayers
      : 0,
    completedPlayers,
    maxScore,
    averageScore: totalPlayers
      ? Number((state.players.reduce((sum, player) => sum + player.score, 0) / totalPlayers).toFixed(1))
      : 0,
    leaderboard: ranked.map((player, index) => ({
      rank: index + 1,
      id: player.id,
      name: player.name,
      score: player.score,
      answered: player.answeredQuestionIds.length,
      total: player.assignedQuestionIds.length,
      completed: player.completed,
      elapsedMs: player.elapsedMs,
    })),
    recentActivity: state.activity.slice(-12).reverse(),
  };
}

function endGame(state, endedAt = Date.now()) {
  if (state.status === 'ended') return state;
  const next = clone(state);
  next.status = 'ended';
  next.completed = true;
  next.endedAt = endedAt;
  next.countdownEndsAt = null;
  next.questionEndsAt = null;
  return next;
}

function removePlayer(state, playerId) {
  if (state.status !== 'waiting') return state;
  const next = clone(state);
  next.players = next.players.filter((player) => player.id !== playerId);
  return next;
}

module.exports = {
  QUESTION_TIME_LIMIT_MS,
  assignRandomQuestions,
  createGameState,
  addPlayer,
  startGame,
  syncRoomState,
  advanceQuestion,
  recordAnswer,
  rankPlayers,
  getMonitorSnapshot,
  endGame,
  removePlayer,
};
