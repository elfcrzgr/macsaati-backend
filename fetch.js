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
    console.log("🚀 Veri motoru: Kesin Sıralama ve Evrensel Görsel Modu...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                const filtered = data.events.filter(e => {
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && (e.status.type !== 'finished');
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`Hata: ${e.message}`); }
    }

    const finalMatches = [];
    const seenIds = new Set();

    for (const e of allEvents) {
        if (seenIds.has(e.id)) continue;
        seenIds.add(e.id);

        try {
            console.log(`🔍 İşleniyor: ${e.homeTeam.name}`);
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
            const leagueId = e.tournament.uniqueTournament.id;
            
            // ✅ Casper ve diğerleri için Google Proxy kullanarak logoları zorla
            const proxy = (url) => `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=2592000&url=${encodeURIComponent(url)}`;

            finalMatches.push({
                id: e.id,
                timestamp: e.startTimestamp,
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                broadcaster: leagueConfigs[leagueId] || "Yerel Yayın",
                homeTeam: { 
                    name: e.homeTeam.name, 
                    logo: proxy(`https://www.sofascore.com/api/v1/team/${e.homeTeam.id}/image`) 
                },
                awayTeam: { 
                    name: e.awayTeam.name, 
                    logo: proxy(`https://www.sofascore.com/api/v1/team/${e.awayTeam.id}/image`) 
                },
                homeScore: e.homeScore?.display ?? "-",
                awayScore: e.awayScore?.display ?? "-",
                tournament: {
                    name: e.tournament.uniqueTournament.name,
                    logo: proxy(`https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/image`)
                },
                details: {
                    stadium: details.info?.event?.venue?.name || "Bilinmiyor",
                    referee: details.info?.event?.referee?.name || "Açıklanmadı",
                    lineups: details.lineups,
                    missingPlayers: details.missing
                }
            });
            await new Promise(r => setTimeout(r, 700)); 
        } catch (err) { }
    }

    // ✅ KESİN SAAT SIRALAMASI
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync("matches.json", JSON.stringify({ matches: finalMatches }, null, 2));
    console.log(`✅ TAMAMLANDI: ${finalMatches.length} maç zamana göre dizildi.`);
    await browser.close();
}

start();