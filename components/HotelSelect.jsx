"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { logoForHotel } from "@/lib/hotelBrands";

// A searchable combobox for the ~160-hotel list, showing each option's
// brand logo (see lib/hotelBrands.js) — the native <select> this replaces
// can't render anything but plain text inside an <option>, so logos are
// only possible with a custom listbox. Kept to a plain combobox pattern
// (no extra libraries): trigger button -> search input + listbox panel,
// arrow keys/Enter/Escape, click-outside to close.
export function HotelSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Opens with the search box focused, not the first option — typing to
  // filter is the fast path for a list this long, so it shouldn't need an
  // extra Tab/click to reach. query/activeIndex reset synchronously in
  // openPanel() below rather than in this effect, since setting state
  // unconditionally the moment an effect sees open flip true is exactly
  // the render-cascade pattern effects are meant to avoid — the only thing
  // that actually needs an effect here is the focus() DOM call itself.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function openPanel() {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function choose(opt) {
    onChange(opt.value);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    }
  }

  const selectedLogo = selected ? logoForHotel(selected.label) : null;

  return (
    <div className="hotel-select" ref={containerRef}>
      <button
        type="button"
        className="hotel-select-trigger"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="hotel-select-trigger-inner">
          {selectedLogo && (
            // eslint-disable-next-line @next/next/no-img-element -- static bundled brand mark, no next/image needed
            <img src={selectedLogo.logo} alt="" className="hotel-select-logo" />
          )}
          <span className={selected ? undefined : "hotel-select-placeholder"}>
            {selected ? selected.label : placeholder || "Select..."}
          </span>
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="hotel-select-panel" role="listbox">
          <input
            ref={searchRef}
            type="text"
            className="hotel-select-search"
            placeholder="Search hotels..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="hotel-select-list" ref={listRef}>
            {filtered.length === 0 && <div className="hotel-select-empty">No hotels match &ldquo;{query}&rdquo;.</div>}
            {filtered.map((opt, i) => {
              const brand = logoForHotel(opt.label);
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  data-active={i === activeIndex}
                  className={`hotel-select-option${i === activeIndex ? " active" : ""}${opt.value === value ? " selected" : ""}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(opt)}
                >
                  {brand ? (
                    // eslint-disable-next-line @next/next/no-img-element -- static bundled brand mark, no next/image needed
                    <img src={brand.logo} alt="" className="hotel-select-logo" />
                  ) : (
                    <span className="hotel-select-logo hotel-select-logo-empty" aria-hidden="true" />
                  )}
                  <span>{opt.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`hotel-select-chevron${open ? " open" : ""}`}
    >
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
