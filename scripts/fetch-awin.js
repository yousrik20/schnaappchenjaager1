#!/usr/bin/env node
/**
 * fetch-awin.js — schnäppchenjäger1 v4.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the official Awin Offers API (POST) exactly as documented:
 * https://help.awin.com/apidocs/promotions
 *
 * Endpoint : POST /publisher/{publisherId}/promotions
 * Auth     : Authorization: Bearer {accessToken}
 * Paginated: fetches all pages automatically
 *
 * ENV:
 *   AWIN_TOKEN        — Awin API access token
 *   AWIN_PUBLISHER_ID — Publisher ID (default: 2851329)
 *   AWIN_REGION       — ISO 3166-1 alpha-2 (default: DE)
 * ─────────────────────────────────────────────────────────────────────────────
 */
"use strict";

const https  = require("https");
const fs     = require("fs");
const path   = require("path");

// ── Config ─────────────────────────────────────────────────────────────────
const TOKEN        = process.env.AWIN_TOKEN;
const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID;
const REGION       = process.env.AWIN_REGION       || "DE";
const OUT_FILE     = path.join(__dirname, "..", "promotions.json");
const PAGE_SIZE    = 200;  // max allowed by Awin API

// Static metadata: icon + category per advertiser (by ID or name)
const ADV_META = {
  "11447":  { icon:"⚡",  cat:"Elektronik",  url:"https://www.elv.de" },
  "125816": { icon:"📷",  cat:"Sicherheit",  url:"https://www.imou.com/de-DE/" },
  "25546":  { icon:"🌸",  cat:"K-Beauty",    url:"https://www.stylevana.com/de_DE/" },
  "28297":  { icon:"👔",  cat:"Mode",        url:"https://www.froelich-und-kaufmann.de" },
  "114336": { icon:"👟",  cat:"Sneakers",    url:"https://www.house-of-sneakers.de" },
  "53143":  { icon:"🏡",  cat:"Wohnen",      url:"https://www.teppich.de" },
  "79858":  { icon:"🛋️",  cat:"Möbel",       url:"https://www.luftbude.de" },
  "13812":  { icon:"🛒",  cat:"Supermarkt",  url:"https://www.netto-online.de" },
  "9364":   { icon:"🔍",  cat:"Vergleich",   url:"https://www.check24.de" },
  "125332": { icon:"🕹️",  cat:"Gaming",      url:"https://www.autofull.com/de/" },
  // Name-based fallbacks for PENDING-ID advertisers
  "NordVPN DE":             { icon:"🛡️", cat:"VPN",       url:"https://nordvpn.com/de/" },
  "ANTHBOT DE":             { icon:"🔧", cat:"Technologie",url:"https://www.anthbot.com/" },
  "100percentpure DE/AT":   { icon:"🌿", cat:"Beauty",     url:"https://www.100percentpure.com/de/" },
  "Voghion Global":         { icon:"💎", cat:"Fashion",    url:"https://www.voghion.com/" },
  "Baur Versand DE":        { icon:"👗", cat:"Lifestyle",  url:"https://www.baur.de" },
  "HRS DE & AT":           { icon:"🏨", cat:"Hotels",     url:"https://www.hrs.com/de/" },
  "FlixBus & FlixTrain DE":{ icon:"🚍", cat:"Fernreise",  url:"https://www.flixbus.de" },
  "Aosom DE/AT":            { icon:"🪴", cat:"Garten",     url:"https://www.aosom.de" },
};

// ── HTTP Helpers ────────────────────────────────────────────────────────────
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.awin.com",
      port: 443,
      path: urlPath,
      method,
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Accept":        "application/json",
        "User-Agent":    "schnaeppchenjager1/4.0",
        ...(bodyStr ? {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
        } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error(`JSON parse: ${e.message}\n${data.slice(0,200)}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode} [${method} ${urlPath}]\n${data.slice(0,300)}`));
        }
      });
    });

    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Request timeout")); });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const apiGet  = (path)       => request("GET",  path, null);
const apiPost = (path, body) => request("POST", path, body);

