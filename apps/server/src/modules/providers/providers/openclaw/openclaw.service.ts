import type { OpenClawSyncContext } from "./openclaw.sync.js";
import { runOpenClawSync } from "./openclaw.sync.js";

/**
 * Thin façade for dependency injection / future multi-provider orchestration.
 */
export class OpenClawService {
  constructor(private readonly ctx: OpenClawSyncContext) {}

  runSync(): ReturnType<typeof runOpenClawSync> {
    return runOpenClawSync(this.ctx);
  }
}
