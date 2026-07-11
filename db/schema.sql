CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  financial_status TEXT,
  fulfillment_status TEXT,
  cancelled_at TIMESTAMPTZ,
  tags TEXT,
  total_price NUMERIC,
  currency TEXT
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);
CREATE INDEX IF NOT EXISTS orders_updated_at_idx ON orders (updated_at);

CREATE TABLE IF NOT EXISTS order_line_items (
  line_item_id BIGINT PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  product_title TEXT,
  variant_title TEXT,
  quantity INTEGER,
  sku TEXT,
  variant_id BIGINT,
  product_id BIGINT
);

CREATE INDEX IF NOT EXISTS order_line_items_order_id_idx ON order_line_items (order_id);
CREATE INDEX IF NOT EXISTS order_line_items_product_title_idx ON order_line_items (product_title);
