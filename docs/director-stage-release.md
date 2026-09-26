# Director stage image — 26 September 2026

Status: built, checked locally, published and installed by the user on pve2 container 107. Live planning and first-frame generation passed. Runway v3.1.0 is installed and its Studio API valve was enabled with user approval. The connection check passed; one video task reached running and survived reload, then was blocked by provider input moderation (`INPUT_PREPROCESSING.SAFETY.THIRD_PARTY`). No video file was returned and no retry was submitted. See [stage test results](director-stage-results-20260926.md).

A [replacement image and pipe 3.1.1](director-stage-fixes-20260926.md) are now prepared for the next test, with provider diagnostics and the frame-acceptance warning fix. This page records the initial installed image.

## Published image

```text
git.theoldschool.house/robert/open-webui-studio@sha256:87b682a3f3a4ace095184c3217d22747e35f496a61fc56facccdba7880515de0
```

- Tag: `director-20260926-120903`.
- Platform: `linux/amd64`; runtime user: `studio`.
- Base Git revision: `df2d51c174cf7e53a5a9e85211fdaed20de3c16d`, plus the uncommitted Director implementation and documentation present at build time. The base revision alone does not identify the complete source.
- Source manifest SHA-256: `c64315f38a087356d42246e464e289892c57636c03f70d480a81854b44ff0698`.
- Node base image: `node:22.17.0-alpine@sha256:fc3e945f920b7e3000cd1af86c4ae406ec70c72f328b667baf0f3a8910d69eed`.
- Local build evidence is in ignored `data/director-image-build.json`, `data/director-image-source-manifest.txt` and `data/director-image-metadata.json`.

Registry inspection confirmed the published manifest digest. All 180 integration tests passed before building. An isolated local container became healthy, served `/studio/health` and `/studio/director` with HTTP 200, and applied the three Director tables. The container used dummy identity configuration and disabled workers; no paid generation occurred. Earlier mock browser/protocol results are recorded in the [test guide](director-stage-test.md).

## Install on stage

Deployment target supplied by the user: `pve2` (`10.100.1.16`), container `107`, public companion URL `https://owui-stage.theoldschool.house/studio/`.

Use the existing deployment's backup and idle-check procedure. Preserve Studio's database, encryption key and OIDC settings. Configure the following in the **Studio service environment consumed by the installer**, not merely in the interactive host shell:

```dotenv
DIRECTOR_ENABLED=true
DIRECTOR_WORKER_ENABLED=true
DIRECTOR_VIDEO_MODEL_ID=runway_video_generation
```

The user confirmed that `/etc/open-webui-studio/compose.yaml` loads `./runtime.env`. Configure these variables in **`/etc/open-webui-studio/runtime.env` inside LXC 107**, then recreate the Studio service. The Compose image field requires `SERVICE_IMAGE` to contain an immutable digest reference. `.env.example` is not loaded automatically in the production image. Run only one Director worker process.

Once Studio is idle, run the user's installer on pve2 with the new digest:

```sh
pct exec 107 -- /usr/local/lib/owui-deploy/install-or-update.sh studio \
  git.theoldschool.house/robert/open-webui-studio@sha256:87b682a3f3a4ace095184c3217d22747e35f496a61fc56facccdba7880515de0 \
  --confirm-studio-idle
```

Then update the existing Runway function backing `runway_video_generation` using version 3.1.0 of `functions_tools/functions/runway_inline.py` in the adjacent stage checkout. Preserve its identity, credentials and existing valves, and enable `ENABLE_STUDIO_API`. This pipe update is separate from the Studio image.

Open `/studio/director`, sign in and use **Check video connection** before generating media. Follow [the one-shot stage test](director-stage-test.md). A visible Director library proves the route/feature is enabled, not that every provider is ready.

## Rollback and remaining work

Retain the previously installed digest and deployment backups. If rollback is needed, use the installer's established procedure, preserve the additive Studio records and the pipe mapping database, and reconcile any already-submitted video tasks. Do not resubmit jobs as part of rollback.

The image includes the current Director feature only. The [audit implementation plan](director-audit-plan.md) remains future work. Live OIDC, model access and first-frame generation passed; video and generated speech/sound still need stage validation.
