const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

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
    console.log("🛡️ Gizli Mod (Stealth) Aktif Ediliyor...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    
    // Gerçek bir kullanıcı gibi davran
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    let allEvents = [];

    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi taranıyor...`);
            // Doğrudan API yerine ana sayfayı kullanarak çerez alıyoruz
            await page.goto(`https://www.sofascore.com/`, { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 2000)); // Sayfanın oturması için bekle
            
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            
            const content = await page.evaluate(() => document.body.innerText);
            if (!content.startsWith('{')) throw new Error("Bloklandık!");

            const data = JSON.parse(content);
            if (data.events) {
                const filtered = data.events.filter(e => {
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && e.status?.type !== 'finished';
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`❌ Liste hatası: ${e.message}`); }
    }

    const seenIds = new Set();
    const finalMatches = [];

    for (const e of allEvents) {
        if (seenIds.has(e.id)) continue; 
        seenIds.add(e.id);

        try {
            console.log(`🔍 Maç detayı: ${e.homeTeam.name}`);
            
            const details = await page.evaluate(async (id) => {
                const f = async (u) => {
                    const r = await fetch(u, { headers: { "Referer": "https://www.sofascore.com/" } });
                    return r.ok ? await r.json() : null;
                };
                return {
                    info: await f(`https://api.sofascore.com/api/v1/event/${id}`),
                    lineups: await f(`https://api.sofascore.com/api/v1/event/${id}/lineups`) || await f(`https://api.sofascore.com/api/v1/event/${id}/tactical-lineups`),
                    missing: await f(`https://api.sofascore.com/api/v1/event/${id}/missing-players`)
                };
            }, e.id);

            const dateTR = new Date(e.startTimestamp * 1000);
            const lId = e.tournament?.uniqueTournament?.id;

            finalMatches.push({
                id: e.id,
                rawTimestamp: e.startTimestamp, 
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                status: e.status.description,
                broadcaster: leagueConfigs[lId] || "Yerel Yayın",
                homeTeam: { name: e.homeTeam.name, logo: `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` },
                awayTeam: { name: e.awayTeam.name, logo: `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` },
                homeScore: e.homeScore?.display ?? "-",
                awayScore: e.awayScore?.display ?? "-",
                tournament: {
                    name: e.tournament?.uniqueTournament?.name,
                    logo: `https://api.sofascore.app/api/v1/unique-tournament/${lId}/image`
                },
                details: {
                    stadium: details.info?.event?.venue?.name || "Bilinmiyor",
                    referee: details.info?.event?.referee?.name || "Açıklanmadı",
                    lineups: details.lineups,
                    missingPlayers: details.missing
                }
            });

            await new Promise(r => setTimeout(r, 1500)); // Çok önemli: 1.5 saniye bekle
        } catch (err) { }
    }

    finalMatches.sort((a, b) => a.rawTimestamp - b.rawTimestamp);

    if (finalMatches.length > 0) {
        fs.writeFileSync("matches.json", JSON.stringify({ matches: finalMatches }, null, 2));
        console.log(`✅ ${finalMatches.length} maç zamana göre dizildi.`);
    } else {
        console.log("❌ Maç bulunamadı. IP değişimi gerekebilir.");
    }

    await browser.close();
}

start();