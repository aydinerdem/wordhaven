
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
    : `<div style="font-size:13px;font-weight:600;">🔥 ${n} gün</div>
       <div style="font-size:12px;color:var(--text2);margin-top:2px;">${n >= 7 ? 'Tam hafta!' : 'Seriyi sürdür'}</div>`;

  return `<div class="streak-bar"><div>${head}</div><div class="streak-days">${dots}</div></div>`;
}

// ── Kompakt seviye listesi ─────────────────────────────────────────────────
let dashOpenLevel = null;

function dashLevelRows() {
  return CEFR_LEVELS.map(lv => {
    const words = WORD_DATA.filter(w => w.cefr === lv);
    const mast = words.filter(w => progress[wkey(w)]?.mastery === 'mastered').length;
    const started = words.filter(w => progress[wkey(w)]).length;
    const pct = words.length ? (mast / words.length * 100) : 0;
    const startedPct = words.length ? (started / words.length * 100) : 0;
    const col = CEFR_COLORS[lv];
    const open = dashOpenLevel === lv;

    return `<div class="dash-lvl-row" onclick="dashToggleLevel('${lv}')">
        <span style="font-size:14px;font-weight:600;color:var(${col});width:26px;flex-shrink:0;">${lv}</span>
        <div class="dash-lvl-bar">
          <div style="position:absolute;inset:0;width:${startedPct}%;background:var(${col});opacity:.25;border-radius:99px;"></div>
          <div style="position:absolute;inset:0;width:${pct}%;background:var(${col});border-radius:99px;"></div>
        </div>
        <span style="flex-shrink:0;text-align:right;line-height:1.3;">
          <span style="font-size:12px;color:var(--text2);white-space:nowrap;">${mast} / ${words.length}</span>
          ${started ? `<br><span style="font-size:10.5px;color:var(--text3);white-space:nowrap;">${started} çalışıldı</span>` : ''}
        </span>
        <span style="font-size:11px;color:var(--text3);flex-shrink:0;">${open ? '▾' : '›'}</span>
      </div>
      ${open ? `<div class="dash-lvl-detail">${renderCefrSection(words, lv)}</div>` : ''}`;
  }).join('');
}

function dashToggleLevel(lv) {
  dashOpenLevel = (dashOpenLevel === lv) ? null : lv;
  updateDashboard();
}

