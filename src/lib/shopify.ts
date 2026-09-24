import crypto from "crypto";

export function getShopifyConfig() {
  const shop = process.env.SHOPIFY_SHOP;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!shop) {
    throw new Error("SHOPIFY_SHOP is not set.");
  }

  return { shop, apiVersion, webhookSecret };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// Prefer a client-credentials token (SHOPIFY_CLIENT_ID/SECRET): the static
// SHOPIFY_ACCESS_TOKEN lost read_orders approval, which silently broke
// fulfillment syncing. Falls back to the static token if no client creds.
export async function getShopifyToken() {
  const { shop } = getShopifyConfig();
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (clientId && clientSecret) {
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.value;
    }
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shopify token exchange failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    const ttlMs = (Number(data.expires_in) || 3600) * 1000;
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + ttlMs - 5 * 60 * 1000,
    };
    return cachedToken.value;
  }

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "Set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ACCESS_TOKEN)."
    );
  }
  return token;
}

export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null) {
  const { webhookSecret } = getShopifyConfig();
  if (!webhookSecret) {
    throw new Error("SHOPIFY_WEBHOOK_SECRET is not set.");
  }
  if (!hmacHeader) {
    return false;
  }
  const digest = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("base64");
  const hmacBuffer = Buffer.from(hmacHeader, "utf8");
  const digestBuffer = Buffer.from(digest, "utf8");
  if (hmacBuffer.length !== digestBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(hmacBuffer, digestBuffer);
}

export async function fetchOrderById(orderId: number) {
  const { shop, apiVersion } = getShopifyConfig();
  const token = await getShopifyToken();
  const url = `https://${shop}/admin/api/${apiVersion}/orders/${orderId}.json`;

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.order;
}

export async function fetchOrdersPage(url: string) {
  const token = await getShopifyToken();
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const linkHeader = response.headers.get("link");
  let nextUrl: string | null = null;

  if (linkHeader && linkHeader.includes('rel="next"')) {
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = match ? match[1] : null;
  }

  return { orders: data.orders || [], nextUrl };
}
