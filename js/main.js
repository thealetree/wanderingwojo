/* ==========================================================================
   Wandering Wojo — Main Application Module
   Data loading, map-only mode, entry navigation, lightbox
   ========================================================================== */

const AppModule = (function () {
  'use strict';

  // --- Config ---
  // Contact email (encoded to avoid scrapers). Decode at runtime.
  var CONTACT_EMAIL = atob('dGhlYWxldHJlZUBnbWFpbC5jb20=');

  // --- State ---
  let entries = [];
  let locations = [];
  let sortedEntries = [];   // entries sorted chronologically (oldest first)
  let navIndex = 0;         // current index in sortedEntries
  let lightboxPhotos = [];
  let lightboxIndex = 0;

  // --- DOM refs ---
  const els = {};

  // --- Helper: hide/show 2¢ panel ---
  function hideTwoCents() {
    var tc = document.getElementById('two-cents');
    if (tc) tc.style.display = 'none';
  }
  function showTwoCents() {
    var tc = document.getElementById('two-cents');
    if (tc) tc.style.display = '';
  }

  /**
   * Initialize the application
   */
  async function init() {
    cacheDom();
    checkSentRedirect();
    await loadData();
    initMap();
    initFloatingTitle();
    initTwoCents();
    initEntryNav();
    initLightbox();
    initKeyboardNav();
    initJourneyStats();
  }

  /**
   * Cache DOM references
   */
  function cacheDom() {
    els.mapContainer = document.getElementById('map-container');
    els.floatingTitle = document.getElementById('floating-title');
    els.lightbox = document.getElementById('lightbox');
    els.lightboxImg = document.getElementById('lightbox-img');
    els.lightboxClose = document.getElementById('lightbox-close');
    els.lightboxPrev = document.getElementById('lightbox-prev');
    els.lightboxNext = document.getElementById('lightbox-next');
    els.navPrev = document.getElementById('nav-prev');
    els.navNext = document.getElementById('nav-next');
    els.navInfo = document.getElementById('nav-info');
    els.entryNav = document.getElementById('entry-nav');
    els.journeyStats = document.getElementById('journey-stats');
  }

  /**
   * Load JSON data files
   */
  async function loadData() {
    try {
      const [entriesRes, locationsRes] = await Promise.all([
        fetch('data/entries.json'),
        fetch('data/locations.json'),
      ]);
      entries = await entriesRes.json();
      locations = await locationsRes.json();

      // Sort chronologically (oldest first) for navigation
      sortedEntries = entries.slice().sort(function (a, b) {
        return new Date(a.date) - new Date(b.date);
      });
      // Default to the most recent entry
      navIndex = Math.max(0, sortedEntries.length - 1);
    } catch (err) {
      console.error('Failed to load data:', err);
      entries = [];
      locations = [];
      sortedEntries = [];
    }
  }

  // =====================================================================
  // FLOATING TITLE (expandable description)
  // =====================================================================

  function initFloatingTitle() {
    if (!els.floatingTitle) return;

    var nameEl = els.floatingTitle.querySelector('.floating-title__name');
    var closeBtn = document.getElementById('floating-title-close');

    function openAboutPanel() {
      els.floatingTitle.classList.add('floating-title--open');
      hideTwoCents();
      // Hide swag button and bottom nav on mobile only
      if (window.innerWidth <= 768) {
        var floatingShop = document.querySelector('.floating-shop');
        var entryNav = document.getElementById('entry-nav');
        if (floatingShop) floatingShop.style.display = 'none';
        if (entryNav) entryNav.style.display = 'none';
      }
    }

    function closeAboutPanel() {
      els.floatingTitle.classList.remove('floating-title--open');
      showTwoCents();
      // Restore swag button and bottom nav
      var floatingShop = document.querySelector('.floating-shop');
      var entryNav = document.getElementById('entry-nav');
      if (floatingShop) floatingShop.style.display = '';
      if (entryNav) entryNav.style.display = '';
    }

    // Only the title text toggles open/close
    nameEl.addEventListener('click', function (e) {
      e.stopPropagation();
      if (els.floatingTitle.classList.contains('floating-title--open')) {
        closeAboutPanel();
      } else {
        openAboutPanel();
      }
    });

    // Close button inside the panel
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeAboutPanel();
      });
    }

    // Clicks anywhere inside the panel (desc, form, etc.) do nothing
    els.floatingTitle.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // Close when clicking outside the panel
    document.addEventListener('click', function () {
      closeAboutPanel();
    });

  }

  function initContactForm(form) {
    // Set form action and redirect URL
    form.action = 'https://formsubmit.co/' + CONTACT_EMAIL;
    var nextInput = document.getElementById('contact-next');
    if (nextInput) {
      nextInput.value = window.location.origin + window.location.pathname + '?sent=true';
    }

    // Show selected file name
    var fileInput = document.getElementById('contact-photo');
    var fileNameEl = document.getElementById('contact-file-name');
    if (fileInput && fileNameEl) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files.length > 0) {
          fileNameEl.textContent = fileInput.files[0].name;
        } else {
          fileNameEl.textContent = '';
        }
      });
    }

    // Validate before submit (message required)
    form.addEventListener('submit', function (e) {
      var msgInput = document.getElementById('contact-msg');
      if (!msgInput.value.trim()) {
        e.preventDefault();
        return;
      }
      // Let the form submit naturally (traditional POST)
      var btn = form.querySelector('.contact-form__btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';
    });
  }

  // Check for ?sent=true redirect and show success toast
  function checkSentRedirect() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('sent') === 'true') {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      // Show toast
      var toast = document.createElement('div');
      toast.className = 'sent-toast';
      toast.textContent = 'Message sent! Thanks for reaching out.';
      document.body.appendChild(toast);
      // Animate in
      requestAnimationFrame(function () {
        toast.classList.add('sent-toast--visible');
      });
      // Remove after 5 seconds
      setTimeout(function () {
        toast.classList.remove('sent-toast--visible');
        setTimeout(function () { toast.remove(); }, 400);
      }, 5000);
    }
  }

  // =====================================================================
  // YOUR 2¢ PANEL (Poll + Donate)
  // =====================================================================
  var FIREBASE_DB = 'https://wanderingwojo-default-rtdb.firebaseio.com';

  function initTwoCents() {
    var panel = document.getElementById('two-cents');
    var toggle = document.getElementById('two-cents-toggle');
    var closeBtn = document.getElementById('two-cents-close');
    var panelContent = document.getElementById('two-cents-panel');
    if (!panel || !toggle) return;

    // Toggle open/close
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.add('two-cents--open');
    });

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.remove('two-cents--open');
    });

    // Clicks inside panel don't close it
    panelContent.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // Click outside closes
    document.addEventListener('click', function () {
      panel.classList.remove('two-cents--open');
    });

    // Tab switching
    var tabs = panel.querySelectorAll('.two-cents__tab');
    var contents = panel.querySelectorAll('.two-cents__content');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('two-cents__tab--active'); });
        contents.forEach(function (c) { c.classList.remove('two-cents__content--active'); });
        tab.classList.add('two-cents__tab--active');
        var target = tab.getAttribute('data-tab');
        panel.querySelector('[data-content="' + target + '"]').classList.add('two-cents__content--active');
      });
    });

    // Init contact form (now lives in the Message tab)
    var form = document.getElementById('contact-form');
    if (form) {
      if (!CONTACT_EMAIL) {
        // Hide the Message tab entirely if no email configured
        var msgTab = panel.querySelector('[data-tab="message"]');
        var msgContent = panel.querySelector('[data-content="message"]');
        if (msgTab) msgTab.style.display = 'none';
        if (msgContent) msgContent.style.display = 'none';
      } else {
        initContactForm(form);
      }
    }

    // Load poll
    loadPoll();
  }

  function loadPoll() {
    fetch('data/poll.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (poll) {
        if (!poll || !poll.active) return;
        renderPoll(poll);
      })
      .catch(function (err) {
        console.warn('Could not load poll:', err);
      });
  }

  function renderPoll(poll) {
    var questionEl = document.getElementById('poll-question');
    var optionsEl = document.getElementById('poll-options');
    var totalEl = document.getElementById('poll-total');
    if (!questionEl || !optionsEl) return;

    questionEl.textContent = poll.question;
    optionsEl.innerHTML = '';

    var votedPollId = localStorage.getItem('wojo_poll_voted_id');
    var votedOption = localStorage.getItem('wojo_poll_voted_option');
    var hasVoted = (votedPollId === poll.id);

    // Fetch current vote counts from Firebase
    fetch(FIREBASE_DB + '/polls/' + poll.id + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var votes = data || {};
        renderPollOptions(poll, votes, hasVoted, votedOption, optionsEl, totalEl);
      })
      .catch(function () {
        // If Firebase is down, still render (just no counts)
        renderPollOptions(poll, {}, hasVoted, votedOption, optionsEl, totalEl);
      });
  }

  function renderPollOptions(poll, votes, hasVoted, votedOption, optionsEl, totalEl) {
    var totalVotes = 0;
    poll.options.forEach(function (opt, i) {
      totalVotes += (votes['opt' + i] || 0);
    });

    poll.options.forEach(function (opt, i) {
      var key = 'opt' + i;
      var count = votes[key] || 0;
      var pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

      var btn = document.createElement('button');
      btn.className = 'two-cents__option';
      if (hasVoted) btn.classList.add('two-cents__option--voted');
      if (hasVoted && votedOption === key) btn.classList.add('two-cents__option--selected');

      var barHtml = hasVoted
        ? '<div class="two-cents__option-bar" style="width:' + pct + '%"></div>'
        : '';
      var countHtml = hasVoted
        ? '<span class="two-cents__option-count">' + pct + '%</span>'
        : '';

      btn.innerHTML = barHtml +
        '<span class="two-cents__option-label">' + opt + '</span>' +
        countHtml;

      if (!hasVoted) {
        btn.addEventListener('click', function () {
          castVote(poll, key, i);
        });
      }

      optionsEl.appendChild(btn);
    });

    if (totalEl) {
      totalEl.textContent = hasVoted ? totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') : '';
    }
  }

  function castVote(poll, optKey, optIndex) {
    // Optimistic UI: mark as voted immediately
    localStorage.setItem('wojo_poll_voted_id', poll.id);
    localStorage.setItem('wojo_poll_voted_option', optKey);

    // Read current count, increment, write back (tiny race window, fine for a blog)
    fetch(FIREBASE_DB + '/polls/' + poll.id + '/' + optKey + '.json')
      .then(function (r) { return r.json(); })
      .then(function (current) {
        var newCount = (current || 0) + 1;
        return fetch(FIREBASE_DB + '/polls/' + poll.id + '/' + optKey + '.json', {
          method: 'PUT',
          body: JSON.stringify(newCount)
        });
      })
      .then(function () {
        // Re-render with updated counts
        renderPoll(poll);
      })
      .catch(function (err) {
        console.warn('Vote failed:', err);
        // Still re-render (vote is saved locally)
        renderPoll(poll);
      });
  }

  // =====================================================================
  // MAP
  // =====================================================================

  function initMap() {
    const mapInitialized = MapModule.init();

    if (mapInitialized) {
      const map = MapModule.getMap();
      map.on('load', function () {
        MapModule.addCorkPins(entries, handlePinClick, handlePinHover);
        MapModule.addRouteFromEntries(entries);
        updateNavInfo();
        // Show thumbs for current entry and neighbors
        if (sortedEntries.length > 0) {
          MapModule.updateThumbVisibility(sortedEntries[navIndex].id);
        }

        // Position map to show entries
        if (entries.length > 0) {
          var isMobile = window.innerWidth < 768;
          var latestEntry = sortedEntries[sortedEntries.length - 1];

          // Center on the most recent entry at a comfortable zoom
          var lngLat = [latestEntry.coordinates[1], latestEntry.coordinates[0]];
          map.flyTo({ center: lngLat, zoom: 5, duration: 500 });

          // After initial positioning finishes, start the route draw-in animation
          map.once('moveend', function () {
            // Highlight the most recent entry's pin before animation starts
            if (sortedEntries.length > 0) {
              highlightPin(sortedEntries[sortedEntries.length - 1].id);
            }
            MapModule.startRouteAnimation();
            // Check for deep link hash after animation starts
            checkUrlHash();
          });
        } else {
          checkUrlHash();
        }
      });
    }
  }

  function handlePinClick(groupEntries, pinEl, marker) {
    // Use the actively previewed entry if it's in this group, otherwise most recent
    var activeId = MapModule.getActivePreviewEntryId();
    var displayEntry = groupEntries[groupEntries.length - 1];
    if (activeId) {
      var activeEntry = groupEntries.find(function (e) { return e.id === activeId; });
      if (activeEntry) displayEntry = activeEntry;
    }
    var idx = sortedEntries.findIndex(function (e) { return e.id === displayEntry.id; });
    if (idx !== -1) navIndex = idx;
    updateNavInfo();
    highlightPin(displayEntry.id);
    MapModule.updateThumbVisibility(displayEntry.id);
    hideTwoCents();
    MapModule.expandPinEntry(groupEntries, pinEl, displayEntry.id);
  }

  function handlePinHover(groupEntries, pinEl, marker) {
    // On desktop, hovering a pin selects it as the active story
    if (window.innerWidth <= 768) return;
    var displayEntry = groupEntries[groupEntries.length - 1];
    var idx = sortedEntries.findIndex(function (e) { return e.id === displayEntry.id; });
    if (idx !== -1) navIndex = idx;
    updateNavInfo();
    highlightPin(displayEntry.id);
    // Defer thumb update so the hovered pin doesn't resize under the cursor mid-click
    requestAnimationFrame(function () {
      MapModule.updateThumbVisibility(displayEntry.id);
    });
  }

  // =====================================================================
  // ENTRY NAVIGATION
  // =====================================================================

  function initEntryNav() {
    if (sortedEntries.length === 0) {
      els.entryNav.style.display = 'none';
      return;
    }

    els.navPrev.addEventListener('click', function () {
      navigateEntry(-1);
    });

    els.navNext.addEventListener('click', function () {
      navigateEntry(1);
    });

    updateNavInfo();
  }

  function navigateEntry(dir) {
    if (sortedEntries.length === 0) return;

    // Calculate new index
    var newIndex = (navIndex + dir + sortedEntries.length) % sortedEntries.length;
    navIndex = newIndex;
    var entry = sortedEntries[navIndex];

    // Check if the target entry is in the currently expanded pin
    var expandedIds = MapModule.getExpandedPinEntryIds();
    if (expandedIds.length > 0 && expandedIds.indexOf(entry.id) !== -1) {
      // Same grouped pin — just switch tabs
      MapModule.switchToEntryInExpandedPin(entry.id);
      highlightPin(entry.id);
      updateNavInfo();
      MapModule.updateThumbVisibility(entry.id);
      return;
    }

    // Different pin — close, fly, highlight, update preview
    MapModule.closeExpandedPin();
    MapModule.flyToEntry(entry);
    highlightPin(entry.id);
    updateNavInfo();
    MapModule.updatePinPreview(entry.id);
    MapModule.updateThumbVisibility(entry.id);
  }

  function highlightPin(entryId) {
    // Remove previous highlight
    document.querySelectorAll('.cork-pin--highlighted').forEach(function (el) {
      el.classList.remove('cork-pin--highlighted');
    });

    // Find the pin that contains this entry ID (grouped pins use data-entry-ids)
    var allPins = document.querySelectorAll('.cork-pin');
    allPins.forEach(function (pin) {
      var ids = (pin.getAttribute('data-entry-ids') || '').split(',');
      if (ids.indexOf(entryId) !== -1) {
        pin.classList.add('cork-pin--highlighted');
      }
    });
  }

  function updateNavInfo() {
    if (sortedEntries.length === 0) return;
    els.navInfo.textContent = (navIndex + 1) + ' / ' + sortedEntries.length;
  }

  // =====================================================================
  // LIGHTBOX
  // =====================================================================

  function initLightbox() {
    els.lightboxClose.addEventListener('click', closeLightbox);
    els.lightboxPrev.addEventListener('click', function () { navLightbox(-1); });
    els.lightboxNext.addEventListener('click', function () { navLightbox(1); });

    els.lightbox.addEventListener('click', function (e) {
      if (e.target === els.lightbox) closeLightbox();
    });
  }

  function openLightbox(photos, index) {
    lightboxPhotos = photos;
    lightboxIndex = index || 0;
    updateLightboxImage();
    els.lightbox.classList.add('active');
    els.lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    els.lightbox.classList.remove('active');
    els.lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function navLightbox(dir) {
    lightboxIndex = (lightboxIndex + dir + lightboxPhotos.length) % lightboxPhotos.length;
    updateLightboxImage();
  }

  function updateLightboxImage() {
    if (lightboxPhotos.length === 0) return;
    els.lightboxImg.src = lightboxPhotos[lightboxIndex];
    els.lightboxImg.alt = 'Photo ' + (lightboxIndex + 1) + ' of ' + lightboxPhotos.length;

    var showNav = lightboxPhotos.length > 1;
    els.lightboxPrev.style.display = showNav ? '' : 'none';
    els.lightboxNext.style.display = showNav ? '' : 'none';
  }

  // =====================================================================
  // KEYBOARD NAVIGATION
  // =====================================================================

  function initKeyboardNav() {
    document.addEventListener('keydown', function (e) {
      // ESC closes lightbox or expanded entry
      if (e.key === 'Escape') {
        if (els.lightbox.classList.contains('active')) {
          closeLightbox();
        } else {
          MapModule.closeExpandedPin();
          showTwoCents();
        }
      }

      // Arrow keys for lightbox
      if (els.lightbox.classList.contains('active')) {
        if (e.key === 'ArrowLeft') navLightbox(-1);
        if (e.key === 'ArrowRight') navLightbox(1);
      } else {
        // Arrow keys for entry navigation (when lightbox is closed)
        if (e.key === 'ArrowLeft') navigateEntry(-1);
        if (e.key === 'ArrowRight') navigateEntry(1);
      }
    });
  }

  // =====================================================================
  // DEEP LINKING (URL hash)
  // =====================================================================

  function checkUrlHash() {
    var hash = window.location.hash.slice(1);
    if (!hash || sortedEntries.length === 0) return;

    // Match by full entry ID or by slug (part after date prefix)
    var entry = null;
    for (var i = 0; i < sortedEntries.length; i++) {
      var e = sortedEntries[i];
      var slug = e.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      if (e.id === hash || slug === hash) {
        entry = e;
        break;
      }
    }

    if (!entry) return;

    var idx = sortedEntries.indexOf(entry);
    navIndex = idx;
    updateNavInfo();

    // Fly to entry
    MapModule.flyToEntry(entry);
    highlightPin(entry.id);

    // Auto-expand after fly animation finishes
    setTimeout(function () {
      var pin = document.querySelector('.cork-pin[data-entry-ids*="' + entry.id + '"]');
      if (pin) {
        var ids = (pin.getAttribute('data-entry-ids') || '').split(',');
        var groupEntries = ids.map(function (id) {
          return sortedEntries.find(function (se) { return se.id === id; });
        }).filter(Boolean);

        MapModule.expandPinEntry(groupEntries, pin, entry.id);
      }
    }, 1400);
  }

  // =====================================================================
  // JOURNEY STATS
  // =====================================================================

  function initJourneyStats() {
    if (!els.journeyStats || sortedEntries.length === 0) {
      if (els.journeyStats) els.journeyStats.style.display = 'none';
      return;
    }

    // Days on the road (first entry to today)
    var firstDate = new Date(sortedEntries[0].date + 'T00:00:00');
    var today = new Date();
    var days = Math.max(1, Math.round((today - firstDate) / (1000 * 60 * 60 * 24)));

    // Number of entries
    var numEntries = sortedEntries.length;

    // Approximate miles (haversine between consecutive entries)
    var totalMiles = 0;
    for (var i = 1; i < sortedEntries.length; i++) {
      totalMiles += haversineDistance(
        sortedEntries[i - 1].coordinates[0], sortedEntries[i - 1].coordinates[1],
        sortedEntries[i].coordinates[0], sortedEntries[i].coordinates[1]
      );
    }
    totalMiles = Math.round(totalMiles);

    // Unique states/regions
    var states = {};
    sortedEntries.forEach(function (e) {
      if (e.location_name) {
        var parts = e.location_name.split(',');
        if (parts.length > 1) {
          states[parts[parts.length - 1].trim()] = true;
        }
      }
    });
    var numStates = Object.keys(states).length;

    // Build stats HTML
    els.journeyStats.innerHTML =
      '<span class="journey-stats__item"><strong>' + days + '</strong> days</span>' +
      '<span class="journey-stats__divider">\u00b7</span>' +
      '<span class="journey-stats__item"><strong>' + numEntries + '</strong> entr' + (numEntries === 1 ? 'y' : 'ies') + '</span>' +
      '<span class="journey-stats__divider">\u00b7</span>' +
      '<span class="journey-stats__item"><strong>~' + totalMiles + '</strong> mi</span>' +
      '<span class="journey-stats__divider">\u00b7</span>' +
      '<span class="journey-stats__item"><strong>' + numStates + '</strong> state' + (numStates === 1 ? '' : 's') + '</span>';
  }

  /**
   * Haversine distance between two [lat, lng] points in miles
   */
  function haversineDistance(lat1, lng1, lat2, lng2) {
    var R = 3959; // Earth radius in miles
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // =====================================================================
  // GISCUS COMMENTS
  // =====================================================================

  var GISCUS_REPO_ID = '';
  var GISCUS_CATEGORY_ID = '';

  function loadGiscus(entryId) {
    if (!GISCUS_REPO_ID || !GISCUS_CATEGORY_ID) return;

    var container = document.getElementById('giscus-' + entryId);
    if (!container || container.querySelector('.giscus')) return;

    var script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.setAttribute('data-repo', 'thealetree/thealetree.github.io');
    script.setAttribute('data-repo-id', GISCUS_REPO_ID);
    script.setAttribute('data-category', 'Journal Comments');
    script.setAttribute('data-category-id', GISCUS_CATEGORY_ID);
    script.setAttribute('data-mapping', 'specific');
    script.setAttribute('data-term', entryId);
    script.setAttribute('data-strict', '0');
    script.setAttribute('data-reactions-enabled', '1');
    script.setAttribute('data-emit-metadata', '0');
    script.setAttribute('data-input-position', 'top');
    script.setAttribute('data-theme', 'preferred_color_scheme');
    script.setAttribute('data-lang', 'en');
    script.setAttribute('data-loading', 'lazy');
    script.crossOrigin = 'anonymous';
    script.async = true;

    container.appendChild(script);
  }

  /**
   * Called by MapModule when user clicks a tab directly — keeps navIndex in sync
   */
  function onTabSwitch(entryId) {
    var idx = sortedEntries.findIndex(function (e) { return e.id === entryId; });
    if (idx !== -1) {
      navIndex = idx;
      updateNavInfo();
    }
  }

  // --- Public API ---
  return {
    init: init,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    loadGiscus: loadGiscus,
    onTabSwitch: onTabSwitch,
  };
})();

// Make AppModule accessible globally for MapModule callbacks
window.AppModule = AppModule;

// Boot
document.addEventListener('DOMContentLoaded', function () {
  AppModule.init();
});
