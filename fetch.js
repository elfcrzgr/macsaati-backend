const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// Lig yayıncı bilgileri
const leagueConfigs = {
    52: "beIN Sports", 98: "beIN Sports / TRT Spor", 17: "beIN Sports",
    8: "S Sport", 54: "S Sport Plus", 23: "S Sport / Tivibu Spor",
    35: "beIN Sports / Tivibu Spor", 34: "beIN Sports", 37: "TV8.5 / Exxen",
    238: "D-Smart / Spor Smart", 709: "CBC Sport / Yerel", 13363: "TV8.5 / Exxen",
    19: "Tivibu / TRT Spor / Tabii", 481: "Spor Smart / D-Smart",
    7: "TRT / Tabii", 3: "TRT / Tabii", 848: "TRT / Tabii",
    679: "TRT / Tabii", 17015: "TRT / Tabii",
    325: "S Sport Plus / D-Smart", 155: "S Sport Plus / D-Smart",
    44: "beIN Sports / Tivibu", 955: "S Sport Plus / TV8.5"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Veri çekme işlemi başlatıldı...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const page = await browser.newPage();
    // Kendimizi gerçek bir tarayıcı gibi tanıtıyoruz
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const todayStr = getTRDate(0);
    const tomorrowStr = getTRDate(1);
    let allEvents = [];

    for (const date of [todayStr, tomorrowStr]) {
        try {
            console.log(`⏳ ${date} maçları alınıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data.events) {
                const filtered = data.events.filter(e => {
                    const matchDateTR = new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && (matchDateTR === date);
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) {
            console.error(`${date} verisi çekilirken hata oluştu:`, e.message);
        }
    }

    const finalMatches = [];
    for (const e of allEvents) {
        try {
            const details = await page.evaluate(async (id) => {
                const headers = { "Referer": "https://www.sofascore.com/" };
                const r = await fetch(`https://api.sofascore.com/api/v1/event/${id}`, { headers });
                const info = r.ok ? await r.json() : null;
                const lR = await fetch(`https://api.sofascore.com/api/v1/event/${id}/lineups`, { headers });
                return { 
                    stadium: info?.event?.venue?.name || "Bilinmiyor",
                    referee: info?.event?.referee?.name || "Açıklanmadı",
                    hasLineup: lR.ok 
                };
            }, e.id);

            const dateTR = new Date(e.startTimestamp * 1000);

            // LOGOLARIN DOĞRUDAN SOFASCORE ÜZERİNDEN ÇEKİLDİĞİ KISIM
            finalMatches.push({
                id: e.id,
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                timestamp: dateTR.getTime(),
                broadcaster: leagueConfigs[e.tournament.uniqueTournament.id] || "Yerel Yayın",
                homeTeam: { 
                    name: e.homeTeam.name, 
                    logo: `https://www.sofascore.com/static3/images/team-logo/${e.homeTeam.id}` 
                },
                awayTeam: { 
                    name: e.awayTeam.name, 
                    logo: `https://www.sofascore.com/static3/images/team-logo/${e.awayTeam.id}` 
                },
                homeScore: e.homeScore?.display ?? "-",
                awayScore: e.awayScore?.display ?? "-",
                tournament: e.tournament.uniqueTournament.name,
                details: details
            });
        } catch (err) {
            console.error(`Maç detay hatası (ID: ${e.id}):`, err.message);
        }
    }

    // Zaman sıralaması
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    const jsonOutput = {
        success: true,
        version: Date.now(),
        lastUpdated: new Date().toISOString(),
        matches: finalMatches
    };

    fs.writeFileSync("matches.json", JSON.stringify(jsonOutput, null, 2));
    console.log(`✅ İşlem tamamlandı. ${finalMatches.length} maç matches.json dosyasına yazıldı.`);
    
    await browser.close();
}

start();
