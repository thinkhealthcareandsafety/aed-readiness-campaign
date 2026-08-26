import { HOTEL_PROPERTY_LOGOS } from "./hotelPropertyLogos";

// Maps a hotel's free-text name (lib/hotels.js) to its brand logo. Order
// matters: more specific brand names are checked before generic "Marriott"
// or "Sheraton" so e.g. "JW Marriott Hotel Pune" matches JW Marriott, not
// the generic Marriott mark, and "Four Points by Sheraton..." matches Four
// Points, not Sheraton.
//
// This is the FALLBACK tier only — logoForHotel below checks the real,
// property-specific logo set in lib/hotelPropertyLogos.js first. It exists
// for the handful of properties without one of their own (yet), so every
// hotel still gets at least a recognizable brand mark instead of nothing.
// A generic per-brand mark was previously the ONLY tier, which is why every
// Courtyard property (for example) used to show the identical logo — this
// module's own logos are Wikimedia Commons brand marks (see
// public/hotel-logos/). Two brands in the hotel list — The Ritz-Carlton and
// Tribute Portfolio — don't have a clean, properly-licensed generic brand
// wordmark on Commons (only property-specific ones), so they intentionally
// have no logo here and fall back to text-only if their real logo is ever
// missing too.
const BRANDS = [
  { match: /\bjw marriott\b/i, logo: "/hotel-logos/jw-marriott.png", name: "JW Marriott" },
  { match: /marriott executive apartments/i, logo: "/hotel-logos/marriott.png", name: "Marriott Executive Apartments" },
  { match: /\bcourtyard\b/i, logo: "/hotel-logos/courtyard.png", name: "Courtyard by Marriott" },
  { match: /\bfairfield\b/i, logo: "/hotel-logos/fairfield.png", name: "Fairfield by Marriott" },
  { match: /\bfour points\b/i, logo: "/hotel-logos/four-points.png", name: "Four Points by Sheraton" },
  { match: /\ble (royal )?m[eé]ridien\b/i, logo: "/hotel-logos/le-meridien.png", name: "Le Méridien" },
  { match: /\baloft\b/i, logo: "/hotel-logos/aloft.png", name: "Aloft" },
  { match: /\bmoxy\b/i, logo: "/hotel-logos/moxy.png", name: "Moxy" },
  { match: /\brenaissance\b/i, logo: "/hotel-logos/renaissance.png", name: "Renaissance" },
  { match: /\bst\.? regis\b/i, logo: "/hotel-logos/st-regis.png", name: "The St. Regis" },
  { match: /\bwestin\b/i, logo: "/hotel-logos/westin.png", name: "The Westin" },
  { match: /\bsheraton\b/i, logo: "/hotel-logos/sheraton.png", name: "Sheraton" },
  { match: /^w\b/i, logo: "/hotel-logos/w-hotels.png", name: "W Hotels" },
  { match: /\bmarriott\b/i, logo: "/hotel-logos/marriott.png", name: "Marriott Hotels" }, // catch-all — keep last
];

export function logoForHotel(hotelName) {
  const propertyLogo = HOTEL_PROPERTY_LOGOS[hotelName];
  if (propertyLogo) return { logo: propertyLogo, brandName: hotelName };
  const brand = BRANDS.find((b) => b.match.test(hotelName));
  return brand ? { logo: brand.logo, brandName: brand.name } : null;
}
