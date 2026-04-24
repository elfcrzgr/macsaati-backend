const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR (Bugün & Yarın Fix)
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";

// Türkiye saatiyle YYYY-MM-DD formatı
const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

const trToday = getTRDate(0);    // 24 Nisan
const trTomorrow = getTRDate(1); // 25 Nisan
const validDates = [trToday, trTomorrow]; // Sadece bu iki günü JSON'a alacağız

const globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    const name = leagueName || "Bilinmeyen";
    globalSummary[sport][name] = (globalSummary[sport][name] || 0) + 1;
}

function printSportSummary(sport) {
    console.log(`\n📊 ${sport.toUpperCase()} ÖZET RAPORU (Sadece Bugün & Yarın)`);
    console.log("-----------------------------------------");
    let total = 0;
    const sorted = Object.entries(globalSummary[sport] || {}).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([l, c]) => { console.log(`📍 ${l}: ${c} maç`); total += c; });
    console.log(`✅ Toplam ${total} eşsiz maç kaydedildi.`);
    console.log("-----------------------------------------\n");
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const FOOT_TEAM_LOGO = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOT_TOUR_LOGO = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

const ELITE_FOOT = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_IDS = [...ELITE_FOOT, ...REGULAR_FOOT];

const footTranslations = { "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "italy": "İtalya" };
const translateFoot = (n) => {
    if (!n) return n;
    let tn = n; const cs = n.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [e, t] of Object.entries(footTranslations)) {
        if (cs.includes(e)) { tn = n.replace(new RegExp(e, 'i'), t); return cs === e ? t : tn; }
    }
    return n;
};

// =========================================================================
// 🏀 BASKETBOL AYARLARI (BSL 519 & Türkçe İsimler)
// =========================================================================
const BASK_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const ELITE_BASK_IDS = [3547, 138, 142, 519, 132, 167, 168]; 
const baskConfigs = {
    519: "TRT Spor / Tabii", 3547: "beIN Sports 5", 138: "S Sport Plus", 142: "S Sport Plus",
    137: "TRT Spor / Tabii", 132: "beIN Sports 5", 167: "S Sport Plus", 168: "TRT Spor Yıldız",
    235: "S Sport Plus", 304: "beIN Sports", 227: "beIN Sports", 164: "beIN Sports"
};
const targetBaskIds = Object.keys(baskConfigs).map(Number);
const baskNameTR = { "Turkish Basketball Super League": "Basketbol Süper Ligi", "NBA": "NBA", "Euroleague": "Euroleague" };

// =========================================================================
// 🎾 TENİS AYARLARI (Elite & Çiftler Bayrak)
// =========================================================================
const TENNIS_LOGO = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOUR = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;
const ELITE_TENNIS_KEYWORDS = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "MADRID", "ROME", "ATP 1000", "WTA 1000", "ATP 500"];

