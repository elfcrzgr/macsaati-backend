const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const app = express();
const DATA_FILE = path.join(__dirname, "all_matches.json");

// ================= YARDIMCI: LİG EŞLEŞTİRME =================
// API ID'lerini korumak için lig isimlerini ID'lere bağlıyoruz
function getLeagueInfo(leagueName) {
    const name = leagueName.toLowerCase();
    if (name.includes("süper lig")) return { id: 203, logo: "https://media.api-sports.io/football/leagues/203.png" };
    if (name.includes("tff 1. lig") || name.includes("1. lig")) return { id: 204, logo: "https://media.api-sports.io/football/leagues/204.png" };
    if (name.includes("premier league")) return { id: 39, logo: "https://media.api-sports.io/football/leagues/39.png" };
    if (name.includes("la liga")) return { id: 140, logo: "https://media.api-sports.io/football/leagues/140.png" };
    if (name.includes("serie a")) return { id: 135, logo: "https://media.api-sports.io/football/leagues/135.png" };
    return { id: 0, logo: "" }; // Bilinmeyenler için
}

// ================= SCRAPER FONKSİYONU =================
async function scrapeData(dateStr) {
    const url = `https://www.sporx.com/iddaa/canli-skor?tarih=${dateStr}`;
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(data);
        let matches = [];

        // Sporx geniş programındaki her bir lig bloğunu dön
        $(".iddaa-oyun-listesi-icerik").each((i, el) => {
            const leagueRaw = $(el).prev(".iddaa-oyun-listesi-header").find(".iddaa-oyun-listesi-header-sol").text().trim();
            const leagueInfo = getLeagueInfo(leagueRaw);

            $(el).find(".iddaa-oyun-listesi-satir").each((j, row) => {
                const time = $(row).find(".iddaa-oyun-listesi-saat").text().trim();
                const home = $(row).find(".iddaa-oyun-listesi-ev-sahibi").text().trim();
                const away = $(row).find(".iddaa-oyun-listesi-deplasman").text().trim();

                if (home && away) {
                    matches.push({
                        homeName: home,
                        awayName: away,
                        homeLogo: `https://ui-avatars.com/api/?name=${encodeURIComponent(home)}&background=random`, // Logo yoksa isimden geçici logo
                        awayLogo: `https://ui-avatars.com/api/?name=${encodeURIComponent(away)}&background=random`,
                        leagueName: leagueRaw,
                        leagueLogo: leagueInfo.logo,
                        matchTime: time,
                        leagueId: leagueInfo.id
                    });
                }
            });
        });
        return matches;
    } catch (err) {
        console.error(`${dateStr} çekilemedi:`, err.message);
        return [];
    }
}

async function updateDatabase() {
    const today = new Date().toISOString().split("T")[0];
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split("T")[0];

    const todayMatches = await scrapeData(today);
    const tomorrowMatches = await scrapeData(tomorrow);

    const db = { [today]: todayMatches, [tomorrow]: tomorrowMatches };
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    console.log("Veritabanı güncellendi.");
}

// ================= ENDPOINTS =================
app.get("/matches", (req, res) => {
    const reqDate = req.query.date; // Android'den gelen ?date=yyyy-MM-dd
    if (!fs.existsSync(DATA_FILE)) return res.status(503).send("Veri hazır değil");

    const db = JSON.parse(fs.readFileSync(DATA_FILE));
    const responseData = db[reqDate] || [];

    res.json({
        success: true,
        response: responseData // API-Football formatıyla uyumlu
    });
});

// Günde 1 kez sabah 05:00'te otomatik güncelle
cron.schedule("0 5 * * *", updateDatabase);

app.listen(3000, () => {
    console.log("Scraper aktif: http://localhost:3000");
    updateDatabase(); // Sunucu açılınca veriyi hemen çek
});