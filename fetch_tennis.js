const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;
const OUTPUT_FILE = "matches_tennis.json";

async function start() {
    console.log("🚀 Süzgeçsiz Tenis Motoru Başlatıldı...");
    console.log("🌍 12 Nisan tarihindeki TÜM maçlar çekilecek (ITF/Challenger dahil).");

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Bursa/TR saatiyle yarını (12 Nisan) bulan sağlam fonksiyon
    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    // SADECE YARINI (12 Nisan) DENEMEK İSTEDİĞİN İÇİN:
    const targetDate = getTRDate(1); 
    console.log(`📡 Hedef Tarih: ${targetDate}`);

    let rawEvents = [];
    try {
        await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${targetDate}`, { waitUntil: 'networkidle2' });
        const data = await page.evaluate(() => JSON.parse(document.body.innerText));
        
        if (data?.events) {
            // FİLTRE YOK: Gelen tüm maçları listeye alıyoruz.
            rawEvents = data.events;
            console.log(`🎾 Toplam ${rawEvents.length} maç bulundu. Detaylar işleniyor...`);
        }
    } catch (e) {
        console.error("❌ Veri çekilirken hata oluştu:", e.message);
    }

    const finalMatches = [];
    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });

    for (const e of rawEvents) {
        const isDouble = e.homeTeam.name.includes("/");
        let homeRank = e.homeTeam.ranking;
        let awayRank = e.awayTeam.ranking;
        let homeLogos = [];
        let awayLogos = [];

        // Detayları (bayraklar ve sıralamalar) çekme kısmı
        try {
            const detail = await page.evaluate(async (id) => {
                try {
                    const r = await fetch(`https://api.sofascore.com/api/v1/event/${id}`);
                    const ev = await r.json();
                    const getCodes = (team) => {
                        if (team.subTeams && team.subTeams.length > 0) {
                            return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                        }
                        return [team.country?.alpha2?.toLowerCase() || "default"];
                    };
                    return {
                        hR: ev?.event?.homeTeam?.ranking,
                        aR: ev?.event?.awayTeam?.ranking,
                        hCodes: getCodes(ev.event.homeTeam),
                        aCodes: getCodes(ev.event.awayTeam)
                    };
                } catch(err) { return null; }
            }, e.id);

            if (detail) {
                homeRank = detail.hR || homeRank;
                awayRank = detail.aR || awayRank;
                homeLogos = detail.hCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                awayLogos = detail.aCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
            }
        } catch (err) {}

        const statusType = e.status?.type; 
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const isFinished = statusType === 'finished';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (isFinished) timeString += "\nMS";

        let finalHomeName = e.homeTeam.name;
        let finalAwayName = e.awayTeam.name;
        if (!isDouble) {
            if (homeRank) finalHomeName += ` (${homeRank})`;
            if (awayRank) finalAwayName += ` (${awayRank})`;
        }

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

        finalMatches.push({
            id: e.id,
            status: statusType, 
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "Tüm Maçlar Modu",
            homeTeam: { 
                name: finalHomeName, 
                logos: homeLogos.length > 0 ? homeLogos : [TENNIS_LOGO_BASE + "default.png"] 
            },
            awayTeam: { 
                name: finalAwayName, 
                logos: awayLogos.length > 0 ? awayLogos : [TENNIS_LOGO_BASE + "default.png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: isFinished || statusType === 'inprogress' ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished || statusType === 'inprogress' ? String(e.awayScore?.display ?? "0") : "-",
            setScores: setScoresStr,
            tournament: e.tournament.name || ""
        });
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    await browser.close();
    console.log(`✅ Bitti! 12 Nisan'daki toplam ${finalMatches.length} maç JSON'a kaydedildi.`);
}

start();
