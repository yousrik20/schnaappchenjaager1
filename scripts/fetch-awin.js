#!/usr/bin/env node
/**
 * fetchAwinVouchers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches live promotions/vouchers from the AWIN Publisher API for every
 * advertiser in ADVERTISER_IDS, then writes the result to deals.json.
 *
 * Required environment variables (set in GitHub Actions secrets):
 *   AWIN_API_TOKEN   – your AWIN Publisher API OAuth token
 *   AWIN_PUBLISHER_ID – your AWIN Publisher ID (numeric)
 *
 * Usage:
 *   node fetchAwinVouchers.js
 *
 * Output:
 *   deals.json  (read by index.html at page load)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Config ────────────────────────────────────────────────────────────────────

const AWIN_API_TOKEN    = process.env.AWIN_API_TOKEN;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID;
const OUTPUT_FILE       = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deals.json');

// All 18 AWIN advertiser IDs from your approved directory
const ADVERTISER_IDS = [
  9399,    // NordVPN DE
  11447,   // ELV DE
  11684,   // Aosom DE/AT
  13812,   // Netto Marken-Discount DE
  25546,   // Stylevana DE
  15152,   // HRS DE & AT
  13945,   // FlixBus & FlixTrain DE
  13991,   // 100percentpure DE/AT
  114336,  // House-of-Sneakers DE
  53143,   // teppich.de
  14537,   // Baur Versand DE
  79858,   // Luftbude DE
  125144,  // ANTHBOT DE
  44635,   // Voghion Global
  28297,   // Frölich und Kaufmann DE
  9364,    // CHECK24 Partnerprogramm
  125816,  // Imou DE
  125332,  // Autofull EU
];

// Category mapping: AWIN primarySector → site category
const SECTOR_TO_CATEGORY = {
  'Electronic Superstore':       'Elektronik',
  'Electronic Accessories':      'Elektronik',
  'B2B Utility Services':        'Elektronik',
  'Clothing':                    'Mode',
  'Shoes':                       'Mode',
  'Womenswear':                  'Mode',
  'Menswear':                    'Mode',
  'Department Stores':           'Mode',
  'Furniture & Soft Furnishings':'Möbel',
  'Home & Garden':               'Möbel',
  'Hotels & Accommodation':      'Reisen',
  'Coaches':                     'Reisen',
  'Tourism & Attractions':       'Reisen',
  'Utilities':                   'Reisen',   // CHECK24
  'Health & Beauty':             'Beauty',
  'FMCG':                        'Lebensmittel',
  'Books & Subscriptions':       'Bücher',
  'Sports Equipment':            'Sport',
  'Sportswear':                  'Sport',
};

// Fallback deal data per advertiser ID (shown when AWIN API returns no active promos)
const FALLBACK_DEALS = {
  9399:   { brandName: 'NordVPN',            category: 'Elektronik',    discountValue: '40%',          description: 'Sicher surfen mit NordVPN: 40% Rabatt auf Jahresabonnements – Der modernste VPN-Dienst der Welt.',          code: 'NORDVPN40',    dealUrl: 'http://nordvpn.com/de',                 image: '🔒' },
  11447:  { brandName: 'ELV',               category: 'Elektronik',    discountValue: 'bis 5%',        description: 'Smart Home & Elektronik: Riesige Auswahl an Homematic, Homematic IP und elektronischen Innovationen.',      code: 'ELVSHOP',      dealUrl: 'https://de.elv.com',                    image: '🏠' },
  11684:  { brandName: 'Aosom',             category: 'Möbel',         discountValue: '8%',            description: 'Gartenmöbel, Heimtierbedarf & Haushalt: 8% Rabatt auf das gesamte Aosom-Sortiment.',                       code: 'AOSOM8',       dealUrl: 'https://www.aosom.de/',                  image: '🛋️' },
  13812:  { brandName: 'Netto',             category: 'Lebensmittel',  discountValue: 'bis 4%',        description: 'Netto Marken-Discount: Wöchentliche Angebote auf Lebensmittel, Haushalt & mehr im Online-Shop.',            code: 'NETTOONLINE',  dealUrl: 'https://www.netto-online.de',            image: '🛒' },
  25546:  { brandName: 'Stylevana',         category: 'Beauty',        discountValue: 'Top-Deals',     description: 'Asiatische K-Beauty & Fashion: Trendige Produkte zum besten Preis direkt aus Südkorea.',                   code: 'STYLEBEAUTY',  dealUrl: 'https://www.stylevana.com/de_DE/',       image: '✨' },
  15152:  { brandName: 'HRS',              category: 'Reisen',        discountValue: 'bis 6%',        description: 'Hotelbuchungen weltweit: Spare mit HRS – Top 3 Hotelportal in Europa für Privat- und Geschäftsreisende.',  code: 'HRSHOTEL',     dealUrl: 'https://www.hrs.de',                    image: '🏨' },
  13945:  { brandName: 'FlixBus',          category: 'Reisen',        discountValue: 'Günstig',       description: 'Europaweit günstig reisen mit FlixBus & FlixTrain – Beste Preise für Fernbus- und Zugtickets.',            code: 'FLIXSOMMER',   dealUrl: 'https://flixbus.de',                    image: '🚌' },
  13991:  { brandName: '100% Pure',        category: 'Beauty',        discountValue: '15%',           description: '100% Naturkosmetik aus Kalifornien: 15% auf alle Produkte – Vegan, nachhaltig & tierversuchsfrei.',        code: 'PURE15',       dealUrl: 'https://www.100percentpure.de/',         image: '🌿' },
  114336: { brandName: 'House of Sneakers',category: 'Mode',          discountValue: 'Exklusiv',      description: 'Limitierte & seltene Sneaker von Top-Marken – Der ultimative Shop für Sneaker-Enthusiasten.',              code: 'SNEAKERDEAL',  dealUrl: 'https://house-of-sneakers.de/',          image: '👟' },
  53143:  { brandName: 'teppich.de',       category: 'Möbel',         discountValue: 'Gratis Versand',description: 'Qualitätsteppiche & Wohnaccessoires: Kostenloser Versand auf alle Bestellungen in Deutschland.',          code: 'TEPPICHFREI',  dealUrl: 'https://www.teppich.de',                image: '🏡' },
  14537:  { brandName: 'Baur',             category: 'Mode',          discountValue: 'bis 8%',        description: 'EINFACH.SCHÖN.SHOPPEN – Fashion, Living & mehr: Riesige Auswahl bei Baur Versand.',                       code: 'BAURMODE',     dealUrl: 'https://www.baur.de/',                   image: '👗' },
  79858:  { brandName: 'Luftbude',         category: 'Möbel',         discountValue: 'Gratis Beratung',description: 'Kostenlose Lüftungsplanung & Beratung: Luftbude liefert die perfekte Lüftung für Ihr Zuhause.',          code: 'LUFT2026',     dealUrl: 'https://www.luftbude.de',               image: '🌬️' },
  125144: { brandName: 'ANTHBOT',          category: 'Elektronik',    discountValue: 'Neu',           description: 'Innovative Roboter-Rasenmäher & Smart Home Geräte – Revolutionäre Gartenpflege neu gedacht.',             code: 'ANTHBOT26',    dealUrl: 'https://de.anthbot.com/',               image: '🤖' },
  44635:  { brandName: 'Voghion',          category: 'Mode',          discountValue: 'Fabrikpreis',   description: 'Globaler Shopping-Marktplatz: Fashion, Elektronik & mehr direkt vom Hersteller – Top-Preise garantiert.', code: 'VOGHION10',    dealUrl: 'https://www.voghion.com/',              image: '🛍️' },
  28297:  { brandName: 'Frölich & Kaufmann',category: 'Bücher',       discountValue: 'Große Auswahl', description: 'Über 60.000 Bücher: Bildbände, Kochbücher, Ratgeber & Kunstbände zu starken Preisen.',                   code: 'BUCH2026',     dealUrl: 'https://www.froelichundkaufmann.de/',    image: '📚' },
  9364:   { brandName: 'CHECK24',          category: 'Reisen',        discountValue: 'bis €55',       description: 'Strom, Gas, DSL & Reisen vergleichen: Beste Konditionen und bis zu €55 Provision bei CHECK24.',           code: 'CHECK24DE',    dealUrl: 'https://www.check24.net',               image: '💡' },
  125816: { brandName: 'Imou',             category: 'Elektronik',    discountValue: 'Neu',           description: 'Smart Home Sicherheit: Kameras, Türklingeln, Smart Locks & IoT-Geräte von IMOU für Millionen Haushalte.', code: 'IMOU2026',     dealUrl: 'https://store.imou.com/de-de/',          image: '📷' },
  125332: { brandName: 'AutoFull',         category: 'Möbel',         discountValue: 'Premium',       description: 'Professionelle Gaming-Stühle: Komfort, Stil und Performance – Designed für maximale Spielfreude.',        code: 'AUTOFULL',     dealUrl: 'https://www.autofull.eu/',              image: '🎮' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[fetchAwinVouchers] ${msg}`); }
function warn(msg) { console.warn(`[fetchAwinVouchers] ⚠️  ${msg}`); }

/** Build the AWIN logo URL for a given advertiser ID */
function awinLogoUrl(advertiserId) {
  return `https://ui.awin.com/images/upload/merchant/profile/${advertiserId}.png`;
}

