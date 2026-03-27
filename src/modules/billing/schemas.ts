import { z } from "zod";

export const checkoutSessionCreateSchema = z.object({
  plan_code: z.string().trim().min(1).max(64),
  success_url: z.string().url(),
  cancel_url: z.string().url()
});

export const customerPortalCreateSchema = z.object({
  return_url: z.string().url()
});

export const googlePlaySubscriptionActionSchema = z.object({
  purchase_token: z.string().trim().min(1).max(512),
  product_id: z.string().trim().min(1).max(255),
  base_plan_id: z.string().trim().min(1).max(255).nullable().optional()
});

export const billingInvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().trim().min(1).optional()
});

export type CheckoutSessionCreateBody = z.infer<typeof checkoutSessionCreateSchema>;
export type CustomerPortalCreateBody = z.infer<typeof customerPortalCreateSchema>;
export type GooglePlaySubscriptionActionBody = z.infer<typeof googlePlaySubscriptionActionSchema>;
export type BillingInvoicesQuery = z.infer<typeof billingInvoicesQuerySchema>;
