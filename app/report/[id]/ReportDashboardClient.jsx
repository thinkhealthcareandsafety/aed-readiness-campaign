"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PrintButton from "./PrintButton";
import DeliveryAddressCard from "./DeliveryAddressCard";

const RING_CIRCUMFERENCE = 326.7;
const SCORE_ANIM_MS = 1300;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// The score ring and category bars used to just appear at their final
// value — instant, with nothing marking the moment as a payoff, even
// though this is the one screen the entire audit exists to produce. This
// sweeps the ring and counts the numbers up on mount, then reveals the
// category bars staggered right after, so the score reads as *earned*
// rather than stated. Skips straight to final values for anyone who's
// asked the OS for reduced motion, same convention as the rest of this
// stylesheet (see the prefers-reduced-motion blocks in globals.css).
function useScoreRingAnimation(targetPct, targetPoints) {
  const [progress, setProgress] = useState(0); // drives the two count-up numbers
  const [revealed, setRevealed] = useState(false); // flips once, triggers the ring's own CSS sweep
  const [barsVisible, setBarsVisible] = useState(false); // cascades in only once the ring/count finishes
  const rafRef = useRef(null);

  useEffect(() => {
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      const frame = requestAnimationFrame(() => {
        setProgress(1);
        setRevealed(true);
        setBarsVisible(true);
      });
      return () => cancelAnimationFrame(frame);
    }
    // Flipped on the next frame rather than immediately, so the browser
    // paints the ring at its 0% starting offset first — flipping it in the
    // same tick as mount can get batched into the same paint, leaving the
    // CSS transition with nothing to animate from.
    const revealFrame = requestAnimationFrame(() => setRevealed(true));
    const startedAt = performance.now();
    function tick(now) {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / SCORE_ANIM_MS);
      setProgress(easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setBarsVisible(true);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    displayedPct: Math.round(targetPct * progress),
    displayedPoints: Math.round(targetPoints * progress),
    ringOffset: revealed ? RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * targetPct) / 100 : RING_CIRCUMFERENCE,
    barsVisible,
  };
}

