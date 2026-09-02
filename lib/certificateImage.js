import fs from "fs";
import path from "path";
import sharp from "sharp";
import { parse as parseFont } from "opentype.js";

// Renders the Good Samaritan Warrior certificate by compositing the
// responder's own details onto the designed template.
//
// public/certificate/good-samaritan-template.jpg is the supplied artwork
// with only its two placeholder strings ("Your Name here" and the sample
// certificate number) painted out — everything else, including the green
// rule under the name, is the original design untouched.
//
// Text is converted to vector paths with opentype.js rather than handed to
// the SVG renderer as <text>: sharp's SVG rasterizer resolves font families
// through the host's font config and silently substitutes a default when it
// can't find one (an embedded @font-face is ignored outright), so a <text>
// approach that looked right locally would quietly render in the wrong font
// on the deployed Linux container. Paths carry their own geometry and look
// identical everywhere.

const TEMPLATE_PATH = path.join(process.cwd(), "public", "certificate", "good-samaritan-template.jpg");
const SCRIPT_FONT_PATH = path.join(process.cwd(), "public", "fonts", "Sacramento.ttf");
const SANS_FONT_PATH = path.join(process.cwd(), "public", "fonts", "Poppins-Regular.ttf");

// Measured off the template artwork (1600x1131). The name sits centred over
// the green rule that runs from x=124 to x=710; the certificate number is
// right-aligned to where the original sample line ended.
const CANVAS = { width: 1600, height: 1131 };
// centerX is the midpoint of the green rule (x 124-710) so any length of name
// sits balanced over it. baselineY is the artwork's own baseline, measured off
// the non-descending letters of its "Your Name here" placeholder — the name
// sits *on* the rule the way a signature does, so Sacramento's long script
// descenders sweep through it rather than stopping short of it. maxWidth
// matches the width that placeholder occupied; strokeWidth adds back a little
// weight, since Sacramento is drawn lighter than the face used in the artwork.
const NAME = {
  centerX: 417,
  baselineY: 443,
  maxWidth: 600,
  fontSize: 112,
  minFontSize: 46,
  color: "#22405a",
  strokeWidth: 1.2,
};
// Sized so a full-length number renders the same width as the sample line in
// the original artwork, and right-aligned to where that line ended.
const CERT_NO = { rightX: 1462, baselineY: 1110, fontSize: 25.5, color: "#24425c" };

let scriptFont = null;
let sansFont = null;

function loadFont(cache, fontPath) {
  if (cache) return cache;
  // opentype.parse needs a real ArrayBuffer; a Node Buffer's .buffer can be a
  // slice of a larger pooled allocation, so copy out just this file's bytes.
  const buf = fs.readFileSync(fontPath);
  return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

// Shrinks the name until it fits the space above the rule — a long
// double-barrelled name should get smaller, never run past the artwork.
function inkWidth(font, text, size) {
  const box = font.getPath(text, 0, 0, size).getBoundingBox();
  return box.x2 - box.x1;
}

function fitFontSize(font, text, maxWidth, startSize, minSize) {
  let size = startSize;
  while (size > minSize && inkWidth(font, text, size) > maxWidth) size -= 2;
  return size;
}

// Positions by the glyphs' own ink bounds rather than their advance widths —
// a script face carries wide side bearings, so advance-width centring leaves
// the name visibly off-centre over the rule even though the maths "balanced".
function placedPath(font, text, size, baselineY, place) {
  const probe = font.getPath(text, 0, 0, size);
  const box = probe.getBoundingBox();
  const x = place.centerX != null ? place.centerX - (box.x1 + box.x2) / 2 : place.rightX - box.x2;
  return font.getPath(text, x, baselineY, size);
}

export function renderCertificate({ name, certificateNumber }) {
  scriptFont = loadFont(scriptFont, SCRIPT_FONT_PATH);
  sansFont = loadFont(sansFont, SANS_FONT_PATH);

  const displayName = String(name || "").trim() || "Awardee";
  const nameSize = fitFontSize(scriptFont, displayName, NAME.maxWidth, NAME.fontSize, NAME.minFontSize);
  const namePath = placedPath(scriptFont, displayName, nameSize, NAME.baselineY, { centerX: NAME.centerX });

  const certText = `Certificate No:${certificateNumber}`;
  const certPath = placedPath(sansFont, certText, CERT_NO.fontSize, CERT_NO.baselineY, { rightX: CERT_NO.rightX });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}">
    <path d="${escapeXml(namePath.toPathData(2))}" fill="${NAME.color}" stroke="${NAME.color}" stroke-width="${NAME.strokeWidth}" stroke-linejoin="round"/>
    <path d="${escapeXml(certPath.toPathData(2))}" fill="${CERT_NO.color}"/>
  </svg>`;

  return sharp(TEMPLATE_PATH)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
