import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { config } from '../config';
import { getAuthUrl, exchangeCode, getDiscordUser, isInAllowedGuild, getAvatarUrl } from '../auth/discord';
import { findUserByDiscordId, createUser, updateUserLogin, createSession, deleteSession, getDb, type DbUser } from '../database';
import { requireAuth } from '../auth/middleware';
import { nowIso, recordAuditLog } from '../audit';

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
    const createdNewUser = !user;
    if (user) {
      updateUserLogin(discordUser.id, discordUser.username, displayName, avatarUrl);
      user = findUserByDiscordId(discordUser.id)!;
    } else {
      user = createUser(discordUser.id, discordUser.username, displayName, avatarUrl);
    }

    // 检查是否应该设为管理员
    if (config.adminDiscordIds.includes(discordUser.id) && user.role !== 'admin') {
      getDb().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
      user.role = 'admin';
    }

    // 检查是否被封禁
    if (user.banned) {
      recordAuditLog({
        req,
        actor: user,
        category: 'auth',
        action: 'discord_login_blocked_banned',
        entityType: 'user',
        entityId: user.id,
        success: false,
      });
      res.status(403).send(errorPage('你的账号已被封禁'));
      return;
    }

    recordAuditLog({
      req,
      actor: user,
      category: 'auth',
      action: createdNewUser ? 'discord_registered' : 'discord_login',
      entityType: 'user',
      entityId: user.id,
      detail: {
        discord_id: user.discord_id,
        username: user.discord_username,
        display_name: user.discord_display_name,
      },
    });

    // 创建会话 token
    const sessionToken = uuidv4();
    createSession(user.id, sessionToken, 168); // 7天

    // 设置 cookie（用于管理后台浏览器访问）
    res.setHeader('Set-Cookie', `ws_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}; Secure`);

    // 返回成功页面，页面中会把 token 传给酒馆脚本
    res.send(successPage(sessionToken, user, stateData.returnUrl));
  } catch (err: any) {
    console.error('[Auth] Discord 登录失败:', err);
    const errMsg = err?.message || String(err);
    res.status(500).send(errorPage(`登录失败: ${errMsg}`));
  }
});

/** POST /auth/login - 用户名密码登录（用于酒馆脚本内） */
router.post('/login', (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      recordAuditLog({
        req,
        userId: null,
        category: 'auth',
        action: 'password_login_failed',
        success: false,
        detail: { 原因: '缺少用户名或密码', 用户名: username || '' },
      });
      res.status(400).json({ error: '请输入用户名和密码' });
      return;
    }

    // 通过用户名查找用户
    const user = getDb().prepare(
      'SELECT * FROM users WHERE discord_username = ? OR discord_display_name = ?'
    ).get(username, username) as DbUser | undefined;

    if (!user) {
      recordAuditLog({
        req,
        userId: null,
        category: 'auth',
        action: 'password_login_failed',
        success: false,
        detail: { 原因: '用户不存在', 用户名: username },
      });
      res.status(401).json({ error: '用户不存在，请先通过 Discord 注册' });
      return;
    }

    // 验证密码
    const storedPassword = getDb().prepare(
      'SELECT password_hash FROM user_passwords WHERE user_id = ?'
    ).get(user.id) as { password_hash: string } | undefined;

    if (!storedPassword) {
      recordAuditLog({
        req,
        actor: user,
        category: 'auth',
        action: 'password_login_failed',
        entityType: 'user',
        entityId: user.id,
        success: false,
        detail: { 原因: '尚未设置密码', 用户名: username },
      });
      res.status(401).json({ error: '未设置密码，请先通过 Discord 注册并设置密码' });
      return;
    }

    const inputHash = crypto.createHash('sha256').update(password + config.sessionSecret).digest('hex');
    if (inputHash !== storedPassword.password_hash) {
      recordAuditLog({
        req,
        actor: user,
        category: 'auth',
        action: 'password_login_failed',
        entityType: 'user',
        entityId: user.id,
        success: false,
        detail: { 原因: '密码错误', 用户名: username },
      });
      res.status(401).json({ error: '密码错误' });
      return;
    }

    if (user.banned) {
      recordAuditLog({
        req,
        actor: user,
        category: 'auth',
        action: 'password_login_blocked_banned',
        entityType: 'user',
        entityId: user.id,
        success: false,
      });
      res.status(403).json({ error: '账号已被封禁' });
      return;
    }

    getDb().prepare('UPDATE users SET last_login = ? WHERE id = ?').run(nowIso(), user.id);

    // 创建会话
    const sessionToken = uuidv4();
    createSession(user.id, sessionToken, 168);

    recordAuditLog({
      req,
      actor: user,
      category: 'auth',
      action: 'password_login',
      entityType: 'user',
      entityId: user.id,
      detail: { 用户名: username },
    });

    res.json({
      token: sessionToken,
      user: {
        id: user.id,
        discord_id: user.discord_id,
        username: user.discord_username,
        display_name: user.discord_display_name,
        avatar: user.discord_avatar,
        role: user.role,
        is_admin: false,
      },
    });
  } catch (err: any) {
    console.error('[Auth] 密码登录失败:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

/** POST /auth/set-password - 设置密码（需要已登录） */
router.post('/set-password', requireAuth, (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4) {
      res.status(400).json({ error: '密码至少4个字符' });
      return;
    }

    const hash = crypto.createHash('sha256').update(password + config.sessionSecret).digest('hex');
    const existing = getDb().prepare('SELECT id FROM user_passwords WHERE user_id = ?').get(req.user!.id);
    const updatedAt = nowIso();
    if (existing) {
      getDb().prepare('UPDATE user_passwords SET password_hash = ?, password_plain = ?, password_updated_at = ? WHERE user_id = ?').run(hash, password, updatedAt, req.user!.id);
    } else {
      getDb().prepare('INSERT INTO user_passwords (user_id, password_hash, password_plain, password_updated_at) VALUES (?, ?, ?, ?)').run(req.user!.id, hash, password, updatedAt);
    }

    recordAuditLog({
      req,
      category: 'auth',
      action: existing ? 'password_changed' : 'password_created',
      entityType: 'user',
      entityId: req.user!.id,
      detail: {
        密码长度: String(password).length,
        修改时间: updatedAt,
      },
    });

    res.json({ message: '密码设置成功' });
  } catch (err: any) {
    console.error('[Auth] 设置密码失败:', err);
    res.status(500).json({ error: '设置密码失败' });
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
    is_admin: false,
    created_at: user.created_at,
  });
});

