const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');
const QRCode = require('qrcode');
const localtunnel = require('localtunnel');

const QUESTIONS = require('./data/questions');
const {
  QUESTION_TIME_LIMIT_MS,
  createGameState,
  addPlayer,
  endGame,
  recordAnswer,
  rankPlayers,
  removePlayer,
  startGame,
  syncRoomState,
  getMonitorSnapshot,
} = require('./lib/game-state');

const PORT = Number(process.env.PORT || 3000);
const COUNTDOWN_MS = 3000;
const QUESTION_COUNT = 15;
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';
const USE_PUBLIC_TUNNEL = process.env.PUBLIC_TUNNEL === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
let publicBaseUrl = null;

let gameState = createGameState(QUESTIONS, Date.now());

function getLanHost() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        candidates.push({ name, address: entry.address });
      }
    }
  }

  const physical = candidates.find(({ name }) => !/vmware|virtual|hyper-v|loopback|docker|wsl/i.test(name));
  return (physical || candidates[0])?.address || 'localhost';
}

function getBaseUrl() {
  return publicBaseUrl || `http://${getLanHost()}:${PORT}`;
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function safeQuestions(questions) {
  return questions.map(({ answer, ...rest }) => rest);
}

function syncState() {
  const synced = syncRoomState(gameState, Date.now());
  if (synced !== gameState) gameState = synced;

  if (
    gameState.status === 'running' &&
    gameState.players.length > 0 &&
    gameState.players.every((player) => player.completed)
  ) {
    gameState = endGame(gameState, Date.now());
  }
}

function getLeaderboard() {
  return rankPlayers(gameState.players).map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    score: player.score,
    answered: player.answeredQuestionIds.length,
    elapsedMs: player.elapsedMs,
  }));
}

function publicPlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    answered: player.answeredQuestionIds.length,
    total: player.assignedQuestionIds.length,
    elapsedMs: player.elapsedMs,
    completed: player.completed,
  };
}

function getPlayerQuestions(player) {
  if (!player) return [];
  const assignedIds = new Set(player.assignedQuestionIds);
  return safeQuestions(QUESTIONS.filter((question) => assignedIds.has(question.id)))
    .sort((a, b) => player.assignedQuestionIds.indexOf(a.id) - player.assignedQuestionIds.indexOf(b.id));
}

function getRoomPayload(playerId = '') {
  syncState();
  const player = getPlayer(playerId);
  const now = Date.now();
  return {
    lanAccessUrl: `http://${getLanHost()}:${PORT}/`,
    publicAccessUrl: publicBaseUrl ? `${publicBaseUrl}/` : null,
    accessUrl: getBaseUrl() + '/',
    status: gameState.status,
    started: gameState.started,
    completed: gameState.completed,
    startedAt: gameState.startedAt,
    countdownEndsAt: gameState.countdownEndsAt,
    countdownRemainingMs: gameState.countdownEndsAt
      ? Math.max(0, gameState.countdownEndsAt - now)
      : 0,
    endedAt: gameState.endedAt,
    questionCount: QUESTION_COUNT,
    questionTimeLimitMs: QUESTION_TIME_LIMIT_MS,
    player: publicPlayer(player),
    questions: getPlayerQuestions(player),
    players: getLeaderboard(),
  };
}

function getAdminPin(req, body = {}) {
  return String(body.pin || req.headers['x-admin-pin'] || '').trim();
}

function requireAdmin(req, body, res) {
  if (getAdminPin(req, body) !== ADMIN_PIN) {
    sendJson(res, 401, { error: '管理员口令不正确' });
    return false;
  }
  return true;
}

