async function testAlternativeBasketball() {
    try {
        // Alternatif mobil skor servisinin günlük basketbol maçları uç noktası
        const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const url = `https://api.allorigins.win/raw?url=` + encodeURIComponent(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${todayStr}`);
        
        // Veya doğrudan alternatif bir public skor API'si deneyelim:
        const directUrl = `https://livetv.sx/enx/scoreboard/`; // Örnek alternatif

        console.log("Bağlantı deneniyor...");
        
        // Önce doğrudan public bir alternatif API deneyelim:
        const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", {
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
            }
        });

        if (!response.ok) {
            console.log(`❌ Alternatif API Reddi: HTTP ${response.status}`);
            return;
        }

        const data = await response.json();
        console.log("✅ BASKETBOL VERİSİ BAŞARIYLA ÇEKİLDİ!");
        console.log("Gelen Lig/Etkinlik Sayısı:", data.events ? data.events.length : "Veri alındı");

    } catch (e) {
        console.error("Test Hatası:", e.message);
    }
}

testAlternativeBasketball();
