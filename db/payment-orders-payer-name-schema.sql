ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payer_name
  text CHECK (payer_name IS NULL OR char_length(payer_name) BETWEEN 1 AND 80);
