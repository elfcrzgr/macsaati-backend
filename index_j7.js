const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// =========================================================================
// ⚙️ AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const INTERVAL = 60000;

// TARGET_FILE'ları TÜM SPOR DALLARI İÇİN
const TARGET_FILES = {
    football: "matches_football.json",
    basketball: "matches_basketball.json",
    tennis: "matches_tennis.json",
    f1: "matches_f1.json"
};

// Git Yapılandırması
const GIT_USER_NAME = process.env.GIT_USER_NAME || "J7 Live Server";
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || "live@j7server.local";

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================

async function executeCommand(command) {
    try {
        const { stdout, stderr } = await execPromise(command, { 
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000
        });
        return stdout;
    } catch (error) {
        throw new Error(`${error.message}\n${error.stderr || ''}`);
    }
}

async function initGitConfig() {
    try {
        console.log("📋 Git yapılandırması kontrol ediliyor...");
        await executeCommand(`git config user.name "${GIT_USER_NAME}"`);
        await executeCommand(`git config user.email "${GIT_USER_EMAIL}"`);
        console.log(`✅ Git User: ${GIT_USER_NAME}`);
    } catch (error) {
        console.error(`⚠️ Git Config Hatası: ${error.message}`);
    }
}

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

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// =========================================================================
// 📥 PUSH İŞLEMİ (GELIŞTIRILMIŞ - TÜM DOSYALARI PUSH ET)
// =========================================================================
// =========================================================================
// 📥 PUSH İŞLEMİ (KURŞUN GEÇİRMEZ VERSİYON)
// =========================================================================
async function pushToGithub() {
    const simdi = new Date().toLocaleTimeString('tr-TR');
    
    const existingFiles = Object.values(TARGET_FILES).filter(file => fs.existsSync(file));
    
    if (existingFiles.length === 0) {
        console.warn(`⚠️ Hiç dosya bulunamadı!`);
        return;
    }

    try {
        console.log(`📤 GitHub senkronizasyonu başlıyor [${simdi}]...`);
        
        // Önce dosyaları sahneye al
        for (const file of existingFiles) {
            await executeCommand(`git add "${file}"`);
        }
        
        // Değişiklik var mı kontrol et
        const status = await executeCommand('git status --porcelain');
        if (!status.trim()) {
            console.log(`  ℹ️ Yeni değişiklik yok`);
            return;
        }
        
        // Commit işlemini yap
        await executeCommand(`git commit -m "J7 Canlı Güncelleme: ${simdi}"`);
        
        // Çakışma (Conflict) dinlemeden, GitHub'daki yenilikleri al ama yerel dosyaları (ours) KORU
        try {
            await executeCommand('git pull origin main --no-rebase -s recursive -X ours');
        } catch (pullErr) {
            console.log("  ⚠️ Pull uyarı verdi (Çakışma olabilir), push zorlanıyor...");
        }
        
        // Yenilenmiş ve çakışması çözülmüş veriyi gönder
        await executeCommand('git push origin main');
        
        console.log(`✅ [${simdi}] GitHub senkronizasyonu BAŞARILI! (${existingFiles.length} dosya)`);
        
    } catch (error) {
        console.error(`❌ Git İşlem Hatası: ${error.message}`);
        // Eğer askıda kalan bir işlem varsa temizle ki sonraki döngü patlamasın
        try { await executeCommand('git rebase --abort'); } catch(e){}
        try { await executeCommand('git merge --abort'); } catch(e){}
    }
}


// =========================================================================
// ⚽ FUTBOL
// =========================================================================
const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

// Futbol ligleri mapping (ID -> Liga adı)
const footballLeagues = {
    52: "İngiltere Premier League",
    351: "İspanya La Liga",
    98: "Almanya Bundesliga",
    17: "İtalya Serie A",
    8: "Fransa Ligue 1",
    23: "İskoçya Premier League",
    35: "Hollanda Eredivisie",
    11: "Portekiz Primeira Liga",
    34: "Belçika Jupiler Pro League",
    37: "Türkiye Süper Lig",
    13: "Avrupa Champions League",
    238: "Avrupa Europa League",
    242: "Avrupa Conference League",
    938: "Uluslararası Dünya Kupası",
    393: "Uluslararası EURO",
    7: "Uluslararası Hazırlık Maçları",
    750: "Uluslararası Konfedasyon Kupası",
    10248: "Türkiye Bölgesel Liga",
    10783: "Türkiye Cup",
    1: "Uluslararası Friendlies",
    679: "Amerika Copa America",
    17015: "Afrika AFCON"
};

