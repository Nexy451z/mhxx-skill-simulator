/* ==========================================================================
   UI: スキルチップの ON/OFF（同系統は排他）＋ 選択中バッジ
   - STEP 3 の #skillGrid / #selectedSkillBar / #clearSkills を担当
   - 同じ系統（例: 達人）のスキルは 1 つだけ選択できる
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var grid = null;
  var bar = null;
  var counter = null;
  var clearBtn = null;

  function skillFromChip(chip) {
    return {
      name: chip.getAttribute('data-name'),
      group: chip.getAttribute('data-group'),
      threshold: Number(chip.getAttribute('data-threshold')) || 10
    };
  }

  function toggleSkill(skill) {
    if (!skill || !skill.name) return;
    var state = MHXX.store.get();
    var current = state.skills || [];
    var existing = current.filter(function (item) { return item.name === skill.name; })[0];
    var next;

    if (existing) {
      next = current.filter(function (item) { return item !== existing; });
    } else {
      next = current
        .filter(function (item) { return item.group !== skill.group; })
        .concat([{ name: skill.name, group: skill.group, threshold: skill.threshold }]);
    }

    MHXX.store.patch({ skills: next, resultIndex: 0 });
    MHXX.bus.emit('skills:sync');
  }

  function renderSelectedBar() {
    if (!bar) return;
    var state = MHXX.store.get();
    var skills = state.skills || [];

    if (counter) {
      counter.textContent = skills.length + '個 選択中';
      counter.classList.toggle('is-empty', skills.length === 0);
    }
    if (clearBtn) clearBtn.disabled = skills.length === 0;

    if (!skills.length) {
      bar.innerHTML = '<span class="selected-empty">' +
        kit.icon('plus', 'icon-sm') +
        ' スキルを選択すると、ここに条件が追加されます</span>';
      return;
    }

    bar.innerHTML = skills.map(function (skill) {
      return '<span class="selected-chip" data-name="' + kit.esc(skill.name) + '">' +
        kit.icon('check', 'chip-icon') +
        '<span class="selected-chip-name">' + kit.esc(skill.name) + '</span>' +
        '<button type="button" class="selected-chip-remove" data-remove="' + kit.esc(skill.name) +
        '" aria-label="' + kit.esc(skill.name) + ' を解除">' +
        kit.icon('close', 'icon-xs') + '</button></span>';
    }).join('');
  }

  function init() {
    grid = document.getElementById('skillGrid');
    bar = document.getElementById('selectedSkillBar');
    counter = document.getElementById('selectedCount');
    clearBtn = document.getElementById('clearSkills');

    if (grid) {
      kit.delegate(grid, 'click', '.skill-chip', function (event, chip) {
        event.preventDefault();
        toggleSkill(skillFromChip(chip));
      });
      grid.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var chip = event.target.closest('.skill-chip');
        if (!chip) return;
        event.preventDefault();
        toggleSkill(skillFromChip(chip));
      });
    }

    if (bar) {
      kit.delegate(bar, 'click', '[data-remove]', function (event, target) {
        event.preventDefault();
        var name = target.getAttribute('data-remove');
        var state = MHXX.store.get();
        MHXX.store.patch({
          skills: (state.skills || []).filter(function (skill) { return skill.name !== name; }),
          resultIndex: 0
        });
        MHXX.bus.emit('skills:sync');
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        MHXX.store.patch({ skills: [], resultIndex: 0 });
        MHXX.bus.emit('skills:sync');
        kit.toast('選択中のスキルをすべて解除しました');
      });
    }

    MHXX.bus.on('state', renderSelectedBar);
    renderSelectedBar();
  }

  MHXX.ui.skillChips = { init: init, toggle: toggleSkill, renderSelectedBar: renderSelectedBar };
})(window);