// ── Birincil eylem ─────────────────────────────────────────────────────────
function dashStartStudy() {
  // Tekrar Et (view 'filter') eski modül — geliştirme yapılmıyor, menüde
  // korunuyor ama ana akış oraya yönlendirilmiyor. Çalışma her durumda
  // Kart Modu'ndan başlar; tekrar bekleyenler zaten oradaki havuza dahil.
  showView('cardmode');
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
      <div class="dash-hero" style="text-align:center;">
        <div style="font-size:34px;margin-bottom:6px;">📖</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;">WordHaven'a hoş geldin</div>
        <p style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:16px;">
          A1 seviyesinde <b>${a1}</b> kelime seni bekliyor. Günde ${goal} kelime ile başla —
          birkaç dakika yeter.
        </p>
        <button class="start-btn" style="margin-top:0;" onclick="showView('cardmode')">İlk kelimelerini çalış →</button>
      </div>
      <div class="dash-lvl-list">${dashLevelRows()}</div>`;
    return;
  }

  // ── Normal durum ──
  const complete = done >= goal;
  const btnLabel = due > 0
    ? `${due} kelime tekrar zamanı · Kart Modu →`
    : (complete ? 'Çalışmaya devam et →' : 'Kart Modu ile çalış →');

  el.innerHTML = `
    <div class="dash-hero">
      <div style="display:flex;align-items:center;gap:16px;">
        ${dashRing(done, goal)}
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">
            ${complete ? 'Bugünü tamamladın 🎉' : 'Bugün'}
          </div>
          <p style="font-size:13px;color:var(--text2);line-height:1.6;">
            ${dashMessage(done, goal, due, mastered)}
          </p>
          <button class="dash-goal-btn" onclick="dashEditGoal()">Hedef: ${goal} kelime · değiştir</button>
        </div>
      </div>
      <button class="start-btn" onclick="dashStartStudy()">${btnLabel}</button>
    </div>

    ${dashStreakHtml()}

    <div class="dash-summary-row">
      <div><span class="dash-sum-n" style="color:var(--success);">${mastered}</span><span class="dash-sum-l">tam öğrenildi</span></div>
      <div><span class="dash-sum-n" style="color:var(--accent);">${knownNow}</span><span class="dash-sum-l">biliyorum dedin</span></div>
      <div><span class="dash-sum-n" style="color:#a05000;">${learningNow}</span><span class="dash-sum-l">öğreniyorum</span></div>
      <div><span class="dash-sum-n" style="color:var(--warn);">${due}</span><span class="dash-sum-l">tekrar bekliyor</span></div>
    </div>

    <div class="dash-lvl-list">
      <div class="dash-lvl-title">Seviyelerin</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.6;padding:0 0 8px;">
        Koyu dolgu <b>tam öğrenildi</b>, soluk dolgu <b>çalıştıkların</b>.
        Bir kelime, 4 farklı günde doğru hatırlandığında (yaklaşık bir aya yayılarak)
        tam öğrenildi sayılır.
      </div>
      ${dashLevelRows()}
    </div>`;
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

  const chip = (label, on, handler, disabled) =>
    `<button class="chip${on ? ' on' : ''}${disabled ? ' disabled' : ''}" ${disabled ? 'disabled' : ''} onclick="${handler}">${label}</button>`;

  const row = (opts, dim) => opts.map(([v, l]) => {
    const c = gbChipCounts(pool, dim, v);
    return chip(`${l} <span style="color:var(--text3);">(${c.display})</span>`, c.selected,
                `gbToggle('${dim}','${v}')`, c.own === 0 && !c.selected);
  }).join('');

  const voaOwn = gbCountWith(pool, gbFilter.sp, gbFilter.wr, gbFilter.fr, true);
  const total = gbCountWith(pool, gbFilter.sp, gbFilter.wr, gbFilter.fr, gbFilter.voa);
  const on = gbActive();

  el.innerHTML = `
    <details class="gb-details"${on ? ' open' : ''}>
      <summary style="font-size:12px;color:var(--accent);cursor:pointer;">
        Longman / VOA filtresi${on ? ` <span style="color:var(--warn);font-weight:600;">• açık</span>` : ''}
      </summary>
      <div style="margin-top:10px;">
        <div style="font-size:11px;color:var(--text3);line-height:1.6;margin-bottom:10px;">
          Bu seçim tüm modüllerde geçerlidir.
        </div>
        <div class="band-label">Konuşma sıklığı</div>
        <div class="f-row">${row(SP_OPTS, 'sp')}</div>
        <div class="band-label">Yazı sıklığı</div>
        <div class="f-row">${row(WR_OPTS, 'wr')}</div>
        <div class="band-label">Genel frekans</div>
        <div class="f-row">${row(FREQ_OPTS_LIST, 'fr')}</div>
        <div class="band-label">Özel liste</div>
        <div class="f-row">
          ${chip(`VOA çekirdeği <span style="color:var(--text3);">(${voaOwn})</span>`, gbFilter.voa, 'gbToggleVoa()', voaOwn === 0 && !gbFilter.voa).replace('class="chip', `class="chip chip-voa`)}
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
    let html = `<div class="list-word-item" onclick="toggleExtraWord('${k.replace(/'/g, "\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
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
    return `<button class="chip${t === wrTense ? ' on' : ''}${n === 0 ? ' disabled' : ''}" ${n === 0 ? 'disabled' : ''} onclick="wrSelectTense('${t}')">${t}</button>`;
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
    <div class="filter-panel" style="margin-bottom:14px;">
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
        <button class="start-btn" style="flex:1;min-width:130px;margin-top:0;" onclick="wrCheckAnswer()">Kontrol et</button>
        <button class="chip" onclick="wrShowHint()">${wrHintLevel === 0 ? 'İpucu' : wrHintLevel === 1 ? 'Daha fazla ipucu' : 'Cevabı göster'}</button>
        <button class="chip" onclick="wrNextQuestion()">Başka cümle</button>
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

const CEFR_LEVELS = ['A1','A2','B1','B2','C1'];
const CEFR_COLORS = { A1:'--a1', A2:'--a2', B1:'--b1', B2:'--b2', C1:'--c1' };

// ── Paylaşılan çizgi ikon seti — emojilerin yerini alır (sol menüdeki
// ikonlarla aynı dil: 20x20 viewBox, stroke currentColor, 1.6-1.8px, yuvarlak
// uç). Tek bir yerden yönetilir; Kelime Durumu, kelime modalı, Kelime Listem
// sekmeleri ve durum/sıralama chip'lerinin hepsi buradan besleniyor.
const ICO = {
  calendar: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.2" width="13" height="12" rx="1.5"/><path d="M3.5 8h13M7 2.8v2.4M13 2.8v2.4"/></svg>',
  repeat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8.2A6 6 0 0 0 5.6 5.4L4 7"/><path d="M4 11.8A6 6 0 0 0 14.4 14.6L16 13"/><path d="M4 3.8v3.4h3.4M16 16.2v-3.4h-3.4"/></svg>',
  alert: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.5"/><path d="M10 7v3.6"/><circle cx="10" cy="13.2" r=".15" fill="currentColor" stroke-width="2.4"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5 8 14l7.5-8.5"/></svg>',
  trend: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14 8 9.2l3 2.6 5.5-6.3"/><path d="M13.2 5.5H16.5V8.8"/></svg>',
  award: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.3 12 6.7l3.8.6-2.7 2.7.6 3.8L10 12.1l-3.7 1.7.6-3.8-2.7-2.7 3.8-.6z"/><path d="M7.3 10.2 9 12l3.7-4"/></svg>',
  upcoming: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v5.2M13.5 6.6l-3.8 2.8-3.8-2.8"/><rect x="4" y="9.6" width="12" height="6.4" rx="1.4"/></svg>',
  star: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.3 12 6.7l3.8.6-2.7 2.7.6 3.8L10 12.1l-3.7 1.7.6-3.8-2.7-2.7 3.8-.6z"/></svg>',
  clock: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.7"/><path d="M10 6.5V10l2.6 1.6"/></svg>'
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
let filters = {
  cefr: new Set(['A1','A2']),
  sp:   new Set(['S1','S2','S3','']),
  wr:   new Set(['W1','W2','W3','']),
  fr:   new Set(['High Frequency','Medium Frequency','Low Frequency','']),
  mode: 'due'
};
let studyQueue=[], studyIdx=0, flipped=false, requeuedKeys=new Set(), sessionResults={ok:0,miss:0};
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

// ── FILTER & QUEUE ─────────────────────────────────────────────────────────
function filteredWords() {
  // Eski yerel sp/wr/fr seçimleri yerine ortak Longman/VOA filtresi geçerli.
  return WORD_DATA.filter(w => filters.cefr.has(w.cefr) && gbPasses(w));
}
function buildQueue() {
  const fw=filteredWords(), today=todayStr();
  if (filters.mode==='due') return fw.filter(w=>{ const p=progress[wkey(w)]; return p&&p.nextReview<=today; });
  if (filters.mode==='new') return fw.filter(w=>!progress[wkey(w)]).slice(0,20);
  const due=fw.filter(w=>{ const p=progress[wkey(w)]; return p&&p.nextReview<=today; });
  const nw=fw.filter(w=>!progress[wkey(w)]).slice(0,Math.max(0,20-due.length));
  return [...due,...nw];
}

// ── SELECT ALL ─────────────────────────────────────────────────────────────
function selectAll(group) {
  const chips = document.querySelectorAll(`[data-g="${group}"]`);
  const allOn = [...chips].every(c => c.classList.contains('on'));
  chips.forEach(c => {
    if (allOn) {
      // deselect all except first
      if (c === chips[0]) c.classList.add('on'); else c.classList.remove('on');
    } else {
      c.classList.add('on');
    }
    const v = c.dataset.v;
    if (allOn) { if (c !== chips[0]) filters[group].delete(v); }
    else filters[group].add(v);
  });
  updateFilterCount();
}

// ── VIEWS ──────────────────────────────────────────────────────────────────
const MAIN_MENU_LABELS = { dash:'Özet', filter:'Tekrar Et', study:'Tekrar Et', news:'Metin Analizi', wordadd:'Sözlüğüm', list:'Kelime Listem', sentence:'Cümle Kur', hangman:'Asmaca', cardmode:'Kart Modu', status:'Kelime Durumu', settings:'Ayarlar', writing:'Cümle Yaz' };
function toggleMainMenu() {
  document.getElementById('main-menu-panel').classList.toggle('hidden');
}
// Menü açıkken sayfa içindeki bir filtreye (CEFR/frekans chip'i vb.) dokununca
// menü açık kalıyordu, çünkü sadece showView() (nav öğesi seçimi) paneli
// kapatıyordu. Artık panel açıkken panelin/toggle'ın DIŞINA her tıklama da
// paneli kapatıyor — sayfa içeriğiyle etkileşim otomatik olarak menüyü kapatır.
document.addEventListener('click', function (e) {
  const panel = document.getElementById('main-menu-panel');
  const toggle = document.getElementById('main-menu-toggle');
  if (!panel || panel.classList.contains('hidden')) return;
  if (panel.contains(e.target) || (toggle && toggle.contains(e.target))) return;
  panel.classList.add('hidden');
});
function showView(v) {
  document.getElementById('main-menu-panel').classList.add('hidden');
  const curLbl = document.getElementById('main-menu-current');
  if (curLbl) curLbl.textContent = MAIN_MENU_LABELS[v] || v;
  ['dash','filter','study','news','wordadd','list','sentence','hangman','settings','cardmode','status','writing'].forEach(n => document.getElementById('view-'+n).classList.toggle('hidden',n!==v));
  document.getElementById('nav-dash').classList.toggle('active', v==='dash');
  document.getElementById('nav-study').classList.toggle('active', v==='filter'||v==='study');
  document.getElementById('nav-news').classList.toggle('active', v==='news');
  document.getElementById('nav-wordadd').classList.toggle('active', v==='wordadd');
  document.getElementById('nav-list').classList.toggle('active', v==='list');
  document.getElementById('nav-sentence').classList.toggle('active', v==='sentence');
  document.getElementById('nav-hangman').classList.toggle('active', v==='hangman');
  document.getElementById('nav-cardmode').classList.toggle('active', v==='cardmode');
  document.getElementById('nav-status').classList.toggle('active', v==='status');
  document.getElementById('nav-settings').classList.toggle('active', v==='settings');
  document.getElementById('nav-writing').classList.toggle('active', v==='writing');
  if (v==='dash') updateDashboard();
  if (v==='filter') updateFilterCount();
  if (v==='wordadd') renderCustomWordsList();
  if (v==='list') { listUpdatePersonalCounts(); if (listMode==='topic') renderTopicWordGrid(); else if (listMode==='favorites') renderFavoritesList(); else if (listMode==='struggle') renderStruggleList(); else if (listMode==='extra') { renderExtraFilters(); renderExtraLetterRow(); renderExtraGrid(); } else { renderListBandFilters(); renderWordList(listLevel); } }
  if (v==='cardmode') cmInit();
  if (v==='status') stInit();
  if (v==='writing') wrInit();
  if (v==='settings') { renderClaudeKeyStatus(); renderDailyGoalSetting(); }
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
    return `<button class="chip lvl-${lv.toLowerCase()}${lv===listLevel?' on':''}${dis?' disabled':''}" ${dis?'disabled':''} data-lv="${lv}" onclick="selectListLevel('${lv}')">${lv} <span style="color:var(--text3);">(${count})</span></button>`;
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
    let html=`<div class="list-word-item" onclick="toggleListWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
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
    let html = `<div class="list-word-item" onclick="toggleListSearchWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 4px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
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
    let html=`<div class="list-word-item" onclick="toggleStruggleWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
      <div style="min-width:0;"><div><span class="wordfont">${w.word}</span> <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''} <span style="font-size:11px;color:var(--warn);">🔍${n}</span></div>${wordRowLine2Html(w)}</div>
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
    let html=`<div class="list-word-item" onclick="toggleFavoritesWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
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
    let html=`<div class="list-word-item" onclick="toggleTopicWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
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
    const trHtml=tr?`<button class="tr-toggle" onclick="event.stopPropagation();toggleTr(this)">Türkçeyi gör ▾</button><div class="tr-text">${tr}</div>`:'';
    return `<div class="c-example"><p>${en}${ttsButtonHtml(en)}</p>${trHtml}</div>`;
  }).join('');
  const catsHtml=(w.categories&&w.categories.length)?`<div class="c-section"><div class="c-section-label">Kategoriler</div><div class="c-cats">${w.categories.map(cat=>`<span class="c-cat">${cat}</span>`).join('')}</div></div>`:'';
  const contactHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${contactBadgesHtml(w.word)}</div>`;
  const lookups = lookupCount[w.word.toLowerCase()] || 0;
  const isMastered = progress[wkey(w)]?.mastery === 'mastered';
  const lookupHtml = (lookups >= 2 && !isMastered)
    ? `<div style="font-size:12px;color:var(--warn);background:var(--warnbg);display:inline-block;padding:4px 10px;border-radius:20px;margin-bottom:10px;">🔍 ${lookups} kez arandı — hâlâ "Biliyorum" değil</div>`
    : '';
  const statsId = 'stats-' + w.word.toLowerCase().replace(/[^a-z0-9]/g,'') + '-' + w.pos;
  const statsToggleHtml = `<div class="c-section">
    <div onclick="event.stopPropagation();document.getElementById('${statsId}').classList.toggle('hidden')" style="font-size:12px;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:4px;">📊 İstatistikler <span style="color:var(--text3);">▸</span></div>
    <div id="${statsId}" class="hidden" style="margin-top:8px;">${contactHtml}${lookupHtml}</div>
  </div>`;
  const copyPayload = escAttr(JSON.stringify({ w:{word:w.word,pos:w.pos,cefr:w.cefr}, c }));
  const copyBtnHtml = `<button class="copy-btn" onclick="event.stopPropagation();copyWordContent(${copyPayload},this)">📋 İçeriği kopyala</button>`;
  const statusHtml = (w.word && WORD_DATA.some(x=>x.word===w.word && x.pos===w.pos)) ? progressQuickControlHtml(w) : '';
  const html = `<div class="c-def" style="margin-bottom:10px;">${c.definition||'—'}${c.definition?ttsButtonHtml(c.definition):''}</div>
    <div class="c-section"><div class="c-section-label">Türkçe anlam</div><div class="c-turkish">${c.turkish||'—'}</div></div>
    ${wordSourceInfoHtml(w)}
    ${catsHtml}
    <div class="c-section"><div class="c-section-label">Nüans</div>${nuanceHtml}</div>
    <div class="c-section"><div class="c-section-label">Örnekler</div>${exHtml}</div>
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

