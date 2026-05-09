const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FIREBASE_BASE_URL =
  "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

const configs = [
  {
    name: 'Futbol',
    firebasePath: 'matches_football.json',
    dirs: {
      team: path.join(__dirname, 'football', 'logos'),
      tournament: path.join(__dirname, 'football', 'tournament_logos')
    }
  },
  {
    name: 'Basketbol',
    firebasePath: 'matches_basketball.json',
    dirs: {
      team: path.join(__dirname, 'basketball', 'logos'),
      nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
      tournament: path.join(__dirname, 'basketball', 'tournament_logos')
    }
  },
  {
    name: 'Tenis',
    firebasePath: 'matches_tennis.json',
    dirs: {
      tournament: path.join(__dirname, 'tennis', 'tournament_logos'),
      team: path.join(__dirname, 'tennis', 'logos')
    }
  }
];

// klasörleri oluştur
for (const c of configs) {
  Object.values(c.dirs).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractId(url) {
  if (!url) return null;
  return url.split('/').pop().split('.')[0];
}

async function fetchFirebase(file) {
  const url = `${FIREBASE_BASE_URL}${file}`;
  const res = await axios.get(url);
  return res.data;
}

// 🔥 KRİTİK: SofaScore anti-bot bypass (light)
async function downloadImage(url, filePath) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Referer': 'https://www.sofascore.com/',
      'Origin': 'https://www.sofascore.com',
      'Accept':
        'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    }
  });

  fs.writeFileSync(filePath, res.data);
}

// 🔥 retry + 403 handling
async function safeDownload(url, filePath, name) {
  for (let i = 0; i < 3; i++) {
    try {
      await downloadImage(url, filePath);
      console.log(`   ✅ OK: ${name}`);
      return true;
    } catch (e) {
      const status = e.response?.status;

      if (status === 403) {
        console.log(`   🚫 403 BLOCK (${i + 1}/3): ${name}`);
        await sleep(2500 + i * 2000);
      } else {
        console.log(`   ❌ FAIL ${status || "ERR"}: ${name}`);
        return false;
      }
    }
  }

  console.log(`   ❌ FINAL FAIL: ${name}`);
  return false;
}

async function start() {
  console.log("🚀 LOGO SYSTEM STARTED (FIXED VERSION)\n");

  let success = 0;
  let fail = 0;

  for (const conf of configs) {
    console.log(`\n📦 ===== ${conf.name} =====`);

    const data = await fetchFirebase(conf.firebasePath);
    const matches = data.matches || data.events || [];

    console.log(`📄 Matches: ${matches.length}`);

    const missing = [];

    for (const m of matches) {
      if (!m.homeTeam || !m.awayTeam) continue;

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {
        if (!t?.logo) continue;

        const id = extractId(t.logo);
        if (!id) continue;

        const isNBA = (m.tournament || "").toUpperCase().includes("NBA");

        let dir = conf.dirs.team;
        if (conf.name === 'Basketbol' && isNBA) {
          dir = conf.dirs.nba;
        }

        const filePath = path.join(dir, `${id}.png`);

        console.log(`🔎 CHECK: ${t.name} (${id})`);

        if (!fs.existsSync(filePath)) {
          missing.push({
            id,
            name: t.name,
            path: filePath
          });
        }
      }
    }

    console.log(`\n🔍 Missing: ${missing.length}`);

    for (const item of missing) {
      const url = `https://api.sofascore.app/api/v1/team/${item.id}/image`;

      console.log(`⬇️ DOWNLOADING: ${item.name} | ${item.id}`);

      const ok = await safeDownload(url, item.path, item.name);

      if (ok) success++;
      else fail++;

      // 🔥 CRITICAL RATE LIMIT FIX
      await sleep(2800);
    }

    console.log(`\n✅ ${conf.name} DONE`);
  }

  console.log(`\n📊 FINAL RESULT`);
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Fail: ${fail}`);
}

start();