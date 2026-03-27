import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("preferences routes", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    harness.authRateLimiter.reset();
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  async function signIn(email: string) {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: { email }
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email)
      }
    });

    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("returns the locked preference defaults before the first write", async () => {
    const session = await signIn("preferences-defaults@example.com");

    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/preferences",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      default_language: "auto",
      auto_punctuation: true,
      remove_fillers: false,
      auto_format: true
    });

    const storedRow = await harness.prisma.userPreference.findUnique({
      where: {
        userId: session.user.id
      }
    });

    expect(storedRow).toBeNull();
  });

  it("upserts preferences with full replacement semantics and syncs across sessions", async () => {
    const firstSession = await signIn("preferences-sync@example.com");
    const secondSession = await signIn("preferences-sync@example.com");

    const invalidPutResponse = await harness.app.inject({
      method: "PUT",
      url: "/v1/preferences",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        default_language: "en"
      }
    });

    expect(invalidPutResponse.statusCode).toBe(400);
    expect(invalidPutResponse.json().error.code).toBe("validation_error");

    const putResponse = await harness.app.inject({
      method: "PUT",
      url: "/v1/preferences",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        default_language: "en",
        auto_punctuation: false,
        remove_fillers: true,
        auto_format: false
      }
    });

    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toEqual({
      default_language: "en",
      auto_punctuation: false,
      remove_fillers: true,
      auto_format: false
    });

    const syncedRead = await harness.app.inject({
      method: "GET",
      url: "/v1/preferences",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(syncedRead.statusCode).toBe(200);
    expect(syncedRead.json()).toEqual({
      default_language: "en",
      auto_punctuation: false,
      remove_fillers: true,
      auto_format: false
    });

    const storedRow = await harness.prisma.userPreference.findUniqueOrThrow({
      where: {
        userId: firstSession.user.id
      }
    });

    expect(storedRow.defaultLanguage).toBe("en");
    expect(storedRow.autoPunctuation).toBe(false);
    expect(storedRow.removeFillers).toBe(true);
    expect(storedRow.autoFormat).toBe(false);
  });

  it("creates and lists dictionary entries for the current user and organization", async () => {
    const firstSession = await signIn("dictionary-sync@example.com");
    const secondSession = await signIn("dictionary-sync@example.com");
    const otherUser = await signIn("dictionary-other@example.com");

    const invalidCreateResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/dictionary",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        phrase: ""
      }
    });

    expect(invalidCreateResponse.statusCode).toBe(400);
    expect(invalidCreateResponse.json().error.code).toBe("validation_error");

    await harness.app.inject({
      method: "POST",
      url: "/v1/dictionary",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        phrase: "first synced phrase"
      }
    });

    await harness.app.inject({
      method: "POST",
      url: "/v1/dictionary",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        phrase: "second synced phrase"
      }
    });

    await harness.app.inject({
      method: "POST",
      url: "/v1/dictionary",
      headers: {
        authorization: `Bearer ${otherUser.access_token}`
      },
      payload: {
        phrase: "other user phrase"
      }
    });

    const firstPage = await harness.app.inject({
      method: "GET",
      url: "/v1/dictionary?limit=1",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items).toHaveLength(1);
    expect(firstPage.json().next_cursor).toBeTruthy();

    const secondPage = await harness.app.inject({
      method: "GET",
      url: `/v1/dictionary?limit=1&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(secondPage.statusCode).toBe(200);

    const combinedItems = [...firstPage.json().items, ...secondPage.json().items];
    expect(combinedItems).toHaveLength(2);
    expect(combinedItems.every((item: { phrase: string }) => item.phrase.includes("synced phrase"))).toBe(true);
    expect(combinedItems.find((item: { phrase: string }) => item.phrase === "other user phrase")).toBeUndefined();
  });

  it("updates and deletes only owned dictionary entries", async () => {
    const firstSession = await signIn("dictionary-mutate@example.com");
    const secondSession = await signIn("dictionary-mutate@example.com");
    const otherUser = await signIn("dictionary-mutate-other@example.com");

    const createResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/dictionary",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        phrase: "original phrase"
      }
    });

    expect(createResponse.statusCode).toBe(200);
    const entryId = createResponse.json().entry.id;

    const foreignPatchResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/dictionary/${entryId}`,
      headers: {
        authorization: `Bearer ${otherUser.access_token}`
      },
      payload: {
        phrase: "foreign update"
      }
    });

    expect(foreignPatchResponse.statusCode).toBe(404);
    expect(foreignPatchResponse.json().error.code).toBe("dictionary_entry_not_found");

    const patchResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/dictionary/${entryId}`,
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        phrase: "updated phrase"
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().entry.phrase).toBe("updated phrase");

    const syncedRead = await harness.app.inject({
      method: "GET",
      url: "/v1/dictionary?limit=10",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(syncedRead.statusCode).toBe(200);
    expect(syncedRead.json().items).toHaveLength(1);
    expect(syncedRead.json().items[0].phrase).toBe("updated phrase");

    const foreignDeleteResponse = await harness.app.inject({
      method: "DELETE",
      url: `/v1/dictionary/${entryId}`,
      headers: {
        authorization: `Bearer ${otherUser.access_token}`
      }
    });

    expect(foreignDeleteResponse.statusCode).toBe(404);
    expect(foreignDeleteResponse.json().error.code).toBe("dictionary_entry_not_found");

    const deleteResponse = await harness.app.inject({
      method: "DELETE",
      url: `/v1/dictionary/${entryId}`,
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      }
    });

    expect(deleteResponse.statusCode).toBe(204);

    const postDeleteRead = await harness.app.inject({
      method: "GET",
      url: "/v1/dictionary?limit=10",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(postDeleteRead.statusCode).toBe(200);
    expect(postDeleteRead.json().items).toHaveLength(0);
  });

  it("creates, lists, and patches writing profiles with current-organization scoping", async () => {
    const firstSession = await signIn("writing-profiles@example.com");
    const secondSession = await signIn("writing-profiles@example.com");
    const otherUser = await signIn("writing-profiles-other@example.com");

    await harness.prisma.organization.create({
      data: {
        name: "Secondary Workspace",
        type: "TEAM",
        ownerUserId: firstSession.user.id
      }
    }).then(async (organization) => {
      await harness.prisma.writingProfile.create({
        data: {
          userId: firstSession.user.id,
          organizationId: organization.id,
          name: "Hidden Profile",
          tone: "hidden",
          rulesJson: {
            hidden: true
          }
        }
      });
    });

    const createResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/writing-profiles",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        name: "Email Writing",
        tone: "concise",
        rules_json: {
          audience: "customer"
        }
      }
    });

    expect(createResponse.statusCode).toBe(200);
    const profileId = createResponse.json().profile.id;

    const listResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/writing-profiles?limit=10",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toHaveLength(1);
    expect(listResponse.json().items[0].name).toBe("Email Writing");

    const foreignPatchResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/writing-profiles/${profileId}`,
      headers: {
        authorization: `Bearer ${otherUser.access_token}`
      },
      payload: {
        tone: "foreign"
      }
    });

    expect(foreignPatchResponse.statusCode).toBe(404);
    expect(foreignPatchResponse.json().error.code).toBe("writing_profile_not_found");

    const patchResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/writing-profiles/${profileId}`,
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        tone: "formal",
        rules_json: {
          audience: "executive",
          max_length: 200
        }
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().profile.tone).toBe("formal");

    const syncedRead = await harness.app.inject({
      method: "GET",
      url: "/v1/writing-profiles?limit=10",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(syncedRead.statusCode).toBe(200);
    expect(syncedRead.json().items).toHaveLength(1);
    expect(syncedRead.json().items[0].rules_json).toEqual({
      audience: "executive",
      max_length: 200
    });
  });

  it("enforces the locked rules_json bounds for writing profiles", async () => {
    const session = await signIn("writing-profile-bounds@example.com");
    const validBoundaryObject = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`k${index}`, index])
    );
    const invalidPayloads = [
      {
        label: "top-level array",
        rules_json: ["bad-shape"]
      },
      {
        label: "oversized json",
        rules_json: {
          large: "x".repeat(9000)
        }
      },
      {
        label: "too deep",
        rules_json: {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: true
                }
              }
            }
          }
        }
      },
      {
        label: "too many keys",
        rules_json: Object.fromEntries(
          Array.from({ length: 51 }, (_, index) => [`key_${index}`, index])
        )
      },
      {
        label: "key too long",
        rules_json: {
          [("x".repeat(65))]: true
        }
      },
      {
        label: "forbidden key prefix",
        rules_json: {
          __secret: true
        }
      }
    ];

    const validResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/writing-profiles",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        name: "Boundary Profile",
        tone: "balanced",
        rules_json: validBoundaryObject
      }
    });

    expect(validResponse.statusCode).toBe(200);

    for (const invalidPayload of invalidPayloads) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/writing-profiles",
        headers: {
          authorization: `Bearer ${session.access_token}`
        },
        payload: {
          name: `Invalid ${invalidPayload.label}`,
          tone: "balanced",
          rules_json: invalidPayload.rules_json
        }
      });

      expect(response.statusCode, invalidPayload.label).toBe(400);
      expect(response.json().error.code, invalidPayload.label).toBe("validation_error");
    }
  });

  it("lists and upserts app profiles with writing-profile ownership validation", async () => {
    const firstSession = await signIn("app-profiles@example.com");
    const secondSession = await signIn("app-profiles@example.com");
    const otherUser = await signIn("app-profiles-other@example.com");
    const ownedWritingProfile = await harness.prisma.writingProfile.create({
      data: {
        userId: firstSession.user.id,
        organizationId: firstSession.organization_id,
        name: "Owned Writing Profile",
        tone: "direct",
        rulesJson: {
          mode: "owned"
        }
      }
    });
    const otherUserWritingProfile = await harness.prisma.writingProfile.create({
      data: {
        userId: otherUser.user.id,
        organizationId: otherUser.organization_id,
        name: "Foreign Writing Profile",
        tone: "foreign",
        rulesJson: {
          mode: "foreign"
        }
      }
    });
    const hiddenOrganization = await harness.prisma.organization.create({
      data: {
        name: "Hidden App Workspace",
        type: "TEAM",
        ownerUserId: firstSession.user.id
      }
    });

    await harness.prisma.appProfile.create({
      data: {
        userId: firstSession.user.id,
        organizationId: hiddenOrganization.id,
        appKey: "hidden-app",
        settingsJson: {
          hidden: true
        }
      }
    });

    const foreignReferenceResponse = await harness.app.inject({
      method: "PUT",
      url: "/v1/app-profiles/editor",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        writing_profile_id: otherUserWritingProfile.id,
        settings_json: {
          mode: "should-fail"
        }
      }
    });

    expect(foreignReferenceResponse.statusCode).toBe(404);
    expect(foreignReferenceResponse.json().error.code).toBe("writing_profile_not_found");

    const firstUpsert = await harness.app.inject({
      method: "PUT",
      url: "/v1/app-profiles/editor",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        writing_profile_id: ownedWritingProfile.id,
        settings_json: {
          mode: "draft",
          shortcuts: true
        }
      }
    });

    expect(firstUpsert.statusCode).toBe(200);
    const firstProfileId = firstUpsert.json().profile.id;

    const secondUpsert = await harness.app.inject({
      method: "PUT",
      url: "/v1/app-profiles/editor",
      headers: {
        authorization: `Bearer ${firstSession.access_token}`
      },
      payload: {
        writing_profile_id: null,
        settings_json: {
          mode: "final",
          shortcuts: false
        }
      }
    });

    expect(secondUpsert.statusCode).toBe(200);
    expect(secondUpsert.json().profile.id).toBe(firstProfileId);
    expect(secondUpsert.json().profile.writing_profile_id).toBeNull();

    const listResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/app-profiles?limit=10",
      headers: {
        authorization: `Bearer ${secondSession.access_token}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toHaveLength(1);
    expect(listResponse.json().items[0].app_key).toBe("editor");
    expect(listResponse.json().items[0].settings_json).toEqual({
      mode: "final",
      shortcuts: false
    });
  });

  it("enforces the locked settings_json bounds for app profiles", async () => {
    const session = await signIn("app-profile-bounds@example.com");
    const invalidPayloads = [
      {
        label: "top-level scalar",
        settings_json: "bad-shape"
      },
      {
        label: "oversized json",
        settings_json: {
          large: "x".repeat(9000)
        }
      },
      {
        label: "too deep",
        settings_json: {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: true
                }
              }
            }
          }
        }
      },
      {
        label: "too many keys",
        settings_json: Object.fromEntries(
          Array.from({ length: 51 }, (_, index) => [`key_${index}`, index])
        )
      },
      {
        label: "key too long",
        settings_json: {
          [("x".repeat(65))]: true
        }
      },
      {
        label: "forbidden key prefix",
        settings_json: {
          $secret: true
        }
      }
    ];

    const validResponse = await harness.app.inject({
      method: "PUT",
      url: "/v1/app-profiles/editor",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        settings_json: {
          theme: "light",
          mode: "dictation"
        }
      }
    });

    expect(validResponse.statusCode).toBe(200);

    for (const invalidPayload of invalidPayloads) {
      const response = await harness.app.inject({
        method: "PUT",
        url: `/v1/app-profiles/${encodeURIComponent(invalidPayload.label)}`,
        headers: {
          authorization: `Bearer ${session.access_token}`
        },
        payload: {
          settings_json: invalidPayload.settings_json
        }
      });

      expect(response.statusCode, invalidPayload.label).toBe(400);
      expect(response.json().error.code, invalidPayload.label).toBe("validation_error");
    }
  });
});