// ── FILTER CHIPS ───────────────────────────────────────────────────────────
document.querySelectorAll('.chip[data-g]').forEach(chip=>{
  chip.addEventListener('click',()=>{
    const g=chip.dataset.g, v=chip.dataset.v;
    if (g==='mode') {
      document.querySelectorAll('[data-g="mode"]').forEach(c=>c.classList.remove('on'));
      chip.classList.add('on'); filters.mode=v;
    } else {
      chip.classList.toggle('on');
      if(chip.classList.contains('on')) filters[g].add(v); else filters[g].delete(v);
    }
    updateFilterCount();
  });
});

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

function updateFilterCount() {
  const q=buildQueue();
  document.getElementById('f-count').textContent=`${q.length} kelime seçildi`;
  document.getElementById('start-btn').disabled=q.length===0;
}

// ── STUDY ──────────────────────────────────────────────────────────────────
function startStudy() {
  studyQueue=[...buildQueue()];
  if(!studyQueue.length) return;
  studyIdx=0; requeuedKeys=new Set(); sessionResults={ok:0,miss:0};
  document.getElementById('session-end').classList.add('hidden');
  document.getElementById('card-wrap').classList.remove('hidden');
  showView('study'); showCard();
}

async function showCard() {
  if(studyIdx>=studyQueue.length){ endSession(); return; }
  const w=studyQueue[studyIdx], total=studyQueue.length;
  document.getElementById('study-prog').textContent=`${studyIdx+1} / ${total}`;
  document.getElementById('prog-fill').style.width=(studyIdx/total*100)+'%';
  flipped=false;
  document.getElementById('card-back').classList.remove('show');
  document.getElementById('flip-hint').style.display='block';
  document.getElementById('action-row').classList.add('hidden');
  document.getElementById('c-word').innerHTML = escHtml(w.word) + ttsButtonHtml(w.word, w.word);
  ttsWireButtons(document.getElementById('c-word'));
  document.getElementById('c-pos').textContent=w.pos;
  const cefrColor = CEFR_COLORS[w.cefr] || '--text2';
  const badges=[`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`];
  if(w.speaking) badges.push(`<span class="badge b-${w.speaking.toLowerCase()}">${w.speaking}</span>`);
  if(w.writing)  badges.push(`<span class="badge b-${w.writing.toLowerCase()}">${w.writing}</span>`);
  if(w.voa)      badges.push('<span class="badge b-voa">VOA</span>');
  document.getElementById('c-badges').innerHTML=badges.join('');
  const k=wkey(w);
  if(contentCache[k]) { renderContent(contentCache[k],w); }
  else {
    document.getElementById('c-loading').classList.remove('hidden');
    document.getElementById('c-def').classList.add('hidden');
    document.getElementById('card-back').classList.remove('show');
    const c=await fetchContent(w); contentCache[k]=c; renderContent(c,w);
  }
}

