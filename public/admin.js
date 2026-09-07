const adminState = {
  pin: '',
  payload: null,
  pollId: null,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  login: $('#adminLogin'),
  pinInput: $('#pinInput'),
  controls: $('#adminControls'),
  start: $('#startButton'),
  end: $('#endButton'),
  reset: $('#resetButton'),
  status: $('#roomStatus'),
  hint: $('#controlHint'),
  qr: $('#adminQr'),
  url: $('#adminUrl'),
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

async function refresh() {
  if (!adminState.pin) return;
  try {
    const payload = await requestJson('/api/admin/room', {
      headers: { 'x-admin-pin': adminState.pin },
    });
    render(payload);
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
    await setupQr();
    window.clearInterval(adminState.pollId);
    adminState.pollId = window.setInterval(refresh, 1000);
  } catch (error) {
    elements.hint.textContent = error.message;
  }
}

async function setupQr() {
  const meta = await requestJson('/api/meta');
  elements.url.textContent = meta.accessUrl;
  const qr = await requestJson(`/api/qr?text=${encodeURIComponent(meta.accessUrl)}`);
  elements.qr.src = qr.dataUrl;
}

elements.login.addEventListener('submit', enterAdmin);
elements.start.addEventListener('click', () => control('/api/admin/start'));
elements.end.addEventListener('click', () => control('/api/admin/end', '确定结束当前答题吗？'));
elements.reset.addEventListener('click', () => control('/api/admin/reset', '确定重置本局并清空参赛名单吗？'));
