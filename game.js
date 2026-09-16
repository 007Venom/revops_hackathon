/* =============================================================================
   RevOps Firefighter — v1 (LOGIC ONLY)
   =============================================================================
   You are a RevOps analyst in a server room. Servers catch fire. Put them out
   before the revenue stack goes down.

   Architecture (conceptually 3 tiers, all in the browser for now):
     - DATA LAYER      : CONFIG + the `game` state object (the single source of
                         truth for everything on screen).
     - LOGIC LAYER     : update() and its helpers — movement, ignition,
                         burn-down, extinguishing, win/lose checks.
     - CLIENT/UI LAYER : draw() — turns the state object into rectangles.

   The game loop reads input -> updates state -> draws state, 60x a second.
============================================================================= */


/* -----------------------------------------------------------------------------
   DATA LAYER: every tunable number lives here. Change these to rebalance.
----------------------------------------------------------------------------- */
const CONFIG = {
  // --- Map geometry ---------------------------------------------------------
  TILE: 40,               // pixel size of one grid tile
  COLS: 20,               // grid width in tiles  (20 * 40 = 800px canvas)
  ROWS: 14,               // grid height in tiles (14 * 40 = 560px canvas)

  // --- Servers --------------------------------------------------------------
  SERVER_COUNT: 10,       // how many servers are placed at game start
  SERVER_SIZE: 32,        // drawn size of a server (fits inside a 40px tile)
  MIN_SERVER_GAP: 2,      // min distance in tiles between servers (Chebyshev).
                          // 2 = never touching, not even diagonally. This is
                          // what guarantees the room stays walkable.
  MAX_BURNED_ALLOWED: 3,  // you lose when this many servers are BURNED_DOWN

  // --- Player ---------------------------------------------------------------
  PLAYER_SIZE: 24,
  PLAYER_SPEED: 190,      // pixels per second

  // --- Fire timing ----------------------------------------------------------
  IGNITE_INTERVAL_START: 6.0,  // seconds between ignitions at t=0
  IGNITE_INTERVAL_MIN: 1.2,    // fastest the ignition timer ever gets
  IGNITE_RAMP_PER_SEC: 0.06,   // interval shrinks by this many seconds, per
                               // second of elapsed time (escalating pressure)
  IGNITE_FIRST_DELAY: 2.0,     // grace period before the very first fire

  BURN_DOWN_TIME: 8.0,         // a fire left this long destroys the server

  // --- Extinguishing --------------------------------------------------------
  EXTINGUISH_TIME: 2.0,   // seconds of holding SPACE to put a fire out
  EXTINGUISH_RANGE: 14,   // how many pixels away from the server's edge still
                          // counts as "next to it" (0 would mean touching)

  // --- Win condition --------------------------------------------------------
  SURVIVE_TIME: 90,       // survive this long, with no active fire and fewer
                          // than MAX_BURNED_ALLOWED servers lost, and you win
};

// Server lifecycle states. OK -> BURNING -> BURNED_DOWN (permanent),
// or BURNING -> OK when the player extinguishes it in time.
const STATE = {
  OK: 'OK',
  BURNING: 'BURNING',
  BURNED_DOWN: 'BURNED_DOWN',
};

// Overall game states.
const PHASE = {
  PLAYING: 'PLAYING',
  WON: 'WON',
  LOST: 'LOST',
};

const COLORS = {
  floor:       '#2b2b2b',
  wall:        '#555555',
  player:      '#3a7bd5',
  ok:          '#9a9a9a',
  burning:     '#d63b2f',
  burnedDown:  '#0d0d0d',
  text:        '#eeeeee',
  barBack:     '#000000',
  barFill:     '#4cd137',
  targetRing:  '#ffd32a',
};


