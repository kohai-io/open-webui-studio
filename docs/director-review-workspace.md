# Director take review workspace

This update gives Takes a large media viewer, a horizontal result strip and a collapsible notes panel. It also adds direct links from Storyboard to the shot's latest result and accepted video. The image has been built, published and deployed by the user to stage; the live checks below passed.

## Reviewing results

- Select a thumbnail to review its image or video at full workspace width. Previous result and Next result follow the filtered list. Selecting a different result keeps each take's unsaved review notes separate.
- Open **Notes & details** for review notes, provider diagnostics and the exact submitted prompt. Save review confirms the note was stored. Unsaved notes trigger the existing leave-page warning.
- **Accept take** selects the video used in Sequence. **Use this frame** assigns the exact image output being viewed. Current selections have a prominent badge and cannot be accepted again accidentally. Changing acceptance keeps all previous results.
- Filter by shot, result type or status, including failed attempts and jobs needing attention. Empty views offer a clear way to reset filters. References are reviewed across the production. Accepting a result preserves the all-shots view and selected result; returning to Storyboard selects a shot if needed.
- Add two results to comparison for adjacent players. Each player has its own playback controls. Clear comparison returns to one result; selecting a third result also leaves the two-result view.
- The selected result, shot and filters survive reload in the same browser session. Status polling updates the job without replacing its existing media element, preserving playback position.

## Names and durations

Video attempts are labelled Take 1, Take 2 and so on, separately for each shot. First frames, last frames and references each have their own sequence. Failed and cancelled attempts retain their place. Multiple image outputs use suffixes such as Frame 2.1 and Frame 2.2.

The server calculates numbers from the complete, append-only job history in insertion order, before the recent-history limit or UI filters. A bounded, owner/project-scoped memory index reads new job inputs incrementally and rebuilds after restart. Numbers remain consistent for older accepted takes outside the 300-job recent window. No database migration is required.

Videos display their actual **Clip duration** when the browser reads metadata. Generation state and elapsed time are shown separately. The requested duration remains available in submitted settings.

## Shot workflow

Storyboard offers **Review new take**, **Review latest result** and, when different, **Review accepted take**. Each opens the specific job and resets review filters so it is visible. The generation-complete notice also links to the new result. **Back to shot** returns from the notes panel to the appropriate shot.

## Validation and deployment

The original Director browser workflows remain covered alongside a new review scenario: numbering across failures, filters, keyboard selection, comparison, acceptance, notes isolation and persistence, playback retention during refresh, multiple image outputs, empty views and mobile overflow.

Browser tests use mock providers and a checked-in, synthetic one-second MP4. No live or paid generation is required. The existing crop and duplicate-submission controls remain in place.

Validated on 26 September 2026: 202 integration tests passed, along with the five existing Director browser regressions and the new review scenario. The focused review scenario passed again after the pre-build fix for accepting references and another shot's take from the all-shots view. It verifies the saved selections, reference visibility after reload and return to a populated Storyboard. Type checking reported zero errors and warnings; changed files passed ESLint, Prettier and whitespace checks. Desktop, comparison and 390-pixel mobile layouts were visually inspected. Local screenshots are saved in ignored `data/director-review-workspace.png`, `data/director-review-comparison.png` and `data/director-review-mobile.png`.

Deployment requires a replacement Studio image. No new environment settings or Runway pipe changes are needed. This update does not include synchronized comparison playback, draggable crop handles, shot-form restructuring or the deferred OWUI audit integration.

## Published image and stage verification

Built and published on 26 September 2026 from clean source revision `fba8cebe2c73dce9880d18418fe84541fe14f19b`. This release record was completed after the build. The image includes both the generation controls and this review workspace.

- Tag: `git.theoldschool.house/robert/open-webui-studio:director-review-20260926-222107`.
- Registry-verified image index digest: `sha256:7c97b2a7ab4cbf238ae3793001ca762ef865780d57f4cb11881e4d903741ec9b`.
- Platform: `linux/amd64`; runtime user: `studio`.
- Source manifest SHA-256: `9c3a6cfb7b32eed9e394fd251cb15833658914d8f93ff102684f90faa4f0ae49`.
- Previous stage image retained for rollback: `sha256:80fd6a1dd88c16b632205729d3424d63a956abbbced5afa365717d8a3565aead`.
- Local build, registry and smoke-test records are stored in ignored `data/director-review-image-*` files.

An isolated container became healthy, served health and Director with HTTP 200, rejected an invalid-session API request with HTTP 401, initialized all three Director tables and contained the new review UI. Networking and generation workers were disabled during this check.

After the user confirmed deployment to pve2 container 107, the existing kettle project was checked through the stage browser. The frame filter and selection survived reload; comparison, clearing comparison, existing notes, Back to shot and Review latest result worked. The original frame loaded at 1672 × 941 and the accepted video at 1280 × 720 with a duration of 5.056 seconds and no media error. No browser console errors were observed. The project remained at revision 4 with two generation records and zero active jobs; no project changes or new generations were submitted. The running container digest was not independently inspected.
