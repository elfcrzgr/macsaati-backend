const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- KONFİGÜRASYON ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const BASKETBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/`;
const BASKETBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/`;
const OUTPUT_FILE = "matches_basketball.json";

// Lig Yayıncı Bilgileri (Senin JSON'ındaki 141, 235 gibi yeni ID'ler eklendi)
const leagueConfigs = {
    3547: "S Sport / NBA TV",      // NBA Ana
    138: "S Sport",                // EuroLeague
    139: "beIN Sports",            // Türkiye BSL
    9357: "beIN Sports / Tivibu",  // Champions League
    141: "S Sport Plus",           // EuroCup (JSON'da 141 gelen)
    168: "S Sport Plus / Tivibu",  // EuroCup (Alternatif)
    215: "S Sport",                // İspanya ACB
    227: "beIN Sports",            // Almanya BBL / Fransa (JSON'da 227 gelen)
    235: "S Sport Plus",           // ABA Ligi / Litvanya (JSON'da 235 gelen)
    132: "S Sport Plus",           // ABA Ligi (Alternatif)
    141: "S Sport Plus",           // İtalya Serie A (Alternatif)
    405: "Spor SMART",             // Çin CBA
    304: "S Sport Plus"            // Avustralya NBL
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru çalışıyor (NBA Garantili Filtre)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // TR Saatine göre yyyy-mm-dd formatı
    const getTRDateString = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const trToday = getTRDateString(0);
    const trTomorrow = getTRDateString(1);
    const trYesterday = getTRDateString(-1);

    let allEvents = [];
    // NBA'in biten maçlarını yakalamak için Yesterday, Today ve Tomorrow tarıyoruz
    for (const date of [trYesterday, trToday, trTomorrow]) {
        try {
            console.log(`⏳ ${date} verisi SofaScore'dan çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return { events: [] }; }
            });

            if (data.events && data.events.length > 0) {
                // FİLTRE: Ya ID listede olacak YA DA turnuva isminde "NBA" geçecek
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    const tName = e.tournament?.name || "";
                    return targetLeagueIds.includes(utId) || tName.toUpperCase().includes("NBA");
                });
                allEvents = allEvents.concat(filtered);
                console.log(`✅ ${date} için ${filtered.length} maç havuza eklendi.`);
            }
        } catch (e) { console.error(`${date} çekilirken hata oluştu.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateObject = new Date(e.startTimestamp * 1000);
        const matchDateTR = dateObject.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const matchTimeTR = dateObject.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

        // Sadece BUGÜN ve YARIN (TR Takvim Günü) maçlarını al (00:00 - 23:59 kuralı)
        if (matchDateTR !== trToday && matchDateTR !== trTomorrow) continue;

        const matchKey = `${matchDateTR}_${e.homeTeam.name}_${e.awayTeam.name}`;
        if (duplicateTracker.has(matchKey)) continue;

        const tournamentName = e.tournament?.name || "";
        const utId = e.tournament?.uniqueTournament?.id;
        
        // NBA Kontrolü
        const isNBA = (utId === 3547 || tournamentName.toUpperCase().includes("NBA"));
        const logoFolder = isNBA ? "NBA/" : "";

        finalMatches.push({
            id: e.id,
            fixedDate: matchDateTR,
            fixedTime: matchTimeTR,
            timestamp: dateObject.getTime(),
            broadcaster: leagueConfigs[utId] || "Yerel Yayın",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.awayTeam.id + ".png" 
            },
            // NBA ise 3547.png'ye zorla
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + (isNBA ? "3547" : utId) + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: isNBA ? "NBA" : (e.tournament.uniqueTournament.name || tournamentName)
        });

        duplicateTracker.add(matchKey);
    }

    // Zaman sıralaması
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    const jsonOutput = { 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        matches: finalMatches 
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`🏁 İşlem Tamamlandı: ${finalMatches.length} maç JSON dosyasına yazıldı.`);
    
    await browser.close();
}

start();