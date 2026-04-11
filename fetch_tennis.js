const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// =========================================================================
// 🌟 ELİT LİSTE (Bu turnuvalar priority ne olursa olsun içeri alınır)
// =========================================================================
const ELITE_KEYWORDS = [
    "Wimbledon", "US Open", "Australian Open", "Roland Garros", "French Open", 
    "Masters", "ATP 1000", "WTA 1000", "ATP Finals", "WTA Finals", 
    "Monte Carlo", "Indian Wells", "Miami", "Madrid", "Rome", "Cincinnati", 
    "Shanghai", "Paris", "Montreal", "Toronto", "Beijing", "Doha", "Dubai",
    "ATP 500", "WTA 500", "Barcelona"
];

const checkIsElite = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword.toUpperCase()));
};

async function start() {
    console.log("🚀 Tenis Akıllı Motor Başlatıldı...");
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
    
    // Monte Carlo'yu garantiye alalım (Hergün için)
    const stubbornTournamentIds = new Set([2391]); 

    // 1. ADIM: GÜNLÜK LİSTELERİ TARA
    for (const date of targetDates) {
        try {
            console.log(`📡 ${date} programı taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tourName = e.tournament?.name || "";
                    const priority = e.tournament?.uniqueTournament?.priority || e.tournament?.priority || 0;
                    
                    // KRİTİK: Ya önceliği 20'den büyük olsun, YA DA adı elit listemizde olsun.
                    const isAccepted = priority > 20 || checkIsElite(tourName);
                    
                    if (isAccepted && e.tournament?.uniqueTournament?.id) {
                        stubbornTournamentIds.add(e.tournament.uniqueTournament.id);
                    }
                    return isAccepted;
                });
                console.log(`✅ ${date}: ${filtered.length} maç süzgeçten geçti.`);
                rawEvents.push(...filtered);
            }
        } catch (e) { console.error(`❌ ${date} hatası:`, e.message); }
    }

    // 2. ADIM: İNATÇI MOD (Elit turnuva fikstürlerinden placeholder maçları söküp al)
    console.log(`🔍 ${stubbornTournamentIds.size} elit turnuva derinlemesine taranıyor...`);
    for (const tid of stubbornTournamentIds) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/seasons`, { waitUntil: 'networkidle2' });
            const sData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (sData?.seasons?.[0]?.id) {
                const sid = sData.seasons[0].id;
                // 'next/0' ve 'next/1' ile finalistleri belli olmayan maçları da al
                for (const range of ['0', '1']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/season/${sid}/events/next/${range}`, { waitUntil: 'networkidle2' });
                    const eData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
                    if (eData?.events) {
                        rawEvents.push(...eData.events);
                    }
                }
            }
        } catch (e) {}
    }

    // 3. ADIM: JSON HAZIRLAMA (Tekilleştirme)
    const finalMatchesMap = new Map();

    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Sadece radarımızdaki 3 güne odaklan
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        const tourName = e.tournament?.name || "";
        
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsElite(tourName),
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / beIN Sports",
            homeTeam: { 
                name: e.homeTeam.name || "Finalist 1", 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "mc") + ".png"] 
            },
            awayTeam: { 
                name: e.awayTeam.name || "Finalist 2", 
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
    console.log(`✅ İşlem Bitti. Toplam ${finalMatches.length} kaliteli maç kaydedildi.`);
}

start();