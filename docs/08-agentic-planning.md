# Automated planning and project assistant — v0.4

The existing estimator now has a goal-driven planning workspace. It retains the existing vanilla browser application, deterministic geometry engine, local project/photo storage and optional Census endpoint. No building measurements or property facts are inferred from an address.

## Working automatic tools

- Compare all applicable combinations of the three catalog products per selected trade and three price tiers (81 full-scope combinations, plus the current custom-price plan when different). Candidate duplication is removed.
- Enter a target budget, or include a supported amount in a goal such as “replace 4 windows under $8,000.” A fit requires the **upper** calculated endpoint to be within budget. An overlapping range is explicitly labeled a risk, not a fit.
- Allow phased work to explore subsets of the selected trades and 25%/50% siding coverage where applicable. This is opt-in. Dimensions and requested replacement counts are not altered to achieve a fit. Ranking favors retained scope first, then the highest catalog spend that fits; it is not an empirically validated product recommendation.
- Review missing details. Prefilled values start unconfirmed. A homeowner can mark an individual detail checked, and editing that field revokes confirmation. This is provenance tracking, not an accuracy/confidence score or professional verification.
- Apply a calculated plan with an explicit button and undo it. Changes invalidate previous comparisons and in-flight assistant results.
- Autosave a small device draft of the project, goal, budget and confirmation state. A draft available on reload has a restore/discard control. Opening a named project or starting a new one starts saving that selected project as the working draft. Photos remain in the existing explicit project-save flow.
- Download a contractor discussion brief containing the estimate, assumptions, missing details, target budget and a site-review checklist. It does not contact anyone or book an appointment.

When AI is unavailable, the automatic planner can parse explicitly supported goal patterns: replacement counts, “windows/doors/siding only,” siding product, tier, numeric footprint dimensions in feet and story count. Unsupported free-form requests are identified as requiring AI; the tool does not pretend to understand them. Proposed values stay unconfirmed.

## AI agent

`POST /api/assistant` runs AI SDK `ToolLoopAgent` with these allowlisted tools:

| Tool | Behavior |
| --- | --- |
| `inspectProject` | Recalculates the estimate and reports unconfirmed details and exclusions. Forced on the first step. |
| `proposeProject` | Validates a requested input/option patch, calculates a proposal and leaves application to the homeowner. It cannot edit rates, mark details confirmed or write storage. |
| `comparePlans` | Runs the same exhaustive deterministic catalog search with the request's budget and phasing setting. |
| `matchAddress` | Calls only the fixed Census address-range geocoder; returns approximate coordinates, no dimensions. One attempt per request. |

The loop is limited to four model steps, 1,100 output tokens per step, zero automatic model retries, a 25-second total deadline and a 12-second step deadline. The last step requests a final response without more tools. Proposal/comparison tool calls are bounded per request. Model replies are rendered as text, never HTML; displayed proposal prices are recomputed in the browser.

The model ID `openai/gpt-6-luna` was checked against the live Gateway catalog on 2026-10-17. It supports tools and is inexpensive for bounded prototype requests. `AI_GATEWAY_MODEL` can override it with another compatible live Gateway ID. No model is used for cost arithmetic.

## Runtime and authentication

- Node 22.x; pinned AI SDK 7.0.143, Zod and `@vercel/oidc` production dependencies. The SDK's installed version-matched docs were used for the agent implementation.
- On Vercel, enable project OIDC tokens; the SDK uses the current request-context token, with `VERCEL_OIDC_TOKEN` as the local fallback. Availability checks use `getVercelOidcTokenSync()` rather than checking only process environment variables. No provider key is shipped to the browser or committed. The project OIDC setting is enabled for the hosted prototype.
- Local development runs all automatic tools without credentials. To exercise AI locally, supply an existing `AI_GATEWAY_API_KEY` or valid linked-project OIDC token through the process environment. A plain Node server does not automatically load `.env.local`.
- `GET /api/assistant` checks credentials and the Gateway credit endpoint without inference. It exposes only `ai`/`planner` availability and a safe message, never credit balances or credentials. It cannot guarantee that a subsequent model request will succeed.
- Account verification, credits, model access, outages or project budgets may prevent inference. The page labels fallback as **Automatic planner** and still runs deterministic planning. No payment method, credits purchase, budget increase or paid upgrade is activated by this change.
- The dev server applies the existing security headers from `lib/web.mjs`.

## Privacy and operating limits

An explicit AI submission sends the goal, current numeric inputs/options, confirmation keys and up to six short conversation messages to the AI service. The address field is not silently added to the AI context; an address typed into the goal is part of that submitted text and can be sent to Census by the address tool. Photos stay local and are not analyzed by AI. Application handlers do not log prompts, addresses, provider responses or tokens; hosting/provider logs and retention require production configuration and a privacy policy.

The endpoint rejects non-JSON bodies, oversized requests, invalid context, arbitrary system-role history and cross-origin browser submissions. Provider failures are sanitized. An eight-requests-per-ten-minutes guard uses hashed caller IP keys **per warm function instance**; it is not a distributed production quota. Deployment protection should remain enabled. Public launch still requires durable abuse protection, team/project spend controls, monitoring and suitable account/privacy flows.

## Verification

`npm run check` covers syntax, unit/integration tests and public asset packaging. The SDK loop is tested with its actual mock provider abstraction, exercising inspect → propose → compare → final response. HTTP tests cover request validation, origin, size, provider outages and throttling. Chromium checks cover both AI transport fixtures and real automatic fallback, phased budgets, apply/undo, confirmation invalidation, actual brief downloads, device-draft restoration, text-only response rendering and ten responsive viewports.

Mock model/provider tests do not establish live inference availability. Deployment and live connection status are recorded in PR #1 after rollout verification.