function renderContent(c, w) {
  document.getElementById('c-loading').classList.add('hidden');
  document.getElementById('c-def').classList.remove('hidden');
  document.getElementById('c-def').textContent=c.definition||'—';
  document.getElementById('c-turkish').textContent=c.turkish||'—';
  // Nuance — paragraphs
  const paras=(c.nuance||'—').split(/\n\n+/).filter(p=>p.trim());
  document.getElementById('c-nuance').innerHTML=paras.map(p=>
    `<p style="margin-bottom:10px;font-size:14px;line-height:1.65;color:var(--text);">${p.trim()}</p>`
  ).join('');
  // Categories
  if(w.categories&&w.categories.length){
    document.getElementById('c-cats-wrap').style.display='block';
    document.getElementById('c-cats').innerHTML=w.categories.map(cat=>`<span class="c-cat">${cat}</span>`).join('');
  } else { document.getElementById('c-cats-wrap').style.display='none'; }
  // Examples with collapsible Turkish
  document.getElementById('c-examples').innerHTML=(c.examples||[]).map((ex,i)=>{
    const en=typeof ex==='object'?ex.en:ex;
    const tr=typeof ex==='object'?ex.tr:null;
    const trHtml=tr?`<button class="tr-toggle" onclick="toggleTr(this)">Türkçeyi gör ▾</button><div class="tr-text">${tr}</div>`:'';
    return `<div class="c-example"><p>${en}${ttsButtonHtml(en)}</p>${trHtml}</div>`;
  }).join('');
  ttsWireButtons(document.getElementById('c-examples'));
}

