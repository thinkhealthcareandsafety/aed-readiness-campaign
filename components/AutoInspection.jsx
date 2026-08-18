"use client";

import { useRef, useState } from "react";
import { CHECKLIST_ITEMS } from "@/lib/inspectionChecklist";

const ITEM_ICON = {
  battery_attached: "/icons/battery-ok.svg",
  pads_connected: "/icons/pads-sealed.svg",
  aed_cabinet_ok: "/icons/cabinet-ok.svg",
  readiness_indicator: "/icons/status-ready.svg",
};

const VIDEO_FRAME_COUNT = 12;

// Extracts VIDEO_FRAME_COUNT JPEG frames, evenly spaced across the clip's
// duration, from a recorded video File — the browser-side replacement for
// the ported service's server-side OpenCV frame extraction (see
// lib/inspectionGemini.js). Avoids adding a native/binary dependency to a
// Next.js API route.
async function extractFrames(videoFile) {
  const url = URL.createObjectURL(videoFile);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("Could not read video"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");

    const duration = video.duration || 0;
    const frames = [];
    for (let i = 0; i < VIDEO_FRAME_COUNT; i++) {
      const t = (duration * (i + 0.5)) / VIDEO_FRAME_COUNT;
      await new Promise((resolve, reject) => {
        video.onseeked = resolve;
        video.onerror = () => reject(new Error("Could not read video"));
        video.currentTime = t;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (blob) frames.push(blob);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadItem(itemId, blobs) {
  const form = new FormData();
  form.append("itemId", itemId);
  blobs.forEach((blob, i) => form.append("file", blob, `${itemId}_${i}.jpg`));
  const res = await fetch("/api/inspection/analyze", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "AI analysis failed");
  return data;
}

export default function AutoInspection({ onComplete, onCancel }) {
  const [results, setResults] = useState({});
  const doneCount = CHECKLIST_ITEMS.filter((i) => ["pass", "fail"].includes(results[i.id]?.status)).length;
  const allDone = doneCount === CHECKLIST_ITEMS.length;
  const pct = Math.round((doneCount / CHECKLIST_ITEMS.length) * 100);

  function setStatus(itemId, patch) {
    setResults((r) => ({ ...r, [itemId]: { ...r[itemId], ...patch } }));
  }

  async function handleCapture(item, file) {
    setStatus(item.id, { status: "analyzing" });
    try {
      const blobs = item.mediaType === "video" ? await extractFrames(file) : [file];
      if (!blobs.length) throw new Error("Could not read that clip — please try again.");
      const data = await uploadItem(item.id, blobs);
      // data.status is Gemini's own field (ready/fault/unclear — only
      // meaningful for the readiness-indicator item), separate from this
      // card's pending/analyzing/pass/fail/error status below. Rename it on
      // the way in so the spread can't silently clobber ours with null.
      const { status: readinessStatus, ...rest } = data;
      setStatus(item.id, { ...rest, readinessStatus, status: data.passed ? "pass" : "fail" });
    } catch (err) {
      setStatus(item.id, { status: "error", notes: err instanceof Error ? err.message : "Analysis failed" });
    }
  }

  return (
    <div className="inspect">
      <div className="inspect-progress">
        <div className="inspect-progress-row">
          <span>Items scanned</span>
          <span className="tabular">
            {doneCount}/{CHECKLIST_ITEMS.length}
          </span>
        </div>
        <div className="inspect-progress-track">
          <div className="inspect-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="inspect-grid">
        {CHECKLIST_ITEMS.map((item) => (
          <InspectItemCard key={item.id} item={item} result={results[item.id]} onCapture={handleCapture} />
        ))}
      </div>

      <div className="inspect-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Back to manual
        </button>
        <button type="button" className="btn btn-primary" disabled={!allDone} onClick={() => onComplete(results)}>
          {allDone ? "Use these results" : `Scan ${CHECKLIST_ITEMS.length - doneCount} more item(s)`}
        </button>
      </div>
    </div>
  );
}

function InspectItemCard({ item, result, onCapture }) {
  const inputRef = useRef(null);
  const status = result?.status || "pending";
  const busy = status === "analyzing";
  const icon = ITEM_ICON[item.id];

  return (
    <div className={`inspect-card inspect-card-${status}`}>
      <div className="inspect-card-head">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- static bundled icon
          <img src={icon} alt="" className="inspect-card-icon" />
        ) : (
          <CameraGlyph video={item.mediaType === "video"} />
        )}
        <div className="inspect-card-title">
          <div className="inspect-card-name">{item.title}</div>
          <div className="inspect-card-desc">{item.description}</div>
        </div>
        <StatusGlyph status={status} />
      </div>

      {result?.mediaUrl && (
        <div className="inspect-card-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element -- captured photo/frame, not a build-time asset */}
          <img src={result.mediaUrl} alt="" />
        </div>
      )}

      {result?.notes && (status === "pass" || status === "fail" || status === "error") && (
        <p className={`inspect-card-notes ${status === "pass" ? "ok" : "bad"}`}>
          {result.notes}
          {typeof result.confidence === "number" && (
            <span className="inspect-card-conf"> · {Math.round(result.confidence * 100)}% confidence</span>
          )}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={item.mediaType === "video" ? "video/*" : "image/*"}
        capture="environment"
        className="inspect-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onCapture(item, file);
        }}
      />
      <button type="button" className="btn btn-ghost inspect-card-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Analysing…" : status === "pending" ? (item.mediaType === "video" ? "Record video" : "Capture photo") : "Retake"}
      </button>
    </div>
  );
}

function CameraGlyph({ video }) {
  return (
    <svg className="inspect-card-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {video ? (
        <path d="M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm12 4 4-2v8l-4-2v-4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      ) : (
        <>
          <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        </>
      )}
    </svg>
  );
}

function StatusGlyph({ status }) {
  if (status === "pass") return <span className="inspect-status-glyph ok">✓</span>;
  if (status === "fail" || status === "error") return <span className="inspect-status-glyph bad">!</span>;
  if (status === "analyzing") return <span className="inspect-status-glyph spin" aria-hidden />;
  return null;
}
