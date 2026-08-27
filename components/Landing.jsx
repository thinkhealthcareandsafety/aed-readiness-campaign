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

const TRUST_ITEMS = [
  { icon: ClockIcon, label: "~5 minutes" },
  { icon: ChecklistIcon, label: "12 readiness checks" },
  { icon: ScanIcon, label: "AI scan or manual" },
  { icon: ScoreIcon, label: "Instant PREPARED score" },
];

const HOW_STEPS = [
  {
    icon: ScanIcon,
    title: "Answer a few questions, or let AI scan it",
    body: "Walk through the checklist yourself, or point your camera at the AED and let AI read the battery, pads, and cabinet for you.",
  },
  {
    icon: ScoreIcon,
    title: "Get your instant PREPARED score",
    body: "The moment you finish, see exactly where the property stands across all eight readiness categories.",
  },
  {
    icon: ReportIcon,
    title: "Walk away with a plan",
    body: "A clear action list, a shareable certificate for trained staff, and one spin of the prize wheel.",
  },
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
  const [howRef, howClass] = useReveal();
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
        {/* The stock clip has a small AI-generator watermark baked into its
           bottom-right corner (a light sparkle glyph) — it's in the source
           pixels, not something CSS can select, so it's covered with a
           patch matching the overlay's own dark corner color instead of
           re-exporting/re-cropping the video. */}
        <div className="landing-hero-watermark-patch" aria-hidden="true" />
        <div className="landing-hero-inner">
          <span className="landing-eyebrow">Think Health &middot; AED Readiness Campaign</span>
          <h1 className="landing-h1">Is your AED ready to save a life right now?</h1>
          <p className="landing-lead">
            A free readiness check for your property&rsquo;s AED — battery, pads, training, and signage —
            scored against the PREPARED standard, with a full report at the end.
          </p>
          <a href="#audit" onClick={scrollToAuditSlowly} className="btn btn-primary landing-cta landing-cta-lg">
            Start your free audit
            <ArrowIcon />
          </a>
        </div>
        <a href="#audit" onClick={scrollToAuditSlowly} className="landing-scroll-cue" aria-label="Scroll down to start the audit">
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

      <section className="landing-how" ref={howRef}>
        <div className={`landing-section-inner ${howClass}`}>
          <span className="landing-eyebrow dark">How it works</span>
          <h2 className="landing-h2">Three steps, about five minutes</h2>
          <div className="landing-how-steps">
            {HOW_STEPS.map((s, i) => (
              <div className="landing-how-step" key={s.title}>
                <div className="landing-how-step-badge">
                  <s.icon />
                  <span className="landing-how-step-num">{i + 1}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {i < HOW_STEPS.length - 1 && <span className="landing-how-connector" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-gift" ref={giftRef}>
        <div className={`landing-section-inner landing-gift-inner ${giftClass}`}>
          <div className="landing-gift-media-wrap landing-gift-media-wrap-portrait">
            <video className="landing-gift-media" autoPlay muted loop playsInline preload="auto">
              <source src="/videos/aed-kit-gift-reveal.mp4" type="video/mp4" />
            </video>
            {/* Same baked-in AI-generator watermark as the hero clip, same
               fix — a patch matching this clip's own light background tone
               instead of the hero's dark one. */}
            <div className="landing-gift-watermark-patch" aria-hidden="true" />
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

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 3.5h7.5L19 8v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.2 3.5V8h4.6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 13.5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
