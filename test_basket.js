async function testMackolikBasket() {
    try {
        const url = "https://api.mackolikfeeds.com/basket/api/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=2026-10-05&extended_period=1&language=tr&migration_status=perform&tz=3";

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
                "X-Authorization": "token true",
                // İşte basketbol için özel üretilmiş doğru bilet:
                "X-RequestToken": "exp=1791196814~acl=/basket/api/matches/*~hmac=D08290EF6031AAA741AF61DA5B238E8E78DD32A632A6D9A5291BF9A48603C667", 
                "Accept-Language": "tr-TR;q=1, en-GB;q=0.9",
                "Connection": "keep-alive"
            }
        });

        if (!response.ok) {
            console.log(`❌ Hata: HTTP ${response.status}`);
            const text = await response.text();
            console.log("Sunucu yanıtı:", text);
            return;
        }

        const data = await response.json();
        console.log("✅ MAÇKOLİK BASKETBOL VERİSİ GELDİ!");
        
        console.log("Veri yapısı:", Object.keys(data));
        
    } catch (e) {
        console.error("Test Hatası:", e.message);
    }
}

testMackolikBasket();