function toggleTr(btn) {
  const trDiv=btn.nextElementSibling;
  const showing=trDiv.style.display==='block';
  trDiv.style.display=showing?'none':'block';
  btn.textContent=showing?'Türkçeyi gör ▾':'Türkçeyi gizle ▴';
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

function flipCard() {
  if(flipped) return; flipped=true;
  document.getElementById('card-back').classList.add('show');
  document.getElementById('flip-hint').style.display='none';
  document.getElementById('action-row').classList.remove('hidden');
}

function answer(correct) {
  const w=studyQueue[studyIdx], k=wkey(w);
  const cur=progress[k]||{};
  const next=getNextReview(cur,correct);
  progress[k]={...next, nextReview:next.nextReview||getNextDate(next.interval), lastSeen:todayStr()};
  if(correct){ sessionResults.ok++; }
  else {
    sessionResults.miss++;
    if(!requeuedKeys.has(k)){ requeuedKeys.add(k); studyQueue.push(w); }
  }
  const today=todayStr();
  if(streak.lastDate!==today){
    streak.lastDate=today;
    const dn=['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][new Date().getDay()];
    if(!streak.days.includes(dn)) streak.days.push(dn);
  }
  saveState();
  studyIdx++; showCard();
}

function endSession() {
  document.getElementById('card-wrap').classList.add('hidden');
  document.getElementById('session-end').classList.remove('hidden');
  const uniq=new Set(studyQueue.map(w=>wkey(w))).size;
  const mastered=Object.values(progress).filter(p=>p.mastery==='mastered').length;
  document.getElementById('session-summary').textContent=
    `${uniq} kelime çalışıldı — ${sessionResults.ok} doğru, ${sessionResults.miss} tekrar. Toplam tam öğrenilen: ${mastered}`;
  updateDashboard();
}

function doExport() {
  const data={progress,progressReverse,contentCache,streak,customProgress,customWords,customCache,srsStore,savedAt:new Date().toISOString()};
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
      saveState();
      updateDashboard();
      renderCustomWordsList();
      alert(`İlerleme yüklendi! ${Object.keys(progress).length} Oxford + ${Object.keys(progressReverse).length} ters yön + ${Object.keys(customProgress).length} özel kelime kaydı aktarıldı.`);
    } catch{ alert('Dosya okunamadı.'); }
  };
  reader.readAsText(file);
}

