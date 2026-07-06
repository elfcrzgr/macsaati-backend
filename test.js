async function testSofascore() {
    // Bugünün tarihini alalım (YYYY-MM-DD formatında)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${today}`;
    
    console.log(`📡 İstek atılıyor: ${url}\n`);
    
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": "https://www.sofascore.com/",
                "Origin": "https://www.sofascore.com",
                "Connection": "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-site"
            }
        });

        console.log(`🔄 HTTP Durum Kodu: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            console.log("❌ SORGUDAN RED GELDİ!");
            // Red geldiyse sitenin bize ne döndürdüğüne (örn: Cloudflare bot koruması HTML'i) bakalım
            const errorText = await response.text();
            console.log("📄 Gelen Hata Yanıtı (İlk 300 karakter):\n", errorText.substring(0, 300));
        } else {
            console.log("✅ BAĞLANTI BAŞARILI!");
            const data = await response.json();
            console.log(`📊 Toplam ${data.events ? data.events.length : 0} maç verisi başarıyla çekildi.`);
        }
    } catch (error) {
        console.error("🚨 Sunucuya hiç ulaşılamadı (Ağ/Fetch Hatası):", error.message);
    }
}

testSofascore();
