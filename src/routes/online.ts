 import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { getDb, type DbUser } from '../database';
import { requireAuth } from '../auth/middleware';
import { nowIso, recordAuditLog } from '../audit';
import { addSSEClient, removeSSEClient, broadcastToRoom, broadcastToRoomAll, closeRoomSSE } from '../sse';

const router = Router();
const STALE_MEMBER_MS = 600_000; // 10分钟无心跳才判定为掉线（SSE连接本身会保活）
const MAX_ROOM_MEMBERS = 8;
const MAX_DIRECTOR_STREAM_LENGTH = 120_000;

// ─── 类型 ───

type OnlineRoomRow = {
  id: string;
  title: string;
  visibility: 'public' | 'password' | 'unlisted';
  password_hash: string;
  password_salt: string;
  status: 'open' | 'paused' | 'closed';
  host_user_id: number;
  host_name: string;
  character_name: string;
  character_summary: string;
  character_opening: string;
  custom_opening: string;
  character_card_link: string;
  preset_name: string;
  required_assets: string;
  per_player_words: number;
  per_player_min_words: number;
  per_player_max_words: number;
  candidate_timeout_seconds: number;
  erase_on_close: number;
  created_at: string;
  updated_at: string;
  closed_at: string;
  member_count?: number;
};

type OnlineRoundRow = {
  id: number;
  room_id: string;
  round_no: number;
  status: 'collecting' | 'integrating' | 'finalized' | 'cancelled';
  deadline_at: string;
  user_message: string;
  assistant_message: string;
  created_at: string;
  finalized_at: string;
};

// ─── 工具函数 ───

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function displayName(user: DbUser): string {
  return user.discord_display_name || user.discord_username || `用户${user.id}`;
}

function hashPassword(password: string, salt: string): string {
  return crypto
    .createHash('sha256')
    .update(`${salt}:${password}:${config.sessionSecret}`)
    .digest('hex');
}

function createPasswordHash(password?: string): { hash: string; salt: string } {
  if (!password) return { hash: '', salt: '' };
  const salt = crypto.randomBytes(12).toString('hex');
  return { hash: hashPassword(password, salt), salt };
}

function verifyPassword(room: OnlineRoomRow, password?: string): boolean {
  if (room.visibility !== 'password') return true;
  if (!password || !room.password_hash || !room.password_salt) return false;
  return hashPassword(password, room.password_salt) === room.password_hash;
}

function makeRoomId(): string {
  for (let i = 0; i < 8; i++) {
    const id = crypto.randomBytes(4).toString('hex');
    const existing = getDb().prepare('SELECT id FROM online_rooms WHERE id = ?').get(id);
    if (!existing) return id;
  }
  return crypto.randomUUID();
}

function getRoom(roomId: string): OnlineRoomRow | undefined {
  return getDb().prepare(`
    SELECT r.*, (
      SELECT COUNT(*) FROM online_room_members m
      WHERE m.room_id = r.id AND m.status = 'joined'
    ) as member_count
    FROM online_rooms r
    WHERE r.id = ?
  `).get(roomId) as OnlineRoomRow | undefined;
}

