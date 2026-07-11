import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

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
  const url = new URL(request.url);
  const start = normalizeDate(url.searchParams.get("start")) || "2026-01-01";
  const end = normalizeDate(url.searchParams.get("end")) || getTodayInIST();

  const pool = getPool();
  const sql = `
    SELECT
      li.product_title,
      li.variant_title,
      SUM(li.quantity)::int AS quantity,
      COUNT(DISTINCT li.order_id)::int AS orders_count
    FROM order_line_items li
    JOIN orders o ON o.id = li.order_id
    WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date
      BETWEEN $1::date AND $2::date
    GROUP BY li.product_title, li.variant_title
    ORDER BY quantity DESC;
  `;

  const result = await pool.query(sql, [start, end]);
  const rows = result.rows.map((row) => ({
    product_title: row.product_title || "Unknown Product",
    variant_title: row.variant_title || null,
    quantity: Number(row.quantity),
    orders_count: Number(row.orders_count),
  }));

  return NextResponse.json({
    start,
    end,
    timezone: "Asia/Kolkata",
    rows,
  });
}
