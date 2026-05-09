const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FIREBASE_BASE_URL =
  'https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/';

const CONCURRENCY = 8;

const configs = [
  {
    name: 'Futbol',
    firebaseFile: 'matches_football',
    dirs: {
      team: path.join(__dirname, 'football', 'logos'),
      tournament: path.join(__dirname, 'football', 'tournament_logos')
    }
  },
  {
    name: 'Basketbol',
    firebaseFile: 'matches_basketball',
    dirs: {
      team: path.join(__dirname, 'basketball', 'logos'),
      nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
      tournament: path.join(__dirname, 'basketball', 'tournament_logos')
    }
  },
  {
    name: 'Tenis',
    firebaseFile: 'matches_tennis',
    dirs: {
      team: path.join(__dirname, 'tennis', 'logos'),
      tournament: path.join(__dirname, 'tennis', 'tournament_logos')
    }
  }
];

// =========================
// INIT FOLDERS
// =========================
for (const conf of configs) {
  for (const dir of Object.values(conf.dirs)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =========================
// SAFE DOWNLOAD
// =========================
async function download(url, filePath, name) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/*'
      }
    });

    if (!res.data || res.data.byteLength < 500) return false;

    fs.writeFileSync(filePath, res.data);

    console.log(`   ✅ ${name}`);
    return true;

  } catch (e) {
    console.log(`   ❌ ${name} -> ${e.response?.status || e.message}`);
    return false;
  }
}

// =========================
// SOFASCORE FALLBACK
// =========================
function getSofaUrl(id) {
  return `https://img.sofascore.com/api/v1/team/${id}/image`;
}

// =========================
// MAIN
// =========================
async function start() {

  console.log('🚀 Missing Logo Engine Started\n');

  let ok = 0;
  let fail = 0;

  for (const conf of configs) {

    console.log(`📦 ${conf.name}`);

    let data;

    try {
      const res = await axios.get(
        `${FIREBASE_BASE_URL}${conf.firebaseFile}.json`
      );

      data = res.data;

    } catch (e) {
      console.log('❌ Firebase error');
      continue;
    }

    const matches =
      data?.matches || data?.events || [];

    console.log(`📄 ${matches.length} matches`);

    // =========================
    // COLLECT MISSING
    // =========================
    const missing = [];

    for (const m of matches) {

      const isNBA =
        (m.tournament || '').toUpperCase().includes('NBA');

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {

        if (!t?.id || !t?.name) continue;

        let dir = conf.dirs.team;

        if (conf.name === 'Basketbol' && isNBA) {
          dir = conf.dirs.nba;
        }

        const filePath =
          path.join(dir, `${t.id}.png`);

        if (!fs.existsSync(filePath)) {

          missing.push({
            id: t.id,
            name: t.name,
            filePath,
            url: t.logo || getSofaUrl(t.id)
          });
        }
      }
    }

    console.log(`🔍 Missing: ${missing.length}`);

    // =========================
    // PARALLEL DOWNLOAD
    // =========================
    const chunks = [];

    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      chunks.push(missing.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {

      await Promise.all(
        chunk.map(async item => {

          const success =
            await download(
              item.url,
              item.filePath,
              item.name
            );

          if (success) ok++;
          else fail++;

        })
      );

      await sleep(300);
    }

    console.log(`✅ ${conf.name} done\n`);
  }

  console.log('\n📊 FINAL RESULT');
  console.log(`✅ Success: ${ok}`);
  console.log(`❌ Fail: ${fail}`);
}

start();