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
// 🛠️ YARDIMCI FONKSİYONLAR (RAPOR ODAKLI)
// =========================================================================

async function uploadToFirebase(sportName, data, matchCount) {
    try {
        const url = `${FIREBASE_BASE_URL}matches_${sportName}.json`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} -> ${matchCount} Maç Güncellendi!`);
        } else {
            console.error(`⚠️ [FIREBASE] ${sportName} Hatası: ${response.statusText}`);
        }
    } catch (error) {
        console.error(`⚠️ [FIREBASE] ${sportName} Bağlantı Koptu!`);
    }
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

// =========================================================================
// ⚽ FUTBOL (DETAYLI ANALİZ RAPORU)
// =========================================================================
const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 238, 38, 36, 19, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 13363, 10783, 96];
const REGULAR_FOOT_IDS = [299, 6516, 325, 155, 242, 11415, 11416, 11417, 15938];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

async function updateFootball() {
    console.log(`⚽ Futbol taranıyor...`);
    let allEvents = [];
    const leagueCount = { 52: 0, 98: 0, 97: 0, alt: 0 };

    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const utId = e.tournament?.uniqueTournament?.id;
                const catId = e.tournament?.category?.id;
                const utName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
                const tourName = (e.tournament?.name || "").toLowerCase();
                
                const isMain = ALL_FOOT_TARGETS.includes(utId);
                const isTurkishLower = (catId === 48) && (utName.includes("2. lig") || utName.includes("3. lig") || tourName.includes("playoff") || tourName.includes("play-off") || utName.includes("tff"));
                
                if (isMain || isTurkishLower) {
                    if (utId === 52) leagueCount[52]++;
                    else if (utId === 98) leagueCount[98]++;
                    else if (utId === 97) leagueCount[97]++;
                    else if (catId === 48) leagueCount.alt++;
                    return true;
                }
                return false;
            }));
        }
    }

    const matches = allEvents.map(e => ({ id: e.id, homeTeam: { name: e.homeTeam.name }, awayTeam: { name: e.awayTeam.name }, tournament: e.tournament.name, timestamp: e.startTimestamp * 1000 }));
    
    await uploadToFirebase("football", { success: true, matches }, matches.length);
    console.log(`   📊 Futbol Özeti -> Süper Lig: ${leagueCount[52]} | 1.Lig: ${leagueCount[98]} | 2.Lig: ${leagueCount[97]} | 3.Lig/Playoff: ${leagueCount.alt}`);
    
    return { hasLiveMatch: allEvents.some(e => e.status.type === 'inprogress') };
}

// =========================================================================
// 🏀 BASKETBOL, 🎾 TENİS, 🏎️ F1 (SAYILI RAPOR)
// =========================================================================

async function updateBasketball() {
    console.log(`🏀 Basketbol taranıyor...`);
    const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${getTRDate(0)}`);
    const count = data?.events ? data.events.length : 0;
    await uploadToFirebase("basketball", { success: true, matches: data?.events || [] }, count);
}

async function updateTennis() {
    console.log(`🎾 Tenis taranıyor...`);
    const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${getTRDate(0)}`);
    const count = data?.events ? data.events.length : 0;
    await uploadToFirebase("tennis", { success: true, matches: data?.events || [] }, count);
}

async function updateF1() {
    console.log(`🏎️ Formula 1 taranıyor...`);
    const data = await fetchData('https://api.jolpi.ca/ergast/f1/current.json');
    const count = data?.MRData?.RaceTable?.Races?.length || 0;
    await uploadToFirebase("f1", { success: true, events: data ? [data] : [] }, count);
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 SUNUCU BAŞLADI - DETAYLI LİG RAPORU AKTİF");
    console.log("============================================================");
    
    let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 

    while (true) {
        try {
            if (timeSinceLastFullUpdate >= FULL_UPDATE_INTERVAL_MS) {
                console.log(`\n🔄 [TAM GÜNCELLEME] ${new Date().toLocaleTimeString('tr-TR')}`);
                await updateFootball();
                await updateBasketball();
                await updateTennis();
                await updateF1();
                console.log(`------------------------------------------------------------`);
                timeSinceLastFullUpdate = 0; 
            } else {
                await updateFootball();
            }
        } catch (e) { console.error("🚨 Hata:", e.message); }
        
        await new Promise(r => setTimeout(r, MINUTE_MS));
        timeSinceLastFullUpdate += MINUTE_MS;
    }
}

main();
