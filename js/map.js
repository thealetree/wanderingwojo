/* ==========================================================================
   Wandering Wojo — Map Module
   Mapbox GL JS: route line, markers, cork board pins
   ========================================================================== */

/*
  ============================================================
  Mapbox PUBLIC token (pk.*) — safe for frontend use.
  This is NOT a secret key. Mapbox public tokens are designed
  to live in client-side code. URL restrictions are configured
  in the Mapbox account dashboard to limit usage to:
    - thealetree.github.io
    - localhost
  ============================================================
*/
const MAPBOX_TOKEN = 'pk.eyJ1Ijoid2FuZGVyaW5nd29qbyIsImEiOiJjbW1ianhoeHYwcDlpMnNvaHoyMWliMGZ4In0.et5PRnxY8JVcu2NYf0pIqA';

const MapModule = (function () {
  'use strict';

  let map = null;
  let markers = [];
  let corkPins = [];
  let activePopup = null;
  let expandedPinEl = null;
  let expandedPinEntries = [];
  let expandedTabIndex = 0;
  let isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Route coordinates — built dynamically from entries
  let routeCoords = [];

  /**
   * Initialize the map. Returns false if no valid token.
   */
  function init() {
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'YOUR_MAPBOX_TOKEN_HERE') {
      document.getElementById('map').classList.add('hidden');
      document.getElementById('map-fallback').classList.remove('hidden');
      return false;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map = new mapboxgl.Map({
      container: 'map',
      style: isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [-112, 40],   // roughly center of the SW route
      zoom: 5,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    // Route is added later via addRouteFromEntries()

    // Close expanded pin when clicking the map background
    map.on('click', function (e) {
      // Only close if click is on the map itself, not on a marker/pin
      if (e.originalEvent.target === map.getCanvas()) {
        closeExpandedPin();
      }
    });

    return true;
  }

  /**
   * Build route from sorted entries and add to map
   */
  function addRouteFromEntries(entries) {
    if (!map || entries.length < 2) return;

    // Sort chronologically and extract [lng, lat] for Mapbox
    var sorted = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });

    var waypoints = sorted.map(function (e) {
      return [e.coordinates[1], e.coordinates[0]];
    });

    // Build meandering path between each pair of waypoints
    routeCoords = [];
    for (var i = 0; i < waypoints.length - 1; i++) {
      var segment = meanderSegment(waypoints[i], waypoints[i + 1], i);
      // Add all points except the last (to avoid duplicates at joins)
      for (var j = 0; j < segment.length - 1; j++) {
        routeCoords.push(segment[j]);
      }
    }
    // Add final waypoint
    routeCoords.push(waypoints[waypoints.length - 1]);

    addRouteLayer();
  }

  /**
   * Generate a meandering path between two [lng, lat] points.
   * Wander amount is proportional to segment length so all segments
   * look equally organic regardless of distance.
   */
  function meanderSegment(from, to, seed) {
    var dx = to[0] - from[0];
    var dy = to[1] - from[1];
    var dist = Math.sqrt(dx * dx + dy * dy);

    // Skip meandering for zero/near-zero distance (same location)
    if (dist < 0.001) return [from, to];

    // Number of intermediate points — more for longer segments
    var steps = Math.max(12, Math.round(dist * 8));

    // Perpendicular unit vector
    var px = -dy / dist;
    var py = dx / dist;

    // Wander amplitude scales with segment length (~3% of distance)
    var amp = dist * 0.03;

    // Seeded pseudo-random using sine — deterministic per segment
    var s = (seed + 1) * 7.3;

    var points = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      // Layered sine waves at different frequencies for organic feel
      var noise =
        Math.sin(t * 6.2831 * 2.0 + s * 1.1) * 0.5 +
        Math.sin(t * 6.2831 * 3.7 + s * 2.3) * 0.3 +
        Math.sin(t * 6.2831 * 7.1 + s * 0.7) * 0.2;

      // Taper at endpoints so the line meets waypoints cleanly
      var taper = Math.sin(t * Math.PI);
      var offset = noise * amp * taper;

      points.push([
        from[0] + dx * t + px * offset,
        from[1] + dy * t + py * offset
      ]);
    }
    return points;
  }

  /**
   * Add the route line to the map
   */
  function addRouteLayer() {
    if (routeCoords.length < 2) return;

    var routeColor = isDark ? '#B87D6A' : '#C1440E';

    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: routeCoords,
        },
      },
    });

    // Glow layer (wider, semi-transparent — soft crayon halo)
    map.addLayer({
      id: 'route-glow',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': routeColor,
        'line-width': 6,
        'line-opacity': 0.1,
        'line-blur': 8,
      },
    });

    // Main route line — crayon-like dashes
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': routeColor,
        'line-width': 3,
        'line-opacity': 0.6,
        'line-dasharray': [3, 2.5],
      },
    });

    // Animate dash
    animateRouteDash();
  }

  /**
   * Animate the route dash pattern
   */
  function animateRouteDash() {
    let offset = 0;
    function step() {
      offset = (offset + 0.5) % 200;
      if (map.getLayer('route-line')) {
        map.setPaintProperty('route-line', 'line-dasharray', [2, 4]);
      }
      requestAnimationFrame(step);
    }
    step();
  }

  /**
   * Add location markers only for locations that have journal entries
   */
  function addLocationMarkers(locations, entries) {
    if (!map) return;

    // Build a set of entry location names to filter by
    var entryLocationNames = {};
    if (entries) {
      entries.forEach(function (e) {
        if (e.location_name) entryLocationNames[e.location_name] = true;
      });
    }

    locations.forEach(function (loc) {
      // Skip locations that have no matching entries
      if (entries && !entryLocationNames[loc.name]) return;
      const el = document.createElement('div');

      if (loc.status === 'current') {
        el.className = 'marker-current';
      } else if (loc.status === 'visited') {
        el.className = 'marker-visited';
      } else {
        el.className = 'marker-planned';
      }

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(loc.coordinates)
        .setPopup(
          new mapboxgl.Popup({ offset: 12, closeButton: true, maxWidth: '220px' })
            .setHTML(
              '<div class="popup-name">' + escapeHtml(loc.name) + '</div>' +
              (loc.date_arrived
                ? '<div class="popup-date">' + formatDate(loc.date_arrived) + '</div>'
                : '<div class="popup-date">Planned</div>') +
              '<div class="popup-note">' + escapeHtml(loc.note) + '</div>'
            )
        )
        .addTo(map);

      markers.push({ marker, data: loc });
    });
  }

  /**
   * Add cork board pins for journal entries, grouped by location_name
   */
  function addCorkPins(entries, onPinClick) {
    if (!map) return;

    // Sort all entries chronologically
    var sorted = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    var entryNumber = {};
    sorted.forEach(function (e, i) { entryNumber[e.id] = i + 1; });
    var total = sorted.length;

    // Group entries by location_name
    var groups = {};
    var groupOrder = [];
    sorted.forEach(function (entry) {
      var key = entry.location_name;
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      groups[key].push(entry);
    });

    // Create one pin per location group
    groupOrder.forEach(function (locationName) {
      var groupEntries = groups[locationName]; // already chronological
      var displayEntry = groupEntries[groupEntries.length - 1]; // most recent for display
      var positionEntry = groupEntries[0]; // earliest for map position
      var isGrouped = groupEntries.length > 1;

      var pinEl = document.createElement('div');
      pinEl.className = 'cork-pin';
      if (isGrouped) pinEl.classList.add('cork-pin--grouped');
      pinEl.setAttribute('data-entry-ids', groupEntries.map(function (e) { return e.id; }).join(','));

      var typeClass = 'cork-pin__type--' + displayEntry.type;
      var typeLabel = formatType(displayEntry.type);

      var numberDisplay;
      if (isGrouped) {
        var firstNum = entryNumber[groupEntries[0].id] || '';
        var lastNum = entryNumber[groupEntries[groupEntries.length - 1].id] || '';
        numberDisplay = firstNum + '-' + lastNum + '/' + total;
      } else {
        numberDisplay = (entryNumber[displayEntry.id] || '') + '/' + total;
      }

      pinEl.innerHTML =
        '<div class="cork-pin__nail"></div>' +
        '<div class="cork-pin__card">' +
          '<span class="cork-pin__type ' + typeClass + '">' + typeLabel + '</span>' +
          '<div class="cork-pin__title">' + escapeHtml(displayEntry.title) + '</div>' +
          '<div class="cork-pin__meta-row">' +
            '<span class="cork-pin__date">' + formatDate(displayEntry.date) + '</span>' +
            '<span class="cork-pin__number">' + numberDisplay + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cork-pin__anchor"></div>';

      var lngLat = [positionEntry.coordinates[1], positionEntry.coordinates[0]];

      var marker = new mapboxgl.Marker({
        element: pinEl,
        anchor: 'bottom',
        offset: [0, 0],
      })
        .setLngLat(lngLat)
        .addTo(map);

      pinEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (onPinClick) onPinClick(groupEntries, pinEl, marker);
      });

      corkPins.push({ marker: marker, element: pinEl, entries: groupEntries });
    });
  }

  /**
   * Build the HTML content for a single entry (used by expand and tab switch)
   */
  function buildEntryContentHtml(entry) {
    var typeClass = 'cork-pin__type--' + entry.type;
    var typeLabel = formatType(entry.type);
    var moodColor = getMoodColor(entry.mood_value != null ? entry.mood_value : 0.5);
    var moodWidth = Math.round((entry.mood_value != null ? entry.mood_value : 0.5) * 100);

    var html =
      '<div class="entry-expanded__header">' +
        '<picture class="wojo-illustration">' +
          '<source srcset="svg/woj_whitelines.svg" media="(prefers-color-scheme: dark)">' +
          '<img src="svg/Woj_darklines.svg" alt="" class="wojo-illustration__img">' +
        '</picture>' +
        '<span class="entry-expanded__type ' + typeClass + '">' + typeLabel + '</span>' +
        '<div class="entry-expanded__location">' + escapeHtml(entry.location_name) +
        '&ensp;&middot;&ensp;' + entry.coordinates[0].toFixed(4) + ', ' + entry.coordinates[1].toFixed(4) + '</div>' +
        '<div class="entry-expanded__date">' + formatDate(entry.date) + '</div>' +
        '<h3 class="entry-expanded__title">' + escapeHtml(entry.title) + '</h3>' +
      '</div>' +
      '<div class="entry-expanded__body">' + renderBody(entry.body) + '</div>';

    if (entry.mood_left && entry.mood_right) {
      html +=
        '<div class="wojo-mood">' +
          '<span class="wojo-mood__label">' + escapeHtml(entry.mood_left) + '</span>' +
          '<div class="wojo-mood__bar">' +
            '<div class="wojo-mood__fill" style="width:' + moodWidth + '%;background:' + moodColor + ';"></div>' +
          '</div>' +
          '<span class="wojo-mood__label">' + escapeHtml(entry.mood_right) + '</span>' +
        '</div>';
    }

    if (entry.photos && entry.photos.length > 0) {
      html += '<div class="entry-expanded__photos">';
      entry.photos.forEach(function (photo, i) {
        html += '<div class="entry-expanded__photo" data-photo-index="' + i + '" data-entry-id="' + entry.id + '">' +
          '<img src="' + escapeHtml(photo) + '" alt="Photo from ' + escapeHtml(entry.location_name) + '" loading="lazy">' +
        '</div>';
      });
      html += '</div>';
    }

    if (entry.video_url) {
      html +=
        '<div class="entry-expanded__video">' +
          '<div class="video-wrapper">' +
            '<iframe src="' + escapeHtml(entry.video_url) + '" allowfullscreen loading="lazy"></iframe>' +
          '</div>' +
        '</div>';
    }

    html +=
      '<div class="entry-expanded__comments" id="giscus-' + entry.id + '">' +
        '<!-- Giscus loads here -->' +
      '</div>';

    return html;
  }

  /**
   * Bind photo click handlers on the expanded content
   */
  function bindPhotoHandlers(expanded, entry) {
    expanded.querySelectorAll('.entry-expanded__photo').forEach(function (photoEl) {
      photoEl.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(photoEl.getAttribute('data-photo-index'));
        if (window.AppModule && window.AppModule.openLightbox) {
          window.AppModule.openLightbox(entry.photos, idx);
        }
      });
    });
  }

  /**
   * Pan map so expanded card top is visible
   */
  function panToExpandedEntry(entry, expanded) {
    // Wait for card to fully render before measuring
    setTimeout(function () {
      var lngLat = [entry.coordinates[1], entry.coordinates[0]];
      var cardHeight = expanded.offsetHeight || 300;
      var viewportWidth = map.getContainer().offsetWidth;
      var padding = 20;

      // The pin is at the bottom-center of the expanded card (anchor: bottom).
      // Card extends cardHeight px upward from pin position.
      // We want pin to be at screen Y = cardHeight + padding so the
      // card top lands at Y = padding.
      var targetPinY = cardHeight + padding;
      // Center horizontally: pin should be at viewport center
      var targetPinX = viewportWidth / 2;

      var currentPoint = map.project(lngLat);
      var shiftY = currentPoint.y - targetPinY;
      var shiftX = currentPoint.x - targetPinX;

      var centerPoint = map.project(map.getCenter());
      centerPoint.y += shiftY;
      centerPoint.x += shiftX;
      var newCenter = map.unproject(centerPoint);
      map.easeTo({
        center: newCenter,
        duration: 800,
        easing: function (t) {
          // Smooth ease-out cubic
          return 1 - Math.pow(1 - t, 3);
        }
      });
    }, 250);
  }

  /**
   * Switch tab within an already-expanded grouped pin
   */
  function switchTab(expanded, sortedGroup, newIndex) {
    expandedTabIndex = newIndex;

    // Update tab active states
    expanded.querySelectorAll('.entry-tabs__tab').forEach(function (tab, i) {
      tab.classList.toggle('entry-tabs__tab--active', i === newIndex);
    });

    // Replace content
    var contentEl = expanded.querySelector('.entry-expanded__content');
    if (contentEl) {
      contentEl.innerHTML = buildEntryContentHtml(sortedGroup[newIndex]);
    }

    // Rebind photo handlers
    bindPhotoHandlers(expanded, sortedGroup[newIndex]);

    // Load Giscus for new tab
    if (window.AppModule && window.AppModule.loadGiscus) {
      window.AppModule.loadGiscus(sortedGroup[newIndex].id);
    }

    // Sync navIndex in AppModule
    if (window.AppModule && window.AppModule.onTabSwitch) {
      window.AppModule.onTabSwitch(sortedGroup[newIndex].id);
    }
  }

  /**
   * Expand a pin with entries (supports grouped locations with tabs)
   * @param {Array} entries - array of entries at this location
   * @param {HTMLElement} pinEl - the pin DOM element
   * @param {string} [targetEntryId] - optional entry ID to pre-select
   */
  function expandPinEntry(entries, pinEl, targetEntryId) {
    closeExpandedPin();

    var card = pinEl.querySelector('.cork-pin__card');
    if (!card) return;
    card.style.display = 'none';

    // Sort entries chronologically within group
    var sortedGroup = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });

    // Determine which tab to show
    var activeIndex = 0;
    if (targetEntryId) {
      sortedGroup.forEach(function (e, i) {
        if (e.id === targetEntryId) activeIndex = i;
      });
    }

    expandedPinEntries = sortedGroup;
    expandedTabIndex = activeIndex;

    // Create expanded container
    var expanded = document.createElement('div');
    expanded.className = 'entry-expanded';
    expanded.setAttribute('data-expanded', 'true');

    // Build tab bar (only if multiple entries)
    var tabBarHtml = '';
    if (sortedGroup.length > 1) {
      tabBarHtml = '<div class="entry-tabs">';
      sortedGroup.forEach(function (e, i) {
        var activeClass = i === activeIndex ? ' entry-tabs__tab--active' : '';
        tabBarHtml +=
          '<button class="entry-tabs__tab' + activeClass + '" data-tab-index="' + i + '">' +
            formatDate(e.date) +
          '</button>';
      });
      tabBarHtml += '</div>';
    }

    expanded.innerHTML =
      '<div class="entry-expanded__sticky-header">' +
        '<button class="entry-expanded__close" aria-label="Close">&times;</button>' +
        tabBarHtml +
      '</div>' +
      '<div class="entry-expanded__content">' +
        buildEntryContentHtml(sortedGroup[activeIndex]) +
      '</div>';

    // Insert into pin
    pinEl.appendChild(expanded);
    expandedPinEl = pinEl;

    // Hide floating title
    var floatingTitle = document.getElementById('floating-title');
    if (floatingTitle) floatingTitle.style.display = 'none';

    // Mobile touch scroll
    ['touchstart', 'touchmove', 'touchend'].forEach(function (evt) {
      expanded.addEventListener(evt, function (e) { e.stopPropagation(); });
    });

    // Close button
    expanded.querySelector('.entry-expanded__close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeExpandedPin();
    });

    // Tab click handlers
    expanded.querySelectorAll('.entry-tabs__tab').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(tabBtn.getAttribute('data-tab-index'));
        switchTab(expanded, sortedGroup, idx);
      });
    });

    // Bind photo handlers for initial tab
    bindPhotoHandlers(expanded, sortedGroup[activeIndex]);

    // Load Giscus
    if (window.AppModule && window.AppModule.loadGiscus) {
      window.AppModule.loadGiscus(sortedGroup[activeIndex].id);
    }

    // Pan map
    panToExpandedEntry(sortedGroup[activeIndex], expanded);
  }

  /**
   * Switch to a specific entry within the currently expanded pin (tab switch)
   * Returns true if successful, false if entryId not in current pin
   */
  function switchToEntryInExpandedPin(entryId) {
    if (!expandedPinEl || expandedPinEntries.length < 2) return false;

    var idx = -1;
    expandedPinEntries.forEach(function (e, i) {
      if (e.id === entryId) idx = i;
    });
    if (idx === -1) return false;

    var expanded = expandedPinEl.querySelector('[data-expanded="true"]');
    if (!expanded) return false;

    switchTab(expanded, expandedPinEntries, idx);
    return true;
  }

  /**
   * Get entry IDs in the currently expanded pin
   */
  function getExpandedPinEntryIds() {
    if (!expandedPinEl || !expandedPinEntries.length) return [];
    return expandedPinEntries.map(function (e) { return e.id; });
  }

  /**
   * Close any expanded cork board entry
   */
  function closeExpandedPin() {
    if (!expandedPinEl) return;

    var expanded = expandedPinEl.querySelector('[data-expanded="true"]');
    if (expanded) expanded.remove();

    var card = expandedPinEl.querySelector('.cork-pin__card');
    if (card) card.style.display = '';

    expandedPinEl = null;
    expandedPinEntries = [];
    expandedTabIndex = 0;

    // Restore floating title
    var floatingTitle = document.getElementById('floating-title');
    if (floatingTitle) floatingTitle.style.display = '';
  }

  /**
   * Show/hide cork board pins
   */
  function showCorkPins(show) {
    corkPins.forEach(function (pin) {
      pin.element.style.display = show ? '' : 'none';
    });
  }

  /**
   * Pan and highlight a specific location on the map
   */
  function flyToEntry(entry) {
    if (!map) return;

    const lngLat = [entry.coordinates[1], entry.coordinates[0]];
    map.flyTo({
      center: lngLat,
      zoom: 8,
      duration: 1200,
      essential: true,
    });
  }

  /**
   * Get the current location from locations data
   */
  function getCurrentLocation(locations) {
    const current = locations.find(function (l) { return l.status === 'current'; });
    return current || locations[locations.length - 1];
  }

  // --- Utilities ---

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatType(type) {
    if (!type) return '';
    return type.replace(/-/g, ' ').toUpperCase();
  }

  function renderBody(body) {
    if (!body) return '';
    // Simple paragraph rendering — split on double newline
    return body.split(/\n\n+/).map(function (p) {
      return '<p>' + escapeHtml(p.trim()) + '</p>';
    }).join('');
  }

  function getMoodColor(value) {
    // Interpolate from sage (#7C9A7E) at 0 to terracotta (#C1440E) at 1
    var r = Math.round(124 + (193 - 124) * value);
    var g = Math.round(154 + (68 - 154) * value);
    var b = Math.round(126 + (14 - 126) * value);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // --- Public API ---
  return {
    init: init,
    addLocationMarkers: addLocationMarkers,
    addRouteFromEntries: addRouteFromEntries,
    addCorkPins: addCorkPins,
    expandPinEntry: expandPinEntry,
    closeExpandedPin: closeExpandedPin,
    switchToEntryInExpandedPin: switchToEntryInExpandedPin,
    getExpandedPinEntryIds: getExpandedPinEntryIds,
    showCorkPins: showCorkPins,
    flyToEntry: flyToEntry,
    getCurrentLocation: getCurrentLocation,
    getMap: function () { return map; },
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatType: formatType,
    renderBody: renderBody,
    getMoodColor: getMoodColor,
  };
})();
