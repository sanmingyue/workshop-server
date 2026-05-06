import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getOptionalUser, requireAuth } from '../auth/middleware';
import { recordAuditLog } from '../audit';
import {
  createWork, getApprovedWorks, getWorkById, getUserWorks,
  updateWork, deleteWork, incrementDownloadCount,
  toggleLike, getUserLikedWorkIds, getAllTags,
} from '../database';

const router = Router();

// ─── 封面图上传配置 ───
const uploadsDir = path.join(config.dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB（角色卡 PNG 可能较大）
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PNG/JPG/GIF/WebP 格式的图片'));
    }
  },
});

// ─── 有效的作品类型 ───
const VALID_TYPES = ['regex', 'persona', 'card_addon', 'worldbook', 'collection'];

/** GET /api/works - 获取已审核通过的作品列表 */
router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.page_size as string) || 12));
  const type = req.query.type as string | undefined;
  const search = req.query.search as string | undefined;
  const sort = req.query.sort as string | undefined;
  const tag = req.query.tag as string | undefined;

  const result = getApprovedWorks(page, pageSize, type, search, sort, tag);

  // 如果有登录用户，附带点赞状态
  let likedIds: number[] = [];
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const { findSession } = require('../database');
      const session = findSession(token);
      if (session) {
        likedIds = getUserLikedWorkIds(session.user_id);
      }
    } catch { /* ignore */ }
  }

  const likedSet = new Set(likedIds);

  res.json({
    works: result.works.map(w => ({
      id: w.id,
      title: w.title,
      description: w.description,
      type: w.type,
      tags: JSON.parse(w.tags || '[]'),
      cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
      author: {
        username: w.author_username,
        display_name: w.author_display_name,
        avatar: w.author_avatar,
      },
      download_count: w.download_count,
      like_count: w.like_count,
      liked: likedSet.has(w.id),
      created_at: w.created_at,
    })),
    total: result.total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(result.total / pageSize),
  });
});

/** GET /api/works/tags - 获取所有已用标签 */
router.get('/tags', (_req: Request, res: Response) => {
  res.json({ tags: getAllTags() });
});

/** GET /api/works/:id - 获取单个作品详情 */
router.get('/:id', (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) {
    res.status(404).json({ error: '作品不存在' });
    return;
  }

  // 非已审核的作品只有作者和管理员能看
  if (work.status !== 'approved') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(404).json({ error: '作品不存在' });
      return;
    }
    try {
      const { findSession, getDb, isAdmin } = require('../database');
      const session = findSession(token);
      if (!session) { res.status(404).json({ error: '作品不存在' }); return; }
      const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
      if (!user || (user.id !== work.user_id && !isAdmin(user))) {
        res.status(404).json({ error: '作品不存在' });
        return;
      }
    } catch {
      res.status(404).json({ error: '作品不存在' });
      return;
    }
  }

  res.json({
    id: work.id,
    title: work.title,
    description: work.description,
    type: work.type,
    content: work.content,
    tags: JSON.parse(work.tags || '[]'),
    cover_url: work.cover_filename ? `${config.baseUrl}/uploads/${work.cover_filename}` : null,
    card_link: work.card_link || '',
    file_type: work.file_type || 'json',
    status: work.status,
    reject_reason: work.reject_reason,
    author: {
      username: work.author_username,
      display_name: work.author_display_name,
      avatar: work.author_avatar,
      discord_id: work.author_discord_id,
    },
    download_count: work.download_count,
    like_count: work.like_count,
    created_at: work.created_at,
    updated_at: work.updated_at,
  });
});

/** POST /api/works - 上传新作品 */
router.post('/', requireAuth, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'card_file', maxCount: 1 },
]), (req: Request, res: Response) => {
  const { title, description, type, content, tags, card_link, file_type, disclaimer_agreed } = req.body;
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

  if (!title || !title.trim()) {
    res.status(400).json({ error: '标题不能为空' });
    return;
  }

  if (!type || !VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `无效的类型，支持: ${VALID_TYPES.join(', ')}` });
    return;
  }

  // card_addon 类型必须填写角色卡链接
  if (type === 'card_addon' && (!card_link || !card_link.trim())) {
    res.status(400).json({ error: '角色卡配套类型必须填写角色卡链接' });
    return;
  }

  // collection 类型必须同意免责声明
  if (type === 'collection' && disclaimer_agreed !== 'true') {
    res.status(400).json({ error: '作者合集类型需要同意授权声明' });
    return;
  }

  // collection 类型使用上传的 PNG 文件作为内容
  let finalContent = content || '';
  let finalFileType = file_type || 'json';

  if (type === 'collection') {
    const cardFile = files?.card_file?.[0];
    if (!cardFile) {
      res.status(400).json({ error: '作者合集类型必须上传角色卡 PNG 文件' });
      return;
    }
    // 存储角色卡文件名，content 存储文件路径引用
    finalContent = `__card_file__:${cardFile.filename}`;
    finalFileType = 'png';
  } else {
    if (!finalContent || !finalContent.trim()) {
      res.status(400).json({ error: '内容不能为空' });
      return;
    }

    if (Buffer.byteLength(finalContent, 'utf8') > config.maxContentSize) {
      res.status(400).json({ error: '内容过大，最大 1MB' });
      return;
    }
  }

  let parsedTags: string[] = [];
  if (tags) {
    try {
      parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      if (!Array.isArray(parsedTags)) parsedTags = [];
      parsedTags = parsedTags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim());
    } catch {
      parsedTags = [];
    }
  }

  const coverFilename = files?.cover?.[0]?.filename || '';

  const workId = createWork(
    req.user!.id,
    title.trim(),
    (description || '').trim(),
    type,
    finalContent,
    parsedTags,
    coverFilename,
    (card_link || '').trim(),
    finalFileType,
  );

  recordAuditLog({
    req,
    category: 'work',
    action: 'work_created',
    entityType: 'work',
    entityId: workId,
    detail: {
      title: title.trim(),
      type,
      tags: parsedTags,
      file_type: finalFileType,
      has_cover: !!coverFilename,
    },
  });

  res.status(201).json({ id: workId, message: '作品已提交，等待审核' });
});

