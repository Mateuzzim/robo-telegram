function formatTime(ts) {
  if (!ts) return '--:--:--';
  return new Date(ts).toLocaleTimeString('pt-BR');
}

function formatDateTime(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleString('pt-BR');
}

function createBadge(status) {
  const cls = { online: 'badge-online', offline: 'badge-offline', paused: 'badge-paused', error: 'badge-error' };
  return `<span class="badge ${cls[status] || 'badge-offline'}">${status}</span>`;
}

function createStatCard(label, value, colorClass) {
  return `<div class="stat-card ${colorClass || ''}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

function escapeJsString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
