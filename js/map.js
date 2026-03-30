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
  let corkPins = [];          // visible pins after clustering
  let allLocationPins = [];   // one pin per location group (persistent)
  let activePopup = null;
  let expandedPinEl = null;
  let expandedPinEntries = [];
  let expandedTabIndex = 0;
  let isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let entryNumberMap = {};  // entry id -> 1-based number
  let totalEntries = 0;

  // Clustering state
  var locationGroups = [];     // atomic groups by location_name
  var currentClusterSig = '';  // signature string for diff detection
  var storedOnPinClick = null;
  var storedOnPinHover = null;
  var clusterDebounceTimer = null;
  var initialAnimationComplete = false;
  var CLUSTER_THRESHOLD_PX = 70;

  /**
   * Get the preview/thumbnail photo for an entry.
   * Uses preview_photo index if set, otherwise falls back to photos[0].
   */
  function getPreviewPhoto(entry) {
    if (!entry.photos || entry.photos.length === 0) return null;
    var idx = (typeof entry.preview_photo === 'number' && entry.preview_photo < entry.photos.length)
      ? entry.preview_photo : 0;
    return entry.photos[idx];
  }
  let activePreviewEntryId = null; // which entry is currently shown in a pin preview

  // Route coordinates — built dynamically from entries
  let routeCoords = [];
  let waypointIndices = []; // routeCoords index for each entry waypoint
  let waypointToGroupIndex = {}; // maps entry waypoint index to locationGroups index

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
        // Restore 2¢ panel
        var tc = document.getElementById('two-cents');
        if (tc) tc.style.display = '';
      }
    });

    // Zoom-based pin scaling — pins shrink when zoomed out, grow when zoomed in
    function updatePinScale() {
      var zoom = map.getZoom();
      var refZoom = 7;
      // Dampened scale: each zoom level adjusts strongly
      var scale = Math.pow(2, (zoom - refZoom) * 1.0);
      // Clamp: 0.25 at very zoomed out, 1.3 at very zoomed in
      scale = Math.max(0.25, Math.min(1.3, scale)) * 0.75;
      var mapEl = document.getElementById('map');
      mapEl.style.setProperty('--pin-zoom-scale', scale);
      // Hide photo thumbnails when zoomed out too far
      if (zoom < 4.5) {
        mapEl.classList.add('pin-thumbs-hidden');
      } else {
        mapEl.classList.remove('pin-thumbs-hidden');
      }

      // Debounced re-clustering
      if (initialAnimationComplete) {
        clearTimeout(clusterDebounceTimer);
        clusterDebounceTimer = setTimeout(function () {
          renderClusters();
        }, 200);
      }
    }
    map.on('zoom', updatePinScale);
    map.on('load', updatePinScale);

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
    // Track which routeCoords index each entry waypoint maps to
    routeCoords = [];
    waypointIndices = [0]; // first entry is at index 0
    for (var i = 0; i < waypoints.length - 1; i++) {
      var segment = meanderSegment(waypoints[i], waypoints[i + 1], i);
      // Add all points except the last (to avoid duplicates at joins)
      for (var j = 0; j < segment.length - 1; j++) {
        routeCoords.push(segment[j]);
      }
      waypointIndices.push(routeCoords.length); // index where next entry lands
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
   * Add the route line to the map (with draw-in animation)
   */
  function addRouteLayer() {
    if (routeCoords.length < 2) return;

    var routeColor = isDark ? '#B87D6A' : '#C1440E';

    // Start with minimal data — animation will reveal the full route
    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [routeCoords[0], routeCoords[0]],
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

    // Animation is triggered externally via startRouteAnimation()
    // after fitBounds completes
  }

  /**
   * Animate the route line drawing in at constant physical speed,
   * revealing cork pins as the route reaches each waypoint.
   * Pins are created with cork-pin--pending class (hidden from the start).
   */
  function animateRouteDrawIn() {
    if (routeCoords.length < 2) return;

    // Build cumulative distance array for constant-speed interpolation
    var cumDist = [0];
    for (var i = 1; i < routeCoords.length; i++) {
      var dx = routeCoords[i][0] - routeCoords[i - 1][0];
      var dy = routeCoords[i][1] - routeCoords[i - 1][1];
      cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var totalDist = cumDist[cumDist.length - 1];

    var startTime = null;
    var duration = 1250;
    var revealedPins = {};

    // Map waypoint indices to location group indices for reveal
    // During initial animation, we reveal by location group order
    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = Math.min(elapsed / duration, 1);

      // Linear progress mapped to distance for constant speed
      var targetDist = progress * totalDist;

      // Binary search for the coordinate index at this distance
      var lo = 0, hi = cumDist.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (cumDist[mid] < targetDist) lo = mid + 1;
        else hi = mid;
      }
      var endIndex = Math.max(1, lo);
      var animCoords = routeCoords.slice(0, endIndex + 1);

      if (map.getSource('route')) {
        map.getSource('route').setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: animCoords,
          },
        });
      }

      // Reveal location group pins as the route reaches their first entry's waypoint
      for (var wi = 0; wi < waypointIndices.length; wi++) {
        if (!revealedPins[wi] && endIndex >= waypointIndices[wi]) {
          revealedPins[wi] = true;
          // Map this waypoint (entry index) to its location group
          var groupIdx = waypointToGroupIndex[wi];
          if (groupIdx !== undefined && !revealedPins['g' + groupIdx]) {
            revealedPins['g' + groupIdx] = true;
            (function (pin) {
              setTimeout(function () {
                pin.element.classList.remove('cork-pin--pending');
                pin.element.classList.add('cork-pin--reveal');
              }, 80);
            })(allLocationPins[groupIdx]);
          }
        }
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        // Animation complete — just remove reveal classes and enable clustering
        // Don't call renderClusters() here — pins are already correct.
        // The zoom handler will trigger clustering when the user zooms.
        allLocationPins.forEach(function (pin) {
          pin.element.classList.remove('cork-pin--reveal');
        });
        initialAnimationComplete = true;
      }
    }

    requestAnimationFrame(step);
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

  // =======================================================================
  // CLUSTERING
  // =======================================================================

  /**
   * Seeded pseudo-random for deterministic pin angles
   */
  function seededRandom(seed) {
    var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Group entries by location_name into atomic units.
   * Returns array sorted chronologically by earliest entry.
   */
  function buildLocationGroups(entries) {
    var sorted = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });

    var groups = {};
    var order = [];
    sorted.forEach(function (entry) {
      var key = entry.location_name;
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(entry);
    });

    return order.map(function (name) {
      var entries = groups[name];
      // Centroid in [lng, lat] (Mapbox convention)
      var avgLng = 0, avgLat = 0;
      entries.forEach(function (e) {
        avgLng += e.coordinates[1];
        avgLat += e.coordinates[0];
      });
      avgLng /= entries.length;
      avgLat /= entries.length;

      return {
        locationName: name,
        entries: entries,
        centroid: [avgLng, avgLat]
      };
    });
  }

  /**
   * Haversine distance in km between two [lng, lat] points.
   */
  function haversineKm(a, b) {
    var R = 6371;
    var dLat = (b[1] - a[1]) * Math.PI / 180;
    var dLng = (b[0] - a[0]) * Math.PI / 180;
    var sinLat = Math.sin(dLat / 2);
    var sinLng = Math.sin(dLng / 2);
    var h = sinLat * sinLat + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  var MAX_CLUSTER_DISTANCE_KM = 60; // never merge locations more than 60km apart

  /**
   * Cluster location groups by screen-space pixel proximity.
   * Returns array of clusters, each with: { groupIndices, entries, centroid }
   */
  function clusterLocationGroups(groups, thresholdPx) {
    if (!map || groups.length === 0) return [];

    // Project each group's centroid to screen pixels
    var clusters = groups.map(function (g, i) {
      var pt = map.project(g.centroid);
      return {
        groupIndices: [i],
        x: pt.x,
        y: pt.y,
        centroid: g.centroid
      };
    });

    // Greedy agglomerative merge
    var merged = true;
    while (merged) {
      merged = false;
      var bestDist = thresholdPx;
      var bestI = -1, bestJ = -1;

      for (var i = 0; i < clusters.length; i++) {
        for (var j = i + 1; j < clusters.length; j++) {
          // Check geographic distance first — skip if too far apart
          var geoDist = haversineKm(clusters[i].centroid, clusters[j].centroid);
          if (geoDist > MAX_CLUSTER_DISTANCE_KM) continue;

          var dx = clusters[i].x - clusters[j].x;
          var dy = clusters[i].y - clusters[j].y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) {
            bestDist = dist;
            bestI = i;
            bestJ = j;
          }
        }
      }

      if (bestI !== -1) {
        var ci = clusters[bestI], cj = clusters[bestJ];
        var ni = ci.groupIndices.length, nj = cj.groupIndices.length;
        ci.x = (ci.x * ni + cj.x * nj) / (ni + nj);
        ci.y = (ci.y * ni + cj.y * nj) / (ni + nj);
        // Update centroid to weighted average
        ci.centroid = [
          (ci.centroid[0] * ni + cj.centroid[0] * nj) / (ni + nj),
          (ci.centroid[1] * ni + cj.centroid[1] * nj) / (ni + nj)
        ];
        ci.groupIndices = ci.groupIndices.concat(cj.groupIndices);
        clusters.splice(bestJ, 1);
        merged = true;
      }
    }

    // Build final cluster objects
    return clusters.map(function (c) {
      // Sort group indices to maintain chronological order
      c.groupIndices.sort(function (a, b) { return a - b; });

      var allEntries = [];
      c.groupIndices.forEach(function (gi) {
        allEntries = allEntries.concat(groups[gi].entries);
      });
      allEntries.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

      return {
        groupIndices: c.groupIndices,
        entries: allEntries,
        primaryIndex: c.groupIndices[0],  // first group is primary (visible marker)
        locationNames: c.groupIndices.map(function (gi) { return groups[gi].locationName; })
      };
    });
  }

  /**
   * Generate a cluster signature string for diff detection
   */
  function clusterSignature(clusters) {
    return clusters.map(function (c) {
      return c.groupIndices.join(',');
    }).join(';;');
  }

  /**
   * Build pin HTML for a group of entries
   */
  function buildPinHtml(pinEl, groupEntries, groupIndex) {
    var displayEntry = groupEntries[groupEntries.length - 1];
    var isGrouped = groupEntries.length > 1;

    // Assign per-entry angles
    var maxAngle = isGrouped ? 3.5 : 6;
    var entryAngles = {};
    groupEntries.forEach(function (e, i) {
      var r = seededRandom(groupIndex * 100 + i);
      entryAngles[e.id] = (r - 0.5) * 2 * maxAngle;
    });

    // Preserve mapbox marker classes and no-transition when rebuilding
    var preserveClasses = [];
    pinEl.classList.forEach(function (cls) {
      if (cls.indexOf('mapboxgl-') === 0 || cls === 'cork-pin--no-transition' || cls === 'cork-pin--no-thumb') preserveClasses.push(cls);
    });
    pinEl.className = 'cork-pin ' + (initialAnimationComplete ? '' : 'cork-pin--pending ') + preserveClasses.join(' ');
    if (isGrouped) pinEl.classList.add('cork-pin--grouped');
    pinEl.setAttribute('data-entry-ids', groupEntries.map(function (e) { return e.id; }).join(','));

    var displayAngle = entryAngles[displayEntry.id] || 0;
    pinEl.style.setProperty('--pin-angle', displayAngle.toFixed(1) + 'deg');

    var numberDisplay;
    if (isGrouped && displayEntry.id === groupEntries[groupEntries.length - 1].id) {
      var firstNum = entryNumberMap[groupEntries[0].id] || '';
      var lastNum = entryNumberMap[groupEntries[groupEntries.length - 1].id] || '';
      numberDisplay = firstNum + '-' + lastNum;
    } else {
      numberDisplay = '' + (entryNumberMap[displayEntry.id] || '');
    }

    var thumbPhoto = null;
    for (var gi = groupEntries.length - 1; gi >= 0; gi--) {
      if (groupEntries[gi].photos && groupEntries[gi].photos.length > 0) {
        thumbPhoto = getPreviewPhoto(groupEntries[gi]);
        break;
      }
    }
    var thumbHtml = '';
    if (thumbPhoto) {
      thumbHtml = '<div class="cork-pin__thumb"><img src="' + escapeHtml(thumbPhoto) + '" alt="" loading="lazy"></div>';
    } else {
      pinEl.classList.add('cork-pin--no-thumb');
    }

    var stackHtml = '';
    if (isGrouped) {
      var stackCount = Math.min(groupEntries.length - 1, 4);
      pinEl.style.setProperty('--stack-count', stackCount);
      var angles = [-4, 5, -6.5, 7.5];
      for (var si = 0; si < stackCount; si++) {
        var angle = angles[si] || (si % 2 === 0 ? -(si * 2 + 3) : (si * 2 + 3));
        stackHtml +=
          '<div class="cork-pin__stack-layer" style="--stack-i:' + si + ';--stack-angle:' + angle + 'deg">' +
            '<div class="cork-pin__stack-nail"></div>' +
            '<div class="cork-pin__stack-card"></div>' +
          '</div>';
      }
    }

    pinEl.innerHTML =
      stackHtml +
      '<div class="cork-pin__nail"></div>' +
      '<div class="cork-pin__card">' +
        '<div class="cork-pin__title">' + escapeHtml(displayEntry.title) + '</div>' +
        '<div class="cork-pin__meta-row">' +
          '<span class="cork-pin__date">' + formatDate(displayEntry.date) + '</span>' +
          '<span class="cork-pin__number">' + numberDisplay + '</span>' +
        '</div>' +
        thumbHtml +
      '</div>';

    // Inline event handlers — more reliable than addEventListener on Mapbox markers
    pinEl.onmouseover = function () { if (window.__wojoHover) window.__wojoHover(pinEl.getAttribute('data-group-index')); };
    pinEl.onclick = function (evt) { evt.stopPropagation(); if (window.__wojoClick) window.__wojoClick(pinEl.getAttribute('data-group-index'), evt); };

    return entryAngles;
  }

  /**
   * Add cork board pins for journal entries.
   * Creates one persistent marker per location group, then clusters dynamically.
   */
  function addCorkPins(entries, onPinClick, onPinHover) {
    if (!map) return;

    storedOnPinClick = onPinClick;
    storedOnPinHover = onPinHover;

    // Sort all entries chronologically and build number map
    var sorted = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    sorted.forEach(function (e, i) { entryNumberMap[e.id] = i + 1; });
    totalEntries = sorted.length;

    // Build location groups (atomic units)
    locationGroups = buildLocationGroups(entries);

    // Build waypointToGroupIndex: map each sorted entry index to its location group index
    waypointToGroupIndex = {};
    var groupIndexByLocation = {};
    locationGroups.forEach(function (g, gi) {
      groupIndexByLocation[g.locationName] = gi;
    });
    sorted.forEach(function (entry, entryIdx) {
      waypointToGroupIndex[entryIdx] = groupIndexByLocation[entry.location_name];
    });

    // Create one persistent marker per location group
    allLocationPins = [];
    locationGroups.forEach(function (group, groupIndex) {
      var pinEl = document.createElement('div');
      var entryAngles = buildPinHtml(pinEl, group.entries, groupIndex);

      var marker = new mapboxgl.Marker({
        element: pinEl,
        anchor: 'top',
        offset: [0, -7],
      })
        .setLngLat(group.centroid)
        .addTo(map);

      pinEl.setAttribute('data-group-index', groupIndex);

      allLocationPins.push({
        marker: marker,
        element: pinEl,
        entries: group.entries,
        entryAngles: entryAngles,
        groupIndex: groupIndex
      });
    });

    // Set initial corkPins to allLocationPins (before clustering kicks in)
    corkPins = allLocationPins.slice();

    // Initialize cluster state to match as-built (each group = its own cluster)
    // This prevents renderClusters from needlessly rebuilding on first call
    currentClusters = locationGroups.map(function (group, idx) {
      return {
        groupIndices: [idx],
        entries: group.entries,
        primaryIndex: idx,
        locationNames: [group.locationName]
      };
    });
    currentClusterSig = clusterSignature(currentClusters);

    // Event delegation on the map container for pin click and hover
    var mapContainer = map.getContainer();

    // Expose hover/click handlers globally for inline event attributes
    window.__wojoHover = function (gi) {
      try {
        gi = parseInt(gi, 10);
        if (isNaN(gi)) return;
        var clusterEntries = getClusterEntriesForGroup(gi);
        var pinData = allLocationPins[gi];
        if (onPinHover && pinData) onPinHover(clusterEntries, pinData.element, pinData.marker);
      } catch (err) {
        document.title = 'HOVER_ERR:' + err.message;
      }
    };

    window.__wojoClick = function (gi, evt) {
      try {
        if (evt) evt.stopPropagation();
        gi = parseInt(gi, 10);
        if (isNaN(gi)) return;
        var clusterEntries = getClusterEntriesForGroup(gi);
        var pinData = allLocationPins[gi];
        if (onPinClick && pinData) onPinClick(clusterEntries, pinData.element, pinData.marker);
      } catch (err) {
        document.title = 'CLICK_ERR:' + err.message;
      }
    };
  }

  /**
   * Get all entries in the cluster that contains a given group index
   */
  function getClusterEntriesForGroup(groupIndex) {
    // Find which cluster contains this group
    for (var i = 0; i < currentClusters.length; i++) {
      if (currentClusters[i].groupIndices.indexOf(groupIndex) !== -1) {
        return currentClusters[i].entries;
      }
    }
    // Fallback: just the group's own entries
    return locationGroups[groupIndex] ? locationGroups[groupIndex].entries : [];
  }

  // Current cluster state
  var currentClusters = [];

  /**
   * Re-cluster pins based on current zoom level.
   * Animates merge/split transitions.
   */
  function renderClusters() {
    if (!map || locationGroups.length === 0) return;
    if (expandedPinEl) return; // Don't re-cluster while expanded

    var newClusters = clusterLocationGroups(locationGroups, CLUSTER_THRESHOLD_PX);
    var newSig = clusterSignature(newClusters);

    // Skip if clustering hasn't changed
    if (newSig === currentClusterSig) return;

    var oldClusters = currentClusters;
    currentClusters = newClusters;
    currentClusterSig = newSig;

    // Build sets of which groups are primary (visible) vs secondary (hidden)
    var newPrimaryGroups = {};  // groupIndex -> cluster index
    var newSecondaryGroups = {}; // groupIndex -> primaryGroupIndex
    newClusters.forEach(function (cluster, ci) {
      var primary = cluster.primaryIndex;
      newPrimaryGroups[primary] = ci;
      cluster.groupIndices.forEach(function (gi) {
        if (gi !== primary) {
          newSecondaryGroups[gi] = primary;
        }
      });
    });

    // Build old state for comparison
    var oldPrimaryGroups = {};
    var oldSecondaryGroups = {};
    oldClusters.forEach(function (cluster) {
      var primary = cluster.primaryIndex;
      oldPrimaryGroups[primary] = true;
      cluster.groupIndices.forEach(function (gi) {
        if (gi !== primary) {
          oldSecondaryGroups[gi] = primary;
        }
      });
    });

    // Process each location pin
    allLocationPins.forEach(function (pin, gi) {
      var isPrimaryNow = gi in newPrimaryGroups;
      var wasSecondary = gi in oldSecondaryGroups;
      var isSecondaryNow = gi in newSecondaryGroups;
      var wasPrimary = gi in oldPrimaryGroups;

      if (isPrimaryNow) {
        // This group is a primary pin — update its content and show it
        var cluster = newClusters[newPrimaryGroups[gi]];
        updatePrimaryPin(pin, cluster, gi);

        if (wasSecondary) {
          // Was hidden, now splitting out — animate in
          pin.element.style.display = '';
          pin.element.style.visibility = '';
          pin.element.classList.remove('cork-pin--merging');
          pin.element.classList.add('cork-pin--splitting');
          pin.element.addEventListener('animationend', function handler() {
            pin.element.classList.remove('cork-pin--splitting');
            pin.element.removeEventListener('animationend', handler);
          });
        } else {
          // Was already primary — check if it absorbed new groups
          pin.element.style.display = '';
          pin.element.style.visibility = '';
          pin.element.classList.remove('cork-pin--merging');
          // Pulse if cluster membership changed
          var oldClusterGroups = [];
          oldClusters.forEach(function (oc) {
            if (oc.primaryIndex === gi) oldClusterGroups = oc.groupIndices;
          });
          if (cluster.groupIndices.length > oldClusterGroups.length) {
            pin.element.classList.add('cork-pin--absorb');
            pin.element.addEventListener('animationend', function handler() {
              pin.element.classList.remove('cork-pin--absorb');
              pin.element.removeEventListener('animationend', handler);
            });
          }
        }
      } else if (isSecondaryNow) {
        // This group is absorbed into another cluster — hide it
        if (!wasSecondary) {
          // Was visible, now merging — animate out
          pin.element.classList.add('cork-pin--merging');
          // After animation, hide completely
          setTimeout(function () {
            if (pin.element.classList.contains('cork-pin--merging')) {
              pin.element.style.display = 'none';
            }
          }, 550);
        } else {
          // Was already hidden
          pin.element.style.display = 'none';
          pin.element.classList.remove('cork-pin--splitting');
        }
      }
    });

    // Rebuild corkPins array to only contain primary (visible) pins
    corkPins = [];
    newClusters.forEach(function (cluster) {
      var pin = allLocationPins[cluster.primaryIndex];
      // Update the pin's entries to include all cluster entries
      corkPins.push({
        marker: pin.marker,
        element: pin.element,
        entries: cluster.entries,
        entryAngles: pin.entryAngles
      });
    });

    // Re-apply highlight if there's an active entry
    if (activePreviewEntryId) {
      // Re-highlight
      document.querySelectorAll('.cork-pin--highlighted').forEach(function (el) {
        el.classList.remove('cork-pin--highlighted');
      });
      allLocationPins.forEach(function (pin) {
        var ids = (pin.element.getAttribute('data-entry-ids') || '').split(',');
        if (ids.indexOf(activePreviewEntryId) !== -1 && pin.element.style.display !== 'none') {
          pin.element.classList.add('cork-pin--highlighted');
        }
      });
      // Re-apply thumb visibility after pin content rebuild
      updateThumbVisibility(activePreviewEntryId);
    }
  }

  /**
   * Update a primary pin's content to reflect its cluster's entries
   */
  function updatePrimaryPin(pin, cluster, groupIndex) {
    var allEntries = cluster.entries;
    var isGrouped = allEntries.length > 1;

    // Update data-entry-ids to include all cluster entries
    pin.element.setAttribute('data-entry-ids', allEntries.map(function (e) { return e.id; }).join(','));

    // Update grouped class
    if (isGrouped) {
      pin.element.classList.add('cork-pin--grouped');
    } else {
      pin.element.classList.remove('cork-pin--grouped');
    }

    // Rebuild the pin HTML with cluster entries
    var entryAngles = buildPinHtml(pin.element, allEntries, groupIndex);
    pin.entryAngles = entryAngles;
    pin.entries = allEntries;

    // Preserve reveal state (don't add pending if already revealed)
    if (initialAnimationComplete) {
      pin.element.classList.remove('cork-pin--pending');
    }
  }

  /**
   * Update a pin's preview card to show a specific entry from its group.
   * Called when the user navigates with prev/next into a grouped pin.
   */
  function updatePinPreview(entryId) {
    activePreviewEntryId = entryId;

    // Find the pin that contains this entry
    var pin = null;
    var pinData = null;
    for (var i = 0; i < corkPins.length; i++) {
      var ids = corkPins[i].entries.map(function (e) { return e.id; });
      if (ids.indexOf(entryId) !== -1) {
        pin = corkPins[i].element;
        pinData = corkPins[i];
        break;
      }
    }
    if (!pin || !pinData) return;

    // Find the specific entry
    var entry = null;
    for (var j = 0; j < pinData.entries.length; j++) {
      if (pinData.entries[j].id === entryId) {
        entry = pinData.entries[j];
        break;
      }
    }
    if (!entry) return;

    // Update card content
    var card = pin.querySelector('.cork-pin__card');
    if (!card) return;

    var titleEl = card.querySelector('.cork-pin__title');
    var dateEl = card.querySelector('.cork-pin__date');
    var numberEl = card.querySelector('.cork-pin__number');
    var thumbEl = card.querySelector('.cork-pin__thumb');

    if (titleEl) titleEl.textContent = entry.title;
    if (dateEl) dateEl.textContent = formatDate(entry.date);
    // Show range if viewing latest entry in a cluster, otherwise just the number
    if (numberEl) {
      var isLatestInGroup = pinData.entries.length > 1 &&
        entry.id === pinData.entries[pinData.entries.length - 1].id;
      if (isLatestInGroup) {
        var firstNum = entryNumberMap[pinData.entries[0].id] || '';
        var lastNum = entryNumberMap[pinData.entries[pinData.entries.length - 1].id] || '';
        numberEl.textContent = firstNum + '-' + lastNum;
      } else {
        numberEl.textContent = '' + (entryNumberMap[entry.id] || '');
      }
    }

    // Update pin angle for this entry
    var angle = (pinData.entryAngles && pinData.entryAngles[entryId]) || 0;
    pin.style.setProperty('--pin-angle', angle.toFixed(1) + 'deg');

    // Update thumbnail
    var newThumb = (entry.photos && entry.photos.length > 0) ? getPreviewPhoto(entry) : null;
    if (newThumb) {
      if (thumbEl) {
        thumbEl.querySelector('img').src = newThumb;
      } else {
        var thumbDiv = document.createElement('div');
        thumbDiv.className = 'cork-pin__thumb';
        thumbDiv.innerHTML = '<img src="' + escapeHtml(newThumb) + '" alt="" loading="lazy">';
        card.appendChild(thumbDiv);
      }
    } else if (thumbEl) {
      thumbEl.remove();
    }
  }

  /**
   * Update which pins show thumbnails based on current entry.
   * Only the selected entry's pin and its immediate neighbors show thumbs.
   */
  function updateThumbVisibility(currentEntryId) {
    if (corkPins.length === 0) return;

    // Find which pin index contains the current entry
    var curPinIdx = -1;
    for (var i = 0; i < corkPins.length; i++) {
      for (var j = 0; j < corkPins[i].entries.length; j++) {
        if (corkPins[i].entries[j].id === currentEntryId) { curPinIdx = i; break; }
      }
      if (curPinIdx !== -1) break;
    }
    if (curPinIdx === -1) return;

    // Show thumb only on the active pin
    corkPins.forEach(function (pinData, idx) {
      if (idx === curPinIdx) {
        pinData.element.classList.remove('cork-pin--no-thumb');
      } else {
        pinData.element.classList.add('cork-pin--no-thumb');
      }
    });
  }

  /**
   * Get the currently active preview entry ID (for expand targeting)
   */
  function getActivePreviewEntryId() {
    return activePreviewEntryId;
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
      '<div class="entry-expanded__body">';

    // Single photo: inline with text wrapping around it
    if (entry.photos && entry.photos.length === 1) {
      html +=
        '<div class="entry-expanded__photo entry-expanded__photo--inline" data-photo-index="0" data-entry-id="' + entry.id + '">' +
          '<img src="' + escapeHtml(entry.photos[0]) + '" alt="Photo from ' + escapeHtml(entry.location_name) + '">' +
        '</div>';
    }

    html += renderBody(entry.body) + '</div>';

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

    // Multiple photos: grid below body
    if (entry.photos && entry.photos.length > 1) {
      html += '<div class="entry-expanded__photos">';
      entry.photos.forEach(function (photo, i) {
        html += '<div class="entry-expanded__photo" data-photo-index="' + i + '" data-entry-id="' + entry.id + '">' +
          '<img src="' + escapeHtml(photo) + '" alt="Photo from ' + escapeHtml(entry.location_name) + '" loading="lazy">' +
        '</div>';
      });
      html += '</div>';
    }

    if (entry.video_url) {
      // Convert YouTube URLs to embed format and extract video ID
      var videoSrc = entry.video_url;
      var videoId = null;
      var ytMatch = videoSrc.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/);
      if (ytMatch) {
        videoId = ytMatch[1];
        videoSrc = 'https://www.youtube.com/embed/' + videoId + '?autoplay=1';
      }
      // Show thumbnail with play button; loads iframe on click
      if (videoId) {
        html +=
          '<div class="entry-expanded__video">' +
            '<div class="video-wrapper video-wrapper--thumbnail" data-video-src="' + escapeHtml(videoSrc) + '">' +
              '<img class="video-wrapper__thumb" src="https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg" alt="Video thumbnail">' +
              '<div class="video-wrapper__play">&#9654;</div>' +
            '</div>' +
          '</div>';
      } else {
        html +=
          '<div class="entry-expanded__video">' +
            '<div class="video-wrapper">' +
              '<iframe src="' + escapeHtml(videoSrc) + '" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>' +
            '</div>' +
          '</div>';
      }
    }

    // Action bar: share link + postcard download
    var slug = entry.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    html +=
      '<div class="entry-expanded__actions">' +
        '<button class="entry-action-btn entry-action-btn--share" data-entry-id="' + entry.id + '" data-slug="' + slug + '" title="Copy link to this entry">' +
          '<span class="entry-action-btn__icon">&#128279;</span> Share Link' +
        '</button>' +
        '<button class="entry-action-btn entry-action-btn--postcard" data-entry-id="' + entry.id + '" title="Download as postcard">' +
          '<span class="entry-action-btn__icon">&#9993;</span> Save Postcard' +
        '</button>' +
      '</div>';

    return html;
  }

  /**
   * Bind photo, share, and postcard click handlers on the expanded content
   */
  function bindPhotoHandlers(expanded, entry) {
    // Video thumbnail click — replace with iframe
    expanded.querySelectorAll('.video-wrapper--thumbnail').forEach(function (wrapper) {
      wrapper.addEventListener('click', function (e) {
        e.stopPropagation();
        var src = wrapper.getAttribute('data-video-src');
        wrapper.innerHTML = '<iframe src="' + src + '" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>';
        wrapper.classList.remove('video-wrapper--thumbnail');
      });
    });

    expanded.querySelectorAll('.entry-expanded__photo').forEach(function (photoEl) {
      photoEl.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(photoEl.getAttribute('data-photo-index'));
        if (window.AppModule && window.AppModule.openLightbox) {
          window.AppModule.openLightbox(entry.photos, idx);
        }
      });
    });

    // Share button — copy permalink to clipboard
    expanded.querySelectorAll('.entry-action-btn--share').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = btn.getAttribute('data-slug');
        var url = window.location.origin + window.location.pathname + '#' + slug;

        function onCopied() {
          btn.innerHTML = '<span class="entry-action-btn__icon">&#10003;</span> Copied!';
          showCopyToast('Link copied to clipboard!');
          setTimeout(function () {
            btn.innerHTML = '<span class="entry-action-btn__icon">&#128279;</span> Share Link';
          }, 2000);
        }

        // Modern clipboard API (needs secure context)
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(onCopied).catch(function () {
            var ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            onCopied();
          });
        } else {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          onCopied();
        }
      });
    });

    // Postcard download button
    expanded.querySelectorAll('.entry-action-btn--postcard').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        downloadPostcard(entry);
      });
    });
  }

  /**
   * Show a brief toast notification (e.g. "Link copied!")
   */
  function showCopyToast(message) {
    var existing = document.querySelector('.copy-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger reflow then add .show for the transition
    toast.offsetHeight; // force reflow
    toast.classList.add('show');

    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  /**
   * Generate and download a postcard image from an entry
   */
  function downloadPostcard(entry) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    function drawCard(img) {
      // Detect orientation and size canvas accordingly
      var isPortrait = img && img.height > img.width;
      var cw = isPortrait ? 800 : 1200;
      var ch = isPortrait ? 1200 : 800;
      canvas.width = cw;
      canvas.height = ch;

      var pad = 40;
      var textBlockH = 160;
      var photoW = cw - pad * 2;
      var photoH = ch - pad * 2 - textBlockH;

      // Warm paper background
      ctx.fillStyle = isDark ? '#282828' : '#FAF6EF';
      ctx.fillRect(0, 0, cw, ch);

      // Photo
      if (img) {
        ctx.save();
        roundRect(ctx, pad, pad, photoW, photoH, 12);
        ctx.clip();
        var scale = Math.max(photoW / img.width, photoH / img.height);
        var w = img.width * scale;
        var h = img.height * scale;
        ctx.drawImage(img, pad + (photoW - w) / 2, pad + (photoH - h) / 2, w, h);
        ctx.restore();
      }

      // Dashed border
      ctx.strokeStyle = isDark ? '#B87D6A' : '#C1440E';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 5]);
      roundRect(ctx, 20, 20, cw - 40, ch - 40, 16);
      ctx.stroke();
      ctx.setLineDash([]);

      // Text area
      var textY = img ? (pad + photoH + 50) : (ch / 2 - 40);

      // Title
      ctx.font = 'bold 52px Caveat, cursive';
      ctx.fillStyle = isDark ? '#ECECEC' : '#2C2825';
      ctx.textAlign = 'left';
      ctx.fillText(entry.title, 60, textY);

      // Location & date
      ctx.font = '30px Patrick Hand, cursive';
      ctx.fillStyle = isDark ? '#AAAAAA' : '#6B6560';
      ctx.fillText(entry.location_name + '  \u00b7  ' + formatDate(entry.date), 60, textY + 45);

      // Mood
      if (entry.mood_left && entry.mood_right) {
        ctx.font = '24px Patrick Hand, cursive';
        ctx.fillStyle = isDark ? '#888888' : '#999590';
        ctx.fillText(entry.mood_left + '  \u2194  ' + entry.mood_right, 60, textY + 85);
      }

      // Watermark
      ctx.font = '24px Caveat, cursive';
      ctx.fillStyle = isDark ? '#575757' : '#C4BFB6';
      ctx.textAlign = 'right';
      ctx.fillText('wanderingwojo.com', cw - 60, ch - 40);

      // Download
      var link = document.createElement('a');
      link.download = 'postcard-' + entry.id + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }

    if (entry.photos && entry.photos.length > 0) {
      // Pick one photo at random
      var src = entry.photos[Math.floor(Math.random() * entry.photos.length)];
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { drawCard(img); };
      img.onerror = function () { drawCard(null); };
      img.src = src;
    } else {
      drawCard(null);
    }
  }

  /**
   * Draw a rounded rectangle path (for canvas postcard)
   */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
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

      // The nail is at the coordinate (anchor: top). Card hangs below.
      // We want the nail near the top so the full card is visible.
      var targetPinY = padding;
      // Center horizontally
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

    // Update URL hash
    var slug = sortedGroup[newIndex].id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    history.replaceState(null, '', '#' + slug);

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
  /**
   * Constrain expanded entry max-height so it doesn't extend behind the bottom nav
   */
  function constrainExpandedHeight(expanded) {
    // Wait for pan animation to finish before measuring position
    map.once('moveend', function () {
      requestAnimationFrame(function () {
        var rect = expanded.getBoundingClientRect();
        var navEl = document.querySelector('.entry-nav');
        var navTop = navEl ? navEl.getBoundingClientRect().top : (window.innerHeight - 120);
        var bottomClearance = 12; // gap above nav
        var available = navTop - rect.top - bottomClearance;
        if (available > 100) {
          expanded.style.maxHeight = Math.floor(available) + 'px';
        }
      });
    });
  }

  function expandPinEntry(entries, pinEl, targetEntryId) {
    closeExpandedPin();

    var card = pinEl.querySelector('.cork-pin__card');
    if (!card) return;
    card.style.display = 'none';

    // Sort entries chronologically within group
    var sortedGroup = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });

    // Determine which tab to show (default to most recent)
    var activeIndex = sortedGroup.length - 1;
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

    // Constrain max-height so expanded entry doesn't overflow behind bottom nav
    constrainExpandedHeight(expanded);

    // Hide other pins so they don't show through expanded entry
    allLocationPins.forEach(function (p) {
      if (p.element !== pinEl) p.element.style.visibility = 'hidden';
    });

    // Hide floating title and shop link
    var floatingTitle = document.getElementById('floating-title');
    if (floatingTitle) floatingTitle.style.display = 'none';
    var floatingShop = document.querySelector('.floating-shop');
    if (floatingShop) floatingShop.style.display = 'none';

    // Prevent scroll/touch events from reaching the map
    ['touchstart', 'touchmove', 'touchend', 'wheel'].forEach(function (evt) {
      expanded.addEventListener(evt, function (e) { e.stopPropagation(); });
    });

    // Close button
    expanded.querySelector('.entry-expanded__close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeExpandedPin();
      // Restore 2¢ panel
      var tc = document.getElementById('two-cents');
      if (tc) tc.style.display = '';
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

    // Update URL hash for deep linking
    var slug = sortedGroup[activeIndex].id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    history.replaceState(null, '', '#' + slug);

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

    // Restore all pins
    allLocationPins.forEach(function (p) {
      p.element.style.visibility = '';
    });

    // Restore floating title and shop link
    var floatingTitle = document.getElementById('floating-title');
    if (floatingTitle) floatingTitle.style.display = '';
    var floatingShop = document.querySelector('.floating-shop');
    if (floatingShop) floatingShop.style.display = '';

    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);

    // Re-cluster since zoom may have changed while expanded
    if (initialAnimationComplete) {
      renderClusters();
    }
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
    startRouteAnimation: animateRouteDrawIn,
    expandPinEntry: expandPinEntry,
    closeExpandedPin: closeExpandedPin,
    switchToEntryInExpandedPin: switchToEntryInExpandedPin,
    getExpandedPinEntryIds: getExpandedPinEntryIds,
    updatePinPreview: updatePinPreview,
    updateThumbVisibility: updateThumbVisibility,
    getActivePreviewEntryId: getActivePreviewEntryId,
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
