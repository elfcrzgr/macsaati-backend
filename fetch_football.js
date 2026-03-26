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
const stubbornLeagueIds = [97, 11415, 11416, 11417, 15938, 17011, 10783, 14605];

// GraphQL ile playoff maçlarını çek
async function fetchPlayoffMatchesGraphQL(page, tournamentId) {
    try {
        const query = {
            operationName: "TournamentEvents",
            variables: {
                tournamentId: tournamentId,
                first: 100
            },
            query: `
                query TournamentEvents($tournamentId: ID!, $first: Int) {
                    tournament(id: $tournamentId) {
                        id
                        name
                        events(first: $first) {
                            nodes {
                                id
                                homeTeam { id name }
                                awayTeam { id name }
                                startTimestamp
                                status { type }
                                homeScore { display }
                                awayScore { display }
                                tournament { 
                                    uniqueTournament { id name }
                                }
                            }
                        }
                    }
                }
            `
        };

        // GraphQL endpoint'e POST yap
        const response = await page.evaluate(async (query) => {
            const res = await fetch('https://api.sofascore.com/api/v1/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
            });
            return res.json();
        }, query);

        return response?.data?.tournament?.events?.nodes || [];
    } catch (e) {
        return [];
    }
}

// Turnuva sayfasından maç bilgisini parse et
async function fetchPlayoffMatchesDOM(page, tournamentUrl) {
    try {
        console.log(`   🌐 Web Sayfası Açılıyor: ${tournamentUrl}`);
        await page.goto(tournamentUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Network isteklerini yakala
        const allApiData = [];
        let captureRequests = true;

        page.on('response', async (response) => {
            if (captureRequests && response.url().includes('api.sofascore.com')) {
                try {
                    const text = await response.text();
                    const json = JSON.parse(text);
                    if (json.events) {
                        allApiData.push(json.events);
                    }
                } catch (e) { }
            }
        });

        // Sayfanın tamamen yüklenmesini bekle
        await page.waitForTimeout(3000);
        captureRequests = false;

        // Tüm captured events'i birleştir
        const allEvents = allApiData.flat();
        return allEvents;
    } catch (e) {
        console.error(`   ❌ DOM Parse Hatası: ${e.message}`);
        return [];
    }
}

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (GraphQL + Web Scraping)...");
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

    // --- 3. ADIM: DERİN DALIŞ ---
    for (const id of stubbornLeagueIds) {
        try {
            console.log(`🔍 Derin Dalış: Turnuva ID ${id}`);
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (seasonsData && seasonsData.seasons && seasonsData.seasons.length > 0) {
                const seasonId = seasonsData.seasons[0].id;

                for (const pageType of ['next/0', 'next/1', 'next/2', 'last/0', 'last/1', 'last/2']) {
                    try {
                        await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${seasonId}/events/${pageType}`, { waitUntil: 'networkidle2' });
                        const eventsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });

                        if (eventsData && eventsData.events) {
                            const targetEvents = eventsData.events.filter(e => {
                                const dateTR = new Date(e.startTimestamp * 1000);
                                const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                                return validDates.includes(dayStrTR);
                            });
                            if (targetEvents.length > 0) {
                                allEvents = allEvents.concat(targetEvents);
                            }
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { console.error(`❌ Hata (ID ${id}):`, e.message); }
    }

    // --- 4. ADIM: PLAYOFF MAÇLARI (DYNAMIK - TURNUVA ID ÜZERINDEN) ---
    console.log(`\n🏆 PLAYOFF MAÇLARI (Dinamik Tarama)...`);
    
    // Playoff turnuvaların URL'lerini bir config'e koyabiliriz
    const playoffTournaments = [
        { id: 17011, slug: 'world-championship-qual-uefa', name: 'Dünya Kupası Elemeleri' }
    ];

    for (const tournament of playoffTournaments) {
        try {
            console.log(`\n   📍 ${tournament.name} (ID: ${tournament.id})`);
            
            // URL dinamik oluştur (slug biliniyorsa)
            let matchesFound = [];

            if (tournament.slug) {
                // Web sayfasından çek (slug kullan)
                const tournamentUrl = `https://www.sofascore.com/tr/football/tournament/europe/${tournament.slug}/11`;
                matchesFound = await fetchPlayoffMatchesDOM(page, tournamentUrl);
            }

            // Fallback: Direct API'den GraphQL ile çek
            if (matchesFound.length === 0) {
                console.log(`   📍 GraphQL Fallback: Tournament ID ${tournament.id}`);
                matchesFound = await fetchPlayoffMatchesGraphQL(page, tournament.id);
            }

            // Tarihe göre filtrele
            const todayMatches = matchesFound.filter(e => {
                if (!e.startTimestamp) return false;
                const dateTR = new Date(e.startTimestamp * 1000);
                const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                return validDates.includes(dayStrTR);
            });

            if (todayMatches.length > 0) {
                console.log(`      ✅ ${todayMatches.length} playoff maçı bulundu`);
                allEvents = allEvents.concat(todayMatches);
            } else {
                console.log(`      ℹ️ Bugün playoff maçı yok`);
            }
        } catch (e) {
            console.error(`   ❌ ${tournament.name} Hatası: ${e.message}`);
        }
    }

    console.log(`\n📊 TOPLAMDA ${allEvents.length} maç çekildi\n`);

    // --- 5. ADIM: VERİ TEMİZLEME VE KAYDETME ---
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
    console.log(`📁 Kayıtlı Maç Sayısı: ${finalMatches.length}`);
    console.log(`💾 Dosya: ${OUTPUT_FILE}`);
    
    await browser.close();
}

start();
