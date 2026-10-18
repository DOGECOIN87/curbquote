# Authorized property-data integration — v0.5

This implements the supplied provider-neutral importer design inside the existing CurbQuote application. It does not connect a specific paid provider, scrape consumer websites, provision a database, or authorize a data agreement. The supplied attachments are preserved; the adapted Python entry point is `tools/authorized_property_ingest.py`.

## Implemented flow

1. **Find property** starts two independent requests: existing Census address-range matching and `POST /api/property` for a configured authorized property API. In v0.6, a complete typed address also starts Census matching automatically; a successful match requests property facts only when a provider is configured. A failure in either leaves manual estimating available.
2. The property adapter validates the configured grant and permitted purpose, contacts only the configured HTTPS origin and normalizes only allowed canonical fields.
3. The homeowner sees the returned address, source provider, retrieval time, separately reported source-update time and permitted facts. Multiple records require a more specific address rather than selecting the first one.
4. The homeowner checks the record's address/unit, selects compatible fields and uses **Use selected details**. Only a whole-number story count from 1–4 and a construction year from 1700–2100 can enter the current estimator. Other facts are reference information.
5. Imported values remain unconfirmed and source-labeled. Homeowner edits are recorded separately from the original source facts. Eligible attribution/corrections survive drafts and named projects and appear in estimate/contractor exports.
6. Changing the address clears source attribution and restores the values from before import. Undo imported details does the same. A new address does not silently inherit an old property's imported values.

**Living area, lot area, bedrooms and bathrooms never become exterior dimensions, siding area or opening counts.** Stories/year are still source-reported facts requiring review. No numerical confidence score or measurement accuracy claim is introduced.

## API contract

| Endpoint | Behavior |
| --- | --- |
| `GET /api/property` | Returns configured/not-configured status and a safe provider label. No provider request or address is sent. |
| `POST /api/property` | Accepts `{ "address": "123 Example St, Austin, TX 78701", "purpose": "estimate" }`; returns normalized `facts`, `source` and safe `warnings` synchronously. |

Source metadata includes `provider`, `retrievedAt`, `sourceUpdatedAt` (or null), `expiresAt` (or null), `retentionDays` and explicit display/store/AI/export permissions. No provider URL, API credential, agreement reference, owner/contact information, listing photos, raw payload or undeclared vendor fields is returned.

Errors distinguish invalid requests (400), denied coverage/use (403), no match (404), ambiguous records (409), excessive input (413), unsupported body type (415), throttling (429), invalid/upstream response (502), unavailable/unconfigured source (503) and deadline (504).

The current adapter is a single bounded request with no provider retries or durable state. The proposed PostgreSQL schema and queued `/v1` endpoints remain a [design reference](reference/property-data-adapter-proposal.md). They are not exposed as pretend asynchronous jobs backed by temporary function memory or SQLite.

## Provider setup

No live provider variables were configured in the hosted project during this implementation. The deployment reports that state explicitly. An actual endpoint, credentials and an approved grant are required to retrieve real property facts.

Use `.env.example` as a disabled template. Configure these values in the server environment, never browser code:

| Variable | Meaning |
| --- | --- |
| `DATA_USE_APPROVED` | Exactly `true`, only after the operator has established the actual applicable data agreement. This flag is not itself proof of legal rights. |
| `PROPERTY_PROVIDER_NAME` | Displayable source name, maximum 100 characters. |
| `PROPERTY_LOOKUP_URL` | HTTPS URL containing exactly one `{address}` placeholder in the path or query. |
| `PROPERTY_ALLOWED_HOSTS` | Comma-separated exact hostnames; the URL's hostname must be listed. No wildcards, IP literals, localhost or alternate HTTPS ports. |
| `PROPERTY_API_KEY` | Optional Bearer token, used only by the server. Other authentication protocols require a provider-specific implementation. |
| `PROPERTY_RESPONSE_PATH` | Optional dotted path to a single record or array containing exactly one record. Array indices are supported in dotted paths. |
| `PROPERTY_FIELD_MAP` | Optional complete JSON mapping of canonical names to provider field paths. Omitted = canonical names. Unknown canonical fields and prototype-related path segments are rejected. |
| `PROPERTY_SOURCE_UPDATED_PATH` | Optional source-update timestamp path relative to the property object. It does not substitute for retrieval time. |
| `PROPERTY_GRANT_JSON` | Actual approved grant, field/purpose permissions, coverage, effective/expiry dates and retention policy. |

