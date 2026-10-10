// Frames for the readiness-indicator check, chosen so a blink can't be lost.
// A browser port of the sibling aed-inspection-platform project's
// python-cv/app/services/readiness_frames.py.
//
// A Philips Ready light flashes for about a tenth of a second, every few
// seconds. Frames spread evenly over a 10-second clip land ~0.4 s apart, so
// the flash usually falls between them: the model then sees a healthy unit
// and a dead one as the same dark light. So every frame is scanned, as the
// clip plays. A flash is a small spot that becomes brighter AND greener than
// anything usually around it, then goes back. The scan steadies handheld
// shake and compares each frame with the clip's own median, dilated: a
// steady green thing that merely shifts a pixel — the green On/Off button on
// an FRx — never exceeds its own neighbourhood, but a light switching on in
// a dark window does. The frames where that happens go to the model with
// evenly spaced ones, and are kept as evidence the server checks the
// verdict against (checkReadiness in lib/inspectionGemini.js).
//
// Returns null when the browser can't scan (no requestVideoFrameCallback, an
// undecodable clip): the caller then sends evenly spaced frames unscanned,
// and the server judges the clip without the scan — which can only make a
// pass harder, never easier.

// Frames sent to the model: flash moments first, the rest spread evenly.
const MAX_FRAMES = 24;
const MAX_FLASH_FRAMES = 6;
// Long edge of the frames the model sees: a status light is unmistakable at
// this size, and the upload stays small on hotel wifi.
const SEND_LONG_EDGE = 640;
const SEND_QUALITY = 0.85;
// Long edge the scan works at.
const SCAN_LONG_EDGE = 256;
// Frames scanned at most (~30 s at 30 fps).
const MAX_SCANNED = 900;
// Frames the clip's usual appearance (its median) is built from.
const BACKGROUND_SAMPLES = 60;
// How far around each pixel counts as "usually around it", in scan pixels.
const NEIGHBOURHOOD = 5;

// Lit = this much greener (G minus the larger of R and B) and this much
// brighter than the brightest, greenest thing usually nearby...
const GREENER_BY = 20;
const BRIGHTER_BY = 15;
// ...or, failing the brighter test, at least this much greener. A Defibtech
// is bright yellow: its casing is already near 255 in the red channel, so a
// green light beside it can never be "brighter" than its surroundings. Yellow
// has no greenness at all, though, so a light coming on there is a jump of
// 60-100 in greenness. It must still be no dimmer than its surroundings.
const STRONGLY_GREENER_BY = 40;
const NO_DIMMER_BY = 8;
// And a lit Ready light is vivid in itself — strongly green and bright.
const MIN_GREEN = 45;
const MIN_BRIGHT = 140;
// A light, not a scene change: at least this many lit pixels at scan size,
// no more than this share of the frame, and gathered in one small spot.
const MIN_LIT_PIXELS = 2;
const MAX_LIT_SHARE = 0.012;
const MAX_SPOT_SIDE = 0.1; // of the frame's long edge
// A frame where this share of pixels changed brightness is a camera jolt or
// an exposure swing: nothing in it is trusted as a flash.
const UNSTABLE_SHARE = 0.3;
// A flash must be dark again this long before and after it is seen lit.
const OFF_AFTER_SECONDS = 0.35;
// Lit longer than this is a steady light (in use, self-test), not a blink.
const MAX_FLASH_SECONDS = 0.7;
// A Ready flash lasts about a tenth of a second, so it spans at least two
// frames; a spot lit in one frame alone is a jolt of the hand.
const MIN_FLASH_FRAMES = 2;
// Hand-shake steadying: how far one frame may have moved from the last
// (scan pixels), and the mean difference left after lining them up above
// which the match isn't trusted — a jolt, motion blur, or a scene change.
const MAX_SHIFT = 8;
const MAX_ALIGNED_DIFF = 14;

export function canScanReadiness() {
  return typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;
}

