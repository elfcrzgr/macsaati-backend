async function testMackolikBasket() {
    try {
        // Proxyman'deki 7246 numaralı basketbol isteğinin URL'si
        const url = "https://api.mackolikfeeds.com/basket/api/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=2026-10-05&extended_period=1&language=tr&migration_status=perform&tz=3";

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
                "X-Authorization": "token true",
                // Şimdilik ekrandaki futbol token'ını deniyoruz, çalışmazsa basketbolunkini alacağız
                "X-RequestToken": "exp=1791196812~acl=/api/matches/*~hmac=0AFB9A50F7BFAD8CD889598D8B1315106FFA1E3264423018559955C016FC3287", 
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
        
        // Gelen verinin anahtarlarına bakalım (Maçlar hangi dizide geliyor görelim)
        console.log("Veri yapısı:", Object.keys(data));
        
    } catch (e) {
        console.error("Test Hatası:", e.message);
    }
}

testMackolikBasket();
