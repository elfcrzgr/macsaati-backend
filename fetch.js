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
    console.log("🚀 Veri motoru başlatılıyor...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // ✅ TÜRKİYE SAATİNE GÖRE BUGÜN VE YARIN
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

    console.log(`📅 Hedeflenen Tarihler: Bugün: ${today} | Yarın: ${tomorrow}`);

    let allEvents = [];
    for (const targetDate of [today, tomorrow]) {
        try {
            console.log(`⏳ ${targetDate} listesi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${targetDate}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data.events) {
                // 🔥 KRİTİK FİLTRE: Sadece o güne ait olan maçları al (Dünden sarkanları ele)
                const filtered = data.events.filter(e => {
                    const eventDate = new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    const isCorrectLeague = targetLeagueIds.includes(e.tournament?.uniqueTournament?.id);
                    return eventDate === targetDate && isCorrectLeague;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`❌ Liste hatası: ${targetDate}`); }
    }

    const finalMatches = [];
    for (const e of allEvents) {
        try {
            console.log(`   -> Detay çekiliyor: ${e.homeTeam.name} - ${e.awayTeam.name}`);

            const details = await page.evaluate(async (id) => {
                const fetchJson = async (url) => {
                    const r = await fetch(url);
                    return r.ok ? r.json() : null;
                };
                return {
                    info: await fetchJson(`https://api.sofascore.com/api/v1/event/${id}`),
                    lineups: await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/lineups`),
                    missing: await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/missing-players`)
                };
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
            await new Promise(r => setTimeout(r, 200)); 
        } catch (err) { console.error(`⚠️ Hata: ${e.id}`); }
    }

    finalMatches.sort((a, b) => a.fixedDate.localeCompare(b.fixedDate) || a.fixedTime.localeCompare(b.fixedTime));
    fs.writeFileSync("matches.json", JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    console.log(`✅ İşlem BİTTİ. Sadece ${today} ve ${tomorrow} maçları kaydedildi.`);
    await browser.close();
}

start();