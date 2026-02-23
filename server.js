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
   SADECE CRON İÇİN API ÇEKME
================================ */
async function fetchAndCacheMatches() {
  try {

    console.log("06:00 Cron → API çağrılıyor...");

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const formatDate = (date) => date.toISOString().split("T")[0];
    const dates = [formatDate(today), formatDate(tomorrow)];

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

      allMatches.push(...filtered);
    }

    allMatches.sort((a, b) => a.time.localeCompare(b.time));

    const finalData = {
      updatedAt: new Date(),
      total: allMatches.length,
      matches: allMatches
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(finalData, null, 2));

    console.log("Cache güncellendi ✅ Toplam:", allMatches.length);

  } catch (error) {
    console.error("API hatası ❌:", error.message);
  }
}

/* ================================
   CRON → HER SABAH 06:00
================================ */
cron.schedule("0 6 * * *", () => {
  fetchAndCacheMatches();
}, {
  timezone: "Europe/Istanbul"
});

/* ================================
   ENDPOINTLER
================================ */

app.get("/", (req, res) => {
  res.send("MacSaati Backend Çalışıyor 🚀");
});

// SADECE CACHE OKUR
app.get("/matches", (req, res) => {

  if (fs.existsSync(CACHE_FILE)) {
    const data = fs.readFileSync(CACHE_FILE);
    res.json(JSON.parse(data));
  } else {
    res.status(404).json({
      error: "Cache henüz oluşturulmadı. 06:00 cron bekleniyor."
    });
  }

});

// /fetch endpoint tamamen pasif
app.get("/fetch", (req, res) => {
  res.send("Manuel fetch devre dışı ❌ Sadece 06:00 cron çalışır.");
});

/* ================================
   SERVER
================================ */
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor 🚀`);
});