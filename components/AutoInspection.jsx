"use client";

import { useRef, useState } from "react";
import { CHECKLIST_ITEMS, fieldRoleFor } from "@/lib/inspectionChecklist";
import LiveCamera from "@/components/LiveCamera";

const ITEM_ICON = {
  battery_attached: "/icons/battery-ok.svg",
  pads_connected: "/icons/pads-sealed.svg",
  aed_cabinet_ok: "/icons/cabinet-ok.svg",
  readiness_indicator: "/icons/status-ready.svg",
};

const VIDEO_FRAME_COUNT = 12;
// A phone camera photo easily runs 8-12MP (several MB); Gemini only needs
// enough resolution to read a printed label, and every extra megabyte is
// slower to upload on hotel wifi, slower for Gemini to process, and more
// likely to brush up against the request timeout — all three of which get
// worse exactly when many people are auto-scanning at once, not better.
const MAX_IMAGE_EDGE = 1600;

function constrainedSize(width, height, maxEdge) {
  if (width <= maxEdge && height <= maxEdge) return [width, height];
  const scale = maxEdge / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)];
}

async function downscaleImage(file, maxEdge = MAX_IMAGE_EDGE, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not read that photo"));
    });
    const [w, h] = constrainedSize(img.naturalWidth, img.naturalHeight, maxEdge);
    if (w === img.naturalWidth && h === img.naturalHeight && file.size < 1.5 * 1024 * 1024) {
      return file; // already small enough — skip the re-encode
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob || file; // fall back to the original rather than block the capture
  } catch {
    return file; // downscaling is an optimization, not a requirement — never let it block a capture
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Extracts VIDEO_FRAME_COUNT JPEG frames, evenly spaced across the clip's
// duration, from a recorded video File/Blob — works the same whether that
// blob came from the OS file picker or from LiveCamera's own MediaRecorder
// capture, since both are just video files at this point.
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

    const [canvasW, canvasH] = constrainedSize(video.videoWidth, video.videoHeight, MAX_IMAGE_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
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

// This component only ever mounts after a client-side interaction (see
// autoScanActive in AuditWizard.jsx), never during the server-rendered
// initial HTML — but guarding the `navigator` reference costs nothing and
// avoids a ReferenceError if that ever stops being true.
function hasCamera() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

async function uploadItem(itemId, aedModel, blobs) {
  const form = new FormData();
  form.append("itemId", itemId);
  if (aedModel) form.append("aedModel", aedModel);
  blobs.forEach((blob, i) => form.append("file", blob, `${itemId}_${i}.jpg`));
  const res = await fetch("/api/inspection/analyze", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "AI analysis failed");
  return data;
}

// One task = one concept (CHECKLIST_ITEMS entry) for one physical unit.
// resultKey is also the exact fieldRole the answer gets written back onto
// (see fieldRoleFor in lib/inspectionChecklist.js and
// handleAutoInspectionComplete in components/AuditWizard.jsx) — using the
// same string for both means no separate mapping table to keep in sync.
function buildTasks(unitCount, modelSequence) {
  const tasks = [];
  for (let unit = 1; unit <= Math.max(1, unitCount); unit++) {
    for (const item of CHECKLIST_ITEMS) {
      tasks.push({ unit, model: modelSequence[unit - 1] || null, item, resultKey: fieldRoleFor(item.id, unit) });
    }
  }
  return tasks;
}

export default function AutoInspection({ unitCount, modelSequence, modelLabelMap, onComplete, onCancel }) {
  const [results, setResults] = useState({});
  const tasks = buildTasks(unitCount || 1, modelSequence || []);
  const doneCount = tasks.filter((t) => ["pass", "fail"].includes(results[t.resultKey]?.status)).length;
  const allDone = doneCount === tasks.length;
  const pct = Math.round((doneCount / tasks.length) * 100);

  function setStatus(resultKey, patch) {
    setResults((r) => ({ ...r, [resultKey]: { ...r[resultKey], ...patch } }));
  }

  async function handleCapture(task, file) {
    setStatus(task.resultKey, { status: "analyzing" });
    try {
      const blobs = task.item.mediaType === "video" ? await extractFrames(file) : [await downscaleImage(file)];
      if (!blobs.length) throw new Error("Could not read that clip — please try again.");
      const data = await uploadItem(task.item.id, task.model, blobs);
      // data.status is Gemini's own field (ready/fault/unclear — only
      // meaningful for the readiness-indicator item), separate from this
      // card's pending/analyzing/pass/fail/error status below. Rename it on
      // the way in so the spread can't silently clobber ours with null.
      const { status: readinessStatus, ...rest } = data;
      setStatus(task.resultKey, { ...rest, readinessStatus, status: data.passed ? "pass" : "fail" });
    } catch (err) {
      setStatus(task.resultKey, { status: "error", notes: err instanceof Error ? err.message : "Analysis failed" });
    }
  }

  const byUnit = new Map();
  for (const t of tasks) {
    if (!byUnit.has(t.unit)) byUnit.set(t.unit, []);
    byUnit.get(t.unit).push(t);
  }

  return (
    <div className="inspect">
      <div className="inspect-progress">
        <div className="inspect-progress-row">
          <span>Items scanned</span>
          <span className="tabular">
            {doneCount}/{tasks.length}
          </span>
        </div>
        <div className="inspect-progress-track">
          <div className="inspect-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {[...byUnit.entries()].map(([unit, unitTasks]) => (
        <div key={unit} className="inspect-unit-group">
          {byUnit.size > 1 && (
            <div className="unit-banner">
              AED ({unit}){modelLabelMap?.[unitTasks[0].model] ? ` — ${modelLabelMap[unitTasks[0].model]}` : ""}
            </div>
          )}
          <div className="inspect-grid">
            {unitTasks.map((task) => (
              <InspectItemCard key={task.resultKey} task={task} result={results[task.resultKey]} onCapture={handleCapture} />
            ))}
          </div>
        </div>
      ))}

      <div className="inspect-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Back to manual
        </button>
        <button type="button" className="btn btn-primary" disabled={!allDone} onClick={() => onComplete(results)}>
          {allDone ? "Use these results" : `Scan ${tasks.length - doneCount} more item(s)`}
        </button>
      </div>
    </div>
  );
}

