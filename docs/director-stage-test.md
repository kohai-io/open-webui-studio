# Test Director on stage

Status, 26 September 2026: deployed to Proxmox host **pve2 (`10.100.1.16`), container 107**. Director loads and live planning/image generation passed. Runway v3.1.0 is installed and its Studio API valve was enabled with user approval. One video task was submitted and survived reload, then was blocked by provider input moderation (`INPUT_PREPROCESSING.SAFETY.THIRD_PARTY`). The user supplied the failure details from Runway because the current pipe does not expose them. No retry was submitted. See [live stage results](director-stage-results-20260926.md).

The future audit changes are [planned separately](director-audit-plan.md). This test exercises the current release. Its complete interaction history is not yet mirrored into OWUI chats.

The [published stage image and installation command](director-stage-release.md) document the running release. The saved test project retains its accepted first frame and blocked video take. Preserve it for diagnosis. Use a separate benign scene for the next delivery/audio/export test rather than resubmitting the blocked generation; the precise moderation trigger remains unknown.

## Deployment readiness

Use the existing Studio deployment and OIDC configuration. Its `/etc/open-webui-studio/compose.yaml` loads `./runtime.env`; set these values in **`/etc/open-webui-studio/runtime.env` inside LXC 107**. See [setup](director-setup.md) for the full instructions. The new settings are:

```dotenv
DIRECTOR_ENABLED=true
DIRECTOR_WORKER_ENABLED=true
DIRECTOR_VIDEO_MODEL_ID=runway_video_generation
```

Run the Director worker on one Studio process. Preserve Studio's persistent database and encryption key, and take a consistent backup before applying migrations. Route `/studio` and its subpaths to the Studio service while preserving the base path. Confirm `/studio/health`, the Director library and sign-in on the actual deployment URL.

Update the existing OWUI Runway function from `functions_tools/functions/runway_inline.py` (version 3.1.0), preserving its installed identity, credentials and valves. The user-facing model ID is `runway_video_generation`; verify which installed function backs it before updating. Enable `ENABLE_STUDIO_API` and retain the ordinary chat-confirmation setting. Preserve the pipe's persistent DATA_DIR.

Confirm that the test user can access a planning base model and the Runway pipe. Image generation/editing uses OWUI's configured image backend, which must be enabled for that user. Do not change a shared image provider merely to satisfy a display name; inspect the existing configuration first.

## First test: one five-second shot

1. Open Director and create **Director stage test — The last train**.
2. In **Brief**, select the available Astra/Opus planning model, confirm the video pipe, choose 16:9 and enter the brief below. Choose **Save project**, then **Check video connection**. The check should confirm that the Seedance integration is enabled and does not generate media.
3. In **Assistant**, choose **Draft storyboard**. Inspect the proposal, then **Apply proposal**. Keep one shot for the first test and set its duration to five seconds.
4. In **Storyboard**, choose **Generate first frame**. In **Takes**, inspect the image and choose **Use this result**. Leave the last-frame field empty: the current video integration accepts one first frame.
5. Choose **Generate video + audio** once. Reload while the job is running. It should remain the same job and complete without another submission. If it reports an unknown outcome, use status recovery rather than immediately generating again.
6. In **Takes**, play the actual clip with audio. Check the framing, requested action, spoken line, ambience and approximately five-second duration. Accept it with **Use this result**.
7. Open **Sequence**. Verify one accepted shot, play it and download **Export production bundle**. Open the ZIP and check that its video plays and its manifest/shot list refer to the accepted take.
8. Return to the project library and reopen the project. Confirm the brief, shot, first frame and accepted take persist. Confirm the generated files appear in OWUI Media under the test user.

Suggested brief:

> A single five-second TV drama shot at a quiet railway platform at dusk. Maya, an adult with short dark hair and a navy coat, looks towards the approaching train lights, smiles and says, "We made it." A gentle camera push in. Soft station ambience and an approaching train; no music. Naturalistic cinematography, consistent appearance, 16:9. Return one shot.

This workflow normally makes one planning request, one image request and one five-second video request. Each Generate action uses the configured provider and may incur its normal charges. Extra attempts are separate generations. Check actual output quality by playback; a successful job does not prove dialogue accuracy or continuity.

## Then test a three-shot sequence

Add a character reference in **References**, generate or upload an image, and accept it in **Takes**. Expand the storyboard to three shots and assign the reference to each. Generate and accept first frames, then generate and accept each video. Revise only shot 2 and create a new take. Shots 1 and 3 should retain their accepted takes. Preview/export the sequence and confirm the ZIP contains the chosen version of each clip.

The export is an ordered clip bundle, not an assembled MP4. Review notes are human-authored. Keep the proposed audit implementation out of this test scope.

## Record findings

For any issue, note the project/shot/job ID, operation, displayed state or error, time, selected model and whether a provider task is known to exist. Retain the existing job for diagnosis. Avoid posting credentials or private prompt content in logs. Separate UI/persistence failures from model-output quality findings.

Previously completed local verification: 180 integration tests, 2 Director browser tests, 8 image-flow browser tests and 7 Runway protocol tests. Those tests used mocks and do not establish live stage compatibility. After the default video-model update, the 14 Director unit tests, Svelte/TypeScript checks and changed-file lint also passed.
