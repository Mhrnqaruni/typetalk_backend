import { Prisma, PrismaClient } from "@prisma/client";

import type {
  AppProfileUpsertInput,
  DictionaryEntryInput,
  UserPreferencesInput,
  WritingProfileInput,
  WritingProfilePatchInput
} from "./schemas";

type DbClient = PrismaClient | Prisma.TransactionClient;

function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class PreferencesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserPreferences(userId: string, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.userPreference.findUnique({
      where: {
        userId
      }
    });
  }

  async upsertUserPreferences(
    userId: string,
    input: UserPreferencesInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.userPreference.upsert({
      where: {
        userId
      },
      update: {
        defaultLanguage: input.defaultLanguage,
        autoPunctuation: input.autoPunctuation,
        removeFillers: input.removeFillers,
        autoFormat: input.autoFormat
      },
      create: {
        userId,
        defaultLanguage: input.defaultLanguage,
        autoPunctuation: input.autoPunctuation,
        removeFillers: input.removeFillers,
        autoFormat: input.autoFormat
      }
    });
  }

  async createDictionaryEntry(
    userId: string,
    organizationId: string,
    input: DictionaryEntryInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.dictionaryEntry.create({
      data: {
        userId,
        organizationId,
        phrase: input.phrase
      }
    });
  }

  async listDictionaryEntries(
    userId: string,
    organizationId: string,
    limit: number,
    cursor?: {
      createdAt: Date;
      id: string;
    },
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.dictionaryEntry.findMany({
      where: {
        userId,
        organizationId,
        ...(cursor
          ? {
              OR: [
                {
                  createdAt: {
                    lt: cursor.createdAt
                  }
                },
                {
                  createdAt: cursor.createdAt,
                  id: {
                    lt: cursor.id
                  }
                }
              ]
            }
          : {})
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" }
      ],
      take: limit + 1
    });
  }

  async updateDictionaryEntry(
    userId: string,
    organizationId: string,
    entryId: string,
    input: DictionaryEntryInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;
    const updateResult = await client.dictionaryEntry.updateMany({
      where: {
        id: entryId,
        userId,
        organizationId
      },
      data: {
        phrase: input.phrase
      }
    });

    if (updateResult.count !== 1) {
      return null;
    }

    return client.dictionaryEntry.findUnique({
      where: {
        id: entryId
      }
    });
  }

  async deleteDictionaryEntry(
    userId: string,
    organizationId: string,
    entryId: string,
    transaction?: DbClient
  ): Promise<boolean> {
    const client = transaction ?? this.prisma;
    const deleteResult = await client.dictionaryEntry.deleteMany({
      where: {
        id: entryId,
        userId,
        organizationId
      }
    });

    return deleteResult.count === 1;
  }

  async createWritingProfile(
    userId: string,
    organizationId: string,
    input: WritingProfileInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.writingProfile.create({
      data: {
        userId,
        organizationId,
        name: input.name,
        tone: input.tone,
        rulesJson: toJsonInput(input.rulesJson)
      }
    });
  }

  async listWritingProfiles(
    userId: string,
    organizationId: string,
    limit: number,
    cursor?: {
      id: string;
    },
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.writingProfile.findMany({
      where: {
        userId,
        organizationId,
        ...(cursor
          ? {
              id: {
                lt: cursor.id
              }
            }
          : {})
      },
      orderBy: [
        { id: "desc" }
      ],
      take: limit + 1
    });
  }

  async findOwnedWritingProfile(
    userId: string,
    organizationId: string,
    profileId: string,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.writingProfile.findFirst({
      where: {
        id: profileId,
        userId,
        organizationId
      }
    });
  }

  async updateWritingProfile(
    userId: string,
    organizationId: string,
    profileId: string,
    input: WritingProfilePatchInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;
    const updateResult = await client.writingProfile.updateMany({
      where: {
        id: profileId,
        userId,
        organizationId
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tone !== undefined ? { tone: input.tone } : {}),
        ...(input.rulesJson !== undefined ? { rulesJson: toJsonInput(input.rulesJson) } : {})
      }
    });

    if (updateResult.count !== 1) {
      return null;
    }

    return client.writingProfile.findUnique({
      where: {
        id: profileId
      }
    });
  }

  async listAppProfiles(
    userId: string,
    organizationId: string,
    limit: number,
    cursor?: {
      id: string;
    },
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.appProfile.findMany({
      where: {
        userId,
        organizationId,
        ...(cursor
          ? {
              id: {
                lt: cursor.id
              }
            }
          : {})
      },
      orderBy: [
        { id: "desc" }
      ],
      take: limit + 1
    });
  }

  async upsertAppProfile(
    userId: string,
    organizationId: string,
    appKey: string,
    input: AppProfileUpsertInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.appProfile.upsert({
      where: {
        userId_organizationId_appKey: {
          userId,
          organizationId,
          appKey
        }
      },
      update: {
        writingProfileId: input.writingProfileId ?? null,
        settingsJson: toJsonInput(input.settingsJson)
      },
      create: {
        userId,
        organizationId,
        appKey,
        writingProfileId: input.writingProfileId ?? null,
        settingsJson: toJsonInput(input.settingsJson)
      }
    });
  }
}