// =========================================================================
// 🚀 ANA MOTOR
// =========================================================================
async function start() {
    console.log(`🚀 MAÇ SAATİ (${trToday} - ${trTomorrow}) MOTORU ÇALIŞIYOR...`);
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    try {
        console.log("🛡️ Güvenlik duvarı aşılıyor...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000));

        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
        await runF1();

    } catch (e) { console.error("Hata:", e.message); }
    finally { await browser.close(); console.log("✅ İşlem başarıyla tamamlandı."); }
}

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    const duplicateTracker = new Set();
    let allRaw = [];
    // Gece maçları için Dün, Bugün ve Yarın'ı API'den çek
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) allRaw.push(...data.events);
    }

    const matches = allRaw.map(e => {
        if (duplicateTracker.has(e.id)) return null;
        const ut = e.tournament?.uniqueTournament;
        if (!ut) return null;

        const dt = new Date(e.startTimestamp * 1000);
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // 🚀 KRİTİK FİLTRE: Sadece bugün ve yarın
        if (!validDates.includes(dayTR)) return null;
        if (ut.name.toLowerCase().match(/u19|u21|women/)) return null;
        if (!ALL_FOOT_IDS.includes(ut.id) && !(ut.hasEventPlayerStatistics && ut.priority < 100)) return null;

        duplicateTracker.add(e.id);
        addToSummary("football", ut.name);
        return {
            id: e.id, isElite: ELITE_FOOT.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: dayTR,
            fixedTime: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: translateFoot(e.homeTeam.name), logo: FOOT_TEAM_LOGO + e.homeTeam.id + ".png" },
            awayTeam: { name: translateFoot(e.awayTeam.name), logo: FOOT_TEAM_LOGO + e.awayTeam.id + ".png" },
            tournamentLogo: FOOT_TOUR_LOGO + ut.id + ".png",
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: ut.name
        };
    }).filter(Boolean);
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("football");
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    const duplicateTracker = new Set();
    let allRaw = [];
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) allRaw.push(...data.events);
    }

    const matches = allRaw.map(e => {
        if (duplicateTracker.has(e.id)) return null;
        const ut = e.tournament?.uniqueTournament;
        if (!ut || !targetBaskIds.includes(ut.id)) return null;

        const dt = new Date(e.startTimestamp * 1000);
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // 🚀 KRİTİK FİLTRE: Sadece bugün ve yarın
        if (!validDates.includes(dayTR)) return null;

        duplicateTracker.add(e.id);
        const isNBA = (ut.id === 3547 || ut.name.toUpperCase().includes("NBA"));
        const name = isNBA ? "NBA" : (baskNameTR[ut.name] || ut.name);
        addToSummary("basketball", name);

        return {
            id: e.id, isElite: ELITE_BASK_IDS.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: dayTR,
            fixedTime: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
            timestamp: dt.getTime(), broadcaster: baskConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE + "logos/" + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE + "logos/" + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE + "tournament_logos/" + (isNBA ? "NBA/3547" : ut.id) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: name
        };
    }).filter(Boolean);
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("basketball");
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    const duplicateTracker = new Set();
    let allRaw = [];
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) allRaw.push(...data.events);
    }

    const matches = [];
    for (const e of allRaw) {
        if (duplicateTracker.has(e.id)) continue;
        const tourName = e.tournament?.name || "";
        const catName = e.tournament?.category?.name || "";
        const dt = new Date(e.startTimestamp * 1000);
        const dayTR = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        if (!validDates.includes(dayTR) || tourName.toUpperCase().match(/ITF|CHALLENGER|UTR/)) continue;

        duplicateTracker.add(e.id);
        const detail = await page.evaluate(async (id) => {
            try {
                const r = await fetch(`https://www.sofascore.com/api/v1/event/${id}`);
                const ev = await r.json();
                const getFlags = (team) => {
                    if (team.subTeams && team.subTeams.length > 0) return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                    return [team.country?.alpha2?.toLowerCase() || "mc"];
                };
                return { hFlags: getFlags(ev.event.homeTeam), aFlags: getFlags(ev.event.awayTeam), hRank: ev.event.homeTeam.ranking, aRank: ev.event.awayTeam.ranking };
            } catch { return null; }
        }, e.id);

        addToSummary("tennis", tourName);
        matches.push({
            id: e.id, isElite: ELITE_TENNIS_KEYWORDS.some(k => tourName.toUpperCase().includes(k)),
            status: e.status?.type, matchStatus: { type: e.status?.type }, fixedDate: dayTR,
            fixedTime: dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
            timestamp: dt.getTime(),
            homeTeam: { name: e.homeTeam.name, logos: detail?.hFlags.map(f => `${TENNIS_LOGO}${f}.png`) || [TENNIS_LOGO + "mc.png"] },
            awayTeam: { name: e.awayTeam.name, logos: detail?.aFlags.map(f => `${TENNIS_LOGO}${f}.png`) || [TENNIS_LOGO + "mc.png"] },
            homeRank: detail?.hRank ? String(detail.hRank) : null, awayRank: detail?.aRank ? String(detail.aRank) : null,
            tournamentLogo: TENNIS_TOUR + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: tourName
        });
    }
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("tennis");
}

async function runF1() {
    console.log("🏎️ F1 taranıyor...");
    try {
        const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await res.json();
        const races = data.MRData.RaceTable.Races.map(r => {
            const dObj = new Date(`${r.date}T${r.time}`);
            const dayTR = dObj.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            if (!validDates.includes(dayTR)) return null;
            return {
                id: r.round, grandPrix: r.raceName, timestamp: dObj.getTime(),
                fixedDate: dayTR, fixedTime: dObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
            };
        }).filter(Boolean);
        fs.writeFileSync("matches_f1.json", JSON.stringify({ success: true, events: races }, null, 2));
        console.log("✅ F1 Tamam.");
    } catch (e) { console.log("F1 Hata"); }
}

start();