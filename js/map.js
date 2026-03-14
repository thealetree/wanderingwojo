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
  let waypointIndices = []; // routeCoords index for each entry waypoint

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
    var duration = 2500;
    var revealedPins = {};

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

      // Reveal pins whose waypoint the route has reached
      for (var wi = 0; wi < waypointIndices.length; wi++) {
        if (!revealedPins[wi] && endIndex >= waypointIndices[wi] && wi < corkPins.length) {
          revealedPins[wi] = true;
          (function (pin) {
            setTimeout(function () {
              pin.element.classList.remove('cork-pin--pending');
              pin.element.classList.add('cork-pin--reveal');
            }, 80);
          })(corkPins[wi]);
        }
      }

      if (progress < 1) {
        requestAnimationFrame(step);
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
      pinEl.className = 'cork-pin cork-pin--pending';
      if (isGrouped) pinEl.classList.add('cork-pin--grouped');
      pinEl.setAttribute('data-entry-ids', groupEntries.map(function (e) { return e.id; }).join(','));

      var numberDisplay;
      if (isGrouped) {
        var firstNum = entryNumber[groupEntries[0].id] || '';
        var lastNum = entryNumber[groupEntries[groupEntries.length - 1].id] || '';
        numberDisplay = firstNum + '-' + lastNum + '/' + total;
      } else {
        numberDisplay = (entryNumber[displayEntry.id] || '') + '/' + total;
      }

      // Find first available photo from group (try most recent first)
      var thumbPhoto = null;
      for (var gi = groupEntries.length - 1; gi >= 0; gi--) {
        if (groupEntries[gi].photos && groupEntries[gi].photos.length > 0) {
          thumbPhoto = groupEntries[gi].photos[0];
          break;
        }
      }
      var thumbHtml = '';
      if (thumbPhoto) {
        thumbHtml = '<div class="cork-pin__thumb"><img src="' + escapeHtml(thumbPhoto) + '" alt="" loading="lazy"></div>';
      }

      pinEl.innerHTML =
        '<div class="cork-pin__nail"></div>' +
        '<div class="cork-pin__card">' +
          '<div class="cork-pin__title">' + escapeHtml(displayEntry.title) + '</div>' +
          '<div class="cork-pin__meta-row">' +
            '<span class="cork-pin__date">' + formatDate(displayEntry.date) + '</span>' +
            '<span class="cork-pin__number">' + numberDisplay + '</span>' +
          '</div>' +
          thumbHtml +
        '</div>' +
        '';

      var lngLat = [positionEntry.coordinates[1], positionEntry.coordinates[0]];

      var marker = new mapboxgl.Marker({
        element: pinEl,
        anchor: 'top',
        offset: [0, -7],
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
      var ytMatch = videoSrc.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
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
            // Fallback: hidden textarea trick
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
          // Legacy fallback
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

    // Hide other pins so they don't show through expanded entry
    corkPins.forEach(function (p) {
      if (p.element !== pinEl) p.element.style.visibility = 'hidden';
    });

    // Hide floating title
    var floatingTitle = document.getElementById('floating-title');
    if (floatingTitle) floatingTitle.style.display = 'none';

    // Prevent scroll/touch events from reaching the map
    ['touchstart', 'touchmove', 'touchend', 'wheel'].forEach(function (evt) {
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

    // Restore other pins
    corkPins.forEach(function (p) {
      p.element.style.visibility = '';
    });

    // Restore floating title
    var floatingTitle = document.getElementById('floating-title');
    if (floatingTitle) floatingTitle.style.display = '';

    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
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
