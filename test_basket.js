async function testGlobalBasketball() {
    try {
        // Livescore / Alternatif mobil skor servisinin genel basketbol uç noktası
        const url = `https://prod-public-api.livescore.com/v1/api/app/scoreboard/basketball/0/an?tz=3`;

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://www.livescore.com",
                "Referer": "https://www.livescore.com/"
            }
        });

        if (!response.ok) {
            console.log(`❌ Livescore API Reddi: HTTP ${response.status}`);
            return;
        }

        const data = await response.json();
        console.log("✅ KÜRESEL BASKETBOL VERİSİ BAŞARIYLA ÇEKİLDİ!");
        
        // Gelen aşamaları/ligleri kontrol edelim
        if (data.Stages) {
            console.log("🏆 Toplam Lig/Stage Sayısı:", data.Stages.length);
            // İlk ligin adını yazdıralım
            if (data.Stages.length > 0) {
                console.log("Örnek Lig:", data.Stages[0].SnName);
            }
        } else {
            console.log("Veri yapısı:", Object.keys(data));
        }

    } catch (e) {
        console.error("Test Hatası:", e.message);
    }
}

testGlobalBasketball();