/* -----------------------------------------------------------------------------
   Canvas handles (CLIENT/UI LAYER plumbing)
----------------------------------------------------------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = CONFIG.COLS * CONFIG.TILE;
canvas.height = CONFIG.ROWS * CONFIG.TILE;


/* -----------------------------------------------------------------------------
   INPUT: we only record which keys are currently held down. The logic layer
   reads this every frame — it never reacts to events directly, which keeps
   movement smooth and frame-rate independent.
----------------------------------------------------------------------------- */
const keys = {};

window.addEventListener('keydown', (e) => {
  // Stop arrow keys / space from scrolling the page.
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar'].includes(e.key)) {
    e.preventDefault();
  }
  keys[e.key] = true;

  // R restarts from anywhere (playing, won or lost).
  if (e.key === 'r' || e.key === 'R') startGame();
});

window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});

// If the window loses focus, forget all held keys — otherwise the player
// keeps walking (or extinguishing) after you tab away.
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

function isSpaceHeld() {
  return !!(keys[' '] || keys['Spacebar']);
}


/* -----------------------------------------------------------------------------
   DATA LAYER: the live game state. Rebuilt from scratch by startGame().
----------------------------------------------------------------------------- */
let game = null;

function startGame() {
  const spawnTile = {
    col: Math.floor(CONFIG.COLS / 2),
    row: Math.floor(CONFIG.ROWS / 2),
  };

  game = {
    phase: PHASE.PLAYING,
    elapsed: 0,                                  // seconds since game start
    igniteTimer: CONFIG.IGNITE_FIRST_DELAY,      // counts down to next fire

    player: {
      x: tileCenter(spawnTile.col),              // centre position in pixels
      y: tileCenter(spawnTile.row),
    },

    spawnTile,
    servers: placeServers(spawnTile),

    // Extinguishing progress. We remember WHICH server we are working on so
    // that switching target (or walking away) resets the progress bar.
    extinguish: {
      targetId: null,
      progress: 0,                               // 0 .. EXTINGUISH_TIME
    },
  };
}


/* -----------------------------------------------------------------------------
   LOGIC LAYER: server placement.

   Rules: interior tiles only (never a wall), never within MIN_SERVER_GAP tiles
   of another server, never on/next to the player spawn. Then we prove the
   layout is fair with a flood fill: the player must be able to walk to a tile
   orthogonally adjacent to every single server. If not, throw the layout away
   and roll again.
----------------------------------------------------------------------------- */
function placeServers(spawnTile) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const servers = tryPlaceServers(spawnTile);
    if (servers && allServersReachable(servers, spawnTile)) return servers;
  }
  // Practically unreachable with the default CONFIG, but never hang the game.
  console.warn('Could not find a valid server layout — using the last attempt.');
  return tryPlaceServers(spawnTile) || [];
}

function tryPlaceServers(spawnTile) {
  const servers = [];

  for (let i = 0; i < CONFIG.SERVER_COUNT; i++) {
    let placed = false;

    // Try random interior tiles until one satisfies the spacing rules.
    for (let tries = 0; tries < 500 && !placed; tries++) {
      const col = 1 + Math.floor(Math.random() * (CONFIG.COLS - 2));
      const row = 1 + Math.floor(Math.random() * (CONFIG.ROWS - 2));

      // Keep clear of the player's spawn tile and its neighbours.
      if (chebyshev(col, row, spawnTile.col, spawnTile.row) < CONFIG.MIN_SERVER_GAP) continue;

      // Keep clear of every server already placed.
      const tooClose = servers.some(
        (s) => chebyshev(col, row, s.col, s.row) < CONFIG.MIN_SERVER_GAP
      );
      if (tooClose) continue;

      servers.push(makeServer(i, col, row));
      placed = true;
    }

    if (!placed) return null; // ran out of room — caller rolls a fresh layout
  }

  return servers;
}

function makeServer(id, col, row) {
  return {
    id,
    col,
    row,
    x: tileCenter(col),        // centre position in pixels
    y: tileCenter(row),
    state: STATE.OK,
    burnTimer: 0,              // seconds this server has been on fire
  };
}