// ── Step 1: Get joined programmes (for metadata) ───────────────────────────
async function fetchProgrammes() {
  console.log("\n📋 Step 1: Fetching joined programmes…");
  try {
    const raw  = await apiGet(`/publishers/${PUBLISHER_ID}/programmes?relationship=joined&countryCode=${REGION}`);
    const list = Array.isArray(raw) ? raw : (raw.programmes || raw.data || []);

    const programmes = list.map(p => {
      const id     = String(p.id ?? "");
      const name   = p.name || p.programName || "";
      const metaId = ADV_META[id]   || {};
      const metaNm = ADV_META[name] || {};
      const meta   = Object.keys(metaId).length ? metaId : metaNm;
      return {
        id,
        name,
        icon:       meta.icon || guessIcon(p.primarySector || ""),
        cat:        meta.cat  || guessCat(p.primarySector  || ""),
        displayUrl: meta.url  || p.displayUrl || p.clickThroughUrl || "",
      };
    }).filter(p => p.id);

    console.log(`   ✅ ${programmes.length} programmes found`);
    return programmes;
  } catch (e) {
    console.warn(`   ⚠️  Programmes API failed: ${e.message}`);
    return [];
  }
}

// ── Step 2: POST to Offers API with full pagination ────────────────────────
// Implements: POST /publisher/{publisherId}/promotions
async function fetchAllOffers() {
  console.log("\n🏷️  Step 2: Fetching offers via POST API (paginated)…");

  const allOffers = [];
  let page = 1;

  while (true) {
    // Request body exactly as per API docs
    const body = {
      filters: {
        membership:  "joined",          // only joined advertisers
        regionCodes: [REGION, "AT"],    // DE + AT
        status:      "active",          // only currently valid
        type:        "all",             // promotions + vouchers
      },
      pagination: {
        page,
        pageSize: PAGE_SIZE,
      },
    };

    console.log(`   Page ${page}…`);

    let raw;
    try {
      raw = await apiPost(
        `/publisher/${PUBLISHER_ID}/promotions?accessToken=${TOKEN}`,
        body
      );
    } catch (e) {
      // Try alternative auth header format (without Bearer)
      try {
        raw = await request("POST",
          `/publisher/${PUBLISHER_ID}/promotions`,
          body
        );
      } catch (e2) {
        console.error(`   ❌ Offers API failed on page ${page}: ${e2.message}`);
        break;
      }
    }

    // API may return array directly or wrapped in an object
    const pageOffers = Array.isArray(raw)
      ? raw
      : (raw.data || raw.promotions || raw.offers || []);

    if (!pageOffers.length) {
      console.log(`   ✅ No more offers — done at page ${page}`);
      break;
    }

    allOffers.push(...pageOffers);
    console.log(`      Got ${pageOffers.length} offers (total: ${allOffers.length})`);

    // Stop if fewer results than page size = last page
    if (pageOffers.length < PAGE_SIZE) break;
    page++;
  }

  return allOffers;
}

