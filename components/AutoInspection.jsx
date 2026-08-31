"use client";

import { useRef, useState } from "react";
import { CHECKLIST_ITEMS, fieldRoleFor } from "@/lib/inspectionChecklist";
import LiveCamera from "@/components/LiveCamera";
import { FieldReferencePhoto } from "@/components/ReferenceGuide";

const ITEM_ICON = {
  battery_attached: "/icons/battery-ok.svg",
  pads_connected: "/icons/pads-sealed.svg",
};

// Maps a checklist item to the same per-model reference-photo `kind` the
// manual flow uses (see MODEL_PHOTOS in ReferenceGuide.jsx) — so scanning
// "Battery expiry" for AED (2) shows exactly that unit's own model's real
// battery-label photo, not a generic camera glyph.
const ITEM_REFERENCE_KIND = {
  pads_expiry_date: "pads",
  battery_expiry_date: "battery",
  battery_attached: "batteryAttached",
  pads_connected: "padsAttached",
};

// Fixed-count sampling regardless of clip length meant a longer or
// lower-fps recording could sample right past a brief LED flash between
// two sample points. Scaling the count to the clip's own duration (roughly
// one sample every 400ms) keeps sampling density consistent instead.
const MIN_VIDEO_FRAMES = 8;
const MAX_VIDEO_FRAMES = 24;
const TARGET_FRAME_INTERVAL_S = 0.4;

// Below this, Gemini's own stated uncertainty means its answer shouldn't
// silently auto-fill a safety-relevant audit field — route it to manual
// review instead (see handleCapture below and the "needs_review" status).
const MIN_CONFIDENCE = 0.55;

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