// Flood fill the walkable floor from the player's spawn, then confirm every
// server has at least one reachable tile next to it.
function allServersReachable(servers, spawnTile) {
  const blocked = new Set(servers.map((s) => `${s.col},${s.row}`));
  const seen = new Set([`${spawnTile.col},${spawnTile.row}`]);
  const queue = [spawnTile];

  while (queue.length) {
    const { col, row } = queue.shift();
    const neighbours = [
      { col: col + 1, row },
      { col: col - 1, row },
      { col, row: row + 1 },
      { col, row: row - 1 },
    ];

    for (const n of neighbours) {
      const key = `${n.col},${n.row}`;
      if (seen.has(key)) continue;
      if (n.col < 1 || n.row < 1 || n.col > CONFIG.COLS - 2 || n.row > CONFIG.ROWS - 2) continue; // wall
      if (blocked.has(key)) continue; // a server occupies this tile
      seen.add(key);
      queue.push(n);
    }
  }

  return servers.every((s) =>
    seen.has(`${s.col + 1},${s.row}`) ||
    seen.has(`${s.col - 1},${s.row}`) ||
    seen.has(`${s.col},${s.row + 1}`) ||
    seen.has(`${s.col},${s.row - 1}`)
  );
}


/* -----------------------------------------------------------------------------
   LOGIC LAYER: the per-frame update. `dt` is the time since the last frame in
   seconds, so the game behaves identically on a 60Hz and a 144Hz screen.
----------------------------------------------------------------------------- */
function update(dt) {
  if (game.phase !== PHASE.PLAYING) return; // frozen on the win/lose screen

  game.elapsed += dt;

  updatePlayer(dt);
  updateIgnition(dt);
  updateFires(dt);
  updateExtinguishing(dt);
  checkEndConditions();
}

// --- Movement ---------------------------------------------------------------
// v1 has no collision with servers (that is a v2 job) — only the walls stop
// you. Diagonals are allowed; we do not normalise them, so diagonal movement
// is slightly faster. Fine for a logic build.
function updatePlayer(dt) {
  const p = game.player;
  const step = CONFIG.PLAYER_SPEED * dt;

  if (keys['ArrowLeft'])  p.x -= step;
  if (keys['ArrowRight']) p.x += step;
  if (keys['ArrowUp'])    p.y -= step;
  if (keys['ArrowDown'])  p.y += step;

  // Clamp inside the walls (the wall is one tile thick around the edge).
  const half = CONFIG.PLAYER_SIZE / 2;
  const minPos = CONFIG.TILE + half;
  p.x = clamp(p.x, minPos, canvas.width  - minPos);
  p.y = clamp(p.y, minPos, canvas.height - minPos);
}

// --- Random ignition, escalating over time ----------------------------------
function currentIgniteInterval() {
  const interval = CONFIG.IGNITE_INTERVAL_START - CONFIG.IGNITE_RAMP_PER_SEC * game.elapsed;
  return Math.max(CONFIG.IGNITE_INTERVAL_MIN, interval);
}

function updateIgnition(dt) {
  game.igniteTimer -= dt;
  if (game.igniteTimer > 0) return;

  // Pick a random server that is currently fine and set it alight.
  const candidates = game.servers.filter((s) => s.state === STATE.OK);
  if (candidates.length > 0) {
    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    victim.state = STATE.BURNING;
    victim.burnTimer = 0;
  }

  // Reset the timer even if nothing could be ignited, so we try again later.
  game.igniteTimer = currentIgniteInterval();
}

// --- Burn-down --------------------------------------------------------------
function updateFires(dt) {
  for (const s of game.servers) {
    if (s.state !== STATE.BURNING) continue;

    s.burnTimer += dt;
    if (s.burnTimer >= CONFIG.BURN_DOWN_TIME) {
      s.state = STATE.BURNED_DOWN;   // permanent: never repaired, never re-lit
      s.burnTimer = 0;

      // If this was the server we were fighting, our progress is moot.
      if (game.extinguish.targetId === s.id) resetExtinguish();
    }
  }
}

