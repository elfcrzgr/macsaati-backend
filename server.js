require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
app.use(cors());

const PORT = 3000;
const CACHE_FILE = "matches.json";

/* ================================
   POPÜLER LİGLER (ANDROID İLE AYNI)
================================ */

const POPULAR_LEAGUES = new Set([
  203, 204, 552, 205,
  39, 140, 141, 135, 78, 61, 94, 144,
  529, 528, 143, 137, 48,
  128, 307, 525,
  2, 3, 848
]);

/* ================================
   CACHE OLUŞTURMA FONKSİYONU
================================ */

async function fetchAndCacheMatches() {
  try {
    console.log("Maç verileri çekiliyor...");

    const today = new Date();
    const tomorrow = new Date();
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

      const filtered = response.data.response.filter(match =>
        POPULAR_LEAGUES.has(match.league.id)
      );

      allMatches.push(...filtered);
    }

    const finalData = {
      updatedAt: new Date(),
      total: allMatches.length,
      response: allMatches,
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(finalData, null, 2));

    console.log("Cache başarıyla güncellendi ✅");
    console.log("Filtre sonrası toplam maç:", allMatches.length);

  } catch (error) {
    console.error("Cache hatası ❌:", error.message);
  }
}

/* ================================
   CRON JOB (Her Gün 10:00)
================================ */

cron.schedule("0 10 * * *", () => {
  fetchAndCacheMatches();
});

/* ================================
   TEST ENDPOINT
================================ */

app.get("/", (req, res) => {
  res.send("MacSaati Backend Çalışıyor 🚀");
});

/* ================================
   MATCHES ENDPOINT
================================ */

app.get("/matches", (req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    const data = fs.readFileSync(CACHE_FILE);
    res.json(JSON.parse(data));
  } else {
    res.status(404).json({ error: "Cache bulunamadı" });
  }
});

/* ================================
   SERVER BAŞLAT
================================ */

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor 🚀`);
});

/* ================================
   SUNUCU AÇILDIĞINDA CACHE OLUŞTUR
================================ */

fetchAndCacheMatches();