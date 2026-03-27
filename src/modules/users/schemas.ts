import { z } from "zod";

export const patchMeSchema = z.object({
  display_name: z.string().trim().min(1).max(100).nullable().optional(),
  avatar_url: z.string().url().nullable().optional()
}).strict();

export const sessionListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  cursor: z.string().min(1).optional()
}).strict();

export const deleteSessionParamsSchema = z.object({
  sessionId: z.string().min(1)
}).strict();
