// Maps each static hotel name in lib/hotels.js to the city it's in, so the
// picker can sort the visitor's local city to the top. Kept as an explicit
// table rather than parsed from the name at runtime — names like "Sheraton
// Grand Bangalore Hotel at Brigade Gateway" or "The Ritz-Carlton, Pune"
// don't follow one consistent word position for the city, so a heuristic
// parser would silently misfile some of them.
export const HOTEL_CITY = {
  "Aloft Bengaluru Outer Ring Road": "Bengaluru",
  "Aloft Bengaluru Whitefield": "Bengaluru",
  "Aloft New Delhi Aerocity": "Delhi",
  "Aravali Marriott Resort & Spa, Delhi NCR": "Delhi",
  "Coorg Marriott Resort & Spa": "Coorg",
  "Courtyard Agra": "Agra",
  "Courtyard Ahmedabad Sindhu Bhavan Road": "Ahmedabad",
  "Courtyard Ahmedabad": "Ahmedabad",
  "Courtyard Amritsar": "Amritsar",
  "Courtyard Gorakhpur": "Gorakhpur",
  "Courtyard Gurugram Downtown": "Gurugram",
  "Courtyard Kochi Airport": "Kochi",
  "Courtyard Mahabaleshwar": "Mahabaleshwar",
  "Courtyard Mumbai International Airport": "Mumbai",
  "Courtyard Nashik": "Nashik",
  "Courtyard Navi Mumbai": "Navi Mumbai",
  "Courtyard Pune Chakan": "Pune",
  "Courtyard Pune Hinjewadi": "Pune",
  "Courtyard Raipur": "Raipur",
  "Courtyard Shillong": "Shillong",
  "Courtyard Siliguri": "Siliguri",
  "Courtyard Tiruchirappalli": "Tiruchirappalli",
  "Courtyard by Marriott Aravali Resort": "Aravali",
  "Courtyard by Marriott Bengaluru Hebbal": "Bengaluru",
  "Courtyard by Marriott Bengaluru Outer Ring Road": "Bengaluru",
  "Courtyard by Marriott Bhopal": "Bhopal",
  "Courtyard by Marriott Bilaspur": "Bilaspur",
  "Courtyard by Marriott Chennai": "Chennai",
  "Courtyard by Marriott Goa Colva": "Goa",
  "Courtyard by Marriott Hyderabad": "Hyderabad",
  "Courtyard by Marriott Madurai": "Madurai",
  "Courtyard by Marriott Ranchi": "Ranchi",
  "Courtyard by Marriott Surat": "Surat",
  "Courtyard by Marriott Vadodara": "Vadodara",
  "Fairfield by Marriott Agra": "Agra",
  "Fairfield by Marriott Ahmedabad": "Ahmedabad",
  "Fairfield by Marriott Amritsar": "Amritsar",
  "Fairfield by Marriott Belagavi": "Belagavi",
  "Fairfield by Marriott Bengaluru Outer Ring Road": "Bengaluru",
  "Fairfield by Marriott Bengaluru Rajajinagar": "Bengaluru",
  "Fairfield by Marriott Bengaluru Whitefield": "Bengaluru",
  "Fairfield by Marriott Chennai Mahindra World City": "Chennai",
  "Fairfield by Marriott Chennai OMR": "Chennai",
  "Fairfield by Marriott Coimbatore": "Coimbatore",
  "Fairfield by Marriott Dehradun": "Dehradun",
  "Fairfield by Marriott Goa Anjuna": "Goa",
  "Fairfield by Marriott Goa Benaulim": "Goa",
  "Fairfield by Marriott Goa Calangute": "Goa",
  "Fairfield by Marriott Hyderabad Gachibowli": "Hyderabad",
  "Fairfield by Marriott Indore": "Indore",
  "Fairfield by Marriott Jaipur": "Jaipur",
  "Fairfield by Marriott Jodhpur": "Jodhpur",
  "Fairfield by Marriott Kolkata": "Kolkata",
  "Fairfield by Marriott Lucknow": "Lucknow",
  "Fairfield by Marriott Mumbai Andheri West": "Mumbai",
  "Fairfield by Marriott Mumbai International Airport": "Mumbai",
  "Fairfield by Marriott Pune Kharadi": "Pune",
  "Fairfield by Marriott Sriperumbudur": "Sriperumbudur",
  "Fairfield by Marriott Vadodara": "Vadodara",
  "Fairfield by Marriott Visakhapatnam": "Visakhapatnam",
  "Four Points by Sheraton Ahmedabad": "Ahmedabad",
  "Four Points by Sheraton Amritsar, Mall Road": "Amritsar",
  "Four Points by Sheraton Bengaluru, Whitefield": "Bengaluru",
  "Four Points by Sheraton Chennai OMR": "Chennai",
  "Four Points by Sheraton Chennai, Velachery": "Chennai",
  "Four Points by Sheraton Hotel & Serviced Apartments, Pune": "Pune",
  "Four Points by Sheraton Jaipur, City Square": "Jaipur",
  "Four Points by Sheraton Kochi Infopark": "Kochi",
  "Four Points by Sheraton Mahabalipuram Resort & Convention Center": "Mahabalipuram",
  "Four Points by Sheraton Nashik": "Nashik",
  "Four Points by Sheraton Navi Mumbai, Vashi": "Navi Mumbai",
  "Four Points by Sheraton New Delhi, Airport Highway": "Delhi",
  "Four Points by Sheraton Sonmarg Resort": "Sonmarg",
  "Four Points by Sheraton Srinagar": "Srinagar",
  "Four Points by Sheraton Vadodara": "Vadodara",
  "Four Points by Sheraton Visakhapatnam": "Visakhapatnam",
  "Goa Marriott Resort & Spa": "Goa",
  "Hyderabad Marriott Hotel & Convention Centre": "Hyderabad",
  "Indore Marriott Hotel": "Indore",
  "JW Marriott Bengaluru Prestige Golfshire Resort & Spa": "Bengaluru",
  "JW Marriott Goa": "Goa",
  "JW Marriott Hotel Bengaluru": "Bengaluru",
  "JW Marriott Hotel Chandigarh": "Chandigarh",
  "JW Marriott Hotel Kolkata": "Kolkata",
  "JW Marriott Hotel New Delhi Aerocity": "Delhi",
  "JW Marriott Hotel Pune": "Pune",
  "JW Marriott Mumbai Juhu": "Mumbai",
  "JW Marriott Mumbai Sahar": "Mumbai",
  "JW Marriott Mussoorie Walnut Grove Resort & Spa": "Mussoorie",
  "Jaipur Marriott Hotel": "Jaipur",
  "Jaisalmer Marriott Resort & Spa": "Jaisalmer",
  "Jim Corbett Marriott Resort & Spa": "Jim Corbett",
  "Katra Marriott Resort & Spa": "Katra",
  "Kochi Marriott Hotel": "Kochi",
  "Lakeside Chalet, Mumbai - Marriott Executive Apartments": "Mumbai",
  "Le Meridien Ahmedabad": "Ahmedabad",
  "Le Meridien Amritsar": "Amritsar",
  "Le Meridien Coimbatore": "Coimbatore",
  "Le Meridien Dehradun Resort & Spa": "Dehradun",
  "Le Meridien Goa, Calangute": "Goa",
  "Le Meridien Gurgaon, Delhi NCR": "Gurugram",
  "Le Meridien Hyderabad": "Hyderabad",
  "Le Meridien Jaipur Resort & Spa": "Jaipur",
  "Le Meridien Kochi": "Kochi",
  "Le Meridien Mahabaleshwar Resort & Spa": "Mahabaleshwar",
  "Le Meridien Nagpur": "Nagpur",
  "Le Meridien Navi Mumbai": "Navi Mumbai",
  "Le Meridien New Delhi": "Delhi",
  "Le Royal Meridien Chennai": "Chennai",
  "Marriott Executive Apartments Bengaluru UB City": "Bengaluru",
  "Marriott Executive Apartments Hyderabad": "Hyderabad",
  "Marriott Executive Apartments Mall Road Amritsar": "Amritsar",
  "Marriott Executive Apartments Navi Mumbai": "Navi Mumbai",
  "Marriott Suites Pune": "Pune",
  "Moxy Bengaluru Airport Prestige Tech Cloud": "Bengaluru",
  "Moxy Mumbai Andheri West": "Mumbai",
  "Mulberry Shades Bengaluru Nandi Hills, a Tribute Portfolio Resort": "Bengaluru",
  "Navi Mumbai Marriott Hotel": "Navi Mumbai",
  "Port Muziris, a Tribute Portfolio Hotel, Kochi": "Kochi",
  "Renaissance Ahmedabad Hotel": "Ahmedabad",
  "Renaissance Bengaluru Race Course Hotel": "Bengaluru",
  "Renaissance Goa Hotel": "Goa",
  "Renaissance Lucknow Hotel": "Lucknow",
  "Sheraton Grand Bangalore Hotel at Brigade Gateway": "Bengaluru",
  "Sheraton Grand Bengaluru Whitefield Hotel & Convention Center": "Bengaluru",
  "Sheraton Grand Chennai Resort & Spa": "Chennai",
  "Sheraton Grand Palace Indore": "Indore",
  "Sheraton Grand Pune Bund Garden Hotel": "Pune",
  "Sheraton Hyderabad Hotel": "Hyderabad",
  "Sheraton New Delhi Hotel": "Delhi",
  "Surat Marriott Hotel": "Surat",
  "THE ARTISTE KOCHI, A TRIBUTE PORTFOLIO HOTEL": "Kochi",
  "The Ritz-Carlton, Bangalore": "Bengaluru",
  "The Ritz-Carlton, Pune": "Pune",
  "The St. Regis Goa Resort": "Goa",
  "The St. Regis Mumbai": "Mumbai",
  "The Westin Chennai Velachery": "Chennai",
  "The Westin Goa": "Goa",
  "The Westin Gurgaon, New Delhi": "Gurugram",
  "The Westin Hyderabad Hitec City": "Hyderabad",
  "The Westin Hyderabad Mindspace": "Hyderabad",
  "The Westin Kolkata Rajarhat": "Kolkata",
  "The Westin Mumbai Garden City": "Mumbai",
  "The Westin Mumbai Powai Lake": "Mumbai",
  "The Westin Pune Koregaon Park": "Pune",
  "The Westin Pushkar Resort & Spa": "Pushkar",
  "The Westin Resort & Spa, Himalayas": "Himalayas",
  "The Westin Sohna Resort & Spa": "Sohna",
  "Trinity Whitefield Bengaluru": "Bengaluru",
  "Udaipur Marriott Hotel": "Udaipur",
  "W Goa": "Goa",
};

