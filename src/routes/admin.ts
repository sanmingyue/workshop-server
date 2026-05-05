import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from '../auth/middleware';
import { config } from '../config';
import {
  getPendingWorks, getAllWorksAdmin, getWorkById,
  approveWork, rejectWork, deleteWork,
  getAllUsers, banUser, getStats,
} from '../database';

const router = Router();

/** GET /admin - 管理后台页面 */
router.get('/', requireAdmin, (_req: Request, res: Response) => {
  res.send(adminPageHtml());
});

/** GET /admin/api/stats - 统计数据 */
router.get('/api/stats', requireAdmin, (_req: Request, res: Response) => {
  res.json(getStats());
});

/** GET /admin/api/works - 获取作品列表 */
router.get('/api/works', requireAdmin, (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const works = getAllWorksAdmin(status);
  res.json({
    works: works.map(w => ({
      ...w,
      tags: JSON.parse(w.tags || '[]'),
      cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
    })),
  });
});

/** GET /admin/api/works/pending - 获取待审核作品 */
router.get('/api/works/pending', requireAdmin, (_req: Request, res: Response) => {
  const works = getPendingWorks();
  res.json({
    works: works.map(w => ({
      ...w,
      tags: JSON.parse(w.tags || '[]'),
      cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
    })),
  });
});

/** POST /admin/api/works/:id/approve - 审核通过 */
router.post('/api/works/:id/approve', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  approveWork(work.id, req.user!.id);
  res.json({ message: '已通过' });
});

/** POST /admin/api/works/:id/reject - 审核拒绝 */
router.post('/api/works/:id/reject', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const reason = req.body.reason || '不符合要求';
  rejectWork(work.id, req.user!.id, reason);
  res.json({ message: '已拒绝' });
});

/** DELETE /admin/api/works/:id - 强制删除作品 */
router.delete('/api/works/:id', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }

  // 删除封面
  if (work.cover_filename) {
    const coverPath = path.join(config.dataDir, 'uploads', work.cover_filename);
    if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
  }

  deleteWork(work.id);
  res.json({ message: '已删除' });
});

/** GET /admin/api/users - 用户列表 */
router.get('/api/users', requireAdmin, (_req: Request, res: Response) => {
  res.json({ users: getAllUsers() });
});

/** POST /admin/api/users/:id/ban - 封禁/解封用户 */
router.post('/api/users/:id/ban', requireAdmin, (req: Request, res: Response) => {
  const userId = parseInt(req.params.id);
  const { banned } = req.body;
  banUser(userId, !!banned);
  res.json({ message: banned ? '已封禁' : '已解封' });
});

