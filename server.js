const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const app = express();
const DATA_FILE = path.join(__dirname, "all_matches.json");

// Logo oluşturucu
const getLogo = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;

async function scrapeData(dateStr) {
    // Sporx yerine alternatif bir kaynağın (Örn: Skorer veya benzeri) altyapısını deniyoruz
    // Eğer bu da 404 verirse, direkt Google arama sonuçlarından çekecek bir yapıya geçeceğiz.
    const url = `https://www.skorer.com/iddaa/canli-skor?tarih=${dateStr}`;
    console.log(`Kazıma deneniyor: ${url}`);

    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'tr-TR,tr;q=0.9'
            },
            timeout: 15000
        });

        const $ = cheerio.load(data);
        let matches = [];

        // Yeni hedef siteye göre seçiciler (Bu kısım en basit maç listesi yapısına göredir)
        $(".live-score-table-row, .match-item, tr.match").each((i, el) => {
            const home = $(el).find(".home-team, .ev-takim").text().trim();
            const away = $(el).find(".away-team, .deplasman-takim").text().trim();
            const time = $(el).find(".match-time, .saat").text().trim();
            const league = $(el).closest(".league-block").find(".league-name").text().trim() || "Genel Lig";

            if (home && away) {
                matches.push({
                    homeName: home,
                    awayName: away,
                    homeLogo: getLogo(home),
                    awayLogo: getLogo(away),
                    leagueName: league,
                    leagueLogo: "",
                    matchTime: time,
                    leagueId: league.includes("Süper Lig") ? 203 : (league.includes("1. Lig") ? 204 : 0)
                });
            }
        });

        return matches;
    } catch (err) {
        console.error(`Hata oluştu (${dateStr}):`, err.message);
        return [];
    }
}

async function updateDatabase() {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    console.log("Maçlar güncelleniyor...");
    const todayMatches = await scrapeData(today);
    const tomorrowMatches = await scrapeData(tomorrow);

    // Eğer her iki site de 404 veya boş dönerse, statik ama çalışan bir test verisi ekleyelim ki uygulama boş kalmasın
    if (todayMatches.length === 0) {
        console.log("⚠️ Veri çekilemedi, test verisi oluşturuluyor...");
        todayMatches.push({
            homeName: "Veri Güncelleniyor",
            awayName: "Lütfen Bekleyin",
            homeLogo: getLogo("V"),
            awayLogo: getLogo("L"),
            leagueName: "Sistem",
            leagueLogo: "",
            matchTime: "00:00",
            leagueId: 203
        });
    }

    const db = { [today]: todayMatches, [tomorrow]: tomorrowMatches };
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    console.log("Veritabanı yazıldı.");
}

app.get("/matches", (req, res) => {
    const reqDate = req.query.date;
    if (!fs.existsSync(DATA_FILE)) return res.status(200).json({ success: true, response: [] });

    const db = JSON.parse(fs.readFileSync(DATA_FILE));
    res.json({ success: true, response: db[reqDate] || [] });
});

cron.schedule("0 5 * * *", updateDatabase);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda hazır.`);
    updateDatabase();
});