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

async function start() {
    console.log("🚀 Tenis motoru (CANLI ODAKLI) başlatılıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);
    let rawEvents = [];

    // 1. ADIM: Canlı Maçları Filtresiz Çek (En yüksek öncelik)
    try {
        await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/events/live`, { waitUntil: 'networkidle2' });
        const liveData = await page.evaluate(() => JSON.parse(document.body.innerText));
        if (liveData?.events) {
            rawEvents.push(...liveData.events); 
        }
    } catch (e) { console.log("Canlı veri hatası"); }

    // 2. ADIM: Planlanmış Maçları Çek
    const dates = [getTRDate(-1), trToday, trTomorrow];
    for (const date of dates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) rawEvents.push(...data.events);
        } catch (e) {}
    }

    // Tekilleştirme (ID bazlı)
    const uniqueEvents = Array.from(new Map(rawEvents.map(e => [e.id, e])).values());
    const finalMatches = [];

    for (const e of uniqueEvents) {
        const statusType = e.status?.type;
        const isInProgress = statusType === 'inprogress';
        const isFinished = statusType === 'finished';
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // --- GHETU FIX: CANLI MAÇLARDA HİÇBİR FİLTREYE BAKMA ---
        const isTargetCategory = targetCategoryIds.includes(e.tournament?.category?.id);
        
        // Kural: Ya hedef kategoride olmalı, ya da ŞU AN CANLI olmalı.
        if (!isTargetCategory && !isInProgress) continue;

        // Kural: Canlı değilse sadece bugün ve yarını göster. Canlıysa dünden kalsa bile göster.
        if (!isInProgress && (dayStr !== trToday && dayStr !== trTomorrow)) continue;

        // Görseldeki gibi saat altına CANLI ekle
        let displayTime = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) displayTime = `${displayTime}\nCANLI`;

        const utId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";
        let homeRank = e.homeTeam.ranking, awayRank = e.awayTeam.ranking;

        finalMatches.push({
            id: e.id,
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
            tournamentLogo: TENNIS_TOURNAMENT_BASE + utId + ".png",
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-",
            tournament: e.tournament.name
        });
    }

    // --- SIRALAMA (Focus Sorunu Çözümü) ---
    // Önce canlı maçları (timestamp'e göre), sonra başlamamış maçları diz.
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));

    console.log(`✅ ${finalMatches.length} maç kaydedildi. Ghetu ve diğer canlılar artık en üstte.`);
    await browser.close();
}

start();