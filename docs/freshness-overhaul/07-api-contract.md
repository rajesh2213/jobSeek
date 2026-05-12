# Phase 7 — API contract

## The new `freshness` payload

Every job in every public API response now carries:

```ts
freshness: {
  source: "POSTED" | "DISCOVERED",
  label: "Posted" | "Added",
  timestamp: string,   // ISO 8601
  relative: string     // "Posted 3 hours ago", server-rendered for SSR / email
}
```

Owned by the backend mapper (`apps/server/src/modules/job/job.mapper.ts` →
`buildFreshness`), which delegates to the single source of truth at
`apps/server/src/utils/freshness.ts`.

## Audit — every API that returns jobs

| Endpoint | Handler | Mapper | Emits `freshness` |
|---|---|---|---|
| `GET /jobs` | `job.controller.ts:217` | `toJobListJson` | ✅ |
| `GET /jobs/:id` (auth, normal) | `job.controller.ts:282, 341` | `toJobDetailJson` | ✅ |
| `GET /jobs/:id` (over daily cap) | `job.controller.ts:302` | `toJobPublicJsonOverDailyCap` | ✅ (inherits via spread) |
| `GET /companies/:slug/jobs` | `company.routes.ts:354` | `toJobListJson` | ✅ |
| Internal shadow hydration | `jobListShadow.run.ts` | `toJobListJson` | ✅ |

No public endpoint serializes Job rows by spreading the Prisma model directly,
so the mapper is the only emission site.

## Backwards compatibility

The existing fields are **preserved** and marked `@deprecated`:

- `postedAt` — kept
- `effectivePostedAt` — kept
- `createdAt` — kept

A v1 client that doesn't know about `freshness` continues to see exactly the
fields it sees today. A v2 client (post-rollout web app, extension) consumes
`freshness` and ignores the deprecated ones. Phase 8 removes their use from
the web app's render path.

## Payload size analysis

| Field | Typical size (bytes) |
|---|---|
| `source` | 19 bytes incl. quotes & key |
| `label` | 18 |
| `timestamp` | 38 |
| `relative` | ~30–40 (varies) |
| Total per job | ~110–130 |

For a 50-item `/jobs` listing payload (~250 KB gzipped today), the freshness
object adds ~6–7 KB raw, ~1–2 KB after gzip — < 1% of payload.

## Type exports

```ts
// apps/client/lib/api.ts
export type FreshnessSource = "POSTED" | "DISCOVERED";
export interface JobFreshness { source; label; timestamp; relative; }
export interface JobItem {
  // ...
  /** @deprecated */ postedAt: string | null;
  /** @deprecated */ effectivePostedAt?: string | null;
  /** @deprecated */ createdAt?: string;
  freshness?: JobFreshness;
}
```

`freshness` is intentionally optional in TypeScript so:

- in-flight cached payloads from before cutover parse cleanly,
- staged rollouts (canary subset) don't break the unmodified clients,
- tests that build partial JobItems don't have to fabricate freshness data.

After the rollout is stable (Phase 11 sign-off), `freshness` can be promoted
to required and the deprecated fields removed in a follow-up.

## Email / extension / SDK consumers

- **Growth email** (`apps/server/src/modules/growthEmail/`) currently renders
  freshness inline. Phase 8 routes it through `job.freshness.relative` (server-
  rendered so email clients don't need a date library).
- **Extension** (`apps/extension/`) shouldn't be affected — it doesn't render
  posted-at. If it ever does, it consumes the same JobItem type and gets the
  field for free.

## What's NOT in this phase

- Frontend component refactor — Phase 8.
- Canonical aggregation validation — Phase 9.
- Historical row cleansing — Phase 10.
