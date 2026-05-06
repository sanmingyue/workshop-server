import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from '../auth/middleware';
import { config } from '../config';
import { adminPageHtml } from '../adminPage';
import { queryAuditLogs, recordAuditLog, serializeAuditLogs } from '../audit';
import {
  getPendingWorks, getAllWorksAdmin, getWorkById,
  approveWork, rejectWork, deleteWork,
  getAllUsers, banUser, getStats, getDb,
} from '../database';

const router = Router();

function workPayload(work: any) {
  return {
    ...work,
    tags: JSON.parse(work.tags || '[]'),
    cover_url: work.cover_filename ? `${config.baseUrl}/uploads/${work.cover_filename}` : null,
  };
}

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
  const type = req.query.type as string | undefined;
  const works = getAllWorksAdmin(status, type);
  res.json({ works: works.map(workPayload) });
});

/** GET /admin/api/works/pending - 获取待审核作品 */
router.get('/api/works/pending', requireAdmin, (_req: Request, res: Response) => {
  const works = getPendingWorks();
  res.json({ works: works.map(workPayload) });
});

/** POST /admin/api/works/:id/approve - 审核通过 */
router.post('/api/works/:id/approve', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  approveWork(work.id, req.user!.id);
  recordAuditLog({
    req,
    category: 'review',
    action: 'work_approved',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { title: work.title, type: work.type },
  });
  res.json({ message: '已通过' });
});

/** POST /admin/api/works/:id/reject - 审核拒绝 */
router.post('/api/works/:id/reject', requireAdmin, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const reason = req.body.reason || '不符合要求';
  rejectWork(work.id, req.user!.id, reason);
  recordAuditLog({
    req,
    category: 'review',
    action: 'work_rejected',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { title: work.title, type: work.type, reason },
  });
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
  recordAuditLog({
    req,
    category: 'review',
    action: 'work_deleted_by_admin',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { title: work.title, type: work.type, previous_status: work.status },
  });
  res.json({ message: '已删除' });
});

/** GET /admin/api/users - 用户列表（密码不直接显示） */
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

/** POST /admin/api/users/:id/password - 手动查阅用户密码 */
router.post('/api/users/:id/password', requireAdmin, (req: Request, res: Response) => {
  const userId = parseInt(req.params.id as string);
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user) { res.status(404).json({ error: '用户不存在' }); return; }

  const password = getDb().prepare(
    'SELECT password_plain, password_updated_at FROM user_passwords WHERE user_id = ?'
  ).get(userId) as { password_plain: string; password_updated_at: string } | undefined;

  recordAuditLog({
    req,
    category: 'security',
    action: 'password_revealed_by_admin',
    entityType: 'user',
    entityId: userId,
    targetUserId: userId,
    detail: {
      username: user.discord_username,
      display_name: user.discord_display_name,
      has_password: !!password?.password_plain,
    },
  });

  res.json({
    user_id: userId,
    username: user.discord_username,
    display_name: user.discord_display_name,
    password: password?.password_plain || '',
    password_updated_at: password?.password_updated_at || '',
  });
});

/** POST /admin/api/users/:id/ban - 封禁/解封用户 */
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
    detail: {
      username: user.discord_username,
      display_name: user.discord_display_name,
    },
  });
  res.json({ message: banned ? '已封禁' : '已解封' });
});

/** GET /admin/api/logs - 操作日志列表 */
router.get('/api/logs', requireAdmin, (req: Request, res: Response) => {
  const result = queryAuditLogs({
    userId: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
    date: req.query.date as string | undefined,
    category: req.query.category as string | undefined,
    action: req.query.action as string | undefined,
    page: req.query.page ? parseInt(req.query.page as string) : undefined,
    pageSize: req.query.page_size ? parseInt(req.query.page_size as string) : undefined,
  });
  res.json(result);
});

/** GET /admin/api/logs/download - 下载操作日志 */
router.get('/api/logs/download', requireAdmin, (req: Request, res: Response) => {
  const format = req.query.format === 'json' ? 'json' : 'txt';
  const result = queryAuditLogs({
    userId: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
    date: req.query.date as string | undefined,
    category: req.query.category as string | undefined,
    action: req.query.action as string | undefined,
    page: 1,
    pageSize: 5000,
  });

  recordAuditLog({
    req,
    category: 'security',
    action: 'audit_logs_downloaded',
    entityType: 'audit_logs',
    detail: {
      format,
      user_id: req.query.user_id || '',
      date: req.query.date || '',
      category: req.query.category || '',
      action: req.query.action || '',
      count: result.logs.length,
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

export default router;
