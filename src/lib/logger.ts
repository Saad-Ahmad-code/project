/**
 * Shared pino logger — import { logger } from '@/lib/logger'.
 * Level controlled by LOG_LEVEL env var (default: info).
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});
