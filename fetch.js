const puppeteer = require('puppeteer-extra'); // 'puppeteer' yerine 'puppeteer-extra' kullanıyoruz
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const leagueConfigs = {
    // Mevcut Ligler ve Yayıncılar (Senin listen...)
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
    console.log("🚀 Veri motoru başlatılıyor...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled' // Otomasyon olduğunu gizler
        ] 
    });

    const page = await browser.newPage();

    // Gerçekçi bir tarayıcı kimliği
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

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
            console.log(`⏳ ${date} maç listesi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });

            const data = await page.evaluate(() => JSON.parse(document.body.innerText));

            if (data.events) {
                const filtered = data.events.filter(e => {
                    const matchDateTR = new Date(e.startTimestamp * 1000)
                        .toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && (matchDateTR === date);
                });
                console.log(`   ✓ ${filtered.length} maç bulundu.`);
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) {
            console.error(`❌ ${date} listesi çekilemedi.`);
        }
    }

    const finalMatches = [];

    for (const e of allEvents) {
        try {
            console.log(`🔍 Detaylar: ${e.homeTeam.name} - ${e.awayTeam.name}`);

            const details = await page.evaluate(async (id) => {
                const fetchJson = async (url) => {
                    try {
                        const r = await fetch(url, { headers: { "Referer": "https://www.sofascore.com/" } });
                        return r.ok ? await r.json() : null;
                    } catch { return null; }
                };
                let info = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}`);
                let lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/lineups`);
                if (!lineups) lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/tactical-lineups`);
                let missing = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/missing-players`);
                return { info, lineups, missing };
            }, e.id);

            const dateTR = new Date(e.startTimestamp * 1000);

            finalMatches.push({
                id: e.id,
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                timestamp: dateTR.getTime(),
                broadcaster: leagueConfigs[e.tournament.uniqueTournament.id] || "Yerel Yayın",
                homeTeam: {
                    name: e.homeTeam.name,
                    id: e.homeTeam.id,
                    logo: `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image`
                },
                awayTeam: {
                    name: e.awayTeam.name,
                    id: e.awayTeam.id,
                    logo: `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image`
                },
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

            // SofaScore'u kızdırmamak için her maç detayından sonra rastgele bekleme (800ms - 1500ms)
            await new Promise(r => setTimeout(r, 800 + Math.random() * 700));

        } catch (err) {
            console.error(`⚠️ ${e.id} nolu maç işlenirken hata oluştu.`);
        }
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    const jsonOutput = {
        success: true,
        version: Date.now(),
        lastUpdated: new Date().toISOString(),
        generatedAt: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
        totalMatches: finalMatches.length,
        matches: finalMatches
    };

    fs.writeFileSync("matches.json", JSON.stringify(jsonOutput, null, 2));
    console.log(`\n✅ İşlem Tamam: ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start().catch(err => {
    console.error("❌ ANA HATA:", err);
    process.exit(1);
});