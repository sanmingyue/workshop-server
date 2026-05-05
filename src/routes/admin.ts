import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from '../auth/middleware';
import { config } from '../config';
import {
  getPendingWorks, getAllWorksAdmin, getWorkById,
  approveWork, rejectWork, deleteWork,
  getAllUsers, banUser, getStats, getDb,
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
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  approveWork(work.id, req.user!.id);
  res.json({ message: '已通过' });
});

/** POST /admin/api/works/:id/reject - 审核拒绝 */
router.post('/api/works/:id/reject', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const reason = req.body.reason || '不符合要求';
  rejectWork(work.id, req.user!.id, reason);
  res.json({ message: '已拒绝' });
});

/** DELETE /admin/api/works/:id - 强制删除作品 */
router.delete('/api/works/:id', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }

  // 删除封面
  if (work.cover_filename) {
    const coverPath = path.join(config.dataDir, 'uploads', work.cover_filename);
    if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
  }

  deleteWork(work.id);
  res.json({ message: '已删除' });
});

/** GET /admin/api/users - 用户列表（含密码） */
router.get('/api/users', requireAdmin, (_req: Request, res: Response) => {
  const users = getAllUsers();
  // 获取所有用户密码
  const passwords = getDb().prepare('SELECT user_id, password_plain FROM user_passwords').all() as { user_id: number; password_plain: string }[];
  const pwdMap = new Map(passwords.map(p => [p.user_id, p.password_plain]));

  res.json({
    users: users.map(u => ({
      ...u,
      password: pwdMap.get(u.id) || '',
    })),
  });
});

