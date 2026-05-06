import { Request, Response, NextFunction } from 'express';
import { findSession, isAdmin, getDb, type DbUser } from '../database';

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: DbUser;
      sessionToken?: string;
    }
  }
}

/** 从请求中提取 session token */
function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  if (typeof req.query.token === 'string') {
    return req.query.token;
  }
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.match(/ws_token=([^;]+)/);
    if (match) return match[1];
  }
  return undefined;
}

export function getOptionalUser(req: Request): DbUser | undefined {
  const token = extractToken(req);
  if (!token) return undefined;

  const session = findSession(token);
  if (!session || new Date(session.expires_at) < new Date()) return undefined;

  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as DbUser | undefined;
  if (!user || user.banned) return undefined;

  req.user = user;
  req.sessionToken = token;
  return user;
}

/** 必须登录 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: '未登录，请先使用 Discord 登录' });
    return;
  }

  const session = findSession(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return;
  }

  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as DbUser | undefined;
  if (!user) {
    res.status(401).json({ error: '用户不存在' });
    return;
  }

  if (user.banned) {
    res.status(403).json({ error: '账号已被封禁' });
    return;
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

/** 必须是管理员 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user || !isAdmin(req.user)) {
      res.status(403).json({ error: '需要管理员权限' });
      return;
    }
    next();
  });
}
