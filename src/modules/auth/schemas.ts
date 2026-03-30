import { z } from "zod";

import { devicePayloadSchema } from "../devices/schemas";

export const challengePurposeSchema = z.enum(["SIGN_IN"]);

export const requestEmailCodeSchema = z.object({
  email: z.string().email(),
  purpose: challengePurposeSchema.optional()
}).strict();

export const verifyEmailCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  purpose: challengePurposeSchema.optional(),
  device: devicePayloadSchema.optional()
}).strict();

export const googleSignInSchema = z.object({
  id_token: z.string().min(1),
  device: devicePayloadSchema.optional()
}).strict();

export const linkGoogleSchema = z.object({
  id_token: z.string().min(1)
}).strict();

export const refreshSchema = z.object({
  refresh_token: z.string().min(1)
}).strict();

export const emptyPayloadSchema = z.object({}).strict();
