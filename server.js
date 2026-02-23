require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;

let cachedMatches = null;
let lastFetchDay = null;

// === ÖNEMLİ LİGLER ===
const IMPORTANT_LEAGUE_IDS = [
  "4328", // Premier League
  "4335", // La Liga
  "4332", // Serie A
  "4331", // Bundesliga
  "4334", // Ligue 1
  "4341", // Süper Lig
  "4480"  // UEFA Champions League
];

// === Yardımcı Fonksiyonlar ===

// Bugünün tarihi UTC olarak
function getTodayUTC() {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

// Bugün veya yarın kontrol (UTC üzerinden)
function isTodayOrTomorrowUTC(dateStr) {
  if (!dateStr) return false;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const d = new Date(dateStr);
  const eventStr = d.toISOString().split("T")[0];

  return eventStr === todayStr || eventStr === tomorrowStr;
}

// Maçları birleştirip filtrele
function mergeAndFilter(allMatches) {
  return allMatches.filter(m => {
    if (!m.dateEvent) return false;
    return isTodayOrTomorrowUTC(m.dateEvent);
  });
}

// === Fetch API Fun ===
async function fetchMatchesFromTheSportsDB() {
  try {
    console.log("Fetching from TheSportsDB V1...");

    const leaguePromises = IMPORTANT_LEAGUE_IDS.map(lid =>
      axios.get(`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${lid}`)
    );

    const results = await Promise.allSettled(leaguePromises);

    let combinedMatches = [];

    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && r.value.data && r.value.data.events) {
        r.value.data.events.forEach(m => console.log(`Fetched date: ${m.dateEvent} for league ${IMPORTANT_LEAGUE_IDS[idx]}`));
        combinedMatches.push(...r.value.data.events);
      } else {
        console.warn(`Warning: failed league fetch ${IMPORTANT_LEAGUE_IDS[idx]}`);
      }
    });

    // Bugün + yarın filtrele
    const filtered = mergeAndFilter(combinedMatches);

    cachedMatches = filtered;
    lastFetchDay = getTodayUTC();

    console.log("Matches cached:", filtered.length);
  } catch (err) {
    console.error("Error fetching leagues:", err.message);
  }
}

// === Cron: Her gün 05:00 ===
cron.schedule(
  "0 5 * * *",
  () => {
    console.log("Cron running at 05:00...");
    fetchMatchesFromTheSportsDB();
  },
  { timezone: "Europe/Istanbul" }
);

// === Endpoint ===
app.get("/matches", async (req, res) => {
  const today = getTodayUTC();

  if (!lastFetchDay || lastFetchDay !== today) {
    await fetchMatchesFromTheSportsDB();
  }

  if (!cachedMatches) return res.status(503).json({ error: "No data yet" });

  res.json({
    success: true,
    date: today,
    matches: cachedMatches,
  });
});

// === Root Endpoint ===
app.get("/", (req, res) => {
  res.send("Mac Saati Backend çalışıyor. /matches endpoint’ini kullanın.");
});

// === Server Start ===
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});