/* ==========================================================================
   Wandering Wojo — Main Application Module
   Data loading, map-only mode, entry navigation, lightbox
   ========================================================================== */

const AppModule = (function () {
  'use strict';

  // --- Config ---
  // Set your email here to enable the anonymous contact form.
  // Uses Formsubmit.co — first submission triggers a confirmation email.
  var CONTACT_EMAIL = 'thealetree@gmail.com';

  // --- State ---
  let entries = [];
  let locations = [];
  let sortedEntries = [];   // entries sorted chronologically (oldest first)
  let navIndex = 0;         // current index in sortedEntries
  let lightboxPhotos = [];
  let lightboxIndex = 0;

  // --- DOM refs ---
  const els = {};

  /**
   * Initialize the application
   */
  async function init() {
    cacheDom();
    await loadData();
    initMap();
    initFloatingTitle();
    initEntryNav();
    initLightbox();
    initKeyboardNav();
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
    var form = document.getElementById('contact-form');

    // Only the title text toggles open/close
    nameEl.addEventListener('click', function (e) {
      e.stopPropagation();
      els.floatingTitle.classList.toggle('floating-title--open');
    });

    // Clicks anywhere inside the panel (desc, form, etc.) do nothing
    els.floatingTitle.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // Close when clicking outside the panel
    document.addEventListener('click', function () {
      els.floatingTitle.classList.remove('floating-title--open');
    });

    // --- Contact form ---
    if (form) {
      if (!CONTACT_EMAIL) {
        form.style.display = 'none';
        return;
      }
      initContactForm(form);
    }
  }

  function initContactForm(form) {
    var msgInput = document.getElementById('contact-msg');
    var btn = form.querySelector('.contact-form__btn');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var message = msgInput.value.trim();
      if (!message) return;

      btn.disabled = true;
      btn.textContent = 'Sending...';

      // Remove any previous status
      var oldStatus = form.querySelector('.contact-form__status');
      if (oldStatus) oldStatus.remove();

      fetch('https://formsubmit.co/ajax/' + CONTACT_EMAIL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          message: message,
          _subject: 'New message from Wandering Wojo',
          _captcha: 'false',
          _template: 'table'
        })
      })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var status = document.createElement('span');
        status.className = 'contact-form__status contact-form__status--ok';
        status.textContent = 'Sent! Thanks for reaching out.';
        form.appendChild(status);
        msgInput.value = '';
        btn.textContent = 'Send';
        btn.disabled = false;

        // Clear success message after a few seconds
        setTimeout(function () { status.remove(); }, 4000);
      })
      .catch(function () {
        var status = document.createElement('span');
        status.className = 'contact-form__status contact-form__status--err';
        status.textContent = 'Something went wrong. Try again?';
        form.appendChild(status);
        btn.textContent = 'Send';
        btn.disabled = false;

        setTimeout(function () { status.remove(); }, 4000);
      });
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
        MapModule.addRouteFromEntries(entries);
        MapModule.addCorkPins(entries, handlePinClick);
        updateNavInfo();
      });
    }
  }

  function handlePinClick(groupEntries, pinEl, marker) {
    // Default to the most recent entry in the group for navIndex
    var displayEntry = groupEntries[groupEntries.length - 1];
    var idx = sortedEntries.findIndex(function (e) { return e.id === displayEntry.id; });
    if (idx !== -1) navIndex = idx;
    updateNavInfo();
    MapModule.expandPinEntry(groupEntries, pinEl);
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
      return;
    }

    // Different pin — close, fly, highlight
    MapModule.closeExpandedPin();
    MapModule.flyToEntry(entry);
    highlightPin(entry.id);
    updateNavInfo();
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
