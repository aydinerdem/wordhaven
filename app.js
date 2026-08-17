
// ═══════════════════════════════════════════════════════════════════════════
// TÜRKÇE → İNGİLİZCE ARAMA
// ═══════════════════════════════════════════════════════════════════════════
// builtin-content.json'daki 26.746 kaydın hepsinde `turkish` alanı dolu.
// Bunlardan ters bir indeks kurup "kitap" yazınca "book" bulunmasını sağlıyoruz.
// İndeks ilk Türkçe aramada kurulur (tembel), sonra bellekte kalır.

let _trIndex = null;   // normalize edilmiş Türkçe terim → [wkey, ...]
let _trEntries = null; // [{ key, word, pos, turkish, terms:[...] }]

// Türkçe'ye duyarlı küçük harf: I→ı, İ→i (JS'in varsayılan toLowerCase'i
// Türkçe'de yanlış sonuç verir).
function trLower(s) {
  return String(s || '').replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

// Aksan toleransı: kullanıcı "sarki" yazsa da "şarkı" bulunsun.
const TR_FOLD = { 'ç':'c', 'ğ':'g', 'ı':'i', 'ö':'o', 'ş':'s', 'ü':'u', 'â':'a', 'î':'i', 'û':'u' };
function trFold(s) {
  // 'İ'.toLowerCase() JS'te 'i' + U+0307 (birleşik nokta) üretir; bu görünmez
  // karakter eşleşmeyi bozuyordu. Tüm birleşik aksanları temizliyoruz.
  return trLower(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[çğıöşüâîû]/g, ch => TR_FOLD[ch] || ch);
}

function trNormalize(s) {
  return trFold(s).replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Türkçe karşılık metnini tekil terimlere böler.
// "üzerinde, -in üstünde, -den yukarıda" → ["üzerinde", "-in üstünde", ...]
function trSplitTerms(turkish) {
  return String(turkish || '')
    .split(/[,;/()]|\s+veya\s+|\s+ya da\s+/)
    .map(t => trNormalize(t))
    .filter(t => t.length > 1);
}

function trBuildIndex() {
  if (_trIndex) return;
  _trIndex = Object.create(null);
  _trEntries = [];
  for (const key in BUILTIN_CONTENT) {
    const c = BUILTIN_CONTENT[key];
    if (!c || !c.turkish) continue;
    const [word, pos] = key.split('|');
    const terms = trSplitTerms(c.turkish);
    if (!terms.length) continue;
    // rawTerms: aksanları korunmuş hâli. "su" ararken "şu" ile karışmasın diye
    // birebir eşleşme, aksan katlanarak bulunan eşleşmenin önüne geçer.
    const rawTerms = String(c.turkish).split(/[,;/()]|\s+veya\s+|\s+ya da\s+/)
      .map(t => trLower(t).replace(/[^a-zçğıöşü0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 1);
    const entry = { key, word, pos: pos || '', turkish: c.turkish, terms, rawTerms };
    _trEntries.push(entry);
    terms.forEach(t => { (_trIndex[t] || (_trIndex[t] = [])).push(entry); });
  }
}

// Türkçe sorguyu arar, en iyi eşleşmeler önce.
//   1 = terimin tamamı birebir  ("kitap" → "kitap")
//   2 = terim sorguyla başlıyor ("kitap" → "kitapçı")
//   3 = terim sorguyu içeriyor  ("kitap" → "ders kitabı" değil ama "el kitabı" evet)
function trSearch(query, limit) {
  trBuildIndex();
  const q = trNormalize(query);
  if (q.length < 2) return [];

  const seen = new Set();
  const out = [];
  const push = (e, rank) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    out.push({ ...e, rank });
  };

  const qRaw = trLower(query).replace(/[^a-zçğıöşü0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  // Önce aksanıyla birebir eşleşenler ("su" → su), sonra katlanmış eşleşmeler ("şu")
  (_trIndex[q] || []).forEach(e => { if (e.rawTerms.includes(qRaw)) push(e, 0); });
  (_trIndex[q] || []).forEach(e => push(e, 1));

  for (const term in _trIndex) {
    if (out.length > 400) break;
    if (term === q) continue;
    if (term.startsWith(q)) _trIndex[term].forEach(e => push(e, 2));
  }
  for (const term in _trIndex) {
    if (out.length > 400) break;
    if (term === q || term.startsWith(q)) continue;
    if (term.includes(q)) _trIndex[term].forEach(e => push(e, 3));
  }

  // Sıralama: eşleşme kalitesi → kelimenin seviyesi (kolaydan zora) → alfabetik
  const lvlOrder = { A1:0, A2:1, B1:2, B2:3, C1:4, C2:5 };
  out.forEach(e => {
    const w = WORD_DATA.find(x => x.word === e.word && x.pos === e.pos)
           || TOPIC_WORDS.find(x => x.word === e.word && x.pos === e.pos);
    e.cefr = w ? w.cefr : '';
    e.wordObj = w || { word: e.word, pos: e.pos };
    e.lvl = lvlOrder[e.cefr] !== undefined ? lvlOrder[e.cefr] : 9;
  });
  out.sort((a, b) => a.rank - b.rank || a.lvl - b.lvl || a.word.localeCompare(b.word));
  return out.slice(0, limit || 40);
}

// Sorgu Türkçe mi görünüyor? (İngilizce'de bulunmayan harfler veya
// İngilizce listelerde hiç karşılığı olmaması)
function looksTurkish(q) {
  return /[çğışöüÇĞİŞÖÜ]/.test(q);
}

function trResultsHtml(results, query) {
  if (!results.length) return '';
  const rows = results.map(e => {
    const p = progress[e.key];
    const mark = !p ? '' : (p.mastery === 'mastered' ? ico('check',12,'#5cb87a',false) : (p.lastAnswer === 'learning' ? ico('alert',12,'#e08a5c',false) : ico('check',12,'var(--text3)',false)));
    return `<div class="tr-hit" onclick="openWordActions(${escAttr(JSON.stringify(e.word))},${escAttr(JSON.stringify(e.pos))})">
      <div style="min-width:0;">
        <span class="wordfont" style="font-size:16px;">${escHtml(e.word)}</span>
        <span style="font-size:11px;color:var(--text3);font-style:italic;margin-left:5px;">${escHtml(e.pos)}</span>
        ${e.cefr ? `<span class="badge b-${e.cefr.toLowerCase()}" style="margin-left:5px;">${e.cefr}</span>` : ''}
        ${mark ? `<span style="margin-left:5px;font-size:11px;">${mark}</span>` : ''}
        <div style="font-size:12px;color:var(--text2);margin-top:2px;line-height:1.5;">${escHtml(e.turkish)}</div>
      </div>
      <span style="color:var(--text3);font-size:12px;flex-shrink:0;">›</span>
    </div>`;
  }).join('');

  return `<div style="margin-top:4px;">
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px;line-height:1.6;">
      "<b style="color:var(--text2);">${escHtml(query)}</b>" için ${results.length} İngilizce karşılık —
      birine dokunarak çalışabilirsin.
    </div>
    ${rows}
  </div>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// KELİME EYLEM MENÜSÜ — bir kelimeyi seçip nasıl çalışacağını belirle
// ═══════════════════════════════════════════════════════════════════════════
// Özet'teki listelerde bir kelimeye dokununca açılır. İki iş yapar:
//   1) Kelimeyi "Biliyorum" / "Bilmiyorum" havuzları arasında taşır
//   2) Kart Modu / Cümle Kur / Cümle Yaz / Asmaca modüllerinden birini
//      DOĞRUDAN o kelime için başlatır
// İçeriği olmayan modüller (örn. o kelime için egzersiz üretilmemişse)
// devre dışı görünür — kullanıcı boş bir ekrana düşmez.

let waCurrent = null;   // { word, pos }

function waFindWord(word, pos) {
  return WORD_DATA.find(x => x.word === word && x.pos === pos)
      || TOPIC_WORDS.find(x => x.word === word && x.pos === pos)
      || EXTRA_WORDS.find(x => x.word === word && x.pos === pos)
      || { word, pos };
}

// O kelime için Cümle Kur / Cümle Yaz egzersizi var mı?
function waExercisesFor(word) {
  if (typeof SG_EXERCISES === 'undefined') return [];
  const lw = String(word).toLowerCase();
  const cands = gbLemmaCandidates(lw);
  return SG_EXERCISES.filter(e => {
    const t = String(e.targetWord || '').toLowerCase();
    if (t === lw) return true;
    if (cands.includes(t)) return true;
    return (e.chunks || []).some(c => String(c.vocabWord || '').toLowerCase() === lw);
  });
}

// Asmaca havuzunda var mı? (kısa/uzun ve pos filtreleri yüzünden her kelime yok)
function waInHangman(word, pos) {
  return HG_POOL.some(w => w.word === word && w.pos === pos);
}

function openWordActions(word, pos) {
  waCurrent = { word, pos };
  const w = waFindWord(word, pos);
  const k = wkey(w);
  const p = progress[k];
  const ex = waExercisesFor(word);
  const inHg = waInHangman(word, pos);
  const c = BUILTIN_CONTENT[k];

  const statusLabel = !p ? 'Henüz çalışılmadı'
    : p.mastery === 'mastered' ? ico('award')+'Tam öğrenildi'
    : p.lastAnswer === 'learning' ? ico('alert')+'Bilmiyorum dedin'
    : ico('check')+'Biliyorum dedin';

  const opt = (label, sub, handler, enabled) =>
    `<button class="wa-opt${enabled ? '' : ' disabled'}" ${enabled ? `onclick="${handler}"` : 'disabled'}>
       <span class="wa-opt-label">${label}</span>
       <span class="wa-opt-sub">${sub}</span>
     </button>`;

  const html = `
    <div class="wa-sheet" onclick="event.stopPropagation()">
      <div class="wa-head">
        <div>
          <div class="wordfont" style="font-size:22px;">${escHtml(word)}</div>
          <div style="font-size:12px;color:var(--text3);font-style:italic;margin-top:2px;">${escHtml(pos || '')} · ${statusLabel}</div>
        </div>
        <button class="wa-close" onclick="closeWordActions()">✕</button>
      </div>

      ${c && c.turkish ? `<div style="font-size:13px;color:var(--text2);padding:0 16px 12px;line-height:1.6;">${escHtml(c.turkish)}</div>` : ''}

      <div class="wa-section-label">Durumunu değiştir</div>
      <div style="display:flex;gap:8px;padding:0 16px 14px;">
        <button class="chip" style="flex:1;" onclick="waSetStatus(false)">${ico('alert')}Bilmiyorum</button>
        <button class="chip" style="flex:1;" onclick="waSetStatus(true)">${ico('check')}Biliyorum</button>
      </div>

      <div class="wa-section-label">Bu kelimeyi nasıl çalışmak istersin?</div>
      <div class="wa-opts">
        ${opt('🃏 Kart Modu', 'Kartı gör, Türkçesini hatırla', "waStudy('card')", true)}
        ${opt('🧩 Cümle Kur', ex.length ? `${ex.length} egzersiz hazır` : 'Bu kelime için egzersiz yok', "waStudy('sentence')", ex.length > 0)}
        ${opt('✍️ Cümle Yaz', ex.length ? 'Türkçesini İngilizce yaz' : 'Bu kelime için egzersiz yok', "waStudy('writing')", ex.length > 0)}
        ${opt('🎯 Asmaca', inHg ? 'Harf harf tahmin et' : 'Bu kelime oyuna uygun değil', "waStudy('hangman')", inHg)}
        ${opt('📖 Sözlükte aç', 'Tanım, nüans ve örnekler', "waStudy('dict')", true)}
      </div>
    </div>`;

  let ov = document.getElementById('wa-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'wa-overlay';
    ov.className = 'wa-overlay';
    ov.onclick = closeWordActions;
    document.body.appendChild(ov);
  }
  ov.innerHTML = html;
  ov.classList.add('open');
}

function closeWordActions() {
  const ov = document.getElementById('wa-overlay');
  if (ov) ov.classList.remove('open');
}

// ── Durum değiştirme ───────────────────────────────────────────────────────
function waSetStatus(known) {
  if (!waCurrent) return;
  const w = waFindWord(waCurrent.word, waCurrent.pos);
  const k = wkey(w);
  const cur = progress[k] || {};
  const next = getNextReview(cur, known);
  progress[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
  saveState();
  closeWordActions();
  updateDashboard();
  if (typeof stRenderList === 'function' && !document.getElementById('view-status').classList.contains('hidden')) stRenderList();
}

// ── Modüle yönlendirme ─────────────────────────────────────────────────────
function waStudy(mode) {
  if (!waCurrent) return;
  const { word, pos } = waCurrent;
  closeWordActions();

  if (mode === 'card')      return waStudyCard(word, pos);
  if (mode === 'sentence')  return waStudySentence(word);
  if (mode === 'writing')   return waStudyWriting(word);
  if (mode === 'hangman')   return waStudyHangman(word, pos);
  if (mode === 'dict')      return waStudyDict(word);
}

// Kart Modu: tek kelimelik bir oturum kur
function waStudyCard(word, pos) {
  const w = waFindWord(word, pos);
  showView('cardmode');
  cmQueue = [w];
  cmIdx = 0; cmViewIdx = 0; cmAnswers = []; cmHistory = [];
  cmReviewing = false;
  cmDone = { known: 0, learning: 0 };
  cmRenderProgress();
  cmShowCard();
}

// Cümle Kur: o kelimenin egzersizlerinden birini aç
function waStudySentence(word) {
  const ex = waExercisesFor(word);
  if (!ex.length) { showView('sentence'); return; }
  showView('sentence');
  sgCurrentExercise = ex[Math.floor(Math.random() * ex.length)];
  sgLastExerciseId = sgCurrentExercise.id;
  sgTokens = [...sgCurrentExercise.root];
  sgChunkIndex = 0;
  sgWrongCount = 0;
  sgTotalWrongTaps = 0;
  sgVerbResolved = false;
  sgPrepResolved = {};
  sgRenderExercise();
}

// Cümle Yaz: o kelimenin egzersizinden soru kur
function waStudyWriting(word) {
  const ex = waExercisesFor(word);
  showView('writing');
  if (!ex.length) return;
  const e = ex[Math.floor(Math.random() * ex.length)];
  wrTense = e.tense;
  wrRenderTenses();
  wrCurrent = {
    word: e.targetWord,
    turkish: e.turkish,
    tense: e.tense,
    cefr: e.cefr || '',
    reference: wrBuildReference(e)
  };
  wrHintLevel = 0;
  wrLastResult = null;
  wrRenderQuestion();
}

// Asmaca: o kelimeyi zorla seç
function waStudyHangman(word, pos) {
  showView('hangman');
  const w = HG_POOL.find(x => x.word === word && x.pos === pos);
  if (!w) return;
  hgCurrentWord = w;
  hgLastWordKey = w.word + '|' + w.pos;
  hgGuessedLetters = new Set();
  hgLives = HG_MAX_LIVES;
  hgHintsUsed = 0;
  hgGameOver = null;
  hgRenderGame();
}

// Sözlüğüm: kelimeyi arama kutusuna yazıp sonucu aç
function waStudyDict(word) {
  showView('wordadd');
  const input = document.getElementById('global-search-input');
  if (input) { input.value = word; performGlobalSearch(); }
}


// ═══════════════════════════════════════════════════════════════════════════
// ÖZET EKRANI — "bugün" odaklı yeniden tasarım
// ═══════════════════════════════════════════════════════════════════════════
// Eski ekran bir RAPOR ekranıydı: üç sıfırla karşılıyor, dokunulacak bir şey
// sunmuyor, beş özdeş boş seviye kartıyla ekranı dolduruyordu. Yeni ekran tek
// bir soruya cevap veriyor: "şimdi ne yapayım?"
//
//   • Üstte tek birincil eylem (bugünün çalışması)
//   • Bugünkü ilerleme halkası — toplam istatistik değil
//   • Streak sıfırken cesaretlendirici, sonrasında alev rozeti
//   • Beş seviye kartı → tek kompakt liste, dokununca detay açılır
//   • Hiç ilerleme yoksa istatistik yerine hoş geldin kartı

const DASH_GOAL_KEY = 'wordhavenDailyGoal';
const DASH_GOAL_DEFAULT = 10;

function dashGoal() {
  try {
    const v = parseInt(localStorage.getItem(DASH_GOAL_KEY), 10);
    if (v && v > 0 && v <= 200) return v;
  } catch (e) {}
  return DASH_GOAL_DEFAULT;
}
function dashSetGoal(n) {
  try { localStorage.setItem(DASH_GOAL_KEY, String(n)); } catch (e) {}
}

// Bugün dokunulan kelime sayısı — progress kayıtlarındaki lastSeen'den okunur,
// ayrı bir sayaç tutmaya gerek yok.
function dashTodayCount() {
  const t = todayStr();
  return Object.values(progress).filter(p => p && p.lastSeen === t).length;
}

function dashDueCount() {
  const t = todayStr();
  return WORD_DATA.filter(w => { const p = progress[wkey(w)]; return p && p.nextReview <= t; }).length;
}

// ── İlerleme halkası (SVG) ─────────────────────────────────────────────────
function dashRing(done, goal) {
  const R = 34, C = 2 * Math.PI * R;
  const ratio = goal ? Math.min(done / goal, 1) : 0;
  const off = C * (1 - ratio);
  const complete = done >= goal;
  const col = complete ? 'var(--success)' : 'var(--accent)';
  return `<svg width="84" height="84" viewBox="0 0 84 84" style="flex-shrink:0;">
    <circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="7"/>
    <circle cx="42" cy="42" r="${R}" fill="none" stroke="${col}" stroke-width="7"
      stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
      transform="rotate(-90 42 42)" style="transition:stroke-dashoffset .5s ease;"/>
    <text x="42" y="41" text-anchor="middle" font-size="21" font-weight="700"
      fill="var(--text)" dominant-baseline="middle">${done}</text>
    <text x="42" y="57" text-anchor="middle" font-size="10" fill="var(--text3)">/ ${goal}</text>
  </svg>`;
}

// ── Motive edici tek satır — gerçek duruma göre değişir ────────────────────
function dashMessage(done, goal, due, totalMastered) {
  if (done === 0 && due > 0) return `${due} kelime tekrar zamanını bekliyor.`;
  if (done === 0)            return 'Bugün henüz başlamadın — birkaç kelime yeter.';
  if (done < goal)           return `Hedefe ${goal - done} kelime kaldı.`;
  if (done === goal)         return 'Günlük hedefini tamamladın. Devam etmek serbest.';
  return `Hedefini ${done - goal} kelime aştın.`;
}

// ── Streak ─────────────────────────────────────────────────────────────────
function dashStreakHtml() {
  const n = streak.days.length;
  const dayNames = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const dots = dayNames.map((d, i) => {
    const done = streak.days.includes(d);
    return `<div class="s-day ${done ? 'done' : ''} ${i === todayIdx ? 'today' : ''}">${d}</div>`;
  }).join('');

  const head = n === 0
    ? `<div style="font-size:13px;font-weight:600;">Seri başlamadı</div>
       <div style="font-size:12px;color:var(--text2);margin-top:2px;">Bugün çalışırsan 1. gün</div>`
    : `<div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:5px;">${ico('flame',13,'var(--warn)',false)}${n} gün</div>
       <div style="font-size:12px;color:var(--text2);margin-top:2px;">${n >= 7 ? 'Tam hafta!' : 'Seriyi sürdür'}</div>`;

  return `<div class="streak-bar"><div>${head}</div><div class="streak-days">${dots}</div></div>`;
}

// ── Kompakt seviye listesi ─────────────────────────────────────────────────
// ── Özet başlığı: karşılama + Ayarlar kısayolu + streak rozeti ─────────────
function dashHeaderHtml() {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const dayNames = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
  const monthNames = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const now = new Date();
  const dateStr = `${now.getDate()} ${monthNames[now.getMonth()]} ${dayNames[(now.getDay()+6)%7]}`;
  const n = streak.days.length;
  return `
    <div class="oz-hdr">
      <div>
        <div class="hdr-greet wordfont">${greeting}</div>
        <div class="hdr-sub">${dateStr}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="settings-btn" onclick="showView('settings')" aria-label="Ayarlar">${ico('settings',18,'var(--text)',false)}</button>
        <div class="streak-pill">${ico('flame',15,'var(--warn)',false)}${n}</div>
      </div>
    </div>`;
}

// ── "Kavanoz patikası" — her seviye doldukça dolan bir daire, noktalı bir
// çizgiyle birbirine bağlı. Erdem'in en çok beğendiği tasarım denemesi
// (wordhaven_v2_all_preview.html) — burada gerçek veriyle çalışıyor.
function dashLevelColorVar(lv) { return '--' + lv.toLowerCase(); }
function dashJarPathHtml(levels, pctByLevel, navFnBuilder) {
  return `<div class="oz-path-row">${levels.map(lv => {
    const pct = pctByLevel[lv] || 0;
    const colorVar = dashLevelColorVar(lv);
    const fillPct = Math.max(Math.round(pct), 3);
    const filled = pct > 50;
    return `<div class="oz-jar" onclick="${navFnBuilder(lv)}">
      <div class="oz-jar-circle" style="background:linear-gradient(to top, var(${colorVar}) ${fillPct}%, var(${colorVar}bg) ${fillPct}%);color:${filled?'#fff':'var(--text2)'};">${lv}</div>
    </div>`;
  }).join('')}</div>`;
}

// Grammar modülünün kendi ana ekranındaki (grInit) genel özet halkası burayı
// kullanıyor — Özet'in kart tasarımı değişse de bu paylaşılan halka kalıyor.
function dashRingSvg(pct, color) {
  return `<svg width="58" height="58" viewBox="0 0 58 58" style="flex-shrink:0;">
    <circle cx="29" cy="29" r="24" fill="none" stroke="var(--surface2)" stroke-width="6"/>
    <circle cx="29" cy="29" r="24" fill="none" stroke="${color}" stroke-width="6"
      stroke-linecap="round" stroke-dasharray="${(2*Math.PI*24).toFixed(1)}"
      stroke-dashoffset="${(2*Math.PI*24*(1-pct/100)).toFixed(1)}"
      transform="rotate(-90 29 29)"/>
    <text x="29" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${pct}%</text>
  </svg>`;
}

// ── Kelime patikası: seviye kavanozları + 8 modüle tek dokunuşla erişim ─────
function dashWordTrackHtml() {
  const mastered = Object.values(progress).filter(p => p.mastery === 'mastered').length;
  const pctByLevel = {};
  CEFR_LEVELS.forEach(lv => {
    const words = WORD_DATA.filter(w => w.cefr === lv);
    const mast = words.filter(w => progress[wkey(w)]?.mastery === 'mastered').length;
    pctByLevel[lv] = words.length ? (mast / words.length * 100) : 0;
  });
  const chips = [
    ['cards','Kart Modu','cardmode'], ['list','Liste','list'], ['book','Sözlüğüm','wordadd'],
    ['chat','Cümle Kur','sentence'], ['pencil','Cümle Yaz','writing'], ['target','Asmaca','hangman'],
    ['news','Metin','news'], ['clipboard','Durum','status'],
  ];
  return `
    <div class="oz-track t-word">
      <div class="oz-track-head">
        <div class="oz-track-icon">${ico('notebook',19,'#fff',false)}</div>
        <div>
          <div class="oz-track-title wordfont">Kelime</div>
          <div class="oz-track-sub">Aralıklı tekrarla öğren</div>
        </div>
        <div class="oz-track-total"><b>${mastered}</b><span>tam öğrenildi</span></div>
      </div>
      ${dashJarPathHtml(CEFR_LEVELS, pctByLevel, lv => `selectListLevel('${lv}');showView('list')`)}
      <div class="oz-chip-grid">${chips.map(([iconName,label,view]) =>
        `<div class="oz-qchip" onclick="showView('${view}')">
          <div class="oz-qchip-ico">${ico(iconName,20,'var(--text)',false)}</div>
          <div class="oz-qchip-lbl">${label}</div>
        </div>`
      ).join('')}</div>
    </div>`;
}

// ── Gramer patikası: seviye kavanozları (A1-C2) + Konular/Gözden Geçir ──────
function dashGrammarTrackHtml() {
  const gr = grOverallStats();
  if (gr.totalSubs === 0) return '';  // Grammar verisi henüz yüklenmediyse hiç gösterme
  const pctByLevel = {};
  GR_DASH_LEVELS.forEach(lv => {
    const g = gr.perLevel[lv];
    pctByLevel[lv] = g.total ? (g.learned / g.total * 100) : 0;
  });
  const chips = [
    ['list','Konular', "showView('grammar')"],
    ['repeat','Gözden Geçir', "showView('grammar');grShowReview()"],
  ];
  return `
    <div class="oz-track t-gram">
      <div class="oz-track-head">
        <div class="oz-track-icon">${ico('list',19,'#fff',false)}</div>
        <div>
          <div class="oz-track-title wordfont">Gramer</div>
          <div class="oz-track-sub">397 konu, kendi hızında</div>
        </div>
        <div class="oz-track-total"><b>${gr.learnedSubs}</b><span>/ ${gr.totalSubs} alt madde</span></div>
      </div>
      ${dashJarPathHtml(GR_DASH_LEVELS, pctByLevel, lv => `showView('grammar');grShowTopics('${lv}')`)}
      <div class="oz-chip-grid" style="grid-template-columns:repeat(2,1fr);max-width:210px;">${chips.map(([iconName,label,onclick]) =>
        `<div class="oz-qchip" onclick="${onclick}">
          <div class="oz-qchip-ico">${ico(iconName,20,'var(--text)',false)}</div>
          <div class="oz-qchip-lbl">${label}</div>
        </div>`
      ).join('')}</div>
    </div>`;
}

const GR_DASH_LEVELS = ['A1','A2','B1','B2','C1','C2'];
function grOverallStats() {
  let totalSubs = 0, learnedSubs = 0;
  const perLevel = {};
  GR_DASH_LEVELS.forEach(lv => {
    const topics = grTopicsFor(lv);
    const total = topics.reduce((s,t) => s + t.subs.length, 0);
    const learned = topics.reduce((s,t) => s + t.subs.filter(sub => grIsLearned(t.topicId, sub.id)).length, 0);
    perLevel[lv] = { total, learned };
    totalSubs += total;
    learnedSubs += learned;
  });
  return { totalSubs, learnedSubs, perLevel };
}

// ── Birincil eylem ─────────────────────────────────────────────────────────
function dashStartStudy() {
  // Tekrar Et (view 'filter') eski modül — geliştirme yapılmıyor, menüde
  // korunuyor ama ana akış oraya yönlendirilmiyor. Çalışma her durumda
  // Kart Modu'ndan başlar; tekrar bekleyenler zaten oradaki havuza dahil.
  showView('cardmode');
}

// Panom ilerleme bantları — eski 2x2 dash-summary-row'un yerine geçen,
// tıklanabilir tek sütun. Her satır Kelime Durumu'nu doğru sekme+filtreyle
// açar. "Tekrar bekliyor" diğer üçünden farklı bir eksendir (nextReview<=bugün,
// mastery'den bağımsız) — bilinçli olarak Öğreniliyor sekmesi + due-only
// anahtarına yönlendiriyoruz; nadir "mastered ama bugün tekrarı gelen"
// kelimeler bu görünümde görünmez (bkz. proje_talimati.md sınırlama notu).
function dashBandListHtml(due, learningNow, knownNow, mastered) {
  const rows = [
    { key:'due', label:'Tekrar bekliyor', desc:'Tarihi gelmiş kelimeler', n:due, color:'var(--warn)', bg:'var(--warnbg)',
      icon:'<path d="M5 3h10M5 17h10M6 3c0 4 2.5 5 4 7-1.5 2-4 3-4 7M14 3c0 4-2.5 5-4 7 1.5 2 4 3 4 7"/>' },
    { key:'learningNow', label:'Öğreniyorum dedin', desc:'Yeni öğrenilmeye başlanan', n:learningNow, color:'#a05000', bg:'#fdeee0',
      icon:'<path d="M4 4.5c2-1 4.5-1 6 0v11c-1.5-1-4-1-6 0v-11zM16 4.5c-2-1-4.5-1-6 0v11c1.5-1 4-1 6 0v-11z"/>' },
    { key:'knownNow', label:'Biliyorum dedin', desc:'Pekişme sürecinde', n:knownNow, color:'var(--accent)', bg:'var(--accentbg)',
      icon:'<path d="M17 3c-7 0-13 3-13 10 0 2 .5 3 .5 3S6 15 9 13c4-2.5 8-3.5 8-10z"/><path d="M4.5 16 10 10.5"/>' },
    { key:'mastered', label:'Tam öğrenildi', desc:'21+ gün aralık, pekişmiş', n:mastered, color:'var(--success)', bg:'var(--successbg)',
      icon:'<path d="M2 8 10 4l8 4-8 4-8-4z"/><path d="M5.5 9.7V13c0 1 2 2.2 4.5 2.2S14.5 14 14.5 13V9.7"/>' },
  ];
  return rows.map(r => `
    <div class="band-row" onclick="dashBandClick('${r.key}')">
      <div class="band-ico" style="background:${r.bg};color:${r.color};">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${r.icon}</svg>
      </div>
      <div class="band-mid"><div class="band-name">${r.label}</div><div class="band-desc">${r.desc}</div></div>
      <div class="band-n" style="color:${r.color};">${r.n}</div>
      <div class="band-chev">›</div>
    </div>`).join('');
}
function dashBandClick(key) {
  if (key==='mastered')     { stTab='known';    stAnswerFilter='all';      stDueOnly=false; }
  if (key==='knownNow')     { stTab='learning'; stAnswerFilter='known';    stDueOnly=false; }
  if (key==='learningNow')  { stTab='learning'; stAnswerFilter='learning'; stDueOnly=false; }
  if (key==='due')          { stTab='learning'; stAnswerFilter='all';      stDueOnly=true;  }
  showView('status');
}

// ── Ana çizim ──────────────────────────────────────────────────────────────
function updateDashboard() {
  const el = document.getElementById('dash-body');
  if (!el) return;

  const goal = dashGoal();
  const done = dashTodayCount();
  const due = dashDueCount();
  const mastered = Object.values(progress).filter(p => p.mastery === 'mastered').length;
  // Son cevabı "Biliyorum" olan ama henüz tam öğrenilmemişler ile son cevabı
  // "Öğreniyorum" olanları ayrı göster — ikisi de mastery 'reviewing' olduğu
  // için eskiden tek kutuda toplanıyordu.
  const knownNow = Object.values(progress).filter(p => p.mastery !== 'mastered' && p.lastAnswer !== 'learning').length;
  const learningNow = Object.values(progress).filter(p => p.lastAnswer === 'learning').length;
  const anyProgress = Object.keys(progress).length > 0;

  // ── Hiç başlanmamış: istatistik yerine davet ──
  if (!anyProgress) {
    const a1 = WORD_DATA.filter(w => w.cefr === 'A1').length;
    el.innerHTML = `
      ${dashHeaderHtml()}
      <div class="dash-hero" style="padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="width:38px;height:38px;border-radius:11px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ico('notebook',19,'#fff',false)}</div>
          <div style="flex:1;min-width:0;text-align:left;">
            <div style="font-size:15px;font-weight:700;">WordHaven'a hoş geldin</div>
            <div style="font-size:12px;opacity:.85;margin-top:1px;">A1'de <b>${a1}</b> kelime seni bekliyor — günde ${goal} kelime ile başla.</div>
          </div>
        </div>
        <button class="start-btn" id="dash-start-btn" style="margin-top:0;" onclick="showView('cardmode')">İlk kelimelerini çalış →</button>
      </div>
      ${dashWordTrackHtml()}
      ${dashGrammarTrackHtml()}
      <div class="oz-more-link" onclick="toggleMainMenu()">Tüm modüller ›</div>`;
    return;
  }

  // ── Normal durum ──
  const complete = done >= goal;
  const btnLabel = due > 0
    ? `${due} kelime tekrar zamanı · Kart Modu →`
    : (complete ? 'Çalışmaya devam et →' : 'Kart Modu ile çalış →');

  el.innerHTML = `
    ${dashHeaderHtml()}
    <div class="dash-hero">
      <div style="display:flex;align-items:center;gap:16px;">
        ${dashRing(done, goal)}
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">
            ${complete ? 'Bugünü tamamladın 🎉' : 'Bugün'}
          </div>
          <p style="font-size:13px;line-height:1.6;">
            ${dashMessage(done, goal, due, mastered)}
          </p>
          <button class="dash-goal-btn" onclick="dashEditGoal()">Hedef: ${goal} kelime · değiştir</button>
        </div>
      </div>
      <button class="start-btn" id="dash-start-btn" onclick="dashStartStudy()">${btnLabel}</button>
    </div>

    ${dashStreakHtml()}

    <div id="dash-band-list">${dashBandListHtml(due, learningNow, knownNow, mastered)}</div>

    ${dashWordTrackHtml()}
    ${dashGrammarTrackHtml()}
    <div class="oz-more-link" onclick="toggleMainMenu()">Tüm modüller ›</div>`;
}

// Hedefi ekrandan hızlıca değiştir (Ayarlar'daki alanla aynı değeri yazar)
function dashEditGoal() {
  const cur = dashGoal();
  const v = prompt('Günlük hedefin kaç kelime olsun? (1-200)', String(cur));
  if (v === null) return;
  const n = parseInt(v, 10);
  if (!n || n < 1 || n > 200) { alert('1 ile 200 arasında bir sayı gir.'); return; }
  dashSetGoal(n);
  cmSizeTouched = false;
  cmSessionSize = n;
  updateDashboard();
  const inp = document.getElementById('daily-goal-input');
  if (inp) inp.value = n;
}

// Ayarlar ekranındaki alan
function renderDailyGoalSetting() {
  const inp = document.getElementById('daily-goal-input');
  if (inp) inp.value = dashGoal();
}
function saveDailyGoal() {
  const inp = document.getElementById('daily-goal-input');
  const n = parseInt(inp.value, 10);
  if (!n || n < 1 || n > 200) { alert('1 ile 200 arasında bir sayı gir.'); return; }
  dashSetGoal(n);
  cmSizeTouched = false;   // yeni hedef Kart Modu'na da yansısın
  cmSessionSize = n;
  updateDashboard();
  const s = document.getElementById('daily-goal-status');
  if (s) { s.textContent = `✓ Kaydedildi: günde ${n} kelime`; setTimeout(() => s.textContent = '', 2500); }
}


// ═══════════════════════════════════════════════════════════════════════════
// ORTAK LONGMAN / VOA FİLTRESİ  (tüm modüllerde geçerli tek seçim)
// ═══════════════════════════════════════════════════════════════════════════
// Bir kez seçilir, Kart Modu / Kelime Listem / Cümle Kur / Asmaca / Tekrar Et /
// Kelime Durumu ekranlarının hepsinde aynı daraltma uygulanır. Seçim
// localStorage'a yazılır, uygulama yeniden açıldığında korunur.
//
// CEFR seviyesi bilinçli olarak ORTAK DEĞİL: her modülde farklı anlamı var
// (Kelime Listem tek seviye gösterir, Kart Modu/Asmaca çoklu seçer), ortaklaşa
// yönetmek kafa karıştırıcı olurdu. Ortak olan sadece Longman bantları + VOA.

const GB_STORAGE_KEY = 'wordhavenBandFilter';

let gbFilter = { sp: new Set(), wr: new Set(), fr: new Set(), voa: false };

function gbLoad() {
  try {
    const raw = localStorage.getItem(GB_STORAGE_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    gbFilter.sp = new Set(o.sp || []);
    gbFilter.wr = new Set(o.wr || []);
    gbFilter.fr = new Set(o.fr || []);
    gbFilter.voa = !!o.voa;
  } catch (e) { /* bozuk kayıt: varsayılanla devam */ }
}
function gbSave() {
  try {
    localStorage.setItem(GB_STORAGE_KEY, JSON.stringify({
      sp: [...gbFilter.sp], wr: [...gbFilter.wr], fr: [...gbFilter.fr], voa: gbFilter.voa
    }));
  } catch (e) {}
}
gbLoad();

function gbActive() {
  return gbFilter.sp.size > 0 || gbFilter.wr.size > 0 || gbFilter.fr.size > 0 || gbFilter.voa;
}

// Bir kelime NESNESİ ortak filtreden geçiyor mu?
function gbPasses(w) {
  if (!w) return !gbActive();
  return bandMatches(w.speaking, gbFilter.sp, SP_OPTS.length)
      && bandMatches(w.writing,  gbFilter.wr, WR_OPTS.length)
      && bandMatches(w.freq,     gbFilter.fr, FREQ_OPTS_LIST.length)
      && (!gbFilter.voa || !!w.voa);
}

// ── Kelime → bant çözümleyici (kök duyarlı) ────────────────────────────────
// Cümle Kur egzersizlerinde hedef kelime çekimli hâlde tutuluyor ("works",
// "walking", "finished"). Sözlükte kök hâli ("work", "walk", "finish") var.
// Bu yüzden doğrudan eşleşme başarısız olursa kök adaylarını sırayla deneriz.
const GB_IRREGULAR = {
  left: 'leave', went: 'go', gone: 'go', done: 'do', made: 'make', said: 'say',
  took: 'take', taken: 'take', came: 'come', saw: 'see', seen: 'see',
  got: 'get', gotten: 'get', gave: 'give', given: 'give', found: 'find',
  thought: 'think', told: 'tell', became: 'become', knew: 'know', known: 'know',
  felt: 'feel', brought: 'bring', began: 'begin', begun: 'begin', kept: 'keep',
  held: 'hold', wrote: 'write', written: 'write', stood: 'stand', heard: 'hear',
  let: 'let', meant: 'mean', met: 'meet', ran: 'run', paid: 'pay', sat: 'sit',
  spoke: 'speak', spoken: 'speak', lay: 'lie', led: 'lead', grew: 'grow',
  grown: 'grow', lost: 'lose', fell: 'fall', fallen: 'fall', sent: 'send',
  built: 'build', understood: 'understand', drew: 'draw', drawn: 'draw',
  broke: 'break', broken: 'break', spent: 'spend', chose: 'choose',
  chosen: 'choose', drove: 'drive', driven: 'drive', bought: 'buy',
  wore: 'wear', worn: 'wear', ate: 'eat', eaten: 'eat', threw: 'throw',
  thrown: 'throw', caught: 'catch', taught: 'teach', slept: 'sleep',
  sold: 'sell', won: 'win', flew: 'fly', flown: 'fly', drank: 'drink',
  drunk: 'drink', sang: 'sing', sung: 'sing', swam: 'swim', rose: 'rise',
  risen: 'rise', read: 'read', put: 'put', cut: 'cut', set: 'set',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  people: 'person', better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  had: 'have', has: 'have', did: 'do', does: 'do'
};

function gbLemmaCandidates(word) {
  const w = String(word || '').toLowerCase().trim();
  const out = [w];
  if (GB_IRREGULAR[w]) out.push(GB_IRREGULAR[w]);
  const push = s => { if (s && s.length >= 2 && !out.includes(s)) out.push(s); };

  if (w.endsWith('ies') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')  && w.length > 3) push(w.slice(0, -2));
  if (w.endsWith('s')   && !w.endsWith('ss') && w.length > 2) push(w.slice(0, -1));
  if (w.endsWith('ied') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')  && w.length > 3) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
  if (w.endsWith('ing') && w.length > 4) {
    push(w.slice(0, -3));
    push(w.slice(0, -3) + 'e');                       // making → make
    const s = w.slice(0, -3);
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) push(s.slice(0, -1)); // running → run
  }
  if (w.endsWith('ier') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('er')  && w.length > 3) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
  if (w.endsWith('est') && w.length > 4) { push(w.slice(0, -3)); push(w.slice(0, -2)); }
  return out;
}

let _gbBandIndex = null;
function gbBandIndex() {
  if (_gbBandIndex) return _gbBandIndex;
  _gbBandIndex = Object.create(null);
  const add = w => {
    if (!w || !w.word) return;
    const k = String(w.word).toLowerCase();
    const cur = _gbBandIndex[k];
    const rec = {
      speaking: w.speaking || '', writing: w.writing || '',
      freq: w.freq || '', voa: !!w.voa
    };
    if (!cur) { _gbBandIndex[k] = rec; return; }
    // Aynı kelimenin birden fazla kaydı varsa en zengin bilgiyi birleştir
    cur.speaking = cur.speaking || rec.speaking;
    cur.writing  = cur.writing  || rec.writing;
    cur.freq     = cur.freq     || rec.freq;
    cur.voa      = cur.voa      || rec.voa;
  };
  WORD_DATA.forEach(add);
  TOPIC_WORDS.forEach(add);
  EXTRA_WORDS.forEach(add);
  return _gbBandIndex;
}

// Çekimli hâli de çözerek kelimenin bantlarını bulur.
// İLK eşleşmede DURMAZ: "running" / "writing" / "making" gibi kelimeler
// sözlükte isim olarak da kayıtlı (koşu, yazı) ve o kayıtların bantları
// eksik olabiliyor. Bu yüzden adayları sırayla gezip BOŞ alanları kökün
// değerleriyle tamamlıyoruz — bilgi kaybetmeden zenginleştirme.
function gbBandsFor(word) {
  const idx = gbBandIndex();
  let out = null;
  for (const cand of gbLemmaCandidates(word)) {
    const hit = idx[cand];
    if (!hit) continue;
    if (!out) { out = { speaking: hit.speaking, writing: hit.writing, freq: hit.freq, voa: hit.voa }; }
    else {
      out.speaking = out.speaking || hit.speaking;
      out.writing  = out.writing  || hit.writing;
      out.freq     = out.freq     || hit.freq;
      out.voa      = out.voa      || hit.voa;
    }
    if (out.speaking && out.writing && out.freq && out.voa) break;
  }
  return out;
}

// Kelime ADIYLA filtre kontrolü (Cümle Kur gibi kelime nesnesi olmayan yerler).
function gbPassesWord(word, fallbackObj) {
  const bands = gbBandsFor(word);
  if (bands) return gbPasses(bands);
  // Sözlükte hiç bulunamadıysa: nesnede varsa onun alanlarına bak, yoksa
  // "etiketsiz" say — daraltma aktifken elenir, değilken geçer.
  return gbPasses(fallbackObj || {});
}

// ── Ortak filtre arayüzü ───────────────────────────────────────────────────
// Her modül kendi havuzunu verir; sayaçlar o havuza göre hesaplanır ve
// "bu chip'e tıklarsan kaç kelime kalır" anlamına gelir.
function gbCountWith(pool, sp, wr, fr, voa) {
  return pool.filter(w =>
    bandMatches(w.speaking, sp, SP_OPTS.length)
    && bandMatches(w.writing, wr, WR_OPTS.length)
    && bandMatches(w.freq, fr, FREQ_OPTS_LIST.length)
    && (!voa || !!w.voa)
  ).length;
}

function gbChipCounts(pool, dim, v) {
  const cur = gbFilter[dim];
  const selected = cur.has(v);
  const mk = s => dim === 'sp' ? gbCountWith(pool, s, gbFilter.wr, gbFilter.fr, gbFilter.voa)
              : dim === 'wr' ? gbCountWith(pool, gbFilter.sp, s, gbFilter.fr, gbFilter.voa)
                             : gbCountWith(pool, gbFilter.sp, gbFilter.wr, s, gbFilter.voa);
  const added = new Set(cur); added.add(v);
  const own = mk(new Set([v]));
  return { selected, own, display: selected ? own : (own === 0 ? 0 : mk(added)) };
}

// containerId : filtrenin çizileceği div
// poolFn      : o modülün ham (filtresiz) kelime havuzunu döndüren fonksiyon
// onChange    : seçim değişince çağrılacak yenileme fonksiyonu
const GB_MOUNTS = [];   // {containerId, poolFn, onChange}

function gbMount(containerId, poolFn, onChange) {
  if (!GB_MOUNTS.some(m => m.containerId === containerId)) {
    GB_MOUNTS.push({ containerId, poolFn, onChange });
  }
  gbRender(containerId);
}

function gbRender(containerId) {
  const m = GB_MOUNTS.find(x => x.containerId === containerId);
  if (!m) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  let pool = [];
  try { pool = m.poolFn() || []; } catch (e) { pool = []; }

  const chip = (label, on, handler, disabled, extraClass) =>
    `<button class="chip${extraClass ? ' ' + extraClass : ''}${on ? ' on' : ''}${disabled ? ' disabled' : ''}" ${disabled ? 'disabled' : ''} onclick="${handler}">${label}</button>`;

  // Erdem: S1-S3/W1-W3/frekans/VOA chip'leri de CEFR seviyeleri gibi
  // renklendirilsin dedi — mevcut rozet (badge, b-s1/b-w1/b-high vb.)
  // renkleriyle tutarlı olsun diye AYNI paleti chip sınıfı olarak kullanıyoruz.
  const BAND_CLASS = { S1:'band-s1', S2:'band-s2', S3:'band-s3', W1:'band-w1', W2:'band-w2', W3:'band-w3',
                        High:'band-high', Medium:'band-medium', Low:'band-low' };
  const row = (opts, dim) => opts.map(([v, l]) => {
    const c = gbChipCounts(pool, dim, v);
    return chip(`${l}<span class="n">(${c.display})</span>`, c.selected,
                `gbToggle('${dim}','${v}')`, c.own === 0 && !c.selected, BAND_CLASS[l]);
  }).join('');

  const voaOwn = gbCountWith(pool, gbFilter.sp, gbFilter.wr, gbFilter.fr, true);
  const total = gbCountWith(pool, gbFilter.sp, gbFilter.wr, gbFilter.fr, gbFilter.voa);
  const on = gbActive();

  el.innerHTML = `
    <details class="gb-details"${on ? ' open' : ''}>
      <summary class="disclosure-summary">
        <span>Longman / VOA filtresi${on ? ` <span style="color:var(--warn);font-weight:700;">• açık</span>` : ''}</span>
        <span class="dchev"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 5l5 5-5 5"/></svg></span>
      </summary>
      <div style="margin-top:10px;">
        <div style="font-size:11px;color:var(--text3);line-height:1.6;margin-bottom:10px;">
          Bu seçim tüm modüllerde geçerlidir.
        </div>
        <div class="band-label">Konuşma sıklığı</div>
        <div class="f-row3">${row(SP_OPTS, 'sp')}</div>
        <div class="band-label">Yazı sıklığı</div>
        <div class="f-row3">${row(WR_OPTS, 'wr')}</div>
        <div class="band-label">Genel frekans</div>
        <div class="f-row3">${row(FREQ_OPTS_LIST, 'fr')}</div>
        <div class="band-label">Özel liste</div>
        <div class="f-row">
          ${chip(`VOA çekirdeği<span class="n">(${voaOwn})</span>`, gbFilter.voa, 'gbToggleVoa()', voaOwn === 0 && !gbFilter.voa, 'band-voa')}
          ${on ? `<button class="chip-all" onclick="gbClear()">Filtreleri temizle</button>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px;">${total} kelime bu filtreden geçiyor</div>
      </div>
    </details>`;
}

function gbRenderAll() {
  GB_MOUNTS.forEach(m => gbRender(m.containerId));
}

// Seçim değişti → kaydet, tüm bağlı ekranları ve aktif modülü yenile
function gbApplyChange() {
  gbSave();
  gbRenderAll();
  GB_MOUNTS.forEach(m => { try { m.onChange && m.onChange(); } catch (e) { console.error('gb onChange', e); } });
}

function gbToggle(dim, v) {
  const s = gbFilter[dim];
  if (s.has(v)) s.delete(v); else s.add(v);
  gbApplyChange();
}
function gbToggleVoa() {
  gbFilter.voa = !gbFilter.voa;
  gbApplyChange();
}
function gbClear() {
  gbFilter.sp.clear(); gbFilter.wr.clear(); gbFilter.fr.clear(); gbFilter.voa = false;
  gbApplyChange();
}


// ═══════════════════════════════════════════════════════════════════════════
// EK KELİME HAVUZU + LONGMAN BANT FİLTRELERİ + VOA ROZETİ
// ═══════════════════════════════════════════════════════════════════════════
// EXTRA_WORDS = Longman 3000/9000 ve VOA'da olup Oxford 3000/5000 ile Konu
// Kelimeleri'nde bulunmayan kelimeler (1.130 benzersiz kelime). CEFR bilgisi
// yok — bu yüzden seviyeye göre değil, Longman frekans bandına göre gruplanır.
const EXTRA_WORDS = (typeof window !== 'undefined' && window.EXTRA_WORDS) ? window.EXTRA_WORDS : [];

// Bant filtresi: freqMatches ile aynı mantık — daraltma yoksa etiketsiz
// kelimeler de geçer, daraltma varsa sadece seçilenler eşleşir.
function bandMatches(value, selectedSet, allCount) {
  const noNarrowing = selectedSet.size === 0 || selectedSet.size === allCount;
  if (noNarrowing) return true;
  return selectedSet.has(value || '');
}

const SP_OPTS = [['S1', 'S1'], ['S2', 'S2'], ['S3', 'S3']];
const WR_OPTS = [['W1', 'W1'], ['W2', 'W2'], ['W3', 'W3']];
const FREQ_OPTS_LIST = [['High Frequency', 'High'], ['Medium Frequency', 'Medium'], ['Low Frequency', 'Low']];

function voaBadgeHtml(w) {
  return w && w.voa ? '<span class="badge b-voa" title="VOA Special English çekirdek listesi">VOA</span>' : '';
}

// Longman konuşma/yazı sıklığı rozetleri — VOA rozetiyle aynı küçük "badge"
// dilinde, kelime satırlarının ikinci satırında VOA ile yan yana gösterilir.
function lfBadgesHtml(w) {
  let h = '';
  if (w && w.speaking) h += `<span class="badge b-${w.speaking.toLowerCase()}" title="Konuşma sıklığı ${w.speaking}">${w.speaking}</span>`;
  if (w && w.writing)  h += `<span class="badge b-${w.writing.toLowerCase()}" title="Yazı sıklığı ${w.writing}">${w.writing}</span>`;
  return h;
}
// Longman genel frekans rozeti (High/Medium/Low) — S/W'den ayrı bir sinyal:
// konuşma/yazı bandı değil, kelimenin Longman derlemindeki genel sıklığı.
const FREQ_BADGE_MAP = { 'High Frequency': ['High','b-high'], 'Medium Frequency': ['Medium','b-medium'], 'Low Frequency': ['Low','b-low'] };
function freqBadgeHtml(w) {
  const m = w && w.freq && FREQ_BADGE_MAP[w.freq];
  return m ? `<span class="badge ${m[1]}" title="Genel frekans: ${m[0]}">${m[0]}</span>` : '';
}
// Kelime satırının alt kısmı: iki ayrı satır. Üstteki bilgi rozetleri
// (Longman S/W + genel frekans + VOA — dokunulamaz), alttaki dokunulabilir
// eylemler (hoparlör/favori/temas noktaları). İkisini karıştırmamak hem
// görsel netlik hem de "buraya dokununca bir şey mi olacak?" belirsizliğini
// önlemek için. Kelime uzunluğundan ve rozet sayısından bağımsız, tüm
// Kelime Listem alt sekmelerinde aynı hizada başlar.
function wordRowLine2Html(w) {
  const badges = `${lfBadgesHtml(w)}${freqBadgeHtml(w)}${voaBadgeHtml(w)}`;
  const badgesRow = badges ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;">${badges}</div>` : '';
  return `${badgesRow}<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">${ttsButtonHtml(w.word, w.word)}${favStarHtml(w)}${contactDotsHtml(w)}</div>`;
}

// ── Kelime Listem → Oxford paneli bant filtreleri ──────────────────────────
let listSpFilter = new Set();
let listWrFilter = new Set();
let listFreqFilter = new Set();
let listVoaOnly = false;

function listWordPasses(w) { return gbPasses(w); }

function renderListBandFilters() {
  gbMount('list-band-filters',
          () => WORD_DATA.filter(w => w.cefr === listLevel),
          () => { listOpenKey = null; renderListCefrRow(); renderWordList(listLevel); });
}
function listRefreshAll() { renderListCefrRow(); renderListBandFilters(); renderWordList(listLevel); }

// ── EK HAVUZ sekmesi ───────────────────────────────────────────────────────
let extraFreqFilter = new Set();
let extraVoaOnly = false;
let extraOpenKey = null;
let extraLetter = null;

function extraWordPasses(w) {
  return bandMatches(w.freq, extraFreqFilter, FREQ_OPTS_LIST.length)
      && (!extraVoaOnly || !!w.voa);
}

function renderExtraFilters() {
  const el = document.getElementById('extra-filter-row');
  if (!el) return;
  const chip = (label, on, handler, disabled) =>
    `<button class="chip${on ? ' on' : ''}${disabled ? ' disabled' : ''}" ${disabled ? 'disabled' : ''} onclick="${handler}">${label}</button>`;
  const frHtml = FREQ_OPTS_LIST.map(([v, l]) => {
    const n = EXTRA_WORDS.filter(w => w.freq === v).length;
    return chip(`${l} <span style="color:var(--text3);">(${n})</span>`, extraFreqFilter.has(v), `extraToggleFreq('${v}')`, n === 0);
  }).join('');
  const voaN = EXTRA_WORDS.filter(w => w.voa).length;
  const anyOn = extraFreqFilter.size || extraVoaOnly;
  el.innerHTML = `${frHtml}${chip(`VOA <span style="color:var(--text3);">(${voaN})</span>`, extraVoaOnly, 'extraToggleVoa()', voaN === 0)}${anyOn ? `<button class="chip-all" onclick="extraClearFilters()">Temizle</button>` : ''}`;
}

function extraToggleFreq(v) {
  if (extraFreqFilter.has(v)) extraFreqFilter.delete(v); else extraFreqFilter.add(v);
  extraOpenKey = null; renderExtraFilters(); renderExtraLetterRow(); renderExtraGrid();
}
function extraToggleVoa() {
  extraVoaOnly = !extraVoaOnly;
  extraOpenKey = null; renderExtraFilters(); renderExtraLetterRow(); renderExtraGrid();
}
function extraClearFilters() {
  extraFreqFilter.clear(); extraVoaOnly = false;
  extraOpenKey = null; renderExtraFilters(); renderExtraLetterRow(); renderExtraGrid();
}

function renderExtraLetterRow() {
  const el = document.getElementById('extra-letter-row');
  if (!el) return;
  const pool = EXTRA_WORDS.filter(extraWordPasses);
  const letters = [...new Set(pool.map(w => (w.word[0] || '#').toUpperCase()))].sort();
  el.innerHTML = letters.map(l =>
    `<button class="chip${l === extraLetter ? ' on' : ''}" onclick="extraSelectLetter('${l}')">${l} <span style="color:var(--text3);">(${pool.filter(w => (w.word[0] || '#').toUpperCase() === l).length})</span></button>`
  ).join('') + (extraLetter ? `<button class="chip-all" onclick="extraSelectLetter(null)">Tümü</button>` : '');
}
function extraSelectLetter(l) {
  extraLetter = (extraLetter === l) ? null : l;
  extraOpenKey = null; renderExtraLetterRow(); renderExtraGrid();
}

function renderExtraGrid() {
  const grid = document.getElementById('extra-word-grid');
  if (!grid) return;
  let pool = EXTRA_WORDS.filter(extraWordPasses);
  if (extraLetter) pool = pool.filter(w => (w.word[0] || '#').toUpperCase() === extraLetter);
  const info = document.getElementById('extra-count-info');
  if (info) info.textContent = `${pool.length} kelime` + (extraLetter ? ` (${extraLetter})` : '');
  if (!pool.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;font-size:13px;color:var(--text3);padding:12px 4px;">Bu filtreyle kelime yok.</p>`;
    return;
  }
  const shown = pool.slice(0, 400);
  grid.innerHTML = shown.map(w => {
    const k = wkey(w);
    const open = (k === extraOpenKey);
    let html = `<div class="list-word-item" onclick="toggleExtraWord('${k.replace(/'/g, "\\'")}')">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span> <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos || ''}</span></div>${wordRowLine2Html(w)}</div>
      <span style="color:var(--text3);font-size:11px;margin-top:2px;">${open ? '▾' : '▸'}</span>
    </div>`;
    if (open) {
      html += `<div style="grid-column:1/-1;border-bottom:0.5px solid var(--border);background:var(--surface);padding:14px;" id="extra-def-${btoa(unescape(encodeURIComponent(k))).replace(/[^a-zA-Z0-9]/g, '')}">${extraDefPlaceholder(w)}</div>`;
    }
    return html;
  }).join('');
  if (pool.length > shown.length) {
    grid.innerHTML += `<p style="grid-column:1/-1;font-size:12px;color:var(--text3);padding:10px 4px;">İlk ${shown.length} kelime gösteriliyor — daraltmak için harf veya frekans filtresi kullan.</p>`;
  }
  ttsWireButtons(grid);
}

function extraDefPlaceholder(w) {
  const k = wkey(w);
  const c = BUILTIN_CONTENT[k];
  if (c && c.definition) return renderListDefHTML(c, w);
  const voaDef = w.voaDefinition
    ? `<p style="font-size:13px;color:var(--text2);margin-bottom:10px;"><b>VOA tanımı:</b> ${escHtml(w.voaDefinition)}</p>`
    : '';
  return `${wordSourceInfoHtml(w)}${voaDef}<p style="font-size:13px;color:var(--text3);margin-bottom:10px;">Bu kelimenin Türkçe içeriği henüz üretilmedi.</p>
    ${dictButtonsHtml(w.word)}`;
}

function toggleExtraWord(k) {
  extraOpenKey = (extraOpenKey === k) ? null : k;
  if (extraOpenKey) markLookup(k.split('|')[0]);
  renderExtraGrid();
}

// ═══════════════════════════════════════════════════════════════════════════
// CÜMLE YAZ — serbest yazma modülü
// ═══════════════════════════════════════════════════════════════════════════
// Kullanıcı bir zaman (tense) seçer, uygulama bir hedef kelime + Türkçe cümle
// verir, kullanıcı İngilizce karşılığını YAZAR. Kontrol iki katmanlı:
//   1) Offline kontrol (her zaman çalışır): hedef kelime kullanılmış mı,
//      zamana ait yardımcı fiil/ek yapısı var mı, uzunluk makul mü.
//   2) Claude kontrolü (API anahtarı girildiyse): gramer, doğallık, anlam.
// Anahtar yoksa modül KİLİTLENMEZ — offline kontrolle çalışmaya devam eder.

const WR_TENSES = [
  'Present Simple', 'Present Continuous', 'Present Perfect', 'Present Perfect Continuous',
  'Past Simple', 'Past Continuous', 'Past Perfect', 'Past Perfect Continuous',
  'Future Simple', 'Future Continuous', 'Future Perfect', 'Future Perfect Continuous'
];

// Her zaman için offline sinyal: cümlede beklenen yardımcı/işaret kalıpları.
const WR_TENSE_SIGNALS = {
  // req: hepsi bulunmalı | ban: hiçbiri bulunmamalı
  // Present/Past Simple'da olumlu cümlenin yardımcı fiili yoktur; bu yüzden
  // "olması gereken"i değil, "olmaması gereken" (çakışan zaman) işaretlerini
  // arıyoruz. Bu, yanlış alarmı ciddi biçimde azaltır.
  'Present Simple': {
    req: [], ban: [/\b(will|shall|won't)\b/i, /\b(was|were)\b/i, /\bhad\b/i,
                   /\b(have|has)\s+been\b/i, /\b(am|is|are)\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i, /\bdid\b/i],
    verbHint: 'yalın fiil (3. tekilde -s/-es)'
  },
  'Present Continuous': {
    req: [/\b(am|is|are)\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i],
    ban: [/\b(will|shall)\b/i, /\bhad\b/i, /\b(was|were)\b/i],
    verbHint: 'am/is/are + fiil-ing'
  },
  'Present Perfect': {
    req: [/\b(have|has)\b/i],
    ban: [/\b(have|has)\s+been\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i, /\b(will|shall)\b/i, /\bhad\b/i],
    verbHint: 'have/has + V3'
  },
  'Present Perfect Continuous': {
    req: [/\b(have|has)\s+been\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i], ban: [/\bhad\b/i, /\b(will|shall)\b/i],
    verbHint: 'have/has been + fiil-ing'
  },
  'Past Simple': {
    req: [], ban: [/\b(will|shall|won't)\b/i, /\b(have|has)\b/i, /\bhad\b/i,
                   /\b(am|is|are)\b/i, /\b(was|were)\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i],
    verbHint: 'fiilin 2. hâli (V2) / did'
  },
  'Past Continuous': {
    req: [/\b(was|were)\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i], ban: [/\b(will|shall)\b/i, /\bhad\b/i],
    verbHint: 'was/were + fiil-ing'
  },
  'Past Perfect': {
    req: [/\bhad\b/i], ban: [/\bhad\s+been\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i, /\b(will|shall)\b/i],
    verbHint: 'had + V3'
  },
  'Past Perfect Continuous': {
    req: [/\bhad\s+been\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i], ban: [/\b(will|shall)\b/i],
    verbHint: 'had been + fiil-ing'
  },
  'Future Simple': {
    req: [/\b(will|shall|won't)\b/i],
    ban: [/\bwill\s+be\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i, /\bwill\s+have\b/i],
    verbHint: 'will + yalın fiil'
  },
  'Future Continuous': {
    req: [/\bwill\s+be\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i], ban: [/\bwill\s+have\b/i],
    verbHint: 'will be + fiil-ing'
  },
  'Future Perfect': {
    req: [/\bwill\s+have\b/i], ban: [/\bwill\s+have\s+been\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i],
    verbHint: 'will have + V3'
  },
  'Future Perfect Continuous': {
    req: [/\bwill\s+have\s+been\s+(?:(?:not|never|always|still|currently|just|also|now|really|already|only|even)\s+)?\w+ing\b/i], ban: [],
    verbHint: 'will have been + fiil-ing'
  }
};

let wrTense = null;
let wrHintLevel = 0;   // 0 = ipucu yok, 1 = yapı+iskelet, 2 = kelime başlangıçları, 3 = tam cevap
let wrCurrent = null;      // {word, pos, cefr, turkish, tense, source}
let wrChecking = false;
let wrLastResult = null;
let wrSessionStats = { total: 0, good: 0 };

const WR_KEY_STORAGE = 'userClaudeKey';
function wrGetApiKey() {
  try { return (localStorage.getItem(WR_KEY_STORAGE) || '').trim(); } catch (e) { return ''; }
}

function wrInit() {
  gbMount('wr-band-filters',
          () => SG_EXERCISES.map(sgExerciseBands),
          () => { wrRenderTenses(); wrRenderStatus(); });
  wrRenderTenses();
  wrRenderStatus();
  if (!wrCurrent) {
    document.getElementById('wr-content').innerHTML =
      `<p style="font-size:13px;color:var(--text2);padding:14px 4px;">Yukarıdan bir zaman seç, sana bir kelime ve Türkçe cümle vereyim.</p>`;
  }
}

function wrRenderTenses() {
  const el = document.getElementById('wr-tense-row');
  if (!el) return;
  el.innerHTML = WR_TENSES.map(t => {
    const n = wrPoolFor(t).length;
    return `<button class="tense-chip${t === wrTense ? ' active' : ''}${n === 0 ? ' disabled' : ''}" ${n === 0 ? 'disabled' : ''} onclick="wrSelectTense('${t}')">${t}</button>`;
  }).join('');
}

// Havuz: önce üretilmiş egzersizler (Türkçe cümle hazır), yoksa kelime havuzu.
function wrPoolFor(tense) {
  if (typeof SG_EXERCISES !== 'undefined' && SG_EXERCISES.length) {
    const hit = SG_EXERCISES.filter(e => e.tense === tense && sgPassesBands(e));
    if (hit.length) return hit;
  }
  return [];
}

function wrRenderStatus() {
  const el = document.getElementById('wr-status-bar');
  if (!el) return;
  const key = wrGetApiKey();
  const mode = key
    ? '<span style="color:var(--success);">✓ Claude kontrolü açık</span>'
    : '<span style="color:var(--text3);">Basit kontrol modu — Ayarlar\'dan Claude anahtarı ekleyerek tam gramer kontrolü açabilirsin</span>';
  const stats = wrSessionStats.total
    ? ` &nbsp;·&nbsp; Bu oturum: ${wrSessionStats.good}/${wrSessionStats.total}`
    : '';
  el.innerHTML = mode + stats;
}

function wrSelectTense(t) {
  wrTense = t;
  wrRenderTenses();
  wrNextQuestion();
}

function wrNextQuestion() {
  const pool = wrPoolFor(wrTense);
  if (!pool.length) {
    document.getElementById('wr-content').innerHTML =
      `<p style="font-size:13px;color:var(--text2);padding:14px 4px;">Bu zaman için henüz içerik üretilmemiş.</p>`;
    return;
  }
  const e = pool[Math.floor(Math.random() * pool.length)];
  wrCurrent = {
    word: e.targetWord,
    turkish: e.turkish,
    tense: e.tense,
    cefr: e.cefr || '',
    reference: wrBuildReference(e)
  };
  wrLastResult = null;
  wrHintLevel = 0;
  wrRenderQuestion();
}

// Referans cümleyi kur: root token'larına chunk'ları pos sırasına göre yerleştir.
// (Cümle Kur'daki sgHandleGapTap ile aynı mantık — chunk.pos nihai cümledeki
// ekleme noktası, artan sırada eklenince cümle doğru oluşur.)
function wrBuildReference(e) {
  const tokens = (e.root || []).slice();
  const chunks = (e.chunks || []).slice().sort((a, b) => a.pos - b.pos);
  chunks.forEach(c => {
    const words = String(c.text || '').split(' ').filter(Boolean);
    const at = Math.min(Math.max(c.pos, 0), tokens.length);
    tokens.splice(at, 0, ...words);
  });
  let s = tokens.join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s && !/[.!?]$/.test(s)) s += '.';
  return s;
}

function wrRenderQuestion() {
  const el = document.getElementById('wr-content');
  if (!el || !wrCurrent) return;
  const sig = WR_TENSE_SIGNALS[wrCurrent.tense];
  el.innerHTML = `
    <div class="sg-card" style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">${wrCurrent.tense}</span>
        ${wrCurrent.cefr ? `<span class="badge b-${wrCurrent.cefr.toLowerCase()}">${wrCurrent.cefr}</span>` : ''}
        <span style="font-size:11px;color:var(--text3);margin-left:auto;">${sig ? sig.verbHint : ''}</span>
      </div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:4px;">Bu cümleyi İngilizce yaz:</div>
      <div style="font-size:17px;font-weight:600;color:var(--accent);margin-bottom:12px;line-height:1.5;">${escHtml(wrCurrent.turkish)}</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px;">Şu kelimeyi mutlaka kullan: <b class="wordfont" style="font-size:15px;color:var(--text);">${escHtml(wrCurrent.word)}</b>${ttsButtonHtml(wrCurrent.word, wrCurrent.word)}</div>
      <textarea id="wr-answer" rows="3" placeholder="İngilizce cümleni buraya yaz…" style="width:100%;padding:12px;font-size:15px;border:0.5px solid var(--border2);border-radius:var(--rsm);background:var(--surface);color:var(--text);box-sizing:border-box;font-family:inherit;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="start-btn" style="flex:1;min-width:130px;margin-top:0;" onclick="wrCheckAnswer()">${ico('check',14,'var(--bg)',true)}Kontrol et</button>
        <button class="chip" onclick="wrShowHint()">${ico('question',12,null,true)}${wrHintLevel === 0 ? 'İpucu' : wrHintLevel === 1 ? 'Daha fazla ipucu' : 'Cevabı göster'}</button>
        <button class="chip" onclick="wrNextQuestion()">${ico('shuffle',12,null,true)}Başka cümle</button>
      </div>
      <div id="wr-hint" style="margin-top:10px;"></div>
    </div>
    <div id="wr-result"></div>`;
  ttsWireButtons(el);
  const ta = document.getElementById('wr-answer');
  if (ta) ta.focus();
}

// Kademeli ipucu: takılan kullanıcıyı boş ekranda bırakmamak için üç adım.
// 1) yapı + harf iskeleti  2) her kelimenin ilk harfleri  3) tam cevap
function wrShowHint() {
  if (!wrCurrent) return;
  wrHintLevel = Math.min(wrHintLevel + 1, 3);
  wrRenderHint();
  // buton etiketi değişsin diye soru gövdesini değil sadece butonu tazele
  const btns = document.querySelectorAll('#wr-content .chip');
  if (btns[0]) btns[0].textContent = wrHintLevel === 1 ? 'Daha fazla ipucu' : wrHintLevel === 2 ? 'Cevabı göster' : 'Cevap gösterildi';
  if (wrHintLevel >= 3 && btns[0]) btns[0].disabled = true;
}

function wrRenderHint() {
  const el = document.getElementById('wr-hint');
  if (!el || !wrCurrent) return;
  const sig = WR_TENSE_SIGNALS[wrCurrent.tense];
  const words = (wrCurrent.reference || '').split(/\s+/).filter(Boolean);
  const box = inner => `<div style="font-size:13px;color:var(--text2);background:var(--surface2);padding:10px 12px;border-radius:var(--rsm);line-height:1.8;">${inner}</div>`;

  if (wrHintLevel === 1) {
    const skeleton = words.map(w => w.length <= 2 ? w : w[0] + '·'.repeat(Math.min(w.length - 1, 6))).join(' ');
    el.innerHTML = box(`<b>Yapı:</b> ${sig ? escHtml(sig.verbHint) : '—'}<br>
      <b>İskelet:</b> <span style="font-family:ui-monospace,monospace;letter-spacing:.5px;">${escHtml(skeleton)}</span>
      <div style="font-size:11.5px;color:var(--text3);margin-top:6px;">Takıldıysan tekrar dokun, daha fazla ipucu vereyim.</div>`);
  } else if (wrHintLevel === 2) {
    // Kısa/yapısal kelimeleri açık göster, anlam kelimelerini ilk harfle bırak
    const partial = words.map(w => {
      const clean = w.replace(/[^A-Za-z']/g, '').toLowerCase();
      if (clean.length <= 3 || WR_STOPWORDS.has(clean)) return w;
      return w.slice(0, 2) + '·'.repeat(Math.min(w.length - 2, 6));
    }).join(' ');
    el.innerHTML = box(`<b>Yapı:</b> ${sig ? escHtml(sig.verbHint) : '—'}<br>
      <b>Neredeyse tamam:</b> <span style="font-family:ui-monospace,monospace;letter-spacing:.5px;">${escHtml(partial)}</span>
      <div style="font-size:11.5px;color:var(--text3);margin-top:6px;">Hâlâ çıkmıyorsa tekrar dokun, cevabı göstereyim.</div>`);
  } else {
    el.innerHTML = box(`<b>Örnek çözüm:</b><br>
      <span style="font-size:15px;font-weight:600;color:var(--text);">${escHtml(wrCurrent.reference)}</span>${ttsButtonHtml(wrCurrent.reference)}
      <div style="font-size:11.5px;color:var(--text3);margin-top:8px;">Cevabı gördüğün için bu cümle "Zorlandım" olarak işaretlenecek. Kopyalamak yerine kapatıp kendin yazmayı dene.</div>
      <div style="margin-top:8px;"><button class="chip" onclick="wrRateWord('unknown')">Anladım, sıradaki →</button></div>`);
    const el2 = document.getElementById('wr-hint');
    if (el2) ttsWireButtons(el2);
  }
}

// ── Offline (anahtarsız) kontrol ───────────────────────────────────────────
// Referans cümledeki anlam taşıyan kelimelerin ne kadarı cevapta var?
// "This is an ___ game for children." gibi eksik cevapları yakalar — hedef
// kelime ve zaman kalıbı doğru olsa bile cümle tamamlanmamışsa uyarır.
const WR_STOPWORDS = new Set(['a','an','the','is','are','am','was','were','be','been','being',
  'do','does','did','have','has','had','will','shall','would','could','should','can','may',
  'to','of','in','on','at','for','with','by','from','as','and','or','but','not','this','that',
  'these','those','it','its','he','she','they','we','you','i','his','her','their','our','your',
  'my','me','him','them','us','there','very','so','too','also','just']);

function wrContentWords(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s']/g, ' ')
    .split(/\s+/).filter(x => x.length > 2 && !WR_STOPWORDS.has(x));
}

function wrCoverage(answer, reference) {
  const ref = wrContentWords(reference);
  if (!ref.length) return null;
  const ansTxt = String(answer).toLowerCase();
  let hit = 0;
  ref.forEach(r => {
    const stem = r.length > 5 ? r.slice(0, r.length - 2) : r;
    if (ansTxt.includes(stem)) hit++;
  });
  return { hit, total: ref.length, ratio: hit / ref.length,
           missing: ref.filter(r => !ansTxt.includes(r.length > 5 ? r.slice(0, r.length - 2) : r)) };
}

function wrOfflineCheck(answer) {
  const a = answer.trim();
  const issues = [];   // anlamı bozan / cümleyi yanlış yapan sorunlar
  const minor  = [];   // yazım-noktalama gibi küçük düzeltmeler
  const good = [];

  if (a.split(/\s+/).filter(Boolean).length < 3) {
    issues.push('Cümle çok kısa görünüyor — en az bir özne ve yüklem olmalı.');
  }

  // Hedef kelime kullanılmış mı? (basit kök eşleşmesi: kelimenin ilk 4 harfi)
  const target = (wrCurrent.word || '').toLowerCase();
  const stem = target.length > 4 ? target.slice(0, Math.max(4, target.length - 2)) : target;
  if (stem && a.toLowerCase().includes(stem)) {
    good.push(`Hedef kelime "${wrCurrent.word}" kullanılmış.`);
  } else {
    issues.push(`Hedef kelime "${wrCurrent.word}" cümlede görünmüyor.`);
  }

  // Zaman yapısı sinyali
  const sig = WR_TENSE_SIGNALS[wrCurrent.tense];
  if (sig) {
    const missing = (sig.req || []).some(r => !r.test(a));
    const conflict = (sig.ban || []).find(r => r.test(a));
    if (missing) {
      issues.push(`${wrCurrent.tense} kalıbı görünmüyor — beklenen: ${sig.verbHint}.`);
    } else if (conflict) {
      issues.push(`Cümlede ${wrCurrent.tense} ile çakışan bir zaman işareti var — beklenen: ${sig.verbHint}.`);
    } else {
      good.push(`${wrCurrent.tense} yapısına uygun görünüyor.`);
    }
  }

  // Kapsam: referanstaki anlam kelimelerinin kaçı cevapta var?
  const cov = wrCoverage(a, wrCurrent && wrCurrent.reference);
  if (cov) {
    if (cov.ratio < 0.5) {
      issues.push(`Cümle eksik görünüyor — beklenen anlamın önemli bir kısmı yok${cov.missing.length ? ` (örn. "${cov.missing[0]}" karşılığı)` : ''}.`);
    } else if (cov.ratio < 0.8) {
      minor.push(cov.missing.length
        ? `Örnek çözümde "${cov.missing[0]}" geçiyor, cümlende karşılığını göremedim — eşanlamlı kullandıysan sorun yok.`
        : 'Cümlenin bir kısmı örnek çözümden farklı — anlamı karşılıyorsa sorun değil.');
    } else {
      good.push('Cümlenin kapsamı örnek çözümle örtüşüyor.');
    }
  }

  // Yazım/noktalama: cümleyi yanlış yapmaz, "küçük düzeltme" olarak ayrılır
  if (!/^[A-Z]/.test(a)) minor.push('Cümle büyük harfle başlamalı.');
  if (!/[.!?]$/.test(a)) minor.push('Cümle noktalama işaretiyle bitmeli.');

  return { ok: issues.length === 0, issues, minor, good, mode: 'offline' };
}

// ── Claude kontrolü (BYOK) ─────────────────────────────────────────────────
const WR_SYSTEM_PROMPT = `Sen Türk öğrencilere İngilizce öğreten deneyimli bir öğretmensin.
Öğrenci sana bir Türkçe cümlenin İngilizce çevirisini yazacak. Belirli bir zaman
(tense) ve belirli bir hedef kelime kullanması isteniyor.

Değerlendirmeni SADECE geçerli JSON olarak döndür, başka hiçbir metin ekleme,
markdown kod bloğu kullanma. Format:
{
  "correct": true/false,
  "score": 0-100,
  "tenseOk": true/false,
  "wordUsed": true/false,
  "corrected": "düzeltilmiş İngilizce cümle",
  "feedbackTr": "Türkçe, kısa ve yapıcı geri bildirim (en fazla 2 cümle)",
  "errors": [{"wrong":"hatalı kısım","right":"doğrusu","whyTr":"Türkçe kısa açıklama"}],
  "alternatives": ["aynı anlamı veren 1-2 doğal alternatif cümle"]
}

Kurallar:
- Anlam Türkçe cümleyle örtüşüyorsa ve gramer doğruysa correct=true ver.
- Küçük noktalama/büyük harf hataları correct=false yapmasın, ama errors'a ekle.
- Öğrenci farklı ama doğru bir kelime seçimi yaptıysa bunu hata sayma, alternatives'e yaz.
- feedbackTr her zaman Türkçe olsun ve cesaretlendirici bir dil kullan.`;

async function wrCallClaude(answer) {
  const key = wrGetApiKey();
  const userMsg = `Türkçe cümle: ${wrCurrent.turkish}
İstenen zaman: ${wrCurrent.tense}
Kullanılması gereken kelime: ${wrCurrent.word}
Öğrencinin yazdığı: ${answer}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: WR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

async function wrCheckAnswer() {
  if (wrChecking) return;
  const ta = document.getElementById('wr-answer');
  const answer = (ta ? ta.value : '').trim();
  const box = document.getElementById('wr-result');
  if (!answer) {
    // Boş bırakmak da bir sinyal: kullanıcı takılmış olabilir. Azarlamak yerine
    // çıkış yolu sun — ipucu kademesi ya da doğrudan cevap.
    box.innerHTML = `<div class="filter-panel">
      <p style="font-size:14px;color:var(--text);margin-bottom:8px;">Henüz bir şey yazmadın.</p>
      <p style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:12px;">
        Aklına gelmiyorsa sorun değil — yarısını yazman bile yeterli, ya da ipucu isteyebilirsin.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="chip" onclick="wrShowHint()">${wrHintLevel === 0 ? 'İpucu ver' : wrHintLevel === 1 ? 'Daha fazla ipucu' : 'Cevabı göster'}</button>
        <button class="chip" onclick="wrRevealAnswer()">Cevabı göster</button>
        <button class="chip" onclick="wrNextQuestion()">Bu cümleyi atla</button>
      </div>
    </div>`;
    return;
  }

  const offline = wrOfflineCheck(answer);
  const key = wrGetApiKey();

  if (!key) {
    wrRenderResult(offline, answer);
    return;
  }

  wrChecking = true;
  box.innerHTML = `<p style="font-size:13px;color:var(--text2);padding:10px 4px;">Claude kontrol ediyor…</p>`;
  try {
    const r = await wrCallClaude(answer);
    wrRenderResult({ ...r, mode: 'claude', offline }, answer);
  } catch (err) {
    console.error('Cümle Yaz — Claude hatası:', err);
    box.innerHTML = `<div style="font-size:12px;color:var(--warn);background:var(--warnbg);padding:10px 12px;border-radius:var(--rsm);margin-bottom:10px;">
      Claude kontrolü yapılamadı (${escHtml(String(err.message || err))}). Basit kontrole geçildi.</div>`;
    wrRenderResult(offline, answer, true);
  } finally {
    wrChecking = false;
    wrRenderStatus();
  }
}

function wrRenderResult(r, answer, append) {
  const box = document.getElementById('wr-result');
  if (!box) return;
  wrLastResult = r;

  const isClaude = r.mode === 'claude';
  const ok = isClaude ? !!r.correct : !!r.ok;
  const hasMinor = !isClaude && Array.isArray(r.minor) && r.minor.length > 0;

  wrSessionStats.total++;
  if (ok) wrSessionStats.good++;

  const head = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
    <span style="font-size:16px;font-weight:700;color:${ok ? (hasMinor ? 'var(--warn)' : 'var(--success)') : 'var(--danger)'};">${ok ? (hasMinor ? '✓ Doğru — küçük düzeltme var' : '✓ Doğru') : '✗ Düzeltme gerekiyor'}</span>
    ${isClaude && typeof r.score === 'number' ? `<span class="badge" style="background:var(--surface2);color:var(--text2);">${r.score}/100</span>` : ''}
    <span style="font-size:11px;color:var(--text3);margin-left:auto;">${isClaude ? 'Claude kontrolü' : 'Basit kontrol'}</span>
  </div>`;

  let body = '';
  if (isClaude) {
    if (r.feedbackTr) body += `<p style="font-size:14px;color:var(--text);margin-bottom:12px;line-height:1.6;">${escHtml(r.feedbackTr)}</p>`;
    if (r.corrected && r.corrected.trim().toLowerCase() !== answer.trim().toLowerCase()) {
      body += `<div style="background:var(--successbg);padding:10px 12px;border-radius:var(--rsm);margin-bottom:10px;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Düzeltilmiş hâli</div>
        <div style="font-size:15px;font-weight:600;">${escHtml(r.corrected)}${ttsButtonHtml(r.corrected)}</div></div>`;
    }
    if (Array.isArray(r.errors) && r.errors.length) {
      body += `<div style="margin-bottom:10px;">${r.errors.map(e => `
        <div style="font-size:13px;padding:8px 10px;background:var(--surface2);border-radius:var(--rsm);margin-bottom:6px;line-height:1.6;">
          <span style="color:var(--danger);text-decoration:line-through;">${escHtml(e.wrong || '')}</span>
          &nbsp;→&nbsp;<span style="color:var(--success);font-weight:600;">${escHtml(e.right || '')}</span>
          ${e.whyTr ? `<div style="font-size:12px;color:var(--text2);margin-top:3px;">${escHtml(e.whyTr)}</div>` : ''}
        </div>`).join('')}</div>`;
    }
    if (Array.isArray(r.alternatives) && r.alternatives.length) {
      body += `<div style="font-size:12px;color:var(--text2);margin-bottom:10px;line-height:1.7;">
        <b>Alternatifler:</b><br>${r.alternatives.map(a => escHtml(a)).join('<br>')}</div>`;
    }
  } else {
    if (r.good && r.good.length) {
      body += `<div style="margin-bottom:8px;">${r.good.map(g =>
        `<div style="font-size:13px;color:var(--success);margin-bottom:4px;">✓ ${escHtml(g)}</div>`).join('')}</div>`;
    }
    if (r.issues && r.issues.length) {
      body += `<div style="margin-bottom:10px;">${r.issues.map(i =>
        `<div style="font-size:13px;color:var(--danger);margin-bottom:4px;">• ${escHtml(i)}</div>`).join('')}</div>`;
    }
    if (r.minor && r.minor.length) {
      body += `<div style="margin-bottom:10px;">${r.minor.map(i =>
        `<div style="font-size:13px;color:var(--warn);margin-bottom:4px;">◦ ${escHtml(i)}</div>`).join('')}</div>`;
    }
    body += `<p style="font-size:11.5px;color:var(--text3);line-height:1.6;margin-bottom:10px;">
      Bu basit kontrol sadece kelime ve zaman kalıbına bakar; gramerin tamamını denetlemez.
      Ayarlar'dan Claude anahtarı eklersen tam kontrol açılır.</p>`;
  }

  // Referans cümle (üretilmiş egzersizden)
  if (wrCurrent.reference) {
    body += `<details style="margin-bottom:12px;">
      <summary style="font-size:12px;color:var(--accent);cursor:pointer;">Örnek çözümü göster</summary>
      <div style="font-size:14px;font-weight:600;margin-top:8px;">${escHtml(wrCurrent.reference)}${ttsButtonHtml(wrCurrent.reference)}</div>
    </details>`;
  }

  body += `<div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="start-btn" style="flex:1;min-width:130px;margin-top:0;" onclick="wrNextQuestion()">Sıradaki cümle →</button>
    <button class="chip" onclick="wrRateWord('known')">Bildim</button>
    <button class="chip" onclick="wrRateWord('unknown')">Zorlandım</button>
  </div>`;

  box.innerHTML = `<div class="filter-panel">${head}${body}</div>`;
  ttsWireButtons(box);
  wrRenderStatus();
}

// Kullanıcı pes etti: cevabı göster, kelimeyi "zorlandım" olarak işaretle.
function wrRevealAnswer() {
  wrHintLevel = 3;
  wrRenderHint();
  const box = document.getElementById('wr-result');
  if (box) box.innerHTML = '';
  const el = document.getElementById('wr-hint');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function wrRateWord(rating) {
  if (!wrCurrent) return;
  if (typeof sgScheduleReview === 'function') {
    sgScheduleReview(`word:${wrCurrent.word}`, rating);
    sgScheduleReview(`structure:${wrCurrent.tense}`, rating);
  }
  if (typeof markContact === 'function') markContact(wrCurrent.word, 'used');
  wrNextQuestion();
}

// ── Ayarlar: Google girişi (Firebase Auth) ─────────────────────────────────
// Giriş kapısı (index.html, wh-auth-gate) zaten yetkisiz hesapları içeri
// almıyor — bu panel sadece Ayarlar'dan çıkış yapabilmek ve hesabı görmek
// için. Allowlist window.WH_ALLOWED_EMAILS'te TEK yerden geliyor (index.html
// içindeki Firebase modülünde tanımlı) — burada ayrı bir kopyası yok.
function renderAuthStatus() {
  const statusEl = document.getElementById('auth-status');
  const actionsEl = document.getElementById('auth-actions');
  if (!statusEl || !actionsEl) return;
  if (!window.whAuth) {
    statusEl.innerHTML = '<span style="color:var(--text3);">Giriş sistemi yükleniyor…</span>';
    actionsEl.innerHTML = '';
    return;
  }
  const user = window.whCurrentUser;
  if (!user) {
    statusEl.innerHTML = '<span style="color:var(--text3);">Giriş yapılmadı.</span>';
    actionsEl.innerHTML = `<button class="chip" onclick="whSignIn()">${ico('user',14,'currentColor',true)} Google ile giriş yap</button>`;
    return;
  }
  const email = (user.email || '').toLowerCase();
  const allowed = (window.WH_ALLOWED_EMAILS || []).includes(email);
  statusEl.innerHTML = allowed
    ? `<span style="color:var(--success);">${ico('check',14,'currentColor',true)} ${escHtml(user.email)} olarak giriş yapıldı</span>`
    : `<span style="color:var(--danger);">${ico('ban',14,'currentColor',true)} ${escHtml(user.email)} yetkili listede değil</span>`;
  actionsEl.innerHTML = `<button class="chip" onclick="whSignOut()">Çıkış yap</button>`;
}
function whSignIn() {
  if (!window.whAuth) return;
  window.whAuth.signIn().catch(function (e) { alert('Giriş başarısız: ' + e.message); });
}
function whSignOut() {
  if (!window.whAuth) return;
  window.whAuth.signOut();
}
document.addEventListener('wh-auth-changed', renderAuthStatus);

// ── Ayarlar: Claude API anahtarı ───────────────────────────────────────────
function renderClaudeKeyStatus() {
  const el = document.getElementById('claude-key-status');
  if (!el) return;
  const key = wrGetApiKey();
  el.innerHTML = key
    ? `<span style="color:var(--success);">✓ Anahtar kayıtlı (…${escHtml(key.slice(-6))})</span>`
    : `<span style="color:var(--text3);">Anahtar girilmedi — Cümle Yaz basit kontrol modunda çalışır.</span>`;
}
function saveClaudeKey() {
  const input = document.getElementById('claude-key-input');
  const v = (input.value || '').trim();
  if (!v) { alert('Lütfen bir anahtar gir.'); return; }
  try { localStorage.setItem(WR_KEY_STORAGE, v); } catch (e) {}
  input.value = '';
  renderClaudeKeyStatus();
  wrRenderStatus();
}
function clearClaudeKey() {
  if (!confirm('Claude API anahtarı silinsin mi?')) return;
  try { localStorage.removeItem(WR_KEY_STORAGE); } catch (e) {}
  renderClaudeKeyStatus();
  wrRenderStatus();
}

// ── Ayarlar: Ana Ekrana Ekle rehberi (iOS/Android sekme geçişi) ────────────
function hsSetTab(platform) {
  document.getElementById('hs-tab-ios').classList.toggle('on', platform === 'ios');
  document.getElementById('hs-tab-android').classList.toggle('on', platform === 'android');
  document.getElementById('hs-steps-ios').classList.toggle('hidden', platform !== 'ios');
  document.getElementById('hs-steps-android').classList.toggle('hidden', platform !== 'android');
}

const CEFR_LEVELS = ['A1','A2','B1','B2','C1'];
const CEFR_COLORS = { A1:'--a1', A2:'--a2', B1:'--b1', B2:'--b2', C1:'--c1' };

// ── Paylaşılan çizgi ikon seti — emojilerin yerini alır (sol menüdeki
// ikonlarla aynı dil: 20x20 viewBox, stroke currentColor, 1.6-1.8px, yuvarlak
// uç). Tek bir yerden yönetilir; Kelime Durumu, kelime modalı, Kelime Listem
// sekmeleri ve durum/sıralama chip'lerinin hepsi buradan besleniyor.
const ICO = {
  settings: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.8"/><path d="M10 3.3v2.3M10 14.4v2.3M4.1 4.1l1.6 1.6M14.3 14.3l1.6 1.6M3.3 10h2.3M14.4 10h2.3M4.1 15.9l1.6-1.6M14.3 5.7l1.6-1.6"/></svg>',
  calendar: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.2" width="13" height="12" rx="1.5"/><path d="M3.5 8h13M7 2.8v2.4M13 2.8v2.4"/></svg>',
  repeat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8.2A6 6 0 0 0 5.6 5.4L4 7"/><path d="M4 11.8A6 6 0 0 0 14.4 14.6L16 13"/><path d="M4 3.8v3.4h3.4M16 16.2v-3.4h-3.4"/></svg>',
  alert: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.5"/><path d="M10 7v3.6"/><circle cx="10" cy="13.2" r=".15" fill="currentColor" stroke-width="2.4"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5 8 14l7.5-8.5"/></svg>',
  x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l10 10M15 5L5 15"/></svg>',
  trend: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14 8 9.2l3 2.6 5.5-6.3"/><path d="M13.2 5.5H16.5V8.8"/></svg>',
  award: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.3 12 6.7l3.8.6-2.7 2.7.6 3.8L10 12.1l-3.7 1.7.6-3.8-2.7-2.7 3.8-.6z"/><path d="M7.3 10.2 9 12l3.7-4"/></svg>',
  upcoming: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v5.2M13.5 6.6l-3.8 2.8-3.8-2.8"/><rect x="4" y="9.6" width="12" height="6.4" rx="1.4"/></svg>',
  star: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.3 12 6.7l3.8.6-2.7 2.7.6 3.8L10 12.1l-3.7 1.7.6-3.8-2.7-2.7 3.8-.6z"/></svg>',
  clock: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.7"/><path d="M10 6.5V10l2.6 1.6"/></svg>',
  plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.5v11M4.5 10h11"/></svg>',
  search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.7" cy="8.7" r="5"/><path d="M15.5 15.5l-3.6-3.6"/></svg>',
  key: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="13" r="3.2"/><path d="M9.2 10.8 15.5 4.5M13 7l1.8 1.8M15.3 4.7l1.8 1.8"/></svg>',
  user: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.8" r="3.2"/><path d="M4 16.2c0-3.3 2.7-5.2 6-5.2s6 1.9 6 5.2"/></svg>',
  link: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 11.5 11.5 8.5"/><path d="M11 6.3l1.3-1.3a3 3 0 1 1 4.2 4.2L15.2 10.5"/><path d="M9 13.7 7.7 15a3 3 0 1 1-4.2-4.2L4.8 9.5"/></svg>',
  ban: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.5"/><path d="M5.6 5.6l8.8 8.8"/></svg>',
  swap: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10.5M11.5 4l3 3-3 3"/><path d="M16 13H5.5M8.5 10l-3 3 3 3"/></svg>',
  palette: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.3a6.7 6.7 0 1 0 0 13.4c1 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.2-1.1 0-.7.6-1.2 1.3-1.2H14a3 3 0 0 0 3-3c0-3.7-3.1-6.7-7-6.7z"/><circle cx="7.2" cy="8.4" r=".5" fill="currentColor"/><circle cx="10.4" cy="6.8" r=".5" fill="currentColor"/><circle cx="13.2" cy="8.6" r=".5" fill="currentColor"/></svg>',
  bolt: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3 5.5 11.2h3.8L9 17l6-8.6H10.8z"/></svg>',
  pin: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17s5-4.6 5-8.3A5 5 0 0 0 5 8.7C5 12.4 10 17 10 17z"/><circle cx="10" cy="8.5" r="1.8"/></svg>',
  target: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3.4"/><circle cx="10" cy="10" r=".4" fill="currentColor"/></svg>',
  box: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5z"/><path d="M3.5 6.5 10 10l6.5-3.5M10 10v7"/></svg>',
  play: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.3v11.4l9-5.7z" fill="currentColor" stroke="currentColor"/></svg>',
  question: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 7.6a2.5 2.5 0 1 1 3.6 2.3c-.9.5-1.1 1-1.1 1.9"/><circle cx="10" cy="14.6" r=".15" fill="currentColor" stroke-width="2.4"/></svg>',
  sparkle: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5v3.5M10 14v3.5M2.5 10H6M14 10h3.5M5 5l2.3 2.3M12.7 12.7L15 15M15 5l-2.3 2.3M7.3 12.7L5 15"/></svg>',
  shuffle: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7h9l-2.5-2.5M12.5 7L10 9.5"/><path d="M16.5 13h-9l2.5 2.5M7.5 13L10 10.5"/></svg>',
  book: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5.3c-1.4-1-3.8-1.5-6-1.1v10.9c2.2-.4 4.6.1 6 1.1 1.4-1 3.8-1.5 6-1.1V4.2c-2.2-.4-4.6.1-6 1.1z"/><path d="M10 5.3v10.9"/></svg>',
  headphones: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12v-2a5.5 5.5 0 0 1 11 0v2"/><rect x="3" y="11" width="3" height="4.6" rx="1.3"/><rect x="14" y="11" width="3" height="4.6" rx="1.3"/></svg>',
  chart: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V9M9 17V4M14 17v-6"/></svg>',
  clipboard: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="10" height="13" rx="1.5"/><path d="M7.5 4.5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1"/><path d="M7.5 9h5M7.5 12h5M7.5 15h3"/></svg>',
  speaker: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8v4h3l4 3.5V4.5L7 8z"/><path d="M13.5 7.2a4 4 0 0 1 0 5.6M15.6 5.1a7 7 0 0 1 0 9.8"/></svg>',
  save: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5"/><path d="M4 14v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V14"/></svg>',
  folder: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5a1 1 0 0 1 1-1h3.5l1.5 1.8H16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
  info: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.7"/><path d="M10 9v4.2"/><circle cx="10" cy="6.8" r=".15" fill="currentColor" stroke-width="2.2"/></svg>',
  cards: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="11" height="13" rx="2"/><path d="M8 3.5h7a2 2 0 0 1 2 2V15"/></svg>',
  news: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M6 8h8M6 11h8M6 14h5"/></svg>',
  list: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h12M4 10h12M4 15h8"/></svg>',
  pencil: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l4 4-9.5 9.5L3 18l1.5-4.5z"/></svg>',
  chat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H5.5A1.5 1.5 0 0 1 4 11.5z"/></svg>',
  flame: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17.5c-3 0-5-2-5-4.7 0-2.3 1.6-3.6 2.2-5.4.4-1.2.2-2.4-.4-3.4 2.6.4 4.7 2.5 4.9 5.2.9-.8 1.2-2 1-3.1 1.8 1.3 2.8 3.4 2.8 5.6 0 3-2.3 5.8-5.5 5.8z"/></svg>',
  notebook: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h7.5a3 3 0 0 1 3 3V16"/><path d="M4 4.5v10a1.5 1.5 0 0 0 1.5 1.5H16"/><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H14"/></svg>'
};
// name: ICO anahtarı. size: px. color: opsiyonel currentColor override. inline:
// true ise metinle aynı satırda hizalanacak margin-right taşır (etiket önü),
// false ise sade bir ikon (sayaç/rozet yanı) döner.
function ico(name, size, color, inline) {
  size = size || 13;
  if (inline === undefined) inline = true;
  const style = `display:inline-flex;width:${size}px;height:${size}px;flex-shrink:0;vertical-align:-2px;${inline?'margin-right:4px;':''}${color?`color:${color};`:''}`;
  return `<span style="${style}">${ICO[name] || ''}</span>`;
}

let progress = {};
// Ters yön (Türkçe → İngilizce) SRS ilerlemesi — `progress`'ten tamamen
// ayrı tutulur. Bir kelimeyi EN→TR'de bilmek, TR→EN'de bilmek anlamına
// gelmez (üretim becerisi tanımadan farklı ve genelde daha zayıf iz bırakır);
// bu yüzden iki yön birbirini asla ezmez. bkz. cmProgressStore().
let progressReverse = {};
// Frekans filtresi ortak mantığı: filtre daraltılmamışsa (tüm seçenekler
// seçili / boş = "tümü") etiketsiz (freq: "") kelimeler de gösterilir.
// Kullanıcı belirli bir frekansa daraltınca (örn. sadece "Low") etiketsiz
// kelimeler artık eşleşmez — "a" gibi etiketsiz temel kelimelerin "Low
// Frequency" filtresinde şaşırtıcı şekilde çıkmasını önler.
function freqMatches(wordFreq, selectedSet, allCount) {
  const noNarrowing = selectedSet.size === 0 || selectedSet.size === allCount;
  if (noNarrowing) return true;
  return selectedSet.has(wordFreq);
}
let contentCache = {};
let streak = { days: [], lastDate: null };
let accordionState = {};

const todayStr = () => new Date().toISOString().slice(0,10);
const wkey = w => w.word+'|'+w.pos;

// ── MASTERY ────────────────────────────────────────────────────────────────
function getNextReview(prog, correct) {
  let { interval=0, easeFactor=2.5, repetitions=0, totalKnown=0, totalLearning=0 } = prog || {};
  if (!correct) {
    return { interval:0, easeFactor:Math.max(1.3,easeFactor-0.2), repetitions:0,
             mastery:'reviewing', learned:false, nextReview:todayStr(),
             totalKnown, totalLearning: totalLearning+1,
             // Son verilen cevap: "Biliyorum" ile "Öğreniyorum" ilk turda aynı
             // mastery'ye ('reviewing') düşüyordu ve Özet'te ayırt edilemiyordu.
             lastAnswer:'learning' };
  }
  if (repetitions===0) interval=1;
  else if (repetitions===1) interval=4;
  else interval=Math.round(interval*easeFactor);
  easeFactor = Math.max(1.3, easeFactor+0.05);
  repetitions += 1;
  let mastery = 'reviewing';
  if (repetitions>=2 && interval>=7)  mastery='consolidating';
  if (repetitions>=4 && interval>=21) mastery='mastered';
  const newTotalKnown = mastery==='mastered' ? 0 : totalKnown+1;
  const newTotalLearning = mastery==='mastered' ? 0 : totalLearning;
  return { interval, easeFactor, repetitions, mastery, learned: mastery==='mastered',
           totalKnown:newTotalKnown, totalLearning:newTotalLearning, lastAnswer:'known' };
}
function getNextDate(n) {
  const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10);
}

// ── VIEWS ──────────────────────────────────────────────────────────────────
const MAIN_MENU_LABELS = { dash:'Panom', news:'Metin Analizi', wordadd:'Sözlüğüm', list:'Kelime Listem', units:'Üniteler', sentence:'Cümle Kur', hangman:'Asmaca', cardmode:'Kart Modu', status:'Kelime Durumu', settings:'Ayarlar', writing:'Cümle Yaz', grammar:'Grammar' };
function toggleMainMenu() {
  document.getElementById('main-menu-panel').classList.toggle('hidden');
}
// Menü açıkken sayfa içindeki bir filtreye (CEFR/frekans chip'i vb.) dokununca
// menü açık kalıyordu, çünkü sadece showView() (nav öğesi seçimi) paneli
// kapatıyordu. Artık panel açıkken panelin/toggle'ın DIŞINA her tıklama da
// paneli kapatıyor — sayfa içeriğiyle etkileşim otomatik olarak menüyü kapatır.
// oz-more-link (Panom'daki "Tüm modüller ›") istisnası: bu link zaten
// toggleMainMenu() çağırıyor, dışta sayılırsa menü açtığı anda kendini
// kapatıyordu (bulunan gerçek bug, düzeltildi).
document.addEventListener('click', function (e) {
  const panel = document.getElementById('main-menu-panel');
  const toggle = document.getElementById('main-menu-toggle');
  if (!panel || panel.classList.contains('hidden')) return;
  if (panel.contains(e.target) || (toggle && toggle.contains(e.target)) || e.target.closest('.oz-more-link')) return;
  panel.classList.add('hidden');
});
function showView(v) {
  // Kelime tanımı paneli artık .app'in doğrudan çocuğu (bkz. word-modal
  // taşıma düzeltmesi) — herhangi bir view-* div'ine bağlı değil, bu yüzden
  // view değişince otomatik kapanmıyordu. Burada açıkça kapatıyoruz.
  closeWordModal();
  document.getElementById('main-menu-panel').classList.add('hidden');
  const curLbl = document.getElementById('main-menu-current');
  if (curLbl) curLbl.textContent = MAIN_MENU_LABELS[v] || v;
  ['dash','news','wordadd','list','units','sentence','hangman','settings','cardmode','status','writing','grammar'].forEach(n => document.getElementById('view-'+n).classList.toggle('hidden',n!==v));
  document.getElementById('nav-dash').classList.toggle('active', v==='dash');
  document.getElementById('nav-news').classList.toggle('active', v==='news');
  document.getElementById('nav-wordadd').classList.toggle('active', v==='wordadd');
  document.getElementById('nav-list').classList.toggle('active', v==='list');
  document.getElementById('nav-units').classList.toggle('active', v==='units');
  document.getElementById('nav-sentence').classList.toggle('active', v==='sentence');
  document.getElementById('nav-hangman').classList.toggle('active', v==='hangman');
  document.getElementById('nav-cardmode').classList.toggle('active', v==='cardmode');
  document.getElementById('nav-status').classList.toggle('active', v==='status');
  document.getElementById('nav-settings').classList.toggle('active', v==='settings');
  document.getElementById('nav-writing').classList.toggle('active', v==='writing');
  document.getElementById('nav-grammar').classList.toggle('active', v==='grammar');
  if (v==='dash') updateDashboard();
  if (v==='wordadd') renderCustomWordsList();
  if (v==='list') { listUpdatePersonalCounts(); if (listMode==='topic') renderTopicWordGrid(); else if (listMode==='favorites') renderFavoritesList(); else if (listMode==='struggle') renderStruggleList(); else if (listMode==='extra') { renderExtraFilters(); renderExtraLetterRow(); renderExtraGrid(); } else { renderListBandFilters(); renderWordList(listLevel); } }
  if (v==='units') unitsInit();
  if (v==='cardmode') cmInit();
  if (v==='status') stInit();
  if (v==='writing') wrInit();
  if (v==='settings') { renderClaudeKeyStatus(); renderDailyGoalSetting(); renderAuthStatus(); }
  if (v==='grammar') grInit();
}

// ── WORD LIST (2-column, toggle accordion) ──────────────────────────────────
let listLevel='A1';
let listOpenKey=null;
function renderListCefrRow(){
  const row=document.getElementById('list-cefr-row');
  const levels=['A1','A2','B1','B2','C1'];
  row.innerHTML=levels.map(lv=>{
    // Sayaç aktif Longman/VOA filtrelerini de hesaba katar (listWordPasses),
    // böylece "Medium" seçiliyken her seviyenin gerçek kelime sayısı görünür.
    const count=WORD_DATA.filter(w=>w.cefr===lv && listWordPasses(w)).length;
    const dis = count===0 && lv!==listLevel;
    return `<button class="chip lvl-${lv.toLowerCase()}${lv===listLevel?' on':''}${dis?' disabled':''}" ${dis?'disabled':''} data-lv="${lv}" onclick="selectListLevel('${lv}')">${lv}<span class="n">(${count})</span></button>`;
  }).join('');
}
function selectListLevel(lv){
  listLevel=lv; listOpenKey=null;
  listRefreshAll();
}
function renderWordList(level){
  const words=WORD_DATA.filter(w=>w.cefr===level && listWordPasses(w));
  const info=document.getElementById('list-count-info');
  if(info) info.textContent = `${words.length} kelime`;
  const grid=document.getElementById('word-list-grid');
  grid.innerHTML=words.map(w=>{
    const k=wkey(w);
    const open=(k===listOpenKey);
    let html=`<div class="list-word-item" onclick="toggleListWord('${k.replace(/'/g,"\\'")}')">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span> <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span></div>${wordRowLine2Html(w)}</div>
      <span style="color:var(--text3);font-size:11px;margin-top:2px;">${open?'▾':'▸'}</span>
    </div>`;
    if(open){
      const c=BUILTIN_CONTENT[k];
      html += `<div style="grid-column:1/-1;border-bottom:0.5px solid var(--border);background:var(--surface);padding:14px;">${c?renderListDefHTML(c,w):'<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}</div>`;
    }
    return html;
  }).join('');
  ttsWireButtons(grid);
}
function toggleListWord(k){
  listOpenKey = (listOpenKey===k) ? null : k;
  if (listOpenKey) markLookup(k.split('|')[0]);
  renderWordList(listLevel);
}

// ── TOPIC WORD LIST (Group → Letter navigation) ─────────────────────────────
let listMode='oxford';
let topicGroup=null;
let topicLetter=null;
let topicOpenKey=null;

const TOPIC_GROUPS = [...new Set(TOPIC_WORDS.flatMap(w=>w.categories||[]))].sort((a,b)=>a.localeCompare(b));
const ALL_CATEGORY_WORDS = TOPIC_WORDS.concat(WORD_DATA.filter(w=>w.categories&&w.categories.length));
const _MC={};(()=>{ALL_CATEGORY_WORDS.forEach(w=>{(w.categories||[]).forEach(g=>{if(!_MC[g])_MC[g]={t:0,m:0};_MC[g].t++;const c=BUILTIN_CONTENT[w.word+'|'+w.pos];if(!c||!c.definition||!c.definition.trim())_MC[g].m++;});});})();

// ── LİSTE İÇİ ARAMA (sadece Oxford 3000/5000 + Konu Kelimeleri havuzunda) ──
// Özel kelime havuzuna bakmaz — o "Kelime Ekle" sekmesinin işi, burası sadece
// mevcut sabit listeleri taramak/filtrelemek için.
const LIST_SEARCH_POOL = WORD_DATA.concat(TOPIC_WORDS).concat(EXTRA_WORDS);
let listSearchOpenKey = null;

function handleListSearch(){
  const raw = document.getElementById('list-search-input').value.trim().toLowerCase();
  const resultsEl = document.getElementById('list-search-results');
  const normalEl = document.getElementById('list-normal-panels');
  if (!raw) {
    resultsEl.classList.add('hidden'); resultsEl.innerHTML='';
    normalEl.classList.remove('hidden');
    return;
  }
  normalEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  listSearchOpenKey = null;
  renderListSearchResults(raw);
}

function renderListSearchResults(raw){
  const resultsEl = document.getElementById('list-search-results');
  const matches = LIST_SEARCH_POOL.filter(w => w.word.toLowerCase().startsWith(raw)).slice(0, 30);
  if (!matches.length) {
    // İngilizce eşleşme yoksa Türkçe karşılıklarda ara — kullanıcı "kitap"
    // yazıp "book"u bulabilsin.
    const trHits = trSearch(raw, 30);
    if (trHits.length) {
      resultsEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="font-size:10px;color:#fff;background:var(--accent);padding:3px 9px;border-radius:10px;font-weight:600;">TÜRKÇE ARAMA</span>
        </div>${trResultsHtml(trHits, raw)}`;
      return;
    }
    resultsEl.innerHTML = `<p style="font-size:13px;color:var(--text2);">"<strong>${raw}</strong>" bulunamadı — ne İngilizce kelime ne de Türkçe karşılık olarak. <b>Sözlüğüm</b> sekmesinden de aratabilirsin.</p>`;
    return;
  }
  resultsEl.innerHTML = matches.map(w=>{
    const k = wkey(w);
    const open = (k===listSearchOpenKey);
    const c = BUILTIN_CONTENT[k];
    const isOxford = OXFORD_WORD_SET.has(w.word.toLowerCase());
    const isExtra = EXTRA_WORD_SET.has(w.word.toLowerCase());
    const sourceTag = isOxford ? '' : (isExtra
      ? ' <span style="font-size:10px;color:var(--warn);">Ek Havuz</span>'
      : ' <span style="font-size:10px;color:var(--text3);">Konu Kelimesi</span>');
    let html = `<div class="list-word-item" onclick="toggleListSearchWord('${k.replace(/'/g,"\\'")}')">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span> <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}${sourceTag}</div>${wordRowLine2Html(w)}</div>
      <span style="color:var(--text3);font-size:11px;margin-top:2px;">${open?'▾':'▸'}</span>
    </div>`;
    if (open) {
      html += `<div style="border-bottom:0.5px solid var(--border);padding:14px 4px;">${c?renderListDefHTML(c,w):'<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}</div>`;
    }
    return html;
  }).join('');
  ttsWireButtons(resultsEl);
}

function toggleListSearchWord(k){
  listSearchOpenKey = (listSearchOpenKey===k) ? null : k;
  const raw = document.getElementById('list-search-input').value.trim().toLowerCase();
  renderListSearchResults(raw);
}

// Kişisel koleksiyon rozetlerindeki sayaçlar — sekmeyi açmadan kaç kelime
// olduğunu gösterir (Kelime Listem'in yeni gruplu sekme tasarımı).
function listUpdatePersonalCounts(){
  const favCount = Object.keys(favorites).length;
  const struggleCount = WORD_DATA.filter(w => {
    const n = lookupCount[w.word.toLowerCase()] || 0;
    const mastered = progress[wkey(w)]?.mastery === 'mastered';
    return n >= LOOKUP_STRUGGLE_THRESHOLD && !mastered;
  }).length;
  const favEl = document.getElementById('list-mode-favorites-count');
  const strEl = document.getElementById('list-mode-struggle-count');
  if (favEl) favEl.textContent = favCount ? ` ${favCount}` : '';
  if (strEl) strEl.textContent = struggleCount ? ` ${struggleCount}` : '';
}

function selectListMode(mode){
  listMode=mode;
  listUpdatePersonalCounts();
  document.getElementById('list-mode-oxford').classList.toggle('active', mode==='oxford');
  document.getElementById('list-mode-topic').classList.toggle('active', mode==='topic');
  document.getElementById('list-mode-favorites').classList.toggle('active', mode==='favorites');
  document.getElementById('list-mode-struggle').classList.toggle('active', mode==='struggle');
  document.getElementById('list-mode-extra').classList.toggle('active', mode==='extra');
  document.getElementById('list-oxford-panel').classList.toggle('hidden', mode!=='oxford');
  document.getElementById('list-topic-panel').classList.toggle('hidden', mode!=='topic');
  document.getElementById('list-favorites-panel').classList.toggle('hidden', mode!=='favorites');
  document.getElementById('list-struggle-panel').classList.toggle('hidden', mode!=='struggle');
  document.getElementById('list-extra-panel').classList.toggle('hidden', mode!=='extra');
  if(mode==='oxford'){ renderListBandFilters(); renderWordList(listLevel); }
  else if(mode==='topic'){ renderTopicGroupRow(); renderTopicLetterPanel(); renderTopicWordGrid(); }
  else if(mode==='favorites'){ renderFavoritesList(); }
  else if(mode==='extra'){ renderExtraFilters(); renderExtraLetterRow(); renderExtraGrid(); }
  else { renderStruggleList(); }
}

// ── ZORLANDIKLARIM (arama sayısı eşiği geçmiş ama hâlâ "Biliyorum" olmamış
// kelimeler — kendiliğinden oluşan bir "sorunlu kelimeler" havuzu) ────────
let struggleOpenKey = null;
function renderStruggleList(){
  const grid=document.getElementById('struggle-word-grid');
  const words = WORD_DATA.filter(w => {
    const n = lookupCount[w.word.toLowerCase()] || 0;
    const mastered = progress[wkey(w)]?.mastery === 'mastered';
    return n >= LOOKUP_STRUGGLE_THRESHOLD && !mastered;
  }).sort((a,b) => (lookupCount[b.word.toLowerCase()]||0) - (lookupCount[a.word.toLowerCase()]||0));
  if(!words.length){
    grid.innerHTML = `<p style="grid-column:1/-1;font-size:13px;color:var(--text3);text-align:center;padding:24px 0;">Henüz zorlandığın bir kelime yok — bir kelimeyi ${LOOKUP_STRUGGLE_THRESHOLD}+ kez arayıp hâlâ "Biliyorum"a geçirmediysen burada listelenir.</p>`;
    return;
  }
  grid.innerHTML=words.map(w=>{
    const k=wkey(w);
    const open=(k===struggleOpenKey);
    const n = lookupCount[w.word.toLowerCase()] || 0;
    let html=`<div class="list-word-item" onclick="toggleStruggleWord('${k.replace(/'/g,"\\'")}')">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span> <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''} <span style="font-size:11px;color:var(--warn);display:inline-flex;align-items:center;gap:2px;">${ico('search',10,null,false)}${n}</span></div>${wordRowLine2Html(w)}</div>
      <span style="color:var(--text3);font-size:11px;margin-top:2px;">${open?'▾':'▸'}</span>
    </div>`;
    if(open){
      const c=BUILTIN_CONTENT[k];
      html += `<div style="grid-column:1/-1;border-bottom:0.5px solid var(--border);background:var(--surface);padding:14px;">${c?renderListDefHTML(c,w):'<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}</div>`;
    }
    return html;
  }).join('');
  ttsWireButtons(grid);
}
function toggleStruggleWord(k){
  struggleOpenKey = (struggleOpenKey===k) ? null : k;
  if (struggleOpenKey) markLookup(k.split('|')[0]);
  renderStruggleList();
}

// ── FAVORİLERİM (seviye/grup filtresinden bağımsız, henüz çalışma havuzuna
// girmemiş favoriler dahil tüm favorileri gösterir) ─────────────────────────
let favoritesOpenKey = null;
function renderFavoritesList(){
  const grid=document.getElementById('favorites-word-grid');
  const pool = WORD_DATA.concat(TOPIC_WORDS.filter(w=>!OXFORD_WORD_SET.has(w.word.toLowerCase())));
  const words = pool.filter(w=>favorites[wkey(w)]).sort((a,b)=>a.word.localeCompare(b.word)||a.pos.localeCompare(b.pos));
  if(!words.length){
    grid.innerHTML = `<p style="grid-column:1/-1;font-size:13px;color:var(--text3);text-align:center;padding:24px 0;">Henüz favori kelime yok. Herhangi bir listede kelimenin yanındaki ☆ ikonuna dokunarak favorileyebilirsin.</p>`;
    return;
  }
  grid.innerHTML=words.map(w=>{
    const k=wkey(w);
    const open=(k===favoritesOpenKey);
    let html=`<div class="list-word-item" onclick="toggleFavoritesWord('${k.replace(/'/g,"\\'")}')">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span> <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}</div>${wordRowLine2Html(w)}</div>
      <span style="color:var(--text3);font-size:11px;margin-top:2px;">${open?'▾':'▸'}</span>
    </div>`;
    if(open){
      const c=BUILTIN_CONTENT[k];
      html += `<div style="grid-column:1/-1;border-bottom:0.5px solid var(--border);background:var(--surface);padding:14px;">${c?renderListDefHTML(c,w):'<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}</div>`;
    }
    return html;
  }).join('');
  ttsWireButtons(grid);
}
function toggleFavoritesWord(k){
  favoritesOpenKey = (favoritesOpenKey===k) ? null : k;
  if (favoritesOpenKey) markLookup(k.split('|')[0]);
  renderFavoritesList();
}

function renderTopicGroupRow(){
  const row=document.getElementById('topic-group-row');
  row.innerHTML=TOPIC_GROUPS.map(g=>{
    const info=_MC[g]||{t:0,m:0};
    const badge=info.m>0?` <span style="color:#e67e22;font-size:11px">⚠️ ${info.m} eksik</span>`:'';
    return `<button class="chip${g===topicGroup?' on':''}" onclick="selectTopicGroup('${g.replace(/'/g,"\\\\'")}')"><span>${g}</span> <span style="color:var(--text3);">(${info.t})</span>${badge}</button>`;
  }).join('');
}

function selectTopicGroup(g){
  topicGroup=g; topicLetter=null; topicOpenKey=null;
  renderTopicGroupRow();
  renderTopicLetterPanel();
  renderTopicWordGrid();
}

function renderTopicLetterPanel(){
  const panel=document.getElementById('topic-letter-panel');
  if(!topicGroup){ panel.style.display='none'; return; }
  panel.style.display='block';
  document.getElementById('topic-group-label').textContent = topicGroup + ' — harf seç (opsiyonel)';
  const groupWords=ALL_CATEGORY_WORDS.filter(w=>(w.categories||[]).includes(topicGroup));
  const letters=[...new Set(groupWords.map(w=>w.word[0].toUpperCase()))].sort((a,b)=>a.localeCompare(b));
  if(topicLetter===null) topicLetter='ALL';
  const row=document.getElementById('topic-letter-row');
  row.innerHTML = `<button class="chip${topicLetter==='ALL'?' on':''}" onclick="selectTopicLetter('ALL')">Tümü <span style="color:var(--text3);">(${groupWords.length})</span></button>` +
    letters.map(l=>{
      const count=groupWords.filter(w=>w.word[0].toUpperCase()===l).length;
      return `<button class="chip${l===topicLetter?' on':''}" onclick="selectTopicLetter('${l}')">${l} <span style="color:var(--text3);">(${count})</span></button>`;
    }).join('');
}

function selectTopicLetter(l){
  topicLetter=l; topicOpenKey=null;
  renderTopicLetterPanel();
  renderTopicWordGrid();
}

function renderTopicWordGrid(){
  const grid=document.getElementById('topic-word-grid');
  if(!topicGroup){ grid.innerHTML=''; return; }
  const words=ALL_CATEGORY_WORDS
    .filter(w=>(w.categories||[]).includes(topicGroup) && (topicLetter==='ALL' || !topicLetter || w.word[0].toUpperCase()===topicLetter))
    .sort((a,b)=>a.word.localeCompare(b.word)||a.pos.localeCompare(b.pos));
  grid.innerHTML=words.map(w=>{
    const k=wkey(w);
    const open=(k===topicOpenKey);
    const _w=BUILTIN_CONTENT[k];
    const _warn=(_w&&_w.definition&&_w.definition.trim())?'':'⚠️';
    let html=`<div class="list-word-item" onclick="toggleTopicWord('${k.replace(/'/g,"\\'")}')">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span>${_warn} <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}</div>${wordRowLine2Html(w)}</div>
      <span style="color:var(--text3);font-size:11px;margin-top:2px;">${open?'▾':'▸'}</span>
    </div>`;
    if(open){
      const c=BUILTIN_CONTENT[k];
      html += `<div style="grid-column:1/-1;border-bottom:0.5px solid var(--border);background:var(--surface);padding:14px;">${c?renderListDefHTML(c,w):'<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}</div>`;
    }
    return html;
  }).join('');
  ttsWireButtons(grid);
}

function toggleTopicWord(k){
  topicOpenKey = (topicOpenKey===k) ? null : k;
  if (topicOpenKey) markLookup(k.split('|')[0]);
  renderTopicWordGrid();
}

// Kelimenin hangi listelerde geçtiğini ve Longman bantlarını gösteren blok.
// Kaynak çıkarımı kesin: speaking/writing SADECE Longman 3000'den, freq SADECE
// Longman 9000'den gelir (enrich_wordlists.py böyle doldurur). voa bayrağı da
// VOA Special English listesinden.
const SP_TITLES = { S1: 'Konuşulan İngilizcede ilk 1000', S2: 'ilk 2000', S3: 'ilk 3000' };
const WR_TITLES = { W1: 'Yazılı İngilizcede ilk 1000', W2: 'ilk 2000', W3: 'ilk 3000' };

function wordSourceInfoHtml(w) {
  if (!w) return '';
  const inL3 = !!(w.speaking || w.writing);
  const inL9 = !!w.freq;
  const inExtra = (typeof EXTRA_WORD_SET !== 'undefined') && EXTRA_WORD_SET.has(String(w.word).toLowerCase());
  const inOxford = (typeof OXFORD_WORD_SET !== 'undefined') && OXFORD_WORD_SET.has(String(w.word).toLowerCase());

  const bands = [];
  if (w.speaking) bands.push(`<span class="badge b-${w.speaking.toLowerCase()}" title="${SP_TITLES[w.speaking] || ''}">Konuşma ${w.speaking}</span>`);
  if (w.writing)  bands.push(`<span class="badge b-${w.writing.toLowerCase()}" title="${WR_TITLES[w.writing] || ''}">Yazı ${w.writing}</span>`);
  if (w.freq)     bands.push(`<span class="badge" style="background:var(--surface2);color:var(--text2);">${w.freq.replace(' Frequency', '')} frekans</span>`);
  if (w.voa)      bands.push('<span class="badge b-voa" title="VOA Special English — basitleştirilmiş haber İngilizcesinin ~1.500 kelimelik çekirdeği">VOA çekirdeği</span>');

  const sources = [];
  if (inOxford) sources.push('Oxford 3000/5000');
  else if (inExtra) sources.push('Ek Havuz');
  if (inL3) sources.push('Longman 3000');
  if (inL9) sources.push('Longman 9000');
  if (w.voa) sources.push('VOA');

  if (!bands.length && !sources.length) return '';
  return `<div class="c-section">
    <div class="c-section-label">Listeler ve sıklık</div>
    ${bands.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">${bands.join('')}</div>` : ''}
    ${sources.length ? `<div style="font-size:11.5px;color:var(--text3);line-height:1.6;">Geçtiği listeler: ${sources.join(' · ')}</div>` : ''}
  </div>`;
}

function renderListDefHTML(c,w){
  const paras=(c.nuance||'—').split(/\n\n+/).filter(p=>p.trim());
  const nuanceHtml=paras.map(p=>`<p style="margin-bottom:8px;font-size:13px;line-height:1.6;color:var(--text);">${p.trim()}</p>`).join('');
  const exHtml=(c.examples||[]).map((ex,i)=>{
    const en=typeof ex==='object'?ex.en:ex;
    const tr=typeof ex==='object'?ex.tr:null;
    const trHtml=tr?`<button class="tr-toggle" onclick="event.stopPropagation();toggleTr(this)"><span class="tr-switch"><span class="tr-switch-knob"></span></span><span class="tr-toggle-label">Türkçesini gör</span></button><div class="tr-text">${tr}</div>`:'';
    return `<div class="c-example"><p>${en}${ttsButtonHtml(en)}</p>${trHtml}</div>`;
  }).join('');
  const catsHtml=(w.categories&&w.categories.length)?`<div class="c-section"><div class="c-section-label">Kategoriler</div><div class="c-cats">${w.categories.map(cat=>`<span class="c-cat">${cat}</span>`).join('')}</div></div>`:'';
  const contactHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${contactBadgesHtml(w.word)}</div>`;
  const lookups = lookupCount[w.word.toLowerCase()] || 0;
  const isMastered = progress[wkey(w)]?.mastery === 'mastered';
  const lookupHtml = (lookups >= 2 && !isMastered)
    ? `<div style="font-size:12px;color:var(--warn);background:var(--warnbg);display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;margin-bottom:10px;">${ico('search',13,null,false)}${lookups} kez arandı — hâlâ "Biliyorum" değil</div>`
    : '';
  const statsId = 'stats-' + w.word.toLowerCase().replace(/[^a-z0-9]/g,'') + '-' + w.pos;
  const statsToggleHtml = `<div class="c-section">
    <div onclick="event.stopPropagation();document.getElementById('${statsId}').classList.toggle('hidden')" style="font-size:12px;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:5px;">${ico('chart',13,null,false)}İstatistikler <span style="color:var(--text3);">▸</span></div>
    <div id="${statsId}" class="hidden" style="margin-top:8px;">${contactHtml}${lookupHtml}</div>
  </div>`;
  const copyPayload = escAttr(JSON.stringify({ w:{word:w.word,pos:w.pos,cefr:w.cefr}, c }));
  const copyBtnHtml = `<button class="copy-btn" onclick="event.stopPropagation();copyWordContent(${copyPayload},this)" style="display:inline-flex;align-items:center;gap:5px;">${ico('clipboard',13,null,false)}İçeriği kopyala</button>`;
  const statusHtml = (w.word && WORD_DATA.some(x=>x.word===w.word && x.pos===w.pos)) ? progressQuickControlHtml(w) : '';
  const html = `<div class="c-def" style="margin-bottom:10px;">${c.definition||'—'}${c.definition?ttsButtonHtml(c.definition):''}</div>
    <div class="c-section"><div class="c-section-label">Türkçe anlam</div><div class="c-turkish">${c.turkish||'—'}</div></div>
    ${wordSourceInfoHtml(w)}
    ${catsHtml}
    <div class="c-section"><div class="c-section-label">Nüans</div>${nuanceHtml}</div>
    <div class="c-section">
      <div class="examples-card">
        <div class="examples-card-head"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2z"/><path d="M8.3 8.2a1.7 1.7 0 1 1 2.2 1.6c-.5.2-.7.5-.7 1"/><circle cx="10" cy="12.6" r=".15" fill="currentColor" stroke-width="2"/></svg>Örnekler</div>
        <div class="examples-card-body">${exHtml}</div>
      </div>
    </div>
    ${statsToggleHtml}
    <div style="text-align:right;margin:10px 0;">${copyBtnHtml}</div>
    ${statusHtml}`;
  // Not: Türkçe anlam ve nüans kasıtlı olarak hoparlörsüz — Kokoro sadece
  // İngilizce için eğitilmiş, Türkçe metni yanlış/bozuk telaffuz eder.
  return html;
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
const ACC_STYLES = {
  due:           { bg: 'var(--warnbg)',    fg: 'var(--warn)'    },
  mastered:      { bg: 'var(--successbg)', fg: 'var(--success)' },
  consolidating: { bg: 'var(--accentbg)',  fg: 'var(--accent)'  },
  reviewing:     { bg: 'var(--a2bg)',      fg: 'var(--a2)'      },
  upcoming:      { bg: 'var(--surface2)',  fg: 'var(--text2)'   },
};
function renderAccordion(id, label, words, defOpen, styleKey) {
  const st = ACC_STYLES[styleKey] || ACC_STYLES.upcoming;
  const open = accordionState[id]!==undefined ? accordionState[id] : defOpen;
  // NOT: JSON dizisi HTML özniteliğine gömülürken çift tırnaklar öznitelik
  // sınırını kırabiliyordu — escAttr ile HTML-güvenli hale getiriyoruz.
  const wordsJson = escAttr(JSON.stringify(words.map(w=>`${w.word} (${w.pos})`)));
  return `<div class="acc-item">
    <div class="acc-head" onclick="toggleAcc('${id}')" style="background:${st.bg};">
      <span class="acc-label" style="color:${st.fg};"><span id="${id}-ic">${open?'▾':'▸'}</span> ${label} <span style="font-weight:400;opacity:.7;">(${words.length})</span></span>
      <button class="copy-btn" onclick="event.stopPropagation();copyList(${wordsJson},this)">Kopyala</button>
    </div>
    <div class="acc-body${open?' open':''}" id="${id}">${words.map(w=>{
      const p = progress[wkey(w)];
      const mark = !p ? '' : (p.mastery==='mastered' ? ico('award',12,'#5cb87a',false) : (p.lastAnswer==='learning' ? ico('alert',12,'#e08a5c',false) : ico('check',12,'var(--text3)',false)));
      return `<div class="acc-word" onclick="openWordActions(${escAttr(JSON.stringify(w.word))},${escAttr(JSON.stringify(w.pos))})">
        <span>${w.word} <span style="color:var(--text3);font-size:11px;">${w.pos}</span></span>
        <span style="font-size:11px;opacity:.75;">${mark} ›</span>
      </div>`;}).join('')}</div>
  </div>`;
}
function toggleAcc(id) {
  const body=document.getElementById(id), ic=document.getElementById(id+'-ic');
  const open=body.classList.toggle('open');
  if(ic) ic.textContent=open?'▾':'▸';
  accordionState[id]=open;
}
function copyTextToClipboard(text, btn) {
  const showResult = (ok) => {
    const t = btn.textContent;
    btn.textContent = ok ? '✓ Kopyalandı' : '✕ Kopyalanamadı';
    setTimeout(() => btn.textContent = t, 1500);
  };
  const legacyCopy = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      showResult(ok);
    } catch (e) { showResult(false); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showResult(true)).catch(legacyCopy);
  } else {
    legacyCopy();
  }
}
function copyList(words, btn) {
  copyTextToClipboard(words.join(', '), btn);
}
// ClipboardItem destekleniyorsa hem HTML (biçimlendirilmiş — Notes, Mail,
// Word gibi zengin metin destekleyen yerlere yapıştırınca kalın başlık/madde
// işareti korunur) hem düz metin olarak yazar; desteklenmiyorsa otomatik
// olarak düz metne düşer.
function copyRichText(plainText, htmlText, btn) {
  const plainFallback = () => copyTextToClipboard(plainText, btn);
  if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
    try {
      const item = new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' })
      });
      navigator.clipboard.write([item]).then(() => {
        const t = btn.textContent; btn.textContent = '✓ Kopyalandı'; setTimeout(() => btn.textContent = t, 1500);
      }).catch(plainFallback);
    } catch (e) {
      plainFallback();
    }
  } else {
    plainFallback();
  }
}
// Bir kelimenin tüm içeriğini (tanım/Türkçe/nüans/örnekler) panoya kopyalar —
// Kelime Listem, Kart Modu, Kelime Durumu ve Sözlüğüm'de aynı paylaşılan
// bileşen (renderListDefHTML) üzerinden çıkar.
function copyWordContent(payload, btn) {
  const { w, c } = payload;
  const title = `${w.word} (${w.pos}${w.cefr ? ' · ' + w.cefr : ''})`;
  const examples = (c.examples || []).map(ex => ({
    en: typeof ex === 'object' ? ex.en : ex,
    tr: typeof ex === 'object' ? ex.tr : null
  }));

  const plainLines = [title, ''];
  if (c.definition) plainLines.push('Tanım', c.definition, '');
  if (c.turkish) plainLines.push('Türkçe', c.turkish, '');
  if (c.nuance) plainLines.push('Nüans', c.nuance.replace(/\n\n+/g, '\n'), '');
  if (examples.length) {
    plainLines.push('Örnekler');
    examples.forEach(ex => {
      plainLines.push('• ' + ex.en);
      if (ex.tr) plainLines.push('  ' + ex.tr);
    });
  }
  const plainText = plainLines.join('\n').trim();

  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = `<div style="font-family:-apple-system,sans-serif;">
    <div style="font-size:19px;font-weight:700;margin-bottom:10px;">${esc(w.word)} <span style="font-weight:400;font-style:italic;color:#666;font-size:14px;">(${esc(w.pos)}${w.cefr?' · '+esc(w.cefr):''})</span></div>`;
  if (c.definition) html += `<p style="margin:0 0 10px;"><b>Tanım:</b> ${esc(c.definition)}</p>`;
  if (c.turkish) html += `<p style="margin:0 0 10px;"><b>Türkçe:</b> ${esc(c.turkish)}</p>`;
  if (c.nuance) html += `<p style="margin:0 0 10px;"><b>Nüans:</b> ${esc(c.nuance).replace(/\n\n+/g,'<br><br>')}</p>`;
  if (examples.length) {
    html += `<p style="margin:0 0 4px;"><b>Örnekler:</b></p><ul style="margin:0 0 10px;padding-left:20px;">`;
    examples.forEach(ex => {
      html += `<li style="margin-bottom:6px;"><i>${esc(ex.en)}</i>${ex.tr?`<br><span style="color:#555;">${esc(ex.tr)}</span>`:''}</li>`;
    });
    html += `</ul>`;
  }
  html += `</div>`;

  copyRichText(plainText, html, btn);
}

function renderCefrSection(cefrWords, level) {
  const today=todayStr();
  const mastered      = cefrWords.filter(w=>progress[wkey(w)]?.mastery==='mastered');
  const consolidating = cefrWords.filter(w=>progress[wkey(w)]?.mastery==='consolidating');
  const upcoming      = cefrWords.filter(w=>!progress[wkey(w)]);
  // "Bugün tekrar" yerine BUGÜN ÇALIŞTIKLARIN — tekrar zamanı gelmiş olmak
  // değil, bugün gerçekten dokunduğun kelimeler.
  const studiedToday  = cefrWords.filter(w=>progress[wkey(w)]?.lastSeen === today);
  // Öğrenme aşaması: sistem "tam öğrenildi" diyene kadar süren tüm kelimeler.
  const learningAll   = cefrWords.filter(w=>{ const p=progress[wkey(w)]; return p && p.mastery!=='mastered'; });
  const saidKnown     = learningAll.filter(w=>progress[wkey(w)]?.lastAnswer !== 'learning');
  const saidUnknown   = learningAll.filter(w=>progress[wkey(w)]?.lastAnswer === 'learning');
  const mastCount     = mastered.length;
  const pct           = cefrWords.length ? (mastCount/cefrWords.length*100).toFixed(0) : 0;
  const color         = CEFR_COLORS[level];

  const cats = [
    studiedToday.length ? {id:level+'-today', label:ico('calendar')+'Bugün çalıştıkların', words:studiedToday, open:true, style:'due'} : null,
    {id:level+'-learning', label:ico('repeat')+'Öğrenme aşamasında', words:learningAll, open:true, style:'reviewing'},
    {id:level+'-unknown', label:ico('alert')+'Bilmiyorum dediklerin', words:saidUnknown, open:true, style:'due'},
    {id:level+'-known', label:ico('check')+'Biliyorum dediklerin', words:saidKnown, open:false, style:'consolidating'},
    {id:level+'-consolidating', label:ico('trend')+'Pekişiyor', words:consolidating, open:false, style:'consolidating'},
    {id:level+'-mastered', label:ico('award')+'Tam öğrenildi', words:mastered, open:false, style:'mastered'},
    {id:level+'-upcoming', label:ico('upcoming')+'Sıradaki yeniler', words:upcoming, open:false, style:'upcoming'},
  ].filter(Boolean);

  // Boş kategorileri ayrı ayrı kutular yerine tek satırda topla — beş kez
  // tekrarlanan "Henüz yok" yerine tek, sakin bir özet satırı.
  const nonEmpty = cats.filter(c=>c.words.length);
  const empty = cats.filter(c=>!c.words.length);
  const accordionsHtml = nonEmpty.map(c=>renderAccordion(c.id,c.label,c.words,c.open,c.style)).join('');
  const emptyHtml = empty.length
    ? `<div style="font-size:12px;color:var(--text3);padding:6px 2px 0;">${empty.map(c=>c.label).join(' · ')}: henüz yok</div>`
    : '';

  return `<div class="cefr-block">
    <div class="cefr-header">
      <span style="font-size:15px;font-weight:500;color:var(${color});">${level}</span>
      <span style="font-size:13px;color:var(--text2);">${mastCount} / ${cefrWords.length} tam öğrenildi</span>
    </div>
    <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:var(${color});"></div></div>
    ${accordionsHtml}
    ${emptyHtml}
  </div>`;
}

// ── GLOBAL SEARCH ──────────────────────────────────────────────────────────
const DICT_SITES = [
  { name: 'Longman',       url: w => `https://www.ldoceonline.com/dictionary/${w}` },
  { name: 'Cambridge',     url: w => `https://dictionary.cambridge.org/dictionary/english-turkish/${w}` },
  { name: 'Collins',       url: w => `https://www.collinsdictionary.com/dictionary/english/${w}` },
  { name: 'Oxford',        url: w => `https://www.oxfordlearnersdictionaries.com/definition/english/${w}` },
  { name: 'WordReference', url: w => `https://www.wordreference.com/entr/${w}` },
  { name: 'RH Sözlük',     url: w => `https://www.remzihoca.com/sozluk/${w}` }
];
function dictButtonsHtml(word) {
  const w = encodeURIComponent(word.trim().toLowerCase());
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;">
    ${DICT_SITES.map(s=>`<a href="${s.url(w)}" target="_blank" rel="noopener" style="flex:1;min-width:90px;text-align:center;padding:9px 6px;font-size:12px;font-weight:500;border-radius:var(--rsm);border:0.5px solid var(--accent);color:var(--accent);background:var(--accentbg);text-decoration:none;">${s.name}</a>`).join('')}
  </div>`;
}
// Basit Levenshtein (düzenleme) mesafesi — yazım hatasına toleranslı öneri
// için kullanılır. Küçük veri setinde (Oxford) performans sorunsuz.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({length:n+1}, (_,i)=>i);
  for (let i=1;i<=m;i++){
    const cur = [i];
    for (let j=1;j<=n;j++){
      cur[j] = a[i-1]===b[j-1] ? prev[j-1] : 1+Math.min(prev[j-1],prev[j],cur[j-1]);
    }
    prev = cur;
  }
  return prev[n];
}
// Tam eşleşme bulunamadığında "bunu mu demek istediniz?" önerileri —
// önce aynı harflerle başlayanlar (eksik yazım), yoksa yazım hatasına
// toleranslı en yakın kelimeler (edit distance).
function findWordSuggestions(raw) {
  if (!raw || raw.length < 3) return [];
  const prefix = raw.slice(0, Math.min(4, raw.length));
  const SUGGEST_POOL = WORD_DATA.concat(EXTRA_WORDS);
  const byPrefix = SUGGEST_POOL.filter(w => w.word.toLowerCase().startsWith(prefix) && w.word.toLowerCase() !== raw);
  if (byPrefix.length) return byPrefix.slice(0, 6);
  const scored = SUGGEST_POOL
    .filter(w => Math.abs(w.word.length - raw.length) <= 3)
    .map(w => ({ w, d: levenshtein(raw, w.word.toLowerCase()) }))
    .filter(x => x.d > 0 && x.d <= 3)
    .sort((a,b) => a.d - b.d);
  return scored.slice(0, 6).map(x => x.w);
}

function performGlobalSearch() {
  const raw = document.getElementById('global-search-input').value.trim().toLowerCase();
  const panel = document.getElementById('search-result-panel');
  const clearBtn = document.getElementById('global-search-clear');
  if (!raw) { panel.classList.add('hidden'); panel.innerHTML=''; clearBtn.classList.add('hidden'); return; }
  const matches = WORD_DATA.filter(w => w.word.toLowerCase() === raw);
  const topicMatches = TOPIC_WORD_MAP[raw] || [];
  const extraMatches = EXTRA_WORD_MAP[raw] || [];
  const customMatch = customWords[raw];
  let html = '';
  if (customMatch) {
    const content = customCache[raw] || BUILTIN_CONTENT[raw + '|—'];
    html += `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:0.5px solid var(--border);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
        <span class="wordfont" style="font-size:22px;">${customMatch.word}</span>${ttsButtonHtml(customMatch.word, customMatch.word)}
        <span style="font-size:10px;color:var(--accent);background:var(--accentbg);padding:2px 8px;border-radius:10px;font-weight:600;">Özel havuzunda zaten var</span>
      </div>
      <button data-word="${escAttr(raw)}" onclick="handleWordClick(this)" style="padding:8px 12px;font-size:12px;font-weight:500;border-radius:var(--rsm);cursor:pointer;border:0.5px solid var(--border2);background:var(--surface2);color:var(--text2);">Detayları / ilerlemeyi gör</button>
    </div>`;
  }
  if (matches.length) {
    matches.forEach(w => {
      markLookup(w.word);
      const c = BUILTIN_CONTENT[wkey(w)];
      html += `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:0.5px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <span class="wordfont" style="font-size:22px;">${w.word}</span>${ttsButtonHtml(w.word, w.word)}
          <span style="font-size:12px;color:var(--text3);font-style:italic;">${w.pos}</span>
          ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}
          ${favStarHtml(w)}${contactDotsHtml(w)}
        </div>
        ${c?renderListDefHTML(c,w):'<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}
      </div>`;
    });
  }
  if (topicMatches.length) {
    topicMatches.forEach((w,i) => {
      const cid = 'search-topic-def-' + i;
      const catsHtml = (w.categories&&w.categories.length)?`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">${w.categories.map(cat=>`<span class="c-cat">${cat}</span>`).join('')}</div>`:'';
      html += `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:0.5px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <span class="wordfont" style="font-size:22px;">${w.word}</span>
          <span style="font-size:12px;color:var(--text3);font-style:italic;">${w.pos}</span>
          ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}
          <span style="font-size:10px;color:var(--text3);">Oxford 3000/5000 dışı</span>
        </div>
        ${catsHtml}
        <div id="${cid}" style="margin-top:8px;"><button onclick="loadTopicWordMeaning('${raw.replace(/'/g,"\\'")}', ${i}, '${cid}')" style="padding:8px 12px;font-size:12px;font-weight:500;border-radius:var(--rsm);cursor:pointer;border:0.5px solid var(--accent);color:var(--accent);background:var(--accentbg);">Anlamı getir</button></div>
      </div>`;
    });
  }
  // Türkçe arama: sorgu Türkçe görünüyorsa veya İngilizce karşılığı yoksa,
  // Türkçe→İngilizce ters indekse bak.
  const noEnglishHit = !matches.length && !topicMatches.length && !extraMatches.length && !customMatch;
  const trHits = (looksTurkish(raw) || noEnglishHit) ? trSearch(raw, 40) : [];
  if (trHits.length && (looksTurkish(raw) || noEnglishHit)) {
    html += `<div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:10px;color:#fff;background:var(--accent);padding:3px 9px;border-radius:10px;font-weight:600;">TÜRKÇE ARAMA</span>
      </div>
      ${trResultsHtml(trHits, raw)}
    </div>`;
  }

  if (extraMatches.length) {
    extraMatches.forEach(w => {
      markLookup(w.word);
      const c = BUILTIN_CONTENT[wkey(w)];
      const bands = [w.freq, w.speaking, w.writing].filter(Boolean).join(' · ');
      html += `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:0.5px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <span class="wordfont" style="font-size:22px;">${w.word}</span>${ttsButtonHtml(w.word, w.word)}
          <span style="font-size:12px;color:var(--text3);font-style:italic;">${w.pos || ''}</span>
          ${voaBadgeHtml(w)}
          <span style="font-size:10px;color:var(--warn);background:var(--warnbg);padding:2px 8px;border-radius:10px;font-weight:600;">Ek Havuz</span>
          ${favStarHtml(w)}
        </div>
        ${bands ? `<div style="font-size:11px;color:var(--text3);margin-bottom:8px;">${bands}</div>` : ''}
        ${c && c.definition ? renderListDefHTML(c, w) : extraDefPlaceholder(w)}
      </div>`;
    });
  }
  if (!matches.length && !topicMatches.length && !customMatch && !extraMatches.length && !trHits.length) {
    const suggestions = findWordSuggestions(raw);
    const suggHtml = suggestions.length
      ? `<div style="margin-bottom:12px;">
          <p style="font-size:12px;color:var(--text3);margin:0 0 6px;">Bunu mu demek istediniz?</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${suggestions.map(w =>
            `<span class="chip" onclick="document.getElementById('global-search-input').value='${w.word.replace(/'/g,"\\'")}';performGlobalSearch();" style="cursor:pointer;">${w.word}</span>`
          ).join('')}</div>
        </div>`
      : '';
    html += `<p style="font-size:13px;color:var(--text3);margin-bottom:10px;">"<strong>${raw}</strong>" hiçbir listede bulunamadı — ne İngilizce kelime olarak (Oxford 3000/5000, Konu Kelimeleri, Ek Havuz) ne de Türkçe karşılık olarak.</p>
      ${suggHtml}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 12px;background:var(--surface2);border-radius:var(--rsm);">
        <span style="font-size:13px;flex:1;">Telaffuz + Yeni Kelime olarak eklemek ister misin?</span>
        ${ttsButtonHtml(raw)}
        <button onclick="closeSearchResult();document.getElementById('manual-word-input').value='${raw.replace(/'/g,"\\'")}';document.getElementById('manual-word-input').focus();document.getElementById('manual-word-input').scrollIntoView({behavior:'smooth',block:'center'});" style="padding:8px 12px;font-size:12px;font-weight:500;border-radius:var(--rsm);cursor:pointer;border:0.5px solid var(--accent);color:var(--accent);background:var(--accentbg);white-space:nowrap;">Ekle</button>
      </div>`;
  }
  html += dictButtonsHtml(raw);
  panel.innerHTML = html;
  panel.classList.remove('hidden');
  clearBtn.classList.remove('hidden');
  ttsWireButtons(panel);
}
async function loadTopicWordMeaning(wordLower, idx, containerId) {
  const w = (TOPIC_WORD_MAP[wordLower] || [])[idx];
  const container = document.getElementById(containerId);
  if (!w || !container) return;
  container.innerHTML = '<p style="font-size:13px;color:var(--text3);">Yükleniyor...</p>';
  const c = await fetchContent(w);
  container.innerHTML = renderListDefHTML(c, w);
}
function closeSearchResult() {
  document.getElementById('global-search-input').value='';
  document.getElementById('search-result-panel').classList.add('hidden');
  document.getElementById('search-result-panel').innerHTML='';
  document.getElementById('global-search-clear').classList.add('hidden');
}
document.getElementById('global-search-input').addEventListener('input', performGlobalSearch);
document.getElementById('global-search-input').addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); performGlobalSearch(); } });

function toggleTr(btn) {
  const trDiv = btn.nextElementSibling;
  const showing = trDiv.style.display === 'block';
  trDiv.style.display = showing ? 'none' : 'block';
  btn.classList.toggle('on', !showing);
  const label = btn.querySelector('.tr-toggle-label');
  if (label) label.textContent = showing ? 'Türkçesini gör' : 'Türkçesini gizle';
}

async function fetchContent(w) {
  // Offline-only: live API calls are not possible from a standalone HTML file
  // (cross-origin fetch is rejected by the browser). Use built-in content only.
  const builtinKey = w.word + '|' + w.pos;
  if (BUILTIN_CONTENT[builtinKey]) return BUILTIN_CONTENT[builtinKey];
  return {
    definition: 'Bu kelime için içerik henüz eklenmedi.',
    turkish: '—',
    nuance: 'Bu kelimenin içeriği henüz hazırlanmadı. İlerleyen güncellemelerde eklenecektir.',
    examples: []
  };
}

// Eski "Tekrar Et" ekranının answer() fonksiyonu içindeydi, o ekranla birlikte
// silinmesin diye buraya, paylaşılan bir yardımcıya taşındı — artık Kart
// Modu'nun cmAnswer() fonksiyonu çağırıyor (bkz. proje notu: "streak bug fix").
function markStreakToday() {
  const today = todayStr();
  if (streak.lastDate === today) return;
  streak.lastDate = today;
  const dn = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][new Date().getDay()];
  if (!streak.days.includes(dn)) streak.days.push(dn);
}

function doExport() {
  const data={progress,progressReverse,contentCache,streak,customProgress,customWords,customCache,srsStore,grItemStates,savedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='oxford_progress_'+todayStr()+'.json'; a.click();
}
function triggerImport(){ document.getElementById('file-in').click(); }
function doImport(e){
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      if(d.progress) progress=d.progress;
      if(d.progressReverse) progressReverse=d.progressReverse;
      if(d.contentCache) contentCache=d.contentCache;
      if(d.streak) streak=d.streak;
      if(d.customProgress) customProgress=d.customProgress;
      if(d.customWords) customWords=d.customWords;
      if(d.customCache) customCache=d.customCache;
      if(d.srsStore) srsStore=d.srsStore;
      if(d.grItemStates) grItemStates=d.grItemStates;
      saveState();
      updateDashboard();
      renderCustomWordsList();
      alert(`İlerleme yüklendi! ${Object.keys(progress).length} Oxford + ${Object.keys(progressReverse).length} ters yön + ${Object.keys(customProgress).length} özel kelime kaydı aktarıldı.`);
    } catch{ alert('Dosya okunamadı.'); }
  };
  reader.readAsText(file);
}

// NOT: Burada eskiden "updateDashboard(); updateFilterCount();" şeklinde
// erken bir çağrı vardı. Bu çağrı, srsStore/grItemStates gibi henüz bu
// noktada tanımlanmamış değişkenlere (aşağıda `let` ile bildiriliyorlar)
// dokunan herhangi bir kod eklendiğinde TDZ (temporal dead zone) hatası
// fırlatıp TÜM script'i çökertiyordu — üstelik çıktısı hiçbir zaman
// görünmüyordu (yükleme ekranı overlay'inin arkasında kalıyor, loadState()
// sonrası gerçek updateDashboard() çağrısı tarafından hemen eziliyordu).
// Tamamen gereksiz/tehlikeli olduğu için kaldırıldı — gerçek ilk çizim
// aşağıdaki loadState()+updateDashboard() çağrısıyla yapılıyor (bkz. ~satır 2900).

// ── NEWS & CUSTOM WORD SYSTEM ──────────────────────────────────────────────

// State
let customWords = {};   // key: word.toLowerCase() → {word, addedAt}
let customProgress = {}; // key: word.toLowerCase() → SM-2 data
let favorites = {}; // key: wkey(w) → true

// Herhangi bir kelime kartından (Sözlüğüm, Kelime Listem, Kart Modu, Kelime
// Durumu) doğrudan Öğreniyorum/Biliyorum'a ekleyip çıkarabilme — paylaşılan
// renderListDefHTML içinde gösterilir, tek yerden her ekranı besler.
function progressQuickControlHtml(w) {
  const k = wkey(w);
  const p = progress[k];
  const status = p ? (p.mastery === 'mastered' ? 'known' : 'learning') : null;
  const wa = `'${w.word.replace(/'/g,"\\'")}','${w.pos}'`;
  return `<div style="display:flex;gap:6px;margin-top:4px;">
    <button onclick="event.stopPropagation();quickSetStatus(${wa},false)" class="chip${status==='learning'?' on':''}" style="flex:1;">${ico('repeat')}Öğreniyorum</button>
    <button onclick="event.stopPropagation();quickSetStatus(${wa},true)" class="chip${status==='known'?' on':''}" style="flex:1;">${ico('check')}Biliyorum</button>
    ${status ? `<button onclick="event.stopPropagation();quickRemoveStatus(${wa})" title="Listeden çıkar" class="chip" style="flex:0 0 auto;">✕</button>` : ''}
  </div>`;
}
function quickSetStatus(word, pos, known) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  progress[wkey(w)] = known
    ? { interval:21, easeFactor:2.5, repetitions:4, mastery:'mastered', learned:true, totalKnown:0, totalLearning:0, nextReview:getNextDate(21), lastSeen:todayStr() }
    : { interval:0, easeFactor:2.5, repetitions:0, mastery:'reviewing', learned:false, totalKnown:0, totalLearning:0, nextReview:todayStr(), lastSeen:todayStr() };
  saveState();
  updateDashboard();
  refreshCurrentWordViews();
}
function quickRemoveStatus(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  delete progress[wkey(w)];
  saveState();
  updateDashboard();
  refreshCurrentWordViews();
}
// Durum değiştikten sonra, o an ekranda açık olan liste görünümünü tazeler
// (görünür değilse dokunmaz).
function refreshCurrentWordViews() {
  const listView = document.getElementById('view-list');
  if (listView && !listView.classList.contains('hidden')) {
    if (listMode === 'topic') renderTopicWordGrid();
    else if (listMode === 'favorites') renderFavoritesList();
    else if (listMode === 'struggle') renderStruggleList();
    else renderWordList(listLevel);
  }
  const statusView = document.getElementById('view-status');
  if (statusView && !statusView.classList.contains('hidden')) stRenderList();
}
let contactTrack = {}; // key: kelime (küçük harf) → {read:N, heard:N, used:N} (N = tekrar sayısı)
let lookupCount = {}; // key: kelime (küçük harf) → kaç kez "arandı" (Sözlüğüm/Kelime Listem'de içeriğine bakıldı)
const CONTACT_THRESHOLD = 5; // bu sayıya ulaşınca rozet/nokta tam renge ulaşır
const LOOKUP_STRUGGLE_THRESHOLD = 3; // bu sayıya ulaşıp hâlâ "Biliyorum" değilse "Zorlandıklarım"a girer

// "Arama" — temas takibinden kasıtlı olarak AYRI bir sinyal: temas (okuma/
// dinleme/kullanım) ne kadar çoksa o kadar iyi, ama arama ne kadar çoksa
// (kelime hâlâ "Biliyorum" olmadan) o kadar endişe verici — kelime bir
// türlü oturmuyor demektir. Bu yüzden ayrı bir sayaç ve ayrı bir renk dili.
function markLookup(word) {
  if (!word) return;
  const k = word.toLowerCase();
  lookupCount[k] = (lookupCount[k] || 0) + 1;
  saveState();
}

// Temas takibi — kelimeyle hangi kanaldan kaç kez karşılaştığını (mevcut
// davranışlara "iğneleme" yaparak) sessizce sayar: 'read' (Metin Analizi'nde
// geçti), 'heard' (TTS ile dinlendi), 'used' (Cümle Kur'da o kelime üzerine
// bir egzersiz değerlendirildi). Kelime bazında tutulur, POS'tan bağımsızdır.
// Tek bir temas "öğrenildi" saymaz — renk, eşiğe ulaşana kadar kademeli koyulaşır.
function markContact(word, dim) {
  if (!word) return;
  const k = word.toLowerCase();
  if (!contactTrack[k]) contactTrack[k] = {};
  contactTrack[k][dim] = (contactTrack[k][dim] || 0) + 1;
  saveState();
}
// count → 0..1 arası oran, eşiği aşan sayılar 1'de kırpılır.
function contactRatio(count) {
  return Math.min(count || 0, CONTACT_THRESHOLD) / CONTACT_THRESHOLD;
}

// Kelime Listem / Konu Kelimeleri / Arama satırlarında kullanılan paylaşılan
// favori yıldızı — modal ve Kelime Durumu ile aynı `favorites` deposunu okur.
function favStarHtml(w) {
  const isFav = !!favorites[wkey(w)];
  return `<span onclick="event.stopPropagation();toggleFavFromRow('${w.word.replace(/'/g,"\\'")}','${w.pos.replace(/'/g,"\\'")}')" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;font-size:19px;cursor:pointer;color:${isFav?'#e0a63c':'var(--border2)'};margin-left:10px;flex-shrink:0;">${isFav?'★':'☆'}</span>`;
}
// Kart Modu'ndaki kart için favori yıldızı — liste satırlarındaki favStarHtml
// ile aynı veriyi kullanır ama tam liste yeniden çizimini tetiklemek yerine
// sadece kendi ikonunu günceller (kart o an görünen tek satır, liste değil).
function cardFavStarHtml(w) {
  const isFav = !!favorites[wkey(w)];
  return `<span onclick="event.stopPropagation();cmToggleCardFav('${w.word.replace(/'/g,"\\'")}','${w.pos.replace(/'/g,"\\'")}',this)" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;font-size:21px;cursor:pointer;color:${isFav?'#e0a63c':'var(--border2)'};flex-shrink:0;">${isFav?'★':'☆'}</span>`;
}
function cmToggleCardFav(word, pos, el) {
  const k = word + '|' + pos;
  if (favorites[k]) delete favorites[k]; else favorites[k] = true;
  saveState();
  listUpdatePersonalCounts();
  const isFav = !!favorites[k];
  el.textContent = isFav ? '★' : '☆';
  el.style.color = isFav ? '#e0a63c' : 'var(--border2)';
}
function toggleFavFromRow(word, pos) {
  const k = word + '|' + pos;
  if (favorites[k]) delete favorites[k]; else favorites[k] = true;
  saveState();
  listUpdatePersonalCounts();
  if (listMode === 'oxford') renderWordList(listLevel);
  else if (listMode === 'topic') renderTopicWordGrid();
  else if (listMode === 'favorites') renderFavoritesList();
  else if (listMode === 'struggle') renderStruggleList();
  const searchResultsEl = document.getElementById('list-search-results');
  if (searchResultsEl && !searchResultsEl.classList.contains('hidden')) {
    const raw = document.getElementById('list-search-input').value.trim().toLowerCase();
    renderListSearchResults(raw);
  }
  const globalPanel = document.getElementById('search-result-panel');
  if (globalPanel && !globalPanel.classList.contains('hidden')) performGlobalSearch();
  renderModalFavoriteBtn();
}
let customCache = {};    // key: word.toLowerCase() → {definition,turkish,nuance,examples}
let modalCurrentWord = null; // {word, pos, cefr, speaking, writing, categories, isCustom}
// openWordModal() bazen asenkron (fetchContent bekliyor) — bu bekleme
// sırasında başka bir view'a geçilip closeWordModal() çağrılırsa, GEÇ
// TAMAMLANAN openWordModal() modalı tekrar görünür kılabiliyordu (Erdem'in
// "aynı kelime iki kez görünüyor" bug raporu). Her açma/kapama bu sayacı
// güncelliyor; asenkron kısım kendi jetonunun hâlâ güncel olduğunu
// doğrulamadan içerik göstermiyor.
let modalOpenToken = 0;

// ── BİRLEŞİK SRS DEPOSU (tüm modüller arasında paylaşılan) ──────────────────
// Cümle Genişletme / Adam Asmaca / Telaffuz Asistanı gibi diğer modüller
// kelime/yapı/düzensiz-fiil öğrenme durumunu bu depo üzerinden okuyup yazar.
// Anahtar şeması: word:<kelime>, structure:<tense adı>, verb:<baseform>
// Not: Oxford flashcard kartlarının kendi "progress" deposu (word|pos anahtarlı)
// ayrı kalmaya devam ediyor çünkü aynı kelimenin farklı POS'ları (örn. "compost"
// noun/verb) ayrı kartlar; srsStore ise POS'tan bağımsız, salt kelime/yapı bazlı.
let srsStore = {};

// Grammar modülü — soru bazlı kalıcı durum deposu (gr-state-dots). srsStore'dan
// AYRI tutulur çünkü şekli farklı: srsStore anahtar başına tek obje tutarken,
// burada her alt madde (topicId+subId) için idx→{status,selected,firstWrong}
// şeklinde bir İÇ İÇE obje var. Anahtar: 'gr:'+topicId+':'+subId (grSrsKey ile
// aynı format, ama farklı depoda olduğu için srsStore'daki 'learned' kaydıyla
// çakışmaz). bkz. backlog #11.
let grItemStates = {};

function getSrsEntry(key) {
  return srsStore[key] || null;
}
function setSrsEntry(key, correct) {
  const cur = srsStore[key] || {};
  const next = getNextReview(cur, correct);
  srsStore[key] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
  saveState();
  return srsStore[key];
}

// ── KALICI SAKLAMA (localStorage) ────────────────────────────────────────────
// Önceden ilerleme yalnızca bellekte tutuluyor ve tek kalıcılık yolu manuel
// "Dışa aktar / İçe aktar" idi (sayfa kapanınca/yenilenince veri kaybı riski).
// Artık her cevaptan sonra otomatik olarak localStorage'a yazılıyor; JSON
// dışa/içe aktarma özelliği cihazlar arası taşıma/yedek için ayrıca duruyor.
// Ayarlar ekranındaki "Sürüm: ..." etiketiyle aynı değeri taşır — GitHub'a her
// yükleyişte bunu ve index.html'deki app.js?v=... damgasını birlikte güncelle.
// Bu, bir cihazın hangi sürümü çalıştırdığını tahmin etmeden görmeyi sağlar.
const APP_VERSION = '202608181000';
(function () {
  const el = document.getElementById('app-version-label');
  if (el) el.textContent = 'Sürüm: ' + APP_VERSION;
})();

const STORAGE_KEY = 'oxford_flashcards_state_v1';

// En son ne zaman kaydedildiği (yerel veya buluttan gelen, hangisi daha
// yeniyse) — cloudSyncOnStartup()'ın çakışma çözümünde kullandığı zaman
// damgası. ISO string olduğu için doğrudan string karşılaştırması yeterli.
let lastSavedAt = null;

function saveState() {
  try {
    lastSavedAt = new Date().toISOString();
    const data = { progress, progressReverse, contentCache, streak, customProgress, customWords, customCache, srsStore, favorites, contactTrack, lookupCount, grItemStates, savedAt: lastSavedAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    cloudSaveState(lastSavedAt);
  } catch (e) { /* localStorage dolu veya erişilemez olabilir — sessizce geç */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.progress) progress = d.progress;
    if (d.progressReverse) progressReverse = d.progressReverse;
    if (d.contentCache) contentCache = d.contentCache;
    if (d.streak) streak = d.streak;
    if (d.customProgress) customProgress = d.customProgress;
    if (d.customWords) customWords = d.customWords;
    if (d.customCache) customCache = d.customCache;
    if (d.srsStore) srsStore = d.srsStore;
    if (d.favorites) favorites = d.favorites;
    if (d.contactTrack) contactTrack = d.contactTrack;
    if (d.lookupCount) lookupCount = d.lookupCount;
    if (d.grItemStates) grItemStates = d.grItemStates;
    if (d.savedAt) lastSavedAt = d.savedAt;
    return true;
  } catch (e) { return false; }
}

// ── BULUT SENKRONU (Firestore, backlog #4) ───────────────────────────────────
// Sadece "ilerleme" niteliğindeki alanlar buluta yazılır. contentCache/
// customCache (BYOK API'den üretilen cümle/tanım önbelleği) KASITLI OLARAK
// dışarıda bırakılıyor — para karşılığı üretilen içerik, ayrı ve daha sonraki
// bir backlog maddesinde ele alınacak (bkz. proje_talimati.md).
// Yazma her zaman asenkron ve sessizdir: localStorage zaten birincil/güvenilir
// kayıt yolu olmaya devam ediyor, bulut yazması başarısız olsa bile (offline,
// izin hatası vb.) kullanıcı deneyimi hiç etkilenmiyor — sadece konsola log.
function cloudSyncFields() {
  return { progress, progressReverse, streak, customProgress, customWords, srsStore, favorites, contactTrack, lookupCount, grItemStates };
}
function cloudSaveState(savedAt) {
  try {
    const fs = window.whFirestore;
    const user = window.whCurrentUser;
    if (!fs || !user) return; // Firestore/giriş henüz hazır değil — sessizce geç
    const data = cloudSyncFields();
    data.savedAt = savedAt;
    fs.setDoc(fs.doc(fs.db, 'users', user.uid), data).catch(function (e) {
      console.error('Bulut kaydı başarısız (yerel kayıt etkilenmedi):', e);
    });
  } catch (e) { /* sessizce geç */ }
}

// Açılışta bir kez çalışır: yerel (localStorage, senkron olarak zaten
// yüklendi) ile buluttaki durumu savedAt zaman damgasına göre karşılaştırır,
// hangisi daha yeniyse o kazanır. Ağ isteği beklemeden önce ekran zaten yerel
// veriyle çizilmiş oluyor; bulut daha yeniyse bu fonksiyon arka planda
// state'i güncelleyip ilgili ekranları yeniden çizer.
function cloudSyncOnStartup() {
  try {
    const fs = window.whFirestore;
    const user = window.whCurrentUser;
    if (!fs || !user) return;
    fs.getDoc(fs.doc(fs.db, 'users', user.uid)).then(function (snap) {
      if (!snap.exists()) { cloudSaveState(lastSavedAt || new Date().toISOString()); return; }
      const cloud = snap.data();
      const cloudNewer = !!cloud.savedAt && (!lastSavedAt || cloud.savedAt > lastSavedAt);
      if (!cloudNewer) return; // yerel zaten güncel veya daha yeni, dokunma
      if (cloud.progress) progress = cloud.progress;
      if (cloud.progressReverse) progressReverse = cloud.progressReverse;
      if (cloud.streak) streak = cloud.streak;
      if (cloud.customProgress) customProgress = cloud.customProgress;
      if (cloud.customWords) customWords = cloud.customWords;
      if (cloud.srsStore) srsStore = cloud.srsStore;
      if (cloud.favorites) favorites = cloud.favorites;
      if (cloud.contactTrack) contactTrack = cloud.contactTrack;
      if (cloud.lookupCount) lookupCount = cloud.lookupCount;
      if (cloud.grItemStates) grItemStates = cloud.grItemStates;
      lastSavedAt = cloud.savedAt;
      // localStorage'ı da güncel tut — contentCache/customCache dokunulmadan kalır.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const local = raw ? JSON.parse(raw) : {};
        local.progress = progress; local.progressReverse = progressReverse; local.streak = streak;
        local.customProgress = customProgress; local.customWords = customWords; local.srsStore = srsStore;
        local.favorites = favorites; local.contactTrack = contactTrack; local.lookupCount = lookupCount;
        local.grItemStates = grItemStates; local.savedAt = lastSavedAt;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      } catch (e) { /* sessizce geç */ }
      updateDashboard();
      if (typeof renderCustomWordsList === 'function') renderCustomWordsList();
      if (typeof refreshCurrentWordViews === 'function') refreshCurrentWordViews();
    }).catch(function (e) {
      console.error('Bulut senkronu okunamadı (yerel veriyle devam ediliyor):', e);
    });
  } catch (e) { /* sessizce geç */ }
}

// ── Coach-mark turu (backlog #7) — spotlight + tooltip, her modülde gerçek
// bir elemanı işaret eder. Eski statik "hoş geldin" listesinin yerine. ──────
const TOUR_SEEN_KEY = 'wh_tour_seen_v1';
const TOUR_STEPS = [
  { view: null, selector: () => window.innerWidth >= 1100 ? '.main-nav-wrap' : '#main-menu-toggle',
    title: 'Menü', text: 'Tüm bölümlere buradan ulaşırsın.' },
  { view: 'dash', selector: '#dash-start-btn',
    title: 'Panom', text: 'Günlük çalışmaya buradan başlarsın — hedefe göre halka dolar.' },
  { view: 'cardmode', selector: '#cm-card-area',
    title: 'Kart Modu', text: 'Kartı çevir, sonra Biliyorum / Öğreniyorum seç. Hızlı tekrar için ideal.' },
  { view: 'status', selector: '#st-add-input',
    title: 'Kelime Durumu', text: 'Oxford listesi dışından da kendi kelimeni ekleyebilirsin.' },
  { view: 'news', selector: '#news-panels',
    title: 'Metin Analizi', text: 'Bir metin yapıştır — bildiğin kelimeler seviyeye göre renklensin.' },
  { view: 'wordadd', selector: '#global-search-input',
    title: 'Sözlüğüm', text: 'Günlük kelime arama ekranın — Oxford\'da varsa direkt gösterir.' },
  { view: 'list', selector: '#list-search-input',
    title: 'Kelime Listem', text: 'Oxford, Konu, Favoriler ve Zorlandıkların — hepsi burada, göz atmak için.' },
  { view: 'sentence', selector: '#sg-tense-filter .auto-tense-btn',
    title: 'Cümle Kur', text: 'Varsayılan karışık zamanlarla çalışır — istersen buradan belirli bir zaman seçebilirsin.' },
  { view: 'writing', selector: '#wr-tense-row',
    title: 'Cümle Yaz', text: 'Türkçe cümleyi İngilizce yaz, anında kontrol al.' },
  { view: 'hangman', selector: '#hg-levels',
    title: 'Asmaca', text: 'Kelime bilgini oyunla eğlenceli şekilde test et.' },
  { view: 'grammar', selector: '#gr-search-input',
    title: 'Grammar', text: '397 konu, A1-C2 arası — açıklama, örnek ve kendi kendini test eden sorularla.' },
  { view: 'settings', selector: '#settings-panel-home',
    title: 'Ayarlar', text: 'Buradan uygulamayı ana ekrana ekleyebilir, bu turu tekrar izleyebilirsin.' },
  { view: null, selector: null,
    title: 'Hazırsın!', text: 'İstersen bu turu Ayarlar\'dan istediğin zaman tekrar izleyebilirsin.' }
];
let tourIdx = 0;
function tourStart() {
  tourIdx = 0;
  document.getElementById('tour-overlay').classList.remove('hidden');
  tourShowStep(0);
}
function tourEnd() {
  document.getElementById('tour-overlay').classList.add('hidden');
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch (e) {}
}
function tourNext() {
  if (tourIdx >= TOUR_STEPS.length - 1) { tourEnd(); return; }
  tourIdx++; tourShowStep(tourIdx);
}
function tourBack() {
  if (tourIdx <= 0) return;
  tourIdx--; tourShowStep(tourIdx);
}
function tourShowStep(i) {
  const step = TOUR_STEPS[i];
  if (step.view) showView(step.view);
  requestAnimationFrame(() => requestAnimationFrame(() => tourRenderStep(step, i)));
}
function tourRenderStep(step, i) {
  document.getElementById('tour-step-counter').textContent = `${i + 1} / ${TOUR_STEPS.length}`;
  document.getElementById('tour-tooltip-title').textContent = step.title;
  document.getElementById('tour-tooltip-text').textContent = step.text;
  document.getElementById('tour-back-btn').disabled = (i === 0);
  document.getElementById('tour-next-btn').textContent = (i === TOUR_STEPS.length - 1) ? 'Bitir' : 'Sonraki ›';

  const spot = document.getElementById('tour-spotlight');
  const tip = document.getElementById('tour-tooltip');
  const selector = typeof step.selector === 'function' ? step.selector() : step.selector;
  const target = selector ? document.querySelector(selector) : null;

  if (!target) {
    spot.style.opacity = '0';
    tip.style.top = '50%';
    tip.style.left = '50%';
    tip.style.marginTop = (-tip.offsetHeight / 2) + 'px';
    tip.style.marginLeft = (-tip.offsetWidth / 2) + 'px';
    return;
  }
  tip.style.marginTop = '0';
  tip.style.marginLeft = '0';
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => tourPositionAt(target), 260);
}
function tourPositionAt(target) {
  const spot = document.getElementById('tour-spotlight');
  const tip = document.getElementById('tour-tooltip');
  const r = target.getBoundingClientRect();
  const pad = 8;
  spot.style.opacity = '1';
  spot.style.top = (r.top - pad) + 'px';
  spot.style.left = (r.left - pad) + 'px';
  spot.style.width = (r.width + pad * 2) + 'px';
  spot.style.height = (r.height + pad * 2) + 'px';

  const tipH = tip.offsetHeight, tipW = tip.offsetWidth;
  const spaceBelow = window.innerHeight - r.bottom;
  const placeBelow = spaceBelow > (tipH + 24) || r.top < (tipH + 24);
  tip.style.top = placeBelow ? (r.bottom + pad + 12) + 'px' : Math.max(12, r.top - pad - 12 - tipH) + 'px';
  let left = r.left + r.width / 2 - tipW / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tipW - 12));
  tip.style.left = left + 'px';
}
window.addEventListener('resize', () => {
  const overlay = document.getElementById('tour-overlay');
  if (overlay.classList.contains('hidden')) return;
  const step = TOUR_STEPS[tourIdx];
  const selector = typeof step.selector === 'function' ? step.selector() : step.selector;
  const target = selector ? document.querySelector(selector) : null;
  if (target) tourPositionAt(target);
});
if (!localStorage.getItem(TOUR_SEEN_KEY)) {
  setTimeout(tourStart, 400);
}

loadState();
updateDashboard();
cloudSyncOnStartup();
renderCustomWordsList();
// NOT (backlog #4 sırasında kaldırıldı): Burada eskiden 'beforeunload'/
// 'pagehide' olaylarında da saveState() çağrılıyordu. Bu, İÇERİK
// DEĞİŞMESE BİLE savedAt'i "şimdi"ye güncelliyordu — her sayfa
// yenilemesi/kapanması, bulut senkronunun "son kaydeden kazanır"
// karşılaştırmasını yapay olarak yerel lehine çeviriyordu (gerçek veri
// değişmemiş olsa bile). Her anlamlı state değişikliği zaten kendi
// noktasında saveState() çağırıyor (cevaplama, favori, grammar cevabı
// vb. — bkz. yukarıdaki ~28 çağrı noktası), bu yüzden bu iki listener
// gereksizdi ve veri kaybı riski olmadan kaldırıldı.

// Build Oxford word set for fast lookup
const OXFORD_WORD_SET = new Set(WORD_DATA.map(w => w.word.toLowerCase()));
const OXFORD_WORD_MAP = Object.create(null); // word_lower → array of word objects
WORD_DATA.forEach(w => {
  const k = w.word.toLowerCase();
  if (!OXFORD_WORD_MAP[k]) OXFORD_WORD_MAP[k] = [];
  OXFORD_WORD_MAP[k].push(w);
});
const EXTRA_WORD_SET = new Set(EXTRA_WORDS.map(w => w.word.toLowerCase()));
const EXTRA_WORD_MAP = Object.create(null); // word_lower → array of extra pool word objects
EXTRA_WORDS.forEach(w => {
  const k = w.word.toLowerCase();
  (EXTRA_WORD_MAP[k] || (EXTRA_WORD_MAP[k] = [])).push(w);
});
const TOPIC_WORD_MAP = Object.create(null); // word_lower → array of topic word objects (not in Oxford 3000/5000)
TOPIC_WORDS.forEach(w => {
  const k = w.word.toLowerCase();
  if (!TOPIC_WORD_MAP[k]) TOPIC_WORD_MAP[k] = [];
  TOPIC_WORD_MAP[k].push(w);
});

var activeLevels = new Set(['A1','A2','B1','B2','C1']);

function toggleNewsLevel(lvl) {
  if (lvl === 'all') {
    // Toggle all: if all on → all off except flip, if any off → all on
    var allOn = ['A1','A2','B1','B2','C1'].every(function(l) { return activeLevels.has(l); });
    if (allOn) {
      activeLevels = new Set();
    } else {
      activeLevels = new Set(['A1','A2','B1','B2','C1']);
    }
  } else {
    if (activeLevels.has(lvl)) activeLevels.delete(lvl);
    else activeLevels.add(lvl);
  }
  updateNewsLevelButtons();
  [0,1,2].forEach(function(i) { if (document.getElementById('news-input-'+i).value) analyzePanel(i); });
}

function updateNewsLevelButtons() {
  var allOn = ['A1','A2','B1','B2','C1'].every(function(l) { return activeLevels.has(l); });
  document.querySelectorAll('.news-lvl-chip').forEach(function(b) {
    var lvl = b.dataset.lvl;
    var isOn = lvl === 'all' ? allOn : activeLevels.has(lvl);
    b.classList.toggle('on', isOn);
  });
}

function analyzePanel(idx) {
  var text = document.getElementById('news-input-' + idx).value;
  var output = document.getElementById('news-output-' + idx);
  if (!text.trim()) { output.style.display = 'none'; output.innerHTML = ''; return; }

  var tokens = text.split(/([\s]+|[^\w'\u2018\u2019-]+)/);
  var html = '';
  var oxfordCount = 0;

  tokens.forEach(function(token) {
    var clean = token.toLowerCase().replace(/[^a-z'-]/g, '');
    if (!clean || !/[a-z]/.test(clean)) { html += escHtml(token); return; }
    var oxWords = OXFORD_WORD_MAP[clean];
    var isCustom = !!customWords[clean];
    if (oxWords && oxWords.length) {
      var cefr = oxWords[0].cefr || '';
      var lvlClass = 'news-' + cefr.toLowerCase();
      var prog = getWordProgress(clean);
      var cls = 'news-oxford ' + lvlClass;
      if (prog && prog.mastery === 'mastered') cls += ' learned';
      else if (prog) cls += ' reviewing';
      var show = activeLevels.has(cefr);
      if (!show) cls += ' hidden-lvl';
      else oxfordCount++;
      markContact(clean, 'read');
      html += '<span class="' + cls + '" data-word="' + escAttr(clean) + '" onclick="handleWordClick(this)">' + escHtml(token) + '</span>';
    } else if (isCustom) {
      markContact(clean, 'read');
      html += '<span class="news-custom" data-word="' + escAttr(clean) + '" onclick="handleWordClick(this)">' + escHtml(token) + '</span>';
    } else if (TOPIC_WORD_MAP[clean] && TOPIC_WORD_MAP[clean].length) {
      markContact(clean, 'read');
      html += '<span class="news-topic" data-word="' + escAttr(clean) + '" onclick="handleWordClick(this)" title="Oxford 3000/5000 dışı, konu listesinde">' + escHtml(token) + '</span>';
    } else {
      html += '<span data-word="' + escAttr(clean) + '" onclick="handlePromptClick(this)" title="Oxford listesinde yok" style="cursor:pointer;">' + escHtml(token) + '</span>';
    }
  });

  output.innerHTML = html;
  output.style.display = 'block';
  var countEl = document.getElementById('news-word-count');
  if (countEl) countEl.textContent = oxfordCount > 0 ? oxfordCount + ' Oxford kelime' : '';
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── KART MODU ────────────────────────────────────────────────────────────
// Tekrar Et'in aynı `progress` verisini kullanır (ortak ilerleme), ama basit
// iki-butonlu (Biliyorum/Öğreniyorum) bir akışla, ayrı bir tasarımda sunar.
// Amaç: iki modu da bozmadan yan yana test edebilmek.
// Boş küme = "hiçbir seviye hariç tutulmadı" (tümü dahil). Bu sayede
// varsayılan görünüm Kelime Listem'deki seviye chip'leriyle aynı — hiçbiri
// dolgu almaz, sadece dokunulan seviye daralır. bkz. cmLevelOk().
let cmSelectedLevels = new Set();
let cmSelectedFreq = new Set(['High Frequency','Medium Frequency','Low Frequency']);
// Kart yönü: 'en2tr' (İngilizce göster, Türkçesini hatırla — mevcut/varsayılan
// davranış) veya 'tr2en' (Türkçe göster, İngilizcesini hatırla — üretim
// pratiği). Her yönün kendi SRS kaydı vardır, bkz. cmProgressStore().
let cmDirection = 'en2tr';
function cmProgressStore(dir) { return dir === 'tr2en' ? progressReverse : progress; }
// Oturum büyüklüğü varsayılanı Ayarlar'daki günlük hedeften gelir.
// Kullanıcı oturum içinde başka bir değer seçerse (cmSizeTouched) o değere
// saygı duyulur; Kart Modu'na tekrar girildiğinde yine hedefe döner.
let cmSessionSize = dashGoal();
let cmSizeTouched = false;
let cmQueue = [];
let cmIdx = 0;
let cmHistory = []; // undo için: {key, prevEntry, wasNew}
// Oturum içi gezinme: cmIdx = cevaplanacak sıradaki kart, cmViewIdx = ekranda
// GÖRÜNEN kart. İkisi normalde eşittir; kullanıcı ‹ ile geri gidince cmViewIdx
// küçülür ve cevaplanmış kartlara cevap değiştirmeden bakabilir.
let cmViewIdx = 0;
let cmAnswers = [];   // index → true (Biliyorum) / false (Öğreniyorum)
let cmReviewing = false;  // oturum bittikten sonra kartlara geri dönüldü mü
let cmDone = { known: 0, learning: 0 };

function cmInit() {
  if (!cmSizeTouched) cmSessionSize = dashGoal();
  cmRenderLevels();
  cmRenderFreqFilter();
  cmRenderDirection();
  cmRenderSizeRow();
  cmStart();
}

const CM_DIR_OPTS = [ ['en2tr', 'İngilizce → Türkçe'], ['tr2en', 'Türkçe → İngilizce'] ];
function cmRenderDirection() {
  const row = document.getElementById('cm-dir-row');
  if (!row) return;
  row.innerHTML = CM_DIR_OPTS.map(([key, label]) =>
    `<button class="chip${cmDirection === key ? ' on' : ''}" onclick="cmSetDirection('${key}')">${label}</button>`
  ).join('');
}
function cmSetDirection(dir) {
  if (cmDirection === dir) return;
  cmDirection = dir;
  cmRenderDirection();
  cmStart();
}

function cmRenderLevels() {
  const row = document.getElementById('cm-level-row');
  const levels = ['A1','A2','B1','B2','C1'];
  row.innerHTML = levels.map(lv => {
    const count = WORD_DATA.filter(w => w.cefr === lv && gbPasses(w)).length;
    const disabled = count === 0;
    return `<button class="chip lvl-${lv.toLowerCase()}${cmSelectedLevels.has(lv)?' on':''}${disabled?' disabled':''}" ${disabled?'disabled':`onclick="cmToggleLevel('${lv}')"`}>${lv}<span class="n">(${count})</span></button>`;
  }).join('');
}

// Filtre olarak kullanılacağı her yerde: boş küme = tüm seviyeler geçer.
function cmLevelOk(lv) { return cmSelectedLevels.size === 0 || cmSelectedLevels.has(lv); }

function cmToggleLevel(lv) {
  if (cmSelectedLevels.has(lv)) cmSelectedLevels.delete(lv);
  else cmSelectedLevels.add(lv);
  cmRenderLevels();
  cmRenderFreqFilter();
  cmStart();
}

const CM_FREQ_OPTS = [ ['High Frequency','High'], ['Medium Frequency','Medium'], ['Low Frequency','Low'] ];
function cmRenderFreqFilter() {
  gbMount('cm-band-filters',
          () => WORD_DATA.filter(w => cmLevelOk(w.cefr)),
          () => { cmRenderLevels(); cmRenderFreqFilter(); cmRenderProgress(); });
  if (!document.getElementById('cm-freq-row')) return;   // eski frekans satırı kaldırıldı
  const row = document.getElementById('cm-freq-row');
  if (!row) return;
  if (!row) return;
  // Mevcut seviye seçimiyle hiç eşleşmeyen frekans seçenekleri otomatik pasif olur;
  // seçiliyken pasif hale gelirse (seviye değişince) seçimden de otomatik çıkarılır.
  CM_FREQ_OPTS.forEach(([key]) => {
    const count = WORD_DATA.filter(w => cmLevelOk(w.cefr) && w.freq === key).length;
    if (count === 0 && cmSelectedFreq.has(key) && cmSelectedFreq.size > 1) cmSelectedFreq.delete(key);
  });
  row.innerHTML = CM_FREQ_OPTS.map(([key,label]) => {
    const count = WORD_DATA.filter(w => cmLevelOk(w.cefr) && w.freq === key).length;
    const disabled = count === 0;
    return `<button class="chip${cmSelectedFreq.has(key)?' on':''}${disabled?' disabled':''}" ${disabled?'disabled':`onclick="cmToggleFreq('${key}')"`}>${label}</button>`;
  }).join('');
}

function cmToggleFreq(key) {
  if (cmSelectedFreq.has(key) && cmSelectedFreq.size > 1) cmSelectedFreq.delete(key);
  else cmSelectedFreq.add(key);
  cmRenderFreqFilter();
  cmStart();
}

function cmRenderSizeRow() {
  const row = document.getElementById('cm-size-row');
  const presets = [5, 10, 20, 30];
  row.innerHTML = presets.map(n =>
    `<button class="chip${cmSessionSize===n?' on':''}" onclick="cmSetSize(${n})">${n}</button>`
  ).join('') + `<input id="cm-manual-size" type="number" min="1" max="500" placeholder="Özel" value="${presets.includes(cmSessionSize)?'':cmSessionSize}" oninput="cmSetSizeManual(this.value)" style="width:76px;padding:6px 10px;font-size:13px;border:0.5px solid var(--border2);border-radius:20px;background:var(--surface2);color:var(--text);box-sizing:border-box;text-align:center;">`;
}

// Preset butonları (5/10/20/30) her zaman tam satırı yeniden çizebilir —
// tıklama sırasında odak kaybı riski yok.
function cmSetSize(n) {
  n = parseInt(n, 10);
  if (!n || n < 1) return;
  cmSessionSize = n;
  cmSizeTouched = true;
  cmRenderSizeRow();
  cmStart();
}

// Manuel input alanı yazarken tam satırı (dolayısıyla input DOM node'unu)
// yeniden oluşturmaz — aksi halde her tuş vuruşunda alan odağını/imleç
// pozisyonunu kaybediyor ve iki basamaklı bir sayı (örn. "45") yazmak
// mümkün olmuyordu (her rakamdan sonra alana tekrar dokunmak gerekiyordu).
// Bu yüzden burada sadece preset chip'lerin "on" durumunu güncelliyoruz,
// input elemanına dokunmuyoruz.
function cmSetSizeManual(raw) {
  const n = parseInt(raw, 10);
  if (!n || n < 1) return; // kullanıcı alanı temizlerken/tek basamak yazarken sessizce bekle
  cmSizeTouched = true;
  cmSessionSize = n;
  const row = document.getElementById('cm-size-row');
  if (row) {
    row.querySelectorAll('.chip').forEach(btn => {
      btn.classList.toggle('on', parseInt(btn.textContent, 10) === n);
    });
  }
  cmStart();
}

function cmBuildQueue() {
  const today = todayStr();
  const store = cmProgressStore(cmDirection);
  const pool = WORD_DATA.filter(w => cmLevelOk(w.cefr) && gbPasses(w));
  const due = pool.filter(w => { const p = store[wkey(w)]; return p && p.nextReview <= today; });
  const nw = pool.filter(w => !store[wkey(w)]).slice(0, Math.max(0, cmSessionSize - due.length));
  const combined = [...due, ...nw].slice(0, cmSessionSize);
  // Basit karıştırma — hep aynı sıradan başlamasın
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

function cmStart() {
  cmQueue = cmBuildQueue();
  cmIdx = 0;
  cmViewIdx = 0;
  cmAnswers = [];
  cmReviewing = false;
  cmHistory = [];
  cmDone = { known: 0, learning: 0 };
  cmRenderProgress();
  cmShowCard();
}

function cmRenderProgress() {
  const el = document.getElementById('cm-progress-card');
  const total = cmQueue.length;
  const answered = cmDone.known + cmDone.learning;
  const pct = total ? (answered / total * 100) : 0;
  // Seçilen oturum büyüklüğü (cmSessionSize) sadece bir ÜST SINIR — filtreye
  // (seviye+frekans) uyan kelime sayısı bundan azsa oturum daha kısa olur.
  // Bu durumda "30 seçili ama 20 Kelime yazıyor" gibi açıklamasız bir fark
  // görünmesin diye nedenini kısaca belirtiyoruz.
  const capNote = total < cmSessionSize
    ? ` <span style="font-weight:400;color:var(--text2);">(bu filtrede ${total} kelime var)</span>`
    : '';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <span class="badge" style="background:var(--accentbg);color:var(--accent);">${ico('check',11,'var(--accent)',true)}${cmDone.known} Biliyorum</span>
      <span class="badge" style="background:var(--b2bg);color:var(--b2);">${ico('repeat',11,'var(--b2)',true)}${cmDone.learning} Öğreniyorum</span>
      <span style="font-size:13px;color:var(--text2);font-weight:600;">${total} Kelime${capNote}</span>
    </div>
    <div style="height:8px;border-radius:4px;background:var(--surface2);overflow:hidden;margin-bottom:2px;">
      <div style="height:100%;width:${pct}%;background:var(--a1);border-radius:4px;transition:width .2s;"></div>
    </div>`;
}

async function cmShowCard() {
  const area = document.getElementById('cm-card-area');
  if (cmViewIdx < 0) cmViewIdx = 0;
  if (cmViewIdx >= cmQueue.length) cmViewIdx = Math.max(0, cmQueue.length - 1);
  // Oturum, 10 kartın HEPSİ cevaplandığında biter — kartlar arasında serbestçe
  // gezinildiği için sıraya değil, cevap sayısına bakılır.
  if (cmQueue.length && cmAnsweredCount() >= cmQueue.length && !cmReviewing) {
    // Oturum bitti — bu seviye(ler)de gerçekten başka çalışılacak kelime kalıp
    // kalmadığını kontrol et (tekrar zamanı gelenler + hiç görülmemiş yeniler).
    const today = todayStr();
    const store = cmProgressStore(cmDirection);
    const morePool = WORD_DATA.filter(w => cmLevelOk(w.cefr) && gbPasses(w));
    if (morePool.length === 0) {
      // Filtre kombinasyonunun (seviye+frekans) kendisi hiç kelimeye denk
      // gelmiyor — bu "tebrikler, bitirdin" değil, "bu kombinasyon boş" durumu.
      area.innerHTML = `<div style="text-align:center;padding:40px 16px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Bu seviye + frekans kombinasyonu için kelime yok</div>
        <div style="font-size:13px;color:var(--text2);">Farklı bir seviye veya frekans seç.</div>
      </div>`;
      return;
    }
    const moreDue = morePool.filter(w => { const p = store[wkey(w)]; return p && p.nextReview <= today; });
    const moreNew = morePool.filter(w => !store[wkey(w)]);
    const hasMore = (moreDue.length + moreNew.length) > 0;
    const remaining = moreDue.length + moreNew.length;
    const goal = dashGoal();
    const doneToday = dashTodayCount();
    const goalMet = doneToday >= goal;
    const hardCount = cmDone.learning;

    // Öğrenme açısından en değerli adım, aynı oturumda zorlandığın kelimeleri
    // hemen bir kez daha görmek (test etkisi + aralıklı tekrar). Bu yüzden
    // "zorlandıklarını tekrar et" birincil öneri; yeni liste ikinci sırada.
    const primary = hardCount > 0
      ? `<button onclick="cmRetryHard()" class="cm-answer-btn known" style="flex:0 1 auto;padding:14px 24px;">${ico('repeat',15,'#fff',false)}Zorlandığın ${hardCount} kelimeyi tekrar et →</button>`
      : (hasMore ? `<button onclick="cmStart()" class="cm-answer-btn known" style="flex:0 1 auto;padding:14px 24px;">Yeni ${cmSessionSize} kelime →</button>` : '');

    const advice = goalMet
      ? `Bugünkü hedefini (${goal}) tamamladın. Kısa ve düzenli çalışmak, uzun tek seferlik oturumlardan daha kalıcı — istersen burada bırakabilirsin.`
      : `Bugün ${doneToday}/${goal} kelime yaptın.`;

    area.innerHTML = `<div class="cm-end-card">
      <div style="font-size:30px;margin-bottom:8px;">${hasMore ? (goalMet ? '🎯' : '🎉') : '🏁'}</div>
      <div style="font-size:17px;font-weight:700;margin-bottom:8px;">
        ${hasMore ? `${cmQueue.length} kelimelik oturumu bitirdin` : 'Bu seviye(ler)de çalışılacak kelime kalmadı'}</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:16px;">
        ${cmDone.known} kelimeye "Biliyorum", ${cmDone.learning} kelimeye "Öğreniyorum" dedin.<br>
        ${advice}
        ${hasMore ? `<br><span style="color:var(--text3);">Bu filtrede ${remaining} kelime daha var.</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        ${primary}
        ${(hardCount > 0 && hasMore) ? `<button onclick="cmStart()" class="chip">Yeni ${cmSessionSize} kelime</button>` : ''}
        <button onclick="cmReviewSession()" class="chip">Oturumu gözden geçir</button>
        <button onclick="showView('dash')" class="chip">Bugünlük yeter</button>
      </div>
    </div>`;
    return;
  }
  cmRenderCard(cmQueue[cmViewIdx], 'cmAnswer', true, undefined, undefined, cmDirection);
}

function cmOpenFromList(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  cmRenderCard(w, 'cmAnswerAdhoc', false);
}

// isQueueCard: sıradaki normal kart mı (geri al / bitiş ekranı geçerli), yoksa
// listeden açılan tek seferlik bir inceleme mi.
function cmRenderCard(w, answerFn, isQueueCard, targetId, backFn, dir) {
  targetId = targetId || 'cm-card-area';
  backFn = backFn || 'cmBackToQueue';
  dir = dir || 'en2tr';
  const area = document.getElementById(targetId);
  const k = wkey(w);
  const c = BUILTIN_CONTENT[k];
  const turkish = c ? c.turkish : '';
  const catsHtml = (w.categories && w.categories.length)
    ? `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:14px;">${w.categories.map(cat=>`<span class="c-cat">${cat}</span>`).join('')}</div>`
    : '';
  const wordArg = `'${w.word.replace(/'/g,"\\'")}','${w.pos}'`;
  const answerCall = isQueueCard ? `${answerFn}(` : `${answerFn}(${wordArg},`;
  const backToListBtn = isQueueCard ? '' : `<div style="text-align:center;margin-bottom:14px;"><button onclick="${backFn}()" class="chip">← listeye dön</button></div>`;
  // NOT: #cm-extra/#cm-tr-hidden/#cm-tr-shown ID'leri targetId'e göre
  // benzersizleştiriliyor — aksi halde Kart Modu ve Kelime Durumu aynı anda
  // DOM'da bulunduğu için (biri gizli de olsa) getElementById ilk bulduğu
  // (görünmeyen) örneği güncelliyor, butonlar görünürde çalışmıyormuş gibi duruyordu.
  const extraId = targetId + '-cm-extra';
  const trHiddenId = targetId + '-cm-tr-hidden';
  const trShownId = targetId + '-cm-tr-shown';
  const badgesHtml = `<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>
        ${lfBadgesHtml(w)}${freqBadgeHtml(w)}${voaBadgeHtml(w)}
      </div>`;

  let promptBlock, revealBlock;
  if (dir === 'tr2en') {
    // Türkçe önde: İngilizcesini hatırlamaya çalış. Kelimeyi/telaffuzu ve
    // örnekleri (ki örnekler kelimeyi açık şekilde içerir) reveal'a kadar
    // tamamen gizli tutuyoruz — aksi halde "+ Ek Anlamlar" cevabı ele verir.
    promptBlock = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:11px;color:var(--text3);font-weight:700;letter-spacing:.3px;">TÜRKÇE → İNGİLİZCE</span>
        ${cardFavStarHtml(w)}
      </div>
      <div style="font-size:22px;font-weight:600;color:var(--accent);margin:8px 0 10px;">${turkish || '—'}</div>
      ${badgesHtml}
      ${catsHtml}`;
    revealBlock = `
      <div id="${trHiddenId}" style="margin-bottom:22px;">
        <button onclick="event.stopPropagation();cmRevealTurkish('${targetId}')" class="chip" style="padding:8px 20px;">İngilizcesini gör</button>
      </div>
      <div id="${trShownId}" class="hidden" style="margin-bottom:22px;">
        <div>${ttsButtonHtml(w.word, w.word)}</div>
        <div class="wordfont" style="font-size:24px;margin:6px 0 2px;">${escHtml(w.word)}</div>
        <div style="font-size:13px;color:var(--text3);font-style:italic;margin-bottom:10px;">${w.pos}</div>
        <button onclick="event.stopPropagation();cmToggleExtra('${targetId}')" class="chip">+ Ek Anlamlar</button>
      </div>
      <div id="${extraId}" class="hidden" style="text-align:left;border-top:0.5px solid var(--border);padding-top:16px;margin-bottom:16px;">
        ${c ? renderListDefHTML(c, w) : '<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}
      </div>`;
  } else {
    // Mevcut davranış: İngilizce önde, Türkçesini hatırlamaya çalış.
    promptBlock = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <button onclick="event.stopPropagation();cmToggleExtra('${targetId}')" class="chip">+ Ek Anlamlar</button>
        ${cardFavStarHtml(w)}
      </div>
      <div>${ttsButtonHtml(w.word, w.word)}</div>
      <div class="wordfont" style="font-size:26px;margin:10px 0 2px;">${escHtml(w.word)}</div>
      <div style="font-size:13px;color:var(--text3);font-style:italic;margin-bottom:8px;">${w.pos}</div>
      ${badgesHtml}
      ${catsHtml}`;
    revealBlock = `
      <div id="${trHiddenId}" style="margin-bottom:22px;">
        <button onclick="event.stopPropagation();cmRevealTurkish('${targetId}')" class="chip" style="padding:8px 20px;">Türkçesini gör</button>
      </div>
      <div id="${trShownId}" class="hidden" style="font-size:20px;color:var(--accent);font-weight:600;margin-bottom:22px;">${turkish || '—'}</div>
      <div id="${extraId}" class="hidden" style="text-align:left;border-top:0.5px solid var(--border);padding-top:16px;margin-bottom:16px;">
        ${c ? renderListDefHTML(c, w) : '<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}
      </div>`;
  }

  area.innerHTML = `
    ${backToListBtn}
    <div class="cm-card">
      ${promptBlock}
      ${revealBlock}
      <div class="cm-answer-row">
        <button onclick="${answerCall}false)" class="cm-answer-btn learning">${ico('repeat',15,'var(--b2)',false)}Öğreniyorum</button>
        <button onclick="${answerCall}true)" class="cm-answer-btn known">${ico('check',15,'#fff',false)}Biliyorum</button>
      </div>
    </div>
    ${isQueueCard ? cmNavBarHtml() : ''}`;
  ttsWireButtons(area);
}

// Oturum içi gezinme çubuğu: ‹ Önceki · 3/10 · Sonraki ›
// "Sonraki" yalnızca zaten cevaplanmış bir karta geri dönüldüğünde aktif olur;
// cevaplanmamış kartı atlamak mümkün değil (aksi halde oturum boşlukla dolar).
function cmAnsweredCount() {
  let n = 0;
  for (let i = 0; i < cmQueue.length; i++) if (cmAnswers[i] !== undefined) n++;
  return n;
}

// Verilen konumdan sonraki ilk CEVAPLANMAMIŞ kartı bulur (başa sarar).
function cmNextUnanswered(from) {
  for (let s = 1; s <= cmQueue.length; s++) {
    const i = (from + s) % cmQueue.length;
    if (cmAnswers[i] === undefined) return i;
  }
  return -1;
}

function cmNavBarHtml() {
  const total = cmQueue.length;
  const pos = Math.min(cmViewIdx + 1, total);
  // Serbest gezinme: kullanıcı 10 kartın hepsi arasında dilediği gibi dolaşır,
  // kartı cevaplamış olması gerekmez.
  const canPrev = cmViewIdx > 0;
  const canNext = cmViewIdx < cmQueue.length - 1;
  const answered = cmAnswers[cmViewIdx];
  const badge = (answered === undefined) ? '' :
    `<div style="font-size:11.5px;color:var(--text3);margin-top:8px;">
       Bu karta verdiğin cevap: <b style="color:${answered ? 'var(--accent)' : '#a05000'};">${answered ? 'Biliyorum' : 'Öğreniyorum'}</b> — değiştirmek için tekrar seçebilirsin
     </div>`;

  return `<div style="margin-top:14px;">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;">
      <button class="chip chip-nav" onclick="cmGo(-1)" ${canPrev ? '' : 'disabled'}>‹ Önceki</button>
      <span style="font-size:12px;color:var(--text2);min-width:52px;text-align:center;">${pos} / ${total}</span>
      <button class="chip chip-nav" onclick="cmGo(1)" ${canNext ? '' : 'disabled'}>Sonraki ›</button>
    </div>
    <div style="text-align:center;margin-top:8px;">
      <button onclick="cmUndo()" class="chip chip-nav" ${cmHistory.length ? '' : 'disabled'}>↺ son cevabı geri al</button>
    </div>
    ${badge}
    ${cmReviewing ? `<div style="font-size:11.5px;color:var(--text3);text-align:center;margin-top:8px;">
       Oturumu gözden geçiriyorsun — cevapları değiştirebilirsin.</div>` : ''}
  </div>`;
}

// Oturum bittikten sonra kartları baştan gözden geçirmek için — cevaplar
// korunur, kullanıcı ‹ › ile gezip isterse cevabını değiştirebilir.
// Oturumda "Öğreniyorum" denen kelimelerden yeni bir mini oturum kurar.
// Aralıklı tekrarın en etkili anı, hatanın hemen ardındaki tekrardır.
function cmRetryHard() {
  const hard = cmQueue.filter((w, i) => cmAnswers[i] === false);
  if (!hard.length) { cmStart(); return; }
  cmQueue = hard;
  cmIdx = 0;
  cmViewIdx = 0;
  cmAnswers = [];
  cmHistory = [];
  cmReviewing = false;
  cmDone = { known: 0, learning: 0 };
  cmRenderProgress();
  cmShowCard();
}

function cmReviewSession() {
  if (!cmQueue.length) return;
  cmReviewing = true;
  cmViewIdx = 0;
  cmShowCard();
}

function cmGo(delta) {
  const t = cmViewIdx + delta;
  if (t < 0 || t >= cmQueue.length) return;
  cmViewIdx = t;
  cmShowCard();
}

function cmRevealTurkish(targetId) {
  targetId = targetId || 'cm-card-area';
  document.getElementById(targetId + '-cm-tr-hidden').classList.add('hidden');
  document.getElementById(targetId + '-cm-tr-shown').classList.remove('hidden');
}

function cmBackToQueue() {
  cmShowCard();
}

function cmToggleExtra(targetId) {
  targetId = targetId || 'cm-card-area';
  document.getElementById(targetId + '-cm-extra').classList.toggle('hidden');
}

function cmAnswer(correct) {
  const i = cmViewIdx;
  const w = cmQueue[i], k = wkey(w);
  if (!w) return;
  const store = cmProgressStore(cmDirection);
  const wasNew = !store[k];
  const prev = cmAnswers[i];               // daha önce cevaplanmış mıydı?
  cmHistory.push({ k, dir: cmDirection, prevEntry: store[k] ? { ...store[k] } : null, wasNew, wasKnown: correct, idx: i, prevAnswer: prev });

  const cur = store[k] || {};
  const next = getNextReview(cur, correct);
  store[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };

  if (prev === undefined) {
    if (correct) cmDone.known++; else cmDone.learning++;
  } else if (prev !== correct) {
    // Cevap değiştiriliyor → sayaçları düzelt
    if (correct) { cmDone.known++; cmDone.learning--; }
    else { cmDone.learning++; cmDone.known--; }
  }
  cmAnswers[i] = correct;
  cmIdx = cmAnsweredCount();
  markStreakToday();

  // Sıradaki cevaplanmamış karta geç; kalmadıysa olduğun yerde kal
  // (cmShowCard oturum sonu ekranını gösterecek).
  const nx = cmNextUnanswered(i);
  if (nx !== -1) cmViewIdx = nx;

  saveState();
  cmRenderProgress();
  cmShowCard();
}

// Öğreniyorum listesinden açılan bir kelimeye verilen cevap — normal sıradaki
// kartı/oturum sayaçlarını etkilemez, sadece o kelimenin kendi ilerlemesini
// günceller ve listeyi tazeler.
function cmAnswerAdhoc(word, pos, correct) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  const k = wkey(w);
  const cur = progress[k] || {};
  const next = getNextReview(cur, correct);
  progress[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
  saveState();
  cmRenderProgress();
  cmBackToQueue();
}

function cmUndo() {
  if (!cmHistory.length) return;
  const last = cmHistory.pop();
  const store = cmProgressStore(last.dir || cmDirection);
  if (last.prevEntry) store[last.k] = last.prevEntry;
  else delete store[last.k];

  if (last.prevAnswer === undefined) {
    if (last.wasKnown) cmDone.known--; else cmDone.learning--;
    cmAnswers[last.idx] = undefined;
    cmViewIdx = last.idx;
  } else {
    // Cevap değişikliğini geri alıyoruz → sayaçları eski hâline döndür
    if (last.prevAnswer !== last.wasKnown) {
      if (last.prevAnswer) { cmDone.known++; cmDone.learning--; }
      else { cmDone.learning++; cmDone.known--; }
    }
    cmAnswers[last.idx] = last.prevAnswer;
    cmViewIdx = last.idx;
  }
  cmIdx = cmAnsweredCount();
  cmReviewing = false;
  saveState();
  cmRenderProgress();
  cmShowCard();
}

// ── KELİME DURUMU ────────────────────────────────────────────────────────
// Öğreniyorum/Biliyorum listelerini ayrı, gezinilebilir bir sekmede gösterir.
// Aynı `progress` verisini kullanır (Tekrar Et + Kart Modu ile ortak).
let stTab = 'learning';
// Panom'daki 4 bandın 3'ünü (due/learningNow/knownNow) ayırt edebilmek için
// eklenen iki ek filtre — 'known' sekmesinde stAnswerFilter'ın anlamı yok.
let stAnswerFilter = 'all'; // 'all' | 'learning' | 'known'
let stDueOnly = false;
// bkz. cmSelectedLevels üstündeki not — aynı mantık: boş = tümü dahil.
let stSelectedLevels = new Set();
let stSort = 'az';
let stAddStatusKnown = false;
// Kelime Durumu da Kart Modu'ndaki gibi iki yönü ayrı ayrı gösterebilir —
// aynı progress/progressReverse çiftini okur, bkz. cmProgressStore().
let stDirection = 'en2tr';
function stProgressStore() { return cmProgressStore(stDirection); }

function stInit() {
  document.getElementById('st-card-area').innerHTML = '';
  document.getElementById('st-list').classList.remove('hidden');
  gbMount('st-band-filters',
          () => WORD_DATA.filter(w => stLevelOk(w.cefr)),
          () => { stRenderLevels(); stRenderList(); });
  stRenderLevels();
  stRenderDirection();
  stRenderSort();
  stRenderAnswerFilter();
  const dueBtn = document.getElementById('st-due-chip');
  if (dueBtn) dueBtn.classList.toggle('due-on', stDueOnly);
  stSetTab(stTab);
}

const ST_DIR_OPTS = [ ['en2tr', 'İngilizce → Türkçe'], ['tr2en', 'Türkçe → İngilizce'] ];
function stRenderDirection() {
  const row = document.getElementById('st-dir-row');
  if (!row) return;
  row.innerHTML = ST_DIR_OPTS.map(([key, label]) =>
    `<button class="chip${stDirection === key ? ' on' : ''}" onclick="stSetDirection('${key}')">${label}</button>`
  ).join('');
}
function stSetDirection(dir) {
  if (stDirection === dir) return;
  stDirection = dir;
  stRenderDirection();
  stRenderLevels();
  stRenderList();
}

function stSetTab(tab) {
  stTab = tab;
  if (tab === 'known') stAnswerFilter = 'all'; // known sekmesinde anlamı yok
  document.getElementById('st-tab-learning').classList.toggle('active', tab==='learning');
  document.getElementById('st-tab-known').classList.toggle('active', tab==='known');
  stRenderAnswerFilter();
  stRenderList();
}

// Panom'dan gelen bant tıklamaları stTab/stAnswerFilter/stDueOnly'yi zaten
// ayarlamış oluyor (bkz. dashBandClick) — burada sadece UI'ı o duruma göre çiziyoruz.
function stRenderAnswerFilter() {
  const row = document.getElementById('st-answer-row');
  if (!row) return;
  if (stTab !== 'learning') { row.innerHTML = ''; row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  const opts = [['all','Tümü'],['learning','Öğreniyorum dedin'],['known','Biliyorum dedin']];
  row.innerHTML = opts.map(([v,l]) =>
    `<button class="chip${stAnswerFilter===v?' on':''}" onclick="stSetAnswerFilter('${v}')">${l}</button>`
  ).join('');
}
function stSetAnswerFilter(v) { stAnswerFilter = v; stRenderAnswerFilter(); stRenderList(); }
function stToggleDueOnly() {
  stDueOnly = !stDueOnly;
  const btn = document.getElementById('st-due-chip');
  if (btn) btn.classList.toggle('due-on', stDueOnly);
  stRenderList();
}

function stRenderLevels() {
  const row = document.getElementById('st-level-row');
  const levels = ['A1','A2','B1','B2','C1'];
  row.innerHTML = levels.map(lv => {
    // Sayaç: o seviyede ortak filtreden geçen ve ilerleme kaydı olan kelimeler
    const count = WORD_DATA.filter(w => w.cefr === lv && gbPasses(w) && stProgressStore()[wkey(w)]).length;
    return `<button class="chip lvl-${lv.toLowerCase()}${stSelectedLevels.has(lv)?' on':''}" onclick="stToggleLevel('${lv}')">${lv}<span class="n">(${count})</span></button>`;
  }).join('');
}

function stLevelOk(lv) { return stSelectedLevels.size === 0 || stSelectedLevels.has(lv); }

function stToggleLevel(lv) {
  if (stSelectedLevels.has(lv)) stSelectedLevels.delete(lv);
  else stSelectedLevels.add(lv);
  stRenderLevels();
  stRenderList();
}

function stRenderSort() {
  const row = document.getElementById('st-sort-row');
  const opts = [['az','A→Z'],['recent',ico('clock')+'Son değişen'],['favorite',ico('star')+'Favoriler']];
  row.innerHTML = opts.map(([v,label]) =>
    `<button class="chip${stSort===v?' on':''}" onclick="stSetSort('${v}')">${label}</button>`
  ).join('');
}

function stSetSort(v) {
  stSort = v;
  stRenderSort();
  stRenderList();
}

function stSetAddStatus(known) {
  stAddStatusKnown = known;
  document.getElementById('st-add-learning').classList.toggle('on', !known);
  document.getElementById('st-add-known').classList.toggle('on', known);
}

// "+ Yeni kelime ekle" kutusuna yazarken canlı öneri listesi — kısmi bir
// kelime (örn. "absol") için Oxford listesindeki eşleşen kelimeleri gösterir,
// dokununca kutuya tam kelimeyi yazar.
function stRenderAddSuggestions() {
  const input = document.getElementById('st-add-input');
  const box = document.getElementById('st-add-suggestions');
  const q = input.value.trim().toLowerCase();
  if (q.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const seen = new Set();
  const matches = WORD_DATA.filter(w => {
    const wl = w.word.toLowerCase();
    if (!wl.startsWith(q) || seen.has(wl)) return false;
    seen.add(wl);
    return true;
  }).slice(0, 8);
  if (!matches.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = matches.map(w =>
    `<span class="chip" onclick="stPickAddSuggestion('${w.word.replace(/'/g,"\\'")}')" style="cursor:pointer;">${w.word}</span>`
  ).join('');
}
function stPickAddSuggestion(word) {
  document.getElementById('st-add-input').value = word;
  document.getElementById('st-add-suggestions').classList.add('hidden');
}

function stAddWord() {
  const input = document.getElementById('st-add-input');
  const word = input.value.trim().toLowerCase();
  if (!word) return;
  const matches = WORD_DATA.filter(w => w.word.toLowerCase() === word);
  if (!matches.length) {
    alert(`"${word}" Oxford 3000/5000 listesinde bulunamadı.\n\nOxford dışı kelimeler için Sözlüğüm sekmesini kullan.`);
    return;
  }
  matches.forEach(w => {
    const k = wkey(w);
    stProgressStore()[k] = stAddStatusKnown
      ? { interval:21, easeFactor:2.5, repetitions:4, mastery:'mastered', learned:true, totalKnown:0, totalLearning:0, nextReview:getNextDate(21), lastSeen:todayStr() }
      : { interval:0, easeFactor:2.5, repetitions:0, mastery:'reviewing', learned:false, totalKnown:0, totalLearning:0, nextReview:todayStr(), lastSeen:todayStr() };
  });
  saveState();
  input.value = '';
  document.getElementById('st-add-suggestions').classList.add('hidden');
  stRenderList();

  // Aynı kökü paylaşan, henüz eklenmemiş diğer türemiş formları (örn. allege →
  // allegation, allegedly) bul ve eklemek isteyip istemediğini sor — otomatik
  // zorla eklemiyoruz, sadece öneriyoruz.
  const stem = word.length >= 5 ? word.slice(0, 5) : word;
  const related = WORD_DATA.filter(w => {
    const wl = w.word.toLowerCase();
    return wl !== word && wl.startsWith(stem) && !stProgressStore()[wkey(w)];
  });
  if (related.length) {
    const list = related.map(w => `${w.word} (${w.pos})`).join(', ');
    const status = stAddStatusKnown ? 'Biliyorum' : 'Öğreniyorum';
    if (confirm(`"${word}" eklendi. Aynı kökten gelen başka kelimeler de var: ${list}.\n\nBunları da "${status}" olarak eklemek ister misin?`)) {
      related.forEach(w => {
        const k = wkey(w);
        stProgressStore()[k] = stAddStatusKnown
          ? { interval:21, easeFactor:2.5, repetitions:4, mastery:'mastered', learned:true, totalKnown:0, totalLearning:0, nextReview:getNextDate(21), lastSeen:todayStr() }
          : { interval:0, easeFactor:2.5, repetitions:0, mastery:'reviewing', learned:false, totalKnown:0, totalLearning:0, nextReview:todayStr(), lastSeen:todayStr() };
      });
      saveState();
      stRenderList();
    }
  }
}

function stToggleFavorite(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  const k = wkey(w);
  if (favorites[k]) delete favorites[k]; else favorites[k] = true;
  saveState();
  stRenderList();
}

// Kelime modalından favori aç/kapat — Kelime Durumu listesiyle aynı `favorites`
// deposunu paylaşır, böylece nereden favorilersen favorile aynı yerde görünür.
function modalToggleFavorite() {
  if (!modalCurrentWord) return;
  const k = wkey(modalCurrentWord);
  if (favorites[k]) delete favorites[k]; else favorites[k] = true;
  saveState();
  listUpdatePersonalCounts();
  renderModalFavoriteBtn();
}
function renderModalFavoriteBtn() {
  const el = document.getElementById('modal-fav-btn');
  if (!el || !modalCurrentWord) return;
  const isFav = !!favorites[wkey(modalCurrentWord)];
  el.textContent = isFav ? '★' : '☆';
  el.style.color = isFav ? '#e0a63c' : 'var(--text3)';
}

// Liste satırlarında kullanılan küçük 3-nokta temas göstergesi (Okuma/Dinleme/Kullanım).
// Her nokta, o kanaldaki tekrar sayısına göre açıktan koyuya renk alır.
function contactDotsHtml(w) {
  const c = contactTrack[w.word.toLowerCase()] || {};
  return `<span style="display:inline-flex;gap:3px;margin-left:8px;vertical-align:middle;">${CONTACT_DIMS.map(([dim,label]) => {
    const count = c[dim] || 0;
    const ratio = contactRatio(count);
    const style = ratio > 0
      ? `background:color-mix(in srgb, var(--accent) ${Math.round(ratio*100)}%, var(--surface2));`
      : 'border:1px solid var(--border2);';
    return `<span title="${label}: ${count}/${CONTACT_THRESHOLD}" style="width:7px;height:7px;border-radius:50%;${style}"></span>`;
  }).join('')}</span>`;
}

// Temas takibi rozetleri (paylaşılan bileşen) — renk yoğunluğu tekrar sayısına
// göre kademeli koyulaşır (0/5 = anahat gri, 5/5 = tam aksan rengi). Modal,
// Kart Modu/Kelime Durumu kartı ve Kelime Listem'in genişleyen panelleri
// hepsi bu tek fonksiyonu kullanır — böylece görünüm her yerde birebir aynı.
const CONTACT_DIMS = [ ['read','Okuma','book'], ['heard','Dinleme','headphones'], ['used','Kullanım','repeat'] ];
function contactBadgesHtml(word) {
  const c = contactTrack[word.toLowerCase()] || {};
  return CONTACT_DIMS.map(([dim,label,iconName]) => {
    const count = c[dim] || 0;
    const ratio = contactRatio(count);
    let style;
    if (ratio <= 0) style = 'border:1.5px solid var(--border2);color:var(--text2);font-weight:500;';
    else {
      const bg = `color-mix(in srgb, var(--accent) ${Math.round(ratio*100)}%, var(--surface2))`;
      const fg = ratio >= 0.6 ? '#fff' : 'var(--accent)';
      style = `background:${bg};color:${fg};font-weight:600;`;
    }
    return `<span title="${count}/${CONTACT_THRESHOLD}" style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;padding:5px 12px;border-radius:20px;${style}">${ico(iconName,13,null,false)}${label} ${count}/${CONTACT_THRESHOLD}</span>`;
  }).join('');
}
function renderModalContactRow() {
  const el = document.getElementById('modal-contact-row');
  if (!el || !modalCurrentWord) return;
  el.innerHTML = contactBadgesHtml(modalCurrentWord.word);
}

function stRenderList() {
  const listEl = document.getElementById('st-list');
  const countEl = document.getElementById('st-count-label');
  let items = WORD_DATA
    .filter(w => stLevelOk(w.cefr) && gbPasses(w))
    .map(w => ({ w, p: stProgressStore()[wkey(w)] }))
    .filter(x => x.p && (stTab==='known' ? x.p.mastery==='mastered' : x.p.mastery!=='mastered'))
    .filter(x => stTab!=='learning' || stAnswerFilter==='all' || x.p.lastAnswer===stAnswerFilter)
    .filter(x => !stDueOnly || x.p.nextReview <= todayStr());

  if (stSort==='az') items.sort((a,b) => a.w.word.localeCompare(b.w.word));
  else if (stSort==='recent') items.sort((a,b) => (b.p.lastSeen||'').localeCompare(a.p.lastSeen||''));
  else if (stSort==='favorite') items.sort((a,b) => (favorites[wkey(b.w)]?1:0) - (favorites[wkey(a.w)]?1:0) || a.w.word.localeCompare(b.w.word));

  countEl.textContent = `${items.length} kelime`;

  if (!items.length) {
    listEl.innerHTML = `<p style="font-size:13px;color:var(--text3);text-align:center;padding:24px 0;">Bu filtrelerde kelime yok.</p>`;
    return;
  }
  listEl.innerHTML = items.map(({w,p}) => {
    const k = wkey(w);
    const isFav = !!favorites[k];
    const wordArg = `'${w.word.replace(/'/g,"\\'")}','${w.pos.replace(/'/g,"\\'")}'`;
    return `<div class="st-word-card">
      <div style="cursor:pointer;flex:1;" onclick="stOpenWord(${wordArg})">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:15px;font-weight:700;">${escHtml(w.word)}</span>
          <span style="font-size:11px;color:var(--text3);font-style:italic;">${w.pos}</span>
          <span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>
          ${p.nextReview <= todayStr() ? '<span style="font-size:9.5px;font-weight:700;color:var(--warn);background:var(--warnbg);padding:2px 6px;border-radius:5px;">tekrar zamanı</span>' : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:11.5px;color:var(--text2);white-space:nowrap;display:inline-flex;align-items:center;gap:9px;">${ico('check',12,'#5cb87a',false)}${p.totalKnown||0} ${ico('repeat',12,'#6b9ee0',false)}${p.totalLearning||0}</span>
        <span onclick="stToggleFavorite(${wordArg})" style="font-size:18px;cursor:pointer;color:${isFav?'#e0a63c':'var(--border2)'};">${isFav?'★':'☆'}</span>
        <span onclick="stRemoveWord(${wordArg})" title="Listeden çıkar" style="cursor:pointer;color:var(--text3);">${ico('x',15,'currentColor',false)}</span>
      </div>
    </div>`;
  }).join('');
}

// Bir kelimeyi Öğreniyorum/Biliyorum takibinden tamamen çıkarır (favori ve
// temas geçmişine dokunmadan) — SRS ilerlemesi sıfırlanır, istersen "+ Yeni
// Kelime Ekle" ile tekrar baştan ekleyebilirsin.
function stRemoveWord(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  if (!confirm(`"${word}" kelimesini Öğreniyorum/Biliyorum listesinden çıkarmak istediğine emin misin?`)) return;
  delete stProgressStore()[wkey(w)];
  saveState();
  stRenderList();
  updateDashboard();
}

function stOpenWord(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  document.getElementById('st-list').classList.add('hidden');
  cmRenderCard(w, 'stAnswerWord', false, 'st-card-area', 'stBackToList', stDirection);
}

function stBackToList() {
  document.getElementById('st-card-area').innerHTML = '';
  document.getElementById('st-list').classList.remove('hidden');
  stRenderList();
}

function stAnswerWord(word, pos, correct) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  const k = wkey(w);
  const cur = stProgressStore()[k] || {};
  const next = getNextReview(cur, correct);
  stProgressStore()[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
  saveState();
  stBackToList();
}

function escAttr(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

// ── TELAFFUZ ──────────────────────────────────────────────────────────────
// Önce ElevenLabs (insan sesine yakın, kotalı) dener; herhangi bir sebeple
// başarısız olursa (kota bitti, anahtar yok, ağ hatası) sessizce tarayıcının
// kendi sesine (Web Speech API) düşer — kullanıcı hiçbir zaman "hiç ses
// çıkmadı" durumuyla karşılaşmaz, sadece kalite düşer.
const ELEVENLABS_API_KEY = 'YOUR_API_KEY'; // ← İstersen tüm cihazlar için ortak varsayılan anahtar (opsiyonel, genelde boş bırakılır)
const TTS_USER_KEY_STORAGE = 'userElevenLabsKey';

// Öncelik: kullanıcının kendi girdiği anahtar (bu cihaza özel, localStorage) >
// koddaki ortak varsayılan anahtar > (ikisi de yoksa) Web Speech'e düş.
function ttsGetActiveKey() {
  const userKey = localStorage.getItem(TTS_USER_KEY_STORAGE);
  if (userKey && userKey.trim()) return userKey.trim();
  if (ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'YOUR_API_KEY') return ELEVENLABS_API_KEY;
  return null;
}

function renderTtsStatus() {
  const el = document.getElementById('tts-status-line');
  if (!el) return;
  const hasKey = !!localStorage.getItem(TTS_USER_KEY_STORAGE);
  el.textContent = hasKey
    ? '✅ Kaliteli ses (ElevenLabs) aktif — kendi anahtarınla.'
    : 'Şu an cihazının kendi (mekanik) sesi kullanılıyor. İstersen aşağıya kendi ücretsiz ElevenLabs anahtarını ekleyip daha doğal bir ses elde edebilirsin.';
}

function saveTtsUserKey() {
  const input = document.getElementById('tts-key-input');
  const val = input.value.trim();
  if (!val) { alert('Önce bir anahtar yapıştır.'); return; }
  localStorage.setItem(TTS_USER_KEY_STORAGE, val);
  ttsElevenCache.clear(); // eski anahtarla üretilmiş ses önbelleği geçersiz olsun
  input.value = '';
  renderTtsStatus();
  alert('Kaydedildi! Artık kaliteli ses kullanılacak.');
}

function clearTtsUserKey() {
  localStorage.removeItem(TTS_USER_KEY_STORAGE);
  ttsElevenCache.clear();
  document.getElementById('tts-key-input').value = '';
  renderTtsStatus();
}
const ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // Premade ses (ElevenLabs'ın kendi quickstart örneğinden) — "Voice Library" sesleri ücretsiz planda API'den engelli, bu yüzden kütüphane yerine temel/premade bir ses kullanıyoruz
const ttsElevenCache = new Map(); // metin -> blob URL (oturum boyunca, aynı metin için krediyi tekrar harcamamak için)

async function ttsSpeakElevenLabs(text) {
  const apiKey = ttsGetActiveKey();
  if (!apiKey) {
    throw new Error('ElevenLabs anahtarı ayarlanmamış');
  }
  let url = ttsElevenCache.get(text);
  if (!url) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' })
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch (_) {}
      throw new Error(`ElevenLabs ${res.status}: ${detail || 'detay yok'}`);
    }
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    ttsElevenCache.set(text, url);
  }
  const audioEl = new Audio(url);
  await audioEl.play();
}

let ttsVoicesReady = null;
function ttsGetVoices() {
  if (ttsVoicesReady) return ttsVoicesReady;
  ttsVoicesReady = new Promise(resolve => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) { resolve(existing); return; }
    const onReady = () => { resolve(window.speechSynthesis.getVoices()); };
    window.speechSynthesis.addEventListener('voiceschanged', onReady, { once: true });
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
  });
  return ttsVoicesReady;
}

function ttsPickVoice(voices) {
  return voices.find(v => /Ava/i.test(v.name) && /Enhanced|Premium/i.test(v.name))
    || voices.find(v => /Daniel/i.test(v.name) && /Enhanced|Premium/i.test(v.name))
    || voices.find(v => v.lang === 'en-US' && /Enhanced|Premium/i.test(v.name))
    || voices.find(v => v.lang === 'en-US')
    || voices.find(v => v.lang && v.lang.startsWith('en'))
    || voices[0] || null;
}

function ttsSpeakWebSpeech(text) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) { reject(new Error('speechSynthesis yok')); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.88;
    // NOT: Önceden burada ses listesi (getVoices) asenkron olarak bekleniyordu.
    // iOS Safari'de bu bekleme (özellikle ilk kullanımda) kullanıcı jesti
    // penceresini kapatıyor ve speak() sessizce hiçbir şey çalmadan başarısız
    // oluyordu. Artık senkron olarak elde bulunan ses listesiyle (boş olsa
    // bile tarayıcı varsayılan sesi kullanır) hemen konuşmayı başlatıyoruz.
    const voice = ttsPickVoice(window.speechSynthesis.getVoices());
    if (voice) utter.voice = voice;
    utter.onend = resolve;
    utter.onerror = (e) => reject(new Error(e.error || 'Bilinmeyen ses hatası'));
    window.speechSynthesis.speak(utter);
  });
}

async function ttsSpeak(text, btnEl) {
  if (!text || !text.trim()) return;
  const origLabel = btnEl ? btnEl.innerHTML : null;
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = ico('clock',13,null,false); }
  const hasKey = !!ttsGetActiveKey();
  try {
    if (hasKey) {
      try {
        await ttsSpeakElevenLabs(text);
      } catch (e1) {
        console.warn('ElevenLabs başarısız, Web Speech\'e düşülüyor:', e1.message);
        // GEÇİCİ TEŞHİS: bir kullanıcı anahtarı kayıtlıysa (yani ElevenLabs
        // çalışması BEKLENİYORSA) ama başarısız oluyorsa, sebebi görünür yap —
        // aksi halde neden mekanik sesin çaldığı hiç anlaşılmaz.
        if (localStorage.getItem(TTS_USER_KEY_STORAGE)) {
          alert('ElevenLabs çalışmadı, mekanik sese düşüldü.\n\nGerçek neden: ' + e1.message + '\n\nBu satırı ekran görüntüsüyle paylaş, birlikte bakalım.');
        }
        await ttsSpeakWebSpeech(text);
      }
    } else {
      // Anahtar hiç yoksa ElevenLabs'ı denemeye bile gerek yok — doğrudan
      // cihaz sesine geç, gereksiz gecikmeyi (ve jest penceresi riskini) önle.
      await ttsSpeakWebSpeech(text);
    }
  } catch (e) {
    console.error('TTS hatası:', e);
    alert('Ses oynatılamadı.\n\nTeknik detay: ' + (e && e.message ? e.message : String(e)) + '\n\nBu satırı ekran görüntüsüyle paylaşırsan tam nedeni görebilirim.');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel || ico('speaker',13,null,false); }
  }
}

function ttsButtonHtml(text, contactWord) {
  const attr = contactWord ? ` data-contact-word="${escAttr(contactWord)}"` : '';
  return `<button type="button" class="tts-btn" data-tts-text="${escAttr(text)}"${attr} title="Dinle">${ico('speaker',13,null,false)}</button>`;
}

// Bir konteyner içindeki tüm .tts-btn düğmelerini tıklama olayına bağlar.
// İnnerHTML her yeniden yazıldığında (her render'da) yeniden çağrılmalı.
function ttsWireButtons(container) {
  (container || document).querySelectorAll('.tts-btn[data-tts-text]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      ttsSpeak(btn.dataset.ttsText, btn);
      if (btn.dataset.contactWord) { markContact(btn.dataset.contactWord, 'heard'); renderModalContactRow(); }
    };
  });
}

function handleWordClick(el) {
  var word = el.dataset.word;
  if (word) openWordModal(word);
}
function handlePromptClick(el) {
  var word = el.dataset.word;
  if (word) promptAddCustom(word);
}
function handleRemoveClick(el) {
  var word = el.dataset.word;
  if (word) removeCustomWord(word);
}

function clearPanel(idx) {
  document.getElementById('news-input-' + idx).value = '';
  const out = document.getElementById('news-output-' + idx);
  out.innerHTML = ''; out.style.display = 'none';
}

function promptAddCustom(wordLower) {
  if (customWords[wordLower]) { openWordModal(wordLower); return; }
  if (confirm(`"${wordLower}" Oxford listesinde yok. Özel havuza eklemek ister misin?`)) {
    customWords[wordLower] = { word: wordLower, addedAt: todayStr() };
    renderCustomWordsList();
    // Re-analyze all panels
    [0,1,2].forEach(i => { if (document.getElementById('news-input-'+i).value) analyzePanel(i); });
    openWordModal(wordLower);
  }
}

// ── YAZIM HATASI KONTROLÜ ────────────────────────────────────────────────
// Basit Levenshtein mesafesi — dış servis/API gerektirmez, tamamen yerel.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// Oxford + Konu kelimeleri havuzundan (yaklaşık 19K), girilen kelimeye en
// yakın olanı bulur. Sadece uzunluğu yakın kelimelerle karşılaştırarak
// (±2 harf) hızlı tutuluyor. 1-2 harf farkına kadar "muhtemel yazım hatası"
// sayılır.
const ALL_KNOWN_WORDS_LOWER = Array.from(new Set([...OXFORD_WORD_SET, ...Object.keys(TOPIC_WORD_MAP)]));
function findClosestKnownWord(raw) {
  if (raw.length < 3) return null;
  let best = null, bestDist = Infinity;
  for (const w of ALL_KNOWN_WORDS_LOWER) {
    if (Math.abs(w.length - raw.length) > 2) continue;
    const d = levenshtein(raw, w);
    if (d < bestDist) { bestDist = d; best = w; }
    if (bestDist === 0) break;
  }
  const maxAllowed = raw.length <= 5 ? 1 : 2; // kısa kelimede daha sıkı tolerans
  return (best && bestDist > 0 && bestDist <= maxAllowed) ? best : null;
}

function addManualWord() {
  const input = document.getElementById('manual-word-input');
  const word = input.value.trim().toLowerCase().replace(/[^a-z'-]/g, '');
  if (!word) return;
  if (customWords[word]) { alert(`"${word}" zaten özel havuzda.`); return; }
  if (OXFORD_WORD_SET.has(word)) { alert(`"${word}" Oxford listesinde var. Flashcard bölümünden çalışabilirsin.`); return; }

  const suggestion = findClosestKnownWord(word);
  if (suggestion) {
    const useSuggestion = confirm(`"${word}" bulunamadı — bunu mu demek istedin: "${suggestion}"?\n\nTamam: "${suggestion}" olarak devam et\nİptal: "${word}" kelimesini olduğu gibi ekle`);
    if (useSuggestion) { input.value = suggestion; addManualWord(); return; }
  }

  customWords[word] = { word, addedAt: todayStr() };
  input.value = '';
  saveState();
  renderCustomWordsList();
}

function renderCustomWordsList() {
  const el = document.getElementById('custom-words-list');
  if (!el) return;
  const words = Object.values(customWords);
  if (!words.length) { el.textContent = 'Henüz kelime eklenmedi.'; return; }
  el.innerHTML = words.map(w => {
    const p = customProgress[w.word];
    let status = ico('upcoming',12,null,false);
    if (p) {
      if (p.mastery === 'mastered') status = ico('award',12,'#5cb87a',false);
      else if (p.mastery === 'consolidating') status = ico('trend',12,'#c9a548',false);
      else status = ico('repeat',12,'#6b9ee0',false);
    }
    return `<span style="display:inline-flex;align-items:center;gap:4px;margin:3px 4px;padding:3px 10px;border-radius:20px;background:var(--surface2);font-size:12px;cursor:pointer;" data-word="${escAttr(w.word)}" onclick="handleWordClick(this)">${status} ${w.word} <button type="button" class="tts-btn" style="width:18px;height:18px;font-size:10px;margin-left:0;" data-tts-text="${escAttr(w.word)}" title="Dinle" onclick="event.stopPropagation();">${ico('speaker',11,null,false)}</button><span data-word="${escAttr(w.word)}" onclick="event.stopPropagation();handleRemoveClick(this)" style="color:var(--text3);margin-left:2px;">✕</span></span>`;
  }).join('');
  ttsWireButtons(el);
}

function removeCustomWord(word) {
  if (!confirm(`"${word}" özel havuzdan sil?`)) return;
  delete customWords[word];
  delete customProgress[word];
  delete customCache[word];
  saveState();
  renderCustomWordsList();
}

function getWordProgress(wordLower) {
  // Check Oxford progress first (multiple POS possible)
  const oxWords = OXFORD_WORD_MAP[wordLower] || [];
  for (const w of oxWords) {
    const k = w.word + '|' + w.pos;
    if (progress[k]) return progress[k];
  }
  return null;
}

async function openWordModal(wordLower) {
  const myToken = ++modalOpenToken;
  markLookup(wordLower);
  // Determine if Oxford, topic-list, or custom
  const oxWords = OXFORD_WORD_MAP[wordLower] || [];
  const topicWords = TOPIC_WORD_MAP[wordLower] || [];
  const isCustom = !oxWords.length;

  // Get best word object
  let wordObj;
  if (oxWords.length) {
    // Pick highest frequency one
    const priority = ['S1','S2','S3',''];
    oxWords.sort((a,b) => priority.indexOf(a.speaking) - priority.indexOf(b.speaking));
    wordObj = { ...oxWords[0], isCustom: false };
  } else if (topicWords.length) {
    wordObj = { ...topicWords[0], speaking: '', writing: '', freq: '', isCustom: true };
  } else {
    wordObj = { word: wordLower, pos: '—', cefr: '', speaking: '', writing: '', freq: '', categories: [], isCustom: true };
  }
  modalCurrentWord = wordObj;
  renderModalOtherPos(wordLower, wordObj.pos);
  renderModalFavoriteBtn();
  renderModalContactRow();

  // Show modal inline
  const modal = document.getElementById('word-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'block';
  modal.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('modal-word').innerHTML = escHtml(wordObj.word) + ttsButtonHtml(wordObj.word, wordObj.word);
  ttsWireButtons(document.getElementById('modal-word'));
  document.getElementById('modal-pos').textContent = wordObj.pos;
  document.getElementById('modal-loading').style.display = 'block';
  document.getElementById('modal-content').classList.add('hidden');

  // Badges
  const cefrBadge = document.getElementById('modal-cefr-badge');
  if (wordObj.cefr) {
    cefrBadge.textContent = wordObj.cefr;
    cefrBadge.className = 'modal-badge b-' + wordObj.cefr.toLowerCase();
    cefrBadge.style.display = '';
  } else cefrBadge.style.display = 'none';

  const spBadge = document.getElementById('modal-sp-badge');
  if (wordObj.speaking) { spBadge.textContent = wordObj.speaking; spBadge.className = 'modal-badge b-' + wordObj.speaking.toLowerCase(); spBadge.style.display = ''; }
  else spBadge.style.display = 'none';

  const wrBadge = document.getElementById('modal-wr-badge');
  if (wordObj.writing) { wrBadge.textContent = wordObj.writing; wrBadge.className = 'modal-badge b-' + wordObj.writing.toLowerCase(); wrBadge.style.display = ''; }
  else wrBadge.style.display = 'none';

  const customBadge = document.getElementById('modal-custom-badge');
  customBadge.classList.toggle('hidden', !isCustom || topicWords.length>0);

  // SR status
  const srEl = document.getElementById('modal-sr-status');
  const prog = isCustom ? customProgress[wordLower] : getWordProgress(wordLower);
  if (prog) {
    const statusMap = { reviewing: ico('repeat')+'Tekrarda', consolidating: ico('trend')+'Pekişiyor', mastered: ico('award')+'Tam öğrenildi' };
    const nextReview = prog.nextReview || '—';
    srEl.innerHTML = `${statusMap[prog.mastery] || ico('repeat')} · Sonraki tekrar: ${nextReview} · ${prog.repetitions || 0} tekrar yapıldı`;
    srEl.classList.remove('hidden');
  } else {
    srEl.classList.add('hidden');
  }

  // Action buttons visibility
  const actions = document.getElementById('modal-actions');
  const restartWrap = document.getElementById('modal-restart-wrap');
  if (prog && prog.mastery === 'mastered') {
    actions.style.display = 'none';
    restartWrap.classList.remove('hidden');
  } else {
    actions.style.display = 'flex';
    restartWrap.classList.add('hidden');
  }

  // Fetch or use cache
  const cacheKey = wordLower;
  const cache = isCustom ? customCache : contentCache;
  if (cache[cacheKey]) {
    renderModalContent(cache[cacheKey], wordObj);
  } else {
    // Check built-in content first
    const builtinKey2 = wordObj.word + '|' + wordObj.pos;
    const builtinData = BUILTIN_CONTENT[builtinKey2];
    if (builtinData) {
      cache[cacheKey] = builtinData;
      renderModalContent(builtinData, wordObj);
      return;
    }
    const c = await fetchContent(wordObj);
    if (myToken !== modalOpenToken) return; // arada kapatıldı/başka kelime açıldı — bu sonucu artık gösterme
    cache[cacheKey] = c;
    renderModalContent(c, wordObj);
  }
}

// "Günün Kelimesi" biçimi: bir kelimenin birden fazla türü (isim/fiil/sıfat vb.)
// varsa, ilk (öncelikli) tür zaten üstte gösteriliyor — burada SADECE diğer
// türleri, her biri kendi örnek cümlesi + çevirisi + hoparlör düğmesiyle
// listeler. Fonetik okunuş (ör. "ÇİMPENZİ") KASITLI OLARAK yok — bu gerçek bir
// dilbilimsel üretim gerektiriyor, yerel veriyle güvenilir üretilemez; TTS
// düğmesi zaten gerçek telaffuzu duyuruyor, yanlış olabilecek yazılı tahminden
// daha güvenilir.
function renderModalOtherPos(wordLower, primaryPos) {
  const el = document.getElementById('modal-other-pos');
  if (!el) return;
  const all = [...(OXFORD_WORD_MAP[wordLower] || []), ...(TOPIC_WORD_MAP[wordLower] || [])];
  const seenPos = new Set([primaryPos]);
  const others = all.filter(w => { if (seenPos.has(w.pos)) return false; seenPos.add(w.pos); return true; });
  if (!others.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin:16px 0 8px;">Diğer türleri</div>` +
    others.map(w => {
      const content = BUILTIN_CONTENT[w.word + '|' + w.pos];
      const tr = content && content.turkish ? content.turkish : '—';
      const ex = content && content.examples && content.examples.length ? content.examples[0] : null;
      const exHtml = ex
        ? `<div style="margin-top:6px;"><p style="font-style:italic;font-size:14px;margin:0;">${ex.en}${ttsButtonHtml(ex.en)}</p><p style="font-size:13px;color:var(--text2);margin:2px 0 0;">${ex.tr || ''}</p></div>`
        : '';
      return `<div style="border-left:2px solid var(--a2bg);padding-left:10px;margin-bottom:12px;">
        <div style="font-size:13px;"><b style="text-transform:capitalize;">${w.pos}</b> — ${tr}</div>
        ${exHtml}
      </div>`;
    }).join('');
  ttsWireButtons(el);
}

function renderModalContent(c, wordObj) {
  document.getElementById('modal-loading').style.display = 'none';
  document.getElementById('modal-content').classList.remove('hidden');
  document.getElementById('modal-def').textContent = c.definition || '—';
  document.getElementById('modal-turkish').textContent = c.turkish || '—';

  // Categories
  const catsWrap = document.getElementById('modal-cats-wrap');
  const catsEl = document.getElementById('modal-cats');
  if (wordObj.categories && wordObj.categories.length) {
    catsEl.innerHTML = wordObj.categories.map(cat => `<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--accentbg);color:var(--accent);">${cat}</span>`).join('');
    catsWrap.classList.remove('hidden');
  } else catsWrap.classList.add('hidden');

  // Nuance paragraphs
  const nuanceEl = document.getElementById('modal-nuance');
  const paras = (c.nuance || '—').split('\n\n').filter(p => p.trim());
  nuanceEl.innerHTML = paras.map(p => `<p style="margin-bottom:10px;font-size:14px;line-height:1.65;">${p.trim()}</p>`).join('');

  // Examples with collapsible Turkish
  document.getElementById('modal-examples').innerHTML = (c.examples || []).map((ex, i) => {
    const en = typeof ex === 'object' ? ex.en : ex;
    const tr = typeof ex === 'object' ? ex.tr : null;
    const trHtml = tr ? `<button class="tr-toggle" onclick="toggleTr(this)"><span class="tr-switch"><span class="tr-switch-knob"></span></span><span class="tr-toggle-label">Türkçesini gör</span></button><div class="tr-text">${tr}</div>` : '';
    return `<div style="border-left:2px solid var(--a2bg);padding-left:10px;margin-bottom:10px;"><p style="font-size:14px;font-style:italic;color:var(--text);line-height:1.6;margin:0;">${en}${ttsButtonHtml(en)}</p>${trHtml}</div>`;
  }).join('');
  ttsWireButtons(document.getElementById('modal-examples'));
}

function closeWordModal() {
  modalOpenToken++; // bekleyen openWordModal() asenkron kısımlarını geçersiz kılar
  document.getElementById('word-modal').classList.add('hidden');
  document.getElementById('word-modal').style.display = 'none';
  modalCurrentWord = null;
}

function modalAnswer(correct) {
  if (!modalCurrentWord) return;
  const w = modalCurrentWord;
  const isCustom = w.isCustom;
  const wordLower = w.word.toLowerCase();

  if (isCustom) {
    // Custom havuzu
    const cur = customProgress[wordLower] || {};
    const next = getNextReview(cur, correct);
    customProgress[wordLower] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
    renderCustomWordsList();
  } else {
    // Oxford havuzu — tüm POS varyantlarını güncelle veya en iyi eşleşmeyi
    const k = w.word + '|' + w.pos;
    const cur = progress[k] || {};
    const next = getNextReview(cur, correct);
    progress[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
  }
  saveState();

  // Update SR status display
  const prog = isCustom ? customProgress[wordLower] : getWordProgress(wordLower);
  const srEl = document.getElementById('modal-sr-status');
  if (prog) {
    const statusMap = { reviewing: ico('repeat')+'Tekrarda', consolidating: ico('trend')+'Pekişiyor', mastered: ico('award')+'Tam öğrenildi' };
    srEl.innerHTML = `${statusMap[prog.mastery] || ico('repeat')} · Sonraki tekrar: ${prog.nextReview} · ${prog.repetitions} tekrar yapıldı`;
    srEl.classList.remove('hidden');
  }

  // Check if now mastered
  if (prog && prog.mastery === 'mastered') {
    document.getElementById('modal-actions').style.display = 'none';
    document.getElementById('modal-restart-wrap').classList.remove('hidden');
  }

  // Re-analyze panels to update highlight colors
  [0,1,2].forEach(i => { if (document.getElementById('news-input-'+i).value) analyzePanel(i); });
  updateDashboard();
}

function modalRestart() {
  if (!modalCurrentWord) return;
  if (!confirm('Bu kelimeyi sıfırlayıp tekrar başlamak istiyor musun? Tüm ilerleme silinecek.')) return;
  const w = modalCurrentWord;
  const isCustom = w.isCustom;
  const wordLower = w.word.toLowerCase();
  if (isCustom) {
    delete customProgress[wordLower];
    renderCustomWordsList();
  } else {
    const k = w.word + '|' + w.pos;
    delete progress[k];
  }
  document.getElementById('modal-actions').style.display = 'flex';
  document.getElementById('modal-restart-wrap').classList.add('hidden');
  document.getElementById('modal-sr-status').classList.add('hidden');
  updateDashboard();
}

updateDashboard();

// ── CÜMLE GENİŞLETME (Sentence Expansion) ───────────────────────────────────
// NOT: SG_EXERCISES şu an elle hazırlanmış küçük bir set (8 örnek, A1-B2).
// API tabanlı canlı cümle üretimi + önbellek (bkz. sohbet geçmişi) ayrı bir
// aşamada eklenecek; o aşamada bu sabit set, sgGetPool()'un döndürdüğü havuzun
// yerini API'den + önbellekten gelen havuz alacak, geri kalan mekanik aynı kalır.
const SG_EXERCISES = SENTENCE_EXERCISES; // externalized -> sentence-exercises.json'dan window.SENTENCE_EXERCISES olarak yükleniyor;

const SG_TENSE_CEFR_MAP = {
  "Present Simple": ["A1"],
  "Present Continuous": ["A1", "A2"],
  "Past Simple": ["A1", "A2"],
  "Past Continuous": ["A2", "B1"],
  "Present Perfect": ["B1"],
  "Present Perfect Continuous": ["B2"],
  "Past Perfect": ["B1", "B2"],
  "Past Perfect Continuous": ["C1"],
  "Future Simple": ["A1", "A2"],
  "Future Continuous": ["B2"],
  "Future Perfect": ["B2", "C1"],
  "Future Perfect Continuous": ["C1"]
};

let sgSelectedLevels = new Set(["A1"]);
let sgSelectedFreq = new Set(["High Frequency", "Medium Frequency", "Low Frequency"]);

// Egzersiz kayıtlarında speaking/writing/voa alanı YOK, freq'in de 1.016'sı boş
// (hedef kelime çekimli: works / walking / left). Bantları hedef kelimeden
// kök duyarlı olarak çözüp önbelleğe alıyoruz.
const _sgBandCache = Object.create(null);
function sgExerciseBands(e) {
  const k = e.id || e.targetWord;
  if (_sgBandCache[k]) return _sgBandCache[k];
  const found = gbBandsFor(e.targetWord) || {};
  const rec = {
    speaking: found.speaking || '',
    writing:  found.writing  || '',
    // Egzersizde freq varsa ona güven; yoksa sözlükten gelenle tamamla.
    freq:     e.freq || found.freq || '',
    voa:      !!found.voa
  };
  _sgBandCache[k] = rec;
  return rec;
}
function sgPassesBands(e) { return gbPasses(sgExerciseBands(e)); }
let sgSelectedTenseFilter = null; // null = "Otomatik" (seviyeye göre)
let sgCurrentExercise = null;
let sgTokens = [];
let sgChunkIndex = 0;
let sgWrongCount = 0;
let sgTotalWrongTaps = 0;
let sgVerbResolved = false;
let sgPrepResolved = {};
let sgLastExerciseId = null;

function sgRenderLevels() {
  const el = document.getElementById('sg-levels');
  const all = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const countFor = l => SG_EXERCISES.filter(e => e.cefr === l && sgPassesBands(e) && (!sgSelectedTenseFilter || e.tense === sgSelectedTenseFilter)).length;
  const validLevels = all.filter(l => countFor(l) > 0);
  // Önceden "size > 1" şartı, seçili TEK seviye geçersiz hale gelince onu
  // çıkarmıyordu - sonuç: "seçili ama tıklanamaz, hiç egzersiz yok" diye
  // kilitli kalan bir chip (bkz. rastgele tıklama sonrası ekran görüntüsü).
  // Artık geçersiz olanlar koşulsuz çıkarılıyor; hepsi geçersiz kalırsa
  // (seçim tamamen boşalırsa) geçerli olan TÜM seviyeler otomatik seçiliyor,
  // böylece hiçbir zaman boş/kilitli bir durumda kalınmıyor.
  [...sgSelectedLevels].forEach(l => { if (!validLevels.includes(l)) sgSelectedLevels.delete(l); });
  if (sgSelectedLevels.size === 0) validLevels.forEach(l => sgSelectedLevels.add(l));
  el.innerHTML = all.map(l => {
    const count = countFor(l);
    const disabled = count === 0;
    return `<div class="chip lvl-${l.toLowerCase()}${sgSelectedLevels.has(l) ? ' on' : ''}${disabled?' disabled':''}" data-level="${l}">${l}<span class="n">(${count})</span></div>`;
  }).join('');
  el.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
    chip.onclick = () => {
      const lvl = chip.dataset.level;
      if (sgSelectedLevels.has(lvl) && sgSelectedLevels.size > 1) sgSelectedLevels.delete(lvl);
      else sgSelectedLevels.add(lvl);
      sgRenderLevels();
      sgRenderFreqFilter();
      sgPickExercise();
    };
  });
}

const SG_FREQ_OPTS = [ ['High Frequency','High'], ['Medium Frequency','Medium'], ['Low Frequency','Low'] ];
function sgRenderFreqFilter() {
  gbMount('sg-band-filters',
          () => SG_EXERCISES.filter(e => !sgSelectedTenseFilter || e.tense === sgSelectedTenseFilter)
                            .map(sgExerciseBands),
          () => { sgRenderLevels(); sgRenderFreqFilter(); });
  if (!document.getElementById('sg-freq-filter')) return;   // eski frekans satırı kaldırıldı
  const el = document.getElementById('sg-freq-filter');
  if (!el) return;
  // Mevcut seviye + yapı (tense) seçimiyle hiç eşleşmeyen frekanslar pasif
  // olur; seçiliyken pasif hale gelirse (seviye/yapı değişince) seçimden de
  // otomatik çıkarılır.
  SG_FREQ_OPTS.forEach(([key]) => {
    const count = SG_EXERCISES.filter(e => sgSelectedLevels.has(e.cefr) && e.freq === key && (!sgSelectedTenseFilter || e.tense === sgSelectedTenseFilter)).length;
    // Burada "en az 1 kalsın" şartı yok - freqMatches() zaten boş seçimi
    // "daraltma yok, tümünü göster" olarak yorumluyor, o yüzden koşulsuz
    // çıkarmak güvenli (CEFR'deki gibi kilitlenme riski yok).
    if (count === 0 && sgSelectedFreq.has(key)) sgSelectedFreq.delete(key);
  });
  el.innerHTML = SG_FREQ_OPTS.map(([key,label]) => {
    const count = SG_EXERCISES.filter(e => sgSelectedLevels.has(e.cefr) && e.freq === key && (!sgSelectedTenseFilter || e.tense === sgSelectedTenseFilter)).length;
    const disabled = count === 0;
    return `<div class="chip${sgSelectedFreq.has(key)?' on':''}${disabled?' disabled':''}" data-freq="${key}">${label}</div>`;
  }).join('');
  el.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
    chip.onclick = () => {
      const key = chip.dataset.freq;
      if (sgSelectedFreq.has(key) && sgSelectedFreq.size > 1) sgSelectedFreq.delete(key);
      else sgSelectedFreq.add(key);
      sgRenderFreqFilter();
      sgPickExercise();
    };
  });
}

let sgTenseManualOpen = false;
function sgToggleTenseManual() {
  sgTenseManualOpen = !sgTenseManualOpen;
  sgRenderTenseFilter();
}
function sgRenderTenseFilter() {
  const el = document.getElementById('sg-tense-filter');
  const tenses = [...new Set(SG_EXERCISES.map(e => e.tense))];
  const isAuto = !sgSelectedTenseFilter;
  const activeLabel = isAuto ? 'Otomatik' : sgSelectedTenseFilter;
  const gridHtml = sgTenseManualOpen ? `<div class="tense-grid">${tenses.map(t => {
    const active = t === sgSelectedTenseFilter;
    return `<button class="tense-chip ${active ? 'active' : ''}" data-tense="${t}">${t}</button>`;
  }).join('')}</div>` : '';
  el.innerHTML = `
    <div class="auto-tense-btn ${isAuto ? 'active' : ''}" data-tense="__auto__">
      ${ico('sparkle', 20, isAuto ? '#fff' : 'var(--a1)', false)}
      <span class="auto-tense-txt">
        <div class="auto-tense-title">${activeLabel}</div>
        <div class="auto-tense-sub">${isAuto ? 'Seviyene göre karışık zamanlar' : 'Manuel seçildi'}</div>
      </span>
      <button class="auto-tense-toggle" onclick="event.stopPropagation();sgToggleTenseManual();">${sgTenseManualOpen ? 'Gizle ⌃' : 'Belirli bir zaman seç ›'}</button>
    </div>
    ${gridHtml}`;
  el.querySelector('.auto-tense-btn').onclick = (e) => {
    if (e.target.classList.contains('auto-tense-toggle')) return;
    sgSelectedTenseFilter = null;
    sgRenderTenseFilter();
    sgRenderLevels();
    sgRenderFreqFilter();
    sgPickExercise();
  };
  el.querySelectorAll('.tense-chip').forEach(chip => {
    chip.onclick = () => {
      sgSelectedTenseFilter = chip.dataset.tense;
      sgRenderTenseFilter();
      sgRenderLevels();
      sgRenderFreqFilter();
      sgPickExercise();
    };
  });
}

let sgSourceFilters = new Set(); // 'learning' | 'favorites' | 'struggle' — boşsa filtre uygulanmaz
const SG_SOURCE_OPTS = [ ['learning',ico('repeat')+'Öğreniyorum'], ['favorites',ico('star')+'Favoriler'], ['struggle',ico('alert')+'Zorlandıklarım'] ];
function sgRenderSourceFilter() {
  const el = document.getElementById('sg-source-filter');
  el.innerHTML = SG_SOURCE_OPTS.map(([key,label]) =>
    `<div class="chip${sgSourceFilters.has(key)?' on':''}" data-key="${key}">${label}</div>`
  ).join('');
  el.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      const key = chip.dataset.key;
      if (sgSourceFilters.has(key)) sgSourceFilters.delete(key); else sgSourceFilters.add(key);
      sgRenderSourceFilter();
      sgPickExercise();
    };
  });
}
// Bir egzersiz kelimesinin (targetWord/vocabWord — POS taşımaz) seçili
// kaynak filtrelerinden en az birine uyup uymadığını kontrol eder.
function sgWordMatchesSource(wordStr) {
  const wl = wordStr.toLowerCase();
  const entries = WORD_DATA.filter(w => w.word.toLowerCase() === wl);
  if (!entries.length) return false;
  return entries.some(w => {
    const k = wkey(w);
    const p = progress[k];
    if (sgSourceFilters.has('learning') && p && p.mastery !== 'mastered') return true;
    if (sgSourceFilters.has('favorites') && favorites[k]) return true;
    if (sgSourceFilters.has('struggle')) {
      const n = lookupCount[wl] || 0;
      if (n >= LOOKUP_STRUGGLE_THRESHOLD && !(p && p.mastery === 'mastered')) return true;
    }
    return false;
  });
}
function sgExerciseWords(ex) {
  const words = [ex.targetWord];
  ex.chunks.forEach(c => { if (c.vocabWord) words.push(c.vocabWord); });
  return words;
}

function sgGetPool() {
  // Önceden tense filtresi (belirli bir GRAMER YAPISI seçince) CEFR
  // filtresini TAMAMEN devre dışı bırakıyordu ("? :" - ya biri ya öteki).
  // CEFR pilleri ekranda seçili görünmeye devam ediyor ama hiç uygulanmıyordu
  // - "A2 seçtim ama C1 çıktı" şaşkınlığının asıl sebebi buydu. Artık ikisi
  // birlikte (VE) uygulanıyor; bu da bazı kombinasyonları (örn. A2 + Past
  // Perfect Continuous, matematiksel olarak imkansız çünkü o yapı zaten
  // her zaman C1'e denk gelir) boş bırakabilir - bu yüzden sgRenderLevels
  // artık tense filtresini de hesaba katarak uyumsuz CEFR pillerini
  // otomatik soluklaştırıyor (aşağıya bkz).
  let pool = SG_EXERCISES.filter(e => sgSelectedLevels.has(e.cefr));
  if (sgSelectedTenseFilter) pool = pool.filter(e => e.tense === sgSelectedTenseFilter);
  pool = pool.filter(sgPassesBands);
  if (sgSourceFilters.size) pool = pool.filter(e => sgExerciseWords(e).some(w => sgWordMatchesSource(w)));
  return pool;
}

function sgExerciseTrackableKeys(ex) {
  const keys = [`structure:${ex.tense}`, `word:${ex.targetWord}`];
  ex.chunks.forEach(c => { if (c.vocabWord) keys.push(`word:${c.vocabWord}`); });
  if (ex.verbConjugation && ex.verbConjugation.irregular) keys.push(`verb:${ex.verbConjugation.baseForm}`);
  return keys;
}

function sgComputeExercisePriority(ex) {
  const today = todayStr();
  let score = 0;
  sgExerciseTrackableKeys(ex).forEach(k => {
    const st = getSrsEntry(k);
    if (!st) { score += 2; return; }
    if (st.learned) return;
    // "structure:<tense>" anahtarı YÜZLERCE farklı cümle arasında paylaşılıyor
    // (örn. tüm Past Simple egzersizleri aynı anahtarı kullanıyor). Bu anahtara
    // da "due" bonusu uygulanırsa, bir yapı bir kez "due" olduğunda o yapıyı
    // paylaşan TÜM cümleler aynı anda öne fırlıyor ve seçim tek bir zamanda
    // kilitleniyor (bildirilen "A2'de hep Past Simple çıkıyor" sorunu). Kelime/
    // fiil anahtarları her egzersizde benzersiz olduğundan sorun yaratmıyor —
    // sadece paylaşılan yapı anahtarının "due" bonusunu devre dışı bırakıyoruz.
    // srsStore'a ne yazıldığını/Tekrar Et'in ne okuduğunu değiştirmiyor, sadece
    // Cümle Kur'un bir sonraki egzersizi seçerken bu anahtarı nasıl tarttığını.
    if (k.startsWith('structure:')) return;
    if (st.nextReview && st.nextReview <= today) score += 3;
  });
  return score;
}

function sgPickExercise() {
  const pool = sgGetPool();
  if (pool.length === 0) {
    const msg = sgSourceFilters.size
      ? 'Bu seçime uyan (kaynak filtresi + seviye) bir egzersiz henüz yok.'
      : 'Bu seviye(ler) için henüz egzersiz yok.';
    document.getElementById('sg-content').innerHTML =
      `<div class="sg-card"><div class="sg-empty">${msg}</div></div>`;
    return;
  }
  // İKİ AŞAMALI SEÇİM: önce havuzdaki YAPILARDAN (tense) birini eşit
  // olasılıkla seçiyoruz, sonra sadece O YAPI içinde SRS önceliğine göre
  // cümleyi seçiyoruz. Eskiden tüm havuz tek seferde puanlanıp en yükseği
  // seçiliyordu — puan "kaç farklı kelime anahtarı var"a bağlı olduğundan,
  // daha çok chunk/kelime içeren cümleler sistematik olarak kayırılıyor,
  // bu da belli bir yapının (örn. Past Simple) her zaman aynı seçilmesine
  // yol açıyordu (bkz. "hangi frekansı seçersem hep aynı yapı çıkıyor"
  // bildirimi). Yapı seçimini önce ve kelime-zenginliğinden bağımsız
  // yapmak bu önyargıyı ortadan kaldırıyor.
  const tenses = [...new Set(pool.map(e => e.tense))];
  const chosenTense = tenses[Math.floor(Math.random() * tenses.length)];
  let candidates = pool.filter(e => e.tense === chosenTense);
  if (candidates.length > 1) candidates = candidates.filter(e => e.id !== sgLastExerciseId);

  const scored = candidates.map(e => ({ e, score: sgComputeExercisePriority(e) }));
  const maxScore = Math.max(...scored.map(s => s.score));
  const topCandidates = maxScore > 0 ? scored.filter(s => s.score === maxScore).map(s => s.e) : candidates;

  sgCurrentExercise = topCandidates[Math.floor(Math.random() * topCandidates.length)];
  sgLastExerciseId = sgCurrentExercise.id;
  sgTokens = [...sgCurrentExercise.root];
  sgChunkIndex = 0;
  sgWrongCount = 0;
  sgTotalWrongTaps = 0;
  sgVerbResolved = false;
  sgPrepResolved = {};
  sgRenderExercise();
}

function sgShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SG_ROLE_COLORS = ['a1', 'a2', 'b1', 'b2', 'accent'];
function sgRoleColorClass(role) {
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) % 997;
  return SG_ROLE_COLORS[hash % SG_ROLE_COLORS.length];
}

const SG_TENSE_USAGE = {
  'Present Simple': 'Genel doğrular, alışkanlıklar ve rutinler için kullanılır. "Her gün/genellikle/asla" gibi zarflarla sık görülür.',
  'Past Simple': 'Geçmişte, belirli bir zamanda başlayıp tamamlanmış eylemler için kullanılır. "Dün/geçen yıl" gibi zarflarla sık görülür.',
  'Present Continuous': 'Şu an gerçekleşmekte olan ya da yakın gelecekte planlanmış eylemler için kullanılır. "Şu anda/şimdi" ile sık görülür.',
  'Future Simple': 'Anlık kararlar, tahminler veya gelecekteki eylemler için kullanılır ("will").',
  'Present Perfect': 'Geçmişte başlayıp etkisi hâlâ süren ya da net zamanı önemli olmayan eylemler için kullanılır ("have/has + V3").',
  'Past Continuous': 'Geçmişte belirli bir anda devam etmekte olan bir eylemi anlatmak için kullanılır, genelde başka bir eylem tarafından kesilir.',
  'Present Perfect Continuous': 'Geçmişte başlayıp hâlâ devam eden, süreklilik ve süre vurgusu olan eylemler için kullanılır.',
  'Past Perfect': 'Geçmişteki bir andan ÖNCE tamamlanmış eylemler için kullanılır — "geçmişin geçmişi" ("had + V3").',
  'Future Continuous': 'Gelecekte belirli bir anda devam ediyor olacak eylemler için kullanılır.',
  'Future Perfect': 'Gelecekteki belirli bir zamana KADAR tamamlanmış olacak eylemler için kullanılır.',
  'Past Perfect Continuous': 'Geçmişteki bir andan önce başlayıp o ana kadar süregelen, süre vurgulu eylemler için kullanılır.',
  'Comparative': 'İki şeyi karşılaştırırken kullanılır ("daha ... -den/dan").',
  'Future Perfect Continuous': 'Gelecekteki belirli bir ana kadar süregelmiş olacak eylemler için kullanılır.',
};

function sgBuildGrammarCard() {
  const entries = [];
  (sgCurrentExercise.rootRoles || []).forEach(r => {
    entries.push({ start: r.idx, role: r.role, text: sgTokens[r.idx] });
  });
  sgCurrentExercise.chunks.forEach((chunk, i) => {
    const range = sgCurrentExercise._insertedRanges[i];
    entries.push({ start: range[0], role: chunk.role, text: chunk.text });
  });
  entries.sort((a, b) => a.start - b.start);
  const rowsHtml = entries.map(e => {
    const cc = sgRoleColorClass(e.role);
    return `<div class="sg-role-row">
      <span class="sg-role-tag sg-role-${cc}">${e.role}</span>
      <span class="sg-role-arrow">→</span>
      <span class="sg-role-word">${e.text}</span>
    </div>`;
  }).join('');
  const usage = SG_TENSE_USAGE[sgCurrentExercise.tense];
  const usageHtml = usage ? `<div class="sg-grammar-usage">${usage}</div>` : '';
  return `
    <div class="sg-grammar-card">
      <div class="sg-grammar-title">${sgCurrentExercise.tenseInfo.name}</div>
      <div class="sg-grammar-formula">${sgCurrentExercise.tenseInfo.formula}</div>
      ${usageHtml}
      <div class="sg-role-list">${rowsHtml}</div>
    </div>`;
}

function sgRenderExercise() {
  const c = document.getElementById('sg-content');
  const totalSteps = sgCurrentExercise.chunks.length;
  const chunksDone = sgChunkIndex >= totalSteps;
  const vc = sgCurrentExercise.verbConjugation;
  const triggerPoint = vc ? (vc.triggerAfterChunk + 1) : -1;
  const needsVerbStage = vc && !sgVerbResolved && sgChunkIndex === triggerPoint;
  const chunkObj = !chunksDone ? sgCurrentExercise.chunks[sgChunkIndex] : null;
  const needsPrepStage = !needsVerbStage && chunkObj && chunkObj.prepositionBlank && sgPrepResolved[sgChunkIndex] === undefined;
  const showGaps = !needsVerbStage && !needsPrepStage && !chunksDone;

  let progressHtml = '<div class="sg-progress">';
  for (let i = 0; i < totalSteps; i++) {
    let cls = i < sgChunkIndex ? 'done' : (i === sgChunkIndex ? 'current' : '');
    progressHtml += `<div class="sg-progress-dot ${cls}"></div>`;
  }
  progressHtml += '</div>';

  // "cefr" alanı kelimenin değil CÜMLENİN zorluğunu gösterir (round-robin
  // ileri zaman bir A2/Medium kelimeyi C1'e taşıyabilir - bkz. build.py notu).
  // Bu ayrım kullanıcı için görünmezse "neden bu kolay kelime C1'de?" kafa
  // karışıklığı yaratıyor, o yüzden yapı ve kelime zorluğunu ayrı gösteriyoruz.
  const sgLvl = (sgCurrentExercise.cefr || '').toLowerCase();
  const sgFreqLabel = { 'High Frequency': 'Sık kullanılan', 'Medium Frequency': 'Orta sıklıkta', 'Low Frequency': 'Az sık kullanılan' }[sgCurrentExercise.freq] || null;
  let sgInfoBar = `<div class="sg-level-bar">
    <span class="badge b-${sgLvl}">Yapı: ${sgCurrentExercise.cefr} (${sgCurrentExercise.tense})</span>`;
  if (sgFreqLabel) {
    sgInfoBar += `<span class="badge sg-word-badge">Kelime: ${sgFreqLabel}</span>`;
  }
  sgInfoBar += `</div>`;

  let sentenceHtml = '<div class="sg-sentence-box">';
  if (showGaps) sentenceHtml += `<span class="sg-gap" data-pos="0"><span class="sg-gap-btn">+</span></span>`;
  sgTokens.forEach((tok, i) => {
    const isChunkWord = sgCurrentExercise._insertedRanges && sgCurrentExercise._insertedRanges.some(r => i >= r[0] && i < r[1]);
    const isVerbWord = vc && i === vc.wordIndex;
    let cls = isChunkWord ? 'sg-chunk-inserted' : '';
    if (isVerbWord && needsVerbStage) cls += ' sg-verb-pending';
    if (isVerbWord && sgVerbResolved) cls += ' sg-verb-resolved';
    let label = tok;
    if (isVerbWord && sgVerbResolved && vc.irregular) label += '<sup class="sg-irr-badge">irr</sup>';
    sentenceHtml += `<span class="sg-word ${cls}">${label}</span>`;
    if (showGaps) sentenceHtml += `<span class="sg-gap" data-pos="${i + 1}"><span class="sg-gap-btn">+</span></span>`;
  });
  sentenceHtml += '</div>';

  let bodyHtml = '';
  if (needsVerbStage) {
    const options = sgShuffle([vc.correctForm, ...vc.distractors]);
    bodyHtml = `
      <div class="sg-tray">
        <div class="sg-tray-label">Zaman zarfına göre fiili doğru seç</div>
        <div class="sg-verb-options">
          ${options.map(o => `<button class="sg-verb-opt" data-form="${o}">${o}</button>`).join('')}
        </div>
      </div>
      <div class="sg-feedback" id="sg-feedback"></div>`;
  } else if (needsPrepStage) {
    const pb = chunkObj.prepositionBlank;
    const options = sgShuffle([pb.correct, ...pb.distractors]);
    bodyHtml = `
      <div class="sg-tray">
        <div class="sg-tray-label">Doğru edatı (preposition) seç: ${pb.template}</div>
        <div class="sg-verb-options">
          ${options.map(o => `<button class="sg-verb-opt" data-prep="${o}">${o}</button>`).join('')}
        </div>
      </div>
      <div class="sg-feedback" id="sg-feedback"></div>`;
  } else if (!chunksDone) {
    const resolvedText = sgPrepResolved[sgChunkIndex] !== undefined ? sgPrepResolved[sgChunkIndex] : chunkObj.text;
    bodyHtml = `
      <div class="sg-tray">
        <div class="sg-tray-label">Yerleştirilecek parça</div>
        <div class="sg-chunk-pill">${resolvedText}</div>
      </div>
      <div class="sg-feedback" id="sg-feedback"></div>`;
  } else {
    const fullSentence = sgTokens.join(' ');
    const grammarHtml = sgCurrentExercise.tenseInfo ? sgBuildGrammarCard() : '';
    bodyHtml = `
      <div class="sg-feedback right">Tamamlandı!</div>
      ${grammarHtml}
      <div style="margin-top:14px;">
        <div class="sg-sentence-recap">${fullSentence}${ttsButtonHtml(fullSentence)}</div>
        <div style="font-size:13px;color:var(--text2);margin:10px 0 6px;">Şimdi Türkçe çevirisini yaz:</div>
        <input class="sg-tr-input" id="sg-tr-input" placeholder="Cümlenin Türkçesi...">
        <button class="sg-btn sg-btn-primary" id="sg-check-tr">Kontrol Et</button>
      </div>
      <div id="sg-tr-result"></div>`;
  }

  c.innerHTML = `<div class="sg-card">${sgInfoBar}<div class="sg-skip-row"><button class="sg-skip-btn" onclick="sgPickExercise()">${ico('shuffle',13,'var(--accent)',true)}Farklı bir cümle göster</button></div>${progressHtml}${sentenceHtml}${bodyHtml}</div>`;
  ttsWireButtons(c);

  if (needsVerbStage) {
    c.querySelectorAll('.sg-verb-opt').forEach(btn => { btn.onclick = () => sgHandleVerbChoice(btn.dataset.form, btn); });
  } else if (needsPrepStage) {
    c.querySelectorAll('.sg-verb-opt').forEach(btn => { btn.onclick = () => sgHandlePrepChoice(btn.dataset.prep, btn); });
  } else if (!chunksDone) {
    c.querySelectorAll('.sg-gap').forEach(g => { g.onclick = () => sgHandleGapTap(parseInt(g.dataset.pos), g); });
  } else {
    document.getElementById('sg-check-tr').onclick = sgHandleTrCheck;
  }
}

function sgHandleVerbChoice(form, btnEl) {
  const vc = sgCurrentExercise.verbConjugation;
  const fb = document.getElementById('sg-feedback');
  if (form === vc.correctForm) {
    sgTokens[vc.wordIndex] = form;
    sgVerbResolved = true;
    sgRenderExercise();
  } else {
    fb.textContent = 'Bu doğru çekim değil, tekrar dene';
    fb.className = 'sg-feedback wrong';
    sgTotalWrongTaps++;
    btnEl.classList.add('wrong-opt');
    setTimeout(() => btnEl.classList.remove('wrong-opt'), 400);
  }
}

function sgHandlePrepChoice(word, btnEl) {
  const chunk = sgCurrentExercise.chunks[sgChunkIndex];
  const pb = chunk.prepositionBlank;
  const fb = document.getElementById('sg-feedback');
  if (word === pb.correct) {
    sgPrepResolved[sgChunkIndex] = pb.template.replace('___', word);
    sgRenderExercise();
  } else {
    fb.textContent = 'Bu edat doğru değil, tekrar dene';
    fb.className = 'sg-feedback wrong';
    sgTotalWrongTaps++;
    btnEl.classList.add('wrong-opt');
    setTimeout(() => btnEl.classList.remove('wrong-opt'), 400);
  }
}

function sgHandleGapTap(pos, gapEl) {
  const chunk = sgCurrentExercise.chunks[sgChunkIndex];
  const fb = document.getElementById('sg-feedback');
  if (pos === chunk.pos) {
    const chunkText = sgPrepResolved[sgChunkIndex] !== undefined ? sgPrepResolved[sgChunkIndex] : chunk.text;
    const words = chunkText.split(' ');
    if (!sgCurrentExercise._insertedRanges) sgCurrentExercise._insertedRanges = [];
    sgCurrentExercise._insertedRanges = sgCurrentExercise._insertedRanges.map(r =>
      r[0] >= pos ? [r[0] + words.length, r[1] + words.length] : r
    );
    sgCurrentExercise._insertedRanges.push([pos, pos + words.length]);
    sgTokens.splice(pos, 0, ...words);
    sgChunkIndex++;
    sgWrongCount = 0;
    sgRenderExercise();
  } else {
    sgWrongCount++;
    sgTotalWrongTaps++;
    fb.textContent = sgWrongCount >= 2 ? 'İpucu: cümlenin en mantıklı yerini düşün (genelde sona doğru eklenir)' : 'Yanlış yer, tekrar dene';
    fb.className = 'sg-feedback wrong';
    if (gapEl) { gapEl.classList.add('wrong'); setTimeout(() => gapEl.classList.remove('wrong'), 400); }
  }
}

// rating: 'known' | 'partial' | 'unknown' — mevcut SM-2 (getNextReview) motorunu kullanır.
// 'partial' aralığı ilerletmez/geriletmez, sadece kısa bir süre sonra tekrar sorulmasını sağlar.
function sgScheduleReview(key, rating) {
  if (rating === 'known') return setSrsEntry(key, true);
  if (rating === 'unknown') return setSrsEntry(key, false);
  const cur = getSrsEntry(key) || {};
  const next = {
    interval: cur.interval || 1, easeFactor: cur.easeFactor || 2.5, repetitions: cur.repetitions || 0,
    mastery: cur.mastery || 'reviewing', learned: false,
    nextReview: getNextDate(1), lastSeen: todayStr()
  };
  srsStore[key] = next;
  saveState();
  return next;
}

function sgHandleTrCheck() {
  const ref = sgCurrentExercise.turkish;
  const box = document.getElementById('sg-tr-result');

  const items = [
    { key: `structure:${sgCurrentExercise.tense}`, label: `Cümle kurulumu (${sgCurrentExercise.tense})` },
    { key: `word:${sgCurrentExercise.targetWord}`, label: sgCurrentExercise.targetWord }
  ];
  const seenItemKeys = new Set(items.map(it => it.key));
  sgCurrentExercise.chunks.forEach(chunk => {
    if (chunk.vocabWord) {
      const k = `word:${chunk.vocabWord}`;
      if (!seenItemKeys.has(k)) { seenItemKeys.add(k); items.push({ key: k, label: chunk.vocabWord }); }
    }
  });
  items.forEach(item => { if (item.key.startsWith('word:')) markContact(item.key.slice(5), 'used'); });
  if (sgCurrentExercise.verbConjugation && sgCurrentExercise.verbConjugation.irregular) {
    const vc = sgCurrentExercise.verbConjugation;
    const k = `verb:${vc.baseForm}`;
    if (!seenItemKeys.has(k)) { seenItemKeys.add(k); items.push({ key: k, label: `${vc.correctForm} (düzensiz fiil)` }); }
  }

  const suggestedRating = sgTotalWrongTaps === 0 ? 'known' : (sgTotalWrongTaps <= 2 ? 'partial' : 'unknown');
  const suggestionNote = sgTotalWrongTaps === 0 ? 'Hiç yanlış denemeden tamamladın' : `${sgTotalWrongTaps} yanlış deneme yaptın`;

  const rowsHtml = items.map((item, i) => {
    const isStructure = i === 0;
    return `
    <div class="sg-word-rate-block" id="sg-wrb-${i}">
      <div class="sg-word-rate-label">${item.label}</div>
      ${isStructure ? `<div class="sg-suggestion-note">${suggestionNote} — önerilen: <b>${suggestedRating === 'known' ? 'Bildim' : suggestedRating === 'partial' ? 'Kısmen' : 'Bilemedim'}</b></div>` : ''}
      <div class="sg-rate-row">
        <button class="sg-rate-btn known ${isStructure && suggestedRating === 'known' ? 'suggested' : ''}" data-r="known" data-i="${i}">Bildim</button>
        <button class="sg-rate-btn partial ${isStructure && suggestedRating === 'partial' ? 'suggested' : ''}" data-r="partial" data-i="${i}">Kısmen</button>
        <button class="sg-rate-btn unknown ${isStructure && suggestedRating === 'unknown' ? 'suggested' : ''}" data-r="unknown" data-i="${i}">Bilemedim</button>
      </div>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="sg-tr-reference">Referans: <b>${ref}</b></div>
    <div style="font-size:13px;color:var(--text2);margin:10px 0 8px;">Kelime(ler)i ayrı ayrı değerlendir:</div>
    ${rowsHtml}`;

  let ratedCount = 0;
  box.querySelectorAll('.sg-rate-btn').forEach(b => {
    b.onclick = () => {
      const i = b.dataset.i;
      const item = items[i];
      const result = sgScheduleReview(item.key, b.dataset.r);
      const blockEl = document.getElementById(`sg-wrb-${i}`);
      blockEl.innerHTML = `<div class="sg-word-rate-label">${item.label}</div>
        <div class="sg-rate-done">${result.learned ? '✓ Öğrenildi, aktif tekrardan çıktı' : `✓ Sonraki tekrar: ${result.nextReview}`}</div>`;
      ratedCount++;
      if (ratedCount === items.length) {
        box.innerHTML += `<button class="sg-btn sg-btn-secondary" id="sg-next-btn" style="margin-top:14px;">Sonraki Cümle</button>`;
        document.getElementById('sg-next-btn').onclick = sgPickExercise;
        sgLoadStats();
      }
    };
  });
}

function sgLoadStats() {
  const el = document.getElementById('sg-stats-bar');
  const keys = Object.keys(srsStore);
  if (keys.length === 0) { el.innerHTML = '<p style="text-align:center;font-size:12px;color:var(--text3);font-weight:400;margin:0;">Henüz değerlendirilen kelime/yapı yok</p>'; return; }
  let mastered = 0, due = 0;
  const today = todayStr();
  keys.forEach(k => {
    const st = srsStore[k];
    if (st.learned) mastered++;
    else if (st.nextReview && st.nextReview <= today) due++;
  });
  el.textContent = `${keys.length} öğe takipte (kelime+yapı) · ${mastered} öğrenildi · ${due} tekrar bekliyor`;
}

sgRenderLevels();
sgRenderFreqFilter();
sgRenderTenseFilter();
sgRenderSourceFilter();
sgPickExercise();
sgLoadStats();

// ── ADAM ASMACA (Hangman) ────────────────────────────────────────────────
// Kelime kaynağı: mevcut ALL_CATEGORY_WORDS havuzu (Oxford + Konu kelimeleri,
// zaten dosyada tanımlı). Yalnızca harflerden/boşluk/tire/kesme işaretinden
// oluşan ve makul uzunluktaki girdiler alınır (idiom/abbreviation hariç).
const HG_POOL = ALL_CATEGORY_WORDS.filter(w =>
  w.word && /^[a-zA-Z][a-zA-Z\s'-]*$/.test(w.word) &&
  w.word.length >= 3 && w.word.length <= 16 &&
  w.pos !== 'abbreviation' && w.pos !== 'idiom'
);
const HG_MAX_LIVES = 6;

let hgSelectedLevels = new Set(); // boş = tüm seviyeler
let hgSelectedFreq = new Set(); // boş = tüm frekanslar
let hgCurrentWord = null;
let hgGuessedLetters = new Set();
let hgLives = HG_MAX_LIVES;
let hgHintsUsed = 0;
let hgWrongGuesses = 0;
let hgLastWordKey = null;
let hgGameOver = null; // null | 'won' | 'lost' | 'revealed'
let hgEliminatedLetters = new Set(); // kelimede olmayan, otomatik elenmiş harfler (can gitmez)
let hgHintClues = []; // bu kelime için mevcut ücretsiz anlam ipuçları (cümle/nüans/tanım)
let hgHintCluesShown = 0; // bunlardan kaçı şu ana kadar gösterildi (kademeli, üst üste eklenir)
let hgManualCorrect = 0; // kullanıcının klavyeden KENDİ seçtiği doğru harf sayısı

function hgRenderLevels() {
  const el = document.getElementById('hg-levels');
  const all = ["A1", "A2", "B1", "B2", "C1", "C2"];
  // Mevcut frekans seçimiyle hiç eşleşmeyen seviyeler pasif olur; seçiliyken
  // pasif hale gelirse (frekans değişince) seçimden otomatik çıkarılır.
  all.forEach(l => {
    const count = HG_POOL.filter(w => w.cefr === l && gbPasses(w)).length;
    if (count === 0 && hgSelectedLevels.has(l)) hgSelectedLevels.delete(l);
  });
  el.innerHTML = all.map(l => {
    const count = HG_POOL.filter(w => w.cefr === l && gbPasses(w)).length;
    const disabled = count === 0;
    return `<div class="chip lvl-${l.toLowerCase()}${hgSelectedLevels.has(l) ? ' on' : ''}${disabled?' disabled':''}" data-level="${l}">${l}<span class="n">(${count})</span></div>`;
  }).join('');
  el.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
    chip.onclick = () => {
      const lvl = chip.dataset.level;
      if (hgSelectedLevels.has(lvl)) hgSelectedLevels.delete(lvl); else hgSelectedLevels.add(lvl);
      hgRenderLevels();
      hgRenderFreqFilter();
      hgPickWord();
    };
  });
}

function hgGetPool() {
  let pool = hgSelectedLevels.size === 0 ? HG_POOL : HG_POOL.filter(w => hgSelectedLevels.has(w.cefr));
  pool = pool.filter(gbPasses);
  return pool;
}

const HG_FREQ_OPTS = [ ['High Frequency','High'], ['Medium Frequency','Medium'], ['Low Frequency','Low'] ];
function hgRenderFreqFilter() {
  gbMount('hg-band-filters',
          () => hgSelectedLevels.size === 0 ? HG_POOL : HG_POOL.filter(w => hgSelectedLevels.has(w.cefr)),
          () => { hgRenderLevels(); hgRenderFreqFilter(); });
  if (!document.getElementById('hg-freq-filter')) return;   // eski frekans satırı kaldırıldı
  const el = document.getElementById('hg-freq-filter');
  if (!el) return;
  const levelPool = hgSelectedLevels.size === 0 ? HG_POOL : HG_POOL.filter(w => hgSelectedLevels.has(w.cefr));
  HG_FREQ_OPTS.forEach(([key]) => {
    const count = levelPool.filter(w => w.freq === key).length;
    if (count === 0 && hgSelectedFreq.has(key)) hgSelectedFreq.delete(key);
  });
  el.innerHTML = HG_FREQ_OPTS.map(([key,label]) => {
    const count = levelPool.filter(w => w.freq === key).length;
    const disabled = count === 0;
    return `<div class="chip${hgSelectedFreq.has(key)?' on':''}${disabled?' disabled':''}" data-freq="${key}">${label}</div>`;
  }).join('');
  el.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
    chip.onclick = () => {
      const key = chip.dataset.freq;
      if (hgSelectedFreq.has(key)) hgSelectedFreq.delete(key); else hgSelectedFreq.add(key);
      hgRenderFreqFilter();
      hgPickWord();
    };
  });
}

function hgComputeWordPriority(w) {
  const key = `word:${w.word.toLowerCase()}`;
  const st = getSrsEntry(key);
  if (!st) return 2; // hiç çalışılmamış -> öncelikli
  if (st.learned) return 0; // öğrenilmiş -> öncelik yok
  const today = todayStr();
  return (st.nextReview && st.nextReview <= today) ? 3 : 0;
}

function hgPickWord() {
  const pool = hgGetPool();
  if (pool.length === 0) {
    document.getElementById('hg-content').innerHTML = `<div class="sg-card"><div class="sg-empty">Bu seviye(ler) için kelime yok.</div></div>`;
    return;
  }
  let candidates = pool.length > 1 ? pool.filter(w => (w.word + '|' + w.pos) !== hgLastWordKey) : pool;
  const scored = candidates.map(w => ({ w, score: hgComputeWordPriority(w) }));
  const maxScore = Math.max(...scored.map(s => s.score));
  const top = maxScore > 0 ? scored.filter(s => s.score === maxScore).map(s => s.w) : candidates;

  hgCurrentWord = top[Math.floor(Math.random() * top.length)];
  hgLastWordKey = hgCurrentWord.word + '|' + hgCurrentWord.pos;
  hgGuessedLetters = new Set();
  hgLives = HG_MAX_LIVES;
  hgHintsUsed = 0;
  hgWrongGuesses = 0;
  hgGameOver = null;
  hgHintClues = hgBuildHintClues(hgCurrentWord);
  hgHintCluesShown = 0;
  hgEliminatedLetters = new Set();
  hgManualCorrect = 0;
  hgRenderGame();
}

// Bir kelime için varsa örnek cümle(ler), tanım ve kategori çağrışımından,
// ücretsiz gösterilecek ipuçları havuzunu kurar (hepsi kelimenin kendisi
// maskelenmiş olarak). Havuz boşsa "İpucu" düğmesi baştan pasif olur —
// harf ipucusu (can karşılığı) bundan bağımsız, ayrı bir düğme.
function hgBuildHintClues(w) {
  const content = BUILTIN_CONTENT[w.word + '|' + w.pos];
  const clues = [];
  if (content && content.examples) {
    content.examples.forEach(ex => { if (ex && ex.en) clues.push({ type: 'example', text: hgMaskWordInSentence(ex.en, w.word) }); });
  }
  if (content && content.definition && content.definition.trim()) {
    clues.push({ type: 'definition', text: hgMaskWordInSentence(content.definition, w.word) });
  }
  // NOT: kategori bazlı bir "çağrışım" ipucusu denemiştik ama bu, üstte zaten
  // badge olarak görünen bilgiyi cümleye çevirmekten ibaretti — yeni bilgi
  // katmıyordu, kaldırıldı. Gerçekten özgün çağrışım cümleleri (örn. "ofis
  // ortamında bulunur") üretilmesi gereken içerik — API aşamasına bırakıldı.
  // Aynı kelime SRS ile tekrar geldiğinde ipuçları farklı sırada çıksın diye
  // havuz her seferinde karıştırılıyor (gerçek yeni içerik üretmiyoruz —
  // bu, API'siz yapabileceğimiz dürüst versiyonu).
  return sgShuffle(clues);
}

function hgIsWordComplete() {
  const wordLower = hgCurrentWord.word.toLowerCase();
  for (const ch of wordLower) {
    if (/[a-z]/.test(ch) && !hgGuessedLetters.has(ch)) return false;
  }
  return true;
}

function hgHandleKeyClick(letter) {
  if (hgGameOver) return;
  letter = letter.toLowerCase();
  if (hgGuessedLetters.has(letter)) return;
  hgGuessedLetters.add(letter);
  const wordLower = hgCurrentWord.word.toLowerCase();
  if (wordLower.includes(letter)) {
    hgManualCorrect++;
    hgEliminateRandomLetters(1); // doğru bilince ödül: 1 alakasız harf daha elenir
  } else {
    hgLives--; hgWrongGuesses++;
  }
  if (hgIsWordComplete()) hgGameOver = 'won';
  else if (hgLives <= 0) hgGameOver = 'lost';
  hgRenderGame();
}

// "Kelimeyi göster" — oyun ortasında pes etme. Can/ipucu harcamaz; dürüstçe
// hiçbir çaba gösterilmediğini işaretler (öneri her zaman "Bilemedim" olur).
function hgHandleReveal() {
  if (hgGameOver) return;
  const wordLower = hgCurrentWord.word.toLowerCase();
  for (const ch of wordLower) { if (/[a-z]/.test(ch)) hgGuessedLetters.add(ch); }
  hgGameOver = 'revealed';
  hgRenderGame();
}

// Kelimede geçmeyen, henüz tahmin edilmemiş harflerden rastgele n tanesini
// "elenmiş" işaretler — can gitmez, sadece klavyeyi daraltıp süreci kolaylaştırır.
function hgEliminateRandomLetters(n) {
  const wordLower = hgCurrentWord.word.toLowerCase();
  const candidates = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(l =>
    !wordLower.includes(l) && !hgGuessedLetters.has(l) && !hgEliminatedLetters.has(l)
  );
  for (let i = 0; i < n && candidates.length; i++) {
    const idx = Math.floor(Math.random() * candidates.length);
    hgEliminatedLetters.add(candidates[idx]);
    candidates.splice(idx, 1);
  }
}

// Cümledeki hedef kelimeyi (ve olası basit çekim eklerini) boşlukla değiştirir.
function hgMaskWordInSentence(sentence, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.replace(new RegExp(esc + "\\w*", "gi"), "_____");
}

// Şu ana kadar açılmış ipuçlarını, en eskiden en yeniye, üst üste gösterir.
function hgRenderHintClues() {
  if (hgHintCluesShown === 0) return '';
  const labelMap = { example: 'Örnek cümle', definition: 'Tanım' };
  return hgHintClues.slice(0, hgHintCluesShown).map(c => `
    <div class="sg-tr-reference" style="margin-bottom:8px;">
      <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;">${labelMap[c.type] || 'İpucu'}</span><br>
      <span style="font-style:italic;">${c.text}</span>
    </div>`).join('');
}

function hgRevealRandomLetter() {
  const wordLower = hgCurrentWord.word.toLowerCase();
  const hidden = [...new Set([...wordLower].filter(ch => /[a-z]/.test(ch) && !hgGuessedLetters.has(ch)))];
  if (hidden.length === 0) return;
  hgGuessedLetters.add(hidden[Math.floor(Math.random() * hidden.length)]);
}

function hgCheckGameOverState() {
  if (hgIsWordComplete()) hgGameOver = 'won';
  else if (hgLives <= 0) hgGameOver = 'lost';
}

// Kademeli ipucu:
//  1. tık (ücretsiz): varsa örnek cümleyi kelimesi maskelenmiş halde gösterir —
//     harf değil, ANLAM ipucu verir. Örnek yoksa bunun yerine bir harf açar.
//  2. ve sonraki tıklar (1 can karşılığı): rastgele bir harf daha açar.
// Her ipucu kullanımında ayrıca kelimede olmayan 1-2 harf otomatik elenir.
// Ücretsiz ipucu: kelimenin gerçek içerik havuzundan bir sonraki maddeyi
// açar (örnek cümle / tanım / kategori çağrışımı). Can harcamaz. Havuz
// bitince (kelimenin gerçekten sahip olduğu içerik kadar) düğme pasif olur —
// harf ipucusundan tamamen bağımsız, istenildiği sırada kullanılabilir.
function hgHandleFreeHint() {
  if (hgGameOver || hgHintCluesShown >= hgHintClues.length) return;
  hgHintCluesShown++;
  hgHintsUsed++;
  hgEliminateRandomLetters(2);
  hgCheckGameOverState();
  hgRenderGame();
}

// Can karşılığı harf ipucu: her zaman kullanılabilir (canlar bitene kadar),
// ücretsiz ipucudan bağımsız — kullanıcı ikisini istediği sırada karıştırabilir.
function hgHandleLetterHint() {
  if (hgGameOver || hgLives <= 0) return;
  hgLives--;
  hgRevealRandomLetter();
  hgHintsUsed++;
  hgEliminateRandomLetters(1);
  hgCheckGameOverState();
  hgRenderGame();
}

function hgBuildWordDisplay() {
  const word = hgCurrentWord.word;
  let html = '<div class="hg-word-display">';
  for (const ch of word) {
    if (ch === ' ' || ch === '-' || ch === "'") {
      html += `<div class="hg-letter-box sep">${ch === ' ' ? '' : ch}</div>`;
    } else {
      const shown = hgGuessedLetters.has(ch.toLowerCase()) || hgGameOver ? ch : '_';
      html += `<div class="hg-letter-box">${shown}</div>`;
    }
  }
  html += '</div>';
  return html;
}

function hgBuildKeyboard() {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const wordLower = hgCurrentWord.word.toLowerCase();
  let html = '<div class="hg-keyboard">';
  letters.forEach(l => {
    const guessed = hgGuessedLetters.has(l);
    const eliminated = !guessed && hgEliminatedLetters.has(l);
    let cls = '';
    if (guessed) cls = wordLower.includes(l) ? 'correct' : 'wrong';
    if (eliminated) cls = 'eliminated';
    html += `<button class="hg-key ${cls}" data-letter="${l}" ${(guessed || eliminated) ? 'disabled' : ''}>${l.toUpperCase()}</button>`;
  });
  html += '</div>';
  return html;
}

function hgRenderGame() {
  const c = document.getElementById('hg-content');
  if (!hgCurrentWord) { hgPickWord(); return; }

  const catBadges = (hgCurrentWord.categories || []).map(cat => `<span class="hg-badge">${cat}</span>`).join('');
  const infoHtml = `<div class="hg-info-row">
      <span class="hg-badge cefr">${hgCurrentWord.cefr || '?'}</span>
      <span class="hg-badge">${hgCurrentWord.pos || '—'}</span>
      ${catBadges}
    </div>`;

  let livesHtml = '<div class="hg-lives">';
  for (let i = 0; i < HG_MAX_LIVES; i++) livesHtml += `<div class="hg-life-dot ${i >= hgLives ? 'lost' : ''}"></div>`;
  livesHtml += '</div>';

  const wordHtml = hgBuildWordDisplay();

  const hintCluesHtml = hgRenderHintClues();

  let bodyHtml = '';
  if (!hgGameOver) {
    const freeHintDisabled = hgHintCluesShown >= hgHintClues.length;
    const freeLabel = freeHintDisabled ? `İpucu (bitti: ${hgHintClues.length}/${hgHintClues.length})` : `İpucu (ücretsiz, ${hgHintClues.length - hgHintCluesShown} kaldı)`;
    bodyHtml = `
      ${hintCluesHtml}
      <div class="hg-hint-row">
        <button class="hg-hint-btn" id="hg-free-hint-btn" ${freeHintDisabled ? 'disabled' : ''}>${freeLabel}</button>
        <button class="hg-hint-btn" id="hg-letter-hint-btn" ${hgLives <= 0 ? 'disabled' : ''}>Harf ipucu (1 can)</button>
        <button class="hg-hint-btn hg-give-up-btn" id="hg-reveal-btn">Kelimeyi göster</button>
      </div>
      ${hgBuildKeyboard()}
      <div class="sg-feedback" id="hg-feedback"></div>`;
  } else {
    const wkeyStr = hgCurrentWord.word + '|' + hgCurrentWord.pos;
    const content = BUILTIN_CONTENT[wkeyStr];
    const def = content && content.definition ? content.definition : 'Bu kelime için içerik henüz eklenmedi.';
    const tr = content && content.turkish ? content.turkish : '—';
    const example = content && content.examples && content.examples.length ? content.examples[0] : null;
    const exampleHtml = example
      ? `<div class="sg-tr-reference" style="margin-top:8px;">${example.en}${ttsButtonHtml(example.en)}<br><span style="color:var(--text2);">${example.tr || ''}</span></div>`
      : '';

    // Dürüst sonuç mesajı: kelime tamamen ipucu/reveal ile çözüldüyse ("hiç
    // kendi harfini seçmedin") bunu bir başarı gibi göstermiyoruz.
    const noRealEffort = hgManualCorrect === 0;
    let resultLine;
    if (hgGameOver === 'lost') {
      resultLine = `<div class="sg-feedback wrong">Canlar bitti — kelime: <b>${hgCurrentWord.word}</b></div>`;
    } else if (hgGameOver === 'revealed' || noRealEffort) {
      resultLine = `<div class="sg-feedback">Kelime gösterildi — kelime: <b>${hgCurrentWord.word}</b></div>`;
    } else {
      resultLine = `<div class="sg-feedback right">Doğru bildin! 🎉</div>`;
    }

    const key = `word:${hgCurrentWord.word.toLowerCase()}`;
    const penalty = hgWrongGuesses + hgHintsUsed;
    const suggestedRating = (hgGameOver === 'lost' || hgGameOver === 'revealed' || noRealEffort)
      ? 'unknown'
      : (penalty === 0 ? 'known' : (penalty <= 2 ? 'partial' : 'unknown'));

    bodyHtml = `
      ${resultLine}
      <div class="sg-tr-reference"><b>${hgCurrentWord.word}</b>${ttsButtonHtml(hgCurrentWord.word, hgCurrentWord.word)} — ${tr}<br><span style="font-size:13px;color:var(--text2);">${def}</span></div>
      ${exampleHtml}
      <div style="font-size:13px;color:var(--text2);margin:12px 0 6px;">Bu kelimeyi değerlendir (istersen atla):</div>
      <div class="sg-rate-row" id="hg-rate-row">
        <button class="sg-rate-btn known ${suggestedRating === 'known' ? 'suggested' : ''}" data-r="known">Bildim</button>
        <button class="sg-rate-btn partial ${suggestedRating === 'partial' ? 'suggested' : ''}" data-r="partial">Kısmen</button>
        <button class="sg-rate-btn unknown ${suggestedRating === 'unknown' ? 'suggested' : ''}" data-r="unknown">Bilemedim</button>
      </div>
      <div id="hg-rate-result"></div>
      <button class="sg-btn sg-btn-secondary" id="hg-skip-btn" style="margin-top:8px;">Puanlamadan sonraki kelime</button>`;
  }

  c.innerHTML = `<div class="sg-card">${infoHtml}${livesHtml}${wordHtml}${bodyHtml}</div>`;
  ttsWireButtons(c);

  if (!hgGameOver) {
    c.querySelectorAll('.hg-key').forEach(btn => { btn.onclick = () => hgHandleKeyClick(btn.dataset.letter); });
    const freeBtn = document.getElementById('hg-free-hint-btn');
    if (freeBtn) freeBtn.onclick = hgHandleFreeHint;
    const letterBtn = document.getElementById('hg-letter-hint-btn');
    if (letterBtn) letterBtn.onclick = hgHandleLetterHint;
    document.getElementById('hg-reveal-btn').onclick = hgHandleReveal;
  } else {
    document.getElementById('hg-skip-btn').onclick = hgPickWord;
    c.querySelectorAll('#hg-rate-row .sg-rate-btn').forEach(b => {
      b.onclick = () => {
        const key = `word:${hgCurrentWord.word.toLowerCase()}`;
        // sgScheduleReview: sentence-expansion modülüyle paylaşılan genel SRS
        // zamanlayıcısı (anahtar bazlı, herhangi bir modülden çağrılabilir).
        const result = sgScheduleReview(key, b.dataset.r);
        document.getElementById('hg-rate-row').style.display = 'none';
        document.getElementById('hg-skip-btn').style.display = 'none';
        document.getElementById('hg-rate-result').innerHTML =
          `<div class="sg-rate-done">${result.learned ? '✓ Öğrenildi, aktif tekrardan çıktı' : `✓ Sonraki tekrar: ${result.nextReview}`}</div>
           <button class="sg-btn sg-btn-secondary" id="hg-next-btn">Sonraki Kelime</button>`;
        document.getElementById('hg-next-btn').onclick = hgPickWord;
        hgLoadStats();
      };
    });
  }
}

function hgLoadStats() {
  const el = document.getElementById('hg-stats-bar');
  const keys = Object.keys(srsStore).filter(k => k.startsWith('word:'));
  if (keys.length === 0) { el.innerHTML = '<p style="text-align:center;font-size:12px;color:var(--text3);font-weight:400;margin:0;">Henüz değerlendirilen kelime yok</p>'; return; }
  let mastered = 0, due = 0;
  const today = todayStr();
  keys.forEach(k => {
    const st = srsStore[k];
    if (st.learned) mastered++;
    else if (st.nextReview && st.nextReview <= today) due++;
  });
  el.textContent = `${keys.length} kelime takipte · ${mastered} öğrenildi · ${due} tekrar bekliyor`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAMMAR MODÜLÜ — kaynak: English Grammar Profile (seviye/konu iskeleti),
// veri grammar-topics.json'dan fetch ediliyor (window.GRAMMAR_TOPICS).
// Doğrulama hibrit: tense'e bağlı konular Cümle Kur'un SENTENCE_EXERCISES
// havuzundan pratik çeker; bağımsız konular (Coordinating, Articles vb.)
// kendi mini-testini kullanır. İlerleme aynı srsStore'a 'gr:' önekiyle
// yazılır — ayrı bir depo/dosya değil, saveState() ile birlikte kaydedilir.
// ═══════════════════════════════════════════════════════════════════════════
let grLevel = 'A1', grTopicIdx = 0;

// #15 — konular `order` alanı varsa (generate_topic_order.py ile üretilen
// pedagojik önerilen sıra) ona göre sıralanır. `order` HİÇBİR konuda yoksa
// (henüz üretilmediyse) orijinal EGP iskelet sırası aynen korunur — geriye
// dönük kırılmaz. Kısmi doldurulmuşsa (bazı konularda var bazılarında yok),
// order'ı olmayanlar sona (999) düşer.
function grTopicsFor(lv) {
  const topics = (window.GRAMMAR_TOPICS && window.GRAMMAR_TOPICS[lv]) || [];
  const hasOrder = topics.some(t => typeof t.order === 'number');
  if (!hasOrder) return topics;
  return [...topics].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

// Canlı/doygun renk paleti — kategoriye göre otomatik atanır. Her giriş
// hafif gradyanlı (iki ton). Bilinen 17 EGP kategorisi için ÇAKIŞMASIZ elle
// atama var (hash'e bırakılsaydı 8 renk / 17 kategori çakışırdı); tanınmayan
// yeni bir kategori gelirse hash fallback devreye girer.
const GR_VIVID_GRADIENTS = [
  ['#8b5cf6', '#6d28d9'],  // 0 mor
  ['#3b82f6', '#1d4ed8'],  // 1 mavi
  ['#10b981', '#047857'],  // 2 zümrüt
  ['#f59e0b', '#c2660a'],  // 3 amber
  ['#f43f5e', '#be123c'],  // 4 gül
  ['#06b6d4', '#0891b2'],  // 5 camgöbeği
  ['#d946ef', '#a21caf'],  // 6 fuşya
  ['#84cc16', '#4d7c0f'],  // 7 lime
  ['#6366f1', '#4338ca'],  // 8 indigo
  ['#ec4899', '#be185d'],  // 9 pembe
  ['#14b8a6', '#0f766e'],  // 10 teal
  ['#eab308', '#a16207'],  // 11 sarı
];
const GR_CATEGORY_STYLE = {
  // A1'de aynı ekranda birlikte görünen 9 kategori — hepsi benzersiz renk.
  CONJUNCTIONS: { grad: 0, icon: 'plus' },
  PRESENT:      { grad: 1, icon: 'clock' },
  PAST:         { grad: 2, icon: 'clock' },
  FUTURE:       { grad: 3, icon: 'clock' },
  DETERMINERS:  { grad: 4, icon: 'search' },
  PRONOUNS:     { grad: 5, icon: 'user' },
  CLAUSES:      { grad: 6, icon: 'link' },
  NOUNS:        { grad: 7, icon: 'box' },
  MODALITY:     { grad: 8, icon: 'key' },
  VERBS:        { grad: 9, icon: 'play' },
  ADVERBS:      { grad: 10, icon: 'bolt' },
  ADJECTIVES:   { grad: 11, icon: 'palette' },
  // Daha üst seviyelerde görülen, A1 setiyle aynı anda ekrana gelmesi
  // düşük ihtimalli kategoriler — mevcut renklerden tekrar kullanılıyor.
  NEGATION:     { grad: 2, icon: 'ban' },
  PASSIVES:     { grad: 3, icon: 'swap' },
  PREPOSITIONS: { grad: 6, icon: 'pin' },
  FOCUS:        { grad: 0, icon: 'target' },
  QUESTIONS:    { grad: 8, icon: 'question' },
};
function grCategoryStyle(category) {
  if (GR_CATEGORY_STYLE[category]) return GR_CATEGORY_STYLE[category];
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return { grad: hash % GR_VIVID_GRADIENTS.length, icon: 'box' };
}
function grCategoryGradient(category) {
  const [c1, c2] = GR_VIVID_GRADIENTS[grCategoryStyle(category).grad];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}
function grCategoryColor(category) {
  return GR_VIVID_GRADIENTS[grCategoryStyle(category).grad][0];
}
function grCategoryIcon(category) {
  return grCategoryStyle(category).icon;
}

function grSrsKey(topicId, subId) { return 'gr:' + topicId + ':' + subId; }
function grIsLearned(topicId, subId) {
  const st = srsStore[grSrsKey(topicId, subId)];
  return !!(st && st.learned);
}
function grMarkLearned(topicId, subId) {
  srsStore[grSrsKey(topicId, subId)] = { learned: true, learnedAt: todayStr() };
  saveState();
}

// Bir alt maddenin soru/cümle durumlarını (gr-state-dots) kalıcı depodan getirir.
// Aynı topicId+subId için HER ZAMAN aynı obje referansını döndürür — bu yüzden
// grRenderVerify tarafında `s._itemStates = grGetItemStates(...)` yapıldıktan
// sonra `s._itemStates[idx] = {...}` şeklindeki mevcut mutasyonlar otomatik
// olarak grItemStates deposunu da günceller; ek bir senkron kod gerekmez,
// sadece değişiklikten sonra saveState() çağrılması yeterli.
function grGetItemStates(topicId, subId) {
  const key = grSrsKey(topicId, subId);
  if (!grItemStates[key]) grItemStates[key] = {};
  return grItemStates[key];
}

// Erdem: Gramer modülüne girince toplam ilerleme hiç görünmüyordu (sadece
// seviye kartları vardı, aggregate yoktu) — arama kutusunun üstüne, Özet'teki
// halka ile aynı görsel dilde bir genel özet ekliyoruz.
function grOverallSummaryHtml() {
  const gr = grOverallStats();
  if (gr.totalSubs === 0) return '';
  const pct = Math.round(gr.learnedSubs / gr.totalSubs * 100);
  return `<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
    ${dashRingSvg(pct, 'var(--accent)')}
    <div>
      <div class="dash-lvl-title" style="margin:0;">Genel ilerleme</div>
      <div style="font-size:12.5px;color:var(--text2);">${gr.learnedSubs} / ${gr.totalSubs} alt madde öğrenildi</div>
    </div>
  </div>`;
}

function grInit() {
  document.getElementById('gr-overall-summary').innerHTML = grOverallSummaryHtml();
  const el = document.getElementById('gr-level-list');
  const levels = ['A1','A2','B1','B2','C1','C2'];
  el.innerHTML = levels.map(lv => {
    const topics = grTopicsFor(lv);
    const subCount = topics.reduce((s,t) => s + t.subs.length, 0);
    const learnedCount = topics.reduce((s,t) => s + t.subs.filter(sub => grIsLearned(t.topicId, sub.id)).length, 0);
    const pct = subCount > 0 ? Math.round(learnedCount / subCount * 100) : 0;
    const metaText = topics.length === 0 ? 'yakında' : `${topics.length} konu · ${subCount} alt madde · ${learnedCount}/${subCount} öğrenildi`;
    const barHtml = topics.length > 0 ? `
      <div class="gr-lvl-bar"><div class="bar-fill" style="width:${pct}%;background:currentColor;"></div></div>` : '';
    return `
    <div class="gr-lvl-card h-${lv.toLowerCase()}" onclick="grShowTopics('${lv}')">
      <div class="gr-lvl-title">Grammar for ${lv==='A1'?'beginners':lv}</div>
      <div class="gr-lvl-meta">${metaText}</div>
      ${barHtml}
      <div class="gr-lvl-badge">${lv}</div>
    </div>`;
  }).join('');
  document.getElementById('gr-levels-view').classList.remove('hidden');
  document.getElementById('gr-topics-view').classList.add('hidden');
  document.getElementById('gr-detail-view').classList.add('hidden');
  document.getElementById('gr-review-view').classList.add('hidden');
}

// Tüm seviyelerdeki 397 konu arasında arama — başlık/EGP referansı/kategoriye göre.
function grSearchTopics(query) {
  const q = query.trim().toLowerCase();
  const resultsEl = document.getElementById('gr-search-results');
  const listEl = document.getElementById('gr-level-list');
  if (!q) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    return;
  }
  listEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  const levels = ['A1','A2','B1','B2','C1','C2'];
  const matches = [];
  levels.forEach(lv => {
    grTopicsFor(lv).forEach(t => {
      const hay = (t.title + ' ' + (t.ref||'') + ' ' + t.category).toLowerCase();
      if (hay.includes(q)) matches.push({ lv, t });
    });
  });
  if (matches.length === 0) {
    resultsEl.innerHTML = `<p style="font-size:12.5px;color:var(--text3);padding:8px 2px;">"${query}" ile eşleşen konu bulunamadı.</p>`;
    return;
  }
  resultsEl.innerHTML = matches.map(({lv, t}) => {
    const color = grCategoryColor(t.category);
    const gradient = grCategoryGradient(t.category);
    return `
    <div class="gr-topic-card" style="border-left:4px solid ${color};" onclick="grJumpFromSearch('${lv}','${t.topicId}')">
      <div class="gr-topic-row">
        <div class="gr-topic-icon" style="background:${gradient};color:#fff;">${ico(grCategoryIcon(t.category), 19, '#fff', false)}</div>
        <div class="gr-topic-main">
          <div class="gr-topic-name">${t.title}</div>
          <div class="gr-topic-meta"><b style="color:${color};">${t.category.charAt(0)+t.category.slice(1).toLowerCase()}</b> · Grammar, ${lv}</div>
        </div>
        <span class="gr-topic-chevron">&#8250;</span>
      </div>
    </div>`;
  }).join('');
}

function grJumpFromSearch(lv, topicId) {
  grLevel = lv;
  const idx = grTopicsFor(lv).findIndex(t => t.topicId === topicId);
  if (idx === -1) return;
  document.getElementById('gr-search-input').value = '';
  document.getElementById('gr-search-results').classList.add('hidden');
  document.getElementById('gr-level-list').classList.remove('hidden');
  grOpenTopic(idx);
}

// #14 — Nüans metnindeki "Karıştırılan yapılar" linkinden çağrılır. Hangi
// seviyede olduğu bilinmiyor (confusionTopicId sadece topicId taşıyor),
// bu yüzden tüm seviyeler taranıp bulunan ilk eşleşmeye gidilir — topicId'ler
// tüm seviyelerde benzersiz (slugify edilmiş EGP referansından türetiliyor).
function grJumpToConfusionTopic(topicId) {
  const levels = ['A1','A2','B1','B2','C1','C2'];
  for (const lv of levels) {
    if (grTopicsFor(lv).some(t => t.topicId === topicId)) {
      grJumpFromSearch(lv, topicId);
      return;
    }
  }
}

function grEstSeconds(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(20, Math.round(words / 200 * 60));
}
function grFmtDur(totalSec) {
  const m = Math.floor(totalSec/60), s = totalSec%60;
  return m > 0 ? `${m}min ${s}sec` : `${s}sec`;
}
function grTopicMeta(t) {
  const totalWords = t.subs.reduce((sum, s) => sum + s.en.split(/\s+/).length + s.ex.map(e=>e.w.replace(/<[^>]+>/g,'')).join(' ').split(/\s+/).length, 0);
  const sec = grEstSeconds(Array(totalWords).fill('x').join(' '));
  const learnedCount = t.subs.filter(s => grIsLearned(t.topicId, s.id)).length;
  return { dur: grFmtDur(sec), learnedCount, pct: Math.round(learnedCount / t.subs.length * 100) };
}

function grShowTopics(lv) {
  grLevel = lv;
  const list = grTopicsFor(lv);
  document.getElementById('gr-topics-title').textContent = lv + ' — Konular (' + list.length + ')';
  const el = document.getElementById('gr-topic-list');
  if (list.length === 0) {
    el.innerHTML = '<p style="font-size:12.5px;color:var(--text3);">Bu seviye için içerik henüz üretilmedi.</p>';
  } else {
    el.innerHTML = list.map((t, i) => {
      const m = grTopicMeta(t);
      const allDone = m.learnedCount === t.subs.length;
      const color = grCategoryColor(t.category);
      const gradient = grCategoryGradient(t.category);
      return `
      <div class="gr-topic-card" style="border-left:4px solid ${color};">
        <div class="gr-topic-row" onclick="grOpenTopic(${i})">
          <div class="gr-topic-icon ${allDone?'done':''}" style="background:${gradient};color:#fff;box-shadow:0 3px 10px -1px ${color}99;">${ico(grCategoryIcon(t.category), 19, '#fff', false)}</div>
          <div class="gr-topic-main">
            <div class="gr-topic-name">${t.title}</div>
            <div class="gr-topic-meta"><b style="color:${color};">${t.category.charAt(0)+t.category.slice(1).toLowerCase()}</b> · Grammar, ${lv}</div>
            <div class="gr-topic-meta">${m.dur} · ${m.learnedCount}/${t.subs.length} öğrenildi</div>
          </div>
          <span class="gr-topic-chevron">&#8250;</span>
        </div>
        <div class="gr-progress-wrap"><div class="gr-progress-fill ${allDone?'full':''}" style="width:${m.pct}%;${allDone?'':`background:${gradient};`}"></div></div>
      </div>`;
    }).join('');
  }
  document.getElementById('gr-levels-view').classList.add('hidden');
  document.getElementById('gr-topics-view').classList.remove('hidden');
  document.getElementById('gr-detail-view').classList.add('hidden');
  document.getElementById('gr-review-view').classList.add('hidden');
}
function grBackToLevels() { grInit(); }

function grOpenTopic(i) {
  grTopicIdx = i;
  const t = grTopicsFor(grLevel)[i];
  const color = grCategoryColor(t.category);
  const gradient = grCategoryGradient(t.category);
  const detailView = document.getElementById('gr-detail-view');
  detailView.style.setProperty('--gr-accent', color);
  document.getElementById('gr-detail-title').innerHTML =
    `<span class="gr-detail-icon" style="background:${gradient};">${ico(grCategoryIcon(t.category), 15, '#fff', false)}</span>${t.title} — ${grLevel}`;
  grRenderSummaryCard(t, color);
  grRenderPills(t);
  document.getElementById('gr-sections').innerHTML = t.subs.map((s, j) => {
    const nuanceHtml = s.nuance ? `
      <div class="c-section">
        <div class="c-section-label">Nüans</div>
        <div class="gr-nuance-block"><div class="gr-nuance-title">Neden kullanılır</div><div class="gr-nuance-text">${s.nuance.why}</div></div>
        <div class="gr-nuance-block"><div class="gr-nuance-title">Sık yapılan hatalar</div><div class="gr-nuance-text">${s.nuance.mistakes}</div></div>
        <div class="gr-nuance-block"><div class="gr-nuance-title">Karıştırılan yapılar</div><div class="gr-nuance-text">${s.nuance.confusion}</div>
          ${s.nuance.confusionTopicId ? `<button class="gr-tr-toggle" onclick="grJumpToConfusionTopic('${s.nuance.confusionTopicId}')">→ İlgili konuya git</button>` : ''}
        </div>
      </div>` : '';
    return `
    <div class="gr-acc" id="gr-sec-${j}">
      <div class="gr-acc-head" onclick="grToggleAcc(${j})">
        <span class="gr-acc-num">${j+1}/${t.subs.length}</span>
        <span class="gr-acc-title">${s.title}</span>
        ${grIsLearned(t.topicId,s.id) ? '<span class="gr-acc-done">✓</span>' : ''}
        <span class="gr-acc-chevron">&#8250;</span>
      </div>
      <div class="gr-acc-body" id="gr-body-${j}">
        <div class="gr-acc-ref">EGP referansı: ${s.guideword}</div>
        <div class="gr-expl">${s.en}</div>
        ${s.ex.length ? `<div class="examples-card" style="margin-bottom:10px;"><div class="examples-card-head"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2z"/><path d="M8.3 8.2a1.7 1.7 0 1 1 2.2 1.6c-.5.2-.7.5-.7 1"/><circle cx="10" cy="12.6" r=".15" fill="currentColor" stroke-width="2"/></svg>Örnekler</div><div class="examples-card-body">${s.ex.map(e => `<div class="gr-ex">${e.w}</div>`).join('')}</div></div>` : ''}
        <button class="gr-tr-switch" onclick="grToggleTr(this)"><span class="tr-switch"><span class="tr-switch-knob"></span></span><span class="tr-toggle-label">Türkçesini göster</span></button>
        <div class="gr-tr-text">${s.tr}<br><br>${s.ex.map(e => e.tr).join('<br>')}</div>
        ${nuanceHtml}
        <div id="gr-verify-${j}"></div>
      </div>
    </div>`;
  }).join('');
  t.subs.forEach((s, j) => grRenderVerify(t, j));
  document.getElementById('gr-levels-view').classList.add('hidden');
  document.getElementById('gr-topics-view').classList.add('hidden');
  document.getElementById('gr-review-view').classList.add('hidden');
  detailView.classList.remove('hidden');
}
function grBackToTopics() { grShowTopics(grLevel); }

function grRenderSummaryCard(t, color) {
  const el = document.getElementById('gr-summary-card');
  if (!el) return;
  el.innerHTML = `
    <div class="ts-card" style="border-left:3px solid ${color};">
      <div class="ts-row"><div class="ts-label">Konu</div><div class="ts-value">${t.title}<div style="font-size:11px;color:var(--text3);font-style:italic;margin-top:2px;">EGP: ${t.ref || t.title}</div></div></div>
      <div class="ts-row"><div class="ts-label">Kategori</div><div class="ts-value" style="color:${color};font-weight:600;">${t.category}</div></div>
      <div class="ts-row"><div class="ts-label">Seviye</div><div class="ts-value"><span class="ts-level-badge">${grLevel}</span></div></div>
      <div class="ts-row"><div class="ts-label">Açıklama</div><div class="ts-value">${t.summary || ''}</div></div>
    </div>`;
}

function grToggleAcc(j, forceOpen) {
  const acc = document.getElementById('gr-sec-'+j);
  const body = document.getElementById('gr-body-'+j);
  const shouldOpen = forceOpen !== undefined ? forceOpen : !body.classList.contains('open');
  if (shouldOpen) {
    // Tek seferde bir tane açık kalsın — diğer tüm accordion'ları kapat
    document.querySelectorAll('#gr-sections .gr-acc-body.open').forEach(b => {
      if (b !== body) b.classList.remove('open');
    });
    document.querySelectorAll('#gr-sections .gr-acc.open').forEach(a => {
      if (a !== acc) a.classList.remove('open');
    });
  }
  body.classList.toggle('open', shouldOpen);
  acc.classList.toggle('open', shouldOpen);
}

function grJumpTo(j) {
  grToggleAcc(j, true);
  const acc = document.getElementById('gr-sec-'+j);
  acc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  acc.classList.add('flash');
  setTimeout(() => acc.classList.remove('flash'), 900);
}

function grRenderPills(t) {
  document.getElementById('gr-sub-nav').innerHTML = t.subs.map((s, j) =>
    `<button class="gr-sub-pill" onclick="grJumpTo(${j})"><span class="dot ${grIsLearned(t.topicId,s.id)?'done':''}" id="gr-dot-${j}"></span><span class="label">${s.guideword}</span></button>`
  ).join('');
}

function grMarkAccDone(j) {
  const head = document.querySelector('#gr-sec-'+j+' .gr-acc-head');
  if (head && !head.querySelector('.gr-acc-done')) {
    const chevron = head.querySelector('.gr-acc-chevron');
    const done = document.createElement('span');
    done.className = 'gr-acc-done';
    done.textContent = '✓';
    head.insertBefore(done, chevron);
  }
}

// Konunun TÜM alt maddeleri öğrenilince (tek bir alt madde değil) kısa bir
// kutlama banner'ı gösterir — sekmeler görünümünün üstüne, birkaç saniye
// sonra veya kapatınca kaybolur.
function grShowTopicCelebration(t) {
  const old = document.getElementById('gr-celebration');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = 'gr-celebration';
  banner.className = 'gr-celebration';
  banner.innerHTML = `
    <span class="gr-celebration-icon">🎉</span>
    <div class="gr-celebration-text"><b>Tebrikler!</b> "${t.title}" konusunu bitirdin.</div>
    <button class="gr-celebration-close" onclick="document.getElementById('gr-celebration').remove()">✕</button>`;
  const anchor = document.getElementById('gr-summary-card');
  anchor.parentNode.insertBefore(banner, anchor);
  setTimeout(() => { const b = document.getElementById('gr-celebration'); if (b) b.remove(); }, 5000);
}

function grRenderVerify(t, j) {
  const s = t.subs[j];
  const el = document.getElementById('gr-verify-'+j);
  if (grIsLearned(t.topicId, s.id)) {
    el.innerHTML = `<div class="gr-verify-box"><div class="gr-mark-done">✓ Öğrenildi</div></div>`;
    return;
  }
  // Alt madde kendi verifyType'ını taşıyabilir (ör. "Negative"/"Question" gibi
  // dar kapsamlı yapılar, konusu tense'e bağlı olsa bile kendi quiz'ini kullanır
  // — Cümle Kur havuzunda olumsuz/soru örneği neredeyse hiç yok). Yoksa konudaki
  // genel tipi kullanır (geriye dönük uyumlu).
  const effectiveVerifyType = s.verifyType || t.verifyType;
  if (effectiveVerifyType === 'quiz') {
    // Geriye dönük uyumluluk: eski tekil "quiz" alanı varsa quizPool'a çevir
    if (!s.quizPool && s.quiz) s.quizPool = [s.quiz];
    if (!s.quizPool || s.quizPool.length === 0) {
      // İçerik üretiminde bu alt madde için quiz gelmemiş — kendin işaretle
      el.innerHTML = `<div class="gr-verify-box">
        <p style="font-size:12px;color:var(--text3);margin-bottom:8px;">Bu alt madde için otomatik kontrol henüz yok.</p>
        <button class="gr-tr-toggle" onclick="grMarkLearned('${t.topicId}','${s.id}');grRenderVerify(grTopicsFor('${grLevel}')[${grTopicIdx}],${j});document.getElementById('gr-dot-${j}').classList.add('done');grMarkAccDone(${j});">Anladım, işaretle →</button>
      </div>`;
      return;
    }
    const target = s.quizPool.length;
    // idx -> {status: 'unanswered'|'wrong'|'correct'|'correct-retry', selected, firstWrong}
    // Kalıcı depoya (grItemStates) bağlı referans — bkz. grGetItemStates.
    s._itemStates = grGetItemStates(t.topicId, s.id);
    if (s._viewIdx === undefined) s._viewIdx = 0;
    if (s._pending === undefined) s._pending = null;  // henüz "kontrol et"e basılmamış seçim
    if (s._retrying === undefined) s._retrying = null;
    const idx = s._viewIdx % target;
    const item = s._itemStates[idx] || { status: 'unanswered' };
    const q = s.quizPool[idx];
    const isRetrying = s._retrying === idx;
    const pendingSel = (s._pending && s._pending.idx === idx) ? s._pending.opt : null;
    const checked = item.status !== 'unanswered' && !isRetrying;
    const progressCount = Object.values(s._itemStates).filter(x => x.status === 'correct' || x.status === 'correct-retry').length;
    const counterHtml = target > 1 ? `<span class="gr-verify-counter">${progressCount}/${target} doğru</span>` : '';

    const optsHtml = q.opts.map((o, k) => {
      let cls = 'gr-quiz-opt';
      if (checked) {
        if (k === q.correct) cls += ' correct';
        else if (k === item.selected) cls += ' wrong';
      } else if (pendingSel === k) cls += ' selected';
      const dis = checked ? 'disabled' : '';
      return `<button class="${cls}" ${dis} onclick="grSelectQuizOption(${j},${k})">${o}</button>`;
    }).join('');

    let feedbackHtml = '', navHtml = '';
    // Havuzda tek soru varsa "Sonraki soru" YANLIŞ bir vaat — bu buton aslında
    // bir sonraki soruya değil, alt maddeyi tamamlamaya götürüyor (bkz.
    // grAdvanceQuiz: progressCount >= target olunca grMarkLearned çağrılıyor).
    // Erdem'in bulduğu gerçek bug: buton hep "Sonraki soru →" diyordu, tek
    // sorulu alt maddelerde (5'ten az alt maddeli konularda hedef 1 soru
    // olduğu için bu ÇOK yaygın) bu yanıltıcıydı.
    const isSingleQuestion = s.quizPool.length <= 1;
    const advanceLabel = isSingleQuestion ? 'Devam et →' : 'Sonraki soru →';
    if (!checked) {
      navHtml = `<button class="gr-check-btn" ${pendingSel===null?'disabled':''} onclick="grCheckQuizAnswer(${j},${target})">Cevabı kontrol et</button>`;
    } else if (item.status === 'correct') {
      feedbackHtml = `<div class="gr-tr-text show">✓ Doğru!</div>`;
      navHtml = `<button class="gr-tr-toggle" onclick="grAdvanceQuiz(${j},${target})">${advanceLabel}</button>`;
    } else if (item.status === 'correct-retry') {
      const firstWrongNote = item.firstWrong !== undefined && item.firstWrong !== null
        ? ` İlk denemende <b>${q.opts[item.firstWrong]}</b> demiştin.` : '';
      feedbackHtml = `<div class="gr-tr-text show">Doğru — ama ilk denemede olmadığı için ilerlemeye sayılmadı.${firstWrongNote}</div>`;
      navHtml = `<button class="gr-tr-toggle" onclick="grAdvanceQuiz(${j},${target})">${advanceLabel}</button>`;
    } else if (isSingleQuestion) {
      // Tek sorulu alt maddede "Sonraki soru" seçeneği anlamsız (gidecek başka
      // soru yok, aynı soruyu tekrar gösterirdi) — sadece tekrar deneme sunulur.
      feedbackHtml = `<div class="gr-tr-text show">Doğru cevap: <b>${q.opts[q.correct]}</b></div>`;
      navHtml = `<button class="gr-tr-toggle" onclick="grRetryQuiz(${j})">↺ Tekrar dene</button>`;
    } else {
      feedbackHtml = `<div class="gr-tr-text show">Doğru cevap: <b>${q.opts[q.correct]}</b></div>`;
      navHtml = `<div style="display:flex;gap:14px;">
        <button class="gr-tr-toggle" onclick="grRetryQuiz(${j})">↺ Tekrar dene</button>
        <button class="gr-tr-toggle" onclick="grAdvanceQuiz(${j},${target})">${advanceLabel}</button>
      </div>`;
    }

    // Bu quiz, tense'e bağlı bir konunun (t.tense var) sub-level override'lı
    // alt maddesiyse (Negative/Question gibi) — kardeşi olan sentencekur
    // alt maddesindeki formül kutusunu burada da göster, tutarlılık için.
    const tenseCardHtml = grTenseFormulaCardHtml(t.tense);

    el.innerHTML = `<div class="gr-verify-box">
      <div class="gr-verify-label"><span>Kontrol et</span>${counterHtml}</div>
      <div class="gr-quiz-q">${q.q}</div>
      <div class="gr-quiz-opts">${optsHtml}</div>
      ${feedbackHtml}
      ${navHtml}
      ${target > 1 ? grStateDotsHtml(s._itemStates, target, idx, `grJumpQuizItem(${j},`) : ''}
      ${!checked && target > 1 ? `<div style="display:flex;gap:14px;margin-top:8px;">
        <button class="gr-tr-toggle" onclick="grSkipQuiz(${j},-1)" style="opacity:.7;">← Önceki</button>
        <button class="gr-tr-toggle" onclick="grSkipQuiz(${j},1)" style="opacity:.7;">Sonraki →</button>
      </div>` : ''}
      ${tenseCardHtml}
      ${grWordBadgeHtml(q.relatedWords)}
    </div>`;
  } else if (effectiveVerifyType === 'sentencekur') {
    // Cümle Kur'un kendi havuzundan (SENTENCE_EXERCISES), aynı tense'e filtrelenmiş,
    // sayfa içi gömülü pratik. Yeni içerik üretmiyoruz, mevcut havuzu ödünç alıyoruz.
    // NOT: sentence-exercises.json'da olumlu/olumsuz/soru ayrımı için ayrı bir alan
    // yok — alt madde adı ("Negative"/"Olumsuz" gibi) bunu istiyorsa, cümle
    // metninden (doesn't/don't/isn't vb.) tahmin ederek ek süzme yapıyoruz.
    // Uygun örnek yoksa sessizce tüm tense havuzuna geri dönüyoruz (boş ekran yerine).
    let pool = (window.SENTENCE_EXERCISES || []).filter(ex => ex.tense === t.tense);
    const desiredPolarity = grDesiredPolarity(s);
    if (desiredPolarity) {
      const filtered = pool.filter(ex => grExercisePolarity(ex) === desiredPolarity);
      if (filtered.length > 0) pool = filtered;
    }
    s._pool = s._pool || pool;
    if (s._pool.length === 0) {
      el.innerHTML = `<div class="gr-verify-box"><p style="font-size:12px;color:var(--text3);">Bu tense için Cümle Kur havuzunda örnek bulunamadı.</p></div>`;
      return;
    }
    const target = Math.min(5, s._pool.length);
    if (s._viewIdx === undefined) s._viewIdx = 0;
    if (s._pending === undefined) s._pending = null;
    if (s._retrying === undefined) s._retrying = null;
    // Kalıcı depoya (grItemStates) bağlı referans — bkz. grGetItemStates.
    s._itemStates = grGetItemStates(t.topicId, s.id);
    const idx = s._viewIdx % target;  // sadece ilk `target` cümle kullanılıyor, tutarlı nokta sayısı için
    const item = s._itemStates[idx] || { status: 'unanswered' };
    const isRetrying = s._retrying === idx;
    const pendingSel = (s._pending && s._pending.idx === idx) ? s._pending.opt : null;
    const checked = item.status !== 'unanswered' && !isRetrying;
    const ex = s._pool[idx];
    const sentence = ex.root.join(' ') + (ex.chunks[0] ? ' ' + ex.chunks[0].text : '');
    const wordEntry = grFindWordDataEntry(ex.targetWord);
    const wordBadge = wordEntry
      ? grWordBadgeHtml([{ word: wordEntry.word, pos: wordEntry.pos, cefr: wordEntry.cefr || ex.cefr, freq: wordEntry.freq || ex.freq, speaking: wordEntry.speaking, writing: wordEntry.writing }])
      : grWordBadgeReadonlyHtml(ex.targetWord, ex.cefr, ex.freq);

    // Bu havuzdaki cümleler zaten hep doğru üretildiği için "doğru" cevap her zaman true.
    const optsHtml = [true, false].map(val => {
      let cls = 'gr-quiz-opt';
      if (checked) {
        if (val === true) cls += ' correct';
        else if (val === item.selected) cls += ' wrong';
      } else if (pendingSel === val) cls += ' selected';
      const dis = checked ? 'disabled' : '';
      const label = val ? 'Evet, doğru' : 'Hayır, yanlış';
      return `<button class="${cls}" ${dis} onclick="grSelectPracticeOption(${j},${val})">${label}</button>`;
    }).join('');

    const progressCount = Object.values(s._itemStates).filter(x => x.status === 'correct' || x.status === 'correct-retry').length;
    let feedbackHtml = '', navHtml = '';
    if (!checked) {
      navHtml = `<button class="gr-check-btn" ${pendingSel===null?'disabled':''} onclick="grCheckPracticeAnswer(${j},${target})">Cevabı kontrol et</button>`;
    } else if (item.status === 'correct') {
      feedbackHtml = `<div class="gr-tr-text show">✓ Doğru!</div>`;
      navHtml = `<button class="gr-tr-toggle" onclick="grAdvancePractice(${j},${target})">Sonraki cümle →</button>`;
    } else if (item.status === 'correct-retry') {
      feedbackHtml = `<div class="gr-tr-text show">Doğru — ama ilk denemede olmadığı için ilerlemeye sayılmadı. İlk cevabın: <b>${item.firstWrong === true ? 'Evet, doğru' : 'Hayır, yanlış'}</b> demiştin.</div>`;
      navHtml = `<button class="gr-tr-toggle" onclick="grAdvancePractice(${j},${target})">Sonraki cümle →</button>`;
    } else {
      feedbackHtml = `<div class="gr-tr-text show">Bu cümle aslında doğru — WordHaven'ın havuzundaki örnekler her zaman geçerli kullanım gösterir.</div>`;
      navHtml = `<div style="display:flex;gap:14px;">
        <button class="gr-tr-toggle" onclick="grRetryPractice(${j})">↺ Tekrar dene</button>
        <button class="gr-tr-toggle" onclick="grAdvancePractice(${j},${target})">Sonraki cümle →</button>
      </div>`;
    }

    el.innerHTML = `<div class="gr-verify-box">
      <div class="gr-verify-label"><span>Pratik yap (Cümle Kur havuzundan)</span><span class="gr-verify-counter">${progressCount}/${target} doğru</span></div>
      <div class="gr-quiz-q">"${sentence}" — bu cümle ${ex.tense} yapısını doğru kullanıyor mu?</div>
      <div class="gr-quiz-opts">${optsHtml}</div>
      ${feedbackHtml}
      ${navHtml}
      ${grStateDotsHtml(s._itemStates, target, idx, `grJumpPracticeItem(${j},`)}
      ${!checked ? `<div style="display:flex;gap:14px;margin-top:8px;">
        <button class="gr-tr-toggle" onclick="grSkipPractice(${j},-1)" style="opacity:.7;">← Önceki</button>
        <button class="gr-tr-toggle" onclick="grSkipPractice(${j},1)" style="opacity:.7;">Sonraki →</button>
      </div>` : ''}
      <div class="sg-grammar-card">
        <div class="sg-grammar-title">${ex.tenseInfo.name}</div>
        <div class="sg-grammar-formula">${ex.tenseInfo.formula}</div>
      </div>
      ${wordBadge}
    </div>`;
  }
}

// Nokta göstergesi — ikon tabanlı, tıklanabilir. Her nokta belirli bir
// soruyu/cümleyi temsil eder ve tıklanınca doğrudan o soruya, verdiğin son
// cevapla birlikte geri döner (jumpFnPrefix + "idx)" şeklinde onclick üretir).
function grStateDotsHtml(itemStates, target, activeIdx, jumpFnPrefix) {
  const dots = Array.from({length: target}).map((_, k) => {
    const st = (itemStates[k] || { status: 'unanswered' }).status;
    let inner = '';
    let cls = 'gr-state-dot';
    if (st === 'correct') { inner = ico('check', 11, '#fff', false); cls += ' correct'; }
    else if (st === 'correct-retry') { inner = ico('repeat', 11, '#fff', false); cls += ' correct-retry'; }
    else if (st === 'wrong') { inner = ico('x', 11, '#fff', false); cls += ' wrong'; }
    if (k === activeIdx) cls += ' active';
    return `<button class="${cls}" onclick="${jumpFnPrefix}${k})" title="${k+1}. soru">${inner}</button>`;
  }).join('');
  return `<div class="gr-state-dots">${dots}</div>`;
}

function grSelectQuizOption(j, optIdx) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const idx = s._viewIdx % s.quizPool.length;
  const item = s._itemStates[idx];
  if (item && item.status !== 'unanswered' && s._retrying !== idx) return;
  s._pending = { idx, opt: optIdx };
  grRenderVerify(t, j);
}

function grCheckQuizAnswer(j, target) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const idx = s._viewIdx % s.quizPool.length;
  if (!s._pending || s._pending.idx !== idx) return;
  const q = s.quizPool[idx];
  const wasAlreadyWrong = s._itemStates[idx] && s._itemStates[idx].status === 'wrong';
  const isCorrect = s._pending.opt === q.correct;
  if (isCorrect) {
    s._itemStates[idx] = {
      status: wasAlreadyWrong ? 'correct-retry' : 'correct',
      selected: s._pending.opt,
      firstWrong: wasAlreadyWrong ? s._itemStates[idx].firstWrong : undefined,
    };
  } else {
    s._itemStates[idx] = {
      status: 'wrong',
      selected: s._pending.opt,
      firstWrong: wasAlreadyWrong ? s._itemStates[idx].firstWrong : s._pending.opt,
    };
  }
  s._pending = null;
  s._retrying = null;
  saveState();  // gr-state-dots durumu kalıcı olsun (bkz. backlog #11)
  grRenderVerify(t, j);
}

// Yanlış cevaptan sonra AYNI soruyu tekrar dener — durum 'wrong' olarak
// kalır ta ki doğru bilinceye kadar; doğru bilinirse 'correct-retry' olur
// (ilerlemeye yine de sayılır, sadece ayrı bir ikonla — mor ↺✓ — işaretlenir).
function grRetryQuiz(j) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const idx = s._viewIdx % s.quizPool.length;
  s._retrying = idx;
  s._pending = null;
  grRenderVerify(t, j);
}

function grAdvanceQuiz(j, target) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  s._viewIdx = (s._viewIdx + 1) % s.quizPool.length;
  s._pending = null;
  s._retrying = null;
  const progressCount = Object.values(s._itemStates).filter(x => x.status === 'correct' || x.status === 'correct-retry').length;
  if (progressCount >= target) {
    const wasComplete = t.subs.every(s2 => grIsLearned(t.topicId, s2.id));
    grMarkLearned(t.topicId, s.id);
    grRenderVerify(t, j);
    document.getElementById('gr-dot-'+j).classList.add('done');
    grMarkAccDone(j);
    if (!wasComplete && t.subs.every(s2 => grIsLearned(t.topicId, s2.id))) grShowTopicCelebration(t);
  } else {
    grRenderVerify(t, j);
  }
}

// Cevaplamadan sadece havuzdaki başka bir soruyu görmek için (dir: +1/-1).
function grSkipQuiz(j, dir) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const len = s.quizPool.length;
  s._viewIdx = ((s._viewIdx + dir) % len + len) % len;
  s._pending = null;
  s._retrying = null;
  grRenderVerify(t, j);
}

// Nokta göstergesine tıklayınca doğrudan o soruya git.
function grJumpQuizItem(j, idx) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  s._viewIdx = idx;
  s._pending = null;
  s._retrying = null;
  grRenderVerify(t, j);
}

// Kelime rozeti — quiz/örnek cümlesinde word-data.json'da kayıtlı bir kelime
// varsa gösterilir. Gerçek srsStore/favorites'a yazan mevcut fonksiyonları
// (quickSetStatus, toggleFavFromRow) kullanır — ayrı bir depo değil.
function grWordBadgeHtml(relatedWords) {
  if (!relatedWords || relatedWords.length === 0) return '';
  return relatedWords.slice(0, 2).map(rw => {
    const w = { word: rw.word, pos: rw.pos };
    const k = wkey(w);
    const isKnown = progress[k] && progress[k].mastery === 'mastered';
    const isLearning = progress[k] && progress[k].mastery === 'reviewing';
    const isFav = !!favorites[k];
    const cefrTag = rw.cefr ? `<span class="gr-word-tag">${rw.cefr}</span>` : '';
    const freqTag = rw.freq ? `<span class="gr-word-tag">${rw.freq.replace(' Frequency','')}</span>` : '';
    const posTag = rw.pos ? `<span class="gr-word-tag">${rw.pos}</span>` : '';
    const speakTag = rw.speaking ? `<span class="gr-word-tag">${rw.speaking}</span>` : '';
    const writeTag = rw.writing ? `<span class="gr-word-tag">${rw.writing}</span>` : '';
    const voaTag = rw.voa ? `<span class="gr-word-tag gr-word-tag-voa">VOA</span>` : '';
    return `<div class="gr-word-badge">
      <div class="gr-word-badge-top">
        <b>${rw.word}</b>${cefrTag}${posTag}${freqTag}${speakTag}${writeTag}${voaTag}
        <span onclick="event.stopPropagation();toggleFavFromRow('${rw.word.replace(/'/g,"\\'")}','${(rw.pos||'').replace(/'/g,"\\'")}');grRefreshWordBadges();" style="cursor:pointer;color:${isFav?'#e0a63c':'var(--border2)'};font-size:16px;margin-left:auto;">${isFav?'★':'☆'}</span>
      </div>
      <div class="gr-word-badge-actions">
        <button class="gr-word-btn ${isLearning?'on':''}" onclick="event.stopPropagation();quickSetStatus('${rw.word.replace(/'/g,"\\'")}','${(rw.pos||'').replace(/'/g,"\\'")}',false);grRefreshWordBadges();">${ico('repeat',13)}Öğreniyorum</button>
        <button class="gr-word-btn ${isKnown?'on':''}" onclick="event.stopPropagation();quickSetStatus('${rw.word.replace(/'/g,"\\'")}','${(rw.pos||'').replace(/'/g,"\\'")}',true);grRefreshWordBadges();">${ico('check',13)}Biliyorum</button>
      </div>
    </div>`;
  }).join('');
}
// word-data'da bulunamayan hedef kelimeler için — Cümle Kur egzersizinin
// kendi cefr/freq bilgisiyle salt-okunur bilgi satırı. Kelime Listem'de
// izlenebilir bir kayıt olmadığı için Biliyorum/Öğreniyorum/Favorile
// butonları göstermiyoruz (uydurma bir bağlantı kurmuş oluruz).
function grWordBadgeReadonlyHtml(targetWord, cefr, freq) {
  if (!targetWord) return '';
  const cefrTag = cefr ? `<span class="gr-word-tag">${cefr}</span>` : '';
  const freqTag = freq ? `<span class="gr-word-tag">${freq.replace(' Frequency','')}</span>` : '';
  return `<div class="gr-word-badge">
    <div class="gr-word-badge-top"><b>${targetWord}</b>${cefrTag}${freqTag}</div>
  </div>`;
}

function grRefreshWordBadges() {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  if (t) t.subs.forEach((s, j) => { if (document.getElementById('gr-verify-'+j)) grRenderVerify(t, j); });
}

// targetWord (ör. "pushes") için word-data.json'da kök/çekim toleranslı POS
// araması — sentence-exercises.json zaten cefr+freq veriyor, biz sadece
// pos'u tamamlıyoruz (bulursa gerçek Kelime Listem kaydına bağlanır).
function grLemmaCandidates(token) {
  const t = token.toLowerCase();
  const c = [t];
  if (t.endsWith('ies') && t.length > 4) c.push(t.slice(0, -3) + 'y');
  if (t.endsWith('es') && t.length > 3) { c.push(t.slice(0, -2)); c.push(t.slice(0, -1)); }
  if (t.endsWith('s') && t.length > 3) c.push(t.slice(0, -1));
  if (t.endsWith('ed') && t.length > 4) { c.push(t.slice(0, -2)); c.push(t.slice(0, -1)); }
  if (t.endsWith('ing') && t.length > 5) { c.push(t.slice(0, -3)); c.push(t.slice(0, -3) + 'e'); }
  return [...new Set(c)];
}

// sentence-exercises.json'da olumlu/olumsuz/soru ayrımı için ayrı bir alan
// olmadığından, cümle metninden tahmin ediyoruz. Kesin değil ama "Negative"
// alt maddesine olumlu örnek düşmesi gibi bariz uyumsuzlukları önler.
function grExercisePolarity(ex) {
  const text = (ex.root.join(' ') + ' ' + (ex.chunks||[]).map(c=>c.text).join(' ')).trim();
  const lower = text.toLowerCase();
  if (/\b(don't|doesn't|didn't|won't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|can't|couldn't|shouldn't|wouldn't|not)\b/.test(lower) || /n't\b/.test(lower)) {
    return 'negative';
  }
  const firstWord = (ex.root[0] || '').toLowerCase();
  if (/\?\s*$/.test(text) || ['do','does','did','is','are','was','were','have','has','had','can','could','will','would','should','what','where','when','why','how','who','which'].includes(firstWord)) {
    return 'question';
  }
  return 'affirmative';
}

// Alt madde adından ("Negative"/"Olumsuz", "Question"/"Soru" vb.) hangi
// kutuplukta örnek istendiğini çıkarır. Belirsizse null (fark etmez).
function grDesiredPolarity(sub) {
  const hay = ((sub.guideword||'') + ' ' + (sub.title||'')).toLowerCase();
  if (/negat|olumsuz/.test(hay)) return 'negative';
  if (/question|soru/.test(hay)) return 'question';
  if (/affirmat|olumlu/.test(hay)) return 'affirmative';
  return null;
}

// Bir alt maddenin toplam soru/cümle hedefini, havuzu MUTASYONA UĞRATMADAN
// hesaplar (grRenderVerify'daki target hesaplama mantığının salt-okunur
// kopyası). #12 ilerleme ekranı, henüz hiç açılmamış alt maddeler için de
// "cevaplanmamış" sayısını bilmek zorunda; bu da s.quizPool/s._pool henüz
// oluşmadan target'a ihtiyaç duyar.
function grSubTargetCount(t, s) {
  const effectiveVerifyType = s.verifyType || t.verifyType;
  if (effectiveVerifyType === 'quiz') {
    const pool = s.quizPool || (s.quiz ? [s.quiz] : []);
    return pool.length;
  } else if (effectiveVerifyType === 'sentencekur') {
    let pool = (window.SENTENCE_EXERCISES || []).filter(ex => ex.tense === t.tense);
    const desiredPolarity = grDesiredPolarity(s);
    if (desiredPolarity) {
      const filtered = pool.filter(ex => grExercisePolarity(ex) === desiredPolarity);
      if (filtered.length > 0) pool = filtered;
    }
    return Math.min(5, pool.length);
  }
  return 0;
}

// #12 — Tüm seviye/konu/alt maddeler taranarak soru bazlı ilerleme dizini
// kurulur: her soru 'unanswered' | 'wrong' | 'correct-retry' kovalarından
// birine düşer (tam doğru bilinenler zaten grIsLearned ile ayrı gösteriliyor,
// burada tekrar listelenmez — bu ekranın amacı GERİ KALANI görünür kılmak).
function grBuildProgressIndex() {
  const levels = ['A1','A2','B1','B2','C1','C2'];
  const buckets = { wrong: [], retry: [], unanswered: [] };
  levels.forEach(lv => {
    grTopicsFor(lv).forEach((t, ti) => {
      t.subs.forEach((s, si) => {
        if (grIsLearned(t.topicId, s.id)) return;  // tamamlanmış alt madde — dahil değil
        const effectiveVerifyType = s.verifyType || t.verifyType;
        if (effectiveVerifyType !== 'quiz' && effectiveVerifyType !== 'sentencekur') return;
        const target = grSubTargetCount(t, s);
        if (target === 0) return;
        const itemStates = grGetItemStates(t.topicId, s.id);
        for (let idx = 0; idx < target; idx++) {
          const st = (itemStates[idx] || { status: 'unanswered' }).status;
          const entry = { level: lv, topicIdx: ti, subIdx: si, topicTitle: t.title, subTitle: s.title, idx };
          if (st === 'wrong') buckets.wrong.push(entry);
          else if (st === 'correct-retry') buckets.retry.push(entry);
          else if (st === 'unanswered') buckets.unanswered.push(entry);
        }
      });
    });
  });
  return buckets;
}

let grReviewTab = 'wrong';
function grShowReview() {
  grReviewTab = 'wrong';
  grRenderReview();
  document.getElementById('gr-levels-view').classList.add('hidden');
  document.getElementById('gr-topics-view').classList.add('hidden');
  document.getElementById('gr-detail-view').classList.add('hidden');
  document.getElementById('gr-review-view').classList.remove('hidden');
}
function grBackFromReview() { grInit(); }

function grSetReviewTab(tab) { grReviewTab = tab; grRenderReview(); }

function grRenderReview() {
  const idx = grBuildProgressIndex();
  const tabDefs = [
    { key: 'wrong', label: 'Yanlış kalmış', list: idx.wrong },
    { key: 'retry', label: 'Tekrarlanmış', list: idx.retry },
    { key: 'unanswered', label: 'Cevaplanmamış', list: idx.unanswered },
  ];
  const tabsHtml = tabDefs.map(td =>
    `<button class="gr-review-tab ${grReviewTab===td.key?'active':''}" onclick="grSetReviewTab('${td.key}')">${td.label} <span class="gr-review-count">${td.list.length}</span></button>`
  ).join('');
  const active = tabDefs.find(td => td.key === grReviewTab);
  const listHtml = active.list.length === 0
    ? `<p style="font-size:12.5px;color:var(--text3);padding:12px 2px;">Bu kategoride şu an soru yok.</p>`
    : active.list.map(e => `
      <div class="gr-review-item" onclick="grJumpToReviewItem('${e.level}',${e.topicIdx},${e.subIdx},${e.idx})">
        <div class="gr-review-item-main">
          <div class="gr-review-item-title">${e.topicTitle} <span style="color:var(--text3);font-weight:400;">· ${e.subTitle}</span></div>
          <div class="gr-review-item-meta">${e.level} · Soru ${e.idx+1}</div>
        </div>
        <span class="gr-topic-chevron">&#8250;</span>
      </div>`).join('');
  document.getElementById('gr-review-tabs').innerHTML = tabsHtml;
  document.getElementById('gr-review-list').innerHTML = listHtml;
}

// Gözden geçirme listesinden bir soruya doğrudan atlar: ilgili konuyu açar,
// alt madde accordion'ını genişletir ve o soru/cümle indeksine (_viewIdx) gider.
function grJumpToReviewItem(level, topicIdx, subIdx, itemIdx) {
  grLevel = level;
  grOpenTopic(topicIdx);
  const t = grTopicsFor(grLevel)[topicIdx];
  const s = t.subs[subIdx];
  s._viewIdx = itemIdx;
  s._pending = null;
  s._retrying = null;
  grToggleAcc(subIdx, true);
  grRenderVerify(t, subIdx);
  setTimeout(() => grJumpTo(subIdx), 50);
}

// Sub-level 'quiz' override'lı bir alt madde, tense'e bağlı bir konuya
// (t.tense) aitse — kardeşi olan sentencekur alt maddesindeki formül
// kutusunu (ör. "Present Simple: Özne + Fiil...") burada da gösterir,
// böylece Negative/Question gibi konularda da tense hatırlatması kalır.
function grTenseFormulaCardHtml(tenseName) {
  if (!tenseName) return '';
  const ex = (window.SENTENCE_EXERCISES || []).find(e => e.tense === tenseName && e.tenseInfo);
  if (!ex) return '';
  return `<div class="sg-grammar-card">
    <div class="sg-grammar-title">${ex.tenseInfo.name}</div>
    <div class="sg-grammar-formula">${ex.tenseInfo.formula}</div>
  </div>`;
}

function grFindWordDataEntry(word) {
  const pool = (window.WORD_DATA || []).concat(window.EXTRA_WORDS || []);
  for (const lemma of grLemmaCandidates(word)) {
    const hit = pool.find(w => w.word && w.word.toLowerCase() === lemma);
    if (hit) return hit;
  }
  return null;
}

function grSelectPracticeOption(j, val) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const target = Math.min(5, s._pool.length);
  const idx = s._viewIdx % target;
  const item = s._itemStates[idx];
  if (item && item.status !== 'unanswered' && s._retrying !== idx) return;
  s._pending = { idx, opt: val };
  grRenderVerify(t, j);
}

function grCheckPracticeAnswer(j, target) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const idx = s._viewIdx % target;
  if (!s._pending || s._pending.idx !== idx) return;
  const prev = s._itemStates[idx];
  const wasAlreadyWrong = prev && prev.status === 'wrong';
  const isCorrect = s._pending.opt === true;  // havuzdaki cümleler hep doğru, "Evet" doğru cevaptır
  if (isCorrect) {
    s._itemStates[idx] = {
      status: wasAlreadyWrong ? 'correct-retry' : 'correct',
      selected: s._pending.opt,
      firstWrong: wasAlreadyWrong ? prev.firstWrong : undefined,
    };
  } else {
    s._itemStates[idx] = {
      status: 'wrong',
      selected: s._pending.opt,
      firstWrong: wasAlreadyWrong ? prev.firstWrong : s._pending.opt,
    };
  }
  s._pending = null;
  s._retrying = null;
  saveState();  // gr-state-dots durumu kalıcı olsun (bkz. backlog #11)
  grRenderVerify(t, j);
}

// Yanlış cevaptan sonra AYNI cümleyi tekrar dener — doğru bilirse 'correct-retry'
// olur (ilerlemeye sayılır ama ayrı bir ikonla — ↺✓ — işaretlenir).
function grRetryPractice(j) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const target = Math.min(5, s._pool.length);
  const idx = s._viewIdx % target;
  s._retrying = idx;
  s._pending = null;
  grRenderVerify(t, j);
}

function grAdvancePractice(j, target) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  s._viewIdx = (s._viewIdx + 1) % target;
  s._pending = null;
  s._retrying = null;
  const progressCount = Object.values(s._itemStates).filter(x => x.status === 'correct' || x.status === 'correct-retry').length;
  if (progressCount >= target) {
    const wasComplete = t.subs.every(s2 => grIsLearned(t.topicId, s2.id));
    grMarkLearned(t.topicId, s.id);
    grRenderVerify(t, j);
    document.getElementById('gr-dot-'+j).classList.add('done');
    grMarkAccDone(j);
    if (!wasComplete && t.subs.every(s2 => grIsLearned(t.topicId, s2.id))) grShowTopicCelebration(t);
  } else {
    grRenderVerify(t, j);
  }
}
// Cevaplamadan sadece havuzdaki başka bir cümleyi görmek için (dir: +1/-1).
function grSkipPractice(j, dir) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  const target = Math.min(5, s._pool.length);
  s._viewIdx = ((s._viewIdx + dir) % target + target) % target;
  s._pending = null;
  s._retrying = null;
  grRenderVerify(t, j);
}
// Nokta göstergesine tıklayınca doğrudan o cümleye git.
function grJumpPracticeItem(j, idx) {
  const t = grTopicsFor(grLevel)[grTopicIdx];
  const s = t.subs[j];
  s._viewIdx = idx;
  s._pending = null;
  s._retrying = null;
  grRenderVerify(t, j);
}

function grToggleTr(btn) {
  const box = btn.nextElementSibling;
  const showing = box.classList.toggle('show');
  btn.classList.toggle('on', showing);
  const label = btn.querySelector('.tr-toggle-label');
  if (label) label.textContent = showing ? 'Türkçesini gizle' : 'Türkçesini göster';
}

// ═══════════════════════════════════════════════════════════════════════
// ÜNİTELER — kelimeleri birincil kategoriye (categories[0], Oxford
// taksonomisi) göre numaralı ünitelere böler, her ünitede 4 adımlı bir
// patika sunar: Kelime Tanıtımı → Eşleştirme → Yazım → Test. Telaffuz
// adımı bilinçli olarak sonraya bırakıldı (mikrofon/PWA+Safari ayrı bir
// araştırma gerektiriyor).
//
// KATEGORİ BAŞINA CHUNK: gerçek veriyle kategoriler tek ünite olamayacak
// kadar büyük çıkıyor (örn. C1 "Politics and society" 590 kelime) —
// her kategori ~17 kelimelik alt-ünitelere bölünüyor (unitsChunkWords).
// AYNI KELİMENİN farklı sözcük türü (pos) kayıtları TEK kayda indiriliyor
// (word'e göre, word+pos'a göre DEĞİL) — aksi halde "alone" (adverb) ve
// "alone" (adjective) aynı ünitede görsel olarak ayırt edilemeyen iki ayrı
// kayıt olarak beliriyordu (gerçek cihazda yakalandı).
//
// ÖNBELLEKLEME: unitsBuildForLevel() artık seviye başına BİR KEZ
// hesaplanıp unitsCache'te saklanıyor — 27.926+19.983 kayıtlık gerçek
// veriyle her render'da yeniden hesaplamak pahalı olurdu.
// ═══════════════════════════════════════════════════════════════════════
let unitsLevel = 'A1';
let unitsOpenId = null;
let unitsStepView = null; // {unitId, step, unit}
let unitsStepIdx = 0;
let unitsMatchState = null;
const unitsCache = {}; // { A1: [...], A2: [...], ... } — bir kez hesaplanır

const UNIT_STEP_DEFS = [
  { key:'intro', label:'Kelime Tanıtımı', icon:'clipboard' },
  { key:'match', label:'Eşleştirme',      icon:'swap' },
  { key:'spell', label:'Yazım',           icon:'pencil' },
  { key:'quiz',  label:'Test',            icon:'target' },
  { key:'speak', label:'Telaffuz',        icon:'headphones', disabled:true },
];

// Bir kategori hedef boyuttan büyükse ~TARGET kelimelik parçalara böler.
// Kategori TARGET*1.5'ten küçükse hiç bölünmez (örn. 20 kelimeyi 10+10 diye
// gereksiz ikiye ayırmamak için). Parçalar mümkün olduğunca eşit boyutlu.
function unitsChunkWords(words, target) {
  target = target || 17;
  const n = words.length;
  if (n <= target * 1.5) return [words];
  const chunkCount = Math.max(1, Math.round(n / target));
  const base = Math.floor(n / chunkCount);
  const remainder = n % chunkCount;
  const chunks = [];
  let idx = 0;
  for (let c = 0; c < chunkCount; c++) {
    const size = base + (c < remainder ? 1 : 0);
    chunks.push(words.slice(idx, idx + size));
    idx += size;
  }
  return chunks;
}

function unitsBuildForLevel(lv) {
  if (unitsCache[lv]) return unitsCache[lv];
  const pool = ALL_CATEGORY_WORDS.filter(w => w.cefr === lv && w.categories && w.categories.length);
  const map = {};
  pool.forEach(w => {
    const cat = w.categories[0];
    if (!map[cat]) map[cat] = [];
    if (!map[cat].some(x => x.word.toLowerCase() === w.word.toLowerCase())) map[cat].push(w);
  });
  const cats = Object.keys(map).sort((a, b) => a.localeCompare(b));
  const units = [];
  let num = 0;
  cats.forEach(cat => {
    const chunks = unitsChunkWords(map[cat], 17);
    chunks.forEach((chunkWords, ci) => {
      num++;
      const name = chunks.length > 1 ? `${cat} ${ci + 1}/${chunks.length}` : cat;
      units.push({ id: lv + ':' + cat + ':' + ci, num, name, cat, words: chunkWords });
    });
  });
  unitsCache[lv] = units;
  return units;
}

function unitsCategoryStyle(cat) {
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
  const icons = ['box','star','bolt','pin','palette','chat','folder','user','book','target'];
  return { grad: hash % GR_VIVID_GRADIENTS.length, icon: icons[hash % icons.length] };
}

// Kalıcı ilerleme: srsStore üzerinde "unit:" ön ekiyle — saveState()/
// cloudSaveState() zaten srsStore'u senkronize ediyor, ek kod gerekmiyor.
function unitProgress(unitId) {
  const key = 'unit:' + unitId;
  if (!srsStore[key]) srsStore[key] = { doneSteps: [] };
  return srsStore[key];
}

function unitsInit() {
  document.getElementById('unit-list-view').classList.remove('hidden');
  document.getElementById('unit-step-view').classList.add('hidden');
  unitsRenderLevelRow();
  unitsRenderList();
}

function unitsRenderLevelRow() {
  const el = document.getElementById('unit-level-row');
  const levels = ['A1','A2','B1','B2','C1'];
  el.innerHTML = levels.map(lv => {
    const n = unitsBuildForLevel(lv).length;
    return `<button class="chip lvl-${lv.toLowerCase()}${lv===unitsLevel?' on':''}" onclick="unitsSelectLevel('${lv}')">${lv}<span class="n">(${n})</span></button>`;
  }).join('');
}
function unitsSelectLevel(lv) { unitsLevel = lv; unitsOpenId = null; unitsRenderLevelRow(); unitsRenderList(); }

function unitsRenderList() {
  const units = unitsBuildForLevel(unitsLevel);
  const el = document.getElementById('unit-list');
  const title = document.getElementById('unit-list-title');
  if (title) title.textContent = unitsLevel + ' Seviye Kelime Üniteleri (' + units.length + ')';
  if (!units.length) { el.innerHTML = '<p style="font-size:13px;color:var(--text3);padding:20px 0;">Bu seviyede henüz kategorize kelime yok.</p>'; return; }
  el.innerHTML = units.map(u => {
    const st = unitsCategoryStyle(u.cat || u.name);
    const c1 = GR_VIVID_GRADIENTS[st.grad][0], c2 = GR_VIVID_GRADIENTS[st.grad][1];
    const prog = unitProgress(u.id);
    const doneCount = prog.doneSteps.length;
    const allDone = doneCount >= 4;
    const open = (u.id === unitsOpenId);
    return `<div class="gr-topic-card" style="border-left:4px solid ${c1};">
      <div class="gr-topic-row" onclick="unitsToggleCard('${u.id}')">
        <div class="gr-topic-icon ${allDone?'done':''}" style="background:linear-gradient(135deg,${c1},${c2});color:#fff;">${ico(st.icon,19,'#fff',false)}</div>
        <div class="gr-topic-main">
          <div class="gr-topic-name">${u.num}. ${u.name}</div>
          <div class="gr-topic-meta">${u.words.length} kelime · ${doneCount}/4 adım tamam</div>
        </div>
        <span class="gr-topic-chevron">${open?'&#8963;':'&#8250;'}</span>
      </div>
      ${open ? unitsPathHtml(u, prog) : ''}
    </div>`;
  }).join('');
}
function unitsToggleCard(id) { unitsOpenId = (unitsOpenId === id) ? null : id; unitsRenderList(); }

function unitsPathHtml(u, prog) {
  const curStep = Math.min(prog.doneSteps.length, 3);
  const stepsHtml = UNIT_STEP_DEFS.map((s, i) => {
    const done = prog.doneSteps.includes(i);
    const isCurrent = !s.disabled && i === curStep;
    const cls = s.disabled ? 'disabled' : (done ? 'done' : (isCurrent ? 'current' : ''));
    const lineHtml = i > 0 ? `<div class="unit-step-line ${prog.doneSteps.includes(i-1)?'done':''}"></div>` : '';
    const onclick = s.disabled ? `unitsShowSoonToast()` : `unitsStartStep('${u.id}',${i})`;
    return `${lineHtml}<div class="unit-step ${cls}" onclick="event.stopPropagation();${onclick}">${ico(s.icon,17,'currentColor',false)}${done?'<span style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--success);color:#fff;font-size:8px;display:flex;align-items:center;justify-content:center;border:2px solid var(--surface);">✓</span>':''}</div>`;
  }).join('');
  return `<div class="unit-path-wrap">
    <div class="unit-path">${stepsHtml}</div>
    <div class="unit-actions">
      <span class="unit-progress-txt">${UNIT_STEP_DEFS[curStep].label}</span>
      <button class="unit-start-btn" onclick="event.stopPropagation();unitsStartStep('${u.id}',${curStep})">${ico('play',14,'#fff',false)}Başla</button>
    </div>
  </div>`;
}
function unitsShowSoonToast() { alert('Telaffuz pratiği yakında geliyor — önce diğer 4 adım tamamlanıyor.'); }

function unitsStartStep(unitId, stepIdx) {
  const lv = unitId.split(':')[0];
  const u = unitsBuildForLevel(lv).find(x => x.id === unitId);
  if (!u) return;
  unitsStepView = { unitId, step: stepIdx, unit: u };
  unitsStepIdx = 0;
  document.getElementById('unit-list-view').classList.add('hidden');
  document.getElementById('unit-step-view').classList.remove('hidden');
  document.getElementById('unit-step-title').textContent = u.num + '. ' + u.name + ' — ' + UNIT_STEP_DEFS[stepIdx].label;
  unitsRenderStep();
}
function unitsExitStep() {
  document.getElementById('unit-step-view').classList.add('hidden');
  document.getElementById('unit-list-view').classList.remove('hidden');
  unitsStepView = null;
  unitsRenderList();
}
function unitsRenderStep() {
  const { step, unit } = unitsStepView;
  const key = UNIT_STEP_DEFS[step].key;
  if (key === 'intro') unitsRenderIntroStep(unit);
  else if (key === 'match') unitsRenderMatchStep(unit);
  else if (key === 'spell') unitsRenderSpellStep(unit);
  else if (key === 'quiz') unitsRenderQuizStep(unit);
}
function unitsCompleteStep(stepIdx) {
  const { unitId } = unitsStepView;
  const prog = unitProgress(unitId);
  if (!prog.doneSteps.includes(stepIdx)) prog.doneSteps.push(stepIdx);
  saveState();
  const nextIdx = stepIdx + 1;
  if (nextIdx < 4) {
    unitsStepView.step = nextIdx;
    unitsStepIdx = 0;
    document.getElementById('unit-step-title').textContent = unitsStepView.unit.num + '. ' + unitsStepView.unit.name + ' — ' + UNIT_STEP_DEFS[nextIdx].label;
    unitsRenderStep();
  } else {
    unitsExitStep();
  }
}
function unitsRenderStepTooFew(stepIdx) {
  document.getElementById('unit-step-body').innerHTML = `<p style="font-size:13px;color:var(--text3);margin-bottom:14px;">Bu ünitede bu egzersiz için yeterli kelime yok.</p><button class="unit-start-btn" onclick="unitsCompleteStep(${stepIdx})">Devam Et</button>`;
}

// ── ADIM 1: Kelime Tanıtımı — mevcut renderListDefHTML() aynen devşiriliyor ──
function unitsRenderIntroStep(u) {
  const w = u.words[unitsStepIdx];
  const c = BUILTIN_CONTENT[w.word + '|' + w.pos];
  const body = document.getElementById('unit-step-body');
  body.innerHTML = `<div class="dict-card">
      <div class="wordfont" style="font-size:24px;margin-bottom:2px;">${w.word}</div>
      <div style="font-size:12px;color:var(--text3);font-style:italic;margin-bottom:14px;">${w.pos}</div>
      ${c ? renderListDefHTML(c, w) : '<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}
    </div>
    <div class="unit-actions">
      <span class="unit-progress-txt">${unitsStepIdx+1} / ${u.words.length}</span>
      <button class="unit-start-btn" onclick="unitsIntroNext()">${unitsStepIdx+1>=u.words.length?'Bitir':'Sonraki'} ${ico('play',13,'#fff',false)}</button>
    </div>`;
  ttsWireButtons(body);
}
function unitsIntroNext() {
  const { unit } = unitsStepView;
  if (unitsStepIdx + 1 < unit.words.length) { unitsStepIdx++; unitsRenderIntroStep(unit); }
  else unitsCompleteStep(0);
}

// ── ADIM 2: Eşleştirme — EN kelime ↔ TR anlam eşleştirme oyunu ─────────────
// Çeldiriciler aynı kategorideki başka kelimelerin GERÇEK Türkçe
// karşılıklarından seçiliyor — sadece N'e N eşleştirme sona doğru eleme
// yöntemiyle kolay çözülüyordu (gerçek cihazda yakalandı).
function unitsRenderMatchStep(u) {
  const withContent = u.words.filter(w => {
    const c = BUILTIN_CONTENT[w.word + '|' + w.pos];
    return c && c.turkish && c.turkish.trim();
  });
  if (withContent.length < 2) { unitsRenderStepTooFew(1); return; }
  const words = withContent.slice(0, 6);
  const trOf = w => BUILTIN_CONTENT[w.word+'|'+w.pos].turkish;

  const chosenKeys = new Set(words.map(w => w.word + '|' + w.pos));
  const decoyPool = (u.cat ? ALL_CATEGORY_WORDS.filter(w => (w.categories||[])[0] === u.cat) : [])
    .filter(w => !chosenKeys.has(w.word + '|' + w.pos))
    .filter(w => { const c = BUILTIN_CONTENT[w.word+'|'+w.pos]; return c && c.turkish && c.turkish.trim(); });
  const shuffledDecoys = decoyPool.sort(() => Math.random() - 0.5).slice(0, 2);

  const enTiles = words.map((w,i) => ({ id:'en'+i, wIdx:i, text: w.word }));
  const trTiles = words.map((w,i) => ({ id:'tr'+i, wIdx:i, text: trOf(w) }));
  shuffledDecoys.forEach((w,i) => trTiles.push({ id:'dec'+i, wIdx:-1, text: BUILTIN_CONTENT[w.word+'|'+w.pos].turkish }));
  for (let i = trTiles.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [trTiles[i],trTiles[j]]=[trTiles[j],trTiles[i]]; }
  unitsMatchState = { words, enTiles, trTiles, selectedEn:null, selectedTr:null, matched:new Set(), wrongPair:null };
  unitsRenderMatchBoard();
}
function unitsRenderMatchBoard() {
  const s = unitsMatchState;
  const body = document.getElementById('unit-step-body');
  const tileHtml = (t, side) => {
    const isMatched = s.matched.has(t.wIdx) && t.wIdx !== -1;
    const isSel = (side==='en' ? s.selectedEn : s.selectedTr) === t.id;
    const isWrong = s.wrongPair && (s.wrongPair.en === t.id || s.wrongPair.tr === t.id);
    const cls = isMatched ? ' correct' : (isWrong ? ' wrong' : '');
    return `<button class="unit-quiz-option${cls}" style="${isSel && !isWrong?'border-color:var(--accent);':''}${isMatched?'pointer-events:none;opacity:.55;':''}" onclick="unitsMatchPick('${side}','${t.id}')">${t.text}</button>`;
  };
  body.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>${s.enTiles.map(t=>tileHtml(t,'en')).join('')}</div>
      <div>${s.trTiles.map(t=>tileHtml(t,'tr')).join('')}</div>
    </div>
    <p class="unit-progress-txt" style="margin-top:10px;">${s.matched.size} / ${s.words.length} eşleşti</p>`;
}
function unitsMatchPick(side, id) {
  const s = unitsMatchState;
  if (s.wrongPair) return;
  if (side==='en') s.selectedEn = (s.selectedEn===id?null:id); else s.selectedTr = (s.selectedTr===id?null:id);
  if (s.selectedEn && s.selectedTr) {
    const enT = s.enTiles.find(t=>t.id===s.selectedEn);
    const trT = s.trTiles.find(t=>t.id===s.selectedTr);
    const isCorrect = trT.wIdx !== -1 && enT.wIdx === trT.wIdx;
    if (isCorrect) {
      s.matched.add(enT.wIdx);
      s.selectedEn = null; s.selectedTr = null;
      if (s.matched.size === s.words.length) { unitsRenderMatchBoard(); setTimeout(()=>unitsCompleteStep(1), 500); return; }
    } else {
      s.wrongPair = { en: s.selectedEn, tr: s.selectedTr };
      unitsRenderMatchBoard();
      setTimeout(() => { s.wrongPair = null; s.selectedEn = null; s.selectedTr = null; unitsRenderMatchBoard(); }, 550);
      return;
    }
  }
  unitsRenderMatchBoard();
}

// ── ADIM 3: Yazım — TR anlamı verilir, İngilizce kelime yazılır ───────────
function unitsRenderSpellStep(u) { unitsRenderSpellCard(u); }
function unitsRenderSpellCard(u) {
  const w = u.words[unitsStepIdx];
  const c = BUILTIN_CONTENT[w.word+'|'+w.pos];
  const body = document.getElementById('unit-step-body');
  body.innerHTML = `<div class="sg-card">
      <div style="font-size:12px;color:var(--text3);margin-bottom:6px;">Türkçe anlamı</div>
      <div style="font-size:17px;font-weight:600;margin-bottom:16px;">${c?.turkish || '—'}</div>
      <input id="unit-spell-input" type="text" placeholder="İngilizce kelimeyi yaz" style="width:100%;padding:12px;border-radius:10px;border:1.5px solid var(--border2);background:var(--surface);color:var(--text);font-size:15px;box-sizing:border-box;" autocapitalize="off" autocorrect="off" spellcheck="false">
      <div id="unit-spell-feedback" style="margin-top:8px;font-size:13px;"></div>
    </div>
    <div class="unit-actions">
      <span class="unit-progress-txt">${unitsStepIdx+1} / ${u.words.length}</span>
      <button class="unit-start-btn" onclick="unitsSpellCheck()">Kontrol Et</button>
    </div>`;
  const inp = document.getElementById('unit-spell-input');
  inp.focus();
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') unitsSpellCheck(); });
}
function unitsSpellCheck() {
  const { unit } = unitsStepView;
  const w = unit.words[unitsStepIdx];
  const inp = document.getElementById('unit-spell-input');
  const fb = document.getElementById('unit-spell-feedback');
  if (inp.disabled) return;
  const ok = inp.value.trim().toLowerCase() === w.word.toLowerCase();
  fb.innerHTML = ok
    ? `<span style="color:var(--success);">${ico('check',13,'var(--success)',false)}Doğru</span>`
    : `<span style="color:var(--danger);">${ico('x',13,'var(--danger)',false)}Doğrusu: <b>${w.word}</b></span>`;
  inp.disabled = true;
  setTimeout(() => {
    if (unitsStepIdx + 1 < unit.words.length) { unitsStepIdx++; unitsRenderSpellCard(unit); }
    else unitsCompleteStep(2);
  }, 1000);
}

// ── ADIM 4: Test — TR anlama göre 4 şıklı İngilizce kelime testi ──────────
function unitsRenderQuizStep(u) {
  if (u.words.length < 2) { unitsRenderStepTooFew(3); return; }
  const w = u.words[unitsStepIdx];
  const c = BUILTIN_CONTENT[w.word+'|'+w.pos];
  const pool = u.words.filter((x,idx) => idx !== unitsStepIdx).sort(() => Math.random()-0.5).slice(0,3);
  const options = [w, ...pool].sort(() => Math.random()-0.5);
  const body = document.getElementById('unit-step-body');
  body.innerHTML = `<div class="sg-card">
      <div style="font-size:12px;color:var(--text3);margin-bottom:6px;">Hangisi bu anlama gelir?</div>
      <div style="font-size:17px;font-weight:600;">${c?.turkish || '—'}</div>
    </div>
    <div id="unit-quiz-options">${options.map(o=>`<button class="unit-quiz-option" data-word="${escAttr(o.word)}" onclick="unitsQuizPick('${o.word.replace(/'/g,"\\'")}','${o.pos.replace(/'/g,"\\'")}')">${o.word}</button>`).join('')}</div>
    <p class="unit-progress-txt" style="margin-top:6px;">${unitsStepIdx+1} / ${u.words.length}</p>`;
}
function unitsQuizPick(word, pos) {
  const { unit } = unitsStepView;
  const w = unit.words[unitsStepIdx];
  const correct = (word === w.word && pos === w.pos);
  document.querySelectorAll('#unit-quiz-options .unit-quiz-option').forEach(btn => {
    if (btn.dataset.word === w.word) btn.classList.add('correct');
    else if (btn.dataset.word === word && !correct) btn.classList.add('wrong');
    btn.onclick = null;
  });
  setTimeout(() => {
    if (unitsStepIdx + 1 < unit.words.length) { unitsStepIdx++; unitsRenderQuizStep(unit); }
    else unitsCompleteStep(3);
  }, 800);
}

hgRenderLevels();
hgRenderFreqFilter();
hgPickWord();
hgLoadStats();
renderListCefrRow();
renderTtsStatus();
