// script.js
// Labirint igra v SVG
// Rezultati se shranjujejo v localStorage brez JSON
// Popup okna uporablja SweetAlert2

(async function init() {

  // ===== 1) POVEZAVA Z HTML ELEMENTI =====
  const svg = document.querySelector('#mazeSvg');
  const wallsGroup = document.querySelector('#walls');
  const player = document.querySelector('#player');
  const finishZone = document.querySelector('#finishZone');

  if (!svg || !wallsGroup || !player || !finishZone) {
    console.error('Manjka SVG element (mazeSvg / walls / player / finishZone). Preveri HTML.');
    return;
  }

  const timeEl = document.getElementById('time');
  const diffEl = document.getElementById('diffVal');
  const resultsEl = document.getElementById('results');

  const btnReset = document.getElementById('btnReset');
  const btnClear = document.getElementById('btnClear');
  const solutionBtn = document.getElementById('solutionBtn');

  // ===== 2) OSNOVNE NASTAVITVE IGRE =====
  const START = { x: 234, y: 5 };
  const VIEW = { w: 484, h: 484 };

  const DIFF = {
    1: { speed: 2.0, radius: 4.0, wallPad: 2.0, timeLimitMs: null },
    2: { speed: 2.0, radius: 4.0, wallPad: 2.0, timeLimitMs: 3 * 60 * 1000 },
    3: { speed: 2.0, radius: 4.0, wallPad: 2.0, timeLimitMs: 2.5 * 60 * 1000 },
    4: { speed: 2.0, radius: 4.0, wallPad: 2.0, timeLimitMs: 2 * 60 * 1000 },
  };

  const SOLUTION_PENALTY_MS = 10 * 1000;

  let difficulty = 1;
  let speed = DIFF[difficulty].speed;
  let radius = DIFF[difficulty].radius;
  let wallPad = DIFF[difficulty].wallPad;
  let timeLimitMs = DIFF[difficulty].timeLimitMs;

  // ===== 3) SPREMENLJIVKE STANJA IGRE =====
  let keys = new Set();
  let startedAt = null;
  let paused = false;
  let pauseStartedAt = null;
  let pausedTotalMs = 0;
  let gameLocked = false;

  // 🔊 + 🔴 dodatno za zadnjih 10 sekund
  let lastBeepSecond = null;
  let blinkState = false;

  // ===== 4) FUNKCIJA ZA POPUP =====
  function popup(opts) {
    if (window.Swal && typeof window.Swal.fire === 'function') return window.Swal.fire(opts);
    alert((opts.title ? opts.title + '\n' : '') + (opts.text || ''));
    return Promise.resolve();
  }

  // 🔊 pisk
  function beep() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 1000;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.stop(ctx.currentTime + 0.15);

    osc.onended = () => {
      if (ctx.state !== 'closed') ctx.close();
    };
  }

  // ===== 5) PRETVORBA SVG STEN V SEGMENTE =====
  const segments = [...wallsGroup.querySelectorAll('line')].map(l => ({ /* wallsGroup.querySelectorAll('line') isce vse <Line> elemente v wallsgroupu vrne v NodeList (kot nekaksen array);
                                                                           ... operator Spread pretvori NodeList v JS array
                                                                           za vsak <line> element l naredi nov objekt */
    x1: +l.getAttribute('x1'),//iz svg bere tocke
    y1: +l.getAttribute('y1'),
    x2: +l.getAttribute('x2'),
    y2: +l.getAttribute('y2'),
  }));

  function setPlayer(x, y) {
    player.setAttribute('cx', x);
    player.setAttribute('cy', y);
  }

  function getPlayer() {
    return { x: +player.getAttribute('cx'), y: +player.getAttribute('cy') };
  }

  // ===== 6) MATEMATIKA ZA TRK =====
  function distPointToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const abLen2 = abx * abx + aby * aby;

    if (abLen2 === 0) return Math.hypot(px - ax, py - ay);

    let t = (apx * abx + apy * aby) / abLen2;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * abx;
    const cy = ay + t * aby;

    return Math.hypot(px - cx, py - cy);// razdalja med dvema tockama
  }

  function collidesCircleWithWalls(x, y) {
    const r = radius + wallPad;

    if (x < r || x > VIEW.w - r || y < r || y > VIEW.h - r) return true;

    for (const s of segments) {
      const minX = Math.min(s.x1, s.x2) - r;
      const maxX = Math.max(s.x1, s.x2) + r;
      const minY = Math.min(s.y1, s.y2) - r;
      const maxY = Math.max(s.y1, s.y2) + r;

      if (x < minX || x > maxX || y < minY || y > maxY) continue;

      const d = distPointToSegment(x, y, s.x1, s.y1, s.x2, s.y2);
      if (d <= r) return true;
    }

    return false;
  }

  function insideFinish(x, y) {
    const fx = +finishZone.getAttribute('x');
    const fy = +finishZone.getAttribute('y');
    const fw = +finishZone.getAttribute('width');
    const fh = +finishZone.getAttribute('height');

    return (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh);
  }

  // ===== 7) FORMAT ČASA =====
  function fmtTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startTimerIfNeeded(now) {
    if (startedAt === null) {
      startedAt = now;
      pausedTotalMs = 0;
      pauseStartedAt = null;
    }
  }

  function elapsedActiveMs(now) {
    if (startedAt === null) return 0;

    const pauseExtra = (paused && pauseStartedAt !== null) ? (now - pauseStartedAt) : 0;
    return (now - startedAt) - (pausedTotalMs + pauseExtra);
  }

  function timeLeftMs(now) {
    return timeLimitMs - elapsedActiveMs(now);
  }

  // ===== 8) SHRANJEVANJE REZULTATOV V LOCAL STORAGE  =====
  const MAX_RESULTS = 20;

  function saveResult(name, time, diff) {
    let count = localStorage.getItem('resultsCount');
    count = count ? parseInt(count, 10) : 0; //ce ni 0 postane count 0

    if (count >= MAX_RESULTS) {
      for (let i = MAX_RESULTS - 1; i > 0; i--) {//use se zašifta za eno vec do 20
        localStorage.setItem('name_' + i, localStorage.getItem('name_' + (i - 1)));
        localStorage.setItem('time_' + i, localStorage.getItem('time_' + (i - 1)));
        localStorage.setItem('difficulty_' + i, localStorage.getItem('difficulty_' + (i - 1)));
      }
      //najnovejsi je na vrhu
      localStorage.setItem('name_0', name);
      localStorage.setItem('time_0', time);
      localStorage.setItem('difficulty_0', diff);
    } else {
      //samo povevca stevec, vse zamakne in nov gre na index0
      for (let i = count; i > 0; i--) {
        localStorage.setItem('name_' + i, localStorage.getItem('name_' + (i - 1)));
        localStorage.setItem('time_' + i, localStorage.getItem('time_' + (i - 1)));
        localStorage.setItem('difficulty_' + i, localStorage.getItem('difficulty_' + (i - 1)));
      }
      
      localStorage.setItem('name_0', name);
      localStorage.setItem('time_0', time);
      localStorage.setItem('difficulty_0', diff);

      localStorage.setItem('resultsCount', count + 1);
    }
  }

  function loadResults() {
    let count = localStorage.getItem('resultsCount');
    count = count ? parseInt(count, 10) : 0;

    const results = [];

    for (let i = 0; i < count; i++) {
      const name = localStorage.getItem('name_' + i);
      const time = localStorage.getItem('time_' + i);
      const diff = localStorage.getItem('difficulty_' + i);

      results.push({
        name: name || 'Brez imena',
        diff: diff || '1',
        time: time || '00:00'
      });
    }

    return results;
  }

  function clearResults() {
    let count = localStorage.getItem('resultsCount');
   if (count) {
    count = parseInt(count, 10); // če obstaja, pretvori v število
      } else {
    count = 0; // če ne obstaja, nastavi na 0
    }
    for (let i = 0; i < count; i++) {
      localStorage.removeItem('name_' + i);
      localStorage.removeItem('time_' + i);
      localStorage.removeItem('difficulty_' + i);
    }

    localStorage.removeItem('resultsCount');
    renderResults();
  }

  function renderResults() {
    const arr = loadResults();
    resultsEl.innerHTML = '';

    if (!arr.length) {
      resultsEl.innerHTML = `
        <div class="results-table">
          <div class="results-head">
            <div>Ime</div>
            <div>Težavnost</div>
            <div>Čas</div>
          </div>
          <div class="results-empty">Ni rezultatov.</div>
        </div>
      `;
      return;
    }

    const rows = arr.map(r => `
      <div class="results-row">
        <div>${r.name}</div>
        <div>${r.diff}</div>
        <div>${r.time}</div>
      </div>
    `).join('');

    resultsEl.innerHTML = `
      <div class="results-table">
        <div class="results-head">
          <div>Ime</div>
          <div>Težavnost</div>
          <div>Čas</div>
        </div>
        ${rows}
      </div>
    `;
  }

  // ===== 9) MENJAVA TEŽAVNOSTI =====
  function applyDifficulty(d) {
    if (!DIFF[d]) return;

    difficulty = d;
    speed = DIFF[d].speed;
    radius = DIFF[d].radius;
    wallPad = DIFF[d].wallPad;
    timeLimitMs = DIFF[d].timeLimitMs;

    if (diffEl) diffEl.textContent = String(d);
    player.setAttribute('r', radius);

    resetGame();
  }

  function hideSolutionIfAny() {
    const p = svg.querySelector('#solutionPath');
    if (p) p.remove();
    if (solutionBtn) solutionBtn.textContent = 'Prikaži rešitev';
  }

  // ===== 10) RESET IGRE =====
  function resetGame() {
    setPlayer(START.x, START.y);
    startedAt = null;
    paused = false;
    pauseStartedAt = null;
    pausedTotalMs = 0;
    keys.clear();
    gameLocked = false;

    lastBeepSecond = null;
    blinkState = false;
    if (timeEl) timeEl.style.color = '';

    if (timeEl) timeEl.textContent = (timeLimitMs === null) ? fmtTime(0) : fmtTime(timeLimitMs);

    hideSolutionIfAny();
  }

  // ===== 11) TOČKE REŠITVE =====
  const SOLUTION_POINTS = `234,2 234,10 202,10 202,26 218,26 218,58 234,58 234,26 314,26 314,10 330,10 330,106 346,106 346,90 362,90 362,106 394,106 394,122 346,122 346,138 330,
  138 330,154 346,154 346,170 378,170 378,154 362,154 362,138 426,138 426,154 394,154 394,186 410,186 410,170 442,170 442,202 474,202 474,234 458,234 458,218 410,218 410,234 426,
  234 426,250 410,250 410,298 394,298 394,314 426,314 426,330 442,330 442,314 458,314 458,330 474,330 474,394 458,394 458,346 442,346 442,362 426,362 426,346 362,346 362,314 378,
  314 378,282 346,282 346,330 330,330 330,362 314,362 314,330 282,330 282,314 314,314 314,298 298,298 298,282 314,282 314,266 282,266 282,298 250,298 250,314 266,314 266,330 250,
  330 250,362 282,362 282,426 266,426 266,410 250,410 250,426 234,426 234,346 170,346 170,314 186,314 186,330 202,330 202,298 170,298 170,266 154,266 154,250 122,250 122,266 138,
  266 138,314 154,314 154,330 122,330 122,314 106,314 106,346 138,346 138,378 122,378 122,458 138,458 138,474 234,474 234,458 202,458 202,442 282,442 282,458 298,458 298,474 250,
  474 250,482`;

  function animateDraw(poly, durationMs = 8000) {
    const len = poly.getTotalLength();// getTotalLength() vrne dolžino celotne poti ali polilinije. Pove, koliko “poti” je za narisati.
    poly.style.strokeDasharray = `${len}`;//Brez animacije bo to videti kot normalna črta. Celotna črta je “en dash”, ki je enako dolg kot linija.
    poly.style.strokeDashoffset = `${len}`;//Kombinacija stroke-dasharray + stroke-dashoffset omogoča animacijo risanja linije.
    poly.getBoundingClientRect();//prisili brskalnik, da prebere dimenzije in “naloži” stil, preden začne animacija.

    let start = null;

    function step(t) {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / durationMs);
      poly.style.strokeDashoffset = `${len * (1 - p)}`;

      if (p < 1) requestAnimationFrame(step);
      else poly.style.strokeDashoffset = '0';
    }

    requestAnimationFrame(step);
  }

  // ===== 12) PRIKAZ / SKRITJE REŠITVE =====
  function toggleSolutionPath() {
    const existing = svg.querySelector('#solutionPath');

    if (existing) {
      existing.remove();
      if (solutionBtn) solutionBtn.textContent = 'Prikaži rešitev';

      paused = false;
      if (startedAt !== null && pauseStartedAt !== null) {
        pausedTotalMs += (performance.now() - pauseStartedAt);
        pauseStartedAt = null;
      }
      return;
    }

    const now = performance.now();

    if (startedAt === null) {
      startedAt = now;
      pausedTotalMs = 0;
      pauseStartedAt = null;
    }

    startedAt -= SOLUTION_PENALTY_MS;

    paused = true;
    pauseStartedAt = now;
    keys.clear();

    const ns = 'http://www.w3.org/2000/svg';
    const poly = document.createElementNS(ns, 'polyline');

    poly.setAttribute('id', 'solutionPath');
    poly.setAttribute('points', SOLUTION_POINTS);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#c8102e');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linecap', 'square');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('pointer-events', 'none');

    svg.insertBefore(poly, player);

    if (solutionBtn) solutionBtn.textContent = 'Skrij rešitev';
    animateDraw(poly, 8000);
  }

  if (solutionBtn) solutionBtn.addEventListener('click', toggleSolutionPath);

  // ===== 13) GLAVNI GAME LOOP =====
  function tick(now) {
    requestAnimationFrame(tick);

    if (timeLimitMs === null) {
      const used = (startedAt === null) ? 0 : elapsedActiveMs(now);
      if (timeEl) timeEl.textContent = fmtTime(used);
    } else {
      const left = (startedAt === null) ? timeLimitMs : timeLeftMs(now);
      if (timeEl) timeEl.textContent = fmtTime(left);

      // 🔊 + 🔴 zadnjih 10 sekund
      if (timeLimitMs !== null && startedAt !== null) {
        const secondsLeft = Math.ceil(left / 1000);

        if (secondsLeft <= 10 && secondsLeft > 0) {

          // beep 1x na sekundo
          if (lastBeepSecond !== secondsLeft) {
            beep();
            lastBeepSecond = secondsLeft;
          }

          // utripanje
          blinkState = !blinkState;
          if (timeEl) timeEl.style.color = blinkState ? 'red' : 'black';

        } else {
          if (timeEl) timeEl.style.color = '';
        }
      }
    }

    if (paused || gameLocked) return;

    if (timeLimitMs !== null && startedAt !== null && timeLeftMs(now) <= 0) {
      gameLocked = true;
      popup({
        icon: 'error',
        title: 'Čas je potekel!',
        text: 'Poskusi še enkrat.',
        confirmButtonText: 'OK'
      }).then(() => resetGame());
      return;
    }

    let dx = 0, dy = 0;
    if (keys.has('ArrowUp') || keys.has('w')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) dy += 1;
    if (keys.has('ArrowLeft') || keys.has('a')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) dx += 1;

    if (dx === 0 && dy === 0) return;

    startTimerIfNeeded(now);

    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    const step = speed;
    const sub = Math.max(1, Math.ceil(step / 1.2));
    const sx = (dx * step) / sub;
    const sy = (dy * step) / sub;

    let { x, y } = getPlayer();
    let moved = false;

    for (let i = 0; i < sub; i++) {
      const nx = x + sx;
      const ny = y + sy;

      if (!collidesCircleWithWalls(nx, ny)) {
        x = nx;
        y = ny;
        moved = true;
      } else {
        const nx2 = x + sx;
        if (!collidesCircleWithWalls(nx2, y)) {
          x = nx2;
          moved = true;
        }

        const ny2 = y + sy;
        if (!collidesCircleWithWalls(x, ny2)) {
          y = ny2;
          moved = true;
        }
      }
    }

    if (moved) {
      setPlayer(x, y);

      if (insideFinish(x, y)) {
        gameLocked = true;

        const usedMs = elapsedActiveMs(now);
        const timeStr = fmtTime(usedMs);

        const saveWin = (playerName) => {
          saveResult(
            (playerName || 'Brez imena').trim(),
            timeStr,
            String(difficulty)
          );
          renderResults();
        };

        if (window.Swal && typeof window.Swal.fire === 'function') {
          Swal.fire({
            icon: 'success',
            title: 'Bravo!',
            html: `
              <div style="text-align:left;">
                <div><b>Težavnost:</b> ${difficulty}</div>
                <div><b>Čas:</b> ${timeStr}</div>
              </div>
            `,
            input: 'text',
            inputLabel: 'Vnesi svoje ime',
            inputPlaceholder: 'Npr. Janez',
            inputAttributes: {
              maxlength: 20
            },
            confirmButtonText: 'Shrani rezultat',
            allowOutsideClick: false,
            inputValidator: (value) => {
              if (!value || !value.trim()) {
                return 'Vnesi ime.';
              }
            }
          }).then((result) => {
            if (result.isConfirmed) {
              saveWin(result.value);
              resetGame();
            }
          });
        } else {
          const playerName = prompt(`Bravo!\nTežavnost: ${difficulty}\nČas: ${timeStr}\n\nVnesi svoje ime:`) || 'Brez imena';
          saveWin(playerName);
          resetGame();
        }
      }
    }
  }

  // ===== 14) GUMBI ZA TEŽAVNOST =====
  document.querySelectorAll('.btn[data-d]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn[data-d]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      applyDifficulty(+b.dataset.d);
    });
  });

  // ===== 15) TIPKOVNICA =====
  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ') {
      e.preventDefault();

      if (!paused) {
        paused = true;
        if (startedAt !== null) pauseStartedAt = performance.now();
      } else {
        paused = false;
        if (startedAt !== null && pauseStartedAt !== null) {
          pausedTotalMs += (performance.now() - pauseStartedAt);
          pauseStartedAt = null;
        }
      }
      return;
    }

    if (k === 'r') {
      resetGame();
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      e.preventDefault();
    }

    keys.add(k);
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(k);
  });

  // ===== 16) OSTALI GUMBI =====
  btnReset?.addEventListener('click', resetGame);

  const btnHint = document.getElementById('btnHint');

  btnHint?.addEventListener('click', () => {
    popup({
      title: 'Navodila za igro',
      html: `
        <b>Premikanje:</b><br>
        • Puščice (↑ ↓ ← →)<br>
        • ali W A S D<br><br>

        <b>Pavza:</b><br>
        • SPACE (preslednica)<br><br>

        <b>Restart:</b><br>
        • gumb Reset<br><br>

        <b>Težavnost:</b><br>
        • 1 – Time Trial (brez limita)<br>
        • 2 – 3:00 (limit)<br>
        • 3 – 2:30 (limit)<br>
        • 4 – 2:00 (limit)<br><br>

        Cilj: priti do izhoda.
      `,
      icon: 'info',
      confirmButtonText: 'Razumem',
      customClass: {
        htmlContainer: 'swal-left'
      }
    });
  });

  btnClear?.addEventListener('click', clearResults);

  // ===== 17) ZAČETNA INICIALIZACIJA =====
  if (diffEl) diffEl.textContent = String(difficulty);
  player.setAttribute('r', radius);

  resetGame();
  renderResults();
  requestAnimationFrame(tick);

})();