The grant requires `status`, `agreement_reference`, `allowed_purposes`, `allowed_fields` and `coverage_regions`. Permission flags default false: `may_store`, `may_display`, `may_process_with_ai`, `may_export`. `retention_days`, `effective_at` and `expires_at` can be null. An approved, currently effective display grant is required before any lookup. Coverage supports U.S. state codes or `US` for an agreement covering the whole U.S.; narrower county/parcel grants need additional provider-specific scope enforcement before activation. A regional grant is checked against the provider's returned region, not guessed from the request string.

Local development does not automatically load `.env.local`:

```sh
npm ci --ignore-scripts
node --env-file=.env.local scripts/dev-server.mjs
```

Add equivalent environment variables to the Vercel project and redeploy for hosted use. Do not paste credentials into chat, source control or a frontend configuration file.

## Permission boundaries

The existing app autosaves drafts, supports downloaded reports and can submit numeric estimate context to AI. Therefore automatic import is enabled only when the configured source permits **display, storage, AI processing and export**, with no bounded retention period or expiration. This is a deliberate limitation of this prototype's current local-storage workflow, not an interpretation that all property providers grant these rights.

More restrictive sources remain temporary **display only**. Their facts are not copied into inputs, drafts, saved projects, reports or AI messages. A time-limited record is removed from memory and the DOM at expiration; tab visibility changes also trigger expiry checks. Browser persistence rejects restricted source contexts even if a caller bypasses the import button. Raw source snapshots are not automatically stored on the server.

The agent's new `lookupProperty` tool requires the same compatible permissions **before** contacting the provider, is limited to one attempt, and leaves import to the homeowner review controls. Before forwarding saved source context to a model, the assistant API rechecks the current server grant, provider and allowed fields; changing or disabling that grant prevents further AI use of that context. Provider values are not marked homeowner-confirmed automatically. Live AI still requires available Gateway credits independently of property-provider setup.

Operator grant changes cannot recall existing offline exports or copies. Public production operation needs appropriate license/retention architecture, authenticated homeowner accounts, durable rate/spend controls and deletion workflows. Restricted grants should remain display-only until those workflows are designed and implemented.

## Transport and operations

- Only the operator configures the endpoint, grant and field map; request bodies cannot supply them.
- Public DNS results are validated and pinned into the HTTPS connection while preserving TLS hostname verification. Private/local/reserved targets are rejected. HTTP redirects are not followed or given credentials.
- A 6.5-second provider deadline covers DNS and response reading. Responses must be plain JSON and at most 1 MiB. Non-200 bodies are discarded.
- Request bodies are at most 2 KiB, use JSON POST rather than an address query string, and reject cross-origin browser submissions. Responses use `Cache-Control: no-store`.
- A six-lookups-per-ten-minutes guard is per warm function instance. It supplements the existing Vercel deployment protection, not a distributed quota.
- Application code does not log provider payloads, addresses, URLs, API keys or raw exceptions. Hosting/provider logging and retention remain operational considerations.

## Adapted Python importer

The provided Python interface is retained, but network access now goes through the shared Node adapter. This avoids maintaining a second, weaker implementation of grant validation, DNS/redirect handling and field normalization.

```sh
# With server configuration exported in the process environment:
python3 tools/authorized_property_ingest.py "123 Example St, Austin, TX 78701" --no-store
python3 tools/authorized_property_ingest.py "123 Example St, Austin, TX 78701" --db ./property-snapshots.sqlite3
```

CLI exports require explicit export permission and unbounded retention, because an unmanaged JSON file cannot be recalled automatically. SQLite writes additionally require storage permission and a provider-reported address. `property_snapshots_v2` appends normalized, source-stamped snapshots; it does not overwrite the legacy script's table or replace prior facts on a second import. No raw vendor response is stored. SQLite is an operator-local utility, never Vercel's application database.

## Verification

Run `npm run check`, `npm run test:python` and `npm run test:browser`. Provider calls in regression tests use explicitly labeled synthetic fixtures, not a real license or live paid API. Tests cover grants, coverage, field mapping, malformed data, ambiguity, transport/DNS/redirect/size/deadline behavior, restricted AI access, source/correction separation, SQLite retention guards and the complete homeowner review/save/export/address-change flow.
