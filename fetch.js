const puppeteer = require('puppeteer');
const fs = require('fs');

const leagueConfigs = {
    52: "beIN Sports", 98: "beIN Sports / TRT Spor", 17: "beIN Sports",
    8: "S Sport", 54: "S Sport Plus", 23: "S Sport / Tivibu Spor",
    35: "beIN Sports / Tivibu Spor", 34: "beIN Sports", 37: "TV8.5 / Exxen",
    238: "D-Smart / Spor Smart", 709: "CBC Sport / Yerel", 13363: "TV8.5 / Exxen",
    19: "Tivibu / TRT Spor / Tabii", 481: "Spor Smart / D-Smart",
    7: "TRT / Tabii", 3: "TRT / Tabii", 848: "TRT / Tabii"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Veri motoru başlatılıyor (Tarih Filtreli Mod)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // ✅ Türkiye saatine göre bugün ve yarını hesaplama
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
            console.log(`⏳ ${date} maç listesi alınıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data.events) {
                const filtered = data.events.filter(e => {
                    // ✅ Maçın başlama tarihini TR saat dilimine göre kontrol et
                    const matchDateTR = new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    
                    const isTargetLeague = targetLeagueIds.includes(e.tournament?.uniqueTournament?.id);
                    const isCorrectDay = (matchDateTR === date); // Sadece o güne ait maçlar
                    
                    return isTargetLeague && isCorrectDay;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`❌ Liste hatası: ${date}`); }
    }

    const finalMatches = [];
    console.log(`🔍 Toplam ${allEvents.length} maç için detaylar toplanıyor...`);

    for (const e of allEvents) {
        try {
            console.log(`   -> İşleniyor: ${e.homeTeam.name} - ${e.awayTeam.name}`);

            const details = await page.evaluate(async (id) => {
                const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                const fetchJson = async (url) => {
                    try {
                        const r = await fetch(url, { headers: { "Referer": "https://www.sofascore.com/" } });
                        return r.ok ? await r.json() : null;
                    } catch { return null; }
                };

                let info = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}`);
                let lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/lineups`);
                
                // Büyük ligler için kadro verisi gelene kadar kısa bir bekleme
                if (!lineups) {
                    await wait(800);
                    lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/lineups`);
                }

                let missing = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/missing-players`);
                return { info, lineups, missing };
            }, e.id);

            const dateTR = new Date(e.startTimestamp * 1000);
            
            finalMatches.push({
                id: e.id,
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                broadcaster: leagueConfigs[e.tournament.uniqueTournament.id] || "Yerel Yayın",
                homeTeam: { name: e.homeTeam.name, logo: `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` },
                awayTeam: { name: e.awayTeam.name, logo: `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` },
                homeScore: e.homeScore?.display ?? "-",
                awayScore: e.awayScore?.display ?? "-",
                tournament: e.tournament.uniqueTournament.name,
                details: {
                    stadium: details.info?.event?.venue?.name || "Bilinmiyor",
                    referee: details.info?.event?.referee?.name || "Açıklanmadı",
                    lineups: details.lineups,
                    missingPlayers: details.missing
                }
            });

            await new Promise(r => setTimeout(r, 400)); 
        } catch (err) { console.error(`⚠️ Hata: ${e.id}`); }
    }

    // Tarihe göre sırala
    finalMatches.sort((a, b) => a.fixedDate.localeCompare(b.fixedDate) || a.fixedTime.localeCompare(b.fixedTime));
    
    fs.writeFileSync("matches.json", JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    console.log(`✅ TEMİZLENDİ VE BİTTİ: matches.json artık sadece bugünü ve yarını kapsıyor.`);
    await browser.close();
}

start();