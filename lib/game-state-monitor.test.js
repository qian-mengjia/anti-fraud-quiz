const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGameState,
  addPlayer,
  startGame,
  recordAnswer,
  getMonitorSnapshot,
} = require('./game-state');

const QUESTIONS = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  answer: 0,
  prompt: `q${index + 1}`,
}));

test('getMonitorSnapshot reports totals and recent activity', () => {
  const state = createGameState(QUESTIONS, 0);
  const withPlayer = addPlayer(state, '小林', 0, () => 0);
  const running = startGame(withPlayer, 0);
  const answered = recordAnswer(running, running.players[0].id, running.players[0].assignedQuestionIds[0], 0, 3000);
  const snapshot = getMonitorSnapshot(answered);

  assert.equal(snapshot.totalPlayers, 1);
  assert.equal(snapshot.activePlayers, 1);
  assert.equal(snapshot.completedPlayers, 0);
  assert.equal(snapshot.status, 'running');
  assert.equal(snapshot.maxScore, 1);
  assert.equal(snapshot.recentActivity.length, 1);
  assert.equal(snapshot.recentActivity[0].name, '小林');
});
