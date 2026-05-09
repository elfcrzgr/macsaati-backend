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
      tournament: path.join(
        __dirname,
        "basketball",
        "tournament_logos"
      ),
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

// klasörler
for (const c of configs) {
  Object.values(c.dirs).forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * 🔥 MULTI SOURCE + 403 SAFE DOWNLOAD
 */
async function downloadImage(urls, outPath, name) {
  for (const url of urls) {
    for (let i = 1; i <= 2; i++) {
      try {
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 20000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            Referer: "https://www.sofascore.com/",
            Origin: "https://www.sofascore.com",
          },
          validateStatus: () => true,
        });

        if (res.status === 200 && res.data?.byteLength > 800) {
          fs.writeFileSync(outPath, res.data);
          console.log(`   ✅ OK: ${name}`);
          return true;
        }

        if (res.status === 403) {
          console.log(`   🚫 403 (retry fallback): ${name}`);
          break;
        }
      } catch (e) {
        await sleep(800 * i);
      }
    }
  }

  console.log(`   ❌ FINAL FAIL: ${name}`);
  return false;
}

async function start() {
  console.log("🚀 V6 SYSTEM START (FIREBASE + 403 SAFE + REPO SAFE)\n");

  let totalMissing = 0;

  for (const conf of configs) {
    const data = await fetchFirebase(conf.file);

    if (!data) {
      console.log(`⚠️ ${conf.name} SKIPPED (firebase null)`);
      continue;
    }

    const matches = data.matches || data.events || [];
    if (!Array.isArray(matches)) {
      console.log(`⚠️ ${conf.name} INVALID DATA`);
      continue;
    }

    const missing = [];

    for (const m of matches) {
      const isNBA =
        (m.tournament || "").toUpperCase().includes("NBA");

      // 🏆 tournament
      if (m.tournamentLogo) {
        const id = m.tournamentLogo.split("/").pop().split(".")[0];

        if (!exists(conf.dirs.tournament, id)) {
          missing.push({
            id,
            name: m.tournament,
            type: "tournament",
            dir: conf.dirs.tournament,
          });
        }
      }

      // 👕 teams
      for (const t of [m.homeTeam, m.awayTeam]) {
        if (!t) continue;

        const logos = Array.isArray(t.logos)
          ? t.logos
          : [t.logo].filter(Boolean);

        for (const url of logos) {
          const id = url?.split("/").pop().split(".")[0];
          if (!id) continue;

          let dir =
            conf.name === "Basketbol" && isNBA
              ? conf.dirs.nba
              : conf.dirs.team;

          if (!exists(dir, id)) {
            missing.push({
              id,
              name: t.name,
              type: "team",
              dir,
            });
          }
        }
      }
    }

    console.log(`🔍 ${conf.name} Missing: ${missing.length}`);
    totalMissing += missing.length;

    for (const item of missing) {
      let urls = [];

      if (item.type === "tournament") {
        urls = [
          `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image`,
          `https://www.sofascore.com/static/images/tournaments/${item.id}.png`,
        ];
      } else {
        urls = [
          `https://api.sofascore.app/api/v1/team/${item.id}/image`,
          `https://www.sofascore.com/static/images/teams/${item.id}.png`,
        ];
      }

      const outPath = path.join(item.dir, `${item.id}.png`);

      console.log(`⬇️ DOWNLOADING: ${item.name} | ${item.id}`);

      await downloadImage(urls, outPath, item.name);
      await sleep(700);
    }

    console.log(`✅ ${conf.name} DONE\n`);
  }

  console.log(`🏁 TOTAL MISSING: ${totalMissing}`);
}

start();