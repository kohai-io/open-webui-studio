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

## Container

The multi-stage Dockerfile builds on Node 22, installs production dependencies only in the runtime image, and runs as the unprivileged `studio` user. Its health endpoint is `/studio/health` and returns no configuration or secret values.

## Security boundary

- Never access the Open WebUI database, storage paths, or internal model classes.
- Never expose provider tokens, Open WebUI JWTs, API keys, or administrator credentials to browser JavaScript or logs.
- Resolve Open WebUI references through the typed, user-scoped server adapter and revalidate access at use time.
