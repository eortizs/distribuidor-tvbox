CREATE TABLE IF NOT EXISTS wa_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  push_name     text CHECK (push_name IS NULL OR char_length(push_name) BETWEEN 1 AND 80),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  inbound_count integer NOT NULL DEFAULT 0 CHECK (inbound_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_contacts_tenant_phone_key UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS wa_contacts_tenant_last_seen_idx
  ON wa_contacts (tenant_id, last_seen_at DESC);

DROP TRIGGER IF EXISTS set_tenant_id ON wa_contacts;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON wa_contacts
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wa_contacts;
CREATE POLICY tenant_isolation ON wa_contacts
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT, UPDATE ON wa_contacts TO speilink_app;
