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
  let globalPhotoList = [];     // [{src, entryIndex, entryId, title}]
  let globalPhotoIndex = 0;
  let lightboxOriginEntryId = null;

  // --- DOM refs ---
  const els = {};

  // --- Helper: hide/show dock ---
  function hideDock() {
    var dock = document.getElementById('dock');
    if (dock) dock.style.display = 'none';
  }
  function showDock() {
    var dock = document.getElementById('dock');
    if (dock) dock.style.display = '';
  }

  /**
   * Initialize the application
   */
  async function init() {
    cacheDom();
    checkSentRedirect();
    await loadData();
    initMap();
    initDock();
    initEntryNav();
    initLightbox();
    initKeyboardNav();
    initJourneyStats();
    initKladgPlayer();
    loadSuggestionPins();
  }

  /**
   * Cache DOM references
   */
  function cacheDom() {
    els.mapContainer = document.getElementById('map-container');
    els.dock = document.getElementById('dock');
    els.lightbox = document.getElementById('lightbox');
    els.lightboxImg = document.getElementById('lightbox-img');
    els.lightboxClose = document.getElementById('lightbox-close');
    els.lightboxPrev = document.getElementById('lightbox-prev');
    els.lightboxNext = document.getElementById('lightbox-next');
    els.lightboxInfo = document.getElementById('lightbox-info');
    els.lightboxVideo = document.getElementById('lightbox-video');
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

      // Build global photo list for cross-entry lightbox navigation
      buildGlobalPhotoList();
    } catch (err) {
      console.error('Failed to load data:', err);
      entries = [];
      locations = [];
      sortedEntries = [];
    }
  }

  // =====================================================================
  // UNIFIED DOCK
  // =====================================================================

  var placementMode = null; // null or { type: 'food'|'hikes'|... }
  var SUGGEST_MAX = 10;
  var SUGGEST_LABELS = {
    'food': 'Food', 'hikes': 'Hikes', 'hot-springs': 'Hot Springs',
    'people': 'People', 'camping': 'Camping'
  };
  var SUGGEST_COLORS = {
    'food': '#E8913A', 'hikes': '#5B8C3E', 'hot-springs': '#4A9BD9',
    'people': '#C06AB8', 'camping': '#8B6F47'
  };

  function initDock() {
    var dock = document.getElementById('dock');
    var panel = document.getElementById('dock-panel');
    if (!dock) return;

    var tabs = dock.querySelectorAll('.dock__tab[data-dock]');
    var contents = dock.querySelectorAll('.dock__content');

    function openTab(tabName) {
      tabs.forEach(function (t) { t.classList.remove('dock__tab--active'); });
      contents.forEach(function (c) { c.classList.remove('dock__content--active'); });
      var tab = dock.querySelector('[data-dock="' + tabName + '"]');
      var content = dock.querySelector('[data-dock-content="' + tabName + '"]');
      if (tab) tab.classList.add('dock__tab--active');
      if (content) content.classList.add('dock__content--active');
      dock.classList.add('dock--open');

      // Desktop: left tabs flush left, right tabs flush right
      if (window.innerWidth > 768 && tab && panel) {
        var barRect = dock.querySelector('.dock__bar').getBoundingClientRect();
        var tabCenter = tab.getBoundingClientRect().left + tab.offsetWidth / 2;
        var barCenter = barRect.left + barRect.width / 2;
        if (tabCenter > barCenter) {
          // Right-side tab: flush right
          panel.style.marginLeft = (barRect.width - panel.offsetWidth) + 'px';
        } else {
          // Left-side tab: flush left
          panel.style.marginLeft = '0px';
        }
      } else if (panel) {
        panel.style.marginLeft = '';
      }

      // Update suggest remaining when opening suggest tab
      if (tabName === 'suggest') updateSuggestUI();
    }

    function closeDock() {
      dock.classList.remove('dock--open');
      tabs.forEach(function (t) { t.classList.remove('dock__tab--active'); });
      contents.forEach(function (c) { c.classList.remove('dock__content--active'); });
    }

    // Tab click: toggle if already active, otherwise switch
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        var tabName = tab.getAttribute('data-dock');
        if (!tabName) return; // Swag link has no data-dock

        if (tab.classList.contains('dock__tab--active')) {
          closeDock();
        } else {
          // Cancel placement mode if switching tabs
          if (placementMode) cancelPlacementMode();
          openTab(tabName);
        }
      });
    });

    // Clicks inside panel don't close it
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // Click outside closes dock
    document.addEventListener('click', function () {
      closeDock();
    });

    // Init contact form
    var form = document.getElementById('contact-form');
    if (form) {
      if (!CONTACT_EMAIL) {
        var msgTab = dock.querySelector('[data-dock="message"]');
        var msgContent = dock.querySelector('[data-dock-content="message"]');
        if (msgTab) msgTab.style.display = 'none';
        if (msgContent) msgContent.style.display = 'none';
      } else {
        initContactForm(form);
      }
    }

    // Load poll
    loadPoll();

    // Init suggest tab
    initSuggestTab(dock);
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

    // Submit via fetch so we can handle errors gracefully
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msgInput = document.getElementById('contact-msg');
      if (!msgInput.value.trim()) return;

      var btn = form.querySelector('.contact-form__btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      var formData = new FormData(form);
      fetch('https://formsubmit.co/ajax/' + CONTACT_EMAIL, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (!res.ok) throw new Error('Status ' + res.status);
        return res.json();
      }).then(function () {
        btn.textContent = 'Sent!';
        msgInput.value = '';
        var fileInput = document.getElementById('contact-photo');
        var fileNameEl = document.getElementById('contact-file-name');
        if (fileInput) fileInput.value = '';
        if (fileNameEl) fileNameEl.textContent = '';
        setTimeout(function () {
          btn.disabled = false;
          btn.textContent = 'Send anonymously';
        }, 3000);
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = 'Send anonymously';
        showToast('Couldn\u2019t send right now \u2014 the mail service may be temporarily down. Try again later!', 6000);
      });
    });
  }

  function showToast(message, duration) {
    var ms = duration || 5000;
    var toast = document.createElement('div');
    toast.className = 'sent-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('sent-toast--visible');
    });
    setTimeout(function () {
      toast.classList.remove('sent-toast--visible');
      setTimeout(function () { toast.remove(); }, 400);
    }, ms);
  }

  // Check for ?sent=true redirect and show success toast
  function checkSentRedirect() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('sent') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      showToast('Message sent! Thanks for reaching out.');
    }
  }

  // =====================================================================
  // POLL + FIREBASE
  // =====================================================================
  var FIREBASE_DB = 'https://wanderingwojo-default-rtdb.firebaseio.com';

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
      btn.className = 'dock__poll-option';
      if (hasVoted) btn.classList.add('dock__poll-option--voted');
      if (hasVoted && votedOption === key) btn.classList.add('dock__poll-option--selected');

      var barHtml = hasVoted
        ? '<div class="dock__poll-option-bar" style="width:' + pct + '%"></div>'
        : '';
      var countHtml = hasVoted
        ? '<span class="dock__poll-option-count">' + pct + '%</span>'
        : '';

      btn.innerHTML = barHtml +
        '<span class="dock__poll-option-label">' + opt + '</span>' +
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
  // SUGGESTION PINS
  // =====================================================================

  function initSuggestTab(dock) {
    var typeBtns = dock.querySelectorAll('.suggest__type-btn');
    typeBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var type = btn.getAttribute('data-pin-type');
        if (!canSuggest()) return;

        if (placementMode && placementMode.type === type) {
          cancelPlacementMode();
          return;
        }

        // Activate this type
        typeBtns.forEach(function (b) { b.classList.remove('suggest__type-btn--active'); });
        btn.classList.add('suggest__type-btn--active');

        placementMode = { type: type };
        document.body.classList.add('placement-mode');

        // Close dock panel so user can see the map
        dock.classList.remove('dock--open');

        showToast('Tap the map to place a ' + SUGGEST_LABELS[type] + ' pin', 4000);

        // Set up map click callback
        MapModule.setPlacementCallback(function (lngLat) {
          placeSuggestionPin(lngLat, type);
        });
      });
    });

    updateSuggestUI();
  }

  function cancelPlacementMode() {
    placementMode = null;
    document.body.classList.remove('placement-mode');
    MapModule.setPlacementCallback(null);
    var typeBtns = document.querySelectorAll('.suggest__type-btn');
    typeBtns.forEach(function (b) { b.classList.remove('suggest__type-btn--active'); });
  }

  function placeSuggestionPin(lngLat, type) {
    if (!canSuggest()) {
      cancelPlacementMode();
      return;
    }

    var pinData = {
      type: type,
      lng: lngLat.lng,
      lat: lngLat.lat,
      ts: Date.now()
    };

    incrementSuggestCount();
    cancelPlacementMode();
    showToast(SUGGEST_LABELS[type] + ' pin placed!', 3000);

    // Reverse geocode, then write to Firebase with name
    MapModule.reverseGeocodePOI(lngLat.lat, lngLat.lng)
    .then(function (name) {
      if (name) pinData.name = name;
      return fetch(FIREBASE_DB + '/suggestions.json', {
        method: 'POST',
        body: JSON.stringify(pinData)
      });
    })
    .then(function (r) { return r.json(); })
    .then(function (result) {
      var key = result.name; // Firebase returns { name: "<key>" }
      saveOwnPinKey(key);
      pinData.key = key;
      pinData.isOwn = true;
      pinData.onDelete = handleDeleteOwnPin;
      MapModule.addSuggestionPin(pinData);
    })
    .catch(function (err) {
      console.warn('Failed to save suggestion pin:', err);
      MapModule.addSuggestionPin(pinData);
    });
  }

  function handleDeleteOwnPin(key, marker) {
    MapModule.removeSuggestionMarker(marker);
    decrementSuggestCount();
    updateSuggestUI();
    removeOwnPinKey(key);
    showToast('Pin removed', 2000);

    // Delete from Firebase
    fetch(FIREBASE_DB + '/suggestions/' + key + '.json', {
      method: 'DELETE'
    }).catch(function (err) {
      console.warn('Failed to delete suggestion pin:', err);
    });
  }

  function loadSuggestionPins() {
    fetch(FIREBASE_DB + '/suggestions.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data) return;
        var ownKeys = getOwnPinKeys();
        var pins = Object.keys(data).map(function (key) {
          var pin = data[key];
          pin.key = key;
          if (ownKeys.indexOf(key) !== -1) {
            pin.isOwn = true;
            pin.onDelete = handleDeleteOwnPin;
          }
          return pin;
        });
        MapModule.addSuggestionPins(pins);
      })
      .catch(function (err) {
        console.warn('Failed to load suggestion pins:', err);
      });
  }

  function getSuggestCount() {
    return parseInt(localStorage.getItem('wojo_suggest_count') || '0', 10);
  }
  function incrementSuggestCount() {
    var count = getSuggestCount() + 1;
    localStorage.setItem('wojo_suggest_count', String(count));
    return count;
  }
  function decrementSuggestCount() {
    var count = Math.max(0, getSuggestCount() - 1);
    localStorage.setItem('wojo_suggest_count', String(count));
    return count;
  }
  function canSuggest() {
    return getSuggestCount() < SUGGEST_MAX;
  }

  function getOwnPinKeys() {
    try {
      return JSON.parse(localStorage.getItem('wojo_own_pins') || '[]');
    } catch (e) { return []; }
  }
  function saveOwnPinKey(key) {
    var keys = getOwnPinKeys();
    keys.push(key);
    localStorage.setItem('wojo_own_pins', JSON.stringify(keys));
  }
  function removeOwnPinKey(key) {
    var keys = getOwnPinKeys().filter(function (k) { return k !== key; });
    localStorage.setItem('wojo_own_pins', JSON.stringify(keys));
  }

  function updateSuggestUI() {
    var statusEl = document.getElementById('suggest-status');
    var remainEl = document.getElementById('suggest-remaining');
    var typeBtns = document.querySelectorAll('.suggest__type-btn');
    var remaining = SUGGEST_MAX - getSuggestCount();

    if (remainEl) {
      remainEl.textContent = remaining > 0
        ? remaining + ' pin' + (remaining !== 1 ? 's' : '') + ' remaining'
        : '';
    }
    if (statusEl) {
      statusEl.textContent = remaining <= 0
        ? 'You\u2019ve placed all ' + SUGGEST_MAX + ' pins for this session.'
        : '';
    }
    typeBtns.forEach(function (btn) {
      btn.disabled = remaining <= 0;
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
        // Set initial active entry and show thumbs for current entry and neighbors
        if (sortedEntries.length > 0) {
          MapModule.updatePinPreview(sortedEntries[navIndex].id);
          MapModule.updateThumbVisibility(sortedEntries[navIndex].id);
        }

        // Position map to show entries
        if (entries.length > 0) {
          var isMobile = window.innerWidth < 768;
          var latestEntry = sortedEntries[sortedEntries.length - 1];

          // Center on the most recent entry at a comfortable zoom
          var lngLat = [latestEntry.coordinates[1], latestEntry.coordinates[0]];
          // Offset center downward so entry appears vertically centered
          // between the top buttons and the bottom dock
          map.flyTo({ center: lngLat, zoom: 5.5, duration: 500, offset: [0, -73] });

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
    hideDock();
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
    MapModule.updatePinPreview(displayEntry.id);
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

  function buildGlobalPhotoList() {
    globalPhotoList = [];
    sortedEntries.forEach(function (entry, eIdx) {
      (entry.photos || []).forEach(function (photo) {
        globalPhotoList.push({
          src: photo,
          type: 'photo',
          entryIndex: eIdx,
          entryId: entry.id,
          title: entry.title
        });
      });
      // Include video as a navigable item
      if (entry.video_url) {
        var ytMatch = entry.video_url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/);
        if (ytMatch) {
          globalPhotoList.push({
            src: 'https://www.youtube.com/embed/' + ytMatch[1] + '?autoplay=1',
            type: 'video',
            entryIndex: eIdx,
            entryId: entry.id,
            title: entry.title
          });
        }
      }
    });
  }

  function openLightbox(entryId, photoIndex) {
    lightboxOriginEntryId = entryId;
    // Find position in global list
    var found = -1;
    var photoCount = 0;
    for (var i = 0; i < globalPhotoList.length; i++) {
      if (globalPhotoList[i].entryId === entryId) {
        if (photoCount === (photoIndex || 0)) { found = i; break; }
        photoCount++;
      }
    }
    globalPhotoIndex = found !== -1 ? found : 0;
    updateLightboxImage();
    els.lightbox.classList.add('active');
    els.lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    els.lightbox.classList.remove('active');
    els.lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // Stop any playing video
    els.lightboxVideo.src = '';
    els.lightboxVideo.style.display = 'none';
    els.lightboxImg.style.display = '';

    if (globalPhotoList.length > 0) {
      var currentItem = globalPhotoList[globalPhotoIndex];
      if (currentItem.entryId !== lightboxOriginEntryId) {
        // User navigated to a different entry — fly there and expand
        navIndex = currentItem.entryIndex;
        var entryId = currentItem.entryId;
        updateNavInfo();
        MapModule.closeExpandedPin();
        MapModule.flyToEntry(sortedEntries[navIndex]);
        highlightPin(entryId);
        MapModule.updateThumbVisibility(entryId);
        hideDock();
        // Expand after fly animation completes
        setTimeout(function () {
          hideDock();
          MapModule.expandByEntryId(entryId);
        }, 1300);
      }
    }
  }

  function navLightbox(dir) {
    globalPhotoIndex = (globalPhotoIndex + dir + globalPhotoList.length) % globalPhotoList.length;
    updateLightboxImage();
  }

  function updateLightboxImage() {
    if (globalPhotoList.length === 0) return;
    var item = globalPhotoList[globalPhotoIndex];

    if (item.type === 'video') {
      els.lightboxImg.style.display = 'none';
      els.lightboxVideo.style.display = 'block';
      els.lightboxVideo.src = item.src;
    } else {
      els.lightboxVideo.style.display = 'none';
      els.lightboxVideo.src = '';
      els.lightboxImg.style.display = '';
      els.lightboxImg.src = item.src;
      els.lightboxImg.alt = item.title;
    }

    var showNav = globalPhotoList.length > 1;
    els.lightboxPrev.style.display = showNav ? '' : 'none';
    els.lightboxNext.style.display = showNav ? '' : 'none';

    // Update info overlay
    els.lightboxInfo.textContent = item.title + '  \u00b7  ' + (item.entryIndex + 1) + ' / ' + sortedEntries.length;
  }

  // =====================================================================
  // KEYBOARD NAVIGATION
  // =====================================================================

  function initKeyboardNav() {
    document.addEventListener('keydown', function (e) {
      // ESC closes lightbox or expanded entry
      if (e.key === 'Escape') {
        if (placementMode) {
          cancelPlacementMode();
        } else if (els.lightbox.classList.contains('active')) {
          closeLightbox();
        } else {
          MapModule.closeExpandedPin();
          showDock();
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

        hideDock();
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

    // Approximate driving miles (haversine × 1.35 road circuity factor)
    var totalMiles = 0;
    for (var i = 1; i < sortedEntries.length; i++) {
      totalMiles += haversineDistance(
        sortedEntries[i - 1].coordinates[0], sortedEntries[i - 1].coordinates[1],
        sortedEntries[i].coordinates[0], sortedEntries[i].coordinates[1]
      );
    }
    totalMiles = Math.round(totalMiles * 1.35);

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

  /* ========================================================================
     KLADG Radio Mini Player
     ======================================================================== */
  function initKladgPlayer() {
    var tracks = [];
    var artMap = {};
    var history = [];
    var historyIndex = -1;
    var audio = new Audio();
    audio.preload = 'auto';
    var isPlaying = false;

    // DOM references — desktop
    var dArt = document.getElementById('kladg-art');
    var dTitle = document.getElementById('kladg-title');
    var dPlay = document.getElementById('kladg-play');
    var dPrev = document.getElementById('kladg-prev');
    var dNext = document.getElementById('kladg-next');
    var dHeader = document.getElementById('kladg-header');

    // DOM references — mobile
    var mPlayer = document.getElementById('kladg-player-mobile');
    var mArt = mPlayer ? mPlayer.querySelector('.kladg-player__art') : null;
    var mTitle = mPlayer ? mPlayer.querySelector('.kladg-player__title') : null;
    var mPlay = mPlayer ? mPlayer.querySelector('[data-kladg="play"]') : null;
    var mPrev = mPlayer ? mPlayer.querySelector('[data-kladg="prev"]') : null;
    var mNext = mPlayer ? mPlayer.querySelector('[data-kladg="next"]') : null;

    // Load data
    Promise.all([
      fetch('data/kladg-tracks.json').then(function(r) { return r.json(); }),
      fetch('data/kladg-art.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
      tracks = results[0];
      results[1].forEach(function(a) { artMap[a.id] = a.filename; });
      // Load a random track but don't autoplay
      loadTrack(pickRandom(), false);
    }).catch(function() {
      updateUI('KLADG Radio', '', 'https://kladg.com');
    });

    function pickRandom() {
      if (tracks.length === 0) return null;
      var recent = history.slice(-10).map(function(h) { return h.id; });
      var candidates = tracks.filter(function(t) { return recent.indexOf(t.id) === -1; });
      if (candidates.length === 0) candidates = tracks;
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function loadTrack(track, autoplay) {
      if (!track) return;
      var src = 'https://kladg.com' + (track.archiveUrl || track.localUrl);
      audio.src = src;
      audio.load();

      // Add to history
      if (historyIndex < 0 || history[historyIndex].id !== track.id) {
        history = history.slice(0, historyIndex + 1);
        history.push(track);
        historyIndex = history.length - 1;
      }

      var artFile = artMap[track.artId] || '';
      var artUrl = artFile ? 'https://kladg.com/art/' + artFile : '';
      var trackUrl = 'https://kladg.com/#/track/' + track.id;
      updateUI(track.title, artUrl, trackUrl);

      if (autoplay) {
        audio.play().then(function() {
          isPlaying = true;
          updatePlayBtn();
        }).catch(function() {});
      }
    }

    function updateUI(title, artUrl, trackUrl) {
      [dTitle, mTitle].forEach(function(el) {
        if (!el) return;
        el.textContent = title;
        el.href = trackUrl;
      });
      [dArt, mArt].forEach(function(el) {
        if (!el) return;
        if (artUrl) {
          el.src = artUrl;
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      });
      [dHeader].forEach(function(el) {
        if (el) el.href = trackUrl;
      });
      if (mPlayer) {
        var mHeader = mPlayer.querySelector('.kladg-player__header');
        if (mHeader) mHeader.href = trackUrl;
      }
    }

    function updatePlayBtn() {
      var icon = isPlaying ? '\u23F8' : '\u25B6';
      if (dPlay) dPlay.textContent = icon;
      if (mPlay) mPlay.textContent = icon;
    }

    function togglePlay() {
      if (!audio.src) return;
      if (isPlaying) {
        audio.pause();
        isPlaying = false;
      } else {
        audio.play().catch(function() {});
        isPlaying = true;
      }
      updatePlayBtn();
    }

    function skipNext() {
      var track = pickRandom();
      if (track) loadTrack(track, true);
    }

    function skipPrev() {
      if (historyIndex > 0) {
        historyIndex--;
        loadTrack(history[historyIndex], true);
      }
    }

    // Event listeners — desktop
    if (dPlay) dPlay.addEventListener('click', function(e) { e.stopPropagation(); togglePlay(); });
    if (dNext) dNext.addEventListener('click', function(e) { e.stopPropagation(); skipNext(); });
    if (dPrev) dPrev.addEventListener('click', function(e) { e.stopPropagation(); skipPrev(); });

    // Event listeners — mobile
    if (mPlay) mPlay.addEventListener('click', function(e) { e.stopPropagation(); togglePlay(); });
    if (mNext) mNext.addEventListener('click', function(e) { e.stopPropagation(); skipNext(); });
    if (mPrev) mPrev.addEventListener('click', function(e) { e.stopPropagation(); skipPrev(); });

    // Auto-advance on track end
    audio.addEventListener('ended', function() {
      isPlaying = false;
      updatePlayBtn();
      skipNext();
    });
  }
})();

// Make AppModule accessible globally for MapModule callbacks
window.AppModule = AppModule;

// Boot
document.addEventListener('DOMContentLoaded', function () {
  AppModule.init();
});
