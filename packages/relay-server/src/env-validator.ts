import { validateRelayRuntimeEnv } from "@yuanio/shared";
import { logger } from "./logger";

export function validateEnvironment(): void {
  const errors = validateRelayRuntimeEnv({ env: process.env, startDir: import.meta.dir });

  if (errors.length > 0) {
    logger.error("Environment validation failed:");
    errors.forEach(err => logger.error(`  - ${err}`));
    throw new Error(`Environment validation failed: ${errors.join(", ")}`);
  }

  logger.info("Environment validation passed");
}
