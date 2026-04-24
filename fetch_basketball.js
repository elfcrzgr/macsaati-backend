const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const OUTPUT_FILE = "matches_basketball.json";

const ELITE_LEAGUE_IDS = [
    3547, 138, 142, 137, 132, 167, 168   
];

const leagueConfigs = {
    3547: "S Sport / NBA TV",         
    138: "S Sport / S Sport Plus",   
    142: "S Sport Plus",             
    137: "TRT Spor / Tabii",         
    132: "beIN Sports 5",            
    167: "S Sport Plus / FIBA TV",   
    168: "TRT Spor Yıldız",           
    9357: "S Sport Plus",            
    139: "beIN Sports / TRT Spor",   
    11511: "TRT Spor Yıldız / TBF TV", 
    21511: "TBF TV (YouTube)", 
    251: "S Sport Plus", 
    215: "S Sport Plus",
    304: "S Sport Plus", 
    227: "beIN Sports", 
    164: "beIN Sports",
    235: "S Sport Plus", 
    405: "beIN Sports"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatıldı (Truva Atı & Canlı Skor Fix)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);
    let allEvents = [];

    // 🛡️ GÜVENLİK DUVARI AŞIMI
    console.log("🛡️ Basketbol için güvenlik duvarı aşılıyor...");
    try {
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000)); // 5 saniye bekleme
    } catch (e) {
        console.log("⚠️ Ana sayfa yüklenirken zaman aşımı oldu ama devam ediliyor...");
    }

    for (const date of [getTRDate(-1), trToday, trTomorrow]) {
        try {
            console.log(`📡 ${date} basketbol programı çekiliyor...`);
            const data = await page.evaluate(async (d) => {
                try {
                    // API adresini www üzerinden fetch ediyoruz
                    const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);
                    if (!res.ok) return null;
                    return await res.json();
                } catch(e) { return null; }
            }, date);

            if (data && data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        const utName = e.tournament?.uniqueTournament?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        if (dayStr !== trToday && dayStr !== trTomorrow) continue;

        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';
        const isCanceled = statusType === 'canceled' || statusType === 'postponed';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        if (isInProgress) {
            timeString = `${timeString}\nCANLI`; 
        } else if (isCanceled) {
            timeString = `İPTAL`;
        }

        // 🚀 CANLI SKOR DÜZELTMESİ: Maç bittiyse veya devam ediyorsa skoru göster
        const hasScore = isFinished || isInProgress;

        finalMatches.push({
            id: e.id,
            isElite: ELITE_LEAGUE_IDS.includes(utId), 
            status: statusType, 
            fixedDate: dayStr,
            fixedTime: timeString, 
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId] || "Resmi Yayıncı", 
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASE_URL + "tournament_logos/" + (isNBA ? "3547" : utId) + ".png",
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : utName
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

    console.log(`✅ İşlem bitti. Basketbol: ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();