# Director generation controls and frame preparation

This release improves the existing Director workflow without changing the Runway pipe protocol or enabling the deferred audit integration.

## Generation controls

- A shot cannot submit the same operation again while its existing job is queued, submitting, running, waiting for authentication or awaiting submission reconciliation. This guard is enforced in a database write transaction, including requests from different tabs and requests with different idempotency keys. Changing the shot or project revision does not bypass it.
- Other shots and different operations can run independently. Once a video job succeeds, fails or is cancelled, the next action is labelled **Generate another take + audio**. Previously accepted takes are preserved.
- Repeating the original idempotency key still returns that original job. Jobs with uncertain outcomes remain available in history and are never automatically resubmitted.
- Unresolved older jobs remain visible even when they fall outside the recent-history window.

## Progress and reconnection

The storyboard and Takes show the generation state and elapsed time. Video jobs record their last successful provider response separately from polling failures. The workspace shows the last successful refresh and a visible connection warning when polling fails; generation controls pause until the connection recovers. Refresh requests have a ten-second timeout.

Returning to the tab triggers an immediate refresh. The selected shot and workspace tab survive a reload in the same browser session. The queued notice changes when the generation completes or needs attention. No percentage or completion estimate is invented.

## Video crop

After assigning a first frame, open **Prepare video crop**. Compare the original with the crop preview, adjust horizontal/vertical position and zoom, then select **Use this crop**. This saves the preview as a separate PNG in the current user's OWUI files and assigns that file as the video first frame. Cropping does not call a generation model or spend generation credits.

The original file and framing controls are retained in optional shot metadata. Reopen the crop tool to readjust from the original, or choose **Use original frame**. Accepting or assigning a different first frame clears obsolete crop metadata. A change to the production aspect ratio requires preparing a new crop before submitting a previously cropped shot.

Preview and upload use the same canvas pixels, with an exact 16:9, 9:16 or 1:1 output ratio. Output is bounded to 1600 pixels on the longest edge and the existing 10 MB image-upload limit. Both the crop and its original reference are checked against the current user's OWUI file access on save. Existing projects without crop metadata remain supported.

## Deployment and validation

Only a replacement Studio image is required. No environment-variable change, SQL migration or Runway pipe update is needed; the existing v3.1.1 integration remains compatible. The user has deployed this image on stage; the live checks below passed.

Validation commands:

```sh
npm run check
npm run test:integration
npm run test:e2e:director
```

The browser suite uses local mock services. It checks active-job rejection, view restoration, connection recovery, exact preview/upload equivalence, original-file preservation, cross-owner rejection, delivery of the cropped file to the video pipe, and the existing three-shot workflow. It does not perform paid generations.

Validated on 26 September 2026: all 198 integration tests and all five Director browser tests passed. Focused generation-control, crop and staleness checks passed after final refinements. Type checking reported no errors or warnings, and changed source files passed lint. Desktop and 390-pixel mobile crop previews were visually checked.

## Container build

Built, smoke-tested locally and published on 26 September 2026. Registry inspection confirmed the digest and `linux/amd64` platform. The user subsequently confirmed deployment to stage. Live UI behavior was verified; the running Docker digest was not independently inspected.

- Tag: `git.theoldschool.house/robert/open-webui-studio:director-controls-20260926-192028`.
- Platform: `linux/amd64`; runtime user: `studio`.
- Published image index digest: `sha256:80fd6a1dd88c16b632205729d3424d63a956abbbced5afa365717d8a3565aead`.
- Base revision: `0bebb648bce13f3265d2fe4561f14133a39d2bb5`, plus the uncommitted generation-control and crop changes. The base revision alone does not identify the complete source.
- Build-time source manifest SHA-256: `71504ace8d75f868a3f7399d3419242cbfcceef9eef7fc3213130dd1db392a0b`. This release record was completed after building.
- Build records: ignored `data/director-controls-image-build.json`, `data/director-controls-image-source-manifest.txt`, `data/director-controls-image-metadata.json` and `data/director-controls-image-build.log`.

An isolated container with networking and generation workers disabled became healthy, served health and Director with HTTP 200, rejected an invalid-session API request with HTTP 401, and initialized all three Director tables. The compiled application contains the crop, duplicate-generation guard and progress controls. The smoke container was removed after validation.

Run on pve2 once Studio is idle, using the existing deployment procedure and preserving `runtime.env`, persistent data and encryption keys:

```sh
pct exec 107 -- /usr/local/lib/owui-deploy/install-or-update.sh studio \
  git.theoldschool.house/robert/open-webui-studio@sha256:80fd6a1dd88c16b632205729d3424d63a956abbbced5afa365717d8a3565aead \
  --confirm-studio-idle
```

No pipe update or environment-variable change is required for this release. The previous stage image remains available at `git.theoldschool.house/robert/open-webui-studio@sha256:3cc0f36e7deef411b40451900f25e2057e19ffc54c07014a268e856556bd9953`.

## Live stage verification

The existing [kettle project](https://owui-stage.theoldschool.house/studio/director/1097c893-5e1f-44ad-8583-54871a7562ca) was checked after the user's deployment confirmation on 26 September 2026:

- Saved revision 4 and the accepted take remain intact, with two generation records and zero active jobs.
- **Prepare video crop** loads the original 1672 × 941 frame and renders a 1600 × 900 preview. The **Generate another take + audio** action is present.
- Generation history displays completion and elapsed-time labels. The selected Takes tab and Morning steam shot filter survive reload.
- The accepted video loads with no media error: 1280 × 720, 5.056 seconds. No browser console errors were captured during these checks.
- Status refresh remains active without a connection warning.

These were read-only live checks. No crop was saved, project revision changed or new generation submitted. Live crop upload, duplicate-submission rejection and connection-loss recovery were not exercised again on stage; their automated coverage is recorded above.
