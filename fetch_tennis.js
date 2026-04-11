const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// =========================================================================
// 🌟 MANUEL ELİT LİSTESİ (Sadece buradakiler Elit Yıldızı Alır)
// =========================================================================
const ELITE_KEYWORDS = [
    "Wimbledon", "US Open", "Australian Open", "Roland Garros", "French Open", 
    "Masters", "ATP 1000", "WTA 1000", "ATP Finals", "WTA Finals", "Olympic",
    "Monte Carlo", "Indian Wells", "Miami", "Madrid", "Rome", "Cincinnati", 
    "Shanghai", "Paris", "Montreal", "Toronto", "Beijing", "Doha", "Dubai",
    "ATP 500", "WTA 500"
];

const checkIsElite = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword.toUpperCase()));
};

async function start() {
    console.log("🚀 Tenis Motoru (Katı Süzgeç: Priority > 40) Başlatıldı...");
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
    const eliteTourIds = new Set();

    // 1. ADIM: GÜNLÜK PROGRAM TARAMASI (Sadece > 40)
    for (const date of targetDates) {
        try {
            console.log(`📡 ${date} programı inceleniyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const priority = e.tournament?.uniqueTournament?.priority || e.tournament?.category?.priority || 0;
                    // KESİN KURAL: Sadece 40'tan büyükler. Canlılık artık bir ayrıcalık değil.
                    return priority > 40;
                });
                
                rawEvents.push(...filtered);

                // İnatçı mod (Placeholder çekimi) için Elit ID'leri topla
                filtered.forEach(e => {
                    if (checkIsElite(e.tournament?.name) && e.tournament?.uniqueTournament?.id) {
                        eliteTourIds.add(e.tournament.uniqueTournament.id);
                    }
                });
            }
        } catch (e) {}
    }

    // 2. ADIM: İNATÇI MOD (Elit turnuvalardaki belli olmayan final maçları için)
    for (const tid of eliteTourIds) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/seasons`, { waitUntil: 'networkidle2' });
            const sData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (sData?.seasons?.[0]?.id) {
                const sid = sData.seasons[0].id;
                for (const range of ['0', '1']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/season/${sid}/events/next/${range}`, { waitUntil: 'networkidle2' });
                    const eData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
                    if (eData?.events) {
                        // Burada da aynı öncelik kuralını uygula
                        const prioritized = eData.events.filter(ev => {
                            const p = ev.tournament?.uniqueTournament?.priority || ev.tournament?.category?.priority || 0;
                            return p > 40;
                        });
                        rawEvents.push(...prioritized);
                    }
                }
            }
        } catch (e) {}
    }

    const finalMatchesMap = new Map();

    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        const tourName = e.tournament.name || "";
        const hName = e.homeTeam.name || "Belli Değil";
        const aName = e.awayTeam.name || "Belli Değil";

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsElite(tourName), // Elitlik senin manuel listene bağlı
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "Resmi Yayıncı",
            homeTeam: { 
                name: hName, 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            awayTeam: { 
                name: aName, 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
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
    console.log(`✅ İşlem tamamlandı. ${finalMatches.length} adet yüksek öncelikli (>40) maç kaydedildi.`);
}

start();
