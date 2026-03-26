const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- YAYINCI VE TURNUVA TANIMLARI ---
const leagueConfigs = {
    11: "TRT 1 / Tabii",           // World Cup Qual. UEFA (Senin linkindeki ana turnuva)
    17011: "TRT 1 / Tabii",        // World Cup Qual. UEFA (Alternatif)
    10783: "S Sport Plus / TRT",   // UEFA Nations League
    4664: "TRT Spor / Tabii",      // Hazırlık Maçları
    52: "beIN Sports",             
    98: "beIN Sports / TRT Spor",  
    97: "TFF YouTube",             
    11417: "TFF YouTube",          
    11416: "TFF YouTube",          
    11415: "TFF YouTube",          
    15938: "TFF YouTube",
    7: "TRT / Tabii",
    8: "S Sport",
    696: "DAZN / YouTube"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);
// İnatçı ligler: Bu turnuvaların içine girip tüm aşamaları (Yarı Final vb.) tarayacağız.
const stubbornLeagueIds = [11, 17011, 97, 11415, 11416, 11417, 15938];

async function start() {
    console.log("🚀 Maç Saati Motoru: Play-off ve Yarı Finaller taranıyor...");
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
    
    // --- 1. ADIM: GENEL GÜNLÜK LİSTE ---
    for (const date of validDates) {
        try {
            console.log(`⏳ ${date} genel maçlar kontrol ediliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (data && data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} API Hatası:`, e.message); }
    }

    // --- 2. ADIM: TURNUVA ÖZEL DERİN TARAMA (Yarı Finaller Buradan Gelir) ---
    for (const id of stubbornLeagueIds) {
        try {
            console.log(`🔍 Turnuva Derinliği Taranıyor: ID ${id}`);
            // Önce bu turnuvanın güncel sezon ID'sini bulalım
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (seasonsData && seasonsData.seasons && seasonsData.seasons.length > 0) {
                const currentSeasonId = seasonsData.seasons[0].id;

                // 'next/0' yaklaşan tüm aşamaları (Yarı final, final vs) getirir.
                // Bazı durumlarda 'last/0' da bugünkü biten/başlayan maçları içerir.
                for (const type of ['next/0', 'last/0']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${currentSeasonId}/events/${type}`, { waitUntil: 'networkidle2' });
                    const eventsData = await page.evaluate(() => JSON.parse(document.body.innerText));

                    if (eventsData && eventsData.events) {
                        const filtered = eventsData.events.filter(e => {
                            const dateTR = new Date(e.startTimestamp * 1000);
                            const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                            return validDates.includes(dayStrTR);
                        });
                        allEvents = allEvents.concat(filtered);
                    }
                }
            }
        } catch (e) { console.error(`Derin Tarama Hatası (ID ${id}):`, e.message); }
    }

    // --- 3. ADIM: TEMİZLİK VE SIRALAMA ---
    const finalMatchesMap = new Map();

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id || 11; // Fallback to 11 if missing
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        const matchObj = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: leagueConfigs[utId] || "TRT 1 / Tabii", 
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: (e.status?.type === 'finished' || e.status?.type === 'inprogress') ? String(e.homeScore.display) : "-",
            awayScore: (e.status?.type === 'finished' || e.status?.type === 'inprogress') ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name || "Dünya Kupası Elemeleri"
        };

        // Tekrar eden maçları engelle, skoru güncel olanı tut
        if (!finalMatchesMap.has(matchKey) || e.status?.type === 'finished') {
            finalMatchesMap.set(matchKey, matchObj);
        }
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`\n✅ Tamamlandı. ${finalMatches.length} maç bulundu. Yarı finaller eklendi.`);
    await browser.close();
}

start();
