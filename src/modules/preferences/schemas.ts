import { z } from "zod";

import { createBoundedJsonObjectSchema } from "../../lib/json-bounds";

export const preferenceDefaults = {
  default_language: "auto",
  auto_punctuation: true,
  remove_fillers: false,
  auto_format: true
} as const;

export const preferencesPutSchema = z.object({
  default_language: z.string().min(1).max(32),
  auto_punctuation: z.boolean(),
  remove_fillers: z.boolean(),
  auto_format: z.boolean()
}).strict();

export const syncListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional()
}).strict();

export const dictionaryCreateSchema = z.object({
  phrase: z.string().trim().min(1).max(500)
}).strict();

export const writingProfileCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  tone: z.string().trim().min(1).max(120),
  rules_json: createBoundedJsonObjectSchema("rules_json")
}).strict();

export const writingProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  tone: z.string().trim().min(1).max(120).optional(),
  rules_json: createBoundedJsonObjectSchema("rules_json").optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one writing profile field must be provided."
});

export const appProfileUpsertSchema = z.object({
  writing_profile_id: z.string().trim().min(1).max(64).nullable().optional(),
  settings_json: createBoundedJsonObjectSchema("settings_json")
}).strict();

export interface UserPreferencesInput {
  defaultLanguage: string;
  autoPunctuation: boolean;
  removeFillers: boolean;
  autoFormat: boolean;
}

export function mapPreferencesPayload(
  payload: z.infer<typeof preferencesPutSchema>
): UserPreferencesInput {
  return {
    defaultLanguage: payload.default_language,
    autoPunctuation: payload.auto_punctuation,
    removeFillers: payload.remove_fillers,
    autoFormat: payload.auto_format
  };
}

export interface DictionaryEntryInput {
  phrase: string;
}

export function mapDictionaryPayload(
  payload: z.infer<typeof dictionaryCreateSchema>
): DictionaryEntryInput {
  return {
    phrase: payload.phrase.trim()
  };
}

export interface WritingProfileInput {
  name: string;
  tone: string;
  rulesJson: Record<string, unknown>;
}

export interface WritingProfilePatchInput {
  name?: string;
  tone?: string;
  rulesJson?: Record<string, unknown>;
}

export function mapWritingProfilePayload(
  payload: z.infer<typeof writingProfileCreateSchema>
): WritingProfileInput {
  return {
    name: payload.name.trim(),
    tone: payload.tone.trim(),
    rulesJson: payload.rules_json
  };
}

export function mapWritingProfilePatchPayload(
  payload: z.infer<typeof writingProfilePatchSchema>
): WritingProfilePatchInput {
  return {
    ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
    ...(payload.tone !== undefined ? { tone: payload.tone.trim() } : {}),
    ...(payload.rules_json !== undefined ? { rulesJson: payload.rules_json } : {})
  };
}

export interface AppProfileUpsertInput {
  writingProfileId?: string | null;
  settingsJson: Record<string, unknown>;
}

export function mapAppProfilePayload(
  payload: z.infer<typeof appProfileUpsertSchema>
): AppProfileUpsertInput {
  return {
    ...(payload.writing_profile_id !== undefined
      ? { writingProfileId: payload.writing_profile_id }
      : {}),
    settingsJson: payload.settings_json
  };
}
