// 延迟读取环境变量（确保 Zeabur 运行时注入的变量能被正确读取）
function env(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

function envList(key: string): string[] {
  return (process.env[key] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
}

// 使用 getter 确保每次访问都从环境变量中读取最新值
export const config = {
  get port() { return parseInt(env('PORT', '8080'), 10); },
  get baseUrl() { return env('BASE_URL', 'http://localhost:8080'); },

  discord: {
    get clientId() { return env('DISCORD_CLIENT_ID'); },
    get clientSecret() { return env('DISCORD_CLIENT_SECRET'); },
    get guildIds() { return envList('DISCORD_GUILD_IDS'); },
    get redirectUri() { return `${env('BASE_URL', 'http://localhost:8080')}/auth/discord/callback`; },
  },

  get adminDiscordIds() { return envList('ADMIN_DISCORD_IDS'); },
  get sessionSecret() { return env('SESSION_SECRET', 'workshop-default-secret-change-me'); },
  get fingerprintSecret() { return env('FINGERPRINT_SECRET', env('SESSION_SECRET', 'workshop-default-secret-change-me')); },
  get dataDir() { return env('DATA_DIR', '/data'); },

  maxFileSize: 5 * 1024 * 1024,
  maxContentSize: 1024 * 1024,
};
