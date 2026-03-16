const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

puppeteer.use(StealthPlugin());

const leagueConfigs = {
    52: "beIN Sports", 98: "beIN Sports / TRT Spor", 17: "beIN Sports",
    8: "S Sport", 54: "S Sport Plus", 23: "S Sport / Tivibu Spor",
    35: "beIN Sports / Tivibu Spor", 34: "beIN Sports", 37: "TV8.5 / Exxen",
    238: "D-Smart / Spor Smart", 709: "CBC Sport / Yerel", 13363: "TV8.5 / Exxen",
    19: "Tivibu / TRT Spor / Tabii", 481: "Spor Smart / D-Smart",
    7: "TRT / Tabii", 3: "TRT / Tabii", 848: "TRT / Tabii",
    679: "TRT / Tabii", 17015: "TRT / Tabii",
    325: "S Sport Plus / D-Smart", 155: "S Sport Plus / D-Smart",
    44: "beIN Sports / Tivibu", 955: "S Sport Plus / TV8.5"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

// Logo cache dizini
const logosDir = path.join(__dirname, 'team-logos');
if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
}

// Logo'yu indir ve cache'le
const cacheTeamLogo = (teamId, logoUrl) => {
    return new Promise((resolve) => {
        if (!logoUrl) {
            resolve(null);
            return;
        }

        const logoPath = path.join(logosDir, `${teamId}.png`);
        
        // Zaten cache'de varsa
        if (fs.existsSync(logoPath)) {
            const stats = fs.statSync(logoPath);
            if (stats.size > 100) {
                resolve(`local://${teamId}.png`);
                return;
            }
        }

        // URL'yi düzelt
        if (logoUrl.startsWith('//')) logoUrl = 'https:' + logoUrl;
        if (!logoUrl.startsWith('http')) logoUrl = 'https://www.sofascore.com' + logoUrl;

        const protocol = logoUrl.startsWith('https') ? https : http;
        const file = fs.createWriteStream(logoPath);

        protocol.get(logoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.sofascore.com/'
            }
        }, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                const stats = fs.statSync(logoPath);
                if (stats.size > 100) {
                    resolve(`local://${teamId}.png`);
                } else {
                    fs.unlinkSync(logoPath);
                    resolve(null);
                }
            });
        }).on('error', () => {
            fs.unlink(logoPath, () => {});
            resolve(null);
        });
    });
};

async function start() {
    console.log("🚀 Veri çekme motoru başlatılıyor...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const todayStr = getTRDate(0);
    const tomorrowStr = getTRDate(1);
    let allEvents = [];

    for (const date of [todayStr, tomorrowStr]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                const filtered = data.events.filter(e => {
                    const matchDateTR = new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    return targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) && (matchDateTR === date);
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} listesi alınamadı.`); }
    }

    const finalMatches = [];
    const cachedTeams = {};

    for (const e of allEvents) {
        try {
            const details = await page.evaluate(async (id) => {
                const headers = { "Referer": "https://www.sofascore.com/" };
                const r = await fetch(`https://api.sofascore.com/api/v1/event/${id}`, { headers });
                const info = r.ok ? await r.json() : null;
                const lR = await fetch(`https://api.sofascore.com/api/v1/event/${id}/lineups`, { headers });
                return { 
                    stadium: info?.event?.venue?.name || "Bilinmiyor",
                    referee: info?.event?.referee?.name || "Açıklanmadı",
                    hasLineup: lR.ok 
                };
            }, e.id);

            const dateTR = new Date(e.startTimestamp * 1000);
            
            // Home Team Logo'yu cache'le
            let homeLogoUrl = null;
            if (!cachedTeams[e.homeTeam.id]) {
                console.log(`🖼️  ${e.homeTeam.name} logosu cache'leniyor...`);
                homeLogoUrl = await cacheTeamLogo(e.homeTeam.id, `https://api.sofascore.com/api/v1/team/${e.homeTeam.id}/image`);
                cachedTeams[e.homeTeam.id] = homeLogoUrl;
            } else {
                homeLogoUrl = cachedTeams[e.homeTeam.id];
            }

            // Away Team Logo'yu cache'le
            let awayLogoUrl = null;
            if (!cachedTeams[e.awayTeam.id]) {
                console.log(`🖼️  ${e.awayTeam.name} logosu cache'leniyor...`);
                awayLogoUrl = await cacheTeamLogo(e.awayTeam.id, `https://api.sofascore.com/api/v1/team/${e.awayTeam.id}/image`);
                cachedTeams[e.awayTeam.id] = awayLogoUrl;
            } else {
                awayLogoUrl = cachedTeams[e.awayTeam.id];
            }
            
            finalMatches.push({
                id: e.id,
                fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                timestamp: dateTR.getTime(),
                broadcaster: leagueConfigs[e.tournament.uniqueTournament.id] || "Yerel Yayın",
                homeTeam: { 
                    name: e.homeTeam.name,
                    id: e.homeTeam.id,
                    logo: homeLogoUrl || `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/team-logos/${e.homeTeam.id}.png`
                },
                awayTeam: { 
                    name: e.awayTeam.name,
                    id: e.awayTeam.id,
                    logo: awayLogoUrl || `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/team-logos/${e.awayTeam.id}.png`
                },
                homeScore: e.homeScore?.display ?? "-",
                awayScore: e.awayScore?.display ?? "-",
                tournament: e.tournament.uniqueTournament.name,
                details: details
            });
        } catch (err) {}
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    const jsonOutput = { success: true, version: Date.now(), lastUpdated: new Date().toISOString(), matches: finalMatches };
    fs.writeFileSync("matches.json", JSON.stringify(jsonOutput, null, 2));
    console.log("✅ matches.json oluşturuldu.");
    console.log(`📂 ${Object.keys(cachedTeams).length} takım logosu cache'lendi!`);
    await browser.close();
}
start();
