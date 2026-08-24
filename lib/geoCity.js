// Server-only: detects the visitor's city from their IP so the hotel
// picker can sort that city's properties to the top. Railway has no
// Vercel-style free geo header, so this hits ip-api.com's free
// (no-API-key, non-commercial) endpoint instead — same outcome, same
// "free, no keys" constraint, just implemented for the host we're
// actually on.
const DEFAULT_CITY = "Pune";

function isPrivateIp(ip) {
  return (
    !ip ||
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

export function getClientIp(headersList) {
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headersList.get("x-real-ip") || null;
}

export async function detectCityFromIp(ip) {
  if (isPrivateIp(ip)) return DEFAULT_CITY;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,city`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    if (data.status === "success" && data.city) return data.city;
  } catch {
    // Network hiccup, timeout, or free-tier rate limit — fall back quietly,
    // this is a sorting nicety, not something worth failing the page over.
  }
  return DEFAULT_CITY;
}
