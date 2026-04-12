/** Dispatched when the header workflow path reaches the CTA endpoint; `detail.ms` is glow duration. */
export const GET_PRO_GLOW_EVENT = "jobseek:getProGlow";

/** Fixed «Get Pro» control — squiggle ends here for non‑Pro users (and while plan is still loading). */
export const GET_PRO_BUTTON_ID = "get-pro-button";

/** Account avatar — squiggle ends here when the user is Pro (`FixedGetProButton` is not mounted). */
export const WORKFLOW_ACCOUNT_ENDPOINT_ID = "workflow-account-endpoint";

/**
 * How long the path stays complete and the Get Pro CTA stays in its highlight state
 * before the workflow resets (ms). Kept in sync with the button listener timeout.
 */
export const GET_PRO_GLOW_MS = 1700;
