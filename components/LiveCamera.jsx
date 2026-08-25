"use client";

import { useEffect, useRef, useState } from "react";

// A real in-page camera (getUserMedia + <video> preview + a capture
// button), not the previous <input type="file" capture="environment">
// alone — that attribute is only ever a *hint* to the OS, and plenty of
// browsers/contexts (any desktop browser, some mobile in-app webviews)
// silently ignore it and fall back to a plain "choose file" dialog with no
// live preview at all. This component is the primary path; the parent
// still keeps the old file-input as an always-available fallback for
// anyone whose browser/device can't grant camera access.
const MAX_RECORD_MS = 12_000; // long enough to catch a slow status-light blink cycle, short enough not to be tedious

export default function LiveCamera({ mediaType, onCapture, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1600 }, height: { ideal: 1600 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (err) {
        // Permission denied, no camera present, insecure context, etc. —
        // all handled the same way: surface it and let the parent's
        // "use file upload instead" take over, never leave a dead end.
        setError(err instanceof Error ? err.message : "Could not access the camera.");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      "image/jpeg",
      0.88
    );
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) =>
      typeof MediaRecorder !== "undefined" ? MediaRecorder.isTypeSupported(t) : false
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      onCapture(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORD_MS) {
        clearInterval(tick);
        stopRecording();
      }
    }, 200);
    recorderRef.current._tick = tick;
  }

  function stopRecording() {
    clearInterval(recorderRef.current?._tick);
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setRecording(false);
  }

  if (error) {
    return (
      <div className="live-camera live-camera-error">
        <p>{error} Use the upload option below instead.</p>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="live-camera">
      <div className="live-camera-frame">
        <video ref={videoRef} muted playsInline className="live-camera-video" />
        {!ready && <div className="live-camera-loading">Starting camera…</div>}
        {recording && (
          <div className="live-camera-rec">
            <span className="live-camera-rec-dot" /> {Math.ceil((MAX_RECORD_MS - elapsedMs) / 1000)}s left
          </div>
        )}
      </div>
      <div className="live-camera-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        {mediaType === "video" ? (
          recording ? (
            <button type="button" className="btn btn-primary" onClick={stopRecording}>
              Stop recording
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={startRecording}>
              ● Start recording
            </button>
          )
        ) : (
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={takePhoto}>
            📷 Capture
          </button>
        )}
      </div>
    </div>
  );
}
