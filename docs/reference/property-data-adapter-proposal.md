# Supplied property-data adapter proposal

> Design reference supplied by the project owner. The implemented v0.5 scope is documented in [the integration guide](../09-property-data-adapter.md). PostgreSQL tables and queued `/v1` endpoints below are a future design, not deployed services.

## Design choice

Implement the MVP as an **authorized-data ingestion adapter**, not a scraper of consumer real-estate websites. RESO standardizes how MLS data can be exchanged, but access is granted by local MLSs under their own agreements. Bridge likewise routes developers to MLS data providers and explains that licensing is handled by those providers. Zillow’s Bridge public-records/Zestimate datasets are a separate approved-access route; Redfin’s terms prohibit automated crawling or querying without express written permission. [RESO Web API](https://www.reso.org/reso-web-api/) [Bridge API](https://www.bridgeinteractive.com/developers/bridge-api/) [Zillow Group data via Bridge](https://www.bridgeinteractive.com/developers/zillow-group-data/) [Redfin Terms of Use](https://www.redfin.com/about/terms-of-use)

The prototype in [the adapted importer](../../tools/authorized_property_ingest.py) calls a provider API endpoint configured by the operator, normalizes selected fields, and stores only the normalized record. It requires an explicit `DATA_USE_APPROVED=true` setting. It does not scrape webpages, collect listing photos, or store raw vendor responses.

## PostgreSQL schema

Use a stable internal property ID and keep source-specific facts as source-stamped snapshots. This preserves provenance and avoids pretending that different providers’ fields have identical meanings. In production, enforce each provider’s field, display, retention, redistribution, and AI-processing conditions through an approved data-access grant.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_address TEXT NOT NULL,
  street TEXT,
  unit TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'US',
  parcel_id TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_address)
);

CREATE TABLE provider_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  coverage_region TEXT,
  agreement_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','suspended','expired')),
  allowed_purposes TEXT[] NOT NULL DEFAULT '{}',
  allowed_fields TEXT[] NOT NULL DEFAULT '{}',
  may_store BOOLEAN NOT NULL DEFAULT false,
  may_display BOOLEAN NOT NULL DEFAULT false,
  may_process_with_ai BOOLEAN NOT NULL DEFAULT false,
  may_use_media BOOLEAN NOT NULL DEFAULT false,
  retention_days INTEGER,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE property_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider_grant_id UUID NOT NULL REFERENCES provider_grants(id),
  provider_record_id TEXT,
  facts JSONB NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE (property_id, provider_grant_id, provider_record_id)
);
CREATE INDEX property_facts_property_time_idx
  ON property_facts(property_id, retrieved_at DESC);

CREATE TABLE property_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider_grant_id UUID NOT NULL REFERENCES provider_grants(id),
  provider_media_id TEXT,
  media_kind TEXT NOT NULL DEFAULT 'exterior_photo',
  storage_key TEXT,
  source_url TEXT,
  content_sha256 TEXT,
  permissions JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (storage_key IS NULL OR source_url IS NULL)
);

CREATE TABLE lookup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_address TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','no_match','failed')),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
```

`property_facts.facts` should contain only fields permitted by the specific provider agreement. A normalized shape for the estimator is: `living_area_sqft`, `bedrooms`, `bathrooms`, `stories`, `year_built`, `property_type`, `parcel_id`, and optional `lot_area_sqft`. Keep original provider field names in a `source_fields` sub-object only when allowed. Use `source_updated_at` and `retrieved_at` separately; they mean different things.

Treat photos as a separate permissioned resource. MLS Grid, for example, documents that its media URLs are for downloading a local copy and must not be used directly in an app or website. Confirm whether download, storage, display, and AI image processing are each allowed before enabling those operations. [MLS Grid API documentation](https://docs.mlsgrid.com/api-documentation/api-version-2.0)

## Adapter API endpoints

- `POST /v1/property-lookups` — accepts `{ "address": "...", "purpose": "estimate" }`; returns `202` with `{ "lookup_id": "...", "status": "queued" }`. Validate the purpose against the approved provider grant before dispatch.
- `GET /v1/property-lookups/{lookup_id}` — returns job state and, when complete, the internal `property_id`; never expose provider credentials or raw payloads.
- `GET /v1/properties/{property_id}` — returns the latest allowed canonical facts, with a `sources` array containing provider, retrieval time, and freshness.
- `GET /v1/properties/{property_id}/sources` — returns source-level provenance and usage metadata safe to disclose to the client.
- `POST /v1/properties/{property_id}/corrections` — saves homeowner-confirmed values separately from provider facts, recording field, corrected value, timestamp, and actor. Do not overwrite source facts.
- `GET /v1/data-providers` — returns enabled providers and supported coverage areas, not secret configuration.
- Add `GET /v1/properties/{property_id}/media` only after photo rights are confirmed. Return app-controlled media references, not unapproved or expiring vendor URLs.

Require authentication, request throttling, address validation, idempotency keys for lookups, audit logs, and deletion/retention jobs. Provider calls should run asynchronously with bounded retries and explicit states for no-match, denial, timeout, and provider failure.

## MVP ingestion flow

1. User submits an address and a permitted use case.
2. Adapter selects a provider that is approved for the location and purpose.
3. Adapter requests the property through that provider’s API/feed, normalizes only approved fields, and records the provider plus timestamps.
4. UI shows the source and freshness, then lets the homeowner correct uncertain values.
5. Estimation code consumes canonical facts and homeowner corrections. It should return ranges and confidence, not claim exact window/door counts based only on beds, baths, or square footage.

The included Python script is a provider-neutral prototype. It expects the selected provider’s permitted API to return JSON. You must configure its URL template and field mapping to match the provider’s actual documentation, credentials, and license. No universal Zillow, Redfin, or MLS endpoint is assumed.
