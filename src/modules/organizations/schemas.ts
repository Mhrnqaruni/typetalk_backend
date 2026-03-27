import { z } from "zod";

export const organizationMembersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  cursor: z.string().min(1).optional()
}).strict();
