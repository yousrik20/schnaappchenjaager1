#!/usr/bin/env node
/**
 * fetch-awin.js — schnäppchenjäger1 v6.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses the OFFICIAL Awin Publisher Promotions API (POST /publisher/{id}/promotions)
 * as documented at https://help.awin.com/apidocs/promotions
 *
 * Key fixes vs v5:
 *  - Correct request body: filters.regionCodes[], filters.status, pagination{}
 *  - Correct response mapping: promotionId, advertiser.id, advertiser.name,
 *    voucher.code, urlTracking, regions.list[]
 *  - pageSize up to 200 (was 100)
 *  - membership: "joined" → only your joined advertisers
 *  - Fetches all regions in one call via regionCodes array
 *
 * ENV:
 *   AWIN_API_TOKEN      — Awin API access token (required)
 *   AWIN_PUBLISHER_ID   — Publisher ID (default: 2851329)
 *   AWIN_REGIONS        — Comma-separated ISO codes (default: DE,AT)
 * ─────────────────────────────────────────────────────────────────────────────
 */
"use strict";

const https = require("https");
const fs    = require("fs");
const path  = require("path");

/* ── Config ──────────────────────────────────────────────────────────────── */
const TOKEN        = process.env.AWIN_API_TOKEN;
const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "2851329";
const REGIONS      = (process.env.AWIN_REGIONS || process.env.AWIN_REGION || "DE,AT")
                       .split(",").map(r => r.trim().toUpperCase());
const PAGE_SIZE    = 200; // max allowed by API
const OUT_FILE     = path.resolve(__dirname, "..", "promotions.json");

/* ── Known advertiser IDs (for logo URLs) ────────────────────────────────── */
const ADVERTISER_IDS = {
  "ELV DE": 11447, "Stylevana DE": 25546, "Netto Marken-Discount DE": 13812,
  "teppich.de": 53143, "Luftbude DE": 79858, "Frölich und Kaufmann DE": 28297,
  "House-of-Sneakers DE": 114336, "CHECK24": 9364, "Autofull EU": 125332,
  "Imou DE": 125816, "NordVPN DE": 9399, "100percentpure DE/AT": 13991,
  "Aosom DE/AT": 11684, "HRS DE & AT": 15152, "FlixBus & FlixTrain DE": 13945,
  "Voghion Global": 44635, "Baur Versand DE": 14537, "ANTHBOT DE": 125144,
};

/* ── Category guesser ────────────────────────────────────────────────────── */
function guessCat(text) {
  const t = (text || "").toLowerCase();
  if (/elektronik|laptop|handy|smartphone|tv|kamera|gadget|tech|led|überwachung|imou/.test(t)) return "Elektronik";
  if (/mode|kleidung|fashion|schuhe|sneaker|jacke|hose|hemd/.test(t))      return "Mode";
  if (/reise|hotel|flug|urlaub|bus|bahn|zug|flixbus|hrs/.test(t))          return "Reisen";
  if (/beauty|kosmetik|pflege|parfum|make.?up|hautpflege|stylevana|pure/.test(t)) return "Kosmetik";
  if (/haushalt|möbel|küche|teppich|wohnen|sofa|lampe|luftrein|luftbude/.test(t)) return "Haushalt";
  if (/versicherung|strom|gas|energie|tarif|check24/.test(t))               return "Versicherung";
  if (/spielzeug|kinder|baby|lego|puppe|frölich/.test(t))                  return "Spielzeug";
  if (/sport|fitness|fahrrad|outdoor|laufen|shark|saugen|wischen/.test(t)) return "Sport & Haushalt";
  if (/gaming|game|konsole|controller|stuhl|autofull/.test(t))             return "Gaming";
  if (/software|vpn|antivirus|nordvpn|sicherheit|anthbot/.test(t))         return "Software";
  if (/lebensmittel|supermarkt|netto|edeka|rewe/.test(t))                  return "Lebensmittel";
  if (/gesundheit|apotheke|medizin|vitamin/.test(t))                       return "Gesundheit";
  if (/baur|versand|aosom|voghion/.test(t))                                return "Shopping";
  return "Sonstiges";
}

/* ── HTTP POST helper ────────────────────────────────────────────────────── */
function apiPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: "api.awin.com",
      path:     urlPath,
      method:   "POST",
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode} on ${urlPath}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

