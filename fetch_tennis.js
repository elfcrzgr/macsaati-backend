const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// =========================================================================
// 🗑️ ÇÖP FİLTRESİ (Korundu)
// =========================================================================
const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

// =========================================================================
// 🌟 DEV TURNUVALAR LİSTESİ (Korundu)
// =========================================================================
const ELITE_KEYWORDS = [
    "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC",
    "ATP FINALS", "WTA FINALS",
    "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "CINCINNATI", 
    "MONTREAL", "TORONTO", "CANADIAN OPEN", "SHANGHAI", "PARIS", "MASTERS",
    "ROTTERDAM", "RIO DE JANEIRO", "ACAPULCO", "BARCELONA", "HALLE", "LONDON", "QUEEN'S", 
    "HAMBURG", "WASHINGTON", "TOKYO", "BASEL", "VIENNA", "MUNICH", "DALLAS", "BRISBANE", 
    "ABU DHABI", "SAN DIEGO", "CHARLESTON", "STUTTGART", "BERLIN", "EASTBOURNE", 
    "MONTERREY", "SEOUL", "STRASBOURG", "ZHENGZHOU", "BAD HOMBURG",
    "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"
];

const isMajorTournament = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return isMajorTournament(tournamentName);
};

async function start() {
    console.log("🚀 Tenis Motoru Başlatıldı (Cloudflare Bypass & Ranking Aktif)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let rawEvents = [];
    const stubbornTournamentIds = new Set([2391]); // Örn: Monte Carlo

    // 🛡️ ADIM 0: GÜVENLİK DUVARI AŞIMI
    console.log("🛡️ Tenis için güvenlik duvarı aşılıyor...");
    try {
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000)); 
    } catch (e) { console.log("⚠️ Ana sayfa yavaş yüklendi, devam ediliyor..."); }

    // 1. ADIM: PROGRAM TARA (Internal Fetch ile)
    for (const date of targetDates) {
        try {
            console.log(`📡 ${date} tenis programı taranıyor...`);
            const data = await page.evaluate(async (d) => {
                try {
                    const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
                    return await res.json();
                } catch(e) { return null; }
            }, date);
            
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tourName = e.tournament?.name;
                    const catName = e.tournament?.category?.name;
                    if (isGarbage(tourName, catName)) return false;
                    if (isMajorTournament(tourName) && e.tournament?.uniqueTournament?.id) {
                        stubbornTournamentIds.add(e.tournament.uniqueTournament.id);
                    }
                    return true;
                });
                rawEvents.push(...filtered);
            }
        } catch (e) { console.error(`${date} taranırken hata oluştu.`); }
    }

    // 2. ADIM: DERİN TARAMA (Stubborn Tournaments)
    for (const tid of stubbornTournamentIds) {
        try {
            const sData = await page.evaluate(async (id) => {
                try {
                    const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${id}/seasons`);
                    return await res.json();
                } catch(e) { return null; }
            }, tid);

            if (sData?.seasons?.[0]?.id) {
                const sid = sData.seasons[0].id;
                for (const path of ['last/0', 'next/0', 'next/1']) {
                    const eData = await page.evaluate(async (t_id, s_id, p) => {
                        try {
                            const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${t_id}/season/${s_id}/events/${p}`);
                            return await res.json();
                        } catch(e) { return null; }
                    }, tid, sid, path);
                    if (eData?.events) rawEvents.push(...eData.events);
                }
            }
        } catch (e) {}
    }

    // 3. ADIM: SIRALAMA VE BAYRAK İŞLEME (Unique ID ile mapleyerek kopyaları önleyelim)
    const finalMatchesMap = new Map();

    for (const e of rawEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(fixedDate)) continue;

        const tourName = e.tournament?.name || "";
        const catName = e.tournament?.category?.name || "";
        if (isGarbage(tourName, catName)) continue;

        let homeLogos = [];
        let awayLogos = [];
        let homeRank = null;
        let awayRank = null;

        try {
            // 🚀 BÜYÜK DEĞİŞİKLİK: Event detaylarını Cloudflare'e yakalanmadan içeriden çekiyoruz
            const detail = await page.evaluate(async (id) => {
                try {
                    const r = await fetch(`https://www.sofascore.com/api/v1/event/${id}`);
                    const ev = await r.json();
                    const eventData = ev.event;

                    const getCodes = (team) => {
                        if (team.subTeams && team.subTeams.length > 0) {
                            return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                        }
                        return [team.country?.alpha2?.toLowerCase() || "mc"];
                    };

                    const hR = eventData.homeTeam.ranking ? String(eventData.homeTeam.ranking) : null;
                    const aR = eventData.awayTeam.ranking ? String(eventData.awayTeam.ranking) : null;

                    return { 
                        hCodes: getCodes(eventData.homeTeam), 
                        aCodes: getCodes(eventData.awayTeam),
                        hRank: hR,
                        aRank: aR
                    };
                } catch(err) { return null; }
            }, e.id);

            if (detail) {
                homeLogos = detail.hCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                awayLogos = detail.aCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                homeRank = detail.hRank;
                awayRank = detail.aRank;
            }
        } catch (err) {}

        if (homeLogos.length === 0) homeLogos = [TENNIS_LOGO_BASE + "mc.png"];
        if (awayLogos.length === 0) awayLogos = [TENNIS_LOGO_BASE + "mc.png"];

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        // Skor Görünürlüğü (Canlı ve MS için)
        const hasScore = statusType === 'inprogress' || statusType === 'finished';
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        let setScoresStr = "";
        if (e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hSet = e.homeScore[`period${i}`];
                let aSet = e.awayScore[`period${i}`];
                if (hSet !== undefined && aSet !== undefined) sets.push(`${hSet}-${aSet}`);
            }
            setScoresStr = sets.join(", "); 
        }

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsEliteMatch(tourName),
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / beIN Sports",
            homeTeam: { name: e.homeTeam.name || "Belli Değil", logos: homeLogos },
            awayTeam: { name: e.awayTeam.name || "Belli Değil", logos: awayLogos },
            homeRank: homeRank,
            awayRank: awayRank,
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
            setScores: setScoresStr,
            tournament: tourName
        });
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    await browser.close();
    console.log(`✅ İşlem Bitti. Tenis: ${finalMatches.length} maç kaydedildi!`);
}

start();