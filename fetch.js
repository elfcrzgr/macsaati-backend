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
    console.log("🚀 Canlı ve Gelecek Maçlar Filtreleniyor...");
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

    // Bugün ve yarını tara
    const dates = [getTRDate(0), getTRDate(1)];
    let allEvents = [];

    for (const date of dates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                // Filtreleme: Hedef liglerde olacak VE maç bitmemiş (status.type != 'finished') olacak
                const filtered = data.events.filter(e => {
                    const isTargetLeague = targetLeagueIds.includes(e.tournament?.uniqueTournament?.id);
                    const isNotFinished = e.status?.type !== 'finished'; // Bitmiş maçları ele
                    return isTargetLeague && isNotFinished;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`Hata: ${date}`); }
    }

    // ✅ Tekrarlı Maçları Engelle (Unique ID kontrolü)
    const seenIds = new Set();
    const finalMatches = [];

    for (const e of allEvents) {
        if (seenIds.has(e.id)) continue; // Eğer bu ID daha önce eklendiyse atla
        seenIds.add(e.id);

        try {
            console.log(`🔍 İnceleniyor: ${e.homeTeam.name} - ${e.awayTeam.name} (${e.status.description})`);
            
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
            
            finalMatches.push({
                id: e.id,
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                status: e.status.description, // Canlı skor takibi için durum bilgisini ekledik
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
            await new Promise(r => setTimeout(r, 600)); 
        } catch (err) { }
    }

    // Uygulamanın beklediği formatta kaydet
    fs.writeFileSync("matches.json", JSON.stringify({ matches: finalMatches }, null, 2));
    console.log(`🎉 İşlem tamam! ${finalMatches.length} aktif maç listelendi.`);
    await browser.close();
}

start();