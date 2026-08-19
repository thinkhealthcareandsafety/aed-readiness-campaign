"use client";

import { useEffect, useRef, useState } from "react";
import { PRIZES } from "@/lib/prizes";

// Recognizable, real hotel-brand marks the property picker already resolves
// hotels against (see lib/hotelBrands.js / public/hotel-logos/) — shown here
// only as "this tool already knows your brand's properties", never
// rephrased as a customer/usage claim ("trusted by...") the campaign can't
// actually back up.
const BRAND_STRIP = [
  { logo: "/hotel-logos/marriott.png", name: "Marriott" },
  { logo: "/hotel-logos/sheraton.png", name: "Sheraton" },
  { logo: "/hotel-logos/westin.png", name: "Westin" },
  { logo: "/hotel-logos/courtyard.png", name: "Courtyard" },
  { logo: "/hotel-logos/aloft.png", name: "Aloft" },
  { logo: "/hotel-logos/renaissance.png", name: "Renaissance" },
];

// IntersectionObserver-driven scroll reveal: a section starts slightly
// lowered and faded, then settles into place the first time it crosses into
// view. `threshold` is low (0.12) so long sections (e.g. the gift grid)
// don't wait for their whole bulk to clear the viewport before animating.
// Returns a tuple, not { elementRef, className } — the react-hooks/refs
// lint rule traces a ref through an object property returned from a custom
// hook and flags *any* access to that property at the JSX usage site, even
// though `ref={x.elementRef}` is exactly as safe as `ref={x}`. Destructuring
// into plain local variables at each call site (`const [fooRef, fooClass] =
// useReveal()`) keeps the ref itself a directly-traceable local rather than
// a property access, which the rule is fine with.
function useReveal() {
  const elementRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Reduced-motion can only be read client-side, so this is an
      // unavoidable one-time client-only correction, not state syncing
      // that should've been derived during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [elementRef, `reveal${visible ? " reveal-in" : ""}`];
}

const TRUST_ITEMS = [
  { icon: ClockIcon, label: "~5 minutes" },
  { icon: ChecklistIcon, label: "12 readiness checks" },
  { icon: ScanIcon, label: "AI scan or manual" },
  { icon: ScoreIcon, label: "Instant PREPARED score" },
];

const WHY_CARDS = [
  {
    icon: "/icons/battery-ok.svg",
    title: "Batteries & pads expire quietly",
    body: "Most properties don't realize their AED battery or pads have expired until it's too late to matter. This check flags it in minutes.",
  },
  {
    icon: "/icons/status-ready.svg",
    title: "One score, eight categories",
    body: "Physical condition, expiry status, training, paediatric readiness, documentation and more — rolled into a single PREPARED score.",
  },
  {
    icon: "/icons/doc-maintenance.svg",
    title: "A report you can act on",
    body: "See exactly what's ready, what's ageing, and what needs replacing — plus a shareable certificate for CPR/AED-trained staff.",
  },
];

