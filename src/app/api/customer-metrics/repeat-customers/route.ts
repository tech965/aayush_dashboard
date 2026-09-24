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

function escapeCsvField(value: string | number) {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = normalizeDate(url.searchParams.get("start")) || "2026-01-01";
    const end = normalizeDate(url.searchParams.get("end")) || getTodayInIST();
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = format === "csv" ? null : Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

    const pool = getPool();

    const { rows: colRows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'orders' AND table_schema = 'public'`
    );
    const existingColumns = new Set(colRows.map((r) => r.column_name));
    const idColumn = CANDIDATE_ID_COLUMNS.find((c) => existingColumns.has(c));

    if (!idColumn) {
      return NextResponse.json(
        { error: "No customer identifier column found on orders." },
        { status: 500 }
      );
    }

    const hasPhoneColumn = existingColumns.has("customer_phone");
    const phoneSelect = hasPhoneColumn
      ? `(ARRAY_AGG(o.customer_phone ORDER BY o.created_at DESC) FILTER (WHERE o.customer_phone IS NOT NULL))[1]`
      : `NULL::text`;

    const { rows } = await pool.query(
      `
      WITH per_customer AS (
        SELECT
          o."${idColumn}" AS customer_key,
          ${phoneSelect} AS phone,
          COUNT(*)::int AS order_count,
          SUM(o.total_price)::numeric AS total_spent,
          MIN(o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS first_order_date,
          MAX(o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS last_order_date
        FROM orders o
        WHERE o.fulfillment_status = 'fulfilled'
          AND o."${idColumn}" IS NOT NULL
          AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
          AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date
        GROUP BY o."${idColumn}"
        HAVING COUNT(*) > 1
      )
      SELECT
        customer_key,
        phone,
        order_count,
        total_spent,
        ROUND(total_spent / order_count, 2) AS avg_order_value,
        first_order_date,
        last_order_date,
        (last_order_date - first_order_date) AS days_as_customer
      FROM per_customer
      ORDER BY total_spent DESC
      ${limit ? `LIMIT ${limit}` : ""}
      `,
      [start, end]
    );

    const cleanRows = rows.map((r) => ({
      customer_key: r.customer_key,
      phone: r.phone ?? null,
      order_count: Number(r.order_count),
      total_spent: Number(r.total_spent),
      avg_order_value: Number(r.avg_order_value),
      first_order_date: r.first_order_date,
      last_order_date: r.last_order_date,
      days_as_customer: Number(r.days_as_customer),
    }));

    const { rows: summaryRows } = await pool.query(
      `
      WITH per_customer AS (
        SELECT
          o."${idColumn}" AS customer_key,
          COUNT(*)::int AS order_count,
          SUM(o.total_price)::numeric AS total_spent,
          MIN(o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS first_order_date,
          MAX(o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS last_order_date
        FROM orders o
        WHERE o.fulfillment_status = 'fulfilled'
          AND o."${idColumn}" IS NOT NULL
          AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
          AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date
        GROUP BY o."${idColumn}"
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::int AS "repeatCustomerCount",
        COALESCE(SUM(total_spent), 0)::numeric AS "repeatRevenue",
        COALESCE(AVG(order_count), 0)::numeric AS "avgOrdersPerRepeatCustomer",
        COALESCE(AVG(total_spent), 0)::numeric AS "avgSpendPerRepeatCustomer",
        COALESCE(AVG(last_order_date - first_order_date), 0)::numeric AS "avgDaysAsCustomer"
      FROM per_customer
      `,
      [start, end]
    );
    const summaryRaw = summaryRows[0] ?? {};
    const summary = {
      repeatCustomerCount: Number(summaryRaw.repeatCustomerCount) || 0,
      repeatRevenue: Number(summaryRaw.repeatRevenue) || 0,
      avgOrdersPerRepeatCustomer: Number(summaryRaw.avgOrdersPerRepeatCustomer) || 0,
      avgSpendPerRepeatCustomer: Number(summaryRaw.avgSpendPerRepeatCustomer) || 0,
      avgDaysAsCustomer: Number(summaryRaw.avgDaysAsCustomer) || 0,
    };

    if (format === "csv") {
      const header = "Customer,Phone,Orders,Total Spent,Avg Order Value,First Order,Last Order,Days as Customer";
      const lines = cleanRows.map((r) =>
        [
          escapeCsvField(r.customer_key),
          escapeCsvField(r.phone ?? ""),
          r.order_count,
          r.total_spent,
          r.avg_order_value,
          r.first_order_date,
          r.last_order_date,
          r.days_as_customer,
        ].join(",")
      );
      const csv = [header, ...lines].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="repeat-customers-${start}-to-${end}.csv"`,
        },
      });
    }

    return NextResponse.json({ start, end, identifierColumnUsed: idColumn, summary, rows: cleanRows });
  } catch (err) {
    console.error("repeat-customers export error:", err);
    return NextResponse.json(
      { error: "Failed to load repeat customer data." },
      { status: 500 }
    );
  }
}
