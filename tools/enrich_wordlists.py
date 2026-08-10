#!/usr/bin/env python3
"""
WordHaven — kelime listesi zenginleştirme
=========================================

Girdi (aynı klasörde olmalı):
    word-data.json        Oxford 3000/5000
    topic-words.json      Konu kelimeleri
    longman-3000.json     S1-S3 / W1-W3 bantları
    longman-9000.json     High / Medium / Low Frequency
    voa-word-book.json    VOA Special English çekirdek listesi

Çıktı:
    word-data.json        (güncellenir: voa bayrağı eklenir)
    topic-words.json      (güncellenir: speaking / writing / freq / voa eklenir)
    extra-words.json      (YENİ: Longman+VOA'da olup Oxford'da olmayan havuz)

Kullanım:
    python3 enrich_wordlists.py

Not: Orijinal dosyaların .bak yedeği alınır.
"""

import json
import re
import shutil
import os
from collections import defaultdict, Counter

# ── POS normalizasyonu ────────────────────────────────────────────────────────
# Longman'ın kısaltmaları WordHaven'ın (Oxford) uzun pos adlarına çevrilir.
L3_POS = {
    'n': 'noun', 'v': 'verb', 'adj': 'adjective', 'adv': 'adverb',
    'pron': 'pronoun', 'prep': 'preposition', 'conj': 'conjunction',
    'determiner': 'determiner', 'interjection': 'exclamation',
    'modal': 'modal verb', 'number': 'number',
    'indefinite article': 'indefinite article',
    'definite article': 'definite article',
    'auxiliary': 'auxiliary verb', 'predeterminer': 'determiner',
}
L9_POS = {
    'noun': 'noun', 'verb': 'verb', 'adjective': 'adjective', 'adverb': 'adverb',
    'pronoun': 'pronoun', 'preposition': 'preposition', 'conjunction': 'conjunction',
    'determiner': 'determiner', 'interjection': 'exclamation',
    'modal': 'modal verb', 'number': 'number',
    'indefinite article': 'indefinite article',
    'definite article': 'definite article',
    'auxiliary': 'auxiliary verb', 'predeterminer': 'determiner',
}
VOA_POS = {
    'n': 'noun', 'v': 'verb', 'adj': 'adjective', 'ad': 'adverb',
    'conj': 'conjunction', 'prep': 'preposition', 'pro': 'pronoun',
}

FREQ_ORDER = {'High Frequency': 0, 'Medium Frequency': 1, 'Low Frequency': 2}
SP_ORDER = {'S1': 0, 'S2': 1, 'S3': 2}
WR_ORDER = {'W1': 0, 'W2': 1, 'W3': 2}