export default function ReportDashboardClient({
  submission,
  scored,
  pct,
  hotelName,
  name,
  hasAED,
  wonPrizeLabel,
  needsDelivery,
  deliverySaved,
  deliveryAddress,
  assessmentDate,
  certificateNumber,
  preparedRows,
  supplementaryRows,
  insightRows,
  criticalCount,
  warnCount,
  goodCount,
  insightSections,
  unitSummaries,
  finalObsText,
}) {
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'critical' | 'warn' | 'good'
  const [activeUnit, setActiveUnit] = useState("all"); // 'all' | 1 | 2 | ... (only offered for a multi-unit property)
  const { displayedPct, displayedPoints, ringOffset, barsVisible } = useScoreRingAnimation(pct, scored.total.points);

  // A "Needs Attention"/"Moderate Readiness" verdict is itself a reading of
  // the PREPARED score — showing one here while the score ring next to it
  // says "No AED installed" (no score generated at all) would contradict
  // itself, so this case gets its own honest label instead of falling
  // through the normal score-based tiers.
  const statusBadge = !hasAED
    ? { label: "No AED Installed", class: "notready", color: "#ef4444", icon: "⚠" }
    : pct >= 85 && criticalCount === 0
    ? { label: "High Readiness", class: "ready", color: "#10b981", icon: "✓" }
    : pct >= 65 && criticalCount === 0
    ? { label: "Moderate Readiness", class: "warn", color: "#f59e0b", icon: "!" }
    : { label: "Needs Attention", class: "notready", color: "#ef4444", icon: "⚠" };

  // Unit filter runs *before* the urgency filter so the urgency tab counts
  // describe the unit you're actually looking at — "Critical (2)" while
  // AED 3 is selected has to mean two problems on AED 3, not two somewhere
  // on the property. Property-wide rows (training, documentation, contacts)
  // belong to no single machine and are deliberately dropped when one unit
  // is picked: the whole point of that tab is answering "what's wrong with
  // this AED", and they're always there on "All units".
  const unitScopedSections = insightSections
    .map((sec) => ({ ...sec, rows: activeUnit === "all" ? sec.rows : sec.rows.filter((r) => r.unit === activeUnit) }))
    .filter((sec) => sec.rows.length > 0);

  // Switching units resets urgency back to "All" — AED 1 having criticals
  // doesn't mean AED 2 does, and leaving a now-empty "Critical" filter
  // active would show a blank list under a tab that no longer renders.
  function selectUnit(unit) {
    setActiveUnit(unit);
    setActiveTab("all");
  }

  const unitScopedRows = unitScopedSections.flatMap((sec) => sec.rows);
  const tabCounts = {
    all: unitScopedRows.length,
    critical: unitScopedRows.filter((r) => r.status === "critical").length,
    warn: unitScopedRows.filter((r) => r.status === "warn").length,
    good: unitScopedRows.filter((r) => r.status === "good").length,
  };

  const filteredInsightSections = unitScopedSections
    .map((sec) => {
      const rows = sec.rows.filter((r) => {
        if (activeTab === "critical") return r.status === "critical";
        if (activeTab === "warn") return r.status === "warn";
        if (activeTab === "good") return r.status === "good";
        return true;
      });
      return { ...sec, rows };
    })
    .filter((sec) => sec.rows.length > 0);

  return (
    <div className="report-dashboard">
      {/* Top Header Actions */}
      <div className="report-top-nav no-print">
        <Link href="/" className="btn btn-ghost btn-sm">
          &larr; Start New Audit
        </Link>
        <div className="report-top-actions">
          <PrintButton />
        </div>
      </div>

      {/* Hero Score & Status Banner */}
      <div className="dashboard-hero-card">
        <div className="hero-left">
          {hasAED ? (
            <div className="hero-score-ring">
              <svg viewBox="0 0 120 120" className="score-ring-svg">
                <circle cx="60" cy="60" r="52" className="ring-bg" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  className="ring-fill"
                  style={{
                    strokeDasharray: RING_CIRCUMFERENCE,
                    strokeDashoffset: ringOffset,
                    stroke: statusBadge.color,
                    transitionDuration: `${SCORE_ANIM_MS}ms`,
                  }}
                />
              </svg>
              <div className="ring-center-content">
                <span className="ring-score-value tabular">{displayedPoints}</span>
                <span className="ring-score-max">of {scored.total.max}</span>
                <span className="ring-score-pct tabular">{displayedPct}%</span>
              </div>
            </div>
          ) : (
            // No AED installed means there's nothing for a PREPARED score to
            // measure readiness against — showing a ring/number here (even a
            // low one) implied a score was generated when it wasn't, which
            // is exactly what the audit-complete screen now tells the
            // responder *won't* happen for this submission (see
            // AuditCompleteCard.jsx). Same footprint as the ring so the hero
            // layout doesn't jump between the two states.
            <div className="hero-score-ring hero-score-empty">
              <span className="hero-score-empty-icon">⛔</span>
              <span className="hero-score-empty-label">No AED installed</span>
            </div>
          )}
        </div>

        <div className="hero-main-info">
          <div className="hero-header-row">
            <span className={`status-pill ${statusBadge.class}`}>
              <span className="pill-icon">{statusBadge.icon}</span>
              {statusBadge.label}
            </span>
            <span className="hero-date-badge">
              Assessed: {assessmentDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>

          <h1 className="hero-property-title">{hotelName || "Property AED Assessment"}</h1>
          <p className="hero-subtitle">
            Submitted by <b>{name || "Responder"}</b> &middot; {submission.email || ""} {submission.phone ? `(${submission.phone})` : ""}
          </p>

          {hasAED && (
            <div className="hero-score-breakdown">
              <div className="chip-score">
                <span className="chip-label">PREPARED Core Score:</span>
                <span className="chip-val tabular">{scored.prepared.points} / {scored.prepared.max}</span>
              </div>
              {scored.supplementary.max > 0 && (
                <div className="chip-score sub">
                  <span className="chip-label">Supplementary Score:</span>
                  <span className="chip-val tabular">{scored.supplementary.points} / {scored.supplementary.max}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Certificate Jump Banner — the certificate itself lives at the
          bottom of a long report, easy to miss on first glance, so this
          gives an immediate, obvious way to it right where the score is. */}
      {scored.qualifiesForCertificate && (
        <a href="#certificate-section" className="certificate-jump-banner no-print">
          <span className="certificate-jump-icon">🎓</span>
          <span className="certificate-jump-text">
            <b>Your Good Samaritan Warrior Certificate is ready.</b> Jump to it below.
          </span>
          <span className="certificate-jump-arrow">↓</span>
        </a>
      )}

      {/* Prize Won Banner */}
      {wonPrizeLabel && !needsDelivery && (
        <div className="prize-callout-card no-print">
          <div className="prize-icon">🎁</div>
          <div className="prize-info">
            <h4>Prize Unlocked: {wonPrizeLabel}</h4>
            <p>Our AED readiness team will follow up directly regarding your subscription setup.</p>
          </div>
        </div>
      )}
      {wonPrizeLabel && needsDelivery && (
        <DeliveryAddressCard
          submissionId={submission.id}
          wonPrizeLabel={wonPrizeLabel}
          initialSaved={deliverySaved}
          initialAddress={deliveryAddress}
          initialName={name}
        />
      )}

      {!hasAED && (
        <div className="callout notready" style={{ marginTop: 20 }}>
          <b>No AED Unit Installed:</b> This property reported 0 active AED units. Procurement and installation of a working AED unit should be the immediate priority to achieve readiness compliance.
        </div>
      )}

      {/* Executive Summary Observation */}
      <div className={`summary-observation-card ${criticalCount > 0 ? "is-critical" : warnCount > 0 ? "is-warn" : "is-good"}`}>
        <div className="obs-header">
          <span className="obs-icon">{criticalCount > 0 ? "🚨" : warnCount > 0 ? "⚠️" : "🎉"}</span>
          <h3>Executive Readiness Summary</h3>
        </div>
        <p>{finalObsText}</p>
      </div>

      {/* Key Metrics Quick Cards */}
      <div className="metrics-summary-grid">
        <div className={`metric-card ${criticalCount > 0 ? "alert-red" : "pass"}`}>
          <div className="metric-icon">🚨</div>
          <div className="metric-body">
            <div className="metric-value tabular">{criticalCount}</div>
            <div className="metric-label">Critical Issues</div>
            <div className="metric-sub">{criticalCount > 0 ? "Requires Immediate Action" : "Zero Critical Issues"}</div>
          </div>
        </div>

        <div className={`metric-card ${warnCount > 0 ? "alert-orange" : "pass"}`}>
          <div className="metric-icon">⚠️</div>
          <div className="metric-body">
            <div className="metric-value tabular">{warnCount}</div>
            <div className="metric-label">Warnings &amp; Review</div>
            <div className="metric-sub">{warnCount > 0 ? "Action Recommended Soon" : "No Warnings"}</div>
          </div>
        </div>

        <div className="metric-card pass">
          <div className="metric-icon">✅</div>
          <div className="metric-body">
            <div className="metric-value tabular">{goodCount}</div>
            <div className="metric-label">Compliant Areas</div>
            <div className="metric-sub">Meeting Standards</div>
          </div>
        </div>

        <div className="metric-card info">
          <div className="metric-icon">🏆</div>
          <div className="metric-body">
            <div className="metric-value tabular">{pct}%</div>
            <div className="metric-label">Readiness Rating</div>
            <div className="metric-sub">Overall Compliance</div>
          </div>
        </div>
      </div>

      {/* Category Performance Visual Breakdown */}
      <section className="dashboard-section">
        <div className="section-header">
          <h2>Category Performance Breakdown</h2>
          <p>Side-by-side comparison across all 8 PREPARED compliance categories</p>
        </div>

        <div className="category-performance-grid">
          {preparedRows.map((s, i) => {
            const ratio = s.max > 0 ? Math.round((s.points / s.max) * 100) : 0;
            const barBg = ratio >= 75 ? "#10b981" : ratio >= 45 ? "#f59e0b" : "#ef4444";
            return (
              <div className="cat-card" key={s.id}>
                <div className="cat-card-header">
                  <span className="cat-letter-badge">{s.letter || "•"}</span>
                  <span className="cat-title">{s.title}</span>
                  <span className="cat-score-pill tabular" style={{ borderColor: barBg, color: barBg }}>
                    {s.points}/{s.max} pts
                  </span>
                </div>

                <div className="cat-progress-wrap">
                  <div className="cat-progress-bar">
                    <div
                      className="cat-progress-fill"
                      style={{ width: barsVisible ? `${ratio}%` : "0%", background: barBg, transitionDelay: `${i * 70}ms` }}
                    />
                  </div>
                  <span className="cat-pct-label tabular">{ratio}%</span>
                </div>
              </div>
            );
          })}
        </div>

        {supplementaryRows.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3 className="subsection-title">Supplementary Sections</h3>
            <div className="category-performance-grid">
              {supplementaryRows.map((s, i) => {
                const ratio = s.max > 0 ? Math.round((s.points / s.max) * 100) : 0;
                const barBg = ratio >= 75 ? "#10b981" : ratio >= 45 ? "#f59e0b" : "#ef4444";
                return (
                  <div className="cat-card" key={s.id}>
                    <div className="cat-card-header">
                      <span className="cat-title">{s.title}</span>
                      <span className="cat-score-pill tabular" style={{ borderColor: barBg, color: barBg }}>
                        {s.points}/{s.max} pts
                      </span>
                    </div>

                    <div className="cat-progress-wrap">
                      <div className="cat-progress-bar">
                        <div
                          className="cat-progress-fill"
                          style={{ width: barsVisible ? `${ratio}%` : "0%", background: barBg, transitionDelay: `${i * 70}ms` }}
                        />
                      </div>
                      <span className="cat-pct-label tabular">{ratio}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Priority Action Items: Urgent / Warning / Compliant Callouts */}
      <section className="dashboard-section">
        <div className="section-header">
          <h2>Actionable Recommendations &amp; Audit Trail</h2>
          <p>
            {unitSummaries.length > 1
              ? "Pick a specific AED to see only that unit's findings, then filter by urgency"
              : "Filtered by urgency so critical fixes come first"}
          </p>
        </div>

        {/* Per-unit tabs — only earn their place on a multi-AED property.
            With one unit every row belongs to it anyway, so a lone "AED 1"
            tab would be a control that can't change anything. */}
        {unitSummaries.length > 1 && (
          <div className="unit-tabs-row no-print">
            <button
              type="button"
              className={`unit-tab ${activeUnit === "all" ? "active" : ""}`}
              onClick={() => selectUnit("all")}
            >
              <span className="unit-tab-name">All units</span>
              <span className="unit-tab-meta">{unitSummaries.length} AEDs</span>
            </button>
            {unitSummaries.map((u) => {
              const unitRows = insightRows.filter((r) => r.unit === u.unit);
              const unitCritical = unitRows.filter((r) => r.status === "critical").length;
              return (
                <button
                  key={u.unit}
                  type="button"
                  className={`unit-tab ${activeUnit === u.unit ? "active" : ""} ${unitCritical > 0 ? "has-critical" : ""}`}
                  onClick={() => selectUnit(u.unit)}
                >
                  <span className="unit-tab-name">
                    AED {u.unit}
                    {unitCritical > 0 && <span className="unit-tab-badge">{unitCritical}</span>}
                  </span>
                  <span className="unit-tab-meta">
                    {[u.modelLabel, u.serial ? `SN ${u.serial}` : null].filter(Boolean).join(" · ") || "No model/serial recorded"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="filter-tabs-row no-print">
          <button
            type="button"
            className={`filter-tab ${activeTab === "all" ? "active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All Items ({tabCounts.all})
          </button>
          {tabCounts.critical > 0 && (
            <button
              type="button"
              className={`filter-tab critical ${activeTab === "critical" ? "active" : ""}`}
              onClick={() => setActiveTab("critical")}
            >
              🚨 Critical Action Required ({tabCounts.critical})
            </button>
          )}
          {tabCounts.warn > 0 && (
            <button
              type="button"
              className={`filter-tab warn ${activeTab === "warn" ? "active" : ""}`}
              onClick={() => setActiveTab("warn")}
            >
              ⚠️ Warnings / Review ({tabCounts.warn})
            </button>
          )}
          {tabCounts.good > 0 && (
            <button
              type="button"
              className={`filter-tab good ${activeTab === "good" ? "active" : ""}`}
              onClick={() => setActiveTab("good")}
            >
              ✅ Working Well ({tabCounts.good})
            </button>
          )}
        </div>

        {/* Filtered Section Cards */}
        <div className="audit-insights-list">
          {filteredInsightSections.map((sec) => (
            <div className="insight-section-block" key={sec.title}>
              <div className="insight-section-badge">
                <span className="sec-letter">{sec.letter}</span>
                <span className="sec-title">{sec.title}</span>
              </div>

              <div className="insight-rows-stack">
                {sec.rows.map((row) => (
                  <div className={`action-insight-card status-${row.status}`} key={row.id}>
                    <div className="action-card-header">
                      <div className="action-card-title-group">
                        <span className="action-status-icon">
                          {row.status === "critical" ? "🚨" : row.status === "warn" ? "⚠️" : row.status === "good" ? "✅" : "ℹ️"}
                        </span>
                        <h4 className="action-card-label">{row.label}</h4>
                      </div>

                      <span className={`action-status-pill ${row.status}`}>
                        {row.status === "critical"
                          ? "Critical Action Required"
                          : row.status === "warn"
                          ? "Review Recommended"
                          : row.status === "good"
                          ? "Compliant"
                          : "Info"}
                      </span>
                    </div>

                    <div className="action-card-answer">
                      <span className="ans-label">Current Answer:</span> <b>{row.answerText}</b>
                    </div>

                    <div className="action-card-rec">
                      <span className="rec-label">Why It Matters &amp; Action Required:</span>
                      <p>{row.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Good Samaritan Warrior Certificate Section */}
      {scored.qualifiesForCertificate ? (
        <section id="certificate-section" className="dashboard-section certificate-section">
          <div className="section-header">
            <h2>Your Good Samaritan Warrior Certificate</h2>
            <p>Issued {assessmentDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} &middot; Certificate No: {certificateNumber}</p>
          </div>
          {/* Same URL backs the preview and the download — the image is
             generated from the submission itself, so what's on screen is
             exactly what saves. eslint-disable: this is a generated PNG from
             our own API route, not a static asset next/image can optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/certificate/${submission.id}`}
            alt={`Good Samaritan Warrior certificate for ${name || "awardee"}`}
            className="certificate-image"
          />
          <div className="certificate-actions no-print">
            <a className="btn btn-primary" href={`/api/certificate/${submission.id}?download=1`} download>
              Download certificate
            </a>
          </div>
        </section>
      ) : (
        <div className="callout structure" style={{ marginTop: 32 }}>
          <b>Certificate Locked:</b> The Good Samaritan Warrior certificate is awarded once CPR and AED training responses are recorded as completed. Complete that training and resubmit to unlock your official readiness certificate.
        </div>
      )}

      {/* Property & Respondent Information Table */}
      <section className="dashboard-section" style={{ marginTop: 36 }}>
        <div className="section-header">
          <h2>Property &amp; Assessment Information</h2>
        </div>
        <div className="property-info-card">
          <div className="info-row">
            <span className="info-key">Property Name</span>
            <span className="info-val">{hotelName || "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-key">Contact Name</span>
            <span className="info-val">{name || "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-key">Email Address</span>
            <span className="info-val">{submission.email || "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-key">Phone Number</span>
            <span className="info-val">{submission.phone || "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-key">Assessment Date</span>
            <span className="info-val">{assessmentDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
          <div className="info-row">
            <span className="info-key">Total Overall Score</span>
            <span className="info-val tabular">{scored.total.points} / {scored.total.max} ({pct}%)</span>
          </div>
        </div>
      </section>

      {/* Report Conclusion Footer */}
      <div className="report-conclusion">
        <p>
          Your participation in the Think Health AED Readiness Campaign demonstrates your commitment toward emergency preparedness and guest safety. Regular AED inspections, timely maintenance, responder training, and readiness monitoring are essential for effective emergency response.
        </p>
        <p>We strongly recommend periodic reassessment and refresher training to maintain a high level of readiness.</p>
        <p>Thank you for supporting a safer property.</p>
        <p style={{ marginTop: 12 }}>
          Regards,
          <br />
          <b>Think Health Campaign Team</b>
        </p>
      </div>
    </div>
  );
}
