const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- GITHUB AYARLARI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const OUTPUT_FILE = "matches_basketball.json";

const leagueConfigs = {
    3547: "S Sport / NBA TV",   // NBA
    9357: "S Sport Plus",       // NCAA
    138: "S Sport / S Sport Plus", 142: "S Sport Plus", 137: "TRT Spor / Tabii",
    168: "TRT Spor Yıldız", 167: "S Sport Plus / FIBA TV", 132: "beIN Sports 5",
    139: "beIN Sports / TRT Spor", 11511: "TRT Spor Yıldız / TBF TV",
    21511: "TBF TV (YouTube)", 251: "S Sport Plus", 215: "S Sport Plus",
    304: "S Sport Plus", 227: "beIN Sports", 164: "beIN Sports",
    235: "S Sport Plus", 405: "beIN Sports"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatıldı (Canlı Durumu ve Görsel Fix Aktif)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);
    let allEvents = [];

    // NBA ve gece maçları için dünü de kontrol ediyoruz
    for (const date of [getTRDate(-1), trToday, trTomorrow]) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
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
        
        // Sadece bugün ve yarının maçlarını listele
        if (dayStr !== trToday && dayStr !== trTomorrow) continue;

        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        // --- DURUM VE GÖRSEL TASARIM MANTIĞI ---
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

        finalMatches.push({
            id: e.id,
            isElite: true, // Listemizde olan tüm basket ligleri elite sayılıyor
            fixedDate: dayStr,
            fixedTime: timeString, // Görseldeki gibi alt alta CANLI yazısı
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
            
            // --- SADECE BİTTİYSE SKOR YAZ, YOKSA "VS" GİBİ "-" KOY ---
            homeScore: (isFinished && e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (isFinished && e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            
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

    console.log(`✅ İşlem bitti. Basketbol maçları (Toplam: ${finalMatches.length}) kaydedildi.`);
    await browser.close();
}

start();