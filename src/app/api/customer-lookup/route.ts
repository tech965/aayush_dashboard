import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "email query param is required." }, { status: 400 });
  }

  try {
    const pool = getPool();

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*)::int AS "orderCount",
        COUNT(*) FILTER (WHERE fulfillment_status = 'fulfilled')::int AS "fulfilledOrderCount",
        COALESCE(SUM(total_price) FILTER (WHERE fulfillment_status = 'fulfilled'), 0)::numeric AS "lifetimeValue",
        MIN(created_at) AS "firstOrderAt",
        MAX(created_at) AS "lastOrderAt"
      FROM orders
      WHERE customer_email = $1
      `,
      [email]
    );

    const raw = rows[0];

    if (!raw || Number(raw.orderCount) === 0) {
      return NextResponse.json(
        { error: `No orders found for ${email}.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      email,
      orderCount: Number(raw.orderCount) || 0,
      fulfilledOrderCount: Number(raw.fulfilledOrderCount) || 0,
      lifetimeValue: Number(raw.lifetimeValue) || 0,
      firstOrderAt: raw.firstOrderAt,
      lastOrderAt: raw.lastOrderAt,
    });
  } catch (err) {
    console.error("customer-lookup error:", err);
    return NextResponse.json(
      { error: "Failed to look up customer." },
      { status: 500 }
    );
  }
}
