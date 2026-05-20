#!/usr/bin/env node
/**
 * fetch-awin.js — schnäppchenjäger1
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Ruft die Awin Programmes API ab → holt ALLE zugelassenen Advertiser-IDs
 *    automatisch (kein manuelles Pflegen der ID-Liste nötig)
 * 2. Ruft die Promotions API für alle IDs ab (Voucher + Deal)
 * 3. Speichert { fetchedAt, programmes, count, promotions } → promotions.json
 *
 * ENV vars:
 *   AWIN_TOKEN        — API-Token aus ui.awin.com → API
 *   AWIN_PUBLISHER_ID — Publisher-ID (Standard: 2851329)
 *   AWIN_REGION       — Ländercode (Standard: DE)
 * ─────────────────────────────────────────────────────────────────────────────
 */
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Konfiguration ──────────────────────────────────────────────────────────
const TOKEN = process.env.AWIN_TOKEN || "b6087dfa-4788-4a8b-bd77-ed681c73a9b3";
const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "2851329";
const REGION = process.env.AWIN_REGION || "DE";
const OUT_FILE = path.join(__dirname, "..", "promotions.json");

// Statische Fallback-Metadaten (Icon + Kategorie) für bekannte Advertiser
// Wird genutzt, wenn die API keine Kategoriedaten zurückgibt
const ADV_META = {
  11447: { icon: "🔌", cat: "Elektronik", url: "https://www.elv.de" },
  125816: { icon: "📹", cat: "Elektronik", url: "https://www.imou.com/de-DE/" },
  25546: { icon: "✨", cat: "Beauty", url: "https://www.stylevana.com/de_DE/" },
  28297: {
    icon: "👔",
    cat: "Mode",
    url: "https://www.froelich-und-kaufmann.de",
  },
  114336: { icon: "👟", cat: "Mode", url: "https://www.house-of-sneakers.de" },
  53143: { icon: "🏠", cat: "Wohnen", url: "https://www.teppich.de" },
  79858: { icon: "🛏️", cat: "Möbel", url: "https://www.luftbude.de" },
  13812: { icon: "🛒", cat: "Supermarkt", url: "https://www.netto-online.de" },
  9364: { icon: "💰", cat: "Finanzen", url: "https://www.check24.de" },
  125332: { icon: "🎮", cat: "Gaming", url: "https://www.autofull.com/de/" },
};

