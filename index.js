const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

let globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    const name = leagueName || "Bilinmeyen";
    globalSummary[sport][name] = (globalSummary[sport][name] || 0) + 1;
}

function printFullSummary() {
    console.log("\n📊 GÜNCEL TARAMA ÖZETİ");
    console.log("-----------------------------------------");
    for (const [sport, leagues] of Object.entries(globalSummary)) {
        console.log(`\n[${sport.toUpperCase()}]`);
        const sorted = Object.entries(leagues).sort((a, b) => b[1] - a[1]);
        sorted.forEach(([name, count]) => console.log(`📍 ${name}: ${count} maç`));
    }
    console.log("-----------------------------------------\n");
    globalSummary = {};
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

// ✅ FA Cup (19), Championship (18) ve Nations League (10783) listede
const ELITE_FOOT_IDS = [10783, 19, 18, 52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const getFootBroadcaster = (utId) => {
    const staticConfigs = { 
        10783: "TRT Spor / S Sport", // Nations League
        19: "Tivibu Spor",           // FA Cup
        18: "Exxen",                 // Championship
        34: "beIN Sports", 52: "beIN Sports", 238: "S Spor", 242: "Apple TV", 
        938: "S Sport", 17: "beIN Sports", 8: "S Sport Plus", 23: "S Sport", 
        7: "TRT", 11: "TRT 1", 351: "TRT Spor", 37: "S Sport Plus", 1: "TRT 1 / Tabii" 
    };
    return staticConfigs[utId] || "beIN Sports";
};

const teamTranslations = { "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "usa": "ABD" };
const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

// =========================================================================
// 🏀 BASKETBOL AYARLARI
// =========================================================================
const BASK_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const ELITE_BASK_IDS = [3547, 138, 142, 137, 132, 167, 168];
const baskLeagueConfigs = { 3547: "S Sport / NBA TV", 138: "S Sport Plus", 142: "S Sport Plus", 137: "TRT Spor", 132: "beIN Sports 5" };
const targetBaskIds = Object.keys(baskLeagueConfigs).map(Number);

// =========================================================================
// 🎾 TENİS AYARLARI
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

const ELITE_KEYWORDS = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC", "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "CINCINNATI", "MONTREAL", "TORONTO", "SHANGHAI", "PARIS", "MASTERS", "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"];

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

// =========================================================================
// 🚀 MOTORLAR
// =========================================================================












async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    let allEvents = [];
    
    // 1. ADIM: Günlük Listeyi Çek
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        try {
            const data = await page.evaluate(async (date) => {
                const res = await fetch(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
                return res.json();
            }, date);
            
            if (data?.events) {
                allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
            }
        } catch (e) {
            console.log(`⚠️ ${date} tarihi çekilemedi`);
        }
    }

    // 2. ADIM: Canlı Maçlar İçin Detaylı Dakika Bilgisi
    const liveMinutesPool = new Map();
    const liveMatches = allEvents.filter(e => e.status.type === 'inprogress');
    
    if (liveMatches.length > 0) {
        console.log(`\n📍 ${liveMatches.length} canlı maç bulundu. Dakika bilgisi alınıyor...\n`);
        
        try {
            const liveData = await page.evaluate(async (matchIds) => {
                const results = {};
                
                // Paralel istekleri 3'er gruplarda yap (daha hızlı)
                for (let i = 0; i < matchIds.length; i += 3) {
                    const chunk = matchIds.slice(i, i + 3);
                    
                    const promises = chunk.map(id => 
                        fetch(`https://api.sofascore.com/api/v1/event/${id}`)
                            .then(res => res.json())
                            .then(data => ({
                                id,
                                event: data.event,
                                error: null
                            }))
                            .catch(err => ({ id, event: null, error: err.message }))
                    );
                    
                    const responses = await Promise.all(promises);
                    responses.forEach(({ id, event }) => {
                        results[id] = event;
                    });
                }
                
                return results;
            }, liveMatches.map(m => m.id));
            
            // Dakika bilgisi çıkart ve log bas
            for (const match of liveMatches) {
                const matchName = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
                const eventDetail = liveData[match.id];
                
                if (!eventDetail) {
                    console.log(`❌ ${matchName}: API verisi yok`);
                    liveMinutesPool.set(match.id, "Canlı");
                    continue;
                }

                const status = eventDetail.status;
                const time = eventDetail.time;
                let minute = "";
                let debugInfo = [];
                
                // STRATEJI 1: Status description'dan dakika çıkart
                if (status?.description) {
                    debugInfo.push(`desc="${status.description}"`);
                    
                    // "78'" veya "90+2'" formatı
                    const minuteMatch = status.description.match(/(\d+(?:\+\d+)?)['\′]/);
                    if (minuteMatch) {
                        minute = minuteMatch[1];
                        debugInfo.push(`✅ RegEx buldu: ${minute}'`);
                    } else if (status.description.toLowerCase().includes("half")) {
                        minute = "DA";
                        debugInfo.push(`✅ Yarı zamanda`);
                    }
                }
                
                // STRATEJI 2: currentPeriodStartTimestamp'tan hesapla
                if (!minute && time?.currentPeriodStartTimestamp) {
                    debugInfo.push(`ts=${time.currentPeriodStartTimestamp}`);
                    
                    const now = Math.floor(Date.now() / 1000);
                    const elapsed = now - time.currentPeriodStartTimestamp;
                    const calcMinute = Math.floor(elapsed / 60);
                    
                    debugInfo.push(`elapsed=${elapsed}s, calc=${calcMinute}min, code=${status?.code}`);
                    
                    if (status?.code === 7) {
                        // 2nd half
                        minute = String(Math.min(45 + calcMinute, 90));
                        debugInfo.push(`✅ 2nd half: ${minute}'`);
                    } else if (status?.code === 6) {
                        // 1st half
                        minute = String(Math.min(calcMinute, 45));
                        debugInfo.push(`✅ 1st half: ${minute}'`);
                    } else if (status?.code === 31) {
                        // Halftime
                        minute = "DA";
                        debugInfo.push(`✅ Halftime detected`);
                    } else {
                        minute = String(calcMinute);
                        debugInfo.push(`⚠️ Unknown code ${status?.code}: ${minute}'`);
                    }
                }
                
                // STRATEJI 3: Hiç bulamadık
                if (!minute) {
                    minute = "Canlı";
                    debugInfo.push(`⚠️ Bulunamadı, fallback: Canlı`);
                }
                
                liveMinutesPool.set(match.id, minute);
                console.log(`✅ ${matchName}`);
                console.log(`   → ${minute}'  [${debugInfo.join(" | ")}]`);
            }
            
            console.log(`\n✅ ${liveMinutesPool.size}/${liveMatches.length} maçın dakikası alındı\n`);
        } catch (e) {
            console.log(`❌ Dakika havuzu hatası: ${e.message}\n`);
        }
    }

    // 3. ADIM: Final Maç Listesini Oluştur
    const finalMatchesMap = new Map();
    allEvents.forEach(e => {
        if (finalMatchesMap.has(e.id)) return;
        
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        const showScore = status === 'inprogress' || status === 'finished';
        
        let liveMinute = "";
        if (status === 'inprogress') {
            liveMinute = liveMinutesPool.get(e.id) || "Canlı";
        }

        addToSummary("football", ut.name);

        finalMatchesMap.set(e.id, {
            id: e.id, 
            isElite: ELITE_FOOT_IDS.includes(ut.id), 
            status: status,
            liveMinute: liveMinute,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: getFootBroadcaster(ut.id),
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + ut.id + ".png",
            homeScore: showScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: showScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
    });

    const matches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
}















async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    allEvents.forEach(e => {
        if (finalMatchesMap.has(e.id)) return; 
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        addToSummary("basketball", ut.name);
        
        finalMatchesMap.set(e.id, {
            id: e.id, isElite: true, status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: baskLeagueConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE_URL + "tournament_logos/" + ut.id + ".png",
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
    });
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches: Array.from(finalMatchesMap.values()) }, null, 2));
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    let rawEvents = [];
    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const date of targetDates) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) rawEvents.push(...data.events.filter(e => !isGarbage(e.tournament?.name, e.tournament?.category?.name)));
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    for (const e of rawEvents) {
        if (finalMatchesMap.has(e.id)) continue;
        const isElite = checkIsEliteMatch(e.tournament.name);
        addToSummary("tennis", e.tournament.name);

        finalMatchesMap.set(e.id, {
            id: e.id, isElite, status: e.status.type,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: getTennisBroadcaster(e.tournament.name, isElite),
            homeTeam: { name: e.homeTeam.name, logo: TENNIS_LOGO_BASE + "mc.png" },
            awayTeam: { name: e.awayTeam.name, logo: TENNIS_LOGO_BASE + "mc.png" },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || 1) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"),
            awayScore: String(e.awayScore?.display ?? "-"),
            tournament: e.tournament.name
        });
    }
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches: Array.from(finalMatchesMap.values()) }, null, 2));
}

async function start(page) {
    try {
        await runFootball(page); await runBasketball(page); await runTennis(page);
        printFullSummary();
    } catch (e) { console.error("Hata:", e); }
}

async function loop() {
    console.log("🟢 iMac CANLI SKOR SUNUCUSU AKTİF");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

    while (true) {
        try {
            await start(page);
            const simdi = new Date().toLocaleTimeString('tr-TR');
            
            const gitCmd = 'git add . && (git commit -m "Canlı Skor Güncellemesi: ' + simdi + '" || echo "Değişiklik yok") && git push origin main --force';
            
            exec(gitCmd, (error) => {
                if (error) console.error(`[${simdi}] ❌ GitHub Hatası: ${error.message}`);
                else console.log(`[${simdi}] ✅ GitHub BAŞARILI!`);
            });
        } catch (e) {}
        await new Promise(r => setTimeout(r, 60000));
    }
}
loop();