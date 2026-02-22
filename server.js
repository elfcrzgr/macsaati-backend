require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const CACHE_FILE = "matches.json";

/* ================================
   POPÜLER LİGLER
================================ */
const POPULAR_LEAGUES = new Set([
  203, 204, 552, 205,
  39, 140, 141, 135, 78, 61, 94, 144,
  529, 528, 143, 137, 48,
  128, 307, 525,
  2, 3, 848
]);

/* ================================
   SAAT FORMATLAMA
================================ */
function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  });
}

/* ================================
   TARİH FORMAT (TR TIMEZONE)
================================ */
function formatDateTR(date) {
  return date.toLocaleDateString("en-CA", {
    timeZone: "Europe/Istanbul"
  });
}

/* ================================
   GÜNLÜK TEKRAR ENGELLEYİCİ
================================ */
function alreadyUpdatedToday() {
  if (!fs.existsSync(CACHE_FILE)) return false;

  const data = JSON.parse(fs.readFileSync(CACHE_FILE));
  if (!data.updatedAt) return false;

  const lastUpdate = new Date(data.updatedAt);
  const now = new Date();

  const lastDateTR = formatDateTR(lastUpdate);
  const todayTR = formatDateTR(now);

  return lastDateTR === todayTR;
}

/* ================================
   FETCH (2 GÜNLÜK)
================================ */
async function fetchAndCacheMatches() {
  try {

    if (alreadyUpdatedToday()) {
      console.log("Bugün zaten güncellenmiş. API çağrılmadı.");
      return false;
    }

    console.log("Maç verileri çekiliyor...");

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const dates = [formatDateTR(today), formatDateTR(tomorrow)];
    let allMatches = [];

    for (let date of dates) {
      const response = await axios.get(
        "https://v3.football.api-sports.io/fixtures",
        {
          headers: {
            "x-apisports-key": process.env.API_KEY,
          },
          params: {
            date: date,
            timezone: "Europe/Istanbul",
          },
        }
      );

      const filtered = response.data.response
        .filter(match => POPULAR_LEAGUES.has(match.league.id))
        .map(match => ({
          id: match.fixture.id,
          time: formatTime(match.fixture.date),
          league: {
            id: match.league.id,
            name: match.league.name,
            logo: match.league.logo
          },
          teams: {
            home: {
              name: match.teams.home.name,
              logo: match.teams.home.logo
            },
            away: {
              name: match.teams.away.name,
              logo: match.teams.away.logo
            }
          }
        }));

      console.log(`API raw (${date}):`, response.data.response.length);
      console.log(`Filtered (${date}):`, filtered.length);

      allMatches.push(...filtered);
    }

    if (allMatches.length === 0) {
      console.log("⚠️ API boş döndü. Cache korunuyor.");
      return false;
    }

    allMatches.sort((a, b) => a.time.localeCompare(b.time));

    const finalData = {
      updatedAt: new Date(),
      total: allMatches.length,
      matches: allMatches
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(finalData, null, 2));
    console.log("✅ Cache güncellendi. Toplam maç:", allMatches.length);

    return true;

  } catch (error) {
    console.error("❌ API Hatası:", error.message);
    return false;
  }
}

/* ================================
   CRON (HER GÜN 09:00)
================================ */
cron.schedule("0 9 * * *", () => {
  console.log("⏰ Günlük otomatik fetch çalıştı");
  fetchAndCacheMatches();
}, {
  timezone: "Europe/Istanbul"
});

/* ================================
   ENDPOINTLER
================================ */

// Health
app.get("/", (req, res) => {
  res.send("MacSaati Backend Çalışıyor 🚀");
});

// Cache okuma
app.get("/matches", (req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    const data = fs.readFileSync(CACHE_FILE);
    res.json(JSON.parse(data));
  } else {
    res.status(404).json({ error: "Cache bulunamadı" });
  }
});

// Manuel fetch (secret korumalı)
app.get("/fetch", async (req, res) => {

  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const success = await fetchAndCacheMatches();

  if (success) {
    res.send("Cache güncellendi ✅");
  } else {
    res.send("API çağrılmadı veya hata oluştu ❌");
  }
});

/* ================================
   SERVER
================================ */
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor 🚀`);
});