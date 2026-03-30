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

function getCountriesFromSubTeams(team) {
    if (!team || !team.subTeams || team.subTeams.length === 0) return ["default"];
    const countries = team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
    return countries.length > 0 ? countries : ["default"];
}

function getCountriesSingles(team) {
    const code = team.country?.alpha2;
    return code ? [code.toLowerCase()] : ["default"];
}

async function start() {
    console.log("🚀 Tenis motoru (SIRALAMA DESTEKLİ) başlatılıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let allEvents = [];
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];
    
    for (const date of dates) {
        try {
            console.log(`⏳ ${date} verileri alınıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) allEvents.push(...data.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id)));
        } catch (e) {}
    }

    try {
        await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/events/live`, { waitUntil: 'networkidle2' });
        const liveData = await page.evaluate(() => JSON.parse(document.body.innerText));
        if (liveData?.events) allEvents.push(...liveData.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id)));
    } catch (e) {}

    const uniqueEvents = Array.from(new Map(allEvents.map(e => [e.id, e])).values());
    const finalMatches = [];

    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });

    for (const e of uniqueEvents) {
        let homeCodes = [];
        let awayCodes = [];
        let homeRank = e.homeTeam.ranking;
        let awayRank = e.awayTeam.ranking;
        const isDouble = e.homeTeam.name.includes("/");

        if (isDouble || (!isDouble && (!homeRank || !awayRank))) {
            process.stdout.write(`🎾 Detaylar İşleniyor: ${e.id} \r`);
            try {
                const detail = await page.evaluate(async (id, homeId, awayId, isDouble) => {
                    const fetchJSON = async (url) => { try { const r = await fetch(url); return await r.json(); } catch(e) { return null; } };
                    
                    let res = { homeRank: null, awayRank: null, hCodes: [], aCodes: [] };
                    
                    const ev = await fetchJSON(`https://api.sofascore.com/api/v1/event/${id}`);
                    if (ev?.event) {
                        res.homeRank = ev.event.homeTeam.ranking;
                        res.awayRank = ev.event.awayTeam.ranking;
                        if (isDouble) {
                            res.hCodes = ev.event.homeTeam.subTeams?.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean) || [];
                            res.aCodes = ev.event.awayTeam.subTeams?.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean) || [];
                        }
                    }

                    if (!isDouble) {
                        if (!res.homeRank) { const h = await fetchJSON(`https://api.sofascore.com/api/v1/team/${homeId}`); res.homeRank = h?.team?.ranking; }
                        if (!res.awayRank) { const a = await fetchJSON(`https://api.sofascore.com/api/v1/team/${awayId}`); res.awayRank = a?.team?.ranking; }
                    }
                    return res;
                }, e.id, e.homeTeam.id, e.awayTeam.id, isDouble);

                if (detail) {
                    homeRank = detail.homeRank || homeRank;
                    awayRank = detail.awayRank || awayRank;
                    if (isDouble) { homeCodes = detail.hCodes; awayCodes = detail.aCodes; }
                }
            } catch (err) {}
        }

        if (!isDouble) {
            homeCodes = getCountriesSingles(e.homeTeam);
            awayCodes = getCountriesSingles(e.awayTeam);
        } else if (homeCodes.length === 0) {
            homeCodes = ["default"]; awayCodes = ["default"];
        }

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";
        
        const mStatus = e.status?.type || "notstarted";
        const isFinished = mStatus === 'finished';

        // GÜNCELLEME: Sadece maç BİTTİYSE skorları al! Canlı maçlarda skor boş kalacak.
        let setScoresStr = "";
        if (isFinished && e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                const h = e.homeScore[`period${i}`], a = e.awayScore[`period${i}`];
                if (h !== undefined && a !== undefined) sets.push(`${h}-${a}`);
            }
            if (sets.length > 0) setScoresStr = `(${sets.join(', ')})`;
        }

        let finalHomeName = e.homeTeam.name;
        let finalAwayName = e.awayTeam.name;
        if (!isDouble) {
            if (homeRank) finalHomeName += ` (${homeRank})`;
            if (awayRank) finalAwayName += ` (${awayRank})`;
        }

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "beIN / Eurosport",
            isDoubles: isDouble,
            matchStatus: { type: mStatus, description: e.status?.description || "-", code: e.status?.code || 0 },
            homeTeam: { name: finalHomeName, countries: homeCodes, logos: homeCodes.map(c => TENNIS_LOGO_BASE + c + ".png") },
            awayTeam: { name: finalAwayName, countries: awayCodes, logos: awayCodes.map(c => TENNIS_LOGO_BASE + c + ".png") },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + tId + ".png",
            
            // GÜNCELLEME: Sadece maç BİTTİYSE ana skorları al
            homeScore: isFinished && e.homeScore?.display !== undefined ? String(e.homeScore.display) : "-",
            awayScore: isFinished && e.awayScore?.display !== undefined ? String(e.awayScore.display) : "-",
            setScores: setScoresStr,
            tournament: e.tournament.name
        });
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    if (finalMatches.length > 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
            success: true, lastUpdated: new Date().toISOString(), 
            totalMatches: finalMatches.length, matches: finalMatches 
        }, null, 2));
        console.log(`\n✅ İşlem Tamam: ${finalMatches.length} maç kaydedildi.`);
    } else {
        console.log("\n⚠️ Uyarı: Hiç maç bulunamadı, dosya güncellenmedi.");
    }
    await browser.close();
}

start();