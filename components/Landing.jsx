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

/* "Takes ~5 minutes" lived here too, directly under a CTA microcopy line
   that already says "Takes about 5 minutes" — the same claim twice, two
   lines apart. Dropped, leaving the three that say something new. */
const TRUST_ITEMS = ["12 quick health checks", "AI photo scanner", "Instant readiness report"];

const HOW_STEPS = [
  {
    title: "Quick answers or instant AI photo scan",
    body: "Walk through the simple checklist on your phone, or snap a photo of your AED to let our smart scanner read the battery and pad dates for you.",
  },
  {
    title: "Get your instant readiness score",
    body: "The moment you finish, see a clean visual dashboard showing what’s in great shape and what needs a quick top-up.",
  },
  {
    title: "Claim your clear action plan & gift",
    body: "Download your customized checklist, issue staff certificates, and spin the wheel for a free maintenance gift.",
    isGift: true,
  },
];

const WHY_CARDS = [
  {
    title: "Batteries & pads expire when you least expect it",
    body: "Gel pads dry out and batteries fade quietly over time. This quick checkup flags expiring items before a real emergency happens.",
  },
  {
    title: "Clear answers across 8 key safety areas",
    body: "From physical cabinet access to team CPR confidence, get a complete 360° view of your property’s emergency readiness.",
  },
  {
    title: "Actionable steps, zero guesswork",
    body: "No complicated jargon. You get plain-language recommendations so your team knows exactly what to do next to keep everyone safe.",
  },
];

export default function Landing() {
  const [howRef, howClass] = useReveal();
  const [giftRef, giftClass] = useReveal();
  const [whyRef, whyClass] = useReveal();
  const [closeRef, closeClass] = useReveal();

  // The hero demo is a real ~85s screen recording, not a short loop — far
  // too long to autoplay silently. It starts on a poster frame with a big
  // play button, exactly like clicking "Watch demo" on any SaaS landing
  // page, and switches to native controls once actually playing so a
  // visitor can pause/seek/rewatch. onEnded resets to the poster/play
  // state (and rewinds) rather than freezing on the last frame, so the
  // card is immediately replayable instead of looking finished-and-dead.
  const demoVideoRef = useRef(null);
  const [demoPlaying, setDemoPlaying] = useState(false);
  function playDemo() {
    const v = demoVideoRef.current;
    if (!v) return;
    if (v.ended) v.currentTime = 0;
    v.play();
  }

  return (
    <>
      <header className="landing-header">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark, no next/image needed */}
        <img src="/brand/thinkhealth-logo.png" alt="Think Health" className="landing-header-logo" />
        <div className="landing-header-actions">
          <span className="landing-header-pill">
            <span className="landing-header-pill-dot" aria-hidden="true" />
            <span>5-minute checkup &middot; Instant safety report &amp; gift</span>
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
            <h1 className="landing-h1">Is your property&rsquo;s AED truly ready to save a life today?</h1>
            <p className="landing-lead">
              An emergency can happen in seconds. Take 5 minutes to check your property’s AED battery, pads, signage, and team training. Get an instant, easy-to-read readiness report to make sure you&rsquo;re always prepared.
            </p>
            <div className="landing-hero-cta-row">
              <a href="#audit" onClick={scrollToAuditSlowly} className="btn btn-primary landing-cta landing-cta-lg">
                Start your free audit
                <ArrowIcon />
              </a>
              <span className="landing-hero-microcopy">
                Takes about 5 minutes.
                <br />
                100% free &middot; no obligation.
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

          <div className="landing-hero-preview">
            <div className="landing-preview-frame">
              <div className="landing-preview-chrome">
                <span className="landing-preview-chrome-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="landing-preview-chrome-label">AED Readiness &mdash; Live Demo</span>
              </div>
              <div className="landing-preview-media">
                <video
                  ref={demoVideoRef}
                  className="landing-preview-video"
                  poster="/videos/aed-demo-cover.jpg"
                  src="/videos/aed-demo.mp4"
                  playsInline
                  controls={demoPlaying}
                  onPlay={() => setDemoPlaying(true)}
                  onPause={() => setDemoPlaying(false)}
                  onEnded={() => setDemoPlaying(false)}
                />
                {!demoPlaying && (
                  <button type="button" className="landing-preview-play" onClick={playDemo} aria-label="Play the AED Readiness demo">
                    <PlayIcon />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="landing-brand-bar">
        <div className="landing-brand-bar-inner">
          <span className="landing-brand-label">Designed for top hospitality &amp; commercial properties</span>
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
          <h2 className="landing-h2">Three simple steps, about five minutes</h2>
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
              <h2 className="landing-h2">Finish your checkup, spin the wheel</h2>
            </div>
            <p>Every completed audit gets one guaranteed spin — equal odds, zero hassle, and our team handles delivery right to your door.</p>
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
          <h2 className="landing-h2">What a quick 5-minute checkup catches</h2>
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
            <h2 className="landing-h2">Ready to ensure your property is 100% safe?</h2>
            <p className="landing-close-sub">
              Answer a few questions or let our AI scan your unit — either way, you&rsquo;ll get an instant readiness dashboard and actionable guidance in about 5 minutes.
            </p>
            <ul className="landing-close-reassure">
              <li>
                <span className="tick">&#10003;</span> 100% free with no obligation
              </li>
              <li>
                <span className="tick">&#10003;</span> Instant readiness dashboard &amp; shareable report
              </li>
              <li>
                <span className="tick star">&#9733;</span> One spin of the prize wheel upon completion
              </li>
            </ul>
            <a href="#audit" onClick={scrollToAuditSlowly} className="btn btn-primary landing-cta landing-cta-lg">
              Start your free audit
              <ArrowIcon />
            </a>
          </div>

          {/* Relocated from the hero — the actual spinning-wheel graphic
              belongs at the moment a visitor is deciding to commit, right
              next to the final CTA, more than it belongs beside the headline
              before they've read anything. Reuses .landing-gift-card as-is
              (the same card the hero used to show) rather than maintaining
              a second parallel "here's your prize" visual language. */}
          <div className="landing-hero-gift">
            <div className="landing-gift-card">
              <div className="landing-gift-card-head">
                <span className="landing-gift-card-label">Your thank-you gift</span>
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
                Finish the checkup,
                <br />
                spin for a free gift
              </p>

              <div className="landing-gift-card-thumbs">
                {PRIZES.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element -- small static thumbnail row, no next/image needed
                  <img key={p.id} src={p.image} alt={p.label} title={p.label} />
                ))}
              </div>

              <div className="landing-gift-card-footer">Every completed checkup earns one spin</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span>Think Health &middot; AED Readiness Campaign</span>
          <span>Free checkup &middot; free maintenance gift &middot; takes ~5 minutes</span>
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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
      <path d="M7 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7l-10.4-6.5A1 1 0 0 0 7 5.5Z" fill="currentColor" />
    </svg>
  );
}
