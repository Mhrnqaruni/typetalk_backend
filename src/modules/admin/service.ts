import { AppError } from "../../lib/app-error";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";
import { SecurityService } from "../security/service";
import { AdminRepository } from "./repository";

interface AdminActorContext {
  actorUserId: string;
  requestId: string;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly securityService: SecurityService
  ) {}

  async getUserDetail(userId: string, actor: AdminActorContext) {
    const user = await this.repository.findUserDetail(userId);

    if (!user) {
      throw new AppError(404, "user_not_found", "User was not found.");
    }

    const response = {
      user: {
        id: user.id,
        primary_email: user.primaryEmail,
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        status: user.status,
        email_verified_at: toIsoString(user.emailVerifiedAt),
        created_at: user.createdAt.toISOString(),
        deleted_at: toIsoString(user.deletedAt)
      },
      organizations: user.memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        type: membership.organization.type,
        role: membership.role,
        owner_user_id: membership.organization.ownerUserId,
        created_at: membership.organization.createdAt.toISOString(),
        membership_created_at: membership.createdAt.toISOString(),
        entitlement: membership.organization.entitlements[0]
          ? {
              code: membership.organization.entitlements[0].code,
              status: membership.organization.entitlements[0].status,
              billing_overlap: membership.organization.entitlements[0].billingOverlap,
              source_provider: membership.organization.entitlements[0].sourceProvider,
              starts_at: toIsoString(membership.organization.entitlements[0].startsAt),
              ends_at: toIsoString(membership.organization.entitlements[0].endsAt),
              updated_at: membership.organization.entitlements[0].updatedAt.toISOString()
            }
          : null
      })),
      devices: user.devices.map((device) => ({
        id: device.id,
        platform: device.platform,
        installation_id: device.installationId,
        device_name: device.deviceName,
        os_version: device.osVersion,
        app_version: device.appVersion,
        locale: device.locale,
        timezone: device.timezone,
        last_seen_at: device.lastSeenAt.toISOString(),
        created_at: device.createdAt.toISOString()
      })),
      sessions: user.sessions.map((session) => ({
        id: session.id,
        device_id: session.deviceId,
        user_agent: session.userAgent,
        last_ip_country_code: session.lastIpCountryCode,
        last_used_at: session.lastUsedAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
        revoked_at: toIsoString(session.revokedAt),
        reauthenticated_at: toIsoString(session.reauthenticatedAt),
        created_at: session.createdAt.toISOString(),
        device: session.device
          ? {
              id: session.device.id,
              platform: session.device.platform,
              installation_id: session.device.installationId,
              device_name: session.device.deviceName
            }
          : null
      })),
      security_events: user.securityEvents.map((event) => ({
        id: event.id,
        event_type: event.eventType,
        severity: event.severity,
        ip_hash: event.ipHash,
        created_at: event.createdAt.toISOString()
      })),
      ip_observations: user.ipObservations.map((observation) => ({
        id: observation.id,
        ip_hash: observation.ipHash,
        hash_key_version: observation.hashKeyVersion,
        country_code: observation.countryCode,
        region: observation.region,
        asn: observation.asn,
        source: observation.source,
        raw_ip_expires_at: toIsoString(observation.rawIpExpiresAt),
        created_at: observation.createdAt.toISOString()
      }))
    };

    await this.securityService.writeAuditLog({
      organizationId: response.organizations[0]?.id ?? null,
      actorUserId: actor.actorUserId,
      actorType: "USER",
      actorId: actor.actorUserId,
      targetType: "USER",
      targetId: user.id,
      targetUserId: user.id,
      action: "admin.user.read",
      requestId: actor.requestId,
      metadataJson: {
        organization_count: response.organizations.length,
        device_count: response.devices.length,
        session_count: response.sessions.length
      }
    });

    return response;
  }

  async listSubscriptions(
    input: {
      limit?: number;
      cursor?: string;
      organizationId?: string;
      userId?: string;
      provider?: "PADDLE" | "STRIPE" | "GOOGLE_PLAY";
      status?: "INCOMPLETE" | "TRIALING" | "ACTIVE" | "GRACE" | "PAYMENT_ISSUE" | "CANCELED" | "EXPIRED";
    },
    actor: AdminActorContext
  ) {
    const resolvedLimit = getPageLimit(input.limit);
    const decodedCursor = decodeCursor<{ updated_at: string; id: string }>(input.cursor);
    const subscriptions = await this.repository.listSubscriptions({
      limit: resolvedLimit,
      cursor: decodedCursor
        ? {
            updatedAt: new Date(decodedCursor.updated_at),
            id: decodedCursor.id
          }
        : null,
      organizationId: input.organizationId,
      userId: input.userId,
      provider: input.provider,
      status: input.status
    });
    const hasNextPage = subscriptions.length > resolvedLimit;
    const pageItems = hasNextPage ? subscriptions.slice(0, resolvedLimit) : subscriptions;
    const nextItem = pageItems[pageItems.length - 1];
    const response = {
      items: pageItems.map((subscription) => ({
        id: subscription.id,
        organization_id: subscription.organizationId,
        provider: subscription.provider,
        external_subscription_id: subscription.externalSubscriptionId,
        status: subscription.status,
        is_trial: subscription.isTrial,
        conflict_flag: subscription.conflictFlag,
        trial_ends_at: toIsoString(subscription.trialEndsAt),
        current_period_start: toIsoString(subscription.currentPeriodStart),
        current_period_end: toIsoString(subscription.currentPeriodEnd),
        canceled_at: toIsoString(subscription.canceledAt),
        created_at: subscription.createdAt.toISOString(),
        updated_at: subscription.updatedAt.toISOString(),
        plan: {
          code: subscription.plan.code,
          display_name: subscription.plan.displayName,
          billing_interval: subscription.plan.billingInterval,
          amount_cents: subscription.plan.amountCents,
          currency: subscription.plan.currency,
          trial_days: subscription.plan.trialDays
        },
        organization: {
          id: subscription.organization.id,
          name: subscription.organization.name,
          type: subscription.organization.type,
          owner_user_id: subscription.organization.ownerUserId
        },
        provider_customer: subscription.providerCustomer
          ? {
              external_customer_id: subscription.providerCustomer.externalCustomerId
            }
          : null,
        entitlement: subscription.organization.entitlements[0]
          ? {
              code: subscription.organization.entitlements[0].code,
              status: subscription.organization.entitlements[0].status,
              billing_overlap: subscription.organization.entitlements[0].billingOverlap,
              source_provider: subscription.organization.entitlements[0].sourceProvider,
              updated_at: subscription.organization.entitlements[0].updatedAt.toISOString()
            }
          : null
      })),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            updated_at: nextItem.updatedAt.toISOString(),
            id: nextItem.id
          })
        : null
    };

    await this.securityService.writeAuditLog({
      organizationId: input.organizationId ?? null,
      actorUserId: actor.actorUserId,
      actorType: "USER",
      actorId: actor.actorUserId,
      targetType: "SUBSCRIPTION_COLLECTION",
      targetId: input.organizationId ?? input.userId ?? null,
      targetUserId: input.userId ?? null,
      action: "admin.subscriptions.read",
      requestId: actor.requestId,
      metadataJson: {
        item_count: response.items.length,
        provider: input.provider ?? null,
        status: input.status ?? null
      }
    });

    return response;
  }

  async listUsage(
    input: {
      limit?: number;
      cursor?: string;
      organizationId?: string;
      userId?: string;
      featureCode?: string;
      status?: "FINALIZED" | "TELEMETRY";
    },
    actor: AdminActorContext
  ) {
    const resolvedLimit = getPageLimit(input.limit);
    const decodedCursor = decodeCursor<{ occurred_at: string; id: string }>(input.cursor);
    const usageEvents = await this.repository.listUsage({
      limit: resolvedLimit,
      cursor: decodedCursor
        ? {
            occurredAt: new Date(decodedCursor.occurred_at),
            id: decodedCursor.id
          }
        : null,
      organizationId: input.organizationId,
      userId: input.userId,
      featureCode: input.featureCode,
      status: input.status
    });
    const hasNextPage = usageEvents.length > resolvedLimit;
    const pageItems = hasNextPage ? usageEvents.slice(0, resolvedLimit) : usageEvents;
    const nextItem = pageItems[pageItems.length - 1];
    const response = {
      items: pageItems.map((event) => ({
        id: event.id,
        organization_id: event.organizationId,
        user_id: event.userId,
        device_id: event.deviceId,
        realtime_session_id: event.realtimeSessionId,
        feature_code: event.featureCode,
        provider: event.provider,
        word_count: event.wordCount,
        audio_seconds: event.audioSeconds,
        request_count: event.requestCount,
        status: event.status,
        occurred_at: event.occurredAt.toISOString(),
        created_at: event.createdAt.toISOString(),
        organization: {
          id: event.organization.id,
          name: event.organization.name,
          type: event.organization.type
        },
        user: {
          id: event.user.id,
          primary_email: event.user.primaryEmail
        },
        device: event.device
          ? {
              id: event.device.id,
              platform: event.device.platform,
              installation_id: event.device.installationId,
              device_name: event.device.deviceName
            }
          : null
      })),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            occurred_at: nextItem.occurredAt.toISOString(),
            id: nextItem.id
          })
        : null
    };

    await this.securityService.writeAuditLog({
      organizationId: input.organizationId ?? null,
      actorUserId: actor.actorUserId,
      actorType: "USER",
      actorId: actor.actorUserId,
      targetType: "USAGE_COLLECTION",
      targetId: input.organizationId ?? input.userId ?? null,
      targetUserId: input.userId ?? null,
      action: "admin.usage.read",
      requestId: actor.requestId,
      metadataJson: {
        item_count: response.items.length,
        feature_code: input.featureCode ?? null,
        status: input.status ?? null
      }
    });

    return response;
  }
}
