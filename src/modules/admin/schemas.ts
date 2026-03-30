import { BillingProvider, SubscriptionStatus, UsageEventStatus } from "@prisma/client";
import { z } from "zod";

export const adminUserParamsSchema = z.object({
  userId: z.string().trim().min(1)
});

export const adminSubscriptionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
  organization_id: z.string().trim().min(1).optional(),
  user_id: z.string().trim().min(1).optional(),
  provider: z.nativeEnum(BillingProvider).optional(),
  status: z.nativeEnum(SubscriptionStatus).optional()
});

export const adminUsageQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional(),
  organization_id: z.string().trim().min(1).optional(),
  user_id: z.string().trim().min(1).optional(),
  feature_code: z.string().trim().min(1).optional(),
  status: z.nativeEnum(UsageEventStatus).optional()
});
