"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  fetchCitySuggestions,
  fetchJobSkills,
  fetchLocationsCatalog,
  fetchRoles,
  type CitySuggestion,
  type JobRoleSuggestion,
  type JobSkillAggregate,
  type LocationsCatalogResponse,
} from "../../lib/api";
import { KNOWN_SKILL_SLUGS } from "../../lib/taxonomy";
import { mergeRoleSuggestionsByDisplay } from "../../lib/roleDisplay";
import type { JobFilters } from "../../lib/slug-parser";
import { cn } from "../../lib/cn";
import { FilterChips } from "../filters/FilterChips";
import { Button } from "../ui/Button";
import { SortSegmented } from "../ui/SortSegmented";

function CitySuggestionShimmerRow() {
  return (
    <li className="px-3 py-2.5" aria-hidden>
      <div className="h-3.5 w-[55%] max-w-[220px] rounded-md bg-gradient-to-r from-ink/10 via-ink/[0.06] to-ink/10 bg-[length:200%_100%] animate-shimmer" />
      <div className="mt-2 h-3 w-[40%] max-w-[140px] rounded-md bg-gradient-to-r from-ink/[0.08] via-ink/[0.04] to-ink/[0.08] bg-[length:200%_100%] animate-shimmer" />
    </li>
  );
}

function RolePresetShimmerRow() {
  return (
    <li className="px-3 py-2.5" aria-hidden>
      <div className="h-4 w-[72%] max-w-[200px] rounded-md bg-gradient-to-r from-ink/10 via-ink/[0.06] to-ink/10 bg-[length:200%_100%] animate-shimmer" />
    </li>
  );
}

function SkillPresetShimmerRow() {
  return (
    <li className="px-3 py-2.5" aria-hidden>
      <div className="h-4 w-[65%] max-w-[180px] rounded-md bg-gradient-to-r from-ink/10 via-ink/[0.06] to-ink/10 bg-[length:200%_100%] animate-shimmer" />
    </li>
  );
}

function regionFilterChipLabel(r: string): string {
  return r === "Global" ? "🌍 Global" : r;
}

/** Global sits next to All; remaining regions keep API order. */
function regionsOrderedForFilterChips(regions: string[]): string[] {
  const global = regions.filter((r) => r === "Global");
  const rest = regions.filter((r) => r !== "Global");
  return [...global, ...rest];
}

function locationFilterTriggerLabel(location: string): string {
  const t = location.trim();
  if (t === "Global" || t.toUpperCase() === "GLOBAL") return "🌍 Global";
  return t;
}

function locationsTriggerLabel(locs: string[]): string {
  if (locs.length === 0) return "Locations";
  if (locs.length === 1) return locationFilterTriggerLabel(locs[0]!);
  return `${locs.length} locations`;
}

/** Pinned category shortcuts inside the Role dropdown (?category=…). Order matches product spec. */
const BROWSE_BY_CATEGORY = [
  { slug: "engineering", label: "Engineering" },
  { slug: "product", label: "Product" },
  { slug: "data", label: "Data" },
  { slug: "design", label: "Design" },
  { slug: "sales", label: "Sales" },
  { slug: "marketing", label: "Marketing" },
  { slug: "operations", label: "Operations" },
  { slug: "finance", label: "Finance" },
  { slug: "hr", label: "HR" },
  { slug: "healthcare", label: "Healthcare" },
  { slug: "legal", label: "Legal" },
  { slug: "security", label: "Security" },
  { slug: "content", label: "Content" },
  { slug: "research", label: "Research" },
] as const;

interface UiFiltersState {
  roles: string[];
  types: Array<"remote" | "onsite" | "hybrid">;
  /** Region names, ISO codes, or city strings — sent as `?locations=`. */
  locations: string[];
  skills: string[];
}

