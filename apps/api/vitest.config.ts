import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://eszy_app:app@localhost:5432/eszy_test",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      LOG_LEVEL: process.env.LOG_LEVEL ?? "silent",
      BASE_DOMAIN: "eszy.test",
    },
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
