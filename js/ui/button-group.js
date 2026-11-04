/* ==========================================================================
   UI: セグメントボタン（剣士/ガンナー・武器スロ・性別）
   - data-state 属性で MHXX.store のキーと対応する
   - data-value 属性で状態値を表す（数値は自動変換）
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  function groupValue(button) {
    var raw = button.getAttribute('data-value');
    if (raw !== null && raw !== '' && !isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  function activate(group, button) {
    Array.prototype.forEach.call(group.querySelectorAll('button'), function (btn) {
      var active = btn === button;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function init() {
    var groups = kit.qa('.btn-group[data-state]');
    groups.forEach(function (group) {
      var key = group.getAttribute('data-state');
      group.setAttribute('role', 'group');
      group.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('button') : null;
        if (!button || button.disabled || !group.contains(button)) return;
        if (button.classList.contains('active')) return;
        activate(group, button);

        var patch = {};
        patch[key] = groupValue(button);
        patch.resultIndex = 0;
        if (key === 'type' || key === 'weaponSlots' || key === 'gender') {
          MHXX.bus.emit('ui:reconfigure', { key: key, value: patch[key] });
        }
        if (MHXX.store) MHXX.store.patch(patch);
      });
    });

    /* 状態側からの同期（初期表示・外部変更） */
    MHXX.bus.on('state', function (state) {
      groups.forEach(function (group) {
        var key = group.getAttribute('data-state');
        if (!(key in state)) return;
        Array.prototype.forEach.call(group.querySelectorAll('button'), function (btn) {
          var active = String(groupValue(btn)) === String(state[key]);
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      });
    });
  }

  MHXX.ui.buttonGroup = { init: init, activate: activate };
})(window);
