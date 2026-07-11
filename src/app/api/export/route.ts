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

function csvEscape(value: string | number | null | undefined) {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/\"/g, "\"\"")}"`;
  }
  return str;
}

function formatDateForCsv(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "stats";
  const start = normalizeDate(url.searchParams.get("start")) || "2026-01-01";
  const end = normalizeDate(url.searchParams.get("end")) || getTodayInIST();

  const pool = getPool();

  if (type === "products") {
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

    const header = ["Product", "Variant", "Items Sold", "Orders"];
    const lines = rows.map((row) =>
      [
        row.product_title,
        row.variant_title || "",
        row.quantity,
        row.orders_count,
      ]
        .map(csvEscape)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=\"product-wise-${start}-to-${end}.csv\"`,
      },
    });
  }

  const statsSql = `
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

  const statsResult = await pool.query(statsSql, [start, end]);
  const header = [
    "Date",
    "Total Orders",
    "Fulfilled",
    "Unfulfilled",
    "Cancelled",
    "COD",
    "Prepaid",
    "Not Answering",
  ];
  const lines = statsResult.rows.map((row) => [
    formatDateForCsv(row.day),
    Number(row.total_orders),
    Number(row.fulfilled_orders),
    Number(row.unfulfilled_orders),
    Number(row.cancelled_orders),
    Number(row.cod_orders),
    Number(row.prepaid_orders),
    Number(row.not_answering_orders),
  ]);
  const csv = [header.join(","), ...lines.map((row) => row.map(csvEscape).join(","))].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=\"daily-stats-${start}-to-${end}.csv\"`,
    },
  });
}