export default function Landing() {
  const [trustRef, trustClass] = useReveal();
  const [giftRef, giftClass] = useReveal();
  const [whyRef, whyClass] = useReveal();
  const [closeRef, closeClass] = useReveal();

  return (
    <>
      <section className="landing-hero">
        <video className="landing-hero-video" autoPlay muted loop playsInline preload="auto">
          <source src="/videos/aed-kit-reveal.mp4" type="video/mp4" />
        </video>
        <div className="landing-hero-overlay" />
        <div className="landing-hero-inner">
          <span className="landing-eyebrow">Think Health &middot; AED Readiness Campaign</span>
          <h1 className="landing-h1">Is your AED ready to save a life right now?</h1>
          <p className="landing-lead">
            A free readiness check for your property&rsquo;s AED — battery, pads, training, and signage —
            scored against the PREPARED standard, with a full report at the end.
          </p>
          <a href="#audit" className="btn btn-primary landing-cta landing-cta-lg">
            Start your free audit
            <ArrowIcon />
          </a>
        </div>
        <a href="#audit" className="landing-scroll-cue" aria-label="Scroll down to start the audit">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 9l8 8 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </section>

      <div className="landing-trust-bar" ref={trustRef}>
        <div className={`landing-trust-bar-inner ${trustClass}`}>
          {TRUST_ITEMS.map(({ icon: Icon, label }) => (
            <div className="landing-trust-item" key={label}>
              <Icon />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="landing-brand-strip">
          <span className="sr-only">{BRAND_STRIP.map((b) => b.name).join(", ")}, and other hotel brands</span>
          <div className="landing-brand-strip-track">
            {/* The logo row is duplicated back-to-back and the animation
               translates exactly one copy's width (-50%) before looping —
               that's what makes the loop seamless with pure CSS instead of
               needing JS to detect scroll position and jump/reset it. */}
            <div className="landing-brand-strip-logos" aria-hidden="true">
              {[...BRAND_STRIP, ...BRAND_STRIP].map((b, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- small static brand mark, no next/image needed
                <img key={`${b.name}-${i}`} src={b.logo} alt="" title={b.name} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="landing-gift" ref={giftRef}>
        <div className={`landing-section-inner landing-gift-inner ${giftClass}`}>
          <div className="landing-gift-media-wrap landing-gift-media-wrap-portrait">
            <video className="landing-gift-media" autoPlay muted loop playsInline preload="auto">
              <source src="/videos/aed-kit-gift-reveal.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="landing-gift-copy">
            <span className="landing-ribbon">Spin to win</span>
            <h2 className="landing-h2 left">Finish your audit, spin the wheel</h2>
            <p>Every completed audit gets one spin — you&rsquo;ll walk away with one of these:</p>
            <ul className="landing-gift-list">
              {PRIZES.map((p) => (
                <li key={p.id}>
                  <span className="check" style={{ background: p.color }}>
                    &#10003;
                  </span>{" "}
                  {p.label}
                </li>
              ))}
            </ul>
            <a href="#audit" className="btn btn-primary landing-cta">
              Start your audit & spin
              <ArrowIcon />
            </a>
          </div>
        </div>
      </section>

      <section className="landing-why" ref={whyRef}>
        <div className={`landing-section-inner ${whyClass}`}>
          <span className="landing-eyebrow dark">Why it matters</span>
          <h2 className="landing-h2">What a five-minute check catches</h2>
          <div className="landing-card-grid">
            {WHY_CARDS.map((c, i) => (
              <div className="landing-card" key={c.title} style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="landing-card-num">{String(i + 1).padStart(2, "0")}</span>
                <div className="landing-card-icon-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static decorative icon, no next/image needed */}
                  <img src={c.icon} alt="" className="landing-card-icon" />
                </div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-close" ref={closeRef}>
        <div className={`landing-section-inner ${closeClass}`}>
          <h2 className="landing-h2">Ready to see where you stand?</h2>
          <p className="landing-close-sub">
            Answer a few questions or let AI scan your unit — either way, you&rsquo;ll have a PREPARED score and a
            clear action list in about five minutes.
          </p>
          <ul className="landing-close-reassure">
            <li>No cost, no obligation</li>
            <li>Report ready the moment you finish</li>
            <li>One spin of the prize wheel when you&rsquo;re done</li>
          </ul>
          <a href="#audit" className="btn btn-primary landing-cta landing-cta-lg">
            Get my PREPARED score
            <ArrowIcon />
          </a>
        </div>
      </section>
    </>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="landing-cta-arrow">
      <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8V5.5a1.5 1.5 0 0 1 1.5-1.5H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ScoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3.5l2.47 5.1 5.53.66-4.06 3.86 1.07 5.5L12 15.9l-4.99 2.72 1.07-5.5-4.06-3.86 5.53-.66L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
