export function adminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>创意工坊 - 管理后台</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #0b1020; color: #e5e7eb; font-family: "Segoe UI", system-ui, sans-serif; }
button, input, select { font: inherit; }
.header { position: sticky; top: 0; z-index: 20; background: rgba(11,16,32,.96); border-bottom: 1px solid rgba(148,163,184,.16); padding: 14px 22px; display: flex; align-items: center; gap: 14px; }
.header h1 { margin: 0; font-size: 18px; color: #67e8f9; font-weight: 700; }
.header .note { margin-left: auto; color: rgba(226,232,240,.48); font-size: 12px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; padding: 16px 22px 8px; }
.stat { border: 1px solid rgba(148,163,184,.16); background: rgba(15,23,42,.78); border-radius: 8px; padding: 12px 14px; }
.stat .num { color: #67e8f9; font-size: 24px; font-weight: 800; line-height: 1; }
.stat .label { color: rgba(226,232,240,.56); font-size: 12px; margin-top: 7px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 22px 0; border-bottom: 1px solid rgba(148,163,184,.12); }
.tab { appearance: none; border: 1px solid transparent; border-bottom: 2px solid transparent; background: transparent; color: rgba(226,232,240,.58); padding: 9px 12px; cursor: pointer; border-radius: 6px 6px 0 0; font-size: 13px; }
.tab:hover { color: #e5e7eb; background: rgba(148,163,184,.08); }
.tab.active { color: #67e8f9; background: rgba(103,232,249,.08); border-color: rgba(103,232,249,.18); border-bottom-color: #67e8f9; }
.toolbar { padding: 14px 22px 0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.toolbar input, .toolbar select { min-height: 34px; border: 1px solid rgba(148,163,184,.22); border-radius: 6px; background: rgba(15,23,42,.82); color: #e5e7eb; padding: 6px 9px; }
.content { padding: 16px 22px 28px; }
.grid { display: grid; gap: 12px; }
.work { border: 1px solid rgba(148,163,184,.14); background: rgba(15,23,42,.72); border-radius: 8px; padding: 14px; display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 14px; }
.work.no-cover { grid-template-columns: minmax(0, 1fr); }
.cover { width: 86px; height: 86px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(148,163,184,.16); }
.work-head { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.title { font-weight: 700; color: #f8fafc; }
.meta, .small { color: rgba(226,232,240,.50); font-size: 12px; }
.desc { color: rgba(226,232,240,.68); font-size: 13px; margin-top: 8px; line-height: 1.5; }
.preview { margin-top: 10px; max-height: 110px; overflow: auto; background: rgba(2,6,23,.62); border: 1px solid rgba(148,163,184,.10); border-radius: 6px; padding: 9px; color: rgba(226,232,240,.60); font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.badge { display: inline-flex; align-items: center; min-height: 20px; border-radius: 5px; padding: 2px 7px; font-size: 11px; font-weight: 700; }
.status-pending { color: #facc15; background: rgba(250,204,21,.12); }
.status-approved { color: #34d399; background: rgba(52,211,153,.12); }
.status-rejected { color: #fb7185; background: rgba(251,113,133,.12); }
.type-regex { color: #60a5fa; background: rgba(96,165,250,.13); }
.type-persona { color: #34d399; background: rgba(52,211,153,.13); }
.type-card_addon { color: #c084fc; background: rgba(192,132,252,.13); }
.type-worldbook { color: #fbbf24; background: rgba(251,191,36,.13); }
.type-collection { color: #fb923c; background: rgba(251,146,60,.13); }
.btn { border: 1px solid rgba(103,232,249,.24); background: rgba(103,232,249,.08); color: #67e8f9; border-radius: 6px; padding: 7px 12px; cursor: pointer; min-height: 32px; }
.btn:hover { background: rgba(103,232,249,.16); }
.btn.ok { color: #34d399; border-color: rgba(52,211,153,.38); background: rgba(52,211,153,.10); }
.btn.warn { color: #facc15; border-color: rgba(250,204,21,.36); background: rgba(250,204,21,.10); }
.btn.danger { color: #fb7185; border-color: rgba(251,113,133,.36); background: rgba(251,113,133,.10); }
.table { width: 100%; border-collapse: collapse; border: 1px solid rgba(148,163,184,.13); background: rgba(15,23,42,.72); border-radius: 8px; overflow: hidden; }
.table th, .table td { text-align: left; border-bottom: 1px solid rgba(148,163,184,.10); padding: 10px; vertical-align: top; font-size: 13px; }
.table th { color: rgba(226,232,240,.62); font-size: 12px; background: rgba(2,6,23,.30); }
.table tr:last-child td { border-bottom: 0; }
.avatar { width: 32px; height: 32px; border-radius: 50%; vertical-align: middle; margin-right: 8px; }
.secret { display: inline-block; min-width: 120px; color: #34d399; font-family: Consolas, monospace; word-break: break-all; }
.log-detail { max-width: 420px; white-space: pre-wrap; word-break: break-word; color: rgba(226,232,240,.58); font-family: Consolas, monospace; font-size: 12px; }
.empty { border: 1px dashed rgba(148,163,184,.22); border-radius: 8px; padding: 34px; text-align: center; color: rgba(226,232,240,.48); }
.error { color: #fb7185; padding: 12px; border: 1px solid rgba(251,113,133,.24); background: rgba(251,113,133,.08); border-radius: 8px; }
@media (max-width: 720px) {
  .header { align-items: flex-start; flex-direction: column; }
  .header .note { margin-left: 0; }
  .work { grid-template-columns: 1fr; }
  .cover { width: 100%; height: 160px; }
  .table { display: block; overflow-x: auto; }
}
</style>
</head>
<body>
<div class="header">
  <h1>创意工坊 - 管理后台</h1>
  <div class="note">审核、账号、审计日志分区管理</div>
</div>
<div class="stats" id="stats"></div>
<div class="tabs" id="tabs"></div>
<div class="toolbar" id="toolbar"></div>
<main class="content" id="content"></main>

<script>
const TYPE_CONFIG = {
  regex: { label: '美化正则' },
  persona: { label: '人设' },
  card_addon: { label: '角色卡配套' },
  worldbook: { label: '共享世界书' },
  collection: { label: '作者合集' }
};
const STATUS_LABELS = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
const CATEGORY_LABELS = { auth: '认证', work: '作品', review: '审核', user: '用户', security: '安全', system: '系统' };
const TABS = [
  { id: 'pending', label: '待审核', status: 'pending' },
  { id: 'approved', label: '已通过', status: 'approved' },
  { id: 'rejected', label: '已驳回', status: 'rejected' },
  { id: 'all', label: '全部作品' },
  { id: 'regex', label: '正则', type: 'regex' },
  { id: 'persona', label: '人设', type: 'persona' },
  { id: 'card_addon', label: '配套', type: 'card_addon' },
  { id: 'worldbook', label: '世界书', type: 'worldbook' },
  { id: 'collection', label: '合集', type: 'collection' },
  { id: 'users', label: '用户账号' },
  { id: 'logs', label: '操作日志' },
  { id: 'stats', label: '系统统计' }
];

let currentTab = 'pending';
let cachedUsers = [];
let logFilters = { date: todayChina(), user_id: '', category: '', action: '' };

function todayChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function api(path, opts) {
  const options = opts || {};
  const resp = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await resp.json().catch(function() { return {}; });
  if (!resp.ok) throw new Error(data.error || '请求失败');
  return data;
}

function esc(value) {
  if (value == null) return '';
  const d = document.createElement('div');
  d.textContent = String(value);
  return d.innerHTML;
}

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(function(tab) {
    return '<button class="tab ' + (tab.id === currentTab ? 'active' : '') + '" onclick="switchTab(\\'' + tab.id + '\\')">' + tab.label + '</button>';
  }).join('');
}

async function loadStats() {
  const data = await api('/admin/api/stats');
  const cards = [
    ['总用户', data.totalUsers],
    ['已通过作品', data.totalWorks],
    ['待审核', data.pendingWorks],
    ['今日上传', data.todayUploads]
  ];
  Object.keys(TYPE_CONFIG).forEach(function(type) {
    const count = (data.pendingByType || {})[type] || 0;
    if (count > 0) cards.push(['待审 · ' + TYPE_CONFIG[type].label, count]);
  });
  document.getElementById('stats').innerHTML = cards.map(function(card) {
    return '<div class="stat"><div class="num">' + esc(card[1]) + '</div><div class="label">' + esc(card[0]) + '</div></div>';
  }).join('');
}

async function switchTab(id) {
  currentTab = id;
  renderTabs();
  renderToolbar();
  await loadContent();
}

function renderToolbar() {
  const el = document.getElementById('toolbar');
  if (currentTab === 'logs') {
    el.innerHTML =
      '<input id="logDate" type="date" value="' + esc(logFilters.date) + '" />' +
      '<select id="logUser"><option value="">全部用户</option>' + cachedUsers.map(function(u) {
        const name = u.discord_display_name || u.discord_username || ('用户 ' + u.id);
        return '<option value="' + u.id + '"' + (String(u.id) === String(logFilters.user_id) ? ' selected' : '') + '>' + esc(name) + '</option>';
      }).join('') + '</select>' +
      '<select id="logCategory"><option value="">全部分类</option>' + Object.keys(CATEGORY_LABELS).map(function(k) {
        return '<option value="' + k + '"' + (k === logFilters.category ? ' selected' : '') + '>' + CATEGORY_LABELS[k] + '</option>';
      }).join('') + '</select>' +
      '<input id="logAction" placeholder="操作关键词" value="' + esc(logFilters.action) + '" />' +
      '<button class="btn" onclick="applyLogFilters()">筛选</button>' +
      '<button class="btn ok" onclick="downloadLogs(\\'txt\\')">下载 TXT</button>' +
      '<button class="btn" onclick="downloadLogs(\\'json\\')">下载 JSON</button>';
  } else if (currentTab === 'users') {
    el.innerHTML = '<button class="btn" onclick="loadContent()">刷新用户</button>';
  } else {
    el.innerHTML = '<button class="btn" onclick="loadContent()">刷新列表</button>';
  }
}

async function loadContent() {
  try {
    if (currentTab === 'users' || currentTab === 'logs') await ensureUsers();
    if (currentTab === 'users') return loadUsers();
    if (currentTab === 'logs') return loadLogs();
    if (currentTab === 'stats') return loadSystemStats();

    const tab = TABS.find(function(item) { return item.id === currentTab; }) || {};
    const params = new URLSearchParams();
    if (tab.status) params.set('status', tab.status);
    if (tab.type) params.set('type', tab.type);
    const data = await api('/admin/api/works?' + params.toString());
    renderWorks(data.works || []);
  } catch (err) {
    document.getElementById('content').innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
  }
}

async function ensureUsers() {
  const data = await api('/admin/api/users');
  cachedUsers = data.users || [];
  if (currentTab === 'logs') renderToolbar();
}

function renderWorks(works) {
  const el = document.getElementById('content');
  if (!works.length) {
    el.innerHTML = '<div class="empty">当前分类没有作品</div>';
    return;
  }
  el.innerHTML = '<div class="grid">' + works.map(renderWorkCard).join('') + '</div>';
}

function renderWorkCard(w) {
  const typeLabel = (TYPE_CONFIG[w.type] || { label: w.type }).label;
  const statusLabel = STATUS_LABELS[w.status] || w.status;
  const cover = w.cover_url ? '<img class="cover" src="' + esc(w.cover_url) + '" onerror="this.remove()" />' : '';
  const reject = w.reject_reason ? '<div class="small" style="color:#fb7185;margin-top:6px;">驳回原因：' + esc(w.reject_reason) + '</div>' : '';
  const cardLink = w.card_link ? '<div class="small">角色卡链接：<a href="' + esc(w.card_link) + '" target="_blank" style="color:#93c5fd;">' + esc(w.card_link) + '</a></div>' : '';
  let actions = '';
  if (w.status === 'pending') {
    actions += '<button class="btn ok" onclick="approveWork(' + w.id + ')">通过</button>';
    actions += '<button class="btn warn" onclick="rejectWork(' + w.id + ')">驳回</button>';
  }
  actions += '<button class="btn danger" onclick="deleteWork(' + w.id + ')">删除</button>';
  return '<article class="work ' + (cover ? '' : 'no-cover') + '">' + cover +
    '<div><div class="work-head"><span class="title">' + esc(w.title) + '</span>' +
    '<span class="badge type-' + esc(w.type) + '">' + esc(typeLabel) + '</span>' +
    '<span class="badge status-' + esc(w.status) + '">' + esc(statusLabel) + '</span></div>' +
    '<div class="meta">作者：' + esc(w.author_display_name || w.author_username) + ' | ID：' + w.id + ' | 创建：' + esc(w.created_at) + '</div>' +
    cardLink + '<div class="desc">' + esc(w.description || '') + '</div>' + reject +
    '<div class="preview">' + esc((w.content || '').slice(0, 700)) + '</div>' +
    '<div class="actions">' + actions + '</div></div></article>';
}

async function approveWork(id) {
  if (!confirm('确定通过该作品？')) return;
  await api('/admin/api/works/' + id + '/approve', { method: 'POST' });
  await loadStats();
  await loadContent();
}

async function rejectWork(id) {
  const reason = prompt('请输入驳回原因');
  if (!reason || !reason.trim()) return;
  await api('/admin/api/works/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
  await loadStats();
  await loadContent();
}

async function deleteWork(id) {
  if (!confirm('确定永久删除该作品？')) return;
  await api('/admin/api/works/' + id, { method: 'DELETE' });
  await loadStats();
  await loadContent();
}

function loadUsers() {
  const rows = cachedUsers.map(function(u) {
    const name = u.discord_display_name || u.discord_username;
    const state = u.banned ? '<span class="badge status-rejected">已封禁</span>' : '<span class="badge status-approved">正常</span>';
    const pwdState = u.password_available
      ? '<span class="small">已设置，长度 ' + esc(u.password_length || 0) + '，更新：' + esc(u.password_updated_at || '未知') + '</span>'
      : '<span class="small">未设置密码</span>';
    const banBtn = u.banned
      ? '<button class="btn" onclick="toggleBan(' + u.id + ', false)">解封</button>'
      : '<button class="btn danger" onclick="toggleBan(' + u.id + ', true)">封禁</button>';
    return '<tr><td><img class="avatar" src="' + esc(u.discord_avatar || '') + '" />' + esc(name) +
      '<div class="small">' + esc(u.discord_username) + ' | ' + esc(u.discord_id) + '</div></td>' +
      '<td>' + esc(u.role) + '</td><td>' + state + '</td><td>' + pwdState + '<div><span id="pwd-' + u.id + '" class="secret"></span></div></td>' +
      '<td><button class="btn warn" onclick="revealPassword(' + u.id + ')">手动查阅密码</button> ' + banBtn + '</td></tr>';
  }).join('');
  document.getElementById('content').innerHTML = '<table class="table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>密码</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

async function revealPassword(userId) {
  if (!confirm('确认查阅该用户密码？本次查阅会写入操作日志。')) return;
  const data = await api('/admin/api/users/' + userId + '/password', { method: 'POST' });
  const el = document.getElementById('pwd-' + userId);
  el.textContent = data.password || '未设置';
}

async function toggleBan(id, banned) {
  if (!confirm(banned ? '确定封禁该用户？' : '确定解封该用户？')) return;
  await api('/admin/api/users/' + id + '/ban', { method: 'POST', body: JSON.stringify({ banned: banned }) });
  await ensureUsers();
  loadUsers();
}

function applyLogFilters() {
  logFilters.date = document.getElementById('logDate').value;
  logFilters.user_id = document.getElementById('logUser').value;
  logFilters.category = document.getElementById('logCategory').value;
  logFilters.action = document.getElementById('logAction').value.trim();
  loadLogs();
}

async function loadLogs() {
  const params = logQueryParams();
  params.set('page_size', '120');
  const data = await api('/admin/api/logs?' + params.toString());
  if (!data.logs || !data.logs.length) {
    document.getElementById('content').innerHTML = '<div class="empty">当前筛选条件下没有操作记录</div>';
    return;
  }
  const rows = data.logs.map(function(log) {
    const actor = log.actor_display_name || log.actor_username || (log.user_id == null ? 'anonymous' : 'user#' + log.user_id);
    const target = log.target_display_name || log.target_username || (log.target_user_id == null ? '' : 'user#' + log.target_user_id);
    return '<tr><td>' + esc(log.created_at) + '<div class="small">日期分组：' + esc(log.log_date) + '</div></td>' +
      '<td>' + esc(actor) + '</td><td>' + esc(CATEGORY_LABELS[log.category] || log.category) + '</td>' +
      '<td>' + esc(log.action) + '<div class="small">' + esc(log.entity_type || '') + ' ' + esc(log.entity_id || '') + '</div></td>' +
      '<td>' + esc(target) + '</td><td>' + (log.success ? '成功' : '失败') + '</td>' +
      '<td><div class="log-detail">' + esc(formatDetail(log.detail)) + '</div></td></tr>';
  }).join('');
  document.getElementById('content').innerHTML = '<table class="table"><thead><tr><th>精确时间戳</th><th>操作者</th><th>分类</th><th>操作</th><th>目标用户</th><th>结果</th><th>详情</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function formatDetail(detail) {
  try {
    return JSON.stringify(JSON.parse(detail || '{}'), null, 2);
  } catch (e) {
    return detail || '';
  }
}

function logQueryParams() {
  const params = new URLSearchParams();
  if (logFilters.date) params.set('date', logFilters.date);
  if (logFilters.user_id) params.set('user_id', logFilters.user_id);
  if (logFilters.category) params.set('category', logFilters.category);
  if (logFilters.action) params.set('action', logFilters.action);
  return params;
}

function downloadLogs(format) {
  applyLogFilters();
  const params = logQueryParams();
  params.set('format', format);
  window.location.href = '/admin/api/logs/download?' + params.toString();
}

async function loadSystemStats() {
  const data = await api('/admin/api/stats');
  const rows = [
    ['总用户', data.totalUsers],
    ['已通过作品', data.totalWorks],
    ['待审核作品', data.pendingWorks],
    ['今日上传', data.todayUploads]
  ];
  Object.keys(TYPE_CONFIG).forEach(function(type) {
    rows.push(['待审 · ' + TYPE_CONFIG[type].label, (data.pendingByType || {})[type] || 0]);
    rows.push(['已通过 · ' + TYPE_CONFIG[type].label, (data.approvedByType || {})[type] || 0]);
  });
  document.getElementById('content').innerHTML = '<table class="table"><thead><tr><th>项目</th><th>数量</th></tr></thead><tbody>' +
    rows.map(function(row) { return '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>'; }).join('') +
    '</tbody></table>';
}

renderTabs();
renderToolbar();
loadStats();
loadContent();
</script>
</body>
</html>`;
}
