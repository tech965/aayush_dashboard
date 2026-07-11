import crypto from "crypto";

export function getShopifyConfig() {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!shop || !token) {
    throw new Error("SHOPIFY_SHOP or SHOPIFY_ACCESS_TOKEN is not set.");
  }

  return { shop, token, apiVersion, webhookSecret };
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
  const { shop, token, apiVersion } = getShopifyConfig();
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
  const { token } = getShopifyConfig();
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
