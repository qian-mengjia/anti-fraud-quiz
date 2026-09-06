const adminState = {
  pin: '',
  payload: null,
  accessInfo: null,
  pollId: null,
  accessMode: window.localStorage.getItem('anti-fraud-admin-access-mode') || 'public',
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  login: $('#adminLogin'),
  pinInput: $('#pinInput'),
  controls: $('#adminControls'),
  start: $('#startButton'),
  end: $('#endButton'),
  reset: $('#resetButton'),
  publicMode: $('#publicModeButton'),
  lanMode: $('#lanModeButton'),
  status: $('#roomStatus'),
  hint: $('#controlHint'),
  qr: $('#adminQr'),
  url: $('#adminUrl'),
  modeHint: $('#modeHint'),
  statStatus: $('#statStatus'),
  statPlayers: $('#statPlayers'),
  statActive: $('#statActive'),
  statMax: $('#statMax'),
  rosterCount: $('#rosterCount'),
  roster: $('#roster'),
};

const statusLabels = {
  waiting: '等待加入',
  countdown: '统一倒计时',
  running: '答题进行中',
  ended: '本局已结束',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function requestJson(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

function render(payload) {
  adminState.payload = payload;
  adminState.accessInfo = payload;
  const monitor = payload.monitor || {};
  const status = payload.status || 'waiting';
  elements.status.textContent = statusLabels[status] || status;
  elements.status.dataset.status = status;
  elements.statStatus.textContent = statusLabels[status] || status;
  elements.statPlayers.textContent = monitor.totalPlayers ?? payload.players?.length ?? 0;
  elements.statActive.textContent = monitor.activePlayers ?? 0;
  elements.statMax.textContent = monitor.maxScore ?? 0;
  elements.rosterCount.textContent = payload.players?.length || 0;
  elements.start.disabled = status !== 'waiting' || !payload.players?.length;
  elements.end.disabled = status === 'ended' || status === 'waiting';
  elements.reset.disabled = status === 'countdown' || status === 'running';
  const accessInfo = adminState.accessInfo || payload;
  elements.publicMode.disabled = !accessInfo.publicAccessUrl;
  elements.publicMode.classList.toggle('active', adminState.accessMode === 'public' && !!accessInfo.publicAccessUrl);
  elements.lanMode.classList.toggle('active', adminState.accessMode === 'lan');

  if (!payload.players?.length) {
    elements.roster.innerHTML = '<p class="emptyState">还没有同学加入，先把二维码投出来吧。</p>';
    return;
  }

  elements.roster.innerHTML = payload.players.map((player) => `
    <div class="rosterRow">
      <span class="rosterRank">${player.rank}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span>${player.score} 分</span>
      <span>${player.answered}/${player.total || 15} 题</span>
    </div>
  `).join('');
}

function pickAccessUrl(payload) {
  const accessInfo = adminState.accessInfo || payload;
  if (adminState.accessMode === 'public' && accessInfo.publicAccessUrl) {
    return accessInfo.publicAccessUrl;
  }
  return accessInfo.lanAccessUrl || accessInfo.accessUrl;
}

async function refreshQr() {
  if (!adminState.payload) return;
  const accessUrl = pickAccessUrl(adminState.payload);
  elements.url.textContent = accessUrl;
  elements.modeHint.textContent = adminState.accessMode === 'public' && adminState.payload.publicAccessUrl
    ? '当前展示模式：公网'
    : '当前展示模式：局域网';
  const qr = await requestJson(`/api/qr?text=${encodeURIComponent(accessUrl)}`);
  elements.qr.src = qr.dataUrl;
}

async function refresh() {
  if (!adminState.pin) return;
  try {
    const payload = await requestJson('/api/admin/room', {
      headers: { 'x-admin-pin': adminState.pin },
    });
    render(payload);
    await refreshQr();
  } catch (error) {
    elements.hint.textContent = error.message;
    window.clearInterval(adminState.pollId);
  }
}

async function control(path, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  try {
    const payload = await requestJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminState.pin },
      body: JSON.stringify({ pin: adminState.pin }),
    });
    render(payload);
    await refreshQr();
  } catch (error) {
    elements.hint.textContent = error.message;
  }
}

async function enterAdmin(event) {
  event.preventDefault();
  adminState.pin = elements.pinInput.value.trim();
  try {
    const payload = await requestJson(`/api/admin/room?pin=${encodeURIComponent(adminState.pin)}`);
    elements.login.classList.add('hidden');
    elements.controls.classList.remove('hidden');
    elements.hint.textContent = '同学扫码后会出现在下面的参赛名单中。';
    render(payload);
    await refreshQr();
    window.clearInterval(adminState.pollId);
    adminState.pollId = window.setInterval(refresh, 1000);
  } catch (error) {
    elements.hint.textContent = error.message;
  }
}

elements.login.addEventListener('submit', enterAdmin);
elements.start.addEventListener('click', () => control('/api/admin/start'));
elements.end.addEventListener('click', () => control('/api/admin/end', '确定结束当前答题吗？'));
elements.reset.addEventListener('click', () => control('/api/admin/reset', '确定重置本局并清空参赛名单吗？'));
elements.publicMode.addEventListener('click', async () => {
  adminState.accessMode = 'public';
  window.localStorage.setItem('anti-fraud-admin-access-mode', 'public');
  if (adminState.payload) await refreshQr();
});
elements.lanMode.addEventListener('click', async () => {
  adminState.accessMode = 'lan';
  window.localStorage.setItem('anti-fraud-admin-access-mode', 'lan');
  if (adminState.payload) await refreshQr();
});
