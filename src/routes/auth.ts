import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getAuthUrl, exchangeCode, getDiscordUser, isInAllowedGuild, getAvatarUrl } from '../auth/discord';
import { findUserByDiscordId, createUser, updateUserLogin, createSession, deleteSession, isAdmin, getDb, type DbUser } from '../database';
import { requireAuth } from '../auth/middleware';

const router = Router();

// 存储 OAuth state（简单内存存储，防 CSRF）
const pendingStates = new Map<string, { createdAt: number; returnUrl?: string }>();

// 定期清理过期 state
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingStates.delete(key);
  }
}, 60 * 1000);

/** GET /auth/discord - 开始 Discord 登录流程 */
router.get('/discord', (req: Request, res: Response) => {
  const state = uuidv4();
  const returnUrl = req.query.return_url as string | undefined;
  pendingStates.set(state, { createdAt: Date.now(), returnUrl });

  const authUrl = getAuthUrl(state);
  res.redirect(authUrl);
});

/** GET /auth/discord/callback - Discord 登录回调 */
router.get('/discord/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).send(errorPage('缺少授权码'));
      return;
    }

    if (!state || typeof state !== 'string' || !pendingStates.has(state)) {
      res.status(400).send(errorPage('无效的授权状态，请重新登录'));
      return;
    }

    const stateData = pendingStates.get(state)!;
    pendingStates.delete(state);

    // 用授权码换取 token
    const tokenData = await exchangeCode(code);

    // 获取用户信息
    const discordUser = await getDiscordUser(tokenData.access_token);

    // 检查是否在允许的服务器中
    const inGuild = await isInAllowedGuild(tokenData.access_token);
    if (!inGuild) {
      res.status(403).send(errorPage(
        '你还不是指定 Discord 服务器的成员，无法使用创意工坊。请先加入服务器后重试。'
      ));
      return;
    }

    // 创建或更新用户
    const avatarUrl = getAvatarUrl(discordUser);
    const displayName = discordUser.global_name || discordUser.username;
    let user = findUserByDiscordId(discordUser.id);
    if (user) {
      updateUserLogin(discordUser.id, discordUser.username, displayName, avatarUrl);
      user = findUserByDiscordId(discordUser.id)!;
    } else {
      user = createUser(discordUser.id, discordUser.username, displayName, avatarUrl);
    }

    // 检查是否应该设为管理员
    if (config.adminDiscordIds.includes(discordUser.id) && user.role !== 'admin') {
      getDb().prepare('UPDATE users SET role = "admin" WHERE id = ?').run(user.id);
      user.role = 'admin';
    }

    // 检查是否被封禁
    if (user.banned) {
      res.status(403).send(errorPage('你的账号已被封禁'));
      return;
    }

    // 创建会话 token
    const sessionToken = uuidv4();
    createSession(user.id, sessionToken, 168); // 7天

    // 返回成功页面，页面中会把 token 传给酒馆脚本
    res.send(successPage(sessionToken, user, stateData.returnUrl));
  } catch (err: any) {
    console.error('[Auth] Discord 登录失败:', err);
    const errMsg = err?.message || String(err);
    res.status(500).send(errorPage(`登录失败: ${errMsg}`));
  }
});

/** GET /auth/me - 获取当前用户信息 */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  res.json({
    id: user.id,
    discord_id: user.discord_id,
    username: user.discord_username,
    display_name: user.discord_display_name,
    avatar: user.discord_avatar,
    role: user.role,
    is_admin: isAdmin(user),
    created_at: user.created_at,
  });
});

/** POST /auth/logout - 登出 */
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  if (req.sessionToken) {
    deleteSession(req.sessionToken);
  }
  res.json({ ok: true });
});

// ─── 辅助函数：生成 HTML 页面 ───

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>登录失败</title>
<style>
  body { background: #0a0e1a; color: #fff; font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; padding: 40px; border: 1px solid rgba(248,113,113,0.3); border-radius: 12px; background: rgba(248,113,113,0.05); max-width: 400px; }
  h2 { color: #f87171; margin: 0 0 16px; }
  p { color: rgba(255,255,255,0.7); line-height: 1.6; }
  .btn { display: inline-block; margin-top: 20px; padding: 10px 24px; border-radius: 8px; background: rgba(77,201,246,0.15); color: #4dc9f6; text-decoration: none; border: 1px solid rgba(77,201,246,0.3); }
</style>
</head><body>
<div class="box">
  <h2>登录失败</h2>
  <p>${message}</p>
  <a class="btn" href="javascript:window.close()">关闭窗口</a>
</div>
</body></html>`;
}

function successPage(token: string, user: DbUser, returnUrl?: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>登录成功</title>
<style>
  body { background: #0a0e1a; color: #fff; font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; padding: 40px; border: 1px solid rgba(52,211,153,0.3); border-radius: 12px; background: rgba(52,211,153,0.05); max-width: 400px; }
  h2 { color: #34d399; margin: 0 0 16px; }
  p { color: rgba(255,255,255,0.7); line-height: 1.6; }
  .avatar { width: 64px; height: 64px; border-radius: 50%; border: 2px solid rgba(52,211,153,0.3); margin-bottom: 12px; }
  .token { font-family: monospace; font-size: 10px; color: rgba(255,255,255,0.3); word-break: break-all; margin-top: 12px; }
</style>
<script>
  // 将 token 通过 postMessage 传递给酒馆脚本
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'WORKSHOP_AUTH', token: '${token}' }, '*');
      setTimeout(() => window.close(), 2000);
    }
  } catch(e) { console.error(e); }
</script>
</head><body>
<div class="box">
  <img class="avatar" src="${user.discord_avatar}" alt="avatar" />
  <h2>登录成功</h2>
  <p>欢迎，${user.discord_display_name || user.discord_username}！</p>
  <p>此窗口将自动关闭，请返回酒馆继续操作。</p>
  <p class="token">如果窗口没有自动关闭，请手动关闭此页面。</p>
</div>
</body></html>`;
}

export default router;