import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { upsertOrders } from "@/lib/orders";
import { parseAndVerifyWebhook, webhookErrorResponse } from "@/lib/webhooks";

export async function handleOrderWebhook(request: Request) {
  try {
    const payload = await parseAndVerifyWebhook(request);
    const pool = getPool();
    await upsertOrders(pool, [payload]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return webhookErrorResponse(error);
  }
}
