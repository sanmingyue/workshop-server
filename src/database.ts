import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './config';

let db: Database.Database;

export function initDatabase(): Database.Database {
  // 确保数据目录存在
  const dataDir = config.dataDir;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'workshop.db');
  db = new Database(dbPath);

  // 开启 WAL 模式提升并发性能
  db.pragma('journal_mode = WAL');

  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      discord_username TEXT NOT NULL,
      discord_display_name TEXT DEFAULT '',
      discord_avatar TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      banned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      cover_filename TEXT DEFAULT '',
      card_link TEXT DEFAULT '',
      file_type TEXT DEFAULT 'json',
      status TEXT DEFAULT 'pending',
      reject_reason TEXT DEFAULT '',
      download_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, work_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_passwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_plain TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);
    CREATE INDEX IF NOT EXISTS idx_works_type ON works(type);
    CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id);
    CREATE INDEX IF NOT EXISTS idx_likes_work ON likes(work_id);
    CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // ─── 数据库迁移：为已有表添加新字段 ───
  const migrateColumn = (table: string, column: string, type: string) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.find(c => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        console.log(`[DB] 迁移: ${table} 添加列 ${column}`);
      }
    } catch { /* ignore */ }
  };

  migrateColumn('works', 'card_link', "TEXT DEFAULT ''");
  migrateColumn('works', 'file_type', "TEXT DEFAULT 'json'");
  migrateColumn('user_passwords', 'password_plain', "TEXT DEFAULT ''");

  console.log('[DB] 数据库初始化完成:', dbPath);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

// ─── 用户操作 ───

export interface DbUser {
  id: number;
  discord_id: string;
  discord_username: string;
  discord_display_name: string;
  discord_avatar: string;
  role: string;
  banned: number;
  created_at: string;
  last_login: string;
}

export function findUserByDiscordId(discordId: string): DbUser | undefined {
  return getDb().prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId) as DbUser | undefined;
}

export function createUser(discordId: string, username: string, displayName: string, avatar: string): DbUser {
  const stmt = getDb().prepare(
    'INSERT INTO users (discord_id, discord_username, discord_display_name, discord_avatar) VALUES (?, ?, ?, ?)',
  );
  stmt.run(discordId, username, displayName, avatar);
  return findUserByDiscordId(discordId)!;
}

export function updateUserLogin(discordId: string, username: string, displayName: string, avatar: string): void {
  getDb().prepare(
    'UPDATE users SET discord_username = ?, discord_display_name = ?, discord_avatar = ?, last_login = CURRENT_TIMESTAMP WHERE discord_id = ?',
  ).run(username, displayName, avatar, discordId);
}

export function isAdmin(user: DbUser): boolean {
  return user.role === 'admin' || config.adminDiscordIds.includes(user.discord_id);
}

export function getAllUsers(): DbUser[] {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as DbUser[];
}

export function banUser(userId: number, banned: boolean): void {
  getDb().prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, userId);
}

// ─── 会话操作 ───

export function createSession(userId: number, token: string, expiresInHours: number = 168): void {
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
  getDb().prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
}

export function findSession(token: string): { user_id: number; expires_at: string } | undefined {
  return getDb().prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as any;
}

export function deleteSession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions(): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < datetime("now")').run();
}

// ─── 作品操作 ───

export interface DbWork {
  id: number;
  user_id: number;
  title: string;
  description: string;
  type: string;
  content: string;
  tags: string;
  cover_filename: string;
  card_link: string;
  file_type: string;
  status: string;
  reject_reason: string;
  download_count: number;
  like_count: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
}

export interface WorkWithAuthor extends DbWork {
  author_username: string;
  author_display_name: string;
  author_avatar: string;
  author_discord_id: string;
}