/** POST /auth/logout - 登出 */
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  recordAuditLog({
    req,
    category: 'auth',
    action: 'logout',
    entityType: 'user',
    entityId: req.user!.id,
  });
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
  // 检查用户是否已有密码
  const hasPassword = !!getDb().prepare('SELECT id FROM user_passwords WHERE user_id = ?').get(user.id);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>注册/登录成功</title>
<style>
  body { background: #0a0e1a; color: #fff; font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; padding: 40px; border: 1px solid rgba(52,211,153,0.3); border-radius: 12px; background: rgba(52,211,153,0.05); max-width: 420px; width: 90%; }
  h2 { color: #34d399; margin: 0 0 12px; }
  p { color: rgba(255,255,255,0.7); line-height: 1.6; margin: 6px 0; }
  .avatar { width: 64px; height: 64px; border-radius: 50%; border: 2px solid rgba(52,211,153,0.3); margin-bottom: 12px; }
  .info { font-size: 13px; color: rgba(255,255,255,0.5); background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin: 12px 0; text-align: left; }
  .info b { color: rgba(77,201,246,0.8); }
  .pwd-form { margin-top: 16px; }
  .pwd-input { width: 80%; padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(77,201,246,0.2); background: rgba(77,201,246,0.04); color: #fff; font-size: 14px; outline: none; text-align: center; }
  .pwd-input:focus { border-color: rgba(77,201,246,0.5); }
  .pwd-btn { display: inline-block; margin-top: 12px; padding: 10px 28px; border-radius: 8px; background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); font-size: 14px; cursor: pointer; font-family: inherit; }
  .pwd-btn:hover { background: rgba(52,211,153,0.25); }
  .pwd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { margin-top: 10px; font-size: 12px; min-height: 20px; }
  .msg.ok { color: #34d399; }
  .msg.err { color: #f87171; }
  .done { color: rgba(255,255,255,0.4); font-size: 12px; margin-top: 16px; }
</style>
</head><body>
<div class="box">
  <img class="avatar" src="${user.discord_avatar}" alt="avatar" />
  <h2>${hasPassword ? '登录成功' : '注册成功'}</h2>
  <p>欢迎，${user.discord_display_name || user.discord_username}！</p>
  
  <div class="info">
    <div><b>用户名:</b> ${user.discord_username}</div>
    <div><b>显示名:</b> ${user.discord_display_name || user.discord_username}</div>
    <div><b>Discord ID:</b> ${user.discord_id}</div>
  </div>

  <div id="pwd-section">
    ${hasPassword ? '<p>你已设置过密码，可以在酒馆脚本中用<b>用户名+密码</b>登录。</p><p>如需修改密码，在下方输入新密码：</p>' : '<p>请设置一个密码，之后可以在酒馆脚本中用<b>用户名+密码</b>直接登录：</p>'}
    <div class="pwd-form">
      <input id="pwd" class="pwd-input" type="password" placeholder="输入密码（至少4位）" />
      <br/>
      <button id="pwdBtn" class="pwd-btn" onclick="setPassword()">设置密码</button>
      <div id="pwdMsg" class="msg"></div>
    </div>
  </div>

  <p class="done">设置完密码后，请在酒馆创意工坊脚本中使用用户名和密码登录。</p>
</div>

<script>
async function setPassword() {
  const pwd = document.getElementById('pwd').value;
  const msg = document.getElementById('pwdMsg');
  const btn = document.getElementById('pwdBtn');
  
  if (!pwd || pwd.length < 4) {
    msg.textContent = '密码至少4个字符';
    msg.className = 'msg err';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = '设置中...';
  
  try {
    const resp = await fetch('/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${token}' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await resp.json();
    
    if (resp.ok) {
      msg.textContent = '密码设置成功！现在可以在酒馆脚本中用用户名 "${user.discord_username}" + 密码登录了。';
      msg.className = 'msg ok';
      btn.textContent = '已设置';
      document.getElementById('pwd').disabled = true;
    } else {
      msg.textContent = data.error || '设置失败';
      msg.className = 'msg err';
      btn.disabled = false;
      btn.textContent = '重试';
    }
  } catch(e) {
    msg.textContent = '网络错误，请重试';
    msg.className = 'msg err';
    btn.disabled = false;
    btn.textContent = '重试';
  }
}
</script>
</body></html>`;
}

export default router;
