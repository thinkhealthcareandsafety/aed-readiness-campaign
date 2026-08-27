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

// Short (1-2 word) labels for the decorative hero wheel's 74px tiles — the
// real PRIZES[].label strings ("Replacement electrode pads") don't fit that
// space. Presentation-only and local to this component: lib/prizes.js stays
// untouched since POST /api/submissions' random index is contracted to its
// exact order and label text.
const PRIZE_SHORT_LABEL = {
  pads: "Electrode pads",
  battery: "Battery pack",
  stretcher: "Stretcher",
  first_aid_kit: "Response kit",
  aedsmartx: "SmartX, 1 year",
};

const WHEEL_SEG = 360 / PRIZES.length;

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

// A plain `href="#audit"` (or CSS `scroll-behavior: smooth`) jumps there in
// whatever duration the browser feels like — often under half a second for
// this page's length, which defeats the point of a long scrolling page: the
// visitor never actually sees the gift/why sections go by, just the hero
// and then the form. This animates the same scroll deliberately slower so
// the middle of the page registers as something they scrolled *past*, not
// content that only exists if they scroll back up for it later.
function scrollToAuditSlowly(e) {
  const target = document.getElementById("audit");
  if (!target) return;
  e.preventDefault();

  // globals.css sets `html { scroll-behavior: smooth }` globally so other,
  // ordinary scrollIntoView calls elsewhere in the app get an animated
  // scroll for free. But every window.scrollBy call this function makes
  // below would ALSO get intercepted by that and turned into its own
  // native smooth-scroll animation, layered on top of (and immediately
  // interrupted by) the very next frame's call doing the same thing — two
  // animations fighting over the same scroll position roughly 60 times a
  // second. That fight, not frame timing, is what actually reads as
  // "laggy": every scrollBy call kicks off a fresh ~300ms native animation
  // that never gets anywhere close to finishing before the next one
  // replaces it. Switching to "auto" for the duration of this function's
  // own animation removes that second competing animation entirely; the
  // original value is restored once it's done so scroll-behavior: smooth
  // still applies everywhere else.
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  function restoreScrollBehavior() {
    root.style.scrollBehavior = previousScrollBehavior;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    target.scrollIntoView();
    restoreScrollBehavior();
    return;
  }
  const startTime = performance.now();
  const maxDuration = Math.min(2600, Math.max(1200, Math.abs(target.getBoundingClientRect().top) * 0.9));
  // Time constant for the exponential chase below — ~63% of whatever
  // distance remains closes every TAU_MS of *real elapsed time*, matched
  // to feel like the previous version's "8% per frame at a steady 60fps".
  const TAU_MS = 200;
  let lastTime = startTime;
  function step(now) {
    const remaining = target.getBoundingClientRect().top;
    // Snap the last couple of pixels via scrollIntoView instead of letting
    // the chase below asymptote forever, and bail out on the same snap if
    // this is taking too long for any reason.
    if (Math.abs(remaining) < 2 || now - startTime > maxDuration + 400) {
      target.scrollIntoView({ block: "start" });
      restoreScrollBehavior();
      return;
    }
    const dt = now - lastTime;
    lastTime = now;
    // Moves however much of the remaining distance a continuous
    // exponential decay would cover in *this frame's actual duration* —
    // recomputed live from the DOM each frame (not a fixed total distance
    // measured once at click time), so it stays correct whether the target
    // moved (a mobile address bar collapsing mid-scroll shifts the whole
    // page's layout) or the visitor themselves scrolled. Parameterizing the
    // decay by dt instead of applying a fixed fraction *per frame* keeps
    // perceived speed constant regardless of frame rate (a slow/dropped
    // frame covers proportionally more ground instead of the same tiny
    // fixed step) — this matters once the competing native animation above
    // is out of the way, since frame-rate hitches are the next thing that
    // would otherwise show up as stutter.
    window.scrollBy(0, remaining * (1 - Math.exp(-dt / TAU_MS)));
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const TRUST_ITEMS = ["~5 minutes", "12 readiness checks", "AI scan or manual", "Instant PREPARED score"];

const HOW_STEPS = [
  {
    title: "Answer a few questions, or let AI scan it",
    body: "Walk through the checklist yourself, or point your camera at the AED and let AI read the battery, pads, and cabinet for you.",
  },
  {
    title: "Get your instant PREPARED score",
    body: "The moment you finish, see exactly where the property stands across all eight readiness categories.",
  },
  {
    title: "Walk away with a plan",
    body: "A clear action list, a shareable certificate for trained staff, and one spin of the prize wheel.",
    isGift: true,
  },
];

const WHY_CARDS = [
  {
    title: "Batteries & pads expire quietly",
    body: "Most properties don't realize their AED battery or pads have expired until it's too late to matter. This check flags it in minutes.",
  },
  {
    title: "One score, eight categories",
    body: "Physical condition, expiry status, training, paediatric readiness, documentation and more — rolled into a single PREPARED score.",
  },
  {
    title: "A report you can act on",
    body: "See exactly what's ready, what's ageing, and what needs replacing — plus a shareable certificate for CPR/AED-trained staff.",
  },
];

export default function Landing() {
  const [howRef, howClass] = useReveal();
  const [giftRef, giftClass] = useReveal();
  const [whyRef, whyClass] = useReveal();
  const [closeRef, closeClass] = useReveal();

  return (
    <>
      <header className="landing-header">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark, no next/image needed */}
        <img src="/brand/thinkhealth-logo.png" alt="Think Health" className="landing-header-logo" />
        <div className="landing-header-actions">
          <span className="landing-header-pill">
            <span className="landing-header-pill-dot" aria-hidden="true" />
            <span>Free audit &middot; free gift at the end</span>
          </span>
          <a href="#audit" onClick={scrollToAuditSlowly} className="btn btn-primary landing-header-cta">
            Start free audit
          </a>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-bg" style={{ backgroundImage: "url(/images/hero-hotel-hallway.jpg)" }} aria-hidden="true" />
        <div className="landing-hero-tint" aria-hidden="true" />
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">Think Health &middot; AED Readiness Campaign</span>
            <h1 className="landing-h1">Is your AED ready to save a life right now?</h1>
            <p className="landing-lead">
              A free readiness check for your property&rsquo;s AED — battery, pads, training, and signage —
              scored against the PREPARED standard, with a full report at the end.
            </p>
            <div className="landing-hero-cta-row">
              <a href="#audit" onClick={scrollToAuditSlowly} className="btn btn-primary landing-cta landing-cta-lg">
                Start your free audit
                <ArrowIcon />
              </a>
              <span className="landing-hero-microcopy">
                About 5 minutes.
                <br />
                No cost, no obligation.
              </span>
            </div>
            <div className="landing-hero-chips">
              {TRUST_ITEMS.map((label) => (
                <span className="landing-hero-chip" key={label}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="landing-hero-gift">
            <div className="landing-gift-card">
              <div className="landing-gift-card-head">
                <span className="landing-gift-card-label">Your reward</span>
                <span className="landing-gift-card-meta">1 spin &middot; {PRIZES.length} gifts</span>
              </div>

              <div className="landing-hero-wheel" aria-hidden="true">
                <div className="landing-hero-wheel-pointer" />
                <div className="landing-hero-wheel-ring" />
                <div className="landing-hero-wheel-disc" />
                <div className="landing-hero-wheel-innerline" />
                <div className="landing-hero-wheel-face">
                  <div className="landing-hero-wheel-spin">
                    <div className="landing-hero-wheel-wedges" />
                    {PRIZES.map((p, i) => (
                      <div
                        key={`div-${p.id}`}
                        className="landing-hero-wheel-divider"
                        style={{ transform: `rotate(${i * WHEEL_SEG}deg)` }}
                      />
                    ))}
                    {PRIZES.map((p, i) => {
                      const c = i * WHEEL_SEG + WHEEL_SEG / 2;
                      return (
                        <div key={p.id} className="landing-hero-wheel-slot" style={{ transform: `rotate(${c}deg)` }}>
                          <div
                            className="landing-hero-wheel-tile"
                            style={{ transform: `translate(-50%, -50%) translateY(-76px) rotate(${-c}deg)` }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative tile photo inside a fixed-size non-interactive graphic */}
                            <img src={p.image} alt="" className="landing-hero-wheel-photo" />
                            <span className="landing-hero-wheel-label">{PRIZE_SHORT_LABEL[p.id] || p.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="landing-hero-wheel-hub">
                  <span className="landing-hero-wheel-hub-dot" />
                </div>
              </div>

              <p className="landing-gift-card-tagline">
                Finish the audit,
                <br />
                spin for a free gift
              </p>

              <div className="landing-gift-card-thumbs">
                {PRIZES.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element -- small static thumbnail row, no next/image needed
                  <img key={p.id} src={p.image} alt={p.label} title={p.label} />
                ))}
              </div>

              <div className="landing-gift-card-footer">Every completed audit gets one spin</div>
            </div>
          </div>
        </div>
      </section>

      <div className="landing-brand-bar">
        <div className="landing-brand-bar-inner">
          <span className="landing-brand-label">Built around the brands you operate</span>
          <div className="landing-brand-strip-track">
            {/* The logo row is duplicated back-to-back and the animation
               translates exactly one copy's width (-50%) before looping —
               that's what makes the loop seamless with pure CSS instead of
               needing JS to detect scroll position and jump/reset it. */}
            <div className="landing-brand-strip-logos" aria-hidden="true">
              <div className="landing-brand-strip-group">
                {BRAND_STRIP.map((b) => (
                  // eslint-disable-next-line @next/next/no-img-element -- small static brand mark, no next/image needed
                  <img key={`a-${b.name}`} src={b.logo} alt="" title={b.name} />
                ))}
              </div>
              <div className="landing-brand-strip-group">
                {BRAND_STRIP.map((b) => (
                  // eslint-disable-next-line @next/next/no-img-element -- small static brand mark, no next/image needed
                  <img key={`b-${b.name}`} src={b.logo} alt="" title={b.name} />
                ))}
              </div>
            </div>
          </div>
          <span className="sr-only">{BRAND_STRIP.map((b) => b.name).join(", ")}, and other hotel brands</span>
        </div>
      </div>

      <section className="landing-how" ref={howRef}>
        <div className={`landing-section-inner ${howClass}`}>
          <span className="landing-eyebrow dark">How it works</span>
          <h2 className="landing-h2">Three steps, about five minutes</h2>
          <div className="landing-how-steps">
            {HOW_STEPS.map((s, i) => (
              <div className={`landing-how-step${s.isGift ? " is-gift" : ""}`} key={s.title}>
                {s.isGift && <span className="landing-how-step-flag">Your gift</span>}
                <span className="landing-how-step-badge">{String(i + 1).padStart(2, "0")}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-gift" ref={giftRef}>
        <div className="landing-gift-glow" aria-hidden="true" />
        <div className={`landing-section-inner landing-gift-inner ${giftClass}`}>
          <div className="landing-gift-head">
            <div>
              <span className="landing-eyebrow">Spin to win</span>
              <h2 className="landing-h2">Finish your audit, spin the wheel</h2>
            </div>
            <p>Every completed audit gets one spin — equal odds, no codes, and our team follows up to arrange delivery.</p>
          </div>
          <div className="landing-gift-grid">
            {PRIZES.map((p, i) => (
              <div className="landing-gift-card-tile" key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static prize photo in a plain grid, no next/image needed */}
                <img src={p.image} alt={p.label} />
                <span className="landing-gift-card-tile-num">{String(i + 1).padStart(2, "0")}</span>
                <p>{p.label}</p>
              </div>
            ))}
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
                <span className="landing-card-badge">{String(i + 1).padStart(2, "0")}</span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-close" ref={closeRef}>
        <div className={`landing-close-card ${closeClass}`}>
          <div className="landing-close-copy">
            <h2 className="landing-h2">Ready to see where you stand?</h2>
            <p className="landing-close-sub">
              Answer a few questions or let AI scan your unit — either way, you&rsquo;ll have a PREPARED score and a
              clear action list in about five minutes.
            </p>
            <ul className="landing-close-reassure">
              <li>
                <span className="tick">&#10003;</span> No cost, no obligation
              </li>
              <li>
                <span className="tick">&#10003;</span> Report ready the moment you finish
              </li>
              <li>
                <span className="tick star">&#9733;</span> One spin of the prize wheel when you&rsquo;re done
              </li>
            </ul>
            <a href="#audit" onClick={scrollToAuditSlowly} className="btn btn-primary landing-cta landing-cta-lg">
              Start your free audit
              <ArrowIcon />
            </a>
          </div>

          <div className="landing-voucher">
            <div className="landing-voucher-notch left" aria-hidden="true" />
            <div className="landing-voucher-notch right" aria-hidden="true" />
            <div className="landing-voucher-head">
              <span className="landing-voucher-label">Gift voucher</span>
              <span className="landing-voucher-badge">1 spin</span>
            </div>
            <p className="landing-voucher-title">
              One spin,
              <br />
              one free gift
            </p>
            <div className="landing-voucher-rule" />
            <p className="landing-voucher-fine">Unlocked when your audit is submitted — no code needed.</p>
            <div className="landing-voucher-thumbs">
              {PRIZES.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element -- small static thumbnail row, no next/image needed
                <img key={p.id} src={p.image} alt="" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span>Think Health &middot; AED Readiness Campaign</span>
          <span>Free audit &middot; free gift &middot; about five minutes</span>
        </div>
      </footer>
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
