import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from '../auth/middleware';
import { config } from '../config';
import { adminPageHtml } from '../adminPage';
import { queryAuditLogs, recordAuditLog, serializeAuditLogs } from '../audit';
import {
  approveWork,
  banUser,
  deleteCommentByAdmin,
  deleteWork,
  getAllCommentsAdmin,
  getAllUsers,
  getAllVersionsAdmin,
  getAllWorksAdmin,
  getCommentById,
  getDb,
  getDownloadsAdmin,
  getFavoritesAdmin,
  getLikesAdmin,
  getPendingWorks,
  getStats,
  getWorkById,
  getWorkFileNames,
  getWorkVersion,
  hideComment,
  hideWorkByAdmin,
  rejectWork,
  restoreWorkByAdmin,
} from '../database';

const router = Router();

function safeJsonTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function workPayload(work: any) {
  return {
    ...work,
    tags: safeJsonTags(work.tags),
    pending_tags: safeJsonTags(work.pending_tags || '[]'),
    cover_url: work.cover_filename ? `${config.baseUrl}/uploads/${work.cover_filename}` : null,
    pending_cover_url: work.pending_cover_filename ? `${config.baseUrl}/uploads/${work.pending_cover_filename}` : null,
  };
}

function versionPayload(version: any) {
  return {
    ...version,
    tags: safeJsonTags(version.tags),
    cover_url: version.cover_filename ? `${config.baseUrl}/uploads/${version.cover_filename}` : null,
  };
}

function removeUploadFiles(workId: number): void {
  const names = getWorkFileNames(workId);
  for (const name of names) {
    const filePath = path.join(config.dataDir, 'uploads', name);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
}

router.get('/', requireAdmin, (_req: Request, res: Response) => {
  res.send(adminPageHtml());
});

router.get('/api/stats', requireAdmin, (_req: Request, res: Response) => {
  res.json(getStats());
});

router.get('/api/works', requireAdmin, (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const type = req.query.type as string | undefined;
  const visibility = req.query.visibility as string | undefined;
  const works = getAllWorksAdmin(status, type, visibility);
  res.json({ works: works.map(workPayload) });
});

router.get('/api/works/pending', requireAdmin, (_req: Request, res: Response) => {
  const works = getPendingWorks();
  res.json({ works: works.map(workPayload) });
});

router.get('/api/versions', requireAdmin, (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const kind = req.query.kind as string | undefined;
  const updateOnly = kind === 'update' ? true : kind === 'new' ? false : undefined;
  const versions = getAllVersionsAdmin(status, updateOnly);
  res.json({ versions: versions.map(versionPayload) });
});

router.post('/api/versions/:id/approve', requireAdmin, (req: Request, res: Response) => {
  const version = getWorkVersion(parseInt(req.params.id as string));
  if (!version) { res.status(404).json({ error: '版本不存在' }); return; }
  const approved = approveWork(version.work_id, req.user!.id, version.id);
  if (!approved) { res.status(400).json({ error: '没有可审核的待审版本' }); return; }
  recordAuditLog({
    req,
    category: 'review',
    action: version.version_no > 1 ? 'work_version_approved' : 'work_approved',
    entityType: 'work_version',
    entityId: version.id,
    targetUserId: getWorkById(version.work_id)?.user_id,
    detail: { 作品ID: version.work_id, 作品标题: version.title, 版本号: version.version_no },
  });
  res.json({ message: '已通过' });
});

router.post('/api/versions/:id/reject', requireAdmin, (req: Request, res: Response) => {
  const version = getWorkVersion(parseInt(req.params.id as string));
  if (!version) { res.status(404).json({ error: '版本不存在' }); return; }
  const reason = String(req.body.reason || '不符合要求').trim();
  const rejected = rejectWork(version.work_id, req.user!.id, reason, version.id);
  if (!rejected) { res.status(400).json({ error: '没有可驳回的待审版本' }); return; }
  recordAuditLog({
    req,
    category: 'review',
    action: version.version_no > 1 ? 'work_version_rejected' : 'work_rejected',
    entityType: 'work_version',
    entityId: version.id,
    targetUserId: getWorkById(version.work_id)?.user_id,
    detail: { 作品ID: version.work_id, 作品标题: version.title, 版本号: version.version_no, 理由: reason },
  });
  res.json({ message: '已驳回' });
});

router.post('/api/works/:id/approve', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const version = approveWork(work.id, req.user!.id);
  if (!version) { res.status(400).json({ error: '没有可审核的待审版本' }); return; }
  recordAuditLog({
    req,
    category: 'review',
    action: version.version_no > 1 ? 'work_version_approved' : 'work_approved',
    entityType: 'work_version',
    entityId: version.id,
    targetUserId: work.user_id,
    detail: { 作品ID: work.id, 作品标题: version.title, 版本号: version.version_no },
  });
  res.json({ message: '已通过' });
});