// ─── 管理后台 HTML ───
function adminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>创意工坊 - 管理后台</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0e1a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }
.header { background: rgba(5,8,16,.9); border-bottom: 1px solid rgba(77,201,246,.15); padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
.header h1 { font-size: 18px; color: #4dc9f6; font-weight: 600; }
.header .thanks { font-size: 11px; color: rgba(255,255,255,.3); margin-left: auto; font-style: italic; }
.stats { display: flex; gap: 16px; padding: 16px 24px; flex-wrap: wrap; }
.stat-card { background: rgba(77,201,246,.04); border: 1px solid rgba(77,201,246,.12); border-radius: 8px; padding: 12px 20px; min-width: 140px; }
.stat-card .num { font-size: 24px; font-weight: 700; color: #4dc9f6; }
.stat-card .label { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 4px; }
.tabs { display: flex; gap: 0; padding: 0 24px; border-bottom: 1px solid rgba(77,201,246,.1); }
.tab { padding: 10px 20px; font-size: 13px; color: rgba(255,255,255,.4); cursor: pointer; border-bottom: 2px solid transparent; background: none; border-top: none; border-left: none; border-right: none; font-family: inherit; }
.tab:hover { color: rgba(255,255,255,.7); }
.tab.active { color: #4dc9f6; border-bottom-color: #4dc9f6; }
.content { padding: 16px 24px; }
.work-card { background: rgba(77,201,246,.02); border: 1px solid rgba(77,201,246,.08); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
.work-card .top { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.work-card .title { font-size: 15px; font-weight: 600; color: rgba(255,255,255,.9); }
.work-card .type-badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; background: rgba(77,201,246,.1); color: rgba(77,201,246,.7); }
.work-card .status-badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; }
.status-pending { background: rgba(251,191,36,.1); color: #fbbf24; }
.status-approved { background: rgba(52,211,153,.1); color: #34d399; }
.status-rejected { background: rgba(248,113,113,.1); color: #f87171; }
.work-card .meta { font-size: 11px; color: rgba(255,255,255,.35); margin-bottom: 8px; }
.work-card .desc { font-size: 12px; color: rgba(255,255,255,.5); margin-bottom: 8px; line-height: 1.5; }
.work-card .content-preview { font-size: 11px; color: rgba(255,255,255,.3); background: rgba(0,0,0,.2); padding: 8px; border-radius: 6px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; margin-bottom: 10px; font-family: monospace; }
.work-card .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 6px 16px; border-radius: 6px; border: 1px solid rgba(77,201,246,.2); background: rgba(77,201,246,.06); color: #4dc9f6; font-size: 12px; cursor: pointer; font-family: inherit; transition: all .15s; }
.btn:hover { background: rgba(77,201,246,.15); border-color: rgba(77,201,246,.4); }
.btn-approve { border-color: rgba(52,211,153,.3); background: rgba(52,211,153,.08); color: #34d399; }
.btn-approve:hover { background: rgba(52,211,153,.2); }
.btn-reject { border-color: rgba(248,113,113,.3); background: rgba(248,113,113,.08); color: #f87171; }
.btn-reject:hover { background: rgba(248,113,113,.2); }
.btn-danger { border-color: rgba(248,113,113,.3); background: rgba(248,113,113,.08); color: #f87171; }
.btn-danger:hover { background: rgba(248,113,113,.2); }
.cover-img { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(77,201,246,.1); flex-shrink: 0; }
.empty { text-align: center; color: rgba(255,255,255,.25); padding: 40px; font-size: 14px; }
.user-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(77,201,246,.06); }
.user-row img { width: 32px; height: 32px; border-radius: 50%; }
.user-row .name { font-size: 13px; color: rgba(255,255,255,.8); }
.user-row .id { font-size: 10px; color: rgba(255,255,255,.25); }
.user-row .role { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(77,201,246,.1); color: rgba(77,201,246,.6); }
.user-row .banned { color: #f87171; }
.user-row .actions { margin-left: auto; display: flex; gap: 6px; }
</style>
</head>
<body>
<div class="header">
  <h1>创意工坊 - 管理后台</h1>
  <span class="thanks">致谢安安提供武器 -- 我们有了家</span>
</div>
<div class="stats" id="stats"></div>
<div class="tabs">
  <button class="tab active" onclick="switchTab('pending')">待审核</button>
  <button class="tab" onclick="switchTab('all')">全部作品</button>
  <button class="tab" onclick="switchTab('users')">用户管理</button>
</div>
<div class="content" id="content"></div>

<script>
const API = '';
let currentTab = 'pending';

async function api(path, opts = {}) {
  const resp = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    credentials: 'include',
  });
  return resp.json();
}

async function loadStats() {
  const data = await api('/admin/api/stats');
  document.getElementById('stats').innerHTML = [
    { num: data.totalUsers, label: '总用户' },
    { num: data.totalWorks, label: '已通过作品' },
    { num: data.pendingWorks, label: '待审核' },
    { num: data.todayUploads, label: '今日上传' },
  ].map(s => '<div class="stat-card"><div class="num">' + s.num + '</div><div class="label">' + s.label + '</div></div>').join('');
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', ['pending','all','users'][i] === tab));
  loadContent();
}

async function loadContent() {
  const el = document.getElementById('content');
  if (currentTab === 'pending') {
    const data = await api('/admin/api/works/pending');
    if (data.works.length === 0) { el.innerHTML = '<div class="empty">暂无待审核作品</div>'; return; }
    el.innerHTML = data.works.map(renderWorkCard).join('');
  } else if (currentTab === 'all') {
    const data = await api('/admin/api/works');
    if (data.works.length === 0) { el.innerHTML = '<div class="empty">暂无作品</div>'; return; }
    el.innerHTML = data.works.map(renderWorkCard).join('');
  } else {
    const data = await api('/admin/api/users');
    el.innerHTML = data.users.map(renderUserRow).join('');
  }
}

function renderWorkCard(w) {
  const statusCls = 'status-' + w.status;
  const statusText = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }[w.status] || w.status;
  const tags = (Array.isArray(w.tags) ? w.tags : []).map(t => '<span style="font-size:10px;color:rgba(255,255,255,.3);margin-right:4px;">#' + t + '</span>').join('');
  const coverHtml = w.cover_url ? '<img class="cover-img" src="' + w.cover_url + '" onerror="this.style.display=\\'none\\'" />' : '';
  const contentPreview = (w.content || '').substring(0, 500);

  let actions = '<button class="btn btn-danger" onclick="deleteWork(' + w.id + ')">删除</button>';
  if (w.status === 'pending') {
    actions = '<button class="btn btn-approve" onclick="approveWork(' + w.id + ')">通过</button>' +
              '<button class="btn btn-reject" onclick="rejectWork(' + w.id + ')">拒绝</button>' + actions;
  }

  return '<div class="work-card"><div class="top">' + coverHtml +
    '<div><div class="title">' + esc(w.title) + ' <span class="type-badge">' + w.type + '</span> <span class="status-badge ' + statusCls + '">' + statusText + '</span></div>' +
    '<div class="meta">by ' + esc(w.author_display_name || w.author_username) + ' | ' + w.created_at + '</div>' +
    '<div>' + tags + '</div></div></div>' +
    '<div class="desc">' + esc(w.description || '') + '</div>' +
    '<div class="content-preview">' + esc(contentPreview) + '</div>' +
    '<div class="actions">' + actions + '</div></div>';
}

function renderUserRow(u) {
  const bannedText = u.banned ? ' <span class="banned">[已封禁]</span>' : '';
  const banBtn = u.banned
    ? '<button class="btn" onclick="toggleBan(' + u.id + ',false)">解封</button>'
    : '<button class="btn btn-danger" onclick="toggleBan(' + u.id + ',true)">封禁</button>';
  return '<div class="user-row"><img src="' + (u.discord_avatar || '') + '" />' +
    '<div><div class="name">' + esc(u.discord_display_name || u.discord_username) + bannedText + '</div>' +
    '<div class="id">' + u.discord_id + ' | <span class="role">' + u.role + '</span></div></div>' +
    '<div class="actions">' + banBtn + '</div></div>';
}

async function approveWork(id) {
  await api('/admin/api/works/' + id + '/approve', { method: 'POST' });
  loadStats(); loadContent();
}

async function rejectWork(id) {
  const reason = prompt('拒绝原因:');
  if (reason === null) return;
  await api('/admin/api/works/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason }) });
  loadStats(); loadContent();
}

async function deleteWork(id) {
  if (!confirm('确定删除?')) return;
  await api('/admin/api/works/' + id, { method: 'DELETE' });
  loadStats(); loadContent();
}

async function toggleBan(id, banned) {
  if (!confirm(banned ? '确定封禁?' : '确定解封?')) return;
  await api('/admin/api/users/' + id + '/ban', { method: 'POST', body: JSON.stringify({ banned }) });
  loadContent();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadStats();
loadContent();
</script>
</body>
</html>`;
}

export default router;