import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { config } from './config';
import { getDb, type DbUser } from './database';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export type AuditCategory =
  | 'auth'
  | 'work'
  | 'review'
  | 'user'
  | 'security'
  | 'system'
  | 'download'
  | 'favorite'
  | 'like'
  | 'comment';

const ACTION_LABELS: Record<string, string> = {
  discord_registered: '用户通过 Discord 注册',
  discord_login: '用户通过 Discord 登录',
  discord_login_blocked_banned: '封禁用户 Discord 登录被拒绝',
  password_login: '用户密码登录',
  password_login_failed: '用户密码登录失败',
  password_login_blocked_banned: '封禁用户密码登录被拒绝',
  password_created: '用户设置密码',
  password_changed: '用户修改密码',
  logout: '用户退出登录',

  work_created: '用户上传作品',
  work_update_submitted: '作者提交作品更新',
  work_soft_deleted_by_author: '作者软删除作品',
  work_downloaded: '用户下载作品',
  work_liked: '用户点赞作品',
  work_unliked: '用户取消点赞',
  work_favorited: '用户收藏作品',
  work_unfavorited: '用户取消收藏',

  comment_created: '用户发表评论',
  comment_edited: '用户编辑评论',
  comment_hidden_by_author: '作者隐藏评论',
  comment_deleted_by_user: '用户删除自己的评论',
  comment_hidden_by_admin: '管理员隐藏评论',
  comment_deleted_by_admin: '管理员删除评论',

  work_approved: '管理员审核通过作品',
  work_rejected: '管理员驳回作品',
  work_version_approved: '管理员审核通过作品版本',
  work_version_rejected: '管理员驳回作品版本',
  work_hidden_by_admin: '管理员隐藏作品',
  work_restored_by_admin: '管理员恢复作品',
  work_deleted_by_admin: '管理员真删除作品',

  user_banned: '管理员封禁用户',
  user_unbanned: '管理员解封用户',
  password_revealed_by_admin: '管理员查阅用户密码',
  audit_logs_downloaded: '管理员下载操作日志',
};

export interface AuditLogInput {
  req?: Request;
  actor?: DbUser;
  userId?: number | null;
  targetUserId?: number | null;
  category: AuditCategory;
  action: string;
  actionLabel?: string;
  entityType?: string;
  entityId?: string | number | null;
  success?: boolean;
  detail?: Record<string, unknown> | string | null;
}

export interface AuditLogRow {
  id: number;
  log_date: string;
  user_id: number | null;
  actor_username: string;
  actor_display_name: string;
  target_user_id: number | null;
  target_username?: string;
  target_display_name?: string;
  category: string;
  action: string;
  action_label: string;
  entity_type: string;
  entity_id: string;
  success: number;
  detail: string;
  ip: string;
  user_agent: string;
  created_at: string;
}

