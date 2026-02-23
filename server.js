require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;

let cachedMatches = [];
let lastFetchDate = null;

// --------------------------------------------------
// Tarih format helper
// --------------------------------------------------
function formatDate(date) {
    return date.toISOString().split("T")[0];
}

// --------------------------------------------------
// API'den gelen veriyi küçült
// --------------------------------------------------
function simplifyMatches(apiResponse) {
    return apiResponse.map(match => ({
        fixtureId: match.fixture.id,
        date: match.fixture.date,
        status: match.fixture.status.short,

        league: {
            id: match.league.id,
            name: match.league.name,
            logo: match.league.logo
        },

        home: {
            id: match.teams.home.id,
            name: match.teams.home.name,
            logo: match.teams.home.logo,
            goals: match.goals.home
        },

        away: {
            id: match.teams.away.id,
            name: match.teams.away.name,
            logo: match.teams.away.logo,
            goals: match.goals.away
        }
    }));
}

// --------------------------------------------------
// TEK CALL - today + tomorrow
// --------------------------------------------------
async function fetchMatchesFromApi() {
    try {
        const now = new Date();

        const today = new Date(now);
        const tomorrow = new Date(now);
        tomorrow.setDate(today.getDate() + 1);

        const todayStr = formatDate(today);
        const tomorrowStr = formatDate(tomorrow);

        console.log("🚀 API çekiliyor:", todayStr, "-", tomorrowStr);

        const response = await axios.get(
            `https://v3.football.api-sports.io/fixtures?from=${todayStr}&to=${tomorrowStr}&timezone=Europe/Istanbul`,
            {
                headers: {
                    "x-apisports-key": process.env.API_KEY
                }
            }
        );

        cachedMatches = simplifyMatches(response.data.response);
        lastFetchDate = todayStr;

        console.log("✅ Güncellendi. Maç sayısı:", cachedMatches.length);

    } catch (error) {
        console.error("❌ API çekme hatası:", error.message);
    }
}

// --------------------------------------------------
// CRON - Her gün 05:00
// --------------------------------------------------
cron.schedule("0 5 * * *", async () => {
    console.log("⏰ 05:00 cron tetiklendi");
    await fetchMatchesFromApi();
}, {
    timezone: "Europe/Istanbul"
});

// --------------------------------------------------
// Render uyursa fallback
// --------------------------------------------------
async function ensureDataFresh() {
    const todayStr = formatDate(new Date());

    if (lastFetchDate !== todayStr) {
        console.log("⚠️ Cron kaçmış olabilir. Manuel fetch yapılıyor...");
        await fetchMatchesFromApi();
    }
}

// --------------------------------------------------
// Endpoint
// --------------------------------------------------
app.get("/matches", async (req, res) => {

    await ensureDataFresh();

    if (!cachedMatches || cachedMatches.length === 0) {
        return res.status(503).json({
            success: false,
            message: "Veri henüz hazır değil"
        });
    }

    res.json({
        success: true,
        date: lastFetchDate,
        count: cachedMatches.length,
        data: cachedMatches
    });
});

// --------------------------------------------------
app.listen(PORT, () => {
    console.log(`🔥 Server çalışıyor: ${PORT}`);
});