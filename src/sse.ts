import { Response } from 'express';
import { getDb } from './database';

/**
 * SSE 事件总线 —— 管理房间内的 SSE 连接，提供房间广播能力
 *
 * 内存中维护 roomId -> Set<Response> 的映射。
 * 每个写操作（聊天、提交发言、候选完成等）完成后，
 * 调用 broadcastToRoom() 将增量事件推送给房间内所有连接。
 *
 * SSE 心跳同时更新数据库中的 last_seen_at，确保有 SSE 连接的用户不会被误判为掉线。
 */

interface SSEClient {
  res: Response;
  userId: number;
  connectedAt: number;
}

// 房间 -> 连接列表
const roomClients: Map<string, Set<SSEClient>> = new Map();

// 心跳间隔（毫秒）
const HEARTBEAT_INTERVAL_MS = 25_000;

// 全局心跳定时器
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const now = new Date().toISOString();
    const userIdsToTouch: { roomId: string; userId: number }[] = [];

    for (const [roomId, clients] of roomClients.entries()) {
      for (const client of clients) {
        try {
          client.res.write(': heartbeat\n\n');
          // 收集需要更新心跳的用户（SSE 连接正常 = 用户在线）
          userIdsToTouch.push({ roomId, userId: client.userId });
        } catch {
          // 写入失败，连接已断开，移除
          clients.delete(client);
        }
      }
      // 清理空房间
      if (clients.size === 0) {
        roomClients.delete(roomId);
      }
    }

    // 批量更新 last_seen_at（SSE 连接在 = 用户在线，不应被踢出）
    if (userIdsToTouch.length > 0) {
      try {
        const stmt = getDb().prepare(
          `UPDATE online_room_members SET last_seen_at = ? WHERE room_id = ? AND user_id = ? AND status = 'joined'`,
        );
        for (const { roomId, userId } of userIdsToTouch) {
          stmt.run(now, roomId, userId);
        }
      } catch {
        // 数据库可能还没初始化，忽略
      }
    }

    // 没有任何连接时停止心跳
    if (roomClients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * 注册 SSE 客户端到指定房间
 */
export function addSSEClient(roomId: string, userId: number, res: Response): SSEClient {
  let clients = roomClients.get(roomId);
  if (!clients) {
    clients = new Set();
    roomClients.set(roomId, clients);
  }

  const client: SSEClient = { res, userId, connectedAt: Date.now() };
  clients.add(client);
  ensureHeartbeat();

  return client;
}

/**
 * 移除 SSE 客户端
 */
export function removeSSEClient(roomId: string, client: SSEClient): void {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) {
    roomClients.delete(roomId);
  }
}

/**
 * 获取房间内的 SSE 连接数
 */
export function getSSEClientCount(roomId: string): number {
  return roomClients.get(roomId)?.size || 0;
}

/**
 * 向房间内所有 SSE 客户端广播事件
 *
 * @param roomId 房间 ID
 * @param event 事件名称（对应前端 EventSource 的 event 字段）
 * @param data 事件数据（会被 JSON.stringify）
 * @param excludeUserId 可选，排除某个用户（避免操作者收到自己的广播）
 */
export function broadcastToRoom(
  roomId: string,
  event: string,
  data: unknown,
  excludeUserId?: number,
): void {
  const clients = roomClients.get(roomId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead: SSEClient[] = [];

  for (const client of clients) {
    if (excludeUserId !== undefined && client.userId === excludeUserId) continue;
    try {
      client.res.write(payload);
    } catch {
      dead.push(client);
    }
  }

  // 清理断开的连接
  for (const client of dead) {
    clients.delete(client);
  }
  if (clients.size === 0) {
    roomClients.delete(roomId);
  }
}

/**
 * 向房间内所有 SSE 客户端发送事件（包含操作者自己）
 */
export function broadcastToRoomAll(roomId: string, event: string, data: unknown): void {
  broadcastToRoom(roomId, event, data);
}

/**
 * 关闭房间的所有 SSE 连接（房间关闭时调用）
 */
export function closeRoomSSE(roomId: string): void {
  const clients = roomClients.get(roomId);
  if (!clients) return;

  const payload = `event: room_closed\ndata: {}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
      client.res.end();
    } catch {
      // ignore
    }
  }
  roomClients.delete(roomId);
}