router.post('/api/works/:id/reject', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const reason = String(req.body.reason || '不符合要求').trim();
  const version = rejectWork(work.id, req.user!.id, reason);
  if (!version) { res.status(400).json({ error: '没有可驳回的待审版本' }); return; }
  recordAuditLog({
    req,
    category: 'review',
    action: version.version_no > 1 ? 'work_version_rejected' : 'work_rejected',
    entityType: 'work_version',
    entityId: version.id,
    targetUserId: work.user_id,
    detail: { 作品ID: work.id, 作品标题: version.title, 版本号: version.version_no, 理由: reason },
  });
  res.json({ message: '已驳回' });
});

router.post('/api/works/:id/hide', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const reason = String(req.body.reason || '存在争议，暂时隐藏').trim();
  hideWorkByAdmin(work.id, req.user!.id, reason);
  recordAuditLog({
    req,
    category: 'review',
    action: 'work_hidden_by_admin',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { 作品标题: work.title, 类型: work.type, 理由: reason },
  });
  res.json({ message: '已隐藏' });
});

router.post('/api/works/:id/restore', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  restoreWorkByAdmin(work.id);
  recordAuditLog({
    req,
    category: 'review',
    action: 'work_restored_by_admin',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { 作品标题: work.title, 类型: work.type },
  });
  res.json({ message: '已恢复公开' });
});

router.delete('/api/works/:id', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const reason = String(req.body?.reason || '管理员真删除作品').trim();
  removeUploadFiles(work.id);
  deleteWork(work.id);
  recordAuditLog({
    req,
    category: 'review',
    action: 'work_deleted_by_admin',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { 作品标题: work.title, 类型: work.type, 原状态: work.status, 原可见性: work.visibility, 理由: reason },
  });
  res.json({ message: '已真删除' });
});

router.get('/api/users', requireAdmin, (_req: Request, res: Response) => {
  const users = getAllUsers();
  const passwords = getDb().prepare(
    'SELECT user_id, password_plain, password_updated_at FROM user_passwords'
  ).all() as { user_id: number; password_plain: string; password_updated_at: string }[];
  const pwdMap = new Map(passwords.map(p => [p.user_id, p]));

  res.json({
    users: users.map(u => {
      const pwd = pwdMap.get(u.id);
      return {
        ...u,
        password_available: !!pwd?.password_plain,
        password_length: pwd?.password_plain ? pwd.password_plain.length : 0,
        password_updated_at: pwd?.password_updated_at || '',
      };
    }),
  });
});

router.post('/api/users/:id/password', requireAdmin, (req: Request, res: Response) => {
  const userId = parseInt(req.params.id as string);
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user) { res.status(404).json({ error: '用户不存在' }); return; }
  const password = getDb().prepare('SELECT password_plain, password_updated_at FROM user_passwords WHERE user_id = ?')
    .get(userId) as { password_plain: string; password_updated_at: string } | undefined;

  recordAuditLog({
    req,
    category: 'security',
    action: 'password_revealed_by_admin',
    entityType: 'user',
    entityId: userId,
    targetUserId: userId,
    detail: { 用户名: user.discord_username, 显示名: user.discord_display_name, 是否有密码: !!password?.password_plain },
  });

  res.json({
    user_id: userId,
    username: user.discord_username,
    display_name: user.discord_display_name,
    password: password?.password_plain || '',
    password_updated_at: password?.password_updated_at || '',
  });
});

router.post('/api/users/:id/ban', requireAdmin, (req: Request, res: Response) => {
  const userId = parseInt(req.params.id as string);
  const { banned } = req.body;
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user) { res.status(404).json({ error: '用户不存在' }); return; }
  banUser(userId, !!banned);
  recordAuditLog({
    req,
    category: 'user',
    action: banned ? 'user_banned' : 'user_unbanned',
    entityType: 'user',
    entityId: userId,
    targetUserId: userId,
    detail: { 用户名: user.discord_username, 显示名: user.discord_display_name },
  });
  res.json({ message: banned ? '已封禁' : '已解封' });
});

