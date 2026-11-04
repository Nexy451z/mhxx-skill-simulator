/* ==========================================================================
   UI: 「さらに追加できるスキル」チップ（ワンクリックで条件追加）
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var grid = null;
  var empty = null;
  var count = null;

  function findSkill(name) {
    var list = (MHXX.skillIndex && MHXX.skillIndex.all) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    return null;
  }

  var MAX_VISIBLE = 12;

  function render(state) {
    if (!grid) return;
    var suggestions = state.extraSuggestions || [];
    var visible = suggestions.slice(0, MAX_VISIBLE);

    if (count) {
      count.textContent = suggestions.length
        ? (suggestions.length > visible.length
          ? visible.length + ' / ' + suggestions.length + '件'
          : suggestions.length + '件')
        : '';
    }
    if (empty) empty.hidden = suggestions.length !== 0;

    grid.innerHTML = visible.map(function (suggestion) {
      var name = suggestion.name || '';
      var reason = suggestion.reason ? ' (' + suggestion.reason + ')' : '';
      return '<div class="skill-chip suggest" data-name="' + kit.esc(name) + '"' +
        ' data-group="' + kit.esc(suggestion.group || '') + '"' +
        ' title="' + kit.esc(name + reason) + '" role="button" tabindex="0">' +
        kit.icon('plus', 'chip-icon') +
        '<span>' + kit.esc(name) + '</span>' +
        (reason ? '<small class="chip-reason">' + kit.esc(reason) + '</small>' : '') +
        '</div>';
    }).join('');
  }

  function add(suggestion) {
    var skill = findSkill(suggestion.name);
    var group = suggestion.group || (skill && skill.group) || suggestion.name;
    var threshold = (skill && skill.threshold) || suggestion.threshold || 10;

    var state = MHXX.store.get();
    var next = (state.skills || [])
      .filter(function (item) { return item.group !== group; })
      .concat([{ name: suggestion.name, group: group, threshold: threshold }]);

    MHXX.store.patch({ skills: next, resultIndex: 0 });
    MHXX.bus.emit('skills:sync');
    kit.toast(suggestion.name + ' を条件に追加しました');
  }

  function init() {
    grid = document.getElementById('suggestGrid');
    empty = document.getElementById('suggestEmpty');
    count = document.getElementById('suggestCount');
    if (!grid) return;

    kit.delegate(grid, 'click', '.skill-chip', function (event, chip) {
      event.preventDefault();
      add({
        name: chip.getAttribute('data-name'),
        group: chip.getAttribute('data-group')
      });
    });
    grid.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var chip = event.target.closest('.skill-chip');
      if (!chip) return;
      event.preventDefault();
      add({ name: chip.getAttribute('data-name'), group: chip.getAttribute('data-group') });
    });

    MHXX.bus.on('state', render);
    render(MHXX.store.get());
  }

  MHXX.ui.suggestChips = { init: init, render: render };
})(window);
