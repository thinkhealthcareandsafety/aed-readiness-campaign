"use client";

import { useEffect, useRef, useState } from "react";

// IntersectionObserver-driven scroll reveal: a section starts slightly
// lowered and faded, then settles into place the first time it crosses into
// view. `threshold` is low (0.12) so long sections (e.g. the gift grid)
// don't wait for their whole bulk to clear the viewport before animating.
function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

  return { ref, className: `reveal${visible ? " reveal-in" : ""}` };
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
  const trustReveal = useReveal();
  const giftReveal = useReveal();
  const whyReveal = useReveal();
  const closeReveal = useReveal();

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

      <div className="landing-trust-bar" ref={trustReveal.ref}>
        <div className={`landing-trust-bar-inner ${trustReveal.className}`}>
          {TRUST_ITEMS.map(({ icon: Icon, label }) => (
            <div className="landing-trust-item" key={label}>
              <Icon />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="landing-gift" ref={giftReveal.ref}>
        <div className={`landing-section-inner landing-gift-inner ${giftReveal.className}`}>
          <div className="landing-gift-media-wrap landing-gift-media-wrap-portrait">
            <video className="landing-gift-media" autoPlay muted loop playsInline preload="auto">
              <source src="/videos/aed-kit-gift-reveal.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="landing-gift-copy">
            <span className="landing-ribbon">Limited-time offer</span>
            <h2 className="landing-h2 left">Complete your audit, claim your free AED kit</h2>
            <p>
              Every property that finishes the readiness check qualifies for a free welcome kit — while stock
              lasts.
            </p>
            <ul className="landing-gift-list">
              <li>
                <span className="check">&#10003;</span> Replacement electrode pads
              </li>
              <li>
                <span className="check">&#10003;</span> AED battery pack
              </li>
              <li>
                <span className="check">&#10003;</span> Folding rescue stretcher
              </li>
              <li>
                <span className="check">&#10003;</span> First-aid kit
              </li>
            </ul>
            <a href="#audit" className="btn btn-primary landing-cta">
              Start your free audit
              <ArrowIcon />
            </a>
          </div>
        </div>
      </section>

      <section className="landing-why" ref={whyReveal.ref}>
        <div className={`landing-section-inner ${whyReveal.className}`}>
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

      <section className="landing-close" ref={closeReveal.ref}>
        <div className={`landing-section-inner ${closeReveal.className}`}>
          <h2 className="landing-h2">Ready to see where you stand?</h2>
          <p className="landing-close-sub">
            Answer a few questions or let AI scan your unit — either way, you&rsquo;ll have a PREPARED score and a
            clear action list in about five minutes.
          </p>
          <a href="#audit" className="btn btn-primary landing-cta landing-cta-lg">
            Start your free audit
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
