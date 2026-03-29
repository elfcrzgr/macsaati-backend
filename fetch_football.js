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
    "ireland": "İrlanda", "croatia": "Hırvatistan", "france": "Fransa",
    "brazil": "Brezilya", "spain": "İspanya", "netherlands": "Hollanda",
    "kosovo": "Kosova", "austria": "Avusturya", "belgium": "Belçika",
    "azerbaijan": "Azerbaycan", "turkiye": "Türkiye"
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

// --- YAYINCI VE LİG TANIMLARI ---
const leagueConfigs = {
    155: "Spor Smart / Exxen", 54: "S Sport Plus / TV+",
    10: "Exxen / S Sport+", 10618: "Exxen / FIFA+",
    351: "TRT Spor / Tabii", 4664: "S Sport+ / TV+",
    11: "TRT 1 / Tabii", 52: "beIN Sports",
    98: "beIN Sports / TRT Spor", 97: "TFF YouTube",
    17: "beIN Sports", 8: "S Sport", 23: "S Sport",
    7: "TRT / Tabii", 696: "DAZN / YouTube",
    13363: "USL YouTube", 10783: "S Sport Plus / TRT",
    748: "TRT Spor",           // U19 Avrupa Şampiyonası
    10620: "TRT Spor",         // U21 Avrupa Şampiyonası Elemeleri
    13: "Spor Smart",          // Brezilya Serie A
    366: "CBC Sport",          // Azerbaycan Premier Lig
    707: "Dinamik"             // Dünya Kupası Elemeleri (Aşağıda özel mantıkla çözülecek)
};

// Dinamik Yayıncı Belirleme Fonksiyonu
const getBroadcaster = (event) => {
    const utId = event.tournament?.uniqueTournament?.id;
    const home = event.homeTeam.name.toLowerCase();
    const away = event.awayTeam.name.toLowerCase();
    const isTurkeyMatch = home.includes("turkey") || home.includes("türkiye") || away.includes("turkey") || away.includes("türkiye");

    // Dünya Kupası Elemeleri Özel Kuralı (ID: 707)
    if (utId === 707) {
        if (isTurkeyMatch) {
            // Play-off tespiti (Eğer kupa aşamasıysa veya SofaScore round bilgisinde varsa)
            // Genelde eleme maçları bittiğinde Play-off'lar başlar. Şimdilik ikisini de kapsayan bir string:
            return "TV8 / TRT"; 
        }
        return "Exxen";
    }

    return leagueConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);
const stubbornLeagueIds = [11, 351, 10, 97, 155, 54, 4664, 748, 10620, 13, 366, 707];

async function start() {
    console.log("🚀 MAÇ SAATİ AKILLI MOTOR BAŞLATILDI (Yeni Ligler Dahil)...");
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
            console.log(`📌 [${date}] Tarihli Maçlar Çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    return targetLeagueIds.includes(utId) || (e.tournament?.uniqueTournament?.priority > 100);
                });
                console.log(`✅ ${date} için ${filtered.length} maç bulundu.`);
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`❌ Hata (${date}):`, e.message); }
    }

    console.log("-----------------------------------------");
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
                        if (targetEvents.length > 0) allEvents = allEvents.concat(targetEvents);
                    }
                }
            }
        } catch (e) { }
    }

    console.log("-----------------------------------------");
    console.log("💾 VERİLER AYIKLANIYOR VE KAYDEDİLİYOR...");
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
            broadcaster: getBroadcaster(e), // Dinamik yayıncı fonksiyonunu kullanıyor
            homeTeam: { 
                name: translateTeam(e.homeTeam.name), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: translateTeam(e.awayTeam.name), 
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
