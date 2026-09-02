import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminAuthed } from "@/lib/adminAuth";
import { listSubmissionsFull, getFormSchema } from "@/lib/db";
import { aggregateSubmissions } from "@/lib/genericScoring";
import { barColor } from "@/lib/scoreColor";
import { prizeLabel, prizeRequiresDelivery } from "@/lib/prizes";
import ScoreTrendChart from "@/components/ScoreTrendChart";
import LogoutButton from "./LogoutButton";
import DeleteSubmissionButton from "./DeleteSubmissionButton";

export const dynamic = "force-dynamic";

const WEAKEST_COUNT = 8;
const LEADERBOARD_COUNT = 10;

export default async function AdminPage() {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/admin/login");

  const schema = getFormSchema();
  const submissions = listSubmissionsFull();
  const agg = aggregateSubmissions(schema, submissions);
  const rows = submissions; // already has everything the table needs

  return (
    <div className="admin-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.6rem" }}>Dashboard</h1>
          <p style={{ color: "var(--ink-soft)", fontSize: ".9rem" }}>{rows.length} audit{rows.length === 1 ? "" : "s"} received</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/admin/builder" className="btn btn-ghost">Edit form &rarr;</Link>
          <LogoutButton />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-note" style={{ marginTop: 24 }}>
          No submissions yet — analytics will appear here once audits start coming in.
        </div>
      ) : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-label">Audits received</div>
              <div className="stat-value tabular">{agg.overview.count}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Avg PREPARED score</div>
              <div className="stat-value tabular" style={{ color: barColor(agg.overview.avgPreparedPct) }}>
                {agg.overview.avgPreparedPct}%
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">AED installed</div>
              <div className="stat-value tabular">{agg.overview.aedInstalledPct}%</div>
              <div className="stat-sub">{agg.overview.aedInstalledCount} of {agg.overview.count} properties</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Certificate rate</div>
              <div className="stat-value tabular">{agg.overview.certificateRate}%</div>
              <div className="stat-sub">{agg.overview.certificateCount} Good Samaritan Warriors</div>
            </div>
          </div>

          <div className="dash-grid">
            <div className="dash-card">
              <h3>PREPARED section performance</h3>
              <p className="dash-card-note">Average score per section, across every property audited.</p>
              <div className="weak-list">
                {agg.sectionAverages.map((s) => (
                  <div className="weak-item" key={s.title}>
                    <div className="row">
                      <span className="name">{s.title}</span>
                      <span className="val tabular">{s.avgPct}%</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${s.avgPct}%`, background: barColor(s.avgPct) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dash-card">
              <h3>Where properties struggle most</h3>
              <p className="dash-card-note">The {WEAKEST_COUNT} lowest-scoring checks, company-wide — the most actionable list here.</p>
              <div className="weak-list">
                {agg.weakestQuestions.slice(0, WEAKEST_COUNT).map((q) => (
                  <div className="weak-item" key={q.label}>
                    <div className="row">
                      <span className="name">{q.label}</span>
                      <span className="meta">{q.sectionTitle}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${q.avgPct}%`, background: barColor(q.avgPct) }} />
                    </div>
                    <div className="row" style={{ marginTop: 4, marginBottom: 0 }}>
                      <span className="val tabular">{q.avgPct}% avg</span>
                      <span className="meta">{q.responses} response{q.responses === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dash-grid" style={{ gridTemplateColumns: agg.scoreTrend.length >= 2 ? "1.3fr 1fr" : "1fr" }}>
            {agg.scoreTrend.length >= 2 && (
              <div className="dash-card">
                <h3>Average score over time</h3>
                <p className="dash-card-note">PREPARED score, averaged across audits submitted on each day.</p>
                <ScoreTrendChart data={agg.scoreTrend} />
              </div>
            )}

            <div className="dash-card">
              <h3>Hotel leaderboard</h3>
              <p className="dash-card-note">Ranked by average PREPARED score.</p>
              <div className="admin-table-wrap" style={{ marginTop: 0, border: "none" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Hotel</th>
                      <th>Audits</th>
                      <th>Avg PREPARED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agg.hotelLeaderboard.slice(0, LEADERBOARD_COUNT).map((h) => (
                      <tr key={h.hotel}>
                        <td style={{ whiteSpace: "normal" }}>{h.hotel}</td>
                        <td className="tabular">{h.count}</td>
                        <td className="tabular" style={{ color: barColor(h.avgPreparedPct), fontWeight: 700 }}>
                          {h.avgPreparedPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {agg.hotelLeaderboard.length > LEADERBOARD_COUNT && (
                <p className="dash-card-note" style={{ marginTop: 10, marginBottom: 0 }}>
                  +{agg.hotelLeaderboard.length - LEADERBOARD_COUNT} more properties — see full list below.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <h2 style={{ fontSize: "1.15rem", marginTop: 36, marginBottom: 4 }}>Submissions</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Hotel</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Has AED</th>
              <th>PREPARED</th>
              <th>Total</th>
              <th>Prize</th>
              <th>Delivery</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = prizeLabel(r.prize);
              const shipped = prizeRequiresDelivery(r.prize);
              return (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.hotel}</td>
                  <td>
                    {r.first_name} {r.last_name}
                  </td>
                  <td>{r.email}</td>
                  <td>{r.phone}</td>
                  <td>{r.has_aed === "yes" ? "Yes" : "No"}</td>
                  <td className="tabular">
                    {r.prepared_points}/{r.prepared_max}
                  </td>
                  <td className="tabular">
                    {r.total_points}/{r.total_max}
                  </td>
                  <td>{label || "—"}</td>
                  <td>
                    {!shipped ? (
                      "—"
                    ) : r.delivery_submitted_at ? (
                      <span
                        className="status-pill ready"
                        title={`${r.delivery_address1}${r.delivery_address2 ? ", " + r.delivery_address2 : ""}, ${r.delivery_city}, ${r.delivery_state} ${r.delivery_postal_code}, ${r.delivery_country}${r.delivery_notes ? " — " + r.delivery_notes : ""}`}
                      >
                        Address received
                      </span>
                    ) : (
                      <span className="status-pill notready">Awaiting address</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/report/${r.id}`}>View report &rarr;</Link>
                  </td>
                  <td>
                    <DeleteSubmissionButton id={r.id} label={`${r.first_name} ${r.last_name}`.trim() || r.hotel} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "28px 12px" }}>
                  No submissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
