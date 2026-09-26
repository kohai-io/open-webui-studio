# Studio Director

See [the take review workspace](director-review-workspace.md) for result selection, comparison and review notes.

See [generation controls and frame preparation](director-generation-controls.md) for duplicate protection, job progress and the video crop workflow.

Director adds a production workspace at `/studio/director`: project briefs, character and location references, storyboard editing, scoped Assistant proposals, image generation/editing, Seedance video jobs, take comparison, human review notes, sequence preview and ZIP export.

Follow the [stage test guide](director-stage-test.md) for a first production. The [interaction history and audit plan](director-audit-plan.md) is deferred work; the current release does not save a complete per-user interaction transcript in Open WebUI.

## Enable the workspace

1. Build/deploy this Studio version using the existing OIDC and Open WebUI configuration. Startup applies the additive `0008_director.sql` migration. Back up the Studio database using the existing deployment procedure first.
2. Set `DIRECTOR_ENABLED=true`. Keep `DIRECTOR_WORKER_ENABLED=true` on one Studio process. For stage, set `DIRECTOR_VIDEO_MODEL_ID=runway_video_generation`, matching the [installed Runway model](https://owui-stage.theoldschool.house/?model=runway_video_generation). This preselects the video pipe in new projects; existing and duplicated projects retain their chosen model. The worker runs one provider request at a time, checks known video tasks between submissions, and keeps work alive when a browser leaves the page.
3. Update the **existing** Runway pipe in Open WebUI with `functions_tools/functions/runway_inline.py` from the adjacent stage checkout (version 3.1.1). Preserve its ID and existing valves, including `ENABLE_STUDIO_API=true`. Existing chat confirmation remains controlled by `REQUIRE_CONFIRMATION`; Studio's explicit Generate action supplies confirmation for the structured API.
4. Configure Open WebUI's image generation/editing provider for the desired GPT Image model. Director uses that configuration; it does not change global image settings or select a separate provider per project.
5. Open Director, create a project, choose the planning model and verify the selected Runway pipe in **Brief**, then use **Check video connection**. This check does not generate media. The default model setting does not grant model access; Open WebUI still checks the signed-in user's permissions.

No deployment configuration, live model settings or installed pipe was changed by the source implementation. Enabling Director requires the normal deployment step and the pipe update above. No extra provider credentials are placed in Studio or the browser.

## Production workflow

Enter the brief and visual treatment. Add character/location references, then generate or choose reference images. In Assistant, draft a storyboard and apply the proposed shots. Assign references to a shot, generate a first frame and accept it in Takes. Generate video and audio from the storyboard. Review and accept a take for each shot. Sequence plays accepted clips in order and exports a ZIP containing the clips, complete input snapshots, a manifest and shot list. Missing takes are marked as gaps.

Generate buttons save the current project before submitting. Batch generation captures the selected shots without rerunning already accepted shots outside that selection. A failed save does not queue a generation. Explicit new generation requests create new takes. Editing a project never automatically submits a provider request.

Review notes are human-authored. Director does not claim to have watched or heard returned clips. Use playback to check spoken words, voices and sound continuity.

## Verified integration surface

The user-supplied Runway 3.0.0 source supports `seedance2_5`, text-to-video or one first-frame image, 4–30 seconds, configurable ratios, and generated audio. The Studio protocol in 3.1.0 uses its existing payload, upload, download and Files API helpers. It fixes video output to 720p with audio enabled and offers 16:9, 9:16 and 1:1. It deliberately rejects last-frame and additional video reference inputs. Use character references to prepare the first frame in the image stage.

The pipe is called through the existing authenticated `/api/chat/completions` endpoint, with a JSON message containing a versioned `studio_director` command. It returns JSON content through the normal completion transport. Operations are `capabilities`, `submit` and `status`. This is not a newly invented HTTP endpoint or a parser for video-player HTML. Open WebUI enforces model access; the pipe verifies user identity and scopes job records by owner.

The pipe stores its job-ID/task-ID mapping in `DATA_DIR/studio-runway-jobs.sqlite3`, separate from Open WebUI's own database. Preserve this file alongside the Studio database when backing up or moving the deployment. It contains owner IDs, request hashes, task IDs, output file IDs and generation settings; no prompts or API keys. The deployed pipe must use a persistent writable DATA_DIR. The first release assumes one Open WebUI host for this integration.

Studio's existing raw text-model adapter is reused with explicit, versioned production instruction packs. Workspace model presets and arbitrary tool loops remain excluded. Astra/Opus must be selectable as accessible base models. This avoids changing the existing text Flow contract or silently enabling unrelated functions.

## Recovery and limits

- Known submitted video jobs resume status checks after a Studio restart. Status/download failures retain the same task; they do not generate another clip. Pipe output import is serialised with a lease. A crash between saving a file and recording its ID may leave an extra owned file, but does not cause another paid generation.
- Pipe 3.1.1 records a bounded failure code and returns the actual Runway task ID. Takes shows a friendly failure explanation and a Provider details disclosure. Raw upstream messages and URLs are not retained. Completed failures are not retried; failure codes lost by the older pipe cannot be reconstructed from Studio records. The pipe's additive database update preserves existing mappings. Studio needs no new database migration for these optional encrypted job fields.
- Submissions with an unknown outcome are never replayed automatically. For video, **Resume status checks** queries the pipe's saved submission ID. If the pipe also lost the provider task ID, check the Runway task manually before creating another generation.
- Expired credentials pause jobs. Signing in again and resuming reattaches user-scoped credentials. Queued image/text work that was never submitted can resume; ambiguous image/text submissions require manual review.
- Cancellation currently applies to queued jobs. Submitted tasks continue at the provider; the UI does not imply otherwise.
- Generation history displays the latest 300 jobs. Accepted take lookup and export must remain available independently of this display limit.
- Frames use the existing Open WebUI image sizes (landscape, portrait or square). Runway may crop to the selected video ratio. Last-frame images can be prepared and reviewed, but cannot be submitted to this first-frame-only integration.
- The first release has one ordered sequence per project. Series/season organisation, collaborative editing, rough-cut MP4 rendering, frame-accurate timing and automated audiovisual review remain deferred.
- Export streams an uncompressed ZIP, capped at 512 MB. Preview and export revalidate file ownership. An unavailable clip or interrupted connection fails the download; retrying an export does not generate media.

## Verification

`npm run test:integration`, `npm run check`, `npm run test:e2e:director`, and `npm run test:e2e:images` cover the application. Director browser tests run against a local mock provider and isolated database. They perform no paid model calls.

Run `python -m unittest discover -s tests -p test_director_protocol.py` from the adjacent `functions_tools` checkout to verify pipe opt-in, consent, owner isolation, duplicate submission handling, ambiguous responses and import recovery without Runway access.

Live deployment compatibility and generated speech/sound still require a deliberately requested live smoke test. Source tests cannot prove output quality or the exact behaviour of an installed function that has not been updated.