function fit(width, height, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

// Plays the clip once and keeps every frame: a small RGBA copy to scan and a
// JPEG to send. Only the cheap work happens per frame, so playback isn't
// starved; the scan itself runs afterwards.
async function captureFrames(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Kept in the page (but invisible): some browsers stop presenting frames
  // of a video element that isn't rendered anywhere.
  Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none" });
  document.body.appendChild(video);
  try {
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error("Could not read video"));
    });
    const [scanW, scanH] = fit(video.videoWidth, video.videoHeight, SCAN_LONG_EDGE);
    const [sendW, sendH] = fit(video.videoWidth, video.videoHeight, SEND_LONG_EDGE);
    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = scanW;
    scanCanvas.height = scanH;
    const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
    const sendCanvas = document.createElement("canvas");
    sendCanvas.width = sendW;
    sendCanvas.height = sendH;
    const sendCtx = sendCanvas.getContext("2d");

    const frames = [];
    let lastMediaTime = -1;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const onFrame = (_now, meta) => {
        if (settled) return;
        if (meta.mediaTime > lastMediaTime) {
          lastMediaTime = meta.mediaTime;
          scanCtx.drawImage(video, 0, 0, scanW, scanH);
          sendCtx.drawImage(video, 0, 0, sendW, sendH);
          frames.push({
            time: meta.mediaTime,
            rgba: scanCtx.getImageData(0, 0, scanW, scanH).data,
            jpeg: new Promise((r) => sendCanvas.toBlob(r, "image/jpeg", SEND_QUALITY)),
          });
          if (frames.length >= MAX_SCANNED) {
            video.pause();
            finish();
            return;
          }
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      video.onended = finish;
      video.onerror = () => reject(new Error("Could not read video"));
      video.play().catch(reject);
    });
    return { frames, width: scanW, height: scanH };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

// Grayscale of an RGBA frame, sampled every `step` pixels.
function grayOf(rgba, width, height, step) {
  const w = Math.floor(width / step);
  const h = Math.floor(height / step);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * step * width + x * step) * 4;
      out[y * w + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  return { data: out, w, h };
}

// Mean absolute difference between `b` shifted by (dx, dy) and `a`, over
// their overlap — the residual left once one frame is lined up on the other.
function shiftedDiff(a, b, dx, dy, margin) {
  let sum = 0;
  let n = 0;
  for (let y = margin; y < a.h - margin; y += 2) {
    const yb = y + dy;
    if (yb < 0 || yb >= a.h) continue;
    for (let x = margin; x < a.w - margin; x += 2) {
      const xb = x + dx;
      if (xb < 0 || xb >= a.w) continue;
      sum += Math.abs(a.data[y * a.w + x] - b.data[yb * a.w + xb]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

// How far `next` moved from `prev` (scan pixels), coarse-to-fine, and how
// well the two then match.
function measureShift(prev, next) {
  const coarseRange = Math.ceil(MAX_SHIFT / 2);
  let best = { dx: 0, dy: 0, diff: Infinity };
  for (let dy = -coarseRange; dy <= coarseRange; dy++) {
    for (let dx = -coarseRange; dx <= coarseRange; dx++) {
      const diff = shiftedDiff(prev.coarse, next.coarse, dx, dy, coarseRange);
      if (diff < best.diff) best = { dx, dy, diff };
    }
  }
  let fine = { dx: best.dx * 2, dy: best.dy * 2, diff: Infinity };
  for (let dy = best.dy * 2 - 1; dy <= best.dy * 2 + 1; dy++) {
    for (let dx = best.dx * 2 - 1; dx <= best.dx * 2 + 1; dx++) {
      const diff = shiftedDiff(prev.fine, next.fine, dx, dy, MAX_SHIFT);
      if (diff < fine.diff) fine = { dx, dy, diff };
    }
  }
  return fine;
}

// The frame moved back by (sx, sy) onto the first one (edges replicated),
// box-blurred 3x3, as greenness (G minus the larger of R and B) and
// brightness (the largest channel).
function steadiedGreenBright(rgba, width, height, sx, sy) {
  const n = width * height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const ys = Math.min(height - 1, Math.max(0, y + sy));
    for (let x = 0; x < width; x++) {
      const xs = Math.min(width - 1, Math.max(0, x + sx));
      const i = (ys * width + xs) * 4;
      const o = y * width + x;
      r[o] = rgba[i];
      g[o] = rgba[i + 1];
      b[o] = rgba[i + 2];
    }
  }
  const R = boxBlur3(r, width, height);
  const G = boxBlur3(g, width, height);
  const B = boxBlur3(b, width, height);
  const green = new Uint8Array(n);
  const bright = new Uint8Array(n);
  for (let o = 0; o < n; o++) {
    green[o] = Math.max(0, Math.min(255, Math.round(G[o] - Math.max(R[o], B[o]))));
    bright[o] = Math.round(Math.max(R[o], G[o], B[o]));
  }
  return { green, bright };
}

// 3x3 mean filter, separable, with edges replicated.
function boxBlur3(src, width, height) {
  const rows = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      rows[row + x] = (src[row + Math.max(0, x - 1)] + src[row + x] + src[row + Math.min(width - 1, x + 1)]) / 3;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = (rows[up + x] + rows[row + x] + rows[down + x]) / 3;
  }
  return out;
}

// Grey-level dilation (a max filter) over a square neighbourhood.
function dilate(src, width, height, size = NEIGHBOURHOOD) {
  const half = Math.floor(size / 2);
  const rows = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let xx = Math.max(0, x - half); xx <= Math.min(width - 1, x + half); xx++) m = Math.max(m, src[y * width + xx]);
      rows[y * width + x] = m;
    }
  }
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let yy = Math.max(0, y - half); yy <= Math.min(height - 1, y + half); yy++) m = Math.max(m, rows[yy * width + x]);
      out[y * width + x] = m;
    }
  }
  return out;
}

