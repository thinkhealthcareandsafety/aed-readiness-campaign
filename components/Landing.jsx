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
          <a href="#audit" className="btn btn-primary landing-cta">
            Start your free audit
          </a>
          <p className="landing-trust-row">~5 minutes &middot; 12 quick sections &middot; Instant PREPARED score</p>
        </div>
        <a href="#audit" className="landing-scroll-cue" aria-label="Scroll down to start the audit">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 9l8 8 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </section>

      <section className="landing-gift">
        <div className="landing-section-inner landing-gift-inner">
          <div className="landing-gift-media-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element -- static bundled photo, no next/image needed */}
            <img src="/images/hero-hotel-hallway.jpg" alt="" className="landing-gift-media" />
          </div>
          <div className="landing-gift-copy">
            <span className="landing-eyebrow dark">Limited-time offer</span>
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
            </a>
          </div>
        </div>
      </section>

      <section className="landing-why">
        <div className="landing-section-inner">
          <h2 className="landing-h2">Why this matters</h2>
          <div className="landing-card-grid">
            {WHY_CARDS.map((c) => (
              <div className="landing-card" key={c.title}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static decorative icon, no next/image needed */}
                <img src={c.icon} alt="" className="landing-card-icon" />
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
