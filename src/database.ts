import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { createDownloadFileToken, createFingerprintNonce, createFingerprintToken } from './fingerprint';

let db: Database.Database;

function currentIso(): string {
  return new Date().toISOString();
}

function parseTags(tags: string): string[] {
  try {
    const value = JSON.parse(tags || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function initDatabase(): Database.Database {
  const dataDir = config.dataDir;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'workshop.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

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
      current_version_id INTEGER,
      last_version_no INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      cover_filename TEXT DEFAULT '',
      card_link TEXT DEFAULT '',
      file_type TEXT DEFAULT 'json',
      status TEXT DEFAULT 'pending',
      visibility TEXT DEFAULT 'public',
      reject_reason TEXT DEFAULT '',
      hidden_reason TEXT DEFAULT '',
      hidden_at TEXT DEFAULT '',
      hidden_by INTEGER,
      author_deleted_at TEXT DEFAULT '',
      author_delete_reason TEXT DEFAULT '',
      download_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      favorite_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT '',
      reviewed_at TEXT DEFAULT '',
      reviewed_by INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS work_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL,
      version_no INTEGER NOT NULL,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT DEFAULT '',
      reviewed_by INTEGER,
      UNIQUE(work_id, version_no),
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_id INTEGER NOT NULL,
      created_at TEXT DEFAULT '',
      UNIQUE(user_id, work_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, work_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_id INTEGER NOT NULL,
      work_version_id INTEGER,
      fingerprint_token TEXT DEFAULT '',
      fingerprint_payload TEXT DEFAULT '',
      fingerprint_version TEXT DEFAULT 'v1',
      file_token TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
      FOREIGN KEY (work_version_id) REFERENCES work_versions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS download_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint_token TEXT UNIQUE NOT NULL,
      fingerprint_payload TEXT DEFAULT '',
      fingerprint_version TEXT DEFAULT 'v1',
      download_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      downloader_username TEXT DEFAULT '',
      downloader_display_name TEXT DEFAULT '',
      downloader_discord_id TEXT DEFAULT '',
      work_id INTEGER NOT NULL,
      work_version_id INTEGER,
      work_title TEXT DEFAULT '',
      work_type TEXT DEFAULT '',
      author_user_id INTEGER,
      author_username TEXT DEFAULT '',
      author_display_name TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'visible',
      hidden_reason TEXT DEFAULT '',
      hidden_by INTEGER,
      hidden_by_role TEXT DEFAULT '',
      hidden_at TEXT DEFAULT '',
      deleted_at TEXT DEFAULT '',
      deleted_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (hidden_by) REFERENCES users(id),
      FOREIGN KEY (deleted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_passwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_plain TEXT DEFAULT '',
      password_updated_at TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_date TEXT NOT NULL,
      user_id INTEGER,
      actor_username TEXT DEFAULT '',
      actor_display_name TEXT DEFAULT '',
      target_user_id INTEGER,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      action_label TEXT DEFAULT '',
      entity_type TEXT DEFAULT '',
      entity_id TEXT DEFAULT '',
      success INTEGER DEFAULT 1,
      detail TEXT DEFAULT '{}',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );
  `);

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
  migrateColumn('works', 'current_version_id', 'INTEGER');
  migrateColumn('works', 'last_version_no', 'INTEGER DEFAULT 1');
  migrateColumn('works', 'visibility', "TEXT DEFAULT 'public'");
  migrateColumn('works', 'hidden_reason', "TEXT DEFAULT ''");
  migrateColumn('works', 'hidden_at', "TEXT DEFAULT ''");
  migrateColumn('works', 'hidden_by', 'INTEGER');
  migrateColumn('works', 'author_deleted_at', "TEXT DEFAULT ''");
  migrateColumn('works', 'author_delete_reason', "TEXT DEFAULT ''");
  migrateColumn('works', 'favorite_count', 'INTEGER DEFAULT 0');
  migrateColumn('works', 'comment_count', 'INTEGER DEFAULT 0');
  migrateColumn('user_passwords', 'password_plain', "TEXT DEFAULT ''");
  migrateColumn('user_passwords', 'password_updated_at', "TEXT DEFAULT ''");
  migrateColumn('downloads', 'fingerprint_token', "TEXT DEFAULT ''");
  migrateColumn('downloads', 'fingerprint_payload', "TEXT DEFAULT ''");
  migrateColumn('downloads', 'fingerprint_version', "TEXT DEFAULT 'v1'");
  migrateColumn('downloads', 'file_token', "TEXT DEFAULT ''");
  migrateColumn('audit_logs', 'action_label', "TEXT DEFAULT ''");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);
    CREATE INDEX IF NOT EXISTS idx_works_type ON works(type);
    CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id);
    CREATE INDEX IF NOT EXISTS idx_works_visibility ON works(visibility);
    CREATE INDEX IF NOT EXISTS idx_works_status_visibility_created ON works(status, visibility, created_at);
    CREATE INDEX IF NOT EXISTS idx_works_user_created ON works(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_work_versions_work ON work_versions(work_id);
    CREATE INDEX IF NOT EXISTS idx_work_versions_status ON work_versions(status);
    CREATE INDEX IF NOT EXISTS idx_likes_work ON likes(work_id);
    CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
    CREATE INDEX IF NOT EXISTS idx_likes_user_created ON likes(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_likes_work_created ON likes(work_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_favorites_work ON favorites(work_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_favorites_work_created ON favorites(work_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_downloads_work ON downloads(work_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_fingerprint ON downloads(fingerprint_token);
    CREATE INDEX IF NOT EXISTS idx_downloads_user_created ON downloads(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_downloads_work_created ON downloads(work_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_download_fingerprints_token ON download_fingerprints(fingerprint_token);
    CREATE INDEX IF NOT EXISTS idx_download_fingerprints_user_created ON download_fingerprints(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_download_fingerprints_work_created ON download_fingerprints(work_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id);
    CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
    CREATE INDEX IF NOT EXISTS idx_comments_work_status_created ON comments(work_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_user_created ON comments(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_date_user ON audit_logs(log_date, user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON audit_logs(target_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created ON audit_logs(entity_type, entity_id, created_at);
  `);

  backfillWorkVersions();
  refreshAllCounters();

  console.log('[DB] 数据库初始化完成:', dbPath);
  return db;
}

function backfillWorkVersions(): void {
  const tx = db.transaction(() => {
    const rows = db.prepare(`
      SELECT *
      FROM works w
      WHERE NOT EXISTS (SELECT 1 FROM work_versions v WHERE v.work_id = w.id)
    `).all() as DbWork[];
    const insert = db.prepare(`
      INSERT INTO work_versions (
        work_id, version_no, title, description, type, content, tags, cover_filename,
        card_link, file_type, status, reject_reason, created_at, updated_at, reviewed_at, reviewed_by
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = db.prepare('UPDATE works SET current_version_id = ?, last_version_no = 1, created_at = COALESCE(NULLIF(created_at, \'\'), ?), updated_at = COALESCE(NULLIF(updated_at, \'\'), ?) WHERE id = ?');

    for (const row of rows) {
      const now = currentIso();
      const createdAt = row.created_at || now;
      const updatedAt = row.updated_at || now;
      const result = insert.run(
        row.id,
        row.title,
        row.description || '',
        row.type,
        row.content,
        row.tags || '[]',
        row.cover_filename || '',
        row.card_link || '',
        row.file_type || 'json',
        row.status || 'pending',
        row.reject_reason || '',
        createdAt,
        updatedAt,
        row.reviewed_at || '',
        row.reviewed_by ?? null,
      );
      update.run(result.lastInsertRowid, createdAt, updatedAt, row.id);
    }

    db.prepare(`
      UPDATE works
      SET current_version_id = (
        SELECT v.id FROM work_versions v
        WHERE v.work_id = works.id
        ORDER BY CASE WHEN v.status = 'approved' THEN 0 ELSE 1 END, v.version_no DESC
        LIMIT 1
      )
      WHERE current_version_id IS NULL
    `).run();
  });
  tx();
}

function refreshAllCounters(): void {
  getDb().prepare('UPDATE works SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.work_id = works.id)').run();
  getDb().prepare('UPDATE works SET favorite_count = (SELECT COUNT(*) FROM favorites WHERE favorites.work_id = works.id)').run();
  getDb().prepare("UPDATE works SET comment_count = (SELECT COUNT(*) FROM comments WHERE comments.work_id = works.id AND comments.status = 'visible')").run();
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

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
    'UPDATE users SET discord_username = ?, discord_display_name = ?, discord_avatar = ?, last_login = ? WHERE discord_id = ?',
  ).run(username, displayName, avatar, currentIso(), discordId);
}

export function isAdmin(user: DbUser): boolean {
  return user.role === 'admin' || config.adminDiscordIds.includes(user.discord_id);
}

export function getAllUsers(): DbUser[] {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as DbUser[];
}

export function searchUsersAdmin(options: AdminUserSearchOptions): PageResult<DbUser> {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = options.q?.trim();
  if (q) {
    where.push(`(
      discord_username LIKE ?
      OR discord_display_name LIKE ?
      OR discord_id LIKE ?
      OR CAST(id AS TEXT) = ?
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pageParams(options.page, options.pageSize, 200);
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM users ${whereSql}`).get(...params) as { c: number }).c;
  const users = getDb().prepare(`
    SELECT *
    FROM users
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as DbUser[];
  return pageResult(users, total, page, pageSize);
}

export function banUser(userId: number, banned: boolean): void {
  getDb().prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, userId);
}

export function createSession(userId: number, token: string, expiresInHours: number = 168): void {
  const now = currentIso();
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
  getDb().prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, expiresAt);
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

export interface DbWork {
  id: number;
  user_id: number;
  current_version_id: number | null;
  last_version_no: number;
  title: string;
  description: string;
  type: string;
  content: string;
  tags: string;
  cover_filename: string;
  card_link: string;
  file_type: string;
  status: string;
  visibility: string;
  reject_reason: string;
  hidden_reason: string;
  hidden_at: string;
  hidden_by: number | null;
  author_deleted_at: string;
  author_delete_reason: string;
  download_count: number;
  like_count: number;
  favorite_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
}

export interface DbWorkVersion {
  id: number;
  work_id: number;
  version_no: number;
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
  created_at: string;
  updated_at: string;
  reviewed_at: string;
  reviewed_by: number | null;
}

export interface WorkWithAuthor extends DbWork {
  author_username: string;
  author_display_name: string;
  author_avatar: string;
  author_discord_id: string;
  pending_version_id?: number | null;
  pending_version_no?: number | null;
  pending_title?: string;
  pending_description?: string;
  pending_content?: string;
  pending_tags?: string;
  pending_cover_filename?: string;
  pending_card_link?: string;
  pending_file_type?: string;
  pending_created_at?: string;
}

export interface VersionWithWork extends DbWorkVersion {
  work_title: string;
  work_visibility: string;
  author_username: string;
  author_display_name: string;
  author_avatar: string;
  author_discord_id: string;
}

export interface DbComment {
  id: number;
  work_id: number;
  user_id: number;
  content: string;
  status: string;
  hidden_reason: string;
  hidden_by: number | null;
  hidden_by_role: string;
  hidden_at: string;
  deleted_at: string;
  deleted_by: number | null;
  created_at: string;
  updated_at: string;
  username?: string;
  display_name?: string;
  avatar?: string;
  work_title?: string;
  work_author_id?: number;
}

export interface DbDownload {
  id: number;
  user_id: number;
  work_id: number;
  work_version_id: number | null;
  fingerprint_token: string;
  fingerprint_payload: string;
  fingerprint_version: string;
  file_token: string;
  ip: string;
  user_agent: string;
  created_at: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface AdminWorkSearchOptions {
  status?: string;
  type?: string;
  visibility?: string;
  q?: string;
  userId?: number;
  page?: number;
  pageSize?: number;
}

export interface AdminUserSearchOptions {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminCommentSearchOptions {
  status?: string;
  workId?: number;
  userId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminActivitySearchOptions {
  userId?: number;
  workId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

function pageParams(page?: number, pageSize?: number, maxPageSize: number = 200): { page: number; pageSize: number; offset: number } {
  const finalPage = Math.max(1, page || 1);
  const finalPageSize = Math.min(maxPageSize, Math.max(1, pageSize || 80));
  return { page: finalPage, pageSize: finalPageSize, offset: (finalPage - 1) * finalPageSize };
}

function pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
  return { items, total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
}

function selectWorkWithAuthor(where: string, params: unknown[], orderBy: string): WorkWithAuthor[] {
  const sql = `
    SELECT
      w.*,
      u.discord_username as author_username,
      u.discord_display_name as author_display_name,
      u.discord_avatar as author_avatar,
      u.discord_id as author_discord_id,
      pv.id as pending_version_id,
      pv.version_no as pending_version_no,
      pv.title as pending_title,
      pv.description as pending_description,
      pv.content as pending_content,
      pv.tags as pending_tags,
      pv.cover_filename as pending_cover_filename,
      pv.card_link as pending_card_link,
      pv.file_type as pending_file_type,
      pv.created_at as pending_created_at
    FROM works w
    JOIN users u ON w.user_id = u.id
    LEFT JOIN work_versions pv ON pv.id = (
      SELECT vv.id FROM work_versions vv
      WHERE vv.work_id = w.id AND vv.status = 'pending'
      ORDER BY vv.version_no DESC
      LIMIT 1
    )
    ${where}
    ${orderBy}
  `;
  return getDb().prepare(sql).all(...params) as WorkWithAuthor[];
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
  const tx = getDb().transaction(() => {
    const now = currentIso();
    const result = getDb().prepare(`
      INSERT INTO works (
        user_id, last_version_no, title, description, type, content, tags, cover_filename,
        card_link, file_type, status, visibility, created_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'public', ?, ?)
    `).run(userId, title, description, type, content, JSON.stringify(tags), coverFilename, cardLink, fileType, now, now);
    const workId = result.lastInsertRowid as number;
    const version = getDb().prepare(`
      INSERT INTO work_versions (
        work_id, version_no, title, description, type, content, tags, cover_filename,
        card_link, file_type, status, created_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(workId, title, description, type, content, JSON.stringify(tags), coverFilename, cardLink, fileType, now, now);
    getDb().prepare('UPDATE works SET current_version_id = ? WHERE id = ?').run(version.lastInsertRowid, workId);
    return workId;
  });
  return tx();
}

export function createWorkVersion(
  work: DbWork,
  title: string,
  description: string,
  content: string,
  tags: string[],
  coverFilename?: string,
  cardLink?: string,
  fileType?: string,
): number {
  const tx = getDb().transaction(() => {
    const now = currentIso();
    const nextVersion = ((getDb().prepare('SELECT MAX(version_no) as n FROM work_versions WHERE work_id = ?').get(work.id) as { n: number | null }).n || 0) + 1;
    const finalCover = coverFilename !== undefined ? coverFilename : work.cover_filename;
    const finalCardLink = cardLink !== undefined ? cardLink : work.card_link;
    const finalFileType = fileType !== undefined ? fileType : work.file_type;
    const result = getDb().prepare(`
      INSERT INTO work_versions (
        work_id, version_no, title, description, type, content, tags, cover_filename,
        card_link, file_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(work.id, nextVersion, title, description, work.type, content, JSON.stringify(tags), finalCover, finalCardLink, finalFileType, now, now);

    if (work.status !== 'approved') {
      getDb().prepare(`
        UPDATE works
        SET current_version_id = ?, last_version_no = ?, title = ?, description = ?, content = ?, tags = ?,
            cover_filename = ?, card_link = ?, file_type = ?, status = 'pending', reject_reason = '', updated_at = ?
        WHERE id = ?
      `).run(result.lastInsertRowid, nextVersion, title, description, content, JSON.stringify(tags), finalCover, finalCardLink, finalFileType, now, work.id);
    } else {
      getDb().prepare('UPDATE works SET last_version_no = ?, updated_at = ? WHERE id = ?').run(nextVersion, now, work.id);
    }

    return result.lastInsertRowid as number;
  });
  return tx();
}

export function getApprovedWorks(
  page: number,
  pageSize: number,
  type?: string,
  search?: string,
  sort?: string,
  tag?: string,
): { works: WorkWithAuthor[]; total: number } {
  const whereParts = [`w.status = 'approved'`, `w.visibility = 'public'`];
  const params: unknown[] = [];

  if (type) {
    whereParts.push('w.type = ?');
    params.push(type);
  }
  if (search) {
    whereParts.push('(w.title LIKE ? OR w.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    whereParts.push('w.tags LIKE ?');
    params.push(`%"${tag}"%`);
  }

  const where = `WHERE ${whereParts.join(' AND ')}`;
  let orderBy = 'ORDER BY w.created_at DESC';
  if (sort === 'popular') orderBy = 'ORDER BY w.download_count DESC, w.favorite_count DESC, w.like_count DESC';
  if (sort === 'likes') orderBy = 'ORDER BY w.like_count DESC';

  const total = (getDb().prepare(`SELECT COUNT(*) as total FROM works w ${where}`).get(...params) as any).total;
  const works = selectWorkWithAuthor(where, [...params, pageSize, (page - 1) * pageSize], `${orderBy} LIMIT ? OFFSET ?`);
  return { works, total };
}

export function getWorkById(workId: number): WorkWithAuthor | undefined {
  return selectWorkWithAuthor('WHERE w.id = ?', [workId], '').at(0);
}

export function getUserWorks(userId: number): WorkWithAuthor[] {
  return selectWorkWithAuthor('WHERE w.user_id = ?', [userId], 'ORDER BY w.created_at DESC');
}

export function getPendingWorks(): WorkWithAuthor[] {
  return selectWorkWithAuthor(
    `WHERE EXISTS (SELECT 1 FROM work_versions v WHERE v.work_id = w.id AND v.status = 'pending')`,
    [],
    'ORDER BY COALESCE(pv.created_at, w.created_at) ASC',
  );
}

export function getAllWorksAdmin(status?: string, type?: string, visibility?: string): WorkWithAuthor[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push('w.status = ?');
    params.push(status);
  }
  if (type) {
    where.push('w.type = ?');
    params.push(type);
  }
  if (visibility) {
    where.push('w.visibility = ?');
    params.push(visibility);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return selectWorkWithAuthor(whereSql, params, 'ORDER BY w.created_at DESC');
}

export function searchWorksAdmin(options: AdminWorkSearchOptions): PageResult<WorkWithAuthor> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    where.push('w.status = ?');
    params.push(options.status);
  }
  if (options.type) {
    where.push('w.type = ?');
    params.push(options.type);
  }
  if (options.visibility) {
    where.push('w.visibility = ?');
    params.push(options.visibility);
  }
  if (options.userId) {
    where.push('w.user_id = ?');
    params.push(options.userId);
  }
  const q = options.q?.trim();
  if (q) {
    where.push(`(
      w.title LIKE ?
      OR w.description LIKE ?
      OR w.tags LIKE ?
      OR u.discord_username LIKE ?
      OR u.discord_display_name LIKE ?
      OR CAST(w.id AS TEXT) = ?
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pageParams(options.page, options.pageSize, 120);
  const total = (getDb().prepare(`
    SELECT COUNT(*) as c
    FROM works w
    JOIN users u ON w.user_id = u.id
    ${whereSql}
  `).get(...params) as { c: number }).c;
  const works = selectWorkWithAuthor(whereSql, [...params, pageSize, offset], 'ORDER BY w.created_at DESC, w.id DESC LIMIT ? OFFSET ?');
  return pageResult(works, total, page, pageSize);
}

export function getWorkVersion(versionId: number): VersionWithWork | undefined {
  return getDb().prepare(`
    SELECT v.*, w.title as work_title, w.visibility as work_visibility,
           u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM work_versions v
    JOIN works w ON w.id = v.work_id
    JOIN users u ON u.id = w.user_id
    WHERE v.id = ?
  `).get(versionId) as VersionWithWork | undefined;
}

export function getAllVersionsAdmin(status?: string, updateOnly?: boolean): VersionWithWork[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push('v.status = ?');
    params.push(status);
  }
  if (updateOnly !== undefined) {
    where.push(updateOnly ? 'v.version_no > 1' : 'v.version_no = 1');
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(`
    SELECT v.*, w.title as work_title, w.visibility as work_visibility,
           u.discord_username as author_username, u.discord_display_name as author_display_name,
           u.discord_avatar as author_avatar, u.discord_id as author_discord_id
    FROM work_versions v
    JOIN works w ON w.id = v.work_id
    JOIN users u ON u.id = w.user_id
    ${whereSql}
    ORDER BY v.created_at DESC
  `).all(...params) as VersionWithWork[];
}

function getLatestPendingVersion(workId: number): DbWorkVersion | undefined {
  return getDb().prepare(`
    SELECT * FROM work_versions
    WHERE work_id = ? AND status = 'pending'
    ORDER BY version_no DESC
    LIMIT 1
  `).get(workId) as DbWorkVersion | undefined;
}

export function approveWork(workId: number, reviewerId: number, versionId?: number): DbWorkVersion | undefined {
  const tx = getDb().transaction(() => {
    const version = versionId ? getDb().prepare('SELECT * FROM work_versions WHERE id = ?').get(versionId) as DbWorkVersion | undefined : getLatestPendingVersion(workId);
    if (!version) return undefined;
    const now = currentIso();
    getDb().prepare("UPDATE work_versions SET status = 'approved', reject_reason = '', reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?")
      .run(now, reviewerId, now, version.id);
    getDb().prepare(`
      UPDATE works
      SET current_version_id = ?, title = ?, description = ?, type = ?, content = ?, tags = ?,
          cover_filename = ?, card_link = ?, file_type = ?, status = 'approved', reject_reason = '',
          reviewed_at = ?, reviewed_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      version.id,
      version.title,
      version.description,
      version.type,
      version.content,
      version.tags,
      version.cover_filename,
      version.card_link,
      version.file_type,
      now,
      reviewerId,
      now,
      version.work_id,
    );
    return version;
  });
  return tx();
}

export function rejectWork(workId: number, reviewerId: number, reason: string, versionId?: number): DbWorkVersion | undefined {
  const tx = getDb().transaction(() => {
    const work = getDb().prepare('SELECT * FROM works WHERE id = ?').get(workId) as DbWork | undefined;
    const version = versionId ? getDb().prepare('SELECT * FROM work_versions WHERE id = ?').get(versionId) as DbWorkVersion | undefined : getLatestPendingVersion(workId);
    if (!work || !version) return undefined;
    const now = currentIso();
    getDb().prepare("UPDATE work_versions SET status = 'rejected', reject_reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?")
      .run(reason, now, reviewerId, now, version.id);
    if (work.status === 'approved' && work.current_version_id !== version.id) {
      getDb().prepare('UPDATE works SET reject_reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?')
        .run(reason, now, reviewerId, now, work.id);
    } else {
      getDb().prepare(`
        UPDATE works
        SET current_version_id = ?, title = ?, description = ?, type = ?, content = ?, tags = ?,
            cover_filename = ?, card_link = ?, file_type = ?, status = 'rejected', reject_reason = ?,
            reviewed_at = ?, reviewed_by = ?, updated_at = ?
        WHERE id = ?
      `).run(
        version.id,
        version.title,
        version.description,
        version.type,
        version.content,
        version.tags,
        version.cover_filename,
        version.card_link,
        version.file_type,
        reason,
        now,
        reviewerId,
        now,
        work.id,
      );
    }
    return version;
  });
  return tx();
}

export function hideWorkByAdmin(workId: number, adminId: number, reason: string): void {
  getDb().prepare("UPDATE works SET visibility = 'hidden', hidden_reason = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?")
    .run(reason, currentIso(), adminId, currentIso(), workId);
}

export function restoreWorkByAdmin(workId: number): void {
  getDb().prepare("UPDATE works SET visibility = 'public', hidden_reason = '', hidden_at = '', hidden_by = NULL, updated_at = ? WHERE id = ?")
    .run(currentIso(), workId);
}

export function softDeleteWorkByAuthor(workId: number, userId: number, reason: string = ''): boolean {
  const result = getDb().prepare(`
    UPDATE works
    SET visibility = 'author_deleted', author_deleted_at = ?, author_delete_reason = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(currentIso(), reason, currentIso(), workId, userId);
  return result.changes > 0;
}

export function deleteWork(workId: number): void {
  getDb().prepare('DELETE FROM works WHERE id = ?').run(workId);
}

export function getWorkFileNames(workId: number): string[] {
  const rows = getDb().prepare(`
    SELECT cover_filename, content, file_type FROM work_versions WHERE work_id = ?
    UNION ALL
    SELECT cover_filename, content, file_type FROM works WHERE id = ?
  `).all(workId, workId) as { cover_filename: string; content: string; file_type: string }[];
  const names = new Set<string>();
  for (const row of rows) {
    if (row.cover_filename) names.add(row.cover_filename);
    if (row.file_type === 'png' && row.content?.startsWith('__card_file__:')) {
      names.add(row.content.replace('__card_file__:', ''));
    }
  }
  return [...names];
}

export function incrementDownloadCount(workId: number): void {
  getDb().prepare('UPDATE works SET download_count = download_count + 1 WHERE id = ?').run(workId);
}

export function recordDownload(userId: number, workId: number, versionId: number | null, ip: string, userAgent: string): DbDownload {
  const tx = getDb().transaction(() => {
    const createdAt = currentIso();
    const inserted = getDb().prepare(`
      INSERT INTO downloads (
        user_id, work_id, work_version_id, fingerprint_token, fingerprint_payload,
        fingerprint_version, file_token, ip, user_agent, created_at
      ) VALUES (?, ?, ?, '', '', 'v1', '', ?, ?, ?)
    `).run(userId, workId, versionId, ip, userAgent, createdAt);
    const downloadId = inserted.lastInsertRowid as number;
    const nonce = createFingerprintNonce();
    const fingerprintInput = { downloadId, userId, workId, versionId, createdAt, nonce };
    const fingerprintToken = createFingerprintToken(fingerprintInput);
    const fileToken = createDownloadFileToken(downloadId, fingerprintToken);
    const payload = JSON.stringify({ ...fingerprintInput, fingerprintToken });
    getDb().prepare(`
      UPDATE downloads
      SET fingerprint_token = ?, fingerprint_payload = ?, fingerprint_version = 'v1', file_token = ?
      WHERE id = ?
    `).run(fingerprintToken, payload, fileToken, downloadId);
    const meta = getDb().prepare(`
      SELECT w.title as work_title, w.type as work_type, w.user_id as author_user_id,
             u.discord_username as downloader_username, u.discord_display_name as downloader_display_name, u.discord_id as downloader_discord_id,
             author.discord_username as author_username, author.discord_display_name as author_display_name
      FROM works w
      JOIN users u ON u.id = ?
      JOIN users author ON author.id = w.user_id
      WHERE w.id = ?
    `).get(userId, workId) as any;
    getDb().prepare(`
      INSERT OR REPLACE INTO download_fingerprints (
        fingerprint_token, fingerprint_payload, fingerprint_version, download_id, user_id,
        downloader_username, downloader_display_name, downloader_discord_id,
        work_id, work_version_id, work_title, work_type, author_user_id, author_username,
        author_display_name, ip, user_agent, created_at
      ) VALUES (?, ?, 'v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fingerprintToken,
      payload,
      downloadId,
      userId,
      meta?.downloader_username || '',
      meta?.downloader_display_name || '',
      meta?.downloader_discord_id || '',
      workId,
      versionId,
      meta?.work_title || '',
      meta?.work_type || '',
      meta?.author_user_id || null,
      meta?.author_username || '',
      meta?.author_display_name || '',
      ip,
      userAgent,
      createdAt,
    );
    return getDownloadById(downloadId)!;
  });
  return tx();
}

export function getDownloadById(downloadId: number): DbDownload | undefined {
  return getDb().prepare('SELECT * FROM downloads WHERE id = ?').get(downloadId) as DbDownload | undefined;
}

export function getDownloadFileRecord(downloadId: number, fileToken: string): any | undefined {
  return getDb().prepare(`
    SELECT d.*, w.title as work_title, w.type as work_type, w.file_type, w.content,
           author.discord_username as author_username, author.discord_display_name as author_display_name
    FROM downloads d
    JOIN works w ON w.id = d.work_id
    JOIN users author ON author.id = w.user_id
    WHERE d.id = ? AND d.file_token = ?
  `).get(downloadId, fileToken);
}

export function findDownloadByFingerprint(fingerprintToken: string): any | undefined {
  const archived = getDb().prepare(`
    SELECT
      fp.download_id as id,
      fp.download_id,
      fp.user_id,
      fp.work_id,
      fp.work_version_id,
      fp.fingerprint_token,
      fp.fingerprint_payload,
      fp.fingerprint_version,
      fp.ip,
      fp.user_agent,
      fp.created_at,
      fp.work_title,
      fp.work_type,
      COALESCE(w.status, '') as work_status,
      COALESCE(w.visibility, '') as work_visibility,
      fp.downloader_username as username,
      fp.downloader_display_name as display_name,
      fp.downloader_discord_id as discord_id,
      fp.author_username,
      fp.author_display_name,
      v.version_no as version_no
    FROM download_fingerprints fp
    LEFT JOIN works w ON w.id = fp.work_id
    LEFT JOIN work_versions v ON v.id = fp.work_version_id
    WHERE fp.fingerprint_token = ?
  `).get(fingerprintToken);
  if (archived) return archived;

  return getDb().prepare(`
    SELECT d.*, w.title as work_title, w.type as work_type, w.status as work_status, w.visibility as work_visibility,
           u.discord_username as username, u.discord_display_name as display_name, u.discord_id as discord_id,
           author.discord_username as author_username, author.discord_display_name as author_display_name,
           v.version_no as version_no
    FROM downloads d
    JOIN works w ON w.id = d.work_id
    JOIN users u ON u.id = d.user_id
    JOIN users author ON author.id = w.user_id
    LEFT JOIN work_versions v ON v.id = d.work_version_id
    WHERE d.fingerprint_token = ?
  `).get(fingerprintToken);
}

export function getDownloadsAdmin(limit: number = 300): any[] {
  return getDb().prepare(`
    SELECT d.*, w.title as work_title, w.type as work_type,
           u.discord_username as username, u.discord_display_name as display_name,
           author.discord_username as author_username, author.discord_display_name as author_display_name
    FROM downloads d
    JOIN works w ON w.id = d.work_id
    JOIN users u ON u.id = d.user_id
    JOIN users author ON author.id = w.user_id
    ORDER BY d.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function searchDownloadsAdmin(options: AdminActivitySearchOptions): PageResult<any> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.userId) {
    where.push('d.user_id = ?');
    params.push(options.userId);
  }
  if (options.workId) {
    where.push('d.work_id = ?');
    params.push(options.workId);
  }
  const q = options.q?.trim();
  if (q) {
    where.push(`(
      d.fingerprint_token LIKE ?
      OR w.title LIKE ?
      OR u.discord_username LIKE ?
      OR u.discord_display_name LIKE ?
      OR author.discord_username LIKE ?
      OR author.discord_display_name LIKE ?
      OR CAST(d.id AS TEXT) = ?
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pageParams(options.page, options.pageSize, 200);
  const total = (getDb().prepare(`
    SELECT COUNT(*) as c
    FROM downloads d
    JOIN works w ON w.id = d.work_id
    JOIN users u ON u.id = d.user_id
    JOIN users author ON author.id = w.user_id
    ${whereSql}
  `).get(...params) as { c: number }).c;
  const downloads = getDb().prepare(`
    SELECT d.*, w.title as work_title, w.type as work_type,
           u.discord_username as username, u.discord_display_name as display_name,
           author.discord_username as author_username, author.discord_display_name as author_display_name
    FROM downloads d
    JOIN works w ON w.id = d.work_id
    JOIN users u ON u.id = d.user_id
    JOIN users author ON author.id = w.user_id
    ${whereSql}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];
  return pageResult(downloads, total, page, pageSize);
}

export function getUserDownloads(userId: number): any[] {
  return getDb().prepare(`
    SELECT d.*, w.title, w.description, w.type, w.cover_filename, w.status, w.visibility,
           author.discord_username as author_username, author.discord_display_name as author_display_name
    FROM downloads d
    JOIN works w ON w.id = d.work_id
    JOIN users author ON author.id = w.user_id
    WHERE d.user_id = ?
    ORDER BY d.created_at DESC
  `).all(userId);
}

export function toggleLike(userId: number, workId: number): boolean {
  const existing = getDb().prepare('SELECT id FROM likes WHERE user_id = ? AND work_id = ?').get(userId, workId);
  if (existing) {
    getDb().prepare('DELETE FROM likes WHERE user_id = ? AND work_id = ?').run(userId, workId);
    getDb().prepare('UPDATE works SET like_count = like_count - 1 WHERE id = ? AND like_count > 0').run(workId);
    return false;
  }
  getDb().prepare('INSERT INTO likes (user_id, work_id, created_at) VALUES (?, ?, ?)').run(userId, workId, currentIso());
  getDb().prepare('UPDATE works SET like_count = like_count + 1 WHERE id = ?').run(workId);
  return true;
}

export function getUserLikedWorkIds(userId: number): number[] {
  const rows = getDb().prepare('SELECT work_id FROM likes WHERE user_id = ?').all(userId) as { work_id: number }[];
  return rows.map(r => r.work_id);
}

export function getLikesAdmin(limit: number = 300): any[] {
  return getDb().prepare(`
    SELECT l.*, w.title as work_title, w.type as work_type,
           u.discord_username as username, u.discord_display_name as display_name
    FROM likes l
    JOIN works w ON w.id = l.work_id
    JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function searchLikesAdmin(options: AdminActivitySearchOptions): PageResult<any> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.userId) {
    where.push('l.user_id = ?');
    params.push(options.userId);
  }
  if (options.workId) {
    where.push('l.work_id = ?');
    params.push(options.workId);
  }
  const q = options.q?.trim();
  if (q) {
    where.push('(w.title LIKE ? OR u.discord_username LIKE ? OR u.discord_display_name LIKE ? OR CAST(l.id AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pageParams(options.page, options.pageSize, 200);
  const total = (getDb().prepare(`
    SELECT COUNT(*) as c
    FROM likes l
    JOIN works w ON w.id = l.work_id
    JOIN users u ON u.id = l.user_id
    ${whereSql}
  `).get(...params) as { c: number }).c;
  const likes = getDb().prepare(`
    SELECT l.*, w.title as work_title, w.type as work_type,
           u.discord_username as username, u.discord_display_name as display_name
    FROM likes l
    JOIN works w ON w.id = l.work_id
    JOIN users u ON u.id = l.user_id
    ${whereSql}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];
  return pageResult(likes, total, page, pageSize);
}

export function toggleFavorite(userId: number, workId: number): boolean {
  const existing = getDb().prepare('SELECT id FROM favorites WHERE user_id = ? AND work_id = ?').get(userId, workId);
  if (existing) {
    getDb().prepare('DELETE FROM favorites WHERE user_id = ? AND work_id = ?').run(userId, workId);
    getDb().prepare('UPDATE works SET favorite_count = favorite_count - 1 WHERE id = ? AND favorite_count > 0').run(workId);
    return false;
  }
  getDb().prepare('INSERT INTO favorites (user_id, work_id, created_at) VALUES (?, ?, ?)').run(userId, workId, currentIso());
  getDb().prepare('UPDATE works SET favorite_count = favorite_count + 1 WHERE id = ?').run(workId);
  return true;
}

export function getUserFavoriteWorkIds(userId: number): number[] {
  const rows = getDb().prepare('SELECT work_id FROM favorites WHERE user_id = ?').all(userId) as { work_id: number }[];
  return rows.map(r => r.work_id);
}

export function getFavoritesAdmin(limit: number = 300): any[] {
  return getDb().prepare(`
    SELECT f.*, w.title as work_title, w.type as work_type,
           u.discord_username as username, u.discord_display_name as display_name
    FROM favorites f
    JOIN works w ON w.id = f.work_id
    JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function searchFavoritesAdmin(options: AdminActivitySearchOptions): PageResult<any> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.userId) {
    where.push('f.user_id = ?');
    params.push(options.userId);
  }
  if (options.workId) {
    where.push('f.work_id = ?');
    params.push(options.workId);
  }
  const q = options.q?.trim();
  if (q) {
    where.push('(w.title LIKE ? OR u.discord_username LIKE ? OR u.discord_display_name LIKE ? OR CAST(f.id AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pageParams(options.page, options.pageSize, 200);
  const total = (getDb().prepare(`
    SELECT COUNT(*) as c
    FROM favorites f
    JOIN works w ON w.id = f.work_id
    JOIN users u ON u.id = f.user_id
    ${whereSql}
  `).get(...params) as { c: number }).c;
  const favorites = getDb().prepare(`
    SELECT f.*, w.title as work_title, w.type as work_type,
           u.discord_username as username, u.discord_display_name as display_name
    FROM favorites f
    JOIN works w ON w.id = f.work_id
    JOIN users u ON u.id = f.user_id
    ${whereSql}
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];
  return pageResult(favorites, total, page, pageSize);
}

export function getUserFavorites(userId: number): any[] {
  return getDb().prepare(`
    SELECT f.*, w.title, w.description, w.type, w.cover_filename, w.status, w.visibility,
           author.discord_username as author_username, author.discord_display_name as author_display_name
    FROM favorites f
    JOIN works w ON w.id = f.work_id
    JOIN users author ON author.id = w.user_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);
}

export function createComment(workId: number, userId: number, content: string): number {
  const now = currentIso();
  const result = getDb().prepare('INSERT INTO comments (work_id, user_id, content, status, created_at, updated_at) VALUES (?, ?, ?, \'visible\', ?, ?)')
    .run(workId, userId, content, now, now);
  getDb().prepare('UPDATE works SET comment_count = comment_count + 1 WHERE id = ?').run(workId);
  return result.lastInsertRowid as number;
}

export function updateComment(commentId: number, userId: number, content: string): boolean {
  const result = getDb().prepare("UPDATE comments SET content = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'visible'")
    .run(content, currentIso(), commentId, userId);
  return result.changes > 0;
}

export function getCommentById(commentId: number): DbComment | undefined {
  return getDb().prepare(`
    SELECT c.*, u.discord_username as username, u.discord_display_name as display_name, u.discord_avatar as avatar,
           w.title as work_title, w.user_id as work_author_id
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN works w ON w.id = c.work_id
    WHERE c.id = ?
  `).get(commentId) as DbComment | undefined;
}

export function getWorkComments(workId: number, includeHidden: boolean = false): DbComment[] {
  const where = includeHidden ? 'c.work_id = ?' : "c.work_id = ? AND c.status = 'visible'";
  return getDb().prepare(`
    SELECT c.*, u.discord_username as username, u.discord_display_name as display_name, u.discord_avatar as avatar
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE ${where}
    ORDER BY c.created_at ASC
  `).all(workId) as DbComment[];
}

export function getAllCommentsAdmin(status?: string): DbComment[] {
  const where = status ? 'WHERE c.status = ?' : '';
  const params = status ? [status] : [];
  return getDb().prepare(`
    SELECT c.*, u.discord_username as username, u.discord_display_name as display_name, u.discord_avatar as avatar,
           w.title as work_title, w.user_id as work_author_id
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN works w ON w.id = c.work_id
    ${where}
    ORDER BY c.created_at DESC
  `).all(...params) as DbComment[];
}

export function searchCommentsAdmin(options: AdminCommentSearchOptions): PageResult<DbComment> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    where.push('c.status = ?');
    params.push(options.status);
  }
  if (options.workId) {
    where.push('c.work_id = ?');
    params.push(options.workId);
  }
  if (options.userId) {
    where.push('c.user_id = ?');
    params.push(options.userId);
  }
  const q = options.q?.trim();
  if (q) {
    where.push(`(
      c.content LIKE ?
      OR w.title LIKE ?
      OR u.discord_username LIKE ?
      OR u.discord_display_name LIKE ?
      OR CAST(c.id AS TEXT) = ?
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = pageParams(options.page, options.pageSize, 200);
  const total = (getDb().prepare(`
    SELECT COUNT(*) as c
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN works w ON w.id = c.work_id
    ${whereSql}
  `).get(...params) as { c: number }).c;
  const comments = getDb().prepare(`
    SELECT c.*, u.discord_username as username, u.discord_display_name as display_name, u.discord_avatar as avatar,
           w.title as work_title, w.user_id as work_author_id
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN works w ON w.id = c.work_id
    ${whereSql}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as DbComment[];
  return pageResult(comments, total, page, pageSize);
}

export function hideComment(commentId: number, byUserId: number, role: 'author' | 'admin' | 'user', reason: string): boolean {
  const comment = getCommentById(commentId);
  if (!comment || comment.status !== 'visible') return false;
  const now = currentIso();
  getDb().prepare(`
    UPDATE comments
    SET status = ?, hidden_reason = ?, hidden_by = ?, hidden_by_role = ?, hidden_at = ?, updated_at = ?
    WHERE id = ?
  `).run(role === 'user' ? 'deleted' : 'hidden', reason, byUserId, role, now, now, commentId);
  getDb().prepare('UPDATE works SET comment_count = comment_count - 1 WHERE id = ? AND comment_count > 0').run(comment.work_id);
  return true;
}

export function deleteCommentByAdmin(commentId: number): boolean {
  const result = getDb().prepare('DELETE FROM comments WHERE id = ?').run(commentId);
  refreshAllCounters();
  return result.changes > 0;
}

export function getStats(): {
  totalUsers: number; totalWorks: number; pendingWorks: number; hiddenWorks: number; authorDeletedWorks: number; todayUploads: number;
  totalDownloads: number; totalFavorites: number; totalComments: number;
  pendingByType: Record<string, number>;
  approvedByType: Record<string, number>;
} {
  const totalUsers = (getDb().prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const totalWorks = (getDb().prepare("SELECT COUNT(*) as c FROM works WHERE status = 'approved' AND visibility = 'public'").get() as any).c;
  const pendingWorks = (getDb().prepare("SELECT COUNT(*) as c FROM work_versions WHERE status = 'pending'").get() as any).c;
  const hiddenWorks = (getDb().prepare("SELECT COUNT(*) as c FROM works WHERE visibility = 'hidden'").get() as any).c;
  const authorDeletedWorks = (getDb().prepare("SELECT COUNT(*) as c FROM works WHERE visibility = 'author_deleted'").get() as any).c;
  const todayUploads = (getDb().prepare("SELECT COUNT(*) as c FROM work_versions WHERE substr(created_at, 1, 10) = substr(datetime('now'), 1, 10)").get() as any).c;
  const totalDownloads = (getDb().prepare('SELECT COUNT(*) as c FROM downloads').get() as any).c;
  const totalFavorites = (getDb().prepare('SELECT COUNT(*) as c FROM favorites').get() as any).c;
  const totalComments = (getDb().prepare('SELECT COUNT(*) as c FROM comments').get() as any).c;

  const pendingByTypeRows = getDb().prepare("SELECT type, COUNT(*) as c FROM work_versions WHERE status = 'pending' GROUP BY type").all() as { type: string; c: number }[];
  const pendingByType: Record<string, number> = {};
  for (const row of pendingByTypeRows) pendingByType[row.type] = row.c;

  const approvedByTypeRows = getDb().prepare("SELECT type, COUNT(*) as c FROM works WHERE status = 'approved' AND visibility = 'public' GROUP BY type").all() as { type: string; c: number }[];
  const approvedByType: Record<string, number> = {};
  for (const row of approvedByTypeRows) approvedByType[row.type] = row.c;

  return { totalUsers, totalWorks, pendingWorks, hiddenWorks, authorDeletedWorks, todayUploads, totalDownloads, totalFavorites, totalComments, pendingByType, approvedByType };
}

export function getAllTags(): string[] {
  const rows = getDb().prepare("SELECT DISTINCT tags FROM works WHERE status = 'approved' AND visibility = 'public'").all() as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of rows) {
    parseTags(row.tags).forEach(t => {
      if (typeof t === 'string' && t.trim()) tagSet.add(t.trim());
    });
  }
  return [...tagSet].sort();
}