/**
 * Fetch all promotions for one advertiser from the AWIN API.
 * Returns an array of raw promotion objects (may be empty).
 */
async function fetchPromotionsForAdvertiser(advertiserId) {
  const url = new URL(
    `https://api.awin.com/publishers/${AWIN_PUBLISHER_ID}/promotions`
  );
  url.searchParams.set('advertiserId', advertiserId);
  url.searchParams.set('regionCode',   'DE');
  url.searchParams.set('promotionType','voucher');  // voucher | deal
  url.searchParams.set('status',       'active');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${AWIN_API_TOKEN}`,
      Accept:        'application/json',
    },
  });

  if (!res.ok) {
    warn(`AWIN API returned ${res.status} for advertiser ${advertiserId}`);
    return [];
  }

  const json = await res.json();
  // AWIN wraps results in { promotions: [...] }
  return Array.isArray(json?.promotions) ? json.promotions : [];
}

/**
 * Convert a raw AWIN promotion object into our deal schema.
 * Falls back to FALLBACK_DEALS values for missing fields.
 */
function mapPromoToDeal(promo, advertiserId, dealIndex) {
  const fb = FALLBACK_DEALS[advertiserId] ?? {};

  // Discount label: prefer voucher code discount, then description
  let discountValue = fb.discountValue ?? 'Deal';
  if (promo.discountType === 'percentage' && promo.discountAmount) {
    discountValue = `${promo.discountAmount}%`;
  } else if (promo.discountType === 'fixed' && promo.discountAmount) {
    discountValue = `€${promo.discountAmount}`;
  }

  const category =
    SECTOR_TO_CATEGORY[promo.primarySector] ??
    fb.category ??
    'Sonstiges';

  return {
    id:           parseInt(`${advertiserId}${dealIndex}`, 10),
    advertiserId: advertiserId,
    brandName:    promo.advertiserName ?? fb.brandName ?? 'Unbekannt',
    category,
    discountValue,
    description:  promo.description   ?? fb.description ?? '',
    code:         promo.code           ?? fb.code        ?? '',
    expiryDate:   promo.endDate?.split('T')[0] ?? '2026-12-31',
    startDate:    promo.startDate?.split('T')[0] ?? null,
    image:        fb.image   ?? '🏷️',
    dealUrl:      promo.clickUrl ?? promo.advertiserUrl ?? fb.dealUrl ?? '#',
    logoUrl:      awinLogoUrl(advertiserId),
    source:       'awin-api',    // marks this as live data
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Validate env vars ──
  if (!AWIN_API_TOKEN || !AWIN_PUBLISHER_ID) {
    console.error(
      '[fetchAwinVouchers] ❌  Missing AWIN_API_TOKEN or AWIN_PUBLISHER_ID.\n' +
      '   Set them as environment variables or GitHub Actions secrets.'
    );
    process.exit(1);
  }

  log(`Starting fetch for ${ADVERTISER_IDS.length} advertisers…`);

  const deals = [];
  let liveCount    = 0;
  let fallbackCount = 0;

  for (const advertiserId of ADVERTISER_IDS) {
    log(`Fetching promotions for advertiser ${advertiserId}…`);

    try {
      const promos = await fetchPromotionsForAdvertiser(advertiserId);

      if (promos.length > 0) {
        // Use the first active promotion (best/most recent)
        const best = promos[0];
        deals.push(mapPromoToDeal(best, advertiserId, deals.length + 1));
        liveCount++;
        log(`  ✅ ${promos.length} promotion(s) found – using best`);
      } else {
        // No active promos → fall back to static data
        const fb = FALLBACK_DEALS[advertiserId];
        if (fb) {
          deals.push({
            id:           deals.length + 1,
            advertiserId: advertiserId,
            source:       'fallback',
            logoUrl:      awinLogoUrl(advertiserId),
            expiryDate:   '2026-12-31',
            startDate:    null,
            ...fb,
          });
          fallbackCount++;
          log(`  ⚙️  No live promotions – using fallback data`);
        } else {
          warn(`  No fallback data for advertiser ${advertiserId} – skipping`);
        }
      }
    } catch (err) {
      warn(`  Error fetching advertiser ${advertiserId}: ${err.message}`);
      // Still include fallback so the site never goes empty
      const fb = FALLBACK_DEALS[advertiserId];
      if (fb) {
        deals.push({
          id:           deals.length + 1,
          advertiserId: advertiserId,
          source:       'fallback-error',
          logoUrl:      awinLogoUrl(advertiserId),
          expiryDate:   '2026-12-31',
          startDate:    null,
          ...fb,
        });
        fallbackCount++;
      }
    }

    // Be polite to the API – 200 ms between requests
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Write output ──
  const output = {
    lastUpdated: new Date().toISOString(),
    totalDeals:  deals.length,
    liveDeals:   liveCount,
    fallbackDeals: fallbackCount,
    deals,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  log(`\n✅ Done! Wrote ${deals.length} deals to deals.json`);
  log(`   Live from AWIN API : ${liveCount}`);
  log(`   From fallback data : ${fallbackCount}`);
}

main().catch(err => {
  console.error('[fetchAwinVouchers] Fatal error:', err);
  process.exit(1);
});