// A cheap client-side gate before a photo ever reaches Gemini — a
// pitch-black, blown-out, or badly out-of-focus capture previously still
// cost a full API round trip (and could brush up against the request
// timeout) before the responder found out it was unusable. Never blocks a
// capture outright (see the "Analyze anyway" escape hatch in
// InspectItemCard below) — this is a fast heads-up, not a hard gate, since
// a heuristic like this can misfire on a legitimately fine photo.
async function assessImageQuality(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not read that photo"));
    });

    const SIZE = 96;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    // Cover-fit draw (like object-fit: cover) so a non-square photo's
    // aspect ratio doesn't skew the brightness/blur sample.
    const scale = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);

    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const gray = new Float32Array(SIZE * SIZE);
    let sum = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      gray[i] = v;
      sum += v;
    }
    const mean = sum / gray.length;

    // Laplacian edge-energy variance as a blur proxy — a sharp, in-focus
    // photo has strong local contrast (high variance); a blurry one is
    // smooth almost everywhere (low variance).
    let lapSum = 0;
    let lapSumSq = 0;
    let n = 0;
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const idx = y * SIZE + x;
        const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - SIZE] - gray[idx + SIZE];
        lapSum += lap;
        lapSumSq += lap * lap;
        n++;
      }
    }
    const lapMean = lapSum / n;
    const lapVariance = lapSumSq / n - lapMean * lapMean;

    if (mean < 28) return "That photo looks too dark — retake it somewhere brighter.";
    if (mean > 245) return "That photo looks washed out — retake it out of direct glare or reflection.";
    if (lapVariance < 40) return "That photo looks blurry — hold steady and let it focus before capturing.";
    return null;
  } catch {
    return null; // a failed quality check should never block a real capture
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Extracts a duration-scaled number of JPEG frames, evenly spaced across a
// recorded video File/Blob — works the same whether that blob came from
// the OS file picker or from LiveCamera's own MediaRecorder capture, since
// both are just video files at this point.
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
    const frameCount = Math.min(
      MAX_VIDEO_FRAMES,
      Math.max(MIN_VIDEO_FRAMES, Math.round(duration / TARGET_FRAME_INTERVAL_S))
    );
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const t = (duration * (i + 0.5)) / frameCount;
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

export default function AutoInspection({ unitCount, modelSequence, modelLabelMap, serialByUnit, onComplete, onCancel }) {
  const [results, setResults] = useState({});
  const tasks = buildTasks(unitCount || 1, modelSequence || []);
  // "needs_review" (low AI confidence) and "skipped" (responder opted out
  // of this one item) both count as *done* for progress purposes — neither
  // one auto-fills the form field (see handleAutoInspectionComplete in
  // AuditWizard.jsx, which only acts on "pass"/"fail"), so the responder
  // answers those specific questions manually later, exactly like the
  // existing "unclear" readiness-indicator case already works.
  const doneCount = tasks.filter((t) => ["pass", "fail", "needs_review", "skipped"].includes(results[t.resultKey]?.status)).length;
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
      // A low-confidence read gets routed to manual review regardless of
      // what it claims passed/failed — Gemini's own stated uncertainty
      // shouldn't silently auto-fill a safety-relevant audit field. This is
      // the actual enforcement of the confidence score the UI already
      // displayed but, until now, never acted on.
      const lowConfidence = typeof data.confidence === "number" && data.confidence < MIN_CONFIDENCE;
      const status = lowConfidence ? "needs_review" : data.passed ? "pass" : "fail";
      const notes = lowConfidence
        ? `Low AI confidence — please check this one yourself. (AI said: "${data.notes || "no detail given"}")`
        : data.notes;
      setStatus(task.resultKey, { ...rest, notes, readinessStatus, status });
    } catch (err) {
      setStatus(task.resultKey, { status: "error", notes: err instanceof Error ? err.message : "Analysis failed" });
    }
  }

  // Escape hatch for a single stubborn item — previously the only way past
  // a bad/repeated read was "Back to manual", which discarded every other
  // already-good result for that unit too. Recorded with no result data at
  // all so handleAutoInspectionComplete's pass/fail-only check leaves the
  // corresponding question for the responder to answer manually.
  function handleSkip(task) {
    setStatus(task.resultKey, { status: "skipped", notes: undefined, mediaUrl: undefined, confidence: undefined });
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
              <span className="unit-banner-id">
                AED ({unit}){modelLabelMap?.[unitTasks[0].model] ? ` — ${modelLabelMap[unitTasks[0].model]}` : ""}
              </span>
              {serialByUnit?.[unit - 1] && <span className="unit-banner-serial">SN {serialByUnit[unit - 1]}</span>}
            </div>
          )}
          <div className="inspect-grid">
            {unitTasks.map((task) => (
              <InspectItemCard key={task.resultKey} task={task} result={results[task.resultKey]} onCapture={handleCapture} onSkip={handleSkip} />
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

function InspectItemCard({ task, result, onCapture, onSkip }) {
  const { item } = task;
  const inputRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [useUploadFallback, setUseUploadFallback] = useState(false);
  // { message, blob } — a captured photo that failed the pre-upload
  // quality heuristic, held here so the responder can retake it or send it
  // to Gemini anyway rather than being blocked outright.
  const [qualityWarning, setQualityWarning] = useState(null);
  const status = result?.status || "pending";
  const busy = status === "analyzing";
  const icon = ITEM_ICON[item.id];
  const canSkip = status === "fail" || status === "error" || status === "needs_review";

  async function processCapture(blob) {
    if (item.mediaType === "image") {
      const warning = await assessImageQuality(blob);
      if (warning) {
        setQualityWarning({ message: warning, blob });
        return;
      }
    }
    onCapture(task, blob);
  }

  function handleBlobCaptured(blob) {
    setShowCamera(false);
    processCapture(blob);
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

      <ItemReferencePhoto itemId={item.id} model={task.model} />

      {result?.mediaUrl && (
        <div className="inspect-card-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element -- captured photo/frame, not a build-time asset */}
          <img src={result.mediaUrl} alt="" />
        </div>
      )}

      {result?.notes && (status === "pass" || status === "fail" || status === "error" || status === "needs_review") && (
        <p className={`inspect-card-notes ${status === "pass" ? "ok" : status === "needs_review" ? "warn" : "bad"}`}>
          {result.notes}
          {typeof result.confidence === "number" && (
            <span className="inspect-card-conf"> · {Math.round(result.confidence * 100)}% confidence</span>
          )}
        </p>
      )}

      {status === "skipped" && <p className="inspect-card-notes neutral">Skipped — you&apos;ll answer this one manually.</p>}

      {qualityWarning ? (
        <div className="inspect-quality-warning">
          <p>{qualityWarning.message}</p>
          <div className="inspect-card-btn-row">
            <button type="button" className="btn btn-ghost inspect-card-btn" onClick={() => setQualityWarning(null)}>
              Retake
            </button>
            <button
              type="button"
              className="inspect-card-upload-link"
              onClick={() => {
                const blob = qualityWarning.blob;
                setQualityWarning(null);
                onCapture(task, blob);
              }}
            >
              Analyze it anyway
            </button>
          </div>
        </div>
      ) : showCamera ? (
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
              if (file) processCapture(file);
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
            {canSkip && (
              <button type="button" className="inspect-card-upload-link" disabled={busy} onClick={() => onSkip(task)}>
                Skip — I&apos;ll answer manually
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ItemReferencePhoto({ itemId, model }) {
  const kind = ITEM_REFERENCE_KIND[itemId];
  if (!kind || !model) return null;
  return <FieldReferencePhoto models={[model]} kind={kind} />;
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
  if (status === "needs_review") return <span className="inspect-status-glyph warn">?</span>;
  if (status === "skipped") return <span className="inspect-status-glyph neutral">–</span>;
  if (status === "analyzing") return <span className="inspect-status-glyph spin" aria-hidden />;
  return null;
}
