const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function parseEnv(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let val = match[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[match[1]] = val;
  }
  return env;
}

function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function fetchOrdersForRange({ shop, token, apiVersion, start, end }) {
  const startDate = `${start}T00:00:00+05:30`;
  const endDate = `${end}T23:59:59+05:30`;
  let url = `https://${shop}/admin/api/${apiVersion}/orders.json?limit=250&status=any&created_at_min=${encodeURIComponent(
    startDate
  )}&created_at_max=${encodeURIComponent(endDate)}`;

  const orders = [];
  while (url) {
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
    if (Array.isArray(data.orders)) {
      orders.push(...data.orders);
    }

    const linkHeader = response.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = match ? match[1] : null;
    } else {
      url = null;
    }

    if (url) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return orders;
}

function normalizeOrder(order) {
  return {
    id: order.id,
    name: order.name ?? null,
    created_at: order.created_at ?? null,
    updated_at: order.updated_at ?? null,
    financial_status: order.financial_status ?? null,
    fulfillment_status: order.fulfillment_status ?? null,
    cancelled_at: order.cancelled_at ?? null,
    tags: order.tags ?? null,
    total_price:
      order.total_price === undefined || order.total_price === null
        ? null
        : Number(order.total_price),
    currency: order.currency ?? null,
    line_items: Array.isArray(order.line_items) ? order.line_items : [],
  };
}

function normalizeLineItems(orderId, lineItems = []) {
  return lineItems.map((item) => ({
    line_item_id: item.id,
    order_id: orderId,
    product_title: item.title ?? null,
    variant_title: item.variant_title ?? null,
    quantity: item.quantity ?? 0,
    sku: item.sku ?? null,
    variant_id: item.variant_id ?? null,
    product_id: item.product_id ?? null,
  }));
}

async function upsertOrders(client, orders) {
  if (orders.length === 0) return;
  const columns = [
    "id",
    "name",
    "created_at",
    "updated_at",
    "financial_status",
    "fulfillment_status",
    "cancelled_at",
    "tags",
    "total_price",
    "currency",
  ];

  for (const rawOrder of orders) {
    const order = normalizeOrder(rawOrder);
    const values = [
      order.id,
      order.name,
      order.created_at,
      order.updated_at,
      order.financial_status,
      order.fulfillment_status,
      order.cancelled_at,
      order.tags,
      order.total_price,
      order.currency,
    ];

    const sql = `
      INSERT INTO orders (${columns.join(", ")})
      VALUES (${columns.map((_, idx) => `$${idx + 1}`).join(", ")})
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        financial_status = EXCLUDED.financial_status,
        fulfillment_status = EXCLUDED.fulfillment_status,
        cancelled_at = EXCLUDED.cancelled_at,
        tags = EXCLUDED.tags,
        total_price = EXCLUDED.total_price,
        currency = EXCLUDED.currency
    `;
    await client.query(sql, values);

    const lineItems = normalizeLineItems(order.id, order.line_items);
    await client.query("DELETE FROM order_line_items WHERE order_id = $1", [
      order.id,
    ]);

    if (lineItems.length > 0) {
      const itemColumns = [
        "line_item_id",
        "order_id",
        "product_title",
        "variant_title",
        "quantity",
        "sku",
        "variant_id",
        "product_id",
      ];
      const itemValues = [];
      const itemPlaceholders = lineItems.map((item, idx) => {
        const offset = idx * itemColumns.length;
        itemValues.push(
          item.line_item_id,
          item.order_id,
          item.product_title,
          item.variant_title,
          item.quantity,
          item.sku,
          item.variant_id,
          item.product_id
        );
        return `(${itemColumns
          .map((_, colIdx) => `$${offset + colIdx + 1}`)
          .join(", ")})`;
      });

      const itemSql = `
        INSERT INTO order_line_items (${itemColumns.join(", ")})
        VALUES ${itemPlaceholders.join(", ")}
      `;
      await client.query(itemSql, itemValues);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const startArgIndex = args.indexOf("--start");
  const endArgIndex = args.indexOf("--end");

  const startArg = startArgIndex >= 0 ? args[startArgIndex + 1] : "2026-01-01";
  const endArg = endArgIndex >= 0 ? args[endArgIndex + 1] : dateToIso(new Date());

  const envPath = path.join(process.cwd(), ".env.local");
  const env = parseEnv(fs.readFileSync(envPath, "utf8"));

  const shop = env.SHOPIFY_SHOP;
  const token = env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = env.SHOPIFY_API_VERSION || "2024-10";
  const connectionString = env.DATABASE_URL;

  if (!shop || !token || !connectionString) {
    throw new Error("Missing SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN, or DATABASE_URL in .env.local");
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  let current = new Date(startArg);
  const end = new Date(endArg);

  while (current <= end) {
    const day = dateToIso(current);
    console.log(`Backfilling ${day}...`);
    const orders = await fetchOrdersForRange({
      shop,
      token,
      apiVersion,
      start: day,
      end: day,
    });
    await upsertOrders(pool, orders);
    console.log(`  ${orders.length} orders`);
    current = addDays(current, 1);
  }

  await pool.end();
  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
