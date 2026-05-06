import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getOptionalUser, requireAuth } from '../auth/middleware';
import { recordAuditLog } from '../audit';
import {
  createComment,
  createWork,
  createWorkVersion,
  getApprovedWorks,
  getCommentById,
  getUserFavoriteWorkIds,
  getUserLikedWorkIds,
  getWorkById,
  getWorkComments,
  hideComment,
  incrementDownloadCount,
  recordDownload,
  softDeleteWorkByAuthor,
  toggleFavorite,
  toggleLike,
  updateComment,
  getAllTags,
  type DbUser,
  type WorkWithAuthor,
} from '../database';

const router = Router();

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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('只支持 PNG/JPG/GIF/WebP 格式的图片'));
  },
});

const VALID_TYPES = ['regex', 'persona', 'card_addon', 'worldbook', 'collection'];

function requestIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(',')[0].trim();
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function isPublicWork(work: WorkWithAuthor): boolean {
  return work.status === 'approved' && work.visibility === 'public';
}

function canViewWork(work: WorkWithAuthor, user?: DbUser): boolean {
  if (isPublicWork(work)) return true;
  return !!user && user.id === work.user_id;
}

function parseTags(tags: unknown): string[] {
  if (!tags) return [];
  try {
    const parsed = typeof tags === 'string' ? JSON.parse(tags) : tags;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim());
  } catch {
    return [];
  }
}

function publicWorkPayload(w: WorkWithAuthor, likedSet = new Set<number>(), favoriteSet = new Set<number>()) {
  return {
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
    favorite_count: w.favorite_count || 0,
    comment_count: w.comment_count || 0,
    liked: likedSet.has(w.id),
    favorited: favoriteSet.has(w.id),
    created_at: w.created_at,
  };
}

router.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.page_size as string) || 12));
  const type = req.query.type as string | undefined;
  const search = req.query.search as string | undefined;
  const sort = req.query.sort as string | undefined;
  const tag = req.query.tag as string | undefined;
  const result = getApprovedWorks(page, pageSize, type, search, sort, tag);

  const user = getOptionalUser(req);
  const likedSet = new Set(user ? getUserLikedWorkIds(user.id) : []);
  const favoriteSet = new Set(user ? getUserFavoriteWorkIds(user.id) : []);

  res.json({
    works: result.works.map(w => publicWorkPayload(w, likedSet, favoriteSet)),
    total: result.total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(result.total / pageSize),
  });
});

router.get('/tags', (_req: Request, res: Response) => {
  res.json({ tags: getAllTags() });
});

router.get('/:id/comments', (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const user = getOptionalUser(req);
  if (!canViewWork(work, user)) { res.status(404).json({ error: '作品不存在' }); return; }
  const includeHidden = !!user && user.id === work.user_id;
  res.json({
    comments: getWorkComments(work.id, includeHidden).map(c => ({
      id: c.id,
      work_id: c.work_id,
      content: c.content,
      status: c.status,
      hidden_reason: includeHidden ? c.hidden_reason : '',
      hidden_by_role: includeHidden ? c.hidden_by_role : '',
      author: {
        id: c.user_id,
        username: c.username,
        display_name: c.display_name,
        avatar: c.avatar,
      },
      created_at: c.created_at,
      updated_at: c.updated_at,
    })),
  });
});

router.post('/:id/comments', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || !isPublicWork(work)) { res.status(404).json({ error: '作品不存在' }); return; }
  const content = String(req.body.content || '').trim();
  if (!content) { res.status(400).json({ error: '评论不能为空' }); return; }
  if (content.length > 1000) { res.status(400).json({ error: '评论最多1000字' }); return; }
  const commentId = createComment(work.id, req.user!.id, content);
  recordAuditLog({
    req,
    category: 'comment',
    action: 'comment_created',
    entityType: 'comment',
    entityId: commentId,
    targetUserId: work.user_id,
    detail: { 作品: work.title, 评论内容: content },
  });
  res.status(201).json({ id: commentId, message: '评论已发布' });
});

