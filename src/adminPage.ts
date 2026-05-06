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
button, input, select, textarea { font: inherit; }
.header { position: sticky; top: 0; z-index: 20; background: rgba(11,16,32,.96); border-bottom: 1px solid rgba(148,163,184,.16); padding: 14px 22px; display: flex; align-items: center; gap: 14px; }
.header h1 { margin: 0; font-size: 18px; color: #67e8f9; font-weight: 700; }
.header .note { margin-left: auto; color: rgba(226,232,240,.48); font-size: 12px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; padding: 16px 22px 8px; }
.stat { border: 1px solid rgba(148,163,184,.16); background: rgba(15,23,42,.78); border-radius: 8px; padding: 12px 14px; }
.stat .num { color: #67e8f9; font-size: 24px; font-weight: 800; line-height: 1; }
.stat .label { color: rgba(226,232,240,.56); font-size: 12px; margin-top: 7px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 22px 0; border-bottom: 1px solid rgba(148,163,184,.12); }
.tab { border: 1px solid transparent; border-bottom: 2px solid transparent; background: transparent; color: rgba(226,232,240,.58); padding: 9px 12px; cursor: pointer; border-radius: 6px 6px 0 0; font-size: 13px; }
.tab:hover { color: #e5e7eb; background: rgba(148,163,184,.08); }
.tab.active { color: #67e8f9; background: rgba(103,232,249,.08); border-color: rgba(103,232,249,.18); border-bottom-color: #67e8f9; }
.toolbar { padding: 14px 22px 0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.toolbar input, .toolbar select, .toolbar textarea { min-height: 34px; border: 1px solid rgba(148,163,184,.22); border-radius: 6px; background: rgba(15,23,42,.82); color: #e5e7eb; padding: 6px 9px; }
.toolbar textarea { width: min(720px, 100%); min-height: 76px; resize: vertical; }
.content { padding: 16px 22px 28px; }
.grid { display: grid; gap: 12px; }
.card { border: 1px solid rgba(148,163,184,.14); background: rgba(15,23,42,.72); border-radius: 8px; padding: 14px; display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 14px; }
.card.no-cover { grid-template-columns: minmax(0, 1fr); }
.cover { width: 86px; height: 86px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(148,163,184,.16); }
.head { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.title { font-weight: 700; color: #f8fafc; }
.meta, .small { color: rgba(226,232,240,.50); font-size: 12px; }
.desc { color: rgba(226,232,240,.68); font-size: 13px; margin-top: 8px; line-height: 1.5; }
.preview { margin-top: 10px; max-height: 130px; overflow: auto; background: rgba(2,6,23,.62); border: 1px solid rgba(148,163,184,.10); border-radius: 6px; padding: 9px; color: rgba(226,232,240,.60); font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.badge { display: inline-flex; align-items: center; min-height: 20px; border-radius: 5px; padding: 2px 7px; font-size: 11px; font-weight: 700; }
.yellow { color: #facc15; background: rgba(250,204,21,.12); }
.green { color: #34d399; background: rgba(52,211,153,.12); }
.red { color: #fb7185; background: rgba(251,113,133,.12); }
.blue { color: #60a5fa; background: rgba(96,165,250,.13); }
.purple { color: #c084fc; background: rgba(192,132,252,.13); }
.orange { color: #fb923c; background: rgba(251,146,60,.13); }
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
.log-detail { max-width: 520px; white-space: pre-wrap; word-break: break-word; color: rgba(226,232,240,.58); font-family: Consolas, monospace; font-size: 12px; }
.empty { border: 1px dashed rgba(148,163,184,.22); border-radius: 8px; padding: 34px; text-align: center; color: rgba(226,232,240,.48); }
.error { color: #fb7185; padding: 12px; border: 1px solid rgba(251,113,133,.24); background: rgba(251,113,133,.08); border-radius: 8px; }
.pager { display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin: 0 0 12px; color: rgba(226,232,240,.56); font-size: 12px; }
.trace-box { border: 1px solid rgba(148,163,184,.14); background: rgba(15,23,42,.72); border-radius: 8px; padding: 14px; }
@media (max-width: 720px) {
  .header { align-items: flex-start; flex-direction: column; }
  .header .note { margin-left: 0; }
  .card { grid-template-columns: 1fr; }
  .cover { width: 100%; height: 160px; }
  .table { display: block; overflow-x: auto; }
}
</style>
</head>
<body>
<div class="header">
  <h1>创意工坊 - 管理后台</h1>
  <div class="note">后台保留完整数据；前端管理员仍按普通用户处理</div>
</div>
<div class="stats" id="stats"></div>
<div class="tabs" id="tabs"></div>
<div class="toolbar" id="toolbar"></div>
<main class="content" id="content"></main>

<script>
const TYPE_LABELS = { regex: '美化正则', persona: '人设', card_addon: '角色卡配套', worldbook: '共享世界书', collection: '作者合集' };
const STATUS_LABELS = { pending: '待审核', approved: '已通过', rejected: '已驳回', visible: '可见', hidden: '已隐藏', deleted: '用户删除' };
const VISIBILITY_LABELS = { public: '公开', hidden: '后台隐藏', author_deleted: '作者软删除' };
const CATEGORY_LABELS = { auth: '认证', work: '作品', review: '审核', user: '用户', security: '安全', system: '系统', download: '下载', favorite: '收藏', like: '点赞', comment: '评论' };
const TABS = [
  { id: 'overview', label: '总览' },
  { id: 'pending-new', label: '新作品待审' },
  { id: 'pending-update', label: '更新待审' },
  { id: 'approved', label: '公开作品' },
  { id: 'hidden', label: '隐藏作品' },
  { id: 'author-deleted', label: '作者软删除' },
  { id: 'rejected', label: '驳回作品' },
  { id: 'users', label: '用户账号' },
  { id: 'comments', label: '评论管理' },
  { id: 'downloads', label: '下载记录' },
  { id: 'fingerprint', label: '指纹追溯' },
  { id: 'favorites', label: '收藏记录' },
  { id: 'likes', label: '点赞记录' },
  { id: 'logs', label: '操作日志' }
];

let currentTab = 'overview';
let cachedUsers = [];
let lastPage = null;
let filters = {};
let logFilters = { date: todayChina(), user_id: '', category: '', action: '', page: 1, page_size: 120 };

function todayChina() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function esc(value) { if (value == null) return ''; const d = document.createElement('div'); d.textContent = String(value); return d.innerHTML; }
function filter() {
  if (!filters[currentTab]) filters[currentTab] = { q: '', type: '', user_id: '', work_id: '', status: '', page: 1, page_size: 80 };
  return filters[currentTab];
}
async function api(path, opts) {
  const options = opts || {};
  const isForm = options.body instanceof FormData;
  const headers = isForm ? (options.headers || {}) : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const resp = await fetch(path, { ...options, credentials: 'include', headers: headers });
  const data = await resp.json().catch(function() { return {}; });
  if (!resp.ok) throw new Error(data.error || '请求失败');
  return data;
}
function badge(text, cls) { return '<span class="badge ' + cls + '">' + esc(text) + '</span>'; }
function typeBadge(type) { return badge(TYPE_LABELS[type] || type, type === 'collection' ? 'orange' : type === 'card_addon' ? 'purple' : type === 'worldbook' ? 'yellow' : type === 'persona' ? 'green' : 'blue'); }
function statusBadge(status) { return badge(STATUS_LABELS[status] || status, status === 'approved' || status === 'visible' ? 'green' : status === 'rejected' || status === 'deleted' ? 'red' : 'yellow'); }
function visibilityBadge(v) { return badge(VISIBILITY_LABELS[v] || v, v === 'hidden' ? 'yellow' : v === 'author_deleted' ? 'red' : 'green'); }

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(function(tab) {
    return '<button class="tab ' + (tab.id === currentTab ? 'active' : '') + '" onclick="switchTab(\\'' + tab.id + '\\')">' + tab.label + '</button>';
  }).join('');
}
async function loadStats() {
  const data = await api('/admin/api/stats');
  const cards = [
    ['总用户', data.totalUsers],
    ['公开作品', data.totalWorks],
    ['待审版本', data.pendingWorks],
    ['隐藏作品', data.hiddenWorks],
    ['作者软删除', data.authorDeletedWorks],
    ['总下载', data.totalDownloads],
    ['总收藏', data.totalFavorites],
    ['总评论', data.totalComments],
    ['今日投稿/更新', data.todayUploads]
  ];
  document.getElementById('stats').innerHTML = cards.map(function(card) {
    return '<div class="stat"><div class="num">' + esc(card[1]) + '</div><div class="label">' + esc(card[0]) + '</div></div>';
  }).join('');
}
async function switchTab(id) {
  currentTab = id;
  lastPage = null;
  renderTabs();
  renderToolbar();
  await loadContent();
}
function commonInputs(f, withType, withStatus) {
  let html = '<input id="q" placeholder="关键词 / ID / 标题 / 用户名" value="' + esc(f.q || '') + '" />';
  if (withType) {
    html += '<select id="type"><option value="">全部类型</option>' + Object.keys(TYPE_LABELS).map(function(k) {
      return '<option value="' + k + '"' + (f.type === k ? ' selected' : '') + '>' + TYPE_LABELS[k] + '</option>';
    }).join('') + '</select>';
  }
  if (withStatus) {
    html += '<select id="status"><option value="">全部状态</option><option value="visible"' + (f.status === 'visible' ? ' selected' : '') + '>可见</option><option value="hidden"' + (f.status === 'hidden' ? ' selected' : '') + '>已隐藏</option><option value="deleted"' + (f.status === 'deleted' ? ' selected' : '') + '>用户删除</option></select>';
  }
  html += '<input id="userId" placeholder="用户ID" value="' + esc(f.user_id || '') + '" style="width:110px" />';
  html += '<input id="workId" placeholder="作品ID" value="' + esc(f.work_id || '') + '" style="width:110px" />';
  html += '<select id="pageSize"><option value="40"' + (f.page_size == 40 ? ' selected' : '') + '>每页40</option><option value="80"' + (f.page_size == 80 ? ' selected' : '') + '>每页80</option><option value="160"' + (f.page_size == 160 ? ' selected' : '') + '>每页160</option></select>';
  html += '<button class="btn ok" onclick="applyFilters()">搜索</button><button class="btn" onclick="resetFilters()">重置</button>';
  return html;
}
function renderToolbar() {
  const el = document.getElementById('toolbar');
  if (currentTab === 'overview' || currentTab === 'pending-new' || currentTab === 'pending-update') {
    el.innerHTML = '<button class="btn" onclick="loadContent()">刷新</button>';
    return;
  }
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
      '<input id="logAction" placeholder="中文操作关键词" value="' + esc(logFilters.action) + '" />' +
      '<button class="btn ok" onclick="applyLogFilters()">筛选</button>' +
      '<button class="btn" onclick="resetLogFilters()">重置</button>' +
      '<button class="btn ok" onclick="downloadLogs(\\'txt\\')">下载 TXT</button>' +
      '<button class="btn" onclick="downloadLogs(\\'json\\')">下载 JSON</button>';
    return;
  }
  if (currentTab === 'fingerprint') {
    el.innerHTML =
      '<input id="fingerprintInput" placeholder="直接粘贴指纹 wf1_..." style="width:280px" />' +
      '<input id="fingerprintFile" type="file" />' +
      '<textarea id="fingerprintContent" placeholder="也可以粘贴可疑 JSON / 文本内容"></textarea>' +
      '<button class="btn ok" onclick="traceFingerprint()">追溯</button>';
    return;
  }
  const f = filter();
  const withType = ['approved', 'hidden', 'author-deleted', 'rejected'].includes(currentTab);
  const withStatus = currentTab === 'comments';
  el.innerHTML = commonInputs(f, withType, withStatus);
}
function collectFilters() {
  const f = filter();
  const q = document.getElementById('q');
  const type = document.getElementById('type');
  const status = document.getElementById('status');
  const userId = document.getElementById('userId');
  const workId = document.getElementById('workId');
  const pageSize = document.getElementById('pageSize');
  f.q = q ? q.value.trim() : '';
  f.type = type ? type.value : '';
  f.status = status ? status.value : '';
  f.user_id = userId ? userId.value.trim() : '';
  f.work_id = workId ? workId.value.trim() : '';
  f.page_size = pageSize ? parseInt(pageSize.value) : 80;
}
function applyFilters() { collectFilters(); filter().page = 1; loadContent(); }
function resetFilters() { filters[currentTab] = { q: '', type: '', user_id: '', work_id: '', status: '', page: 1, page_size: 80 }; renderToolbar(); loadContent(); }
function changePage(delta) {
  const f = currentTab === 'logs' ? logFilters : filter();
  const max = lastPage ? lastPage.total_pages || 1 : 1;
  f.page = Math.max(1, Math.min(max, (f.page || 1) + delta));
  loadContent();
}
function pager(data) {
  lastPage = data;
  if (!data || !data.total_pages || data.total_pages <= 1) return '';
  return '<div class="pager"><button class="btn" onclick="changePage(-1)"' + (data.page <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + esc(data.page) + ' / ' + esc(data.total_pages) + ' 页，共 ' + esc(data.total) + ' 条</span><button class="btn" onclick="changePage(1)"' + (data.page >= data.total_pages ? ' disabled' : '') + '>下一页</button></div>';
}
async function ensureUsers() {
  const data = await api('/admin/api/users?page_size=200');
  cachedUsers = data.users || [];
  if (currentTab === 'logs') renderToolbar();
}
async function loadContent() {
  try {
    if (currentTab === 'logs') await ensureUsers();
    if (currentTab === 'overview') return loadOverview();
    if (currentTab === 'pending-new') return loadVersions('new');
    if (currentTab === 'pending-update') return loadVersions('update');
    if (currentTab === 'approved') return loadWorks({ status: 'approved', visibility: 'public' });
    if (currentTab === 'hidden') return loadWorks({ visibility: 'hidden' });
    if (currentTab === 'author-deleted') return loadWorks({ visibility: 'author_deleted' });
    if (currentTab === 'rejected') return loadWorks({ status: 'rejected' });
    if (currentTab === 'users') return loadUsers();
    if (currentTab === 'comments') return loadComments();
    if (currentTab === 'downloads') return loadDownloads();
    if (currentTab === 'favorites') return loadFavorites();
    if (currentTab === 'likes') return loadLikes();
    if (currentTab === 'logs') return loadLogs();
    if (currentTab === 'fingerprint') return empty('粘贴指纹、可疑内容，或上传 PNG 后点击追溯');
  } catch (err) {
    document.getElementById('content').innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
  }
}
async function loadOverview() {
  const data = await api('/admin/api/stats');
  const rows = [
    ['公开作品', data.totalWorks],
    ['待审版本', data.pendingWorks],
    ['隐藏作品', data.hiddenWorks],
    ['作者软删除作品', data.authorDeletedWorks],
    ['下载记录', data.totalDownloads],
    ['收藏记录', data.totalFavorites],
    ['评论记录', data.totalComments]
  ];
  document.getElementById('content').innerHTML = renderTable(['项目', '数量'], rows);
}
async function loadVersions(kind) {
  const data = await api('/admin/api/versions?status=pending&kind=' + kind);
  const versions = data.versions || [];
  if (!versions.length) return empty('没有待审核版本');
  document.getElementById('content').innerHTML = '<div class="grid">' + versions.map(renderVersionCard).join('') + '</div>';
}
function renderVersionCard(v) {
  const cover = v.cover_url ? '<img class="cover" src="' + esc(v.cover_url) + '" />' : '';
  return '<article class="card ' + (cover ? '' : 'no-cover') + '">' + cover +
    '<div><div class="head"><span class="title">' + esc(v.title) + '</span>' + typeBadge(v.type) + statusBadge(v.status) + badge('v' + v.version_no, 'blue') + '</div>' +
    '<div class="meta">作品ID：' + esc(v.work_id) + ' | 作者：' + esc(v.author_display_name || v.author_username) + ' | 提交：' + esc(v.created_at) + '</div>' +
    '<div class="desc">' + esc(v.description || '') + '</div>' +
    '<div class="preview">' + esc((v.content || '').slice(0, 900)) + '</div>' +
    '<div class="actions"><button class="btn ok" onclick="approveVersion(' + v.id + ')">通过该版本</button><button class="btn warn" onclick="rejectVersion(' + v.id + ')">驳回该版本</button></div></div></article>';
}
function paramsFromFilter(extra) {
  const f = filter();
  const params = new URLSearchParams(extra || {});
  if (f.q) params.set('q', f.q);
  if (f.type) params.set('type', f.type);
  if (f.status) params.set('status', f.status);
  if (f.user_id) params.set('user_id', f.user_id);
  if (f.work_id) params.set('work_id', f.work_id);
  params.set('page', String(f.page || 1));
  params.set('page_size', String(f.page_size || 80));
  return params;
}
async function loadWorks(extra) {
  const data = await api('/admin/api/works?' + paramsFromFilter(extra).toString());
  const works = data.works || [];
  if (!works.length) return empty('没有作品');
  document.getElementById('content').innerHTML = pager(data) + '<div class="grid">' + works.map(renderWorkCard).join('') + '</div>';
}
function renderWorkCard(w) {
  const cover = w.cover_url ? '<img class="cover" src="' + esc(w.cover_url) + '" />' : '';
  const reason = w.visibility === 'hidden' ? '<div class="small" style="color:#facc15;">隐藏理由：' + esc(w.hidden_reason || '') + '</div>' :
    w.visibility === 'author_deleted' ? '<div class="small" style="color:#fb7185;">作者删除理由：' + esc(w.author_delete_reason || '') + '</div>' : '';
  let actions = '';
  if (w.pending_version_id) actions += '<button class="btn ok" onclick="approveVersion(' + w.pending_version_id + ')">通过待审版本</button><button class="btn warn" onclick="rejectVersion(' + w.pending_version_id + ')">驳回待审版本</button>';
  if (w.visibility !== 'hidden') actions += '<button class="btn warn" onclick="hideWork(' + w.id + ')">隐藏</button>';
  if (w.visibility !== 'public') actions += '<button class="btn ok" onclick="restoreWork(' + w.id + ')">恢复公开</button>';
  actions += '<button class="btn danger" onclick="deleteWorkHard(' + w.id + ')">真删除</button>';
  actions += '<button class="btn" onclick="traceWork(' + w.id + ')">追溯</button>';
  actions += '<button class="btn" onclick="showWorkComments(' + w.id + ')">看评论</button>';
  return '<article class="card ' + (cover ? '' : 'no-cover') + '">' + cover +
    '<div><div class="head"><span class="title">' + esc(w.title) + '</span>' + typeBadge(w.type) + statusBadge(w.status) + visibilityBadge(w.visibility) + '</div>' +
    '<div class="meta">ID：' + w.id + ' | 作者ID：' + esc(w.user_id) + ' | 作者：' + esc(w.author_display_name || w.author_username) + ' | 下载 ' + esc(w.download_count) + ' | 收藏 ' + esc(w.favorite_count || 0) + ' | 点赞 ' + esc(w.like_count) + ' | 评论 ' + esc(w.comment_count || 0) + '</div>' +
    reason + '<div class="desc">' + esc(w.description || '') + '</div>' +
    '<div class="preview">' + esc((w.content || '').slice(0, 800)) + '</div><div class="actions">' + actions + '</div></div></article>';
}
async function approveVersion(id) {
  if (!confirm('确定通过该版本？')) return;
  await api('/admin/api/versions/' + id + '/approve', { method: 'POST' });
  await loadStats(); await loadContent();
}
async function rejectVersion(id) {
  const reason = prompt('请输入驳回原因');
  if (!reason || !reason.trim()) return;
  await api('/admin/api/versions/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
  await loadStats(); await loadContent();
}
async function hideWork(id) {
  const reason = prompt('请输入隐藏理由');
  if (!reason || !reason.trim()) return;
  await api('/admin/api/works/' + id + '/hide', { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
  await loadStats(); await loadContent();
}
async function restoreWork(id) {
  if (!confirm('确定恢复公开？')) return;
  await api('/admin/api/works/' + id + '/restore', { method: 'POST' });
  await loadStats(); await loadContent();
}
async function deleteWorkHard(id) {
  const reason = prompt('真删除会清除作品和关联数据，但操作日志保留。请输入理由确认：');
  if (!reason || !reason.trim()) return;
  await api('/admin/api/works/' + id, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
  await loadStats(); await loadContent();
}
async function loadUsers() {
  const data = await api('/admin/api/users?' + paramsFromFilter({}).toString());
  const rows = (data.users || []).map(function(u) {
    const name = u.discord_display_name || u.discord_username;
    const state = u.banned ? badge('已封禁', 'red') : badge('正常', 'green');
    const pwdState = u.password_available ? '已设置，长度 ' + esc(u.password_length || 0) + '，更新：' + esc(u.password_updated_at || '未知') : '未设置密码';
    const banBtn = u.banned ? '<button class="btn" onclick="toggleBan(' + u.id + ', false)">解封</button>' : '<button class="btn danger" onclick="toggleBan(' + u.id + ', true)">封禁</button>';
    return ['<img class="avatar" src="' + esc(u.discord_avatar || '') + '" />' + esc(name) + '<div class="small">ID：' + esc(u.id) + ' | ' + esc(u.discord_username) + ' | ' + esc(u.discord_id) + '</div>', esc(u.role), state, pwdState + '<div><span id="pwd-' + u.id + '" class="secret"></span></div>', '<button class="btn warn" onclick="revealPassword(' + u.id + ')">手动查阅密码</button> ' + banBtn + ' <button class="btn" onclick="traceUser(' + u.id + ')">追溯</button> <button class="btn" onclick="showUserComments(' + u.id + ')">全部评论</button>'];
  });
  document.getElementById('content').innerHTML = pager(data) + (rows.length ? renderTable(['用户', '角色', '状态', '密码', '操作'], rows, true) : '<div class="empty">没有用户</div>');
}
async function revealPassword(userId) {
  if (!confirm('确认查阅该用户密码？本次查阅会写入操作日志。')) return;
  const data = await api('/admin/api/users/' + userId + '/password', { method: 'POST' });
  document.getElementById('pwd-' + userId).textContent = data.password || '未设置';
}
async function toggleBan(id, banned) {
  if (!confirm(banned ? '确定封禁该用户？' : '确定解封该用户？')) return;
  await api('/admin/api/users/' + id + '/ban', { method: 'POST', body: JSON.stringify({ banned: banned }) });
  await loadUsers();
}
function showWorkComments(workId) {
  currentTab = 'comments';
  filters.comments = { q: '', type: '', user_id: '', work_id: String(workId), status: '', page: 1, page_size: 80 };
  renderTabs(); renderToolbar(); loadContent();
}
function showUserComments(userId) {
  currentTab = 'comments';
  filters.comments = { q: '', type: '', user_id: String(userId), work_id: '', status: '', page: 1, page_size: 80 };
  renderTabs(); renderToolbar(); loadContent();
}
async function loadComments() {
  const data = await api('/admin/api/comments?' + paramsFromFilter({}).toString());
  const rows = (data.comments || []).map(function(c) {
    const actions = '<button class="btn warn" onclick="hideCommentAdmin(' + c.id + ')">隐藏</button> <button class="btn danger" onclick="deleteCommentAdmin(' + c.id + ')">真删除</button>';
    return [esc(c.created_at), 'ID ' + esc(c.work_id) + '<div class="small">' + esc(c.work_title || '') + '</div>', 'ID ' + esc(c.user_id) + '<div class="small">' + esc(c.display_name || c.username) + '</div>', statusBadge(c.status), '<div class="log-detail">' + esc(c.content) + '</div><div class="small">' + esc(c.hidden_reason || '') + '</div>', actions];
  });
  document.getElementById('content').innerHTML = pager(data) + (rows.length ? renderTable(['时间', '作品', '评论者', '状态', '内容', '操作'], rows, true) : '<div class="empty">当前条件下没有评论</div>');
}
async function hideCommentAdmin(id) {
  const reason = prompt('请输入隐藏评论理由');
  if (!reason || !reason.trim()) return;
  await api('/admin/api/comments/' + id + '/hide', { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
  await loadContent();
}
async function deleteCommentAdmin(id) {
  if (!confirm('确定真删除该评论？操作日志会保留。')) return;
  await api('/admin/api/comments/' + id, { method: 'DELETE' });
  await loadContent();
}
async function loadDownloads() {
  const data = await api('/admin/api/downloads?' + paramsFromFilter({}).toString());
  const rows = (data.downloads || []).map(function(d) {
    return [esc(d.created_at), 'ID ' + esc(d.user_id) + '<div class="small">' + esc(d.display_name || d.username) + '</div>', 'ID ' + esc(d.work_id) + '<div class="small">' + esc(d.work_title || '') + '</div>', esc(TYPE_LABELS[d.work_type] || d.work_type), '<span class="secret">' + esc(d.fingerprint_token || '') + '</span>', esc(d.ip || '')];
  });
  document.getElementById('content').innerHTML = pager(data) + (rows.length ? renderTable(['时间', '下载用户', '作品', '类型', '下载指纹', 'IP'], rows, true) : '<div class="empty">暂无下载记录</div>');
}
async function loadFavorites() {
  const data = await api('/admin/api/favorites?' + paramsFromFilter({}).toString());
  renderActivity(data, 'favorites');
}
async function loadLikes() {
  const data = await api('/admin/api/likes?' + paramsFromFilter({}).toString());
  renderActivity(data, 'likes');
}
function renderActivity(data, key) {
  const rows = (data[key] || []).map(function(row) {
    return [esc(row.created_at), 'ID ' + esc(row.user_id) + '<div class="small">' + esc(row.display_name || row.username) + '</div>', 'ID ' + esc(row.work_id) + '<div class="small">' + esc(row.work_title || '') + '</div>', esc(TYPE_LABELS[row.work_type] || row.work_type)];
  });
  document.getElementById('content').innerHTML = pager(data) + (rows.length ? renderTable(['时间', '用户', '作品', '类型'], rows, true) : '<div class="empty">暂无记录</div>');
}
function applyLogFilters() {
  logFilters.date = document.getElementById('logDate').value;
  logFilters.user_id = document.getElementById('logUser').value;
  logFilters.category = document.getElementById('logCategory').value;
  logFilters.action = document.getElementById('logAction').value.trim();
  logFilters.page = 1;
  loadLogs();
}
function resetLogFilters() { logFilters = { date: '', user_id: '', category: '', action: '', page: 1, page_size: 120 }; renderToolbar(); loadLogs(); }
async function loadLogs() {
  const params = logQueryParams();
  params.set('page_size', String(logFilters.page_size || 120));
  params.set('page', String(logFilters.page || 1));
  const data = await api('/admin/api/logs?' + params.toString());
  const logs = data.logs || [];
  if (!logs.length) return empty('当前筛选条件下没有操作记录');
  const rows = logs.map(function(log) {
    const actor = log.actor_display_name || log.actor_username || (log.user_id == null ? '未识别用户' : '用户#' + log.user_id);
    const target = log.target_display_name || log.target_username || (log.target_user_id == null ? '' : '用户#' + log.target_user_id);
    return [esc(log.created_at) + '<div class="small">日期分组：' + esc(log.log_date) + '</div>', esc(actor), esc(CATEGORY_LABELS[log.category] || log.category), esc(log.action_label || log.action), esc(target), log.success ? '成功' : '失败', '<div class="log-detail">' + esc(formatDetail(log.detail)) + '</div>'];
  });
  document.getElementById('content').innerHTML = pager(data) + renderTable(['精确时间戳', '操作者', '分类', '操作', '目标用户', '结果', '详情'], rows, true);
}
function formatDetail(detail) { try { return JSON.stringify(JSON.parse(detail || '{}'), null, 2); } catch (e) { return detail || ''; } }
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
async function traceUser(id) {
  currentTab = 'logs'; renderTabs();
  logFilters.user_id = String(id); logFilters.date = ''; logFilters.category = ''; logFilters.action = ''; logFilters.page = 1;
  renderToolbar(); await loadLogs();
}
async function traceWork(id) {
  const data = await api('/admin/api/trace/works/' + id);
  const rows = (data.logs || []).map(function(log) {
    return [esc(log.created_at), esc(log.actor_display_name || log.actor_username), esc(log.action_label || log.action), '<div class="log-detail">' + esc(formatDetail(log.detail)) + '</div>'];
  });
  document.getElementById('content').innerHTML = rows.length ? renderTable(['时间', '操作者', '操作', '详情'], rows, true) : '<div class="empty">暂无追溯记录</div>';
}
async function traceFingerprint() {
  const form = new FormData();
  const direct = document.getElementById('fingerprintInput').value.trim();
  const content = document.getElementById('fingerprintContent').value;
  const file = document.getElementById('fingerprintFile').files[0];
  if (direct) form.append('fingerprint', direct);
  if (content) form.append('content', content);
  if (file) form.append('file', file);
  try {
    const data = await api('/admin/api/fingerprint/trace', { method: 'POST', body: form });
    if (!data.found) {
      document.getElementById('content').innerHTML = '<div class="empty">识别到指纹，但没有匹配下载记录：' + esc(data.fingerprint) + '</div>';
      return;
    }
    const d = data.download;
    document.getElementById('content').innerHTML =
      '<div class="trace-box"><div class="head"><span class="title">命中下载记录 #' + esc(d.id) + '</span>' + typeBadge(d.work_type) + '</div>' +
      '<div class="meta">指纹：<span class="secret">' + esc(data.fingerprint) + '</span></div>' +
      '<div class="desc">下载用户：用户ID ' + esc(d.user_id) + ' / ' + esc(d.display_name || d.username) + ' / Discord ' + esc(d.discord_id || '') + '</div>' +
      '<div class="desc">作品：ID ' + esc(d.work_id) + ' / ' + esc(d.work_title) + ' / 作者：' + esc(d.author_display_name || d.author_username) + '</div>' +
      '<div class="desc">版本：' + esc(d.version_no || d.work_version_id || '') + ' | 下载时间：' + esc(d.created_at) + ' | IP：' + esc(d.ip || '') + '</div>' +
      '<div class="actions"><button class="btn" onclick="traceUser(' + esc(d.user_id) + ')">追溯该用户日志</button><button class="btn" onclick="traceWork(' + esc(d.work_id) + ')">追溯该作品日志</button></div></div>';
  } catch (err) {
    document.getElementById('content').innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
  }
}
function renderTable(headers, rows, raw) {
  return '<table class="table"><thead><tr>' + headers.map(function(h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function(row) { return '<tr>' + row.map(function(cell) { return '<td>' + (raw ? cell : esc(cell)) + '</td>'; }).join('') + '</tr>'; }).join('') +
    '</tbody></table>';
}
function empty(text) { document.getElementById('content').innerHTML = '<div class="empty">' + esc(text) + '</div>'; }

renderTabs();
renderToolbar();
loadStats();
loadContent();
</script>
</body>
</html>`;
}
