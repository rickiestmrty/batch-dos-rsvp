(() => {
  // Timing for the intro (ms after the page loads)
  const MESSENGER_AT = 1800;
  const PHOTOS_AFTER_MESSENGER = 2000;
  // Play the ding this many ms before the Messenger card appears
  const DING_AHEAD = 100;
  // Where the ding starts inside messenger-ding.mp4 (seconds); the rest before it is silence
  const DING_START_IN_CLIP = 1.44;

  const phone = document.getElementById('phone');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  const messenger = document.getElementById('notif-messenger');
  const photos = document.getElementById('notif-photos');
  const song = document.getElementById('song');
  const playToggle = document.getElementById('play-toggle');

  // Live clock, like a real lock screen
  function tickClock() {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = String(now.getMinutes()).padStart(2, '0');
    timeEl.textContent = `${h}:${m}`;
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tickClock();
  setInterval(tickClock, 1000);

  // SpotiBai progress follows the real song
  const fill = document.getElementById('progress-fill');
  const elapsedEl = document.getElementById('elapsed');
  const remainingEl = document.getElementById('remaining');
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  song.addEventListener('timeupdate', () => {
    const total = song.duration || 207;
    fill.style.width = `${(song.currentTime / total) * 100}%`;
    elapsedEl.textContent = fmt(song.currentTime);
    remainingEl.textContent = `-${fmt(total - song.currentTime)}`;
  });

  const setPlayingUI = (playing) => {
    phone.classList.toggle('is-paused', !playing);
    playToggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };
  setPlayingUI(false); // nothing is playing until the browser lets it
  song.addEventListener('play', () => setPlayingUI(true));
  song.addEventListener('pause', () => setPlayingUI(false));
  song.loop = true;

  let userPaused = false;
  playToggle.addEventListener('click', () => {
    if (skipToggleClick) {
      skipToggleClick = false;
      return;
    }
    if (song.paused) {
      userPaused = false;
      song.play().catch(() => {});
    } else {
      userPaused = true;
      song.pause();
    }
  });

  // Messenger ding via Web Audio: starts exactly on time, with no load delay
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;
  let dingBuffer = null;
  if (audioCtx) {
    fetch('assets/messenger-ding.mp4')
      .then((r) => r.arrayBuffer())
      .then((buf) => new Promise((ok, fail) => audioCtx.decodeAudioData(buf, ok, fail)))
      .then((decoded) => { dingBuffer = decoded; })
      .catch(() => {});
  }

  function playDing() {
    if (!audioCtx || !dingBuffer || audioCtx.state !== 'running') return;
    const src = audioCtx.createBufferSource();
    src.buffer = dingBuffer;
    src.connect(audioCtx.destination);
    src.start(0, DING_START_IN_CLIP);
  }

  // Try to start the song right away. Most browsers block sound until the
  // visitor touches the page, so we also start it on their first touch/click.
  function startAudio() {
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    if (song.paused && !userPaused) song.play().catch(() => {});
  }
  const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'keydown'];
  let skipToggleClick = false;
  function unlock(e) {
    // A first tap that lands on the pause button would start the song and then
    // immediately pause it again with the click that follows.
    if (song.paused && e.target.closest && e.target.closest('#play-toggle')) skipToggleClick = true;
    startAudio();
    startIntro();
  }
  UNLOCK_EVENTS.forEach((type) => window.addEventListener(type, unlock, { passive: true }));

  // The Messenger ding has to land with its card, and browsers drop any sound made
  // before the visitor's first tap. So when sound is still locked, the intro waits on
  // the lock screen ("Tap to wake") and that first tap starts the song and the
  // notifications together. Where sound is allowed straight away, it just starts.
  let introStarted = false;
  function startIntro() {
    if (introStarted) return;
    introStarted = true;
    phone.classList.remove('is-waiting');
    runIntro();
  }
  if (audioCtx) audioCtx.resume().catch(() => {});
  song.play()
    .then(startIntro)
    .catch(() => { if (!introStarted) phone.classList.add('is-waiting'); });
  song.addEventListener('playing', () => {
    UNLOCK_EVENTS.forEach((type) => window.removeEventListener(type, unlock));
  }, { once: true });

  // Phones keep a page's sound going after you switch apps, lock the screen or close
  // the tab, until the browser gets round to killing it. Stop it the moment the page is
  // out of sight, and pick up where it left off when they come back.
  let resumeOnReturn = false;
  function goQuiet() {
    if (!song.paused) {
      resumeOnReturn = true;
      song.pause();
    }
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
  }
  function comeBack() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (resumeOnReturn && !userPaused) song.play().catch(() => {});
    resumeOnReturn = false;
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? goQuiet() : comeBack()));
  window.addEventListener('pagehide', goQuiet);
  // Back/forward cache: the page is restored as it was, without reloading
  window.addEventListener('pageshow', (e) => { if (e.persisted && !document.hidden) comeBack(); });

  // Light buzz on phones that support it
  const buzz = () => navigator.vibrate && navigator.vibrate(60);

  // Notifications drop in one after the other
  function runIntro() {
    setTimeout(playDing, MESSENGER_AT - DING_AHEAD);

    setTimeout(() => {
      messenger.classList.add('is-in');
      buzz();

      setTimeout(() => {
        photos.classList.add('is-in');
        buzz();
      }, PHOTOS_AFTER_MESSENGER);
    }, MESSENGER_AT);
  }

  // ---------- Memories burst ----------
  // Photos live in assets/memories as 01.jpg, 02.jpg, ... in date order, built from
  // assets/photos by `pnpm build-memories`. Any number that's missing shows a placeholder.
  // The last one is the finale: it comes out slower, lands bigger and is held on screen.
  const MEMORY_COUNT = 16;
  const MEMORY_EXT = 'jpg';
  const FLIGHT_MS = 1900;   // how long one photo takes from the thumbnail to flying past
  const STAGGER_MS = 650;   // gap between photos coming out
  const FINALE_GAP_MS = 700;   // extra beat before the last photo, so it doesn't arrive in the crowd
  const FINALE_IN_MS = 1300;   // thumbnail -> center
  const FINALE_HOLD_MS = 3400; // on screen, slowly pushing in
  const FINALE_OUT_MS = 1000;  // dissolves toward you

  const memoriesLayer = document.getElementById('memories');
  const thumb = photos.querySelector('.memory-thumb');
  const PLACEHOLDER_COLORS = [
    ['#f9a65a', '#c7577a'], ['#5a8dee', '#7b4fd1'], ['#3fbf9f', '#2a6f97'],
    ['#ff7a7a', '#f6c445'], ['#9b5de5', '#f15bb5'], ['#00bbf9', '#00f5d4'],
  ];

  // Preload so photos are ready by the time someone taps
  const memorySrcs = Array.from(
    { length: MEMORY_COUNT },
    (_, i) => `assets/memories/${String(i + 1).padStart(2, '0')}.${MEMORY_EXT}`,
  );
  const memoryLoaded = memorySrcs.map((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  }));

  function makePhotoCard(i, img) {
    const card = document.createElement('div');
    card.className = 'memory-photo';
    if (img) {
      const el = document.createElement('img');
      el.src = img.src;
      el.alt = '';
      card.appendChild(el);
    } else {
      const [c1, c2] = PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length];
      card.innerHTML = `<div class="memory-placeholder" style="background:linear-gradient(135deg, ${c1}, ${c2})">
        <b>${String(i + 1).padStart(2, '0')}</b><span>Batch 2013</span></div>`;
    }
    return card;
  }

  const rand = (min, max) => min + Math.random() * (max - min);

  // The card takes the photo's own shape, so nobody at the edge of a group shot gets cropped.
  function cardSize(img, maxW, maxH) {
    const ratio = img ? img.naturalWidth / img.naturalHeight : 4 / 5;
    const W = Math.min(maxW, maxH * ratio);
    return { W, H: W / ratio };
  }

  // Sitting on top of the 2013 thumbnail, scaled down to its size
  function fromThumb(W, H) {
    const phoneBox = phone.getBoundingClientRect();
    const thumbBox = thumb.getBoundingClientRect();
    return {
      x: thumbBox.left - phoneBox.left + thumbBox.width / 2 - W / 2,
      y: thumbBox.top - phoneBox.top + thumbBox.height / 2 - H / 2,
      scale: thumbBox.width / Math.max(W, H),
    };
  }

  function flyPhoto(i, img) {
    const phoneBox = phone.getBoundingClientRect();
    const { W, H } = cardSize(img, phoneBox.width * 0.8, phoneBox.height * 0.5);
    const s = fromThumb(W, H);

    // Middle: near the center of the screen, big enough to see clearly
    const mx = phoneBox.width / 2 - W / 2 + rand(-18, 18);
    const my = phoneBox.height * 0.44 - H / 2 + rand(-14, 14);
    const rot = rand(-7, 7);

    // End: keeps coming toward you and drifts off to a side
    const ex = mx + rand(-90, 90);
    const ey = my + rand(-60, 40);

    const card = makePhotoCard(i, img);
    card.style.width = `${W}px`;
    card.style.height = `${H}px`;
    card.style.zIndex = String(1000 - i); // newer photos come from behind
    memoriesLayer.appendChild(card);

    const anim = card.animate([
      { transform: `translate(${s.x}px, ${s.y}px) scale(${s.scale}) rotate(0deg)`, opacity: 0.6, offset: 0, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `translate(${mx}px, ${my}px) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.38, easing: 'linear' },
      { transform: `translate(${mx}px, ${my}px) scale(1.12) rotate(${rot}deg)`, opacity: 1, offset: 0.68, easing: 'cubic-bezier(.5,0,.9,.4)' },
      { transform: `translate(${ex}px, ${ey}px) scale(2.8) rotate(${rot * 1.6}deg)`, opacity: 0, offset: 1 },
    ], { duration: FLIGHT_MS, fill: 'forwards' });

    return anim.finished.then(() => card.remove());
  }

  // The last photo: rises out of the thumbnail on top of everything, settles dead center,
  // bigger and in a thicker frame, a light sweeps across it, it slowly pushes in while it's
  // held, then it dissolves toward you instead of flying off.
  function flyFinale(i, img) {
    const phoneBox = phone.getBoundingClientRect();
    const { W, H } = cardSize(img, phoneBox.width * 0.92, phoneBox.height * 0.62);
    const s = fromThumb(W, H);
    const mx = phoneBox.width / 2 - W / 2;
    const my = phoneBox.height * 0.45 - H / 2;

    const card = makePhotoCard(i, img);
    card.classList.add('memory-photo--finale');
    card.style.width = `${W}px`;
    card.style.height = `${H}px`;
    card.style.zIndex = '2000';
    memoriesLayer.appendChild(card);
    memoriesLayer.classList.add('is-finale');

    const total = FINALE_IN_MS + FINALE_HOLD_MS + FINALE_OUT_MS;
    const landed = FINALE_IN_MS / total;
    const held = (FINALE_IN_MS + FINALE_HOLD_MS) / total;
    // The sheen in CSS starts as it lands.
    card.style.setProperty('--finale-in', `${FINALE_IN_MS}ms`);

    const anim = card.animate([
      { transform: `translate(${s.x}px, ${s.y}px) scale(${s.scale}) rotate(-6deg)`, opacity: 0.6, offset: 0, easing: 'cubic-bezier(.16,.84,.28,1)' },
      { transform: `translate(${mx}px, ${my}px) scale(1) rotate(0deg)`, opacity: 1, offset: landed, easing: 'linear' },
      { transform: `translate(${mx}px, ${my}px) scale(1.05) rotate(0deg)`, opacity: 1, offset: held, easing: 'cubic-bezier(.4,0,.7,.2)' },
      { transform: `translate(${mx}px, ${my - 10}px) scale(1.35) rotate(0deg)`, opacity: 0, offset: 1 },
    ], { duration: total, fill: 'forwards' });

    // The warm glow behind it goes as the photo starts to leave
    memoryTimers.push(setTimeout(() => memoriesLayer.classList.remove('is-finale'), FINALE_IN_MS + FINALE_HOLD_MS));
    return anim.finished.then(() => card.remove());
  }

  const skipBtn = document.getElementById('memories-skip');
  const memoryTimers = [];
  let memoriesStarted = false;
  let memoriesFinished = false;

  async function playMemories() {
    if (memoriesStarted) return;
    memoriesStarted = true;
    skipBtn.hidden = false;

    const imgs = await Promise.all(memoryLoaded);
    if (memoriesFinished) return; // skipped while the photos were still loading
    memoriesLayer.classList.add('is-playing');

    const last = imgs.length - 1;
    const flights = imgs.map((img, i) => new Promise((resolve) => {
      const isFinale = i === last;
      const startAt = 350 + i * STAGGER_MS + (isFinale ? FINALE_GAP_MS : 0);
      memoryTimers.push(setTimeout(() => (isFinale ? flyFinale(i, img) : flyPhoto(i, img)).then(resolve), startAt));
    }));
    await Promise.all(flights);
    finishMemories();
  }

  // Once, whether the last photo flew past or they skipped.
  // Next part listens with: window.addEventListener('memories-done', ...)
  function finishMemories() {
    if (memoriesFinished) return;
    memoriesFinished = true;
    skipBtn.hidden = true;
    window.dispatchEvent(new CustomEvent('memories-done'));
  }

  // Skip: no more photos launch, the ones mid-flight fade where they are.
  skipBtn.addEventListener('click', () => {
    memoryTimers.forEach(clearTimeout);
    memoriesLayer.classList.remove('is-finale');
    memoriesLayer.querySelectorAll('.memory-photo').forEach((card) => {
      card.getAnimations().forEach((a) => a.pause());
      card.animate([{ opacity: getComputedStyle(card).opacity }, { opacity: 0 }], { duration: 250, fill: 'forwards' })
        .finished.then(() => card.remove());
    });
    finishMemories();
  });

  // Tapping the Photos notification starts the memories
  photos.addEventListener('click', () => {
    photos.classList.add('is-tapped');
    window.dispatchEvent(new CustomEvent('open-memories'));
    playMemories();
  });

  // ---------- Calendar invite + RSVP ----------
  const CALENDAR_AFTER_MEMORIES = 700; // ms after the last photo flies past
  const RSVP_KEY = 'batchDosRsvp';

  const calendar = document.getElementById('notif-calendar');
  const invite = document.getElementById('invite');
  const inviteClose = document.getElementById('invite-close');
  const steps = invite.querySelectorAll('[data-step]');
  const form = document.getElementById('rsvp-form');
  const nameInput = document.getElementById('rsvp-name');
  const nameField = nameInput.closest('.name-field');
  const options = document.getElementById('name-options');
  const nameHint = document.getElementById('name-hint');
  const sendBtn = document.getElementById('rsvp-send');
  const doneName = document.getElementById('rsvp-done-name');
  const alreadyName = document.getElementById('rsvp-already-name');

  const readRsvp = () => {
    try { return JSON.parse(localStorage.getItem(RSVP_KEY)) || null; } catch { return null; }
  };
  const saveRsvp = (data) => {
    try { localStorage.setItem(RSVP_KEY, JSON.stringify(data)); } catch {}
  };

  // ---------- Send RSVPs to the reunion workbook ----------
  // The answer is queued on the device first, then posted to /api/rsvp, which appends
  // a row to the RSVP tab. If the post fails (bad signal, server hiccup) the queued
  // answer is sent again the next time the page opens.
  const PENDING_KEY = 'batchDosRsvpPending';

  const readPending = () => {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || null; } catch { return null; }
  };
  const writePending = (data) => {
    try {
      if (data) localStorage.setItem(PENDING_KEY, JSON.stringify(data));
      else localStorage.removeItem(PENDING_KEY);
    } catch {}
  };

  // "Rondina, Wayne" -> "Wayne": how the page greets someone.
  const firstName = (name) => {
    const comma = name.indexOf(',');
    return comma >= 0 ? name.slice(comma + 1).trim() || name : name;
  };

  // Resolves to 'ok', 'already' (that name already said yes), 'not-on-list', or
  // 'queued' (no signal / server trouble: kept on the device and sent next time).
  function sendRsvp(data) {
    writePending(data);
    const settle = () => {
      // Only clear it if nothing newer was queued while this one was in flight.
      const pending = readPending();
      if (pending && pending.at === data.at) writePending(null);
    };
    return fetch('api/rsvp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: data.status, name: data.name || '' }),
      keepalive: true,
    })
      .then(async (res) => {
        if (res.status >= 500) throw new Error(`RSVP not saved (${res.status})`);
        // Saved, or refused for a reason that sending again won't change.
        settle();
        if (res.ok) return 'ok';
        const body = await res.json().catch(() => ({}));
        return body.code === 'already-responded' ? 'already' : 'not-on-list';
      })
      .catch((err) => {
        console.error('[rsvp]', err);
        return 'queued';
      });
  }

  const unsent = readPending();
  if (unsent) sendRsvp(unsent);

  function showStep(name) {
    steps.forEach((el) => { el.hidden = el.dataset.step !== name; });
  }

  // After the memories: clear the dim layer, retire the Photos card, bring in the invite
  window.addEventListener('memories-done', () => {
    memoriesLayer.classList.remove('is-playing');
    photos.classList.remove('is-in');
    setTimeout(() => {
      calendar.classList.add('is-in');
      buzz();
      loadRoster();
    }, CALENDAR_AFTER_MEMORIES);
  });

  // ---------- Full details: the sched on notebook paper + the dress code ----------
  // The program, from the reunion workbook's Program tab. Edit wording or times here.
  // `kind`: 'games' gets a doodled star, 'night' gets a highlighter swipe.
  const PROGRAM = [
    { start: '8:00am', end: '10:00am', title: 'Registration & Arrival', note: 'arrival, chika-chika, pangumusta' },
    { start: '10:00am', title: 'Welcome Address', note: 'by our very own Apolinario Cabatingan' },
    { start: '10:15am', title: 'Asa Na Ta?', note: 'everyone shares what the last nine years looked like — work, family, the wins and the hard parts' },
    { start: '12:00pm', title: 'Lunch' },
    { start: '1:00pm', title: 'Game No. 1', kind: 'games' },
    { start: '1:45pm', title: 'Video Presentation', note: 'photos from back then, put together by the committee' },
    { start: '2:15pm', title: 'Game No. 2', kind: 'games' },
    { start: '3:10pm', title: 'Game No. 3', kind: 'games' },
    { start: '3:45pm', title: 'Intermission' },
    { start: '3:55pm', title: 'Game No. 4', kind: 'games' },
    { start: '4:30pm', title: 'Game No. 5', kind: 'games' },
    { start: '5:00pm', title: 'Dinner' },
    { start: '6:00pm', end: 'till late', title: 'Chill & Drinks', kind: 'night' },
  ];

  // Any shade of blue, white, or yellow — grouped so the three colours read at a glance.
  const DRESS_CODE = [
    { name: 'blue', swatches: ['#0A1680', '#1A1A55', '#224668', '#104B6C', '#93B2F8'] },
    { name: 'white', swatches: ['#FCFDFF', '#EFF8FF', '#E3DED8', '#D5BFA7'] },
    { name: 'yellow', swatches: ['#F5EFC1', '#FBEDB0', '#FEE14E', '#F7B94C', '#C9930A'] },
  ];

  const sheet = invite.querySelector('.sheet');
  const detailsToggle = document.getElementById('details-toggle');
  const detailsLabel = detailsToggle.querySelector('.strip-title');
  const detailsSub = detailsToggle.querySelector('.strip-sub');
  const more = document.getElementById('invite-more');

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  // A pen-drawn star for the games: one stroke, slightly uneven, like a margin doodle.
  const STAR_SVG =
    '<svg class="nb-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.6 6.1 6.4.4-4.9 4.2 1.6 6.4L12 16.4l-5.6 3.6 1.5-6.5-4.8-4.1 6.5-.5z" /></svg>';

  const program = document.getElementById('program');
  PROGRAM.forEach((item) => {
    const li = el('li', item.kind ? `is-${item.kind}` : '');
    li.appendChild(el('time', 'nb-time', item.start));

    const what = el('div', 'nb-what');
    const title = el('span', 'nb-title', item.title);
    what.appendChild(title);
    if (item.kind === 'games') title.insertAdjacentHTML('afterend', STAR_SVG);
    if (item.end) what.appendChild(el('span', 'nb-end', item.end === 'till late' ? ' — till late!' : ` (til ${item.end})`));
    if (item.note) what.appendChild(el('p', 'nb-note', item.note));

    li.appendChild(what);
    program.appendChild(li);
  });

  const dressGroups = document.getElementById('swatches');
  DRESS_CODE.forEach(({ name, swatches }) => {
    const row = el('div', 'sticky-row');
    row.appendChild(el('span', 'sticky-name', `${name}:`));
    const dots = el('span', 'sticky-dots');
    swatches.forEach((hex, i) => {
      const s = el('span');
      s.style.background = hex;
      // Each dot sits a little differently, like it was coloured in by hand
      s.style.transform = `rotate(${(i * 37) % 50 - 25}deg)`;
      dots.appendChild(s);
    });
    row.appendChild(dots);
    dressGroups.appendChild(row);
  });

  function setDetails(open, { scroll = true } = {}) {
    more.hidden = !open;
    sheet.classList.toggle('is-expanded', open);
    detailsToggle.setAttribute('aria-expanded', String(open));
    detailsLabel.textContent = open ? 'Show less' : 'See full details';
    detailsSub.textContent = open ? 'fold the sched back up' : 'the sched + dress code';
    if (open && scroll) {
      // Wait a frame so the sheet has grown to its scrolling height first
      requestAnimationFrame(() => {
        sheet.scrollTo({ top: Math.max(0, detailsToggle.offsetTop - 12), behavior: 'smooth' });
      });
    }
  }
  detailsToggle.addEventListener('click', () => setDetails(more.hidden));

  function openInvite() {
    setDetails(false, { scroll: false });
    sheet.scrollTop = 0;
    const saved = readRsvp();
    if (saved && saved.status === 'accepted') {
      doneName.textContent = firstName(saved.name);
      showStep('done');
    } else {
      showStep('ask');
    }
    calendar.classList.add('is-seen');
    invite.hidden = false;
    inviteClose.focus({ preventScroll: true });
  }

  function closeInvite() {
    if (invite.hidden || invite.classList.contains('is-closing')) return;
    invite.classList.add('is-closing');
    setTimeout(() => {
      invite.hidden = true;
      invite.classList.remove('is-closing');
      calendar.focus({ preventScroll: true });
    }, 250);
  }

  calendar.addEventListener('click', openInvite);
  inviteClose.addEventListener('click', closeInvite);
  invite.addEventListener('click', (e) => { if (e.target === invite) closeInvite(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });

  // ---------- Venue peek: tap a snapshot and it lifts out, big ----------
  // The small polaroid hides while a big copy grows out of its exact spot (and tilt),
  // then shrinks back into it on close, so it reads as the same photo picked up.
  const venuePeek = document.getElementById('venue-peek');
  let venueZoom = null;

  function liftFrom(card, big) {
    const from = card.getBoundingClientRect();
    const to = big.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const tilt = getComputedStyle(card).getPropertyValue('--tilt').trim() || '0deg';
    return `translate(${dx}px, ${dy}px) scale(${from.width / to.width}) rotate(${tilt})`;
  }

  function openVenuePhoto(card) {
    if (venueZoom) return;
    const caption = card.querySelector('.polaroid-caption').textContent;
    const layer = el('div', 'venue-zoom');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', `${caption} (tap to close)`);
    layer.tabIndex = -1;

    const big = el('figure', 'polaroid polaroid--big');
    big.style.setProperty('--tilt', '-1deg');
    const img = el('img');
    img.src = card.dataset.src;
    img.alt = card.getAttribute('aria-label').replace(/^See it bigger: /, '');
    big.append(img, el('figcaption', 'polaroid-caption', caption));
    layer.appendChild(big);
    invite.appendChild(layer);

    venueZoom = { card, layer, big };
    big.animate(
      [{ transform: liftFrom(card, big) }, { transform: 'rotate(-1deg)' }],
      { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)' },
    );
    card.style.visibility = 'hidden';
    layer.focus({ preventScroll: true });
  }

  function closeVenuePhoto() {
    if (!venueZoom || venueZoom.layer.classList.contains('is-closing')) return;
    const { card, layer, big } = venueZoom;
    layer.classList.add('is-closing');
    big.animate(
      [{ transform: 'rotate(-1deg)' }, { transform: liftFrom(card, big) }],
      { duration: 300, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
    ).finished.then(() => {
      card.style.visibility = '';
      layer.remove();
      venueZoom = null;
      card.focus({ preventScroll: true });
    });
  }

  venuePeek.addEventListener('click', (e) => {
    const card = e.target.closest('.polaroid');
    if (card) openVenuePhoto(card);
  });
  invite.addEventListener('click', (e) => {
    if (venueZoom && venueZoom.layer.contains(e.target)) closeVenuePhoto();
  });
  // Escape puts the photo back first; the next Escape closes the invite as before.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && venueZoom) {
      e.stopImmediatePropagation();
      closeVenuePhoto();
    }
  }, true);

  // ---------- Name picker: the batch list (Attendees tab) ----------
  // Same behaviour as batch-dos-reunion's identity step: type, the best six matches
  // cascade in below, tap (or arrow + Enter) to pick. Only a picked name can be sent.
  // The search itself lives in names.js, shared with the server. It is pulled in on
  // demand, so the intro, the song and the ding never depend on it loading.
  let rankRoster = null;
  let roster = null;      // { names: [...], going: Set }
  let rosterLoad = null;
  let rosterFailed = false;
  let picked = null;
  let results = [];
  let cursor = 0;

  function loadRoster() {
    rosterLoad ??= Promise.all([
      fetch('api/roster').then((res) => {
        if (!res.ok) throw new Error(`Roster not loaded (${res.status})`);
        return res.json();
      }),
      import('./names.js').then((m) => { rankRoster = m.rankRoster; }),
    ])
      .then(([data]) => {
        roster = { names: data.names || [], going: new Set(data.going || []) };
        rosterFailed = false;
        renderPicker();
      })
      .catch((err) => {
        console.error('[roster]', err);
        rosterLoad = null; // let the next keystroke try again
        rosterFailed = true;
        renderPicker();
      });
    return rosterLoad;
  }

  function setHint(text, isError = false) {
    nameHint.textContent = text;
    nameHint.classList.toggle('is-error', isError);
  }

  function renderPicker() {
    const query = nameInput.value.trim();
    const next = roster && !picked ? rankRoster(roster.names, query) : [];

    // Rebuild only when the matches change, so the cascade replays per new result set
    // instead of on every keystroke.
    if (next.join('|') !== results.join('|')) {
      results = next;
      cursor = 0;
      options.replaceChildren(...results.map((name, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'name-option';
        btn.id = `name-option-${i}`;
        btn.setAttribute('role', 'option');
        btn.style.animationDelay = `${Math.min(i, 5) * 45}ms`;
        btn.appendChild(el('span', '', name));
        if (roster.going.has(name)) btn.appendChild(el('span', 'chip', 'Already going'));
        btn.addEventListener('mouseenter', () => { cursor = i; markCursor(); });
        btn.addEventListener('click', () => pick(name));
        li.appendChild(btn);
        return li;
      }));
    }
    markCursor();
    nameInput.setAttribute('aria-expanded', String(results.length > 0));

    if (picked) setHint(`Tap Send to RSVP as ${picked}.`);
    else if (!query) setHint('Pick your name from the batch list.');
    else if (rosterFailed) setHint("Couldn't load the batch list. Check your signal and keep typing to retry.", true);
    else if (!roster) setHint('Loading the batch list…');
    else if (!results.length) setHint(`No match for “${query}”. Try your surname, or tell the committee.`, true);
    else setHint('Tap your name below.');
  }

  function markCursor() {
    options.querySelectorAll('.name-option').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === cursor);
      btn.setAttribute('aria-selected', String(i === cursor));
    });
    if (results.length) nameInput.setAttribute('aria-activedescendant', `name-option-${cursor}`);
    else nameInput.removeAttribute('aria-activedescendant');
  }

  function pick(name) {
    if (roster && roster.going.has(name)) {
      showAlready(name);
      return;
    }
    picked = name;
    nameInput.value = name;
    nameField.classList.add('is-picked');
    sendBtn.disabled = false;
    nameInput.blur(); // drop the keyboard so Send is in view
    renderPicker();
  }

  function unpick() {
    picked = null;
    nameField.classList.remove('is-picked');
    if (sendBtn.dataset.state === 'idle') sendBtn.disabled = true;
  }

  nameInput.addEventListener('input', () => {
    unpick();
    if (!roster) loadRoster();
    renderPicker();
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      cursor = Math.min(cursor + 1, results.length - 1);
      markCursor();
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      markCursor();
    } else if (e.key === 'Enter' && !picked) {
      e.preventDefault();
      if (results[cursor]) pick(results[cursor]);
    }
  });

  function showDone(name) {
    doneName.textContent = firstName(name);
    showStep('done');
  }

  function showAlready(name) {
    alreadyName.textContent = firstName(name);
    showStep('already');
  }

  function askName() {
    unpick();
    nameInput.value = '';
    showStep('name');
    loadRoster();
    renderPicker();
    nameInput.focus();
  }
  document.getElementById('rsvp-accept').addEventListener('click', askName);
  document.getElementById('rsvp-change').addEventListener('click', askName);
  document.getElementById('rsvp-not-me').addEventListener('click', () => {
    askName();
    setHint('Pick your own name. If someone else answered as you, tell the committee.');
  });

  document.getElementById('rsvp-maybe').addEventListener('click', () => {
    const data = { status: 'maybe', at: new Date().toISOString() };
    saveRsvp(data);
    sendRsvp(data);
    showStep('maybe');
  });

  // ---------- Send button: idle -> sending -> sent ----------
  const sendLabel = sendBtn.querySelector('.btn-label');
  const calendarText = calendar.querySelector('.notif-text');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MIN_SENDING_MS = 600; // a spinner that flashes for 80ms reads as a glitch
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setSendState(state) {
    sendBtn.dataset.state = state;
    sendLabel.textContent = state === 'sending' ? 'Sending' : 'Send RSVP';
    sendBtn.setAttribute('aria-label', state === 'sent' ? 'RSVP sent' : sendLabel.textContent);
    if (state === 'idle') sendBtn.disabled = !picked;
    else sendBtn.disabled = true;
  }

  // The lock-screen invite remembers the answer, like a real calendar would.
  function markCalendarGoing() {
    calendar.classList.add('is-going');
    calendarText.textContent = "You're going ✓ · Sat, Dec 26";
    calendar.setAttribute('aria-label', "Google Calendar: Batch Dos Reunion, Saturday December 26. You're going");
  }

  // A burst in the dress-code colours (blue, white, yellow), thrown up and out of the
  // check and pulled back down, each piece tumbling at its own rate.
  function confettiFrom(origin) {
    const box = origin.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const phoneBox = phone.getBoundingClientRect();
    const colours = DRESS_CODE.flatMap((group) => group.swatches);
    // Clipped to the phone's screen, so on a laptop nothing falls past the frame
    const layer = el('div', 'confetti-layer');
    Object.assign(layer.style, {
      left: `${phoneBox.left}px`,
      top: `${phoneBox.top}px`,
      width: `${phoneBox.width}px`,
      height: `${phoneBox.height}px`,
      borderRadius: getComputedStyle(phone).borderRadius,
    });
    document.body.appendChild(layer);

    const pieces = Array.from({ length: 46 }, (_, i) => {
      const piece = document.createElement('i');
      const w = rand(5, 9);
      piece.style.width = `${w}px`;
      piece.style.height = `${i % 3 === 0 ? w : w * rand(1.6, 2.3)}px`;
      if (i % 5 === 0) piece.style.borderRadius = '50%';
      piece.style.background = colours[i % colours.length];
      piece.style.left = `${cx - phoneBox.left}px`;
      piece.style.top = `${cy - phoneBox.top}px`;
      piece.style.boxShadow = 'inset 0 0 0 .5px rgba(0,0,0,.15)';
      layer.appendChild(piece);

      // A real arc: thrown up and out (slowing), a beat at the top, then falling
      // (speeding up) — kept inside the phone so none of it lands off-screen.
      const angle = rand(-Math.PI * 0.82, -Math.PI * 0.18);
      const speed = rand(130, 270);
      const room = Math.min(cx - phoneBox.left, phoneBox.right - cx) - 12;
      const dx = Math.max(-room, Math.min(room, Math.cos(angle) * speed));
      const dy = Math.sin(angle) * speed;
      const endX = Math.max(-room, Math.min(room, dx * 1.25 + rand(-30, 30)));
      const spin = rand(-720, 720);
      const at = (x, y, deg, scale) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${deg}deg) scale(${scale})`;
      return piece.animate([
        { transform: at(0, 0, 0, 0.4), opacity: 1, easing: 'cubic-bezier(.15,.75,.35,1)' },
        { transform: at(dx, dy, spin * 0.4, 1), opacity: 1, offset: 0.34, easing: 'cubic-bezier(.55,0,.85,.45)' },
        { transform: at(endX, dy + 300, spin, 0.85), opacity: 0 },
      ], { duration: rand(1500, 2000), delay: rand(0, 90), easing: 'linear', fill: 'forwards' }).finished;
    });

    Promise.all(pieces).then(() => layer.remove());
  }

  // After a yes: the sheet closes, the phone is locked again, and the committee's
  // payment message lands on top of the stack with the Messenger ding.
  const payment = document.getElementById('notif-payment');
  const SENT_HOLD_MS = 1000;          // the green check stays up about a second, then the sheet goes
  const PAYMENT_AFTER_LOCK_MS = 700;  // the lock screen settles, then the message

  // `sentAt`: when the button turned into the green check
  async function lockAndNotifyPayment(name, sentAt) {
    await pause(Math.max(0, SENT_HOLD_MS - (performance.now() - sentAt)));
    closeInvite();
    await pause(PAYMENT_AFTER_LOCK_MS);
    document.getElementById('payment-name').textContent = firstName(name);
    payment.classList.remove('is-in');
    void payment.offsetWidth; // restart the drop-in if they RSVP twice in one visit
    payment.classList.add('is-in');
    playDing();
    buzz();
  }

  // The send's moment: the pill folds into a green check and the confetti goes up.
  // Resolves once the confetti is out; the check keeps drawing on while the sheet waits.
  async function celebrate() {
    if (reduceMotion) return;
    setSendState('sent');
    await pause(480);           // pill folds into the circle
    confettiFrom(sendBtn);
    if (navigator.vibrate) navigator.vibrate([18, 60, 28]);
  }

  if (readRsvp()?.status === 'accepted') markCalendarGoing();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!picked) {
      setHint('Tap your name from the list first.', true);
      nameInput.focus();
      return;
    }
    const name = picked;
    nameInput.blur();
    setSendState('sending');

    const data = { status: 'accepted', name, at: new Date().toISOString() };
    const [outcome] = await Promise.all([sendRsvp(data), pause(MIN_SENDING_MS)]);

    if (outcome === 'not-on-list') {
      // The list changed under them (or an old page): start the pick over.
      unpick();
      nameInput.value = '';
      setSendState('idle');
      renderPicker();
      setHint("That name isn't on the batch list any more. Pick again, or tell the committee.", true);
      return;
    }

    // 'ok', 'already', or 'queued' (no signal: it goes through next time they open this)
    saveRsvp(data);
    if (roster) roster.going.add(name);
    markCalendarGoing();
    if (outcome === 'already') {
      setSendState('idle');
      showAlready(name);
    } else {
      const sentAt = performance.now();
      await celebrate();
      await lockAndNotifyPayment(name, sentAt);
      // Behind the closed sheet: reopening the invite shows "See you there"
      showDone(name);
      setSendState('idle'); // ready if they ever come back to this step
    }
    window.dispatchEvent(new CustomEvent('rsvp-accepted', { detail: { name } }));
  });

  // Keep the sheet above the on-screen keyboard on phones
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fitKeyboard = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      invite.style.setProperty('--kb', `${kb}px`);
    };
    vv.addEventListener('resize', fitKeyboard);
    vv.addEventListener('scroll', fitKeyboard);
  }
})();
