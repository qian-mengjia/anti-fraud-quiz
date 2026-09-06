const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGameState,
  addPlayer,
  startGame,
  advanceQuestion,
  recordAnswer,
  rankPlayers,
  assignRandomQuestions,
  syncRoomState,
  endGame,
  removePlayer,
} = require('./game-state');

const QUESTIONS = [
  { id: 1, answer: 1, prompt: 'q1' },
  { id: 2, answer: 0, prompt: 'q2' },
];

test('recordAnswer awards one point for a correct answer', () => {
  const state = startGame(createGameState(QUESTIONS, 0), 0);
  const withPlayer = addPlayer(state, '小林', 0);
  const next = recordAnswer(withPlayer, withPlayer.players[0].id, 1, 1, 5000);

  assert.equal(next.players[0].score, 1);
  assert.equal(next.players[0].answeredQuestionIds.length, 1);
});

test('recordAnswer ignores the same question after it has been answered once', () => {
  const state = startGame(createGameState(QUESTIONS, 0), 0);
  const withPlayer = addPlayer(state, '小林', 0);
  const first = recordAnswer(withPlayer, withPlayer.players[0].id, 1, 1, 5000);
  const second = recordAnswer(first, withPlayer.players[0].id, 1, 1, 6000);

  assert.equal(second.players[0].score, 1);
  assert.equal(second.players[0].answeredQuestionIds.length, 1);
});

test('rankPlayers sorts by score then faster elapsed time', () => {
  const ranked = rankPlayers([
    { name: 'A', score: 12, elapsedMs: 120000 },
    { name: 'B', score: 12, elapsedMs: 110000 },
    { name: 'C', score: 10, elapsedMs: 90000 },
  ]);

  assert.deepEqual(ranked.map((p) => p.name), ['B', 'A', 'C']);
});

test('startGame opens the first question and sets the deadline', () => {
  const state = createGameState(QUESTIONS, 1000);
  const started = startGame(state, 2000);

  assert.equal(started.started, true);
  assert.equal(started.currentQuestionIndex, 0);
  assert.equal(started.questionEndsAt, 17000);
});

test('advanceQuestion moves to the next question until the quiz ends', () => {
  const state = startGame(createGameState(QUESTIONS, 1000), 2000);
  const next = advanceQuestion(state, 18000);
  const done = advanceQuestion(next, 34000);

  assert.equal(next.currentQuestionIndex, 1);
  assert.equal(next.questionEndsAt, 33000);
  assert.equal(done.completed, true);
  assert.equal(done.currentQuestionIndex, 1);
  assert.equal(done.questionEndsAt, null);
});

test('recordAnswer records a timeout as answered without points', () => {
  const state = startGame(createGameState(QUESTIONS, 0), 0);
  const withPlayer = addPlayer(state, '小林', 0);
  const next = recordAnswer(withPlayer, withPlayer.players[0].id, 1, null, 15000);

  assert.equal(next.players[0].score, 0);
  assert.equal(next.players[0].answeredQuestionIds.length, 1);
});

test('assignRandomQuestions returns a unique fixed-size subset', () => {
  const bank = Array.from({ length: 20 }, (_, index) => ({ id: index + 1 }));
  const assigned = assignRandomQuestions(bank, 15, () => 0.25);

  assert.equal(assigned.length, 15);
  assert.equal(new Set(assigned.map((question) => question.id)).size, 15);
});

test('each player gets an independent question assignment', () => {
  const bank = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    answer: 0,
    prompt: `q${index + 1}`,
  }));
  const state = createGameState(bank, 0);
  const first = addPlayer(state, '小林', 0, () => 0);
  const second = addPlayer(first, '小周', 1, () => 0.9);

  assert.equal(first.players[0].assignedQuestionIds.length, 15);
  assert.equal(second.players[1].assignedQuestionIds.length, 15);
  assert.notDeepEqual(
    first.players[0].assignedQuestionIds,
    second.players[1].assignedQuestionIds,
  );
});

test('recordAnswer rejects questions outside the player assignment', () => {
  const bank = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    answer: 0,
    prompt: `q${index + 1}`,
  }));
  const state = createGameState(bank, 0);
  const withPlayer = addPlayer(state, '小林', 0, () => 0);
  const rejected = recordAnswer(withPlayer, withPlayer.players[0].id, 20, 0, 1000);

  assert.equal(rejected.players[0].score, 0);
  assert.equal(rejected.players[0].answeredQuestionIds.length, 0);
});

test('startGame places the room into a shared countdown before running', () => {
  const state = createGameState(QUESTIONS, 0);
  const withPlayer = addPlayer(state, '小林', 0);
  const countdown = startGame(withPlayer, 1000, 3000);

  assert.equal(countdown.status, 'countdown');
  assert.equal(countdown.countdownEndsAt, 4000);

  const running = syncRoomState(countdown, 4000);
  assert.equal(running.status, 'running');
  assert.equal(running.countdownEndsAt, null);
  assert.equal(running.startedAt, 4000);
});

test('endGame closes the room and prevents further answers', () => {
  const state = startGame(addPlayer(createGameState(QUESTIONS, 0), '小林', 0), 1000);
  const ended = endGame(state, 2000);
  const rejected = recordAnswer(ended, ended.players[0].id, 1, 1, 1000);

  assert.equal(ended.status, 'ended');
  assert.equal(ended.endedAt, 2000);
  assert.equal(rejected.players[0].answeredQuestionIds.length, 0);
});

test('removePlayer only removes a player while the room is waiting', () => {
  const waiting = addPlayer(createGameState(QUESTIONS, 0), '小林', 0);
  const removed = removePlayer(waiting, waiting.players[0].id);
  assert.equal(removed.players.length, 0);

  const running = startGame(addPlayer(createGameState(QUESTIONS, 0), '小周', 0), 0);
  const unchanged = removePlayer(running, running.players[0].id);
  assert.equal(unchanged.players.length, 1);
});

test('addPlayer keeps player ids unique after a waiting player leaves', () => {
  const first = addPlayer(createGameState(QUESTIONS, 0), '小林', 0);
  const waiting = removePlayer(first, first.players[0].id);
  const second = addPlayer(waiting, '小周', 1);

  assert.equal(second.players[0].id, 'player-2');
});