def norm(s):
    """Kelime normalizasyonu: küçük harf, parantezli ekleri at, boşlukları sadeleştir.
    'a (an)' -> 'a', 'case (court)' -> 'case', 'seek(ing)' -> 'seek'"""
    s = s.lower().strip()
    s = s.replace('seek(ing)', 'seek')
    s = re.sub(r'\s*\(.*?\)\s*', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save(path, data):
    if os.path.exists(path):
        shutil.copy2(path, path + '.bak')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def best(values, order):
    """Birden fazla bant varsa en güçlüsünü (en düşük sıra numarası) seç."""
    vals = [v for v in values if v in order]
    return min(vals, key=lambda v: order[v]) if vals else ''


# ── Kaynak indeksleri ─────────────────────────────────────────────────────────
def build_indexes():
    l3 = load('longman-3000.json')['words']
    l9 = load('longman-9000.json')['words']
    voa = load('voa-word-book.json')['words']

    # (kelime, pos) -> bant   ve   kelime -> [bantlar]  (pos eşleşmezse yedek)
    sp_wp, wr_wp = {}, {}
    sp_w, wr_w = defaultdict(list), defaultdict(list)
    for e in l3:
        w = norm(e['word'])
        s, r = e.get('spoken'), e.get('written')
        if s:
            sp_w[w].append(s)
        if r:
            wr_w[w].append(r)
        for p in e['pos']:
            np = L3_POS.get(p)
            if not np:
                continue
            if s:
                sp_wp[(w, np)] = s
            if r:
                wr_wp[(w, np)] = r

    fr_wp, fr_w = {}, defaultdict(list)
    for e in l9:
        w = norm(e['word'])
        f = e.get('frequency')
        if not f:
            continue
        fr_w[w].append(f)
        for p in e['pos']:
            np = L9_POS.get(p)
            if np:
                fr_wp[(w, np)] = f

    voa_w = set()
    voa_pos = defaultdict(set)
    voa_def = {}
    for e in voa:
        w = norm(e['word'])
        voa_w.add(w)
        for p in e['pos']:
            np = VOA_POS.get(p)
            if np:
                voa_pos[w].add(np)
        senses = e.get('senses') or []
        if senses and w not in voa_def:
            voa_def[w] = senses[0].get('definition', '')

    return dict(sp_wp=sp_wp, wr_wp=wr_wp, sp_w=sp_w, wr_w=wr_w,
                fr_wp=fr_wp, fr_w=fr_w, voa_w=voa_w, voa_pos=voa_pos,
                voa_def=voa_def, l3=l3, l9=l9, voa=voa)


def lookup(ix, word, pos):
    """Önce (kelime,pos) tam eşleşmesi, olmazsa kelime düzeyinde en güçlü bant."""
    w = norm(word)
    sp = ix['sp_wp'].get((w, pos)) or best(ix['sp_w'].get(w, []), SP_ORDER)
    wr = ix['wr_wp'].get((w, pos)) or best(ix['wr_w'].get(w, []), WR_ORDER)
    fr = ix['fr_wp'].get((w, pos)) or best(ix['fr_w'].get(w, []), FREQ_ORDER)
    return sp or '', wr or '', fr or ''


def is_voa(ix, word, pos):
    w = norm(word)
    if w not in ix['voa_w']:
        return False
    poses = ix['voa_pos'].get(w)
    # VOA'nın pos bilgisi kaba (ad = adjective/adverb). pos kaydı yoksa
    # veya eşleşiyorsa bayrağı ver; aksi halde yine kelime düzeyinde kabul et.
    return True if not poses else True


# ── 1) word-data.json: sadece voa bayrağı ─────────────────────────────────────
def enrich_word_data(ix):
    wd = load('word-data.json')
    n = 0
    for w in wd:
        if is_voa(ix, w['word'], w['pos']):
            w['voa'] = True   # false'ı hiç yazma, dosya küçük kalsın
            n += 1
    save('word-data.json', wd)
    print(f"word-data.json      : {len(wd)} kayıt, {n} tanesi VOA çekirdeğinde")
    return wd


# ── 2) topic-words.json: speaking / writing / freq / voa ──────────────────────
def enrich_topic_words(ix):
    tw = load('topic-words.json')
    stats = Counter()
    for w in tw:
        sp, wr, fr = lookup(ix, w['word'], w['pos'])
        # Boş alanları HİÇ yazma — 19.776 kayda boş string eklemek dosyayı
        # ~1 MB şişiriyor. Uygulama tarafı zaten (w.speaking || '') okuyor.
        if sp:
            w['speaking'] = sp
        if wr:
            w['writing'] = wr
        if fr:
            w['freq'] = fr
        if is_voa(ix, w['word'], w['pos']):
            w['voa'] = True
        if sp:
            stats['speaking'] += 1
        if wr:
            stats['writing'] += 1
        if fr:
            stats['freq'] += 1
        if w.get('voa'):
            stats['voa'] += 1
        if sp or wr or fr:
            stats['any'] += 1
    save('topic-words.json', tw)
    print(f"topic-words.json    : {len(tw)} kayıt | "
          f"speaking {stats['speaking']} | writing {stats['writing']} | "
          f"freq {stats['freq']} | voa {stats['voa']} | en az bir bant {stats['any']}")
    return tw


# ── 3) extra-words.json: Oxford dışı havuz ────────────────────────────────────
def build_extra_pool(ix, wd, tw):
    oxford = set(norm(w['word']) for w in wd) | set(norm(w['word']) for w in tw)

    # Aday kayıtları kelime+pos düzeyinde topla
    cand = {}   # (word, pos) -> kayıt

    def add(word, pos, source):
        w = norm(word)
        if not w or w in oxford:
            return
        key = (w, pos)
        if key not in cand:
            cand[key] = {
                'word': w, 'pos': pos, 'cefr': '',
                'speaking': '', 'writing': '', 'freq': '',
                'categories': [], 'voa': False, 'sources': [],
            }
        if source not in cand[key]['sources']:
            cand[key]['sources'].append(source)

    def add_all(entries, posmap, source):
        for e in entries:
            mapped = [posmap.get(p) for p in e.get('pos', [])]
            mapped = [m for m in mapped if m]
            # Kaynakta pos boş veya tanınmıyorsa kelimeyi yine de al (pos '').
            # 'a.m.', 'e.g.', 'good evening', "let's", 'mr' gibi kısaltma ve
            # kalıplar bu yüzden düşmesin.
            for np in (mapped or ['']):
                add(e['word'], np, source)

    add_all(ix['l3'], L3_POS, 'L3000')
    add_all(ix['l9'], L9_POS, 'L9000')
    add_all(ix['voa'], VOA_POS, 'VOA')

    # Bantları ve VOA tanımını doldur
    for (w, pos), rec in cand.items():
        sp, wr, fr = lookup(ix, w, pos)
        rec['speaking'], rec['writing'], rec['freq'] = sp, wr, fr
        # VOA bayrağı KELİME düzeyinde belirlenir (word-data.json ile aynı kural).
        # pos düzeyinde bakılırsa VOA'nın kaba pos etiketleri (ad = sıfat/zarf)
        # yüzünden tanımı olan kelime rozetsiz kalabiliyordu.
        rec['voa'] = w in ix['voa_w']
        if rec['voa'] and 'VOA' not in rec['sources']:
            rec['sources'].append('VOA')
        # VOA'nın hazır İngilizce tanımı — akşamki üretimde çeviri temeli olur
        d = ix['voa_def'].get(w)
        if d:
            rec['voaDefinition'] = d

    # Boş alanları temizle (dosya boyutu). 'word' ve 'pos' her zaman kalır.
    for rec in cand.values():
        for k in ('cefr', 'speaking', 'writing', 'freq'):
            if not rec.get(k):
                rec.pop(k, None)
        if not rec.get('categories'):
            rec.pop('categories', None)
        if not rec.get('voa'):
            rec.pop('voa', None)

    extra = sorted(cand.values(), key=lambda r: (r['word'], r['pos']))
    save('extra-words.json', extra)

    uniq = len(set(r['word'] for r in extra))
    print(f"extra-words.json    : {len(extra)} kayıt / {uniq} benzersiz kelime")
    print("  frekans dağılımı  :", dict(Counter(r.get('freq') or '—' for r in extra)))
    print("  kaynak dağılımı   :", dict(Counter('+'.join(r['sources']) for r in extra)))
    print("  VOA tanımı hazır  :", sum(1 for r in extra if r.get('voaDefinition')))
    return extra


def main():
    print("Kaynaklar okunuyor…")
    ix = build_indexes()
    print()
    wd = enrich_word_data(ix)
    tw = enrich_topic_words(ix)
    build_extra_pool(ix, wd, tw)
    print("\nBitti. Yedekler .bak uzantısıyla saklandı.")


if __name__ == '__main__':
    main()
