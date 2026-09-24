import { NextResponse } from "next/server";
import { verifyShopifyWebhook } from "./shopify";

export class WebhookVerificationError extends Error {}

export function webhookErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const status = error instanceof WebhookVerificationError ? 401 : 500;
  console.error(`Webhook failed (${status}): ${message}`);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function parseAndVerifyWebhook(request: Request) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const verified = verifyShopifyWebhook(rawBody, hmac);
  if (!verified) {
    throw new WebhookVerificationError("Webhook verification failed.");
  }
  return JSON.parse(rawBody);
}