interface Props {
  draft: JobFilters;
  appliedFilters: JobFilters;
  setDraft: Dispatch<SetStateAction<JobFilters>>;
  uiFilters: UiFiltersState;
  setUiFilters: Dispatch<SetStateAction<UiFiltersState>>;
  onApply: () => void;
  onRemoveChip: Parameters<typeof FilterChips>[0]["onRemoveChip"];
  onSortNavigate: (sort: JobFilters["sort"]) => void;
  showSort?: boolean;
  showChips?: boolean;
  totalRoles?: number;
  selectedCategory?: string;
  onCategoryNavigate: (category: string | undefined) => void;
  onClearFilters?: () => void;
  clearFiltersDisabled?: boolean;
}

export function JobsInlineFilters({
  draft,
  appliedFilters,
  setDraft,
  uiFilters,
  setUiFilters,
  onApply,
  onRemoveChip,
  onSortNavigate,
  showSort = true,
  showChips = true,
  totalRoles,
  selectedCategory,
  onCategoryNavigate,
  onClearFilters,
  clearFiltersDisabled = false,
}: Props) {
  const skillsPanelId = useId();
  const cityListId = useId();
  const [openMenu, setOpenMenu] = useState<null | "role" | "skills" | "experience" | "posted" | "locations">(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const cityTypeaheadRef = useRef<HTMLDivElement>(null);
  const [skillsQuery, setSkillsQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [roleRows, setRoleRows] = useState<JobRoleSuggestion[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [skillRows, setSkillRows] = useState<JobSkillAggregate[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [cityQuery, setCityQuery] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityNoResults, setCityNoResults] = useState(false);
  const [cityHighlightIndex, setCityHighlightIndex] = useState(-1);
  const [citySuggestDismissed, setCitySuggestDismissed] = useState(false);
  const [locCatalog, setLocCatalog] = useState<LocationsCatalogResponse | null>(null);
  const [locCatalogLoading, setLocCatalogLoading] = useState(false);
  const [locRegionTab, setLocRegionTab] = useState<string>("all");
  const selectedSkills = new Set(uiFilters.skills.map((s) => s.toLowerCase()));

  useEffect(() => {
    let cancelled = false;
    setRolesLoading(true);
    fetchRoles()
      .then((rows) => {
        if (!cancelled) setRoleRows(rows);
      })
      .catch(() => {
        if (!cancelled) setRoleRows([]);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    fetchJobSkills()
      .then((rows) => {
        if (!cancelled) setSkillRows(rows);
      })
      .catch(() => {
        if (!cancelled) setSkillRows([]);
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dedupedRoleRows = useMemo(
    () => mergeRoleSuggestionsByDisplay(roleRows),
    [roleRows],
  );

  const roleMeta = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of dedupedRoleRows) m.set(r.slug, r.label);
    for (const r of roleRows) {
      if (!m.has(r.slug)) m.set(r.slug, r.label);
    }
    return m;
  }, [dedupedRoleRows, roleRows]);

  const filteredRoleRows = useMemo(() => {
    const q = roleQuery.trim().toLowerCase();
    if (!q) return dedupedRoleRows;
    return dedupedRoleRows.filter(
      (r) => r.slug.includes(q) || r.label.toLowerCase().includes(q),
    );
  }, [dedupedRoleRows, roleQuery]);

  const rankedSkillRows = useMemo(() => {
    const q = skillsQuery.trim().toLowerCase();
    const countMap = new Map(skillRows.map((r) => [r.slug, r.count] as const));
    const skillLabel = (slug: string) => slug.replace(/-/g, " ");
    if (!q) {
      return skillRows.slice(0, 60).map((r) => ({ ...r }));
    }
    const slugSet = new Set<string>();
    for (const r of skillRows) slugSet.add(r.slug);
    for (const s of KNOWN_SKILL_SLUGS) slugSet.add(s);
    const out: JobSkillAggregate[] = [];
    for (const slug of slugSet) {
      if (!slug.includes(q) && !skillLabel(slug).includes(q)) continue;
      out.push({ slug, count: countMap.get(slug) ?? 0 });
    }
    out.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
    return out.slice(0, 80);
  }, [skillsQuery, skillRows]);

  const closeMenus = useCallback(() => setOpenMenu(null), []);

  useEffect(() => {
    if (openMenu !== "role") setRoleQuery("");
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`[data-dropdown-id="${openMenu}"]`)) return;
      setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu === "locations") {
      setCitySuggestDismissed(false);
    }
  }, [openMenu]);

  useEffect(() => {
    setCitySuggestDismissed(false);
  }, [cityQuery]);

  useEffect(() => {
    const q = cityQuery.trim();
    if (q.length < 2) {
      setCitySuggestions([]);
      setCityLoading(false);
      setCityNoResults(false);
      setCityHighlightIndex(-1);
      return;
    }
    setCityNoResults(false);
    const handle = window.setTimeout(() => {
      setCityLoading(true);
      setCitySuggestions([]);
      fetchCitySuggestions(q)
        .then((rows) => {
          setCitySuggestions(rows);
          setCityNoResults(rows.length === 0);
          setCityHighlightIndex(-1);
        })
        .catch(() => {
          setCitySuggestions([]);
          setCityNoResults(true);
          setCityHighlightIndex(-1);
        })
        .finally(() => setCityLoading(false));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [cityQuery]);

  useEffect(() => {
    if (openMenu !== "locations") return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || cityTypeaheadRef.current?.contains(target)) return;
      setCitySuggestDismissed(true);
      setCityHighlightIndex(-1);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== "locations") return;
    if (locCatalog || locCatalogLoading) return;
    setLocCatalogLoading(true);
    fetchLocationsCatalog()
      .then((data) => setLocCatalog(data))
      .catch(() => setLocCatalog({ regions: [], countries: [] }))
      .finally(() => setLocCatalogLoading(false));
  }, [openMenu, locCatalog, locCatalogLoading]);

  useEffect(() => {
    if (!locCatalog?.regions.length) {
      if (uiFilters.locations.length === 0) setLocRegionTab("all");
      return;
    }
    if (uiFilters.locations.length === 0) {
      setLocRegionTab("all");
      return;
    }
    for (let i = uiFilters.locations.length - 1; i >= 0; i -= 1) {
      const L = uiFilters.locations[i]!.trim();
      if (!L) continue;
      const regionHit = locCatalog.regions.find((r) => r.toLowerCase() === L.toLowerCase());
      if (regionHit) {
        setLocRegionTab(regionHit);
        return;
      }
      const countryHit = locCatalog.countries.find((c) => c.code.toLowerCase() === L.toLowerCase());
      if (countryHit) {
        setLocRegionTab(countryHit.region);
        return;
      }
    }
    setLocRegionTab("all");
  }, [uiFilters.locations, locCatalog]);

  useEffect(() => {
    setDraft((d) => ({
      ...d,
      role: uiFilters.roles[0],
      roles: uiFilters.roles.length ? uiFilters.roles : undefined,
      country: undefined,
      locations: uiFilters.locations.length ? uiFilters.locations : undefined,
      location: undefined,
      workType: undefined,
      workTypes: uiFilters.types.length ? uiFilters.types : undefined,
      isRemote: uiFilters.types.includes("remote") ? true : undefined,
      skills: uiFilters.skills.length ? uiFilters.skills : undefined,
    }));
  }, [uiFilters, setDraft]);

  function toggleSkill(slug: string) {
    const normalized = slug.toLowerCase();
    setUiFilters((prev) => {
      const cur = new Set(prev.skills.map((x) => x.toLowerCase()));
      if (cur.has(normalized)) cur.delete(normalized);
      else cur.add(normalized);
      const skills = Array.from(cur).sort();
      return { ...prev, skills };
    });
  }

  function toggleLocationToken(next: string) {
    const v = next.trim();
    if (!v) return;
    setUiFilters((prev) => {
      const k = v.toLowerCase();
      const idx = prev.locations.findIndex((x) => x.toLowerCase() === k);
      if (idx >= 0) {
        return { ...prev, locations: prev.locations.filter((_, i) => i !== idx) };
      }
      return { ...prev, locations: [...prev.locations, v] };
    });
    setCityQuery("");
    setCitySuggestDismissed(true);
    setCityHighlightIndex(-1);
  }

  function isLocationTokenSelected(token: string): boolean {
    const k = token.trim().toLowerCase();
    return uiFilters.locations.some((x) => x.toLowerCase() === k);
  }

  function toggleRole(next: string) {
    setUiFilters((prev) => ({
      ...prev,
      roles: prev.roles.includes(next)
        ? prev.roles.filter((r) => r !== next)
        : [...prev.roles, next],
    }));
  }

  function isSelected(role: string): boolean {
    return uiFilters.roles.includes(role);
  }

  function isSkillSelected(skill: string): boolean {
    return uiFilters.skills.includes(skill);
  }

  function toggleType(next: "remote" | "onsite" | "hybrid") {
    setUiFilters((prev) => ({
      ...prev,
      types: prev.types.includes(next)
        ? prev.types.filter((t) => t !== next)
        : [...prev.types, next],
    }));
  }

  function clearLocations() {
    setUiFilters((prev) => ({ ...prev, locations: [] }));
    setLocRegionTab("all");
  }

  const skillCount = uiFilters.skills.length;
  const browseCategoryLabel = selectedCategory
    ? BROWSE_BY_CATEGORY.find((c) => c.slug === selectedCategory)?.label
    : undefined;
  const roleLabel =
    uiFilters.roles.length === 0
      ? (browseCategoryLabel ?? "Role")
      : uiFilters.roles.length === 1
        ? (roleMeta.get(uiFilters.roles[0]!) ??
          uiFilters.roles[0]!.replace(/-/g, " "))
        : `${uiFilters.roles.length} Roles Selected`;
  const skillsLabel =
    skillCount === 0
      ? "Skills"
      : skillCount === 1
        ? uiFilters.skills[0]!.replace(/-/g, " ")
        : `${skillCount} Skills Selected`;
  const sortValue = appliedFilters.sort === "salary_desc" ? "salary_desc" : "latest";
  const panelClass = "absolute left-0 top-full z-50 mt-2 rounded-xl border border-ink/10 bg-surface p-3 shadow-lg overflow-hidden";
  /** `overflow-visible` so the city typeahead list (absolute below the input) is not clipped. */
  const locationsPanelClass =
    "absolute left-0 top-full z-[100] mt-2 max-w-[min(100vw-2rem,380px)] rounded-xl border border-ink/10 bg-surface p-3 shadow-lg overflow-visible";
  const triggerClass =
    "h-10 min-w-[140px] max-w-[220px] rounded-xl border border-ink/15 bg-surface px-4 text-left text-xs font-bold uppercase tracking-wide text-ink shadow-sm transition-colors hover:border-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/20 whitespace-nowrap";
  const rolePanelClass = `${panelClass} min-w-[min(100vw-2rem,400px)] max-w-[min(100vw-2rem,460px)]`;
  const cityQ = cityQuery.trim();
  const showCitySuggestionsList =
    openMenu === "locations" &&
    cityQ.length >= 2 &&
    !citySuggestDismissed &&
    (cityLoading || citySuggestions.length > 0 || cityNoResults);
  const dropdownMotion = {
    initial: { opacity: 0, scaleY: 0.72, width: "100%", y: -10 },
    animate: { opacity: 1, scaleY: 1, width: 220, y: 0 },
    exit: { opacity: 0, scaleY: 0.82, width: "92%", y: -6 },
    transition: { type: "spring" as const, stiffness: 420, damping: 18, mass: 0.55 },
  };
  const roleDropdownMotion = {
    initial: { opacity: 0, scaleY: 0.72, y: -10 },
    animate: { opacity: 1, scaleY: 1, y: 0 },
    exit: { opacity: 0, scaleY: 0.82, y: -6 },
    transition: { type: "spring" as const, stiffness: 420, damping: 18, mass: 0.55 },
  };

  return (
    <div ref={controlsRef} className="w-full">
      <div className="flex flex-wrap items-start gap-3">
        <div className="relative min-w-[140px] max-w-[180px]" data-dropdown-id="role">
          <button
            type="button"
            className={triggerClass}
            onClick={() => setOpenMenu((v) => (v === "role" ? null : "role"))}
            aria-expanded={openMenu === "role"}
          >
            <span className="block truncate whitespace-nowrap">
              {roleLabel}
            </span>
          </button>
          <AnimatePresence>
          {openMenu === "role" ? (
            <motion.div {...roleDropdownMotion} style={{ originY: 0 }} className={rolePanelClass}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink/45">
                Browse by category
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                {BROWSE_BY_CATEGORY.map((c) => {
                  const active = selectedCategory === c.slug;
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() =>
                        onCategoryNavigate(active ? undefined : c.slug)
                      }
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                        active
                          ? "bg-[#E8533A] text-white shadow-sm"
                          : "bg-ink/[0.07] text-ink/80 ring-1 ring-ink/10 hover:bg-ink/10",
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <div className="my-3 border-t border-ink/10" role="separator" />
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink/45">
                Specific role
              </p>
              <input
                value={roleQuery}
                onChange={(e) => setRoleQuery(e.target.value)}
                placeholder="Search roles"
                className="mb-2 h-10 w-full rounded-xl border border-ink/15 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <ul className="max-h-[220px] overflow-y-auto pr-1">
                {rolesLoading ? (
                  <>
                    <RolePresetShimmerRow />
                    <RolePresetShimmerRow />
                    <RolePresetShimmerRow />
                  </>
                ) : filteredRoleRows.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-ink/50">No roles match</li>
                ) : (
                  filteredRoleRows.map((row) => {
                    const selected = isSelected(row.slug);
                    return (
                      <li key={row.slug}>
                        <button
                          type="button"
                          className={`flex h-10 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${selected ? "bg-orange-100 text-orange-700" : "hover:bg-brand/5"}`}
                          onClick={() => toggleRole(row.slug)}
                        >
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                            {row.label}
                            <span className="ml-1.5 text-xs font-normal text-ink/40">
                              ({row.count.toLocaleString()})
                            </span>
                          </span>
                          <span
                            className={`ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${selected ? "border-orange-400 bg-orange-200 text-orange-700" : "border-ink/20 text-transparent"}`}
                            aria-hidden
                          >
                            ✓
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              {uiFilters.roles.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {uiFilters.roles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20"
                      onClick={() => toggleRole(role)}
                    >
                      {(roleMeta.get(role) ?? role.replace(/-/g, " "))} x
                    </button>
                  ))}
                </div>
              ) : null}
            </motion.div>
          ) : null}
          </AnimatePresence>
        </div>

        <div className="flex min-w-[220px] max-w-[260px] items-center gap-1 rounded-xl border border-ink/15 bg-white p-1">
          {[
            { label: "Remote", value: "remote" },
            { label: "Onsite", value: "onsite" },
            { label: "Hybrid", value: "hybrid" },
          ].map((item) => {
            const value = item.value as "remote" | "onsite" | "hybrid";
            const active = uiFilters.types.includes(value);
            return (
              <button
                key={item.label}
                type="button"
                className={`flex-1 rounded-lg px-2.5 py-1.5 text-center text-sm font-semibold whitespace-nowrap transition ${active ? "bg-orange-500 text-white shadow-sm" : "text-ink/60 hover:bg-ink/5 hover:text-ink"}`}
                onClick={() => toggleType(value)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[140px] max-w-[220px]" data-dropdown-id="skills">
          <button
            type="button"
            aria-expanded={openMenu === "skills"}
            aria-controls={skillsPanelId}
            onClick={() => setOpenMenu((v) => (v === "skills" ? null : "skills"))}
            className={triggerClass}
          >
            <span className="block truncate whitespace-nowrap">{skillsLabel}</span>
          </button>
          <AnimatePresence>
          {openMenu === "skills" && (
            <motion.div
              id={skillsPanelId}
              role="region"
              aria-label="Skills"
              className={panelClass}
              initial={dropdownMotion.initial}
              animate={dropdownMotion.animate}
              exit={dropdownMotion.exit}
              transition={dropdownMotion.transition}
              style={{ originY: 0 }}
            >
              <input
                value={skillsQuery}
                onChange={(e) => setSkillsQuery(e.target.value)}
                placeholder="Search skills"
                className="mb-2 h-10 w-full rounded-xl border border-ink/15 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <ul className="max-h-56 overflow-auto">
                {skillsLoading ? (
                  <>
                    <SkillPresetShimmerRow />
                    <SkillPresetShimmerRow />
                    <SkillPresetShimmerRow />
                  </>
                ) : rankedSkillRows.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-ink/50">No skills match</li>
                ) : (
                  rankedSkillRows.map((row) => {
                    const s = row.slug;
                    const active = selectedSkills.has(s) || isSkillSelected(s);
                    return (
                      <li key={s}>
                        <button
                          type="button"
                          className={`flex h-10 w-full items-center justify-between rounded-xl px-3 text-left text-sm whitespace-nowrap ${active ? "bg-orange-100 text-orange-700" : "hover:bg-brand/5"}`}
                          onClick={() => toggleSkill(s)}
                        >
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                            {s.replace(/-/g, " ")}
                            {row.count > 0 ? (
                              <span className="ml-1.5 text-xs font-normal text-ink/40">
                                ({row.count.toLocaleString()})
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={`ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${active ? "border-orange-400 bg-orange-200 text-orange-700" : "border-ink/20 text-transparent"}`}
                            aria-hidden
                          >
                            ✓
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              {uiFilters.skills.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {uiFilters.skills.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20"
                      onClick={() => toggleSkill(s)}
                    >
                      {s.replace(/-/g, " ")} x
                    </button>
                  ))}
                </div>
              ) : null}
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        <div className="relative min-w-[140px] max-w-[220px]" data-dropdown-id="experience">
          <button
            type="button"
            className={triggerClass}
            onClick={() => setOpenMenu((v) => (v === "experience" ? null : "experience"))}
          >
            {draft.experience ? `Level: ${draft.experience}` : "Experience"}
          </button>
          <AnimatePresence>
          {openMenu === "experience" ? (
            <motion.div className={panelClass} initial={dropdownMotion.initial} animate={dropdownMotion.animate} exit={dropdownMotion.exit} transition={dropdownMotion.transition} style={{ originY: 0 }}>
              {["", "junior", "mid", "senior"].map((v) => (
                <button
                  key={v || "any"}
                  type="button"
                className="h-10 w-full rounded-xl px-3 text-left text-sm hover:bg-brand/5"
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      experience: v ? (v as JobFilters["experience"]) : undefined,
                    }));
                    setOpenMenu(null);
                  }}
                >
                  {v ? v[0]!.toUpperCase() + v.slice(1) : "Any level"}
                </button>
              ))}
            </motion.div>
          ) : null}
          </AnimatePresence>
        </div>

        <div className="relative min-w-[140px] max-w-[220px]" data-dropdown-id="posted">
          <button
            type="button"
            className={triggerClass}
            onClick={() => setOpenMenu((v) => (v === "posted" ? null : "posted"))}
          >
            {draft.posted ? `Posted: ${draft.posted}` : "Posted"}
          </button>
          <AnimatePresence>
          {openMenu === "posted" ? (
            <motion.div className={panelClass} initial={dropdownMotion.initial} animate={dropdownMotion.animate} exit={dropdownMotion.exit} transition={dropdownMotion.transition} style={{ originY: 0 }}>
              {[
                { value: "", label: "Any time" },
                { value: "24h", label: "24 hours" },
                { value: "3d", label: "3 days" },
                { value: "1w", label: "1 week" },
                { value: "1m", label: "1 month" },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="h-10 w-full rounded-xl px-3 text-left text-sm hover:bg-brand/5"
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      posted: item.value ? (item.value as JobFilters["posted"]) : undefined,
                    }));
                    setOpenMenu(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </motion.div>
          ) : null}
          </AnimatePresence>
        </div>

        <div className="relative min-w-[140px] max-w-[220px]" data-dropdown-id="locations">
          <button
            type="button"
            className={triggerClass}
            onClick={() => setOpenMenu((v) => (v === "locations" ? null : "locations"))}
          >
            <span className="block truncate whitespace-nowrap">
              {locationsTriggerLabel(uiFilters.locations)}
            </span>
          </button>
          <AnimatePresence>
          {openMenu === "locations" ? (
            <motion.div
              className={locationsPanelClass}
              initial={dropdownMotion.initial}
              animate={dropdownMotion.animate}
              exit={dropdownMotion.exit}
              transition={dropdownMotion.transition}
              style={{ originY: 0 }}
            >
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink/45">Region</p>
              <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${locRegionTab === "all" ? "bg-orange-500 text-white" : "bg-ink/5 text-ink/70 hover:bg-ink/10"}`}
                  onClick={() => {
                    setLocRegionTab("all");
                    clearLocations();
                  }}
                >
                  All
                </button>
                {regionsOrderedForFilterChips(locCatalog?.regions ?? []).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      isLocationTokenSelected(r) ? "bg-orange-500 text-white" : "bg-ink/5 text-ink/70 hover:bg-ink/10"
                    }`}
                    onClick={() => {
                      setLocRegionTab(r);
                      toggleLocationToken(r);
                    }}
                  >
                    {regionFilterChipLabel(r)}
                  </button>
                ))}
              </div>
              {locCatalogLoading ? (
                <p className="py-2 text-sm text-ink/50">Loading regions…</p>
              ) : locRegionTab !== "all" && locCatalog && locRegionTab !== "Global" ? (
                <>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink/45">Country</p>
                  <ul className="mb-3 max-h-56 overflow-y-auto">
                    {locCatalog.countries
                      .filter((c) => c.region === locRegionTab)
                      .map((c) => (
                        <li key={c.code}>
                          <button
                            type="button"
                            className="h-9 w-full rounded-lg px-2 text-left text-sm hover:bg-brand/5"
                            onClick={() => toggleLocationToken(c.code)}
                          >
                            {c.name}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink/45">City or place</p>
              <div ref={cityTypeaheadRef} className="relative">
                <div className="relative">
                  <input
                    value={cityQuery}
                    onChange={(e) => setCityQuery(e.target.value)}
                    placeholder="e.g. Chennai"
                    role="combobox"
                    aria-expanded={showCitySuggestionsList}
                    aria-controls={cityListId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      showCitySuggestionsList && cityHighlightIndex >= 0
                        ? `${cityListId}-opt-${cityHighlightIndex}`
                        : undefined
                    }
                    className="h-10 w-full rounded-xl border border-ink/15 py-2 pl-3 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                    onKeyDown={(e) => {
                      const n = citySuggestions.length;
                      if (e.key === "Escape") {
                        if (showCitySuggestionsList) {
                          e.preventDefault();
                          setCitySuggestDismissed(true);
                          setCityHighlightIndex(-1);
                        }
                        return;
                      }
                      if (e.key === "ArrowDown" && showCitySuggestionsList && n > 0) {
                        e.preventDefault();
                        setCityHighlightIndex((h) => (h + 1) % n);
                        return;
                      }
                      if (e.key === "ArrowUp" && showCitySuggestionsList && n > 0) {
                        e.preventDefault();
                        setCityHighlightIndex((h) => (h <= 0 ? n - 1 : h - 1));
                        return;
                      }
                      if (e.key === "Enter") {
                        const q = cityQuery.trim();
                        if (n > 0 && cityHighlightIndex >= 0 && citySuggestions[cityHighlightIndex]) {
                          e.preventDefault();
                          toggleLocationToken(citySuggestions[cityHighlightIndex]!.city);
                          return;
                        }
                        if (q) {
                          e.preventDefault();
                          toggleLocationToken(q);
                        }
                      }
                    }}
                  />
                </div>
                <AnimatePresence initial={false}>
                  {showCitySuggestionsList ? (
                    <motion.ul
                      key="city-suggestions"
                      id={cityListId}
                      role="listbox"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute left-0 right-0 z-[110] mt-2 max-h-[300px] overflow-x-hidden overflow-y-auto rounded-[12px] border border-black/[0.07] bg-white py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.10)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {cityLoading && citySuggestions.length === 0 ? (
                        <>
                          <CitySuggestionShimmerRow />
                          <CitySuggestionShimmerRow />
                          <CitySuggestionShimmerRow />
                        </>
                      ) : cityNoResults ? (
                        <li className="px-3 py-3 text-sm text-ink/50">No cities found</li>
                      ) : (
                        citySuggestions.map((s, i) => {
                          const active = i === cityHighlightIndex;
                          return (
                            <li
                              key={`${s.city}|${s.country ?? ""}|${s.region}|${i}`}
                              id={`${cityListId}-opt-${i}`}
                              role="option"
                              aria-selected={active}
                            >
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-start gap-2 border-0 px-3 py-2.5 text-left outline-none transition-colors",
                                  active ? "bg-[rgba(232,83,58,0.07)]" : "hover:bg-black/[0.03]",
                                )}
                                onMouseEnter={() => setCityHighlightIndex(i)}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => toggleLocationToken(s.city)}
                              >
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <div
                                    className={cn(
                                      "truncate text-sm font-semibold leading-tight tracking-tight",
                                      active ? "text-[#E8533A]" : "text-ink",
                                    )}
                                  >
                                    {s.city}
                                  </div>
                                  <div className="mt-0.5 truncate text-xs leading-tight text-black/50">
                                    {s.country?.trim() || "?"} · {s.region}
                                  </div>
                                </div>
                                <span className="mt-0.5 shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-medium leading-none text-ink/65">
                                  {s.region}
                                </span>
                              </button>
                            </li>
                          );
                        })
                      )}
                    </motion.ul>
                  ) : null}
                </AnimatePresence>
              </div>
              {uiFilters.locations.length > 0 ? (
                <div className="mt-3 border-t border-ink/10 pt-2">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {uiFilters.locations.map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20"
                        onClick={() => toggleLocationToken(loc)}
                      >
                        {locationFilterTriggerLabel(loc)} ×
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand hover:underline"
                      onClick={() => clearLocations()}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          ) : null}
          </AnimatePresence>
        </div>

        <div className="filter-chip min-w-[8rem] flex-1 transition-all duration-300 ease-chip hover:-translate-y-0.5 hover:scale-[1.03] sm:flex-none">
          {onClearFilters ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                outlineTone="rose"
                size="md"
                type="button"
                onClick={onClearFilters}
                disabled={clearFiltersDisabled}
                className="h-[42px] min-w-[5.5rem] font-semibold tracking-wide"
              >
                Clear
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={onApply}
                className="h-[42px] min-w-[5.5rem] font-bold tracking-wide sm:w-auto"
              >
                Apply
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={onApply}
              className="h-[42px] w-full font-bold tracking-wide sm:w-auto"
            >
              Apply
            </Button>
          )}
        </div>
      </div>

      {showSort ? (
        <div className="mt-4">
          <SortSegmented
            value={sortValue}
            onChange={(v) =>
              onSortNavigate(v === "salary_desc" ? "salary_desc" : undefined)
            }
            totalRoles={totalRoles}
          />
        </div>
      ) : null}

      {showChips ? <FilterChips filters={appliedFilters} onRemoveChip={onRemoveChip} /> : null}
    </div>
  );
}