router.get('/api/comments', requireAdmin, (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  res.json({ comments: getAllCommentsAdmin(status) });
});

router.post('/api/comments/:id/hide', requireAdmin, (req: Request, res: Response) => {
  const comment = getCommentById(parseInt(req.params.id as string));
  if (!comment) { res.status(404).json({ error: '评论不存在' }); return; }
  const reason = String(req.body.reason || '管理员隐藏评论').trim();
  hideComment(comment.id, req.user!.id, 'admin', reason);
  recordAuditLog({
    req,
    category: 'comment',
    action: 'comment_hidden_by_admin',
    entityType: 'comment',
    entityId: comment.id,
    targetUserId: comment.user_id,
    detail: { 作品: comment.work_title || '', 理由: reason },
  });
  res.json({ message: '评论已隐藏' });
});

router.delete('/api/comments/:id', requireAdmin, (req: Request, res: Response) => {
  const comment = getCommentById(parseInt(req.params.id as string));
  if (!comment) { res.status(404).json({ error: '评论不存在' }); return; }
  deleteCommentByAdmin(comment.id);
  recordAuditLog({
    req,
    category: 'comment',
    action: 'comment_deleted_by_admin',
    entityType: 'comment',
    entityId: comment.id,
    targetUserId: comment.user_id,
    detail: { 作品: comment.work_title || '', 评论者ID: comment.user_id },
  });
  res.json({ message: '评论已删除' });
});

router.get('/api/downloads', requireAdmin, (req: Request, res: Response) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 300));
  res.json({ downloads: getDownloadsAdmin(limit) });
});

router.get('/api/favorites', requireAdmin, (req: Request, res: Response) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 300));
  res.json({ favorites: getFavoritesAdmin(limit) });
});

router.get('/api/likes', requireAdmin, (req: Request, res: Response) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 300));
  res.json({ likes: getLikesAdmin(limit) });
});

router.get('/api/logs', requireAdmin, (req: Request, res: Response) => {
  const result = queryAuditLogs({
    userId: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
    date: req.query.date as string | undefined,
    category: req.query.category as string | undefined,
    action: req.query.action as string | undefined,
    entityType: req.query.entity_type as string | undefined,
    entityId: req.query.entity_id as string | undefined,
    page: req.query.page ? parseInt(req.query.page as string) : undefined,
    pageSize: req.query.page_size ? parseInt(req.query.page_size as string) : undefined,
  });
  res.json(result);
});

router.get('/api/logs/download', requireAdmin, (req: Request, res: Response) => {
  const format = req.query.format === 'json' ? 'json' : 'txt';
  const result = queryAuditLogs({
    userId: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
    date: req.query.date as string | undefined,
    category: req.query.category as string | undefined,
    action: req.query.action as string | undefined,
    entityType: req.query.entity_type as string | undefined,
    entityId: req.query.entity_id as string | undefined,
    page: 1,
    pageSize: 5000,
  });

  recordAuditLog({
    req,
    category: 'security',
    action: 'audit_logs_downloaded',
    entityType: 'audit_logs',
    detail: {
      格式: format,
      用户ID: req.query.user_id || '',
      日期: req.query.date || '',
      分类: req.query.category || '',
      操作: req.query.action || '',
      数量: result.logs.length,
    },
  });

  const body = serializeAuditLogs(result.logs, format);
  const datePart = (req.query.date as string | undefined) || 'all';
  const userPart = (req.query.user_id as string | undefined) || 'all-users';
  const filename = `audit-${datePart}-${userPart}.${format}`;
  res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
});

router.get('/api/trace/users/:id', requireAdmin, (req: Request, res: Response) => {
  const userId = parseInt(req.params.id as string);
  const logs = queryAuditLogs({ userId, pageSize: 500 });
  res.json({ logs: logs.logs, total: logs.total });
});

router.get('/api/trace/works/:id', requireAdmin, (req: Request, res: Response) => {
  const workId = req.params.id as string;
  const logs = queryAuditLogs({ entityType: 'work', entityId: workId, pageSize: 500 });
  const versionLogs = queryAuditLogs({ entityType: 'work_version', pageSize: 500 });
  res.json({
    work: getWorkById(parseInt(workId)),
    logs: [...logs.logs, ...versionLogs.logs.filter(log => {
      try {
        const detail = JSON.parse(log.detail || '{}');
        return String(detail['作品ID'] || '') === workId;
      } catch {
        return false;
      }
    })].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  });
});

export default router;
