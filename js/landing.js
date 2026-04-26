/* Wandering Wojo — Field Guide landing
   Renders chapter notebook cards from data/chapters.json + computes
   per-chapter stats from data/entries.json.
*/
(function () {
  'use strict';

  var grid = document.getElementById('chapters-grid');
  if (!grid) return;

  var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  Promise.all([
    fetch('data/chapters.json').then(function (r) { return r.json(); }),
    fetch('data/entries.json').then(function (r) { return r.json(); }).catch(function () { return []; }),
  ]).then(function (results) {
    var chapters = results[0] || [];
    var entries = results[1] || [];

    var chapterEntries = mapEntriesToChapters(chapters, entries);

    chapters.forEach(function (chapter) {
      var slot = document.createElement('div');
      slot.className = 'fg-chapters__slot';

      var stats = computeStats(chapterEntries[chapter.id] || []);
      slot.appendChild(renderNotebook(chapter, stats));

      grid.appendChild(slot);
    });

    paintTopbarStats(entries);
  }).catch(function (err) {
    console.error('[landing] failed to load chapters', err);
  });

  function paintTopbarStats(entries) {
    var totals = computeStats(entries);
    var slots = {
      days: document.querySelector('[data-stat="days"]'),
      entriesMiles: document.querySelector('[data-stat="entries-miles"]'),
      states: document.querySelector('[data-stat="states"]'),
    };
    if (!totals.stats.length) return;
    // totals.stats = ['N DAYS','M ENTRIES','~X MI','Y STATES']
    if (slots.days) slots.days.textContent = totals.stats[0];
    if (slots.entriesMiles) slots.entriesMiles.textContent = totals.stats[1] + ' · ' + totals.stats[2];
    if (slots.states) slots.states.textContent = totals.stats[3];
  }

  /* ---------- helpers ---------- */

  // For now every entry maps to chapter 01. When a real `chapter` field
  // gets added to entries.json this is where to switch.
  function mapEntriesToChapters(chapters, entries) {
    var byId = {};
    chapters.forEach(function (c) { byId[c.id] = []; });
    var liveChapter = chapters.find(function (c) { return c.status === 'live'; });
    if (!liveChapter) return byId;

    entries.forEach(function (e) {
      var cid = e.chapter && byId[e.chapter] ? e.chapter : liveChapter.id;
      byId[cid].push(e);
    });
    return byId;
  }

  function computeStats(entries) {
    if (!entries.length) {
      return { dates: 'TBA', stats: [] };
    }

    var sorted = entries.slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    var firstDate = new Date(sorted[0].date);
    var lastDate = new Date(sorted[sorted.length - 1].date);
    var endDate = lastDate > new Date() ? lastDate : new Date();
    var days = Math.max(1, Math.round((endDate - firstDate) / 86400000));

    var miles = approxMiles(sorted);
    var states = uniqueStates(sorted);
    var dates = formatMonth(firstDate) + ' ' + firstDate.getFullYear() + ' — PRESENT';

    return {
      dates: dates,
      stats: [
        days + ' DAYS',
        entries.length + ' ENTRIES',
        '~' + formatThousands(miles) + ' MI',
        states.length + ' STATE' + (states.length === 1 ? '' : 'S'),
      ],
    };
  }

  function uniqueStates(entries) {
    var seen = {};
    var ordered = [];
    entries.forEach(function (e) {
      var name = (e.location_name || '').split(',').pop().trim();
      // Normalize "WA" -> "WA", "Washington" -> "Washington" (leave as-is)
      if (name && !seen[name]) {
        seen[name] = true;
        ordered.push(name);
      }
    });
    return ordered;
  }

  function approxMiles(entries) {
    var total = 0;
    for (var i = 1; i < entries.length; i++) {
      var a = entries[i - 1].coordinates;
      var b = entries[i].coordinates;
      if (!a || !b || a.length < 2 || b.length < 2) continue;
      total += haversineMiles(a[0], a[1], b[0], b[1]);
    }
    return Math.round(total / 50) * 50; // round to nearest 50
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
          * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function formatThousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatMonth(date) {
    return MONTHS[date.getMonth()];
  }

  /* ---------- DOM builders ---------- */

  function renderNotebook(chapter, stats) {
    var notebook = document.createElement(chapter.path && chapter.status === 'live' ? 'a' : 'div');
    notebook.className = 'notebook notebook--' + chapter.color
      + (chapter.status === 'upcoming' ? ' notebook--upcoming' : '');
    notebook.dataset.chapter = chapter.id;

    if (chapter.path && chapter.status === 'live') {
      notebook.href = chapter.path;
      notebook.style.textDecoration = 'none';
      notebook.style.color = 'inherit';
      notebook.setAttribute('aria-label', 'Open chapter: ' + chapter.title);
    }

    var tilt = typeof chapter.tilt === 'number' ? chapter.tilt : 0;
    notebook.style.transform = 'rotate(' + tilt + 'deg)';

    if (chapter.status !== 'upcoming') {
      notebook.addEventListener('mouseenter', function () {
        notebook.style.transform = 'rotate(' + (tilt * 0.2) + 'deg) translateY(-6px)';
      });
      notebook.addEventListener('mouseleave', function () {
        notebook.style.transform = 'rotate(' + tilt + 'deg)';
      });
    }

    notebook.appendChild(el('div', 'notebook__shadow'));
    if (chapter.status !== 'upcoming') {
      notebook.appendChild(el('div', 'notebook__edge'));
    }

    var cover = el('div', 'notebook__cover');

    if (chapter.status === 'upcoming') {
      // Chapter 03 is the totally-blank placeholder
      if (chapter.title) {
        cover.appendChild(el('div', 'notebook__upcoming-chapter', 'CHAPTER ' + chapter.number));
        cover.appendChild(el('div', 'notebook__upcoming-untitled', 'untitled'));
        cover.appendChild(el('div', 'notebook__upcoming-coming', '—— COMING ——'));
      }
    } else {
      // top labels
      var top = el('div', 'notebook__top-row');
      top.appendChild(el('span', null, 'CH. ' + chapter.number));
      top.appendChild(el('span', null, 'FIELD JOURNAL'));
      cover.appendChild(top);

      // binding
      cover.appendChild(el('div', 'notebook__binding'));
      cover.appendChild(el('div', 'notebook__binding-dot notebook__binding-dot--top'));
      cover.appendChild(el('div', 'notebook__binding-dot notebook__binding-dot--bot'));

      // center cover art
      var center = el('div', 'notebook__center');
      center.appendChild(makeCoverArt(chapter));
      cover.appendChild(center);

      // title block
      var title = el('div', 'notebook__title-block');
      title.appendChild(el('div', 'notebook__title', chapter.title));
      if (chapter.subtitle) {
        title.appendChild(el('div', 'notebook__subtitle', chapter.subtitle));
      }
      title.appendChild(el('div', 'notebook__dates', stats.dates));
      if (stats.stats.length) {
        var statsRow = el('div', 'notebook__stats');
        stats.stats.forEach(function (s) { statsRow.appendChild(el('span', null, s)); });
        title.appendChild(statsRow);
      }
      cover.appendChild(title);
    }

    notebook.appendChild(cover);

    if (chapter.status === 'live') {
      notebook.appendChild(el('div', 'notebook__active-tab', 'ACTIVE'));
    }

    return notebook;
  }

  function makeCoverArt(chapter) {
    if (chapter.cover === 'cat') {
      var img = document.createElement('img');
      img.src = 'assets/woj-white.png';
      img.alt = '';
      return img;
    }
    if (chapter.cover === 'abstract') {
      var ab = el('div', 'notebook__abstract', chapter.number);
      return ab;
    }
    if (chapter.cover === 'route') {
      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M30,160 Q 60,90 100,110 T 170,40');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--cover-stamp)');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-dasharray', '6 5');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
      [[30,160,'var(--cover-stamp)','1'],[100,110,'var(--cover-ink)','0.6'],[170,40,'var(--cover-stamp)','1']].forEach(function (c) {
        var dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', c[0]); dot.setAttribute('cy', c[1]);
        dot.setAttribute('r', c[0] === 100 ? 5 : 6);
        dot.setAttribute('fill', c[2]);
        dot.setAttribute('opacity', c[3]);
        svg.appendChild(dot);
      });
      return svg;
    }
    return document.createDocumentFragment();
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
})();