/** PUT /api/works/:id - 修改自己的作品 */
router.put('/:id', requireAuth, upload.single('cover'), (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.user_id !== req.user!.id) {
    res.status(404).json({ error: '作品不存在或无权修改' });
    return;
  }

  const { title, description, content, tags } = req.body;

  let parsedTags: string[] = JSON.parse(work.tags || '[]');
  if (tags) {
    try {
      parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      if (!Array.isArray(parsedTags)) parsedTags = [];
      parsedTags = parsedTags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim());
    } catch { /* keep original */ }
  }

  updateWork(
    work.id,
    (title || work.title).trim(),
    (description ?? work.description).trim(),
    (content || work.content),
    parsedTags,
    req.file?.filename,
  );

  // 修改后重新进入待审核
  const { getDb } = require('../database');
  getDb().prepare(`UPDATE works SET status = 'pending', reject_reason = '' WHERE id = ?`).run(work.id);

  recordAuditLog({
    req,
    category: 'work',
    action: 'work_updated',
    entityType: 'work',
    entityId: work.id,
    detail: {
      title: (title || work.title).trim(),
      type: work.type,
      status: 'pending',
      has_new_cover: !!req.file?.filename,
    },
  });

  res.json({ message: '作品已更新，重新等待审核' });
});

/** DELETE /api/works/:id - 删除自己的作品 */
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.user_id !== req.user!.id) {
    res.status(404).json({ error: '作品不存在或无权删除' });
    return;
  }

  // 删除封面文件
  if (work.cover_filename) {
    const coverPath = path.join(uploadsDir, work.cover_filename);
    if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
  }

  deleteWork(work.id);
  recordAuditLog({
    req,
    category: 'work',
    action: 'work_deleted',
    entityType: 'work',
    entityId: work.id,
    detail: { title: work.title, type: work.type },
  });
  res.json({ message: '作品已删除' });
});

/** POST /api/works/:id/like - 点赞/取消点赞 */
router.post('/:id/like', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.status !== 'approved') {
    res.status(404).json({ error: '作品不存在' });
    return;
  }

  const liked = toggleLike(req.user!.id, work.id);
  const updatedWork = getWorkById(work.id)!;

  recordAuditLog({
    req,
    category: 'work',
    action: liked ? 'work_liked' : 'work_unliked',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { title: work.title, type: work.type },
  });

  res.json({ liked, like_count: updatedWork.like_count });
});

/** GET /api/works/:id/download - 下载作品内容 */
router.get('/:id/download', (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.status !== 'approved') {
    res.status(404).json({ error: '作品不存在' });
    return;
  }

  incrementDownloadCount(work.id);
  const actor = getOptionalUser(req);
  recordAuditLog({
    req,
    actor,
    userId: actor?.id ?? null,
    targetUserId: work.user_id,
    category: 'work',
    action: 'work_downloaded',
    entityType: 'work',
    entityId: work.id,
    detail: {
      title: work.title,
      type: work.type,
      file_type: work.file_type || 'json',
    },
  });

  // collection 类型（PNG 角色卡）返回文件 URL
  if (work.file_type === 'png' && work.content.startsWith('__card_file__:')) {
    const filename = work.content.replace('__card_file__:', '');
    res.json({
      id: work.id,
      title: work.title,
      type: work.type,
      content: '',
      file_url: `${config.baseUrl}/uploads/${filename}`,
      file_type: 'png',
      card_link: work.card_link || '',
      author_name: work.author_display_name || work.author_username,
    });
    return;
  }

  res.json({
    id: work.id,
    title: work.title,
    type: work.type,
    content: work.content,
    file_type: work.file_type || 'json',
    card_link: work.card_link || '',
    author_name: work.author_display_name || work.author_username,
  });
});

/** GET /api/my/works - 获取自己上传的所有作品 */
router.get('/my/works', requireAuth, (req: Request, res: Response) => {
  // 注意: 这个路由因为路径含 /my/works 需要放在正确位置
  // 但 Express 的 router 会按注册顺序匹配，所以将在 index.ts 中单独挂载
  res.status(500).json({ error: '路由配置错误' });
});

export default router;
