import { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false, enableOfflineQueue: true })
  : null;
redis?.on("error", (e) => logger.warn({ err: e.message }, "redis error"));
