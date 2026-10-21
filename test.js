const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');

const app = admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
}, 'test');

app.database().ref('.info/connected').on('value', s => console.log('bağlı mı:', s.val()));

app.database().ref('forced_matches').once('value')
    .then(s => { console.log('✅ okundu:', JSON.stringify(s.val())); process.exit(); })
    .catch(e => { console.log('❌ hata:', e.message); process.exit(); });

setTimeout(() => { console.log('⏰ 20 sn doldu, yanıt yok'); process.exit(); }, 20000);
