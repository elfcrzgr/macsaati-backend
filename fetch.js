const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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
    console.log("🚀 Veri motoru: Derin Sorgulama Modu (V4 - Tekrarlama Düzeltmesi)...");
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

    const dates = [getTRDate(0), getTRDate(1), getTRDate(2)];

    let allEvents = [];
    for (const date of dates) {
        try {
            console.log(`⏳ ${date} maç listesi taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                const filtered = data.events.filter(e => {
                    const matchDateTR = new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && (matchDateTR === date);
                });
                console.log(`   ✓ ${date} için ${filtered.length} maç bulundu`);
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { 
            console.error(`❌ Liste hatası: ${date}`); 
        }
    }

    console.log(`\n📊 API'den ${allEvents.length} maç bulundu`);

    // ✅ ÖNEMLİ: Deduplicate ÖNCESİ yapılmalı
    const seenIds = new Set();
    const uniqueEvents = [];
    
    for (const event of allEvents) {
        if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            uniqueEvents.push(event);
        } else {
            console.log(`   🔄 Tekrarlanan maç kaldırıldı: ${event.homeTeam.name} vs ${event.awayTeam.name} (ID: ${event.id})`);
        }
    }

    console.log(`✅ Tekrarlama sonrası: ${uniqueEvents.length} maç`);

    const finalMatches = [];
    console.log(`🔍 Maçlar için detay taranıyor...`);

    for (const e of uniqueEvents) {
        try {
            console.log(`   -> ${e.homeTeam.name} - ${e.awayTeam.name}`);

            const details = await page.evaluate(async (id) => {
                const fetchJson = async (url) => {
                    try {
                        const r = await fetch(url, { headers: { "Referer": "https://www.sofascore.com/" } });
                        return r.ok ? await r.json() : null;
                    } catch { return null; }
                };

                let info = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}`);
                let lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/lineups`);
                
                if (!lineups) {
                    lineups = await fetchJson(`https://api.sofascore.com/api/v1/event/${id}/tactical-lineups`);
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

            await new Promise(r => setTimeout(r, 600)); 
        } catch (err) { 
            console.error(`   ❌ Hata: ${err.message}`);
        }
    }

    // ✅ Saat bazında sıralama
    finalMatches.sort((a, b) => {
        const timeA = new Date(`${a.fixedDate} ${a.fixedTime}`).getTime();
        const timeB = new Date(`${b.fixedDate} ${b.fixedTime}`).getTime();
        return timeA - timeB;
    });

    // ✅ SADECE bugün ve yarının maçlarını tut
    const todayStr = getTRDate(0);
    const tomorrowStr = getTRDate(1);
    const filteredMatches = finalMatches.filter(m => 
        m.fixedDate === todayStr || m.fixedDate === tomorrowStr
    );

    // ✅ FINAL JSON YAPISI
    const jsonData = {
        success: true,
        lastUpdated: new Date().toISOString(),
        cacheKey: Date.now(), // Her güncelleme için unique key
        totalMatches: filteredMatches.length,
        matchesWithLineup: filteredMatches.filter(m => m.details.lineups).length,
        matches: filteredMatches // Array son sırada
    };

    // ✅ JSON'u yaz
    fs.writeFileSync("matches.json", JSON.stringify(jsonData, null, 2));

    console.log(`\n✅ TAMAMLANDI:`);
    console.log(`   📅 ${filteredMatches.length} maç`);
    console.log(`   🎬 ${jsonData.matchesWithLineup} kadro çekildi`);
    console.log(`   ⏰ ${new Date().toLocaleTimeString('tr-TR')}`);
    console.log(`   🔑 Cache Key: ${jsonData.cacheKey}`);
    
    await browser.close();
}

start();