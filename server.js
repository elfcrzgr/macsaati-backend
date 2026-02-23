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
    // URL'i test edilmiş güncel formatla değiştirdik
    const url = `https://www.sporx.com/iddaa/canli-skor?tarih=${dateStr}`;
    
    try {
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,all;q=0.8'
            },
            timeout: 15000 
        });
        
        const $ = cheerio.load(data);
        let matches = [];

        // Sporx'in HTML yapısına göre en garanti kapsayıcıyı hedefliyoruz
        $(".iddaa-oyun-listesi-icerik").each((i, el) => {
            // Bir önceki element olan header'dan lig adını al
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
                        homeLogo: `https://ui-avatars.com/api/?name=${encodeURIComponent(home)}&background=random&color=fff`,
                        awayLogo: `https://ui-avatars.com/api/?name=${encodeURIComponent(away)}&background=random&color=fff`,
                        leagueName: leagueRaw,
                        leagueLogo: leagueInfo.logo,
                        matchTime: time,
                        leagueId: leagueInfo.id
                    });
                }
            });
        });

        // Eğer hala maç bulamadıysa alternatif bir seçici deneyelim (Yedek Plan)
        if (matches.length === 0) {
            console.log(`${dateStr} için ana seçici boş kaldı, alternatif deneniyor...`);
            // Buraya gerekirse başka bir tablo yapısı eklenebilir
        }

        return matches;
    } catch (err) {
        // Eğer 404 veriyorsa URL'de tarih kısmını kontrol etmeliyiz
        console.error(`${dateStr} Hatası:`, err.response ? err.response.status : err.message);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
    updateDatabase(); 
});