function closeRoomData(room: Pick<OnlineRoomRow, 'id' | 'erase_on_close'>, closedAt: string): void {
  if (room.erase_on_close) {
    const rounds = getDb().prepare('SELECT id FROM online_rounds WHERE room_id = ?').all(room.id) as { id: number }[];
    for (const round of rounds) {
      getDb().prepare("UPDATE online_round_inputs SET player_message = '', candidate_reply = '' WHERE round_id = ?").run(round.id);
    }
    getDb().prepare("UPDATE online_rounds SET user_message = '', assistant_message = '' WHERE room_id = ?").run(room.id);
    getDb().prepare('DELETE FROM online_room_chat_messages WHERE room_id = ?').run(room.id);
  }

  getDb().prepare("UPDATE online_rooms SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(closedAt, closedAt, room.id);
  getDb().prepare("UPDATE online_room_members SET status = 'left', last_seen_at = ? WHERE room_id = ?").run(closedAt, room.id);
}

function promoteNextHost(roomId: string, now: string): void {
  const nextHost = getDb().prepare(`
    SELECT user_id, display_name
    FROM online_room_members
    WHERE room_id = ? AND status = 'joined'
    ORDER BY joined_at ASC
    LIMIT 1
  `).get(roomId) as { user_id: number; display_name: string } | undefined;

  if (!nextHost) return;

  getDb().prepare(`
    UPDATE online_room_members
    SET role = CASE WHEN user_id = ? THEN 'host' ELSE 'player' END
    WHERE room_id = ?
  `).run(nextHost.user_id, roomId);
  getDb().prepare(`
    UPDATE online_rooms
    SET host_user_id = ?, host_name = ?, updated_at = ?
    WHERE id = ?
  `).run(nextHost.user_id, nextHost.display_name, now, roomId);
}

function reconcileOpenRooms(now: string): void {
  const emptyRooms = getDb().prepare(`
    SELECT r.id, r.erase_on_close
    FROM online_rooms r
    WHERE r.status = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM online_room_members m
        WHERE m.room_id = r.id AND m.status = 'joined'
      )
  `).all() as Pick<OnlineRoomRow, 'id' | 'erase_on_close'>[];

  for (const room of emptyRooms) {
    closeRoomData(room, now);
    closeRoomSSE(room.id);
  }

  const roomsNeedingHost = getDb().prepare(`
    SELECT r.id
    FROM online_rooms r
    WHERE r.status = 'open'
      AND EXISTS (
        SELECT 1 FROM online_room_members m
        WHERE m.room_id = r.id AND m.status = 'joined'
      )
      AND NOT EXISTS (
        SELECT 1 FROM online_room_members m
        WHERE m.room_id = r.id AND m.status = 'joined' AND m.role = 'host'
      )
  `).all() as { id: string }[];

  for (const room of roomsNeedingHost) {
    promoteNextHost(room.id, now);
    // 广播房主变更
    broadcastMemberUpdate(room.id);
  }
}

function cleanupStaleRooms(): void {
  const cutoff = new Date(Date.now() - STALE_MEMBER_MS).toISOString();
  const now = nowIso();
  const tx = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE online_room_members
      SET status = 'left', role = 'player', last_seen_at = ?
      WHERE status = 'joined' AND last_seen_at < ?
    `).run(now, cutoff);

    reconcileOpenRooms(now);
  });
  tx();
}

function serializeRoom(room: OnlineRoomRow): Record<string, unknown> {
  return {
    id: room.id,
    title: room.title,
    visibility: room.visibility,
    status: room.status,
    host_user_id: room.host_user_id,
    host_name: room.host_name,
    character_name: room.character_name,
    character_summary: room.character_summary,
    character_opening: room.character_opening,
    custom_opening: room.custom_opening,
    character_card_link: room.character_card_link,
    preset_name: room.preset_name,
    required_assets: parseJsonArray(room.required_assets),
    per_player_words: room.per_player_words,
    per_player_min_words: room.per_player_min_words ?? 700,
    per_player_max_words: room.per_player_max_words ?? 1000,
    candidate_timeout_seconds: room.candidate_timeout_seconds,
    erase_on_close: !!room.erase_on_close,
    member_count: room.member_count || 0,
    created_at: room.created_at,
    updated_at: room.updated_at,
  };
}

function getMember(roomId: string, userId: number): any | undefined {
  return getDb().prepare('SELECT * FROM online_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function requireRoomMemberById(req: Request, res: Response, roomId: string): OnlineRoomRow | undefined {
  cleanupStaleRooms();
  const room = getRoom(roomId);
  if (!room || room.status === 'closed') {
    res.status(404).json({ error: '房间不存在或已关闭' });
    return undefined;
  }

  const member = getMember(room.id, req.user!.id);
  if (!member || member.status !== 'joined') {
    res.status(403).json({ error: '你还没有加入这个房间' });
    return undefined;
  }

  touchMember(room.id, req.user!);
  return room;
}

function requireRoomMember(req: Request, res: Response): OnlineRoomRow | undefined {
  return requireRoomMemberById(req, res, paramValue(req.params.roomId));
}

function requireHost(req: Request, res: Response, roomId: string): OnlineRoomRow | undefined {
  cleanupStaleRooms();
  const room = getRoom(roomId);
  if (!room || room.status === 'closed') {
    res.status(404).json({ error: '房间不存在或已关闭' });
    return undefined;
  }
  if (room.host_user_id !== req.user!.id) {
    res.status(403).json({ error: '只有房主可以执行该操作' });
    return undefined;
  }
  touchMember(room.id, req.user!);
  return room;
}

function touchMember(roomId: string, user: DbUser, characterName?: string, characterPersona?: string): void {
  const now = nowIso();
  if (characterName !== undefined || characterPersona !== undefined) {
    // 带角色信息的 upsert（加入时）
    getDb().prepare(`
      INSERT INTO online_room_members (
        room_id, user_id, display_name, avatar, role, status, joined_at, last_seen_at, character_name, character_persona
      ) VALUES (?, ?, ?, ?, 'player', 'joined', ?, ?, ?, ?)
      ON CONFLICT(room_id, user_id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar = excluded.avatar,
        status = 'joined',
        joined_at = CASE WHEN status = 'joined' THEN joined_at ELSE excluded.joined_at END,
        last_seen_at = excluded.last_seen_at,
        character_name = excluded.character_name,
        character_persona = excluded.character_persona
    `).run(roomId, user.id, displayName(user), user.discord_avatar || '', now, now, characterName || '', characterPersona || '');
  } else {
    // 普通心跳 upsert（不覆盖角色信息）
    getDb().prepare(`
      INSERT INTO online_room_members (
        room_id, user_id, display_name, avatar, role, status, joined_at, last_seen_at
      ) VALUES (?, ?, ?, ?, 'player', 'joined', ?, ?)
      ON CONFLICT(room_id, user_id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar = excluded.avatar,
        status = 'joined',
        joined_at = CASE WHEN status = 'joined' THEN joined_at ELSE excluded.joined_at END,
        last_seen_at = excluded.last_seen_at
    `).run(roomId, user.id, displayName(user), user.discord_avatar || '', now, now);
  }
}

function serializeRound(round: OnlineRoundRow): Record<string, unknown> {
  const inputs = getDb().prepare(`
    SELECT user_id, display_name, player_message, candidate_reply, status, submitted_at, candidate_at
    FROM online_round_inputs
    WHERE round_id = ?
    ORDER BY submitted_at ASC, id ASC
  `).all(round.id);

  return {
    id: round.id,
    room_id: round.room_id,
    round_no: round.round_no,
    status: round.status,
    deadline_at: round.deadline_at,
    user_message: round.user_message,
    assistant_message: round.assistant_message,
    created_at: round.created_at,
    finalized_at: round.finalized_at,
    inputs,
  };
}

function roomState(req: Request, room: OnlineRoomRow): Record<string, unknown> {
  const me = getMember(room.id, req.user!.id);
  const members = getMembers(room.id);

  const chatMessages = getDb().prepare(`
    SELECT id, room_id, user_id, display_name, content, created_at
    FROM online_room_chat_messages
    WHERE room_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 120
  `).all(room.id).reverse();

  const activeRound = getDb().prepare(`
    SELECT *
    FROM online_rounds
    WHERE room_id = ? AND status IN ('collecting', 'integrating')
    ORDER BY round_no DESC
    LIMIT 1
  `).get(room.id) as OnlineRoundRow | undefined;

  const finalizedRounds = getDb().prepare(`
    SELECT *
    FROM online_rounds
    WHERE room_id = ? AND status = 'finalized'
    ORDER BY round_no DESC
    LIMIT 20
  `).all(room.id).reverse() as OnlineRoundRow[];

  return {
    room: serializeRoom(room),
    me,
    members,
    chat_messages: chatMessages,
    active_round: activeRound ? serializeRound(activeRound) : null,
    finalized_rounds: finalizedRounds.map(serializeRound),
  };
}

// ─── SSE 广播辅助函数 ───

/** 获取房间当前成员列表 */
function getMembers(roomId: string): any[] {
  return getDb().prepare(`
    SELECT user_id, display_name, avatar, role, status, last_seen_at, character_name, character_persona, ready
    FROM online_room_members
    WHERE room_id = ? AND status = 'joined'
    ORDER BY role = 'host' DESC, joined_at ASC
  `).all(roomId);
}

/** 广播成员列表更新 */
function broadcastMemberUpdate(roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  broadcastToRoomAll(roomId, 'member_update', {
    members: getMembers(roomId),
    room: serializeRoom(room),
  });
}

/** 广播回合状态更新 */
function broadcastRoundUpdate(roomId: string, round: OnlineRoundRow): void {
  broadcastToRoomAll(roomId, 'round_update', serializeRound(round));
}

// ─── 路由 ───

router.use(requireAuth);

// ─── SSE 事件流 ───

router.get('/rooms/:roomId/events', (req: Request, res: Response) => {
  cleanupStaleRooms();
  const roomId = paramValue(req.params.roomId);
  const room = getRoom(roomId);
  if (!room || room.status === 'closed') {
    res.status(404).json({ error: '房间不存在或已关闭' });
    return;
  }

  const member = getMember(room.id, req.user!.id);
  if (!member || member.status !== 'joined') {
    res.status(403).json({ error: '你还没有加入这个房间' });
    return;
  }

  // 更新心跳
  touchMember(room.id, req.user!);

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx 兼容
  res.flushHeaders();

  // 注册 SSE 客户端
  const client = addSSEClient(room.id, req.user!.id, res);

  // 立即推送一次完整状态
  const fullState = roomState(req, getRoom(room.id)!);
  res.write(`event: full_state\ndata: ${JSON.stringify(fullState)}\n\n`);

  // 连接断开时清理
  req.on('close', () => {
    removeSSEClient(room.id, client);
  });
});

// ─── 房间列表 ───

router.get('/rooms', (req: Request, res: Response) => {
  cleanupStaleRooms();
  const rooms = getDb().prepare(`
    SELECT r.*, (
      SELECT COUNT(*) FROM online_room_members m
      WHERE m.room_id = r.id AND m.status = 'joined'
    ) as member_count
    FROM online_rooms r
    WHERE r.status = 'open' AND r.visibility IN ('public', 'password')
    ORDER BY r.updated_at DESC
    LIMIT 80
  `).all() as OnlineRoomRow[];

  res.json({ rooms: rooms.map(serializeRoom) });
});

// ─── 创建房间 ───

router.post('/rooms', (req: Request, res: Response) => {
  const {
    title,
    visibility,
    password,
    character_name,
    character_summary,
    character_opening,
    custom_opening,
    character_card_link,
    preset_name,
    required_assets,
    per_player_words,
    per_player_min_words,
    per_player_max_words,
    candidate_timeout_seconds,
    erase_on_close,
    host_character_name,
    host_character_persona,
  } = req.body || {};

  if (!character_card_link || typeof character_card_link !== 'string') {
    res.status(400).json({ error: '请填写角色卡公开链接' });
    return;
  }

  const roomVisibility = ['public', 'password', 'unlisted'].includes(visibility) ? visibility : 'public';
  if (roomVisibility === 'password' && (!password || typeof password !== 'string')) {
    res.status(400).json({ error: '密码房间需要填写密码' });
    return;
  }

  const id = makeRoomId();
  const now = nowIso();
  const passwordInfo = createPasswordHash(String(password || ''));
  const safeAssets = Array.isArray(required_assets)
    ? required_assets.filter((item: unknown) => typeof item === 'string').slice(0, 30)
    : [];
  const hostName = displayName(req.user!);

  const finalMinWords = Math.max(100, Math.min(5000, Number(per_player_min_words) || 700));
  const finalMaxWords = Math.max(finalMinWords, Math.min(8000, Number(per_player_max_words) || 1000));

  getDb().prepare(`
    INSERT INTO online_rooms (
      id, title, visibility, password_hash, password_salt, status, host_user_id, host_name,
      character_name, character_summary, character_opening, custom_opening, character_card_link, preset_name, required_assets,
      per_player_words, per_player_min_words, per_player_max_words, candidate_timeout_seconds, erase_on_close, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(title || '联机房间').slice(0, 80),
    roomVisibility,
    passwordInfo.hash,
    passwordInfo.salt,
    req.user!.id,
    hostName,
    String(character_name || '').slice(0, 120),
    String(character_summary || '').slice(0, 2000),
    String(character_opening || '').slice(0, 4000),
    String(custom_opening || '').slice(0, 4000),
    String(character_card_link || '').slice(0, 800),
    String(preset_name || '').slice(0, 120),
    JSON.stringify(safeAssets),
    Math.max(300, Math.min(1000, Number(per_player_words) || 1000)),
    finalMinWords,
    finalMaxWords,
    Math.max(30, Math.min(600, Number(candidate_timeout_seconds) || 120)),
    erase_on_close === false ? 0 : 1,
    now,
    now,
  );

  getDb().prepare(`
    INSERT INTO online_room_members (
      room_id, user_id, display_name, avatar, role, status, joined_at, last_seen_at, character_name, character_persona
    ) VALUES (?, ?, ?, ?, 'host', 'joined', ?, ?, ?, ?)
  `).run(id, req.user!.id, hostName, req.user!.discord_avatar || '', now, now, String(host_character_name || '').slice(0, 120), String(host_character_persona || '').slice(0, 2000));

  recordAuditLog({
    req,
    category: 'system',
    action: 'online_room_created',
    actionLabel: '用户创建联机房间',
    entityType: 'online_room',
    entityId: id,
    detail: { 房间名: title || '联机房间', 角色: character_name || '', 可见性: roomVisibility },
  });

  res.json({ room: serializeRoom(getRoom(id)!) });
});

// ─── 加入房间 ───

router.post('/rooms/:roomId/join', (req: Request, res: Response) => {
  cleanupStaleRooms();
  const room = getRoom(paramValue(req.params.roomId));
  if (!room || room.status === 'closed') {
    res.status(404).json({ error: '房间不存在或已关闭' });
    return;
  }
  if (!verifyPassword(room, req.body?.password)) {
    res.status(403).json({ error: '房间密码错误' });
    return;
  }

  const characterName = String(req.body?.character_name || '').trim().slice(0, 120);
  const characterPersona = String(req.body?.character_persona || '').trim().slice(0, 2000);
  if (!characterName) {
    res.status(400).json({ error: '请填写你的角色名' });
    return;
  }

  const existingMember = getMember(room.id, req.user!.id);
  if (!existingMember || existingMember.status !== 'joined') {
    const memberCount = getDb().prepare(`
      SELECT COUNT(*) as count
      FROM online_room_members
      WHERE room_id = ? AND status = 'joined'
    `).get(room.id) as { count: number };
    if (memberCount.count >= MAX_ROOM_MEMBERS) {
      res.status(409).json({ error: `房间最多 ${MAX_ROOM_MEMBERS} 人` });
      return;
    }
  }

  touchMember(room.id, req.user!, characterName, characterPersona);
  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(nowIso(), room.id);

  recordAuditLog({
    req,
    category: 'system',
    action: 'online_room_joined',
    actionLabel: '用户加入联机房间',
    entityType: 'online_room',
    entityId: room.id,
    detail: { 房间名: room.title },
  });

  // SSE 广播：新成员加入
  broadcastMemberUpdate(room.id);

  res.json({ room: serializeRoom(getRoom(room.id)!) });
});

// ─── 离开房间 ───

router.post('/rooms/:roomId/leave', (req: Request, res: Response) => {
  cleanupStaleRooms();
  const room = getRoom(paramValue(req.params.roomId));
  if (!room || room.status === 'closed') {
    res.json({ ok: true });
    return;
  }

  const now = nowIso();
  getDb().prepare(`
    UPDATE online_room_members
    SET status = 'left', role = 'player', last_seen_at = ?
    WHERE room_id = ? AND user_id = ?
  `).run(now, room.id, req.user!.id);
  const tx = getDb().transaction(() => reconcileOpenRooms(now));
  tx();

  // SSE 广播：成员离开（如果房间还在则广播，否则 reconcile 已经 closeRoomSSE 了）
  const updatedRoom = getRoom(room.id);
  if (updatedRoom && updatedRoom.status === 'open') {
    broadcastMemberUpdate(room.id);
  }

  res.json({ ok: true });
});

// ─── 获取房间状态 ───

router.get('/rooms/:roomId', (req: Request, res: Response) => {
  const room = requireRoomMember(req, res);
  if (!room) return;
  res.json(roomState(req, getRoom(room.id)!));
});

// ─── 心跳 ───

router.post('/rooms/:roomId/heartbeat', (req: Request, res: Response) => {
  const room = requireRoomMember(req, res);
  if (!room) return;
  res.json({ ok: true });
});

// ─── 房间聊天 ───

router.post('/rooms/:roomId/chat', (req: Request, res: Response) => {
  const room = requireRoomMember(req, res);
  if (!room) return;

  const content = String(req.body?.content || '').trim();
  if (!content) {
    res.status(400).json({ error: '聊天内容不能为空' });
    return;
  }
  if (content.length > 1200) {
    res.status(400).json({ error: '聊天内容过长' });
    return;
  }

  const now = nowIso();
  const result = getDb().prepare(`
    INSERT INTO online_room_chat_messages (room_id, user_id, display_name, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(room.id, req.user!.id, displayName(req.user!), content, now);

  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, room.id);

  // SSE 广播：聊天消息
  broadcastToRoomAll(room.id, 'chat_message', {
    id: result.lastInsertRowid,
    room_id: room.id,
    user_id: req.user!.id,
    display_name: displayName(req.user!),
    content,
    created_at: now,
  });

  res.json({ id: result.lastInsertRowid });
});

// ─── 切换准备状态 ───

router.post('/rooms/:roomId/ready', (req: Request, res: Response) => {
  const room = requireRoomMember(req, res);
  if (!room) return;

  const member = getMember(room.id, req.user!.id);
  if (!member) return;

  const newReady = member.ready ? 0 : 1;
  getDb().prepare('UPDATE online_room_members SET ready = ? WHERE room_id = ? AND user_id = ?')
    .run(newReady, room.id, req.user!.id);

  // SSE 广播成员更新
  broadcastMemberUpdate(room.id);

  res.json({ ready: !!newReady });
});

// ─── 开始新一轮 ───

router.post('/rooms/:roomId/rounds', (req: Request, res: Response) => {
  const room = requireHost(req, res, paramValue(req.params.roomId));
  if (!room) return;

  const active = getDb().prepare(`
    SELECT id FROM online_rounds
    WHERE room_id = ? AND status IN ('collecting', 'integrating')
    LIMIT 1
  `).get(room.id);
  if (active) {
    res.status(409).json({ error: '上一轮还没有完成' });
    return;
  }

  // 检查所有成员是否已准备
  const members = getMembers(room.id);
  const notReady = members.filter(m => !m.ready && m.user_id !== room.host_user_id);
  if (notReady.length > 0) {
    res.status(409).json({ error: `还有 ${notReady.length} 位玩家未准备` });
    return;
  }

  const last = getDb().prepare('SELECT MAX(round_no) as n FROM online_rounds WHERE room_id = ?').get(room.id) as { n: number | null };
  const roundNo = (last.n || 0) + 1;
  const now = nowIso();
  const deadline = new Date(Date.now() + room.candidate_timeout_seconds * 1000).toISOString();
  const result = getDb().prepare(`
    INSERT INTO online_rounds (room_id, round_no, status, deadline_at, created_at)
    VALUES (?, ?, 'collecting', ?, ?)
  `).run(room.id, roundNo, deadline, now);

  // 重置所有人 ready=0
  getDb().prepare('UPDATE online_room_members SET ready = 0 WHERE room_id = ?').run(room.id);

  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, room.id);

  // SSE 广播：新一轮开始 + 成员更新（ready 重置）
  const newRound = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(result.lastInsertRowid) as OnlineRoundRow;
  broadcastToRoomAll(room.id, 'round_started', serializeRound(newRound));
  broadcastMemberUpdate(room.id);

  res.json({ round_id: result.lastInsertRowid });
});

// ─── 提交本轮发言 ───

router.post('/rounds/:roundId/input', (req: Request, res: Response) => {
  const round = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(req.params.roundId) as OnlineRoundRow | undefined;
  if (!round || round.status !== 'collecting') {
    res.status(404).json({ error: '当前轮次不存在或已结束' });
    return;
  }
  const room = requireRoomMemberById(req, res, round.room_id);
  if (!room) return;

  const playerMessage = String(req.body?.player_message || '').trim();
  if (!playerMessage) {
    res.status(400).json({ error: '本轮发言不能为空' });
    return;
  }
  if (playerMessage.length > 8000) {
    res.status(400).json({ error: '本轮发言过长' });
    return;
  }

  const now = nowIso();
  getDb().prepare(`
    INSERT INTO online_round_inputs (
      round_id, user_id, display_name, player_message, status, submitted_at
    ) VALUES (?, ?, ?, ?, 'submitted', ?)
    ON CONFLICT(round_id, user_id) DO UPDATE SET
      display_name = excluded.display_name,
      player_message = excluded.player_message,
      status = 'submitted',
      submitted_at = excluded.submitted_at
  `).run(round.id, req.user!.id, displayName(req.user!), playerMessage, now);

  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, round.room_id);

  // SSE 广播：玩家提交发言
  broadcastToRoomAll(round.room_id, 'round_input', {
    round_id: round.id,
    user_id: req.user!.id,
    display_name: displayName(req.user!),
    player_message: playerMessage,
    status: 'submitted',
    submitted_at: now,
  });

  res.json({ ok: true });
});

// ─── 提交候选回复 ───

router.post('/rounds/:roundId/candidate', (req: Request, res: Response) => {
  const round = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(req.params.roundId) as OnlineRoundRow | undefined;
  if (!round || !['collecting', 'integrating'].includes(round.status)) {
    res.status(404).json({ error: '当前轮次不存在或已结束' });
    return;
  }
  const room = requireRoomMemberById(req, res, round.room_id);
  if (!room) return;

  const candidateReply = String(req.body?.candidate_reply || '').trim();
  if (!candidateReply) {
    res.status(400).json({ error: '候选回复不能为空' });
    return;
  }
  if (candidateReply.length > 80000) {
    res.status(400).json({ error: '候选回复过长' });
    return;
  }

  const existing = getDb().prepare('SELECT id FROM online_round_inputs WHERE round_id = ? AND user_id = ?').get(round.id, req.user!.id);
  if (!existing) {
    res.status(400).json({ error: '请先提交本轮发言' });
    return;
  }

  const now = nowIso();
  getDb().prepare(`
    UPDATE online_round_inputs
    SET candidate_reply = ?, status = 'candidate_ready', candidate_at = ?
    WHERE round_id = ? AND user_id = ?
  `).run(candidateReply, now, round.id, req.user!.id);

  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, round.room_id);

  // SSE 广播：候选回复完成
  broadcastToRoomAll(round.room_id, 'candidate_ready', {
    round_id: round.id,
    user_id: req.user!.id,
    display_name: displayName(req.user!),
    candidate_reply: candidateReply,
    status: 'candidate_ready',
    candidate_at: now,
  });

  res.json({ ok: true });
});

// ─── 导演流式输出 ───

router.post('/rounds/:roundId/stream', (req: Request, res: Response) => {
  const round = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(req.params.roundId) as OnlineRoundRow | undefined;
  if (!round || !['collecting', 'integrating'].includes(round.status)) {
    res.status(404).json({ error: '当前轮次不存在或已结束' });
    return;
  }
  const room = requireHost(req, res, round.room_id);
  if (!room) return;

  const assistantMessage = String(req.body?.assistant_message || '').slice(0, MAX_DIRECTOR_STREAM_LENGTH);
  const now = nowIso();
  getDb().prepare(`
    UPDATE online_rounds
    SET status = 'integrating', assistant_message = ?
    WHERE id = ?
  `).run(assistantMessage, round.id);
  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, round.room_id);

  // SSE 广播：导演流式输出（排除房主自己，因为房主本地已有流）
  broadcastToRoom(round.room_id, 'director_stream', {
    round_id: round.id,
    status: 'integrating',
    assistant_message: assistantMessage,
  }, req.user!.id);

  res.json({ ok: true });
});

// ─── 完成整合 ───

router.post('/rounds/:roundId/finalize', (req: Request, res: Response) => {
  const round = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(req.params.roundId) as OnlineRoundRow | undefined;
  if (!round || !['collecting', 'integrating'].includes(round.status)) {
    res.status(404).json({ error: '当前轮次不存在或已结束' });
    return;
  }
  const room = requireHost(req, res, round.room_id);
  if (!room) return;

  const userMessage = String(req.body?.user_message || '').trim();
  const assistantMessage = String(req.body?.assistant_message || '').trim();
  if (!userMessage || !assistantMessage) {
    res.status(400).json({ error: '最终同步楼层不能为空' });
    return;
  }

  const now = nowIso();
  getDb().prepare(`
    UPDATE online_rounds
    SET status = 'finalized', user_message = ?, assistant_message = ?, finalized_at = ?
    WHERE id = ?
  `).run(userMessage, assistantMessage, now, round.id);
  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, round.room_id);

  recordAuditLog({
    req,
    category: 'system',
    action: 'online_round_finalized',
    actionLabel: '房主完成联机轮次整合',
    entityType: 'online_round',
    entityId: round.id,
    detail: { 房间: room.title, 轮次: round.round_no },
  });

  // SSE 广播：轮次完成
  const finalizedRound = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(round.id) as OnlineRoundRow;
  broadcastToRoomAll(round.room_id, 'round_finalized', serializeRound(finalizedRound));

  // 30 秒后清空正文（节省带宽，历史已同步到各端）
  setTimeout(() => {
    try {
      getDb().prepare("UPDATE online_round_inputs SET candidate_reply = '' WHERE round_id = ?").run(round.id);
    } catch { /* ignore */ }
  }, 30_000);

  res.json({ ok: true });
});

// ─── 重Roll（回退到 integrating） ───

router.post('/rounds/:roundId/reroll', (req: Request, res: Response) => {
  const round = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(req.params.roundId) as OnlineRoundRow | undefined;
  if (!round || round.status !== 'finalized') {
    res.status(404).json({ error: '当前轮次不存在或不在已完成状态' });
    return;
  }
  const room = requireHost(req, res, round.room_id);
  if (!room) return;

  const now = nowIso();
  getDb().prepare(`
    UPDATE online_rounds
    SET status = 'integrating', finalized_at = ''
    WHERE id = ?
  `).run(round.id);
  getDb().prepare('UPDATE online_rooms SET updated_at = ? WHERE id = ?').run(now, round.room_id);

  // SSE 广播：回合状态更新
  const updatedRound = getDb().prepare('SELECT * FROM online_rounds WHERE id = ?').get(round.id) as OnlineRoundRow;
  broadcastRoundUpdate(round.room_id, updatedRound);

  res.json({ ok: true });
});

// ─── 关闭房间 ───

router.post('/rooms/:roomId/close', (req: Request, res: Response) => {
  const room = requireHost(req, res, paramValue(req.params.roomId));
  if (!room) return;

  const tx = getDb().transaction(() => {
    const now = nowIso();
    closeRoomData(room, now);
  });
  tx();

  recordAuditLog({
    req,
    category: 'system',
    action: 'online_room_closed',
    actionLabel: '房主关闭联机房间',
    entityType: 'online_room',
    entityId: room.id,
    detail: { 房间名: room.title, 清空正文: !!room.erase_on_close },
  });

  // SSE 广播：房间关闭，关闭所有 SSE 连接
  closeRoomSSE(room.id);

  res.json({ ok: true });
});

export default router;