// --- Hold-to-extinguish state machine ---------------------------------------
// Every frame we ask: is there a burning server in range, and is SPACE held?
//   yes + same server as last frame -> progress grows
//   yes + different server          -> progress restarts on the new target
//   no                              -> progress resets to zero
function updateExtinguishing(dt) {
  const target = findExtinguishTarget();

  if (!target || !isSpaceHeld()) {
    resetExtinguish();
    return;
  }

  if (game.extinguish.targetId !== target.id) {
    game.extinguish.targetId = target.id;
    game.extinguish.progress = 0;
  }

  game.extinguish.progress += dt;

  if (game.extinguish.progress >= CONFIG.EXTINGUISH_TIME) {
    target.state = STATE.OK;      // fire out — this server can burn again later
    target.burnTimer = 0;
    resetExtinguish();
  }
}

function resetExtinguish() {
  game.extinguish.targetId = null;
  game.extinguish.progress = 0;
}

// The nearest burning server within EXTINGUISH_RANGE pixels of the player.
function findExtinguishTarget() {
  let best = null;
  let bestDist = Infinity;

  for (const s of game.servers) {
    if (s.state !== STATE.BURNING) continue;
    const dist = distanceToServerEdge(game.player, s);
    if (dist <= CONFIG.EXTINGUISH_RANGE && dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }

  return best;
}

// Gap in pixels between the player's box and the server's box (0 = touching
// or overlapping), so "standing on it" and "standing beside it" both work.
function distanceToServerEdge(player, server) {
  const gapX = Math.abs(player.x - server.x) - (CONFIG.PLAYER_SIZE + CONFIG.SERVER_SIZE) / 2;
  const gapY = Math.abs(player.y - server.y) - (CONFIG.PLAYER_SIZE + CONFIG.SERVER_SIZE) / 2;
  return Math.max(0, Math.hypot(Math.max(0, gapX), Math.max(0, gapY)));
}

// --- Win / lose -------------------------------------------------------------
function checkEndConditions() {
  const burnedDown = countByState(STATE.BURNED_DOWN);
  const burning = countByState(STATE.BURNING);

  // LOSE: too much of the revenue stack is gone.
  if (burnedDown >= CONFIG.MAX_BURNED_ALLOWED) {
    game.phase = PHASE.LOST;
    return;
  }

  // WIN: the clock ran out AND nothing is currently on fire. If a fire is
  // still active when the timer hits, you keep playing until you put it out.
  if (game.elapsed >= CONFIG.SURVIVE_TIME && burning === 0) {
    game.phase = PHASE.WON;
  }
}

function countByState(state) {
  return game.servers.filter((s) => s.state === state).length;
}


/* -----------------------------------------------------------------------------
   CLIENT/UI LAYER: draw the state. Plain rectangles on purpose for v1.
----------------------------------------------------------------------------- */
function draw() {
  drawRoom();
  drawServers();
  drawPlayer();
  drawExtinguishBar();
  drawDebugOverlay();
  if (game.phase !== PHASE.PLAYING) drawEndScreen();
}

function drawRoom() {
  // Floor.
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Walls: a one-tile-thick border.
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, 0, canvas.width, CONFIG.TILE);                                  // top
  ctx.fillRect(0, canvas.height - CONFIG.TILE, canvas.width, CONFIG.TILE);        // bottom
  ctx.fillRect(0, 0, CONFIG.TILE, canvas.height);                                 // left
  ctx.fillRect(canvas.width - CONFIG.TILE, 0, CONFIG.TILE, canvas.height);        // right
}

