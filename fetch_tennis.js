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
    console.log("🚀 Tenis motoru (BAŞLAMADI Kontrolü Aktif) başlatılıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let rawEvents = [];
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];
    const nowTimestamp = Date.now(); // Sunucunun şu anki zamanı
    
    for (const date of dates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                const filtered = data.events.filter(e => 
                    targetCategoryIds.includes(e.tournament?.category?.id) || 
                    e.status?.type === 'inprogress'
                );
                rawEvents.push(...filtered);
            }
        } catch (e) {}
    }

    const uniqueEvents = Array.from(new Map(rawEvents.map(e => [e.id, e])).values());
    const finalMatches = [];

    for (const e of uniqueEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const statusType = e.status?.type; // 'inprogress', 'notstarted', 'finished'
        const dateTR = new Date(startTimestamp);
        
        let timeString = dateTR.toLocaleTimeString('tr-TR', { 
            timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' 
        });

        // --- CANLI / BAŞLAMADI MANTIĞI ---
        if (statusType === 'inprogress') {
            timeString += "\nCANLI";
        } else if (statusType === 'notstarted' && nowTimestamp > startTimestamp) {
            // Maç saati geçti ama henüz başlamadı (Senin Trungelliti örneği)
            timeString += "\nBAŞLAMADI";
        } else if (statusType === 'finished') {
            timeString += "\nMS";
        }

        finalMatches.push({
            id: e.id,
            status: statusType, 
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "S Sport / Eurosport",
            homeTeam: { 
                name: e.homeTeam.name + (e.homeTeam.ranking ? ` (${e.homeTeam.ranking})` : ""), 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            awayTeam: { 
                name: e.awayTeam.name + (e.awayTeam.ranking ? ` (${e.awayTeam.ranking})` : ""), 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: statusType === 'finished' ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: statusType === 'finished' ? String(e.awayScore?.display ?? "0") : "-",
            tournament: e.tournament.name
        });
    }

    // SIRALAMA: Canlılar her zaman en üstte
    finalMatches.sort((a, b) => {
        if (a.status === 'inprogress' && b.status !== 'inprogress') return -1;
        if (a.status !== 'inprogress' && b.status === 'inprogress') return 1;
        return a.timestamp - b.timestamp;
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches: finalMatches }, null, 2));
    await browser.close();
}
start();