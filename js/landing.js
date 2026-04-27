/* Wandering Wojo — Field Guide landing
   Renders chapter notebook cards from data/chapters.json + computes
   per-chapter stats from data/entries.json.
*/
(function () {
  'use strict';

  var grid = document.getElementById('chapters-grid');
  if (!grid) return;

  var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  fetch('data/chapters.json').then(function (r) { return r.json(); }).then(function (chapters) {
    chapters = chapters || [];

    // Load each chapter's entries from its own entries_file (if specified).
    var perChapter = chapters.map(function (c) {
      if (!c.entries_file) return Promise.resolve([]);
      return fetch(c.entries_file)
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    });

    return Promise.all(perChapter).then(function (lists) {
      var chapterEntries = {};
      chapters.forEach(function (c, i) { chapterEntries[c.id] = lists[i] || []; });

      // A chapter only renders once it has at least one entry.
      // Exception: a chapter with no title is the "more to come"
      // placeholder — always show.
      var visible = chapters.filter(function (c) {
        if ((chapterEntries[c.id] || []).length > 0) return true;
        if (!c.title) return true;
        return false;
      });

      // ACTIVE sticker goes on whichever chapter contains the single
      // most recent entry across all chapters.
      var activeChapterId = null;
      var latestDate = -Infinity;
      chapters.forEach(function (c) {
        (chapterEntries[c.id] || []).forEach(function (e) {
          var t = new Date(e.date).getTime();
          if (!isNaN(t) && t > latestDate) {
            latestDate = t;
            activeChapterId = c.id;
          }
        });
      });

      visible.forEach(function (chapter) {
        var slot = document.createElement('div');
        slot.className = 'fg-chapters__slot';
        var stats = computeStats(chapterEntries[chapter.id] || []);
        slot.appendChild(renderNotebook(chapter, stats, chapter.id === activeChapterId));
        grid.appendChild(slot);
      });

      // Topbar stats are the union of all entries across all chapters.
      var allEntries = lists.reduce(function (acc, l) { return acc.concat(l); }, []);
      paintTopbarStats(allEntries);
    });
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

  function renderNotebook(chapter, stats, isActive) {
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

    if (isActive) {
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

/* ============================================================
   Landing-page modals: poll, message, donate, rss
   ============================================================ */
(function () {
  'use strict';

  var CONTACT_EMAIL = atob('dGhlYWxldHJlZUBnbWFpbC5jb20=');
  var FIREBASE_DB = 'https://wanderingwojo-default-rtdb.firebaseio.com';
  var KOFI_URL = 'https://ko-fi.com/wanderingwojo/?hidefeed=true&widget=true&embed=true&preview=true';

  var modal = document.getElementById('fg-modal');
  if (!modal) return;
  var titleEl = document.getElementById('fg-modal-title');
  var stampEl = document.getElementById('fg-modal-stamp');
  var panels = modal.querySelectorAll('[data-panel]');

  var META = {
    poll:    { title: 'TODAY’S QUESTION', stamp: '★ DISPATCH POLL ★' },
    message: { title: 'DROP A NOTE',      stamp: '★ POSTCARD ★' },
    donate:  { title: 'FUEL THE TRIP',    stamp: '★ TIP JAR ★' },
    rss:     { title: 'SUBSCRIBE',        stamp: '★ RSS FEED ★' },
  };

  var pollLoaded = false;
  var kofiLoaded = false;

  function openModal(name) {
    var meta = META[name];
    if (!meta) return;
    titleEl.textContent = meta.title;
    stampEl.textContent = meta.stamp;
    panels.forEach(function (p) {
      if (p.dataset.panel === name) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';

    if (name === 'poll' && !pollLoaded) { loadPoll(); pollLoaded = true; }
    if (name === 'donate' && !kofiLoaded) {
      var iframe = document.getElementById('kofi-frame-landing');
      if (iframe) iframe.src = KOFI_URL;
      kofiLoaded = true;
    }
  }

  function closeModal() {
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }

  // Open triggers
  document.querySelectorAll('[data-modal]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openModal(btn.getAttribute('data-modal'));
    });
  });
  // Close triggers
  modal.querySelectorAll('[data-modal-close]').forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hasAttribute('hidden')) closeModal();
  });

  /* ---------- Poll ---------- */
  function loadPoll() {
    fetch('data/poll.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (poll) {
        if (!poll || !poll.active) {
          document.getElementById('poll-intro').textContent = 'No active poll right now — check back soon.';
          return;
        }
        renderPoll(poll);
      })
      .catch(function () {
        document.getElementById('poll-intro').textContent = 'Couldn’t load the poll. Try again in a sec.';
      });
  }

  function renderPoll(poll) {
    var intro = document.getElementById('poll-intro');
    var optionsEl = document.getElementById('poll-options');
    var totalEl = document.getElementById('poll-total');
    intro.textContent = poll.question;
    optionsEl.innerHTML = '';

    var votedPollId = localStorage.getItem('wojo_poll_voted_id');
    var votedOption = localStorage.getItem('wojo_poll_voted_option');
    var hasVoted = (votedPollId === poll.id);

    fetch(FIREBASE_DB + '/polls/' + poll.id + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { paintOptions(poll, data || {}, hasVoted, votedOption, optionsEl, totalEl); })
      .catch(function () { paintOptions(poll, {}, hasVoted, votedOption, optionsEl, totalEl); });
  }

  function paintOptions(poll, votes, hasVoted, votedOption, optionsEl, totalEl) {
    var total = 0;
    poll.options.forEach(function (_, i) { total += (votes['opt' + i] || 0); });
    optionsEl.innerHTML = '';
    poll.options.forEach(function (opt, i) {
      var key = 'opt' + i;
      var count = votes[key] || 0;
      var pct = total > 0 ? Math.round((count / total) * 100) : 0;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fg-poll__option';
      if (hasVoted) btn.classList.add('fg-poll__option--voted');
      if (hasVoted && votedOption === key) btn.classList.add('fg-poll__option--selected');

      var bar = hasVoted ? '<div class="fg-poll__option-bar" style="width:' + pct + '%"></div>' : '';
      var pctText = hasVoted ? '<span class="fg-poll__option-count">' + pct + '%</span>' : '';
      btn.innerHTML = bar + pctText + '<span class="fg-poll__option-label">' + escapeHtml(opt) + '</span>';

      if (!hasVoted) {
        btn.addEventListener('click', function () { castVote(poll, key); });
      }
      optionsEl.appendChild(btn);
    });
    if (totalEl) totalEl.textContent = hasVoted ? total + ' vote' + (total === 1 ? '' : 's') : '';
  }

  function castVote(poll, optKey) {
    localStorage.setItem('wojo_poll_voted_id', poll.id);
    localStorage.setItem('wojo_poll_voted_option', optKey);
    fetch(FIREBASE_DB + '/polls/' + poll.id + '/' + optKey + '.json')
      .then(function (r) { return r.json(); })
      .then(function (current) {
        return fetch(FIREBASE_DB + '/polls/' + poll.id + '/' + optKey + '.json', {
          method: 'PUT',
          body: JSON.stringify((current || 0) + 1),
        });
      })
      .then(function () { renderPoll(poll); })
      .catch(function () { renderPoll(poll); });
  }

  /* ---------- Contact form ---------- */
  var form = document.getElementById('contact-form-landing');
  if (form) {
    form.action = 'https://formsubmit.co/' + CONTACT_EMAIL;
    var fileInput = document.getElementById('contact-photo-landing');
    var fileNameEl = document.getElementById('contact-file-name-landing');
    if (fileInput && fileNameEl) {
      fileInput.addEventListener('change', function () {
        fileNameEl.textContent = fileInput.files.length ? fileInput.files[0].name : '';
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('contact-msg-landing');
      if (!msg.value.trim()) return;
      var btn = form.querySelector('.fg-form__btn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      fetch('https://formsubmit.co/ajax/' + CONTACT_EMAIL, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' },
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then(function () {
        btn.textContent = 'Sent!';
        msg.value = '';
        if (fileInput) fileInput.value = '';
        if (fileNameEl) fileNameEl.textContent = '';
        toast('Postcard delivered. Thanks for writing in!');
        setTimeout(function () { btn.disabled = false; btn.textContent = 'Send anonymously'; }, 2500);
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = 'Send anonymously';
        toast('Couldn’t send right now — the mail service may be down. Try again later!');
      });
    });
  }

  /* ---------- RSS copy ---------- */
  var copyBtn = document.getElementById('rss-copy-btn');
  var urlText = document.getElementById('rss-url-text');
  if (copyBtn && urlText) {
    copyBtn.addEventListener('click', function () {
      var url = urlText.textContent;
      var done = function () {
        copyBtn.textContent = 'Copied';
        copyBtn.classList.add('fg-rss__copy--ok');
        setTimeout(function () {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('fg-rss__copy--ok');
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
      }
    });
  }

  /* ---------- Helpers ---------- */
  function toast(message) {
    var t = document.createElement('div');
    t.className = 'fg-toast';
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('fg-toast--visible'); });
    setTimeout(function () {
      t.classList.remove('fg-toast--visible');
      setTimeout(function () { t.remove(); }, 300);
    }, 4500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
