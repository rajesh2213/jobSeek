"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchCountrySuggestions, type CountrySuggestion } from "../../lib/api";

interface Props {
  id?: string;
  /** ISO code when selected */
  valueCode: string;
  /** Text shown in the input */
  inputDisplay: string;
  onChange: (code: string, displayLabel: string) => void;
  placeholder?: string;
}

export function CountrySelect({
  id: _id,
  valueCode,
  inputDisplay,
  onChange,
  placeholder = "Search countries…",
}: Props) {
  const autoId = useId();
  const listboxId = `${autoId}-listbox`;
  const [query, setQuery] = useState(inputDisplay);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<CountrySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(inputDisplay);
  }, [inputDisplay]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetchCountrySuggestions(query)
        .then((rows) => {
          if (!cancelled) {
            setSuggestions(rows);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(c: CountrySuggestion) {
    onChange(c.code, `${c.name} (${c.code})`);
    setQuery(`${c.name} (${c.code})`);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative w-full min-w-[12rem]">
      <label htmlFor={listboxId} className="sr-only">
        Country
      </label>
      <input
        id={listboxId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listboxId}-options`}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          setOpen(true);
          onChange("", v);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-2xl bg-white/90 px-3.5 py-2.5 text-sm text-ink shadow-sm ring-1 ring-ink/5 transition-shadow placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/35"
      />
      {open && (suggestions.length > 0 || loading) && (
        <ul
          id={`${listboxId}-options`}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-2xl bg-white py-1 shadow-lg ring-1 ring-ink/8"
        >
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-muted">Loading…</li>
          )}
          {suggestions.map((c) => (
            <li key={c.code} role="option">
              <button
                type="button"
                className="flex w-full px-3 py-2 text-left text-sm text-ink hover:bg-brand-soft focus:bg-brand-soft focus:outline-none"
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