function drawServers() {
  const size = CONFIG.SERVER_SIZE;

  for (const s of game.servers) {
    ctx.fillStyle =
      s.state === STATE.BURNING     ? COLORS.burning :
      s.state === STATE.BURNED_DOWN ? COLORS.burnedDown :
                                      COLORS.ok;

    ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);

    // Highlight the server SPACE would currently target — makes the range
    // rule obvious while we are tuning EXTINGUISH_RANGE.
    if (game.phase === PHASE.PLAYING) {
      const target = findExtinguishTarget();
      if (target && target.id === s.id) {
        ctx.strokeStyle = COLORS.targetRing;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - size / 2 - 3, s.y - size / 2 - 3, size + 6, size + 6);
      }
    }

    // Debug: how long until this fire destroys the server.
    if (s.state === STATE.BURNING) {
      const left = (CONFIG.BURN_DOWN_TIME - s.burnTimer).toFixed(1);
      ctx.fillStyle = COLORS.text;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${left}s`, s.x, s.y + size / 2 + 12);
    }
  }
}

function drawPlayer() {
  const size = CONFIG.PLAYER_SIZE;
  ctx.fillStyle = COLORS.player;
  ctx.fillRect(game.player.x - size / 2, game.player.y - size / 2, size, size);
}

function drawExtinguishBar() {
  if (game.extinguish.targetId === null) return;

  const target = game.servers.find((s) => s.id === game.extinguish.targetId);
  if (!target) return;

  const w = 44;
  const h = 6;
  const x = target.x - w / 2;
  const y = target.y - CONFIG.SERVER_SIZE / 2 - 12;
  const ratio = clamp(game.extinguish.progress / CONFIG.EXTINGUISH_TIME, 0, 1);

  ctx.fillStyle = COLORS.barBack;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.barFill;
  ctx.fillRect(x, y, w * ratio, h);
}

function drawDebugOverlay() {
  const lines = [
    `elapsed:          ${game.elapsed.toFixed(1)}s / ${CONFIG.SURVIVE_TIME}s`,
    `servers OK:       ${countByState(STATE.OK)}`,
    `servers burning:  ${countByState(STATE.BURNING)}`,
    `burned down:      ${countByState(STATE.BURNED_DOWN)} / ${CONFIG.MAX_BURNED_ALLOWED} (lose at ${CONFIG.MAX_BURNED_ALLOWED})`,
    `ignite interval:  ${currentIgniteInterval().toFixed(2)}s (next in ${Math.max(0, game.igniteTimer).toFixed(1)}s)`,
    `extinguishing:    ${game.extinguish.targetId === null
        ? '—'
        : `server #${game.extinguish.targetId} ${game.extinguish.progress.toFixed(2)}s / ${CONFIG.EXTINGUISH_TIME}s`}`,
    `phase:            ${game.phase}`,
  ];

  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.text;
  lines.forEach((line, i) => ctx.fillText(line, 10, 18 + i * 15));
}

function drawEndScreen() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const won = game.phase === PHASE.WON;
  ctx.textAlign = 'center';

  ctx.fillStyle = won ? COLORS.barFill : COLORS.burning;
  ctx.font = 'bold 34px monospace';
  ctx.fillText(won ? 'REVENUE STACK SAVED' : 'REVENUE STACK DOWN', canvas.width / 2, canvas.height / 2 - 20);

  ctx.fillStyle = COLORS.text;
  ctx.font = '14px monospace';
  ctx.fillText(
    `survived ${game.elapsed.toFixed(1)}s · ${countByState(STATE.BURNED_DOWN)} servers lost`,
    canvas.width / 2,
    canvas.height / 2 + 12
  );
  ctx.fillText('press R to restart', canvas.width / 2, canvas.height / 2 + 40);
}


/* -----------------------------------------------------------------------------
   Small maths helpers
----------------------------------------------------------------------------- */
function tileCenter(index) {
  return index * CONFIG.TILE + CONFIG.TILE / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// "King-move" distance in tiles: 1 means touching, including diagonally.
function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}


/* -----------------------------------------------------------------------------
   THE GAME LOOP: requestAnimationFrame + delta time.
----------------------------------------------------------------------------- */
let lastFrameTime = performance.now();

function loop(now) {
  // Seconds since the previous frame, capped so that tabbing away and back
  // does not teleport the player or instantly burn every server down.
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

startGame();
requestAnimationFrame(loop);
