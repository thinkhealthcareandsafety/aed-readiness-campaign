"use client";

export default function PrintButton() {
  return (
    <button className="btn btn-primary no-print" style={{ marginLeft: "auto" }} onClick={() => window.print()}>
      Print / Save PDF
    </button>
  );
}
