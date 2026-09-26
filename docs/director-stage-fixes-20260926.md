# Director stage fixes — 26 September 2026

The first live video task was blocked by provider input moderation. These fixes make that result understandable in Director and remove an unrelated false warning after frame acceptance. They do not change moderation, generation prompts, provider settings or automatic retry behaviour.

Status: the user confirmed installation of the replacement Studio image on stage. Its UI fixes were verified live. The existing OWUI Runway function was then updated to 3.1.1 and its connection check passed. The separate kettle test passed first-frame generation, five-second video delivery, playback, acceptance, reload persistence and export with non-silent audio. See the [live test report](director-stage-results-20260926.md) for evidence and remaining coverage limits.

## Changes to deploy together

1. **Runway pipe 3.1.1:** retain a validated failure code, return the actual Runway task UUID and include both in cached responses. Arbitrary provider messages and URLs are excluded. Existing mappings survive an additive SQLite column migration. Both provider cancellation spellings are supported.
2. **Studio image:** persist the optional diagnostics in the encrypted job, explain moderation/invalid-file/provider-unavailable/general failures, and show the code and task UUID under Provider details. Existing records with no diagnostics still display a generic failure explanation. Long codes wrap within the take card.
3. **Studio image:** compare inputs appropriate to each operation when showing a stale-take warning. Accepting that frame's output does not mark it stale; changed prompts, relevant reference images and video inputs still do.

The pipe and Studio changes remain compatible with protocol version 1. Either may be updated first. Both are needed for complete diagnostics on future jobs. No new Studio environment variables or database migrations are needed.

The already-blocked task remains failed. Its discarded failure code is not backfilled automatically, and deployment does not submit or retry media jobs. The code supplied by the user is recorded in the [live test report](director-stage-results-20260926.md).

## Verification

- Live stage: the original failed take now displays a provider failure explanation, its accepted frame has no false stale warning, and its saved revision/data remain intact. This verifies the deployed behaviour; the running Docker digest was not independently inspected after the user's installation.
- Live OWUI: updated the existing `runway_video_generation` function to 3.1.1, preserving its identity and valves. The previous source was backed up to `data/runway-stage-before-3.1.1.py`; its AST matched the tested local source outside the version metadata and changed Studio methods. Functions visibly reports 3.1.1 and Director still reports Seedance ready. Evidence: `data/director-stage-runway-3.1.1-20260926.png`.
- Live kettle test: one image and one video generation succeeded, with no duplicate submissions. The video task UUID appears in Director and the exported manifest. The production ZIP contains a 1280×720, 24 fps H.264 clip lasting 5.056 seconds with stereo AAC audio. ZIP integrity and complete video/audio decoding passed; audio is non-silent. The accepted take survived reload and no jobs remain active. Sound character needs a human listening review; dialogue and lip-sync were not tested.
- 186 Studio integration tests passed.
- 11 Runway protocol tests passed, including the old database migration, owner isolation, retained moderation diagnostics and no repeat generation on failed tasks.
- Svelte/TypeScript: zero errors and warnings.
- ESLint passed for changed source/test files.
- All three Director browser regression tests passed, including reload persistence, frame acceptance, three-shot retakes and export with a mock provider. The focused rerun also passed for diagnostic text wrapping on desktop and mobile.
- The final `linux/amd64` image ran as user `studio`, became healthy, served health/Director with HTTP 200 and rejected an invalid test session at the Director API with HTTP 401. Normal lazy service initialization applied all three Director tables. The isolated smoke container had no mounted data or enabled generation workers and was removed after verification.

## Published image

```text
git.theoldschool.house/robert/open-webui-studio@sha256:3cc0f36e7deef411b40451900f25e2057e19ffc54c07014a268e856556bd9953
```

- Tag: `director-fixes-20260926-124912`.
- Registry manifest digest verified after pushing.
- Source base revision: `df2d51c174cf7e53a5a9e85211fdaed20de3c16d` plus the uncommitted Director work and these fixes.
- Build-time source manifest SHA-256: `32c85be48c45bfdc618eec7ff282831535ccc2ee65732eebc2148dab5d8d5a06`. Release documentation was completed after publishing.
- Build records: `data/director-fixes-image-build.json`, `data/director-fixes-image-source-manifest.txt`, `data/director-fixes-image-metadata.json` and `data/director-fixes-image-build.log` (ignored local artifacts).
- The existing image build reports one moderate runtime dependency advisory; dependency changes are outside this focused patch.

## Installation

Update the existing `runway_video_generation` function from the adjacent stage checkout's `functions_tools/functions/runway_inline.py` (3.1.1). Preserve credentials and current valves, especially `ENABLE_STUDIO_API=true` and the existing chat confirmation setting. Keep its persistent `DATA_DIR/studio-runway-jobs.sqlite3`.

Install the replacement Studio digest through the established installer on pve2, LXC 107, after confirming Studio has no active generation jobs. Preserve `/etc/open-webui-studio/runtime.env`, persistent data and encryption keys. The initial release's [deployment instructions](director-stage-release.md) remain applicable.

Run on **pve2** once Studio is idle:

```sh
pct exec 107 -- /usr/local/lib/owui-deploy/install-or-update.sh studio \
  git.theoldschool.house/robert/open-webui-studio@sha256:3cc0f36e7deef411b40451900f25e2057e19ffc54c07014a268e856556bd9953 \
  --confirm-studio-idle
```

The prior stage digest remains available for rollback:
`git.theoldschool.house/robert/open-webui-studio@sha256:87b682a3f3a4ace095184c3217d22747e35f496a61fc56facccdba7880515de0`.

These installation steps have now been completed on stage. The connection check and a separate benign kettle test passed. The earlier moderated scene remains available for diagnosis and was not retried.
