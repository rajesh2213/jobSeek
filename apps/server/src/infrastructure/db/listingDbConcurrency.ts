/**
 * Caps concurrent listing DB work inside the API process so slow /jobs queries
 * cannot occupy every Prisma pool slot (P2024 under worker + SSR load).
 */
const maxConcurrent = Math.max(
  1,
  Math.min(4, Number.parseInt(process.env.JOB_LIST_DB_CONCURRENCY ?? "2", 10) || 2),
);

let inFlight = 0;
const waiters: Array<() => void> = [];

function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

export async function withListingDbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= maxConcurrent) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    release();
  }
}
