const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

require('events').EventEmitter.defaultMaxListeners = 100;

// =========================================================================
// 🔥 AYARLAR VE ÇALIŞMA ORTAMI
// =========================================================================
const STATE_FILE = 'basketball_states.json'; 
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const MINUTE_MS = 60000;
const TEN_MIN_MS = 10 * 60000;

const emptyLeaguesCache = new Map();

// =========================================================================
// 🔥 FIREBASE BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'basketball_app');
console.log("🔥 [BASKETBOL] Firebase Admin başlatıldı.");

// =========================================================================
// 🧠 GLOBAL HAFIZA (CACHE) VE DURUM YÖNETİMİ
// =========================================================================
const previousMatchStates = new Map();
const globalBasketballCache = new Map();

const sportUpdateStatus = {
    lastFullUpdate: 0, 
    lastQuickUpdate: 0, 
    nextMatchTime: null, 
    hasLiveMatch: false
};

function saveState() {
    const obj = Object.fromEntries(previousMatchStates);
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj));
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            for (const [key, val] of Object.entries(data)) previousMatchStates.set(key, val);
            console.log(`📂 [HAFIZA-BASKETBOL] ${previousMatchStates.size} maç durumu yüklendi.`);
        } catch (e) { console.error("❌ Hafıza dosyası okunamadı, yeni başlatılıyor."); }
    }
}

// ⏱️ Zaman aşımı yardımcıları
function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    if (t.unref) t.unref();
    return c.signal;
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} ${Math.round(ms / 1000)} sn içinde yanıt vermedi`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset); 
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

function getIstanbulNow() {
    const istStr = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' });
    return new Date(istStr);
}

// =========================================================================
// 🛠️ MAÇKOLİK FETCH FONKSİYONU
// =========================================================================
async function fetchMackolikBasketball(dateStr) {
    try {
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(r => setTimeout(r, delay));

        const url = `https://api.mackolikfeeds.com/basket/api/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=${dateStr}&extended_period=1&language=tr&migration_status=perform&tz=3`;

        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            headers: {
                "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
                "X-Authorization": "token true",
                "X-RequestToken": "exp=1791196814~acl=/basket/api/matches/*~hmac=D08290EF6031AAA741AF61DA5B238E8E78DD32A632A6D9A5291BF9A48603C667",
                "Accept-Language": "tr-TR;q=1, en-GB;q=0.9",
                "Connection": "keep-alive"
            }
        });

        if (!response.ok) {
            console.log(`⚠️ Maçkolik API Reddi (HTTP ${response.status})`);
            return null;
        }

        return await response.json();
    } catch (e) {
        console.error(`❌ MACKOLIK FETCH HATASI -> ${e.message}`);
        return null;
    }
}

// =========================================================================
// 🏀 BASKETBOL GÜNCELLEME (YENİ MAÇKOLİK ALTYAPISI)
// =========================================================================
async function updateBasketball(targetDates = [getTRDate(0)]) {
    console.log(`🏀 Basketbol: Tarihler: ${targetDates.join(', ')} aranıyor...`);

    for (const date of targetDates) {
        const responseData = await fetchMackolikBasketball(date);
        
        if (responseData && responseData.data && responseData.data.length > 0) {
            console.log(`\n✅ ${date} tarihi için Maçkolik'ten veri çekildi!`);
            console.log(`📊 Toplam Maç Sayısı: ${responseData.data.length}`);
            
            // GELEN JSON VERİSİNİN ŞEMASINI İNCELEMEK İÇİN İLK MAÇI EKRANA BASTIRIYORUZ
            console.log("\n================ MAÇKOLİK VERİ ŞEMASI ÖRNEĞİ ================");
            console.log(JSON.stringify(responseData.data[0], null, 2));
            console.log("=============================================================\n");
            
            // Şemayı görebilmemiz için işlemi burada bilerek durduruyoruz.
            console.log("🛑 Kod şema incelemesi için durduruldu. Lütfen yukarıdaki JSON çıktısını bana gönder.");
            process.exit(0); 
        }
    }
}

// =========================================================================
// 🆕 ANA DÖNGÜ TESTİ
// =========================================================================
async function main() {
    loadState();
    console.log("============================================================");
    console.log("🟢 [BASKETBOL] MAÇKOLİK TEST SERVİSİ BAŞLADI");
    console.log("============================================================");

    // Sadece bugünün tarihini test ediyoruz
    await updateBasketball([getTRDate(0)]);
}
main();