export function createWork(
  userId: number,
  title: string,
  description: string,
  type: string,
  content: string,
  tags: string[],
  coverFilename: string,
  cardLink: string = '',
  fileType: string = 'json',
): number {
  const result = getDb().prepare(
    'INSERT INTO works (user_id, title, description, type, content, tags, cover_filename, card_link, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(userId, title, description, type, content, JSON.stringify(tags), coverFilename, cardLink, fileType);
  return result.lastInsertRowid as number;
}

export function getApprovedWorks(
  page: number,
  pageSize: number,
  type?: string,
  search?: string,
  sort?: string,
  tag?: string,
): { works: WorkWithAuthor[]; total: number } {
  let where = `WHERE w.status = 'approved'`;
  const params: any[] = [];

  if (type) {
    where += ' AND w.type = ?';
    params.push(type);
  }
  if (search) {
    where += ' AND (w.title LIKE ? OR w.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    where += ' AND w.tags LIKE ?';
    params.push(`%"${tag}"%`);
  }

  let orderBy = 'ORDER BY w.created_at DESC';
  if (sort === 'popular') orderBy = 'ORDER BY w.download_count DESC, w.like_count DESC';
  if (sort === 'likes') orderBy = 'ORDER BY w.like_count DESC';

  const countSql = `SELECT COUNT(*) as total FROM works w ${where}`;
  const total = (getDb().prepare(countSql).get(...params) as any).total;

  const sql = `
    SELECT w.*, u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM works w
    JOIN users u ON w.user_id = u.id
    ${where}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const works = getDb().prepare(sql).all(...params, pageSize, (page - 1) * pageSize) as WorkWithAuthor[];

  return { works, total };
}

export function getWorkById(workId: number): WorkWithAuthor | undefined {
  const sql = `
    SELECT w.*, u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM works w
    JOIN users u ON w.user_id = u.id
    WHERE w.id = ?
  `;
  return getDb().prepare(sql).get(workId) as WorkWithAuthor | undefined;
}

export function getUserWorks(userId: number): WorkWithAuthor[] {
  const sql = `
    SELECT w.*, u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM works w
    JOIN users u ON w.user_id = u.id
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC
  `;
  return getDb().prepare(sql).all(userId) as WorkWithAuthor[];
}

export function updateWork(workId: number, title: string, description: string, content: string, tags: string[], coverFilename?: string, cardLink?: string, fileType?: string): void {
  if (coverFilename !== undefined) {
    getDb().prepare(
      'UPDATE works SET title = ?, description = ?, content = ?, tags = ?, cover_filename = ?, card_link = COALESCE(?, card_link), file_type = COALESCE(?, file_type), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(title, description, content, JSON.stringify(tags), coverFilename, cardLink ?? null, fileType ?? null, workId);
  } else {
    getDb().prepare(
      'UPDATE works SET title = ?, description = ?, content = ?, tags = ?, card_link = COALESCE(?, card_link), file_type = COALESCE(?, file_type), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(title, description, content, JSON.stringify(tags), cardLink ?? null, fileType ?? null, workId);
  }
}

export function deleteWork(workId: number): void {
  getDb().prepare('DELETE FROM works WHERE id = ?').run(workId);
}

export function approveWork(workId: number, reviewerId: number): void {
  getDb().prepare(
    `UPDATE works SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?`,
  ).run(reviewerId, workId);
}

export function rejectWork(workId: number, reviewerId: number, reason: string): void {
  getDb().prepare(
    `UPDATE works SET status = 'rejected', reject_reason = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?`,
  ).run(reason, reviewerId, workId);
}

export function getPendingWorks(): WorkWithAuthor[] {
  const sql = `
    SELECT w.*, u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM works w
    JOIN users u ON w.user_id = u.id
    WHERE w.status = 'pending'
    ORDER BY w.created_at ASC
  `;
  return getDb().prepare(sql).all() as WorkWithAuthor[];
}

export function getAllWorksAdmin(status?: string): WorkWithAuthor[] {
  let where = '';
  const params: any[] = [];
  if (status) {
    where = 'WHERE w.status = ?';
    params.push(status);
  }
  const sql = `
    SELECT w.*, u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM works w
    JOIN users u ON w.user_id = u.id
    ${where}
    ORDER BY w.created_at DESC
  `;
  return getDb().prepare(sql).all(...params) as WorkWithAuthor[];
}

export function incrementDownloadCount(workId: number): void {
  getDb().prepare('UPDATE works SET download_count = download_count + 1 WHERE id = ?').run(workId);
}

// ─── 点赞操作 ───

export function toggleLike(userId: number, workId: number): boolean {
  const existing = getDb().prepare('SELECT id FROM likes WHERE user_id = ? AND work_id = ?').get(userId, workId);
  if (existing) {
    getDb().prepare('DELETE FROM likes WHERE user_id = ? AND work_id = ?').run(userId, workId);
    getDb().prepare('UPDATE works SET like_count = like_count - 1 WHERE id = ? AND like_count > 0').run(workId);
    return false; // 取消点赞
  } else {
    getDb().prepare('INSERT INTO likes (user_id, work_id) VALUES (?, ?)').run(userId, workId);
    getDb().prepare('UPDATE works SET like_count = like_count + 1 WHERE id = ?').run(workId);
    return true; // 点赞
  }
}

export function getUserLikedWorkIds(userId: number): number[] {
  const rows = getDb().prepare('SELECT work_id FROM likes WHERE user_id = ?').all(userId) as { work_id: number }[];
  return rows.map(r => r.work_id);
}

// ─── 统计 ───

export function getStats(): {
  totalUsers: number; totalWorks: number; pendingWorks: number; todayUploads: number;
  pendingByType: Record<string, number>;
  approvedByType: Record<string, number>;
} {
  const totalUsers = (getDb().prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const totalWorks = (getDb().prepare(`SELECT COUNT(*) as c FROM works WHERE status = 'approved'`).get() as any).c;
  const pendingWorks = (getDb().prepare(`SELECT COUNT(*) as c FROM works WHERE status = 'pending'`).get() as any).c;
  const todayUploads = (getDb().prepare(`SELECT COUNT(*) as c FROM works WHERE date(created_at) = date('now')`).get() as any).c;

  // 按类型统计待审核
  const pendingByTypeRows = getDb().prepare(`SELECT type, COUNT(*) as c FROM works WHERE status = 'pending' GROUP BY type`).all() as { type: string; c: number }[];
  const pendingByType: Record<string, number> = {};
  for (const row of pendingByTypeRows) pendingByType[row.type] = row.c;

  // 按类型统计已通过
  const approvedByTypeRows = getDb().prepare(`SELECT type, COUNT(*) as c FROM works WHERE status = 'approved' GROUP BY type`).all() as { type: string; c: number }[];
  const approvedByType: Record<string, number> = {};
  for (const row of approvedByTypeRows) approvedByType[row.type] = row.c;

  return { totalUsers, totalWorks, pendingWorks, todayUploads, pendingByType, approvedByType };
}

// ─── 获取所有已用标签 ───

export function getAllTags(): string[] {
  const rows = getDb().prepare(`SELECT DISTINCT tags FROM works WHERE status = 'approved'`).all() as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      const arr = JSON.parse(row.tags);
      if (Array.isArray(arr)) arr.forEach((t: string) => tagSet.add(t));
    } catch { /* ignore */ }
  }
  return [...tagSet].sort();
}