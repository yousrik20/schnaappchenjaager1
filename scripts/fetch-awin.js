#!/usr/bin/env node
/**
 * fetch-awin.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches ALL active promotions from "Meine Aktionen" in the Awin publisher
 * dashboard and saves them to ../promotions.json
 *
 * Usage:
 *   node scripts/fetch-awin.js
 *
 * Required environment variables:
 *   AWIN_TOKEN        — your Awin API token (from ui.awin.com → API)
 *   AWIN_PUBLISHER_ID — your publisher ID (e.g. 2851329)
 *
 * Optional:
 *   AWIN_ADVERTISER_IDS — comma-separated list (leave empty = fetch ALL)
 *   AWIN_REGION         — region code (default: DE)
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN        = process.env.AWIN_TOKEN        || "b6087dfa-4788-4a8b-bd77-ed681c73a9b3";
const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "2851329";
const REGION       = process.env.AWIN_REGION       || "DE";
const OUT_FILE     = path.join(__dirname, "..", "promotions.json");

// All your approved advertiser IDs — add/remove as needed
const ADVERTISER_IDS = (process.env.AWIN_ADVERTISER_IDS || [
  "11447",   // ELV DE
  "13537",   // Netto Marken-Discount DE
  "17171",   // Stylevana DE
  "11441",   // HRS DE & AT
  "75752",   // House-of-Sneakers DE
  "70984",   // Luftbude DE
  "23351",   // teppich.de
  "19251",   // Frölich und Kaufmann DE
  "15513",   // CHECK24
  "76707",   // Autofull EU
  "76902",   // Imou DE
  "12345",   // Aosom DE/AT
].join(",")).replace(/\s/g, "");

// Fetch ALL types from "Meine Aktionen":
const PROMOTION_TYPES = ["voucher", "deal"];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Make a GET request to the Awin API and return parsed JSON.
 * @param {string} urlPath  — path + query string
 * @returns {Promise<any>}
 */
function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.awin.com",
      port:     443,
      path:     urlPath,
      method:   "GET",
      headers:  {
        "Authorization": `Bearer ${TOKEN}`,
        "Accept":        "application/json",
        "User-Agent":    "schnäppchenjäger1-fetcher/2.0",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${body.slice(0,200)}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode} for ${urlPath}\nBody: ${body.slice(0,300)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Request timed out")); });
    req.end();
  });
}

/**
 * Fetch one promotion type for the given advertiser IDs.
 */
async function fetchType(type) {
  const qs = new URLSearchParams({
    advertiserId:  ADVERTISER_IDS,
    regionCode:    REGION,
    status:        "active",
    promotionType: type,
  });

  const urlPath = `/publishers/${PUBLISHER_ID}/promotions?${qs}`;
  console.log(`  → GET https://api.awin.com${urlPath}`);

  const raw  = await apiGet(urlPath);
  // Awin returns bare array OR { promotions:[…] } depending on API version
  const list = Array.isArray(raw)           ? raw
             : Array.isArray(raw.promotions) ? raw.promotions
             : Array.isArray(raw.data)       ? raw.data
             : [];
  console.log(`     ${type}: ${list.length} promotions`);
  return list;
}

/**
 * Normalise a single promotion object to a consistent shape.
 */
function normalise(promo, type) {
  return {
    id:           promo.id            ?? promo.promotionId ?? "",
    advertiserId: promo.advertiserId  ?? promo.advertiser?.id  ?? "",
    advertiser:   promo.advertiser?.name
               ?? promo.advertiserName
               ?? promo.advertiser
               ?? "",
    type:         type,
    code:         promo.code          ?? promo.voucherCode  ?? "",
    title:        promo.title         ?? promo.name         ?? "",
    description:  promo.description   ?? "",
    terms:        promo.terms         ?? promo.termsConds   ?? "",
    categories:   Array.isArray(promo.categories)
                    ? promo.categories.join(", ")
                    : (promo.category ?? promo.categories ?? ""),
    deeplink:     promo.deeplink
               ?? promo.trackingLink
               ?? promo.affiliateLink
               ?? "",
    startDate:    promo.startDate     ?? promo.starts ?? "",
    endDate:      promo.endDate       ?? promo.ends   ?? "",
    regionCode:   promo.regionCode    ?? REGION,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(" schnäppchenjäger1 – Awin Promotions Fetcher v2.0");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Publisher ID : ${PUBLISHER_ID}`);
  console.log(`Region       : ${REGION}`);
  console.log(`Advertisers  : ${ADVERTISER_IDS}`);
  console.log(`Output       : ${OUT_FILE}`);
  console.log("");

  if (!TOKEN) {
    console.error("ERROR: AWIN_TOKEN is not set.");
    console.error("Set it with:  export AWIN_TOKEN=your_token_here");
    process.exit(1);
  }

  // ── Fetch all promotion types ──────────────────────────────────────────────
  const allPromos = [];
  const seenIds   = new Set();

  for (const type of PROMOTION_TYPES) {
    console.log(`Fetching type: ${type} …`);
    try {
      const list = await fetchType(type);
      for (const p of list) {
        const norm = normalise(p, type);
        // Deduplicate by ID (same promo can appear in multiple types)
        const key = `${norm.id}-${norm.code}`;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          allPromos.push(norm);
        }
      }
    } catch (err) {
      console.warn(`  WARNING: Failed to fetch type "${type}": ${err.message}`);
    }
  }

  // ── Sort: soonest expiry first ────────────────────────────────────────────
  allPromos.sort((a, b) => {
    const da = a.endDate ? new Date(a.endDate) : new Date("2099-01-01");
    const db = b.endDate ? new Date(b.endDate) : new Date("2099-01-01");
    return da - db;
  });

  // ── Write output ──────────────────────────────────────────────────────────
  const output = {
    fetchedAt:  new Date().toISOString(),
    publisher:  PUBLISHER_ID,
    region:     REGION,
    count:      allPromos.length,
    promotions: allPromos,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("─── Summary ──────────────────────────────────────");
  console.log(`Total promotions saved : ${allPromos.length}`);

  // Count by advertiser
  const byAdv = {};
  for (const p of allPromos) {
    byAdv[p.advertiser] = (byAdv[p.advertiser] || 0) + 1;
  }
  for (const [adv, count] of Object.entries(byAdv).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${adv.padEnd(35)} ${count} promos`);
  }

  console.log("");
  console.log(`✅ Saved to ${OUT_FILE}`);
  console.log(`   fetchedAt: ${output.fetchedAt}`);
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
