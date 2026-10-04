async function fetchFotMobData(dateStr) { 
    try {
        const delay = Math.floor(Math.random() * 1000) + 300;
        await new Promise(r => setTimeout(r, delay));

        const url = `https://api3.fotmob.com/matches?date=${dateStr}&tz=10800000&tzone=Europe%2FIstanbul`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "Host": "api3.fotmob.com",
                "fotmob-version": "1243.0",
                "Accept": "application/json, */*", // JSON istediğimizi özellikle belirtiyoruz
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FotMob",
                "Accept-Language": "tr-TR,tr;q=0.9",
                "Connection": "keep-alive"
            }
        });

        clearTimeout(timeoutId);

        // JSON yerine önce ham metni alıyoruz ki ne döndüğünü görelim
        const textData = await response.text();

        if (!response.ok) {
            console.log(`⚠ FotMob API Reddi (HTTP ${response.status}) -> URL: ${url}`);
            console.log("Gelen Hata Metni (İlk 500 Karakter):\n", textData.substring(0, 500));
            return null;
        }

        try {
            // Ham metni JSON'a dönüştürmeyi deniyoruz
            const data = JSON.parse(textData);
            console.log("✅ FOTMOB VERİSİ BAŞARIYLA ÇEKİLDİ!");
            if(data && data.leagues) {
                 console.log(`Toplam ${data.leagues.length} lig verisi geldi.`);
            }
            return data;
        } catch (parseError) {
            console.log("❌ JSON Çevirme Hatası! Gelen Yanıt (İlk 500 Karakter):\n", textData.substring(0, 500));
            return null;
        }

    } catch (e) {
        console.error("FotMob Fetch Hatası:", e.message);
        return null;
    }
}

fetchFotMobData("20261004");