function medianOf(stack, picks, n) {
  const out = new Uint8Array(n);
  const values = new Uint8Array(picks.length);
  const mid = picks.length >> 1;
  for (let p = 0; p < n; p++) {
    for (let k = 0; k < picks.length; k++) values[k] = stack[picks[k]][p];
    values.sort();
    out[p] = picks.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) >> 1;
  }
  return out;
}

// Pixels vividly green and bright, and more so than anything usually
// around them. `mask`, when given, is narrowed in place.
function litMask(green, bright, nearGreen, nearBright, mask) {
  const out = mask || new Uint8Array(green.length).fill(1);
  for (let p = 0; p < green.length; p++) {
    if (!out[p]) continue;
    const greener = green[p] - nearGreen[p];
    const brighter = bright[p] - nearBright[p];
    out[p] =
      green[p] >= MIN_GREEN &&
      bright[p] >= MIN_BRIGHT &&
      greener > GREENER_BY &&
      (brighter > BRIGHTER_BY || (greener > STRONGLY_GREENER_BY && brighter >= -NO_DIMMER_BY))
        ? 1
        : 0;
  }
  return out;
}

const countOf = (mask) => mask.reduce((s, v) => s + v, 0);

// Most lit pixels in one blob, small enough to be a light.
function oneSmallSpot(mask, width, height) {
  const total = countOf(mask);
  if (!total) return false;
  const seen = new Uint8Array(mask.length);
  let best = { area: 0, side: 0 };
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    let minX = Infinity;
    let maxX = -1;
    let minY = Infinity;
    let maxY = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      area++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (area > best.area) best = { area, side: Math.max(maxX - minX + 1, maxY - minY + 1) };
  }
  return best.area >= MIN_LIT_PIXELS && best.area >= 0.6 * total && best.side <= Math.max(6, MAX_SPOT_SIDE * Math.max(width, height));
}

// Positions (in the scanned stack) of frames with a flash. Two tests.
// Against the clip's usual picture: a spot is lit that normally isn't.
// Against the same spot `offGap` frames before and after: it was dark then —
// a blink goes on and off again. Hand drift can bring a green button into a
// place it wasn't, but it stays there, so it fails the second test.
function findFlashes(greens, brights, width, height, offGap, steady) {
  const count = greens.length;
  const n = width * height;
  const sampleCount = Math.min(BACKGROUND_SAMPLES, count);
  const picks = Array.from({ length: sampleCount }, (_, i) => Math.floor((i * (count - 1)) / Math.max(1, sampleCount - 1)));
  const bgGreen = medianOf(greens, picks, n);
  const bgBright = medianOf(brights, picks, n);
  const nearGreen = dilate(bgGreen, width, height);
  const nearBright = dilate(bgBright, width, height);
  const dilated = new Map();
  const dilatedAt = (j) => {
    if (!dilated.has(j)) dilated.set(j, [dilate(greens[j], width, height), dilate(brights[j], width, height)]);
    return dilated.get(j);
  };

  const found = [];
  for (let k = offGap; k < count - offGap; k++) {
    if (!(steady[k] && steady[k - offGap] && steady[k + offGap])) continue;
    let changed = 0;
    for (let p = 0; p < n; p++) if (Math.abs(brights[k][p] - bgBright[p]) > 25) changed++;
    if (changed > UNSTABLE_SHARE * n) continue;
    const lit = litMask(greens[k], brights[k], nearGreen, nearBright);
    const litCount = countOf(lit);
    if (litCount < MIN_LIT_PIXELS || litCount > MAX_LIT_SHARE * n) continue;
    // On, then off: the spot must be dark just before and just after.
    for (const j of [k - offGap, k + offGap]) {
      const [g, b] = dilatedAt(j);
      litMask(greens[k], brights[k], g, b, lit);
    }
    if (oneSmallSpot(lit, width, height)) found.push(k);
  }
  return found;
}

