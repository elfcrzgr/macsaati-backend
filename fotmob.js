async function fetchFotMobData(dateStr) { 
    // dateStr formatı: YYYYMMDD olmalı (örn: "20261004")
    try {
        const delay = Math.floor(Math.random() * 1000) + 300;
        await new Promise(r => setTimeout(r, delay));

        // Proxyman'de yakaladığımız birebir aynı adres
        const url = `https://api3.fotmob.com/matches?date=${dateStr}&tz=10800000&tzone=Europe%2FIstanbul`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                // Ekrandan kopyaladığımız saf mobil kimlikler
                "Host": "api3.fotmob.com",
                "fotmob-version": "1243.0",
                "Accept": "*/*",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FotMob",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Connection": "keep-alive"
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log(`⚠️️ FotMob API Reddi (HTTP ${response.status}) -> URL: ${url}`);
            return null;
        }

        const data = await response.json();
        console.log("✅ FOTMOB VERİSİ BAŞARIYLA ÇEKİLDİ!");
        // Gelen verinin yapısını görmek için sadece maç listesini yazdıralım
        if(data && data.leagues) {
             console.log(`Toplam ${data.leagues.length} lig verisi geldi.`);
        }
        return data;
    } catch (e) {
        console.error("FotMob Fetch Hatası:", e.message);
        return null;
    }
}

// Test etmek için doğrudan çağır:
fetchFotMobData("20261004");
