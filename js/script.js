// script.js
// Labirint igra v SVG
// Rezultati se shranjujejo v sessionStorage
// Popup okna uporablja SweetAlert2

(async function init() {

  // ===== 1) POVEZAVA Z HTML ELEMENTI =====
  // Tukaj z querySelector/getElementById vzamemo elemente iz HTML-ja,
  // da jih lahko kasneje spreminjamo z JavaScriptom.

  const svg = document.querySelector('#mazeSvg');
  const wallsGroup = document.querySelector('#walls');
  const player = document.querySelector('#player');
  const finishZone = document.querySelector('#finishZone');

  // Če kakšen pomemben SVG element manjka, se igra ne more zagnati.
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
  // START = začetna pozicija igralca
  // VIEW = velikost SVG igralnega polja
  const START = { x: 234, y: 5 };
  const VIEW = { w: 484, h: 484 };

  // DIFF = nastavitve za posamezno težavnost
  // speed = hitrost premikanja
  // radius = velikost igralca
  // wallPad = dodatna varnostna razdalja od stene
  // timeLimitMs = časovni limit v milisekundah
  const DIFF = {
    1: { speed: 2.0, radius: 4.0, wallPad: 0.0, timeLimitMs: null },              // brez limita
    2: { speed: 2.0, radius: 4.0, wallPad: 0.0, timeLimitMs: 3 * 60 * 1000 },     // 3:00
    3: { speed: 2.0, radius: 4.0, wallPad: 0.0, timeLimitMs: 2.5 * 60 * 1000 },   // 2:30
    4: { speed: 2.0, radius: 4.0, wallPad: 0.0, timeLimitMs: 2 * 60 * 1000 },     // 2:00
  };

  // Če igralec klikne "Prikaži rešitev", dobi kazen 10 sekund.
  const SOLUTION_PENALTY_MS = 10 * 1000;

  // Trenutno aktivna težavnost in njene vrednosti
  let difficulty = 1;
  let speed = DIFF[difficulty].speed;
  let radius = DIFF[difficulty].radius;
  let wallPad = DIFF[difficulty].wallPad;
  let timeLimitMs = DIFF[difficulty].timeLimitMs;

  // ===== 3) SPREMENLJIVKE STANJA IGRE =====
  // keys = tipke, ki jih trenutno drži igralec
  // startedAt = čas, ko se je igra začela
  // paused = ali je igra na pavzi
  // pauseStartedAt = trenutek, ko se je pavza začela
  // pausedTotalMs = skupni čas vseh pavz
  // gameLocked = zaklene igro po zmagi/porazu
  let keys = new Set();
  let startedAt = null;
  let paused = false;
  let pauseStartedAt = null;
  let pausedTotalMs = 0;
  let gameLocked = false;

  // ===== 4) FUNKCIJA ZA POPUP =====
  // Če je SweetAlert2 naložen, uporabimo Swal.fire.
  // Če ne, uporabimo navaden alert kot rezervno možnost.
  function popup(opts) {
    if (window.Swal && typeof window.Swal.fire === 'function') return window.Swal.fire(opts);
    alert((opts.title ? opts.title + '\n' : '') + (opts.text || ''));
    return Promise.resolve();
  }

  // ===== 5) PRETVORBA SVG STEN V SEGMENTE =====
  // Vse <line> elemente iz SVG pretvorimo v JavaScript objekte,
  // da lahko preverjamo trke igralca s stenami.
  const segments = [...wallsGroup.querySelectorAll('line')].map(l => ({
    x1: +l.getAttribute('x1'),
    y1: +l.getAttribute('y1'),
    x2: +l.getAttribute('x2'),
    y2: +l.getAttribute('y2'),
  }));

  // Nastavi novo pozicijo igralca v SVG
  function setPlayer(x, y) {
    player.setAttribute('cx', x);
    player.setAttribute('cy', y);
  }

  // Prebere trenutno pozicijo igralca iz SVG
  function getPlayer() {
    return { x: +player.getAttribute('cx'), y: +player.getAttribute('cy') };
  }

  // ===== 6) MATEMATIKA ZA TRK =====
  // Ta funkcija izračuna razdaljo med točko (igralcem)
  // in eno steno (segmentom).
  // To uporabimo, da ugotovimo, ali se je igralec dotaknil stene.
  function distPointToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const abLen2 = abx * abx + aby * aby;

    if (abLen2 === 0) return Math.hypot(px - ax, py - ay);

    let t = (apx * abx + apy * aby) / abLen2;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * abx;
    const cy = ay + t * aby;

    return Math.hypot(px - cx, py - cy);
  }

  // Preveri, ali bi igralec na poziciji x,y trčil v steno ali šel izven polja
  function collidesCircleWithWalls(x, y) {
    const r = radius + wallPad;

    // Trk z robom igralnega polja
    if (x < r || x > VIEW.w - r || y < r || y > VIEW.h - r) return true;

    // Trk s katerokoli steno
    for (const s of segments) {
      const minX = Math.min(s.x1, s.x2) - r;
      const maxX = Math.max(s.x1, s.x2) + r;
      const minY = Math.min(s.y1, s.y2) - r;
      const maxY = Math.max(s.y1, s.y2) + r;

      // Najprej hiter filter: če je točka daleč stran, segment preskočimo
      if (x < minX || x > maxX || y < minY || y > maxY) continue;

      const d = distPointToSegment(x, y, s.x1, s.y1, s.x2, s.y2);
      if (d <= r) return true;
    }

    return false;
  }

  // Preveri, ali je igralec v ciljnem območju
  function insideFinish(x, y) {
    const fx = +finishZone.getAttribute('x');
    const fy = +finishZone.getAttribute('y');
    const fw = +finishZone.getAttribute('width');
    const fh = +finishZone.getAttribute('height');

    return (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh);
  }

  // ===== 7) FORMAT ČASA =====
  // Milisekunde pretvori v obliko MM:SS, npr. 01:18
  function fmtTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Če se igra še ni začela, jo ob prvem premiku zaženemo
  function startTimerIfNeeded(now) {
    if (startedAt === null) {
      startedAt = now;
      pausedTotalMs = 0;
      pauseStartedAt = null;
    }
  }

  // Vrne aktivni čas igranja brez pavz
  function elapsedActiveMs(now) {
    if (startedAt === null) return 0;

    const pauseExtra = (paused && pauseStartedAt !== null) ? (now - pauseStartedAt) : 0;
    return (now - startedAt) - (pausedTotalMs + pauseExtra);
  }

  // Za težavnosti s časovnim limitom izračuna, koliko časa še ostane
  function timeLeftMs(now) {
    return timeLimitMs - elapsedActiveMs(now);
  }

  // ===== 8) SHRANJEVANJE REZULTATOV =====
  // sessionStorage pomeni, da se rezultati hranijo samo do refresh-a ali zaprtja seje.
  const STORE_KEY = 'maze_results_v2';

  function loadResults() {
    try {
      return JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveResults(arr) {
    // Shrani največ 20 rezultatov
    sessionStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(0, 20)));
  }

  // Prikaže rezultate v obliki tabele
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
        <div>${r.name || '-'}</div>
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
  // Ko kliknemo na gumb 1/2/3/4, nastavimo nove vrednosti in resetiramo igro.
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

  // Skrije rešitev, če je trenutno narisana
  function hideSolutionIfAny() {
    const p = svg.querySelector('#solutionPath');
    if (p) p.remove();
    if (solutionBtn) solutionBtn.textContent = 'Prikaži rešitev';
  }

  // ===== 10) RESET IGRE =====
  // Vrne igralca na začetek in ponastavi celotno stanje igre
  function resetGame() {
    setPlayer(START.x, START.y);
    startedAt = null;
    paused = false;
    pauseStartedAt = null;
    pausedTotalMs = 0;
    keys.clear();
    gameLocked = false;

    // Če ni limita, pokaže 00:00, sicer začetni limit
    if (timeEl) timeEl.textContent = (timeLimitMs === null) ? fmtTime(0) : fmtTime(timeLimitMs);

    hideSolutionIfAny();
  }

  // ===== 11) TOČKE REŠITVE =====
  // To so vnaprej zapisane koordinate pravilne poti skozi labirint.
  const SOLUTION_POINTS = `234,2 234,10 202,10 202,26 218,26 218,58 234,58 234,26 314,26 314,10 330,10 330,106 346,106 346,90 362,90 362,106 394,106 394,122 346,122 346,138 330,138 330,154 346,154 346,170 378,170 378,154 362,154 362,138 426,138 426,154 394,154 394,186 410,186 410,170 442,170 442,202 474,202 474,234 458,234 458,218 410,218 410,234 426,234 426,250 410,250 410,298 394,298 394,314 426,314 426,330 442,330 442,314 458,314 458,330 474,330 474,394 458,394 458,346 442,346 442,362 426,362 426,346 362,346 362,314 378,314 378,282 346,282 346,330 330,330 330,362 314,362 314,330 282,330 282,314 314,314 314,298 298,298 298,282 314,282 314,266 282,266 282,298 250,298 250,314 266,314 266,330 250,330 250,362 282,362 282,426 266,426 266,410 250,410 250,426 234,426 234,346 170,346 170,314 186,314 186,330 202,330 202,298 170,298 170,266 154,266 154,250 122,250 122,266 138,266 138,314 154,314 154,330 122,330 122,314 106,314 106,346 138,346 138,378 122,378 122,458 138,458 138,474 234,474 234,458 202,458 202,442 282,442 282,458 298,458 298,474 250,474 250,482`;

  // Nariše rešitev postopoma (animacija črte)
  function animateDraw(poly, durationMs = 8000) {
    const len = poly.getTotalLength();
    poly.style.strokeDasharray = `${len}`;
    poly.style.strokeDashoffset = `${len}`;
    poly.getBoundingClientRect();

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
  // Ko klikneš "Prikaži rešitev":
  // - doda se kazen 10 sekund
  // - igralec se ne more premikati
  // - nariše se pravilna pot
  // Ko klikneš še enkrat:
  // - rešitev izgine
  // - premikanje se spet omogoči
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

    // Če igralec še ni začel, ob prvem prikazu rešitve zaženemo timer
    if (startedAt === null) {
      startedAt = now;
      pausedTotalMs = 0;
      pauseStartedAt = null;
    }

    // Kazen 10 sekund
    startedAt -= SOLUTION_PENALTY_MS;

    // Med prikazom rešitve je igra na pavzi
    paused = true;
    pauseStartedAt = now;
    keys.clear();

    const ns = 'http://www.w3.org/2000/svg';
    const poly = document.createElementNS(ns, 'polyline');

    poly.setAttribute('id', 'solutionPath');
    poly.setAttribute('points', SOLUTION_POINTS);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#ff0000');
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
  // requestAnimationFrame kliče to funkcijo večkrat na sekundo.
  // Tukaj se osvežuje čas, premikanje in preverjanje zmage/poraza.
  function tick(now) {
    requestAnimationFrame(tick);

    // Posodabljanje prikaza časa
    if (timeLimitMs === null) {
      const used = (startedAt === null) ? 0 : elapsedActiveMs(now);
      if (timeEl) timeEl.textContent = fmtTime(used);
    } else {
      const left = (startedAt === null) ? timeLimitMs : timeLeftMs(now);
      if (timeEl) timeEl.textContent = fmtTime(left);
    }

    // Če je igra na pavzi ali zaklenjena, ne dovolimo premikanja
    if (paused || gameLocked) return;

    // Če je zmanjkalo časa
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

    // Branje smeri iz pritisnjenih tipk
    let dx = 0, dy = 0;
    if (keys.has('ArrowUp') || keys.has('w')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) dy += 1;
    if (keys.has('ArrowLeft') || keys.has('a')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) dx += 1;

    // Če igralec ne pritiska ničesar, ne delamo nič
    if (dx === 0 && dy === 0) return;

    // Ob prvem premiku zaženemo čas
    startTimerIfNeeded(now);

    // Normalizacija diagonale:
    // da je hitrost enaka v vse smeri, tudi diagonalno
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    // Premikanje razdelimo na manjše korake,
    // da igralec ne "preskoči" tankih sten
    const step = speed;
    const sub = Math.max(1, Math.ceil(step / 1.2));
    const sx = (dx * step) / sub;
    const sy = (dy * step) / sub;

    let { x, y } = getPlayer();
    let moved = false;

    for (let i = 0; i < sub; i++) {
      const nx = x + sx;
      const ny = y + sy;

      // Če ni trka, se normalno premaknemo
      if (!collidesCircleWithWalls(nx, ny)) {
        x = nx;
        y = ny;
        moved = true;
      } else {
        // Če trčimo diagonalno, poskusimo še ločeno po X in Y
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

    // Če se je igralec dejansko premaknil, posodobimo položaj
    if (moved) {
      setPlayer(x, y);

      // Če je igralec prišel v cilj
      if (insideFinish(x, y)) {
        gameLocked = true;

        const usedMs = elapsedActiveMs(now);
        const timeStr = fmtTime(usedMs);

        // Funkcija za shranjevanje rezultata
        const saveWin = (playerName) => {
          const entry = {
            name: (playerName || 'Brez imena').trim(),
            diff: difficulty,
            time: timeStr,
            ts: Date.now()
          };

          const arr = loadResults();
          arr.unshift(entry);
          saveResults(arr);
          renderResults();
        };

        // Če je SweetAlert na voljo, pokažemo obrazec za vnos imena
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
              maxlength: 8 // največ 8 znakov
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
          // Rezervna možnost brez SweetAlert
          const playerName = prompt(`Bravo!\nTežavnost: ${difficulty}\nČas: ${timeStr}\n\nVnesi svoje ime:`) || 'Brez imena';
          saveWin(playerName);
          resetGame();
        }
      }
    }
  }

  // ===== 14) GUMBI ZA TEŽAVNOST =====
  // Aktivira klik na 1/2/3/4 in zamenja aktivni gumb
  document.querySelectorAll('.btn[data-d]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn[data-d]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      applyDifficulty(+b.dataset.d);
    });
  });

  // ===== 15) TIPKOVNICA =====
  // keydown = ko tipko pritisnemo
  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // SPACE = pavza
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

    // R = reset igre
    if (k === 'r') {
      resetGame();
      return;
    }

    // Prepreči scroll strani pri puščicah
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      e.preventDefault();
    }

    // Tipko shranimo v Set
    keys.add(k);
  });

  // keyup = ko tipko spustimo
  window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(k);
  });

  // ===== 16) OSTALI GUMBI =====
  // Reset gumb
  btnReset?.addEventListener('click', resetGame);

  const btnHint = document.getElementById('btnHint');

  // Namig / navodila
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

  // Počisti rezultate
  btnClear?.addEventListener('click', () => {
    sessionStorage.removeItem(STORE_KEY);
    renderResults();
  });

  // ===== 17) ZAČETNA INICIALIZACIJA =====
  // Nastavimo začetni prikaz in zaženemo game loop
  if (diffEl) diffEl.textContent = String(difficulty);
  player.setAttribute('r', radius);

  resetGame();
  renderResults();
  requestAnimationFrame(tick);

})();