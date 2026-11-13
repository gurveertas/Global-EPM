import { createApp } from "./app";
import { env } from "./lib/env";
import { logger } from "./lib/logger";

createApp().listen(env.PORT, () => logger.info(`eszy API on :${env.PORT}`));
