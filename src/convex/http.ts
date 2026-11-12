import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

function hexToBytes(value: string) {
  const clean = value.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifySignature(rawBody: string, signature: string | null) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const bytes = hexToBytes(signature);
  if (!bytes) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(rawBody),
  );
}

/**
 * Production-ready webhook boundary for a payment gateway adapter.
 *
 * Expected JSON:
 *   { provider, providerRef, authority?, amountToman, status, rawStatus? }
 * Required header: x-billing-signature: hex(HMAC_SHA256(rawBody, secret)).
 *
 * No gateway is enabled without real credentials. Verification happens before
 * any Convex mutation; the mutation also rejects signatures that were not
 * verified here.
 */
http.route({
  path: "/billing/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    const signature = request.headers.get("x-billing-signature");
    if (!(await verifySignature(raw, signature))) {
      return new Response(JSON.stringify({ error: "invalid_signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    let payload: {
      provider?: unknown;
      providerRef?: unknown;
      authority?: unknown;
      amountToman?: unknown;
      status?: unknown;
      rawStatus?: unknown;
    };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      typeof payload.provider !== "string" ||
      typeof payload.providerRef !== "string" ||
      typeof payload.amountToman !== "number" ||
      !Number.isSafeInteger(payload.amountToman) ||
      payload.amountToman < 0 ||
      (payload.status !== "succeeded" && payload.status !== "failed")
    ) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    try {
      const result = await ctx.runMutation(
        internal.subscription.applyWebhook,
        {
          provider: payload.provider,
          providerRef: payload.providerRef,
          authority:
            typeof payload.authority === "string"
              ? payload.authority.slice(0, 200)
              : undefined,
          amountToman: payload.amountToman,
          succeeded: payload.status === "succeeded",
          signatureVerified: true,
          rawStatus:
            typeof payload.rawStatus === "string"
              ? payload.rawStatus.slice(0, 200)
              : undefined,
        },
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch {
      // Do not leak internals to the gateway. A 422 prompts inspection in the
      // admin/payment log without acknowledging the payment as valid.
      return new Response(JSON.stringify({ error: "not_applied" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    }
  }),
});

export default http;
