import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { config } from './config';
import { getDb, type DbUser } from './database';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface AuditLogInput {
  req?: Request;
  actor?: DbUser;
  userId?: number | null;
  targetUserId?: number | null;
  category: 'auth' | 'work' | 'review' | 'user' | 'security' | 'system';
  action: string;
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

function getRequestIp(req?: Request): string {
  if (!req) return '';
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(',')[0].trim();
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function stringifyDetail(detail: AuditLogInput['detail']): string {
  if (detail == null) return '{}';
  if (typeof detail === 'string') return JSON.stringify({ message: detail });
  try {
    return JSON.stringify(detail);
  } catch {
    return JSON.stringify({ message: 'detail_unserializable' });
  }
}

function parseDetail(detail: string): unknown {
  try {
    return JSON.parse(detail || '{}');
  } catch {
    return { raw: detail };
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

    const result = getDb().prepare(`
      INSERT INTO audit_logs (
        log_date, user_id, actor_username, actor_display_name, target_user_id,
        category, action, entity_type, entity_id, success, detail, ip, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logDate,
      userId,
      actor?.discord_username || '',
      actor?.discord_display_name || '',
      input.targetUserId ?? null,
      input.category,
      input.action,
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
    where.push('l.action LIKE ?');
    params.push(`%${filters.action}%`);
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
    const actor = log.actor_display_name || log.actor_username || (log.user_id == null ? 'anonymous' : `user#${log.user_id}`);
    const target = log.target_display_name || log.target_username || (log.target_user_id == null ? '' : `user#${log.target_user_id}`);
    const entity = log.entity_type ? `${log.entity_type}:${log.entity_id}` : '';
    const targetPart = target ? ` target=${target}` : '';
    const entityPart = entity ? ` entity=${entity}` : '';
    return `[${log.created_at}] [${log.log_date}] ${actor} ${log.category}.${log.action}${targetPart}${entityPart} success=${!!log.success} ip=${log.ip} detail=${JSON.stringify(parseDetail(log.detail))}`;
  }).join('\n');
}
