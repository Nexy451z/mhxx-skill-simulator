/* ==========================================================================
   お守り管理ストア (js/core/charm-store.js)
   --------------------------------------------------------------------------
   スキルシミュレーターが使う「手持ちのお守り」を localStorage に永続化し、
   CRUD・テキスト入出力・上位互換のお守りの枝刈りを提供する。

   依存:
     js/core/save-parser.js（読まれていればラベル整形とスキル名解決に使う）
     無くても単体で動作する（スキル名→ポイントの表だけを扱うため）

   公開: window.MHXX.charmStore（互換のため MHXX.core.charmStore にも登録）

   保存キー: mhxx_sim_charms_v1
   保存形式: { version: 1, charms: [ Charm, ... ] }
     Charm = {
       id, name, kind, rarity, slots,
       skills: [{ name, pt }, ...],
       skillMap: { スキル名: pt },
       label, source, tag, preset, createdAt, updatedAt,
       skill1, skill1Pt, skill2, skill2Pt,   … UI 互換のフラット表現（常に付与）
       boxIndex?, sourceSlot?                … セーブ由来メタデータ（再正規化でも保持）
     }

   テキスト形式（泣シミュ互換）:
     1行 = スキル1,値1,スキル2,値2,スロット数
     例) 2 スキル  痛撃,6,達人,10,3
         1 スキル  斬れ味,6,,,3  / 短縮形 斬れ味,6,3
         無スキル  ,,,,3
         マイナス  乗り,6,気絶,-1,3  / ,0,気絶,-2,3
     ※ スキルポイントは負値もそのまま保持し、0 に潰さない
     ※ 3 スキル以上は「名前,値」の組を必要なだけ並べて最後にスロット数
       （列数が奇数になるので最後の列がスロット数として解釈される）
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.core = MHXX.core || {};

  var STORAGE_KEY = 'mhxx_sim_charms_v1';
  var STORE_VERSION = 1;
  var MAX_SLOTS = 3;

  /* saveParser が無い場合のフォールバック（ゲームデータと同じ並び） */
  var KIND_NAMES = [
    '装備なし', '兵士の護石', '闘士の護石', '騎士の護石',
    '城塞の護石', '女王の護石', '王の護石', '龍の護石',
    '英雄の護石', '伝説の護石', '天の護石'
  ];
  var KIND_RARITY = [0, 97, 97, 98, 98, 99, 99, 99, 100, 100, 100];

  /* 初期プリセット（神おま・汎用おま） */
  var PRESET_DEFS = [
    { tag: '神おま', name: '天の護石', kind: 10, slots: 3, skills: [{ name: '痛撃', pt: 6 }, { name: '達人', pt: 10 }] },
    { tag: '汎用', name: '天の護石', kind: 10, slots: 3, skills: [{ name: '斬れ味', pt: 6 }] },
    { tag: 'ガンナー', name: '天の護石', kind: 10, slots: 3, skills: [{ name: '通常弾強化', pt: 6 }, { name: '達人', pt: 9 }] },
    { tag: '火力', name: '天の護石', kind: 10, slots: 3, skills: [{ name: '攻撃', pt: 10 }] },
    { tag: '匠', name: '龍の護石', kind: 7, slots: 3, skills: [{ name: '匠', pt: 5 }] },
    { tag: 'スロット用', name: '天の護石', kind: 10, slots: 3, skills: [] }
  ];

  /* --- 小道具 ------------------------------------------------------ */

  function parser() {
    return MHXX.saveParser || (MHXX.core && MHXX.core.saveParser) || null;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function toInt(value, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.round(n);
  }

  function kindName(kind) {
    var p = parser();
    if (p && typeof p.charmKindName === 'function') {
      var resolved = p.charmKindName(kind);
      if (resolved) return resolved;
    }
    return typeof KIND_NAMES[kind] === 'string' ? KIND_NAMES[kind] : '護石';
  }

  function kindRarity(kind) {
    var rarity = KIND_RARITY[kind];
    return typeof rarity === 'number' ? rarity : 0;
  }

  function kindFromName(name) {
    for (var i = 0; i < KIND_NAMES.length; i++) {
      if (KIND_NAMES[i] === name) return i;
    }
    if (name === '護石') return 0;
    return null;
  }

  function formatSignedPoints(pt) {
    return pt >= 0 ? '+' + pt : String(pt);
  }

  function buildLabel(charm) {
    var p = parser();
    if (p && typeof p.formatCharmLabel === 'function') {
      return p.formatCharmLabel(charm);
    }
    var parts = [];
    var skills = charm.skills || [];
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      if (!skill || !skill.name || !skill.pt) continue;
      parts.push(skill.name + formatSignedPoints(skill.pt));
    }
    if (!parts.length) parts.push('スキルなし');
    parts.push('スロ' + (charm.slots || 0));
    return '[' + (charm.name || kindName(charm.kind)) + '] ' + parts.join(' ');
  }

  var idCounter = 0;
  function nextId() {
    idCounter += 1;
    return 'c' + Date.now().toString(36) + '-' + idCounter.toString(36) +
      '-' + Math.random().toString(36).slice(2, 6);
  }

  function cloneCharm(charm) {
    return JSON.parse(JSON.stringify(charm));
  }

  /* --- 正規化 ------------------------------------------------------ */

  function skillsFromMap(map) {
    var out = [];
    if (!map || typeof map !== 'object') return out;
    for (var name in map) {
      if (!hasOwn(map, name)) continue;
      out.push({ name: name, pt: map[name] });
    }
    return out;
  }

  /* フラットな skill1/skill2 表現からのフォールバック（UI 互換入力用） */
  function skillsFromFlat(input) {
    var out = [];
    if (input.skill1) {
      var p1 = toInt(input.skill1Pt, 0);
      if (p1 !== 0) out.push({ name: input.skill1, pt: p1 });
    }
    if (input.skill2) {
      var p2 = toInt(input.skill2Pt, 0);
      if (p2 !== 0) out.push({ name: input.skill2, pt: p2 });
    }
    return out;
  }

  function normalizeSkills(input) {
    var raw = input.skills;
    /* skills が「未指定」のときだけ skillMap → skill1/skill2 の順に補う。
       skills: [] は意図的な「スキル無し」なので空のまま扱う。 */
    if (!raw || typeof raw.length !== 'number') {
      var fromMap = input.skillMap && typeof input.skillMap === 'object'
        ? skillsFromMap(input.skillMap) : [];
      raw = fromMap.length ? fromMap : skillsFromFlat(input);
    }
    var map = Object.create(null);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var entry = raw[i];
      var name = null;
      var pt = null;
      if (Array.isArray(entry)) {
        name = entry[0];
        pt = entry[1];
      } else if (entry && typeof entry === 'object') {
        name = entry.name || entry.skill || entry.system;
        pt = entry.pt != null ? entry.pt : (entry.points != null ? entry.points : entry.value);
      }
      if (typeof name !== 'string') continue;
      name = name.replace(/^\s+|\s+$/g, '');
      if (!name) continue;
      pt = toInt(pt, 0);
      if (pt === 0) continue;
      if (map[name] != null) continue; /* 同名スキルは先勝ち */
      map[name] = pt;
      out.push({ name: name, pt: pt });
    }
    return out;
  }

  /* セーブ由来の数値メタデータを数値化する。数値でなければ null（=未指定扱い） */
  function metaInt(value) {
    if (value == null) return null;
    var n = Number(value);
    if (!isFinite(n)) return null;
    return Math.round(n);
  }

  /* フラットな互換プロパティを常に付与する。
     app.js / charm-panel.js / charm-modal.js のどの経路から参照されても
     skill1, skill1Pt, skill2, skill2Pt が見えるようにするため。 */
  function attachFlatSkills(charm) {
    var skills = (charm && charm.skills) || [];
    var first = skills[0] || null;
    var second = skills[1] || null;
    charm.skill1 = first ? first.name : '';
    charm.skill1Pt = first ? first.pt : 0;
    charm.skill2 = second ? second.name : '';
    charm.skill2Pt = second ? second.pt : 0;
    return charm;
  }

  function normalizeCharm(input, defaults) {
    input = input || {};
    defaults = defaults || {};

    var skills = normalizeSkills(input);
    var skillMap = {};
    for (var i = 0; i < skills.length; i++) skillMap[skills[i].name] = skills[i].pt;

    var hasKind = input.kind != null && isFinite(Number(input.kind));
    var kind = toInt(input.kind, defaults.kind != null ? defaults.kind : 0);
    if (kind < 0) kind = 0;
    if (kind > 10) kind = 10;

    var name = typeof input.name === 'string' ? input.name.replace(/^\s+|\s+$/g, '') : '';
    /* 泣シミュのテキスト形式には護石名が無いので、指定が無ければ汎用名「護石」 */
    if (!name) name = hasKind ? kindName(kind) : '護石';
    if (!hasKind) {
      var byName = kindFromName(name);
      if (byName !== null) kind = byName;
    }

    /* レア度は入力（セーブの 97..100 など）をそのまま尊重し、
       未指定のときだけ護石の種類から決める。 */
    var rarity = metaInt(input.rarity);
    if (rarity === null) rarity = kindRarity(kind);
    if (rarity < 0) rarity = 0;
    if (rarity > 255) rarity = 255;

    var slots = toInt(input.slots != null ? input.slots : input.slot, 0);
    if (slots < 0) slots = 0;
    if (slots > MAX_SLOTS) slots = MAX_SLOTS;

    var charm = {
      id: typeof input.id === 'string' && input.id ? input.id : nextId(),
      name: name,
      kind: kind,
      rarity: rarity,
      slots: slots,
      skills: skills,
      skillMap: skillMap,
      label: '',
      source: input.source || defaults.source || 'manual',
      tag: input.tag || defaults.tag || '',
      preset: input.preset === true,
      createdAt: input.createdAt || Date.now(),
      updatedAt: input.updatedAt || Date.now()
    };

    /* セーブ由来のメタデータは再正規化で失わない。
       配列添字 (idx) などで上書きせず、元の値をそのまま引き継ぐ。 */
    var boxIndex = metaInt(input.boxIndex);
    if (boxIndex !== null) charm.boxIndex = boxIndex;
    var sourceSlot = metaInt(input.sourceSlot);
    if (sourceSlot !== null) charm.sourceSlot = sourceSlot;
    if (input.saveFormat) charm.saveFormat = input.saveFormat;
    if (typeof input.sourceCharmId === 'string' && input.sourceCharmId) {
      charm.sourceCharmId = input.sourceCharmId;
    }

    charm.label = buildLabel(charm);
    return attachFlatSkills(charm);
  }

  /* --- 永続化 ------------------------------------------------------ */

  var memoryStorage = null;
  function getStorage() {
    try {
      if (typeof global.localStorage !== 'undefined' && global.localStorage) {
        var probeKey = '__mhxx_charm_store_probe__';
        global.localStorage.setItem(probeKey, '1');
        global.localStorage.removeItem(probeKey);
        return global.localStorage;
      }
    } catch (err) {
      /* file:// やプライベートモードで使えない場合はメモリに退避 */
    }
    if (!memoryStorage) {
      var data = {};
      memoryStorage = {
        getItem: function (key) { return hasOwn(data, key) ? data[key] : null; },
        setItem: function (key, value) { data[key] = String(value); },
        removeItem: function (key) { delete data[key]; }
      };
    }
    return memoryStorage;
  }

  function readStored() {
    var raw = null;
    try { raw = getStorage().getItem(STORAGE_KEY); } catch (err) { raw = null; }
    if (raw == null || raw === '') return null;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return null; }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.charms)) return parsed.charms;
    return null;
  }

  function persist() {
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify({
        version: STORE_VERSION,
        charms: charms
      }));
    } catch (err) {
      /* 容量オーバー等は握りつぶす（メモリ上は保持される） */
    }
    notify();
  }

  /* --- 変更通知 ---------------------------------------------------- */

  var subscribers = [];
  function notify() {
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](getAll()); } catch (err) { /* UI 側の例外は無視 */ }
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    subscribers.push(listener);
    return function () { unsubscribe(listener); };
  }

  function unsubscribe(listener) {
    for (var i = subscribers.length - 1; i >= 0; i--) {
      if (subscribers[i] === listener) subscribers.splice(i, 1);
    }
  }

  /* --- 初期化 ------------------------------------------------------ */

  function buildPresets() {
    var out = [];
    for (var i = 0; i < PRESET_DEFS.length; i++) {
      var def = PRESET_DEFS[i];
      out.push(normalizeCharm({
        id: 'preset-' + (i + 1),
        name: def.name,
        kind: def.kind,
        slots: def.slots,
        skills: def.skills,
        source: 'preset',
        tag: def.tag,
        preset: true
      }, { source: 'preset' }));
    }
    return out;
  }

  function initCharms() {
    var stored = readStored();
    if (stored === null) return buildPresets();
    var out = [];
    var usedIds = Object.create(null);
    for (var i = 0; i < stored.length; i++) {
      if (!stored[i]) continue;
      var charm = normalizeCharm(stored[i], { source: stored[i].source || 'manual' });
      /* 旧バージョンが書き込んだ重複 ID も起動時に一意化する */
      if (usedIds[charm.id]) charm.id = nextId();
      usedIds[charm.id] = true;
      out.push(charm);
    }
    return out;
  }

  var charms = initCharms();

  /* --- 照会 -------------------------------------------------------- */

  function getAll() {
    var out = [];
    for (var i = 0; i < charms.length; i++) out.push(cloneCharm(charms[i]));
    return out;
  }

  function getById(id) {
    for (var i = 0; i < charms.length; i++) {
      if (charms[i].id === id) return cloneCharm(charms[i]);
    }
    return null;
  }

  function count() {
    return charms.length;
  }

  function charmSignature(charm) {
    var skills = (charm && charm.skills) || [];
    var parts = [];
    for (var i = 0; i < skills.length; i++) {
      if (!skills[i] || !skills[i].name || !skills[i].pt) continue;
      parts.push(skills[i].name + ':' + skills[i].pt);
    }
    parts.sort();
    return (charm && charm.slots != null ? charm.slots : 0) + '|' + parts.join(',');
  }

  /* --- CRUD -------------------------------------------------------- */

  function idInUse(id) {
    for (var i = 0; i < charms.length; i++) {
      if (charms[i].id === id) return true;
    }
    return false;
  }

  function addCharm(input) {
    var charm = normalizeCharm(input, { source: 'manual' });
    if (input && input.preset === true) charm.preset = true;
    /* 既存と ID が衝突したら振り直す（重複 ID による水増し・誤削除を防ぐ） */
    if (idInUse(charm.id)) charm.id = nextId();
    charms.push(charm);
    persist();
    return cloneCharm(charm);
  }

  function addCharms(list) {
    var added = [];
    if (!list || typeof list.length !== 'number') return added;
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      added.push(addCharm(list[i]));
    }
    return added;
  }

  function updateCharm(id, input) {
    input = input || {};
    for (var i = 0; i < charms.length; i++) {
      if (charms[i].id !== id) continue;
      var base = cloneCharm(charms[i]);
      var merged = {};
      for (var key in base) if (hasOwn(base, key)) merged[key] = base[key];
      for (var key2 in input) if (hasOwn(input, key2)) merged[key2] = input[key2];
      merged.id = id;
      merged.source = base.source;
      merged.tag = input.tag != null ? input.tag : base.tag;
      merged.preset = base.preset;
      merged.createdAt = base.createdAt;

      var next = normalizeCharm(merged, { source: base.source });
      next.id = id;
      next.createdAt = base.createdAt;
      next.preset = base.preset;
      next.updatedAt = Date.now();
      charms[i] = next;
      persist();
      return cloneCharm(next);
    }
    return null;
  }

  function removeCharm(id) {
    for (var i = 0; i < charms.length; i++) {
      if (charms[i].id !== id) continue;
      charms.splice(i, 1);
      persist();
      return true;
    }
    return false;
  }

  function clearAll() {
    var removed = charms.length;
    charms = [];
    persist();
    return removed;
  }

  function resetToPresets() {
    charms = buildPresets();
    persist();
    return getAll();
  }

  function getPresets() {
    return buildPresets();
  }

  /* --- テキスト / JSON 入出力 -------------------------------------- */

  /* お守りからスキル配列を得る。
     skills → skillMap → skill1/skill2 の順にフォールバックする。 */
  function charmSkillList(charm) {
    if (!charm) return [];
    if (charm.skills && typeof charm.skills.length === 'number' && charm.skills.length) {
      return charm.skills;
    }
    if (charm.skillMap) return skillsFromMap(charm.skillMap);
    var out = [];
    var p1 = toInt(charm.skill1Pt, 0);
    var p2 = toInt(charm.skill2Pt, 0);
    if (charm.skill1 && p1 !== 0) out.push({ name: charm.skill1, pt: p1 });
    if (charm.skill2 && p2 !== 0) out.push({ name: charm.skill2, pt: p2 });
    return out;
  }

  function formatCryLine(charm) {
    var fields = [];
    var skills = charmSkillList(charm);
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      if (!skill) continue;
      var skillName = skill.name || skill.group;
      if (!skillName) continue;
      var pt = toInt(skill.pt != null ? skill.pt : skill.points, 0);
      /* 0 ポイントは「スキル無し」だが、負のポイントは有効なスキルなので残す */
      if (pt === 0) continue;
      fields.push(String(skillName));
      fields.push(String(pt));
    }
    /* 泣シミュの 5 列形式に合わせ、スキルが 2 つ未満なら空列で埋める。
       3 スキル以上はそのまま並べる（列数が奇数になり最後がスロット数）。 */
    while (fields.length < 4) fields.push('');
    fields.push(String(toInt(charm && charm.slots != null ? charm.slots : 0, 0)));
    return fields.join(',');
  }

  function csvField(value) {
    var text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportCry() {
    var lines = [];
    for (var i = 0; i < charms.length; i++) lines.push(formatCryLine(charms[i]));
    return lines.join('\n');
  }

  function exportCsv(options) {
    options = options || {};
    var lines = [];
    if (options.header !== false) {
      lines.push('護石名,スキル1,値1,スキル2,値2,スロット数');
    }
    for (var i = 0; i < charms.length; i++) {
      var charm = charms[i];
      var s1 = charm.skills[0] || null;
      var s2 = charm.skills[1] || null;
      lines.push([
        csvField(charm.name),
        csvField(s1 ? s1.name : ''),
        s1 ? String(s1.pt) : '',
        csvField(s2 ? s2.name : ''),
        s2 ? String(s2.pt) : '',
        String(charm.slots)
      ].join(','));
    }
    return lines.join('\n');
  }

  function exportJson() {
    return JSON.stringify({
      version: STORE_VERSION,
      exportedAt: new Date().toISOString(),
      charms: charms
    }, null, 2);
  }

  function exportText(format, options) {
    var fmt = String(format || 'text').toLowerCase();
    if (fmt === 'json') return exportJson();
    if (fmt === 'csv') return exportCsv(options);
    return exportCry();
  }

  function isKindName(name) {
    for (var i = 0; i < KIND_NAMES.length; i++) {
      if (KIND_NAMES[i] === name) return true;
    }
    return name === '護石';
  }

  function parseLabelLine(line) {
    var match = line.match(/^\[([^\]]*)\]\s*(.*)$/);
    if (!match) return null;
    var name = match[1].replace(/^\s+|\s+$/g, '');
    var rest = match[2];
    var slots = 0;
    var skills = [];
    var tokens = rest.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (!token) continue;
      var slotMatch = token.match(/^スロ(?:ット)?(\d+)$/);
      if (slotMatch) { slots = toInt(slotMatch[1], 0); continue; }
      var skillMatch = token.match(/^(.+?)([+-]\d+)$/);
      if (skillMatch) {
        var pt = toInt(skillMatch[2], 0);
        if (pt !== 0) skills.push({ name: skillMatch[1], pt: pt });
      }
    }
    if (slots < 0) slots = 0;
    if (slots > MAX_SLOTS) slots = MAX_SLOTS;
    return { name: name, skills: skills, slots: slots };
  }

  function parseCharmTextLine(line) {
    if (!line) return null;
    var text = String(line).replace(/^\s+|\s+$/g, '');
    if (!text) return null;
    if (text.charAt(0) === '[') return parseLabelLine(text);

    var fields = text.split(/[,\t]/);
    for (var i = 0; i < fields.length; i++) fields[i] = fields[i].replace(/^\s+|\s+$/g, '');
    /* 末尾の空フィールド（"痛撃,6,,,3," のような出力）は読み飛ばす */
    while (fields.length > 1 && fields[fields.length - 1] === '') fields.pop();
    if (fields.length < 2) return null;

    var name = null;
    if (isKindName(fields[0])) {
      name = fields[0];
      fields = fields.slice(1);
    }
    if (!fields.length) return null;

    var slots = 0;
    /* 泣シミュ形式は「(名前,値)* , スロット数」なので列数は奇数になる。
       2 列だけならスロット数なし、3 列なら短縮形 (名前,値,スロット数)。 */
    if (fields.length % 2 === 1) {
      slots = toInt(fields[fields.length - 1], 0);
      fields = fields.slice(0, fields.length - 1);
    }
    if (slots < 0) slots = 0;
    if (slots > MAX_SLOTS) slots = MAX_SLOTS;

    var skills = [];
    for (var k = 0; k + 1 < fields.length; k += 2) {
      var skillName = fields[k];
      if (!skillName) continue;
      /* 負のポイントもそのまま保持する（0 のときだけスキル無し扱い） */
      var pt = toInt(fields[k + 1], 0);
      if (pt === 0) continue;
      skills.push({ name: skillName, pt: pt });
    }
    return { name: name, skills: skills, slots: slots };
  }

  function isHeaderLine(line) {
    var lower = line.toLowerCase();
    return lower.indexOf('スキル1') >= 0 || lower.indexOf('護石名') >= 0 ||
      lower.indexOf('slots') >= 0 || lower.indexOf('スロット数') >= 0 ||
      lower.indexOf('skill1') >= 0;
  }

  function parseImportText(text) {
    var src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var trimmed = src.replace(/^\s+|\s+$/g, '');
    if (!trimmed) return { items: [], format: 'empty' };

    var first = trimmed.charAt(0);
    if (first === '[' || first === '{') {
      var data;
      try {
        data = JSON.parse(trimmed);
      } catch (err) {
        throw new Error('JSON の解析に失敗しました: ' + (err && err.message ? err.message : err));
      }
      var arr = Array.isArray(data) ? data : (data && Array.isArray(data.charms) ? data.charms : null);
      if (!arr) throw new Error('JSON の形式が不正です（配列か { charms: [...] } を渡してください）');
      return { items: arr, format: 'json' };
    }

    var lines = trimmed.split(/\r?\n/);
    var items = [];
    var format = 'text';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, '');
      if (!line) continue;
      if (line.charAt(0) === '#' || line.indexOf('//') === 0) continue;
      if (isHeaderLine(line)) { format = 'csv'; continue; }
      var item = parseCharmTextLine(line);
      if (item) items.push(item);
    }
    return { items: items, format: format };
  }

  function normalizeMode(mode) {
    return String(mode || '').toLowerCase() === 'replace' ? 'replace' : 'merge';
  }

  function importMany(items, mode, sourceName) {
    mode = normalizeMode(mode);
    var normalized = [];
    for (var i = 0; i < (items ? items.length : 0); i++) {
      var item = items[i];
      if (!item) continue;
      normalized.push(normalizeCharm(item, { source: sourceName === 'save' ? 'save' : 'import' }));
    }

    var summary = {
      mode: mode,
      format: sourceName || 'text',
      added: 0,
      skipped: 0,
      total: charms.length,
      error: ''
    };

    /* 取り込む側の ID も一意化する。JSON 取込などで同じ ID が複数含まれていても
       「重複 ID の水増し」で一覧・削除・編集が壊れないようにする。 */
    var usedIds = Object.create(null);
    if (mode !== 'replace') {
      for (var u = 0; u < charms.length; u++) usedIds[charms[u].id] = true;
    }
    for (var n = 0; n < normalized.length; n++) {
      if (!normalized[n].id || usedIds[normalized[n].id]) normalized[n].id = nextId();
      usedIds[normalized[n].id] = true;
    }

    if (mode === 'replace') {
      if (!normalized.length) {
        summary.error = '取り込めるお守りがありませんでした（置き換えは行っていません）';
        return summary;
      }
      /* 置き換え時は実セーブの重複もそのまま保持する */
      charms = normalized;
      summary.added = normalized.length;
      persist();
      summary.total = charms.length;
      return summary;
    }

    /* 重複判定は「既存の登録数」をカウントして行う。
       実セーブに存在する同性能のお守り（物理的に複数持っている）は
       1 回目の取込では落とさず、同じスロットを再取込したときだけ増分が 0 になる。 */
    var counts = Object.create(null);
    for (var k = 0; k < charms.length; k++) {
      var existingSig = charmSignature(charms[k]);
      counts[existingSig] = (counts[existingSig] || 0) + 1;
    }
    for (var j = 0; j < normalized.length; j++) {
      var sig = charmSignature(normalized[j]);
      if (counts[sig] > 0) {
        counts[sig] -= 1;
        summary.skipped += 1;
        continue;
      }
      charms.push(normalized[j]);
      summary.added += 1;
    }
    if (summary.added) persist();
    summary.total = charms.length;
    return summary;
  }

  function importText(text, mode) {
    var summary = {
      mode: normalizeMode(mode),
      format: 'text',
      added: 0,
      skipped: 0,
      total: charms.length,
      error: ''
    };
    var parsed;
    try {
      parsed = parseImportText(text);
    } catch (err) {
      summary.error = err && err.message ? err.message : String(err);
      return summary;
    }
    summary.format = parsed.format;
    var result = importMany(parsed.items, summary.mode, 'import');
    result.format = parsed.format;
    return result;
  }

  function saveItemSignature(item) {
    var parts = [];
    var skills = (item && item.skills) || [];
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      if (!skill) continue;
      var name = skill.name || skill.group;
      var pt = toInt(skill.pt != null ? skill.pt : skill.points, 0);
      if (!name || pt === 0) continue;
      parts.push(name + ':' + pt);
    }
    parts.sort();
    return toInt(item && item.slots, 0) + '|' + parts.join(',');
  }

  /**
   * セーブスロットからお守りを取り込む。
   *
   * replace 時はセーブ内の全件をそのまま保持する（スロット1 = 188 件、
   * スロット2 = 231 件など）。「スキルなしスロ3」や同性能お守りが勝手に
   * 減ってユーザーが驚くことがないよう、既定では重複除去しない。
   * 重複をまとめたい場合だけ options.dedupe = true を渡す。
   *
   * @param {Array} charmsArray saveParser の slot.charms（または同等の配列）
   * @param {string} [mode] 'replace' で全置換 / 'merge'（既定）で追記
   * @param {Object} [options] { dedupe: boolean }
   * @returns {Object} summary（added / skipped / total / deduped / inputCount）
   */
  function importFromSaveSlot(charmsArray, mode, options) {
    if (options === true) options = { dedupe: true };
    options = options || {};
    var dedupe = options.dedupe === true;
    var arr = charmsArray && typeof charmsArray.length === 'number' ? charmsArray : [];
    var items = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      var charm = arr[i];
      if (!charm) continue;
      items.push({
        name: charm.name,
        kind: charm.kind,
        rarity: charm.rarity,
        slots: charm.slots,
        skills: charm.skills,
        skillMap: charm.skillMap,
        boxIndex: charm.boxIndex,
        sourceSlot: charm.sourceSlot,
        source: 'save',
        saveFormat: charm.saveFormat
      });
    }

    var deduped = 0;
    if (dedupe) {
      var seen = Object.create(null);
      var kept = [];
      for (i = 0; i < items.length; i++) {
        var sig = saveItemSignature(items[i]);
        if (seen[sig]) { deduped += 1; continue; }
        seen[sig] = true;
        kept.push(items[i]);
      }
      items = kept;
    }

    var summary = importMany(items, mode, 'save');
    summary.deduped = deduped;
    summary.inputCount = arr.length;
    summary.sourceSlot = arr.length && arr[0] && arr[0].sourceSlot != null
      ? arr[0].sourceSlot : null;
    return summary;
  }

  /* --- 上位互換のお守りの枝刈り ------------------------------------ */

  function normalizeSystems(requiredSystems) {
    if (!requiredSystems) return null;
    var arr = typeof requiredSystems === 'string' ? [requiredSystems] : requiredSystems;
    if (!arr || typeof arr.length !== 'number' || !arr.length) return null;
    var p = parser();
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < arr.length; i++) {
      var value = arr[i];
      var name = null;
      if (typeof value === 'number') {
        if (p && typeof p.skillSystemName === 'function') name = p.skillSystemName(value);
      } else if (typeof value === 'string') {
        name = value;
      } else if (value && typeof value.name === 'string') {
        name = value.name;
      }
      if (!name || seen[name]) continue;
      seen[name] = true;
      out.push(name);
    }
    return out.length ? out : null;
  }

  /* a が b の上位互換か。
     戻り値: 1 = a が b を厳密に上回る / 0 = 性能が同一 / -1 = それ以外
     ※ スキルポイントは符号付きのまま比較する。達人 0（未所持）は 達人 -10 より
        厳密に優れており、負値を 0 に潰すと同一性能と誤判定してしまう。 */
  function domination(a, b, systems) {
    if (a.slots < b.slots) return -1;
    var strict = a.slots > b.slots;
    var i;
    var av;
    var bv;

    if (systems) {
      var va = a.vals;
      var vb = b.vals;
      for (i = 0; i < va.length; i++) {
        av = va[i];
        bv = vb[i];
        if (av < bv) return -1;
        if (av > bv) strict = true;
      }
      return strict ? 1 : 0;
    }

    var pa = a.pairs;
    var pb = b.pairs;
    var mapB = b.map;
    var pair;
    for (i = 0; i < pa.length; i++) {
      pair = pa[i];
      /* 未所持は 0 として比較する（負値は負値のまま） */
      bv = hasOwn(mapB, pair[0]) ? mapB[pair[0]] : 0;
      if (pair[1] < bv) return -1;
      if (pair[1] > bv) strict = true;
    }
    for (i = 0; i < pb.length; i++) {
      pair = pb[i];
      if (hasOwn(a.map, pair[0])) continue;
      /* b の余分なスキル: プラスは強み、マイナスは弱み */
      if (pair[1] > 0) return -1;
      if (pair[1] < 0) strict = true;
    }
    return strict ? 1 : 0;
  }

  /* 同一の (スロット数, 対象系統の値) を持つお守り同士で、どちらを残すかを決める。
     優先順:
       1. マイナススキルを持たない方（負のポイントの個数が少ない方）
       2. マイナス合計が浅い方（-1 > -10）
       3. 他系統の合計ポイントが高い方
       4. 全体合計が高い方
       5. 元の並び順で先の方
     ※ 負値は 0 に潰さず符号付きのまま比較する。 */
  function preferEntry(a, b) {
    if (a.negCount !== b.negCount) return a.negCount < b.negCount;
    if (a.negSum !== b.negSum) return a.negSum > b.negSum;
    if (a.otherSum !== b.otherSum) return a.otherSum > b.otherSum;
    if (a.totalSum !== b.totalSum) return a.totalSum > b.totalSum;
    return a.index < b.index;
  }

  /**
   * 上位互換のお守りだけを残す（枝刈り）。
   *
   * - スキルポイントは符号付きのまま比較する
   *   （達人 0 は 達人 -10 より厳密に上回る）。
   * - requiredSystems 指定時は「対象系統 + スロット数」が同値のお守りを 1 件に
   *   まとめ、マイナススキルを持たない方 / 他系統の合計が高い方を残す。
   *   これにより配列順によってマイナス付きだけが残る事故を防ぐ。
   * - 同一性能の重複は常に 1 件にまとめる。
   *
   * @param {Array} list お守り配列（saveParser の出力でも charmStore の出力でもよい）
   * @param {Array|string} [requiredSystems]
   *        注目するスキル系統（名前、またはスキル系統 ID の配列）。省略時は全系統。
   * @returns {Array} 入力のうち、他に完全上位互換・同一性能が存在しないもの。
   *          戻り値の要素は入力配列の要素そのもの（参照を保持）。
   */
  function pruneDominatedCharms(list, requiredSystems) {
    var input = list && typeof list.length === 'number' ? list : [];
    var systems = normalizeSystems(requiredSystems);
    var entries = [];
    var i;
    var j;

    for (i = 0; i < input.length; i++) {
      var charm = input[i];
      if (!charm) continue;

      var skills = charmSkillList(charm);
      var map = Object.create(null);
      for (j = 0; j < skills.length; j++) {
        var skill = skills[j];
        if (!skill) continue;
        var skillName = skill.name || skill.group;
        if (typeof skillName !== 'string' || !skillName) continue;
        var pt = Number(skill.pt != null ? skill.pt : skill.points);
        if (!isFinite(pt) || pt === 0) continue;
        /* 負のポイントも 0 に潰さず、そのまま合算する */
        map[skillName] = (map[skillName] || 0) + pt;
      }

      var pairs = [];
      var negCount = 0;
      var negSum = 0;
      var totalSum = 0;
      for (var key in map) {
        if (!hasOwn(map, key)) continue;
        var value = map[key];
        pairs.push([key, value]);
        totalSum += value;
        if (value < 0) {
          negCount += 1;
          negSum += value;
        }
      }

      var slots = Number(charm.slots != null ? charm.slots : charm.slot);
      if (!isFinite(slots) || slots < 0) slots = 0;

      var vals = null;
      var sigParts = [];
      var otherSum = totalSum;
      if (systems) {
        vals = [];
        var requiredSum = 0;
        for (j = 0; j < systems.length; j++) {
          var requiredValue = hasOwn(map, systems[j]) ? map[systems[j]] : 0;
          vals.push(requiredValue);
          requiredSum += requiredValue;
          sigParts.push(systems[j] + ':' + requiredValue);
        }
        otherSum = totalSum - requiredSum;
      } else {
        var sorted = pairs.slice(0).sort(function (a, b) {
          return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
        });
        for (j = 0; j < sorted.length; j++) sigParts.push(sorted[j][0] + ':' + sorted[j][1]);
      }

      entries.push({
        charm: charm,
        index: i,
        map: map,
        pairs: pairs,
        slots: slots,
        vals: vals,
        sig: slots + '|' + sigParts.join(','),
        negCount: negCount,
        negSum: negSum,
        totalSum: totalSum,
        otherSum: otherSum
      });
    }

    /* 1) 同一性能（対象系統 + スロットが同値）は代表 1 件にまとめる。
          代表は「マイナス無し > 他系統の合計が高い > 元の並び順」。 */
    var groups = Object.create(null);
    var sigOrder = [];
    for (i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!hasOwn(groups, entry.sig)) {
        groups[entry.sig] = entry;
        sigOrder.push(entry.sig);
        continue;
      }
      if (preferEntry(entry, groups[entry.sig])) groups[entry.sig] = entry;
    }
    var unique = [];
    for (i = 0; i < sigOrder.length; i++) unique.push(groups[sigOrder[i]]);
    unique.sort(function (a, b) { return a.index - b.index; });

    /* 2) 他に上位互換があれば除外 */
    var keep = [];
    for (i = 0; i < unique.length; i++) {
      var dominated = false;
      for (j = 0; j < unique.length; j++) {
        if (i === j) continue;
        var relation = domination(unique[j], unique[i], systems);
        if (relation > 0) { dominated = true; break; }
        if (relation === 0 && preferEntry(unique[j], unique[i])) { dominated = true; break; }
      }
      if (!dominated) keep.push(unique[i].charm);
    }
    return keep;
  }

  /* --- 公開 API ---------------------------------------------------- */

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: STORE_VERSION,

    /* 参照系 */
    getAll: getAll,
    getCharms: getAll,
    getById: getById,
    count: count,
    getPresets: getPresets,

    /* 変更系 */
    addCharm: addCharm,
    addCharms: addCharms,
    updateCharm: updateCharm,
    removeCharm: removeCharm,
    clearAll: clearAll,
    resetToPresets: resetToPresets,

    /* 取り込み */
    importFromSaveSlot: importFromSaveSlot,
    importText: importText,

    /* 書き出し */
    exportText: exportText,
    exportCsv: function () { return exportCsv({}); },
    exportJson: exportJson,

    /* ユーティリティ */
    normalizeCharm: normalizeCharm,
    pruneDominatedCharms: pruneDominatedCharms,
    charmSignature: charmSignature,
    formatCryLine: formatCryLine,
    parseCharmTextLine: parseCharmTextLine,
    parseImportText: parseImportText,

    /* 変更通知 */
    subscribe: subscribe,
    unsubscribe: unsubscribe
  };

  MHXX.charmStore = api;
  MHXX.core.charmStore = api;
})(typeof window !== 'undefined' ? window : this);
