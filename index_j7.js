const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// =========================================================================
// ⚙️ GLOBAL AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const INTERVAL = 60000; // Her 1 dakikada bir
const LOG_PREFIX = "[J7 SUNUCUSU]";

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Samsung J7) AppleWebKit/537.36"
            }
        });
        return response.ok ? await response.json() : null;
    } catch (e) { 
        return null; 
    }
}

// ✅ DÜZELTILMIŞ GIT PUSH
function pushToGithub() {
    return new Promise((resolve) => {
        const simdi = new Date().toLocaleTimeString('tr-TR');
        
        console.log(`${LOG_PREFIX} Git işlemi başlıyor...`);

        // Adım 1: Pull
        exec('git pull --rebase origin main 2>&1', (error1, stdout1) => {
            if (error1) {
                console.error(`${LOG_PREFIX} ❌ Pull Hatası:`, error1.message);
                exec('git rebase --abort 2>&1', () => {
                    console.log(`${LOG_PREFIX} Rebase iptal edildi`);
                    resolve();
                });
                return;
            }
            console.log(`${LOG_PREFIX} ✓ Pull başarılı`);

            // Adım 2: Durumu kontrol et
            exec('git status --porcelain 2>&1', (error2, stdout2) => {
                if (!stdout2.trim()) {
                    console.log(`${LOG_PREFIX} ℹ️ Değişiklik yok, push gerek yok`);
                    resolve();
                    return;
                }

                // Adım 3: Add (teker teker)
                const files = [
                    'matches_football.json',
                    'matches_basketball.json',
                    'matches_tennis.json',
                    'matches_f1.json'
                ];

                let addCommand = 'git add';
                for (const file of files) {
                    addCommand += ` "${file}"`;
                }

                exec(addCommand + ' 2>&1', (error3) => {
                    if (error3) {
                        console.error(`${LOG_PREFIX} ❌ Add Hatası:`, error3.message);
                        resolve();
                        return;
                    }
                    console.log(`${LOG_PREFIX} ✓ Dosyalar eklendi`);

                    // Adım 4: Commit
                    exec(`git commit -m "J7 Canlı Skor: ${simdi}" 2>&1`, (error4) => {
                        if (error4 && !error4.message.includes('nothing to commit')) {
                            console.error(`${LOG_PREFIX} ❌ Commit Hatası:`, error4.message);
                            resolve();
                            return;
                        }
                        console.log(`${LOG_PREFIX} ✓ Commit yapıldı`);

                        // Adım 5: Push
                        exec('git push origin main 2>&1', (error5, stdout5) => {
                            if (error5) {
                                console.error(`${LOG_PREFIX} ❌ Push Hatası:`, error5.message);
                            } else {
                                console.log(`${LOG_PREFIX} [${simdi}] ✅ GitHub BAŞARILI!`);
                            }
                            resolve();
                        });
                    });
                });
            });
        });
    });
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const ELITE_FOOT_IDS = [10783, 19, 18, 52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const getFootBroadcaster = (utId) => {
    const configs = { 
        10783: "TRT Spor / S Sport", 19: "Tivibu Spor", 18: "Exxen",
        34: "beIN Sports", 52: "beIN Sports", 238: "S Spor", 242: "Apple TV", 
        938: "S Sport", 17: "beIN Sports", 8: "S Sport Plus", 23: "S Sport", 
        7: "TRT", 11: "TRT 1", 351: "TRT Spor", 37: "S Sport Plus", 1: "TRT 1 / Tabii" 
    };
    return configs[utId] || "beIN Sports";
};

const teamTranslations = { 
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", 
    "england": "İngiltere", "spain": "İspanya", "italy": "İtalya", 
    "portugal": "Portekiz", "usa": "ABD" 
};

const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

// ✅ DAKIKA HESAPLAMA (Sadece Futbol)
function calculateLiveMinute(eventData) {
    if (!eventData || !eventData.time) return "Canlı";
    
    const status = eventData.status;
    const time = eventData.time;
    const now = Math.floor(Date.now() / 1000);
    
    if (!time.currentPeriodStartTimestamp) return "Canlı";
    
    const elapsed = now - time.currentPeriodStartTimestamp;
    const calcMinute = Math.floor(elapsed / 60);
    
    if (status?.code === 31) return "DA"; // Halftime
    if (status?.code === 7) return String(45 + calcMinute); // 2. Yarı
    if (status?.code === 6) return String(calcMinute); // 1. Yarı
    return String(calcMinute);
}

async function runFootball() {
    console.log(`${LOG_PREFIX} ⚽ Futbol taranıyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    // Canlı maçlar için dakika hesaplama (SADECE FUTBOL)
    const liveMinutesPool = new Map();
    const liveMatches = allEvents.filter(e => e.status.type === 'inprogress');
    
    for (const match of liveMatches) {
        const detailData = await fetchData(`https://api.sofascore.com/api/v1/event/${match.id}`);
        if (detailData?.event) {
            const liveMinute = calculateLiveMinute(detailData.event);
            liveMinutesPool.set(match.id, liveMinute);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    const matches = allEvents.map(e => {
        const status = e.status.type;
        const isLive = status === 'inprogress';
        const ut = e.tournament.uniqueTournament;
        
        return {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(ut.id),
            status: status,
            liveMinute: isLive ? (liveMinutesPool.get(e.id) || "Canlı") : "",
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: getFootBroadcaster(ut.id),
            homeTeam: { 
                name: translateTeam(e.homeTeam.name), 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` 
            },
            awayTeam: { 
                name: translateTeam(e.awayTeam.name), 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` 
            },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${ut.id}.png`,
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync("matches_football_j7.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
    console.log(`${LOG_PREFIX} ✅ Futbol: ${matches.length} maç kaydedildi`);
}

// =========================================================================
// 🏀 BASKETBOL AYARLARI
// =========================================================================
const baskLeagueConfigs = { 
    3547: "S Sport / NBA TV", 138: "S Sport Plus", 142: "S Sport Plus", 
    137: "TRT Spor", 132: "beIN Sports 5" 
};
const targetBaskIds = Object.keys(baskLeagueConfigs).map(Number);

async function runBasketball() {
    console.log(`${LOG_PREFIX} 🏀 Basketbol taranıyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        }
        await new Promise(r => setTimeout(r, 300));
    }

    const matches = allEvents.map(e => {
        const status = e.status.type;
        const ut = e.tournament.uniqueTournament;
        
        return {
            id: e.id,
            isElite: true,
            status: status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: baskLeagueConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${e.homeTeam.id}.png` 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${e.awayTeam.id}.png` 
            },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${ut.id}.png`,
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync("matches_basketball_j7.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
    console.log(`${LOG_PREFIX} ✅ Basketbol: ${matches.length} maç kaydedildi`);
}

// =========================================================================
// 🎾 TENİS AYARLARI
// =========================================================================
const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

const ELITE_KEYWORDS = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC", "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "ATP 1000", "WTA 1000"];

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

const getTennisBroadcaster = (tournamentName, isElite) => {
    if (!tournamentName) return "Resmi Yayıncı";
    const t = tournamentName.toUpperCase();
    if (t.includes("WIMBLEDON")) return "TRT Spor / S Sport";
    if (t.includes("ROLAND GARROS") || t.includes("FRENCH OPEN") || t.includes("US OPEN") || t.includes("AUSTRALIAN OPEN")) return "Eurosport";
    if (isElite) return "S Sport / beIN Sports";
    return "Tennis TV / Resmi Yayıncı"; 
};

async function runTennis() {
    console.log(`${LOG_PREFIX} 🎾 Tenis taranıyor...`);
    
    const targetDates = [getTRDate(0), getTRDate(1)];
    let rawEvents = [];
    const stubbornTournamentIds = new Set([2391]);

    for (const date of targetDates) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
        if (data?.events) {
            const filtered = data.events.filter(e => {
                const tourName = e.tournament?.name;
                const catName = e.tournament?.category?.name;
                if (isGarbage(tourName, catName)) return false;
                if (checkIsEliteMatch(tourName) && e.tournament?.uniqueTournament?.id) {
                    stubbornTournamentIds.add(e.tournament.uniqueTournament.id);
                }
                return true;
            });
            rawEvents.push(...filtered);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    const finalMatches = [];
    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const fixedDate = new Date(startTimestamp).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        if (!targetDates.includes(fixedDate)) continue;
        
        const tourName = e.tournament?.name || "";
        const isElite = checkIsEliteMatch(tourName);
        
        let homeLogos = [];
        let awayLogos = [];
        let homeRank = null;
        let awayRank = null;

        try {
            const detail = await fetchData(`https://www.sofascore.com/api/v1/event/${e.id}`);
            if (detail?.event) {
                const eventData = detail.event;
                const getCodes = (team) => {
                    if (team.subTeams && team.subTeams.length > 0) {
                        return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                    }
                    return [team.country?.alpha2?.toLowerCase() || "mc"];
                };
                
                homeLogos = getCodes(eventData.homeTeam).map(c => `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${c}.png`);
                awayLogos = getCodes(eventData.awayTeam).map(c => `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/${c}.png`);
                homeRank = eventData.homeTeam.ranking ? String(eventData.homeTeam.ranking) : null;
                awayRank = eventData.awayTeam.ranking ? String(eventData.awayTeam.ranking) : null;
            }
        } catch (err) {}

        if (homeLogos.length === 0) homeLogos = [`https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/mc.png`];
        if (awayLogos.length === 0) awayLogos = [`https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/mc.png`];

        const statusType = e.status?.type;
        let timeString = new Date(startTimestamp).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        const hasScore = statusType === 'inprogress' || statusType === 'finished';
        if (statusType === 'inprogress') timeString += " CANLI";
        else if (statusType === 'finished') timeString += " MS";

        finalMatches.push({
            id: e.id,
            isElite: isElite,
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: getTennisBroadcaster(tourName, isElite),
            homeTeam: { name: e.homeTeam.name || "Belli Değil", logos: homeLogos },
            awayTeam: { name: e.awayTeam.name || "Belli Değil", logos: awayLogos },
            homeRank: homeRank,
            awayRank: awayRank,
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/${e.tournament?.uniqueTournament?.id || 1}.png`,
            homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
            tournament: tourName
        });
        
        await new Promise(r => setTimeout(r, 500));
    }

    const matches = finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_tennis_j7.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
    console.log(`${LOG_PREFIX} ✅ Tenis: ${matches.length} maç kaydedildi`);
}

// =========================================================================
// 🏎️ F1 AYARLARI
// =========================================================================
async function runF1() {
    console.log(`${LOG_PREFIX} 🏎️ F1 taranıyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/motorsport/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => 
                e.tournament?.category?.name?.toUpperCase().includes("FORMULA 1") ||
                e.tournament?.name?.toUpperCase().includes("F1")
            ));
        }
        await new Promise(r => setTimeout(r, 300));
    }

    const matches = allEvents.map(e => {
        const status = e.status.type;
        const ut = e.tournament.uniqueTournament;
        
        return {
            id: e.id,
            isElite: true,
            status: status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: "S Sport / Sky Sports F1",
            homeTeam: { 
                name: e.homeTeam?.name || e.tournament.name, 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/${e.homeTeam?.id || 1}.png` 
            },
            tournament: e.tournament.name
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync("matches_f1_j7.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
    console.log(`${LOG_PREFIX} ✅ F1: ${matches.length} etkinlik kaydedildi`);
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function loop() {
    console.log(`${LOG_PREFIX} 🟢 TÜM SPORLAR SUNUCUSU BAŞLADI\n`);
    while (true) {
        try {
            const startTime = Date.now();
            await runFootball();
            await runBasketball();
            await runTennis();
            await runF1();
            await pushToGithub();
            
            const elapsed = Date.now() - startTime;
            console.log(`${LOG_PREFIX} ⏱️ İşlem süresi: ${elapsed}ms\n`);
        } catch (e) { 
            console.error(`${LOG_PREFIX} 🚨 Hata: ${e.message}`); 
        }
        
        console.log(`${LOG_PREFIX} ⏳ ${INTERVAL/1000} saniye bekleniyor...\n`);
        await new Promise(r => setTimeout(r, INTERVAL));
    }
}

loop();