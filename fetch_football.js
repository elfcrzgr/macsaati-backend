const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- GELİŞMİŞ ÇEVİRİ SÖZLÜĞÜ (Harf Temizliği Destekli) ---
const teamTranslations = {
    "romania": "Romanya", "czechia": "Çekya", "denmark": "Danimarka",
    "north macedonia": "K. Makedonya", "italy": "İtalya", "northern ireland": "Kuzey İrlanda",
    "poland": "Polonya", "albania": "Arnavutluk", "slovakia": "Slovakya",
    "ukraine": "Ukrayna", "sweden": "İsveç", "wales": "Galler",
    "bosnia": "Bosna Hersek", "bolivia": "Bolivya", "suriname": "Surinam",
    "new caledonia": "Yeni Kaledonya", "jamaica": "Jamaika", "switzerland": "İsviçre",
    "germany": "Almanya", "turkey": "Türkiye", "ireland": "İrlanda",
    "croatia": "Hırvatistan", "france": "Fransa", "brazil": "Brezilya",
    "spain": "İspanya", "netherlands": "Hollanda", "latvia": "Letonya",
    "luxembourg": "Lüksemburg", "gibraltar": "Cebelitarık", "malta": "Malta",
    "kosovo": "Kosova"
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

const leagueConfigs = {
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

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);
const stubbornLeagueIds = [11, 10618, 351, 10, 97, 11415, 11416, 11417, 15938, 155, 54, 4664];

async function start() {
    console.log("🚀 MAÇ SAATİ AKILLI MOTOR BAŞLATILDI...");
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
            console.log(`⚡ Lig ID: ${id} için sezonlar taranıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (seasonsData?.seasons?.length > 0) {
                const sId = seasonsData.seasons[0].id; // Sadece en güncel sezon
                console.log(`🔎 Sezon ID: ${sId} için etkinlikler sorgulanıyor...`);
                for (const type of ['next/0', 'last/0']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${sId}/events/${type}`, { waitUntil: 'networkidle2' });
                    const eventsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
                    if (eventsData?.events) {
                        const targetEvents = eventsData.events.filter(e => {
                            const dateTR = new Date(e.startTimestamp * 1000);
                            const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                            return validDates.includes(dayStrTR);
                        });
                        if (targetEvents.length > 0) {
                            console.log(`🎯 Lig ${id} için ${targetEvents.length} maç derin taramadan yakalandı.`);
                            allEvents = allEvents.concat(targetEvents);
                        }
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
            broadcaster: leagueConfigs[utId] || "Resmi Yayıncı / Canlı Skor", 
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
    
    console.log(`✅ İŞLEM TAMAMLANDI: Toplam ${finalMatches.length} maç JSON'a yazıldı.`);
    console.log("-----------------------------------------");
    await browser.close();
}

start();