/* ── Normalize one offer from official API response ──────────────────────── */
function normalizeOffer(raw) {
  // Official API response fields (from docs)
  const advertiserId   = raw.advertiser?.id   || null;
  const advertiserName = raw.advertiser?.name || `Advertiser ${advertiserId}`;
  const voucherCode    = raw.voucher?.code    || raw.voucherCode || raw.code || "";
  const type           = raw.type === "voucher" ? "voucher" : "deal";

  // urlTracking is the correct affiliate tracking link
  const deeplink = raw.urlTracking || raw.url || "#";

  // Build category from title + description + advertiser name
  const catText = `${advertiserName} ${raw.title || ""} ${raw.description || ""}`;
  const categories = guessCat(catText);

  return {
    id:             String(raw.promotionId || raw.id || Math.random()),
    advertiserId:   advertiserId || ADVERTISER_IDS[advertiserName] || null,
    advertiser:     advertiserName,
    type,
    title:          raw.title       || raw.description || "",
    description:    raw.description || raw.title       || "",
    terms:          raw.terms       || "",
    code:           voucherCode,
    categories,
    deeplink,
    startDate:      raw.startDate   || "",
    endDate:        raw.endDate     || "",
    discountPercent: raw.discountPercent || 0,
    discountAmount:  raw.discountAmount  || 0,
    fetchedAt:      new Date().toISOString(),
  };
}

/* ── Fetch all pages for given regions ───────────────────────────────────── */
async function fetchAllOffers() {
  console.log(`📡 Fetching active offers for regions: ${REGIONS.join(", ")}...`);
  const all  = [];
  let   page = 1;

  while (true) {
    const body = {
      filters: {
        regionCodes: REGIONS,      // correct field name per API docs
        status:      "active",     // only active offers
        membership:  "joined",     // only your joined advertisers
        type:        "all",        // vouchers + promotions
      },
      pagination: {                // correct structure per API docs
        page,
        pageSize: PAGE_SIZE,
      },
    };

    let data;
    try {
      data = await apiPost(`/publisher/${PUBLISHER_ID}/promotions`, body);
    } catch (e) {
      console.error(`   ✗ Page ${page} API call failed: ${e.message}`);
      console.error(`   Request body was: ${JSON.stringify(body)}`);
      break;
    }

    // Log raw response structure for debugging
    if (page === 1) {
      const preview = JSON.stringify(data).slice(0, 500);
      console.log(`   Raw response preview: ${preview}`);
      if (typeof data === 'object' && !Array.isArray(data)) {
        console.log(`   Response keys: ${Object.keys(data).join(', ')}`);
      }
    }

    // API returns array directly OR wrapped object
    const items = Array.isArray(data)
      ? data
      : (data.promotions || data.offers || data.data || data.results || []);

    if (!items.length) {
      console.log(`   ⚠ Page ${page} returned 0 items — full response: ${JSON.stringify(data).slice(0, 300)}`);
      break;
    }

    const normalized = items.map(normalizeOffer);
    all.push(...normalized);
    console.log(`   Page ${page}: +${items.length} offers (total: ${all.length})`);

    // Last page if fewer than PAGE_SIZE returned
    if (items.length < PAGE_SIZE) {
      console.log(`   ✓ Done — last page reached`);
      break;
    }

    page++;
    if (page > 20) { console.warn("   ⚠ Safety limit (20 pages = 4000 offers)"); break; }
  }

  return all;
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  schnäppchenjäger1 — Awin Fetch v6.0 (official API)");
  console.log("═══════════════════════════════════════════════════════");

  if (!TOKEN) {
    console.error("✗ AWIN_API_TOKEN is not set. Aborting.");
    process.exit(1);
  }

  console.log(`  Publisher ID : ${PUBLISHER_ID}`);
  console.log(`  Regions      : ${REGIONS.join(", ")}`);
  console.log(`  Page size    : ${PAGE_SIZE} (API max)`);
  console.log(`  Output       : ${OUT_FILE}`);
  console.log("═══════════════════════════════════════════════════════\n");

  try {
    const promotions = await fetchAllOffers();

    // Deduplicate by id
    const seen   = new Set();
    const unique = promotions.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    console.log(`\n📦 ${unique.length} unique offers (${promotions.length - unique.length} duplicates removed)`);

    // Sort: active first, then by endDate
    const now = new Date();
    unique.sort((a, b) => {
      const aExp = a.endDate ? new Date(a.endDate) < now : false;
      const bExp = b.endDate ? new Date(b.endDate) < now : false;
      if (aExp !== bExp) return aExp ? 1 : -1;
      return (a.endDate || "").localeCompare(b.endDate || "");
    });

    const active   = unique.filter(p => !p.endDate || new Date(p.endDate) >= now).length;
    const vouchers = unique.filter(p => p.type === "voucher").length;
    const deals    = unique.filter(p => p.type !== "voucher").length;

    const output = {
      fetchedAt:    new Date().toISOString(),
      publisherId:  PUBLISHER_ID,
      regions:      REGIONS,
      total:        unique.length,
      totalActive:  active,
      totalExpired: unique.length - active,
      promotions:   unique,
    };

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");

    console.log("═══════════════════════════════════════════════════════");
    console.log(`✅ Done! ${unique.length} offers → promotions.json`);
    console.log(`   Active  : ${active}  |  Expired : ${unique.length - active}`);
    console.log(`   Vouchers: ${vouchers}  |  Deals   : ${deals}`);
    console.log("═══════════════════════════════════════════════════════\n");

  } catch (e) {
    console.error("✗ Fatal:", e.message);
    process.exit(1);
  }
}

main();
