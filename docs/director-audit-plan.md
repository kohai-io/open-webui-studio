# Director interaction history and audit plan

Status: future implementation, 26 September 2026. This document records the agreed direction for later work. It does not enable auditing or change the current generation path. Test the existing Director release first using [the stage test guide](director-stage-test.md).

## Outcome

Make each Director generation traceable to its Open WebUI user, project, shot or reference, submitted inputs and resulting outputs. Provide readable history in Open WebUI and a durable event record that survives normal chat editing and deletion. History synchronisation must never repeat a paid generation.

## Current baseline

- Studio authenticates provider calls with the signed-in user's Open WebUI token. Projects and generation jobs are owner-scoped in Studio's independent SQLite database.
- Text and pipe requests use `/api/chat/completions` without saved-chat fields. They do not create an Open WebUI conversation. Studio saves prompts and parsed planning proposals, but not complete returned text or usage.
- Generated images and videos are saved as user-owned Open WebUI files. Images include generation metadata; videos include provider task and generation options. Director does not currently associate those files with saved chat messages.
- The Runway pipe has a separate job/task mapping database. It supports recovery and deduplication, not a complete audit transcript.
- Job state and review notes can change. Current job records are operational history, not an append-only event ledger.
- Open WebUI HTTP audit logging is independently configurable, may truncate bodies, and is not a replacement for explicit interaction records. Live logging configuration has not been verified.

## Proposed ownership

| Component                 | Responsibility                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Studio                    | Production state, generation lifecycle, canonical interaction events, pending history deliveries |
| Open WebUI                | Identity, model permissions, durable media, readable conversations grouped by Director project   |
| Central audit destination | Retained event copies, restricted audit access and protection independent of user chat deletion  |

Use one Open WebUI conversation per generation job, grouped in a project folder where the deployed API supports it. Keep the same conversation across status updates and recovery for that job. An explicit new take gets a new job and conversation. This limits concurrent writes to any one conversation. Do not create conversations for each polling request.

Studio must use the user-scoped Open WebUI API. It must not open Open WebUI's database or import its internal model classes. If physical storage of the canonical ledger inside Open WebUI's database becomes mandatory, scope an authenticated Open WebUI extension and migrations separately; do not add direct database access from Studio.

## Event and history contract

Define a versioned event schema containing:

- A unique event ID, generation job ID, per-job sequence, event time, owning OWUI user ID and actor ID. Derive identity from the authenticated session, never browser-submitted identity.
- Project ID and revision, shot/reference ID, operation, instruction-pack version, effective prompt and ordered input file references.
- Requested model ID and effective provider/model/settings when known, including image provider configuration. Mark unavailable values explicitly.
- Submission attempt ID, correlation/request IDs and provider task ID when available.
- Lifecycle transition, returned text before proposal parsing, parsed proposal, output file IDs, sanitised errors and recovery decisions.
- Reported usage and its source; cost only when supplied or computed from a recorded, versioned price source. Missing usage/cost is unknown, not zero. Video polling is not a new generation.

Record queueing, submission intent, acceptance, completion, failure, unknown outcome, cancellation, resume, result acceptance and review-note changes. For a failed proposal parse, retain the returned content with the failure event. Record capability checks and polling failures as operational events; successful unchanged polls need not duplicate full payloads. Metadata-only access logs can cover every HTTP interaction.

Exclude credentials, tokens, secret headers and provider URLs containing credentials. Store permitted content encrypted with explicit size bounds. If an oversized response must be bounded, record that fact and preserve it through an approved encrypted attachment mechanism where required; do not silently label truncated content complete. Generated media remains in OWUI storage, referenced by ID.

## Persistence and delivery

Add an additive migration with three logical records (final numbering follows the migration sequence at implementation time):

1. `studio_director_audit_event`: immutable event envelope and encrypted payload, unique event ID and `(job_id, sequence)`.
2. `studio_director_audit_delivery`: mutable delivery state per event/destination, attempt count, retry time, claim lease, last error and acknowledgement.
3. `studio_director_owui_history`: owner/project/job mapping to OWUI folder/chat/message IDs and synchronisation state.

Write a lifecycle change, its audit event and delivery intent in the same Studio database transaction. Persist submission intent before the provider call. If that local write fails, do not submit. Persist the result before trying to update remote history. A remote history outage must not turn a successful generation into a failed generation.

A separate delivery worker sends pending history updates with bounded backoff. Use deterministic message IDs and reconcile existing records before retrying an ambiguous write. Verify chat/folder creation semantics: do not assume OWUI supports caller-supplied IDs or idempotency keys. An uncertain creation response must enter reconciliation instead of blindly creating another chat. Never invoke a generation API from the delivery worker.

