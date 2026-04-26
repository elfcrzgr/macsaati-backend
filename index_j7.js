const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// =========================================================================
// ⚙️ AYARLAR VE DOSYA İSİMLERİ
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const INTERVAL = 60000; // Her 1 dakikada bir çalışır

const FILES = {
    football: "matches_football_j7.json",
    basketball: "matches_basketball_j7.json",
    tennis: "matches_tennis_j7.json",
    f1: "matches_f1_j7.json"
};

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Samsung J7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
                "Accept": "application/json",
                "Cache-Control": "no-cache"
            }
        });
        return response.ok ? await response.json() : null;
    } catch (e) { return null; }
}

function pushToGithub() {
    return new Promise((resolve) => {
        const simdi = new Date().toLocaleTimeString('tr-TR');
        const filesToPush = Object.values(FILES).join(" ");
        exec(`git add ${filesToPush} && git commit -m "J7 Tüm Sporlar Güncellemesi: ${simdi}" && git push`, (error) => {
            if (error) console.error(`❌ GitHub Hatası: ${error.message}`);
            else console.log(`[${simdi}] ✅ J7 -> GitHub BAŞARILI!`);
            resolve();
        });
    });
}

// =========================================================================
// ⚽ FUTBOL YAPILANDIRMASI
// =========================================================================
const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor...`);
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const matches = allEvents.map(e => {
        const status = e.status.type;
        const isLive = status === 'inprogress';
        let liveMinute = isLive ? (e.status.description?.toLowerCase().includes("half") ? "İY" : (e.status.description || "").replace(/[^0-9+]/g, '')) : "";

        return {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(e.tournament?.uniqueTournament?.id),
            status: status,
            liveMinute: liveMinute,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: e.tournament.name
        };
    });

    fs.writeFileSync(FILES.football, JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🏀 BASKETBOL YAPILANDIRMASI
// =========================================================================
const ELITE_BASK_IDS = [3547, 138, 142, 137, 132, 167, 168];
const targetBaskIds = [3547, 138, 142, 137, 132, 167, 168, 9357, 139, 11511, 21511, 251, 215, 304, 227, 164, 235, 405];

async function updateBasketball() {
    console.log(`🏀 Basketbol güncelleniyor...`);
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const matches = allEvents.map(e => {
        const isNBA = (e.tournament?.uniqueTournament?.id === 3547 || e.tournament?.name === "NBA");
        const status = e.status.type;
        const isLive = status === 'inprogress';
        
        return {
            id: e.id,
            isElite: ELITE_BASK_IDS.includes(e.tournament?.uniqueTournament?.id),
            status: status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) + (isLive ? "\nCANLI" : ""),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : e.tournament.name
        };
    });

    fs.writeFileSync(FILES.basketball, JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🎾 TENİS YAPILANDIRMASI (IP Ban Korumalı Hafif Sürüm)
// =========================================================================
const ELITE_TENNIS_KEYWORDS = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "ATP FINALS", "WTA FINALS", "MASTERS", "ATP 1000", "WTA 1000", "ATP 500", "WTA 500", "MUNICH", "MIAMI", "INDIAN WELLS", "ROME", "MADRID"];

async function updateTennis() {
    console.log(`🎾 Tenis güncelleniyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const tour = (e.tournament?.name || "").toUpperCase();
                const cat = (e.tournament?.category?.name || "").toUpperCase();
                // Çöpleri filtrele
                if (tour.includes("ITF") || tour.includes("CHALLENGER") || tour.includes("UTR") || cat.includes("ITF")) return false;
                return true;
            }));
        }
    }

    const matches = allEvents.map(e => {
        const tourName = e.tournament?.name || "";
        const isElite = ELITE_TENNIS_KEYWORDS.some(kw => tourName.toUpperCase().includes(kw)) && !tourName.toUpperCase().includes("QUALIFYING");
        const status = e.status.type;
        const isLive = status === 'inprogress';

        let setScoresStr = "";
        if (e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                if (e.homeScore[`period${i}`] !== undefined && e.awayScore[`period${i}`] !== undefined) {
                    sets.push(`${e.homeScore[`period${i}`]}-${e.awayScore[`period${i}`]}`);
                }
            }
            setScoresStr = sets.join(", ");
        }

        return {
            id: e.id,
            isElite: isElite,
            status: status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) + (isLive ? "\nCANLI" : ""),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: e.homeTeam.name || "Belli Değil" },
            awayTeam: { name: e.awayTeam.name || "Belli Değil" },
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            setScores: setScoresStr,
            tournament: tourName
        };
    });

    fs.writeFileSync(FILES.tennis, JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🏎️ F1 YAPILANDIRMASI (Sadece Aktif Yarış Odaklı)
// =========================================================================
async function updateF1() {
    console.log(`🏎️ F1 güncelleniyor...`);
    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response.ok) return;
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;
        
        // Yarış mantığı: Geçmişte kalmış yarışları atlayıp, sadece içinde bulunduğumuz aktif yarış haftasını bulur
        const now = Date.now();
        let currentRace = races.find(r => new Date(`${r.date}T${r.time}`).getTime() > now - (48 * 60 * 60 * 1000));
        if (!currentRace) currentRace = races[races.length - 1]; // Sezon bittiyse son yarışı göster

        const finalEvents = [];
        const addSession = (sessionName, dateStr, timeStr) => {
            if (!dateStr || !timeStr) return;
            const dateObj = new Date(`${dateStr}T${timeStr}`);
            const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
            const dayAndMonth = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

            finalEvents.push({
                id: `${currentRace.round}_${sessionName.replace(/\s/g, '')}`,
                fixedDate: `${dayAndMonth} ${dayName}`,
                fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                timestamp: dateObj.getTime(),
                broadcaster: "beIN Sports / F1 TV",
                grandPrix: currentRace.raceName,
                sessionName: sessionName,
                trackName: currentRace.Circuit.circuitName
            });
        };

        if (currentRace.FirstPractice) addSession("1. Antrenman", currentRace.FirstPractice.date, currentRace.FirstPractice.time);
        if (currentRace.SecondPractice) addSession("2. Antrenman", currentRace.SecondPractice.date, currentRace.SecondPractice.time);
        if (currentRace.ThirdPractice) addSession("3. Antrenman", currentRace.ThirdPractice.date, currentRace.ThirdPractice.time);
        if (currentRace.Qualifying) addSession("Sıralama", currentRace.Qualifying.date, currentRace.Qualifying.time);
        if (currentRace.Sprint) addSession("Sprint", currentRace.Sprint.date, currentRace.Sprint.time);
        addSession("Yarış", currentRace.date, currentRace.time);

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        fs.writeFileSync(FILES.f1, JSON.stringify({ success: true, events: finalEvents }, null, 2));

    } catch (e) { console.error("❌ F1 Hata:", e.message); }
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function loop() {
    console.log("🟢 J7 TÜM SPORLAR SUNUCUSU BAŞLADI");
    while (true) {
        try {
            await updateFootball();
            await updateBasketball();
            await updateTennis();
            await updateF1();
            await pushToGithub();
        } catch (e) { console.error("🚨 Kritik Döngü Hatası:", e.message); }
        
        console.log(`⏳ ${INTERVAL/1000} saniye bekleniyor...`);
        await new Promise(r => setTimeout(r, INTERVAL));
    }
}

loop();            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: e.tournament.name
        };
    });

    // Yazma işlemi yeni dosya ismine göre yapılıyor
    fs.writeFileSync(TARGET_FILE, JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function loop() {
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI");
    while (true) {
        try {
            await updateFootball();
            await pushToGithub();
        } catch (e) { console.error("🚨 Hata:", e.message); }
        
        console.log(`⏳ ${INTERVAL/1000} saniye bekleniyor...`);
        await new Promise(r => setTimeout(r, INTERVAL));
    }
}

loop();
