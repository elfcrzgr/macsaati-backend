const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

const leagueConfigs = {
    52: "beIN Sports",             
    98: "beIN Sports / TRT Spor",  
    311: "A Spor / ATV",           
    97: "TFF YouTube",             
    11417: "TFF YouTube",          
    11416: "TFF YouTube",          
    11415: "TFF YouTube",          
    15938: "TFF YouTube",          
    17: "beIN Sports",             
    18: "beIN Sports",             
    8: "S Sport",                  
    23: "S Sport",                 
    35: "beIN Sports / Tivibu",    
    7: "TRT / Tabii",              
    3: "TRT / Tabii",              
    17015: "TRT / Tabii",          
    696: "DAZN / YouTube",
    17011: "TRT 1 / Tabii",
    10783: "S Sport Plus / TRT",
    14605: "TRT 1 / Bizim Çocuklar",
    4664: "TRT Spor / Tabii",
    54: "S Sport Plus",            
    73: "Tivibu Spor",             
    53: "S Sport Plus",            
    19: "Tivibu / TRT Spor",       
    34: "beIN Sports",             
    33: "beIN Sports",             
    238: "Tivibu Spor / Spor Smart", 
    170: "S Sport / TV+",            
    13363: "USL YouTube"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

// Playoff/Eliminasyon aşamalarında direkt event taraması yapacağız
const deepScanLeagueIds = [17011, 10783, 14605]; // Sadece en önemli olanlar

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Playoff & Elemeler)...");
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
    console.log(`📅 Aranan Tarihler: ${validDates.join(', ')}\n`);
    
    let allEvents = [];
    
    // --- 1. ADIM: GENEL GÜNLÜK MAÇLAR ---
    for (const date of validDates) {
        try {
            console.log(`⏳ ${date} genel API taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (data && data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                console.log(`   ✅ ${filtered.length} maç bulundu`);
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`❌ Hata (${date}):`, e.message); }
    }

    // --- 2. ADIM: CANLI MAÇLAR ---
    try {
        console.log(`⏳ Canlı maçlar taranıyor...`);
        await page.goto(`https://api.sofascore.com/api/v1/sport/football/events/live`, { waitUntil: 'networkidle2' });
        const liveData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
        if (liveData && liveData.events) {
            const filteredLive = liveData.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
            console.log(`   ✅ ${filteredLive.length} canlı maç bulundu`);
            allEvents = allEvents.concat(filteredLive);
        }
    } catch (e) { console.error(`❌ Canlı Maç Hatası:`, e.message); }

    // --- 3. ADIM: PLAYOFF/ELIMINASYON MAÇLARI (AGRESIF TARAMA) ---
    console.log(`\n🔍 Playoff & Elemeler Derin Taraması:`);
    for (const id of deepScanLeagueIds) {
        try {
            console.log(`\n   🎯 Turnuva ID: ${id}`);
            
            // Sezonları çek
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (seasonsData && seasonsData.seasons && seasonsData.seasons.length > 0) {
                const seasonId = seasonsData.seasons[0].id;
                console.log(`   📍 Sezon ID: ${seasonId}`);

                // Çoklu sayfa ve offset kombinasyonları dene
                const endpoints = [
                    { type: 'next', offset: 0 },
                    { type: 'next', offset: 1 },
                    { type: 'next', offset: 2 },
                    { type: 'last', offset: 0 },
                    { type: 'last', offset: 1 },
                    { type: 'last', offset: 2 },
                    { type: 'archived', offset: 0 }
                ];

                let matchesFound = 0;

                for (const endpoint of endpoints) {
                    try {
                        const url = `https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${seasonId}/events/${endpoint.type}/${endpoint.offset}`;
                        await page.goto(url, { waitUntil: 'networkidle2' });
                        const eventsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });

                        if (eventsData && eventsData.events && eventsData.events.length > 0) {
                            const targetEvents = eventsData.events.filter(e => {
                                const dateTR = new Date(e.startTimestamp * 1000);
                                const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                                return validDates.includes(dayStrTR);
                            });
                            
                            if (targetEvents.length > 0) {
                                matchesFound += targetEvents.length;
                                console.log(`      ✅ ${endpoint.type}/${endpoint.offset}: ${targetEvents.length} maç`);
                                allEvents = allEvents.concat(targetEvents);
                            }
                        }
                    } catch (e) {
                        // Sessiz devam et
                    }
                }

                if (matchesFound === 0) {
                    console.log(`      ℹ️ Bu turnuvada bugün playoff maçı bulunamadı`);
                }
            }
        } catch (e) { console.error(`   ❌ Hata (ID ${id}):`, e.message); }
    }

    console.log(`\n📊 TOPLAMDA ${allEvents.length} maç çekildi (Deduplikasyon öncesi)\n`);

    // --- 4. ADIM: VERİ TEMİZLEME VE KAYDETME ---
    const finalMatchesMap = new Map();

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        if (!utId) continue;
        
        const matchKey = `${e.homeTeam.id}_${e.awayTeam.id}_${utId}_${e.startTimestamp}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const isFinished = e.status?.type === 'finished';

        const matchObj = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: leagueConfigs[utId] || "TFF YouTube", 
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
            tournament: e.tournament.uniqueTournament.name,
            _rawStatus: e.status?.type
        };

        if (finalMatchesMap.has(matchKey)) {
            const existing = finalMatchesMap.get(matchKey);
            if (isFinished || (e.status?.type === 'inprogress' && existing._rawStatus !== 'finished')) {
                finalMatchesMap.set(matchKey, matchObj);
            }
        } else {
            finalMatchesMap.set(matchKey, matchObj);
        }
    }

    const finalMatches = Array.from(finalMatchesMap.values()).map(m => {
        delete m._rawStatus;
        return m;
    });

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`✅ İşlem Tamamlandı!`);
    console.log(`📁 Kayıtlı Maç Sayısı: ${finalMatches.length} (Deduplikasyondan Sonra)`);
    console.log(`💾 Dosya: ${OUTPUT_FILE}`);
    
    await browser.close();
}

start();