/** POST /admin/api/users/:id/ban - 封禁/解封用户 */
router.post('/api/users/:id/ban', requireAdmin, (req: Request, res: Response) => {
  const userId = parseInt(req.params.id as string);
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

/* ── Header ── */
.header { background: rgba(5,8,16,.9); border-bottom: 1px solid rgba(77,201,246,.15); padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
.header h1 { font-size: 18px; color: #4dc9f6; font-weight: 600; }
.header .thanks { font-size: 11px; color: rgba(255,255,255,.3); margin-left: auto; font-style: italic; }

/* ── Stats ── */
.stats { display: flex; gap: 12px; padding: 16px 24px; flex-wrap: wrap; }
.stat-card { background: rgba(77,201,246,.04); border: 1px solid rgba(77,201,246,.12); border-radius: 8px; padding: 12px 18px; min-width: 120px; }
.stat-card .num { font-size: 24px; font-weight: 700; color: #4dc9f6; }
.stat-card .label { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 4px; }
.stat-card.type-regex { border-color: rgba(96,165,250,.25); }
.stat-card.type-regex .num { color: #60a5fa; }
.stat-card.type-persona { border-color: rgba(52,211,153,.25); }
.stat-card.type-persona .num { color: #34d399; }
.stat-card.type-card_addon { border-color: rgba(167,139,250,.25); }
.stat-card.type-card_addon .num { color: #a78bfa; }
.stat-card.type-worldbook { border-color: rgba(251,191,36,.25); }
.stat-card.type-worldbook .num { color: #fbbf24; }
.stat-card.type-collection { border-color: rgba(251,146,60,.25); }
.stat-card.type-collection .num { color: #fb923c; }

/* ── Tabs ── */
.tabs { display: flex; gap: 0; padding: 0 24px; border-bottom: 1px solid rgba(77,201,246,.1); }
.tab { padding: 10px 20px; font-size: 13px; color: rgba(255,255,255,.4); cursor: pointer; border-bottom: 2px solid transparent; background: none; border-top: none; border-left: none; border-right: none; font-family: inherit; }
.tab:hover { color: rgba(255,255,255,.7); }
.tab.active { color: #4dc9f6; border-bottom-color: #4dc9f6; }
.content { padding: 16px 24px; }

/* ── Type group headers ── */
.type-group-header { display: flex; align-items: center; gap: 10px; margin: 20px 0 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,.06); }
.type-group-header:first-child { margin-top: 0; }
.type-group-header .type-icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; }
.type-group-header .type-name { font-size: 15px; font-weight: 600; color: rgba(255,255,255,.85); }
.type-group-header .type-count { font-size: 12px; color: rgba(255,255,255,.3); margin-left: auto; }

/* ── Work cards ── */
.work-card { background: rgba(77,201,246,.02); border: 1px solid rgba(77,201,246,.08); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
.work-card .top { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.work-card .title { font-size: 15px; font-weight: 600; color: rgba(255,255,255,.9); }
.work-card .type-badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; font-weight: 600; display: inline-block; }
.type-badge-regex { background: rgba(96,165,250,.15); color: #60a5fa; }
.type-badge-persona { background: rgba(52,211,153,.15); color: #34d399; }
.type-badge-card_addon { background: rgba(167,139,250,.15); color: #a78bfa; }
.type-badge-worldbook { background: rgba(251,191,36,.15); color: #fbbf24; }
.type-badge-collection { background: rgba(251,146,60,.15); color: #fb923c; }
.work-card .status-badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
.status-pending { background: rgba(251,191,36,.12); color: #fbbf24; }
.status-approved { background: rgba(52,211,153,.12); color: #34d399; }
.status-rejected { background: rgba(248,113,113,.12); color: #f87171; }
.work-card .meta { font-size: 11px; color: rgba(255,255,255,.35); margin-bottom: 6px; }
.work-card .card-link { font-size: 11px; color: rgba(96,165,250,.7); text-decoration: none; margin-bottom: 6px; display: inline-block; }
.work-card .card-link:hover { color: #60a5fa; text-decoration: underline; }
.work-card .reject-reason { font-size: 11px; color: #f87171; background: rgba(248,113,113,.06); border: 1px solid rgba(248,113,113,.12); padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; }
.work-card .desc { font-size: 12px; color: rgba(255,255,255,.5); margin-bottom: 8px; line-height: 1.5; }
.work-card .content-preview { font-size: 11px; color: rgba(255,255,255,.3); background: rgba(0,0,0,.2); padding: 8px; border-radius: 6px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; margin-bottom: 10px; font-family: monospace; }
.work-card .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

/* ── Buttons ── */
.btn { padding: 6px 16px; border-radius: 6px; border: 1px solid rgba(77,201,246,.2); background: rgba(77,201,246,.06); color: #4dc9f6; font-size: 12px; cursor: pointer; font-family: inherit; transition: all .15s; }
.btn:hover { background: rgba(77,201,246,.15); border-color: rgba(77,201,246,.4); }
.btn-approve { padding: 8px 28px; font-size: 14px; font-weight: 700; border: 2px solid rgba(52,211,153,.5); background: rgba(52,211,153,.12); color: #34d399; border-radius: 8px; }
.btn-approve:hover { background: rgba(52,211,153,.3); border-color: #34d399; box-shadow: 0 0 12px rgba(52,211,153,.2); }
.btn-reject { padding: 8px 28px; font-size: 14px; font-weight: 700; border: 2px solid rgba(248,113,113,.5); background: rgba(248,113,113,.12); color: #f87171; border-radius: 8px; }
.btn-reject:hover { background: rgba(248,113,113,.3); border-color: #f87171; box-shadow: 0 0 12px rgba(248,113,113,.2); }
.btn-danger { border-color: rgba(248,113,113,.3); background: rgba(248,113,113,.08); color: #f87171; }
.btn-danger:hover { background: rgba(248,113,113,.2); }
.cover-img { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(77,201,246,.1); flex-shrink: 0; }
.empty { text-align: center; color: rgba(255,255,255,.25); padding: 40px; font-size: 14px; }

/* ── Users ── */
.user-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(77,201,246,.06); }
.user-row img { width: 32px; height: 32px; border-radius: 50%; }
.user-row .name { font-size: 13px; color: rgba(255,255,255,.8); }
.user-row .id { font-size: 10px; color: rgba(255,255,255,.25); }
.user-row .role { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(77,201,246,.1); color: rgba(77,201,246,.6); }
.user-row .banned { color: #f87171; }
.user-row .actions { margin-left: auto; display: flex; gap: 6px; }

/* ── Reject Modal ── */
.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(4px); z-index: 1000; align-items: center; justify-content: center; }
.modal-overlay.show { display: flex; }
.modal { background: #131825; border: 1px solid rgba(77,201,246,.15); border-radius: 12px; padding: 24px; width: 420px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
.modal h3 { font-size: 16px; color: #f87171; margin-bottom: 16px; font-weight: 600; }
.modal textarea { width: 100%; height: 100px; background: rgba(0,0,0,.3); border: 1px solid rgba(248,113,113,.2); border-radius: 8px; color: #e0e0e0; font-size: 13px; padding: 10px; resize: vertical; font-family: inherit; outline: none; }
.modal textarea:focus { border-color: rgba(248,113,113,.5); }
.modal textarea::placeholder { color: rgba(255,255,255,.2); }
.modal .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
.modal .btn-cancel { padding: 8px 20px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: rgba(255,255,255,.5); border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; }
.modal .btn-cancel:hover { background: rgba(255,255,255,.08); }
.modal .btn-confirm-reject { padding: 8px 24px; border: 2px solid rgba(248,113,113,.5); background: rgba(248,113,113,.15); color: #f87171; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; }
.modal .btn-confirm-reject:hover { background: rgba(248,113,113,.3); }
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

<!-- 驳回理由弹窗 -->
<div class="modal-overlay" id="rejectModal">
  <div class="modal">
    <h3>驳回作品</h3>
    <div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:10px;" id="rejectWorkTitle"></div>
    <textarea id="rejectReason" placeholder="请输入驳回原因（必填）...&#10;&#10;例如：内容格式不符合要求 / 描述信息不完整 / 包含不当内容"></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeRejectModal()">取消</button>
      <button class="btn-confirm-reject" onclick="confirmReject()">确认驳回</button>
    </div>
  </div>
</div>

<script>
const API = '';
let currentTab = 'pending';
let rejectingWorkId = null;

const TYPE_CONFIG = {
  regex:      { label: '美化正则', color: '#60a5fa', bg: 'rgba(96,165,250,.15)', icon: '✦' },
  persona:    { label: '人设',     color: '#34d399', bg: 'rgba(52,211,153,.15)', icon: '☆' },
  card_addon: { label: '角色卡配套', color: '#a78bfa', bg: 'rgba(167,139,250,.15)', icon: '◈' },
  worldbook:  { label: '共享世界书', color: '#fbbf24', bg: 'rgba(251,191,36,.15)', icon: '◉' },
  collection: { label: '作者合集', color: '#fb923c', bg: 'rgba(251,146,60,.15)', icon: '◆' },
};

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
  const pbt = data.pendingByType || {};
  const abt = data.approvedByType || {};

  let html = [
    { num: data.totalUsers, label: '总用户', cls: '' },
    { num: data.totalWorks, label: '已通过作品', cls: '' },
    { num: data.pendingWorks, label: '待审核', cls: '' },
    { num: data.todayUploads, label: '今日上传', cls: '' },
  ].map(s => '<div class="stat-card ' + s.cls + '"><div class="num">' + s.num + '</div><div class="label">' + s.label + '</div></div>').join('');

  // 按类型的待审核统计
  const typeKeys = Object.keys(TYPE_CONFIG);
  const hasAnyPending = typeKeys.some(k => (pbt[k] || 0) > 0);
  if (hasAnyPending) {
    html += typeKeys.filter(k => (pbt[k] || 0) > 0).map(k => {
      const cfg = TYPE_CONFIG[k];
      return '<div class="stat-card type-' + k + '"><div class="num">' + pbt[k] + '</div><div class="label">待审 · ' + cfg.label + '</div></div>';
    }).join('');
  }

  document.getElementById('stats').innerHTML = html;
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
    if (data.works.length === 0) { el.innerHTML = '<div class="empty">🎉 暂无待审核作品</div>'; return; }
    el.innerHTML = renderGroupedWorks(data.works);
  } else if (currentTab === 'all') {
    const data = await api('/admin/api/works');
    if (data.works.length === 0) { el.innerHTML = '<div class="empty">暂无作品</div>'; return; }
    el.innerHTML = renderGroupedWorks(data.works);
  } else {
    const data = await api('/admin/api/users');
    el.innerHTML = data.users.map(renderUserRow).join('');
  }
}

function renderGroupedWorks(works) {
  // 按类型分组
  const groups = {};
  const typeOrder = ['regex', 'persona', 'card_addon', 'worldbook', 'collection'];
  works.forEach(w => {
    if (!groups[w.type]) groups[w.type] = [];
    groups[w.type].push(w);
  });

  let html = '';
  typeOrder.forEach(type => {
    if (!groups[type] || groups[type].length === 0) return;
    const cfg = TYPE_CONFIG[type] || { label: type, color: '#4dc9f6', bg: 'rgba(77,201,246,.15)', icon: '●' };
    html += '<div class="type-group-header">' +
      '<div class="type-icon" style="background:' + cfg.bg + ';color:' + cfg.color + ';">' + cfg.icon + '</div>' +
      '<div class="type-name">' + cfg.label + '</div>' +
      '<div class="type-count">' + groups[type].length + ' 个</div></div>';
    html += groups[type].map(renderWorkCard).join('');
  });

  // 未知类型
  Object.keys(groups).forEach(type => {
    if (typeOrder.includes(type)) return;
    html += '<div class="type-group-header"><div class="type-icon" style="background:rgba(255,255,255,.1);">?</div><div class="type-name">' + type + '</div><div class="type-count">' + groups[type].length + ' 个</div></div>';
    html += groups[type].map(renderWorkCard).join('');
  });

  return html;
}

function renderWorkCard(w) {
  const statusCls = 'status-' + w.status;
  const statusText = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }[w.status] || w.status;
  const typeBadgeCls = 'type-badge-' + w.type;
  const typeCfg = TYPE_CONFIG[w.type] || { label: w.type };
  const tags = (Array.isArray(w.tags) ? w.tags : []).map(t => '<span style="font-size:10px;color:rgba(255,255,255,.3);margin-right:4px;">#' + t + '</span>').join('');
  const coverHtml = w.cover_url ? '<img class="cover-img" src="' + w.cover_url + '" onerror="this.style.display=\\'none\\'" />' : '';
  const contentPreview = (w.content || '').substring(0, 500);

  // 角色卡链接
  const cardLinkHtml = w.card_link ? '<div><a class="card-link" href="' + esc(w.card_link) + '" target="_blank">🔗 角色卡链接: ' + esc(w.card_link) + '</a></div>' : '';

  // 驳回原因
  const rejectHtml = w.reject_reason ? '<div class="reject-reason">❌ 驳回原因: ' + esc(w.reject_reason) + '</div>' : '';

  let actions = '<button class="btn btn-danger" onclick="deleteWork(' + w.id + ')">删除</button>';
  if (w.status === 'pending') {
    actions = '<button class="btn btn-approve" onclick="approveWork(' + w.id + ')">✓ 通过</button>' +
              '<button class="btn btn-reject" onclick="openRejectModal(' + w.id + ',\\'' + esc(w.title).replace(/'/g, "\\\\'") + '\\')">✗ 驳回</button>' + actions;
  }

  return '<div class="work-card"><div class="top">' + coverHtml +
    '<div style="flex:1;"><div class="title">' + esc(w.title) + ' <span class="type-badge ' + typeBadgeCls + '">' + typeCfg.label + '</span> <span class="status-badge ' + statusCls + '">' + statusText + '</span></div>' +
    '<div class="meta">by ' + esc(w.author_display_name || w.author_username) + ' | ' + w.created_at + ' | ID:' + w.id + '</div>' +
    '<div>' + tags + '</div></div></div>' +
    cardLinkHtml +
    '<div class="desc">' + esc(w.description || '') + '</div>' +
    rejectHtml +
    '<div class="content-preview">' + esc(contentPreview) + '</div>' +
    '<div class="actions">' + actions + '</div></div>';
}

function renderUserRow(u) {
  const bannedText = u.banned ? ' <span class="banned">[已封禁]</span>' : '';
  const pwdText = u.password ? '<span style="color:rgba(52,211,153,.6);font-size:10px;margin-left:6px;">密码: ' + esc(u.password) + '</span>' : '<span style="color:rgba(255,255,255,.15);font-size:10px;margin-left:6px;">未设密码</span>';
  const banBtn = u.banned
    ? '<button class="btn" onclick="toggleBan(' + u.id + ',false)">解封</button>'
    : '<button class="btn btn-danger" onclick="toggleBan(' + u.id + ',true)">封禁</button>';
  return '<div class="user-row"><img src="' + (u.discord_avatar || '') + '" />' +
    '<div><div class="name">' + esc(u.discord_display_name || u.discord_username) + bannedText + '</div>' +
    '<div class="id">' + u.discord_id + ' | <span class="role">' + u.role + '</span>' + pwdText + '</div></div>' +
    '<div class="actions">' + banBtn + '</div></div>';
}

async function approveWork(id) {
  if (!confirm('确定通过该作品？通过后将在广场可见。')) return;
  await api('/admin/api/works/' + id + '/approve', { method: 'POST' });
  loadStats(); loadContent();
}

function openRejectModal(id, title) {
  rejectingWorkId = id;
  document.getElementById('rejectWorkTitle').textContent = '作品: ' + title;
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').classList.add('show');
  document.getElementById('rejectReason').focus();
}

function closeRejectModal() {
  rejectingWorkId = null;
  document.getElementById('rejectModal').classList.remove('show');
}

async function confirmReject() {
  const reason = document.getElementById('rejectReason').value.trim();
  if (!reason) {
    document.getElementById('rejectReason').style.borderColor = '#f87171';
    document.getElementById('rejectReason').setAttribute('placeholder', '⚠️ 驳回原因不能为空！请填写原因后再提交。');
    document.getElementById('rejectReason').focus();
    return;
  }
  await api('/admin/api/works/' + rejectingWorkId + '/reject', { method: 'POST', body: JSON.stringify({ reason }) });
  closeRejectModal();
  loadStats(); loadContent();
}

async function deleteWork(id) {
  if (!confirm('⚠️ 确定要永久删除该作品？此操作不可恢复。')) return;
  await api('/admin/api/works/' + id, { method: 'DELETE' });
  loadStats(); loadContent();
}

async function toggleBan(id, banned) {
  if (!confirm(banned ? '确定封禁该用户？' : '确定解封该用户？')) return;
  await api('/admin/api/users/' + id + '/ban', { method: 'POST', body: JSON.stringify({ banned }) });
  loadContent();
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// 点击模态框外部关闭
document.getElementById('rejectModal').addEventListener('click', function(e) {
  if (e.target === this) closeRejectModal();
});

// ESC 关闭模态框
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeRejectModal();
});

loadStats();
loadContent();
</script>
</body>
</html>`;
}

export default router;