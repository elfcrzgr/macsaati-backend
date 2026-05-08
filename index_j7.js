const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// =========================================================================
// ⚙️ AYARLAR VE FIREBASE BAĞLANTISI
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const MINUTE_MS = 60000; 
const FULL_UPDATE_INTERVAL_MS = 20 * 60000; 
const FIREBASE_BASE_URL = "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

let externalBroadcasters = {};

// =========================================================================
// 🌍 TAKIM VE ÜLKE ÇEVİRİLERİ (EKSİKSİZ)
// =========================================================================
const teamTranslations = {
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere",
    "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "netherlands": "Hollanda",
    "belgium": "Belçika", "switzerland": "İsviçre", "austria": "Avusturya", "croatia": "Hırvatistan",
    "denmark": "Danimarka", "scotland": "İskoçya", "hungary": "Macaristan", "serbia": "Sırbistan",
    "poland": "Polonya", "czechia": "Çekya", "romania": "Romanya", "slovakia": "Slovakya",
    "slovenia": "Slovenya", "georgia": "Gürcistan", "albania": "Arnavutluk", "norway": "Norveç",
    "sweden": "İsveç", "ukraine": "Ukrayna", "greece": "Yunanistan", "wales": "Galler",
    "finland": "Finlandiya", "ireland": "İrlanda", "northernireland": "Kuzey İrlanda",
    "brazil": "Brezilya", "argentina": "Arjantin", "usa": "ABD", "japan": "Japonya"
};

const translateTeam = (name) => {
    if (!name) return name;
    let translatedName = name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) {
            translatedName = name.replace(new RegExp(eng, 'i'), tr);
            return translatedName;
        }
    }
    return name;
};

// =========================================================================
// 🌉 YAYINCI MOTORU (JSON EŞLEŞTİRME)
// =========================================================================
async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?_=${Date.now()}`;
        const response = await fetch(url);
        if (response.ok) externalBroadcasters = await response.json();
    } catch (e) { externalBroadcasters = {}; }
}

function applyBroadcaster(sport, date, time, home, away, fallback) {
    const h = (home || "").toLowerCase();
    const a = (away || "").toLowerCase();
    const ignoreList = ['spor', 'club', 'team', 'united', 'city', 'real', 'fc', 'fk', 'sk', 'bk', 'de', 'la'];
    const getWords = (name) => name.replace(/[^\w\sğüşıöç]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !ignoreList.includes(w));
    const hWords = getWords(h);
    const aWords = getWords(a);

    for (const dateKey in externalBroadcasters) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        for (const m of dayData.matches) {
            if (m.spor && m.spor.toLowerCase() === sport.toLowerCase()) {
                const mTitle = (m.mac || "").toLowerCase();
                let matchFound = (hWords.length > 0 && hWords.some(w => mTitle.includes(w))) && 
                                 (aWords.length > 0 && aWords.some(w => mTitle.includes(w)));
                if (matchFound) return m.yayin; 
            }
        }
    }
    return fallback; 
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function uploadToFirebase(sport, data, count) {
    try {
        const url = `${FIREBASE_BASE_URL}matches_${sport}.json`;
        await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        console.log(`✅ [FIREBASE] ${sport.toUpperCase()} -> ${count} Veri Güncellendi!`);
    } catch (e) { console.error(`🚨 Firebase Hatası (${sport})`); }
}

async function fetchData(url) {
    try {
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.sofascore.com/" } });
        return response.ok ? await response.json() : null;
    } catch (e) { return null; }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

function calculateLiveMinute(eventData) {
    if (eventData.time?.currentMinute !== undefined) return String(eventData.time.currentMinute) + "'";
    if (eventData.status?.code === 31) return "İY";
    return "Canlı";
}

// =========================================================================
// ⚽ FUTBOL (3. LİG PLAY-OFF FIX + ANALİZ)
// =========================================================================
const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 238, 38, 36, 19, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 13363, 10783, 96];
const REGULAR_FOOT_IDS = [299, 6516, 325, 155, 242, 11415, 11416, 11417, 15938];
const footballLeagues = { 52: "Süper Lig", 98: "1. Lig", 97: "2. Lig", 96: "Kupa", 11417: "3. Lig G1", 11416: "3. Lig G2", 11415: "3. Lig G3", 15938: "3. Lig G4" };

async function updateFootball() {
    console.log(`⚽ Futbol taranıyor...`);
    let allEvents = [];
    const counts = { s: 0, b: 0, i: 0, u: 0 }; 

    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const utId = e.tournament?.uniqueTournament?.id;
                const catId = e.tournament?.category?.id;
                const utn = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
                const tn = (e.tournament?.name || "").toLowerCase();
                const isTarget = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS].includes(utId) || 
                                (catId === 48 && (utn.includes("lig") || utn.includes("tff") || tn.includes("play")));
                if (isTarget) {
                    if (utId === 52) counts.s++; else if (utId === 98) counts.b++; else if (utId === 97) counts.i++; else counts.u++;
                }
                return isTarget;
            }));
        }
    }

    const matches = allEvents.map(e => {
        const dTR = new Date(e.startTimestamp * 1000);
        const day = dTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const time = dTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const utn = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
        const tn = (e.tournament?.name || "").toLowerCase();
        const defYayin = (e.tournament?.uniqueTournament?.id === 52) ? "beIN Sports" : "Resmi Yayıncı / Canlı Skor";
        const finalBroadcaster = applyBroadcaster("futbol", day, time, e.homeTeam.name, e.awayTeam.name, defYayin);

        return {
            id: e.id, status: e.status.type, fixedDate: day, fixedTime: time, timestamp: e.startTimestamp * 1000,
            isElite: ELITE_FOOT_IDS.includes(e.tournament?.uniqueTournament?.id) || utn.includes("lig") || tn.includes("play"),
            liveMinute: (e.status.type === 'inprogress') ? calculateLiveMinute(e) : "",
            broadcaster: finalBroadcaster,
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${e.tournament?.uniqueTournament?.id || 0}.png`,
            homeScore: (e.status.type !== 'notstarted') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (e.status.type !== 'notstarted') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: footballLeagues[e.tournament?.uniqueTournament?.id] || e.tournament.name
        };
    });

    await uploadToFirebase("football", { success: true, matches }, matches.length);
    console.log(`   📊 Analiz -> Süper: ${counts.s} | 1.Lig: ${counts.b} | 2.Lig: ${counts.i} | Alt/Kupa: ${counts.u}`);
    return { hasLiveMatch: allEvents.some(e => e.status.type === 'inprogress'), nextMatchTimestamp: matches.filter(m => m.status === 'notstarted')[0]?.timestamp };
}

