const puppeteer = require('puppeteer');
const fs = require('fs');

// 2026 Türkiye Güncel Yayıncı Listesi
const leagueConfigs = {
    52: "beIN Sports",                  // Trendyol Süper Lig
    98: "beIN Sports / TRT Spor",       // Trendyol 1. Lig
    17: "beIN Sports",                  // Premier League
    8: "S Sport",                       // LaLiga
    54: "S Sport Plus",                 // LaLiga 2
    23: "S Sport / Tivibu Spor",        // Serie A
    35: "beIN Sports / Tivibu Spor",    // Bundesliga
    34: "beIN Sports",                  // Ligue 1
    37: "TV8.5 / Exxen",                // Eredivisie
    238: "D-Smart / Spor Smart",        // Liga Portugal
    709: "CBC Sport / Yerel",           // Misli Premier League
    13363: "TV8.5 / Exxen",             // USL Championship
    19: "Tivibu / TRT Spor / Tabii",    // FA Cup
    481: "Spor Smart / D-Smart",        // AFC Şampiyonlar Ligi
    7: "TRT / Tabii",                   // UEFA Şampiyonlar Ligi
    3: "TRT / Tabii",                   // UEFA Avrupa Ligi
    848: "TRT / Tabii"                  // UEFA Konferans Ligi
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Veri motoru başlatılıyor...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // ✅ Türkiye Saat Dilimine Göre (UTC+3) Bugün ve Yarın Hesaplama
    const offset = 3 * 60 * 60 * 1000; // 3 saatlik fark
    const now = new Date();
    
    const today = new Date(now.getTime() + offset).toISOString().split('T')[0];
    const tomorrow = new Date(now.getTime() + 86400000 + offset).toISOString().split('T')[0];

    let allEvents = [];
    for (const date of [today, tomorrow]) {
        try {
            console.log(`⏳ ${date} taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) allEvents = allEvents.concat(data.events);
        } catch (e) { console.error(`❌ Hata: ${date}`); }
    }

    const seenIds = new Set();
    const finalMatches = [];

    allEvents.forEach(e => {
        const lId = e.tournament?.uniqueTournament?.id;
        if (targetLeagueIds.includes(lId) && !seenIds.has(e.id)) {
            seenIds.add(e.id);
            
            // ✅ TR Saati Sabitleme (UTC+3)
            const dateTR = new Date(e.startTimestamp * 1000 + offset);
            const fixedDate = dateTR.toISOString().split('T')[0];
            const fixedTime = dateTR.toISOString().split('T')[1].substring(0, 5);

            finalMatches.push({
                match: {
                    id: e.id,
                    fixedDate: fixedDate,
                    fixedTime: fixedTime,
                    broadcaster: leagueConfigs[lId] || "Yerel Yayın",
                    homeTeam: { 
                        id: e.homeTeam.id,
                        name: e.homeTeam.name, 
                        logo: `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` 
                    },
                    awayTeam: { 
                        id: e.awayTeam.id,
                        name: e.awayTeam.name, 
                        logo: `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` 
                    },
                    homeScore: { display: e.homeScore?.display ?? "-" },
                    awayScore: { display: e.awayScore?.display ?? "-" },
                    tournament: { 
                        id: lId, 
                        name: e.tournament.uniqueTournament.name,
                        logo: `https://api.sofascore.app/api/v1/unique-tournament/${lId}/image`
                    }
                }
            });
        }
    });

    finalMatches.sort((a, b) => a.match.fixedDate.localeCompare(b.match.fixedDate) || a.match.fixedTime.localeCompare(b.match.fixedTime));
    fs.writeFileSync("matches.json", JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    console.log(`✅ Tamamlandı. ${today} ve ${tomorrow} tarihli toplam ${finalMatches.length} maç yazıldı.`);
    await browser.close();
}
start();