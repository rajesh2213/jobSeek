/**
 * Barrel exports for job discovery + detail parity helpers (SSR unified layer).
 */
export { getSharedJobService } from "./serverServices.shared.js";
export {
  executeMeteredJobsListHttpParity,
  type MeteredJobsListHttpParityResult,
  type MeteredJobsListReplyHints,
} from "./jobsList.shared.js";
export {
  executeJobDetailHttpParity,
  type JobDetailHttpParityResult,
} from "./jobDetail.shared.js";
