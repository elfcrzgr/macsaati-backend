const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

let cronJob;
let isSuspended = false;

const app = express();

const API_KEY = process.env.API_KEY;
const BASE_URL = "https://v3.football.api-sports.io/fixtures";
const DATA_FILE = path.join(__dirname, "matches.json");

// ================= POPÜLER LİGLER =================
const POPULAR_LEAGUES = new Set([
  // 🇹🇷 TÜRKİYE
  203, // Süper Lig
  204, // Trendyol 1. Lig
  205, // 2. Lig
  552, // Türkiye Kupası

  // 🇪🇺 AVRUPA KUPALARI
  2,   // Champions League
  3,   // Europa League
  848, // Conference League
  525, // UEFA Youth League

  // 🇬🇧 İNGİLTERE
  39,  // Premier League
  40,  // Championship (1. Lig)
  41,  // League One (2. Lig)
  42,  // League Two (3. Lig)

  // 🇪🇸 İSPANYA
  140, // La Liga
  141, // La Liga 2

  // 🇮🇹 İTALYA
  135, // Serie A
  136, // Serie B

  // 🇩🇪 ALMANYA
  78,  // Bundesliga
  79,  // 2. Bundesliga

  // 🇫🇷 FRANSA
  186, // Ligue 1
  187, // Ligue 2

  // 🇵🇹 PORTEKİZ
  94,  // Primeira Liga

  // 🇳🇱 HOLLANDA
  88,  // Eredivisie
  89,  // Eerste Divisie

  // 🇦🇷 ARJANTIN
  128, // Primera División

  // 🇧🇷 BREZİLYA
  71,  // Serie A
  72,  // Serie B
]);

// ========== FETCH FUNCTION ==========
async function fetchMatches() {
  if (isSuspended) {
    console.log("❌ Hesap suspend. Fetch iptal edildi.");
    return;
  }

  try {
    console.log("📡 Api-Football'dan maç verileri çekiliyor...");

    const today = new Date().toISOString().split("T")[0];

    const response = await axios.get(BASE_URL, {
      params: {
        from: today,
        to: today,
        timezone: "Europe/Istanbul"
      },
      headers: {
        "x-apisports-key": API_KEY,
      },
      timeout: 15000
    });

    // 🔴 API YANITI DEBUG
    console.log("📋 API Yanıtı:", {
      results: response.data.results,
      errors: response.data.errors,
      responseLength: response.data.response?.length || 0
    });

    // Suspend kontrolü
    if (response.data.errors && response.data.errors.access) {
      const errorMsg = response.data.errors.access.toLowerCase();
      if (errorMsg.includes("suspend")) {
        console.log("⚠️  API hesabı suspend edildi!");
        isSuspended = true;
        if (cronJob) cronJob.stop();
        return;
      }
    }

    // 🔴 TÜM MAÇLARI GÖSTER - HİÇ FİLTRE YOK
    const matches = response.data.response || [];

    console.log(`✅ ${matches.length} maç bulundu`);
    
    // 🔍 TÜM MAÇLARIN LİG ID'LERİNİ YAZDIR
    if (matches.length > 0) {
      console.log("🔍 === BUGÜNÜN TÜM MAÇLARI ===");
      matches.forEach(m => {
        console.log(`League ID: ${m.league?.id} | ${m.league?.name} | ${m.teams?.home?.name} vs ${m.teams?.away?.name} | ${m.fixture?.date}`);
      });
    }

    const dataToSave = {
      date: today,
      timestamp: Date.now(),
      response: matches,
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    console.log(`✅ ${matches.length} maç kaydedildi.`);

  } catch (err) {
    console.error("❌ API hatası:", err.response?.data?.errors || err.message);
    
    if (err.response?.status === 403) {
      isSuspended = true;
      console.log("⚠️  Hesap askıya alındı!");
    }
  }
}

// ========== İLK KONTROL ==========
function checkAndFetchIfNeeded() {
  const today = new Date().toISOString().split("T")[0];

  if (!fs.existsSync(DATA_FILE)) {
    console.log("📂 Dosya yok. İlk fetch yapılıyor...");
    fetchMatches();
    return;
  }

  try {
    const fileContent = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    
    if (fileContent.date !== today || Date.now() - fileContent.timestamp > 43200000) {
      console.log("⏰ Veri eski. Yenisi çekiliyor...");
      fetchMatches();
    } else {
      console.log("✅ Bugünün verisi mevcut.");
    }
  } catch (e) {
    console.log("⚠️  Dosya okunamadı. Yeni fetch yapılıyor...");
    fetchMatches();
  }
}

// ========== CRON (Her gün 05:00 UTC) ==========
cronJob = cron.schedule("0 5 * * *", async () => {
  console.log("🔔 05:00 UTC - Cron tetiklendi");
  await fetchMatches();
});

// ========== ROOT ROUTE ==========
app.get("/", (req, res) => {
  res.json({
    status: "Server çalışıyor ✅",
    message: "Maç verileri için /matches?date=YYYY-MM-DD'ye git",
    health: "/health",
    example: "/matches?date=2026-02-23"
  });
});

// ========== HEALTH CHECK ==========
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    suspended: isSuspended
  });
});

// ========== ROUTE: /matches ==========
app.get("/matches", (req, res) => {
  const { date } = req.query;

  if (!fs.existsSync(DATA_FILE)) {
    return res.status(503).json({
      success: false,
      message: "Veri henüz hazır değil",
    });
  }

  try {
    const fileContent = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    if (date && fileContent.date !== date) {
      return res.status(404).json({
        success: false,
        message: `${date} için veri yok`,
      });
    }

    res.json({
      success: true,
      data: fileContent,
    });
  } catch (e) {
    console.error("❌ Dosya okuması hatası:", e);
    return res.status(500).json({
      success: false,
      message: "Veri işleme hatası",
    });
  }
});

// ========== START ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`📡 API Key: ${API_KEY ? "✅ Ayarlanmış" : "❌ Eksik"}`);
  checkAndFetchIfNeeded();
});

module.exports = app;