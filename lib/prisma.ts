import { PrismaClient } from "@prisma/client";

/**
 * Shared singleton across the app. Every route/page previously did its own
 * `new PrismaClient()` at module scope — harmless in production (one
 * process, one load), but in Next.js dev mode each fast-refresh reload
 * re-evaluates those modules and opens a fresh connection pool without
 * closing the old one, eventually exhausting Supabase's pooler
 * ("max clients reached in session mode"). Stashing the instance on
 * `globalThis` in dev survives module reloads, matching Prisma's own
 * recommended Next.js pattern.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