function InspectItemCard({ task, result, onCapture }) {
  const { item } = task;
  const inputRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [useUploadFallback, setUseUploadFallback] = useState(false);
  const status = result?.status || "pending";
  const busy = status === "analyzing";
  const icon = ITEM_ICON[item.id];

  function handleBlobCaptured(blob) {
    setShowCamera(false);
    onCapture(task, blob);
  }

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

      {showCamera ? (
        <LiveCamera
          mediaType={item.mediaType}
          onCapture={handleBlobCaptured}
          onCancel={() => setShowCamera(false)}
        />
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={item.mediaType === "video" ? "video/*" : "image/*"}
            capture="environment"
            className="inspect-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onCapture(task, file);
            }}
          />
          <div className="inspect-card-btn-row">
            <button
              type="button"
              className="btn btn-ghost inspect-card-btn"
              disabled={busy}
              onClick={() => {
                // getUserMedia needs a real (or localhost) secure context —
                // if it's simply not present, skip straight to the file
                // picker instead of showing a live-camera panel that can
                // only ever show its own error state.
                if (hasCamera()) setShowCamera(true);
                else inputRef.current?.click();
              }}
            >
              {busy ? "Analysing…" : status === "pending" ? (item.mediaType === "video" ? "Record video" : "Take live photo") : "Retake"}
            </button>
            {hasCamera() && !useUploadFallback && (
              <button
                type="button"
                className="inspect-card-upload-link"
                disabled={busy}
                onClick={() => {
                  setUseUploadFallback(true);
                  inputRef.current?.click();
                }}
              >
                or upload a file instead
              </button>
            )}
          </div>
        </>
      )}
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
