import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  url: string | undefined;
  terminalUrl: string | undefined;
  toolRegistryUrl: string | undefined;
}

export const redisConfig = registerAs<RedisConfig>('redis', () => ({
  url: process.env.REDIS_URL,
  terminalUrl: process.env.TERMINAL_REDIS_URL,
  toolRegistryUrl: process.env.TOOL_REGISTRY_REDIS_URL,
}));