router.put('/comments/:id', requireAuth, (req: Request, res: Response) => {
  const commentId = parseInt(req.params.id as string);
  const content = String(req.body.content || '').trim();
  if (!content) { res.status(400).json({ error: '评论不能为空' }); return; }
  if (content.length > 1000) { res.status(400).json({ error: '评论最多1000字' }); return; }
  const comment = getCommentById(commentId);
  if (!comment || comment.user_id !== req.user!.id) { res.status(404).json({ error: '评论不存在或无权修改' }); return; }
  if (!updateComment(commentId, req.user!.id, content)) { res.status(400).json({ error: '评论无法修改' }); return; }
  recordAuditLog({
    req,
    category: 'comment',
    action: 'comment_edited',
    entityType: 'comment',
    entityId: commentId,
    detail: { 作品: comment.work_title || '', 评论内容: content },
  });
  res.json({ message: '评论已更新' });
});

router.delete('/comments/:id', requireAuth, (req: Request, res: Response) => {
  const commentId = parseInt(req.params.id as string);
  const comment = getCommentById(commentId);
  if (!comment) { res.status(404).json({ error: '评论不存在' }); return; }

  if (comment.user_id === req.user!.id) {
    hideComment(commentId, req.user!.id, 'user', '用户删除自己的评论');
    recordAuditLog({
      req,
      category: 'comment',
      action: 'comment_deleted_by_user',
      entityType: 'comment',
      entityId: commentId,
      detail: { 作品: comment.work_title || '' },
    });
    res.json({ message: '评论已删除' });
    return;
  }

  if (comment.work_author_id === req.user!.id) {
    const reason = String(req.body.reason || '作者隐藏评论').trim();
    hideComment(commentId, req.user!.id, 'author', reason);
    recordAuditLog({
      req,
      category: 'comment',
      action: 'comment_hidden_by_author',
      entityType: 'comment',
      entityId: commentId,
      targetUserId: comment.user_id,
      detail: { 作品: comment.work_title || '', 理由: reason },
    });
    res.json({ message: '评论已隐藏' });
    return;
  }

  res.status(403).json({ error: '无权处理该评论' });
});

router.get('/:id', (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work) { res.status(404).json({ error: '作品不存在' }); return; }
  const user = getOptionalUser(req);
  if (!canViewWork(work, user)) { res.status(404).json({ error: '作品不存在' }); return; }
  const liked = user ? getUserLikedWorkIds(user.id).includes(work.id) : false;
  const favorited = user ? getUserFavoriteWorkIds(user.id).includes(work.id) : false;

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
    visibility: work.visibility,
    hidden_reason: user?.id === work.user_id ? work.hidden_reason : '',
    author_delete_reason: user?.id === work.user_id ? work.author_delete_reason : '',
    reject_reason: user?.id === work.user_id ? work.reject_reason : '',
    pending_update: user?.id === work.user_id && !!work.pending_version_id,
    pending_version_no: user?.id === work.user_id ? work.pending_version_no : null,
    author: {
      username: work.author_username,
      display_name: work.author_display_name,
      avatar: work.author_avatar,
      discord_id: work.author_discord_id,
    },
    download_count: work.download_count,
    like_count: work.like_count,
    favorite_count: work.favorite_count || 0,
    comment_count: work.comment_count || 0,
    liked,
    favorited,
    created_at: work.created_at,
    updated_at: work.updated_at,
  });
});

router.post('/', requireAuth, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'card_file', maxCount: 1 },
]), (req: Request, res: Response) => {
  const { title, description, type, content, tags, card_link, file_type, disclaimer_agreed } = req.body;
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

  if (!title || !title.trim()) { res.status(400).json({ error: '标题不能为空' }); return; }
  if (!type || !VALID_TYPES.includes(type)) { res.status(400).json({ error: `无效的类型，支持: ${VALID_TYPES.join(', ')}` }); return; }
  if (type === 'card_addon' && (!card_link || !card_link.trim())) { res.status(400).json({ error: '角色卡配套类型必须填写角色卡链接' }); return; }
  if (type === 'collection' && disclaimer_agreed !== 'true') { res.status(400).json({ error: '作者合集类型需要同意授权声明' }); return; }

  let finalContent = content || '';
  let finalFileType = file_type || 'json';
  if (type === 'collection') {
    const cardFile = files?.card_file?.[0];
    if (!cardFile) { res.status(400).json({ error: '作者合集类型必须上传角色卡 PNG 文件' }); return; }
    finalContent = `__card_file__:${cardFile.filename}`;
    finalFileType = 'png';
  } else {
    if (!finalContent || !finalContent.trim()) { res.status(400).json({ error: '内容不能为空' }); return; }
    if (Buffer.byteLength(finalContent, 'utf8') > config.maxContentSize) { res.status(400).json({ error: '内容过大，最大 1MB' }); return; }
  }

  const parsedTags = parseTags(tags);
  const coverFilename = files?.cover?.[0]?.filename || '';
  const workId = createWork(req.user!.id, title.trim(), (description || '').trim(), type, finalContent, parsedTags, coverFilename, (card_link || '').trim(), finalFileType);

  recordAuditLog({
    req,
    category: 'work',
    action: 'work_created',
    entityType: 'work',
    entityId: workId,
    detail: { 作品标题: title.trim(), 类型: type, 标签: parsedTags, 文件类型: finalFileType, 是否有封面: !!coverFilename },
  });
  res.status(201).json({ id: workId, message: '作品已提交，等待审核' });
});

