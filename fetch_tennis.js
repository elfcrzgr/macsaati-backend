const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const OUTPUT_FILE = "matches_tennis.json";

const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

// Önemli Tenis Kategorileri (ATP, WTA, Grand Slam vb.)
const targetCategoryIds = [3, 4, 5, 1396, 1397];

async function start() {
    console.log("🎾 Tenis motoru başlatılıyor (Geçmiş maçlar dahil)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    let allEvents = [];
    // DÜN (-1), BUGÜN (0) ve YARIN (1) taraması yaparak biten maçları yakalıyoruz
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const content = await page.evaluate(() => document.body.innerText);
            const data = JSON.parse(content);
            
            if (data.events) {
                const filtered = data.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} tarihinde veri bulunamadı.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Mükerrer kontrolü (Aynı maçı tekrar ekleme)
        const matchKey = `${e.id}`; 
        if (duplicateTracker.has(matchKey)) continue;

        // Set detaylarını oluştur (6-4, 7-5 gibi)
        let setDetails = "";
        if (e.homeScore && e.homeScore.period1 !== undefined) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hS = e.homeScore[`period${i}`];
                let aS = e.awayScore[`period${i}`];
                if (hS !== undefined && aS !== undefined) sets.push(`${hS}-${aS}`);
            }
            if (sets.length > 0) setDetails = `(${sets.join(', ')})`;
        }

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: "beIN Sports / Eurosport",
            homeTeam: { name: e.homeTeam.name, logo: TENNIS_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: TENNIS_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || "default") + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            setDetails: setDetails,
            tournament: e.tournament.name
        });
        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}
start();