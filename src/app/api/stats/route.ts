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
    WITH days AS (
      SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
    ),
    agg AS (
      SELECT
        (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled_orders,
        COUNT(*) FILTER (WHERE fulfillment_status = 'fulfilled') AS fulfilled_orders,
        COUNT(*) FILTER (
          WHERE cancelled_at IS NULL
            AND (fulfillment_status IS NULL OR fulfillment_status IN ('partial', 'unfulfilled'))
        ) AS unfulfilled_orders,
        COUNT(*) FILTER (
          WHERE upper(financial_status) IN ('PENDING', 'AUTHORIZED')
        ) AS cod_orders,
        COUNT(*) FILTER (WHERE upper(financial_status) = 'PAID') AS prepaid_orders,
        COUNT(*) FILTER (WHERE tags ILIKE '%not answering%') AS not_answering_orders
      FROM orders
      WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date
        BETWEEN $1::date AND $2::date
      GROUP BY 1
    )
    SELECT
      d.day,
      COALESCE(a.total_orders, 0) AS total_orders,
      COALESCE(a.cancelled_orders, 0) AS cancelled_orders,
      COALESCE(a.fulfilled_orders, 0) AS fulfilled_orders,
      COALESCE(a.unfulfilled_orders, 0) AS unfulfilled_orders,
      COALESCE(a.cod_orders, 0) AS cod_orders,
      COALESCE(a.prepaid_orders, 0) AS prepaid_orders,
      COALESCE(a.not_answering_orders, 0) AS not_answering_orders
    FROM days d
    LEFT JOIN agg a ON a.day = d.day
    ORDER BY d.day;
  `;

  type RawRow = {
    day: string;
    total_orders: string | number;
    cancelled_orders: string | number;
    fulfilled_orders: string | number;
    unfulfilled_orders: string | number;
    cod_orders: string | number;
    prepaid_orders: string | number;
    not_answering_orders: string | number;
  };

  const result = await pool.query<RawRow>(sql, [start, end]);
  const rows = (result.rows as RawRow[]).map((row: RawRow) => ({
    ...row,
    total_orders: Number(row.total_orders),
    cancelled_orders: Number(row.cancelled_orders),
    fulfilled_orders: Number(row.fulfilled_orders),
    unfulfilled_orders: Number(row.unfulfilled_orders),
    cod_orders: Number(row.cod_orders),
    prepaid_orders: Number(row.prepaid_orders),
    not_answering_orders: Number(row.not_answering_orders),
  }));

  return NextResponse.json({
    start,
    end,
    timezone: "Asia/Kolkata",
    rows,
  });
}
