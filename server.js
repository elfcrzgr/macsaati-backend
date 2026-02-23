const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();

const API_KEY = process.env.API_KEY;
const BASE_URL = "https://v3.football.api-sports.io/fixtures";

let cachedMatches = null;
let lastFetchDate = null;
let isFetching = false;

// ================= FETCH FUNCTION =================
async function fetchMatches() {
  try {
    console.log("Maç verileri çekiliyor...");

    const today = new Date().toISOString().split("T")[0];

    const response = await axios.get(BASE_URL, {
      params: {
        from: today,
        to: today,
      },
      headers: {
        "x-apisports-key": API_KEY,
      },
    });

    cachedMatches = response.data;
    lastFetchDate = today;

    console.log("Veri başarıyla çekildi.");
  } catch (err) {
    console.error("API hata:", err.response?.data || err.message);
  }
}

// ================= ENSURE DATA =================
async function ensureData() {
  const today = new Date().toISOString().split("T")[0];

  if (!cachedMatches || lastFetchDate !== today) {
    if (!isFetching) {
      isFetching = true;
      await fetchMatches();
      isFetching = false;
    }
  }
}

// ================= CRON =================
cron.schedule("0 5 * * *", async () => {
  console.log("05:00 Cron tetiklendi");
  await fetchMatches();
});

// ================= ROUTE =================
app.get("/matches", async (req, res) => {
  await ensureData();

  if (!cachedMatches) {
    return res.status(503).json({
      success: false,
      message: "Veri çekilemedi",
    });
  }

  res.json({
    success: true,
    data: cachedMatches,
  });
});

// ================= START =================
app.listen(3000, () => {
  console.log("Server 3000 portta çalışıyor");
});