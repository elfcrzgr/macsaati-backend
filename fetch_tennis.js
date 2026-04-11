const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

const ELITE_KEYWORDS = [
    "Wimbledon", "US Open", "Australian Open", "Roland Garros", "French Open", 
    "Masters", "ATP 1000", "WTA 1000", "ATP Finals", "WTA Finals", 
    "Monte Carlo", "Indian Wells", "Miami", "Madrid", "Rome", "Cincinnati", 
    "Shanghai", "Paris", "Montreal", "Toronto", "Canadian Open", "Beijing", 
    "Doha", "Dubai", "ATP 500", "WTA 500"
];

const checkIsElite = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword.toUpperCase()));
};

async function start() {
    console.log("🚀 Dinamik Tenis Motoru Başlatıldı...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let allCollectedEvents = [];
    const activeEliteTournamentIds = new Set(); // Dinamik olarak toplanacak Elite ID'ler

    // 1. ADIM: GÜNLÜK PROGRAMI TARA VE ELİT TURNUVALARI TESPİT ET
    for (const date of targetDates) {
        try {
            console.log(`📡 ${date} programı taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data?.events) {
                for (const e of data.events) {
                    allCollectedEvents.push(e);
                    // Eğer turnuva Elit ise ID'sini listeye al (Zorla çekim için)
                    const tourName = e.tournament?.name || "";
                    if (checkIsElite(tourName) && e.tournament?.uniqueTournament?.id) {
                        activeEliteTournamentIds.add(e.tournament.uniqueTournament.id);
                    }
                }
            }
        } catch (e) {}
    }

    // 2. ADIM: TESPİT EDİLEN ELİT TURNUVALARA "ZORLA" GİR (İnatçı Mod)
    // Rakipleri belli olmayan "Winner of..." maçlarını burada yakalıyoruz.
    for (const id of activeEliteTournamentIds) {
        try {
            console.log(`🎾 Elit Turnuva ID ${id} için gizli maçlar taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (seasonsData?.seasons?.length > 0) {
                const sId = seasonsData.seasons[0].id;
                // 'next/0' listesinde günlük programda olmayan placeholder maçlar bulunur
                await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${sId}/events/next/0`, { waitUntil: 'networkidle2' });
                const eventsData = await page.evaluate(() => {
                    try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
                });
                
                if (eventsData?.events) {
                    allCollectedEvents = allCollectedEvents.concat(eventsData.events);
                }
            }
        } catch (e) {}
    }

    // 3. ADIM: VERİLERİ TEMİZLE VE JSON'A HAZIRLA
    const finalMatchesMap = new Map();

    for (const e of allCollectedEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // Sadece bizim 3 günlük radarımızdaki maçları işle
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";

        const tourName = e.tournament.name || "";
        const hName = e.homeTeam.name || "Belli Değil";
        const aName = e.awayTeam.name || "Belli Değil";

        // Map kullanımı sayesinde hem günlük listeden hem inatçı moddan gelen aynı maçlar tekilleşir
        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsElite(tourName),
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / Eurosport",
            homeTeam: { 
                name: hName, 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "mc") + ".png"] 
            },
            awayTeam: { 
                name: aName, 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "mc") + ".png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: statusType === 'notstarted' ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: statusType === 'notstarted' ? "-" : String(e.awayScore?.display ?? "0"),
            tournament: tourName
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
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} maç çekildi. Placeholder maçlar dahil edildi.`);
}

start();