// =========================================================================
// 🏀 BASKETBOL (NBA LOGO FIX)
// =========================================================================
const ELITE_BASK_IDS = [132, 138, 141, 519, 9357, 264, 285];

async function updateBasketball() {
    console.log(`🏀 Basketbol taranıyor...`);
    const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${getTRDate(0)}`);
    const events = (data?.events || []).filter(e => ELITE_BASK_IDS.includes(e.tournament?.uniqueTournament?.id));
    
    const matches = events.map(e => {
        const utId = e.tournament?.uniqueTournament?.id;
        const utn = (e.tournament?.uniqueTournament?.name || "").toUpperCase();
        const dTR = new Date(e.startTimestamp * 1000);
        const day = dTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const time = dTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const isNBA = (utId === 3547 || utn.includes("NBA"));
        const finalBroadcaster = applyBroadcaster("basketbol", day, time, e.homeTeam.name, e.awayTeam.name, "beIN / S Sport");

        return {
            id: e.id, isElite: true, status: e.status.type, fixedDate: day, fixedTime: time, timestamp: dTR.getTime(),
            broadcaster: finalBroadcaster,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            tournament: e.tournament.name, homeScore: String(e.homeScore?.display ?? "0"), awayScore: String(e.awayScore?.display ?? "0")
        };
    });
    await uploadToFirebase("basketball", { success: true, matches }, matches.length);
}

// =========================================================================
// 🎾 TENİS (RANKING + BAYRAKLAR)
// =========================================================================
async function updateTennis() {
    console.log(`🎾 Tenis taranıyor...`);
    const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${getTRDate(0)}`);
    const matches = (data?.events || []).filter(e => !(e.tournament?.name || "").toUpperCase().includes("ITF")).map(e => {
        const hCode = (e.homeTeam?.country?.alpha2 || "mc").toLowerCase();
        const aCode = (e.awayTeam?.country?.alpha2 || "mc").toLowerCase();
        return {
            id: e.id, status: e.status.type, fixedDate: getTRDate(0), tournament: e.tournament.name,
            broadcaster: applyBroadcaster("tenis", getTRDate(0), "", e.homeTeam.name, e.awayTeam.name, "beIN / S Sport"),
            homeTeam: { name: e.homeTeam.name, ranking: e.homeTeam?.ranking || "-", logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${hCode}.png` },
            awayTeam: { name: e.awayTeam.name, ranking: e.awayTeam?.ranking || "-", logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${aCode}.png` },
            homeScore: String(e.homeScore?.display ?? "0"), awayScore: String(e.awayScore?.display ?? "0")
        };
    });
    await uploadToFirebase("tennis", { success: true, matches }, matches.length);
}

// =========================================================================
// 🏎️ F1
// =========================================================================
async function updateF1() {
    console.log(`🏎️ F1 taranıyor...`);
    const data = await fetchData('https://api.jolpi.ca/ergast/f1/current.json');
    const races = data?.MRData?.RaceTable?.Races || [];
    const events = races.map(r => ({ ...r, broadcaster: applyBroadcaster("f1", r.date, "", r.raceName, "", "beIN Sports / F1 TV") }));
    await uploadToFirebase("f1", { success: true, events }, events.length);
}

// =========================================================================
// 🔄 ANA DÖNGÜ (AKILLI TAKİP)
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 MASTER SUNUCU BAŞLADI - SIFIR KAYIP MODU");
    console.log("============================================================");
    let footballStatus = { hasLiveMatch: false, nextMatchTimestamp: null };
    let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 
    let iteration = 1;

    while (true) {
        try {
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            await loadExternalBroadcasters();
            const now = Date.now();
            const isMatchStarting = footballStatus.nextMatchTimestamp && (now >= (footballStatus.nextMatchTimestamp - 60000));
            
            if (timeSinceLastFullUpdate >= FULL_UPDATE_INTERVAL_MS) {
                footballStatus = await updateFootball();
                await updateBasketball(); await updateTennis(); await updateF1();
                timeSinceLastFullUpdate = 0; 
            } else if (footballStatus.hasLiveMatch || isMatchStarting) {
                footballStatus = await updateFootball();
            } else {
                const nextUpdate = Math.round((FULL_UPDATE_INTERVAL_MS - timeSinceLastFullUpdate) / 60000);
                console.log(`💤 Dinleniyor... Tam güncellemeye ${nextUpdate} dk kaldı.`);
            }
        } catch (e) { console.error("🚨 Hata:", e.message); }
        await new Promise(r => setTimeout(r, MINUTE_MS));
        timeSinceLastFullUpdate += MINUTE_MS;
        iteration++;
    }
}
main();
