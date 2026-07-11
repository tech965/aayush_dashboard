import { verifyShopifyWebhook } from "./shopify";

export async function parseAndVerifyWebhook(request: Request) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const verified = verifyShopifyWebhook(rawBody, hmac);
  if (!verified) {
    throw new Error("Webhook verification failed.");
  }
  return JSON.parse(rawBody);
}