updateDashboard();
updateFilterCount();

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

// ── BİRLEŞİK SRS DEPOSU (tüm modüller arasında paylaşılan) ──────────────────
// Cümle Genişletme / Adam Asmaca / Telaffuz Asistanı gibi diğer modüller
// kelime/yapı/düzensiz-fiil öğrenme durumunu bu depo üzerinden okuyup yazar.
// Anahtar şeması: word:<kelime>, structure:<tense adı>, verb:<baseform>
// Not: Oxford flashcard kartlarının kendi "progress" deposu (word|pos anahtarlı)
// ayrı kalmaya devam ediyor çünkü aynı kelimenin farklı POS'ları (örn. "compost"
// noun/verb) ayrı kartlar; srsStore ise POS'tan bağımsız, salt kelime/yapı bazlı.
let srsStore = {};

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
const STORAGE_KEY = 'oxford_flashcards_state_v1';

function saveState() {
  try {
    const data = { progress, progressReverse, contentCache, streak, customProgress, customWords, customCache, srsStore, favorites, contactTrack, lookupCount, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    return true;
  } catch (e) { return false; }
}

const WELCOME_SEEN_KEY = 'wh_welcome_seen_v1';
function showWelcomeOverlay() {
  document.getElementById('welcome-overlay').classList.remove('hidden');
}
function closeWelcomeOverlay() {
  document.getElementById('welcome-overlay').classList.add('hidden');
  try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch (e) {}
}
if (!localStorage.getItem(WELCOME_SEEN_KEY)) {
  showWelcomeOverlay();
}

loadState();
updateDashboard();
updateFilterCount();
renderCustomWordsList();
window.addEventListener('beforeunload', saveState);
window.addEventListener('pagehide', saveState);

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
  document.querySelectorAll('.news-lvl-btn').forEach(function(b) {
    var lvl = b.dataset.lvl;
    var isOn = lvl === 'all' ? allOn : activeLevels.has(lvl);
    if (lvl === 'all') {
      b.style.background = isOn ? 'var(--text)' : 'none';
      b.style.color = isOn ? 'var(--bg)' : 'var(--text2)';
      b.style.borderColor = 'var(--border2)';
    } else {
      var l = lvl.toLowerCase();
      b.style.background = isOn ? 'var(--' + l + 'bg)' : 'none';
      b.style.color = 'var(--' + l + ')';
      b.style.borderColor = 'var(--' + l + ')';
      b.style.opacity = isOn ? '1' : '0.4';
    }
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
    return `<button class="chip lvl-${lv.toLowerCase()}${cmSelectedLevels.has(lv)?' on':''}${disabled?' disabled':''}" ${disabled?'disabled':`onclick="cmToggleLevel('${lv}')"`}>${lv} <span style="color:var(--text3);">(${count})</span></button>`;
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
      <span class="badge" style="background:var(--accentbg);color:var(--accent);">${cmDone.known} Biliyorum</span>
      <span class="badge" style="background:#fff3e0;color:#a05000;">${cmDone.learning} Öğreniyorum</span>
      <span style="font-size:13px;color:var(--text2);font-weight:600;">${total} Kelime${capNote}</span>
    </div>
    <div style="height:6px;border-radius:3px;background:var(--border2);overflow:hidden;margin-bottom:12px;">
      <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .2s;"></div>
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
      ? `<button onclick="cmRetryHard()" style="padding:12px 26px;border-radius:var(--rsm);border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Zorlandığın ${hardCount} kelimeyi tekrar et →</button>`
      : (hasMore ? `<button onclick="cmStart()" style="padding:12px 26px;border-radius:var(--rsm);border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Yeni ${cmSessionSize} kelime →</button>` : '');

    const advice = goalMet
      ? `Bugünkü hedefini (${goal}) tamamladın. Kısa ve düzenli çalışmak, uzun tek seferlik oturumlardan daha kalıcı — istersen burada bırakabilirsin.`
      : `Bugün ${doneToday}/${goal} kelime yaptın.`;

    area.innerHTML = `<div style="text-align:center;padding:30px 16px;">
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
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:var(--r);padding:28px 20px;text-align:center;">
      ${promptBlock}
      ${revealBlock}
      <div style="display:flex;gap:10px;">
        <button onclick="${answerCall}false)" style="flex:1;padding:14px;border-radius:var(--rsm);border:none;background:#fff3e0;color:#a05000;font-weight:600;font-size:14px;cursor:pointer;">Öğreniyorum</button>
        <button onclick="${answerCall}true)" style="flex:1;padding:14px;border-radius:var(--rsm);border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Biliyorum</button>
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
  document.getElementById('st-tab-learning').classList.toggle('active', tab==='learning');
  document.getElementById('st-tab-known').classList.toggle('active', tab==='known');
  stRenderList();
}

function stRenderLevels() {
  const row = document.getElementById('st-level-row');
  const levels = ['A1','A2','B1','B2','C1'];
  row.innerHTML = levels.map(lv => {
    // Sayaç: o seviyede ortak filtreden geçen ve ilerleme kaydı olan kelimeler
    const count = WORD_DATA.filter(w => w.cefr === lv && gbPasses(w) && stProgressStore()[wkey(w)]).length;
    return `<button class="chip lvl-${lv.toLowerCase()}${stSelectedLevels.has(lv)?' on':''}" onclick="stToggleLevel('${lv}')">${lv} <span style="color:var(--text3);">(${count})</span></button>`;
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
const CONTACT_DIMS = [ ['read','📖 Okuma'], ['heard','🎧 Dinleme'], ['used','🔁 Kullanım'] ];
function contactBadgesHtml(word) {
  const c = contactTrack[word.toLowerCase()] || {};
  return CONTACT_DIMS.map(([dim,label]) => {
    const count = c[dim] || 0;
    const ratio = contactRatio(count);
    let style;
    if (ratio <= 0) style = 'border:1.5px solid var(--border2);color:var(--text2);font-weight:500;';
    else {
      const bg = `color-mix(in srgb, var(--accent) ${Math.round(ratio*100)}%, var(--surface2))`;
      const fg = ratio >= 0.6 ? '#fff' : 'var(--accent)';
      style = `background:${bg};color:${fg};font-weight:600;`;
    }
    return `<span title="${count}/${CONTACT_THRESHOLD}" style="font-size:12.5px;padding:5px 12px;border-radius:20px;${style}">${label} ${count}/${CONTACT_THRESHOLD}</span>`;
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
    .filter(x => x.p && (stTab==='known' ? x.p.mastery==='mastered' : x.p.mastery!=='mastered'));

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
    return `<div style="background:var(--surface);border:0.5px solid var(--border);border-radius:var(--rsm);padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="cursor:pointer;flex:1;" onclick="stOpenWord(${wordArg})">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:15px;font-weight:700;">${escHtml(w.word)}</span>
          <span style="font-size:11px;color:var(--text3);font-style:italic;">${w.pos}</span>
          <span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:11.5px;color:var(--text2);white-space:nowrap;display:inline-flex;align-items:center;gap:9px;">${ico('check',12,'#5cb87a',false)}${p.totalKnown||0} ${ico('repeat',12,'#6b9ee0',false)}${p.totalLearning||0}</span>
        <span onclick="stToggleFavorite(${wordArg})" style="font-size:18px;cursor:pointer;color:${isFav?'#e0a63c':'var(--border2)'};">★</span>
        <span onclick="stRemoveWord(${wordArg})" title="Listeden çıkar" style="font-size:16px;cursor:pointer;color:var(--text3);">✕</span>
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
  const origLabel = btnEl ? btnEl.textContent : null;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳'; }
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
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origLabel || '🔊'; }
  }
}

