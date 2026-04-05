"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchCountrySuggestions, type CountrySuggestion } from "../../lib/api";
import { cn } from "../../lib/cn";

interface Props {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onPick?: (code: string) => void;
  placeholder?: string;
  className?: string;
  /** Merged onto input (Komposo rose pill field). */
  inputClassName?: string;
}

/**
 * Free-text country field with debounced suggestions (controlled value).
 */
export function CountryInput({
  id: extId,
  value,
  onChange,
  onPick,
  placeholder = "Country name or code…",
  className = "",
  inputClassName = "",
}: Props) {
  const autoId = useId();
  const inputId = extId ?? `${autoId}-country`;
  const listId = `${inputId}-suggestions`;
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<CountrySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetchCountrySuggestions(q)
        .then((rows) => {
          setSuggestions(rows);
          setLoading(false);
        })
        .catch(() => {
          setSuggestions([]);
          setLoading(false);
        });
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(c: CountrySuggestion) {
    onChange(`${c.name} (${c.code})`);
    onPick?.(c.code);
    setOpen(false);
  }

  const countryFieldClass = cn(
    "w-full rounded-full border-2 border-rose/30 bg-surface px-3.5 py-2.5 text-sm font-medium text-ink shadow-sm transition-shadow placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-rose/15",
    inputClassName,
  );

  return (
    <div ref={wrapRef} className={cn("relative w-full min-w-[11rem]", className)}>
      <label htmlFor={inputId} className="sr-only">
        Country
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={countryFieldClass}
      />
      {open && (suggestions.length > 0 || loading) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-2xl bg-surface py-1 shadow-lg ring-1 ring-ink/8"
        >
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-muted">Loading…</li>
          )}
          {suggestions.map((c) => (
            <li key={c.code} role="option">
              <button
                type="button"
                className="flex w-full px-3 py-2 text-left text-sm text-ink hover:bg-brand/5 focus:bg-brand/5 focus:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-ink-muted">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
