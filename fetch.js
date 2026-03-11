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
    console.log("🚀 Veri motoru: Derin Sorgulama + Sıralama Modu...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

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
            console.log(`⏳ ${date} maç listesi taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                const filtered = data.events.filter(e => {
                    const matchDateTR = new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    // Sadece bitmemiş maçları ve hedef ligleri al
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && 
                           (matchDateTR === date) && 
                           (e.status.type !== 'finished');
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`❌ Liste hatası: ${date}`); }
    }

    const finalMatches = [];
    console.log(`🔍 ${allEvents.length} maç için detaylar toplanıyor...`);

    for (const e of allEvents) {
        try {
            console.log(`   -> İşleniyor: ${e.homeTeam.name} - ${e.awayTeam.name}`);

            const details = await page.evaluate(async (id) => {
                const fetchJson = async (url) => {
                    try {
                        const r = await fetch(url, { headers: { "Referer": "https://www.sofascore.com/" } });
                        return r.ok ? await r.json() : null;
                    } catch { return null; }
                };

                let info = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}`);
                let lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/lineups`) || 
                              await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/tactical-lineups`);
                let missing = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/missing-players`);
                
                return { info, lineups, missing };
            }, e.id);

            const dateTR = new Date(e.startTimestamp * 1000);
            const leagueId = e.tournament.uniqueTournament.id;
            
            finalMatches.push({
                id: e.id,
                timestamp: e.startTimestamp, // Sıralama için eklendi
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                broadcaster: leagueConfigs[leagueId] || "Yerel Yayın",
                homeTeam: { 
                    name: e.homeTeam.name, 
                    logo: `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` 
                },
                awayTeam: { 
                    name: e.awayTeam.name, 
                    logo: `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` 
                },
                homeScore: e.homeScore?.display ?? "-",
                awayScore: e.awayScore?.display ?? "-",
                // Lig hem isim hem logo olarak güncellendi
                tournament: {
                    name: e.tournament.uniqueTournament.name,
                    logo: `https://api.sofascore.app/api/v1/unique-tournament/${leagueId}/image`
                },
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

    // ✅ SAAT BAZLI SIRALAMA (Küçükten büyüğe)
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    // Kayıt
    fs.writeFileSync("matches.json", JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    
    console.log(`✅ TAMAMLANDI: ${finalMatches.length} maç zamana göre sıralandı.`);
    await browser.close();
}

start();