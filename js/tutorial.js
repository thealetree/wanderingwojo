/* ==========================================================================
   Wandering Wojo — Tutorial / Walkthrough Module
   ========================================================================== */

const TutorialModule = (function () {
  'use strict';

  var isMobile = false;
  var currentStep = 0;
  var steps = [];
  var overlay = null;
  var card = null;
  var isActive = false;

  var STEPS_ALL = [
    {
      title: "Hey, I\u2019m Wojo!",
      body: "Welcome to my travel journal. I\u2019m a cat on an adventure with my human Van \u2014 we\u2019re heading from Oregon all the way to Alaska. Let me show you around real quick. *stretches*",
      target: null,
      position: 'center'
    },
    {
      title: "The Map & My Pins",
      body: "See those little cork pins? Each one\u2019s a stop from our trip \u2014 click one to read the story. Some spots have multiple entries stacked up. Lots happened out there.",
      target: null,
      position: 'center'
    },
    {
      title: "Hopping Through Stories",
      body: "These arrows let you move between entries in order. That counter shows where you are in the journey. Like a remote control for my life. *blinks slowly*",
      target: '#entry-nav',
      position: 'top'
    },
    {
      title: "The Good Stuff Up Top",
      body: "The bar up top has everything \u2014 learn About us, vote in our Poll, send a Message (totally anonymous), suggest spots to visit, or help fund gas & treats. I personally endorse the treats option.",
      target: '#dock',
      position: 'bottom'
    },
    {
      title: "Photos & Videos",
      body: "Click any photo inside a story to see it big. Arrow keys flip through all the pics across every entry from there. Fair warning: a lot of them are of me.",
      target: null,
      position: 'center'
    },
    {
      title: "Prefer a List?",
      body: "That \u2630 button opens all our stops as a scrollable timeline instead of the map. Sometimes you just wanna read without thinking about geography. I get it.",
      target: '#nav-list-toggle',
      position: 'top'
    },
    {
      title: "My Time Machine",
      body: "See that clock? That\u2019s my time machine! Click it to scrub through our journey one stop at a time.",
      target: '#nav-timeline-toggle',
      position: 'top'
    },
    {
      title: "Keyboard Shortcuts",
      body: "\u2190 \u2192 arrow keys navigate between entries. ESC closes any open story or photo. You\u2019re basically a power user now.",
      target: null,
      position: 'center',
      desktopOnly: true
    },
    {
      title: "That\u2019s the tour!",
      body: "Now go explore! Click the \u003f up in the menu anytime to see this again. I\u2019ll be somewhere sunny, napping. \uD83D\uDC3E",
      target: '#tutorial-btn',
      position: 'bottom'
    }
  ];

  function buildSteps() {
    isMobile = window.innerWidth < 768;
    return STEPS_ALL.filter(function (s) {
      return !s.desktopOnly || !isMobile;
    });
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';
    overlay.id = 'tutorial-overlay';
    document.body.appendChild(overlay);

    card = document.createElement('div');
    card.className = 'tutorial-card';
    card.id = 'tutorial-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Site tour');
    document.body.appendChild(card);

    overlay.addEventListener('click', function () {
      endTutorial();
    });
  }

  function destroyOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (card) { card.remove(); card = null; }
  }

  function renderStep() {
    if (!card) return;
    var step = steps[currentStep];
    if (!step) return;

    var isLast = currentStep === steps.length - 1;
    var isFirst = currentStep === 0;

    var dots = '';
    for (var i = 0; i < steps.length; i++) {
      dots += '<span class="tutorial-dot' + (i === currentStep ? ' tutorial-dot--active' : '') + '"></span>';
    }

    card.innerHTML =
      '<div class="tutorial-card__header">' +
        '<span class="tutorial-card__title">' + escHtml(step.title) + '</span>' +
        '<button class="tutorial-card__skip" id="tut-skip" aria-label="Skip tutorial">Skip</button>' +
      '</div>' +
      '<p class="tutorial-card__body">' + escHtml(step.body) + '</p>' +
      '<div class="tutorial-card__footer">' +
        '<div class="tutorial-card__dots">' + dots + '</div>' +
        '<div class="tutorial-card__btns">' +
          (!isFirst
            ? '<button class="tutorial-card__btn tutorial-card__btn--back" id="tut-back">\u2190 Back</button>'
            : '<span></span>') +
          '<button class="tutorial-card__btn tutorial-card__btn--next" id="tut-next">' +
            (isLast ? 'Done!' : 'Next \u2192') +
          '</button>' +
        '</div>' +
      '</div>';

    document.getElementById('tut-next').addEventListener('click', function (e) {
      e.stopPropagation();
      goNext();
    });
    var backBtn = document.getElementById('tut-back');
    if (backBtn) backBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      goBack();
    });
    document.getElementById('tut-skip').addEventListener('click', function (e) {
      e.stopPropagation();
      endTutorial();
    });

    positionCard(step);
  }

  function positionCard(step) {
    if (!card) return;

    var CARD_W = 340;
    var MARGIN = 14;

    if (isMobile || step.position === 'center' || !step.target) {
      card.style.top = '50%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      return;
    }

    var targetEl = document.querySelector(step.target);
    if (!targetEl) {
      card.style.top = '50%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      return;
    }

    var rect = targetEl.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var cardH = card.offsetHeight || 210;

    var cardTop, cardLeft;

    if (step.position === 'bottom') {
      cardTop = rect.bottom + MARGIN;
      cardLeft = rect.left + rect.width / 2 - CARD_W / 2;
    } else if (step.position === 'top') {
      cardTop = rect.top - cardH - MARGIN;
      cardLeft = rect.left + rect.width / 2 - CARD_W / 2;
    } else {
      if (rect.bottom + cardH + MARGIN < vh) {
        cardTop = rect.bottom + MARGIN;
        cardLeft = rect.left + rect.width / 2 - CARD_W / 2;
      } else {
        cardTop = rect.top - cardH - MARGIN;
        cardLeft = rect.left + rect.width / 2 - CARD_W / 2;
      }
    }

    cardLeft = Math.max(MARGIN, Math.min(vw - CARD_W - MARGIN, cardLeft));
    cardTop  = Math.max(MARGIN, Math.min(vh - cardH - MARGIN, cardTop));

    card.style.top = cardTop + 'px';
    card.style.left = cardLeft + 'px';
    card.style.transform = '';
  }

  function highlightTarget(step) {
    document.querySelectorAll('.tutorial-highlight').forEach(function (el) {
      el.classList.remove('tutorial-highlight');
    });
    if (!step || !step.target) return;
    var el = document.querySelector(step.target);
    if (el) el.classList.add('tutorial-highlight');
  }

  function goNext() {
    if (currentStep < steps.length - 1) {
      currentStep++;
      highlightTarget(steps[currentStep]);
      renderStep();
    } else {
      endTutorial();
    }
  }

  function goBack() {
    if (currentStep > 0) {
      currentStep--;
      highlightTarget(steps[currentStep]);
      renderStep();
    }
  }

  function startTutorial() {
    if (isActive) return;
    isActive = true;
    currentStep = 0;
    steps = buildSteps();

    createOverlay();
    renderStep();
    highlightTarget(steps[0]);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (overlay) overlay.classList.add('tutorial-overlay--visible');
        if (card) card.classList.add('tutorial-card--visible');
      });
    });
  }

  function endTutorial() {
    if (!isActive) return;
    isActive = false;

    document.querySelectorAll('.tutorial-highlight').forEach(function (el) {
      el.classList.remove('tutorial-highlight');
    });

    if (overlay) overlay.classList.remove('tutorial-overlay--visible');
    if (card) card.classList.remove('tutorial-card--visible');

    setTimeout(destroyOverlay, 360);

    try { localStorage.setItem('wojo_tutorial_seen', '1'); } catch (e) {}
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    var btn = document.getElementById('tutorial-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        startTutorial();
      });
    }

    var seen = false;
    try { seen = !!localStorage.getItem('wojo_tutorial_seen'); } catch (e) {}
    if (!seen) {
      setTimeout(startTutorial, 2000);
    }
  }

  return { init: init, start: startTutorial };
})();

window.TutorialModule = TutorialModule;
