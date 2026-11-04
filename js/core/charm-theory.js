/* ==========================================================================
   理論値お守り生成 (js/core/charm-theory.js)
   --------------------------------------------------------------------------
   ・MHXX.data の護石データ（charmKinds / charmLimits）から
     「対象系統だけを持ち、その系統で取り得る最大ポイント」の理論値お守りを作る
   ・対象系統 = 現在選択中のスキルの系統 ∪ 追加候補の系統
     （お守りに載せても意味がない系統は生成しない）
   ・スロ数 0〜3 ごとに「スキルなし / 系統1つ / 系統2つ」の理論値お守りを生成する
   ・第1スキルは kind.maxFirstSkill、第2スキルは kind.maxSecondSkill で cap する
   ・charmSkillTables[rarity].slot1 / slot2 は「第1スキル枠 / 第2スキル枠」の上限表
     （護石のスロ数ではない）。第2枠専用の系統は第1枠に合法な系統を1つ載せて表現する
   ・生成したお守りは必ず isValid()（位置別の上限表 + kind.maxSlots + スキル2系統まで）を満たす
   ・DOM に依存しない純ロジック（Node からも require できる）

   Node から使う場合:
     global.window = global; global.MHXX = global.MHXX || {};
     require('./js/data/sim-data.js');
     var theory = require('./js/core/charm-theory.js');
     theory.buildCharms(['攻撃', '達人'], global.MHXX.data);
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});

  var MAX_SLOTS = 3;

  var kindCacheData = null;
  var kindCache = null;

  function dataOf(data) {
    return data || MHXX.data || {};
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /* 理論値お守りの候補になる護石の種類（rarity > 0 = 装備なし以外） */
  function usableKinds(data) {
    data = dataOf(data);
    if (kindCache && kindCacheData === data) return kindCache;

    var source = data.charmKinds || [];
    var out = [];
    for (var i = 0; i < source.length; i++) {
      var kind = source[i];
      if (!kind) continue;
      if (!(Number(kind.rarity) > 0)) continue;
      out.push(kind);
    }
    kindCacheData = data;
    kindCache = out;
    return out;
  }

  /* その kind / スキル位置 / 系統で取り得る最大ポイント。
     charmSkillTables[rarity].slot1 = 第1スキル枠 / slot2 = 第2スキル枠の上限表で、
     護石のスロ数（0〜3）には依存しない（スロ数は kind.maxSlots の判定にだけ使う）。
     上限は kind.maxFirstSkill / maxSecondSkill で cap する。 */
  function maxPointsForKind(kind, slots, system, second, data) {
    data = dataOf(data);
    if (!kind || !system) return 0;
    if (!(Number(kind.maxSlots) >= Number(slots))) return 0;
    var tables = data.charmSkillTables && data.charmSkillTables[kind.rarity];
    if (!tables) return 0;
    var table = tables[second ? 'slot2' : 'slot1'];
    if (!table) return 0;
    var range = table[system];
    if (!range) return 0;

    /* 表の値は [下限, 上限] */
    var upper = Number(range.length > 1 ? range[1] : range[0]) || 0;
    var cap = Number(second ? kind.maxSecondSkill : kind.maxFirstSkill) || 0;
    var value = Math.min(upper, cap);
    return value > 0 ? value : 0;
  }

  /* 第2スキル枠専用の系統（攻撃・達人・匠など）は、第1スキル枠に別の合法な系統を
     1つ載せた形でしか存在できない。その第1スキル候補を kind ごとに1つ返す。
     ポイントは表の下限（余計な加点を避ける）。 */
  function firstSkillPartner(kind, slots, excludeSystem, data) {
    data = dataOf(data);
    if (!kind) return null;
    if (!(Number(kind.maxSlots) >= Number(slots))) return null;
    var tables = data.charmSkillTables && data.charmSkillTables[kind.rarity];
    if (!tables || !tables.slot1) return null;
    var table = tables.slot1;
    var cap = Number(kind.maxFirstSkill) || 0;
    for (var system in table) {
      if (!hasOwn(table, system)) continue;
      if (system === excludeSystem) continue;
      var range = table[system];
      var max = Math.min(Number(range.length > 1 ? range[1] : range[0]) || 0, cap);
      if (!(max > 0)) continue;
      var min = Number(range[0]) || 1;
      if (min < 1) min = 1;
      if (min > max) min = max;
      return { system: system, points: min };
    }
    return null;
  }

  /* slots で systems（1〜2系統）を同時に持てる kind のうち、
     ポイント合計が最大になる組を返す。
     戻り値: { kindId, kindName, rarity, points: { 系統: pt }, score } */
  function bestKindFor(slots, systems, data) {
    data = dataOf(data);
    var targets = (systems || []).slice(0, 2);
    if (!targets.length) return null;

    var kinds = usableKinds(data);
    var best = null;
    for (var i = 0; i < kinds.length; i++) {
      var kind = kinds[i];
      if (Number(kind.maxSlots) < slots) continue;

      var points = {};
      var score = 0;
      var ok = true;
      for (var j = 0; j < targets.length; j++) {
        var system = targets[j];
        var value = maxPointsForKind(kind, slots, system, j > 0, data);
        if (!(value > 0)) { ok = false; break; }
        points[system] = value;
        score += value;
      }
      if (!ok) continue;
      if (!best || score > best.score) {
        best = {
          kindId: kind.id,
          kindName: kind.name,
          rarity: kind.rarity,
          points: points,
          score: score
        };
      }
    }
    return best;
  }

  /* { 系統: pt } -> "達人+10 痛撃+6" */
  function skillsText(points) {
    var parts = [];
    var source = points || {};
    for (var system in source) {
      if (!hasOwn(source, system)) continue;
      var value = Number(source[system]) || 0;
      if (!value) continue;
      parts.push(system + (value > 0 ? '+' : '') + value);
    }
    return parts.join(' ');
  }

  function makeCharm(best, slots, points) {
    var kindName = best ? best.kindName : '';
    var text = skillsText(points);
    var label = (kindName ? kindName + ' ' : '') + (text || 'スキルなし') + ' スロ' + slots;
    return {
      name: '理論値 ' + label,
      label: label,
      slots: slots,
      skills: points || {},
      kindId: best ? best.kindId : null,
      kindName: kindName,
      rarity: best ? best.rarity : 0
    };
  }

  /* 対象系統の理論値お守りを全パターン生成する
     （スロ0〜3 × スキルなし / 単独 / 2系統の組） */
  function buildCharms(systems, data) {
    data = dataOf(data);
    var kinds = usableKinds(data);

    var unique = [];
    var seenSystem = {};
    var source = systems || [];
    for (var i = 0; i < source.length; i++) {
      var system = source[i];
      if (!system || seenSystem[system]) continue;
      seenSystem[system] = true;
      unique.push(system);
    }

    var list = [];
    for (var slots = 0; slots <= MAX_SLOTS; slots++) {
      list.push(makeCharm(null, slots, {}));

      for (var a = 0; a < unique.length; a++) {
        var system = unique[a];

        /* 第1スキル枠として載せられる場合（攻撃・達人・匠などは載らない） */
        var single = bestKindFor(slots, [system], data);
        if (single) {
          var singlePoints = {};
          singlePoints[system] = single.points[system];
          list.push(makeCharm(single, slots, singlePoints));
        }

        /* 第2スキル枠として載せる場合。第1スキル枠には任意の合法系統を1つ載せる
           （ポイントは表の下限）。第2枠専用の系統もこれで表現できる。 */
        var secondBest = null;
        for (var k = 0; k < kinds.length; k++) {
          var kind = kinds[k];
          if (Number(kind.maxSlots) < slots) continue;
          var value = maxPointsForKind(kind, slots, system, true, data);
          if (!(value > 0)) continue;
          var partner = firstSkillPartner(kind, slots, system, data);
          if (!partner) continue;
          if (!secondBest || value > secondBest.value) {
            secondBest = { kind: kind, value: value, partner: partner };
          }
        }
        if (secondBest) {
          var pairPoints = {};
          pairPoints[secondBest.partner.system] = secondBest.partner.points;
          pairPoints[system] = secondBest.value;
          list.push(makeCharm({
            kindId: secondBest.kind.id,
            kindName: secondBest.kind.name,
            rarity: secondBest.kind.rarity
          }, slots, pairPoints));
        }

        for (var b = a + 1; b < unique.length; b++) {
          /* 第1スキル枠と第2スキル枠で上限が異なる（例: 気絶は第2枠なら 13pt）ため、
             両方の順序を生成する。同一内容は下の重複除去で 1 件にまとまる。 */
          var pair = bestKindFor(slots, [unique[a], unique[b]], data);
          if (pair) list.push(makeCharm(pair, slots, pair.points));
          var pairRev = bestKindFor(slots, [unique[b], unique[a]], data);
          if (pairRev) list.push(makeCharm(pairRev, slots, pairRev.points));
        }
      }
    }

    /* 同じスロ数・種類・ポイントの組は 1 つにまとめる */
    var out = [];
    var seen = {};
    for (var k = 0; k < list.length; k++) {
      var charm = list[k];
      var key = charm.slots + '|' + (charm.kindId == null ? '' : charm.kindId) + '|' +
        JSON.stringify(charm.skills);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(charm);
    }
    return out;
  }

  /* 指定系統のポイントを持つお守りだけを残す
     （理論値逆引きでは「その候補系統を載せたお守り」だけを検索に渡す） */
  function charmsWithSystem(charms, system) {
    var out = [];
    var list = charms || [];
    for (var i = 0; i < list.length; i++) {
      var charm = list[i];
      if (!charm || !charm.skills) continue;
      if (Number(charm.skills[system]) > 0) out.push(charm);
    }
    return out;
  }

  /* "天の護石 達人+10 痛撃+6 スロ3" */
  function charmLabel(charm) {
    if (!charm) return '';
    if (charm.label) return charm.label;
    var kindName = charm.kindName || '';
    var text = skillsText(charm.skills || {});
    return (kindName ? kindName + ' ' : '') + (text || 'スキルなし') +
      ' スロ' + (Number(charm.slots) || 0);
  }

  /* data.isValidCharmSkill による合法性チェック（テスト・レビュー用） */
  function isValid(charm, data) {
    data = dataOf(data);
    if (!charm) return false;
    var slots = Number(charm.slots) || 0;
    if (slots < 0 || slots > MAX_SLOTS) return false;
    if (charm.kindId == null) return !Object.keys(charm.skills || {}).length;
    if (typeof data.isValidCharmSkill !== 'function') return false;

    /* kind の存在と最大スロ数を確認する */
    var kind = null;
    var kinds = usableKinds(data);
    for (var ki = 0; ki < kinds.length; ki++) {
      if (kinds[ki].id === charm.kindId) { kind = kinds[ki]; break; }
    }
    if (!kind) return false;
    if (slots > (Number(kind.maxSlots) || 0)) return false;

    var skills = charm.skills || {};
    var count = 0;
    for (var system in skills) {
      if (!hasOwn(skills, system)) continue;
      var value = Number(skills[system]) || 0;
      if (!(value > 0)) return false;
      /* 第1スキル枠 → 第2スキル枠の順に、その枠の上限表と cap を超えないこと */
      var second = count > 0;
      if (value > maxPointsForKind(kind, slots, system, second, data)) return false;
      count += 1;
    }
    /* MHXX の護石はスキルを最大 2 系統までしか持てない */
    return count <= 2;
  }

  /* MHXX.charmApi.add に渡す payload へ変換する
     （kind は生成に使った種類をそのまま使うので、登録しても合法なまま） */
  function toCharmPayload(charm) {
    var map = (charm && charm.skills) || {};
    var skills = [];
    for (var system in map) {
      if (!hasOwn(map, system)) continue;
      var points = Number(map[system]) || 0;
      if (!points) continue;
      skills.push({ name: system, pt: points });
    }
    return {
      type: (charm && charm.kindName) || '護石',
      kind: charm && charm.kindId != null ? charm.kindId : 10,
      slots: Math.max(0, Math.min(MAX_SLOTS, Number(charm && charm.slots) || 0)),
      skills: skills
    };
  }

  MHXX.charmTheory = {
    MAX_SLOTS: MAX_SLOTS,
    usableKinds: usableKinds,
    maxPointsForKind: maxPointsForKind,
    bestKindFor: bestKindFor,
    buildCharms: buildCharms,
    charmsWithSystem: charmsWithSystem,
    skillsText: skillsText,
    charmLabel: charmLabel,
    isValid: isValid,
    toCharmPayload: toCharmPayload
  };

  /* Node から require したときは戻り値でも使えるようにする（テスト用） */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MHXX.charmTheory;
  }
})(typeof window !== 'undefined' ? window
  : typeof globalThis !== 'undefined' ? globalThis
    : typeof self !== 'undefined' ? self : this);