router.put('/:id', requireAuth, upload.single('cover'), (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.user_id !== req.user!.id) { res.status(404).json({ error: '作品不存在或无权修改' }); return; }
  if (work.visibility === 'author_deleted') { res.status(400).json({ error: '已删除作品不能继续更新' }); return; }

  const { title, description, content, tags } = req.body;
  const parsedTags = tags ? parseTags(tags) : JSON.parse(work.tags || '[]');
  const versionId = createWorkVersion(
    work,
    (title || work.title).trim(),
    (description ?? work.description).trim(),
    content || work.content,
    parsedTags,
    req.file?.filename,
  );

  recordAuditLog({
    req,
    category: 'work',
    action: 'work_update_submitted',
    entityType: 'work_version',
    entityId: versionId,
    targetUserId: work.user_id,
    detail: { 作品ID: work.id, 作品标题: title || work.title, 类型: work.type, 版本ID: versionId },
  });
  res.json({ message: work.status === 'approved' ? '作品更新已提交，等待审核；公开版本会先保留' : '作品已更新，重新等待审核', version_id: versionId });
});

router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.user_id !== req.user!.id) { res.status(404).json({ error: '作品不存在或无权删除' }); return; }
  const reason = String(req.body?.reason || '作者删除作品').trim();
  softDeleteWorkByAuthor(work.id, req.user!.id, reason);
  recordAuditLog({
    req,
    category: 'work',
    action: 'work_soft_deleted_by_author',
    entityType: 'work',
    entityId: work.id,
    detail: { 作品标题: work.title, 类型: work.type, 理由: reason },
  });
  res.json({ message: '作品已删除（后台仍保留记录）' });
});

router.post('/:id/like', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || !isPublicWork(work)) { res.status(404).json({ error: '作品不存在' }); return; }
  const liked = toggleLike(req.user!.id, work.id);
  const updatedWork = getWorkById(work.id)!;
  recordAuditLog({
    req,
    category: 'like',
    action: liked ? 'work_liked' : 'work_unliked',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { 作品标题: work.title, 类型: work.type },
  });
  res.json({ liked, like_count: updatedWork.like_count });
});

router.post('/:id/favorite', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || !isPublicWork(work)) { res.status(404).json({ error: '作品不存在' }); return; }
  const favorited = toggleFavorite(req.user!.id, work.id);
  const updatedWork = getWorkById(work.id)!;
  recordAuditLog({
    req,
    category: 'favorite',
    action: favorited ? 'work_favorited' : 'work_unfavorited',
    entityType: 'work',
    entityId: work.id,
    targetUserId: work.user_id,
    detail: { 作品标题: work.title, 类型: work.type },
  });
  res.json({ favorited, favorite_count: updatedWork.favorite_count });
});

router.get('/:id/download', requireAuth, (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || !canViewWork(work, req.user)) { res.status(404).json({ error: '作品不存在' }); return; }
  if (work.status !== 'approved' && work.user_id !== req.user!.id) { res.status(404).json({ error: '作品不存在' }); return; }

  incrementDownloadCount(work.id);
  recordDownload(req.user!.id, work.id, work.current_version_id || null, requestIp(req), String(req.headers['user-agent'] || ''));
  recordAuditLog({
    req,
    targetUserId: work.user_id,
    category: 'download',
    action: 'work_downloaded',
    entityType: 'work',
    entityId: work.id,
    detail: { 作品标题: work.title, 类型: work.type, 文件类型: work.file_type || 'json' },
  });

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

router.get('/my/works', requireAuth, (_req: Request, res: Response) => {
  res.status(500).json({ error: '路由配置错误' });
});

export default router;
