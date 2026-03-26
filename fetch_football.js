const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- 27 MART MAÇLARINI YAKALAYAN GÜNCEL YAYINCI LİSTESİ ---
const leagueConfigs = {
    // 27 Mart Programındaki Turnuvalar
    11: "TRT 1 / Tabii",            // UEFA Dünya Kupası Elemeleri
    10: "S Sport Plus / FIFA+",     // Bolivya - Surinam (Güney Amerika Elemeleri)
    10214: "FIFA+ / YouTube",       // Yeni Kaledonya - Jamaika (Play-off)
    351: "TRT Spor / Tabii",        // Türkiye - Ermenistan (UEFA U19)
    4664: "S Sport Plus / Tabii",   // İsviçre - Almanya (Hazırlık Maçı)
    
    // Türkiye Alt Ligleri
    97: "TFF YouTube",             
    11417: "TFF YouTube",          
    11416: "TFF YouTube",          
    11415: "TFF YouTube",          
    15938: "TFF YouTube",
    
    // Diğer Ligler
    52: "beIN Sports",             
    98: "beIN Sports / TRT Spor",  
    17: "beIN Sports",             
    8: "S Sport",                  
    23: "S Sport",                 
    696: "DAZN / YouTube",
    13363: "USL YouTube",
    10783: "S Sport Plus / TRT"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

// Derin tarama yapılacak "inatçı" turnuvalar (27 Mart maçları burada)
const stubbornLeagueIds = [11, 10, 10214, 351, 97, 11415, 11416, 11417, 15938];

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (27 Mart Güncellemesi)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    const validDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let allEvents = [];
    
    // --- 1. ADIM: GENEL API TARAMASI ---
    for (const date of validDates) {
        try {
            console.log(`⏳ ${date} genel maç verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (data && data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`Hata (${date}):`, e.message); }
    }

    // --- 2. ADIM: DERİN TARAMA (TURNUVA İÇİ GRUPLAR) ---
    for (const id of stubbornLeagueIds) {
        try {
            console.log(`🔍 Derin Tarama: ID ${id}`);
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (seasonsData && seasonsData.seasons && seasonsData.seasons.length > 0) {
                const seasonId = seasonsData.seasons[0].id; 

                for (const pageType of ['next/0', 'last/0']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${seasonId}/events/${pageType}`, { waitUntil: 'networkidle2' });
                    const eventsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });

                    if (eventsData && eventsData.events) {
                        const targetEvents = eventsData.events.filter(e => {
                            const dateTR = new Date(e.startTimestamp * 1000);
                            const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                            return validDates.includes(dayStrTR);
                        });
                        allEvents = allEvents.concat(targetEvents);
                    }
                }
            }
        } catch (e) { console.error(`Derin Dalış Hatası (ID ${id}):`, e.message); }
    }

    // --- 3. ADIM: AYIKLAMA VE KAYDETME ---
    const finalMatchesMap = new Map();

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        if (!utId) continue;
        
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const isFinished = e.status?.type === 'finished' || e.status?.type === 'inprogress';

        const matchObj = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: leagueConfigs[utId] || "TRT / Tabii", 
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: isFinished ? String(e.homeScore.display) : "-",
            awayScore: isFinished ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };

        if (finalMatchesMap.has(matchKey)) {
            const existing = finalMatchesMap.get(matchKey);
            if (e.status?.type === 'finished' || (e.status?.type === 'inprogress' && existing.homeScore === "-")) {
                finalMatchesMap.set(matchKey, matchObj);
            }
        } else {
            finalMatchesMap.set(matchKey, matchObj);
        }
    }

    const finalMatches = Array.from(finalMatchesMap.values());
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`\n✅ İşlem Tamamlandı. 27 Mart dahil ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();
