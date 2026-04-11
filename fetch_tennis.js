const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;
const OUTPUT_FILE = "matches_tennis.json";

const categoryConfigs = {
    3: "S Sport / S Sport Plus", 4: "beIN Sports", 5: "Eurosport",
    1396: "Eurosport", 1397: "Eurosport", 1398: "S Sport",
    1399: "Eurosport", 6: "beIN Sports", 7: "S Sport"
};

const targetCategoryIds = Object.keys(categoryConfigs).map(Number);

// =========================================================================
// TENİS ELİT TURNUVA ANAHTAR KELİMELERİ (Sağlamlaştırılmış Şehir Listesi)
// =========================================================================
const ELITE_KEYWORDS = [
    // 🏆 MEGA TURNUVALAR (2000 & 1000 Puan)
    "Wimbledon", "US Open", "Australian Open", "Roland Garros", "French Open", 
    "Masters", "ATP 1000", "WTA 1000", 
    "ATP Finals", "WTA Finals", "Next Gen ATP Finals", 
    
    // 📍 ŞEHİR İSİMLİ BÜYÜK TURNUVALAR
    "Monte Carlo", "Indian Wells", "Miami", "Madrid", "Rome", "Cincinnati", 
    "Shanghai", "Paris", "Montreal", "Toronto", "Canadian Open", "Beijing", 
    "Doha", "Dubai",
    
    // 🌍 ULUSLARARASI ŞOVLAR
    "Davis Cup", "Billie Jean King Cup", "Laver Cup", "United Cup", "Olympic",
    
    // ⭐ ÜST DÜZEY PROFESYONEL TUR
    "ATP 500", "WTA 500"
];

const checkIsElite = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword.toUpperCase()));
};

async function start() {
    console.log("🚀 Tenis motoru (Tekler Ranking + Çiftler Bayrak + Elit/Set Skorları) başlatılıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let rawEvents = [];
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];
    const nowTimestamp = Date.now();
    
    for (const date of dates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                const filtered = data.events.filter(e => 
                    targetCategoryIds.includes(e.tournament?.category?.id) || e.status?.type === 'inprogress'
                );
                rawEvents.push(...filtered);
            }
        } catch (e) {}
    }

    const uniqueEvents = Array.from(new Map(rawEvents.map(e => [e.id, e])).values());
    const finalMatches = [];

    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });

    for (const e of uniqueEvents) {
        const isDouble = e.homeTeam.name.includes("/");
        let homeRank = e.homeTeam.ranking;
        let awayRank = e.awayTeam.ranking;
        let homeLogos = [];
        let awayLogos = [];

        try {
            const detail = await page.evaluate(async (id) => {
                try {
                    const r = await fetch(`https://api.sofascore.com/api/v1/event/${id}`);
                    const ev = await r.json();
                    
                    const getCodes = (team) => {
                        if (team.subTeams && team.subTeams.length > 0) {
                            return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                        }
                        return [team.country?.alpha2?.toLowerCase() || "default"];
                    };
                    
                    return {
                        hR: ev?.event?.homeTeam?.ranking,
                        aR: ev?.event?.awayTeam?.ranking,
                        hCodes: getCodes(ev.event.homeTeam),
                        aCodes: getCodes(ev.event.awayTeam)
                    };
                } catch(err) { return null; }
            }, e.id);

            if (detail) {
                homeRank = detail.hR || homeRank;
                awayRank = detail.aR || awayRank;
                homeLogos = detail.hCodes.map(c => `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/${c}.png`);
                awayLogos = detail.aCodes.map(c => `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/${c}.png`);
            }
        } catch (err) {}

        const statusType = e.status?.type; 
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const isFinished = statusType === 'finished';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'notstarted' && nowTimestamp > startTimestamp) timeString += "\nBAŞLAMADI";
        else if (isFinished) timeString += "\nMS";

        let finalHomeName = e.homeTeam.name;
        let finalAwayName = e.awayTeam.name;
        
        if (!isDouble) {
            if (homeRank) finalHomeName += ` (${homeRank})`;
            if (awayRank) finalAwayName += ` (${awayRank})`;
        }

        // 🎾 SET SKORLARINI ÇEKME DÖNGÜSÜ
        let setScoresStr = "";
        if (e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hSet = e.homeScore[`period${i}`];
                let aSet = e.awayScore[`period${i}`];
                if (hSet !== undefined && aSet !== undefined) {
                    sets.push(`${hSet}-${aSet}`);
                }
            }
            setScoresStr = sets.join(", "); 
        }

        // 🌟 ELİT KONTROLÜ
        const tournamentName = e.tournament.name || "";
        const isITForChallenger = tournamentName.toUpperCase().includes("ITF") || tournamentName.toUpperCase().includes("CHALLENGER");
        const isElite = !isITForChallenger && checkIsElite(tournamentName);

        finalMatches.push({
            id: e.id,
            isElite: isElite,
            status: statusType, 
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "S Sport / Eurosport",
            homeTeam: { 
                name: finalHomeName, 
                logos: homeLogos.length > 0 ? homeLogos : [TENNIS_LOGO_BASE + "default.png"] 
            },
            awayTeam: { 
                name: finalAwayName, 
                logos: awayLogos.length > 0 ? awayLogos : [TENNIS_LOGO_BASE + "default.png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: isFinished || statusType === 'inprogress' ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished || statusType === 'inprogress' ? String(e.awayScore?.display ?? "0") : "-",
            setScores: setScoresStr,
            tournament: tournamentName
        });
    }

    finalMatches.sort((a, b) => {
        if (a.status === 'inprogress' && b.status !== 'inprogress') return -1;
        if (a.status !== 'inprogress' && b.status === 'inprogress') return 1;
        return a.timestamp - b.timestamp;
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    await browser.close();
    console.log("✅ İşlem bitti. Teklerde sıralama, çiftlerde yan yana bayraklar, Elit filtre ve Set Skorları hazır.");
}