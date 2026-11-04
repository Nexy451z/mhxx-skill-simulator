/* ==========================================================================
   MHXX スキルシミュレーター - 検索エンジン (js/core/search-engine.js)
   --------------------------------------------------------------------------
   泣シミュレータ（sim-compiled-ja.js）の検索アルゴリズムと計算仕様を
   忠実に移植・最適化した高速スキルシミュレートエンジン。

   ── 公開 API (window.MHXX.searchEngine) ──────────────────────────────
     setData(data)              … 装備/装飾品/スキルデータを注入（MHXX.data でも可）
     getData()                  … 正規化済みモデルを取得
     searchSync(options)        … 同期検索（結果オブジェクトを返す）
     search / run / simulate    … searchSync の別名（どの呼び出し方でも可）
     searchAsync(options, cb)   … 非同期検索（Promise。promise.cancel() で中断）
     cancel()                   … 実行中の非同期検索を中断
     prepare(options)           … 検索前の候補数などの確認（デバッグ/UI 用）
     listSkills() / findSkill(name) / findSystem(name) / listSystems()
     analyze(result)            … 結果の系統別ポイントを再計算（検証用）
     buildWorkerSource()        … Worker 用の自己完結コード文字列を生成（検証用）

   ── 結果オブジェクト（result）の主なフィールド ──────────────────────
     equipments / parts : { weapon, head, body, arm, waist, leg, legs, charm }
                          （parts は equipments と同一実体。leg と legs も同一）
                          各部位: name, slots, slotSizes[], decos[], skills{}, points{},
                                  defense, resistances[], multiplier,
                                  gender, torsoUp, alternatives[]
     skillMatrix        : [{ system, requiredPt, basePt, decoPt, bonusPt, totalPt,
                             secretBonus, activated, activatedSkills, parts{...} }]
                          secretBonus はネセト一式のスキル加点+2（total>0 の系統のみ 2）
     skills / totals    : 系統名 -> 合計ポイント
     freeSlots / emptySlots / freeSlotDetail / freeSlotList / totalSlots / usedSlots
     extraSuggestions   : 実際の空きスロで装着可能だと検証済みの追加スキル候補

   ── options ────────────────────────────────────────────────────────
     equipType    : 1=剣士 / 2=ガンナー                       (既定 1)
     weaponSlots  : 0〜3（武器スロ N = 容量 N 穴のスロット 1 個。複数珠可）
     weaponSlotSizes : [3,3,3] のように明示指定も可（任意）
     requiredSkills : 発動させたいスキル名の配列（系統名でも可）
     charmMode    : 'single' | 'all' | 'none'
     selectedCharm: charmMode='single' のときのお守り
     charms       : charmMode='all' のときのお守り配列
     maxResults   : 最大件数                                  (既定 200)
     gender       : 1|'male' / 2|'female' / 3|'both'|'any'
                    （3 のときも 1 セット内で男専用/女専用は混在させない）
     sortBy       : 'def' | 'slots' | 'resSum'                 (既定 'def')
     minDefense / maxDefense / resistFilters / villageStar / hallStar
     timeLimitMs  : 探索時間の上限ms（0 で無制限）            (既定 800)
     candidateOrder: 'score'（既定・スキル寄与優先）| 'def'（防御優先）
     seed         : ネセト一式 / 胴系統倍加のシード評価を行う  (既定 true)
     extraSuggestions : 追加スキル提案を生成する               (既定 true)

   ── データ契約（MHXX.data あるいは setData で渡す）───────────────────
     {
       skills: [ {name, system, points, type?} ]  … 系統名 system / 必要pt points
                 または泣シミュ形式 [["グループ名",[[name,system,points,type],...]],...]
       armors: [ {name, part, type, gender, slots, slotSizes?, skills:{系統:pt},
                  defense, resistances:[火,水,雷,氷,龍], village?, hall?, special?} ]
                 または泣シミュ形式のタプル
                 [name, 性別mask, 種別mask, part, 村☆, 集会所☆, 特殊, -, -, スロ数,
                  slotSizes, skills, 防御, 耐性]
       decorations: [ {name, size, skills:{系統:pt}} ]
                 または [name, slot, -, -, -, skills]
       charms   : [ {name, slots, slotSizes?, skills:{系統:pt}} ]   （任意）
     }
     part  : 0=頭 1=胴 2=腕 3=腰 4=脚
     type  : 1=剣士 2=ガンナー 3=共通（ビットマスク）
     gender: 1=男性 2=女性 3=共通（ビットマスク）

   ── 計算仕様（泣シミュレータ準拠）──────────────────────────────────
     ・胴系統倍加 : 胴防具のスキルpt と 胴に挿した装飾品pt が D 倍
                    D = 1 + (胴以外の胴系統倍加部位数)
     ・ネセト一式 : 5部位がネセト揃い（秘術pt>=10）で
                    護石のスキルpt・護石装飾品pt が 2 倍、
                    装備＋護石＋装飾品の合算が正（1pt 以上）の系統にのみ
                    +2（スキル加点+2）。マイナス系統には加算しない。
     ・装飾品    : 残り穴数 >= 装飾品サイズ のスロットに複数個まで装着可能
                     （「スロ3」= 3穴 = 【3】珠1個 / 【2】珠1個+【1】珠1個 / 【1】珠3個）。
                    倍加スロット（胴/ネセト護石）はポイントが multiplier 倍。
     ・性別      : 男性検索は「男専用 or 共通」、女性検索は「女専用 or 共通」のみ。
                    gender=3（両方）でも 1 セット内に男専用と女専用を混在させない
                    （DFS の段階で排他 + 評価時に最終検証）。
     ・検索      : 必須系統pt と スロ数 が同一の防具を防御最大代表へ統合し、
                    パレート下位互換を枝刈り。さらに装飾品容量の上界で枝刈り。
                    ネセト部位・胴系統倍加部位は必ず候補に残す。
                    胴系統倍加候補は潜在スコア上界（3スロ相当×2）を持たせ、
                    「3スロ胴＋複数部位倍加」が枝刈りで落ちないようにする。
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * コア（Worker にも文字列として埋め込むため完全に自己完結させる）
   * ------------------------------------------------------------------ */
  function SearchEngineCore(global, sourceText) {
    'use strict';

    /* ---------------- 定数 ---------------- */
    var VERSION = '1.0.0';
    var PART_HEAD = 0, PART_BODY = 1, PART_ARM = 2, PART_WAIST = 3, PART_LEGS = 4;
    var PART_CHARM = 5, PART_WEAPON = 6;
    var PART_KEYS = ['head', 'body', 'arm', 'waist', 'legs', 'charm', 'weapon'];
    var PART_LABELS = ['頭', '胴', '腕', '腰', '脚', '護石', '武器'];
    var TORSO_UP_KEYS = ['胴系統倍加', '胴系統倍化'];
    var NESET_SKILL = '秘術';
    var NESET_CHARM_SKILL = '護石強化';
    var NESET_BONUS_PT = 2;
    var NESET_CHARM_MULT = 2;
    var NESET_SETS = {
      1: ['ネセトカウザ', 'ネセトディルア', 'ネセトタハッド', 'ネセトヒザム', 'ネセトダラー'],
      2: ['ネセトラース', 'ネセトコルポ', 'ネセトマーノ', 'ネセトアンカ', 'ネセトサーク']
    };
    var DEFAULT_MAX_RESULTS = 200;
    var SLICE_MS = 12;               /* タイムスライス 1 回あたりの処理時間 */
    var DECO_NODE_BUDGET = 1500;
    var WORKER_BOOT_TIMEOUT = 2500;
    var ORDER_DEF_W = 0.8;     /* 候補ソート時の防御力の重み */
    /* 胴系統倍加候補の潜在スコア上界。
       倍加部位は自分のスキルptが 0 のことが多いが、胴のスキル/装飾品を D 倍
       する価値があるため、スコア 0 として枝刈りされないよう
       「3スロ相当 × 2」の十分な上界を与える。 */
    var TORSO_UP_POTENTIAL_PT = 6;
    /* ネセト一式のスキル加点+2 が乗る条件（合算ポイントが「正」であること） */
    var NESET_BONUS_MIN_PT = 1;

    /* ---------------- 小道具 ---------------- */
    var hasOwn = Object.prototype.hasOwnProperty;
    function own(o, k) { return hasOwn.call(o, k); }
    function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
    function now() {
      if (typeof performance !== 'undefined' && performance && performance.now) return performance.now();
      return Date.now();
    }
    function toInt(v, def) {
      var n = parseInt(v, 10);
      return isFinite(n) ? n : def;
    }
    function clone(o) {
      if (o === null || typeof o !== 'object') return o;
      if (isArray(o)) {
        var a = new Array(o.length);
        for (var i = 0; i < o.length; i++) a[i] = clone(o[i]);
        return a;
      }
      var r = {};
      for (var k in o) if (own(o, k)) r[k] = clone(o[k]);
      return r;
    }
    /* 全角/半角・空白・大文字小文字を吸収した比較キー */
    function normKey(s) {
      if (s == null) return '';
      var t = String(s);
      t = t.replace(/[\uFF01-\uFF5E]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      });
      t = t.replace(/\u3000/g, ' ');
      t = t.replace(/\s+/g, '');
      t = t.replace(/[・･]/g, '');
      return t.toLowerCase();
    }
    function num(v, def) {
      if (v == null || v === '') return def;
      var n = Number(v);
      return isFinite(n) ? n : def;
    }

    /* ---------------- 状態 ---------------- */
    var rawData = null;        /* 外部から注入された生データ */
    var model = null;          /* 正規化済みモデル */
    var modelDirty = true;
    var activeCancel = null;   /* 実行中の非同期検索キャンセラ */

    /* ================================================================== *
     * データ正規化
     * ================================================================== */
    function detectRawData() {
      var mhxx = global && global.MHXX;
      var cand = null;
      if (mhxx) {
        cand = mhxx.data || mhxx.DATA || mhxx.master || null;
      }
      if (!cand && global) cand = global.MHXX_DATA || null;
      return cand;
    }

    function pickList(container, keys) {
      if (!container) return null;
      if (isArray(container)) return container;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (own(container, k)) {
          var v = container[k];
          if (typeof v === 'function') {
            try { v = v.call(container); } catch (e) { v = null; }
          }
          if (isArray(v)) return v;
          if (v && isArray(v.list)) return v.list;
          if (v && isArray(v.items)) return v.items;
          if (v && isArray(v.all)) return v.all;
        }
      }
      return null;
    }

    /* ---- スキル定義 ---- */
    function normalizeSkills(src) {
      var list = [];
      var byName = {};
      var byKey = {};
      var systems = {};
      var i, j, k;

      function add(name, system, pts, type) {
        if (name == null || system == null) return;
        var def = {
          name: String(name),
          system: String(system),
          points: num(pts, 10),
          type: toInt(type, 3) || 3
        };
        list.push(def);
        byName[def.name] = def;
        byKey[normKey(def.name)] = def;
        if (!own(systems, def.system)) {
          systems[def.system] = { name: def.system, skills: [], positive: [], negative: [] };
        }
        systems[def.system].skills.push(def);
      }

      if (isArray(src)) {
        for (i = 0; i < src.length; i++) {
          var e = src[i];
          if (isArray(e)) {
            if (typeof e[0] === 'string' && isArray(e[1])) {
              /* グループ形式: ["グループ名", [["スキル名","系統名",pt,type], ...]] */
              for (j = 0; j < e[1].length; j++) {
                var ge = e[1][j];
                if (isArray(ge)) add(ge[0], ge[1], ge[2], ge[3]);
                else if (ge && typeof ge === 'object') add(ge.name, ge.system, ge.points != null ? ge.points : ge.pt, ge.type);
              }
            } else if (e.length >= 3 && typeof e[0] === 'string' && typeof e[1] === 'string') {
              /* 泣シミュのスキル表: ["スキル名","系統名",必要pt,type] */
              add(e[0], e[1], e[2], e[3]);
            }
          } else if (e && typeof e === 'object') {
            if (e.skills && isArray(e.skills)) {
              /* グループ形式: {group:[...]} */
              for (j = 0; j < e.skills.length; j++) {
                var s2 = e.skills[j];
                if (isArray(s2)) add(s2[0], s2[1], s2[2], s2[3]);
                else if (s2 && typeof s2 === 'object') add(s2.name, s2.system, s2.points != null ? s2.points : s2.pt, s2.type);
              }
            } else {
              add(e.name, e.system, e.points != null ? e.points : e.pt,
                e.type != null ? e.type : e.equipType);
            }
          }
        }
      } else if (src && typeof src === 'object') {
        /* グループ配列: [["グループ名", [ ... ]], ...] */
        var groups = src.groups || src.list || src.items || src.skillCategories;
        if (isArray(groups)) {
          for (i = 0; i < groups.length; i++) {
            var g = groups[i];
            if (isArray(g) && isArray(g[1])) {
              for (j = 0; j < g[1].length; j++) {
                var t = g[1][j];
                if (isArray(t)) add(t[0], t[1], t[2], t[3]);
                else if (t && typeof t === 'object') add(t.name, t.system, t.points != null ? t.points : t.pt, t.type);
              }
            } else if (g && typeof g === 'object' && isArray(g.skills)) {
              for (j = 0; j < g.skills.length; j++) {
                var t2 = g.skills[j];
                if (isArray(t2)) add(t2[0], t2[1], t2[2], t2[3]);
                else if (t2 && typeof t2 === 'object') add(t2.name, t2.system, t2.points != null ? t2.points : t2.pt, t2.type);
              }
            }
          }
        } else if (src.systems && typeof src.systems === 'object') {
          for (k in src.systems) {
            if (!own(src.systems, k)) continue;
            var arr = src.systems[k];
            if (!isArray(arr)) continue;
            for (j = 0; j < arr.length; j++) {
              var d = arr[j];
              if (isArray(d)) add(d[0], d[1] || k, d[2], d[3]);
              else if (d && typeof d === 'object') add(d.name, d.system || k, d.points != null ? d.points : d.pt, d.type);
            }
          }
        }
      }

      /* 系統ごとの並びを整える */
      for (k in systems) {
        if (!own(systems, k)) continue;
        var sys = systems[k];
        sys.skills.sort(function (a, b) {
          if (a.points === b.points) return a.name < b.name ? -1 : 1;
          return b.points - a.points;
        });
        sys.positive = sys.skills.filter(function (s) { return s.points > 0; });
        sys.negative = sys.skills.filter(function (s) { return s.points < 0; });
        /* 発動に必要な最小pt（正のスキル） */
        sys.minPositive = sys.positive.length ? sys.positive[sys.positive.length - 1].points : 0;
        sys.maxPositive = sys.positive.length ? sys.positive[0].points : 0;
      }

      return { list: list, byName: byName, byKey: byKey, systems: systems };
    }

    /* ---- 防具 ---- */
    function normalizeArmors(src) {
      var out = [];
      if (!isArray(src)) return out;
      for (var i = 0; i < src.length; i++) {
        var a = normalizeArmor(src[i]);
        if (a) out.push(a);
      }
      return out;
    }

    function normalizeArmor(e) {
      if (!e) return null;
      var rec;
      if (isArray(e)) {
        /* 泣シミュ形式: [name, K(性別), type(種別), part, i(村), j(集会所),
                          D(特殊), 0, 0, slots, slotSizes, skills, def, resist] */
        var skills = e[11];
        if (!skills || typeof skills !== 'object') skills = {};
        rec = {
          name: String(e[0]),
          gender: toInt(e[1], 3) || 3,
          type: toInt(e[2], 3) || 3,
          part: toInt(e[3], 0),
          village: toInt(e[4], 1),
          hall: toInt(e[5], 1),
          special: !!e[6],
          slots: toInt(e[9], 0),
          slotSizes: isArray(e[10]) ? e[10] : null,
          skills: skills,
          defense: num(e[12], 0),
          resistances: isArray(e[13]) ? e[13] : [0, 0, 0, 0, 0]
        };
      } else if (typeof e === 'object') {
        var part = e.part != null ? e.part : (e.m != null ? e.m : e.slot);
        if (typeof part === 'string') {
          var pi = PART_LABELS.indexOf(part);
          if (pi < 0) pi = PART_KEYS.indexOf(part);
          part = pi;
        }
        rec = {
          name: String(e.name != null ? e.name : ''),
          gender: toInt(e.gender != null ? e.gender : (e.K != null ? e.K : (e.sex != null ? e.sex : 3)), 3) || 3,
          type: toInt(e.type != null ? e.type : (e.eqType != null ? e.eqType : e.kind), 3) || 3,
          part: toInt(part, 0),
          village: toInt(e.village != null ? e.village : (e.i != null ? e.i : (e.reqVillage != null ? e.reqVillage : e.villageStar)), 1),
          hall: toInt(e.hall != null ? e.hall : (e.j != null ? e.j : (e.reqHr != null ? e.reqHr : e.hallStar)), 1),
          special: !!(e.special || e.D || e.isEvent),
          slots: toInt(e.slots != null ? e.slots : (e.slotCount != null ? e.slotCount : e.b), 0),
          slotSizes: isArray(e.slotSizes) ? e.slotSizes : (isArray(e.slotArray) ? e.slotArray : null),
          skills: e.skills || e.points || {},
          defense: num(e.defense != null ? e.defense : (e.def != null ? e.def : e.o), 0),
          resistances: isArray(e.resistances) ? e.resistances
            : (isArray(e.resist) ? e.resist
              : (isArray(e.res) ? e.res : (isArray(e.N) ? e.N : [0, 0, 0, 0, 0])))
        };
      } else {
        return null;
      }
      if (rec.part < 0 || rec.part > 4) return null;
      if (!rec.slotSizes && rec.slots > 0) rec.slotSizes = [rec.slots];
      rec.torsoUp = isTorsoUpSkills(rec.skills);
      return rec;
    }

    function isTorsoUpSkills(skills) {
      if (!skills) return false;
      for (var i = 0; i < TORSO_UP_KEYS.length; i++) {
        if (own(skills, TORSO_UP_KEYS[i]) && skills[TORSO_UP_KEYS[i]]) return true;
      }
      return false;
    }

    /* ---- 装飾品 ---- */
    function normalizeDecos(src) {
      var out = [];
      if (!isArray(src)) return out;
      for (var i = 0; i < src.length; i++) {
        var d = normalizeDeco(src[i]);
        if (d) out.push(d);
      }
      return out;
    }

    function normalizeDeco(e) {
      if (!e) return null;
      var rec;
      if (isArray(e)) {
        /* 泣シミュ形式: [name, slot, 0, rarity, value, skills] */
        var sk = e[5];
        if (!sk || typeof sk !== 'object') sk = {};
        rec = { name: String(e[0]), size: toInt(e[1], 1), skills: sk };
      } else if (typeof e === 'object') {
        rec = {
          name: String(e.name != null ? e.name : ''),
          size: toInt(e.size != null ? e.size
            : (e.slot != null ? e.slot
              : (e.slots != null ? e.slots : (e.slotCost != null ? e.slotCost : 1))), 1),
          skills: e.skills || e.points || {}
        };
      } else {
        return null;
      }
      if (rec.size < 1) rec.size = 1;
      if (rec.size > 3) rec.size = 3;
      return rec;
    }

    /* ---- お守り ---- */
    function normalizeCharm(e) {
      if (!e) return null;
      if (isArray(e)) {
        return {
          name: String(e[0] != null ? e[0] : 'お守り'),
          slots: toInt(e[1], 0),
          slotSizes: isArray(e[2]) ? e[2] : null,
          skills: e[3] && typeof e[3] === 'object' ? e[3] : {}
        };
      }
      var skills = e.skills || e.points || {};
      var slots = toInt(e.slots != null ? e.slots : (e.slotCount != null ? e.slotCount : e.b), 0);
      var sizes = isArray(e.slotSizes) ? e.slotSizes : (isArray(e.slotArray) ? e.slotArray : null);
      if (!sizes && slots > 0) sizes = [slots];
      return {
        name: String(e.name != null ? e.name : 'お守り'),
        slots: slots,
        slotSizes: sizes,
        skills: skills
      };
    }

    /* ---- モデル構築 ---- */
    function buildModel(raw) {
      var src = raw || detectRawData();
      if (!src) {
        throw new Error('[MHXX.searchEngine] 装備データが未設定です。MHXX.data を用意するか setData() を呼んでください。');
      }
      var skillSrc = null, armorSrc = null, decoSrc = null, charmSrc = null;

      if (isArray(src)) {
        armorSrc = src;
      } else {
        skillSrc = src.skills || src.skillList || null;
        armorSrc = pickList(src, ['armors', 'armor', 'equipments', 'head', 'armorList']);
        decoSrc = pickList(src, ['decorations', 'decos', 'jewels', 'decoList']);
        charmSrc = pickList(src, ['charms', 'omamori', 'charmList']);
      }
      if (!armorSrc) throw new Error('[MHXX.searchEngine] 防具データが見つかりません。');

      /* armorFields / decoFields が定義されていればタプルをその順でオブジェクト化 */
      var armorFields = (src && !isArray(src) && isArray(src.armorFields)) ? src.armorFields : null;
      var decoFields = (src && !isArray(src) && isArray(src.decoFields)) ? src.decoFields : null;
      if (armorFields) {
        var mappedA = new Array(armorSrc.length);
        for (var ai2 = 0; ai2 < armorSrc.length; ai2++) {
          mappedA[ai2] = tupleToObject(armorFields, armorSrc[ai2]);
        }
        armorSrc = mappedA;
      }
      if (decoFields && decoSrc) {
        var mappedD = new Array(decoSrc.length);
        for (var di2 = 0; di2 < decoSrc.length; di2++) {
          mappedD[di2] = tupleToObject(decoFields, decoSrc[di2]);
        }
        decoSrc = mappedD;
      }

      var skills = normalizeSkills(skillSrc || []);
      var armors = normalizeArmors(armorSrc);
      var decos = normalizeDecos(decoSrc || []);

      /* スキル定義が無い場合は装備から系統名を推測（系統=スキル名扱い） */
      if (!skills.list.length) {
        var seen = {};
        for (var i = 0; i < armors.length; i++) {
          for (var k in armors[i].skills) {
            if (!own(armors[i].skills, k) || seen[k]) continue;
            seen[k] = 1;
            skills.list.push({ name: k, system: k, points: 10, type: 3 });
            skills.byName[k] = skills.list[skills.list.length - 1];
            skills.byKey[normKey(k)] = skills.byName[k];
            skills.systems[k] = { name: k, skills: [skills.byName[k]], positive: [], negative: [] };
          }
        }
        for (var s in skills.systems) {
          if (!own(skills.systems, s)) continue;
          var sys = skills.systems[s];
          sys.positive = sys.skills.slice();
          sys.minPositive = 10;
          sys.maxPositive = 10;
        }
      }

      /* 系統名 -> 系統オブジェクト（装備のスキル名が系統名と一致しない場合の補助） */
      var systemAlias = {};
      for (var n = 0; n < skills.list.length; n++) {
        var sd = skills.list[n];
        if (!own(systemAlias, sd.system)) systemAlias[sd.system] = sd.system;
        systemAlias[normKey(sd.name)] = sd.system;
      }

      /* 装飾品のスキル名も系統名に寄せる（通常は同一） */
      var decoBySystem = {};
      for (var di = 0; di < decos.length; di++) {
        var d = decos[di];
        var mapped = {};
        var hasPositive = false;
        for (var dk in d.skills) {
          if (!own(d.skills, dk)) continue;
          var target = own(systemAlias, dk) ? systemAlias[dk] : (own(systemAlias, normKey(dk)) ? systemAlias[normKey(dk)] : dk);
          mapped[target] = (mapped[target] || 0) + num(d.skills[dk], 0);
          if (mapped[target] > 0) hasPositive = true;
        }
        d.systemSkills = mapped;
        d.hasPositive = hasPositive;
        for (var ms in mapped) {
          if (!own(mapped, ms)) continue;
          if (mapped[ms] > 0) {
            if (!own(decoBySystem, ms)) decoBySystem[ms] = [];
            decoBySystem[ms].push(d);
          }
        }
      }
      for (var ds in decoBySystem) {
        if (!own(decoBySystem, ds)) continue;
        decoBySystem[ds].sort(function (x, y) {
          var px = x.systemSkills[ds] || 0, py = y.systemSkills[ds] || 0;
          if (px !== py) return py - px;
          return x.size - y.size;
        });
      }

      /* 系統ごとの最良装飾品（サイズ別） */
      var bestDecoBySystem = {};
      for (var bs in decoBySystem) {
        if (!own(decoBySystem, bs)) continue;
        var table = { 1: null, 2: null, 3: null };
        var arr = decoBySystem[bs];
        for (var ai = 0; ai < arr.length; ai++) {
          var dd = arr[ai];
          var pts = dd.systemSkills[bs] || 0;
          if (pts <= 0) continue;
          var cur = table[dd.size];
          if (!cur) { table[dd.size] = dd; continue; }
          var curPts = cur.systemSkills[bs] || 0;
          if (pts > curPts) table[dd.size] = dd;
          else if (pts === curPts && negCost(dd, bs) < negCost(cur, bs)) table[dd.size] = dd;
        }
        bestDecoBySystem[bs] = table;
      }

      function negCost(deco, sys) {
        var c = 0;
        for (var k in deco.systemSkills) {
          if (!own(deco.systemSkills, k)) continue;
          if (k === sys) continue;
          var v = deco.systemSkills[k];
          if (v < 0) c += -v;
        }
        return c;
      }

      return {
        version: VERSION,
        skills: skills,
        armors: armors,
        decos: decos,
        charms: (charmSrc || []).map(normalizeCharm).filter(Boolean),
        decoBySystem: decoBySystem,
        bestDecoBySystem: bestDecoBySystem,
        systemAlias: systemAlias
      };
    }

    function ensureModel() {
      if (!model || modelDirty) {
        model = buildModel(rawData);
        modelDirty = false;
      }
      return model;
    }

    /* ================================================================== *
     * 検索コンテキスト構築
     * ================================================================== */
    function resolveSystem(m, name) {
      if (!name) return null;
      if (own(m.skills.byName, name)) return m.skills.byName[name].system;
      var key = normKey(name);
      if (own(m.skills.byKey, key)) return m.skills.byKey[key].system;
      if (own(m.skills.systems, name)) return name;
      return null;
    }

    function resolveSkill(m, name) {
      if (!name) return null;
      if (own(m.skills.byName, name)) return m.skills.byName[name];
      var key = normKey(name);
      if (own(m.skills.byKey, key)) return m.skills.byKey[key];
      return null;
    }

    /* 性別指定の正規化: 1=男性 / 2=女性 / 3=両方（混在禁止）
       'male'|'m'|'男性' … 1 / 'female'|'f'|'女性' … 2 /
       'any'|'both'|'all'|'両方' … 3 / 未指定 … 1（既定は男性） */
    function parseGender(v) {
      if (v == null || v === '') return 1;
      if (typeof v === 'string') {
        var t = normKey(v);
        if (t === 'male' || t === 'm' || t === 'man' || t === '男性' || t === '男') return 1;
        if (t === 'female' || t === 'f' || t === 'woman' || t === '女性' || t === '女') return 2;
        if (t === 'any' || t === 'both' || t === 'all' || t === '両方' || t === '共通' || t === '指定なし') return 3;
        var nstr = parseInt(t, 10);
        if (nstr === 1 || nstr === 2 || nstr === 3) return nstr;
        return 1;
      }
      var n = toInt(v, 1);
      return (n === 1 || n === 2) ? n : 3;
    }

    function buildContext(options) {
      var m = ensureModel();
      var opt = options || {};
      var equipType = toInt(opt.equipType, 1);
      if (equipType !== 2) equipType = 1;
      /* 1=男性 / 2=女性 / 3=両方（1 セット内で男専用と女専用は絶対に混在させない） */
      var gender = parseGender(opt.gender);
      /* 性別ビットマスク: 1=男専用, 2=女専用, 3=共通 の AND 判定に使う */
      var sexMask = gender === 2 ? 2 : (gender === 3 ? 0 : 1);

      /* --- 必須スキル -> 系統pt --- */
      var reqSkills = opt.requiredSkills || opt.skills || [];
      if (!isArray(reqSkills)) reqSkills = [reqSkills];
      var sysNames = [];
      var sysIndex = {};
      var reqMap = {};
      var missingSkills = [];
      var i, k;

      function addSys(name) {
        if (!own(sysIndex, name)) {
          sysIndex[name] = sysNames.length;
          sysNames.push(name);
        }
        return sysIndex[name];
      }

      for (i = 0; i < reqSkills.length; i++) {
        var raw = reqSkills[i];
        if (!raw) continue;
        var def = resolveSkill(m, raw);
        if (def) {
          if (def.points <= 0) continue;  /* マイナススキル要求は非対応（泣シミュ準拠） */
          addSys(def.system);
          if (!own(reqMap, def.system) || reqMap[def.system] < def.points) {
            reqMap[def.system] = def.points;
          }
          continue;
        }
        /* 系統名（例: "通常弾強化"）でも受け付ける */
        var sysName = resolveSystem(m, raw);
        if (sysName && m.skills.systems[sysName] && m.skills.systems[sysName].minPositive > 0) {
          addSys(sysName);
          var mp2 = m.skills.systems[sysName].minPositive;
          if (!own(reqMap, sysName) || reqMap[sysName] < mp2) reqMap[sysName] = mp2;
          continue;
        }
        missingSkills.push(String(raw));
      }
      /* 装備・護石にしか出てこない系統も追跡対象に含めたい場合は
         requiredSkills を空にしない限り不要 */
      var reqArr = [];
      for (i = 0; i < sysNames.length; i++) reqArr.push(reqMap[sysNames[i]] || 0);

      /* --- 武器スロット --- */
      var weaponSlots = toInt(opt.weaponSlots, 0);
      if (weaponSlots < 0) weaponSlots = 0;
      if (weaponSlots > 3) weaponSlots = 3;
      var weaponSizes = isArray(opt.weaponSlotSizes) && opt.weaponSlotSizes.length
        ? opt.weaponSlotSizes.slice()
        : (weaponSlots > 0 ? [weaponSlots] : []);
      weaponSizes = weaponSizes.filter(function (v) { return v >= 1; });

      /* --- 護石候補 --- */
      var charmMode = opt.charmMode || (opt.charms && opt.charms.length ? 'all' : 'single');
      var charmCandidates = [];
      if (charmMode === 'all') {
        var list = opt.charms || m.charms || [];
        for (i = 0; i < list.length; i++) {
          var c = normalizeCharm(list[i]);
          if (c) charmCandidates.push(c);
        }
      } else if (charmMode === 'single' || charmMode === 'none') {
        if (opt.selectedCharm && charmMode !== 'none') {
          var sc = normalizeCharm(opt.selectedCharm);
          if (sc) charmCandidates.push(sc);
        }
      }
      /* お守りなしも常に候補に含める */
      var hasNoCharm = false;
      for (i = 0; i < charmCandidates.length; i++) {
        if (!charmCandidates[i].slots && !Object.keys(charmCandidates[i].skills).length) hasNoCharm = true;
      }
      if (!hasNoCharm) charmCandidates.push({ name: 'なし', slots: 0, slotSizes: null, skills: {} });

      /* --- 防具候補 --- */
      var villageStar = opt.villageStar != null ? toInt(opt.villageStar, 10) : 10;
      var hallStar = opt.hallStar != null ? toInt(opt.hallStar, 13) : 13;
      var useStarFilter = !!(opt.useStarFilter || opt.villageStar != null || opt.hallStar != null);
      var minDefense = opt.minDefense != null ? num(opt.minDefense, 0) : 0;
      var maxDefense = opt.maxDefense != null ? num(opt.maxDefense, 0) : 0;
      var resistFilters = isArray(opt.resistFilters) ? opt.resistFilters : null;

      var candidates = [[], [], [], [], []];
      for (i = 0; i < m.armors.length; i++) {
        var a = m.armors[i];
        if (!(a.type & equipType)) continue;
        /* 性別フィルタ: 男性検索は「男専用 or 共通」、女性検索は「女専用 or 共通」のみ。
           gender=3 のときは両方を候補に残すが、DFS 側で 1 セット内の混在を禁止する。 */
        if (sexMask && !(a.gender & sexMask)) continue;
        if (useStarFilter) {
          if (a.special) {
            if (!(a.village <= villageStar && a.hall <= hallStar)) continue;
          } else {
            if (a.village > villageStar && a.hall > hallStar) continue;
          }
        }
        if (minDefense && a.defense < minDefense) continue;
        if (maxDefense && a.defense > maxDefense) continue;
        if (resistFilters) {
          var okRes = true;
          for (k = 0; k < 5; k++) {
            var lim = num(resistFilters[k], -100);
            if (lim > -100 && (a.resistances[k] || 0) < lim) { okRes = false; break; }
          }
          if (!okRes) continue;
        }
        candidates[a.part].push(a);
      }

      /* --- 圧縮: 系統pt ベクトル + スロ数 が同一のものを防御最大に統合 --- */
      var sysCount = sysNames.length;
      var perPart = [];
      /* 代替候補（同一性能キーを持つ他の防具）。UI が部位ごとの候補を差し替えられる。 */
      var altByPart = [];
      for (i = 0; i < 5; i++) altByPart.push({});
      for (i = 0; i < 5; i++) {
        perPart.push(compressCandidates(candidates[i], sysNames, reqArr, opt, equipType, altByPart[i]));
      }
      for (i = 0; i < 5; i++) {
        var altGroup = altByPart[i];
        for (var agk in altGroup) {
          if (!own(altGroup, agk)) continue;
          altGroup[agk].sort(function (x, y) { return (y.defense || 0) - (x.defense || 0); });
        }
      }

      /* --- 護石の枝刈り（all モード） --- */
      var charmList = pruneCharms(charmCandidates, sysNames, reqArr, opt);
      for (i = 0; i < charmList.length; i++) {
        var ch0 = charmList[i];
        ch0._sizes = ch0.slotSizes && ch0.slotSizes.length ? ch0.slotSizes : (ch0.slots ? [ch0.slots] : []);
        var cpts = new Array(sysCount);
        for (var cj = 0; cj < sysCount; cj++) cpts[cj] = num(ch0.skills[sysNames[cj]], 0);
        ch0._pts = cpts;
      }

      /* --- 装飾品のポイント密度（枝刈り用上界） --- */
      var decoRatio = {};
      var decoRatioArr = new Array(sysNames.length);
      var maxDecoRatio = 0.5;
      for (i = 0; i < sysNames.length; i++) {
        var sname = sysNames[i];
        var tbl = m.bestDecoBySystem[sname];
        var best = 0;
        if (tbl) {
          for (var sz = 1; sz <= 3; sz++) {
            if (!tbl[sz]) continue;
            var pv2 = tbl[sz].systemSkills[sname] || 0;
            if (pv2 > 0) {
              var rr2 = pv2 / sz;
              if (rr2 > best) best = rr2;
            }
          }
        }
        decoRatio[sname] = best;
        decoRatioArr[i] = best;
        if (best > maxDecoRatio) maxDecoRatio = best;
      }
      /* --- 装飾品ソルバ用の索引（系統index基準） --- */
      var decoRef = m.decos;
      var decoSize = new Array(decoRef.length);
      var decoPtsIdx = new Array(decoRef.length);
      var sysBestPts = [];
      var sysBestDeco = [];
      var capTable = [];
      var maxCapBySize = [0, 0, 0, 0];
      var decoSumPos = new Array(decoRef.length);
      for (var di = 0; di < decoRef.length; di++) {
        var dd = decoRef[di];
        decoSize[di] = dd.size;
        var arr = new Array(sysCount);
        for (var sj = 0; sj < sysCount; sj++) arr[sj] = num(dd.systemSkills[sysNames[sj]], 0);
        decoPtsIdx[di] = arr;
        var sumPos = 0;
        for (var sk = 0; sk < sysCount; sk++) if (arr[sk] > 0) sumPos += arr[sk];
        decoSumPos[di] = sumPos;
      }
      /* 容量 sz（= 穴数）で取れる最大ポイントの上界。
         MHXX は「1 スロ 1 個」ではなく穴数プールなので、サイズ1珠×3 の
         ような詰め方も上界に反映させる（装飾品は何個でも用意できる前提）。
         これを 1 個分のままにすると、3 スロに【1】珠×3 で発動する構成が
         容量プリチェックで落ちてしまう。 */
      for (var csz = 1; csz <= 3; csz++) {
        var bestSum = 0;
        for (var dq = 0; dq < decoRef.length; dq++) {
          var qsz = decoSize[dq];
          if (qsz > csz) continue;
          var qv = decoSumPos[dq] + maxCapBySize[csz - qsz];
          if (qv > bestSum) bestSum = qv;
        }
        maxCapBySize[csz] = bestSum;
      }
      for (var sy = 0; sy < sysCount; sy++) {
        var pts1 = 0, pts2 = 0, pts3 = 0;
        var best1 = -1, best2 = -1, best3 = -1;
        var sec = [];
        for (var dj = 0; dj < decoRef.length; dj++) {
          var pv3 = decoPtsIdx[dj][sy];
          if (pv3 <= 0) continue;
          var dsz = decoSize[dj];
          if (dsz === 1) { if (pv3 > pts1) { pts1 = pv3; best1 = dj; } }
          else if (dsz === 2) { if (pv3 > pts2) { pts2 = pv3; best2 = dj; } }
          else { if (pv3 > pts3) { pts3 = pv3; best3 = dj; } }
          sec.push(dj);
        }
        sysBestPts[sy] = [0, pts1, pts2, pts3];
        var cands = [];
        if (best3 >= 0) cands.push(best3);
        if (best2 >= 0) cands.push(best2);
        if (best1 >= 0) cands.push(best1);
        sec.sort(function (x, y) { return decoPtsIdx[y][sy] - decoPtsIdx[x][sy]; });
        for (var se = 0; se < sec.length && cands.length < 5; se++) {
          if (cands.indexOf(sec[se]) < 0) cands.push(sec[se]);
        }
        sysBestDeco[sy] = cands;
        /* 系統別の容量→最大ポイント（穴数プール前提の上界 DP） */
        var caps = [0, 0, 0, 0];
        for (var cq = 1; cq <= 3; cq++) {
          var bc = 0;
          for (var dq2 = 0; dq2 < decoRef.length; dq2++) {
            var pvq = decoPtsIdx[dq2][sy];
            if (pvq <= 0) continue;
            var sq = decoSize[dq2];
            if (sq > cq) continue;
            var vq = pvq + caps[cq - sq];
            if (vq > bc) bc = vq;
          }
          caps[cq] = bc;
        }
        capTable[sy] = caps;
      }
      /* 部位ごとの最大スロット容量（サイズ合計） */
      var maxSlotUnits = [0, 0, 0, 0, 0];
      for (i = 0; i < 5; i++) {
        var lst = perPart[i];
        for (var li2 = 0; li2 < lst.length; li2++) {
          var u = slotSizeSum(lst[li2]);
          if (u > maxSlotUnits[i]) maxSlotUnits[i] = u;
        }
      }
      /* 護石の最大スロット容量。護石は最後（part=5）に選ぶため、
         それ以前の枝刈り上界にも「護石スロで補填できる余地」を含める。
         ネセト一式では護石の装飾品ptが 2 倍になるので 2 倍して安全側に倒す。 */
      var maxCharmSlotUnits = 0;
      for (i = 0; i < charmList.length; i++) {
        var cu = slotSizeSum(charmList[i]);
        if (cu > maxCharmSlotUnits) maxCharmSlotUnits = cu;
      }

      /* --- ソート設定 --- */
      var sortBy = opt.sortBy || 'def';
      if (sortBy !== 'def' && sortBy !== 'slots' && sortBy !== 'resSum' && sortBy !== 'slotsUsed') sortBy = 'def';
      var maxResults = toInt(opt.maxResults, DEFAULT_MAX_RESULTS);
      if (maxResults <= 0) maxResults = DEFAULT_MAX_RESULTS;
      if (maxResults > 5000) maxResults = 5000;

      return {
        model: m,
        equipType: equipType,
        gender: gender,
        sexMask: sexMask,
        genderMixed: gender === 3,
        altByPart: altByPart,
        sysNames: sysNames,
        sysIndex: sysIndex,
        sysCount: sysCount,
        reqArr: reqArr,
        reqMap: reqMap,
        missingSkills: missingSkills,
        weaponSlots: weaponSlots,
        weaponSizes: weaponSizes,
        weaponName: opt.weaponName || (weaponSizes.length ? '武器スロ' + weaponSlots : '武器スロなし'),
        charms: charmList,
        charmMode: charmMode,
        candidates: perPart,
        sortBy: sortBy,
        maxResults: maxResults,
        maxNodes: toInt(opt.maxNodes, 4000000),
        timeLimitMs: opt.timeLimitMs != null ? toInt(opt.timeLimitMs, 0) : (opt.maxTimeMs != null ? toInt(opt.maxTimeMs, 0) : 800),
        initialThreshold: opt.initialThreshold != null ? num(opt.initialThreshold, 0) : null,
        candidateOrder: opt.candidateOrder || 'score',
        seed: opt.seed !== false,
        debug: !!opt.debug,
        decoRatio: decoRatio,
        decoRatioArr: decoRatioArr,
        maxDecoRatio: maxDecoRatio,
        decoRef: decoRef,
        decoSize: decoSize,
        decoPtsIdx: decoPtsIdx,
        sysBestPts: sysBestPts,
        sysBestDeco: sysBestDeco,
        capTable: capTable,
        maxCapBySize: maxCapBySize,
        decoMemo: {},
        slotPool: [],
        __base: new Array(sysCount),
        __need: new Array(sysCount),
        maxSlotUnits: maxSlotUnits,
        maxCharmSlotUnits: maxCharmSlotUnits,
        weaponSlotUnits: weaponSizes.reduce(function (a, b) { return a + b; }, 0),
        includeExtra: opt.extraSuggestions !== false,
        includeAllSystems: opt.includeAllSystems !== false,
        progressEvery: toInt(opt.progressEvery, 4000)
      };
    }

    /* 候補圧縮 + パレート枝刈り
       ・必須スキル系統pt + スロ数 が同一 → 防御最大の代表に統合
       ・胴系統倍加 / 秘術 / 護石強化 は圧縮キーに含め、必ず別候補として残す
       ・パレート下位互換（全pt以下 & スロ以下 & 防御以下）を枝刈り */
    function compressCandidates(list, sysNames, reqArr, opt, equipType, altOut) {
      if (!list.length) return [];
      var i, j, k;
      var sysCount = sysNames.length;
      var nesetNames = NESET_SETS[equipType === 2 ? 2 : 1];
      var best = {};
      var out = [];
      opt = opt || {};

      for (i = 0; i < list.length; i++) {
        var a = list[i];
        var pts = new Array(sysCount);
        var keyParts = [];
        for (j = 0; j < sysCount; j++) {
          var v = num(a.skills[sysNames[j]], 0);
          pts[j] = v;
          if (v) keyParts.push(j + ':' + v);
        }
        a._pts = pts;
        /* 特殊スキル（秘術 / 護石強化）は必須系統に含まれなくても保持 */
        a._neset = num(a.skills[NESET_SKILL], 0);
        a._charmUp = num(a.skills[NESET_CHARM_SKILL], 0);
        a._isNesetPiece = nesetNames.indexOf(a.name) >= 0;
        a._sizes = a.slotSizes && a.slotSizes.length ? a.slotSizes : (a.slots ? [a.slots] : []);
        var un = 0;
        for (var uq = 0; uq < a._sizes.length; uq++) un += a._sizes[uq];
        a._units = un;

        var key = a.slots + '|' + keyParts.join(',') + '|t' + (a.torsoUp ? 1 : 0) +
          '|n' + a._neset + '|c' + a._charmUp;
        a._key = key;
        /* 性別（1=男専用 / 2=女専用 / 3=共通）: 1 セット内の混在防止に使う */
        a._sex = a.gender === 1 ? 1 : (a.gender === 2 ? 2 : 3);
        /* 潜在スコア: 枝刈り・並び順の基準。
           胴系統倍加は自身の pt が 0 でも胴の価値を D 倍するため、
           3スロ相当以上の上界を与えて不当に落とさない。 */
        var score = 0;
        for (j = 0; j < sysCount; j++) {
          var sv = pts[j];
          if (sv > 0) score += Math.min(sv, reqArr[j] > 0 ? reqArr[j] : sv);
          else score += sv;
        }
        a._potential = (a.torsoUp && score < TORSO_UP_POTENTIAL_PT) ? TORSO_UP_POTENTIAL_PT : score;
        a._score = a._potential;
        if (altOut) {
          var grp = altOut[key];
          if (!grp) altOut[key] = grp = [];
          if (grp.length < 6) grp.push(a);
        }
        var cur = best[key];
        if (!cur || a.defense > cur.defense ||
            (a.defense === cur.defense && a.resistances.reduce(sum5, 0) > cur.resistances.reduce(sum5, 0))) {
          best[key] = a;
        }
      }
      for (k in best) if (own(best, k)) out.push(best[k]);

      /* 並び順: 既定は「必須スキル寄与 + スロ + 防御」の総合評価。
         candidateOrder:'def' 指定時は純粋な防御降順。 */
      if (opt.candidateOrder === 'def') {
        out.sort(function (x, y) {
          if (y.defense !== x.defense) return y.defense - x.defense;
          return y.slots - x.slots;
        });
      } else {
        out.sort(function (x, y) {
          var sx = (x._score || 0) * 100 + x.slots * 14 + (x.defense || 0) * ORDER_DEF_W +
            (x.torsoUp ? 60 : 0) + (x._isNesetPiece ? 120 : 0);
          var sy = (y._score || 0) * 100 + y.slots * 14 + (y.defense || 0) * ORDER_DEF_W +
            (y.torsoUp ? 60 : 0) + (y._isNesetPiece ? 120 : 0);
          return sy - sx;
        });
      }

      /* パレート枝刈り */
      var kept = [];
      for (i = 0; i < out.length; i++) {
        var cand = out[i];
        /* ネセト部位は必ず残す（一式判定に必要） */
        if (cand._isNesetPiece) { kept.push(cand); continue; }
        var dominated = false;
        for (j = 0; j < kept.length; j++) {
          var b = kept[j];
          if (b._isNesetPiece) continue;
          if (b.slots < cand.slots) continue;
          if (b.defense < cand.defense) continue;
          if (b.torsoUp && !cand.torsoUp) { /* 倍加持ちは別物 */ }
          else if (cand.torsoUp && !b.torsoUp) continue;
          if (b._neset < cand._neset) continue;
          if (b._charmUp < cand._charmUp) continue;
          var allGe = true;
          for (k = 0; k < sysCount; k++) {
            if (b._pts[k] < cand._pts[k]) { allGe = false; break; }
          }
          if (allGe) { dominated = true; break; }
        }
        if (!dominated) kept.push(cand);
      }
      return kept;
    }

    function sum5(a, b) { return a + b; }

    function tupleToObject(fields, tuple) {
      if (!isArray(tuple)) return tuple;
      var o = {};
      for (var i = 0; i < fields.length; i++) o[fields[i]] = tuple[i];
      return o;
    }

    function slotSizeSum(a) {
      if (!a) return 0;
      if (a._units !== undefined) return a._units;
      var sizes = a.slotSizes && a.slotSizes.length ? a.slotSizes : (a.slots ? [a.slots] : []);
      var s = 0;
      for (var i = 0; i < sizes.length; i++) s += num(sizes[i], 0);
      a._units = s;
      return s;
    }

    /* 護石のパレート枝刈り */
    function pruneCharms(charms, sysNames, reqArr, opt) {
      if (!charms.length) return charms;
      var sysCount = sysNames.length;
      var i, j, k;
      var items = [];
      for (i = 0; i < charms.length; i++) {
        var c = charms[i];
        var pts = new Array(sysCount);
        for (j = 0; j < sysCount; j++) pts[j] = num(c.skills[sysNames[j]], 0);
        var slots = 0;
        if (c.slotSizes && c.slotSizes.length) {
          for (k = 0; k < c.slotSizes.length; k++) slots += num(c.slotSizes[k], 0);
        } else {
          slots = c.slots;
        }
        items.push({ charm: c, pts: pts, slots: slots });
      }
      /* 重複除去 */
      var seen = {};
      var uniq = [];
      for (i = 0; i < items.length; i++) {
        var key = items[i].slots + '|' + items[i].pts.join(',');
        if (seen[key]) continue;
        seen[key] = 1;
        uniq.push(items[i]);
      }
      /* 防御の代わりにスロ数を基準に降順ソート → パレート */
      uniq.sort(function (x, y) {
        if (y.slots !== x.slots) return y.slots - x.slots;
        var sx = 0, sy = 0;
        for (var q = 0; q < x.pts.length; q++) { sx += x.pts[q]; sy += y.pts[q]; }
        return sy - sx;
      });
      var kept = [];
      for (i = 0; i < uniq.length; i++) {
        var cand = uniq[i];
        var dominated = false;
        for (j = 0; j < kept.length; j++) {
          var b = kept[j];
          if (b.slots < cand.slots) continue;
          var allGe = true;
          for (k = 0; k < sysCount; k++) {
            if (b.pts[k] < cand.pts[k]) { allGe = false; break; }
          }
          if (allGe) { dominated = true; break; }
        }
        if (!dominated) kept.push(cand);
      }
      /* お守りなしは必ず残す */
      var hasNone = false;
      for (i = 0; i < kept.length; i++) if (!kept[i].slots && kept[i].pts.every(isZero)) hasNone = true;
      if (!hasNone) kept.push({ charm: { name: 'なし', slots: 0, slotSizes: null, skills: {} }, pts: zeroArr(sysCount), slots: 0 });
      return kept.map(function (x) { return x.charm; });
    }
    function isZero(v) { return !v; }

    /* ================================================================== *
     * 装飾品ソルバ
     * ================================================================== */
    function fillSlots(ctx, weaponSizes, parts, charm, torsoUpCount, isNeset) {
      var pool = ctx.slotPool;
      var n = 0;
      var i, j;
      for (i = 0; i < weaponSizes.length; i++) {
        var s = pool[n];
        if (!s) s = pool[n] = { size: 0, part: 0, mult: 1 };
        s.size = weaponSizes[i]; s.part = PART_WEAPON; s.mult = 1;
        n++;
      }
      for (i = 0; i < 5; i++) {
        var a = parts[i];
        if (!a) continue;
        var sizes = a._sizes || (a.slotSizes && a.slotSizes.length ? a.slotSizes : (a.slots ? [a.slots] : []));
        var mult = (i === PART_BODY) ? (1 + torsoUpCount) : 1;
        for (j = 0; j < sizes.length; j++) {
          var s2 = pool[n];
          if (!s2) s2 = pool[n] = { size: 0, part: 0, mult: 1 };
          s2.size = sizes[j]; s2.part = i; s2.mult = mult;
          n++;
        }
      }
      if (charm) {
        var cs = charm._sizes || (charm.slotSizes && charm.slotSizes.length ? charm.slotSizes : (charm.slots ? [charm.slots] : []));
        var cmult = isNeset ? NESET_CHARM_MULT : 1;
        for (j = 0; j < cs.length; j++) {
          var s3 = pool[n];
          if (!s3) s3 = pool[n] = { size: 0, part: 0, mult: 1 };
          s3.size = cs[j]; s3.part = PART_CHARM; s3.mult = cmult;
          n++;
        }
      }
      return n;
    }

    /* ------------------------------------------------------------------ *
     * 装飾品ソルバ（高速版）
     *   needArr : 系統index ごとの残り必要pt
     *   slots   : [{size, part, mult}]
     *   戻り値  : { assignments:[{slot, deco}], used } | null
     * ------------------------------------------------------------------ */
    function solveDecos(ctx, needArr, slots, slotCountIn) {
      var n = needArr.length;
      if (n === 0) return EMPTY_SOLUTION;
      var q, i;
      var gapTotal = 0;
      for (q = 0; q < n; q++) if (needArr[q] > 0) gapTotal += needArr[q];
      if (gapTotal <= 0) return EMPTY_SOLUTION;

      /* 0 も「スロット無し」として正しく扱う（0 || slots.length だと
         前回のスロットプール長が使われ、存在しないスロットに装飾品を
         割り当ててしまう） */
      var slotCount = (slotCountIn === undefined || slotCountIn === null) ? slots.length : slotCountIn;
      if (!slotCount) return null;

      /* ---- 容量プリチェック（圧倒的多数の不可解をここで弾く） ---- */
      var maxCapBySize = ctx.maxCapBySize;
      var capTable = ctx.capTable;
      var totalCap = 0;
      for (i = 0; i < slotCount; i++) totalCap += maxCapBySize[slots[i].size] * slots[i].mult;
      if (gapTotal > totalCap) return null;
      var sysCap = ctx.__tmpCap || (ctx.__tmpCap = new Array(n));
      for (q = 0; q < n; q++) sysCap[q] = 0;
      for (i = 0; i < slotCount; i++) {
        var sz = slots[i].size, mu = slots[i].mult;
        for (q = 0; q < n; q++) {
          if (needArr[q] <= 0) continue;
          sysCap[q] += capTable[q][sz] * mu;
        }
      }
      for (q = 0; q < n; q++) {
        if (needArr[q] > 0 && needArr[q] > sysCap[q]) return null;
      }

      /* ---- メモ化キー ---- */
      var key = '';
      for (i = 0; i < slotCount; i++) key += slots[i].size * 10 + slots[i].mult + ',';
      key += '|';
      for (i = 0; i < n; i++) if (needArr[i] > 0) key += i + ':' + needArr[i] + ',';
      var memoStore = ctx.decoMemo;
      var cached = memoStore[key];
      if (cached !== undefined) return cached === 0 ? null : remapSolution(ctx, cached, slots);

      /* ---- スロットを「倍率大 → サイズ大」で並べる ---- */
      var slotOrder = ctx.__slotOrder || (ctx.__slotOrder = []);
      slotOrder.length = slotCount;
      for (i = 0; i < slotCount; i++) slotOrder[i] = i;
      var so = slotOrder;
      so.sort(function (x, y) {
        var s1 = slots[x], s2 = slots[y];
        if (s1.mult !== s2.mult) return s2.mult - s1.mult;
        return s2.size - s1.size;
      });

      /* 各スロットは「残り穴数」を持つ容量プールとして扱う。
         MHXX にスロット Lv の概念は無く、「スロ3」= 3 穴は
           【3】珠 1 個 / 【2】珠 1 個 + 【1】珠 1 個 / 【1】珠 3 個
         のいずれも装着できる（1 スロ 1 個ではない）。 */
      var rem = new Array(slotCount);
      for (i = 0; i < slotCount; i++) rem[i] = slots[i].size;
      var picked = [];              /* 成功時の配置 [{ s: slotIndex, d: decoIndex }] */
      var cur = new Array(n);
      for (i = 0; i < n; i++) cur[i] = 0;
      var nodes = 0;
      var localMemo = {};
      var sysBest = ctx.sysBestDeco;
      var sysPts = ctx.sysBestPts;
      var decoPtsIdx = ctx.decoPtsIdx;

      function satisfied() {
        for (var t = 0; t < n; t++) if (needArr[t] - cur[t] > 0) return false;
        return true;
      }

      function apply(di, slotIdx, sign) {
        var mult = slots[slotIdx].mult;
        var arr = decoPtsIdx[di];
        for (var t = 0; t < n; t++) {
          var v = arr[t];
          if (v) cur[t] += sign * v * mult;
        }
      }

      function pickSystem() {
        var bestIdx = -1, bestScore = -1;
        for (var t = 0; t < n; t++) {
          var r = needArr[t] - cur[t];
          if (r <= 0) continue;
          /* サイズ3の装飾品が無い系統でも解けるよう、サイズ1〜3の最大値を使う
             （以前は size3 専用の値だけを見ていたため、size1/2 しか無い系統が
              必ず「解なし」になっていた） */
          var mp = sysPts[t][3];
          if (sysPts[t][1] > mp) mp = sysPts[t][1];
          if (sysPts[t][2] > mp) mp = sysPts[t][2];
          if (mp <= 0) continue;
          var score = r / mp;
          if (score > bestScore) { bestScore = score; bestIdx = t; }
        }
        return bestIdx;
      }

      function stateKey() {
        var s = '';
        for (var t = 0; t < n; t++) {
          var r = needArr[t] - cur[t];
          if (r > 0) s += t + ':' + r + ',';
        }
        /* 残り穴数の組み合わせが同じなら以降の探索結果も同じ */
        for (var u = 0; u < slotCount; u++) s += u + ':' + rem[u] + ',';
        return s;
      }

      function rec() {
        if (++nodes > DECO_NODE_BUDGET) return false;
        if (satisfied()) return true;
        var sk = stateKey();
        if (localMemo[sk]) return false;

        var sysIdx = pickSystem();
        if (sysIdx < 0) { localMemo[sk] = 1; return false; }

        /* この系統に有効な装飾品候補（サイズ別ベスト + 予備） */
        var cands = sysBest[sysIdx];
        for (var ci = 0; ci < cands.length; ci++) {
          var di = cands[ci];
          if (di < 0) continue;
          var dSize = ctx.decoSize[di];
          var pts = decoPtsIdx[di][sysIdx];
          if (pts <= 0) continue;
          /* 装着先を探す。残り穴数 >= 装飾品サイズ のスロットに詰める。
             同じ (倍率, 残り穴数) のスロットは 1 回だけ試す。
             倍率大 → 残り穴数が小さい順（無駄な断片化を避ける）。 */
          var fits = [];
          for (var oi = 0; oi < slotCount; oi++) {
            var sIdx = so[oi];
            if (rem[sIdx] < dSize) continue;
            var dup = false;
            for (var fi = 0; fi < fits.length; fi++) {
              if (slots[fits[fi]].mult === slots[sIdx].mult && rem[fits[fi]] === rem[sIdx]) { dup = true; break; }
            }
            if (!dup) fits.push(sIdx);
          }
          if (!fits.length) continue;
          fits.sort(function (a0, b0) {
            if (slots[a0].mult !== slots[b0].mult) return slots[b0].mult - slots[a0].mult;
            return rem[a0] - rem[b0];
          });
          for (var fj = 0; fj < fits.length; fj++) {
            var fit = fits[fj];
            rem[fit] -= dSize;
            apply(di, fit, 1);
            picked.push({ s: fit, d: di });
            if (rec()) return true;
            picked.pop();
            apply(di, fit, -1);
            rem[fit] += dSize;
          }
        }
        localMemo[sk] = 1;
        return false;
      }

      var okRes = rec();
      if (!okRes) { memoStore[key] = 0; return null; }

      var plan = new Array(picked.length);
      for (i = 0; i < picked.length; i++) plan[i] = [picked[i].s, picked[i].d];
      var stored = { plan: plan, used: plan.length, sig: key };
      memoStore[key] = stored;
      return remapSolution(ctx, stored, slots);
    }

    var EMPTY_SOLUTION = { assignments: [], used: 0 };
    var EMPTY5 = [0, 0, 0, 0, 0];
    /* 評価用の部位バッファは createSearchTask のスコープ内で確保する
       （モジュールスコープの暗黙変数参照による ReferenceError を排除）。 */

    /* メモ化した配置（スロットindex -> 装飾品index）を実スロットへ割り当て */
    function remapSolution(ctx, stored, slots) {
      var assignments = [];
      var plan = stored.plan || [];
      for (var i = 0; i < plan.length; i++) {
        var item = plan[i];
        var si, di;
        if (isArray(item)) { si = item[0]; di = item[1]; }
        else { si = i; di = item; }      /* 旧形式（1 スロ 1 個）との互換 */
        if (di === undefined || di === null || di < 0) continue;
        if (si === undefined || si === null || si < 0 || si >= slots.length) continue;
        assignments.push({ slot: slots[si], deco: ctx.decoRef[di], slotIndex: si });
      }
      return { assignments: assignments, used: assignments.length };
    }

    /* ================================================================== *
     * 検索本体（明示スタック DFS / タイムスライス可能）
     * ================================================================== */
    function createSearchTask(ctx) {
      var m = ctx.model;
      var sysCount = ctx.sysCount;
      var sysNames = ctx.sysNames;
      var reqArr = ctx.reqArr;
      /* 装飾品ポイント密度の上界（欠損していても 0.5 で必ず動く） */
      var ratioArr = ctx.decoRatioArr;
      if (!ratioArr) {
        ratioArr = new Array(sysCount);
        for (var rq = 0; rq < sysCount; rq++) ratioArr[rq] = 0.5;
      }
      var lists = [];
      for (var p = 0; p < 5; p++) lists.push(ctx.candidates[p]);
      var charms = ctx.charms;
      /* 評価用の一時バッファ（タスクスコープで明示的に定義） */
      var evalPartsBuf = [null, null, null, null, null];

      /* 防御・pt のサフィックス最大値（枝刈り用） */
      var suffixDef = new Array(7);
      var suffixPts = new Array(7);
      suffixDef[6] = 0;
      suffixPts[6] = zeroArr(sysCount);
      for (var sp = 5; sp >= 0; sp--) {
        var list = sp < 5 ? lists[sp] : charms;
        var md = 0;
        var mp = zeroArr(sysCount);
        for (var li = 0; li < list.length; li++) {
          var it = list[li];
          if (it.defense != null && it.defense > md) md = it.defense;
          var pv = sp < 5 ? it._pts : null;
          var optMult = (sp === PART_BODY) ? 5 : 1; /* 胴は後から倍加する可能性を楽観視 */
          if (pv) {
            for (var q = 0; q < sysCount; q++) {
              var ov = pv[q] * (pv[q] > 0 ? optMult : 1);
              if (ov > mp[q]) mp[q] = ov;
            }
          } else if (it.skills) {
            for (var q2 = 0; q2 < sysCount; q2++) {
              var v2 = num(it.skills[sysNames[q2]], 0);
              if (v2 > mp[q2]) mp[q2] = v2;
            }
          }
        }
        suffixDef[sp] = md + (sp < 5 ? suffixDef[sp + 1] : 0);
        var merged = zeroArr(sysCount);
        for (var q3 = 0; q3 < sysCount; q3++) merged[q3] = mp[q3] + suffixPts[sp + 1][q3];
        suffixPts[sp] = merged;
      }

      var results = [];
      var seenKeys = {};
      var resultCount = 0;
      var threshold = ctx.initialThreshold != null ? ctx.initialThreshold : -Infinity;   /* これ未満の防御は捨てる */
      var nodes = 0;
      var stats = { leaves: 0, decoFail: 0, verifyFail: 0, thresholdSkip: 0, accepted: 0, visits: [0,0,0,0,0,0], prunedPt: 0, prunedSlot: 0, acceptedAt: [] };
      var startedAt = now();
      var finished = false;
      var prunedByLimit = false;

      /* スタックフレーム */
      var stack = [];
      var ptsPool = [];

      function pushFrame(part, baseDef, basePts, torsoUp, sex) {
        var pts;
        if (ptsPool.length) pts = ptsPool.pop();
        else pts = zeroArr(sysCount);
        for (var i = 0; i < sysCount; i++) pts[i] = basePts[i];
        stack.push({
          part: part,
          idx: -1,
          def: baseDef,
          pts: pts,
          torsoUp: torsoUp,
          sex: sex || 0,       /* 0=未確定 / 1=男性専用を含む / 2=女性専用を含む */
          chosen: null
        });
      }

      /* ---- 特殊コンボのシード評価（ネセト一式 / 胴系統倍加） ---- */
      function seedSpecial() {
        if (ctx.seed === false) return;
        var i, p2, c2;
        var nesetNames = NESET_SETS[ctx.equipType === 2 ? 2 : 1];
        var charmLimit = Math.min(charms.length, 4);

        /* ネセト一式 */
        var nesetParts = [];
        var nesetOk = true;
        for (p2 = 0; p2 < 5; p2++) {
          var found = null;
          for (i = 0; i < lists[p2].length; i++) {
            if (lists[p2][i].name === nesetNames[p2]) { found = lists[p2][i]; break; }
          }
          if (!found) { nesetOk = false; break; }
          nesetParts.push(found);
        }
        if (nesetOk) {
          for (c2 = 0; c2 < charmLimit; c2++) evaluateCombo(nesetParts, charms[c2]);
        }

        /* 胴系統倍加: 各部位の倍加候補 × 他部位の上位 K 件 */
        var K = 3;
        var tuParts = [];
        for (p2 = 0; p2 < 5; p2++) {
          var tus = [];
          for (i = 0; i < lists[p2].length && tus.length < 4; i++) {
            if (lists[p2][i].torsoUp) tus.push(lists[p2][i]);
          }
          tuParts.push(tus);
        }
        var hasTu = false;
        for (p2 = 0; p2 < 5; p2++) if (tuParts[p2].length) hasTu = true;
        if (hasTu) {
          /* 複数部位の同時倍加（胴スロを D 倍する構成）も必ずシード評価する。
             DFS の枝刈りで落ちうる「3スロ胴＋倍加4部位」を確実に拾うため。 */
          for (var bi = 0; bi < Math.min(4, lists[PART_BODY].length); bi++) {
            var seedCombo = [null, null, null, null, null];
            for (p2 = 0; p2 < 5; p2++) {
              if (p2 === PART_BODY) seedCombo[p2] = lists[PART_BODY][bi];
              else seedCombo[p2] = tuParts[p2].length ? tuParts[p2][0] : lists[p2][0];
            }
            for (c2 = 0; c2 < charmLimit; c2++) evaluateCombo(seedCombo, charms[c2]);
          }

          var combo = [null, null, null, null, null];
          var guard = 0;
          for (var tp2 = 0; tp2 < 5; tp2++) {
            if (!tuParts[tp2].length) continue;
            for (var ti = 0; ti < tuParts[tp2].length; ti++) {
              combo[0] = lists[0][0]; combo[1] = lists[1][0]; combo[2] = lists[2][0];
              combo[3] = lists[3][0]; combo[4] = lists[4][0];
              combo[tp2] = tuParts[tp2][ti];
              /* 他部位の上位 K 件を組み合わせ */
              var total = 1;
              for (p2 = 0; p2 < 5; p2++) if (p2 !== tp2) total *= Math.min(K, lists[p2].length);
              if (total > 400) total = 400;
              for (var ci = 0; ci < total; ci++) {
                var rem = ci;
                for (p2 = 0; p2 < 5; p2++) {
                  if (p2 === tp2) continue;
                  var kk = Math.min(K, lists[p2].length);
                  combo[p2] = lists[p2][rem % kk];
                  rem = (rem / kk) | 0;
                }
                for (c2 = 0; c2 < charmLimit; c2++) {
                  evaluateCombo(combo, charms[c2]);
                }
                if (++guard > 20000) break;
              }
              if (guard > 20000) break;
            }
          }
        }
      }
      seedSpecial();

      /* 初期フレーム */
      pushFrame(0, 0, zeroArr(sysCount), 0, 0);

      function advance() {
        if (finished) return false;
        if (!stack.length) { finished = true; return false; }

        var f = stack[stack.length - 1];
        var part = f.part;
        var list = part < 5 ? lists[part] : charms;

        f.idx++;
        if (f.idx >= list.length) {
          /* この階層は終了 */
          var old = stack.pop();
          ptsPool.push(old.pts);
          if (!stack.length) { finished = true; return false; }
          return true;
        }

        var cand = list[f.idx];
        stats.visits[part]++;

        /* --- 性別の排他（1 セット内に男専用と女専用を混在させない） --- */
        var branchSex = f.sex || 0;
        if (part < 5) {
          var candSex = cand._sex || 3;
          if (candSex === 1 || candSex === 2) {
            if (branchSex && branchSex !== candSex) {
              /* このブランチでは選べない → 次の候補へ */
              return true;
            }
            branchSex = candSex;
          }
        }

        /* --- 防御の枝刈り（def ソート時のみ） --- */
        if (ctx.sortBy === 'def' && threshold > -Infinity) {
          var maxDef = f.def + (cand.defense || 0) + suffixDef[part + 1];
          if (maxDef < threshold) {
            /* 候補列が防御降順のときだけ以降を打ち切れる。
               score 順のときはこの候補のみ捨てる（安全側）。 */
            if (ctx.candidateOrder === 'def') f.idx = list.length;
            return true;
          }
        }

        /* --- 必須ptの枝刈り --- */
        var torsoUp = f.torsoUp;
        var bodyMult = 1;
        var pts = f.pts;
        var candPts = cand._pts;
        var i;

        /* 胴系統倍加数の更新（胴=1 は除く） */
        if (part < 5 && part !== PART_BODY && cand.torsoUp) torsoUp = f.torsoUp + 1;

        /* 部分和の計算（胴は D 倍） */
        var newPts = ptsPool.length ? ptsPool.pop() : zeroArr(sysCount);
        var feasible = true;
    
        if (part < 5) {
          bodyMult = 1 + torsoUp;
          /* 胴は後続部位の胴系統倍加で最大 5 倍まで伸びるため楽観的に見積もる */
          var bodyEstMult = (part === PART_BODY) ? Math.max(bodyMult, 5) : 1;
          for (i = 0; i < sysCount; i++) {
            var cv = candPts[i];
            newPts[i] = pts[i] + (part === PART_BODY ? cv * bodyEstMult : cv);
          }
        } else {
          /* 護石はこの時点で倍率未確定（ネセト判定後）なので素のまま加算 */
          var cpts2 = cand._pts;
          if (cpts2) {
            for (i = 0; i < sysCount; i++) newPts[i] = pts[i] + cpts2[i];
          } else {
            for (i = 0; i < sysCount; i++) newPts[i] = pts[i] + num(cand.skills[sysNames[i]], 0);
          }
        }

        /* --- 未充足チェック（装飾品での補填余地を上界として加味） --- */
        /* 使用可能スロット容量（サイズ合計）。胴は最大 5 倍、残り部位は最大容量。
           護石スロットも上界に含める（含めないと「護石3スロに装飾品を挿して
           発動する」構成が上界枝刈りで落ちてしまう）。 */
        var units = ctx.weaponSlotUnits;
        for (var cp = 0; cp < part; cp++) {
          var ch = stack[cp].chosen;
          if (!ch) continue;
          units += slotSizeSum(ch) * (cp === PART_BODY ? 5 : 1);
        }
        if (part < 5) {
          units += slotSizeSum(cand) * (part === PART_BODY ? 5 : 1);
          /* 未選択の護石は最大容量（ネセト時の 2 倍込み）で楽観的に見積もる */
          units += ctx.maxCharmSlotUnits * NESET_CHARM_MULT;
        } else {
          /* part===5: 選択した護石自身のスロット（倍率は最大 2 倍で見積もる） */
          units += slotSizeSum(cand) * NESET_CHARM_MULT;
        }
        for (var rp = part + 1; rp < 5; rp++) {
          units += ctx.maxSlotUnits[rp] * (rp === PART_BODY ? 5 : 1);
        }
        var needFromDeco = 0;
        for (i = 0; i < sysCount; i++) {
          var need = reqArr[i];
          if (need <= 0) continue;
          var have = newPts[i];
          var maxRest = suffixPts[part + 1][i];
          /* ネセト一式のスキル加点+2 は装飾品容量とは別枠で乗るため、
             上界では楽観的に +2 を見込む（見込まないと「護石3スロの
             装飾品 + ネセト加点」でちょうど届く構成が落ちる）。 */
          var gap = need - have - maxRest - NESET_BONUS_PT;
          if (gap > 0) {
            var ratio = ratioArr[i] || 0.5;
            if (gap > units * ratio + 1e-9) { feasible = false; stats.prunedPt++; break; }
            needFromDeco += gap;
          }
        }
        if (feasible && needFromDeco > 0) {
          if (needFromDeco > units * ctx.maxDecoRatio + 1e-9) { feasible = false; stats.prunedPt++; }
        }

        if (!feasible) return true;

        /* 葉（護石まで選んだ）→ 判定 */
        if (part === 5) {
          nodes++;
          evaluate(part, newPts, torsoUp, cand);
          ptsPool.push(newPts);
          return true;
        }

        f.chosen = cand;
        pushFrame(part + 1, f.def + (cand.defense || 0), newPts, torsoUp, branchSex);
        ptsPool.push(newPts);
        return true;
      }

      /* 5部位 + 護石 が確定した時点の評価 */
      function evaluate(part, ptsWithCharm, torsoUpCount0, charm) {
        var parts = evalPartsBuf;
        parts[0] = stack[0].chosen; parts[1] = stack[1].chosen; parts[2] = stack[2].chosen;
        parts[3] = stack[3].chosen; parts[4] = stack[4].chosen;
        evaluateCombo(parts, charm);
      }

      function evaluateCombo(parts, charm) {
        stats.leaves++;
        if (!parts[0] || !parts[1] || !parts[2] || !parts[3] || !parts[4]) return;
        /* 性別の最終ガード: 男専用と女専用が同一セットに混在する解は絶対に採らない */
        if (!sexCompatible(parts, ctx.gender)) { stats.sexMixed = (stats.sexMixed || 0) + 1; return; }
        var torsoUpCount = 0;
        for (var tp = 0; tp < 5; tp++) {
          if (tp !== PART_BODY && parts[tp].torsoUp) torsoUpCount++;
        }
        var isNeset = detectNeset(parts, ctx.equipType);
        var D = 1 + torsoUpCount;
        var charmMult = isNeset ? NESET_CHARM_MULT : 1;
        var i, k, pi;

        /* 素点（倍率適用）を再利用配列に積む */
        var base = ctx.__base;
        for (i = 0; i < sysCount; i++) base[i] = 0;
        for (pi = 0; pi < 5; pi++) {
          if (!parts[pi]) continue;
          var ap = parts[pi]._pts;
          if (!ap) continue;         /* 防御的ガード（正規化前の部位でも落ちない） */
          if (pi === PART_BODY) {
            if (D !== 1) for (i = 0; i < sysCount; i++) base[i] += ap[i] * D;
            else for (i = 0; i < sysCount; i++) base[i] += ap[i];
          } else {
            for (i = 0; i < sysCount; i++) base[i] += ap[i];
          }
        }
        var cs = charm._pts;
        if (cs) {
          for (i = 0; i < sysCount; i++) base[i] += cs[i] * charmMult;
        }

        var slotCount = fillSlots(ctx, ctx.weaponSizes, parts, charm, torsoUpCount, isNeset);
        var needArr = ctx.__need;
        var solved = null;
        var totals = null;
        var bonus = null;
        var decoTotal = new Array(sysCount);
        var attemptCount = isNeset ? 2 : 1;
        var attempt;

        /* ネセト一式の「スキル加点+2」は、装備＋護石＋装飾品の合算が
           正（1pt 以上）の系統にのみ乗る。加点の有無で必要ptが変わるため、
           楽観解 → 加点確定解 の順に解き直し、実際の合算で検証して採用する。
           （solveDecos と buildResult で必要ptが食い違わないようにする） */
        for (attempt = 0; attempt < attemptCount; attempt++) {
          var deficit = 0;
          for (i = 0; i < sysCount; i++) {
            if (reqArr[i] <= 0) { needArr[i] = 0; continue; }
            var bonusGuess = 0;
            if (isNeset) {
              if (attempt === 0) bonusGuess = NESET_BONUS_PT;
              else bonusGuess = base[i] > 0 ? NESET_BONUS_PT : 0;
            }
            var rem = reqArr[i] - base[i] - bonusGuess;
            needArr[i] = rem;
            if (rem > 0) deficit += rem;
          }
          var candSolved = deficit <= 0 ? EMPTY_SOLUTION : solveDecos(ctx, needArr, ctx.slotPool, slotCount);
          if (!candSolved) continue;

          /* 実際の装飾品ポイントを集計 */
          for (i = 0; i < sysCount; i++) decoTotal[i] = 0;
          for (var ai0 = 0; ai0 < candSolved.assignments.length; ai0++) {
            var asg0 = candSolved.assignments[ai0];
            var ds0 = asg0.deco.systemSkills;
            for (k in ds0) {
              if (!own(ds0, k)) continue;
              var si0 = ctx.sysIndex[k];
              if (si0 === undefined) continue;
              decoTotal[si0] += ds0[k] * asg0.slot.mult;
            }
          }
          var nextBonus = zeroArr(sysCount);
          var nextTotals = new Array(sysCount);
          var okAll = true;
          for (i = 0; i < sysCount; i++) {
            var combined = base[i] + decoTotal[i];
            nextBonus[i] = (isNeset && combined >= NESET_BONUS_MIN_PT) ? NESET_BONUS_PT : 0;
            nextTotals[i] = combined + nextBonus[i];
            if (reqArr[i] > 0 && nextTotals[i] < reqArr[i]) okAll = false;
          }
          if (!okAll) { stats.verifyFail++; continue; }
          solved = candSolved;
          totals = nextTotals;
          bonus = nextBonus;
          break;
        }
        if (!solved) { stats.decoFail++; return; }

        /* --- ここから成功時のみの重い処理 --- */
        var decoByPart = [[], [], [], [], [], [], []];
        var decoPtsByPart = [];
        for (i = 0; i < 7; i++) decoPtsByPart.push(zeroArr(sysCount));
        for (var ai = 0; ai < solved.assignments.length; ai++) {
          var asg = solved.assignments[ai];
          if (!asg || !asg.slot || !asg.deco) continue;   /* 防御的ガード */
          var dpi = asg.slot.part;
          var deco = asg.deco;
          if (!decoByPart[dpi]) decoByPart[dpi] = [];
          decoByPart[dpi].push(deco);
          var dsk = deco.systemSkills;
          for (k in dsk) {
            if (!own(dsk, k)) continue;
            var si = ctx.sysIndex[k];
            if (si === undefined) continue;
            decoPtsByPart[dpi][si] += dsk[k] * asg.slot.mult;
          }
        }

        var defense = 0;
        for (pi = 0; pi < 5; pi++) defense += parts[pi].defense || 0;

        /* 防御しきい値（def ソート時） */
        if (ctx.sortBy === 'def' && resultCount >= ctx.maxResults && defense <= threshold) { stats.thresholdSkip++; return; }

        var resist = [0, 0, 0, 0, 0];
        for (pi = 0; pi < 5; pi++) {
          var rr = parts[pi].resistances || EMPTY5;
          for (i = 0; i < 5; i++) resist[i] += rr[i] || 0;
        }

        /* 部位別素点（結果用にコピー） */
        var partBase = [];
        for (pi = 0; pi < 5; pi++) {
          var arr = zeroArr(sysCount);
          var mult = (pi === PART_BODY) ? D : 1;
          for (i = 0; i < sysCount; i++) arr[i] = parts[pi]._pts[i] * mult;
          partBase.push(arr);
        }
        var charmBase = zeroArr(sysCount);
        for (i = 0; i < sysCount; i++) charmBase[i] = (charm._pts ? charm._pts[i] : 0) * charmMult;
        /* bonus は上で「合算 > 0」判定済み（護石・装飾品込み） */
        if (!bonus) bonus = zeroArr(sysCount);

        /* スロット情報のコピー（プールは再利用されるため） */
        var slotCopies = new Array(slotCount);
        for (i = 0; i < slotCount; i++) {
          var ps = ctx.slotPool[i];
          slotCopies[i] = { size: ps.size, part: ps.part, mult: ps.mult };
        }
        var solvedCopies = { assignments: [], used: solved.assignments.length };
        for (i = 0; i < solved.assignments.length; i++) {
          var a2 = solved.assignments[i];
          var sIdx = a2.slotIndex !== undefined ? a2.slotIndex : i;
          solvedCopies.assignments.push({ slot: slotCopies[sIdx], slotIndex: sIdx, deco: a2.deco });
        }

        var res = buildResult(ctx, {
          parts: parts.slice(),
          charm: charm,
          isNeset: isNeset,
          torsoUpCount: torsoUpCount,
          D: D,
          defense: defense,
          resist: resist,
          base: base.slice(),
          partBase: partBase,
          charmBase: charmBase,
          bonus: bonus,
          totals: totals,
          decoByPart: decoByPart,
          decoPtsByPart: decoPtsByPart,
          slots: slotCopies,
          solved: solvedCopies
        });

        /* 同一構成の重複を排除 */
        var dkey = parts[0].name + '|' + parts[1].name + '|' + parts[2].name + '|' + parts[3].name + '|' + parts[4].name +
          '|' + charm.name + '|' + solved.assignments.map(function (a3) { return a3.slot.part + ':' + a3.deco.name; }).sort().join(',');
        if (seenKeys[dkey]) return;
        seenKeys[dkey] = 1;
        results.push(res);
        resultCount++;
        stats.accepted++;
        if (stats.accepted <= 30) stats.acceptedAt.push(stats.leaves);
        if (ctx.sortBy === 'def' && resultCount >= ctx.maxResults) {
          threshold = computeThreshold(results, ctx.maxResults);
        }
        if (resultCount > ctx.maxResults * 40) prunedByLimit = true;
      }

      return {
        step: function (deadline) {
          var guard = 0;
          while (true) {
            for (var gi = 0; gi < 512; gi++) {
              if (finished) return { done: true, results: results };
              advance();
            }
            if (prunedByLimit) { finished = true; return { done: true, results: results }; }
            if (ctx.maxNodes && nodes > ctx.maxNodes) { finished = true; return { done: true, results: results }; }
            if (now() >= deadline) break;
            if (ctx.timeLimitMs && (now() - startedAt) > ctx.timeLimitMs) { finished = true; return { done: true, results: results }; }
          }
          return {
            done: false,
            progress: estimateProgress(stack, lists, charms),
            results: results,
            found: resultCount
          };
        },
        finish: function () {
          return { done: true, results: results };
        },
        getResults: function () { return results; },
        isDone: function () { return finished; },
        stats: stats
      };
    }

    function zeroArr(n) {
      var a = new Array(n);
      for (var i = 0; i < n; i++) a[i] = 0;
      return a;
    }

    function estimateProgress(stack, lists, charms) {
      if (!stack.length) return 100;
      var total = 0, done = 0;
      for (var i = 0; i < stack.length; i++) {
        var f = stack[i];
        var len = f.part < 5 ? lists[f.part].length : charms.length;
        total += len || 1;
        done += Math.max(0, f.idx);
      }
      if (stack.length < 6) total += 1;
      var p = total > 0 ? (done / total) : 0;
      /* 深さも加味 */
      p = p * 0.85 + (stack.length / 6) * 0.15;
      return Math.max(0, Math.min(99, Math.round(p * 100)));
    }

    function computeThreshold(results, maxResults) {
      var defs = [];
      for (var i = 0; i < results.length; i++) defs.push(results[i].defense);
      defs.sort(function (a, b) { return b - a; });
      if (defs.length <= maxResults) return -Infinity;
      return defs[maxResults - 1];
    }

    function detectNeset(parts, equipType) {
      var names = NESET_SETS[equipType === 2 ? 2 : 1];
      for (var i = 0; i < 5; i++) {
        if (!parts[i] || parts[i].name !== names[i]) return false;
      }
      return true;
    }

    /* 1 セット内に男性専用(sex=1)と女性専用(sex=2)が混在していないか。
       gender=1 なら女性専用を、gender=2 なら男性専用を含むセットを拒否する。 */
    function sexCompatible(parts, gender) {
      var male = false, female = false;
      for (var i = 0; i < 5; i++) {
        var s = parts[i] ? (parts[i].gender | 0) : 3;
        if (s === 1) male = true;
        else if (s === 2) female = true;
        if (male && female) return false;
      }
      if (gender === 1 && female) return false;
      if (gender === 2 && male) return false;
      return true;
    }

    /* ================================================================== *
     * 結果オブジェクト構築
     * ================================================================== */
    function buildResult(ctx, info) {
      var m = ctx.model;
      var sysNames = ctx.sysNames;
      var sysCount = ctx.sysCount;
      var i, k;

      var equipments = {
        weapon: {
          name: ctx.weaponName,
          part: PART_WEAPON,
          slots: ctx.weaponSlots,
          slotSizes: ctx.weaponSizes.slice(),
          decos: [],
          skills: {},
          points: {},
          defense: 0,
          resistances: [0, 0, 0, 0, 0],
          multiplier: 1,
          torsoUp: false,
          gender: 3,
          alternatives: []
        },
        head: null, body: null, arm: null, waist: null, legs: null, charm: null
      };

      var partKeys = ['head', 'body', 'arm', 'waist', 'legs'];
      for (i = 0; i < 5; i++) {
        var a = info.parts[i];
        if (!a) continue;
        var partSizes = a.slotSizes ? a.slotSizes.slice() : (a.slots ? [a.slots] : []);
        var partHoles = a.slots != null ? (a.slots | 0) : partSizes.reduce(function (s, x) { return s + (x | 0); }, 0);
        equipments[partKeys[i]] = {
          name: a.name,
          part: i,
          slots: partHoles,
          slotSizes: partSizes,
          decos: (info.decoByPart[i] || []).slice(),
          skills: a.skills || {},
          points: a.skills || {},
          defense: a.defense || 0,
          resistances: a.resistances || [0, 0, 0, 0, 0],
          torsoUp: !!a.torsoUp,
          multiplier: (i === PART_BODY && info.D > 1) ? info.D : 1,
          gender: a.gender | 0,
          alternatives: buildAlternatives(ctx, i, a)
        };
      }
      equipments.weapon.decos = (info.decoByPart[PART_WEAPON] || []).slice();
      var charmSizes = info.charm.slotSizes ? info.charm.slotSizes.slice()
        : (info.charm.slots ? [info.charm.slots] : []);
      var charmHoles = info.charm.slots != null ? (info.charm.slots | 0) : charmSizes.reduce(function (s, x) { return s + (x | 0); }, 0);
      equipments.charm = {
        name: info.charm.name || 'なし',
        slots: charmHoles,
        slotSizes: charmSizes,
        decos: (info.decoByPart[PART_CHARM] || []).slice(),
        skills: info.charm.skills || {},
        defense: 0,
        resistances: [0, 0, 0, 0, 0],
        multiplier: info.isNeset ? NESET_CHARM_MULT : 1,
        alternatives: []
      };
      /* UI / 呼び出し側が 'leg' / 'legs' のどちらでも脚部位を引けるようにする */
      equipments.leg = equipments.legs;

      /* ---- スキルマトリクス ---- */
      var matrix = [];
      for (i = 0; i < sysCount; i++) {
        var sysName = sysNames[i];
        var row = {
          system: sysName,
          requiredPt: ctx.reqArr[i],
          totalPt: info.totals[i],
          activated: ctx.reqArr[i] > 0 ? info.totals[i] >= ctx.reqArr[i] : false,
          activatedSkills: [],
          parts: {},
          basePt: info.base[i],
          bonusPt: info.bonus[i],
          /* ネセト一式の「スキル加点+2」（合算 > 0 の系統のみ 2、それ以外は 0） */
          secretBonus: (info.isNeset && info.totals[i] >= NESET_BONUS_MIN_PT) ? NESET_BONUS_PT : 0
        };
        var partNames = ['head', 'body', 'arm', 'waist', 'legs', 'charm', 'weapon'];
        var decoIdx = [0, 1, 2, 3, 4, PART_CHARM, PART_WEAPON];
        for (var pi = 0; pi < 7; pi++) {
          var baseV = pi < 5 ? info.partBase[pi][i] : (pi === 5 ? info.charmBase[i] : 0);
          var decoV = info.decoPtsByPart[decoIdx[pi]][i];
          row.parts[partNames[pi]] = {
            base: baseV,
            deco: decoV,
            total: baseV + decoV
          };
        }
        row.decoPt = row.parts.head.deco + row.parts.body.deco + row.parts.arm.deco +
          row.parts.waist.deco + row.parts.legs.deco + row.parts.charm.deco + row.parts.weapon.deco;
        /* 発動スキル */
        var sys = m.skills.systems[sysName];
        if (sys) {
          var act = pickActivatedSkills(sys, info.totals[i]);
          row.activatedSkills = act;
          row.activated = act.length > 0 && (ctx.reqArr[i] > 0 ? info.totals[i] >= ctx.reqArr[i] : true);
        }
        matrix.push(row);
      }

      /* ---- 発動スキル一覧（必須以外の系統も含む） ---- */
      var activatedSkills = [];
      var allTotals = {};
      for (i = 0; i < sysCount; i++) allTotals[sysNames[i]] = info.totals[i];
      /* 必須外の系統（装備・護石・装飾品に含まれるもの） */
      var extraSystems = collectOtherSystems(ctx, info);
      for (k in extraSystems) {
        if (!own(extraSystems, k)) continue;
        if (own(allTotals, k)) continue;
        allTotals[k] = extraSystems[k];
      }
      for (k in allTotals) {
        if (!own(allTotals, k)) continue;
        var syso = m.skills.systems[k];
        if (!syso) continue;
        var acts = pickActivatedSkills(syso, allTotals[k]);
        for (var ai = 0; ai < acts.length; ai++) {
          activatedSkills.push({
            name: acts[ai].name,
            system: k,
            points: acts[ai].points,
            totalPt: allTotals[k],
            isNegative: acts[ai].points < 0
          });
        }
      }

      /* ---- 空きスロット（残り穴数ベース） ----
         MHXX はスロット Lv ではなく穴数で管理するため、
         「スロ3 に【1】珠 1 個」なら残り 2 穴として扱う。 */
      var freeSlotDetail = { weapon: 0, head: 0, body: 0, arm: 0, waist: 0, legs: 0, charm: 0 };
      var remaining = new Array(info.slots.length);
      for (i = 0; i < info.slots.length; i++) remaining[i] = info.slots[i].size | 0;
      for (i = 0; i < info.solved.assignments.length; i++) {
        var asg = info.solved.assignments[i];
        var asgIdx = asg.slotIndex;
        if (asgIdx === undefined || asgIdx === null) {
          /* slotIndex が無い古い解でも、スロット実体から使用位置を特定する */
          var foundIdx = info.slots.indexOf(asg.slot);
          asgIdx = foundIdx >= 0 ? foundIdx : -1;
        }
        if (asgIdx < 0 || asgIdx >= remaining.length) continue;
        var dsz = (asg.deco && asg.deco.size) ? asg.deco.size : 1;
        remaining[asgIdx] -= dsz;
        if (remaining[asgIdx] < 0) remaining[asgIdx] = 0;
      }
      var freeSlotList = [];
      var totalSlots = 0;
      var usedSlots = 0;
      var freeSlots = 0;
      for (i = 0; i < info.slots.length; i++) {
        var capSize = info.slots[i].size | 0;
        totalSlots += capSize;
        usedSlots += capSize - remaining[i];
        if (remaining[i] > 0) {
          freeSlotList.push({
            size: remaining[i],
            part: info.slots[i].part,
            mult: info.slots[i].mult || 1,
            slotIndex: i,
            capacity: capSize
          });
          var fk = PART_KEYS[info.slots[i].part];
          if (fk) freeSlotDetail[fk] = (freeSlotDetail[fk] || 0) + remaining[i];
          freeSlots += remaining[i];
        }
      }
      freeSlotDetail.leg = freeSlotDetail.legs;

      /* ---- 追加提案（実際の空きスロ形状で装着可否を検証） ---- */
      var extraSuggestions = [];
      if (ctx.includeExtra) {
        extraSuggestions = buildExtraSuggestions(ctx, info, allTotals, freeSlotList);
      }

      var resistSum = 0;
      for (i = 0; i < 5; i++) resistSum += info.resist[i];

      return {
        isNeset: info.isNeset,
        nesetBonus: info.isNeset ? NESET_BONUS_PT : 0,
        torsoUpCount: info.torsoUpCount,
        torsoUpMultiplier: info.D,
        defense: info.defense,
        resistances: info.resist.slice(),
        resistSum: resistSum,
        equipments: equipments,
        /* UI が result.parts を参照しても同じ装備情報・スロット・装飾品・
           部位別スキルpt・代替候補(alternatives) を取得できるよう同一実体を公開 */
        parts: equipments,
        skillMatrix: matrix,
        skills: allTotals,
        totals: allTotals,
        activatedSkills: activatedSkills,
        extraSuggestions: extraSuggestions,
        freeSlots: freeSlots,
        emptySlots: freeSlots,
        freeSlotDetail: freeSlotDetail,
        freeSlotList: freeSlotList,
        totalSlots: totalSlots,
        usedSlots: usedSlots,
        missingSkills: ctx.missingSkills.slice(),
        equipType: ctx.equipType,
        gender: ctx.gender,
        weaponSlots: ctx.weaponSlots
      };
    }

    /* 同一性能キー（系統pt / スロ / 倍加 / ネセト属性が一致）の代替候補。
       差し替えても同じ検索結果が成立する装備だけを返す。 */
    function buildAlternatives(ctx, part, armor) {
      var out = [];
      if (!armor || !armor._key) return out;
      var groups = ctx.altByPart && ctx.altByPart[part];
      var group = groups && groups[armor._key];
      if (!group || !group.length) return out;
      var ownSex = armor.gender === 1 ? 1 : (armor.gender === 2 ? 2 : 3);
      for (var i = 0; i < group.length && out.length < 4; i++) {
        var x = group[i];
        if (!x || x.name === armor.name) continue;
        /* 差し替えても性別の混在が起きないものだけを候補にする */
        if (ctx.gender === 1 && x._sex === 2) continue;
        if (ctx.gender === 2 && x._sex === 1) continue;
        if (x._sex === 1 && ownSex === 2) continue;
        if (x._sex === 2 && ownSex === 1) continue;
        out.push({
          name: x.name,
          slots: x.slots,
          slotSizes: x.slotSizes ? x.slotSizes.slice() : (x.slots ? [x.slots] : []),
          defense: x.defense || 0,
          resistances: x.resistances || [0, 0, 0, 0, 0],
          skills: x.skills || {},
          points: x.skills || {},
          gender: x.gender | 0,
          torsoUp: !!x.torsoUp
        });
      }
      return out;
    }

    function pickActivatedSkills(sys, pts) {
      var out = [];
      if (pts > 0) {
        var best = null;
        for (var i = 0; i < sys.positive.length; i++) {
          var s = sys.positive[i];
          if (s.points <= pts && (!best || s.points > best.points)) best = s;
        }
        if (best) out.push(best);
      } else if (pts < 0) {
        var worst = null;
        for (var j = 0; j < sys.negative.length; j++) {
          var n = sys.negative[j];
          if (n.points >= pts && (!worst || n.points < worst.points)) worst = n;
        }
        if (worst) out.push(worst);
      }
      return out;
    }

    function collectOtherSystems(ctx, info) {
      var out = {};
      var i, k;
      var sysNames = ctx.sysNames;
      var reqSet = {};
      for (i = 0; i < sysNames.length; i++) reqSet[sysNames[i]] = 1;

      function addSkills(skills, mult) {
        if (!skills) return;
        for (var key in skills) {
          if (!own(skills, key)) continue;
          var sysName = ctx.model.systemAlias[key] || ctx.model.systemAlias[normKey(key)] || key;
          if (reqSet[sysName]) continue;
          out[sysName] = (out[sysName] || 0) + num(skills[key], 0) * (mult || 1);
        }
      }
      var bodyMult = 1 + info.torsoUpCount;
      for (i = 0; i < 5; i++) {
        addSkills(info.parts[i].skills, i === PART_BODY ? bodyMult : 1);
      }
      addSkills(info.charm.skills, info.isNeset ? NESET_CHARM_MULT : 1);
      /* 装飾品 */
      for (i = 0; i < info.solved.assignments.length; i++) {
        var asg = info.solved.assignments[i];
        if (!asg || !asg.slot || !asg.deco) continue;
        var sk = {};
        for (k in asg.deco.systemSkills) if (own(asg.deco.systemSkills, k)) sk[k] = asg.deco.systemSkills[k];
        addSkills(sk, asg.slot.mult || 1);
      }
      if (info.isNeset) {
        /* 「合算 > 0」の系統のみ加点（マイナス系統を 0 に持ち上げない） */
        for (k in out) if (own(out, k) && out[k] >= NESET_BONUS_MIN_PT) out[k] += NESET_BONUS_PT;
      }
      return out;
    }

    /* ---- 追加スキル提案 ----
       ・「合計空きスロ数」ではなく、実際に残っているスロット 1 本ずつの
         サイズ・部位・倍率で装着可能かを判定する（1スロ×3 に 3スロ珠は入らない）。
       ・追加する装飾品のマイナススキルで必須スキルが閾値を割る場合は、
         余剰 pt で耐えられるか、残りの空きスロで補填できるかを検証する。
       ・上記を通過した提案だけを返す（クリックして条件追加しても必ず解が存在する）。 */
    function buildExtraSuggestions(ctx, info, totals, freeSlotList) {
      var m = ctx.model;
      var out = [];
      var usedSystems = {};
      var i, k;
      for (i = 0; i < ctx.sysNames.length; i++) usedSystems[ctx.sysNames[i]] = 1;

      var free = (freeSlotList || []).slice();
      if (!free.length) return out;
      free.sort(function (x, y) {
        return (y.size * (y.mult || 1)) - (x.size * (x.mult || 1));
      });

      /* 必須系統（現在プレイヤーが要求しているスキル）の必要pt */
      var reqMap = {};
      for (i = 0; i < ctx.sysNames.length; i++) {
        if (ctx.reqArr[i] > 0) reqMap[ctx.sysNames[i]] = ctx.reqArr[i];
      }

      var systems = m.skills.systems;
      for (k in systems) {
        if (!own(systems, k)) continue;
        if (usedSystems[k]) continue;
        var sys = systems[k];
        if (!sys || !sys.positive || !sys.positive.length) continue;
        var lowSkill = sys.positive[sys.positive.length - 1];
        var needed = sys.minPositive > 0 ? sys.minPositive : lowSkill.points;
        if (!needed || needed <= 0) continue;
        var current = num(totals[k], 0);
        if (current >= needed) continue;
        var bestTbl = m.bestDecoBySystem[k];
        if (!bestTbl) continue;
        var hasDeco = false;
        for (var z = 1; z <= 3; z++) if (bestTbl[z]) hasDeco = true;
        if (!hasDeco) continue;

        var plan = planDecosForSystem(k, needed - current, free, bestTbl);
        if (!plan) continue;
        var check = verifySuggestionPlan(ctx, free, plan, totals, reqMap, needed, k);
        if (!check.ok) continue;

        out.push({
          skillName: lowSkill.name,
          name: lowSkill.name,
          systemName: k,
          group: k,
          threshold: needed,
          neededPt: needed,
          currentPt: current,
          deficitPt: needed - current,
          requiredSlots: check.used,
          freeSlotsLeft: check.freeLeft,
          verified: true,
          reason: current > 0
            ? ('残り' + (needed - current) + 'pt / 空き' + check.used + 'スロ')
            : ('空き' + check.used + 'スロ'),
          decos: plan.decos.map(function (d) { return d.deco.name; })
        });
      }

      out.sort(function (a, b) {
        if (a.requiredSlots !== b.requiredSlots) return a.requiredSlots - b.requiredSlots;
        return b.currentPt - a.currentPt;
      });
      return out.slice(0, 24);
    }

    /* 指定系統の不足ptを、実際の空きスロットだけを使って補う計画を立てる */
    function planDecosForSystem(sysName, deficit, freeSlots, bestTbl) {
      var left = deficit;
      var used = 0;
      var decos = [];
      var taken = new Array(freeSlots.length);
      var guard = 0;
      while (left > 0 && guard++ < 16) {
        var bestIdx = -1, bestDeco = null, bestPts = 0;
        for (var i = 0; i < freeSlots.length; i++) {
          if (taken[i]) continue;
          var slot = freeSlots[i];
          if (!slot) continue;
          var maxSize = Math.min(3, slot.size | 0);
          for (var sz = maxSize; sz >= 1; sz--) {
            var d = bestTbl[sz];
            if (!d || d.size > slot.size) continue;
            var p = (d.systemSkills[sysName] || 0) * (slot.mult || 1);
            if (p > bestPts) { bestPts = p; bestIdx = i; bestDeco = d; }
          }
        }
        if (!bestDeco || bestPts <= 0) break;
        taken[bestIdx] = 1;
        decos.push({ deco: bestDeco, slot: freeSlots[bestIdx], pts: bestPts });
        left -= bestPts;
        used++;
      }
      if (left > 0) return null;
      return { used: used, decos: decos, taken: taken };
    }

    /* 提案プランを実際に適用し、必須スキルを壊さないか・最終的に発動するかを検証する */
    function verifySuggestionPlan(ctx, freeSlots, plan, totals, reqMap, needed, sysName) {
      var work = {};
      var k, i, j;
      for (k in totals) if (own(totals, k)) work[k] = num(totals[k], 0);

      var takenIdx = [];
      for (i = 0; i < plan.decos.length; i++) {
        var pd = plan.decos[i];
        for (j = 0; j < freeSlots.length; j++) {
          if (freeSlots[j] === pd.slot) { takenIdx.push(j); break; }
        }
        var ds = pd.deco.systemSkills;
        for (k in ds) if (own(ds, k)) work[k] = (work[k] || 0) + ds[k] * (pd.slot.mult || 1);
      }

      /* 追加した系統自身が閾値に届くか */
      if (num(work[sysName], 0) < needed) return { ok: false, used: plan.used, freeLeft: 0 };

      /* 既存の必須スキルを割り込ませていないか */
      var short = [];
      for (k in reqMap) {
        if (!own(reqMap, k)) continue;
        var v = num(work[k], 0);
        if (v < reqMap[k]) short.push({ system: k, need: reqMap[k] - v });
      }
      if (short.length) {
        var rest = [];
        for (j = 0; j < freeSlots.length; j++) if (takenIdx.indexOf(j) < 0) rest.push(freeSlots[j]);
        for (i = 0; i < short.length; i++) {
          if (!rest.length) return { ok: false, used: plan.used, freeLeft: 0 };
          var patch = planDecosForSystem(short[i].system, short[i].need, rest,
            ctx.model.bestDecoBySystem[short[i].system]);
          if (!patch) return { ok: false, used: plan.used, freeLeft: 0 };
          for (var pi2 = 0; pi2 < patch.decos.length; pi2++) {
            var pp = patch.decos[pi2];
            for (j = 0; j < rest.length; j++) { if (rest[j] === pp.slot) { rest.splice(j, 1); break; } }
            var pds = pp.deco.systemSkills;
            for (k in pds) if (own(pds, k)) work[k] = (work[k] || 0) + pds[k] * (pp.slot.mult || 1);
          }
        }
        /* 補填後の最終確認 */
        for (k in reqMap) {
          if (!own(reqMap, k)) continue;
          if (num(work[k], 0) < reqMap[k]) return { ok: false, used: plan.used, freeLeft: 0 };
        }
        if (num(work[sysName], 0) < needed) return { ok: false, used: plan.used, freeLeft: 0 };
      }
      return { ok: true, used: plan.used, freeLeft: freeSlots.length - takenIdx.length };
    }

    /* ================================================================== *
     * 公開 API
     * ================================================================== */
    var api = {
      version: VERSION,
      partKeys: PART_KEYS.slice(),
      partLabels: PART_LABELS.slice(),
      nesetSets: clone(NESET_SETS)
    };

    api.setData = function (data) {
      rawData = data || null;
      modelDirty = true;
      model = null;
      return api;
    };
    api.getRawData = function () { return rawData || detectRawData(); };
    api.getData = function () { return ensureModel(); };
    api.ensureData = function () { ensureModel(); return api; };

    api.listSkills = function () {
      return ensureModel().skills.list.slice();
    };
    api.listSystems = function () {
      var m = ensureModel();
      var out = [];
      for (var k in m.skills.systems) {
        if (!own(m.skills.systems, k)) continue;
        out.push({
          name: k,
          skills: m.skills.systems[k].skills.slice(),
          minPositive: m.skills.systems[k].minPositive
        });
      }
      out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      return out;
    };
    api.findSkill = function (name) {
      return resolveSkill(ensureModel(), name);
    };
    api.findSystem = function (name) {
      return resolveSystem(ensureModel(), name);
    };

    /* 検索前の準備情報（デバッグ・UI 表示用） */
    api.prepare = function (options) {
      var ctx = buildContext(options);
      var cands = [];
      var candNames = [];
      for (var i = 0; i < 5; i++) {
        cands.push(ctx.candidates[i].length);
        candNames.push(ctx.candidates[i].map(function (a) { return a.name; }));
      }
      return {
        systems: ctx.sysNames.slice(),
        requiredPoints: ctx.reqArr.slice(),
        missingSkills: ctx.missingSkills.slice(),
        candidateCounts: cands,
        candidateNames: candNames,
        charmCount: ctx.charms.length,
        weaponSlots: ctx.weaponSlots,
        sortBy: ctx.sortBy,
        maxResults: ctx.maxResults
      };
    };

    /* --- 同期検索 --- */
    api.searchSync = function (options) {
      var ctx = buildContext(options);
      var task = createSearchTask(ctx);
      var step;
      do {
        step = task.step(now() + 1000000);
      } while (!step.done);
      var out = finalize(ctx, step.results);
      out.stats = task.stats;
      return out;
    };
    /* どの呼び出し方でも落ちないよう search / run / simulate も別名で公開する */
    api.search = api.searchSync;
    api.run = api.searchSync;
    api.simulate = api.searchSync;

    /* --- 非同期検索（Worker / タイムスライス自動切替） --- */
    api.searchAsync = function (options, onProgress) {
      var cancelled = false;
      var worker = null;
      var timer = null;
      var workerReady = false;
      var bootTimer = null;
      var resolveFn = null;
      var rejectFn = null;
      var settled = false;

      var promise = new Promise(function (resolve, reject) {
        resolveFn = resolve;
        rejectFn = reject;
      });
      function settle(fn, v) {
        if (settled) return;
        settled = true;
        fn(v);
      }
      function cleanup() {
        if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
        if (timer) { clearTimeout(timer); timer = null; }
        if (worker) {
          try { worker.terminate(); } catch (e) { }
          worker = null;
        }
        if (activeCancel === cancel) activeCancel = null;
      }
      function cancel() {
        if (settled) return;
        cancelled = true;
        cleanup();
        settle(resolveFn, {
          cancelled: true,
          results: [],
          count: 0,
          elapsedMs: 0,
          options: options
        });
      }
      promise.cancel = cancel;
      promise.abort = cancel;
      activeCancel = cancel;

      var startedAt = now();
      /* file:// 直開きでは Blob Worker がブロックされる環境が多いため最初からタイムスライスを使う */
      var isFileProtocol = false;
      try {
        isFileProtocol = !!(global.location && global.location.protocol === 'file:');
      } catch (e) { isFileProtocol = false; }
      var useWorker = !isFileProtocol && api.__source && typeof Worker !== 'undefined' &&
        typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL &&
        !options.__noWorker && options.useWorker !== false;

      if (useWorker) {
        try {
          var code = buildWorkerSource();
          if (!code) throw new Error('worker source unavailable');
          var blob = new Blob([code], { type: 'application/javascript' });
          var url = URL.createObjectURL(blob);
          worker = new Worker(url);
          worker.onmessage = function (ev) {
            var msg = ev.data || {};
            if (msg.type === 'ready') {
              workerReady = true;
              if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
              worker.postMessage({ type: 'search', options: options });
              /* 応答が返らない場合の保険 */
              var wd = (options && options.timeLimitMs) ? options.timeLimitMs : 2000;
              bootTimer = setTimeout(function () {
                if (!settled) { cleanup(); runSliced(); }
              }, wd + 3000);
            } else if (msg.type === 'progress') {
              if (!cancelled && typeof onProgress === 'function') {
                try { onProgress(msg.value, msg.results || []); } catch (e) { }
              }
            } else if (msg.type === 'result') {
              cleanup();
              var res = msg.result || {};
              res.elapsedMs = now() - startedAt;
              settle(resolveFn, res);
            } else if (msg.type === 'error') {
              cleanup();
              settle(rejectFn, new Error(msg.message || 'worker error'));
            }
          };
          worker.onerror = function (e) {
            /* Worker 失敗 → フォールバック */
            cleanup();
            runSliced();
          };
          var raw = api.getRawData();
          /* Worker が応答しない環境（file:// 等）では自動フォールバック */
          workerReady = false;
          bootTimer = setTimeout(function () {
            if (!settled && !workerReady) {
              cleanup();
              runSliced();
            }
          }, WORKER_BOOT_TIMEOUT);
          worker.postMessage({ type: 'init', data: raw });
          return promise;
        } catch (e) {
          cleanup();
          /* フォールバックへ */
        }
      }
      runSliced();
      return promise;

      function runSliced() {
        if (cancelled) return;
        var ctx;
        try {
          ctx = buildContext(options);
        } catch (err) {
          cleanup();
          settle(rejectFn, err);
          return;
        }
        var task = createSearchTask(ctx);
        function tick() {
          if (cancelled) return;
          var step = task.step(now() + SLICE_MS);
          if (step.done) {
            cleanup();
            var res = finalize(ctx, step.results);
            res.elapsedMs = now() - startedAt;
            settle(resolveFn, res);
            return;
          }
          if (typeof onProgress === 'function') {
            try { onProgress(step.progress, step.results); } catch (e) { }
          }
          timer = setTimeout(tick, 0);
        }
        timer = setTimeout(tick, 0);
      }
    };

    api.cancel = function () {
      if (activeCancel) activeCancel();
      return api;
    };

    function finalize(ctx, results) {
      var list = results.slice();
      sortResults(list, ctx.sortBy);
      if (list.length > ctx.maxResults) list.length = ctx.maxResults;
      for (var i = 0; i < list.length; i++) list[i].index = i;
      return {
        cancelled: false,
        results: list,
        count: list.length,
        totalFound: results.length,
        sortBy: ctx.sortBy,
        equipType: ctx.equipType,
        gender: ctx.gender,
        weaponSlots: ctx.weaponSlots,
        requiredSkills: Object.keys(ctx.reqMap),
        requiredSystems: ctx.sysNames.slice(),
        requiredPoints: ctx.reqArr.slice(),
        missingSkills: ctx.missingSkills.slice(),
        elapsedMs: 0
      };
    }

    function sortResults(list, sortBy) {
      if (sortBy === 'slots' || sortBy === 'slotsUsed') {
        list.sort(function (a, b) {
          if (b.freeSlots !== a.freeSlots) return b.freeSlots - a.freeSlots;
          return b.defense - a.defense;
        });
      } else if (sortBy === 'resSum') {
        list.sort(function (a, b) {
          if (b.resistSum !== a.resistSum) return b.resistSum - a.resistSum;
          return b.defense - a.defense;
        });
      } else {
        list.sort(function (a, b) {
          if (b.defense !== a.defense) return b.defense - a.defense;
          return b.freeSlots - a.freeSlots;
        });
      }
    }

    /* 結果の内訳を再計算（デバッグ・検証用） */
    api.analyze = function (result) {
      if (!result) return null;
      var m = ensureModel();
      var totals = {};
      function add(skills, mult) {
        if (!skills) return;
        for (var k in skills) {
          if (!own(skills, k)) continue;
          var sys = m.systemAlias[k] || m.systemAlias[normKey(k)] || k;
          totals[sys] = (totals[sys] || 0) + num(skills[k], 0) * (mult || 1);
        }
      }
      var eq = result.equipments || result.parts || {};
      /* 胴系統倍加はネセトでも同じ（D = 1 + 倍加部位数） */
      var bodyMult = 1 + (result.torsoUpCount || 0);
      add(eq.head && eq.head.skills, 1);
      add(eq.body && eq.body.skills, bodyMult);
      add(eq.arm && eq.arm.skills, 1);
      add(eq.waist && eq.waist.skills, 1);
      add(eq.legs && eq.legs.skills, 1);
      add(eq.charm && eq.charm.skills, result.isNeset ? NESET_CHARM_MULT : 1);
      var keys = ['weapon', 'head', 'body', 'arm', 'waist', 'legs', 'charm'];
      for (var i = 0; i < keys.length; i++) {
        var part = eq[keys[i]];
        if (!part || !part.decos) continue;
        var mult = 1;
        if (keys[i] === 'body') mult = 1 + (result.torsoUpCount || 0);
        if (keys[i] === 'charm' && result.isNeset) mult = NESET_CHARM_MULT;
        for (var d = 0; d < part.decos.length; d++) add(part.decos[d].systemSkills || part.decos[d].skills, mult);
      }
      if (result.isNeset) {
        /* 「合算 > 0」の系統のみスキル加点+2 */
        for (var k2 in totals) if (own(totals, k2) && totals[k2] >= NESET_BONUS_MIN_PT) totals[k2] += NESET_BONUS_PT;
      }
      return totals;
    };

    /* --- Worker ソース生成 ---
       コア関数 (SearchEngineCore) は、その関数スコープ内に
       正規化ヘルパー（normalizeArmor / normalizeDeco / normalizeSkill /
       normalizeCharm / 定数 / 枝刈り / ソルバ）をすべて内包しているため、
       toString() した文字列だけで外部変数に一切依存せず動作する。 */
    function buildWorkerSource() {
      var src = api.__source;
      if (!src) return null;
      return '(function(){\n' +
        'var api=null;\n' +
        'try{ api=(' + src + ')(self,null); }\n' +
        'catch(e){ try{ self.postMessage({type:"error",message:"boot:"+String(e&&e.stack||e)}); }catch(e2){} return; }\n' +
        'self.onmessage=function(ev){\n' +
        '  var msg=ev.data||{};\n' +
        '  if(msg.type==="init"){\n' +
        '    try{ api.setData(msg.data); self.postMessage({type:"ready"}); }\n' +
        '    catch(e){ self.postMessage({type:"error",message:"init:"+String(e&&e.stack||e)}); }\n' +
        '  } else if(msg.type==="search"){\n' +
        '    try{ self.postMessage({type:"progress",value:0}); }catch(e0){}\n' +
        '    try{\n' +
        '      var res=api.searchSync(msg.options);\n' +
        '      self.postMessage({type:"result",result:res});\n' +
        '    }catch(e){ self.postMessage({type:"error",message:"search:"+String(e&&e.stack||e)}); }\n' +
        '  }\n' +
        '};\n' +
        '})();';
    }
    /* テスト・デバッグ用（Worker コード文字列をそのまま検証できる） */
    api.buildWorkerSource = buildWorkerSource;

    api.__source = sourceText || null;
    return api;
  }

  /* ------------------------------------------------------------------ *
   * 起動
   * ------------------------------------------------------------------ */
  var root = (typeof global !== 'undefined' && global) ? global
    : (typeof self !== 'undefined' && self) ? self
      : (typeof window !== 'undefined' && window) ? window : this;

  var sourceText = null;
  try { sourceText = SearchEngineCore.toString(); } catch (e) { sourceText = null; }

  var engine = SearchEngineCore(root, sourceText);

  if (root.MHXX) {
    root.MHXX.searchEngine = engine;
  } else {
    root.MHXX = { searchEngine: engine };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
