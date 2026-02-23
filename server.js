const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const app = express();
const DATA_FILE = path.join(__dirname, "all_matches.json");

function getLeagueInfo(leagueName) {
    const name = leagueName.toLowerCase();
    if (name.includes("süper lig")) return { id: 203, logo: "https://media.api-sports.io/football/leagues/203.png" };
    if (name.includes("1. lig")) return { id: 204, logo: "https://media.api-sports.io/football/leagues/204.png" };
    if (name.includes("premier league")) return { id: 39, logo: "https://media.api-sports.io/football/leagues/39.png" };
    if (name.includes("la liga")) return { id: 140, logo: "https://media.api-sports.io/football/leagues/140.png" };
    if (name.includes("serie a")) return { id: 135, logo: "https://media.api-sports.io/football/leagues/135.png" };
    return { id: 0, logo: "" };
}

async function scrapeData(dateStr) {
    // Sporx yerine daha stabil bir URL yapısı deniyoruz
    const url = `https://www.sporx.com/iddaa/canli-skor?tarih=${dateStr}`;
    console.log(`İstek atılıyor: ${url}`);

    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 20000
        });

        const $ = cheerio.load(data);
        let matches = [];

        // Eğer Sporx 404 vermez ama boş sayfa dönerse diye kontrol
        const rows = $(".iddaa-oyun-listesi-satir");
        console.log(`${dateStr} tarihinde bulunan satır sayısı: ${rows.length}`);

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

        return matches;
    } catch (err) {
        // Eğer hala 404 alıyorsak, Sporx bugünlük bizi bloklamış olabilir.
        console.error(`HATA [${dateStr}]:`, err.response ? `Status: ${err.response.status}` : err.message);
        return [];
    }
}

async function updateDatabase() {
    const today = new Date().toISOString().split("T")[0];
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split("T")[0];

    console.log("Veri çekme işlemi başlatıldı...");
    const todayMatches = await scrapeData(today);
    const tomorrowMatches = await scrapeData(tomorrow);

    const db = { [today]: todayMatches, [tomorrow]: tomorrowMatches };
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    console.log(`İşlem tamamlandı. Toplam Maç: ${todayMatches.length + tomorrowMatches.length}`);
}

app.get("/matches", (req, res) => {
    const reqDate = req.query.date;
    if (!fs.existsSync(DATA_FILE)) return res.status(503).json({success: false, message: "Veri hazır değil"});

    const db = JSON.parse(fs.readFileSync(DATA_FILE));
    const responseData = db[reqDate] || [];

    res.json({
        success: true,
        response: responseData
    });
});

cron.schedule("0 5 * * *", updateDatabase);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
    updateDatabase();
});