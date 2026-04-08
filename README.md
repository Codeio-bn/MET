# SMET — Scouting Medical Incident Tracker

Een snelle, gedecentraliseerde medische coördinatietool voor meerdaagse wandelevenementen met 1000+ deelnemers.

---

## Inhoudsopgave

- [Overzicht](#overzicht)
- [Functies](#functies)
- [Tech Stack](#tech-stack)
- [Snel starten](#snel-starten)
- [Gebruik](#gebruik)
- [Database schema](#database-schema)
- [Projectstructuur](#projectstructuur)
- [Ontwikkeling (live reload)](#ontwikkeling-live-reload)

---

## Overzicht

SMET is gebouwd rond drie kernprincipes:

| Principe | Uitleg |
|---|---|
| **Zero Friction** | Geen login, geen wachtwoorden. Identificatie via URL-parameter (`?role=team10km`) |
| **Snelheid** | Van telefoon uit zak tot melding verzonden in minder dan 15 seconden |
| **Betrouwbaarheid** | Werkt op spotty 4G/5G — meldingen worden lokaal gebufferd en automatisch verzonden zodra er verbinding is |

---

## Functies

### Rapportageformulier (mobiel) — `/report?role=<team>`
- Automatische rolherkenning via URL (`/report?role=team10km`)
- GPS ophalen met visuele feedback, of handmatig een locatie op de kaart slepen
- Drie prioriteitsniveaus: **Laag** · **Middel** · **Hoog**
- Snelkeuze EHBO-materialen (pleisters, zwachtel, coldpack, etc.) met teller per item — opgeslagen als gestructureerde data
- Offline ondersteuning — meldingen worden lokaal opgeslagen en automatisch verzonden bij herverbinding
- **Inzetmelding** — bij nieuwe toewijzing: geluidssignaal + trilling + pop-up
- **ETA-presets** — kies direct 5 / 10 / 15 / 20 / 30 minuten, of voer een vrije tekst in
- Teamstatus broadcaster — beschikbaar / onderweg / bezet zichtbaar voor de coördinator

### Omstandermelding (publiek) — `/meld`
- Vereenvoudigd formulier voor omstanders
- Dringend / normaal toggle
- Automatische GPS met kaartfallback
- Optionele naam
- Offline-ondersteuning
- Meldingen worden gemarkeerd als **"Omstander"** in het dashboard zodat de coördinator ze kan verifiëren vóór inzet

### Coordinator Dashboard — `/dashboard`
- Realtime incidentenkaart via Socket.io
- Leaflet kaart (60%) met gekleurde prioriteitsmarkers
- Incidentenfeed (40%) met filtering en sortering
- Klik op een melding → kaart vliegt naar de locatie
- Klik op een pin → melding wordt geselecteerd in de feed
- **Omstandermeldingen** worden visueel onderscheiden (amber rand + badge) als verificatie vereist
- **"Aangenomen"-badge** zichtbaar zodra een team de inzet bevestigt
- **Teamworkload** — aantal actieve meldingen per team zichtbaar in het toewijzingspanel, inclusief statusstip (groen/geel/rood)
- **Locatie corrigeren** — coördinator kan een pin verplaatsen via de kaart vanuit het detailvenster
- **Activiteitenlog** — elke toewijzing, acceptatie, afwijzing en sluiting wordt bijgehouden met tijdstip
- **Geluidswaarschuwing** bij hoge prioriteit (aanpasbaar via instellingen)
- Wandelroutes per dag/evenement op de kaart met start (**S**) en finish (**F**) markers
- Evenementenfilter in de filterbalk — evenementen gesorteerd op datum
- Teamlinks panel — directe links naar rapportageformulieren per team
- Beheerpanel — meldingen sluiten, verwijderen, of alles resetten
- **Excel-export** met extra kolommen: bron (team/omstander), aangenomen-tijdstip, afgesloten-tijdstip

### Instellingen — `/settings`
| Tab | Functionaliteit |
|---|---|
| **Evenementen** | Evenementen aanmaken per datum, GPX/GeoJSON routes uploaden met kleurkeuze, waypoints uploaden |
| **Teams** | Teams toevoegen/verwijderen/hernoemen — links worden automatisch bijgewerkt |
| **Materialen** | EHBO-snelkeuze knopjes aanpassen (emoji, label) |
| **Geluid** | MP3/WAV uploaden als notificatiegeluid, testknop, terugzetten naar standaard |
| **Links** | Overzicht van alle QR-codes per team én voor de omstanderpagina — printklaar |
| **Backup** | Volledige instellingen exporteren/importeren als JSON |

### Rapportage — `/rapportage`
- Post-event overzicht van alle meldingen
- Materiaalverbruik per evenement (gestructureerd vanuit JSONB, met tekstfallback voor oudere data)
- Responstijden per melding: aangenomen om · afgesloten om · minuten tot acceptatie
- Omstandermeldingen herkenbaar via badge
- Filters op status, evenement, team en zoekterm

---

## Tech Stack

| Laag | Technologie |
|---|---|
| Frontend | React 18 · Vite · Tailwind CSS · Leaflet / react-leaflet |
| Backend | Node.js · Express · Socket.io |
| Database | PostgreSQL 16 |
| Deployment | Docker · Docker Compose · Nginx |

---

## Snel starten

### Vereisten
- [Docker Desktop](https://www.docker.com/products/docker-desktop)

### Installatie

```bash
# 1. Kloon de repository
git clone https://github.com/jouw-gebruiker/smet.git
cd smet

# 2. Maak een .env aan
cp .env.example .env
# Pas DB_PASSWORD aan in .env

# 3. Bouw en start
docker compose up -d --build
```

De applicatie is bereikbaar op **http://localhost** (of poort 3001 als 80 bezet is).

### URL-overzicht

| URL | Beschrijving |
|---|---|
| `http://localhost/dashboard` | Coordinator dashboard |
| `http://localhost/report?role=team10km` | Rapportageformulier Team 10km |
| `http://localhost/report?role=team5km` | Rapportageformulier Team 5km |
| `http://localhost/meld` | Omstander melding (publiek) |
| `http://localhost/rapportage` | Post-event rapportage |
| `http://localhost/settings` | Instellingen |

Vervang `team10km` door de gewenste rolnaam. De rol wordt opgeslagen in `localStorage` — na de eerste keer openen via URL is de parameter niet meer nodig.

---

## Gebruik

### Teams instellen
1. Ga naar `/settings` → tab **Teams**
2. Voeg teams toe met een `role` (URL-parameter) en een weergavenaam
3. Sla op — het dashboard toont direct de bijgewerkte links

### QR-codes delen
1. Ga naar `/settings` → tab **Links**
2. Alle team-QR-codes én de omstander-QR-code staan hier overzichtelijk bij elkaar
3. Print de pagina of deel de codes direct voor gebruik op het evenement

### Routes uploaden
1. Ga naar `/settings` → tab **Evenementen**
2. Maak een evenement aan met naam en datum
3. Upload een **GPX** of **GeoJSON** bestand per route
4. Kies een kleur — de route verschijnt direct op de kaart

> **GPX exporteren?** Gebruik Komoot, Strava of Garmin en exporteer als `.gpx`.

### Notificatiegeluid aanpassen
1. Ga naar `/settings` → tab **Geluid**
2. Upload een `.mp3` of `.wav` bestand
3. Test het geluid met de testknop

### Locatie van een melding corrigeren
1. Open het detailvenster van een melding (knop **i** in de feed)
2. Klik op **Locatie verplaatsen**
3. Klik op de kaart of sleep de pin naar de juiste plek
4. Klik op **Locatie opslaan**

---

## Database schema

```sql
-- Incidenten
CREATE TABLE incidents (
  id                 UUID PRIMARY KEY,
  reporter           VARCHAR(100) NOT NULL,
  priority           VARCHAR(10)  NOT NULL,   -- 'low' | 'medium' | 'high'
  status             VARCHAR(10)  NOT NULL,   -- 'open' | 'closed'
  complaint          TEXT,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  event_id           VARCHAR(100),
  event_name         VARCHAR(200),
  assigned_team      VARCHAR(100),
  rejected_by        VARCHAR(100),
  rejection_reason   TEXT,
  eta_text           VARCHAR(100),
  source             VARCHAR(20)  DEFAULT 'team',  -- 'team' | 'public'
  materials_used     JSONB        DEFAULT '[]',    -- [{key, label, icon, count}]
  assignment_history JSONB        DEFAULT '[]',    -- audit log entries
  accepted_at        TIMESTAMP WITH TIME ZONE,
  closed_at          TIMESTAMP WITH TIME ZONE
);

-- Instellingen (key-value, inclusief teamstatussen)
CREATE TABLE settings (
  key   VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL
);
```

---

## Projectstructuur

```
smet/
├── backend/
│   ├── src/
│   │   ├── index.js              # Express + Socket.io server
│   │   ├── db.js                 # PostgreSQL pool + initialisatie
│   │   └── routes/
│   │       ├── incidents.js      # CRUD incidenten + audit log
│   │       └── settings.js       # Instellingen + bestandsuploads
│   ├── Dockerfile                # Productie
│   └── Dockerfile.dev            # Ontwikkeling (nodemon)
├── frontend/
│   ├── src/
│   │   ├── views/
│   │   │   ├── ReportView.jsx        # Mobiel rapportageformulier
│   │   │   ├── DashboardView.jsx     # Coordinator dashboard
│   │   │   ├── SettingsView.jsx      # Instellingenpagina
│   │   │   ├── RapportageView.jsx    # Post-event rapportage
│   │   │   └── PublicReportView.jsx  # Omstander melding
│   │   └── lib/
│   │       └── alert.js          # Notificatiegeluid (aanpasbaar)
│   ├── Dockerfile                # Productie (Vite build → Nginx)
│   ├── Dockerfile.dev            # Ontwikkeling (Vite HMR)
│   └── nginx.conf                # Nginx proxy configuratie
├── docker-compose.yml            # Productie
├── docker-compose.dev.yml        # Ontwikkeling (live reload)
├── data/
│   ├── db/                       # PostgreSQL data (persistent volume)
│   └── uploads/                  # Geüploade bestanden (routes, geluiden)
└── .env.example
```

---

## Ontwikkeling (live reload)

Bij ontwikkeling worden bronbestanden als volume gemount — wijzigingen zijn direct zichtbaar zonder te herbouwen.

```bash
# Eerste keer (bouwt de dev images)
docker compose -f docker-compose.dev.yml up --build

# Daarna
docker compose -f docker-compose.dev.yml up
```

- **Backend** — nodemon herstart automatisch bij wijzigingen in `backend/src/`
- **Frontend** — Vite HMR pusht wijzigingen direct naar de browser

### Productie deployen

```bash
docker compose up -d --build
```

---

## Omgevingsvariabelen

Kopieer `.env.example` naar `.env` en pas aan:

```env
DB_PASSWORD=verander_dit_voor_productie
```

---

## Licentie

MIT
