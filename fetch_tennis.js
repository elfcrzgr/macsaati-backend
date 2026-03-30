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
    console.log("🚀 Tenis motoru (HIZLANDIRILMIŞ MOD) başlatılıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    // --- HIZLANDIRICI 1: Resim, CSS ve Fontları engelle ---
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let allEvents = [];
    
    // --- 1 & 2. ADIM: VERİLERİ ÇEK ---
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];
    for (const date of dates) {
        try {
            console.log(`⏳ ${date} çekiliyor...`);
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

    // Deduplikasyon
    const uniqueEvents = Array.from(new Map(allEvents.map(e => [e.id, e])).values());
    const finalMatches = [];

    // --- HIZLANDIRICI 2: page.goto YERİNE fetch KULLANIMI ---
    // SofaScore ana sayfasına bir kere gidelim ki cookie/header otursun
    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });

    for (const e of uniqueEvents) {
        let homeCodes = [];
        let awayCodes = [];
        const isDouble = e.homeTeam.name.includes("/");

        if (isDouble) {
            process.stdout.write(`🎾 Çiftler Detayı Alınıyor: ${e.id} \r`);
            try {
                // Sayfayı yenilemeden arka planda fetch atıyoruz (ÇOK HIZLI)
                const detail = await page.evaluate(async (id) => {
                    const response = await fetch(`https://api.sofascore.com/api/v1/event/${id}`);
                    return response.json();
                }, e.id);
                
                if (detail?.event) {
                    homeCodes = getCountriesFromSubTeams(detail.event.homeTeam);
                    awayCodes = getCountriesFromSubTeams(detail.event.awayTeam);
                }
            } catch (err) {
                homeCodes = ["default"]; awayCodes = ["default"];
            }
        } else {
            homeCodes = getCountriesSingles(e.homeTeam);
            awayCodes = getCountriesSingles(e.awayTeam);
        }

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";
        const isFinished = e.status?.type === 'finished';

        let setScoresStr = "";
        if (isFinished && e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                const h = e.homeScore[`period${i}`], a = e.awayScore[`period${i}`];
                if (h !== undefined && a !== undefined) sets.push(`${h}-${a}`);
            }
            if (sets.length > 0) setScoresStr = `(${sets.join(', ')})`;
        }

        // --- SIRALAMA (RANKING) MANTIĞI EKLENDİ ---
        let finalHomeName = e.homeTeam.name;
        let finalAwayName = e.awayTeam.name;

        // Sadece tekler maçlarında ve ranking verisi varsa ismin sonuna (X) ekle
        if (!isDouble) {
            if (e.homeTeam.ranking) finalHomeName += ` (${e.homeTeam.ranking})`;
            if (e.awayTeam.ranking) finalAwayName += ` (${e.awayTeam.ranking})`;
        }

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "beIN / Eurosport",
            isDoubles: isDouble,
            matchStatus: { type: e.status?.type || "notstarted", description: e.status?.description || "-", code: e.status?.code || 0 },
            homeTeam: { name: finalHomeName, countries: homeCodes, logos: homeCodes.map(c => TENNIS_LOGO_BASE + c + ".png") },
            awayTeam: { name: finalAwayName, countries: awayCodes, logos: awayCodes.map(c => TENNIS_LOGO_BASE + c + ".png") },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + tId + ".png",
            homeScore: (isFinished && e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (isFinished && e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            setScores: setScoresStr,
            tournament: e.tournament.name
        });
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));
    
    console.log(`\n✅ ${finalMatches.length} maç yazıldı. Süre ciddi oranda kısaltıldı!`);
    await browser.close();
}

start();