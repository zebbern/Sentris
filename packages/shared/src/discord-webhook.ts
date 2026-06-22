const ALLOWED_DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);
const DISCORD_WEBHOOK_PATH = /^\/api\/webhooks\/\d+\/[\w-]+$/;

export function isValidDiscordWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (!ALLOWED_DISCORD_HOSTS.has(parsed.hostname)) return false;
    if (!DISCORD_WEBHOOK_PATH.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function validateDiscordWebhookUrlFormat(url: string): void {
  if (!isValidDiscordWebhookUrl(url)) {
    throw new Error(
      'Webhook URL must be a valid Discord HTTPS webhook (discord.com/api/webhooks/{id}/{token})',
    );
  }
}
