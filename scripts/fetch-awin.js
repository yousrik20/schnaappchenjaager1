#!/usr/bin/env node
/**
 * fetch-awin.js — schnäppchenjäger1 v5.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches live promotions from the Awin Publisher Promotions API and writes
 * the result to promotions.json for the static GitHub Pages frontend.
 *
 * Endpoint : POST /publisher/{publisherId}/promotions
 * Auth     : Bearer {accessToken}
 * Paginated: fetches all pages automatically
 *
 * ENV:
 *   AWIN_API_TOKEN      — Awin API access token (required)
 *   AWIN_PUBLISHER_ID   — Publisher ID (default: 2851329)
 *   AWIN_REGION         — ISO 3166-1 alpha-2 (default: DE)
 * ─────────────────────────────────────────────────────────────────────────────
 */
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");

/* ── Config ──────────────────────────────────────────────────────────────── */
const TOKEN = process.env.AWIN_API_TOKEN;
const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "2851329";
const REGION = process.env.AWIN_REGION || "DE";
const OUT_FILE = path.resolve(__dirname, "..", "promotions.json");
const PAGE_SIZE = 100;

/* ── Known advertiser IDs ─────────────────────────────────────────────────
   Maps advertiser name → Awin merchant ID for logo loading and deeplinks.
   PENDING = not yet confirmed, will use fallback deeplink.
   ────────────────────────────────────────────────────────────────────────── */
const ADVERTISER_IDS = {
  "ELV DE": 11447,
  "Stylevana DE": 25546,
  "Netto Marken-Discount DE": 13812,
  "teppich.de": 53143,
  "Luftbude DE": 79858,
  "Frölich und Kaufmann DE": 28297,
  "House-of-Sneakers DE": 114336,
  CHECK24: 9364,
  "Autofull EU": 125332,
  "Imou DE": 125816,
  "NordVPN DE": 9399,
  "100percentpure DE/AT": 13991,
  "Aosom DE/AT": 11684,
  "HRS DE & AT": 15152,
  "FlixBus & FlixTrain DE": 13945,
  "Voghion Global": 44635,
  "Baur Versand DE": 14537,
  "ANTHBOT DE": 125144,
};

/* ── Category guesser ────────────────────────────────────────────────────── */
function guessCat(text) {
  const t = (text || "").toLowerCase();
  if (/elektronik|laptop|handy|smartphone|tv|kamera|gadget|tech/.test(t))
    return "Elektronik";
  if (/mode|kleidung|fashion|schuhe|sneaker|jacke|hose|hemd/.test(t))
    return "Mode";
  if (/reise|hotel|flug|urlaub|bus|bahn|zug|flixbus/.test(t)) return "Reisen";
  if (/beauty|kosmetik|pflege|parfum|make.?up|hautpflege/.test(t))
    return "Kosmetik";
  if (/haushalt|möbel|küche|teppich|wohnen|sofa|lampe/.test(t))
    return "Haushalt";
  if (/versicherung|strom|gas|energie|tarif|check24/.test(t))
    return "Versicherung";
  if (/spielzeug|kinder|baby|lego|puppe/.test(t)) return "Spielzeug";
  if (/sport|fitness|fahrrad|outdoor|laufen/.test(t)) return "Sport";
  if (/gaming|game|konsole|pc spiel|controller|stuhl/.test(t)) return "Gaming";
  if (/software|vpn|antivirus|app|digital/.test(t)) return "Software";
  if (/lebensmittel|supermarkt|essen|netto|edeka/.test(t))
    return "Lebensmittel";
  if (/gesundheit|apotheke|medizin|vitamin/.test(t)) return "Gesundheit";
  return "Sonstiges";
}

