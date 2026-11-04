/* ==========================================================================
   MHXX セーブデータ 護石パーサー (js/core/save-parser.js)
   --------------------------------------------------------------------------
   Switch / 3DS 版『モンスターハンターダブルクロス』の system セーブを読み込み、
   セーブスロット 1〜3 の装備BOXに入っている護石（お守り）をすべて抽出する。

   依存: なし
   参照: window.MHXX.data.skillSystemById があればスキル系統名に優先して使う
   公開: window.MHXX.saveParser（互換のため MHXX.core.saveParser にも登録）

   ■ ファイル形式（mhnxeditor 検証済み）
     Switch JP        4,726,188 B = 36 B のコンテナヘッダ + 4,726,152 B 本体
     3DS JP           4,726,152 B = 本体のみ
     Switch MHGU EN   5,159,100 B = 36 + 5,159,064
     3DS MHGen EN     5,159,064 B = 本体のみ
     サイズが未知の場合は body[0]（または buf[36]）== 0xC6 で自動判定する。
     ※ 既知サイズはサイズ一致を最優先する。3DS サイズ (…152 / …064) は
        ヘッダ無し（オフセット 0）として扱い、37 バイト目が偶然 0xC6 でも
        Switch (36 B ヘッダ) と誤判定しない。

   ■ 本体ヘッダ
     body[0x00]        u8        0xC6 マジック
     body[0x04..0x06]  u8 × 3    スロット 1〜3 の使用フラグ
     body[0x10/14/18]  u32 LE    スロット 1〜3 のベースオフセット
                                 （通常 0x126474 / 0x244C34 / 0x3633F4）

   ■ 装備BOX（スロットごと）
     slotBase + 0x62EE から 2000 レコード × 36 バイト = 72,000 バイト。
     1 レコードの見かた:
       rec[0x00] & 0x1F === 6 … 護石（36 バイト全て 0 は空き）
       rec[0x02]           護石の種類 0=装備なし / 1 兵士 … 7 龍 … 10 天
       rec[0x0C]           1つ目のスキル系統ID (0=なし, 1..205)
       rec[0x0D]           2つ目のスキル系統ID
       rec[0x0E]           s8  1つ目のスキルポイント（負値あり）
       rec[0x0F]           s8  2つ目のスキルポイント
       rec[0x10]           スロット数 (0..3)
       rec[0x12]           レア度 (97..100)

   ■ 抽出結果（実セーブ C:\anyWorkspace\nx\jksv_ready\system で検証）
     スロット1 = 188 件 / スロット2 = 231 件 / スロット3 = 231 件 = 計 650 件
     （装備BOXは護石専用ではなく武器・防具も同居する。type 6 のレコードだけが護石）
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.data = MHXX.data || {};

  /* --- バイナリ定数 ------------------------------------------------ */

  var MAGIC = 0xC6;
  var TYPE_MASK = 0x1F;
  var CHARM_TYPE = 6;
  var SLOT_COUNT = 3;
  var SLOT_FLAG_OFFSETS = [0x04, 0x05, 0x06];
  var SLOT_BASE_OFFSETS = [0x10, 0x14, 0x18];
  var EQUIP_BOX_OFFSET = 0x62EE;
  var CHARM_RECORD_COUNT = 2000;
  var CHARM_RECORD_SIZE = 36;
  var MAX_SLOTS = 3;
  var MAX_SKILL_SYSTEM_ID = 205;

  /* --- スキル系統名 (id 0..205) ------------------------------------
     romfs/nativeNX/table/skillTypeData_jpn.gmd から抽出した 206 件。
     id 0 は「なし」で、レコード上は 0 = スキル無しを意味する。
     ------------------------------------------------------------------ */
  var SKILL_SYSTEM_NAMES = [
    'なし', '毒', '麻痺', '睡眠', '気絶',
    '聴覚保護', '風圧', '耐震', 'だるま', '耐暑',
    '耐寒', '寒冷適応', '炎熱適応', '盗み無効', '対防御DOWN',
    '狂撃耐性', '細菌学', '裂傷', '攻撃', '防御',
    '体力', '火耐性', '水耐性', '雷耐性', '氷耐性',
    '龍耐性', '属性耐性', '火属性攻撃', '水属性攻撃', '雷属性攻撃',
    '氷属性攻撃', '龍属性攻撃', '属性攻撃', '特殊攻撃', '研ぎ師',
    '匠', '斬れ味', '剣術', '研磨術', '鈍器',
    '抜刀会心', '抜刀減気', '納刀', '納刀研磨', '刃鱗',
    '装填速度', '反動', '精密射撃', '通常弾強化', '貫通弾強化',
    '散弾強化', '重撃弾強化', '通常弾追加', '貫通弾追加', '散弾追加',
    '榴弾追加', '拡散弾追加', '毒瓶追加', '麻痺瓶追加', '睡眠瓶追加',
    '強撃瓶追加', '属強瓶追加', '接撃瓶追加', '減気瓶追加', '爆破瓶追加',
    '速射', '射法', '装填数', '変則射撃', '弾薬節約',
    '達人', '痛撃', '連撃', '特殊会心', '属性会心',
    '会心強化', '裏会心', '溜め短縮', 'スタミナ', '体術',
    '気力回復', '走行継続', '回避性能', '回避距離', '泡沫',
    'ガード性能', 'ガード強化', 'KO', '減気攻撃', '笛',
    '砲術', '重撃', '爆弾強化', '本気', '闘魂',
    '無傷', 'チャンス', '龍気', '底力', '逆境',
    '逆上', '窮地', '根性', '気配', '采配',
    '号令', '乗り', '跳躍', '無心', '我慢',
    'ＳＰ延長', '千里眼', '観察眼', '狩人', '運搬',
    '加護', '英雄の盾', '回復量', '回復速度', '効果持続',
    '広域', '腹減り', '食いしん坊', '食事', '節食',
    '肉食', '茸食', '野草知識', '調合成功率', '調合数',
    '高速設置', '採取', 'ハチミツ', '護石王', '気まぐれ',
    '運気', '剥ぎ取り', '捕獲', 'ベルナ', 'ココット',
    'ポッケ', 'ユクモ', '龍識船', '飛行酒場', '紅兜',
    '大雪主', '矛砕', '岩穿', '紫毒姫', '宝纏',
    '白疾風', '隻眼', '黒炎王', '金雷公', '荒鉤爪',
    '燼滅刃', '朧隠', '鎧裂', '天眼', '青電主',
    '銀嶺', '鏖魔', '真・紅兜', '真・大雪主', '真・矛砕',
    '真・岩穿', '真・紫毒姫', '真・宝纏', '真・白疾風', '真・隻眼',
    '真・黒炎王', '真・金雷公', '真・荒鉤爪', '真・燼滅刃', '真・朧隠',
    '真・鎧裂', '真・天眼', '真・青電主', '真・銀嶺', '真・鏖魔',
    '北辰納豆流', '斬術', '食欲', '職工', '剛腕',
    '祈願', '裏稼業', '刀匠', '射手', '状態耐性',
    '怒', '回避術', '居合', '頑強', '剛撃',
    '盾持', '潔癖', '増幅', '護石収集', '強欲',
    '対鋼龍', '対霞龍', '対炎龍', '胴系統倍加', '秘術',
    '護石強化'
  ];

  /* --- 護石の種類 (rec[0x02]) ---------------------------------------
     romfs/nativeNX/table/amuletData_jpn.gmd の 11 行と同一。
     0 は「装備なし」で、ゲームが書く値ではない（がセーブに実在しうる）。
     ------------------------------------------------------------------ */
  var CHARM_KIND_NAMES = [
    '装備なし', '兵士の護石', '闘士の護石', '騎士の護石',
    '城塞の護石', '女王の護石', '王の護石', '龍の護石',
    '英雄の護石', '伝説の護石', '天の護石'
  ];

  /* 種類 → レア度の対応（97..100） */
  var KIND_RARITY = [0, 97, 97, 98, 98, 99, 99, 99, 100, 100, 100];

  /* 既知のファイルサイズ → 形式とヘッダ長
     MHGU (Switch EN) = 5,159,100 B / MHGen (3DS EN) = 5,159,064 B。
     「switch-mhgu」は 36 B ヘッダ付き、「3ds-mhgen」は本体のみ（オフセット 0）。 */
  var KNOWN_FORMATS = {
    4726188: { format: 'switch-jp', headerSize: 36 },
    4726152: { format: '3ds-jp', headerSize: 0 },
    5159100: { format: 'switch-mhgu', headerSize: 36 },
    5159064: { format: '3ds-mhgen', headerSize: 0 }
  };

  var FORMAT_LABELS = {
    'switch-jp': 'Nintendo Switch (MHXX JP)',
    '3ds-jp': 'ニンテンドー3DS (MHXX JP)',
    'switch-mhgu': 'Nintendo Switch (MHGU EN)',
    '3ds-mhgen': 'ニンテンドー3DS (MHGen EN)',
    /* 旧名（互換のため残す） */
    'switch-en': 'Nintendo Switch (MHGU EN)',
    '3ds-en': 'ニンテンドー3DS (MHGen EN)',
    'switch-unknown': 'Nintendo Switch (サイズ自動判定)',
    '3ds-unknown': 'ニンテンドー3DS (サイズ自動判定)'
  };

  /* --- 小道具 ------------------------------------------------------ */

  function toBytes(input) {
    if (!input) return null;
    if (typeof ArrayBuffer !== 'undefined') {
      if (input instanceof ArrayBuffer) return new Uint8Array(input);
      if (ArrayBuffer.isView && ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
    }
    if (typeof input.length === 'number') {
      var copy = new Uint8Array(input.length);
      for (var i = 0; i < input.length; i++) copy[i] = input[i] & 0xFF;
      return copy;
    }
    return null;
  }

  function isAllZero(bytes, offset, size) {
    for (var i = 0; i < size; i++) {
      if (bytes[offset + i] !== 0) return false;
    }
    return true;
  }

  function readInt8(bytes, offset) {
    var v = bytes[offset];
    return v > 0x7F ? v - 0x100 : v;
  }

  function signedPoints(pt) {
    return pt >= 0 ? '+' + pt : String(pt);
  }

  /* --- 形式判定 ---------------------------------------------------- */

  function detectFormat(bytes) {
    var size = bytes.length;
    var known = KNOWN_FORMATS[size];

    if (known) {
      if (known.headerSize === 0) {
        /* 3DS 本体のみの既知サイズ。サイズ一致を最優先し、オフセット 0 の
           0xC6 を本体マジックとして扱う。37 バイト目が偶然 0xC6 でも
           Switch (36 B ヘッダ) とは誤判定しない。 */
        return { format: known.format, headerSize: 0 };
      }
      if (bytes[known.headerSize] === MAGIC) {
        return { format: known.format, headerSize: known.headerSize };
      }
      /* ヘッダ付きの既知サイズなのにヘッダ位置がマジックでない。
         サイズは信頼し、parseSystemFile 側で明示的なエラーにする。 */
      return { format: known.format, headerSize: known.headerSize };
    }

    /* サイズが未知 → マジック位置で自動判定する。
       先にオフセット 0 (3DS) を見ることで、3DS 本体の 37 バイト目が
       偶然 0xC6 のときに 36 B ヘッダ付き Switch と誤判定しない。 */
    if (bytes[0] === MAGIC) {
      return { format: '3ds-unknown', headerSize: 0, auto: true };
    }
    if (size > 36 && bytes[36] === MAGIC) {
      return { format: 'switch-unknown', headerSize: 36, auto: true };
    }
    return null;
  }

  /* --- 名前解決 ---------------------------------------------------- */

  function skillSystemName(id) {
    var table = MHXX.data && MHXX.data.skillSystemById;
    if (table) {
      var entry = table[id];
      if (typeof entry === 'string' && entry) return entry;
      if (entry && typeof entry.name === 'string' && entry.name) return entry.name;
    }
    var name = SKILL_SYSTEM_NAMES[id];
    return typeof name === 'string' ? name : 'スキル' + id;
  }

  function charmKindName(kind) {
    var name = CHARM_KIND_NAMES[kind];
    return typeof name === 'string' ? name : '護石';
  }

  function kindRarity(kind) {
    var rarity = KIND_RARITY[kind];
    return typeof rarity === 'number' ? rarity : 0;
  }

  /* --- 護石オブジェクト生成 ---------------------------------------- */

  function formatCharmLabel(charm) {
    var name = charm.name || charmKindName(charm.kind);
    var parts = [];
    var skills = charm.skills || [];
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      if (!skill || !skill.name || !skill.pt) continue;
      parts.push(skill.name + signedPoints(skill.pt));
    }
    if (!parts.length) parts.push('スキルなし');
    parts.push('スロ' + (charm.slots || 0));
    return '[' + name + '] ' + parts.join(' ');
  }

  function buildCharm(bytes, offset, boxIndex, slotNumber) {
    var kind = bytes[offset + 0x02];
    var skill1Id = bytes[offset + 0x0C];
    var skill2Id = bytes[offset + 0x0D];
    var skill1Pt = readInt8(bytes, offset + 0x0E);
    var skill2Pt = readInt8(bytes, offset + 0x0F);
    var slots = bytes[offset + 0x10];
    if (slots > MAX_SLOTS) slots = MAX_SLOTS;
    var rarity = bytes[offset + 0x12];

    var skills = [];
    if (skill1Id !== 0 && skill1Pt !== 0) {
      skills.push({ id: skill1Id, name: skillSystemName(skill1Id), pt: skill1Pt });
    }
    if (skill2Id !== 0 && skill2Pt !== 0) {
      skills.push({ id: skill2Id, name: skillSystemName(skill2Id), pt: skill2Pt });
    }

    var skillMap = {};
    for (var i = 0; i < skills.length; i++) {
      skillMap[skills[i].name] = skills[i].pt;
    }

    var charm = {
      id: 'save-s' + slotNumber + '-' + boxIndex,
      name: charmKindName(kind),
      kind: kind,
      rarity: rarity,
      slots: slots,
      skills: skills,
      skillMap: skillMap,
      boxIndex: boxIndex,
      sourceSlot: slotNumber,
      label: '',
      /* UI 互換のフラット表現（charm-store 側でも同じ形を付与する） */
      skill1: skills[0] ? skills[0].name : '',
      skill1Pt: skills[0] ? skills[0].pt : 0,
      skill2: skills[1] ? skills[1].name : '',
      skill2Pt: skills[1] ? skills[1].pt : 0
    };
    charm.label = formatCharmLabel(charm);
    return charm;
  }

  /* --- スロット 1 つ分の装備BOXを走査 ------------------------------ */

  function parseSlot(body, view, slotNumber) {
    var index = slotNumber - 1;
    var base = view.getUint32(SLOT_BASE_OFFSETS[index], true);
    var boxOffset = base + EQUIP_BOX_OFFSET;
    var slot = {
      slotNumber: slotNumber,
      active: body[SLOT_FLAG_OFFSETS[index]] !== 0,
      baseOffset: base,
      boxOffset: boxOffset,
      charmCount: 0,
      charms: []
    };

    if (base < 0x1C || boxOffset + CHARM_RECORD_COUNT * CHARM_RECORD_SIZE > body.length) {
      slot.skipped = true;
      slot.error = 'スロット' + slotNumber + ' の装備BOXがセーブ本体の範囲外です' +
        ' (base=0x' + base.toString(16) + ')';
      return slot;
    }

    for (var i = 0; i < CHARM_RECORD_COUNT; i++) {
      var offset = boxOffset + i * CHARM_RECORD_SIZE;
      if ((body[offset] & TYPE_MASK) !== CHARM_TYPE) continue;
      if (isAllZero(body, offset, CHARM_RECORD_SIZE)) continue;
      slot.charms.push(buildCharm(body, offset, i, slotNumber));
    }
    slot.charmCount = slot.charms.length;
    return slot;
  }

  /* --- 公開 API ---------------------------------------------------- */

  function parseSystemFile(input) {
    var result = {
      valid: false,
      format: null,
      formatLabel: '',
      size: 0,
      headerSize: 0,
      bodySize: 0,
      totalCharms: 0,
      slots: [],
      error: ''
    };

    var bytes = toBytes(input);
    if (!bytes || !bytes.length) {
      result.error = '空のデータです。ArrayBuffer または Uint8Array を渡してください。';
      return result;
    }
    result.size = bytes.length;

    var info = detectFormat(bytes);
    if (!info) {
      result.error = 'MHXX/MHGU の system セーブとして認識できませんでした' +
        ' (サイズ ' + bytes.length + ' B)';
      return result;
    }

    result.format = info.format;
    result.formatLabel = FORMAT_LABELS[info.format] || info.format;
    result.headerSize = info.headerSize;
    result.autoDetected = info.auto === true;

    var body = info.headerSize ? bytes.subarray(info.headerSize) : bytes;
    result.bodySize = body.length;

    if (body.length < 0x20 || body[0] !== MAGIC) {
      result.error = 'セーブ本体のマジック (0xC6) が一致しません。' +
        'system 以外のファイルか、ヘッダ長の判定に失敗しています。';
      return result;
    }

    var view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    for (var slotNumber = 1; slotNumber <= SLOT_COUNT; slotNumber++) {
      var slot = parseSlot(body, view, slotNumber);
      result.slots.push(slot);
      result.totalCharms += slot.charms.length;
    }

    result.valid = true;
    return result;
  }

  function formatLabel(format) {
    return FORMAT_LABELS[format] || format || '';
  }

  MHXX.saveParser = {
    version: '1.1.0',

    /* 定数（UI 側から参照用） */
    SLOT_COUNT: SLOT_COUNT,
    KNOWN_FORMATS: KNOWN_FORMATS,
    FORMAT_LABELS: FORMAT_LABELS,
    CHARM_RECORD_COUNT: CHARM_RECORD_COUNT,
    CHARM_RECORD_SIZE: CHARM_RECORD_SIZE,
    EQUIP_BOX_OFFSET: EQUIP_BOX_OFFSET,
    MAX_SLOTS: MAX_SLOTS,
    MAX_SKILL_SYSTEM_ID: MAX_SKILL_SYSTEM_ID,
    SKILL_SYSTEM_NAMES: SKILL_SYSTEM_NAMES,
    CHARM_KIND_NAMES: CHARM_KIND_NAMES,

    /* 関数 */
    parseSystemFile: parseSystemFile,
    detectFormat: detectFormat,
    formatLabel: formatLabel,
    skillSystemName: skillSystemName,
    charmKindName: charmKindName,
    kindRarity: kindRarity,
    formatCharmLabel: formatCharmLabel
  };

  /* 既存モジュールからの参照経路も用意 */
  MHXX.core = MHXX.core || {};
  MHXX.core.saveParser = MHXX.saveParser;
})(typeof window !== 'undefined' ? window : this);
