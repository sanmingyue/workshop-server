import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getOptionalUser, requireAuth } from '../auth/middleware';
import { recordAuditLog } from '../audit';
import {
  appendCollectionChildren,
  createComment,
  createWork,
  createWorkVersion,
  getCollectionChildren,
  getApprovedWorks,
  getCommentById,
  getDownloadFileRecord,
  getUserFavoriteWorkIds,
  getUserLikedWorkIds,
  getWorkById,
  getWorkComments,
  hasUserDownloaded,
  hideComment,
  incrementDownloadCount,
  recordDownload,
  softDeleteWorkByAuthor,
  toggleFavorite,
  toggleLike,
  updateComment,
  setCollectionChildren,
  validateCollectionChildIds,
  getAllTags,
  type DbUser,
  type WorkWithAuthor,
} from '../database';
import { embedPngFingerprint, embedTextFingerprint } from '../fingerprint';

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
    // cover 字段只允许图片；card_file 字段允许图片和 JSON
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'card_file') {
      const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.json'];
      if (allowed.includes(ext)) cb(null, true);
      else cb(new Error('资源文件只支持 PNG/JPG/GIF/WebP/JSON 格式'));
    } else {
      const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      if (allowed.includes(ext)) cb(null, true);
      else cb(new Error('只支持 PNG/JPG/GIF/WebP 格式的图片'));
    }
  },
});

const VALID_TYPES = ['regex', 'persona', 'character', 'card_addon', 'worldbook', 'collection'];

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

