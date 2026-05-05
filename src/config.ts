// 从环境变量读取配置
export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  // Discord OAuth2
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    // 允许的 Discord 服务器 ID（逗号分隔）
    guildIds: (process.env.DISCORD_GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    redirectUri: '', // 运行时计算
  },

  // 管理员 Discord ID（逗号分隔）
  adminDiscordIds: (process.env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean),

  // 会话密钥
  sessionSecret: process.env.SESSION_SECRET || 'workshop-default-secret-change-me',

  // 数据存储路径（Zeabur 持久化磁盘挂载点）
  dataDir: process.env.DATA_DIR || '/data',

  // 上传限制
  maxFileSize: 5 * 1024 * 1024, // 5MB 封面图
  maxContentSize: 1024 * 1024,   // 1MB 文本内容
};

// 运行时计算重定向 URI
config.discord.redirectUri = `${config.baseUrl}/auth/discord/callback`;