Use normal user credentials with existing expiry and ownership checks. History delivery needs its own bounded credential lease because generation credentials are cleared at completion. Expired credentials pause only the user's history delivery until reauthentication; do not use an administrator token or extend a token's actual expiry.

Treat OWUI chat content as a readable projection of the stored events. Do not replay the audit conversation as model context or let a user-edited message change a production job. If a user deletes a mirrored chat, preserve the ledger and show the missing-history state; do not silently recreate deleted chats. Provide an explicit restore-history action later if needed.

## API and UI work

- Add Director-specific history methods to the OWUI adapter. Preserve the current Flow text-completion contract.
- Use verified chat/folder/message APIs and supported file linkage. Avoid rewriting an entire shared project chat for each completed shot.
- Capture effective image configuration and provider task metadata through a minimal versioned bridge extension where existing responses do not expose them. Snapshot settings at execution time.
- Add an owner-scoped job history view with model, prompt, settings, result, status and available usage. Display `History sync pending`, `Sign in to sync` and a link to the OWUI conversation when created.
- Keep generation status separate from history delivery status. Failed history delivery offers retry-sync, not regenerate.
- Restrict administrative audit queries and exports independently from ordinary project access. Keep secret values out of exports and logs.
- Verify OWUI message indexing against the deployed version. Mark synthetic media/control messages clearly and exclude them from misleading token/model counts where possible. Use the ledger for generation and provider-cost reporting; do not promise stock OWUI analytics measures video costs.

## Retention and operational decisions

Before enabling this feature, agree retention for prompts, returned content, metadata, media and audit copies; who can review/export records; and the central log destination. These remain deployment decisions, not hard-coded policy.

Use append-only application APIs and restricted write access for events. Restrict retention deletion to an explicit audited maintenance path. Ship copies to a separately protected destination with delivery monitoring. Encryption and append-only code alone do not establish tamper-proof storage; evaluate independent integrity checks and destination retention controls against the actual audit requirement.

Back up the Studio database, encryption-key material and Runway mapping database through the deployment's normal mechanisms. Test restoration and reconcile pending deliveries. Account deletion and retention expiry must follow the agreed policy without confusing ordinary chat deletion with audit erasure.

## Implementation sequence

| Phase              | Work                                                                                                            | Exit criterion                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Verify contract | Inspect deployed OWUI version, chat/folder/message updates, media linkage, indexing and creation reconciliation | Contract fixtures and a documented recovery strategy; no paid calls needed          |
| 2. Capture events  | Migration, encrypted events, transactional outbox, returned-content and usage capture                           | Success, failure and unknown outcomes survive restarts with correct ownership       |
| 3. Mirror history  | User-scoped history adapter, mapping, independent delivery worker, reauthentication                             | Text/image/video job history appears in OWUI; sync failures never repeat generation |
| 4. Audit access    | Job history UI, explicit sync states, authorised export, central delivery and retention configuration           | Per-user visibility and operational alerts verified; deletion semantics documented  |
| 5. Roll out        | Mock acceptance, restricted stage validation, feature flags and recovery runbook                                | End-to-end evidence from stage and a tested rollback procedure                      |

Keep capture and history delivery behind separate feature flags. Preserve captured events and pending deliveries on rollback. Do not backfill missing historical responses or usage by inventing values or rerunning jobs. Imported older jobs must be labelled as partial historical records.

## Acceptance tests

- Two users cannot read, link or overwrite one another's events, chats or output files; recheck access during delivery.
- Every generation has an event before submission and a terminal or explicitly uncertain outcome after recovery.
- Concurrent shots produce distinct, complete history. Duplicate deliveries do not duplicate messages or media.
- Crashes before/after submission, local checkpoint, remote chat creation and acknowledgement produce the documented recoverable state.
- OWUI outage, expired credentials, deleted chats and denied file access do not trigger a provider submission.
- Failed/malformed planning results retain returned content; unknown usage remains unknown; prompts/settings match the submitted snapshot.
- Cancel/resume/accept/review changes append events without rewriting previous records. No secrets appear in content, metadata, exports or logs.
- Backup restoration, retention, central-delivery outage and feature-flag rollback preserve the stated guarantees.
- Existing Director and Flow tests continue to pass. Live validation uses a deliberately bounded test, after the current release has been exercised.

## References

- [Current Director setup](director-setup.md)
- [Open WebUI analytics](https://docs.openwebui.com/features/administration/analytics/)
- [Open WebUI audit logging configuration](https://docs.openwebui.com/reference/env-configuration/)
- [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