function getPlayer(playerId) {
  return gameState.players.find((player) => player.id === playerId) || null;
}

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && requestUrl.pathname === '/api/meta') {
    sendJson(res, 200, {
      title: '智识反诈',
      questionCount: QUESTIONS.length,
      assignedQuestionCount: QUESTION_COUNT,
      questionTimeLimitMs: QUESTION_TIME_LIMIT_MS,
      countdownMs: COUNTDOWN_MS,
      lanAccessUrl: `http://${getLanHost()}:${PORT}/`,
      publicAccessUrl: publicBaseUrl ? `${publicBaseUrl}/` : null,
      accessUrl: `${getBaseUrl()}/`,
      adminUrl: `${getBaseUrl()}/admin`,
      monitorUrl: `${getBaseUrl()}/monitor`,
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/room') {
    sendJson(res, 200, getRoomPayload(requestUrl.searchParams.get('playerId') || ''));
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/leaderboard') {
    syncState();
    sendJson(res, 200, { players: getLeaderboard() });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/monitor') {
    syncState();
    sendJson(res, 200, {
      ...getMonitorSnapshot(gameState),
      questionCount: QUESTION_COUNT,
      questionTimeLimitMs: QUESTION_TIME_LIMIT_MS,
      serverTime: Date.now(),
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/room') {
    if (!requireAdmin(req, Object.fromEntries(requestUrl.searchParams), res)) return;
    syncState();
    sendJson(res, 200, {
      ...getRoomPayload(),
      monitor: getMonitorSnapshot(gameState),
      adminPinRequired: true,
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/qr') {
    const text = requestUrl.searchParams.get('text') || '';
    if (!text) {
      sendJson(res, 400, { error: 'QR text is required' });
      return;
    }

    try {
      const dataUrl = await QRCode.toDataURL(text, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      sendJson(res, 200, { dataUrl });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/join') {
    try {
      syncState();
      const body = JSON.parse(await readBody(req) || '{}');
      const name = String(body.name || '').trim().slice(0, 16) || '匿名同学';
      const playerId = String(body.playerId || '').trim();
      const existing = playerId ? getPlayer(playerId) : null;

      if (existing) {
        sendJson(res, 200, getRoomPayload(existing.id));
        return;
      }

      if (gameState.status !== 'waiting') {
        sendJson(res, 409, { error: '本局已经开始，暂时不能加入' });
        return;
      }

      gameState = addPlayer(gameState, name, Date.now());
      const player = gameState.players[gameState.players.length - 1];

      sendJson(res, 200, getRoomPayload(player.id));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/leave') {
    try {
      syncState();
      const body = JSON.parse(await readBody(req) || '{}');
      const playerId = String(body.playerId || '').trim();
      const player = getPlayer(playerId);
      if (!player) {
        sendJson(res, 200, { ok: true, removed: false });
        return;
      }
      if (gameState.status !== 'waiting') {
        sendJson(res, 409, { error: '游戏开始后不能退出，请联系管理员重置本局' });
        return;
      }
      gameState = removePlayer(gameState, playerId);
      sendJson(res, 200, { ok: true, removed: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/answer') {
    try {
      syncState();
      const body = JSON.parse(await readBody(req) || '{}');
      const playerId = String(body.playerId || '');
      const questionId = Number(body.questionId);
      const choiceIndex = body.choiceIndex === null ? null : Number(body.choiceIndex);
      const elapsedMs = Number(body.elapsedMs || 0);
      const before = getPlayer(playerId);

      if (!before) {
        sendJson(res, 404, { error: 'Player not found' });
        return;
      }

      if (gameState.status !== 'running') {
        sendJson(res, 409, { error: '管理员还没有开始答题，或本局已经结束' });
        return;
      }

      const question = QUESTIONS.find((item) => item.id === questionId);
      if (!question) {
        sendJson(res, 400, { error: 'Question not found' });
        return;
      }

      if (!before.assignedQuestionIds.includes(questionId)) {
        sendJson(res, 400, { error: '这道题不属于你的答题序列' });
        return;
      }

      if (before.answeredQuestionIds.includes(questionId)) {
        sendJson(res, 409, { error: '这道题已经提交过了' });
        return;
      }

      const boundedElapsedMs = Math.max(0, Math.min(
        Number.isFinite(elapsedMs) ? elapsedMs : 0,
        QUESTION_TIME_LIMIT_MS,
      ));
      gameState = recordAnswer(gameState, playerId, questionId, choiceIndex, boundedElapsedMs);
      const after = getPlayer(playerId);
      const accepted = after && after.answeredQuestionIds.length > before.answeredQuestionIds.length;
      if (accepted && gameState.players.every((player) => player.completed)) {
        gameState = endGame(gameState, Date.now());
      }

      sendJson(res, 200, {
        accepted,
        correct: choiceIndex !== null && choiceIndex === question.answer,
        correctIndex: question.answer,
        player: {
          id: after.id,
          name: after.name,
          score: after.score,
          answered: after.answeredQuestionIds.length,
          elapsedMs: after.elapsedMs,
        },
        players: getLeaderboard(),
        tip: question.tip,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/start') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!requireAdmin(req, body, res)) return;
      syncState();
      if (gameState.status !== 'waiting') {
        sendJson(res, 409, { error: '当前房间不是等待状态' });
        return;
      }
      if (!gameState.players.length) {
        sendJson(res, 409, { error: '至少需要一名同学加入后才能开始' });
        return;
      }
      gameState = startGame(gameState, Date.now(), COUNTDOWN_MS);
      sendJson(res, 200, getRoomPayload());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/end') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!requireAdmin(req, body, res)) return;
      syncState();
      gameState = endGame(gameState, Date.now());
      sendJson(res, 200, getRoomPayload());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/reset') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!requireAdmin(req, body, res)) return;
      gameState = createGameState(QUESTIONS, Date.now());
      sendJson(res, 200, getRoomPayload());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/admin') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'admin.html'));
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/monitor') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'monitor.html'));
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const assetPath = path.join(PUBLIC_DIR, decodeURIComponent(requestUrl.pathname));
  if (!assetPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    serveStatic(req, res, assetPath);
    return;
  }

  serveStatic(req, res, path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Anti-fraud quiz running at http://localhost:${PORT}`);
});

if (USE_PUBLIC_TUNNEL) {
  localtunnel({ port: PORT })
    .then((tunnel) => {
      publicBaseUrl = tunnel.url;
      console.log(`Public tunnel available at ${publicBaseUrl}`);
      tunnel.on('close', () => {
        publicBaseUrl = null;
      });
    })
    .catch((error) => {
      console.error('Public tunnel failed:', error.message);
    });
}
