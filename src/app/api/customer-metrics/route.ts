import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const CANDIDATE_ID_COLUMNS = [
  "customer_email",
  "shopify_customer_id",
  "customer_id",
  "email",
  "customer_phone",
  "phone",
  "buyer_email",
  "billing_email",
];

function normalizeDate(value: string | null) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function getTodayInIST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = normalizeDate(url.searchParams.get("start")) || "2026-01-01";
    const end = normalizeDate(url.searchParams.get("end")) || getTodayInIST();

    const pool = getPool();

    const { rows: colRows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'orders' AND table_schema = 'public'`
    );
    const existingColumns = new Set(colRows.map((r) => r.column_name));
    const idColumn = CANDIDATE_ID_COLUMNS.find((c) => existingColumns.has(c));

    if (!idColumn) {
      return NextResponse.json(
        {
          error: `No customer identifier column found on orders. Checked: ${CANDIDATE_ID_COLUMNS.join(", ")}. Actual columns: ${[...existingColumns].join(", ")}`,
        },
        { status: 500 }
      );
    }

    const { rows } = await pool.query(
      `
      WITH fulfilled_orders AS (
        SELECT
          o."${idColumn}" AS customer_key,
          o.total_price,
          o.created_at
        FROM orders o
        WHERE o.fulfillment_status = 'fulfilled'
          AND o."${idColumn}" IS NOT NULL
          AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
          AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date
      ),
      per_customer AS (
        SELECT
          customer_key,
          COUNT(*) AS order_count,
          SUM(total_price) AS total_spent
        FROM fulfilled_orders
        GROUP BY customer_key
      )
      SELECT
        COUNT(*)::int AS "totalCustomers",
        COALESCE(SUM(total_spent), 0)::numeric AS "totalRevenue",
        COALESCE(SUM(total_spent) / NULLIF(COUNT(*), 0), 0)::numeric AS "avgLtv",
        COUNT(*) FILTER (WHERE order_count > 1)::int AS "repeatCustomers",
        COALESCE(100.0 * COUNT(*) FILTER (WHERE order_count > 1) / NULLIF(COUNT(*), 0), 0)::numeric AS "repeatRatePercent",
        COALESCE(SUM(order_count), 0)::int AS "fulfilledOrders"
      FROM per_customer;
      `,
      [start, end]
    );

    const raw = rows[0] ?? {};
    const fulfilledOrders = Number(raw.fulfilledOrders) || 0;
    const repeatCustomers = Number(raw.repeatCustomers) || 0;

    return NextResponse.json({
      start,
      end,
      identifierColumnUsed: idColumn,
      totalCustomers: Number(raw.totalCustomers) || 0,
      totalRevenue: Number(raw.totalRevenue) || 0,
      avgLtv: Number(raw.avgLtv) || 0,
      repeatCustomers,
      repeatRatePercent: Number(raw.repeatRatePercent) || 0,
      fulfilledOrders,
      ltvRate: repeatCustomers > 0 ? fulfilledOrders / repeatCustomers : 0,
    });
  } catch (err) {
    console.error("customer-metrics error:", err);
    return NextResponse.json(
      { error: "Failed to load customer metrics." },
      { status: 500 }
    );
  }
}
