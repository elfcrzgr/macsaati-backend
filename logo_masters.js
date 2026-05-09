const fs = require("fs");
const path = require("path");
const axios = require("axios");

const FIREBASE_BASE_URL =
  "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

const configs = [
  {
    name: "Futbol",
    file: "matches_football.json",
    dirs: {
      team: path.join(__dirname, "football", "logos"),
      tournament: path.join(__dirname, "football", "tournament_logos"),
    },
  },
  {
    name: "Basketbol",
    file: "matches_basketball.json",
    dirs: {
      team: path.join(__dirname, "basketball", "logos"),
      nba: path.join(__dirname, "basketball", "logos", "NBA"),
      tournament: path.join(__dirname, "basketball", "tournament_logos"),
    },
  },
  {
    name: "Tenis",
    file: "matches_tennis.json",
    dirs: {
      team: path.join(__dirname, "tennis", "logos"),
      tournament: path.join(__dirname, "tennis", "tournament_logos"),
    },
  },
];

// Klasörleri oluştur
for (const c of configs) {
  Object.values(c.dirs).forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cookie varsa buraya yapıştır, yoksa boş bırak
const SOFASCORE_COOKIE = "";

async function fetchFirebase(file) {
  try {
    const res = await axios.get(`${FIREBASE_BASE_URL}${file}`, {
      timeout: 15000,
    });
    return res.data || null;
  } catch (e) {
    console.log(`❌ Firebase error: ${file}`);
    return null;
  }
}

function exists(dir, id) {
  return fs.existsSync(path.join(dir, `${id}.png`));
}

async function downloadImage(urls, outPath, name) {
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Referer: "https://www.sofascore.com/",
          Origin: "https://www.sofascore.com",
          "Sec-Fetch-Dest": "image",
          "Sec-Fetch-Mode": "no-cors",
          "Sec-Fetch-Site": "same-site",
          "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          Connection: "keep-alive",
        };

        if (SOFASCORE_COOKIE) {
          headers["Cookie"] = SOFASCORE_COOKIE;
        }

        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 20000,
          headers,
          validateStatus: () => true,
        });

        if (res.status === 200 && res.data?.byteLength > 800) {
          fs.writeFileSync(outPath, res.data);
          console.log(`   ✅ OK: ${name}`);
          return true;
        }

        if (res.status === 403) {
          console.log(`   🚫 403 (deneme ${attempt}/3): ${name} → ${url}`);
          await sleep(2000 * attempt);
          break;
        }

        if (res.status === 404) {
          console.log(`   ⚠️ 404 (bulunamadı): ${name} → ${url}`);
          break;
        }

        console.log(`   ⚠️ HTTP ${res.status}: ${name}`);
        await sleep(1000 * attempt);
      } catch (e) {
        console.log(`   ⚠️ Hata (deneme ${attempt}/3): ${name} → ${e.message}`);
        await sleep(1000 * attempt);
      }
    }
  }

  console.log(`   ❌ BAŞARISIZ: ${name}`);
  return false;
}

async function start() {
  console.log("🚀 LOGO İNDİRİCİ BAŞLADI\n");

  let totalMissing = 0;
  let totalSuccess = 0;
  let totalFail = 0;

  for (const conf of configs) {
    console.log(`\n📂 ${conf.name} işleniyor...`);

    const data = await fetchFirebase(conf.file);

    if (!data) {
      console.log(`⚠️ ${conf.name} ATLANDI (firebase boş döndü)`);
      continue;
    }

    const matches = data.matches || data.events || [];
    if (!Array.isArray(matches)) {
      console.log(`⚠️ ${conf.name} GEÇERSİZ VERİ`);
      continue;
    }

    const missing = [];
    const seenIds = new Set();

    for (const m of matches) {
      const isNBA = (m.tournament || "").toUpperCase().includes("NBA");

      // 🏆 Turnuva logosu
      if (m.tournamentLogo) {
        const id = m.tournamentLogo.split("/").pop().split(".")[0];
        const key = `tournament_${id}`;

        if (!seenIds.has(key) && !exists(conf.dirs.tournament, id)) {
          seenIds.add(key);
          missing.push({
            id,
            name: m.tournament || id,
            type: "tournament",
            dir: conf.dirs.tournament,
          });
        }
      }

      // 👕 Takım logoları
      for (const t of [m.homeTeam, m.awayTeam]) {
        if (!t) continue;

        const logos = Array.isArray(t.logos)
          ? t.logos
          : [t.logo].filter(Boolean);

        for (const url of logos) {
          const id = url?.split("/").pop().split(".")[0];
          if (!id) continue;

          const dir =
            conf.name === "Basketbol" && isNBA
              ? conf.dirs.nba
              : conf.dirs.team;

          const key = `team_${id}`;

          if (!seenIds.has(key) && !exists(dir, id)) {
            seenIds.add(key);
            missing.push({
              id,
              name: t.name || id,
              type: "team",
              dir,
            });
          }
        }
      }
    }

    console.log(`🔍 ${conf.name} → Eksik logo sayısı: ${missing.length}`);
    totalMissing += missing.length;

    for (const item of missing) {
      let urls = [];

      if (item.type === "tournament") {
        urls = [
          `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image/dark`,
          `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image`,
          `https://img.sofascore.com/api/v1/unique-tournament/${item.id}/image/dark`,
          `https://img.sofascore.com/api/v1/unique-tournament/${item.id}/image`,
          `https://www.sofascore.com/static/images/tournaments/${item.id}.png`,
        ];
      } else {
        urls = [
          `https://api.sofascore.app/api/v1/team/${item.id}/image/dark`,
          `https://api.sofascore.app/api/v1/team/${item.id}/image`,
          `https://img.sofascore.com/api/v1/team/${item.id}/image/dark`,
          `https://img.sofascore.com/api/v1/team/${item.id}/image`,
          `https://www.sofascore.com/static/images/teams/${item.id}.png`,
        ];
      }

      const outPath = path.join(item.dir, `${item.id}.png`);
      console.log(`⬇️  İndiriliyor: ${item.name} (ID: ${item.id})`);

      const ok = await downloadImage(urls, outPath, item.name);
      if (ok) totalSuccess++;
      else totalFail++;

      await sleep(1200);
    }

    console.log(`✅ ${conf.name} TAMAMLANDI`);
  }

  console.log("\n─────────────────────────────────");
  console.log(`📊 ÖZET:`);
  console.log(`   Toplam eksik  : ${totalMissing}`);
  console.log(`   Başarılı      : ${totalSuccess}`);
  console.log(`   Başarısız     : ${totalFail}`);
  console.log("─────────────────────────────────");
}

start();