/* ── Emoji guesser ──────────────────────────────────────────────────────── */
function guessIcon(advertiser) {
  const icons = {
    CHECK24: "🔍",
    "Stylevana DE": "💄",
    "ELV DE": "🔌",
    "Netto Marken-Discount DE": "🛒",
    "HRS DE & AT": "🏨",
    "House-of-Sneakers DE": "👟",
    "Luftbude DE": "💨",
    "teppich.de": "🏠",
    "Frölich und Kaufmann DE": "🧸",
    "Autofull EU": "🎮",
    "Imou DE": "📷",
    "NordVPN DE": "🔒",
    "FlixBus & FlixTrain DE": "🚌",
    "Baur Versand DE": "📦",
    "Aosom DE/AT": "🏡",
    "Voghion Global": "🌍",
    "ANTHBOT DE": "🤖",
    "100percentpure DE/AT": "🌿",
  };
  return icons[advertiser] || "🏷️";
}

/* ── HTTP helpers ────────────────────────────────────────────────────────── */
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(
            new Error(`HTTP ${res.statusCode} — ${options.path}\n${data}`),
          );
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function apiGet(path) {
  return request({
    hostname: "api.awin.com",
    path,
    method: "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });
}

function apiPost(path, body) {
  const bodyStr = JSON.stringify(body);
  return request(
    {
      hostname: "api.awin.com",
      path,
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    },
    body,
  );
}

/* ── Fetch joined programmes ─────────────────────────────────────────────── */
async function fetchProgrammes() {
  console.log("📡 Fetching joined programmes...");
  try {
    const data = await apiGet(
      `/publishers/${PUBLISHER_ID}/programmes?relationship=joined&countryCode=${REGION}`,
    );
    const programmes = Array.isArray(data) ? data : data.programmes || [];
    console.log(`   ✓ ${programmes.length} joined programmes`);
    return programmes;
  } catch (e) {
    console.warn(`   ⚠ Could not fetch programmes: ${e.message}`);
    return [];
  }
}

/* ── Normalise a single Awin promotion object ────────────────────────────── */
function normalizeOffer(raw, programmes) {
  /* Resolve advertiser name from programme list if not present */
  const prog = programmes.find(
    (p) => String(p.id) === String(raw.advertiserId),
  );
  const advertiserName =
    raw.advertiserName ||
    raw.advertiser_name ||
    (prog ? prog.name : `Advertiser ${raw.advertiserId}`);

  /* Deeplink — use Awin tracking URL */
  const deeplink = buildDeeplink(
    raw.advertiserId,
    raw.promotionUrl || raw.url || "",
  );

  /* Terms / conditions field variants */
  const terms =
    raw.terms || raw.conditions || raw.term || raw.description2 || "";

  /* Discount extraction */
  const discountPercent = raw.discountPercent || raw.discount_percent || 0;
  const discountAmount = raw.discountAmount || raw.discount_amount || 0;

  /* Category */
  const categories =
    raw.categories ||
    guessCat(
      (raw.title || "") + " " + (raw.description || "") + " " + advertiserName,
    );

  return {
    id: String(raw.id || raw.promotionId || Math.random()),
    advertiserId: raw.advertiserId || raw.advertiser_id || null,
    advertiser: advertiserName,
    icon: guessIcon(advertiserName),
    type: raw.type || raw.promotionType || (raw.code ? "voucher" : "deal"),
    title: raw.title || raw.name || raw.description || "",
    description: raw.description || raw.details || "",
    terms: terms,
    code: raw.code || raw.voucherCode || raw.voucher_code || "",
    categories: categories,
    deeplink: deeplink,
    startDate: raw.startDate || raw.start_date || new Date().toISOString(),
    endDate: raw.endDate || raw.end_date || "",
    discountPercent,
    discountAmount,
    region: REGION,
    fetchedAt: new Date().toISOString(),
  };
}

/* ── Build Awin tracking deeplink ────────────────────────────────────────── */
function buildDeeplink(advertiserId, destinationUrl) {
  if (!advertiserId) return destinationUrl || "#";
  const encoded = encodeURIComponent(destinationUrl || "");
  return `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${PUBLISHER_ID}&ued=${encoded}`;
}

/* ── Validate deeplink ───────────────────────────────────────────────────── */
function isValidLink(link) {
  return link && link.startsWith("https://") && link.length > 30;
}

/* ── Fetch all promotions (paginated) ────────────────────────────────────── */
async function fetchAllOffers(programmes) {
  console.log("📡 Fetching promotions (paginated)...");
  const all = [];
  let page = 1;

  while (true) {
    try {
      /* Awin Offers API — POST endpoint */
      const body = {
        publisherId: parseInt(PUBLISHER_ID),
        regionCode: REGION,
        page,
        pageSize: PAGE_SIZE,
      };

      let data;
      try {
        /* Try POST endpoint first (newer API) */
        data = await apiPost(
          `/publisher/${PUBLISHER_ID}/promotions?page=${page}&pageSize=${PAGE_SIZE}&region=${REGION}`,
          body,
        );
      } catch {
        /* Fall back to GET endpoint */
        data = await apiGet(
          `/publishers/${PUBLISHER_ID}/promotions?page=${page}&pageSize=${PAGE_SIZE}&region=${REGION}`,
        );
      }

      const items = Array.isArray(data)
        ? data
        : data.promotions || data.offers || data.data || data.results || [];

      if (!items.length) {
        console.log(`   ✓ Fetched all pages (stopped at page ${page})`);
        break;
      }

      const normalized = items.map((raw) => normalizeOffer(raw, programmes));
      all.push(...normalized);
      console.log(`   Page ${page}: +${items.length} (total: ${all.length})`);

      /* Stop if fewer than PAGE_SIZE returned (last page) */
      if (items.length < PAGE_SIZE) break;
      page++;

      /* Safety limit */
      if (page > 50) {
        console.warn("   ⚠ Safety limit reached (50 pages)");
        break;
      }
    } catch (e) {
      console.error(`   ✗ Error on page ${page}: ${e.message}`);
      break;
    }
  }

  return all;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  schnäppchenjäger1 — Awin Promotion Fetcher v5.0");
  console.log("═══════════════════════════════════════════════════════");

  if (!TOKEN) {
    console.error("✗ AWIN_API_TOKEN not set. Aborting.");
    process.exit(1);
  }

  console.log(`  Publisher ID : ${PUBLISHER_ID}`);
  console.log(`  Region       : ${REGION}`);
  console.log(`  Output       : ${OUT_FILE}`);
  console.log("═══════════════════════════════════════════════════════\n");

  try {
    /* 1. Get joined programmes for name resolution */
    const programmes = await fetchProgrammes();

    /* 2. Fetch all paginated promotions */
    const promotions = await fetchAllOffers(programmes);

    /* 3. Filter: only valid deeplinks, deduplicate by id */
    const seen = new Set();
    const unique = promotions.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    /* 4. Sort: active first (not expired), then by endDate ascending */
    const now = new Date();
    unique.sort((a, b) => {
      const aExp = a.endDate ? new Date(a.endDate) < now : false;
      const bExp = b.endDate ? new Date(b.endDate) < now : false;
      if (aExp !== bExp) return aExp ? 1 : -1;
      return (a.endDate || "").localeCompare(b.endDate || "");
    });

    /* 5. Write promotions.json */
    const output = {
      fetchedAt: new Date().toISOString(),
      publisherId: PUBLISHER_ID,
      region: REGION,
      total: unique.length,
      promotions: unique,
    };

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");

    /* 6. Summary */
    const active = unique.filter(
      (p) => !p.endDate || new Date(p.endDate) >= now,
    ).length;
    const expired = unique.length - active;
    const vouchers = unique.filter((p) => p.type === "voucher").length;
    const deals = unique.filter((p) => p.type !== "voucher").length;

    console.log("\n═══════════════════════════════════════════════════════");
    console.log(
      `✅ Done! ${unique.length} promotions written to promotions.json`,
    );
    console.log(`   Active  : ${active}  |  Expired: ${expired}`);
    console.log(`   Vouchers: ${vouchers}  |  Deals  : ${deals}`);
    console.log("═══════════════════════════════════════════════════════\n");
  } catch (e) {
    console.error("✗ Fatal error:", e.message);
    process.exit(1);
  }
}

main();
