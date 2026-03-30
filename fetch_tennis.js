const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;
const OUTPUT_FILE = "matches_tennis.json";

// Sadece senin istediğin ana kategoriler (Ranking çekimini yormamak için)
const categoryConfigs = {
    3: "S Sport / S Sport Plus", 4: "beIN Sports", 5: "Eurosport",
    1396: "Eurosport", 1397: "Eurosport", 1398: "S Sport",
    1399: "Eurosport", 6: "beIN Sports", 7: "S Sport"
};

const targetCategoryIds = Object.keys(categoryConfigs).map(Number);

function getCountriesSingles(team) {
    const code = team.country?.alpha2;
    return code ? [code.toLowerCase()] : ["default"];
}

async function start() {
    console.log("🚀 Tenis motoru (RANKING & CANLI KORUMA) çalışıyor...");
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
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let rawEvents = [];
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];
    
    // 1. Verileri Çek (Filtre + Canlı Koruma)
    for (const date of dates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                // GHETU FIX: Kategori listende olmasa bile CANLI ise listeye dahil et
                const filtered = data.events.filter(e => 
                    targetCategoryIds.includes(e.tournament?.category?.id) || 
                    e.status?.type === 'inprogress'
                );
                rawEvents.push(...filtered);
            }
        } catch (e) {}
    }

    // 2. Canlıları Garantile (Filtresiz)
    try {
        await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/events/live`, { waitUntil: 'networkidle2' });
        const liveData = await page.evaluate(() => JSON.parse(document.body.innerText));
        if (liveData?.events) rawEvents.push(...liveData.events);
    } catch (e) {}

    const uniqueEvents = Array.from(new Map(rawEvents.map(e => [e.id, e])).values());
    const finalMatches = [];

    // Ranking detayları için Sofa'ya git
    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });

    for (const e of uniqueEvents) {
        let homeRank = e.homeTeam.ranking;
        let awayRank = e.awayTeam.ranking;
        const isDouble = e.homeTeam.name.includes("/");

        // Ranking yoksa detaydan çek
        if (!isDouble && (!homeRank || !awayRank)) {
            try {
                const detail = await page.evaluate(async (id) => {
                    try {
                        const r = await fetch(`https://api.sofascore.com/api/v1/event/${id}`);
                        const ev = await r.json();
                        return { hR: ev?.event?.homeTeam?.ranking, aR: ev?.event?.awayTeam?.ranking };
                    } catch(e) { return null; }
                }, e.id);
                if (detail) {
                    homeRank = detail.hR || homeRank;
                    awayRank = detail.aR || awayRank;
                }
            } catch (err) {}
        }

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const mStatus = e.status?.type || "notstarted";
        const isInProgress = mStatus === 'inprogress';
        const isFinished = mStatus === 'finished';

        // GÖRSEL TASARIM: Saat altına CANLI (\n Android'de alt satıra atar)
        let displayTime = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) displayTime = `${displayTime}\nCANLI`;

        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";

        finalMatches.push({
            id: e.id,
            status: mStatus, 
            fixedDate: dayStr,
            fixedTime: displayTime,
            timestamp: dateTR.getTime(),
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "S Sport / Eurosport",
            homeTeam: { 
                name: e.homeTeam.name + (homeRank ? ` (${homeRank})` : ""), 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            awayTeam: { 
                name: e.awayTeam.name + (awayRank ? ` (${awayRank})` : ""), 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + tId + ".png",
            // SKOR KURALI: Sadece bittiyse skorları yazdır
            homeScore: isFinished && e.homeScore?.display !== undefined ? String(e.homeScore.display) : "-",
            awayScore: isFinished && e.awayScore?.display !== undefined ? String(e.awayScore.display) : "-",
            tournament: e.tournament.name
        });
    }

    // --- SIRALAMA: Önce Canlılar (Zamana göre), Sonra Diğerleri ---
    finalMatches.sort((a, b) => {
        if (a.status === 'inprogress' && b.status !== 'inprogress') return -1;
        if (a.status !== 'inprogress' && b.status === 'inprogress') return 1;
        return a.timestamp - b.timestamp;
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));

    console.log(`\n✅ İşlem Tamam: ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();