// ── Step 3: Normalize API response → consistent schema ────────────────────
// Maps Awin API field names to the schema expected by index.html
function normalizeOffer(raw) {
  const advId  = String(raw.advertiser?.id   ?? "");
  const advNm  = raw.advertiser?.name        ?? "";
  const metaId = ADV_META[advId]             || {};
  const metaNm = ADV_META[advNm]             || {};
  const meta   = Object.keys(metaId).length ? metaId : metaNm;

  // Deeplink: prefer urlTracking (official tracking URL from API)
  const deeplink = (raw.urlTracking || "").trim()
    || buildDeeplink(advId, raw.url || meta.url || "");

  // Voucher code is nested in raw.voucher.code (per API docs)
  const code      = raw.voucher?.code      ?? "";
  const exclusive = raw.voucher?.exclusive ?? false;

  return {
    id:           String(raw.promotionId ?? raw.id ?? ""),
    advertiserId: advId,
    advertiser:   advNm,
    type:         raw.type        ?? "promotion",    // "promotion" | "voucher"
    code,                                             // from voucher.code
    exclusive,                                        // from voucher.exclusive
    title:        raw.title       ?? "",
    description:  raw.description ?? "",
    terms:        raw.terms       ?? "",
    deeplink,                                         // from urlTracking
    url:          raw.url         ?? "",
    startDate:    raw.startDate   ?? "",
    endDate:      raw.endDate     ?? "",
    dateAdded:    raw.dateAdded   ?? "",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function buildDeeplink(advId, destUrl) {
  if (!advId) return destUrl || "";
  const base = `https://www.awin1.com/cread.php?awinmid=${advId}&awinaffid=${PUBLISHER_ID}`;
  return destUrl ? `${base}&p=${encodeURIComponent(destUrl)}` : base;
}

function isValidLink(url) {
  return typeof url === "string" && url.startsWith("https://");
}

function guessCat(sector) {
  const s = sector.toLowerCase();
  if (s.includes("fashion") || s.includes("cloth")) return "Mode";
  if (s.includes("beauty")  || s.includes("health"))return "Beauty";
  if (s.includes("travel")  || s.includes("hotel")) return "Reisen";
  if (s.includes("electr")  || s.includes("tech"))  return "Elektronik";
  if (s.includes("home")    || s.includes("garden"))return "Wohnen";
  if (s.includes("sport"))                          return "Sport";
  if (s.includes("finance") || s.includes("insur")) return "Finanzen";
  return "Shopping";
}

function guessIcon(cat) {
  const s = (cat || "").toLowerCase();
  if (s.includes("fashion") || s.includes("mode"))  return "👔";
  if (s.includes("beauty")  || s.includes("kosmet"))return "💄";
  if (s.includes("sport"))                          return "🏃";
  if (s.includes("travel")  || s.includes("hotel")) return "✈️";
  if (s.includes("electr")  || s.includes("tech"))  return "💻";
  if (s.includes("home")    || s.includes("möbel")) return "🏠";
  if (s.includes("food")    || s.includes("super")) return "🛒";
  if (s.includes("finance") || s.includes("vergl")) return "💳";
  if (s.includes("gaming"))                         return "🎮";
  if (s.includes("vpn")     || s.includes("secur")) return "🛡️";
  if (s.includes("garden"))                         return "🌱";
  return "🏷️";
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log(" schnäppchenjäger1 — Awin Fetcher v4.0");
  console.log(` Publisher: ${PUBLISHER_ID} | Region: ${REGION}`);
  console.log(" API: POST /publisher/{id}/promotions (paginated)");
  console.log("══════════════════════════════════════════════════");

  if (!TOKEN) {
    console.error("\n❌ AWIN_TOKEN is not set!");
    console.error("   Add it as a GitHub Secret: AWIN_TOKEN");
    process.exit(1);
  }

  // Step 1: Get programme metadata
  const programmes = await fetchProgrammes();

  // Step 2: Fetch all offers via POST API
  const rawOffers = await fetchAllOffers();
  console.log(`\n   Raw offers received: ${rawOffers.length}`);

  // Step 3: Normalize + repair deeplinks
  const seen      = new Set();
  const offers    = [];
  let   linkFixed = 0;

  for (const raw of rawOffers) {
    const norm = normalizeOffer(raw);

    // Deduplicate by ID
    if (seen.has(norm.id)) continue;
    seen.add(norm.id);

    // Repair missing/invalid deeplinks
    if (!isValidLink(norm.deeplink)) {
      const meta = ADV_META[norm.advertiserId] || ADV_META[norm.advertiser] || {};
      norm.deeplink = buildDeeplink(norm.advertiserId, meta.url || "");
      linkFixed++;
    }

    offers.push(norm);
  }

  // Sort: soonest expiry first
  offers.sort((a, b) => {
    const da = a.endDate ? new Date(a.endDate) : new Date("2099-01-01");
    const db = b.endDate ? new Date(b.endDate) : new Date("2099-01-01");
    return da - db;
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n─── Summary ─────────────────────────────────────");
  console.log(`Programmes  : ${programmes.length}`);
  console.log(`Total offers: ${offers.length}`);
  console.log(`Vouchers    : ${offers.filter(o=>o.type==="voucher").length}`);
  console.log(`Promotions  : ${offers.filter(o=>o.type==="promotion").length}`);
  console.log(`Exclusive   : ${offers.filter(o=>o.exclusive).length}`);
  console.log(`Links fixed : ${linkFixed}`);

  const byAdv = {};
  offers.forEach(o => { byAdv[o.advertiser] = (byAdv[o.advertiser]||0)+1; });
  console.log("\n  By advertiser:");
  Object.entries(byAdv)
    .sort((a,b) => b[1]-a[1])
    .forEach(([k,v]) => console.log(`    ${k.padEnd(38)} ${v}`));

  // ── Write promotions.json ─────────────────────────────────────────────────
  const output = {
    fetchedAt:  new Date().toISOString(),
    publisher:  PUBLISHER_ID,
    region:     REGION,
    programmes,           // advertiser metadata for frontend
    count:      offers.length,
    promotions: offers,   // normalized offers
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n✅ Saved → ${OUT_FILE}`);

  // Exit with error if 0 offers (helps GitHub Actions detect failures)
  if (!offers.length && !programmes.length) {
    console.error("❌ 0 offers and 0 programmes — check AWIN_TOKEN");
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`\n❌ Fatal: ${e.message}`);
  process.exit(1);
});