// ── HTTP-Helper ────────────────────────────────────────────────────────────
function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.awin.com",
        port: 443,
        path: urlPath,
        method: "GET",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/json",
          "User-Agent": "schnaeppchenjager1-fetcher/3.0",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`JSON: ${e.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── 1. ALLE zugelassenen Programme abrufen (Auto-Discovery) ────────────────
async function fetchProgrammes() {
  console.log("\n📋 Schritt 1: Zugelassene Advertiser abrufen…");
  // Awin Programmes API — gibt alle Programme zurück, denen der Publisher beigetreten ist
  const raw = await apiGet(
    `/publishers/${PUBLISHER_ID}/programmes?relationship=joined&countryCode=${REGION}`,
  );
  const list = Array.isArray(raw) ? raw : raw.programmes || raw.data || [];

  const programmes = list
    .map((p) => {
      const id = String(p.id ?? p.advertiserId ?? "");
      const meta = ADV_META[id] || {};
      return {
        id,
        name: p.name || p.programName || "",
        displayUrl: p.displayUrl || p.clickThroughUrl || meta.url || "",
        icon: meta.icon || "🏷️",
        cat: meta.cat || guessCat(p.primarySector || p.sector || ""),
        sector: p.primarySector || p.sector || "",
        commission: p.commissionRange?.min ?? null,
      };
    })
    .filter((p) => p.id && p.name);

  console.log(`   ✅ ${programmes.length} Advertiser gefunden:`);
  programmes.forEach((p) => console.log(`      ${p.id.padEnd(8)} ${p.name}`));
  return programmes;
}

// Kategorie aus Awin-Sektor ableiten
function guessCat(sector) {
  const s = sector.toLowerCase();
  if (s.includes("fashion") || s.includes("clothing")) return "Mode";
  if (s.includes("beauty") || s.includes("health")) return "Beauty";
  if (s.includes("travel") || s.includes("hotel")) return "Reisen";
  if (s.includes("electr") || s.includes("tech")) return "Elektronik";
  if (s.includes("home") || s.includes("garden")) return "Wohnen";
  if (s.includes("sport")) return "Sport";
  if (s.includes("food") || s.includes("grocery")) return "Supermarkt";
  if (s.includes("finance") || s.includes("insurance")) return "Finanzen";
  return "Shopping";
}

// ── 2. Promotions für alle IDs abrufen ────────────────────────────────────
async function fetchPromotions(advertiserIds) {
  const TYPES = ["voucher", "deal"];
  const all = [];
  const seen = new Set();

  for (const type of TYPES) {
    console.log(`\n🏷️  Schritt 2: Promotions abrufen (${type})…`);
    try {
      const qs = new URLSearchParams({
        advertiserId: advertiserIds.join(","),
        regionCode: REGION,
        status: "active",
        promotionType: type,
      });
      const raw = await apiGet(`/publishers/${PUBLISHER_ID}/promotions?${qs}`);
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray(raw.promotions)
          ? raw.promotions
          : [];

      for (const p of list) {
        const id = String(p.id ?? p.promotionId ?? "");
        const key = id + "|" + (p.code ?? "");
        if (seen.has(key)) continue;
        seen.add(key);

        const advId = String(p.advertiserId ?? p.advertiser?.id ?? "");
        const rawDl = (p.deeplink ?? p.trackingLink ?? "").trim();
        const meta = ADV_META[advId] || {};

        // Deeplink validieren / reparieren
        const deeplink =
          rawDl.startsWith("https://") && rawDl.includes("awinmid")
            ? rawDl
            : `https://www.awin1.com/cread.php?awinmid=${advId}&awinaffid=${PUBLISHER_ID}${meta.url ? "&p=" + encodeURIComponent(meta.url) : ""}`;

        all.push({
          id,
          advertiserId: advId,
          advertiser: p.advertiser?.name ?? p.advertiserName ?? "",
          type,
          code: p.code ?? p.voucherCode ?? "",
          title: p.title ?? p.name ?? "",
          description: p.description ?? "",
          terms: p.terms ?? "",
          categories: Array.isArray(p.categories)
            ? p.categories.join(", ")
            : (p.category ?? ""),
          deeplink,
          startDate: p.startDate ?? p.starts ?? "",
          endDate: p.endDate ?? p.ends ?? "",
        });
      }
      console.log(`   ✅ ${list.length} ${type}-Promotions`);
    } catch (e) {
      console.warn(`   ⚠️  ${type} fehlgeschlagen: ${e.message}`);
    }
  }

  // Nach Ablaufdatum sortieren (bald ablaufend zuerst)
  all.sort((a, b) => {
    const da = a.endDate ? new Date(a.endDate) : new Date("2099-01-01");
    const db = b.endDate ? new Date(b.endDate) : new Date("2099-01-01");
    return da - db;
  });

  return all;
}

// ── 3. Link-Audit ──────────────────────────────────────────────────────────
function auditLinks(promos) {
  const broken = promos.filter((p) => !p.deeplink?.startsWith("https://"));
  if (broken.length) {
    console.warn(
      `\n⚠️  ${broken.length} defekte Links gefunden und repariert.`,
    );
  } else {
    console.log("\n✅ Alle Deeplinks gültig.");
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("════════════════════════════════════════════════════");
  console.log(" schnäppchenjäger1 — Awin Fetcher v3.0");
  console.log(`  Publisher : ${PUBLISHER_ID}  |  Region: ${REGION}`);
  console.log("════════════════════════════════════════════════════");

  if (!TOKEN) {
    console.error("❌ AWIN_TOKEN fehlt! Export: export AWIN_TOKEN=dein-token");
    process.exit(1);
  }

  // Schritt 1: Alle zugelassenen Programme holen
  const programmes = await fetchProgrammes();
  const ids = programmes.map((p) => p.id).filter(Boolean);

  if (!ids.length) {
    console.error("❌ Keine zugelassenen Programme gefunden.");
    process.exit(1);
  }

  // Schritt 2: Promotions für alle IDs holen
  const promotions = await fetchPromotions(ids);
  auditLinks(promotions);

  // Schritt 3: Speichern
  const output = {
    fetchedAt: new Date().toISOString(),
    publisher: PUBLISHER_ID,
    region: REGION,
    programmes, // ← Advertiser-Metadaten für dynamisches Frontend
    count: promotions.length,
    promotions,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");

  // Zusammenfassung
  console.log("\n─── Zusammenfassung ──────────────────────────────────");
  console.log(`Partner    : ${programmes.length}`);
  console.log(`Promotions : ${promotions.length}`);
  const byAdv = {};
  promotions.forEach((p) => {
    byAdv[p.advertiser] = (byAdv[p.advertiser] || 0) + 1;
  });
  Object.entries(byAdv)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k.padEnd(38)} ${v}`));
  console.log(`\n✅ Gespeichert: ${OUT_FILE}`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