// Groups consecutive flash frames into separate flashes.
function groupEvents(positions, gap) {
  const events = [];
  for (const p of positions) {
    const last = events[events.length - 1];
    if (last && p - last[last.length - 1] <= gap) last.push(p);
    else events.push([p]);
  }
  return events;
}

/**
 * Scans every frame of a readiness clip for the indicator's flashes and
 * picks the frames the model sees.
 * @returns {Promise<{ frames: Blob[], times: number[], flashPositions: number[],
 *   flashCount: number, duration: number, steadyShare: number } | null>}
 */
export async function scanReadinessClip(file) {
  if (!canScanReadiness()) return null;
  let captured;
  try {
    captured = await captureFrames(file);
  } catch {
    return null;
  }
  const { frames, width, height } = captured;
  if (frames.length < 3) return null;

  // Steady the hand: line each frame up on the one before, and accumulate
  // how far the scene has moved since the first.
  const levels = frames.map((f) => ({ coarse: grayOf(f.rgba, width, height, 2), fine: grayOf(f.rgba, width, height, 1) }));
  const steady = [true];
  let totalX = 0;
  let totalY = 0;
  const greens = [];
  const brights = [];
  for (let k = 0; k < frames.length; k++) {
    if (k > 0) {
      const { dx, dy, diff } = measureShift(levels[k - 1], levels[k]);
      totalX += dx;
      totalY += dy;
      steady.push(diff <= MAX_ALIGNED_DIFF);
    }
    const { green, bright } = steadiedGreenBright(frames[k].rgba, width, height, totalX, totalY);
    greens.push(green);
    brights.push(bright);
  }

  const intervals = frames.slice(1).map((f, i) => f.time - frames[i].time).filter((d) => d > 0).sort((a, b) => a - b);
  const frameInterval = intervals.length ? intervals[intervals.length >> 1] : 1 / 30;
  const scanFps = 1 / frameInterval;
  const offGap = Math.max(2, Math.round(OFF_AFTER_SECONDS * scanFps));
  const positions = findFlashes(greens, brights, width, height, offGap, steady);
  // A blink is brief; anything lit for longer is a steady light or a scene
  // change, never a Ready flash.
  const events = groupEvents(positions, Math.max(2, Math.floor(scanFps * 0.25))).filter(
    (e) => e.length >= MIN_FLASH_FRAMES && (e[e.length - 1] - e[0] + 1) / scanFps <= MAX_FLASH_SECONDS
  );

  // One frame per flash — the middle of its run — then even spacing.
  const chosen = new Set(events.slice(0, MAX_FLASH_FRAMES).map((e) => e[e.length >> 1]));
  const flashSet = new Set(chosen);
  for (let i = 0; i < MAX_FRAMES && chosen.size < MAX_FRAMES; i++) {
    const p = Math.floor((i * (frames.length - 1)) / (MAX_FRAMES - 1));
    if ([...chosen].every((c) => Math.abs(p - c) > 1)) chosen.add(p);
  }
  const ordered = [...chosen].sort((a, b) => a - b);
  const blobs = await Promise.all(ordered.map((p) => frames[p].jpeg));
  if (blobs.some((b) => !b)) return null;

  return {
    frames: blobs,
    times: ordered.map((p) => Math.round(frames[p].time * 100) / 100),
    flashPositions: ordered.map((p, i) => (flashSet.has(p) ? i + 1 : null)).filter((v) => v != null),
    flashCount: events.length,
    duration: Math.round((frames[frames.length - 1].time + frameInterval) * 10) / 10,
    steadyShare: Math.round((steady.filter(Boolean).length / steady.length) * 100) / 100,
    scanned: frames.length,
  };
}
