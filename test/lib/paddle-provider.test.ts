import { afterEach, describe, expect, it, vi } from "vitest";

import { LivePaddleProvider } from "../../src/modules/billing/paddle";

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("live paddle provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts the after cursor token from Paddle pagination URLs before requesting the next page", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        data: [
          {
            id: "txn_1",
            status: "completed",
            currency_code: "usd",
            details: {
              totals: {
                grand_total: "9.99"
              }
            },
            billing_period: {
              starts_at: "2026-03-01T00:00:00.000Z",
              ends_at: "2026-04-01T00:00:00.000Z"
            },
            created_at: "2026-03-01T00:00:00.000Z"
          }
        ],
        meta: {
          pagination: {
            next: "https://api.paddle.com/transactions?customer_id=ctm_123&per_page=1&after=txn_1"
          }
        }
      }))
      .mockResolvedValueOnce(createJsonResponse({
        data: [],
        meta: {
          pagination: {
            next: null
          }
        }
      }));
    vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);
    const provider = new LivePaddleProvider("pdl_test_typetalk", "pdlwhsec_typetalk");

    const firstPage = await provider.listInvoices({
      customerId: "ctm_123",
      limit: 1
    });
    await provider.listInvoices({
      customerId: "ctm_123",
      limit: 1,
      startingAfter: firstPage.nextCursor ?? undefined
    });

    expect(firstPage.nextCursor).toBe("txn_1");
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.paddle.com/transactions?customer_id=ctm_123&per_page=1&after=txn_1",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("creates customer portal sessions using only Paddle-supported request fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({
      data: {
        id: "cps_1",
        urls: {
          general: {
            overview: "https://paddle.test/portal/1"
          }
        }
      }
    }));
    vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);
    const provider = new LivePaddleProvider("pdl_test_typetalk", "pdlwhsec_typetalk");

    await provider.createCustomerPortalSession({
      customerId: "ctm_123",
      subscriptionIds: ["sub_123"]
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.paddle.com/customers/ctm_123/portal-sessions",
      expect.objectContaining({
        method: "POST"
      })
    );

    const requestInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(requestInit.body as string);

    expect(payload).toEqual({
      subscription_ids: ["sub_123"]
    });
    expect(payload).not.toHaveProperty("custom_data");
  });
});
