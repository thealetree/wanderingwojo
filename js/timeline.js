/* ==========================================================================
   Wandering Wojo — Timeline Scrubber Module
   Toggleable horizontal scrubber above the entry nav.
   ========================================================================== */

const TimelineModule = (function () {
  'use strict';

  // --- State ---
  var sortedEntries = [];
  var isActive = false;
  var activeIndex = 0;
  var isDragging = false;
  var onScrubCallback = null;

  // --- DOM refs ---
  var barEl = null;
  var trackEl = null;
  var fillEl = null;
  var playheadEl = null;
  var pinEls = [];
  var toggleBtn = null;

  /**
   * Initialize the timeline.
   * @param {Array}    entries  sortedEntries (chronological oldest-first)
   * @param {Element}  btn      the clock toggle button
   * @param {Function} onScrub  called with (newIndex) when playhead moves
   */
  function init(entries, btn, onScrub) {
    sortedEntries = entries;
    toggleBtn = btn;
    onScrubCallback = onScrub;

    if (!entries || entries.length === 0) {
      if (btn) btn.style.display = 'none';
      return;
    }

    buildTimeline();
    bindDragEvents();

    // Default playhead to most-recent entry
    activeIndex = entries.length - 1;
  }

  /**
   * Build pin markers and inject into #timeline-bar
   */
  function buildTimeline() {
    barEl = document.getElementById('timeline-bar');
    if (!barEl) return;

    trackEl = document.createElement('div');
    trackEl.className = 'timeline__track';

    fillEl = document.createElement('div');
    fillEl.className = 'timeline__fill';
    trackEl.appendChild(fillEl);

    // One pin per entry
    pinEls = [];
    sortedEntries.forEach(function (entry, i) {
      var pin = document.createElement('div');
      pin.className = 'timeline__pin';
      pin.setAttribute('data-timeline-index', i);

      // Geographic cluster hint: same location_name as the previous entry
      if (i > 0 && entry.location_name === sortedEntries[i - 1].location_name) {
        pin.classList.add('timeline__pin--cluster');
      }

      pin.style.left = pinPercent(i) + '%';
      trackEl.appendChild(pin);
      pinEls.push(pin);
    });

    playheadEl = document.createElement('div');
    playheadEl.className = 'timeline__playhead';
    trackEl.appendChild(playheadEl);

    barEl.appendChild(trackEl);
  }

  /** Percentage position [0-100] for entry at index i */
  function pinPercent(i) {
    if (sortedEntries.length <= 1) return 50;
    return (i / (sortedEntries.length - 1)) * 100;
  }

  /** Update fill, playhead position, and pin active/inactive classes */
  function renderPlayhead(index) {
    if (!playheadEl || !fillEl) return;
    var pct = pinPercent(index);
    playheadEl.style.left = pct + '%';
    fillEl.style.width = pct + '%';

    pinEls.forEach(function (pin, i) {
      pin.classList.toggle('timeline__pin--active', i <= index);
      pin.classList.toggle('timeline__pin--inactive', i > index);
    });
  }

  /** Find nearest entry index for a given clientX drag position */
  function indexFromClientX(clientX) {
    if (!trackEl || sortedEntries.length === 0) return 0;
    var rect = trackEl.getBoundingClientRect();
    var relX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    var ratio = relX / rect.width;

    var nearest = 0;
    var nearestDist = Infinity;
    sortedEntries.forEach(function (_, i) {
      var d = Math.abs(ratio - pinPercent(i) / 100);
      if (d < nearestDist) { nearestDist = d; nearest = i; }
    });
    return nearest;
  }

  /** Move playhead to index and fire the scrub callback */
  function scrubTo(index) {
    if (index < 0 || index >= sortedEntries.length) return;
    if (index === activeIndex && !isDragging) return;
    activeIndex = index;
    renderPlayhead(index);
    if (onScrubCallback) onScrubCallback(index);
  }

  function bindDragEvents() {
    if (!barEl) return;

    function startDrag(e) {
      if (!isActive) return;
      isDragging = true;
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      scrubTo(indexFromClientX(clientX));
      if (e.cancelable) e.preventDefault();
    }

    function onDrag(e) {
      if (!isDragging) return;
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      scrubTo(indexFromClientX(clientX));
      if (e.cancelable) e.preventDefault();
    }

    function endDrag() { isDragging = false; }

    barEl.addEventListener('mousedown', startDrag);
    barEl.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
  }

  /**
   * Show the timeline bar and activate scrubbing.
   * @param {number} currentNavIndex  current entry-nav index
   */
  function activate(currentNavIndex) {
    if (!sortedEntries.length) return;
    isActive = true;
    activeIndex = currentNavIndex;
    if (barEl) {
      barEl.style.display = '';
      barEl.removeAttribute('aria-hidden');
      requestAnimationFrame(function () {
        barEl.classList.add('timeline-bar--active');
      });
    }
    if (toggleBtn) toggleBtn.classList.add('entry-nav__btn--active');
    renderPlayhead(activeIndex);
  }

  /** Hide the timeline bar and stop scrubbing. */
  function deactivate() {
    isActive = false;
    if (barEl) {
      barEl.classList.remove('timeline-bar--active');
      barEl.setAttribute('aria-hidden', 'true');
      setTimeout(function () {
        if (!isActive && barEl) barEl.style.display = 'none';
      }, 320);
    }
    if (toggleBtn) toggleBtn.classList.remove('entry-nav__btn--active');
  }

  /**
   * Sync the playhead to a new index WITHOUT firing the scrub callback.
   * Called by main.js when the entry-nav arrows move while timeline is active.
   */
  function syncToIndex(index) {
    if (!isActive) return;
    activeIndex = index;
    renderPlayhead(index);
  }

  function isTimelineActive() { return isActive; }
  function getActiveIndex() { return activeIndex; }

  return {
    init: init,
    activate: activate,
    deactivate: deactivate,
    syncToIndex: syncToIndex,
    isTimelineActive: isTimelineActive,
    getActiveIndex: getActiveIndex,
  };
})();

window.TimelineModule = TimelineModule;
