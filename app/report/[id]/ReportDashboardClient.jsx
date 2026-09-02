"use client";

import { useState } from "react";
import Link from "next/link";
import PrintButton from "./PrintButton";
import DeliveryAddressCard from "./DeliveryAddressCard";

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
  preparedRows,
  supplementaryRows,
  insightRows,
  criticalCount,
  warnCount,
  goodCount,
  insightSections,
  finalObsText,
}) {
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'critical' | 'warn' | 'good'

  const statusBadge =
    pct >= 85 && criticalCount === 0
      ? { label: "High Readiness", class: "ready", color: "#10b981", icon: "✓" }
      : pct >= 65 && criticalCount === 0
      ? { label: "Moderate Readiness", class: "warn", color: "#f59e0b", icon: "!" }
      : { label: "Needs Attention", class: "notready", color: "#ef4444", icon: "⚠" };

  const filteredInsightSections = insightSections
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
          <div className="hero-score-ring">
            <svg viewBox="0 0 120 120" className="score-ring-svg">
              <circle cx="60" cy="60" r="52" className="ring-bg" />
              <circle
                cx="60"
                cy="60"
                r="52"
                className="ring-fill"
                style={{
                  strokeDasharray: 326.7,
                  strokeDashoffset: 326.7 - (326.7 * pct) / 100,
                  stroke: statusBadge.color,
                }}
              />
            </svg>
            <div className="ring-center-content">
              <span className="ring-score-value tabular">{scored.total.points}</span>
              <span className="ring-score-max">of {scored.total.max}</span>
              <span className="ring-score-pct tabular">{pct}%</span>
            </div>
          </div>
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
        </div>
      </div>

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
          {preparedRows.map((s) => {
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
                    <div className="cat-progress-fill" style={{ width: `${ratio}%`, background: barBg }} />
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
              {supplementaryRows.map((s) => {
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
                        <div className="cat-progress-fill" style={{ width: `${ratio}%`, background: barBg }} />
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
          <p>Filtered by urgency so critical fixes come first</p>
        </div>

        {/* Filter Tabs */}
        <div className="filter-tabs-row no-print">
          <button
            type="button"
            className={`filter-tab ${activeTab === "all" ? "active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All Items ({insightRows.length})
          </button>
          {criticalCount > 0 && (
            <button
              type="button"
              className={`filter-tab critical ${activeTab === "critical" ? "active" : ""}`}
              onClick={() => setActiveTab("critical")}
            >
              🚨 Critical Action Required ({criticalCount})
            </button>
          )}
          {warnCount > 0 && (
            <button
              type="button"
              className={`filter-tab warn ${activeTab === "warn" ? "active" : ""}`}
              onClick={() => setActiveTab("warn")}
            >
              ⚠️ Warnings / Review ({warnCount})
            </button>
          )}
          {goodCount > 0 && (
            <button
              type="button"
              className={`filter-tab good ${activeTab === "good" ? "active" : ""}`}
              onClick={() => setActiveTab("good")}
            >
              ✅ Working Well ({goodCount})
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
        <div className="certificate-wrapper">
          <div className="certificate">
            <div className="cert-eyebrow">Think Health &middot; AED Readiness Campaign</div>
            <h2>Good Samaritan Warrior</h2>
            <div className="cert-awardee-name">{name || "Awardee"}</div>
            <p className="cert-desc">
              has demonstrated CPR and AED operating readiness in support of <b>{hotelName || "their property"}</b>&rsquo;s
              emergency response capability.
            </p>
            <div className="cert-meta-row">
              <span>Issued: {assessmentDate.toLocaleDateString()}</span>
              <span>Verification Code: {submission.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>
        </div>
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
