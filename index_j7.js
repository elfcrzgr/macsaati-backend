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

// =========================================================================
// 🌉 YAYINCI DOSYASI (BULUTTAN OKUMA)
// =========================================================================
let externalBroadcasters = {};

async function loadExternalBroadcasters() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/yayinci_bilgisi.json?_=${Date.now()}`;
        const response = await fetch(url);
        if (response.ok) {
            externalBroadcasters = await response.json();
        } else {
            externalBroadcasters = {};
        }
    } catch (e) {
        externalBroadcasters = {};
    }
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
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (response.ok) console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} güncellendi.`);
    } catch (error) {
        console.error(`⚠️ [FIREBASE] Bağlantı Hatası:`, error.message);
    }
}

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"];

async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENTS[0], "Referer": "https://www.sofascore.com/" }
        });
        return response.ok ? await response.json() : null;
    } catch (e) { return null; }
}

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// ⚽ FUTBOL (GÜNCELLENMİŞ TÜRKİYE KATEGORİ FİLTRESİ)
// =========================================================================
const teamTranslations = { "germany": "Almanya", "england": "İngiltere", "france": "Fransa" }; // Liste uzatılabilir

const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

const getFootBroadcaster = (utId, hName, aName, tName, utName) => {
    const staticConfigs = {
        34: "beIN Sports", 52: "beIN Sports", 238: "TRT Spor / Tabii", 98: "beIN Sports / TRT Spor", 97: "TFF YouTube", 11417: "TFF YouTube", 11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube", 10783: "A Spor", 96: "A Spor"
    };
    return staticConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

// 97 (2. Lig) ve 3. Lig grupları burada tanımlı
const ELITE_FOOT_IDS = [17, 8, 35, 23, 34, 52, 37, 238, 38, 36, 19, 97, 98, 7, 679, 17015, 16, 1, 133, 270, 53, 13363, 10783, 96];
const REGULAR_FOOT_IDS = [299, 6516, 325, 155, 242, 11415, 11416, 11417, 15938];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const footballLeagues = {
    52: "Türkiye Süper Lig", 98: "Trendyol 1. Lig", 97: "TFF 2. Lig", 938: "Türkiye Kupası", 10783: "Türkiye Kupası", 96: "Türkiye Kupası",
    11417: "TFF 3. Lig 1. Grup", 11416: "TFF 3. Lig 2. Grup", 11415: "TFF 3. Lig 3. Grup", 15938: "TFF 3. Lig 4. Grup"
};

function calculateLiveMinute(eventData) {
    if (eventData.time?.currentMinute !== undefined) return String(eventData.time.currentMinute) + "'";
    if (eventData.status?.code === 31) return "İY";
    return "Canlı";
}

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor (Türkiye Kategori Filtresi Aktif)...`);
    let allEvents = [];
    
    // 🚀 DÜZELTME: Sadece Türkiye (ID: 48) kategorisindeki alt ligleri yakalıyoruz.
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}?_=${Date.now()}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const utId = e.tournament?.uniqueTournament?.id;
                const catId = e.tournament?.category?.id;
                const utName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
                const tourName = (e.tournament?.name || "").toLowerCase();

                // 1. Kural: Elit liglerimiz (Süper Lig, Premier Lig vb.)
                const isMainLeague = ALL_FOOT_TARGETS.includes(utId);

                // 2. Kural: Sadece TÜRKİYE (48) kategorisindeyse ve 2.lig/3.lig/playoff/tff geçiyorsa al
                const isTurkishLower = (catId === 48) && (
                    utName.includes("2. lig") || utName.includes("3. lig") || tourName.includes("2. lig") || tourName.includes("3. lig") ||
                    utName.includes("play-off") || utName.includes("playoff") || utName.includes("tff")
                );

                return isMainLeague || isTurkishLower;
            }));
        }
    }

    const duplicateTracker = new Map();
    allEvents.forEach(e => {
        if (duplicateTracker.has(e.id)) return;
        const status = e.status.type;
        const isLive = status === 'inprogress';
        const leagueId = e.tournament?.uniqueTournament?.id;
        const utName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
        
        const hName = e.homeTeam.name || "";
        const aName = e.awayTeam.name || "";
        const cleanTournamentName = footballLeagues[leagueId] || e.tournament?.name || e.tournament?.uniqueTournament?.name;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const fallbackBroadcaster = getFootBroadcaster(leagueId, hName, aName, "", utName);
        const finalBroadcaster = getBroadcasterWithFallback("futbol", dayTR, timeString, hName, aName, fallbackBroadcaster);

        // 🚀 PLAY-OFF ve Alt ligleri 'Elite' yapıyoruz ki uygulamada her zaman görünsünler
        const isEliteMatch = ELITE_FOOT_IDS.includes(leagueId) || utName.includes("3. lig") || utName.includes("2. lig") || utName.includes("play");

        duplicateTracker.set(e.id, {
            id: e.id, isElite: isEliteMatch, status: status,
            liveMinute: isLive ? calculateLiveMinute(e) : "",
            fixedDate: dayTR, fixedTime: timeString, timestamp: e.startTimestamp * 1000,
            broadcaster: finalBroadcaster,
            homeTeam: { name: translateTeam(hName), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: translateTeam(aName), logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${leagueId}.png`,
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: cleanTournamentName
        });
    });

    const matches = Array.from(duplicateTracker.values()).sort((a, b) => a.timestamp - b.timestamp);
    await uploadToFirebase("football", { success: true, lastUpdate: new Date().toLocaleTimeString('tr-TR'), matches });
    return { hasLiveMatch: matches.some(m => m.status === 'inprogress'), nextMatchTimestamp: matches.filter(m => m.status === 'notstarted')[0]?.timestamp };
}

// 🏀 BASKETBOL, 🎾 TENİS, 🏎️ F1 bölümleri senin kodunla aynı kalacak...
// (Sayfa dolmasın diye özet geçiyorum ama senin orijinal kodundaki bu kısımlar korunmalı)

// ... [Basketbol, Tenis ve F1 fonksiyonlarını buraya senin orijinal kodundan olduğu gibi kopyala] ...

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI (SADECE TÜRKİYE ALT LİGLERİ FİLTRESİ)");
    console.log("============================================================");
    let timeSinceLastFullUpdate = FULL_UPDATE_INTERVAL_MS; 
    while (true) {
        try {
            await loadExternalBroadcasters();
            if (timeSinceLastFullUpdate >= FULL_UPDATE_INTERVAL_MS) {
                console.log("🔄 Tam Güncelleme Döngüsü...");
                await updateFootball(); await updateBasketball(); await updateTennis(); await updateF1();
                timeSinceLastFullUpdate = 0; 
            } else {
                await updateFootball(); // Canlı maç takibi için futbolu hep güncelle
            }
        } catch (e) { console.error("🚨 Hata:", e.message); }
        await new Promise(r => setTimeout(r, MINUTE_MS));
        timeSinceLastFullUpdate += MINUTE_MS;
    }
}
main();