function parseIdArray(value: unknown): number[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

function publicWorkPayload(w: WorkWithAuthor, likedSet = new Set<number>(), favoriteSet = new Set<number>()) {
  return {
    id: w.id,
    title: w.title,
    char_name: w.char_name || '',
    description: w.description,
    type: w.type,
    tags: JSON.parse(w.tags || '[]'),
    cover_url: w.cover_filename ? `${config.baseUrl}/uploads/${w.cover_filename}` : null,
    card_link: w.card_link || '',
    file_type: w.file_type || 'json',
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

function workContentForPreview(w: WorkWithAuthor): string {
  if (w.type === 'collection') return '';
  if (w.file_type === 'png' && w.content?.startsWith('__card_file__:')) return '';
  return contentPreview(w.content);
}

function collectionChildPayload(w: WorkWithAuthor, likedSet = new Set<number>(), favoriteSet = new Set<number>()) {
  return {
    ...publicWorkPayload(w, likedSet, favoriteSet),
    content: workContentForPreview(w),
  };
}

function contentPreview(content: string): string {
  if (!content) return '';
  return content.length > 2000 ? `${content.slice(0, 2000)}...` : content;
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

router.get('/download-files/:downloadId', (req: Request, res: Response) => {
  const downloadId = parseInt(req.params.downloadId as string);
  const key = String(req.query.key || '');
  const record = getDownloadFileRecord(downloadId, key);
  if (!record || record.file_type !== 'png' || !record.content?.startsWith('__card_file__:')) {
    res.status(404).json({ error: '文件不存在' });
    return;
  }

  const filename = String(record.content).replace('__card_file__:', '');
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: '文件不存在' });
    return;
  }

  const original = fs.readFileSync(filePath);
  const watermarked = embedPngFingerprint(original, record.fingerprint_token || '');
  const safeTitle = String(record.work_title || `work-${record.work_id}`).replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.png"`);
  res.send(watermarked);
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
  const likedSet = new Set(user ? getUserLikedWorkIds(user.id) : []);
  const favoriteSet = new Set(user ? getUserFavoriteWorkIds(user.id) : []);
  const children = work.type === 'collection'
    ? getCollectionChildren(work.id).map(child => collectionChildPayload(child, likedSet, favoriteSet))
    : undefined;

  res.json({
    id: work.id,
    title: work.title,
    char_name: work.char_name || '',
    description: work.description,
    type: work.type,
    content: workContentForPreview(work),
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
    children,
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
  const { title, description, type, content, tags, card_link, file_type, char_name, child_ids, addon_subtype } = req.body;
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

  if (!title || !title.trim()) { res.status(400).json({ error: '标题不能为空' }); return; }
  if (!type || !VALID_TYPES.includes(type)) { res.status(400).json({ error: `无效的类型，支持: ${VALID_TYPES.join(', ')}` }); return; }
  const finalCharName = (char_name || '').trim();
  if ((type === 'persona' || type === 'card_addon') && !finalCharName) { res.status(400).json({ error: '人设/OC与角色卡二创必须填写角色名' }); return; }
  if (type === 'character' && (!card_link || !card_link.trim())) { res.status(400).json({ error: '角色卡类型必须填写角色卡链接' }); return; }
  if (type === 'card_addon' && (!card_link || !card_link.trim())) { res.status(400).json({ error: '角色卡配套类型必须填写角色卡链接' }); return; }

  const cardFile = files?.card_file?.[0];

  let finalContent = content || '';
  let finalFileType = file_type || 'json';
  let collectionChildIds: number[] = [];

  if (type === 'collection') {
    // 合集：不需要内容或资源文件
    const coverFile = files?.cover?.[0];
    if (!coverFile) { res.status(400).json({ error: '作者合集必须上传封面图' }); return; }
    collectionChildIds = parseIdArray(child_ids);
    try {
      collectionChildIds = validateCollectionChildIds(req.user!.id, collectionChildIds);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || '合集作品选择无效' });
      return;
    }
    finalContent = '';
    finalFileType = 'json';
  } else if (type === 'character') {
    // 角色卡：必须通过 card_file 上传
    if (!cardFile) { res.status(400).json({ error: '角色卡类型必须上传角色卡文件' }); return; }
    const ext = path.extname(cardFile.originalname).toLowerCase();
    finalFileType = ext === '.png' ? 'png' : 'json';
    finalContent = `__card_file__:${cardFile.filename}`;
  } else if (type === 'regex' || type === 'worldbook') {
    // 正则/世界书：优先走 card_file 文件上传，回退到 content 文本
    if (cardFile) {
      // 读取 JSON 文件内容存入 content
      const fileContent = fs.readFileSync(cardFile.path, 'utf8');
      if (Buffer.byteLength(fileContent, 'utf8') > config.maxContentSize) {
        // 清理上传的文件
        try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
        res.status(400).json({ error: '文件内容过大，最大 1MB' });
        return;
      }
      finalContent = fileContent;
      finalFileType = 'json';
      // 删除临时文件（内容已读入 content）
      try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
    } else if (finalContent && finalContent.trim()) {
      // 兼容旧方式：通过 content 字段传文本
      if (Buffer.byteLength(finalContent, 'utf8') > config.maxContentSize) {
        res.status(400).json({ error: '内容过大，最大 1MB' });
        return;
      }
    } else {
      res.status(400).json({ error: '请上传资源文件或填写内容' });
      return;
    }
  } else if (type === 'card_addon') {
    // 角色卡二创：根据 addon_subtype 决定
    const subtype = (addon_subtype || '').trim();
    if (subtype && subtype !== 'persona' && cardFile) {
      // 非 persona 子类型：读取文件
      const fileContent = fs.readFileSync(cardFile.path, 'utf8');
      if (Buffer.byteLength(fileContent, 'utf8') > config.maxContentSize) {
        try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
        res.status(400).json({ error: '文件内容过大，最大 1MB' });
        return;
      }
      finalContent = fileContent;
      try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
    }
    // 编码 addon_subtype 到 file_type
    if (subtype) {
      finalFileType = `json:${subtype}`;
    }
    if (!finalContent || !finalContent.trim()) {
      res.status(400).json({ error: '内容不能为空' });
      return;
    }
    if (Buffer.byteLength(finalContent, 'utf8') > config.maxContentSize) {
      res.status(400).json({ error: '内容过大，最大 1MB' });
      return;
    }
  } else {
    // persona 等其他类型：纯文本内容
    if (!finalContent || !finalContent.trim()) { res.status(400).json({ error: '内容不能为空' }); return; }
    if (Buffer.byteLength(finalContent, 'utf8') > config.maxContentSize) { res.status(400).json({ error: '内容过大，最大 1MB' }); return; }
  }

  const parsedTags = parseTags(tags);
  const coverFilename = files?.cover?.[0]?.filename || '';
  const workId = createWork(req.user!.id, title.trim(), finalCharName, (description || '').trim(), type, finalContent, parsedTags, coverFilename, (card_link || '').trim(), finalFileType);
  if (type === 'collection') {
    setCollectionChildren(workId, req.user!.id, collectionChildIds);
  }

  recordAuditLog({
    req,
    category: 'work',
    action: 'work_created',
    entityType: 'work',
    entityId: workId,
    detail: { 作品标题: title.trim(), 角色名: finalCharName, 类型: type, 标签: parsedTags, 文件类型: finalFileType, 是否有封面: !!coverFilename, 子作品ID: collectionChildIds },
  });
  res.status(201).json({ id: workId, message: '作品已提交，等待审核' });
});

router.put('/:id/children', requireAuth, (req: Request, res: Response) => {
  const collectionId = parseInt(req.params.id as string);
  const addIds = parseIdArray(req.body?.add_ids);
  if (addIds.length === 0) { res.status(400).json({ error: '请选择要添加的作品' }); return; }

  try {
    const result = appendCollectionChildren(collectionId, req.user!.id, addIds);
    recordAuditLog({
      req,
      category: 'work',
      action: 'collection_children_added',
      entityType: 'work',
      entityId: collectionId,
      detail: { 合集ID: collectionId, 添加作品ID: addIds, 实际新增: result.added, 当前数量: result.total },
    });
    res.json({ message: `已添加 ${result.added} 件作品`, children_count: result.total });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || '添加失败' });
  }
});

