const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FIREBASE_BASE_URL =
  'https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/';

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

// =========================
// HELPERS
// =========================
const sleep = ms => new Promise(r => setTimeout(r, ms));

// =========================
// DEBUG CHECK
// =========================
function checkFile(confName, teamName, teamId, filePath) {

  const exists = fs.existsSync(filePath);

  console.log(`🔎 [${confName}] ${teamName} (${teamId})`);
  console.log(`   📂 ${filePath}`);
  console.log(`   👉 ${exists ? 'VAR ✅' : 'YOK ❌'}`);

  return exists;
}

// =========================
// DOWNLOAD
// =========================
async function download(url, filePath, name) {

  try {

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    fs.writeFileSync(filePath, res.data);

    console.log(`   💾 DOWNLOAD OK → ${name}`);

    return true;

  } catch (e) {

    console.log(
      `   ❌ DOWNLOAD FAIL → ${name} (${e.response?.status || e.message})`
    );

    return false;
  }
}

// =========================
// SOFA FALLBACK
// =========================
const getSofaUrl = (type, id) => {

  if (type === 'team') {
    return `https://img.sofascore.com/api/v1/team/${id}/image`;
  }

  if (type === 'tournament') {
    return `https://img.sofascore.com/api/v1/unique-tournament/${id}/image`;
  }

  return null;
};

// =========================
// MAIN
// =========================
async function start() {

  console.log('🚀 DEBUG LOGO SYSTEM STARTED\n');

  let ok = 0;
  let fail = 0;

  for (const conf of configs) {

    console.log(`\n📦 ===== ${conf.name} =====`);

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

    console.log(`📄 Matches: ${matches.length}`);

    const missing = [];

    // =========================
    // LOOP MATCHES
    // =========================
    for (const m of matches) {

      const isNBA =
        (m.tournament || '').toUpperCase().includes('NBA');

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {

        if (!t?.id || !t?.name) {
          console.log('⚠️ SKIP: invalid team');
          continue;
        }

        let dir = conf.dirs.team;

        if (conf.name === 'Basketbol' && isNBA) {
          dir = conf.dirs.nba;
        }

        const filePath =
          path.join(dir, `${t.id}.png`);

        const exists =
          checkFile(conf.name, t.name, t.id, filePath);

        if (!exists) {

          missing.push({
            type: 'team',
            id: t.id,
            name: t.name,
            filePath
          });
        }
      }

      // =========================
      // TOURNAMENT
      // =========================
      if (m.tournamentId) {

        const filePath =
          path.join(
            conf.dirs.tournament,
            `${m.tournamentId}.png`
          );

        const exists =
          fs.existsSync(filePath);

        console.log(
          `🏆 [${conf.name}] Tournament ${m.tournament} (${m.tournamentId})`
        );

        console.log(
          `   📂 ${filePath}`
        );

        console.log(
          `   👉 ${exists ? 'VAR ✅' : 'YOK ❌'}`
        );

        if (!exists) {

          missing.push({
            type: 'tournament',
            id: m.tournamentId,
            name: m.tournament,
            filePath
          });
        }
      }
    }

    console.log(`\n🔍 Missing: ${missing.length}`);

    // =========================
    // DOWNLOAD
    // =========================
    for (const item of missing) {

      const url =
        getSofaUrl(item.type, item.id);

      if (!url) continue;

      const success =
        await download(url, item.filePath, item.name);

      if (success) ok++;
      else fail++;

      await sleep(300);
    }

    console.log(`✅ ${conf.name} DONE`);
  }

  console.log('\n📊 FINAL RESULT');
  console.log(`✅ Success: ${ok}`);
  console.log(`❌ Fail: ${fail}`);
}

start();