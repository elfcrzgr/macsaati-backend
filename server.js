const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const app = express();

const API_KEY = process.env.API_KEY;
const BASE_URL = "https://v3.football.api-sports.io/fixtures";

const DATA_FILE = path.join(__dirname, "matches.json");

let cronJob;
let isSuspended = false;

// 🎯 Çekilecek Lig ID'leri
const IMPORTANT_LEAGUES = [
  203, // Süper Lig
  204, // 1. Lig
  39,  // Premier League
  140, // La Liga
  135, // Serie A
  78,  // Bundesliga
  61,  // Ligue 1
  2,   // Champions League
  1,   // Dünya Kupası
  4,   // Avrupa Şampiyonası
  9    // Copa America
];

// ================= FETCH =================
async function fetchMatches() {
  if (isSuspended) {
    console.log("Hesap suspend. Fetch iptal.");
    return;
  }

  try {
    console.log("Maç verileri çekiliyor...");

    const today = new Date().toISOString().split("T")[0];

    const response = await axios.get(BASE_URL, {
      params: {
        date: today
      },
      headers: {
        "x-apisports-key": API_KEY,
      },
    });

    // Suspend kontrolü
    if (
      response.data.errors &&
      response.data.errors.access &&
      response.data.errors.access.toLowerCase().includes("suspend")
    ) {
      console.log("⚠ API hesabı suspend edildi!");
      isSuspended = true;
      if (cronJob) cronJob.stop();
      return;
    }

    const allMatches = response.data.response;

    // 🎯 Sadece önemli ligleri filtrele
    const filtered = allMatches.filter(match =>
      IMPORTANT_LEAGUES.includes(match.league.id)
    );

    const dataToSave = {
      date: today,
      total: filtered.length,
      matches: filtered
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));

    console.log("Veri kaydedildi. Toplam maç:", filtered.length);

  } catch (err) {
    console.error("API hata:", err.response?.data || err.message);
  }
}

// ================= INITIAL CHECK =================
function checkAndFetchIfNeeded() {
  const today = new Date().toISOString().split("T")[0];

  if (!fs.existsSync(DATA_FILE)) {
    console.log("Dosya yok. İlk fetch yapılıyor...");
    fetchMatches();
    return;
  }

  const fileContent = JSON.parse(fs.readFileSync(DATA_FILE));

  if (fileContent.date !== today) {
    console.log("Bugünün verisi yok. Fetch yapılıyor...");
    fetchMatches();
  } else {
    console.log("Bugünün verisi mevcut.");
  }
}

// ================= CRON =================
cronJob = cron.schedule("0 5 * * *", async () => {
  console.log("05:00 Cron tetiklendi");
  await fetchMatches();
}, {
  timezone: "Europe/Istanbul"
});

// ================= ROUTE =================
app.get("/matches", (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    return res.status(503).json({
      success: false,
      message: "Veri henüz hazır değil"
    });
  }

  const fileContent = JSON.parse(fs.readFileSync(DATA_FILE));

  res.json({
    success: true,
    date: fileContent.date,
    total: fileContent.total,
    matches: fileContent.matches
  });
});

// ================= START =================
app.listen(3000, () => {
  console.log("Server 3000 portta çalışıyor");
  checkAndFetchIfNeeded();
});