const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// =========================================================================
// 🎾 AKILLI SEVİYE KONTROLÜ
// =========================================================================
const checkMatchLevel = (tournamentName) => {
    if (!tournamentName) return { isAccepted: false, isElite: false };
    
    const name = tournamentName.toUpperCase();
    
    // 🛑 Kesinlikle İstemediğimiz Seviyeler (Gürültü Kirliliği)
    if (name.includes("ITF") || name.includes("CHALLENGER") || name.includes("UTR") || name.includes("QUALIFYING") || name.includes("QUALIFIERS")) {
        return { isAccepted: false, isElite: false };
    }

    // 🏆 ELİT SEVİYE (500, 1000, Slam)
    const eliteKeywords = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "MASTERS", "1000", "500", "FINALS", "OLYMPIC", "MONTE CARLO", "MADRID", "ROME"];
    const isElite = eliteKeywords.some(k => name.includes(k));

    // ✅ STANDART SEVİYE (En az 250'lik maçlar)
    const isStandard = name.includes("250") || isElite;

    return { isAccepted: isStandard, isElite: isElite };
};

async function start() {
    console.log("🚀 Tenis Akıllı Filtreleme (250+ Seviye) Başlatıldı...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let rawEvents = [];

    // Günlük programdan sadece 250+ olanları topla
    for (const date of targetDates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const level = checkMatchLevel(e.tournament.name);
                    return level.isAccepted; // Sadece 250 ve üstü ise kabul et (Canlı olsa bile alt seviyeyi alma)
                });
                rawEvents.push(...filtered);
            }
        } catch (e) {}
    }

    // 🔍 İNATÇI MOD: Monte Carlo (2391) gibi turnuvaları her zaman kontrol et (Finalistler belli olmasa bile)
    // Bu kısım senin önceki "hayalet maç" sorununu çözecek.
    const stubbornIds = [2391]; 
    for (const tid of stubbornIds) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/seasons`, { waitUntil: 'networkidle2' });
            const sData = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (sData?.seasons?.[0]?.id) {
                const sid = sData.seasons[0].id;
                for (const range of ['0', '1']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/season/${sid}/events/next/${range}`, { waitUntil: 'networkidle2' });
                    const eData = await page.evaluate(() => JSON.parse(document.body.innerText));
                    if (eData?.events) rawEvents.push(...eData.events);
                }
            }
        } catch (e) {}
    }

    const finalMatchesMap = new Map();

    for (const e of rawEvents) {
        const level = checkMatchLevel(e.tournament.name);
        if (!level.isAccepted) continue;

        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: level.isElite, // Sadece 500+ olanlar true olur
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / beIN Sports",
            homeTeam: { name: e.homeTeam.name, logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] },
            awayTeam: { name: e.awayTeam.name, logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"),
            awayScore: String(e.awayScore?.display ?? "-"),
            tournament: e.tournament.name
        });
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    await browser.close();
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} kaliteli maç (250+) kaydedildi.`);
}

start();
