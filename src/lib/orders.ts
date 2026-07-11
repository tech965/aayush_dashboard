import { Pool } from "pg";

export type ShopifyOrder = {
  id: number;
  name?: string;
  created_at?: string;
  updated_at?: string;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  tags?: string;
  total_price?: string | number | null;
  currency?: string | null;
  line_items?: ShopifyLineItem[];
};

export type ShopifyLineItem = {
  id: number;
  title?: string;
  variant_title?: string;
  quantity?: number;
  sku?: string | null;
  variant_id?: number | null;
  product_id?: number | null;
};

export type NormalizedOrder = {
  id: number;
  name: string | null;
  created_at: string | null;
  updated_at: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  tags: string | null;
  total_price: number | null;
  currency: string | null;
};

export type NormalizedLineItem = {
  line_item_id: number;
  order_id: number;
  product_title: string | null;
  variant_title: string | null;
  quantity: number;
  sku: string | null;
  variant_id: number | null;
  product_id: number | null;
};

export function normalizeOrder(order: ShopifyOrder): NormalizedOrder {
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
  };
}

function normalizeLineItems(
  orderId: number,
  lineItems: ShopifyLineItem[] = []
): NormalizedLineItem[] {
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

export async function upsertOrders(pool: Pool, orders: ShopifyOrder[]) {
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

  for (const order of orders) {
    const normalized = normalizeOrder(order);
    const values: Array<string | number | null> = [
      normalized.id,
      normalized.name,
      normalized.created_at,
      normalized.updated_at,
      normalized.financial_status,
      normalized.fulfillment_status,
      normalized.cancelled_at,
      normalized.tags,
      normalized.total_price,
      normalized.currency,
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

    await pool.query(sql, values);

    const hasLineItems = Array.isArray(order.line_items);
    if (hasLineItems) {
      const lineItems = normalizeLineItems(order.id, order.line_items);
      await pool.query("DELETE FROM order_line_items WHERE order_id = $1", [
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
        const itemValues: Array<string | number | null> = [];
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

        await pool.query(itemSql, itemValues);
      }
    }
  }
}
