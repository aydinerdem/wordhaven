const CEFR_LEVELS = ['A1','A2','B1','B2','C1'];
const CEFR_COLORS = { A1:'--a1', A2:'--a2', B1:'--b1', B2:'--b2', C1:'--c1' };

let progress = {};
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
             totalKnown, totalLearning: totalLearning+1 };
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
  return { interval, easeFactor, repetitions, mastery, learned: mastery==='mastered', totalKnown:newTotalKnown, totalLearning:newTotalLearning };
}
function getNextDate(n) {
  const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10);
}

// ── FILTER & QUEUE ─────────────────────────────────────────────────────────
function filteredWords() {
  return WORD_DATA.filter(w =>
    filters.cefr.has(w.cefr) && filters.sp.has(w.speaking) &&
    filters.wr.has(w.writing) && filters.fr.has(w.freq)
  );
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
const MAIN_MENU_LABELS = { dash:'Özet', filter:'Tekrar Et', study:'Tekrar Et', news:'Metin Analizi', wordadd:'Sözlüğüm', list:'Kelime Listem', sentence:'Cümle Kur', hangman:'Asmaca', cardmode:'Kart Modu', status:'Kelime Durumu', settings:'Ayarlar' };
function toggleMainMenu() {
  document.getElementById('main-menu-panel').classList.toggle('hidden');
}
function showView(v) {
  document.getElementById('main-menu-panel').classList.add('hidden');
  const curLbl = document.getElementById('main-menu-current');
  if (curLbl) curLbl.textContent = MAIN_MENU_LABELS[v] || v;
  ['dash','filter','study','news','wordadd','list','sentence','hangman','settings','cardmode','status'].forEach(n => document.getElementById('view-'+n).classList.toggle('hidden',n!==v));
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
  if (v==='dash') updateDashboard();
  if (v==='filter') updateFilterCount();
  if (v==='wordadd') renderCustomWordsList();
  if (v==='list') { if (listMode==='topic') renderTopicWordGrid(); else if (listMode==='favorites') renderFavoritesList(); else renderWordList(listLevel); }
  if (v==='cardmode') cmInit();
  if (v==='status') stInit();
}

// ── WORD LIST (2-column, toggle accordion) ──────────────────────────────────
let listLevel='A1';
let listOpenKey=null;
function renderListCefrRow(){
  const row=document.getElementById('list-cefr-row');
  const levels=['A1','A2','B1','B2','C1'];
  row.innerHTML=levels.map(lv=>{
    const count=WORD_DATA.filter(w=>w.cefr===lv).length;
    return `<button class="chip lvl-${lv.toLowerCase()}${lv===listLevel?' on':''}" data-lv="${lv}" onclick="selectListLevel('${lv}')">${lv} <span style="color:var(--text3);">(${count})</span></button>`;
  }).join('');
}
function selectListLevel(lv){
  listLevel=lv; listOpenKey=null;
  document.querySelectorAll('#list-cefr-row .chip').forEach(c=>c.classList.toggle('on', c.dataset.lv===lv));
  renderWordList(lv);
}
function renderWordList(level){
  const words=WORD_DATA.filter(w=>w.cefr===level);
  const grid=document.getElementById('word-list-grid');
  grid.innerHTML=words.map(w=>{
    const k=wkey(w);
    const open=(k===listOpenKey);
    let html=`<div class="list-word-item" onclick="toggleListWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <span>${w.word} <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span>${ttsButtonHtml(w.word, w.word)}${favStarHtml(w)}${contactDotsHtml(w)}</span>
      <span style="color:var(--text3);font-size:11px;">${open?'▾':'▸'}</span>
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
const LIST_SEARCH_POOL = WORD_DATA.concat(TOPIC_WORDS);
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
    resultsEl.innerHTML = `<p style="font-size:13px;color:var(--text2);">"<strong>${raw}</strong>" bu listelerde (Oxford 3000/5000 veya Konu Kelimeleri) bulunamadı. Bu kelime muhtemelen bu gruplarda yok — <b>Sözlüğüm</b> sekmesinden aratabilirsin.</p>`;
    return;
  }
  resultsEl.innerHTML = matches.map(w=>{
    const k = wkey(w);
    const open = (k===listSearchOpenKey);
    const c = BUILTIN_CONTENT[k];
    const isOxford = OXFORD_WORD_SET.has(w.word.toLowerCase());
    const sourceTag = isOxford ? '' : ' <span style="font-size:10px;color:var(--text3);">Konu Kelimesi</span>';
    let html = `<div class="list-word-item" onclick="toggleListSearchWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 4px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <span>${w.word} <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}${sourceTag}${ttsButtonHtml(w.word, w.word)}${favStarHtml(w)}${contactDotsHtml(w)}</span>
      <span style="color:var(--text3);font-size:11px;">${open?'▾':'▸'}</span>
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

function selectListMode(mode){
  listMode=mode;
  document.getElementById('list-mode-oxford').classList.toggle('active', mode==='oxford');
  document.getElementById('list-mode-topic').classList.toggle('active', mode==='topic');
  document.getElementById('list-mode-favorites').classList.toggle('active', mode==='favorites');
  document.getElementById('list-oxford-panel').classList.toggle('hidden', mode!=='oxford');
  document.getElementById('list-topic-panel').classList.toggle('hidden', mode!=='topic');
  document.getElementById('list-favorites-panel').classList.toggle('hidden', mode!=='favorites');
  if(mode==='oxford'){ renderWordList(listLevel); }
  else if(mode==='topic'){ renderTopicGroupRow(); renderTopicLetterPanel(); renderTopicWordGrid(); }
  else { renderFavoritesList(); }
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
    let html=`<div class="list-word-item" onclick="toggleFavoritesWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <span>${w.word} <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}${ttsButtonHtml(w.word, w.word)}${favStarHtml(w)}${contactDotsHtml(w)}</span>
      <span style="color:var(--text3);font-size:11px;">${open?'▾':'▸'}</span>
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
    let html=`<div class="list-word-item" onclick="toggleTopicWord('${k.replace(/'/g,"\\'")}')" style="padding:10px 8px;font-size:14px;cursor:pointer;border-bottom:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <span>${w.word}${_warn} <span style="color:var(--text3);font-size:11px;font-style:italic;">${w.pos}</span> ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}${ttsButtonHtml(w.word, w.word)}${favStarHtml(w)}${contactDotsHtml(w)}</span>
      <span style="color:var(--text3);font-size:11px;">${open?'▾':'▸'}</span>
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
  renderTopicWordGrid();
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
  const contactHtml = `<div class="c-section"><div class="c-section-label">Temas takibi</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${contactBadgesHtml(w.word)}</div></div>`;
  const copyPayload = escAttr(JSON.stringify({ w:{word:w.word,pos:w.pos,cefr:w.cefr}, c }));
  const copyBtnHtml = `<button class="copy-btn" onclick="event.stopPropagation();copyWordContent(${copyPayload},this)">📋 İçeriği kopyala</button>`;
  const statusHtml = (w.word && WORD_DATA.some(x=>x.word===w.word && x.pos===w.pos)) ? progressQuickControlHtml(w) : '';
  const html = `${contactHtml}
    <div style="text-align:right;margin-bottom:10px;">${copyBtnHtml}</div>
    <div class="c-def" style="margin-bottom:10px;">${c.definition||'—'}${c.definition?ttsButtonHtml(c.definition):''}</div>
    <div class="c-section"><div class="c-section-label">Türkçe anlam</div><div class="c-turkish">${c.turkish||'—'}</div></div>
    ${catsHtml}
    <div class="c-section"><div class="c-section-label">Nüans</div>${nuanceHtml}</div>
    <div class="c-section"><div class="c-section-label">Örnekler</div>${exHtml}</div>
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
    <div class="acc-body${open?' open':''}" id="${id}">${words.map(w=>`<div style="font-size:13px;line-height:2;font-family:monospace;">${w.word} <span style="color:var(--text3);font-size:11px;">${w.pos}</span></div>`).join('')}</div>
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
  const reviewing     = cefrWords.filter(w=>progress[wkey(w)]?.mastery==='reviewing');
  const upcoming      = cefrWords.filter(w=>!progress[wkey(w)]);
  const dueNow        = cefrWords.filter(w=>{ const p=progress[wkey(w)]; return p&&p.nextReview<=today; });
  const mastCount     = mastered.length;
  const pct           = cefrWords.length ? (mastCount/cefrWords.length*100).toFixed(0) : 0;
  const color         = CEFR_COLORS[level];

  const cats = [
    dueNow.length ? {id:level+'-due', label:'⏰ Bugün tekrar', words:dueNow, open:true, style:'due'} : null,
    {id:level+'-mastered', label:'✅ Tam öğrenildi', words:mastered, open:true, style:'mastered'},
    {id:level+'-consolidating', label:'📈 Pekişiyor', words:consolidating, open:false, style:'consolidating'},
    {id:level+'-reviewing', label:'🔄 Tekrarda', words:reviewing, open:false, style:'reviewing'},
    {id:level+'-upcoming', label:'🆕 Sıradaki yeniler', words:upcoming, open:false, style:'upcoming'},
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

function updateDashboard() {
  const today=todayStr();
  const mastered      = Object.values(progress).filter(p=>p.mastery==='mastered').length;
  const consolidating = Object.values(progress).filter(p=>p.mastery==='consolidating').length;
  const reviewing     = Object.values(progress).filter(p=>p.mastery==='reviewing').length;
  const due           = WORD_DATA.filter(w=>{ const p=progress[wkey(w)]; return p&&p.nextReview<=today; }).length;
  document.getElementById('d-mastered').textContent  = mastered;
  document.getElementById('d-reviewing').textContent = consolidating+reviewing;
  document.getElementById('d-due').textContent       = due;

  // CEFR sections
  document.getElementById('cefr-sections').innerHTML =
    CEFR_LEVELS.map(lv => renderCefrSection(WORD_DATA.filter(w=>w.cefr===lv), lv)).join('');

  // Streak
  const dayNames=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
  document.getElementById('streak-days').innerHTML = dayNames.map((d,i)=>{
    const isToday=i===(new Date().getDay()+6)%7;
    const done=streak.days.includes(d);
    return `<div class="s-day ${done?'done':''} ${isToday?'today':''}">${d}</div>`;
  }).join('');
  document.getElementById('streak-label').textContent=`${streak.days.length} gün`;
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
  const byPrefix = WORD_DATA.filter(w => w.word.toLowerCase().startsWith(prefix) && w.word.toLowerCase() !== raw);
  if (byPrefix.length) return byPrefix.slice(0, 6);
  const scored = WORD_DATA
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
  const customMatch = customWords[raw];
  let html = '';
  if (customMatch) {
    const content = customCache[raw] || BUILTIN_CONTENT[raw + '|—'];
    html += `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:0.5px solid var(--border);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
        <span style="font-size:20px;font-weight:500;">${customMatch.word}</span>${ttsButtonHtml(customMatch.word, customMatch.word)}
        <span style="font-size:10px;color:var(--accent);background:var(--accentbg);padding:2px 8px;border-radius:10px;font-weight:600;">Özel havuzunda zaten var</span>
      </div>
      <button data-word="${escAttr(raw)}" onclick="handleWordClick(this)" style="padding:8px 12px;font-size:12px;font-weight:500;border-radius:var(--rsm);cursor:pointer;border:0.5px solid var(--border2);background:var(--surface2);color:var(--text2);">Detayları / ilerlemeyi gör</button>
    </div>`;
  }
  if (matches.length) {
    matches.forEach(w => {
      const c = BUILTIN_CONTENT[wkey(w)];
      html += `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:0.5px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="font-size:20px;font-weight:500;">${w.word}</span>${ttsButtonHtml(w.word, w.word)}
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
          <span style="font-size:20px;font-weight:500;">${w.word}</span>
          <span style="font-size:12px;color:var(--text3);font-style:italic;">${w.pos}</span>
          ${w.cefr?`<span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>`:''}
          <span style="font-size:10px;color:var(--text3);">Oxford 3000/5000 dışı</span>
        </div>
        ${catsHtml}
        <div id="${cid}" style="margin-top:8px;"><button onclick="loadTopicWordMeaning('${raw.replace(/'/g,"\\'")}', ${i}, '${cid}')" style="padding:8px 12px;font-size:12px;font-weight:500;border-radius:var(--rsm);cursor:pointer;border:0.5px solid var(--accent);color:var(--accent);background:var(--accentbg);">Anlamı getir</button></div>
      </div>`;
    });
  }
  if (!matches.length && !topicMatches.length && !customMatch) {
    const suggestions = findWordSuggestions(raw);
    const suggHtml = suggestions.length
      ? `<div style="margin-bottom:12px;">
          <p style="font-size:12px;color:var(--text3);margin:0 0 6px;">Bunu mu demek istediniz?</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${suggestions.map(w =>
            `<span class="chip" onclick="document.getElementById('global-search-input').value='${w.word.replace(/'/g,"\\'")}';performGlobalSearch();" style="cursor:pointer;">${w.word}</span>`
          ).join('')}</div>
        </div>`
      : '';
    html += `<p style="font-size:13px;color:var(--text3);margin-bottom:10px;">"<strong>${raw}</strong>" Oxford listesinde bulunamadı.</p>
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
  const data={progress,contentCache,streak,customProgress,customWords,customCache,srsStore,savedAt:new Date().toISOString()};
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
      if(d.contentCache) contentCache=d.contentCache;
      if(d.streak) streak=d.streak;
      if(d.customProgress) customProgress=d.customProgress;
      if(d.customWords) customWords=d.customWords;
      if(d.customCache) customCache=d.customCache;
      if(d.srsStore) srsStore=d.srsStore;
      saveState();
      updateDashboard();
      renderCustomWordsList();
      alert(`İlerleme yüklendi! ${Object.keys(progress).length} Oxford + ${Object.keys(customProgress).length} özel kelime kaydı aktarıldı.`);
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
    <button onclick="event.stopPropagation();quickSetStatus(${wa},false)" class="chip${status==='learning'?' on':''}" style="flex:1;">🔁 Öğreniyorum</button>
    <button onclick="event.stopPropagation();quickSetStatus(${wa},true)" class="chip${status==='known'?' on':''}" style="flex:1;">✅ Biliyorum</button>
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
    else renderWordList(listLevel);
  }
  const statusView = document.getElementById('view-status');
  if (statusView && !statusView.classList.contains('hidden')) stRenderList();
}
let contactTrack = {}; // key: kelime (küçük harf) → {read:N, heard:N, used:N} (N = tekrar sayısı)
const CONTACT_THRESHOLD = 5; // bu sayıya ulaşınca rozet/nokta tam renge ulaşır

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
function toggleFavFromRow(word, pos) {
  const k = word + '|' + pos;
  if (favorites[k]) delete favorites[k]; else favorites[k] = true;
  saveState();
  if (listMode === 'oxford') renderWordList(listLevel);
  else if (listMode === 'topic') renderTopicWordGrid();
  else if (listMode === 'favorites') renderFavoritesList();
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
    const data = { progress, contentCache, streak, customProgress, customWords, customCache, srsStore, favorites, contactTrack, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { /* localStorage dolu veya erişilemez olabilir — sessizce geç */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.progress) progress = d.progress;
    if (d.contentCache) contentCache = d.contentCache;
    if (d.streak) streak = d.streak;
    if (d.customProgress) customProgress = d.customProgress;
    if (d.customWords) customWords = d.customWords;
    if (d.customCache) customCache = d.customCache;
    if (d.srsStore) srsStore = d.srsStore;
    if (d.favorites) favorites = d.favorites;
    if (d.contactTrack) contactTrack = d.contactTrack;
    return true;
  } catch (e) { return false; }
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
let cmSelectedLevels = new Set(['A1','A2','B1','B2','C1']);
let cmSessionSize = 30;
let cmQueue = [];
let cmIdx = 0;
let cmHistory = []; // undo için: {key, prevEntry, wasNew}
let cmDone = { known: 0, learning: 0 };

function cmInit() {
  cmRenderLevels();
  cmRenderSizeRow();
  cmStart();
}

function cmRenderLevels() {
  const row = document.getElementById('cm-level-row');
  const levels = ['A1','A2','B1','B2','C1'];
  row.innerHTML = levels.map(lv =>
    `<button class="chip lvl-${lv.toLowerCase()}${cmSelectedLevels.has(lv)?' on':''}" onclick="cmToggleLevel('${lv}')">${lv}</button>`
  ).join('');
}

function cmToggleLevel(lv) {
  if (cmSelectedLevels.has(lv) && cmSelectedLevels.size > 1) cmSelectedLevels.delete(lv);
  else cmSelectedLevels.add(lv);
  cmRenderLevels();
  cmStart();
}

function cmRenderSizeRow() {
  const row = document.getElementById('cm-size-row');
  const presets = [5, 10, 20, 30];
  row.innerHTML = presets.map(n =>
    `<button class="chip${cmSessionSize===n?' on':''}" onclick="cmSetSize(${n})">${n}</button>`
  ).join('') + `<input type="number" min="1" max="500" placeholder="Manuel" value="${presets.includes(cmSessionSize)?'':cmSessionSize}" oninput="cmSetSize(this.value)" style="width:70px;padding:6px 8px;font-size:13px;border:0.5px solid var(--border2);border-radius:20px;background:var(--surface2);color:var(--text);">`;
}

function cmSetSize(n) {
  n = parseInt(n, 10);
  if (!n || n < 1) return;
  cmSessionSize = n;
  cmRenderSizeRow();
  cmStart();
}

function cmBuildQueue() {
  const today = todayStr();
  const pool = WORD_DATA.filter(w => cmSelectedLevels.has(w.cefr));
  const due = pool.filter(w => { const p = progress[wkey(w)]; return p && p.nextReview <= today; });
  const nw = pool.filter(w => !progress[wkey(w)]).slice(0, Math.max(0, cmSessionSize - due.length));
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
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <span class="badge" style="background:var(--accentbg);color:var(--accent);">${cmDone.known} Biliyorum</span>
      <span class="badge" style="background:#fff3e0;color:#a05000;">${cmDone.learning} Öğreniyorum</span>
      <span style="font-size:13px;color:var(--text2);font-weight:600;">${total} Kelime</span>
    </div>
    <div style="height:6px;border-radius:3px;background:var(--border2);overflow:hidden;margin-bottom:12px;">
      <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .2s;"></div>
    </div>`;
}

async function cmShowCard() {
  const area = document.getElementById('cm-card-area');
  if (cmIdx >= cmQueue.length) {
    // Oturum bitti — bu seviye(ler)de gerçekten başka çalışılacak kelime kalıp
    // kalmadığını kontrol et (tekrar zamanı gelenler + hiç görülmemiş yeniler).
    const today = todayStr();
    const morePool = WORD_DATA.filter(w => cmSelectedLevels.has(w.cefr));
    const moreDue = morePool.filter(w => { const p = progress[wkey(w)]; return p && p.nextReview <= today; });
    const moreNew = morePool.filter(w => !progress[wkey(w)]);
    const hasMore = (moreDue.length + moreNew.length) > 0;
    area.innerHTML = `<div style="text-align:center;padding:40px 16px;">
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;">${hasMore ? 'Bu oturum bitti! 🎉' : 'Bu seviye(ler)de çalışılacak başka kelime kalmadı! 🎉'}</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:${hasMore ? '20px' : '0'};">${cmDone.known} biliyordun, ${cmDone.learning} tanesi hâlâ öğreniliyor.</div>
      ${hasMore ? `<button onclick="cmStart()" style="padding:12px 28px;border-radius:var(--rsm);border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Yeni Oturum Başlat</button>` : ''}
    </div>`;
    return;
  }
  cmRenderCard(cmQueue[cmIdx], 'cmAnswer', true);
}

function cmOpenFromList(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  cmRenderCard(w, 'cmAnswerAdhoc', false);
}

// isQueueCard: sıradaki normal kart mı (geri al / bitiş ekranı geçerli), yoksa
// listeden açılan tek seferlik bir inceleme mi.
function cmRenderCard(w, answerFn, isQueueCard, targetId, backFn) {
  targetId = targetId || 'cm-card-area';
  backFn = backFn || 'cmBackToQueue';
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
  area.innerHTML = `
    ${backToListBtn}
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:var(--r);padding:28px 20px;text-align:center;">
      <button onclick="event.stopPropagation();cmToggleExtra('${targetId}')" class="chip" style="margin-bottom:16px;">+ Ek Anlamlar</button>
      <div>${ttsButtonHtml(w.word, w.word)}</div>
      <div style="font-size:26px;font-weight:700;margin:10px 0 2px;">${escHtml(w.word)}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;">
        <span class="badge b-${w.cefr.toLowerCase()}">${w.cefr}</span>
        <span style="font-size:13px;color:var(--text3);font-style:italic;">${w.pos}</span>
      </div>
      ${catsHtml}
      <div id="${trHiddenId}" style="margin-bottom:22px;">
        <button onclick="event.stopPropagation();cmRevealTurkish('${targetId}')" class="chip" style="padding:8px 20px;">Türkçesini gör</button>
      </div>
      <div id="${trShownId}" class="hidden" style="font-size:20px;color:var(--accent);font-weight:600;margin-bottom:22px;">${turkish || '—'}</div>
      <div id="${extraId}" class="hidden" style="text-align:left;border-top:0.5px solid var(--border);padding-top:16px;margin-bottom:16px;">
        ${c ? renderListDefHTML(c, w) : '<p style="font-size:13px;color:var(--text3);">İçerik bulunamadı.</p>'}
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="${answerCall}false)" style="flex:1;padding:14px;border-radius:var(--rsm);border:none;background:#fff3e0;color:#a05000;font-weight:600;font-size:14px;cursor:pointer;">Öğreniyorum</button>
        <button onclick="${answerCall}true)" style="flex:1;padding:14px;border-radius:var(--rsm);border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;">Biliyorum</button>
      </div>
    </div>
    ${isQueueCard ? `<div style="text-align:center;margin-top:14px;">
      <button onclick="cmUndo()" class="chip" ${cmHistory.length?'':'disabled style="opacity:.4;"'}>↺ geri al</button>
    </div>` : ''}`;
  ttsWireButtons(area);
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
  const w = cmQueue[cmIdx], k = wkey(w);
  const wasNew = !progress[k];
  cmHistory.push({ k, prevEntry: progress[k] ? { ...progress[k] } : null, wasNew, wasKnown: correct });
  const cur = progress[k] || {};
  const next = getNextReview(cur, correct);
  progress[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
  if (correct) cmDone.known++; else cmDone.learning++;
  saveState();
  cmIdx++;
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
  if (last.prevEntry) progress[last.k] = last.prevEntry;
  else delete progress[last.k];
  if (last.wasKnown) cmDone.known--; else cmDone.learning--;
  cmIdx--;
  saveState();
  cmRenderProgress();
  cmShowCard();
}

// ── KELİME DURUMU ────────────────────────────────────────────────────────
// Öğreniyorum/Biliyorum listelerini ayrı, gezinilebilir bir sekmede gösterir.
// Aynı `progress` verisini kullanır (Tekrar Et + Kart Modu ile ortak).
let stTab = 'learning';
let stSelectedLevels = new Set(['A1','A2','B1','B2','C1']);
let stSort = 'az';
let stAddStatusKnown = false;

function stInit() {
  document.getElementById('st-card-area').innerHTML = '';
  document.getElementById('st-list').classList.remove('hidden');
  stRenderLevels();
  stRenderSort();
  stSetTab(stTab);
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
  row.innerHTML = levels.map(lv =>
    `<button class="chip lvl-${lv.toLowerCase()}${stSelectedLevels.has(lv)?' on':''}" onclick="stToggleLevel('${lv}')">${lv}</button>`
  ).join('');
}

function stToggleLevel(lv) {
  if (stSelectedLevels.has(lv) && stSelectedLevels.size > 1) stSelectedLevels.delete(lv);
  else stSelectedLevels.add(lv);
  stRenderLevels();
  stRenderList();
}

function stRenderSort() {
  const row = document.getElementById('st-sort-row');
  const opts = [['az','A→Z'],['recent','🕐 Son değişen'],['favorite','⭐ Favoriler']];
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
    progress[k] = stAddStatusKnown
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
    return wl !== word && wl.startsWith(stem) && !progress[wkey(w)];
  });
  if (related.length) {
    const list = related.map(w => `${w.word} (${w.pos})`).join(', ');
    const status = stAddStatusKnown ? 'Biliyorum' : 'Öğreniyorum';
    if (confirm(`"${word}" eklendi. Aynı kökten gelen başka kelimeler de var: ${list}.\n\nBunları da "${status}" olarak eklemek ister misin?`)) {
      related.forEach(w => {
        const k = wkey(w);
        progress[k] = stAddStatusKnown
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
    .filter(w => stSelectedLevels.has(w.cefr))
    .map(w => ({ w, p: progress[wkey(w)] }))
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
        <span style="font-size:11.5px;color:var(--text2);white-space:nowrap;">✅${p.totalKnown||0} · 🔁${p.totalLearning||0}</span>
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
  delete progress[wkey(w)];
  saveState();
  stRenderList();
  updateDashboard();
}

function stOpenWord(word, pos) {
  const w = WORD_DATA.find(x => x.word===word && x.pos===pos);
  if (!w) return;
  document.getElementById('st-list').classList.add('hidden');
  cmRenderCard(w, 'stAnswerWord', false, 'st-card-area', 'stBackToList');
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
  const cur = progress[k] || {};
  const next = getNextReview(cur, correct);
  progress[k] = { ...next, nextReview: next.nextReview || getNextDate(next.interval), lastSeen: todayStr() };
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
    let status = '🆕';
    if (p) {
      if (p.mastery === 'mastered') status = '✅';
      else if (p.mastery === 'consolidating') status = '📈';
      else status = '🔄';
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
    const statusMap = { reviewing: '🔄 Tekrarda', consolidating: '📈 Pekişiyor', mastered: '✅ Tam öğrenildi' };
    const nextReview = prog.nextReview || '—';
    srEl.textContent = `${statusMap[prog.mastery] || '🔄'} · Sonraki tekrar: ${nextReview} · ${prog.repetitions || 0} tekrar yapıldı`;
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
    const statusMap = { reviewing: '🔄 Tekrarda', consolidating: '📈 Pekişiyor', mastered: '✅ Tam öğrenildi' };
    srEl.textContent = `${statusMap[prog.mastery] || '🔄'} · Sonraki tekrar: ${prog.nextReview} · ${prog.repetitions} tekrar yapıldı`;
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
const SG_EXERCISES = [
  {
    id: "sg1", cefr: "A1", tense: "Present Simple",
    root: ["She", "works"],
    targetWord: "works",
    chunks: [
      { text: "in a bank", pos: 2, role: "Yer zarfı", vocabWord: "bank" },
      { text: "every day", pos: 4, role: "Zaman zarfı", vocabWord: "day" }
    ],
    tenseInfo: { name: "Present Simple (Geniş Zaman)", formula: "Özne + Fiil (3.tekil şahısta -s/-es) + zarflar" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "Fiil (-s/-es)" }],
    turkish: "Her gün bir bankada çalışır."
  },
  {
    id: "sg2", cefr: "A1", tense: "Past Simple",
    root: ["I", "eat", "breakfast"],
    targetWord: "breakfast",
    chunks: [
      { text: "yesterday", pos: 3, role: "Zaman zarfı", vocabWord: "yesterday" },
      { text: "at home", pos: 4, role: "Yer zarfı", vocabWord: "home" }
    ],
    verbConjugation: {
      wordIndex: 1, baseForm: "eat", correctForm: "ate",
      distractors: ["eated", "eaten"], irregular: true,
      triggerAfterChunk: 0
    },
    tenseInfo: { name: "Past Simple (Di'li Geçmiş Zaman)", formula: "Özne + Fiil (V2 / düzensizse ezber form) + Nesne + zarflar" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "Fiil (V2)" }, { idx: 2, role: "Nesne" }],
    turkish: "Dün evde kahvaltı ettim."
  },
  {
    id: "sg3", cefr: "A2", tense: "Present Continuous",
    root: ["They", "are walking"],
    targetWord: "walking",
    chunks: [
      {
        text: "to the park", pos: 2, role: "Yön zarfı", vocabWord: "park",
        prepositionBlank: { template: "___ the park", correct: "to", distractors: ["at", "in"] }
      },
      { text: "right now", pos: 5, role: "Zaman zarfı", vocabWord: "now" }
    ],
    tenseInfo: { name: "Present Continuous (Şimdiki Zaman)", formula: "Özne + am/is/are + Fiil-ing + zarflar" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "am/is/are + V-ing" }],
    turkish: "Şu anda parka doğru yürüyorlar."
  },
  {
    id: "sg4", cefr: "A2", tense: "Future Simple",
    root: ["We", "will visit"],
    targetWord: "visit",
    chunks: [
      { text: "our grandmother", pos: 2, role: "Nesne", vocabWord: "grandmother" },
      { text: "next weekend", pos: 4, role: "Zaman zarfı", vocabWord: "weekend" }
    ],
    tenseInfo: { name: "Future Simple (Gelecek Zaman)", formula: "Özne + will + Fiil + Nesne + zarflar" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "will + Fiil" }],
    turkish: "Gelecek hafta sonu büyükannemizi ziyaret edeceğiz."
  },
  {
    id: "sg5", cefr: "B1", tense: "Present Perfect",
    root: ["She", "has finished"],
    targetWord: "finished",
    chunks: [
      { text: "her homework", pos: 2, role: "Nesne", vocabWord: "homework" },
      { text: "already", pos: 4, role: "Zaman zarfı", vocabWord: "already" }
    ],
    tenseInfo: { name: "Present Perfect (Yakın Geçmiş Zaman)", formula: "Özne + have/has + V3 + Nesne + zarflar" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "have/has + V3" }],
    turkish: "Ödevini zaten bitirdi."
  },
  {
    id: "sg6", cefr: "B1", tense: "Past Continuous",
    root: ["I", "was reading"],
    targetWord: "reading",
    chunks: [
      { text: "a book", pos: 2, role: "Nesne", vocabWord: "book" },
      { text: "when you called", pos: 4, role: "Zaman cümleciği", vocabWord: "called" }
    ],
    tenseInfo: { name: "Past Continuous (Sürekli Geçmiş Zaman)", formula: "Özne + was/were + Fiil-ing + Nesne + zaman cümleciği" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "was/were + V-ing" }],
    turkish: "Sen aradığında bir kitap okuyordum."
  },
  {
    id: "sg7", cefr: "B2", tense: "Present Perfect Continuous",
    root: ["He", "has been working"],
    targetWord: "working",
    chunks: [
      {
        text: "on this project", pos: 2, role: "Konu zarfı", vocabWord: "project",
        prepositionBlank: { template: "___ this project", correct: "on", distractors: ["at", "for"] }
      },
      { text: "for three hours", pos: 5, role: "Süre zarfı", vocabWord: "hours" }
    ],
    tenseInfo: { name: "Present Perfect Continuous", formula: "Özne + have/has been + Fiil-ing + zarflar" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "have/has been + V-ing" }],
    turkish: "Üç saattir bu proje üzerinde çalışıyor."
  },
  {
    id: "sg8", cefr: "B2", tense: "Past Perfect",
    root: ["They", "had left"],
    targetWord: "left",
    chunks: [
      { text: "the office", pos: 2, role: "Nesne", vocabWord: "office" },
      { text: "before I arrived", pos: 4, role: "Zaman cümleciği", vocabWord: "arrived" }
    ],
    tenseInfo: { name: "Past Perfect (Geçmişte Bitmiş Zaman)", formula: "Özne + had + V3 + Nesne + zaman cümleciği" },
    rootRoles: [{ idx: 0, role: "Özne" }, { idx: 1, role: "had + V3" }],
    turkish: "Ben varmadan önce ofisten ayrılmışlardı."
  }
];

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
  el.innerHTML = all.map(l =>
    `<div class="chip lvl-${l.toLowerCase()}${sgSelectedLevels.has(l) ? ' on' : ''}" data-level="${l}">${l}</div>`
  ).join('');
  el.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      const lvl = chip.dataset.level;
      if (sgSelectedLevels.has(lvl) && sgSelectedLevels.size > 1) sgSelectedLevels.delete(lvl);
      else sgSelectedLevels.add(lvl);
      sgRenderLevels();
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
      sgPickExercise();
    };
  });
}

function sgGetPool() {
  if (sgSelectedTenseFilter) return SG_EXERCISES.filter(e => e.tense === sgSelectedTenseFilter);
  return SG_EXERCISES.filter(e => sgSelectedLevels.has(e.cefr));
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
    if (st.nextReview && st.nextReview <= today) score += 3;
  });
  return score;
}

function sgPickExercise() {
  const pool = sgGetPool();
  if (pool.length === 0) {
    document.getElementById('sg-content').innerHTML =
      `<div class="sg-card"><div class="sg-empty">Bu seviye(ler) için henüz egzersiz yok.</div></div>`;
    return;
  }
  let candidates = pool.length > 1 ? pool.filter(e => e.id !== sgLastExerciseId) : pool;
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
  return `
    <div class="sg-grammar-card">
      <div class="sg-grammar-title">${sgCurrentExercise.tenseInfo.name}</div>
      <div class="sg-grammar-formula">${sgCurrentExercise.tenseInfo.formula}</div>
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

  c.innerHTML = `<div class="sg-card">${progressHtml}${sentenceHtml}${bodyHtml}</div>`;
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
  sgCurrentExercise.chunks.forEach(chunk => { if (chunk.vocabWord) items.push({ key: `word:${chunk.vocabWord}`, label: chunk.vocabWord }); });
  items.forEach(item => { if (item.key.startsWith('word:')) markContact(item.key.slice(5), 'used'); });
  if (sgCurrentExercise.verbConjugation && sgCurrentExercise.verbConjugation.irregular) {
    const vc = sgCurrentExercise.verbConjugation;
    items.push({ key: `verb:${vc.baseForm}`, label: `${vc.correctForm} (düzensiz fiil)` });
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
sgRenderTenseFilter();
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
  el.innerHTML = all.map(l =>
    `<div class="chip lvl-${l.toLowerCase()}${hgSelectedLevels.has(l) ? ' on' : ''}" data-level="${l}">${l}</div>`
  ).join('');
  el.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      const lvl = chip.dataset.level;
      if (hgSelectedLevels.has(lvl)) hgSelectedLevels.delete(lvl); else hgSelectedLevels.add(lvl);
      hgRenderLevels();
      hgPickWord();
    };
  });
}

function hgGetPool() {
  if (hgSelectedLevels.size === 0) return HG_POOL;
  return HG_POOL.filter(w => hgSelectedLevels.has(w.cefr));
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
hgPickWord();
hgLoadStats();
renderListCefrRow();
renderTtsStatus();