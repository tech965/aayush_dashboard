"use client";

import { useEffect, useMemo, useState } from "react";

type StatsRow = {
  day: string;
  total_orders: number;
  cancelled_orders: number;
  fulfilled_orders: number;
  unfulfilled_orders: number;
  cod_orders: number;
  prepaid_orders: number;
  not_answering_orders: number;
};

type ProductRow = {
  product_title: string;
  variant_title?: string | null;
  quantity: number;
  orders_count?: number;
};

const TIMEZONE = "Asia/Kolkata";
const DEFAULT_START = "2026-01-01";

function formatDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDisplayDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function pct(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export default function Dashboard() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return formatDateInput(d);
  });
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));
  const [rows, setRows] = useState<StatsRow[]>([]);
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "unfulfilled">("overview");
  const [loading, setLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // RTO estimator inputs (user-entered assumptions, in %)
  const [codRtoPercent, setCodRtoPercent] = useState<string>("");
  const [prepaidRtoPercent, setPrepaidRtoPercent] = useState<string>("");
  const [showRtoInputs, setShowRtoInputs] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/stats?start=${startDate}&end=${endDate}`
        );
        if (!res.ok) {
          throw new Error("Failed to load stats.");
        }
        const data = await res.json();
        if (active) {
          setRows(data.rows || []);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchStats();
    return () => {
      active = false;
    };
  }, [startDate, endDate]);

  useEffect(() => {
    if (activeTab !== "products") return;
    let active = true;
    const fetchProducts = async () => {
      setProductLoading(true);
      try {
        const res = await fetch(
          `/api/products?start=${startDate}&end=${endDate}`
        );
        if (!res.ok) {
          throw new Error("Failed to load products.");
        }
        const data = await res.json();
        if (active) {
          setProductRows(data.rows || []);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (active) {
          setProductLoading(false);
        }
      }
    };
    fetchProducts();
    return () => {
      active = false;
    };
  }, [activeTab, startDate, endDate]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += Number(row.total_orders) || 0;
        acc.cancelled += Number(row.cancelled_orders) || 0;
        acc.fulfilled += Number(row.fulfilled_orders) || 0;
        acc.unfulfilled += Number(row.unfulfilled_orders) || 0;
        acc.cod += Number(row.cod_orders) || 0;
        acc.prepaid += Number(row.prepaid_orders) || 0;
        acc.notAnswering += Number(row.not_answering_orders) || 0;
        return acc;
      },
      {
        total: 0,
        cancelled: 0,
        fulfilled: 0,
        unfulfilled: 0,
        cod: 0,
        prepaid: 0,
        notAnswering: 0,
      }
    );
  }, [rows]);

  // Unfulfilled orders split into two buckets:
  // - Confirmed by Team: unfulfilled orders where the customer WAS reached/confirmed
  // - Not Answering: unfulfilled orders where the customer could not be reached
  const unfulfilledInsights = useMemo(() => {
    const confirmedByTeam = Math.max(
      0,
      totals.unfulfilled - totals.notAnswering
    );
    return {
      unfulfilled: totals.unfulfilled,
      confirmedByTeam,
      notAnswering: totals.notAnswering,
      confirmedRate: pct(confirmedByTeam, totals.unfulfilled),
      notAnsweringRate: pct(totals.notAnswering, totals.unfulfilled),
    };
  }, [totals.unfulfilled, totals.notAnswering]);

  const maxUnfulfilledBucket = Math.max(
    1,
    unfulfilledInsights.confirmedByTeam,
    unfulfilledInsights.notAnswering
  );

  const productTotals = useMemo(() => {
    return productRows.reduce(
      (acc, row) => {
        acc.totalQuantity += Number(row.quantity) || 0;
        return acc;
      },
      { totalQuantity: 0 }
    );
  }, [productRows]);

  // Expected RTO % = (COD orders * COD RTO% + Prepaid orders * Prepaid RTO%) / Total Fulfilled Orders
  const rtoEstimate = useMemo(() => {
    const codRate = parseFloat(codRtoPercent);
    const prepaidRate = parseFloat(prepaidRtoPercent);
    const validCodRate = isNaN(codRate) ? 0 : codRate;
    const validPrepaidRate = isNaN(prepaidRate) ? 0 : prepaidRate;

    const expectedCodRto = totals.cod * (validCodRate / 100);
    const expectedPrepaidRto = totals.prepaid * (validPrepaidRate / 100);
    const expectedTotalRtoOrders = expectedCodRto + expectedPrepaidRto;
    const expectedRtoPercent = pct(expectedTotalRtoOrders, totals.fulfilled);

    return {
      hasInputs: codRtoPercent !== "" || prepaidRtoPercent !== "",
      expectedCodRto,
      expectedPrepaidRto,
      expectedTotalRtoOrders,
      expectedRtoPercent,
    };
  }, [codRtoPercent, prepaidRtoPercent, totals.cod, totals.prepaid, totals.fulfilled]);

  const maxTotal = Math.max(
    1,
    ...rows.map((row) => Number(row.total_orders) || 0)
  );

  const downloadCsv = (type: "stats" | "products") => {
    const url = `/api/export?type=${type}&start=${startDate}&end=${endDate}`;
    window.location.href = url;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Start Date
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-[var(--ink)] shadow-sm"
            />
          </div>
          <div className="flex flex-col text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            End Date
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-[var(--ink)] shadow-sm"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[var(--muted)]">
          {loading ? "Syncing latest stats..." : "Webhook data is live"}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            activeTab === "overview"
              ? "bg-[var(--accent)] text-white"
              : "border border-black/10 bg-white text-[var(--muted)]"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            activeTab === "products"
              ? "bg-[var(--accent)] text-white"
              : "border border-black/10 bg-white text-[var(--muted)]"
          }`}
        >
          Product Wise
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("unfulfilled")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            activeTab === "unfulfilled"
              ? "bg-[var(--accent)] text-white"
              : "border border-black/10 bg-white text-[var(--muted)]"
          }`}
        >
          Unfulfilled Insights
        </button>
        <button
          type="button"
          onClick={() =>
            downloadCsv(activeTab === "products" ? "products" : "stats")
          }
          className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[var(--muted)]"
        >
          Export CSV
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {activeTab === "overview" && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total Orders" value={totals.total} tone="accent" />
            <StatCard
              label="Fulfilled"
              value={totals.fulfilled}
              tone="green"
              percent={pct(totals.fulfilled, totals.total)}
            />
            <StatCard
              label="Unfulfilled"
              value={totals.unfulfilled}
              tone="amber"
              percent={pct(totals.unfulfilled, totals.total)}
            />
            <StatCard
              label="Cancelled"
              value={totals.cancelled}
              tone="rose"
              percent={pct(totals.cancelled, totals.total)}
            />
            <StatCard
              label="COD"
              value={totals.cod}
              tone="slate"
              percent={pct(totals.cod, totals.total)}
            />
            <StatCard
              label="Prepaid"
              value={totals.prepaid}
              tone="emerald"
              percent={pct(totals.prepaid, totals.total)}
            />
            <StatCard
              label="Expected RTO %"
              value={Math.round(rtoEstimate.expectedTotalRtoOrders)}
              tone="ink"
              percent={
                rtoEstimate.hasInputs
                  ? rtoEstimate.expectedRtoPercent
                  : undefined
              }
              onClick={() => setShowRtoInputs((prev) => !prev)}
              hint={showRtoInputs ? "Click to hide" : "Click to set assumptions"}
            />
          </div>

          {showRtoInputs && (
            <div className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow)] md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
                  RTO Estimator
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  (COD × COD RTO% + Prepaid × Prepaid RTO%) ÷ Fulfilled Orders
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  COD RTO %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={codRtoPercent}
                    onChange={(event) => setCodRtoPercent(event.target.value)}
                    placeholder="e.g. 18"
                    className="mt-2 w-32 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-[var(--ink)] shadow-sm"
                  />
                </div>
                <div className="flex flex-col text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Prepaid RTO %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={prepaidRtoPercent}
                    onChange={(event) => setPrepaidRtoPercent(event.target.value)}
                    placeholder="e.g. 3"
                    className="mt-2 w-32 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-[var(--ink)] shadow-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6 rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow)]">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
                Daily Volume Pulse
              </p>
              <h2 className="text-2xl font-semibold text-[var(--ink)]">
                Orders per day
              </h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {rows.map((row) => {
                const height = Math.round(
                  (Number(row.total_orders) / maxTotal) * 120
                );
                return (
                  <div key={row.day} className="flex flex-col items-center gap-2">
                    <div
                      className="w-6 rounded-full bg-[var(--chart)]/80"
                      style={{ height: `${height || 6}px` }}
                    />
                    <span className="text-[10px] text-[var(--muted)]">
                      {new Date(row.day).getDate()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-black/10 bg-white/90 shadow-[0_18px_40px_var(--shadow)]">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
                  Daily Breakdown
                </p>
                <h3 className="text-xl font-semibold text-[var(--ink)]">
                  {formatDisplayDate(startDate)} to {formatDisplayDate(endDate)}
                </h3>
              </div>
              <div className="text-xs font-semibold text-[var(--muted)]">
                Updated {formatDateInput(new Date())}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--surface-strong)] text-left text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  <tr>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Total</th>
                    <th className="px-6 py-3">Fulfilled</th>
                    <th className="px-6 py-3">Unfulfilled</th>
                    <th className="px-6 py-3">Cancelled</th>
                    <th className="px-6 py-3">COD</th>
                    <th className="px-6 py-3">Prepaid</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const dayTotal = Number(row.total_orders) || 0;
                    return (
                      <tr
                        key={row.day}
                        className="border-b border-black/5 last:border-0"
                      >
                        <td className="px-6 py-4 font-semibold">
                          {formatDisplayDate(row.day)}
                        </td>
                        <td className="px-6 py-4 font-semibold text-[var(--accent-dark)]">
                          {Number(row.total_orders)}
                        </td>
                        <td className="px-6 py-4">
                          {Number(row.fulfilled_orders)}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(Number(row.fulfilled_orders), dayTotal).toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {Number(row.unfulfilled_orders)}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(Number(row.unfulfilled_orders), dayTotal).toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {Number(row.cancelled_orders)}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(Number(row.cancelled_orders), dayTotal).toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {Number(row.cod_orders)}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(Number(row.cod_orders), dayTotal).toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {Number(row.prepaid_orders)}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(Number(row.prepaid_orders), dayTotal).toFixed(1)}%)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-8 text-center text-[var(--muted)]"
                      >
                        No data yet. Run backfill to load January 1, 2026 onward.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "products" && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              label="Total Quantity"
              value={productTotals.totalQuantity}
              tone="accent"
            />
            <StatCard
              label="Distinct Products"
              value={productRows.length}
              tone="ink"
            />
          </div>

          <div className="overflow-hidden rounded-3xl border border-black/10 bg-white/90 shadow-[0_18px_40px_var(--shadow)]">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
                  Product Wise Report
                </p>
                <h3 className="text-xl font-semibold text-[var(--ink)]">
                  {formatDisplayDate(startDate)} to {formatDisplayDate(endDate)}
                </h3>
              </div>
              <div className="text-xs font-semibold text-[var(--muted)]">
                {productLoading
                  ? "Loading products..."
                  : `Updated ${formatDateInput(new Date())}`}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--surface-strong)] text-left text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  <tr>
                    <th className="px-6 py-3">Product</th>
                    <th className="px-6 py-3">Items Sold</th>
                    <th className="px-6 py-3">% of Total</th>
                    <th className="px-6 py-3">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {productRows.map((row) => (
                    <tr
                      key={`${row.product_title}-${row.variant_title || ""}`}
                      className="border-b border-black/5 last:border-0"
                    >
                      <td className="px-6 py-4 font-semibold">
                        {row.variant_title
                          ? `${row.product_title} - ${row.variant_title}`
                          : row.product_title}
                      </td>
                      <td className="px-6 py-4 font-semibold text-[var(--accent-dark)]">
                        {Number(row.quantity)}
                      </td>
                      <td className="px-6 py-4 text-[var(--muted)]">
                        {pct(
                          Number(row.quantity),
                          productTotals.totalQuantity
                        ).toFixed(1)}
                        %
                      </td>
                      <td className="px-6 py-4">{Number(row.orders_count)}</td>
                    </tr>
                  ))}
                  {productRows.length === 0 && !productLoading && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-8 text-center text-[var(--muted)]"
                      >
                        No product data yet. Run the product backfill to load
                        line items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "unfulfilled" && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="Unfulfilled Orders"
              value={unfulfilledInsights.unfulfilled}
              tone="amber"
              percent={pct(unfulfilledInsights.unfulfilled, totals.total)}
            />
            <StatCard
              label="Confirmed by Team"
              value={unfulfilledInsights.confirmedByTeam}
              tone="emerald"
              percent={unfulfilledInsights.confirmedRate}
            />
            <StatCard
              label="Not Answering"
              value={unfulfilledInsights.notAnswering}
              tone="rose"
              percent={unfulfilledInsights.notAnsweringRate}
            />
          </div>

          <div className="flex flex-col gap-6 rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow)]">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
                Team Response Breakdown
              </p>
              <h2 className="text-2xl font-semibold text-[var(--ink)]">
                Confirmed by Team vs Not Answering
              </h2>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--ink)]">
                    Confirmed by Team
                  </span>
                  <span className="text-[var(--muted)]">
                    {new Intl.NumberFormat("en-IN").format(
                      unfulfilledInsights.confirmedByTeam
                    )}{" "}
                    ({unfulfilledInsights.confirmedRate.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-black/5">
                  <div
                    className="h-3 rounded-full bg-emerald-400/80"
                    style={{
                      width: `${Math.max(
                        2,
                        Math.round(
                          (unfulfilledInsights.confirmedByTeam /
                            maxUnfulfilledBucket) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--ink)]">
                    Not Answering
                  </span>
                  <span className="text-[var(--muted)]">
                    {new Intl.NumberFormat("en-IN").format(
                      unfulfilledInsights.notAnswering
                    )}{" "}
                    ({unfulfilledInsights.notAnsweringRate.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-black/5">
                  <div
                    className="h-3 rounded-full bg-rose-400/80"
                    style={{
                      width: `${Math.max(
                        2,
                        Math.round(
                          (unfulfilledInsights.notAnswering /
                            maxUnfulfilledBucket) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-[var(--muted)]">
              Of all unfulfilled orders, your team has successfully reached
              and confirmed{" "}
              <span className="font-semibold text-[var(--ink)]">
                {unfulfilledInsights.confirmedRate.toFixed(1)}%
              </span>
              , while{" "}
              <span className="font-semibold text-[var(--ink)]">
                {unfulfilledInsights.notAnsweringRate.toFixed(1)}%
              </span>{" "}
              remain unreachable.
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-black/10 bg-white/90 shadow-[0_18px_40px_var(--shadow)]">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
                  Daily Unfulfilled Breakdown
                </p>
                <h3 className="text-xl font-semibold text-[var(--ink)]">
                  {formatDisplayDate(startDate)} to {formatDisplayDate(endDate)}
                </h3>
              </div>
              <div className="text-xs font-semibold text-[var(--muted)]">
                Updated {formatDateInput(new Date())}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--surface-strong)] text-left text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  <tr>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Unfulfilled</th>
                    <th className="px-6 py-3">Confirmed by Team</th>
                    <th className="px-6 py-3">Not Answering</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const dayUnfulfilled = Number(row.unfulfilled_orders) || 0;
                    const dayNotAnswering =
                      Number(row.not_answering_orders) || 0;
                    const dayConfirmed = Math.max(
                      0,
                      dayUnfulfilled - dayNotAnswering
                    );
                    return (
                      <tr
                        key={row.day}
                        className="border-b border-black/5 last:border-0"
                      >
                        <td className="px-6 py-4 font-semibold">
                          {formatDisplayDate(row.day)}
                        </td>
                        <td className="px-6 py-4 font-semibold text-[var(--accent-dark)]">
                          {dayUnfulfilled}
                        </td>
                        <td className="px-6 py-4">
                          {dayConfirmed}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(dayConfirmed, dayUnfulfilled).toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {dayNotAnswering}{" "}
                          <span className="text-xs text-[var(--muted)]">
                            ({pct(dayNotAnswering, dayUnfulfilled).toFixed(1)}%)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-8 text-center text-[var(--muted)]"
                      >
                        No data yet. Run backfill to load January 1, 2026 onward.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: number;
  tone:
    | "accent"
    | "green"
    | "amber"
    | "rose"
    | "slate"
    | "emerald"
    | "purple"
    | "ink";
  percent?: number; // 0-100, optional
  onClick?: () => void;
  hint?: string;
};

function StatCard({ label, value, tone, percent, onClick, hint }: StatCardProps) {
  const formatted = new Intl.NumberFormat("en-IN").format(value);
  const toneMap: Record<StatCardProps["tone"], string> = {
    accent: "from-[#fef3c7] to-[#fde68a] text-[#b45309]",
    green: "from-[#d1fae5] to-[#a7f3d0] text-[#065f46]",
    amber: "from-[#ffedd5] to-[#fed7aa] text-[#9a3412]",
    rose: "from-[#ffe4e6] to-[#fecdd3] text-[#9f1239]",
    slate: "from-[#e2e8f0] to-[#cbd5f5] text-[#1e293b]",
    emerald: "from-[#dcfce7] to-[#bbf7d0] text-[#166534]",
    purple: "from-[#ede9fe] to-[#ddd6fe] text-[#5b21b6]",
    ink: "from-[#f5f5f5] to-[#e5e5e5] text-[#111827]",
  };

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-2xl border border-black/10 bg-gradient-to-br p-4 text-left shadow-[0_14px_30px_var(--shadow)] ${toneMap[tone]} ${
        onClick ? "cursor-pointer transition hover:brightness-95" : ""
      }`}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.18em]">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-[var(--ink)]">
          {formatted}
        </span>
        {percent !== undefined && (
          <span className="text-sm font-semibold text-[var(--ink)]/60">
            ({percent.toFixed(1)}%)
          </span>
        )}
      </div>
      {hint && (
        <span className="text-[10px] font-medium normal-case tracking-normal text-[var(--ink)]/50">
          {hint}
        </span>
      )}
    </Wrapper>
  );
}