router.put('/:id', requireAuth, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'card_file', maxCount: 1 },
]), (req: Request, res: Response) => {
  const work = getWorkById(parseInt(req.params.id as string));
  if (!work || work.user_id !== req.user!.id) { res.status(404).json({ error: '作品不存在或无权修改' }); return; }
  if (work.visibility === 'author_deleted') { res.status(400).json({ error: '已删除作品不能继续更新' }); return; }

  const { title, description, content, tags, char_name, card_link, file_type } = req.body;
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const parsedTags = tags ? parseTags(tags) : JSON.parse(work.tags || '[]');
  const nextCharName = char_name !== undefined ? String(char_name || '').trim() : work.char_name || '';
  if ((work.type === 'persona' || work.type === 'card_addon') && !nextCharName) { res.status(400).json({ error: '人设/OC与角色卡二创必须填写角色名' }); return; }
  const nextCardLink = card_link !== undefined ? String(card_link || '').trim() : work.card_link;
  if (work.type === 'card_addon' && !nextCardLink) { res.status(400).json({ error: '角色卡二创必须填写角色卡链接' }); return; }
  if (work.type === 'character' && card_link !== undefined && !nextCardLink) { res.status(400).json({ error: '角色卡类型必须填写角色卡链接' }); return; }

  // 处理资源文件替换
  const cardFile = files?.card_file?.[0];
  let nextContent = work.type === 'collection' ? work.content : (content || work.content);
  let nextFileType = file_type !== undefined ? String(file_type || work.file_type) : work.file_type;

  if (cardFile) {
    if (work.type === 'character') {
      // 角色卡：存为文件指针
      const ext = path.extname(cardFile.originalname).toLowerCase();
      nextFileType = ext === '.png' ? 'png' : 'json';
      nextContent = `__card_file__:${cardFile.filename}`;
    } else if (work.type === 'regex' || work.type === 'worldbook') {
      // 正则/世界书：读取文件内容
      const fileContent = fs.readFileSync(cardFile.path, 'utf8');
      if (Buffer.byteLength(fileContent, 'utf8') > config.maxContentSize) {
        try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
        res.status(400).json({ error: '文件内容过大，最大 1MB' });
        return;
      }
      nextContent = fileContent;
      nextFileType = 'json';
      try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
    } else if (work.type === 'card_addon') {
      // 角色卡二创非 persona 子类型：读取文件
      const fileContent = fs.readFileSync(cardFile.path, 'utf8');
      if (Buffer.byteLength(fileContent, 'utf8') > config.maxContentSize) {
        try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
        res.status(400).json({ error: '文件内容过大，最大 1MB' });
        return;
      }
      nextContent = fileContent;
      try { fs.unlinkSync(cardFile.path); } catch { /* ignore */ }
    }
  }

  const coverFilename = files?.cover?.[0]?.filename;
  const versionId = createWorkVersion(
    work,
    (title || work.title).trim(),
    (description ?? work.description).trim(),
    nextContent,
    parsedTags,
    coverFilename,
    nextCardLink,
    nextFileType,
    nextCharName,
  );

  recordAuditLog({
    req,
    category: 'work',
    action: 'work_update_submitted',
    entityType: 'work_version',
    entityId: versionId,
    targetUserId: work.user_id,
    detail: { 作品ID: work.id, 作品标题: title || work.title, 类型: work.type, 版本ID: versionId, 有新资源文件: !!cardFile, 有新封面: !!coverFilename },
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

  // 只在用户首次下载该作品时递增 download_count
  const isFirstDownload = !hasUserDownloaded(req.user!.id, work.id);
  if (isFirstDownload) {
    incrementDownloadCount(work.id);
  }
  const download = recordDownload(req.user!.id, work.id, work.current_version_id || null, requestIp(req), String(req.headers['user-agent'] || ''));
  recordAuditLog({
    req,
    targetUserId: work.user_id,
    category: 'download',
    action: 'work_downloaded',
    entityType: 'work',
    entityId: work.id,
    detail: { 作品标题: work.title, 类型: work.type, 文件类型: work.file_type || 'json', 下载记录ID: download.id, 指纹: download.fingerprint_token },
  });

  if (work.file_type === 'png' && work.content.startsWith('__card_file__:')) {
    res.json({
      id: work.id,
      title: work.title,
      char_name: work.char_name || '',
      type: work.type,
      content: '',
      file_url: `${config.baseUrl}/api/works/download-files/${download.id}?key=${encodeURIComponent(download.file_token)}`,
      file_type: 'png',
      card_link: work.card_link || '',
      author_name: work.author_display_name || work.author_username,
    });
    return;
  }

  res.json({
    id: work.id,
    title: work.title,
    char_name: work.char_name || '',
    type: work.type,
    content: embedTextFingerprint(work.content, download.fingerprint_token),
    file_type: work.file_type || 'json',
    card_link: work.card_link || '',
    author_name: work.author_display_name || work.author_username,
  });
});

router.get('/my/works', requireAuth, (_req: Request, res: Response) => {
  res.status(500).json({ error: '路由配置错误' });
});

export default router;
