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
  song.addEventListener('play', () => setPlayingUI(true));
  song.addEventListener('pause', () => setPlayingUI(false));
  song.loop = true;

  let userPaused = false;
  playToggle.addEventListener('click', () => {
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
  startAudio();
  ['pointerdown', 'touchstart', 'keydown'].forEach((type) => {
    window.addEventListener(type, startAudio, { passive: true });
  });
  song.addEventListener('playing', () => {
    ['pointerdown', 'touchstart', 'keydown'].forEach((type) => {
      window.removeEventListener(type, startAudio);
    });
  }, { once: true });

  // Light buzz on phones that support it
  const buzz = () => navigator.vibrate && navigator.vibrate(60);

  // Notifications drop in one after the other
  setTimeout(playDing, MESSENGER_AT - DING_AHEAD);

  setTimeout(() => {
    messenger.classList.add('is-in');
    buzz();

    setTimeout(() => {
      photos.classList.add('is-in');
      buzz();
    }, PHOTOS_AFTER_MESSENGER);
  }, MESSENGER_AT);

  // ---------- Memories burst ----------
  // Put real photos in assets/memories as 1.jpg, 2.jpg, ... (up to MEMORY_COUNT).
  // Any number that's missing shows a placeholder card instead.
  const MEMORY_COUNT = 12;
  const MEMORY_EXT = 'jpg';
  const FLIGHT_MS = 1900;   // how long one photo takes from the thumbnail to flying past
  const STAGGER_MS = 650;   // gap between photos coming out

  const memoriesLayer = document.getElementById('memories');
  const thumb = photos.querySelector('.memory-thumb');
  const PLACEHOLDER_COLORS = [
    ['#f9a65a', '#c7577a'], ['#5a8dee', '#7b4fd1'], ['#3fbf9f', '#2a6f97'],
    ['#ff7a7a', '#f6c445'], ['#9b5de5', '#f15bb5'], ['#00bbf9', '#00f5d4'],
  ];

  // Preload so photos are ready by the time someone taps
  const memorySrcs = Array.from({ length: MEMORY_COUNT }, (_, i) => `assets/memories/${i + 1}.${MEMORY_EXT}`);
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

  function flyPhoto(i, img) {
    const phoneBox = phone.getBoundingClientRect();
    const thumbBox = thumb.getBoundingClientRect();
    const W = phoneBox.width * 0.72;
    const H = W * 5 / 4;

    // Start: sitting on top of the 2013 thumbnail
    const sx = thumbBox.left - phoneBox.left + thumbBox.width / 2 - W / 2;
    const sy = thumbBox.top - phoneBox.top + thumbBox.height / 2 - H / 2;
    const startScale = thumbBox.width / W;

    // Middle: near the center of the screen, big enough to see clearly
    const mx = phoneBox.width / 2 - W / 2 + rand(-18, 18);
    const my = phoneBox.height * 0.44 - H / 2 + rand(-14, 14);
    const rot = rand(-7, 7);

    // End: keeps coming toward you and drifts off to a side
    const ex = mx + rand(-90, 90);
    const ey = my + rand(-60, 40);

    const card = makePhotoCard(i, img);
    card.style.width = `${W}px`;
    card.style.zIndex = String(1000 - i); // newer photos come from behind
    memoriesLayer.appendChild(card);

    const anim = card.animate([
      { transform: `translate(${sx}px, ${sy}px) scale(${startScale}) rotate(0deg)`, opacity: 0.6, offset: 0, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `translate(${mx}px, ${my}px) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.38, easing: 'linear' },
      { transform: `translate(${mx}px, ${my}px) scale(1.12) rotate(${rot}deg)`, opacity: 1, offset: 0.68, easing: 'cubic-bezier(.5,0,.9,.4)' },
      { transform: `translate(${ex}px, ${ey}px) scale(2.8) rotate(${rot * 1.6}deg)`, opacity: 0, offset: 1 },
    ], { duration: FLIGHT_MS, fill: 'forwards' });

    return anim.finished.then(() => card.remove());
  }

  let memoriesStarted = false;
  async function playMemories() {
    if (memoriesStarted) return;
    memoriesStarted = true;

    const imgs = await Promise.all(memoryLoaded);
    memoriesLayer.classList.add('is-playing');

    const flights = imgs.map((img, i) => new Promise((resolve) => {
      setTimeout(() => flyPhoto(i, img).then(resolve), 350 + i * STAGGER_MS);
    }));
    await Promise.all(flights);

    // Next part can listen with: window.addEventListener('memories-done', ...)
    window.dispatchEvent(new CustomEvent('memories-done'));
  }

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
  const doneName = document.getElementById('rsvp-done-name');

  const readRsvp = () => {
    try { return JSON.parse(localStorage.getItem(RSVP_KEY)) || null; } catch { return null; }
  };
  const saveRsvp = (data) => {
    try { localStorage.setItem(RSVP_KEY, JSON.stringify(data)); } catch {}
  };

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
    }, CALENDAR_AFTER_MEMORIES);
  });

  function openInvite() {
    const saved = readRsvp();
    if (saved && saved.status === 'accepted') {
      doneName.textContent = saved.name;
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

  function askName() {
    showStep('name');
    nameInput.focus();
  }
  document.getElementById('rsvp-accept').addEventListener('click', askName);
  document.getElementById('rsvp-change').addEventListener('click', askName);

  document.getElementById('rsvp-maybe').addEventListener('click', () => {
    saveRsvp({ status: 'maybe', at: new Date().toISOString() });
    showStep('maybe');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) { nameInput.focus(); return; }
    nameInput.blur();
    saveRsvp({ status: 'accepted', name, at: new Date().toISOString() });
    doneName.textContent = name;
    showStep('done');
    // Hook for saving RSVPs somewhere: window.addEventListener('rsvp-accepted', (e) => e.detail.name)
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
