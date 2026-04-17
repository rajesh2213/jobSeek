# Smart Apply Extension QA Checklist

## ATS Matrix
- Greenhouse (including employer pages with `gh_jid` / iframe embed — scan should list embedded form fields)
- Lever
- Workday
- Ashby

## Core Flow
1. Open ATS page and confirm popup shows ATS detected.
2. Confirm field detection count is non-zero.
3. Click `Fill application`.
4. Verify standard profile fields are filled.
5. Verify resume upload behavior:
   - If supported: file input is auto-attached.
   - If blocked: popup shows manual upload guidance.
6. Verify long-answer questions generate drafts.
7. Edit one generated answer and apply answers.
8. Confirm undo restores previously filled values.
9. Retry any failed fields from popup and confirm status updates.

## Reliability Checks
- Run same scenario twice on same ATS page to ensure idempotent behavior.
- Refresh page, reopen popup, and verify no stale errors persist.
- Confirm profile incomplete and quota reached states still block fill with clear messaging.

## Telemetry Sanity
- Confirm these events appear in server logs:
  - `ats_page_detected`
  - `fields_detected_count`
  - `fill_started`
  - `fill_completed`
  - `answer_edited_before_apply` (when edited)
  - `session_to_first_success_time`

## Rollout
- Keep premium UX behind `NEXT_PUBLIC_SMART_APPLY_PREMIUM_V1`.
- Validate ATS matrix in staging before broad rollout.