function ttsButtonHtml(text, contactWord) {
  const attr = contactWord ? ` data-contact-word="${escAttr(contactWord)}"` : '';
  return `<button type="button" class="tts-btn" data-tts-text="${escAttr(text)}"${attr} title="Dinle">🔊</button>`;
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
    return `<span style="display:inline-flex;align-items:center;gap:4px;margin:3px 4px;padding:3px 10px;border-radius:20px;background:var(--surface2);font-size:12px;cursor:pointer;" data-word="${escAttr(w.word)}" onclick="handleWordClick(this)">${status} ${w.word} <button type="button" class="tts-btn" style="width:18px;height:18px;font-size:10px;margin-left:0;" data-tts-text="${escAttr(w.word)}" title="Dinle" onclick="event.stopPropagation();">🔊</button><span data-word="${escAttr(w.word)}" onclick="event.stopPropagation();handleRemoveClick(this)" style="color:var(--text3);margin-left:2px;">✕</span></span>`;
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
    const trHtml = tr ? `<button class="tr-toggle" onclick="toggleTr(this)">Türkçeyi gör ▾</button><div class="tr-text">${tr}</div>` : '';
    return `<div style="border-left:2px solid var(--a2bg);padding-left:10px;margin-bottom:10px;"><p style="font-size:14px;font-style:italic;color:var(--text);line-height:1.6;margin:0;">${en}${ttsButtonHtml(en)}</p>${trHtml}</div>`;
  }).join('');
  ttsWireButtons(document.getElementById('modal-examples'));
}

