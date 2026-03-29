const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- GITHUB VE KLASÖR YAPILANDIRMASI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const TEAM_FOLDER = "logos"; 
const TOURNAMENT_FOLDER = "tournament_logos"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/${TEAM_FOLDER}/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/${TOURNAMENT_FOLDER}/`;
const OUTPUT_FILE = "matches_football.json";

// --- GELİŞMİŞ ÇEVİRİ SÖZLÜĞÜ ---
const teamTranslations = {
    "romania": "Romanya", "czechia": "Çekya", "denmark": "Danimarka",
    "north macedonia": "K. Makedonya", "italy": "İtalya", "northern ireland": "Kuzey İrlanda",
    "poland": "Polonya", "albania": "Arnavutluk", "slovakia": "Slovakya",
    "ukraine": "Ukrayna", "sweden": "İsveç", "wales": "Galler",
    "bosnia": "Bosna Hersek", "germany": "Almanya", "turkey": "Türkiye",
    "croatia": "Hırvatistan", "france": "Fransa", "brazil": "Brezilya",
    "spain": "İspanya", "netherlands": "Hollanda", "austria": "Avusturya", "belgium": "Belçika"
};

const translateTeam = (name) => {
    if (!name) return name;
    const cleanName = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (teamTranslations[cleanName]) return teamTranslations[cleanName];
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanName.includes(eng)) return tr;
    }
    return name;
};

// --- AKILLI YAYINCI BELİRLEME FONKSİYONU ---
const getBroadcaster = (utId, homeName, awayName, tournamentName) => {
    const isTurkey = homeName.includes("Türkiye") || awayName.includes("Türkiye") || 
                     homeName.includes("Turkey") || awayName.includes("Turkey");
    const isPlayoff = tournamentName.toLowerCase().includes("play-off") || 
                      tournamentName.toLowerCase().includes("playoff");

    // U19 (748) ve U21 (750) Elemeleri
    if (utId === 748 || utId === 750) {
        return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    }

    // Dünya Kupası Elemeleri (704)
    if (utId === 704) {
        if (isTurkey) {
            return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        }
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }

    // Sabit Yayıncılar
    const staticConfigs = {
        13: "Spor Smart",       // Brezilya Serie A
        393: "CBC Sport",       // Azerbaycan Premier Lig
        155: "Spor Smart / Exxen", 54: "S Sport Plus / TV+",
        10: "Exxen / S Sport+", 10618: "Exxen / FIFA+",
        351: "TRT Spor / Tabii", 4664: "S Sport+ / TV+",
        11: "TRT 1 / Tabii", 52: "beIN Sports",
        98: "beIN Sports / TRT Spor", 97: "TFF YouTube",
        11417: "TFF YouTube", 11416: "TFF YouTube",
        11415: "TFF YouTube", 15938: "TFF YouTube",
        17: "beIN Sports", 8: "S Sport", 23: "S Sport",
        7: "TRT / Tabii", 696: "DAZN / YouTube",
        13363: "USL YouTube", 10783: "S Sport Plus / TRT"
    };

    return staticConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

// Takip edilen Lig ID'leri
const targetLeagueIds = [748, 750, 704, 13, 393, 155, 54, 10, 10618, 351, 4664, 11, 52, 98, 97, 11417, 11416, 11415, 15938, 17, 8, 23, 7, 696, 13363, 10783];
const stubbornLeagueIds = [11, 10618, 351, 10, 97, 748, 750, 704, 13, 393];

async function start() {
    console.log("🚀 MAÇ SAATİ AKILLI MOTOR BAŞLATILDI (Dünya Kupası & Brezilya Dahil)...");
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
    
    console.log("-----------------------------------------");
    console.log("📅 GENEL TARAMA BAŞLADI...");
    for (const date of validDates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    return targetLeagueIds.includes(utId) || (e.tournament?.uniqueTournament?.priority > 100);
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { }
    }

    console.log("🔍 DERİN TARAMA (İnatçı Ligler) BAŞLADI...");
    for (const id of stubbornLeagueIds) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (seasonsData?.seasons?.length > 0) {
                const sId = seasonsData.seasons[0].id;
                for (const type of ['next/0', 'last/0']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${sId}/events/${type}`, { waitUntil: 'networkidle2' });
                    const eventsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
                    if (eventsData?.events) {
                        const targetEvents = eventsData.events.filter(e => {
                            const dateTR = new Date(e.startTimestamp * 1000);
                            const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                            return validDates.includes(dayStrTR);
                        });
                        allEvents = allEvents.concat(targetEvents);
                    }
                }
            }
        } catch (e) { }
    }

    console.log("💾 VERİLER AYIKLANIYOR...");
    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        if (!utId) continue;
        
        const hName = e.homeTeam.name;
        const aName = e.awayTeam.name;
        const tName = e.tournament.name;
        const matchKey = `${hName}_${aName}_${utId}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        const isFinished = e.status?.type === 'finished' || e.status?.type === 'inprogress';

        const matchObj = {
            id: e.id,
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            // Akıllı yayıncı kontrolü burada devreye giriyor:
            broadcaster: getBroadcaster(utId, hName, aName, tName), 
            homeTeam: { 
                name: translateTeam(hName), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: translateTeam(aName), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: isFinished ? String(e.homeScore.display) : "-",
            awayScore: isFinished ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };

        finalMatchesMap.set(matchKey, matchObj);
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`✅ İŞLEM TAMAMLANDI: Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();
