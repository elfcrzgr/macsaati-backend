require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const CACHE_FILE = "matches.json";

/* ================================
   TARİH FORMAT (TR)
================================ */
function formatDateTR(date) {
  return date.toLocaleDateString("en-CA", {
    timeZone: "Europe/Istanbul"
  });
}

/* ================================
   SAAT FORMAT
================================ */
function formatTime(timeText) {
  return timeText.trim();
}

/* ================================
   SCRAPING (BUGÜN + YARIN)
================================ */
async function fetchMatches() {
  try {
    console.log("Scraping başlatıldı...");

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const dates = [formatDateTR(today), formatDateTR(tomorrow)];
    let allMatches = [];

    for (let date of dates) {

      const url = `https://int.soccerway.com/matches/${date}/`;

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      const $ = cheerio.load(response.data);

      $(".match-row").each((i, el) => {

        const time = $(el).find(".match-time").text();
        const home = $(el).find(".team-a").text().trim();
        const away = $(el).find(".team-b").text().trim();
        const league = $(el).closest(".competition").find("h2").text().trim();

        if (time && home && away) {
          allMatches.push({
            id: `${date}-${i}`,
            time: formatTime(time),
            league: {
              id: league,
              name: league,
              logo: ""
            },
            teams: {
              home: { name: home, logo: "" },
              away: { name: away, logo: "" }
            }
          });
        }

      });

      console.log(`${date} için maç sayısı:`, allMatches.length);
    }

    if (allMatches.length === 0) {
      console.log("⚠️ Veri bulunamadı. Cache güncellenmedi.");
      return false;
    }

    allMatches.sort((a, b) => a.time.localeCompare(b.time));

    const finalData = {
      updatedAt: new Date(),
      total: allMatches.length,
      matches: allMatches
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(finalData, null, 2));

    console.log("✅ Cache güncellendi:", allMatches.length);

    return true;

  } catch (err) {
    console.error("❌ Scraping hatası:", err.message);
    return false;
  }
}

/* ================================
   CRON (Her gün 09:00)
================================ */
cron.schedule("0 9 * * *", () => {
  console.log("⏰ Günlük scraping çalıştı");
  fetchMatches();
}, {
  timezone: "Europe/Istanbul"
});

/* ================================
   ENDPOINTLER
================================ */
app.get("/", (req, res) => {
  res.send("MacSaati Backend (API’siz) 🚀");
});

app.get("/matches", (req, res) => {
  if (fs.existsSync(CACHE_FILE)) {
    res.json(JSON.parse(fs.readFileSync(CACHE_FILE)));
  } else {
    res.status(404).json({ error: "Cache bulunamadı" });
  }
});

app.get("/fetch", async (req, res) => {
  const success = await fetchMatches();
  if (success) {
    res.send("Scraping başarılı ✅");
  } else {
    res.send("Scraping başarısız ❌");
  }
});

/* ================================
   SERVER
================================ */
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor 🚀`);
});