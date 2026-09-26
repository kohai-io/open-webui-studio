# Director stage test results — 26 September 2026

Result: the core live workflow has now passed across two tests: planning, first-frame generation, video delivery to OWUI, playback, acceptance, reload persistence and export. The initial railway scene was blocked by provider moderation and remains preserved without retry. After the replacement Studio image and Runway v3.1.1 update, a separate five-second kettle video succeeded with non-silent stereo audio. Subjective sound quality, dialogue, lip-sync and multi-shot continuity remain unverified. See the post-deployment section below for the successful test.

## Initial deployment and test record

- Target: `https://owui-stage.theoldschool.house/studio/director`, pve2 (`10.100.1.16`), LXC 107.
- Installed image, confirmed by the user's Docker inspection: `git.theoldschool.house/robert/open-webui-studio@sha256:87b682a3f3a4ace095184c3217d22747e35f496a61fc56facccdba7880515de0`.
- Compose file: `/etc/open-webui-studio/compose.yaml`; it loads `./runtime.env`. Director settings belong in `/etc/open-webui-studio/runtime.env` inside LXC 107.
- User completed normal Homelab sign-in in the test browser. No credentials were copied into test files or commands.
- Created [Director stage smoke test — 26 Sep 2026](https://owui-stage.theoldschool.house/studio/director/411f6232-dc60-4d58-9f1c-e08b4b5aba92). Existing projects were not edited.
- Project ID: `411f6232-dc60-4d58-9f1c-e08b4b5aba92`; final saved revision: 4.
- Shot: **We Made It**, five seconds; ID `d359374c-5db9-4272-83cd-80ad7fc9fcdd`.
- Selected planning model: `chatgpt/gpt-5.6-sol`. Astra and Opus were not present in the accessible catalogue.
- One planning generation, one image generation and one five-second video generation were requested. The video was submitted at approximately 12:36 BST. No video retry was requested. Actual provider cost was not available in Director.

## Passed

| Check                        | Evidence                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public route and health      | `/studio/health` and `/studio/director` returned HTTP 200                                                                                                         |
| Anonymous API protection     | Unauthenticated GET `/studio/api/director` returned HTTP 401                                                                                                      |
| Sign-in                      | Homelab OIDC returned to authenticated Studio                                                                                                                     |
| Model discovery              | User-visible planning catalogue and Runway pipe loaded; `runway_video_generation` was preselected for the new project                                             |
| Image readiness              | Generation and editing flags both reported enabled; only generation was exercised                                                                                 |
| Project persistence          | Brief, production format and model selection saved at revision 2 and survived reload                                                                              |
| Live planning                | GPT-5.6 Sol returned one valid five-second shot; proposal was applied at revision 3                                                                               |
| Live first-frame generation  | Generated first-frame file `f0bfb777-1673-4665-9968-4888e8332f13`; result rendered in Takes                                                                       |
| Reload during image workflow | The single image job remained available after reload and completed; no second request was submitted                                                               |
| Frame acceptance             | The image was assigned to the shot, marked Frame ready and retained at revision 4 after reload                                                                    |
| Review note persistence      | Saved review note was present after reload                                                                                                                        |
| Sequence gaps                | Sequence reported 0/1 accepted video shots and disabled playback                                                                                                  |
| Export with missing video    | Downloaded ZIP passed integrity checks, contained `manifest.json` and `shot-list.txt`, and recorded the shot with `missing: true`, `filename: null`               |
| Updated video capabilities   | Runway v3.1.0 was visible in OWUI Functions; after the authorized valve change, Director reported “Seedance ready · first frame · 4–30 seconds · generated audio” |
| Video submission and reload  | One video job changed to running and remained the only active job after reload; it subsequently returned failed with no output file                               |
| Failed take preservation     | Failed video remains in Takes with its submitted prompt/settings and a saved diagnostic review note; zero active jobs                                             |

## Video integration readiness

**Check video connection** returned `invalid response`. The authenticated Open WebUI Functions page visibly identified **Runway Video Generation v3.0.0**. Director requires the structured protocol introduced in the local v3.1.0 source. The installed version therefore does not meet the integration prerequisite; further transport compatibility remains to be tested after updating it.

The user then updated the pipe to v3.1.0, verified on the Functions page. Repeating **Check video connection** returned the structured disabled response. The user explicitly authorized enabling `ENABLE_STUDIO_API`; the valve was saved through OWUI and Director then reported Seedance ready. Other valve values were preserved.

**Generate video + audio** was activated once for the existing five-second shot and accepted first frame. The job entered running at approximately 12:36 BST and survived a page reload. It subsequently returned failed. No output file or accepted video exists, and no retry was submitted.

The v3.1.0 pipe used for this first test returned only state/job ID for provider `FAILED` responses, discarding the upstream failure reason. That worker cleared `job.error` for these responses, so Takes displayed only failed. An exception during status polling would instead retain running with `status_unavailable`.

The user supplied Runway request-history evidence showing HTTP 200 for submission and status requests, followed by these task-result fields:

- Provider task ID: `634be0e3-9b80-42da-b4e3-e26de72e24c5`.
- Created: 26 September 2026, 12:36 PM.
- Status: `Failed`.
- Failure: “Your request was blocked by this model provider's content moderation system.”
- Failure code: `INPUT_PREPROCESSING.SAFETY.THIRD_PARTY`.

This confirms a provider moderation rejection, while the HTTP requests succeeded. The response does not identify the triggering input or rule, so no attribution to the face, railway setting, dialogue, copyright or a particular word is established. Runway documents that moderated tasks return `FAILED` with `failure` and `failureCode` in the response body: [content moderation](https://docs.dev.runwayml.com/api-details/moderation/). Its [task failure guidance](https://docs.dev.runwayml.com/errors/task-failures/) advises against retrying input-safety failures; that page does not document this exact `THIRD_PARTY` code separately.

No retry was submitted. Next priorities are to expose useful failure diagnostics in Director and use a separate, simple benign scene to validate successful video delivery, audio playback and export. Keep the blocked task for diagnosis; a successful unrelated test would not establish why this scene was blocked.

## Other findings

The false stale warning and missing failure diagnostics have now been fixed in source and tested locally; see the [follow-up release](director-stage-fixes-20260926.md). The findings below describe the deployed image used for this live test.

1. **Incorrect stale warning after accepting a frame.** Takes shows “Shot direction has changed since this take” immediately after accepting the first-frame result, without a creative-direction edit. `stale()` in `src/routes/director/[id]/+page.svelte` compares `old.firstFrame` with `current.firstFrame` for image jobs too. Follow-up: make staleness checks specific to the operation and distinguish accepting an output from changing its inputs.
2. **Planning selector includes image models.** Image entries such as `chatgpt/gpt-image-2` appear among planning choices. Follow-up: restrict planning choices using verified model capabilities when available; do not imply every catalogue entry supports text planning.
3. **Initial browser clicks were inconclusive.** Some automated mouse actions immediately after navigation did not transition the view. Keyboard activation worked and completed the workflow. A console error for client navigation to `/studio/auth/login` was also observed, although the normal full sign-in completed. These observations do not establish an application pointer-event defect; reproduce after hydration in a normal browser before changing code.
4. **Provider failure diagnostics are lost.** Preserve a sanitized failure code/reason and provider task reference in the pipe mapping and response, retain them in the Studio job and show a useful failure explanation in Takes. Do not expose credentials or signed media URLs, and do not automatically retry a paid generation. This prevented diagnosing the live video failure from Director.

## Evidence and limits

Local ignored artifacts:

- `data/director-stage-20260926.png`: accepted frame and storyboard.
- `data/director-stage-runway-version-20260926.png`: installed pipe version.
- `data/director-stage-pipe-readiness-20260926.png`: structured disabled response after updating to v3.1.0, before the authorized valve change.
- `data/director-stage-video-failure-20260926.png`: failed video take and saved diagnostic note.
- `data/director-stage-production-20260926.zip`: exported project with the missing-video gap.

The generated frame was visually inspected: a short-haired adult in a dark coat at a railway platform at dusk, with approaching train lights. Video generation was exercised but failed before a file was returned. Actual video quality, dialogue, audio continuity, image editing, multi-shot retakes, cross-user isolation, provider failure recovery and export of actual video clips remain unverified. Prior mock tests cover several of these paths but do not substitute for live validation.

The test project and accepted frame remain in the user's account for continuation. There were no active generation jobs at the end. The [audit plan](director-audit-plan.md) remains future work.

## Post-deployment verification and kettle test

The user confirmed installing the [replacement Studio image](director-stage-fixes-20260926.md). Its UI changes were verified against the original project: the failed video now has a generic provider-failure explanation and the accepted frame has no false stale warning. Revision 4 and the original generation records were preserved. The old discarded failure code was not backfilled. The running Docker digest was not independently inspected.

The existing `runway_video_generation` function was updated through OWUI to v3.1.1, with its identity and valves preserved. The prior source was backed up in `data/runway-stage-before-3.1.1.py`; AST comparison confirmed no unrelated implementation differences from the tested local source. The Functions page visibly reports v3.1.1, and the Director connection check still reports Seedance ready.

A separate [Director stage test — Kettle — 26 Sep 2026](https://owui-stage.theoldschool.house/studio/director/1097c893-5e1f-44ad-8583-54871a7562ca) contains one manually entered five-second shot, **Morning steam**: a stationary steel kettle steaming on a kitchen stovetop, locked camera, natural morning light, bubbling water and steam hiss, with no dialogue or music. No planning call was needed for this smoke test.

- Project ID: `1097c893-5e1f-44ad-8583-54871a7562ca`.
- One first-frame generation submitted at 17:48 BST and succeeded. OWUI file ID: `005170f9-a393-45a6-a145-993ca7410341`. The frame was visually reviewed and accepted at revision 3 without a stale warning.
- One video/audio generation submitted at 17:49 BST. Director displayed the real Runway task ID `bc215f13-10eb-4144-88e9-8e82c0da8099` under Provider details. The running job and two total generation records survived a page reload.
- Video succeeded at 17:54:02 BST, approximately 4 minutes 34 seconds after submission. OWUI video file ID: `5dbf9d70-8826-443b-a878-801708ca7ed2`; accepted take ID: `c29bed78-73c7-486e-8cc2-380a2e9192f0`; shot ID: `d7bed7ac-01e0-4a65-9774-4e5b415d922b`.
- The video rendered in Takes and its player reached 0:05 / 0:05. Acceptance saved revision 4, which survived reload with **Take accepted**. Sequence reported **1/1 shots accepted**, played the clip and returned to its idle state at the end.
- The exported ZIP passed integrity validation and contained `manifest.json`, `shot-list.txt` and `shots/001.mp4`. The manifest records `missing: false`, the accepted take, submitted settings, actual Runway task UUID and owned OWUI file ID.
- Exported media: H.264, 1280×720, 24 fps; video duration 5.041667 seconds; stereo AAC at 32 kHz, audio/container duration 5.056 seconds; 2,498,793 bytes. Complete video/audio decode passed with no errors. Audio is non-silent (mean −39.5 dB, peak −19.3 dB); this does not establish that the generated sound matches the requested kettle hiss.
- A technical review note was saved on the accepted take. Exactly one image and one video were submitted for this project, with no repeat requests and zero active jobs at completion. The original moderated project was not resubmitted.

Evidence saved locally (ignored artifacts):

- `data/director-stage-runway-3.1.1-20260926.png`: installed pipe version.
- `data/director-stage-kettle-success-20260926.png`: live successful image/video takes, accepted video and provider ID.
- `data/director-stage-kettle-20260926.zip`: production export.
- `data/director-stage-kettle-20260926.mp4`: clip extracted from that export for validation.
- `data/director-stage-kettle-manifest-20260926.json` and `data/director-stage-kettle-validation-20260926.json`: exported metadata and measured results.

This completes the core single-shot integration smoke test. It does not validate dialogue or lip-sync, subjective sound quality, live multi-shot continuity/retakes, image editing, cross-user isolation, or fresh provider-failure-code propagation. Failure-code handling has automated regression coverage; the successful live task verifies propagation of its real provider task ID. The full per-user OWUI audit integration remains deferred in the [audit plan](director-audit-plan.md).
