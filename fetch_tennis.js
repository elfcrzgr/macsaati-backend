const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// GitHub klasör yolları
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;
const OUTPUT_FILE = "matches_tennis.json";

// Yayıncı konfigürasyonu (Genişletilmiş Kategori Listesi)
const categoryConfigs = {
    3: "beIN Sports / Eurosport",  // Grand Slam
    4: "beIN Sports",              // ATP
    5: "beIN Sports",              // WTA
    1396: "beIN Sports",           // ATP Masters
    1397: "beIN Sports",           // WTA 1000
    1398: "beIN Sports",           // ATP 500
    1399: "beIN Sports",           // WTA 500
    6: "beIN Sports",              // ATP 250
    7: "beIN Sports"               // WTA 250
};

const targetCategoryIds = Object.keys(categoryConfigs).map(Number);

async function start() {
    console.log("🎾 Tenis motoru başlatılıyor (Karma Çiftler & Derin Tarama)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); // Türkiye Saati Ayarı
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let allEvents = [];
    // Dün, Bugün ve Yarın verilerini çekiyoruz
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2', timeout: 60000 });
            
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
            });
            
            if (data && data.events) {
                const filtered = data.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id));
                console.log(`📡 ${date}: ${filtered.length} uygun maç bulundu.`);
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası: ${e.message}`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set(); 

    for (const e of allEvents) {
        if (duplicateTracker.has(`${e.id}`)) continue;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // --- GELİŞMİŞ BAYRAK ÇÖZÜCÜ (Karma Çiftler Desteği) ---
        const getLogosArray = (team) => {
            let flagList = [];
            
            // 1. Takım ülke kodu (Tekler veya ortak ülkeli çiftler)
            if (team.country?.alpha2) {
                flagList.push(team.country.alpha2.toLowerCase());
            } 
            
            // 2. Oyuncu bazlı ülke tarama (Karma çiftler için derinlik)
            if (team.players && team.players.length > 0) {
                team.players.forEach(p => {
                    const code = p.country?.alpha2 || (p.player && p.player.country && p.player.country.alpha2);
                    if (code) flagList.push(code.toLowerCase());
                });
            }

            // Hiçbir şey yoksa default
            if (flagList.length === 0) flagList.push("default");

            // Aynı ülkeden oyuncular varsa bayrağı teke indir
            let uniqueFlags = [...new Set(flagList)];
            
            return uniqueFlags.map(code => TENNIS_LOGO_BASE + code + ".png");
        };

        // --- SKOR VE SET DETAYI ---
        let setDetails = "";
        if (e.homeScore && (e.homeScore.period1 !== undefined || e.homeScore.display !== undefined)) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hS = e.homeScore[`period${i}`];
                let aS = e.awayScore[`period${i}`];
                if (hS !== undefined && aS !== undefined) sets.push(`${hS}-${aS}`);
            }
            if (sets.length > 0) setDetails = `(${sets.join(', ')})`;
        }

        const tournamentId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "beIN / Eurosport",
            homeTeam: { 
                name: e.homeTeam.name, 
                logos: getLogosArray(e.homeTeam) 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logos: getLogosArray(e.awayTeam) 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + tournamentId + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            setDetails: setDetails,
            tournament: e.tournament.name
        });

        duplicateTracker.add(`${e.id}`);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
        success: true,
        lastUpdated: new Date().toISOString(),
        matches: finalMatches
    }, null, 2));
    
    console.log(`✅ İşlem tamamlandı. Toplam ${finalMatches.length} maç JSON'a yazıldı.`);
    await browser.close();
}

start();