// Futbol yayıncıları mapping (ID -> Yayıncı)
const footballBroadcasters = {
    52: "Sky Sports / S Sport",
    351: "La Liga TV / S Sport",
    98: "Sky Sports / Tivibu Plus",
    17: "Sky Sports / Tivibu Plus",
    8: "Amazon Prime / beIN Sports",
    23: "Sky Sports",
    35: "Ziggo Sport / S Sport Plus",
    11: "Eleven Sports / S Sport Plus",
    34: "Eleven Sports",
    37: "beIN Sports / Sky Sports",
    13: "Champions League / S Sport Plus",
    238: "Europa League / S Sport Plus",
    242: "Conference League / S Sport Plus",
    938: "TRT Spor / beIN Sports",
    393: "TRT Spor / beIN Sports",
    7: "TRT Spor / Resmi Yayıncı",
    750: "Resmi Yayıncı",
    10248: "Yerel Kanal",
    10783: "beIN Sports / S Sport",
    1: "Resmi Yayıncı",
    679: "TRT Spor / beIN Sports",
    17015: "TRT Spor / beIN Sports"
};

async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    // Liglerden kaç maç geldi hesapla
    const leagueCount = {};
    allEvents.forEach(e => {
        const leagueId = e.tournament?.uniqueTournament?.id;
        leagueCount[leagueId] = (leagueCount[leagueId] || 0) + 1;
    });

    const matches = allEvents.map(e => {
        const status = e.status.type;
        const isLive = status === 'inprogress';
        const leagueId = e.tournament?.uniqueTournament?.id;
        
        return {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(leagueId),
            status: status,
            liveMinute: isLive ? (e.status.description || "") : "",
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: footballBroadcasters[leagueId] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: e.tournament.name
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(TARGET_FILES.football, JSON.stringify({ success: true, matches }, null, 2));
    
    // Detaylı log
    console.log(`   ✅ Toplam ${matches.length} futbol maçı`);
    Object.keys(leagueCount).forEach(leagueId => {
        const leagueName = footballLeagues[leagueId] || `Liga ${leagueId}`;
        console.log(`      • ${leagueName}: ${leagueCount[leagueId]} maç`);
    });
}

// =========================================================================
// 🏀 BASKETBOL
// =========================================================================
const ELITE_LEAGUE_IDS = [3547, 138, 142, 137, 132, 167, 168];
const leagueConfigs = { 
    3547: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 142: "S Sport Plus", 
    137: "TRT Spor / Tabii", 132: "beIN Sports 5", 167: "S Sport Plus / FIBA TV", 
    168: "TRT Spor Yıldız", 9357: "S Sport Plus", 139: "beIN Sports / TRT Spor",
    11511: "TRT Spor Yıldız / TBF TV", 21511: "TBF TV (YouTube)", 251: "S Sport Plus", 
    215: "S Sport Plus", 304: "S Sport Plus", 227: "beIN Sports", 164: "beIN Sports",
    235: "S Sport Plus", 405: "beIN Sports"
};
const targetBaskIds = Object.keys(leagueConfigs).map(Number);

async function updateBasketball() {
    console.log(`🏀 Basketbol güncelleniyor...`);
    let allEvents = [];
    
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();
    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);
    
    // Liglerden kaç maç geldi hesapla
    const leagueCount = {};

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

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        if (isInProgress) {
            timeString = `${timeString}\nCANLI`; 
        }

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
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` 
            },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "3547" : utId}.png`,
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : utName
        });
        duplicateTracker.add(matchKey);
        
        // Ligi say
        leagueCount[utId] = (leagueCount[utId] || 0) + 1;
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(TARGET_FILES.basketball, JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    
    // Detaylı log
    console.log(`   ✅ Toplam ${finalMatches.length} basketbol maçı`);
    Object.keys(leagueCount).forEach(leagueId => {
        const leagueName = leagueConfigs[leagueId] || `Liga ${leagueId}`;
        console.log(`      • ${leagueName}: ${leagueCount[leagueId]} maç`);
    });
}

// =========================================================================
// 🎾 TENİS
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

