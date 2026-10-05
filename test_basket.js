async function fetchFlashscoreBasketball() {
    try {
        // Flashscore'un mobil uygulamalarının arkada kullandığı genel veri akış uç noktası
        const url = `https://local-app.flashscore.global/x/feed/df_bk_1_0`; // 1: Basketbol

        const response = await fetch(url, {
            headers: {
                "User-Agent": "FlashScore/3.14.0 (Android)",
                "X-Client": "Android-App",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9"
            }
        });

        if (!response.ok) {
            console.log(`❌ Flashscore Basketbol API Reddi: HTTP ${response.status}`);
            return;
        }

        const text = await response.text();
        console.log("✅ BASKETBOL VERİSİ BAŞARIYLA ÇEKİLDİ!");
        console.log("Gelen Veri Uzunluğu:", text.length);
        console.log("İlk 300 Karakter:\n", text.substring(0, 300));

    } catch (e) {
        console.error("Basketbol Fetch Hatası:", e.message);
    }
}

fetchFlashscoreBasketball();
