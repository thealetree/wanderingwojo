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

    routeCoords = sorted.map(function (e) {
      return [e.coordinates[1], e.coordinates[0]];
    });

    addRouteLayer();
  }

  /**
   * Add the route line to the map
   */
  function addRouteLayer() {
    if (routeCoords.length < 2) return;

    var routeColor = isDark ? '#B0ABA5' : '#3D3A37';

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

    // Glow layer (wider, semi-transparent)
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
        'line-width': 5,
        'line-opacity': 0.08,
        'line-blur': 6,
      },
    });

    // Main route line
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
        'line-width': 2,
        'line-opacity': 0.5,
        'line-dasharray': [2, 4],
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
   * Add cork board pins for journal entries
   */
  function addCorkPins(entries, onPinClick) {
    if (!map) return;

    // Build chronological index lookup (1-based)
    var sorted = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    var entryNumber = {};
    sorted.forEach(function (e, i) { entryNumber[e.id] = i + 1; });
    var total = sorted.length;

    entries.forEach(function (entry) {
      const pinEl = document.createElement('div');
      pinEl.className = 'cork-pin';
      pinEl.setAttribute('data-entry-id', entry.id);

      const typeClass = 'cork-pin__type--' + entry.type;
      const typeLabel = formatType(entry.type);
      const num = entryNumber[entry.id] || '';

      pinEl.innerHTML =
        '<div class="cork-pin__card">' +
          '<span class="cork-pin__type ' + typeClass + '">' + typeLabel + '</span>' +
          '<div class="cork-pin__title">' + escapeHtml(entry.title) + '</div>' +
          '<div class="cork-pin__meta-row">' +
            '<span class="cork-pin__date">' + formatDate(entry.date) + '</span>' +
            '<span class="cork-pin__number">' + num + '/' + total + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cork-pin__anchor"></div>';

      // Coordinates in entries are [lat, lng], need [lng, lat] for Mapbox
      const lngLat = [entry.coordinates[1], entry.coordinates[0]];

      const marker = new mapboxgl.Marker({
        element: pinEl,
        anchor: 'bottom',
        offset: [0, 0],
      })
        .setLngLat(lngLat)
        .addTo(map);

      pinEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (onPinClick) onPinClick(entry, pinEl, marker);
      });

      corkPins.push({ marker, element: pinEl, data: entry });
    });
  }

  /**
   * Expand an entry on the cork board (in-place card expansion)
   */
  function expandPinEntry(entry, pinEl) {
    closeExpandedPin();

    const card = pinEl.querySelector('.cork-pin__card');
    if (!card) return;

    // Hide the small card content
    card.style.display = 'none';

    // Create expanded content
    const expanded = document.createElement('div');
    expanded.className = 'entry-expanded';
    expanded.setAttribute('data-expanded', 'true');

    const typeClass = 'cork-pin__type--' + entry.type;
    const typeLabel = formatType(entry.type);

    // Build mood bar color (sage to terracotta based on mood_value)
    const moodColor = getMoodColor(entry.mood_value != null ? entry.mood_value : 0.5);
    const moodWidth = Math.round((entry.mood_value != null ? entry.mood_value : 0.5) * 100);

    let html =
      '<div class="entry-expanded__header" style="position:relative;">' +
        '<button class="entry-expanded__close" aria-label="Close">&times;</button>' +
        '<span class="entry-expanded__type ' + typeClass + '">' + typeLabel + '</span>' +
        '<div class="entry-expanded__location">' + escapeHtml(entry.location_name) +
        '&ensp;&middot;&ensp;' + entry.coordinates[0].toFixed(4) + ', ' + entry.coordinates[1].toFixed(4) + '</div>' +
        '<div class="entry-expanded__date">' + formatDate(entry.date) + '</div>' +
        '<h3 class="entry-expanded__title">' + escapeHtml(entry.title) + '</h3>' +
      '</div>' +
      '<div class="entry-expanded__body">' + renderBody(entry.body) + '</div>';

    // Mood bar
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

    // Photos
    if (entry.photos && entry.photos.length > 0) {
      html += '<div class="entry-expanded__photos">';
      entry.photos.forEach(function (photo, i) {
        html += '<div class="entry-expanded__photo" data-photo-index="' + i + '" data-entry-id="' + entry.id + '">' +
          '<img src="' + escapeHtml(photo) + '" alt="Photo from ' + escapeHtml(entry.location_name) + '" loading="lazy">' +
        '</div>';
      });
      html += '</div>';
    }

    // Video
    if (entry.video_url) {
      html +=
        '<div class="entry-expanded__video">' +
          '<div class="video-wrapper">' +
            '<iframe src="' + escapeHtml(entry.video_url) + '" allowfullscreen loading="lazy"></iframe>' +
          '</div>' +
        '</div>';
    }

    // Giscus placeholder
    html +=
      '<div class="entry-expanded__comments" id="giscus-' + entry.id + '">' +
        '<!-- Giscus loads here -->' +
      '</div>';

    expanded.innerHTML = html;

    // Insert expanded element into the pin
    pinEl.appendChild(expanded);
    expandedPinEl = pinEl;

    // Close button handler
    expanded.querySelector('.entry-expanded__close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeExpandedPin();
    });

    // Photo click handlers
    expanded.querySelectorAll('.entry-expanded__photo').forEach(function (photoEl) {
      photoEl.addEventListener('click', function (e) {
        e.stopPropagation();
        const idx = parseInt(photoEl.getAttribute('data-photo-index'));
        if (window.AppModule && window.AppModule.openLightbox) {
          window.AppModule.openLightbox(entry.photos, idx);
        }
      });
    });

    // Load Giscus
    if (window.AppModule && window.AppModule.loadGiscus) {
      window.AppModule.loadGiscus(entry.id);
    }
  }

  /**
   * Close any expanded cork board entry
   */
  function closeExpandedPin() {
    if (!expandedPinEl) return;

    const expanded = expandedPinEl.querySelector('[data-expanded="true"]');
    if (expanded) {
      expanded.remove();
    }

    const card = expandedPinEl.querySelector('.cork-pin__card');
    if (card) {
      card.style.display = '';
    }

    expandedPinEl = null;
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
