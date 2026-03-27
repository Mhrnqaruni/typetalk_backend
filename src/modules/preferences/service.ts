import { PrismaClient } from "@prisma/client";

import { AppError } from "../../lib/app-error";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";
import { PreferencesRepository } from "./repository";
import {
  type AppProfileUpsertInput,
  preferenceDefaults,
  type DictionaryEntryInput,
  type UserPreferencesInput,
  type WritingProfileInput,
  type WritingProfilePatchInput
} from "./schemas";

export class PreferencesService {
  constructor(
    private readonly _prisma: PrismaClient,
    private readonly repository: PreferencesRepository
  ) {}

  async getPreferences(userId: string) {
    const preferences = await this.repository.findUserPreferences(userId);

    return this.serializePreferences(preferences);
  }

  async putPreferences(userId: string, input: UserPreferencesInput) {
    const preferences = await this.repository.upsertUserPreferences(userId, input);

    return this.serializePreferences(preferences);
  }

  async createDictionaryEntry(
    userId: string,
    organizationId: string,
    input: DictionaryEntryInput
  ) {
    const entry = await this.repository.createDictionaryEntry(userId, organizationId, input);

    return {
      entry: this.serializeDictionaryEntry(entry)
    };
  }

  async listDictionaryEntries(
    userId: string,
    organizationId: string,
    limit?: number,
    cursor?: string
  ) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ createdAt: string; id: string }>(cursor);
    const entries = await this.repository.listDictionaryEntries(
      userId,
      organizationId,
      resolvedLimit,
      decodedCursor
        ? {
            createdAt: new Date(decodedCursor.createdAt),
            id: decodedCursor.id
          }
        : undefined
    );

    const hasNextPage = entries.length > resolvedLimit;
    const pageItems = hasNextPage ? entries.slice(0, resolvedLimit) : entries;
    const nextItem = pageItems[pageItems.length - 1];

    return {
      items: pageItems.map((entry) => this.serializeDictionaryEntry(entry)),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            createdAt: nextItem.createdAt.toISOString(),
            id: nextItem.id
          })
        : null
    };
  }

  async updateDictionaryEntry(
    userId: string,
    organizationId: string,
    entryId: string,
    input: DictionaryEntryInput
  ) {
    const entry = await this.repository.updateDictionaryEntry(
      userId,
      organizationId,
      entryId,
      input
    );

    if (!entry) {
      throw new AppError(404, "dictionary_entry_not_found", "Dictionary entry was not found.");
    }

    return {
      entry: this.serializeDictionaryEntry(entry)
    };
  }

  async deleteDictionaryEntry(
    userId: string,
    organizationId: string,
    entryId: string
  ): Promise<void> {
    const deleted = await this.repository.deleteDictionaryEntry(userId, organizationId, entryId);

    if (!deleted) {
      throw new AppError(404, "dictionary_entry_not_found", "Dictionary entry was not found.");
    }
  }

  async createWritingProfile(
    userId: string,
    organizationId: string,
    input: WritingProfileInput
  ) {
    const profile = await this.repository.createWritingProfile(userId, organizationId, input);

    return {
      profile: this.serializeWritingProfile(profile)
    };
  }

  async listWritingProfiles(
    userId: string,
    organizationId: string,
    limit?: number,
    cursor?: string
  ) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ id: string }>(cursor);
    const profiles = await this.repository.listWritingProfiles(
      userId,
      organizationId,
      resolvedLimit,
      decodedCursor
        ? {
            id: decodedCursor.id
          }
        : undefined
    );

    const hasNextPage = profiles.length > resolvedLimit;
    const pageItems = hasNextPage ? profiles.slice(0, resolvedLimit) : profiles;
    const nextItem = pageItems[pageItems.length - 1];

    return {
      items: pageItems.map((profile) => this.serializeWritingProfile(profile)),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            id: nextItem.id
          })
        : null
    };
  }

  async updateWritingProfile(
    userId: string,
    organizationId: string,
    profileId: string,
    input: WritingProfilePatchInput
  ) {
    const profile = await this.repository.updateWritingProfile(
      userId,
      organizationId,
      profileId,
      input
    );

    if (!profile) {
      throw new AppError(404, "writing_profile_not_found", "Writing profile was not found.");
    }

    return {
      profile: this.serializeWritingProfile(profile)
    };
  }

  async listAppProfiles(
    userId: string,
    organizationId: string,
    limit?: number,
    cursor?: string
  ) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ id: string }>(cursor);
    const profiles = await this.repository.listAppProfiles(
      userId,
      organizationId,
      resolvedLimit,
      decodedCursor
        ? {
            id: decodedCursor.id
          }
        : undefined
    );

    const hasNextPage = profiles.length > resolvedLimit;
    const pageItems = hasNextPage ? profiles.slice(0, resolvedLimit) : profiles;
    const nextItem = pageItems[pageItems.length - 1];

    return {
      items: pageItems.map((profile) => this.serializeAppProfile(profile)),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            id: nextItem.id
          })
        : null
    };
  }

  async upsertAppProfile(
    userId: string,
    organizationId: string,
    appKey: string,
    input: AppProfileUpsertInput
  ) {
    if (input.writingProfileId) {
      const writingProfile = await this.repository.findOwnedWritingProfile(
        userId,
        organizationId,
        input.writingProfileId
      );

      if (!writingProfile) {
        throw new AppError(404, "writing_profile_not_found", "Writing profile was not found.");
      }
    }

    const profile = await this.repository.upsertAppProfile(userId, organizationId, appKey, input);

    return {
      profile: this.serializeAppProfile(profile)
    };
  }

  private serializePreferences(
    preferences:
      | {
          defaultLanguage: string;
          autoPunctuation: boolean;
          removeFillers: boolean;
          autoFormat: boolean;
        }
      | null
  ) {
    return {
      default_language: preferences?.defaultLanguage ?? preferenceDefaults.default_language,
      auto_punctuation: preferences?.autoPunctuation ?? preferenceDefaults.auto_punctuation,
      remove_fillers: preferences?.removeFillers ?? preferenceDefaults.remove_fillers,
      auto_format: preferences?.autoFormat ?? preferenceDefaults.auto_format
    };
  }

  private serializeDictionaryEntry(entry: {
    id: string;
    phrase: string;
    createdAt: Date;
  }) {
    return {
      id: entry.id,
      phrase: entry.phrase,
      created_at: entry.createdAt.toISOString()
    };
  }

  private serializeWritingProfile(profile: {
    id: string;
    name: string;
    tone: string;
    rulesJson: unknown;
  }) {
    return {
      id: profile.id,
      name: profile.name,
      tone: profile.tone,
      rules_json: profile.rulesJson
    };
  }

  private serializeAppProfile(profile: {
    id: string;
    appKey: string;
    writingProfileId: string | null;
    settingsJson: unknown;
  }) {
    return {
      id: profile.id,
      app_key: profile.appKey,
      writing_profile_id: profile.writingProfileId,
      settings_json: profile.settingsJson
    };
  }
}