async function updateTennis() {
    console.log(`🎾 Tenis güncelleniyor...`);
    let rawEvents = [];
    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    
    // Turnuvalardan kaç maç geldi hesapla
    const tournamentCount = {};

    for (const date of targetDates) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
        if (data?.events) {
            const filtered = data.events.filter(e => {
                const tourName = e.tournament?.name;
                const catName = e.tournament?.category?.name;
                return !isGarbage(tourName, catName);
            });
            rawEvents.push(...filtered);
        }
    }

    const finalMatches = [];
    const finalMatchesMap = new Map();

    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(fixedDate)) continue;

        const tourName = e.tournament?.name || "";
        if (isGarbage(tourName, e.tournament?.category?.name)) continue;

        let homeLogos = [];
        let awayLogos = [];

        if (e.homeTeam?.country?.alpha2) homeLogos.push(`${TENNIS_LOGO_BASE}${e.homeTeam.country.alpha2.toLowerCase()}.png`);
        else homeLogos.push(`${TENNIS_LOGO_BASE}mc.png`);

        if (e.awayTeam?.country?.alpha2) awayLogos.push(`${TENNIS_LOGO_BASE}${e.awayTeam.country.alpha2.toLowerCase()}.png`);
        else awayLogos.push(`${TENNIS_LOGO_BASE}mc.png`);

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        const hasScore = statusType === 'inprogress' || statusType === 'finished';
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        finalMatches.push({
            id: e.id,
            isElite: checkIsEliteMatch(tourName),
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / beIN Sports",
            homeTeam: { name: e.homeTeam.name || "Belli Değil", logos: homeLogos },
            awayTeam: { name: e.awayTeam.name || "Belli Değil", logos: awayLogos },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
            tournament: tourName
        });
        
        // Turnuvayı say
        tournamentCount[tourName] = (tournamentCount[tourName] || 0) + 1;
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(TARGET_FILES.tennis, JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    
    // Detaylı log
    console.log(`   ✅ Toplam ${finalMatches.length} tenis maçı`);
    Object.keys(tournamentCount).forEach(tourName => {
        console.log(`      • ${tourName}: ${tournamentCount[tourName]} maç`);
    });
}

// =========================================================================
// 🏎️ FORMULA 1
// =========================================================================
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    
    try {
        const response = await fetchData('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) {
            console.log(`   ⚠️ F1 verisi alınamadı`);
            return;
        }

        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];
        
        // Ülke isimlerini 2 haneli dosya adlarına çeviren mapping
        const countryToCode = {
            "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
            "China": "cn", "USA": "us", "United States": "us", "Italy": "it", 
            "Monaco": "mc", "Canada": "ca", "Spain": "es", "Austria": "at", 
            "UK": "gb", "Hungary": "hu", "Belgium": "be", "Netherlands": "nl", 
            "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx", "Brazil": "br", 
            "Qatar": "qa", "UAE": "ae"
        };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
            
            let flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            if (countryName.toLowerCase().includes("usa")) flagCode = "us";

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
                const dayAndMonth = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

                finalEvents.push({
                    id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                    fixedDate: `${dayAndMonth} ${dayName}`,
                    fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    timestamp: dateObj.getTime(),
                    broadcaster: "beIN Sports / F1 TV",
                    grandPrix: race.raceName,
                    sessionName: sessionName,
                    trackName: race.Circuit.circuitName,
                    countryLogo: F1_LOGO_BASE + flagCode + ".png", 
                    tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png"
                });
            };

            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.SecondPractice) addSession("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addSession("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addSession("Sprint", race.Sprint.date, race.Sprint.time);
            addSession("Yarış", race.date, race.time);
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);

        fs.writeFileSync(TARGET_FILES.f1, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents }, null, 2));
        
        // Detaylı log
        const raceCount = new Set(finalEvents.map(e => e.grandPrix)).size;
        console.log(`   ✅ Toplam ${finalEvents.length} F1 seanı (${raceCount} Grand Prix)`);
        
        // Her yarış için kaç seans olduğunu göster
        const sessionsByRace = {};
        finalEvents.forEach(e => {
            if (!sessionsByRace[e.grandPrix]) sessionsByRace[e.grandPrix] = 0;
            sessionsByRace[e.grandPrix]++;
        });
        
        Object.keys(sessionsByRace).slice(0, 3).forEach(race => {
            console.log(`      • ${race}: ${sessionsByRace[race]} seans`);
        });
        
    } catch (error) {
        console.error(`   ⚠️ F1 hatası: ${error.message}`);
    }
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI");
    console.log("============================================================");
    
    await initGitConfig();
    
    let iteration = 1;
    while (true) {
        try {
            console.log(`\n[İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            
            // TÜM SPOR DALLARI (Sırayla)
            await updateFootball();
            await updateBasketball();
            await updateTennis();
            await updateF1();
            
            // BİR KEZ PUSH YAP (TÜM DOSYALAR)
            await pushToGithub();
            
        } catch (e) { 
            console.error("🚨 Hata:", e.message); 
        }
        
        console.log(`⏳ ${INTERVAL/1000} saniye bekleniyor...\n`);
        await new Promise(r => setTimeout(r, INTERVAL));
        iteration++;
    }
}

main(); 
