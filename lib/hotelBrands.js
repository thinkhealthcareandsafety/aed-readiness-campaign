// Maps a hotel's free-text name (lib/hotels.js) to its brand logo. Order
// matters: more specific brand names are checked before generic "Marriott"
// or "Sheraton" so e.g. "JW Marriott Hotel Pune" matches JW Marriott, not
// the generic Marriott mark, and "Four Points by Sheraton..." matches Four
// Points, not Sheraton.
//
// Logos are Wikimedia Commons brand marks (see public/hotel-logos/), sourced
// per-brand rather than per-property. Two brands in the hotel list — The
// Ritz-Carlton and Tribute Portfolio — don't have a clean, properly-licensed
// generic brand wordmark on Commons (only property-specific ones), so they
// intentionally have no logo here and fall back to text-only.
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
  const brand = BRANDS.find((b) => b.match.test(hotelName));
  return brand ? { logo: brand.logo, brandName: brand.name } : null;
}
