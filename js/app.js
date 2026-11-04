/* ==========================================================================
   MHXX スキルシミュレーター - エントリポイント / 状態管理 / アダプタ層
   --------------------------------------------------------------------------
   読み込み順（index.html の <script defer> の並び順で保証される）:
     js/data/sim-data.js        -> MHXX.data            （任意 / 無ければ fallback）
     js/core/save-parser.js     -> MHXX.saveParser      （任意）
     js/core/charm-store.js     -> MHXX.charmStore      （任意）
     js/core/search-engine.js   -> MHXX.searchEngine    （任意 / 無ければ demo）
     js/ui/ui-kit.js            -> MHXX.uiKit / MHXX.bus
     js/ui/fallback-data.js     -> MHXX.fallbackData
     js/ui/demo-engine.js       -> MHXX.demoEngine
     js/ui/*.js                 -> MHXX.ui.<module>
     js/app.js                  -> 本ファイル（最後に読み込む）

   他サブエージェントのモジュールが未完成でも、フォールバックで必ず起動する。
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var bus = MHXX.bus;

  /* ======================================================================
     1. データ正規化（js/data/sim-data.js の形を吸収する）
     ====================================================================== */

  var CATEGORY_LABELS = {
    recommended: 'よく使う/おすすめ',
    attack: '戦闘(攻撃)',
    survival: '戦闘(生存)',
    resist: '特殊攻撃耐性',
    param: 'パラメータ変化',
    item: 'アイテム・クエスト',
    combo: '複合・二つ名',
    all: 'すべて'
  };

  var CATEGORY_ALIASES = {
    'attack': 'attack', '戦闘(攻撃)': 'attack', '攻撃': 'attack', '火力': 'attack',
    'survival': 'survival', '戦闘(生存)': 'survival', '生存': 'survival', '防御': 'survival',
    'resist': 'resist', '特殊攻撃耐性': 'resist', '耐性': 'resist',
    'param': 'param', 'パラメータ変化': 'param', 'パラメータ': 'param',
    'item': 'item', 'アイテム・クエスト': 'item', 'アイテム': 'item',
    'quest': 'item', 'クエスト': 'item',
    'combo': 'combo', '複合・二つ名': 'combo', '複合スキル': 'combo', '複合': 'combo', '二つ名': 'combo',
    'recommended': 'recommended', 'よく使う/おすすめ': 'recommended', 'おすすめ': 'recommended',
    'all': 'all', 'すべて': 'all', '全て': 'all'
  };

  /* 表示するタブ（仕様どおりの並び / データ側に categories が無い場合に使用） */
  var DEFAULT_CATEGORIES = [
    { id: 'recommended', label: 'よく使う/おすすめ' },
    { id: 'attack', label: '戦闘(攻撃)' },
    { id: 'survival', label: '戦闘(生存)' },
    { id: 'resist', label: '特殊攻撃耐性' },
    { id: 'param', label: 'パラメータ変化' },
    { id: 'item', label: 'アイテム・クエスト' },
    { id: 'combo', label: '複合・二つ名' },
    { id: 'all', label: 'すべて' }
  ];

  /* sim-data.js に「おすすめ」フラグが無いため、定番スキルを名前で指定する */
  var RECOMMENDED_NAMES = [
    '見切り+1', '見切り+2', '見切り+3', '超会心', '弱点特効', '連撃の心得',
    '斬れ味レベル+1', '斬れ味レベル+2', '業物', '攻撃力UP【中】', '攻撃力UP【大】',
    '挑戦者+1', '挑戦者+2', '逆上', '死中に活', '龍気活性', '不屈', '本気', '護法',
    '耳栓', '高級耳栓', '回避性能+1', '回避性能+2', '回避距離UP', '納刀術',
    '砥石使用高速化', '通常弾・連射矢UP', '貫通弾・貫通矢UP', '散弾・拡散矢UP',
    '装填数UP', '装填速度+2', '反動軽減+2', 'ブレ抑制+2', '弾道強化', '速射', '変則射撃',
    '気絶無効', '体力+50', 'スタミナ急速回復', '体術', 'ランナー', '集中', '抜刀術【技】',
    '属性攻撃強化', '溜め短縮', '剣術+2', 'ガード性能+2', '広域化+2', '精霊の加護'
  ];
  var RECOMMENDED_MAP = {};
  RECOMMENDED_NAMES.forEach(function (name) { RECOMMENDED_MAP[name] = true; });

  function firstNumber(values, fallback) {
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      if (value === null || value === undefined || value === '') continue;
      var num = Number(value);
      if (!isNaN(num)) return num;
    }
    return fallback;
  }

  function normalizeCategory(value) {
    if (!value) return 'all';
    var key = String(value).trim();
    if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
    var lower = key.toLowerCase();
    if (CATEGORY_ALIASES[lower]) return CATEGORY_ALIASES[lower];
    return 'all';
  }

  function normalizeWeapon(value) {
    if (!value) return 'both';
    var key = String(value).toLowerCase();
    if (key === 'blade' || key === '剣士' || key === 'sword' || key === 'melee') return 'blade';
    if (key === 'gunner' || key === 'ガンナー' || key === 'bow' || key === 'gun') return 'gunner';
    return 'both';
  }

  function pickSkillList(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data.length ? data : null;
    var keys = ['skills', 'skillList', 'skillData', 'allSkills', 'skill'];
    for (var i = 0; i < keys.length; i++) {
      var value = data[keys[i]];
      if (Array.isArray(value) && value.length) return value;
      if (value && typeof value === 'object') {
        var arr = kit.toArray(value);
        if (arr.length) return arr;
      }
    }
    return null;
  }

  function normalizeSkill(raw) {
    if (!raw) return null;

    if (typeof raw === 'string') {
      return {
        name: raw, group: raw, threshold: 10,
        category: 'all', weapon: 'both', recommended: false
      };
    }

    if (Array.isArray(raw)) {
      return {
        name: raw[0],
        group: raw[1] || raw[0],
        threshold: firstNumber([raw[2]], 10),
        category: normalizeCategory(raw[3]),
        weapon: normalizeWeapon(raw[4]),
        recommended: !!raw[5]
      };
    }

    var name = raw.name || raw.label || raw.title || raw.n;
    if (!name) return null;

    var group = raw.group || raw.tree || raw.series || raw.system || raw.groupName ||
      raw.categoryName || raw.skillGroup || name;

    /* points がマイナスのスキル（見切り-1 など）は選択対象外にするため、負値はそのまま保持する */
    var threshold = firstNumber(
      [raw.threshold, raw.need, raw.required, raw.points, raw.max, raw.value, raw.pt],
      NaN
    );
    if (isNaN(threshold)) threshold = 10;

    return {
      name: String(name),
      group: String(group),
      threshold: threshold,
      negative: threshold < 0,
      category: normalizeCategory(raw.categoryKey || raw.category || raw.cat || raw.kind),
      weapon: normalizeWeapon(raw.weapon || raw.weaponType || raw.type),
      recommended: !!(raw.recommended || raw.popular || raw.pick || raw.isRecommended) ||
        RECOMMENDED_MAP[name] === true,
      description: raw.description || raw.desc || ''
    };
  }

  function ensureData() {
    var data = MHXX.data;
    var rawSkills = pickSkillList(data);
    var usingFallback = false;

    if (!rawSkills) {
      data = MHXX.fallbackData || {};
      rawSkills = data.skills || [];
      usingFallback = true;
      MHXX.data = data;
    }

    var skills = [];
    var byName = {};
    var byGroup = {};

    var negatives = [];
    rawSkills.forEach(function (raw) {
      var skill = normalizeSkill(raw);
      if (!skill || !skill.name || byName[skill.name]) return;
      if (!(skill.threshold > 0)) {
        /* 必要ポイントがマイナスのバッドスキル（攻撃力DOWN / 見切り-1 など）は
           STEP 3 のチップに出さない（誤タップ防止）。データ自体は保持する。 */
        if (skill.threshold < 0) {
          skill.negative = true;
          negatives.push(skill);
        }
        return;
      }
      byName[skill.name] = skill;
      skills.push(skill);
      (byGroup[skill.group] || (byGroup[skill.group] = [])).push(skill);
    });

    Object.keys(byGroup).forEach(function (group) {
      byGroup[group].sort(function (a, b) { return a.threshold - b.threshold; });
    });

    /* 仕様のタブ構成を優先（データ側の categories はラベル上書き用にのみ使用） */
    var categories = DEFAULT_CATEGORIES.map(function (category) { return { id: category.id, label: category.label }; });
    if (data && Array.isArray(data.categories) && data.categories.length) {
      var labelById = {};
      data.categories.forEach(function (category) {
        if (!category) return;
        if (typeof category === 'string') {
          labelById[normalizeCategory(category)] = category;
        } else {
          var catId = normalizeCategory(category.id || category.key || category.name);
          labelById[catId] = category.label || category.name || catId;
        }
      });
      categories.forEach(function (category) {
        if (labelById[category.id]) category.label = labelById[category.id];
      });
    }

    var charmTypes = data.charmTypes || data.charmTypeList || data.charmNames ||
      data.charmKindNames || (MHXX.fallbackData ? MHXX.fallbackData.charmTypes : ['龍の護石']);
    if (Array.isArray(charmTypes)) {
      charmTypes = charmTypes.filter(function (name) { return name && name !== 'なし' && name !== '装備なし'; });
      if (!charmTypes.length) charmTypes = ['龍の護石'];
    }

    /* データにおすすめ情報が無い場合の保険（先頭の汎用スキルを数件おすすめ扱い） */
    if (!skills.some(function (skill) { return skill.recommended; })) {
      skills.slice(0, 40).forEach(function (skill) {
        if (skill.threshold <= 20) skill.recommended = true;
      });
    }

    MHXX.skillIndex = {
      all: skills,
      byName: byName,
      byGroup: byGroup,
      negatives: negatives,
      groups: Object.keys(byGroup),
      fallback: usingFallback
    };
    MHXX.categories = categories;
    MHXX.charmTypes = Array.isArray(charmTypes) ? charmTypes.slice() : ['龍の護石'];

    /* 護石の種類（kind 0 = 装備なし を含む正式名）。お守り管理モーダルの選択肢に使う */
    var kindNames = (data && (data.charmKindNamesRaw || data.charmKindNames)) || [];
    if (!Array.isArray(kindNames) || !kindNames.length) kindNames = CHARM_KIND_NAMES;
    MHXX.charmKindNames = kindNames.slice();

    if (usingFallback) {
      console.info('[MHXX] js/data/sim-data.js が無いためフォールバックデータで起動しました');
    }
  }

  /* ======================================================================
     2. お守り API（js/core/charm-store.js を唯一の保存先として使う）
     ----------------------------------------------------------------------
     ・MHXX.charmStore があれば必ずそこへ読み書きする
       （STEP 2 の #charmSelect / お守り管理モーダル / 検索候補が同じ一覧を参照）
     ・charmStore が読み込まれていない環境だけ localStorage にフォールバック
     ・旧 localStorage キー（mhxx.skillSimulator.charms.v1）に残ったお守りは
       起動時に一度だけストアへ移行し、一覧から消えないようにする
     ====================================================================== */

  var LEGACY_STORAGE_KEY = 'mhxx.skillSimulator.charms.v1';
  var localCharms = null;
  var localSeq = 0;
  var legacyMigrated = false;

  var CHARM_KIND_NAMES = [
    '装備なし', '兵士の護石', '闘士の護石', '騎士の護石', '城塞の護石',
    '女王の護石', '王の護石', '龍の護石', '英雄の護石', '伝説の護石', '天の護石'
  ];

  function getStore() {
    return MHXX.charmStore || (MHXX.core && MHXX.core.charmStore) || null;
  }

  function hasOwnKey(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function parsePointToken(token) {
    var match = String(token).match(/^(.+?)([+-]?[0-9]+)$/);
    if (!match) return null;
    return { group: match[1].trim(), points: Number(match[2]) };
  }

  function localKindNames() {
    if (Array.isArray(MHXX.charmKindNames) && MHXX.charmKindNames.length) return MHXX.charmKindNames;
    var data = MHXX.data;
    if (data && Array.isArray(data.charmKindNamesRaw) && data.charmKindNamesRaw.length) {
      return data.charmKindNamesRaw;
    }
    if (data && Array.isArray(data.charmKindNames) && data.charmKindNames.length) {
      return data.charmKindNames;
    }
    return CHARM_KIND_NAMES;
  }

  function isKindName(name) {
    return localKindNames().indexOf(name) !== -1 || name === '護石';
  }

  function readLegacyCharms() {
    var raw = null;
    try {
      raw = global.localStorage ? global.localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    } catch (err) {
      raw = null;
    }
    if (!raw) return [];
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return [];
    }
    var list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.charms) ? parsed.charms : []);
    var out = [];
    list.forEach(function (item) {
      var charm = normalizeCharm(item);
      if (charm) out.push(charm);
    });
    return out;
  }

  function clearLegacyCharms() {
    try {
      if (global.localStorage) global.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (err) {
      /* localStorage が使えない環境では何もしない */
    }
  }

  function loadLocalCharms() {
    if (localCharms) return localCharms;
    var legacy = readLegacyCharms();
    if (legacy.length) {
      localCharms = legacy;
      clearLegacyCharms();
      return localCharms;
    }
    var samples = (MHXX.fallbackData && MHXX.fallbackData.sampleCharms) || [];
    localCharms = samples.map(function (charm) { return normalizeCharm(charm); }).filter(Boolean);
    saveLocalCharms();
    return localCharms;
  }

  function saveLocalCharms() {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(localCharms || []));
      }
    } catch (err) {
      /* file:// などで localStorage が使えない場合はメモリのみで動作 */
    }
  }

  function nextCharmId() {
    localSeq += 1;
    return 'charm-' + Date.now().toString(36) + '-' + localSeq;
  }

  /* お守りを UI 用の共通形へ正規化する。
       { id, type, name, kind, rarity, slots,
         skills: [{ name, group, pt, points }] }
     ポイントは負値（-10 など）も保持し、kind 0（装備なし）/
     スキルなしスロ3 のお守りも壊さない。 */
  function normalizeCharm(raw) {
    if (!raw) return null;

    if (typeof raw === 'string') {
      var token = parsePointToken(raw);
      if (!token) return null;
      return {
        id: nextCharmId(),
        type: '護石',
        name: '護石',
        kind: null,
        rarity: null,
        slots: 0,
        skills: [{ name: token.group, group: token.group, pt: token.points, points: token.points }]
      };
    }

    var type = raw.type || raw.charmType || raw.charmName || raw.name || raw.title || '護石';
    var slots = firstNumber([raw.slots, raw.slot, raw.slotCount, raw.decoSlots, raw.slotNum], 0);
    slots = Math.max(0, Math.min(3, slots));

    var skills = [];
    var source = raw.skills || raw.skillList || raw.effects || raw.skill || raw.skillMap || [];

    if (Array.isArray(source)) {
      source.forEach(function (entry) {
        if (Array.isArray(entry)) {
          if (entry[0]) skills.push({ group: String(entry[0]), points: Number(entry[1]) || 0 });
        } else if (entry && typeof entry === 'object') {
          var group = entry.group || entry.name || entry.skill || entry.system || entry.groupName;
          if (!group) return;
          skills.push({
            group: String(group),
            points: firstNumber([entry.points, entry.pt, entry.value, entry.level], 0)
          });
        } else if (typeof entry === 'string') {
          var parsed = parsePointToken(entry);
          if (parsed) skills.push(parsed);
        }
      });
    } else if (source && typeof source === 'object') {
      Object.keys(source).forEach(function (group) {
        skills.push({ group: group, points: Number(source[group]) || 0 });
      });
    }

    [raw.skill1, raw.firstSkill, raw.skill2, raw.secondSkill].forEach(function (entry) {
      if (!entry) return;
      if (typeof entry === 'string') {
        var parsedEntry = parsePointToken(entry);
        if (parsedEntry) skills.push(parsedEntry);
      } else if (typeof entry === 'object' && (entry.group || entry.name)) {
        skills.push({
          group: String(entry.group || entry.name),
          points: firstNumber([entry.points, entry.pt, entry.value], 0)
        });
      }
    });

    var merged = {};
    var order = [];
    skills.forEach(function (skill) {
      if (!skill.group) return;
      if (!hasOwnKey(merged, skill.group)) order.push(skill.group);
      merged[skill.group] = (merged[skill.group] || 0) + (Number(skill.points) || 0);
    });

    var charm = {
      id: raw.id != null && raw.id !== '' ? String(raw.id) : nextCharmId(),
      type: String(type),
      name: String(type),
      kind: (raw.kind != null && raw.kind !== '' && isFinite(Number(raw.kind))) ? Number(raw.kind) : null,
      rarity: (raw.rarity != null && raw.rarity !== '' && isFinite(Number(raw.rarity))) ? Number(raw.rarity) : null,
      slots: slots,
      skills: order.map(function (group) {
        return { name: group, group: group, pt: merged[group], points: merged[group] };
      })
    };
    if (raw.source) charm.source = raw.source;
    if (raw.tag) charm.tag = raw.tag;
    if (raw.preset === true) charm.preset = true;
    if (typeof raw.label === 'string' && raw.label) charm.storeLabel = raw.label;
    if (raw.boxIndex != null) charm.boxIndex = raw.boxIndex;
    if (raw.sourceSlot != null) charm.sourceSlot = raw.sourceSlot;
    return charm;
  }

  function charmLabel(charm) {
    if (!charm) return '';
    var name = charm.type || charm.name || '護石';
    var parts = (charm.skills || []).map(function (skill) {
      var group = skill.name || skill.group || '';
      var points = Number(skill.points != null ? skill.points : skill.pt) || 0;
      if (!group) return '';
      return group + (points > 0 ? '+' : '') + points;
    }).filter(Boolean);
    return name + ' ' + (parts.length ? parts.join(' ') : 'スキルなし') +
      ' スロ' + (Number(charm.slots) || 0);
  }

  function charmSignature(charm) {
    var store = getStore();
    if (store && typeof store.charmSignature === 'function') {
      try {
        return store.charmSignature(charm);
      } catch (err) { /* フォールバックへ */ }
    }
    var parts = [];
    ((charm && charm.skills) || []).forEach(function (skill) {
      var name = skill && (skill.name || skill.group);
      var pt = Number(skill && (skill.points != null ? skill.points : skill.pt)) || 0;
      if (!name || !pt) return;
      parts.push(name + ':' + pt);
    });
    parts.sort();
    return String((charm && charm.slots) || 0) + '|' + parts.join(',');
  }

  function callStore(methodNames, args) {
    var store = getStore();
    if (!store) return undefined;
    for (var i = 0; i < methodNames.length; i++) {
      var fn = store[methodNames[i]];
      if (typeof fn !== 'function') continue;
      try {
        return fn.apply(store, args || []);
      } catch (err) {
        console.warn('[MHXX] charmStore.' + methodNames[i] + ' failed', err);
      }
    }
    return undefined;
  }

  /* charmStore に渡す payload（charm-store.js の Charm 形式） */
  function toStorePayload(charm, keepId) {
    var normalized = normalizeCharm(charm);
    if (!normalized) return null;
    var payload = {
      id: keepId && normalized.id ? String(normalized.id) : undefined,
      name: normalized.type,
      kind: normalized.kind != null ? normalized.kind : undefined,
      rarity: normalized.rarity != null ? normalized.rarity : undefined,
      slots: normalized.slots,
      skills: normalized.skills.map(function (skill) {
        return { name: skill.name, pt: skill.points };
      })
    };
    if (normalized.source) payload.source = normalized.source;
    if (normalized.tag) payload.tag = normalized.tag;
    if (normalized.boxIndex != null) payload.boxIndex = normalized.boxIndex;
    if (normalized.sourceSlot != null) payload.sourceSlot = normalized.sourceSlot;
    return payload;
  }

  /* charmStore が無いときの localStorage レコード */
  function localRecord(charm) {
    var normalized = normalizeCharm(charm);
    if (!normalized) return null;
    return {
      id: normalized.id,
      type: normalized.type,
      name: normalized.type,
      kind: normalized.kind,
      rarity: normalized.rarity,
      slots: normalized.slots,
      skills: normalized.skills.map(function (skill) {
        return { name: skill.name, group: skill.name, points: skill.points, pt: skill.points };
      })
    };
  }

  /* スペース区切り形式（例: 痛撃+6 達人+10 スロ3）を
     カンマ区切り（泣シミュ互換）へ展開して charm-store の取込へ渡す */
  function expandSpaceFormatLine(line) {
    var source = String(line == null ? '' : line).replace(/^\s+|\s+$/g, '');
    if (!source || source.charAt(0) === '[' || source.charAt(0) === '{' || source.charAt(0) === '"') return null;
    if (source.indexOf(',') !== -1 || source.indexOf('\t') !== -1) return null;
    var tokens = source.split(/\s+/);
    var name = null;
    if (tokens.length && isKindName(tokens[0])) name = tokens.shift();
    var slots = 0;
    var skills = [];
    tokens.forEach(function (token) {
      var slotMatch = token.match(/^(?:スロ(?:ット)?|slot|s)([0-3])$/i);
      if (slotMatch) { slots = Number(slotMatch[1]); return; }
      var match = token.match(/^(.+?)([+-][0-9]+)$/);
      if (match) skills.push([match[1], Number(match[2])]);
    });
    if (!skills.length && !slots) return null;
    var fields = [name || '護石'];
    skills.forEach(function (pair) { fields.push(pair[0], String(pair[1])); });
    fields.push(String(slots));
    return fields.join(',');
  }

  /* ラベル形式（例: [天の護石] 痛撃+6 達人+10 スロ3）をカンマ区切りへ展開する。
     charm-store の text 取込は先頭が '[' だと JSON と誤認するため、ここで変換する。 */
  function expandLabelFormatLine(line) {
    var source = String(line == null ? '' : line).replace(/^\s+|\s+$/g, '');
    if (source.charAt(0) !== '[') return null;
    var match = source.match(/^\[([^\]]*)\]\s*(.*)$/);
    if (!match) return null;
    var name = match[1].replace(/^\s+|\s+$/g, '');
    var rest = match[2];
    if (name.indexOf('{') !== -1 || name.indexOf('"') !== -1) return null;
    if (rest.indexOf('{') !== -1 || rest.indexOf('"') !== -1) return null;

    var slots = 0;
    var skills = [];
    rest.split(/\s+/).forEach(function (token) {
      if (!token) return;
      var slotMatch = token.match(/^スロ(?:ット)?([0-3])$/);
      if (slotMatch) { slots = Number(slotMatch[1]); return; }
      var skillMatch = token.match(/^(.+?)([+-][0-9]+)$/);
      if (skillMatch) skills.push([skillMatch[1], Number(skillMatch[2])]);
    });
    if (!skills.length && !slots) return null;

    var fields = [isKindName(name) ? name : '護石'];
    skills.forEach(function (pair) { fields.push(pair[0], String(pair[1])); });
    fields.push(String(slots));
    return fields.join(',');
  }

  function normalizeImportText(text) {
    var src = String(text == null ? '' : text);
    if (src.replace(/^\s+/, '').charAt(0) === '{') return src;
    var out = [];
    src.split(/\r?\n/).forEach(function (line) {
      var expanded = expandLabelFormatLine(line);
      if (expanded === null) expanded = expandSpaceFormatLine(line);
      out.push(expanded === null ? line : expanded);
    });
    return out.join('\n');
  }

  /* charm-store が無い環境用の簡易テキストパーサ */
  function parseLocalCharmText(text) {
    var out = [];
    var src = normalizeImportText(text);
    src.split(/\r?\n/).forEach(function (line) {
      var source = line.replace(/^\s+|\s+$/g, '');
      if (!source || source.charAt(0) === '#') return;
      var fields = source.split(/[,\t]/);
      for (var i = 0; i < fields.length; i++) fields[i] = fields[i].replace(/^\s+|\s+$/g, '');
      if (fields.length < 2) return;

      var name = '護石';
      if (isKindName(fields[0])) name = fields.shift();
      if (!fields.length) return;

      var slots = 0;
      if (fields.length % 2 === 1) slots = firstNumber([fields.pop()], 0);
      var skills = [];
      for (var k = 0; k + 1 < fields.length; k += 2) {
        var group = fields[k];
        if (!group) continue;
        var points = firstNumber([fields[k + 1]], 0);
        if (!points) continue;
        skills.push({ name: group, pt: points });
      }
      out.push({ name: name, slots: slots, skills: skills });
    });
    return out;
  }

  var charmApi = {
    normalize: normalizeCharm,
    label: charmLabel,
    signature: charmSignature,
    store: getStore,
    kindNames: localKindNames,

    list: function () {
      var store = getStore();
      if (store) {
        var rows = callStore(['getAll', 'getCharms'], []);
        if (rows === undefined || rows === null) {
          var prop = store.items || store.all || store.charms;
          if (Array.isArray(prop)) rows = prop;
        }
        if (rows !== undefined && rows !== null) {
          return kit.toArray(rows).map(normalizeCharm).filter(Boolean);
        }
      }
      return loadLocalCharms().map(normalizeCharm).filter(Boolean);
    },

    getById: function (id) {
      if (id === null || id === undefined) return null;
      var list = charmApi.list();
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) return list[i];
      }
      return null;
    },

    count: function () {
      return charmApi.list().length;
    },

    add: function (charm) {
      var payload = toStorePayload(charm, false);
      if (!payload) return null;

      if (getStore()) {
        delete payload.id;
        var created = callStore(['addCharm', 'add', 'upsert', 'save'], [payload]);
        if (created) {
          var normalized = normalizeCharm(created);
          if (normalized) return normalized;
        }
        var all = charmApi.list();
        return all.length ? all[all.length - 1] : null;
      }

      var list = loadLocalCharms();
      var record = localRecord(payload);
      if (!record) return null;
      record.id = nextCharmId();
      list.push(record);
      saveLocalCharms();
      return normalizeCharm(record);
    },

    addMany: function (charms) {
      var payloads = kit.toArray(charms).map(function (charm) {
        return toStorePayload(charm, false);
      }).filter(Boolean);
      if (!payloads.length) return 0;

      var store = getStore();
      if (store) {
        if (typeof store.addCharms === 'function') {
          callStore(['addCharms'], [payloads]);
        } else {
          payloads.forEach(function (payload) { charmApi.add(payload); });
        }
        return payloads.length;
      }
      payloads.forEach(function (payload) { charmApi.add(payload); });
      return payloads.length;
    },

    update: function (id, charm) {
      if (id === null || id === undefined) return null;
      var existing = charmApi.getById(id);
      var payload = toStorePayload(charm, true);
      if (!payload) return null;
      payload.id = String(id);
      if (payload.kind === undefined) {
        payload.kind = existing && existing.kind != null ? existing.kind : 0;
      }
      if (payload.rarity === undefined && existing && existing.rarity != null) {
        payload.rarity = existing.rarity;
      }
      if (!payload.name && existing) payload.name = existing.type;

      if (getStore()) {
        var updated = callStore(['updateCharm'], [String(id), payload]);
        if (updated) {
          var normalized = normalizeCharm(updated);
          if (normalized) return normalized;
        }
        return charmApi.getById(id);
      }

      var list = loadLocalCharms();
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) !== String(id)) continue;
        var record = localRecord(payload);
        if (!record) return null;
        record.id = String(id);
        list[i] = record;
        saveLocalCharms();
        return normalizeCharm(record);
      }
      return null;
    },

    remove: function (id) {
      if (id === null || id === undefined) return;
      if (getStore()) {
        callStore(['removeCharm', 'remove', 'delete', 'removeById'], [String(id)]);
        return;
      }
      localCharms = loadLocalCharms().filter(function (item) {
        return String(item.id) !== String(id);
      });
      saveLocalCharms();
    },

    clear: function () {
      if (getStore()) {
        callStore(['clearAll', 'clear', 'removeAll'], []);
        return;
      }
      localCharms = [];
      saveLocalCharms();
    },

    resetPresets: function () {
      var result = callStore(['resetToPresets'], []);
      if (result !== undefined) return charmApi.list();
      localCharms = null;
      return charmApi.list();
    },

    parseText: function (text) {
      return parseLocalCharmText(text);
    },

    importText: function (text, mode) {
      var normalized = normalizeImportText(text);
      if (getStore() && typeof getStore().importText === 'function') {
        var result = callStore(['importText'], [normalized, mode || 'merge']);
        if (result) return result;
      }
      return charmApi.importCharms(parseLocalCharmText(normalized), mode);
    },

    importCharms: function (items, mode) {
      var list = kit.toArray(items);
      var summary = {
        mode: mode === 'replace' ? 'replace' : 'merge',
        format: 'text',
        added: 0,
        skipped: 0,
        total: charmApi.list().length,
        error: ''
      };
      if (!list.length) return summary;

      if (summary.mode === 'replace') {
        charmApi.clear();
        summary.total = 0;
      }

      /* 既存の登録数をシグネチャ別に数え、同じスロットの再取込では増分 0 にする
         （実セーブ内の同性能お守りは 1 回目の取込では保持する） */
      var counts = {};
      charmApi.list().forEach(function (charm) {
        var sig = charmSignature(charm);
        counts[sig] = (counts[sig] || 0) + 1;
      });

      list.forEach(function (item) {
        var payload = toStorePayload(item, false);
        if (!payload) return;
        var sig = charmSignature(payload);
        if (summary.mode !== 'replace' && counts[sig] > 0) {
          counts[sig] -= 1;
          summary.skipped += 1;
          return;
        }
        if (charmApi.add(payload)) summary.added += 1;
      });

      summary.total = charmApi.list().length;
      return summary;
    },

    /* セーブスロット取込（charm-store の importFromSaveSlot へ委譲） */
    importFromSaveSlot: function (charms, mode) {
      var store = getStore();
      if (store && typeof store.importFromSaveSlot === 'function') {
        var result = callStore(['importFromSaveSlot'], [charms, mode || 'merge']);
        if (result) return result;
      }
      return charmApi.importCharms(charms, mode);
    },

    exportText: function (format) {
      var fmt = String(format || 'text').toLowerCase();
      if ((fmt === 'json' || fmt === 'csv') && getStore() &&
        typeof getStore().exportText === 'function') {
        var structured = callStore(['exportText'], [fmt]);
        if (typeof structured === 'string') return structured;
      }
      return charmApi.list().map(function (charm) {
        var fields = [charm.type || '護石'];
        (charm.skills || []).forEach(function (skill) {
          var points = Number(skill.points != null ? skill.points : skill.pt) || 0;
          if (!points) return;
          fields.push(skill.name || skill.group, String(points));
        });
        /* 護石種類も含めて出力する（charm-store の取込は種類名つきも解釈できる） */
        fields.push(String(charm.slots || 0));
        return fields.join(',');
      }).join('\n');
    },

    /* 旧 localStorage のお守りをストアへ一度だけ移行する */
    bootstrap: function () {
      var store = getStore();
      if (!store || legacyMigrated) return 0;
      legacyMigrated = true;

      var legacy = readLegacyCharms();
      if (!legacy.length) return 0;

      var seen = {};
      charmApi.list().forEach(function (charm) { seen[charmSignature(charm)] = true; });

      var added = 0;
      legacy.forEach(function (charm) {
        var sig = charmSignature(charm);
        if (seen[sig]) return;
        seen[sig] = true;
        if (charmApi.add(charm)) added += 1;
      });
      clearLegacyCharms();
      if (added && MHXX.bus) MHXX.bus.emit('charms');
      return added;
    }
  };

  MHXX.charmApi = charmApi;

  MHXX.charmApi = charmApi;

  /* charm-store 側の変更（他 UI / セーブ取込）も即時反映する */
  if (MHXX.charmStore && typeof MHXX.charmStore.subscribe === 'function') {
    try {
      MHXX.charmStore.subscribe(function () { bus.emit('charms'); });
    } catch (err) {
      console.warn('[MHXX] charmStore.subscribe failed', err);
    }
  }

  /* ======================================================================
     3. セーブデータパーサー API
     ====================================================================== */

  MHXX.saveApi = {
    parse: function (buffer) {
      var parser = MHXX.saveParser;
      if (!parser) {
        throw new Error('save-parser.js が読み込まれていません');
      }
      var fn = parser.parseSystemFile || parser.parseSystem || parser.parse;
      if (typeof fn !== 'function') {
        throw new Error('parseSystemFile が見つかりません');
      }
      return fn.call(parser, buffer);
    }
  };

  /* ======================================================================
     4. 検索エンジンアダプタ
     ====================================================================== */

  var RES_ALIASES = {
    fire: ['fire', '火'], water: ['water', '水'], thunder: ['thunder', '雷', 'thunderRes'],
    ice: ['ice', '氷'], dragon: ['dragon', '龍', 'dragonRes']
  };

  var PART_ALIASES = {
    weapon: ['weapon', 'weaponPart', '武器'],
    head: ['head', 'headPart', '頭'],
    body: ['body', 'chest', 'bodyPart', '胴', 'torso'],
    arm: ['arm', 'arms', 'armPart', '腕'],
    waist: ['waist', 'waistPart', '腰'],
    leg: ['leg', 'legs', 'legPart', '脚'],
    charm: ['charm', 'omamori', '護石', 'お守り', 'amulet']
  };

  function normalizeSlots(value) {
    if (value === null || value === undefined) return [];
    if (typeof value === 'number') {
      var count = Math.floor(value);
      if (!isFinite(count) || count <= 0) return [];
      if (count > 3) count = 3;
      var arr = [];
      for (var i = 0; i < count; i++) arr.push(1);
      return arr;
    }
    if (typeof value === 'string') {
      var digits = value.replace(/[^0-9]/g, '');
      if (!digits) return [];
      return normalizeSlots(Number(digits));
    }
    if (Array.isArray(value)) {
      var totalHoles = 0;
      value.forEach(function (item) {
        var sz = (item && typeof item === 'object')
          ? (firstNumber([item.size, item.level, item.slot, item.slots], 1) || 1)
          : (Number(item) || 0);
        if (sz > 0) totalHoles += sz;
      });
      return normalizeSlots(totalHoles);
    }
    if (typeof value === 'object') {
      if (Array.isArray(value.slotSizes)) return normalizeSlots(value.slotSizes);
      if (Array.isArray(value.sizes)) return normalizeSlots(value.sizes);
      if (value.count != null || value.length != null) {
        return normalizeSlots(firstNumber([value.count, value.length], 0));
      }
      var keys = Object.keys(value);
      if (keys.length) return normalizeSlots(keys.length);
    }
    return [];
  }

  function decoSkillMap(raw) {
    var value = raw.skills || raw.systemSkills || raw.points || raw.effect || raw.effects ||
      raw.skillPoints || null;
    return normalizePoints(value);
  }

  function normalizeDecos(value) {
    if (!value) return [];
    return kit.toArray(value).map(function (raw) {
      if (!raw) return null;

      if (typeof raw === 'string') {
        var match = raw.match(/【([1-3])】/);
        var level = match ? Number(match[1]) : 1;
        return { name: raw, level: level, slotCost: level, points: 1, group: null, skills: {} };
      }
      if (typeof raw !== 'object') return null;

      var skills = decoSkillMap(raw);
      var slotCost = firstNumber(
        [raw.slotCost, raw.cost, raw.level, raw.size, raw.slot, raw.slots], 1
      ) || 1;
      var group = raw.group || raw.skill || raw.system || null;
      var points = firstNumber([raw.points, raw.value, raw.pt], 0);
      if (!points && group && skills[group] != null) points = skills[group];
      if (!points) {
        Object.keys(skills).forEach(function (name) {
          if (Math.abs(skills[name]) > Math.abs(points)) {
            points = skills[name];
            if (!group) group = name;
          }
        });
      }

      return {
        name: String(raw.name || raw.decoName || raw.title || raw.jewel || '装飾品'),
        level: Math.max(1, Math.min(3, slotCost)),
        slotCost: slotCost,
        points: points,
        group: group,
        skills: skills
      };
    }).filter(Boolean);
  }

  function normalizePoints(value) {
    var out = {};
    if (!value) return out;
    if (Array.isArray(value)) {
      value.forEach(function (entry) {
        if (!entry) return;
        if (Array.isArray(entry)) {
          if (entry[0]) out[entry[0]] = (out[entry[0]] || 0) + (Number(entry[1]) || 0);
          return;
        }
        if (typeof entry === 'string') {
          var parsed = parsePointToken(entry);
          if (parsed) out[parsed.group] = (out[parsed.group] || 0) + parsed.points;
          return;
        }
        var group = entry.group || entry.system || entry.name || entry.skill;
        if (!group) return;
        out[group] = (out[group] || 0) + firstNumber([entry.points, entry.value, entry.pt], 0);
      });
      return out;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        var num = Number(value[key]);
        if (!isNaN(num)) out[key] = (out[key] || 0) + num;
      });
    }
    return out;
  }

  function normalizeAlternatives(value) {
    var out = [];
    kit.toArray(value).forEach(function (entry) {
      if (!entry) return;
      if (typeof entry === 'string') {
        out.push({ name: entry, defense: 0, slots: [], skills: {} });
        return;
      }
      if (typeof entry !== 'object') return;
      out.push({
        name: String(entry.name || entry.equipName || entry.title || '-'),
        defense: firstNumber([entry.defense, entry.def], 0),
        slots: normalizeSlots(entry.slotSizes || entry.slots || entry.slot),
        skills: normalizePoints(entry.skills || entry.points || entry.skillPoints)
      });
    });
    return out;
  }

  function normalizePart(key, raw, decosByPart) {
    if (raw === null || raw === undefined) return null;

    if (typeof raw === 'string') {
      return {
        key: key,
        name: raw,
        slots: [],
        freeSlots: 0,
        decos: [],
        points: {},
        basePoints: {},
        decoPoints: {},
        decoSkills: {},
        notes: {},
        isTorsoUp: false,
        alternatives: [],
        defense: 0,
        resist: normalizeResist(null),
        bonusMultiplier: 1
      };
    }
    if (typeof raw !== 'object') return null;

    if (!raw.decos && decosByPart && decosByPart[key]) {
      raw = Object.assign({}, raw, { decos: decosByPart[key] });
    }

    var slots = normalizeSlots(
      raw.slots != null ? raw.slots : (raw.slotSizes || raw.slotArray || raw.slot || raw.slotCount || raw.decoSlots)
    );
    var decos = normalizeDecos(
      raw.decos || raw.decorations || raw.jewels || raw.gems || raw.slotItems || raw.decoList
    );
    var points = normalizePoints(
      raw.skills || raw.points || raw.skillPoints || raw.pts || raw.baseSkills
    );
    var decoSkills = normalizePoints(
      raw.decoSkills || raw.decoPoints || raw.decoSkillPoints || raw.jewelSkills
    );
    if (!Object.keys(decoSkills).length && decos.length) {
      decos.forEach(function (deco) {
        Object.keys(deco.skills || {}).forEach(function (group) {
          decoSkills[group] = (decoSkills[group] || 0) + (Number(deco.skills[group]) || 0);
        });
      });
    }

    var name = raw.name || raw.equipName || raw.armorName || raw.title || raw.itemName ||
      raw.charmName || raw.label || '-';
    var isTorsoUp = !!(raw.isTorsoUp || raw.torsoUp || raw.dou || raw.torsoUpBody ||
      (Number(raw.douMultiplier) > 1) ||
      (Number(points['胴系統倍加']) > 0) || (Number(points['胴系統倍化']) > 0));

    return {
      key: key,
      name: String(name),
      slots: slots,
      freeSlots: firstNumber([raw.freeSlots, raw.emptySlots], 0),
      decos: decos,
      points: points,
      basePoints: normalizePoints(points),
      decoPoints: normalizePoints(decoSkills),
      decoSkills: decoSkills,
      notes: {},
      isTorsoUp: isTorsoUp,
      alternatives: normalizeAlternatives(raw.alternatives || raw.altParts || raw.candidates || raw.others),
      bonusMultiplier: firstNumber([raw.bonusMultiplier, raw.multiplier, raw.mult], 1) || 1,
      defense: firstNumber([raw.defense, raw.def], 0),
      resist: normalizeResist(raw.resistances || raw.resist || raw.res),
      partCode: raw.part
    };
  }

  var PART_SOURCE_KEYS = [
    'equipments', 'parts', 'equipment', 'equip', 'set', 'armor', 'armors', 'result', 'build'
  ];

  /* 検索結果の部位データを正規化する。
     ・エンジンは result.equipments（{weapon, head, body, arm, waist, legs, charm}）で返す
     ・部位ごとに name / slots / freeSlots / decos（装着済み装飾品）/
       skills（防具の素pt）/ decoSkills（装飾品pt）/ isTorsoUp /
       alternatives（同値防具の別候補）を欠落なく渡す */
  function normalizeParts(raw) {
    raw = raw || {};
    var source = null;
    for (var i = 0; i < PART_SOURCE_KEYS.length; i++) {
      var candidate = raw[PART_SOURCE_KEYS[i]];
      if (candidate && typeof candidate === 'object') {
        source = candidate;
        break;
      }
    }
    if (!source) source = raw;

    /* 配列で返すエンジンにも対応（part / key / slot のいずれかで部位を判定） */
    if (Array.isArray(source)) {
      var ordered = ['head', 'body', 'arm', 'waist', 'leg'];
      var byKey = {};
      source.forEach(function (entry) {
        if (!entry) return;
        var partKey = entry.key || entry.partKey || entry.slot || entry.name;
        if (typeof partKey === 'string' && PART_ALIASES[partKey]) {
          byKey[partKey] = entry;
        } else if (typeof entry.part === 'number' && ordered[entry.part]) {
          byKey[ordered[entry.part]] = entry;
        }
      });
      source = byKey;
    }

    var decosByPart = (raw.decos && !Array.isArray(raw.decos)) ? raw.decos : null;

    var out = {};
    Object.keys(PART_ALIASES).forEach(function (key) {
      var value = null;
      PART_ALIASES[key].some(function (alias) {
        if (source[alias] !== null && source[alias] !== undefined) {
          value = source[alias];
          return true;
        }
        return false;
      });
      out[key] = normalizePart(key, value, decosByPart);
    });
    return out;
  }

  function sumPartPoints(parts) {
    var totals = {};
    Object.keys(parts || {}).forEach(function (key) {
      var part = parts[key];
      if (!part) return;
      var multiplier = Number(part.bonusMultiplier) || 1;
      Object.keys(part.points || {}).forEach(function (group) {
        totals[group] = (totals[group] || 0) + (Number(part.points[group]) || 0) * multiplier;
      });
      Object.keys(part.decoSkills || {}).forEach(function (group) {
        totals[group] = (totals[group] || 0) + (Number(part.decoSkills[group]) || 0);
      });
    });
    return totals;
  }

  function normalizeResist(raw) {
    var out = {};
    if (!raw) {
      Object.keys(RES_ALIASES).forEach(function (key) { out[key] = 0; });
      return out;
    }
    if (Array.isArray(raw)) {
      ['fire', 'water', 'thunder', 'ice', 'dragon'].forEach(function (key, index) {
        out[key] = Number(raw[index]) || 0;
      });
      return out;
    }
    Object.keys(RES_ALIASES).forEach(function (key) {
      var aliases = RES_ALIASES[key];
      var value;
      aliases.some(function (alias) {
        if (raw[alias] !== undefined) { value = raw[alias]; return true; }
        return false;
      });
      out[key] = Number(value) || 0;
    });
    return out;
  }

  function computeActivated(totals) {
    var out = [];
    var byGroup = (MHXX.skillIndex && MHXX.skillIndex.byGroup) || {};
    Object.keys(totals || {}).forEach(function (group) {
      var list = byGroup[group] || [];
      var best = null;
      list.forEach(function (skill) {
        if (totals[group] >= skill.threshold) best = skill;
      });
      if (best) {
        out.push({ name: best.name, group: group, points: totals[group], threshold: best.threshold });
      }
    });
    return out;
  }

  function normalizeActivated(raw, totals) {
    var source = raw.activated || raw.activatedSkills || raw.activeSkills || raw.skills;
    var out = [];

    if (Array.isArray(source)) {
      source.forEach(function (entry) {
        if (!entry) return;
        if (typeof entry === 'string') {
          var skill = MHXX.skillIndex.byName[entry];
          out.push({
            name: entry,
            group: skill ? skill.group : entry,
            points: skill ? (totals[skill.group] || 0) : 0,
            threshold: skill ? skill.threshold : 0
          });
          return;
        }
        if (typeof entry === 'object') {
          var name = entry.name || entry.skill || entry.title;
          if (!name) return;
          var found = MHXX.skillIndex.byName[name];
          out.push({
            name: name,
            group: entry.group || entry.system || (found ? found.group : name),
            points: firstNumber([entry.points, entry.value, entry.totalPt], found ? (totals[found.group] || 0) : 0),
            threshold: firstNumber([entry.threshold, entry.need], found ? found.threshold : 0)
          });
        }
      });
    }

    if (!out.length) out = computeActivated(totals);
    return out;
  }

  function normalizeSuggestion(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      var skill = MHXX.skillIndex.byName[raw];
      return {
        name: raw,
        group: skill ? skill.group : raw,
        reason: '',
        threshold: skill ? skill.threshold : 10
      };
    }
    var name = raw.name || raw.skillName || raw.skill || raw.title;
    if (!name) return null;
    var found = MHXX.skillIndex.byName[name];
    return {
      name: name,
      group: raw.group || raw.system || raw.systemName || (found ? found.group : name),
      reason: raw.reason || raw.label || '',
      threshold: firstNumber([raw.threshold, raw.need, raw.neededPt], found ? found.threshold : 10)
    };
  }

  var MATRIX_PART_KEYS = {
    weapon: 'weapon', head: 'head', body: 'body', arm: 'arm',
    waist: 'waist', legs: 'leg', leg: 'leg', charm: 'charm',
    '武器': 'weapon', '頭': 'head', '胴': 'body',
    '腕': 'arm', '腰': 'waist', '脚': 'leg', '護石': 'charm'
  };

  /* 検索エンジンが返す skillMatrix（部位別内訳）をマトリクス表示用に反映する。
       parts[part].points     … その部位の合計（素pt + 装飾品pt）
       parts[part].basePoints … 防具の素pt（胴系統倍加 / ネセト護石倍加を含む）
       parts[part].decoPoints … 装飾品で加算されたpt
       parts[part].notes      … セル注記（note があれば）
     ネセト一式のスキル加点(secretBonus)は部位へ割り付けず totals 側だけに反映する。 */
  function applySkillMatrix(raw, parts, totals) {
    var info = { applied: false, secretBonus: {} };
    var matrix = raw.skillMatrix || raw.matrix || raw.partMatrix;
    if (!matrix) return info;
    var rows = Array.isArray(matrix) ? matrix : kit.toArray(matrix);
    if (!rows.length) return info;

    rows.forEach(function (row) {
      if (!row) return;
      var system = row.system || row.group || row.skillSystem || row.name;
      if (!system) return;
      system = String(system);

      var totalPt = firstNumber([row.totalPt, row.total, row.totalPoints], null);
      var bonusPt = firstNumber([row.secretBonus, row.nesetBonus, row.bonusPt, row.bonus], null);
      if (bonusPt === null && row.secretBonus && typeof row.secretBonus === 'object') {
        bonusPt = firstNumber([row.secretBonus[system], row.secretBonus.value], null);
      }
      if (bonusPt) info.secretBonus[system] = bonusPt;

      var blocks = row.byPart || row.parts || row.partPoints || row.cells || null;
      var partSum = 0;
      var seen = false;

      function applyCell(sourceKey, cell) {
        if (!cell) return;
        var partKey = MATRIX_PART_KEYS[sourceKey];
        if (!partKey && PART_ALIASES[sourceKey]) partKey = sourceKey;
        var part = partKey ? parts[partKey] : null;
        if (!part) return;

        var base;
        var deco;
        var total;
        var note = '';
        if (typeof cell === 'number') {
          total = cell;
          base = cell;
          deco = 0;
        } else {
          base = firstNumber([cell.base, cell.basePt, cell.armor, cell.basePoints], 0);
          deco = firstNumber([cell.deco, cell.decoPt, cell.jewel, cell.decoPoints], 0);
          total = firstNumber([cell.total, cell.totalPt], base + deco);
          note = cell.note || cell.comment || cell.memo || '';
        }
        if (!isFinite(total)) total = 0;
        if (!part.points) part.points = {};
        if (!part.basePoints) part.basePoints = {};
        if (!part.decoPoints) part.decoPoints = {};
        if (!part.notes) part.notes = {};
        part.points[system] = total;
        part.basePoints[system] = base;
        part.decoPoints[system] = deco;
        if (note) part.notes[system] = note;
        partSum += total;
        seen = true;
      }

      if (Array.isArray(blocks)) {
        blocks.forEach(function (cell) {
          if (!cell || typeof cell !== 'object') return;
          var key = cell.part || cell.key || cell.partKey || cell.slotName;
          if (key != null) applyCell(String(key), cell);
        });
      } else if (blocks && typeof blocks === 'object') {
        Object.keys(blocks).forEach(function (key) {
          applyCell(key, blocks[key]);
        });
      }

      if (!seen) return;
      info.applied = true;

      var value;
      if (totalPt !== null && isFinite(totalPt)) value = totalPt;
      else value = partSum + (info.secretBonus[system] || 0);
      if (!isFinite(value)) return;

      if (!totals || typeof totals !== 'object') return;
      totals[system] = value;
    });

    return info;
  }

  function countSlots(parts) {
    var total = 0;
    Object.keys(parts || {}).forEach(function (key) {
      var part = parts[key];
      if (part) total += (part.slots || []).length;
    });
    return total;
  }

  function countDecos(parts) {
    var total = 0;
    Object.keys(parts || {}).forEach(function (key) {
      var part = parts[key];
      if (part) total += (part.decos || []).length;
    });
    return total;
  }

  /* 空きスロット（部位別）。エンジンの freeSlotDetail を優先し、
     無ければ「スロ数 - 装着数」で数える。 */
  function normalizeFreeSlotDetail(raw, parts) {
    var source = raw.freeSlotDetail || raw.freeSlotsByPart || raw.slotDetail || raw.slotsByPart || null;
    var detail = {};
    Object.keys(PART_ALIASES).forEach(function (key) {
      var part = parts[key] || null;
      var free = null;
      if (source) {
        if (source[key] != null) free = firstNumber([source[key]], null);
        if (free === null) {
          PART_ALIASES[key].some(function (alias) {
            if (source[alias] != null) {
              free = firstNumber([source[alias]], null);
              return true;
            }
            return false;
          });
        }
      }
      if (free === null) {
        free = part ? Math.max(0, (part.slots || []).length - (part.decos || []).length) : 0;
      }
      if (part) part.freeSlots = free;
      detail[key] = free;
    });
    return detail;
  }

  function normalizeResult(raw, index) {
    if (!raw) return null;
    var parts = normalizeParts(raw);

    var totalsSource = (!Array.isArray(raw.skills) && raw.skills && typeof raw.skills === 'object')
      ? raw.skills
      : (raw.totals || raw.totalPoints || raw.skillTotals || raw.pointTotals);
    var totals = normalizePoints(totalsSource);

    /* 部位別マトリクスを反映（skillMatrix が正なら部位pt / 合計ptを上書き） */
    var matrixInfo = applySkillMatrix(raw, parts, totals);
    if (!Object.keys(totals).length) totals = sumPartPoints(parts);

    var freeDetail = normalizeFreeSlotDetail(raw, parts);

    var emptySlots = 0;
    Object.keys(parts).forEach(function (key) {
      var part = parts[key];
      if (part) emptySlots += Number(part.freeSlots) || 0;
    });

    var torsoUp = firstNumber([raw.torsoUpCount, raw.douMultiplier, raw.douCount, raw.bodyMultiplier], raw.dou ? 1 : 0);
    var isNeset = !!(raw.isNeset || raw.nasetsu || raw.naSetsu || raw.isNasetsu);

    /* 胴系統倍加: 胴部位のセルに倍率を表示 */
    if (!isNeset && torsoUp > 0 && parts.body) {
      parts.body.bonusMultiplier = 1 + torsoUp;
      parts.body.isTorsoUpBody = true;
    }

    return {
      id: raw.id != null ? String(raw.id) : 'result-' + (index + 1),
      rank: index + 1,
      defense: firstNumber([raw.defense, raw.def, raw.totalDefense, raw.defence], 0),
      resist: normalizeResist(raw.resist || raw.resistance || raw.resistances || raw.res),
      parts: parts,
      totals: totals,
      activated: normalizeActivated(raw, totals),
      extraSuggestions: dedupeSuggestions(raw.extraSuggestions || raw.suggestions || raw.extras || []),
      nasetsu: isNeset,
      secretBonus: matrixInfo.secretBonus || {},
      douMultiplier: isNeset ? 0 : torsoUp,
      emptySlots: firstNumber([raw.freeSlots, raw.emptySlots], emptySlots),
      freeSlotDetail: freeDetail,
      totalSlots: firstNumber([raw.totalSlots], countSlots(parts)),
      usedSlots: firstNumber([raw.usedSlots], countDecos(parts)),
      weaponSlots: firstNumber([raw.weaponSlots], 0),
      missingSkills: kit.toArray(raw.missingSkills).map(String)
    };
  }

  function suggestionKey(suggestion) {
    return String((suggestion && (suggestion.group || suggestion.name)) || '');
  }

  function dedupeSuggestions(list) {
    var out = [];
    var seen = {};
    kit.toArray(list).forEach(function (raw) {
      var suggestion = normalizeSuggestion(raw);
      if (!suggestion || !suggestion.name) return;
      var key = suggestionKey(suggestion);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(suggestion);
    });
    return out;
  }

  function normalizeSearchResult(raw, state) {
    var results = [];
    var extras = [];
    var meta = {};

    if (Array.isArray(raw)) {
      results = raw;
    } else if (raw && typeof raw === 'object') {
      results = raw.results || raw.list || raw.sets || raw.matches || raw.data || [];
      extras = raw.extraSuggestions || raw.suggestions || raw.extras || [];
      meta = raw;
      if (!Array.isArray(results) && results && typeof results === 'object') {
        results = kit.toArray(results);
      }
      if (!results.length && (raw.parts || raw.equipments || raw.equipment || raw.defense != null)) {
        results = [raw];
      }
    }

    var normalized = results.map(function (item, index) {
      return normalizeResult(item, index);
    }).filter(Boolean);

    /* 右ペイン上部「さらに追加できるスキル」:
       結果直下の extraSuggestions を優先し、無ければ各結果の extraSuggestions を統合する */
    var suggestions = dedupeSuggestions(extras);
    if (!suggestions.length) {
      var pool = [];
      normalized.forEach(function (result) {
        pool = pool.concat(result.extraSuggestions || []);
      });
      suggestions = dedupeSuggestions(pool);
    }

    /* すでに条件へ入っている系統は「追加できます」から外す */
    var selectedGroups = {};
    ((state && state.skills) || []).forEach(function (skill) {
      if (skill && skill.group) selectedGroups[skill.group] = true;
    });
    if (Object.keys(selectedGroups).length) {
      suggestions = suggestions.filter(function (suggestion) {
        return !selectedGroups[suggestion.group || suggestion.name];
      });
    }

    return {
      results: normalized,
      extraSuggestions: suggestions,
      missingSkills: kit.toArray(meta.missingSkills).map(String),
      partial: !!meta.partial,
      state: state
    };
  }

  /* 個別固定モード (charmMode='single') の指すお守りを返す。
     一覧から削除済み / charmId が空のときは null。
     「固定していたお守りが無いのに single で検索され、結果の護石が『なし』だけに
     なる」事故を防ぐため、buildPayload / 'charms' 通知 / 起動時で共有する。 */
  function findSelectedCharm(charms, state) {
    if (!state || state.charmMode !== 'single') return null;
    if (state.charmId === null || state.charmId === undefined || state.charmId === '') return null;
    var list = charms || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(state.charmId)) return list[i];
    }
    return null;
  }

  /* 指定 id のお守りが登録されているか。
     一覧の複製を作らずに済むようストアの getById を優先する
     （大量取込のたびに 'charms' 通知が走るため、ここは軽く保つ）。 */
  function existsCharmId(id) {
    if (id === null || id === undefined || id === '') return false;
    var key = String(id);
    var store = getStore();
    if (store && typeof store.getById === 'function') {
      try {
        return !!store.getById(key);
      } catch (err) {
        /* ストア側で失敗したら一覧で確認する */
      }
    }
    var list = charmApi.list();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return true;
    }
    return false;
  }

  function buildPayload(state) {
    var charms = charmApi.list();
    /* 固定対象が解決できないときは全検索として扱う（護石候補ゼロにしない）。
       #charmSelect の表示と state がズレていても、エンジンには必ず
       実在する護石の一覧が渡るようにする。 */
    var charm = findSelectedCharm(charms, state);

    var selected = state.skills || [];
    return {
      type: state.type,
      equipType: state.type === 'gunner' ? 2 : 1,
      gender: state.gender === 'female' ? 'female' : 'male',
      weaponSlots: Number(state.weaponSlots) || 0,
      weaponSlotSizes: state.weaponSlotSizes || null,
      charmMode: charm ? 'single' : 'all',
      charmId: charm ? state.charmId : null,
      charm: charm,
      charms: charms,
      skills: selected.slice(),
      requiredSkills: selected.map(function (skill) { return skill.name; }).filter(Boolean),
      sort: state.sort,
      limit: 24,
      maxResults: 24,
      state: state
    };
  }

  /* --- 検索エンジンとのブリッジ ---------------------------------------
     js/data/sim-data.js はコンパクト配列形式（armorFields / decoFields）で
     保持されているため、エンジンが解釈できるオブジェクト形式へ変換して渡す。
     （データ側が将来オブジェクト形式になった場合はそのまま渡す）
     ------------------------------------------------------------------ */
  var engineDataRef = null;

  function toEngineCharm(charm) {
    var skills = {};
    (charm.skills || []).forEach(function (skill) {
      var group = skill.group || skill.name || skill.system;
      var points = firstNumber([skill.points, skill.pt, skill.value], 0);
      if (group) skills[group] = (skills[group] || 0) + points;
    });
    return {
      name: charm.type || charm.name || '護石',
      slots: Number(charm.slots) || 0,
      skills: skills
    };
  }

  /* sim-data.js の armorFields = [name, sex, type, part, reqHr, reqVillage,
     isEvent, slots, def, res, skills] をエンジンのオブジェクト形式へ変換する */
  function convertArmorArray(a) {
    return {
      name: a[0],
      gender: a[1],
      type: a[2],
      part: a[3],
      hall: a[4],
      village: a[5],
      special: !!a[6],
      slots: a[7],
      slotSizes: null,
      defense: a[8],
      resistances: a[9],
      skills: a[10]
    };
  }

  function convertDecoArray(d) {
    return { name: d[0], size: d[1], skills: d[4] || {} };
  }

  function buildEngineData(data) {
    if (!data || !Array.isArray(data.armors) || !data.armors.length) return data;
    var compact = data.armors.some(function (armor) {
      return Array.isArray(armor) && armor.length === 11;
    });
    if (!compact) return data;

    return {
      skills: data.skills || data.skillList,
      armors: data.armors.map(function (armor) {
        return Array.isArray(armor) ? convertArmorArray(armor) : armor;
      }),
      decos: (data.decos || []).map(function (deco) {
        return Array.isArray(deco) ? convertDecoArray(deco) : deco;
      })
    };
  }

  function ensureEngineData(engine) {
    if (!engine || typeof engine.setData !== 'function') return;
    if (engineDataRef === MHXX.data) return;
    engineDataRef = MHXX.data;
    try {
      engine.setData(buildEngineData(MHXX.data));
    } catch (err) {
      console.error('[MHXX] searchEngine.setData failed', err);
    }
  }

  /* 検索エンジンへ渡す options（js/core/search-engine.js の契約に合わせる）
     equipType / gender / weaponSlots / requiredSkills / charmMode /
     selectedCharm / charms / sortBy / maxResults をすべて明示する。 */
  function buildEngineOptions(payload) {
    var current = payload.state || null;
    var requiredSkills = (payload.skills || []).map(function (skill) {
      return skill && (skill.name || skill.group);
    }).filter(Boolean);

    var options = {
      equipType: payload.equipType || (payload.type === 'gunner' ? 2 : 1),
      gender: payload.gender === 'female' ? 2 : payload.gender === 'both' ? 3 : 1,
      weaponSlots: Number(payload.weaponSlots) || 0,
      requiredSkills: requiredSkills,
      /* single を名乗るなら selectedCharm が必ず要る（無いと護石候補が
         「なし」だけになり、全検索に切り替えたのに護石が使われないように見える） */
      charmMode: (payload.charmMode === 'single' && payload.charm) ? 'single' : 'all',
      charms: (payload.charms || []).map(toEngineCharm),
      sortBy: payload.sort === 'slots' ? 'slots' : payload.sort === 'resist' ? 'resSum' : 'def',
      maxResults: Number(payload.maxResults || payload.limit) || 24,
      seed: true,
      extraSuggestions: true,
      includeAllSystems: true,
      candidateOrder: 'score'
    };
    if (payload.charm) options.selectedCharm = toEngineCharm(payload.charm);
    if (current && Array.isArray(current.weaponSlotSizes) && current.weaponSlotSizes.length) {
      options.weaponSlotSizes = current.weaponSlotSizes.slice();
    }
    if (current && current.useWorker === false) options.useWorker = false;
    return options;
  }

  /* --- 非同期検索（UI を固まらせない / 時間切れは途中結果を採用） --- */
  var engineRunToken = 0;
  var ENGINE_TIME_BUDGET = 4500;

  function runEngineAsync(engine, options) {
    var token = ++engineRunToken;
    if (typeof engine.cancel === 'function') {
      try { engine.cancel(); } catch (err) { /* 実行中でなければ無視 */ }
    }

    var partial = [];
    var promise;
    try {
      /* タイムスライス方式で実行（Worker 起動・データ転送のオーバーヘッドを避ける） */
      options.__noWorker = true;
      promise = engine.searchAsync(options, function (progress, results) {
        if (token !== engineRunToken) return;
        if (Array.isArray(results) && results.length) partial = results;
        bus.emit('search:progress', progress);
      });
    } catch (err) {
      return Promise.reject(err);
    }

    return new Promise(function (resolve) {
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) return;
        settled = true;
        try {
          if (promise && typeof promise.cancel === 'function') promise.cancel();
        } catch (err) { /* ignore */ }
        resolve({ results: partial.slice(0, 24), partial: true });
      }, ENGINE_TIME_BUDGET);

      promise.then(function (result) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        resolve(result);
      }, function (err) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        console.error('[MHXX] searchAsync failed', err);
        resolve({ results: partial.slice(0, 24), partial: true });
      });
    });
  }

  function engineSearch(state) {
    var engine = MHXX.searchEngine;
    var payload = buildPayload(state);

    if (engine) {
      try {
        ensureEngineData(engine);
        var options = buildEngineOptions(payload);

        if (typeof engine.searchAsync === 'function') {
          return runEngineAsync(engine, options);
        }
        if (typeof engine.searchSync === 'function') {
          var syncResult = engine.searchSync(options);
          if (syncResult) return syncResult;
        }

        var names = ['search', 'run', 'simulate', 'find', 'simulateAll'];
        for (var i = 0; i < names.length; i++) {
          var fn = engine[names[i]];
          if (typeof fn !== 'function') continue;
          var result = fn.call(engine, payload);
          if (result !== undefined && result !== null) return result;
        }
      } catch (err) {
        console.error('[MHXX] searchEngine failed', err);
        bus.emit('search:error', err);
        return { results: [], extraSuggestions: [], error: err };
      }
    }

    /* エンジン自体が無い場合のみデモエンジンで動作させる */
    if (!MHXX.demoEngine) return { results: [], extraSuggestions: [] };
    return MHXX.demoEngine.search(payload);
  }

  /* ======================================================================
     5. ストア（状態管理）
     ====================================================================== */

  var SEARCH_KEYS = ['type', 'gender', 'weaponSlots', 'charmMode', 'charmId', 'skills', 'sort'];

  var state = {
    type: 'blade',
    /* 性別は「男性 / 女性」の2択（既定: 男性）。男女専用防具が混在しないようにする */
    gender: 'male',
    weaponSlots: 3,
    weaponSlotSizes: null,
    charmMode: 'all',
    charmId: null,
    skills: [],
    category: 'recommended',
    keyword: '',
    sort: 'defense',
    resultIndex: 0,
    results: [],
    extraSuggestions: [],
    missingSkills: [],
    status: 'idle'
  };

  var searchToken = 0;
  var pendingSearch = false;
  var pendingSearchTimer = null;

  function scheduleSearch(immediate) {
    if (immediate) {
      runSearch();
      return;
    }
    if (pendingSearch) return;
    pendingSearch = true;
    pendingSearchTimer = global.setTimeout(function () {
      pendingSearch = false;
      pendingSearchTimer = null;
      runSearch();
    }, 140);
  }

  /* 予約済みのデバウンス検索を取り消す。
     refresh() で即時検索する直後に古い条件の検索が走り、結果を上書きするのを防ぐ。 */
  function cancelScheduledSearch() {
    if (!pendingSearch) return;
    pendingSearch = false;
    if (pendingSearchTimer) {
      global.clearTimeout(pendingSearchTimer);
      pendingSearchTimer = null;
    }
  }

  function runSearch() {
    cancelScheduledSearch();
    var token = ++searchToken;
    state.status = 'searching';
    bus.emit('search:start', state);

    var raw;
    try {
      raw = engineSearch(state);
    } catch (err) {
      console.error('[MHXX] search failed', err);
      raw = { results: [], extraSuggestions: [] };
    }

    Promise.resolve(raw).then(function (resolved) {
      if (token !== searchToken) return;
      var normalized;
      try {
        normalized = normalizeSearchResult(resolved, state);
      } catch (err) {
        console.error('[MHXX] result normalization failed', err);
        normalized = { results: [], extraSuggestions: [] };
      }

      state.results = normalized.results;
      state.extraSuggestions = normalized.extraSuggestions;
      state.missingSkills = normalized.missingSkills || [];
      state.partial = !!normalized.partial;
      state.resultIndex = kit.clamp(state.resultIndex || 0, 0, Math.max(0, state.results.length - 1));
      state.status = 'ready';

      bus.emit('results', state);
      bus.emit('state', state);
    }).catch(function (err) {
      console.error('[MHXX] search rejected', err);
      state.status = 'error';
      state.results = [];
      state.extraSuggestions = [];
      bus.emit('results', state);
      bus.emit('state', state);
    });
  }

  function patch(changes) {
    if (!changes) return;
    var needsSearch = false;

    Object.keys(changes).forEach(function (key) {
      if (SEARCH_KEYS.indexOf(key) !== -1) needsSearch = true;
      state[key] = changes[key];
    });

    if (changes.resultIndex !== undefined) {
      state.resultIndex = kit.clamp(Number(changes.resultIndex) || 0, 0, Math.max(0, state.results.length - 1));
      var current = state.results[state.resultIndex];
      if (current) state.extraSuggestions = current.extraSuggestions || [];
    }

    if (needsSearch) {
      state.resultIndex = 0;
      scheduleSearch();
    }

    bus.emit('state', state);
  }

  MHXX.store = {
    get: function () { return state; },
    patch: patch,
    refresh: function () { runSearch(); },
    subscribe: function (fn) { return bus.on('state', fn); }
  };

  /* タイプ変更時、対象外（剣士専用 / ガンナー専用）スキルを自動解除する */
  bus.on('ui:reconfigure', function (info) {
    if (!info || info.key !== 'type') return;
    var nextType = info.value;
    var before = state.skills || [];
    var filtered = before.filter(function (skill) {
      var def = MHXX.skillIndex && MHXX.skillIndex.byName[skill.name];
      if (!def) return true;
      return def.weapon === 'both' || def.weapon === nextType;
    });
    if (filtered.length !== before.length) {
      patch({ skills: filtered });
      kit.toast('タイプに合わせて対象外のスキルを解除しました');
    }
  });

  /* 検索エンジン側の例外はトーストで知らせる */
  bus.on('search:error', function (err) {
    console.error('[MHXX] search error', err);
    kit.toast('検索エンジンでエラーが発生しました。条件を変えて再試行してください', 'error');
  });

  /* お守り一覧が変わったときの再検索。
     一覧が変われば護石候補も変わるため、全検索モードでも必ず検索し直す
     （再検索しないと「全検索 - N個」と表示されたまま古い護石なしの結果が
     残り、お守りが使われていないように見える）。
     固定していたお守りが削除された場合は全検索モードへ戻す。 */
  bus.on('charms', function () {
    if (state.charmMode === 'single' && !existsCharmId(state.charmId)) {
      patch({ charmMode: 'all', charmId: null, resultIndex: 0 });
      return;
    }
    scheduleSearch();
  });

  /* ======================================================================
     6. 起動
     ====================================================================== */

  var UI_ORDER = [
    'toast', 'buttonGroup', 'skillSearch', 'skillChips',
    'charmPanel', 'charmModal', 'suggestChips', 'resultView'
  ];

  function initModules() {
    var done = {};
    UI_ORDER.forEach(function (name) {
      var module = MHXX.ui[name];
      if (!module || typeof module.init !== 'function') return;
      done[name] = true;
      try {
        module.init();
      } catch (err) {
        console.error('[MHXX] failed to initialize UI module: ' + name, err);
      }
    });

    Object.keys(MHXX.ui).forEach(function (name) {
      if (done[name]) return;
      var module = MHXX.ui[name];
      if (!module || typeof module.init !== 'function') return;
      try {
        module.init();
      } catch (err) {
        console.error('[MHXX] failed to initialize UI module: ' + name, err);
      }
    });
  }

  function boot() {
    ensureData();

    /* 旧 localStorage のお守りをストアへ一度だけ移行（取りこぼし防止） */
    try {
      charmApi.bootstrap();
    } catch (err) {
      console.warn('[MHXX] charm migration failed', err);
    }

    initModules();

    /* お守りが削除されていた場合は全検索モードへ戻す */
    var charms = charmApi.list();
    if (state.charmMode === 'single' && !findSelectedCharm(charms, state)) {
      state.charmMode = 'all';
      state.charmId = null;
    }

    bus.emit('state', state);
    runSearch();
  }

  MHXX.app = {
    state: state,
    patch: patch,
    search: runSearch,
    getState: function () { return state; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
