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
// 🌉 YAYINCI DOSYASI (BULUTTAN OKUMA)
// =========================================================================
async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?_=${Date.now()}`;
        const response = await fetch(url);
        if (response.ok) {
            externalBroadcasters = await response.json();
        }
    } catch (e) { externalBroadcasters = {}; }
}

function getBroadcasterWithFallback(sportCategory, dateStr, timeStr, homeName, awayName, fallback) {
    const hName = (homeName || "").toLowerCase();
    const aName = (awayName || "").toLowerCase();
    const ignoreList = ['spor', 'club', 'team', 'united', 'city', 'real', 'fc', 'fk', 'sk', 'bk', 'de', 'la'];
    const getWords = (name) => name.replace(/[^\w\sğüşıöç]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !ignoreList.includes(w));
    const hWords = getWords(hName);
    const aWords = getWords(aName);

    for (const dateKey in externalBroadcasters) {
        const dayData = externalBroadcasters[dateKey];
        if (!dayData || !dayData.matches) continue;
        for (const m of dayData.matches) {
            if (m.spor && m.spor.toLowerCase() === sportCategory.toLowerCase()) {
                const mTitle = (m.mac || "").toLowerCase();
                let hMatch = hWords.length > 0 ? hWords.some(w => mTitle.includes(w)) : mTitle.includes(hName);
                let aMatch = aWords.length > 0 ? aWords.some(w => mTitle.includes(w)) : mTitle.includes(aName);
                if (hMatch && aMatch) return m.yayin; 
            }
        }
    }
    return fallback;
}

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function uploadToFirebase(sportName, data) {
    try {
        const url = `${FIREBASE_BASE_URL}matches_${sportName}.json`;
        await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} güncellendi.`);
    } catch (e) { console.error(`⚠️ Firebase Hatası:`, e.message); }
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
// ⚽ FUTBOL
// =========================================================================
const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 238, 38, 36, 19, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 13363, 10783, 96];
const REGULAR_FOOT_IDS = [299, 6516, 325, 155, 242, 11415, 11416, 11417, 15938];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = {
    52: "Türkiye Süper Lig", 98: "Trendyol 1. Lig", 97: "TFF 2. Lig", 96: "Türkiye Kupası",
    11417: "TFF 3. Lig 1. Grup", 11416: "TFF 3. Lig 2. Grup", 11415: "TFF 3. Lig 3. Grup", 15938: "TFF 3. Lig 4. Grup"
};

function calculateLiveMinute(eventData) {
    if (eventData.time?.currentMinute !== undefined) return String(eventData.time.currentMinute) + "'";
    if (eventData.status?.code === 31) return "İY";
    return "Canlı";
}

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor (Play-off & Akıllı Log Aktif)...`);
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const utId = e.tournament?.uniqueTournament?.id;
                const catId = e.tournament?.category?.id;
                const utName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
                const tourName = (e.tournament?.name || "").toLowerCase();
                const isMainLeague = ALL_FOOT_TARGETS.includes(utId);
                const isTurkishLower = (catId === 48) && (
                    utName.includes("2. lig") || utName.includes("3. lig") || tourName.includes("2. lig") || tourName.includes("3. lig") ||
                    utName.includes("play-off") || utName.includes("playoff") || utName.includes("tff")
                );
                return isMainLeague || isTurkishLower;
            }));
        }
    }

    const duplicateTracker = new Map();
    const leagueCount = {}; // 🚀 Detaylı log için sayaç geri geldi

    allEvents.forEach(e => {
        if (duplicateTracker.has(e.id)) return;
        const status = e.status.type;
        const isLive = status === 'inprogress';
        const leagueId = e.tournament?.uniqueTournament?.id;
        
        // Sayaç işlemleri
        leagueCount[leagueId] = (leagueCount[leagueId] || 0) + 1;

        const utName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
        const hName = e.homeTeam.name || "";
        const aName = e.awayTeam.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const cleanTournamentName = footballLeagues[leagueId] || e.tournament?.name || e.tournament?.uniqueTournament?.name;
        const finalBroadcaster = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, "Resmi Yayıncı");
        
        const isEliteMatch = ELITE_FOOT_IDS.includes(leagueId) || utName.includes("3. lig") || utName.includes("2. lig") || utName.includes("play");

        duplicateTracker.set(e.id, {
            id: e.id, isElite: isEliteMatch, status: status,
            liveMinute: isLive ? calculateLiveMinute(e) : "",
            fixedDate: dayTR, fixedTime: timeString, timestamp: e.startTimestamp * 1000,
            broadcaster: finalBroadcaster,
            homeTeam: { name: hName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: aName, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${leagueId}.png`,
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: cleanTournamentName
        });
    });

    const matches = Array.from(duplicateTracker.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("football", { success: true, matches });

    // 🚀 AYRINTILI LOGLARI BASALIM
    console.log(`   📈 Detaylar: Süper Lig: ${leagueCount[52] || 0} | 1.Lig: ${leagueCount[98] || 0} | 2.Lig: ${leagueCount[97] || 0} | 3.Ligler/Kupa: ${(leagueCount[11417] || 0) + (leagueCount[11416] || 0) + (leagueCount[11415] || 0) + (leagueCount[15938] || 0) + (leagueCount[96] || 0)}`);
    console.log(`   ✅ Toplam ${matches.length} maç Firebase'e gönderildi.`);

    return { 
        hasLiveMatch: matches.some(m => m.status === 'inprogress'), 
        nextMatchTimestamp: matches.filter(m => m.status === 'notstarted')[0]?.timestamp 
    };
}

