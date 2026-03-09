const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = 3000;

async function getFullMatchDetails(matchId) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    try {
        // 1. TEMEL BİLGİLER (Stat, Hakem, Şehir)
        await page.goto(`https://api.sofascore.com/api/v1/event/${matchId}`, { waitUntil: 'networkidle2' });
        const eventData = await page.evaluate(() => JSON.parse(document.body.innerText));

        // 2. KADROLAR VE MUHTEMEL 11 (Lineups)
        // Maç başlamadan önce burası 'Muhtemel', başlayınca 'Resmi' döner.
        await page.goto(`https://api.sofascore.com/api/v1/event/${matchId}/lineups`, { waitUntil: 'networkidle2' });
        const lineupData = await page.evaluate(() => JSON.parse(document.body.innerText));

        // 3. SAKAT VE CEZALILAR (Missing Players)
        await page.goto(`https://api.sofascore.com/api/v1/event/${matchId}/missing-players`, { waitUntil: 'networkidle2' });
        const missingData = await page.evaluate(() => JSON.parse(document.body.innerText));

        return {
            success: true,
            venue: {
                name: eventData.event?.venue?.name || "Bilinmiyor",
                city: eventData.event?.venue?.city?.name || "Bilinmiyor",
                capacity: eventData.event?.venue?.capacity || "Bilinmiyor"
            },
            referee: {
                name: eventData.event?.referee?.name || "Henüz atanmadı",
                yellowCards: eventData.event?.referee?.yellowCards || 0
            },
            lineups: {
                isConfirmed: lineupData.confirmed || false, // true ise resmi, false ise muhtemeldir
                home: lineupData.home?.players?.map(p => ({ name: p.player.name, position: p.player.position })) || [],
                away: lineupData.away?.players?.map(p => ({ name: p.player.name, position: p.player.position })) || []
            },
            missingPlayers: {
                home: missingData.home?.map(p => ({ name: p.player.name, reason: p.reason })) || [],
                away: missingData.away?.map(p => ({ name: p.player.name, reason: p.reason })) || []
            }
        };
    } catch (e) {
        return { success: false, error: "Detaylar alınırken hata oluştu" };
    } finally {
        await browser.close();
    }
}

app.get('/detail', async (req, res) => {
    const matchId = req.query.id;
    if (!matchId) return res.status(400).json({ error: "ID gerekli" });
    const result = await getFullMatchDetails(matchId);
    res.json(result);
});

app.listen(PORT, () => console.log(`📡 Detay servisi port ${PORT} üzerinde hazır!`));