const $ = (selector) => document.querySelector(selector);
const elements = {
  status: $('#monitorStatus'),
  updated: $('#lastUpdated'),
  total: $('#totalPlayers'),
  active: $('#activePlayers'),
  completed: $('#completedPlayers'),
  max: $('#maxScore'),
  average: $('#averageScore'),
  leaderboard: $('#leaderboard'),
  activity: $('#activity'),
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

function render(payload) {
  elements.status.textContent = statusLabels[payload.status] || payload.status;
  elements.status.dataset.status = payload.status;
  elements.updated.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  elements.total.textContent = payload.totalPlayers;
  elements.active.textContent = payload.activePlayers;
  elements.completed.textContent = payload.completedPlayers;
  elements.max.textContent = payload.maxScore;
  elements.average.textContent = payload.averageScore;

  if (!payload.leaderboard.length) {
    elements.leaderboard.innerHTML = '<p class="emptyState">等待同学扫码加入。</p>';
  } else {
    elements.leaderboard.innerHTML = payload.leaderboard.map((player) => `
      <div class="monitorRow">
        <span class="monitorRank rank-${player.rank}">${player.rank}</span>
        <strong>${escapeHtml(player.name)}</strong>
        <span class="progressCell"><i style="width: ${(player.answered / Math.max(1, player.total)) * 100}%"></i><small>${player.answered}/${player.total}</small></span>
        <b>${player.score}</b>
      </div>
    `).join('');
  }

  if (!payload.recentActivity.length) {
    elements.activity.innerHTML = '<p class="emptyState">答题动态会显示在这里。</p>';
  } else {
    elements.activity.innerHTML = payload.recentActivity.map((item) => `
      <div class="activityRow">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.correct ? '答对 1 题' : '提交 0 分'}</span>
        <b>${item.score} 分</b>
      </div>
    `).join('');
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/monitor', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '监控数据获取失败');
    render(payload);
  } catch {
    elements.status.textContent = '连接中断';
  }
}

refresh();
window.setInterval(refresh, 1000);
