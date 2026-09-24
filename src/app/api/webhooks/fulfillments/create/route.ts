import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { upsertOrders } from "@/lib/orders";
import { fetchOrderById } from "@/lib/shopify";
import { parseAndVerifyWebhook, webhookErrorResponse } from "@/lib/webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await parseAndVerifyWebhook(request);
    const orderId = payload?.order_id;

    if (!orderId) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const order = await fetchOrderById(Number(orderId));
    const pool = getPool();
    await upsertOrders(pool, [order]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return webhookErrorResponse(error);
  }
}
