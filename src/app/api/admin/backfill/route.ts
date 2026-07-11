import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { upsertOrders } from "@/lib/orders";
import { fetchOrdersPage, getShopifyConfig } from "@/lib/shopify";

export const runtime = "nodejs";

function requireAdmin(request: Request) {
  const token = process.env.ADMIN_API_KEY;
  if (!token) {
    throw new Error("ADMIN_API_KEY is not set.");
  }
  const auth = request.headers.get("authorization");
  if (!auth || auth !== `Bearer ${token}`) {
    throw new Error("Unauthorized");
  }
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const startDate = normalizeDate(body?.startDate) || "2026-01-01";
    const endDate =
      normalizeDate(body?.endDate) || new Date().toISOString().slice(0, 10);

    const { shop, apiVersion } = getShopifyConfig();
    let nextUrl: string | null = `https://${shop}/admin/api/${apiVersion}/orders.json?limit=250&status=any&created_at_min=${encodeURIComponent(
      `${startDate}T00:00:00+05:30`
    )}&created_at_max=${encodeURIComponent(`${endDate}T23:59:59+05:30`)}`;

    const pool = getPool();
    let total = 0;
    while (nextUrl) {
      const { orders, nextUrl: next } = await fetchOrdersPage(nextUrl);
      await upsertOrders(pool, orders);
      total += orders.length;
      nextUrl = next;
      if (nextUrl) {
        await sleep(500);
      }
    }

    return NextResponse.json({ ok: true, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}
