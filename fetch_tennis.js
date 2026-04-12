const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// =========================================================================
// 🗑️ ÇÖP FİLTRESİ (Olduğu gibi korundu)
// =========================================================================
const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

// =========================================================================
// 🌟 DEV TURNUVALAR LİSTESİ (Olduğu gibi korundu)
// =========================================================================
const ELITE_KEYWORDS = [
    "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC",
    "ATP FINALS", "WTA FINALS",
    "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "CINCINNATI", 
    "MONTREAL", "TORONTO", "CANADIAN OPEN", "SHANGHAI", "PARIS", "MASTERS",
    "ROTTERDAM", "RIO DE JANEIRO", "ACAPULCO", "BARCELONA", "HALLE", "LONDON", "QUEEN'S", 
    "HAMBURG", "WASHINGTON", "TOKYO", "BASEL", "VIENNA", "MUNICH", "DALLAS", "BRISBANE", 
    "ABU DHABI", "SAN DIEGO", "CHARLESTON", "STUTTGART", "BERLIN", "EASTBOURNE", 
    "MONTERREY", "SEOUL", "STRASBOURG", "ZHENGZHOU", "BAD HOMBURG",
    "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"
];

const isMajorTournament = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return isMajorTournament(tournamentName);
};

async function start() {
    console.log("🚀 Tenis Motoru Başlatıldı (Ranking & Flag Fix)...");
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
    const stubbornTournamentIds = new Set([2391]); // Monte Carlo banko

    // 1. ADIM: PROGRAM TARA
    for (const date of targetDates) {
        try {
            console.log(`📡 ${date} programı taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tourName = e.tournament?.name;
                    const catName = e.tournament?.category?.name;
                    if (isGarbage(tourName, catName)) return false;
                    if (isMajorTournament(tourName) && e.tournament?.uniqueTournament?.id) {
                        stubbornTournamentIds.add(e.tournament.uniqueTournament.id);
                    }
                    return true;
                });
                rawEvents.push(...filtered);
            }
        } catch (e) {}
    }

    // 2. ADIM: DERİN TARAMA
    for (const tid of stubbornTournamentIds) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/seasons`, { waitUntil: 'networkidle2' });
            const sData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (sData?.seasons?.[0]?.id) {
                const sid = sData.seasons[0].id;
                for (const path of ['last/0', 'next/0', 'next/1']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${tid}/season/${sid}/events/${path}`, { waitUntil: 'networkidle2' });
                    const eData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
                    if (eData?.events) rawEvents.push(...eData.events);
                }
            }
        } catch (e) {}
    }

    // 3. ADIM: SIRALAMA VE BAYRAK İŞLEME
    const finalMatchesMap = new Map();
    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });

    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(fixedDate)) continue;

        const tourName = e.tournament?.name || "";
        const catName = e.tournament?.category?.name || "";
        if (isGarbage(tourName, catName)) continue;

        let homeLogos = [];
        let awayLogos = [];
        let homeRank = null;
        let awayRank = null;

        try {
            const detail = await page.evaluate(async (id) => {
                try {
                    const r = await fetch(`https://api.sofascore.com/api/v1/event/${id}`);
                    const ev = await r.json();
                    const eventData = ev.event;

                    const getCodes = (team) => {
                        if (team.subTeams && team.subTeams.length > 0) {
                            return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                        }
                        return [team.country?.alpha2?.toLowerCase() || "mc"];
                    };

                    // 📈 SIRALAMA ÇEKME (Burası eklendi ✅)
                    const hR = eventData.homeTeam.ranking ? String(eventData.homeTeam.ranking) : null;
                    const aR = eventData.awayTeam.ranking ? String(eventData.awayTeam.ranking) : null;

                    return { 
                        hCodes: getCodes(eventData.homeTeam), 
                        aCodes: getCodes(eventData.awayTeam),
                        hRank: hR,
                        aRank: aR
                    };
                } catch(err) { return null; }
            }, e.id);

            if (detail) {
                homeLogos = detail.hCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                awayLogos = detail.aCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                homeRank = detail.hRank;
                awayRank = detail.aRank;
            }
        } catch (err) {}

        if (homeLogos.length === 0) homeLogos = [TENNIS_LOGO_BASE + "mc.png"];
        if (awayLogos.length === 0) awayLogos = [TENNIS_LOGO_BASE + "mc.png"];

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        let setScoresStr = "";
        if (e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hSet = e.homeScore[`period${i}`];
                let aSet = e.awayScore[`period${i}`];
                if (hSet !== undefined && aSet !== undefined) sets.push(`${hSet}-${aSet}`);
            }
            setScoresStr = sets.join(", "); 
        }

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsEliteMatch(tourName),
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / beIN Sports",
            homeTeam: { name: e.homeTeam.name || "Belli Değil", logos: homeLogos },
            awayTeam: { name: e.awayTeam.name || "Belli Değil", logos: awayLogos },
            homeRank: homeRank, // JSON'a eklendi ✅
            awayRank: awayRank, // JSON'a eklendi ✅
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: statusType === 'notstarted' ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: statusType === 'notstarted' ? "-" : String(e.awayScore?.display ?? "0"),
            setScores: setScoresStr,
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
    console.log(`✅ İşlem Bitti. Ranking verileri eklendi!`);
}

start();
