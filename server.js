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
function getToday() {
  return new Date().toISOString().split("T")[0];
}

function isTodayOrTomorrow(dateStr) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const d = new Date(dateStr);
  return (
    d.toISOString().split("T")[0] === now.toISOString().split("T")[0] ||
    d.toISOString().split("T")[0] === tomorrow.toISOString().split("T")[0]
  );
}

function mergeAndFilter(allMatches) {
  return allMatches.filter((m) => {
    if (!m.dateEvent) return false;
    return isTodayOrTomorrow(m.dateEvent);
  });
}

// === Fetch API Fun ===
async function fetchMatchesFromTheSportsDB() {
  try {
    console.log("Fetching from TheSportsDB V1...");

    const leaguePromises = IMPORTANT_LEAGUE_IDS.map((lid) =>
      axios.get(
        `https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${lid}`
      )
    );

    const results = await Promise.allSettled(leaguePromises);

    let combinedMatches = [];

    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && r.value.data && r.value.data.events) {
        combinedMatches.push(...r.value.data.events);
      } else {
        console.warn(`Warning: failed league fetch ${IMPORTANT_LEAGUE_IDS[idx]}`);
      }
    });

    // Bugün+yarın olanları filtrele
    const filtered = mergeAndFilter(combinedMatches);

    cachedMatches = filtered;
    lastFetchDay = getToday();

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
  {
    timezone: "Europe/Istanbul",
  }
);

// === Endpoint ===
app.get("/matches", async (req, res) => {
  const today = getToday();

  // İlk defa veya gün değiştiyse
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

// === Root Endpoint (opsiyonel) ===
app.get("/", (req, res) => {
  res.send("Mac Saati Backend çalışıyor. /matches endpoint’ini kullanın.");
});

// === Server Start ===
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});