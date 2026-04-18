"use client";

import type { JobFilters } from "../../lib/slug-parser";

export interface FilterChipModel {
  id: string;
  label: string;
  onRemove: () => void;
}

interface Props {
  filters: JobFilters;
  onRemoveChip: (payload: {
    type: keyof JobFilters | "skill";
    value?: string;
  }) => void;
}

function globalLocationLabel(raw: string): string {
  const t = raw.trim();
  if (t === "Global" || t.toUpperCase() === "GLOBAL") return "🌍 Global";
  return t;
}

function buildChips(filters: JobFilters, onRemove: Props["onRemoveChip"]): FilterChipModel[] {
  const out: FilterChipModel[] = [];
  const push = (items: FilterChipModel[]) => {
    for (const item of items) out.push(item);
  };

  const categoryVals =
    filters.categories?.length
      ? filters.categories
      : filters.category
        ? [filters.category]
        : [];
  push(
    categoryVals.map((cat) => ({
      id: `category-${cat}`,
      label: `Category: ${cat.replace(/-/g, " ")}`,
      onRemove: () => onRemove({ type: "category", value: cat }),
    })),
  );
  const roles = filters.roles?.length ? filters.roles : filters.role ? [filters.role] : [];
  push(
    roles.map((role) => ({
      id: `role-${role}`,
      label: `Role: ${role.replace(/-/g, " ")}`,
      onRemove: () => onRemove({ type: "role", value: role }),
    })),
  );

  if (filters.location?.trim()) {
    out.push({
      id: "location",
      label: `Location: ${globalLocationLabel(filters.location)}`,
      onRemove: () => onRemove({ type: "location" }),
    });
  } else {
    const locations = filters.locations?.length
      ? filters.locations
      : filters.country
        ? [filters.country]
        : [];
    push(
      locations.map((loc) => ({
        id: `country-${loc}`,
        label: `Location: ${globalLocationLabel(loc)}`,
        onRemove: () => onRemove({ type: "country", value: loc }),
      })),
    );
  }

  const types = filters.workTypes?.length
    ? filters.workTypes
    : filters.workType
      ? [filters.workType]
      : [];
  push(
    types.map((workType) => ({
      id: `workType-${workType}`,
      label: `Work: ${workType}`,
      onRemove: () => onRemove({ type: "workType", value: workType }),
    })),
  );
  if (filters.isRemote === true && !filters.workType) {
    out.push({
      id: "remote",
      label: "Remote",
      onRemove: () => onRemove({ type: "isRemote" }),
    });
  }
  if (filters.skills?.length) {
    for (const s of filters.skills) {
      out.push({
        id: `skill-${s}`,
        label: s.replace(/-/g, " "),
        onRemove: () => onRemove({ type: "skill", value: s }),
      });
    }
  }
  if (filters.experience) {
    out.push({
      id: "experience",
      label: `Level: ${filters.experience}`,
      onRemove: () => onRemove({ type: "experience" }),
    });
  }
  if (filters.posted) {
    out.push({
      id: "posted",
      label: `Posted: ${filters.posted}`,
      onRemove: () => onRemove({ type: "posted" }),
    });
  }
  if (filters.minSalary !== undefined && filters.minSalary > 0) {
    out.push({
      id: "minSalary",
      label: `Min $${filters.minSalary.toLocaleString()}+`,
      onRemove: () => onRemove({ type: "minSalary" }),
    });
  }
  if (filters.sort === "salary_desc") {
    out.push({
      id: "sort",
      label: "Sort: highest salary",
      onRemove: () => onRemove({ type: "sort" }),
    });
  }

  return out;
}

export function FilterChips({ filters, onRemoveChip }: Props) {
  const chips = buildChips(filters, onRemoveChip);
  if (chips.length === 0) return null;

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/[0.06] pt-4"
      role="list"
      aria-label="Active filters"
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Active</span>
      {chips.map((c) => (
        <span
          key={c.id}
          role="listitem"
          className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-200"
        >
          {c.label}
          <button
            type="button"
            onClick={c.onRemove}
            className="flex h-5 w-5 items-center justify-center rounded-full text-orange-700/80 transition-colors hover:bg-orange-300/60 hover:text-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
            aria-label={`Remove ${c.label}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