// A visitor's IP-geolocated (or manually picked) city and a hotel's city
// need to match even when they're phrased differently by whichever geo
// provider returned them (e.g. "Bangalore" vs "Bengaluru", "Gurgaon" vs
// "Gurugram") or by the hotel name itself ("New Delhi" vs "Delhi NCR").
// Both sides get run through this before comparing.
const CITY_ALIASES = {
  bangalore: "bengaluru",
  bengaluru: "bengaluru",
  "new delhi": "delhi",
  delhi: "delhi",
  "delhi ncr": "delhi",
  gurgaon: "gurugram",
  gurugram: "gurugram",
};

export function normalizeCity(city) {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  return CITY_ALIASES[key] || key;
}

// Every distinct city in the list, in the order hotels first appear —
// used to populate the manual city-override selector.
export function listHotelCities() {
  const seen = new Set();
  const cities = [];
  for (const city of Object.values(HOTEL_CITY)) {
    if (!seen.has(city)) {
      seen.add(city);
      cities.push(city);
    }
  }
  return cities.sort((a, b) => a.localeCompare(b));
}

// Every distinct city a hotel is actually in, properly cased for display
// (unlike listHotelCities() above, which lowercases/aliases for matching
// purposes) — used to populate the delivery-address city dropdown, since
// a prize winner is very likely shipping to the same city as the property
// they just audited. Not exhaustive of every Indian city, so that dropdown
// always pairs this with a manual "Other" fallback.
export function listDeliveryCities() {
  return [...new Set(Object.values(HOTEL_CITY))].sort((a, b) => a.localeCompare(b));
}

// Stable sort: hotels whose city matches `city` come first (in their
// existing order), everything else follows (also in its existing order).
export function sortHotelOptionsByCity(options, city) {
  const target = normalizeCity(city);
  if (!target) return options;
  const matched = [];
  const rest = [];
  for (const opt of options) {
    const hotelCity = normalizeCity(HOTEL_CITY[opt.label]);
    (hotelCity === target ? matched : rest).push(opt);
  }
  return matched.length ? [...matched, ...rest] : options;
}
