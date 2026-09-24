// Pulls order -> email + phone from Shopify Admin API for Jan 2026 onward,
// writes them into orders.customer_email / customer_phone.
//
// Processes one calendar month at a time. Before touching Shopify, checks
// whether that month still has rows missing both fields — if not, skips
// straight to the next month. Safe to stop and re-run any time; it will
// never redo a month that's already complete.
//
//   SHOPIFY_SHOP              *.myshopify.com handle
//   SHOPIFY_CLIENT_ID         from AWL Customer Sync's Settings > Credentials
//   SHOPIFY_CLIENT_SECRET     from the same Credentials page
//   DATABASE_URL              same connection string the app uses

import pg from "pg";

const { SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, DATABASE_URL } = process.env;

const required = { SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, DATABASE_URL };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(`Missing env var(s): ${missing.join(", ")}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const API_VERSION = "2024-10";

function getMonthRanges() {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const endYear = nowIST.getUTCFullYear();
  const endMonth = nowIST.getUTCMonth();
  const ranges = [];
  let year = 2026, month = 0;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    ranges.push({
      label: `${year}-${String(month + 1).padStart(2, "0")}`,
      min: `${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00+05:30`,
      max: `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01T00:00:00+05:30`,
    });
    month = nextMonth;
    year = nextYear;
  }
  return ranges;
}

async function getAccessToken() {
  const res = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function fetchWithRetry(url, options, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? 2) * 1000;
        console.warn(`  Rate limited, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (err) {
      if (i === attempts) throw err;
      console.warn(`  Network error (attempt ${i}/${attempts}): ${err.message}. Retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Shopify rule: once page_info is present, no other filter params
// (status, fields, date range) are allowed on that request — they're
// already baked into the cursor from the first page. Only send them
// on the very first page of each month.
async function fetchOrdersPage(accessToken, min, max, pageInfo) {
  const url = new URL(`https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/orders.json`);
  url.searchParams.set("limit", "250");
  if (pageInfo) {
    url.searchParams.set("page_info", pageInfo);
  } else {
    url.searchParams.set("status", "any");
    url.searchParams.set("fields", "id,email,phone,created_at");
    url.searchParams.set("created_at_min", min);
    url.searchParams.set("created_at_max", max);
  }

  const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": accessToken } });
  if (!res.ok) throw new Error(`Shopify API error ${res.status}: ${await res.text()}`);

  const linkHeader = res.headers.get("link");
  const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
  const nextPageInfo = nextMatch ? new URL(nextMatch[1]).searchParams.get("page_info") : null;

  const data = await res.json();
  return { orders: data.orders ?? [], nextPageInfo };
}

// Writes an entire page in ONE query instead of one UPDATE per order.
async function saveOrdersBatch(orders) {
  const withData = orders.filter((o) => o.email || o.phone);
  if (withData.length === 0) return 0;

  const ids = withData.map((o) => o.id);
  const emails = withData.map((o) => (o.email ? o.email.toLowerCase() : null));
  const phones = withData.map((o) => o.phone ?? null);

  const result = await pool.query(
    `UPDATE orders o
     SET customer_email = COALESCE(v.email, o.customer_email),
         customer_phone = COALESCE(v.phone, o.customer_phone)
     FROM (SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[]) AS v(id, email, phone)) AS v
     WHERE o.id = v.id`,
    [ids, emails, phones]
  );
  return result.rowCount ?? 0;
}

async function monthNeedsWork(min, max) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS remaining
     FROM orders
     WHERE (created_at AT TIME ZONE 'Asia/Kolkata') >= $1::timestamptz
       AND (created_at AT TIME ZONE 'Asia/Kolkata') <  $2::timestamptz
       AND customer_email IS NULL
       AND customer_phone IS NULL`,
    [min, max]
  );
  return rows[0].remaining;
}

async function run() {
  const accessToken = await getAccessToken();
  console.log("Got access token via Client Credentials Grant.\n");

  const months = getMonthRanges();
  let grandTotal = 0;

  for (const { label, min, max } of months) {
    const remaining = await monthNeedsWork(min, max);
    if (remaining === 0) {
      console.log(`${label}: already complete, skipping.`);
      continue;
    }
    console.log(`${label}: ${remaining} orders still missing email/phone, processing...`);

    let pageInfo = null;
    let monthUpdated = 0;
    let page = 0;

    do {
      page += 1;
      const { orders, nextPageInfo } = await fetchOrdersPage(accessToken, min, max, pageInfo);
      const updated = await saveOrdersBatch(orders);
      monthUpdated += updated;
      grandTotal += updated;
      console.log(`  page ${page}: ${orders.length} orders, ${updated} updated`);
      pageInfo = nextPageInfo;
      if (pageInfo) await new Promise((r) => setTimeout(r, 500));
    } while (pageInfo);

    console.log(`${label}: done, ${monthUpdated} orders updated this month.\n`);
  }

  console.log(`All months processed. Total updated this run: ${grandTotal}.`);
  await pool.end();
}

run().catch((err) => {
  console.error("\nStopped early:", err.message);
  console.error("Safe to just run the script again — it will skip whatever's already done.");
  process.exit(1);
});