# Open WebUI Studio

Private companion application for Open WebUI. Studio owns product-specific state for agents, media timelines, and flows while Open WebUI remains authoritative for users, permissions, models, chats, files, and Knowledge.

The initial integration contract is maintained in the adjacent Open WebUI repository at `docs/owui-studio-contract.md`.

## Runtime

- Node.js `22.17.0` (see `.nvmrc`)
- SvelteKit with TypeScript and `adapter-node`
- Application base path: `/studio`

## Local development

```powershell
nvm use
npm ci
npm run dev
```

The shell is available at `http://localhost:5173/studio`. Copy `.env.example` to an ignored local environment file and supply secrets through your local secret mechanism.

## Verification

```powershell
npm run format
npm run lint
npm run check
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

## Open WebUI adapter

`src/lib/server/owui` contains the server-only v0.10.2 adapter, normalized contracts, stable error mapping, and deterministic test stub. It covers OAuth token exchange, current identity, filtered models/agents, paginated files, paginated Knowledge, and chat creation. Mutations are never retried automatically; idempotent reads receive at most one transient retry.

## Database and sessions

Studio owns an independent SQLite database under `data/` by default. Numbered SQL migrations are applied transactionally and recorded in `studio_migration`. Session cookies will contain only random opaque handles; the database stores their SHA-256 hashes and AES-256-GCM encrypted OIDC/OWUI session payloads. Supply `SESSION_ENCRYPTION_KEY` as 32 random bytes encoded with base64 through the deployment secret manager.

Generic OIDC login, callback, and logout routes live under `/studio/auth`. They use discovery, Authorization Code + PKCE, state, nonce, single-use encrypted transactions, subject binding, and the upstream OWUI provider-token exchange. The core flow is provider-neutral for eventual Okta use; automated tests use an in-process fake provider and require no external IdP.

## Flow execution

Studio stores Flow definitions, immutable versions, encrypted execution payloads, ordered checkpoints, metadata-only events, and execution-bound OWUI credential leases in its own database. The in-process worker claims queued runs, refreshes heartbeats, evaluates supported text nodes, and calls the user-scoped OWUI completion adapter once per Model node.

Set `FLOW_WORKER_ENABLED=false` for web-only replicas. Worker settings in `.env.example` control polling, claim and heartbeat timing, run and node deadlines, and the global claim limit. Assign each worker replica a distinct `FLOW_WORKER_ID`, and keep the heartbeat interval below the claim TTL.

Authenticated APIs live under `/studio/api/flows` and `/studio/api/executions`. Mutations enforce same-origin browser requests, execution creation requires an `Idempotency-Key` header, and progress streams through owner-scoped server-sent events.

## Container

The multi-stage Dockerfile builds on Node 22, installs production dependencies only in the runtime image, and runs as the unprivileged `studio` user. Its health endpoint is `/studio/health` and returns no configuration or secret values.

## Security boundary

- Never access the Open WebUI database, storage paths, or internal model classes.
- Never expose provider tokens, Open WebUI JWTs, API keys, or administrator credentials to browser JavaScript or logs.
- Resolve Open WebUI references through the typed, user-scoped server adapter and revalidate access at use time.

## Image flows

Open `/studio/flows` and choose **New image flow** or **New image edit flow**. Name and save the flow, enter a prompt, then run it. Image editing accepts up to eight PNG, JPEG or WebP references from Media, uploaded files (10 MB each), or the sketch tool. Use **Use sketch as reference** before running; the drawing surface is temporary, while its saved image remains in Open WebUI.

The Image node uses Open WebUI's configured generation or editing model. Enable the corresponding image feature in Open WebUI and grant the user image-generation permission. Image size defaults to Open WebUI's setting; optional sizes still depend on the configured provider. An existing Model node can refine a text prompt before an Image node. To chain edits, connect the earlier Image node to an Image node configured for editing, then connect that node to an Output configured as Images.

Images are stored as Open WebUI files. Studio records typed file references in encrypted execution inputs and checkpoints, revalidates ownership before use, and previews results through its existing Media endpoint. Run history restores the prompt and image references; retries are explicit new runs. Image mutations are never automatically retried. Cancellation stops Studio waiting for the request, but cannot guarantee that the upstream provider stops work already accepted.

Set `BODY_SIZE_LIMIT=12M` when running the Node adapter to allow multipart uploads (included in the Docker image). `FLOW_IMAGE_NODE_TIMEOUT_MS` defaults to 300000; the existing overall run deadline still applies. The image HTTP request is also capped at five minutes.

This first version supports separate image references and freehand sketches. It does not composite layers, create masks, or enable agent/function execution. Existing text flows keep their format and behavior.

Run `npm run test:e2e:images` for the authenticated browser checks. They use an isolated test database and local mock Open WebUI provider, with no real model calls or credentials. The usual `npm run test:integration`, `npm run check` and `npm run lint` cover the shared implementation.