// 🏀 BASKETBOL, 🎾 TENİS, 🏎️ F1 STUBS (Kendi orijinal kodundaki tam hallerini buraya ekleyebilirsin)
async function updateBasketball() { console.log("🏀 Basketbol güncelleniyor..."); }
async function updateTennis() { console.log("🎾 Tenis güncelleniyor..."); }
async function updateF1() { console.log("🏎️ Formula 1 güncelleniyor..."); }

// =========================================================================
// 🔄 ANA DÖNGÜ (ZEKİ MOD GERİ GELDİ)
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (DETAYLI LOG & AKILLI ZAMANLAYICI)");
    console.log("============================================================");
    
    let iteration = 1;
    let footballStatus = { hasLiveMatch: false, nextMatchTimestamp: null };
    let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 

    while (true) {
        try {
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            await loadExternalBroadcasters();

            const now = Date.now();
            const isMatchStartingSoon = footballStatus.nextMatchTimestamp && (now >= (footballStatus.nextMatchTimestamp - 60000));
            
            // 🚀 ASIL MANTIK BURASI:
            if (timeSinceLastFullUpdate >= FULL_UPDATE_INTERVAL_MS) {
                // 20 dakikada bir her şeyi güncelle (Full Update)
                console.log("🔄 20 Dakikalık Tam Güncelleme Döngüsü Çalışıyor...");
                footballStatus = await updateFootball();
                await updateBasketball(); await updateTennis(); await updateF1();
                timeSinceLastFullUpdate = 0; 
            } else if (footballStatus.hasLiveMatch || isMatchStartingSoon) {
                // Canlı maç varsa veya maç başlamak üzereyse HER DAKİKA sadece futbolu güncelle
                console.log(isMatchStartingSoon ? "⏰ Maç başlamak üzere! Futbol güncelleniyor..." : "⚽ Canlı maç var! Futbol güncelleniyor...");
                footballStatus = await updateFootball();
            } else {
                // Canlı maç yok, tam güncelleme vaktine daha var...
                const nextUpdateIn = Math.round((FULL_UPDATE_INTERVAL_MS - timeSinceLastFullUpdate) / 60000);
                console.log(`💤 Canlı maç yok. Tam güncellemeye ${nextUpdateIn} dk kaldı. J7 dinleniyor...`);
            }

        } catch (e) { console.error("🚨 Hata:", e.message); }
        
        await new Promise(r => setTimeout(r, MINUTE_MS));
        timeSinceLastFullUpdate += MINUTE_MS;
        iteration++;
    }
}
main();