function closeWordModal() {
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
updateFilterCount();

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
    return `<div class="chip lvl-${l.toLowerCase()}${sgSelectedLevels.has(l) ? ' on' : ''}${disabled?' disabled':''}" data-level="${l}">${l} <span style="color:var(--text3);">(${count})</span></div>`;
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

function sgRenderTenseFilter() {
  const el = document.getElementById('sg-tense-filter');
  const tenses = [...new Set(SG_EXERCISES.map(e => e.tense))];
  const options = ["__auto__", ...tenses];
  el.innerHTML = options.map(t => {
    const label = t === "__auto__" ? "Otomatik (seviyeye göre)" : t;
    const active = (t === "__auto__" && !sgSelectedTenseFilter) || (t === sgSelectedTenseFilter);
    return `<div class="sg-level-chip sg-tense-chip ${active ? 'active' : ''}" data-tense="${t}">${label}</div>`;
  }).join('');
  el.querySelectorAll('.sg-tense-chip').forEach(chip => {
    chip.onclick = () => {
      const t = chip.dataset.tense;
      sgSelectedTenseFilter = t === "__auto__" ? null : t;
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

  c.innerHTML = `<div class="sg-card">${sgInfoBar}<div class="sg-skip-row"><button class="sg-skip-btn" onclick="sgPickExercise()">🔀 Farklı bir örnek göster</button></div>${progressHtml}${sentenceHtml}${bodyHtml}</div>`;
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
    return `<div class="chip lvl-${l.toLowerCase()}${hgSelectedLevels.has(l) ? ' on' : ''}${disabled?' disabled':''}" data-level="${l}">${l} <span style="color:var(--text3);">(${count})</span></div>`;
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

hgRenderLevels();
hgRenderFreqFilter();
hgPickWord();
hgLoadStats();
renderListCefrRow();
renderTtsStatus();
