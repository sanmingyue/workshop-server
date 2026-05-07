import express from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { initDatabase, cleanExpiredSessions, getUserDownloads, getUserFavorites, getUserWorks } from './database';
import { requireAuth } from './auth/middleware';
import authRoutes from './routes/auth';
import worksRoutes from './routes/works';
import adminRoutes from './routes/admin';
import onlineRoutes from './routes/online';

// ─── 初始化 ───
const app = express();
initDatabase();

// ─── 中间件 ───
app.use(cors({
  origin: true, // 允许所有来源（酒馆脚本需要跨域访问）
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 频率限制
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 60, // 每分钟最多60次
  message: { error: '请求过于频繁，请稍后再试' },
});
app.use('/api', apiLimiter);

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 上传每分钟最多10次
  message: { error: '上传过于频繁，请稍后再试' },
});
app.use('/api/works', (req, _res, next) => {
  if (req.method === 'POST') return uploadLimiter(req, _res, next);
  next();
});

// 静态文件：封面图
const uploadsDir = path.join(config.dataDir, 'uploads');
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));

// ─── 路由 ───
app.use('/auth', authRoutes);
app.use('/api/works', worksRoutes);
app.use('/api/online', onlineRoutes);
app.use('/admin', adminRoutes);

// 「我的作品」单独挂载（避免与 /api/works/:id 冲突）
app.get('/api/my/works', requireAuth, (req, res) => {
  const works = getUserWorks(req.user!.id);
  res.json({
    works: works.map(w => ({
      id: w.id,
      title: w.title,
      char_name: w.char_name || '',
      description: w.description,
      type: w.type,
      tags: JSON.parse(w.tags || '[]'),
      cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
      card_link: w.card_link || '',
      file_type: w.file_type || 'json',
      status: w.status,
      visibility: w.visibility,
      hidden_reason: w.hidden_reason || '',
      author_delete_reason: w.author_delete_reason || '',
      reject_reason: w.reject_reason,
      pending_update: !!w.pending_version_id,
      pending_version_id: w.pending_version_id || null,
      pending_version_no: w.pending_version_no || null,
      download_count: w.download_count,
      like_count: w.like_count,
      favorite_count: w.favorite_count || 0,
      comment_count: w.comment_count || 0,
      created_at: w.created_at,
      updated_at: w.updated_at,
    })),
  });
});

app.get('/api/my/downloads', requireAuth, (req, res) => {
  res.json({
    downloads: getUserDownloads(req.user!.id).map(w => ({
      id: w.id,
      work_id: w.work_id,
      title: w.title,
      char_name: w.char_name || '',
      description: w.description || '',
      type: w.type,
      tags: JSON.parse(w.tags || '[]'),
      cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
      card_link: w.card_link || '',
      file_type: w.file_type || 'json',
      status: w.status,
      visibility: w.visibility,
      download_count: w.download_count || 0,
      like_count: w.like_count || 0,
      favorite_count: w.favorite_count || 0,
      comment_count: w.comment_count || 0,
      fingerprint_token: w.fingerprint_token || '',
      downloaded_at: w.created_at,
      author: {
        username: w.author_username,
        display_name: w.author_display_name,
      },
    })),
  });
});

app.get('/api/my/favorites', requireAuth, (req, res) => {
  res.json({
    favorites: getUserFavorites(req.user!.id).map(w => ({
      id: w.id,
      work_id: w.work_id,
      title: w.title,
      char_name: w.char_name || '',
      description: w.description || '',
      type: w.type,
      tags: JSON.parse(w.tags || '[]'),
      cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
      card_link: w.card_link || '',
      file_type: w.file_type || 'json',
      status: w.status,
      visibility: w.visibility,
      download_count: w.download_count || 0,
      like_count: w.like_count || 0,
      favorite_count: w.favorite_count || 0,
      comment_count: w.comment_count || 0,
      favorited_at: w.created_at,
      author: {
        username: w.author_username,
        display_name: w.author_display_name,
      },
    })),
  });
});

// ─── 健康检查 ───
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    base_url: config.baseUrl,
    has_client_id: !!config.discord.clientId,
    port: config.port,
  });
});

// ─── 定期清理过期会话 ───
setInterval(cleanExpiredSessions, 3600 * 1000); // 每小时清理一次

// ─── 启动服务 ───
app.listen(config.port, '0.0.0.0', () => {
  console.log(`[Workshop] 创意工坊后端已启动: http://localhost:${config.port}`);
  console.log(`[Workshop] 管理后台: ${config.baseUrl}/admin`);
  console.log(`[Workshop] Discord 回调: ${config.discord.redirectUri}`);
  console.log(`[Workshop] 允许的服务器: ${config.discord.guildIds.join(', ') || '未限制'}`);
  console.log(`[Workshop] 管理员 Discord ID: ${config.adminDiscordIds.join(', ') || '未设置'}`);
});
