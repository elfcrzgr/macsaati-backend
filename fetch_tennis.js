const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// 2391: Monte Carlo Masters ID'si
const STUBBORN_TOURNAMENTS = [2391]; 

async function start() {
    console.log("🎾 Monte Carlo Finali İçin İnatçı Motor Başlatıldı...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    console.log("📡 Hedeflenen Tarihler:", targetDates);

    let allMonteCarloEvents = [];

    for (const id of STUBBORN_TOURNAMENTS) {
        try {
            console.log(`📡 Turnuva ID ${id} üzerinden placeholder maçlar aranıyor...`);
            
            // 1. Sezon ID'sini bul
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (seasonsData?.seasons?.length > 0) {
                const sId = seasonsData.seasons[0].id;
                
                // 2. 'next/0' ile rakipleri belli olmayan maçları da içeren listeyi çek
                await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${sId}/events/next/0`, { waitUntil: 'networkidle2' });
                const eventsData = await page.evaluate(() => JSON.parse(document.body.innerText));
                
                if (eventsData?.events) {
                    allMonteCarloEvents = allMonteCarloEvents.concat(eventsData.events);
                }
            }
        } catch (e) { console.error(`Hata: ${id} çekilemedi.`); }
    }

    const finalMatches = [];

    for (const e of allMonteCarloEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // Sadece bugün ve yarını alalım
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        // Rakipler belli değilse 'Winner of...' isimlerini Sofascore'dan geldiği gibi yazar
        const hName = e.homeTeam.name || "Belli Değil";
        const aName = e.awayTeam.name || "Belli Değil";

        finalMatches.push({
            id: e.id,
            isElite: true,
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / S Sport Plus",
            homeTeam: { 
                name: hName, 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            awayTeam: { 
                name: aName, 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || id) + ".png",
            homeScore: statusType === 'notstarted' ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: statusType === 'notstarted' ? "-" : String(e.awayScore?.display ?? "0"),
            tournament: "Monte Carlo, Monaco"
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
    console.log(`✅ İşlem tamam. ${finalMatches.length} maç bulundu. Final maçı placeholder olarak eklenmiş olmalı.`);
}

start();
