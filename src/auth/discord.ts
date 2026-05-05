import { config } from '../config';

const DISCORD_API = 'https://discord.com/api/v10';

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordGuild {
  id: string;
  name: string;
}

/** 生成 Discord OAuth2 授权 URL */
export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** 用授权码换取 access_token */
export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const resp = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.discord.redirectUri,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord token exchange failed: ${resp.status} ${text}`);
  }

  return resp.json() as Promise<DiscordTokenResponse>;
}

/** 获取 Discord 用户信息 */
export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  const resp = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to get Discord user: ${resp.status}`);
  }

  return resp.json() as Promise<DiscordUser>;
}

/** 获取用户加入的服务器列表 */
export async function getUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const resp = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to get user guilds: ${resp.status}`);
  }

  return resp.json() as Promise<DiscordGuild[]>;
}

/** 检查用户是否在允许的服务器中（至少在其中一个） */
export async function isInAllowedGuild(accessToken: string): Promise<boolean> {
  if (config.discord.guildIds.length === 0) return true; // 未配置则不限制

  const guilds = await getUserGuilds(accessToken);
  const userGuildIds = new Set(guilds.map(g => g.id));

  return config.discord.guildIds.some(id => userGuildIds.has(id));
}

/** 获取 Discord 头像 URL */
export function getAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  // 默认头像
  const defaultIndex = (BigInt(user.id) >> BigInt(22)) % BigInt(6);
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}