# schnäppchenjäger1 — Awin Auto-Fetch Setup

Dieses Projekt holt automatisch alle aktiven Aktionen aus **Meine Aktionen** im Awin-Dashboard und speichert sie als `promotions.json`, die von der Website geladen wird.

---

## 📁 Projektstruktur

```
dein-repo/
├── index.html                          ← Website
├── promotions.json                     ← Wird automatisch aktualisiert
├── scripts/
│   └── fetch-awin.js                   ← Fetch-Skript (Node.js)
└── .github/
    └── workflows/
        └── fetch-promotions.yml        ← GitHub Actions Workflow
```

---

## ⚙️ Einmaliges Setup (3 Schritte)

### Schritt 1 — Awin API Token holen

1. Gehe zu [ui.awin.com](https://ui.awin.com)
2. Klicke oben rechts auf deinen Namen → **API**
3. Erstelle einen neuen Token (alle Berechtigungen aktivieren)
4. Kopiere den Token

### Schritt 2 — Token als GitHub Secret hinterlegen

1. Gehe in deinem GitHub-Repo zu:
   **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `AWIN_TOKEN`
3. Value: dein Awin API Token einfügen
4. Speichern

### Schritt 3 — Ersten Lauf manuell starten

1. Gehe zu **Actions → Fetch Awin Promotions**
2. Klicke **Run workflow → Run workflow**
3. Nach ~30 Sekunden ist `promotions.json` befüllt ✅

---

## 🔄 Automatischer Ablauf

```
Jede 6 Stunden
     │
     ▼
GitHub Actions startet fetch-awin.js
     │
     ▼
scripts/fetch-awin.js ruft Awin API auf:
  GET api.awin.com/publishers/2851329/promotions
  → type: voucher
  → type: deal
     │
     ▼
Schreibt promotions.json
     │
     ▼
Commit + Push ins Repo
     │
     ▼
GitHub Pages deployed neue Version
     │
     ▼
Besucher sehen aktuelle Gutscheine ✅
```

---

## 📋 Neue Advertiser hinzufügen

Öffne `.github/workflows/fetch-promotions.yml` und erweitere die Liste:

```yaml
AWIN_ADVERTISER_IDS: "11447,13537,17171,NEUE_ID"
```

Und in `scripts/fetch-awin.js` in der Kommentarliste:

```js
"NEUE_ID",   // Name des Advertisers
```

---

## 🖥️ Lokales Testen

```bash
# Token setzen
export AWIN_TOKEN="dein-token-hier"
export AWIN_PUBLISHER_ID="2851329"

# Skript ausführen
node scripts/fetch-awin.js
```

Output:
```
═══════════════════════════════════════════════════
 schnäppchenjäger1 – Awin Promotions Fetcher v2.0
═══════════════════════════════════════════════════
Publisher ID : 2851329
Region       : DE
Advertisers  : 11447,13537,17171,...

Fetching type: voucher …
  → GET https://api.awin.com/publishers/2851329/promotions?...
     voucher: 55 promotions
Fetching type: deal …
  → GET https://api.awin.com/publishers/2851329/promotions?...
     deal: 12 promotions

─── Summary ──────────────────────────────────────
Total promotions saved : 67
  Stylevana DE                         13
  Netto Marken-Discount DE             16
  ...

✅ Saved to /path/to/promotions.json
```

---

## 📊 promotions.json Struktur

```json
{
  "fetchedAt": "2026-04-30T08:00:00.000Z",
  "publisher": "2851329",
  "region": "DE",
  "count": 55,
  "promotions": [
    {
      "id": "12345",
      "advertiserId": "17171",
      "advertiser": "Stylevana DE",
      "type": "voucher",
      "code": "AFFSPF22",
      "title": "Suncare 22% Off",
      "description": "Member Exclusive: 22% off...",
      "terms": "...",
      "categories": "Kosmetik, Hautpflege",
      "deeplink": "https://www.awin1.com/cread.php?...",
      "startDate": "2026-04-28T11:33:00",
      "endDate": "2026-05-31T17:59:00",
      "regionCode": "DE"
    }
  ]
}
```

---

## ❓ Häufige Probleme

| Problem | Lösung |
|---|---|
| `HTTP 401` | Token abgelaufen → neuen Token in ui.awin.com erstellen |
| `0 promotions` | Advertiser-ID falsch oder Programm nicht zugelassen |
| Workflow läuft nicht | In GitHub: Actions → Enable Actions aktivieren |
| `promotions.json` leer | Manuell: Actions → Run workflow klicken |

---

## 🔑 Advertiser-IDs Referenz

| Advertiser | ID |
|---|---|
| ELV DE | 11447 |
| Netto Marken-Discount DE | 13537 |
| Stylevana DE | 17171 |
| HRS DE & AT | 11441 |
| House-of-Sneakers DE | 75752 |
| Luftbude DE | 70984 |
| teppich.de | 23351 |
| Frölich und Kaufmann DE | 19251 |
| CHECK24 | 15513 |
| Autofull EU | 76707 |
| Imou DE | 76902 |

> Neue IDs findest du in Awin unter: **Meine Aktionen → Programm-Spalte → Profil**