export interface AuditLogFilters {
  userId?: number;
  date?: string;
  category?: string;
  action?: string;
  entityType?: string;
  entityId?: string | number;
  page?: number;
  pageSize?: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toLogDate(iso: string = nowIso()): string {
  const time = new Date(iso).getTime();
  return new Date(time + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

function getRequestIp(req?: Request): string {
  if (!req) return '';
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(',')[0].trim();
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function stringifyDetail(detail: AuditLogInput['detail']): string {
  if (detail == null) return '{}';
  if (typeof detail === 'string') return JSON.stringify({ 说明: detail });
  try {
    return JSON.stringify(detail);
  } catch {
    return JSON.stringify({ 说明: '详情无法序列化' });
  }
}

function parseDetail(detail: string): unknown {
  try {
    return JSON.parse(detail || '{}');
  } catch {
    return { 原始内容: detail };
  }
}

function appendDailyUserLog(row: AuditLogRow): void {
  try {
    const userKey = row.user_id == null ? 'anonymous' : String(row.user_id);
    const dir = path.join(config.dataDir, 'audit-logs', row.log_date);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `user-${userKey}.jsonl`);
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
  } catch (err) {
    console.warn('[Audit] 写入每日用户日志文件失败:', err);
  }
}

export function recordAuditLog(input: AuditLogInput): void {
  try {
    const actor = input.actor || input.req?.user;
    const userId = input.userId !== undefined ? input.userId : actor?.id ?? null;
    const createdAt = nowIso();
    const logDate = toLogDate(createdAt);
    const detail = stringifyDetail(input.detail);
    const ip = getRequestIp(input.req);
    const userAgent = input.req?.headers['user-agent'] || '';
    const entityId = input.entityId == null ? '' : String(input.entityId);
    const actionLabel = input.actionLabel || getActionLabel(input.action);

    const result = getDb().prepare(`
      INSERT INTO audit_logs (
        log_date, user_id, actor_username, actor_display_name, target_user_id,
        category, action, action_label, entity_type, entity_id, success, detail, ip, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logDate,
      userId,
      actor?.discord_username || '',
      actor?.discord_display_name || '',
      input.targetUserId ?? null,
      input.category,
      input.action,
      actionLabel,
      input.entityType || '',
      entityId,
      input.success === false ? 0 : 1,
      detail,
      ip,
      String(userAgent),
      createdAt,
    );

    appendDailyUserLog({
      id: Number(result.lastInsertRowid),
      log_date: logDate,
      user_id: userId,
      actor_username: actor?.discord_username || '',
      actor_display_name: actor?.discord_display_name || '',
      target_user_id: input.targetUserId ?? null,
      category: input.category,
      action: input.action,
      action_label: actionLabel,
      entity_type: input.entityType || '',
      entity_id: entityId,
      success: input.success === false ? 0 : 1,
      detail,
      ip,
      user_agent: String(userAgent),
      created_at: createdAt,
    });
  } catch (err) {
    console.warn('[Audit] 记录操作日志失败:', err);
  }
}

export function queryAuditLogs(filters: AuditLogFilters): {
  logs: AuditLogRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.userId) {
    where.push('(l.user_id = ? OR l.target_user_id = ?)');
    params.push(filters.userId, filters.userId);
  }
  if (filters.date) {
    where.push('l.log_date = ?');
    params.push(filters.date);
  }
  if (filters.category) {
    where.push('l.category = ?');
    params.push(filters.category);
  }
  if (filters.action) {
    where.push('(l.action LIKE ? OR l.action_label LIKE ?)');
    params.push(`%${filters.action}%`, `%${filters.action}%`);
  }
  if (filters.entityType) {
    where.push('l.entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.entityId !== undefined) {
    where.push('l.entity_id = ?');
    params.push(String(filters.entityId));
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(500, Math.max(1, filters.pageSize || 80));
  const offset = (page - 1) * pageSize;

  const total = (getDb().prepare(`
    SELECT COUNT(*) as c
    FROM audit_logs l
    ${whereSql}
  `).get(...params) as { c: number }).c;

  const logs = getDb().prepare(`
    SELECT
      l.*,
      target.discord_username as target_username,
      target.discord_display_name as target_display_name
    FROM audit_logs l
    LEFT JOIN users target ON target.id = l.target_user_id
    ${whereSql}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as AuditLogRow[];

  return {
    logs,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

export function serializeAuditLogs(logs: AuditLogRow[], format: 'json' | 'txt'): string {
  if (format === 'json') {
    return JSON.stringify(logs.map(log => ({
      ...log,
      success: !!log.success,
      detail: parseDetail(log.detail),
    })), null, 2);
  }

  return logs.map(log => {
    const actor = log.actor_display_name || log.actor_username || (log.user_id == null ? '匿名/未识别用户' : `用户#${log.user_id}`);
    const target = log.target_display_name || log.target_username || (log.target_user_id == null ? '' : `用户#${log.target_user_id}`);
    const entity = log.entity_type ? `${log.entity_type}:${log.entity_id}` : '';
    const targetPart = target ? ` 目标=${target}` : '';
    const entityPart = entity ? ` 对象=${entity}` : '';
    return `[${log.created_at}] [${log.log_date}] ${actor} ${log.action_label}${targetPart}${entityPart} 结果=${log.success ? '成功' : '失败'} IP=${log.ip} 详情=${JSON.stringify(parseDetail(log.detail))}`;
  }).join('\n');
}
