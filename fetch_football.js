const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- SADECE SENİN İSTEDİĞİN ELİT LİGLER VE 2026 YAYINCILARI ---
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
    41: "TRT / Tabii",             
    8: "S Sport",                  
    54: "S Sport Plus",            
    73: "Tivibu Spor",             
    23: "S Sport",                 
    53: "S Sport Plus",            
    35: "beIN Sports / Tivibu",    
    19: "Tivibu / TRT Spor",       
    34: "beIN Sports",             
    33: "beIN Sports",             
    238: "Tivibu Spor / Spor Smart", 
    170: "S Sport / TV+",            
    13363: "USL YouTube",            
    7: "TRT / Tabii",              
    3: "TRT / Tabii",              
    17015: "TRT / Tabii",          
    1819: "TRT / Tabii / TV8",     
    7544: "TRT / Tabii",           
    4656: "TRT / Tabii",           
    696: "DAZN / YouTube"          
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

// Özel olarak "Derin Dalış" yapılıp grupları tek tek taranacak gizli ligler:
const stubbornLeagueIds = [97, 11415, 11416, 11417, 15938];

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Derin Dalış Modu Aktif)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    const validDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let allEvents = [];
    
    // --- 1. ADIM: GENEL GÜNLÜK MAÇLARI ÇEK ---
    for (const date of validDates) {
        try {
            console.log(`⏳ ${date} genel maç verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    return targetLeagueIds.includes(utId);
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`Genel API Hatası (${date}):`, e.message); }
    }

    // --- 2. ADIM: İNATÇI LİGLER İÇİN DERİN DALIŞ (Senin tespit ettiğin ID'ler üzerinden) ---
    for (const id of stubbornLeagueIds) {
        try {
            console.log(`🔍 Özel Lig Derin Dalış: ID ${id}`);
            // Önce o ligin aktif sezonlarını ve gruplarını buluyoruz (Senin gördüğün 78237 gibi)
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (seasonsData && seasonsData.seasons && seasonsData.seasons.length > 0) {
                // Sadece en güncel yılın gruplarını al (Beyaz ve Kırmızı grubu yakalamak için)
                const currentYear = seasonsData.seasons[0].year;
                const activeSeasons = seasonsData.seasons.filter(s => s.year === currentYear);

                for (const season of activeSeasons) {
                    console.log(`   👉 Grup bulundu: ${season.name} (ID: ${season.id}) maçları çekiliyor...`);
                    // Şimdi o spesifik grubun doğrudan kendi fikstürüne saldırıyoruz
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${season.id}/events/next/0`, { waitUntil: 'networkidle2' });
                    const nextEventsData = await page.evaluate(() => JSON.parse(document.body.innerText));

                    if (nextEventsData && nextEventsData.events) {
                        const targetEvents = nextEventsData.events.filter(e => {
                            const dateTR = new Date(e.startTimestamp * 1000);
                            const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                            return validDates.includes(dayStrTR);
                        });
                        
                        allEvents = allEvents.concat(targetEvents);
                    }
                }
            }
        } catch (e) { console.error(`Derin Dalış Hatası (${id}):`, e.message); }
    }

    // --- 3. ADIM: AYIKLAMA VE DOSYAYA KAYDETME ---
    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        if (!utId) continue;
        
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
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
            homeScore: (e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        });

        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`\n✅ İşlem Tamamlandı. ${finalMatches.length} maç dosyaya kaydedildi.`);
    await browser.close();
}

start();
