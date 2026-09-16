/* =============================================================================
   RevOps Firefighter — v3
   =============================================================================
   v1 was logic-only rectangles. v2 added textures/menu/HUD/scoring. v3 adds,
   on top of both:
     - real sprites: server rack (with a burned/charred filter), an animated
       fire overlay on burning servers, and a 4-direction player walk cycle
     - a looping background video on the main menu (muted autoplay)
     - an Escape pause menu with Continue / Quit-to-menu + a random taunt line

   Architecture is unchanged:
     - DATA LAYER      : CONFIG + the `game` state object.
     - LOGIC LAYER     : update() and its helpers.
     - CLIENT/UI LAYER : draw() + the DOM menu/pause overlays in
                         index.html/style.css.

   Each version's additions are labelled "v2:" / "v3:" in comments so the
   diff against the previous version is easy to follow.
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
  MIN_SERVER_GAP: 2,      // min distance in tiles between servers/obstacles
                          // (Chebyshev). This is what guarantees the room
                          // stays walkable and nothing spawns hugging a wall.
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

  // --- v2: desks (solid obstacles) -------------------------------------------
  // Footprint is DESK_COLS x DESK_ROWS tiles, matching the ~128x80
  // desk_table.png asset. Per-map desk/partition tile lists now live in
  // MAPS (v3.1, below) instead of being fixed here.
  DESK_COLS: 3,
  DESK_ROWS: 2,

  // --- v2: scoring ------------------------------------------------------------
  POINTS: {
    EXTINGUISH: 100,      // per server successfully put out
    BURN_PENALTY: 150,    // per server lost to BURNED_DOWN
    SURVIVE_PER_SEC: 1,   // slow trickle just for staying alive
  },
  LEADERBOARD_SIZE: 5,    // top N scores kept for this browser session

  // --- v2: HUD sizing ---------------------------------------------------------
  HUD_PANEL_SCALE: 0.55,  // stat_panel_frame.png (288x160) drawn at this scale

  // --- v3: server rack + fire sprites -----------------------------------------
  SERVER_SPRITE_W: 40,       // drawn width; server_rack.png is 540x1116 (tall)
  FIRE_FRAME_W: 164,         // fire_spritesheet.png: 1312x393, 8 frames
  FIRE_FRAME_H: 393,
  FIRE_FRAME_COUNT: 8,
  FIRE_ANIM_FPS: 9,          // within the requested 8-10fps range
  FIRE_DRAW_SCALE: 1.3,      // fire drawn slightly wider than the rack

  // --- v3: player walk cycle ---------------------------------------------------
  // walking_sprite.png is a 4x4 grid, ~236x283 per cell. Row -> facing
  // direction, guessed from the sheet by eye — see the v3 chat reply for
  // which mapping this is; flag if a direction looks wrong and we'll swap.
  DIRECTION_ROWS: { down: 0, up: 3, left: 1, right: 2 },
  PLAYER_FRAME_COUNT: 4,
  WALK_ANIM_FPS: 8,
  PLAYER_SPRITE_W: 40,       // drawn width of the character sprite

  // --- v3: pause menu taunts ---------------------------------------------------
  // Exact wording as given — do not edit these strings.
  TAUNT_LINES: [
    `Quitting already? We knew this fight was out of your league..`,
    `Are you really rage-quitting, or did your mom just call you for dinner?.`,
    `Giving up so soon? The tutorial wasn't that hard..`,
    `We'd call you a chicken, but even chickens put up a fight..`,
    `Go ahead, click "Exit Game". The game was getting a bit too fast for you anyway..`,
    `Closing the game won't make you any better at it, you know..`,
    `Running away won't fix your high score..`,
    `Don't worry, the game will still be here when you get your courage back..`,
    `Rage-quitting won't refund your skill issues..`,
    `Go take a nap—clearly this was a bit too intense for you..`,
    `We'd say "thanks for playing," but you barely even tried..`,
  ],
};

// Server lifecycle states. OK -> BURNING -> BURNED_DOWN (permanent),
// or BURNING -> OK when the player extinguishes it in time.
const STATE = {
  OK: 'OK',
  BURNING: 'BURNING',
  BURNED_DOWN: 'BURNED_DOWN',
};

// Overall game states (menu is represented separately — see `game === null`).
const PHASE = {
  PLAYING: 'PLAYING',
  WON: 'WON',
  LOST: 'LOST',
};

const COLORS = {
  // Brand palette (mirrors the CSS variables in style.css).
  bgDark: '#191E2B',
  bgMid: '#2D3447',
  accent: '#FF6A4A',
  accentDark: '#D64F33',
  cream: '#F7F4EF',
  grey: '#C6C6C6',

  // Gameplay colors.
  player: '#3a7bd5',
  ok: '#9a9a9a',
  burning: '#FF6A4A',      // fire uses the brand accent color
  burnedDown: '#0d0d0d',
  targetRing: '#ffd32a',
  barBack: '#000000',
  barFill: '#4cd137',

  // Fallback (no-image-yet) obstacle look.
  deskFallback: '#b8875a',
  deskFallbackBorder: '#7a5a3a',
};


/* -----------------------------------------------------------------------------
   Canvas handles (CLIENT/UI LAYER plumbing)
----------------------------------------------------------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = CONFIG.COLS * CONFIG.TILE;
canvas.height = CONFIG.ROWS * CONFIG.TILE;

const HUD_FONT = `"Press Start 2P", "Courier New", monospace`;


/* -----------------------------------------------------------------------------
   v2: ASSET PRELOADING for the textures drawn ON the canvas (walls, floor,
   desks, HUD frame). Each entry loads independently and flags itself as
   `loaded`. Every draw call below checks that flag and falls back to a plain
   colored shape if the PNG isn't there yet — so the game is fully playable
   before real art is dropped into /assets/images, and upgrades automatically
   the moment it is (no code changes needed).

   The menu's background wash and badge are plain <img>/CSS in index.html —
   the browser handles those on its own, so they aren't part of this list.
----------------------------------------------------------------------------- */
const ASSET_SOURCES = {
  wallTile: 'assets/images/wall_tile.png',
  floorTile: 'assets/images/floor_tile.png',
  deskTable: 'assets/images/desk_table.png',
  statPanelFrame: 'assets/images/stat_panel_frame.png',

  // v3
  serverRack: 'assets/sprites/server_rack.png',
  fireSheet: 'assets/sprites/fire_spritesheet.png',
  walkingSprite: 'assets/sprites/walking_sprite.png',
};

const ASSETS = {};
for (const [key, src] of Object.entries(ASSET_SOURCES)) {
  const entry = { img: new Image(), loaded: false };
  entry.img.onload = () => { entry.loaded = true; };
  entry.img.onerror = () => {
    console.warn(`[assets] ${src} not found yet — using fallback rendering.`);
  };
  entry.img.src = src;
  ASSETS[key] = entry;
}


/* -----------------------------------------------------------------------------
   v3.1: MAP SELECT. A "map" is just a different fixed desk/partition layout —
   everything else (border walls, server randomization, fire/extinguish
   rules) is unchanged. The player picks one from the map-select overlay
   (shown after "Start Game", wired further down) before each new game.
----------------------------------------------------------------------------- */
const MAPS = [
  {
    id: 'open-floor',
    name: 'Open Floor',
    difficulty: 'Easy',
    tagline: 'Four corner desks and two short partition walls around a mostly open center.',
    deskTiles: [
      { col: 2, row: 2 }, { col: 15, row: 2 },
      { col: 2, row: 10 }, { col: 15, row: 10 },
    ],
    partitionTiles: [
      { col: 10, row: 3 }, { col: 10, row: 4 },
      { col: 9, row: 9 }, { col: 9, row: 10 },
    ],
  },
  {
    id: 'cubicle-rows',
    name: 'Cubicle Rows',
    difficulty: 'Medium',
    tagline: 'Two long desk rows split the floor into lanes — plan a loop instead of cutting straight across.',
    deskTiles: [
      { col: 2, row: 4 }, { col: 7, row: 4 }, { col: 12, row: 4 },
      { col: 2, row: 8 }, { col: 7, row: 8 }, { col: 12, row: 8 },
    ],
    partitionTiles: [
      { col: 16, row: 4 }, { col: 16, row: 5 },
      { col: 16, row: 8 }, { col: 16, row: 9 },
    ],
  },
  {
    id: 'server-ring',
    name: 'Server Ring',
    difficulty: 'Medium',
    tagline: 'Desks and partitions form a loose ring around the center — commit to one of four gaps to get in or out.',
    deskTiles: [
      { col: 6, row: 3 }, { col: 12, row: 3 },
      { col: 6, row: 9 }, { col: 12, row: 9 },
    ],
    // Shorter ring segments than the original design (2 tiles per side
    // instead of 4) — with the 4 corner desks already blocking ~24 tiles,
    // a full 16-tile ring left too little open floor for placeServers() to
    // reliably find a valid, fully-reachable spot for all 10 servers.
    partitionTiles: [
      { col: 5, row: 6 }, { col: 5, row: 7 },
      { col: 14, row: 6 }, { col: 14, row: 7 },
      { col: 9, row: 2 }, { col: 10, row: 2 },
      { col: 9, row: 11 }, { col: 10, row: 11 },
    ],
  },
  {
    id: 'maze-grid',
    name: 'Maze Grid',
    difficulty: 'Hard',
    tagline: 'Nine staggered desk pods with partition stubs at every gap — narrow corridors, hard choices under fire.',
    deskTiles: [
      { col: 2, row: 2 }, { col: 8, row: 2 }, { col: 14, row: 2 },
      { col: 2, row: 6 }, { col: 7, row: 6 }, { col: 14, row: 6 },
      { col: 2, row: 10 }, { col: 8, row: 10 }, { col: 14, row: 10 },
    ],
    partitionTiles: [
      { col: 5, row: 4 }, { col: 5, row: 8 },
      { col: 11, row: 4 }, { col: 11, row: 8 },
      { col: 17, row: 4 }, { col: 17, row: 8 },
    ],
  },
];

/* -----------------------------------------------------------------------------
   v2/v3.1: fixed structural layout — walls, desks and partitions never move
   during a game, only the servers are re-randomized on restart. v2 computed
   this once from a single hardcoded CONFIG layout; v3.1 turns it into
   buildMapLayout(), called whenever the player picks a map, so the same
   plumbing works for any number of maps.
----------------------------------------------------------------------------- */
const DESK_PIXEL_SIZE = {
  w: CONFIG.DESK_COLS * CONFIG.TILE,
  h: CONFIG.DESK_ROWS * CONFIG.TILE,
};

function buildMapLayout(map) {
  // Every tile a desk physically occupies (used to keep servers off them).
  const deskFootprintTiles = map.deskTiles.flatMap((d) => {
    const tiles = [];
    for (let c = 0; c < CONFIG.DESK_COLS; c++) {
      for (let r = 0; r < CONFIG.DESK_ROWS; r++) {
        tiles.push({ col: d.col + c, row: d.row + r });
      }
    }
    return tiles;
  });

  // Border wall tiles (perimeter) + partitions, for drawing the wall texture.
  const wallTiles = [];
  for (let c = 0; c < CONFIG.COLS; c++) {
    wallTiles.push({ col: c, row: 0 });
    wallTiles.push({ col: c, row: CONFIG.ROWS - 1 });
  }
  for (let r = 1; r < CONFIG.ROWS - 1; r++) {
    wallTiles.push({ col: 0, row: r });
    wallTiles.push({ col: CONFIG.COLS - 1, row: r });
  }
  wallTiles.push(...map.partitionTiles);

  // Tile keys that block server placement / the reachability flood fill.
  const structuralBlockedKeys = new Set(
    [...deskFootprintTiles, ...map.partitionTiles].map((t) => `${t.col},${t.row}`)
  );

  // Pixel AABBs for player collision (desks + partitions — the border wall
  // is already handled by clamping the player's position, same as v1).
  const solidObstacles = [
    ...map.deskTiles.map((d) => ({
      left: d.col * CONFIG.TILE,
      top: d.row * CONFIG.TILE,
      right: d.col * CONFIG.TILE + DESK_PIXEL_SIZE.w,
      bottom: d.row * CONFIG.TILE + DESK_PIXEL_SIZE.h,
    })),
    ...map.partitionTiles.map((t) => ({
      left: t.col * CONFIG.TILE,
      top: t.row * CONFIG.TILE,
      right: (t.col + 1) * CONFIG.TILE,
      bottom: (t.row + 1) * CONFIG.TILE,
    })),
  ];

  return {
    deskTiles: map.deskTiles,
    partitionTiles: map.partitionTiles,
    deskFootprintTiles,
    wallTiles,
    structuralBlockedKeys,
    solidObstacles,
  };
}

// Defaults to the first map so the game stays playable even if startGame()
// somehow runs before a map is picked — the real path is always through
// chooseMap() from the map-select overlay, wired further down.
let activeMap = buildMapLayout(MAPS[0]);

/* -----------------------------------------------------------------------------
   v3: sprite sheet geometry, derived from the source image dimensions given
   in the brief. Kept out of CONFIG because they're computed, not hand-tuned.
----------------------------------------------------------------------------- */
// server_rack.png is 540x1116 — scale height to match the configured width.
const SERVER_SPRITE_H = Math.round(CONFIG.SERVER_SPRITE_W * (1116 / 540));

// fire_spritesheet.png: draw slightly wider than the rack, same aspect ratio
// as one 164x393 frame.
const FIRE_DRAW_SIZE = {
  w: Math.round(CONFIG.SERVER_SPRITE_W * CONFIG.FIRE_DRAW_SCALE),
  h: Math.round(
    CONFIG.SERVER_SPRITE_W * CONFIG.FIRE_DRAW_SCALE * (CONFIG.FIRE_FRAME_H / CONFIG.FIRE_FRAME_W)
  ),
};

// walking_sprite.png is 944x1133 in a 4x4 grid -> each source cell is
// 236 x 283.25. Drawn scaled down to PLAYER_SPRITE_W wide, same aspect ratio.
const PLAYER_CELL = { w: 944 / 4, h: 1133 / 4 };
const PLAYER_SPRITE_H = Math.round(CONFIG.PLAYER_SPRITE_W * (PLAYER_CELL.h / PLAYER_CELL.w));


/* -----------------------------------------------------------------------------
   INPUT: we only record which keys are currently held down. The logic layer
   reads this every frame — it never reacts to events directly, which keeps
   movement smooth and frame-rate independent.
----------------------------------------------------------------------------- */
const keys = {};

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'Escape'].includes(e.key)) {
    e.preventDefault();
  }
  keys[e.key] = true;

  // R restarts, but only once a game is actually in progress (see v2 menu:
  // ignore R while the main menu overlay is still showing).
  if ((e.key === 'r' || e.key === 'R') && game) startGame();

  // v3: Escape toggles pause, but only during active gameplay — not on the
  // main menu and not on the win/lose screen (game.phase stays PLAYING while
  // paused, so this same check works for both pausing and resuming).
  if (e.key === 'Escape' && game && game.phase === PHASE.PLAYING) {
    setPaused(!game.paused);
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

function isSpaceHeld() {
  return !!(keys[' '] || keys['Spacebar']);
}


/* -----------------------------------------------------------------------------
   v2/v3: MAIN MENU wiring. The menu itself is plain DOM (index.html/
   style.css); this just toggles it and starts/exits the game. `game` stays
   `null` while the menu is showing, which the loop below treats as "nothing
   to update". v3 adds showMenu()/hideMenu() as real functions (not just an
   inline one-off) because Quit-to-menu now needs to bring the menu back.
----------------------------------------------------------------------------- */
const menuOverlay = document.getElementById('menuOverlay');
const menuVideo = document.getElementById('menuVideo');
const exitFallbackMsg = document.getElementById('exitFallbackMsg');

function showMenu() {
  menuOverlay.style.display = 'flex';
  // Belt-and-braces: some browsers only honor autoplay if `muted` is also
  // set as a JS property, not just the HTML attribute.
  menuVideo.muted = true;
  menuVideo.play().catch(() => {
    // Autoplay blocked (or the file isn't there yet) — the overlay's own
    // background-image already shows through, so there's nothing else to do.
  });
}

function hideMenu() {
  menuOverlay.style.display = 'none';
  menuVideo.pause();
}

document.getElementById('btnStart').addEventListener('click', () => {
  hideMenu();
  showMapSelect();
});

document.getElementById('btnExit').addEventListener('click', () => {
  window.close();
  // If we're still executing after this, the browser refused to close a tab
  // it didn't open itself — tell the player what to do instead.
  setTimeout(() => { exitFallbackMsg.hidden = false; }, 150);
});

// The mute/unmute button is `disabled` in the HTML, so it already can't be
// clicked — no handler needed until it does something.
// NOTE for later: once the mute toggle is real, this is where to gate
// unmuting the menu video — only turn sound on if the toggle is ON AND it
// happens after a user gesture (autoplay policies block unmuted audio
// otherwise). For now the video stays hard-muted regardless.


/* -----------------------------------------------------------------------------
   v3.1: MAP SELECT overlay wiring. Shown after "Start Game" instead of
   jumping straight into a run — the player picks one of MAPS (above), then
   startGame() runs against whichever layout they chose. There's no separate
   "Change Map" button on the main menu; picking a map is just step two of
   starting a new game every time (including after Quit-to-menu).
----------------------------------------------------------------------------- */
const mapSelectOverlay = document.getElementById('mapSelectOverlay');
const mapCardsGrid = document.getElementById('mapCardsGrid');

function showMapSelect() {
  renderMapCards();
  mapSelectOverlay.style.display = 'flex';
}

function hideMapSelect() {
  mapSelectOverlay.style.display = 'none';
}

document.getElementById('btnMapBack').addEventListener('click', () => {
  hideMapSelect();
  showMenu();
});

// Rebuilt fresh each time the overlay opens — four cards is cheap enough
// that there's no need to cache/diff them.
function renderMapCards() {
  mapCardsGrid.innerHTML = '';

  MAPS.forEach((map) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'map-card';
    card.innerHTML = `
      <canvas width="${CONFIG.COLS * MAP_PREVIEW_TILE_PX}" height="${CONFIG.ROWS * MAP_PREVIEW_TILE_PX}"></canvas>
      <div class="map-card-head">
        <p class="map-card-name">${map.name}</p>
        <span class="map-diff map-diff--${map.difficulty.toLowerCase()}">${map.difficulty}</span>
      </div>
      <p class="map-card-tagline">${map.tagline}</p>
    `;
    card.addEventListener('click', () => chooseMap(map));

    mapCardsGrid.appendChild(card);
    drawMapPreview(card.querySelector('canvas'), map);
  });
}

// Small schematic preview drawn with the same colors the real room uses
// (see COLORS), so each card is an accurate "here's what you'll see", not a
// separate mockup that could drift out of sync with the real rendering.
const MAP_PREVIEW_TILE_PX = 10;

function drawMapPreview(canvas, map) {
  const pctx = canvas.getContext('2d');
  const t = MAP_PREVIEW_TILE_PX;

  pctx.fillStyle = COLORS.bgDark;
  pctx.fillRect(0, 0, canvas.width, canvas.height);

  // Border wall.
  pctx.fillStyle = COLORS.bgMid;
  for (let c = 0; c < CONFIG.COLS; c++) {
    pctx.fillRect(c * t, 0, t, t);
    pctx.fillRect(c * t, (CONFIG.ROWS - 1) * t, t, t);
  }
  for (let r = 1; r < CONFIG.ROWS - 1; r++) {
    pctx.fillRect(0, r * t, t, t);
    pctx.fillRect((CONFIG.COLS - 1) * t, r * t, t, t);
  }

  // Partitions (same fill as the wall — that's how they render in-game too).
  for (const p of map.partitionTiles) {
    pctx.fillRect(p.col * t, p.row * t, t, t);
  }

  // Desks.
  pctx.fillStyle = COLORS.deskFallback;
  for (const d of map.deskTiles) {
    pctx.fillRect(d.col * t, d.row * t, CONFIG.DESK_COLS * t, CONFIG.DESK_ROWS * t);
  }

  // Spawn marker — always the grid center, same tile startGame() uses.
  const spawnCol = Math.floor(CONFIG.COLS / 2);
  const spawnRow = Math.floor(CONFIG.ROWS / 2);
  pctx.fillStyle = COLORS.player;
  pctx.beginPath();
  pctx.arc((spawnCol + 0.5) * t, (spawnRow + 0.5) * t, t * 0.35, 0, Math.PI * 2);
  pctx.fill();
}

function chooseMap(map) {
  activeMap = buildMapLayout(map);
  hideMapSelect();
  startGame();
}


/* -----------------------------------------------------------------------------
   v3: Escape PAUSE MENU wiring. Also plain DOM, layered over the canvas only
   while `game.paused` is true. update() (further down) is what actually
   freezes the simulation — this just shows/hides the overlay and rolls a
   random taunt line each time it opens.
----------------------------------------------------------------------------- */
const pauseOverlay = document.getElementById('pauseOverlay');
const tauntText = document.getElementById('tauntText');

let lastTauntIndex = -1;
function rollTaunt() {
  const lines = CONFIG.TAUNT_LINES;
  let idx;
  do {
    idx = Math.floor(Math.random() * lines.length);
  } while (idx === lastTauntIndex && lines.length > 1);
  lastTauntIndex = idx;
  tauntText.textContent = lines[idx];
}

function setPaused(paused) {
  if (!game) return;
  game.paused = paused;
  pauseOverlay.style.display = paused ? 'flex' : 'none';
  if (paused) rollTaunt();
}

document.getElementById('btnContinue').addEventListener('click', () => setPaused(false));

document.getElementById('btnQuitToMenu').addEventListener('click', () => {
  // Ends the current run (no score is recorded — only WON/LOST do that,
  // unchanged from v2) and goes back to the main menu.
  pauseOverlay.style.display = 'none';
  game = null;
  showMenu();
});


/* -----------------------------------------------------------------------------
   v2: in-memory session leaderboard. Lives for as long as the tab is open;
   intentionally not persisted (no localStorage / backend yet, per spec).
----------------------------------------------------------------------------- */
let sessionLeaderboard = [];

function recordFinalScore() {
  sessionLeaderboard.push({
    score: Math.floor(game.score),
    result: game.phase,     // 'WON' or 'LOST'
    elapsed: game.elapsed,
  });
  sessionLeaderboard.sort((a, b) => b.score - a.score);
  sessionLeaderboard.length = Math.min(sessionLeaderboard.length, CONFIG.LEADERBOARD_SIZE);
}


/* -----------------------------------------------------------------------------
   DATA LAYER: the live game state. Rebuilt from scratch by startGame().
   `game` is `null` before the first "Start Game" click (menu screen).
----------------------------------------------------------------------------- */
let game = null;

function startGame() {
  const spawnTile = {
    col: Math.floor(CONFIG.COLS / 2),
    row: Math.floor(CONFIG.ROWS / 2),
  };

  game = {
    phase: PHASE.PLAYING,
    paused: false,           // v3: Escape pause toggle
    elapsed: 0,
    igniteTimer: CONFIG.IGNITE_FIRST_DELAY,

    player: {
      x: tileCenter(spawnTile.col),
      y: tileCenter(spawnTile.row),
      facing: 'down',        // v3: for the walk-cycle sprite
      moving: false,
      walkClock: 0,
    },

    spawnTile,
    servers: placeServers(spawnTile),

    extinguish: {
      targetId: null,
      progress: 0,
    },

    // v2: running score for this session's game.
    score: 0,
  };
}


/* -----------------------------------------------------------------------------
   LOGIC LAYER: server placement.

   Rules: interior tiles only, never within MIN_SERVER_GAP tiles of another
   server, the player spawn, a desk, or a partition. Then a flood fill proves
   every server has a reachable tile next to it (desks/partitions count as
   blocked ground, same as v1's walls-only version did for servers alone).
----------------------------------------------------------------------------- */
function placeServers(spawnTile) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const servers = tryPlaceServers(spawnTile);
    if (servers && allServersReachable(servers, spawnTile)) return servers;
  }
  console.warn('Could not find a valid server layout — using the last attempt.');
  return tryPlaceServers(spawnTile) || [];
}

function tryPlaceServers(spawnTile) {
  const servers = [];

  for (let i = 0; i < CONFIG.SERVER_COUNT; i++) {
    let placed = false;

    for (let tries = 0; tries < 500 && !placed; tries++) {
      const col = 1 + Math.floor(Math.random() * (CONFIG.COLS - 2));
      const row = 1 + Math.floor(Math.random() * (CONFIG.ROWS - 2));

      if (chebyshev(col, row, spawnTile.col, spawnTile.row) < CONFIG.MIN_SERVER_GAP) continue;

      const tooCloseToServer = servers.some(
        (s) => chebyshev(col, row, s.col, s.row) < CONFIG.MIN_SERVER_GAP
      );
      if (tooCloseToServer) continue;

      // v2: also keep clear of desks and partitions.
      if (nearAnyTile(col, row, activeMap.deskFootprintTiles, CONFIG.MIN_SERVER_GAP)) continue;
      if (nearAnyTile(col, row, activeMap.partitionTiles, CONFIG.MIN_SERVER_GAP)) continue;

      servers.push(makeServer(i, col, row));
      placed = true;
    }

    if (!placed) return null;
  }

  return servers;
}

function nearAnyTile(col, row, tiles, gap) {
  return tiles.some((t) => chebyshev(col, row, t.col, t.row) < gap);
}

function makeServer(id, col, row) {
  return {
    id,
    col,
    row,
    x: tileCenter(col),
    y: tileCenter(row),
    state: STATE.OK,
    burnTimer: 0,
  };
}

// Flood fill the walkable floor from the player's spawn (servers, desks and
// partitions all block it), then confirm every server has at least one
// reachable tile next to it.
function allServersReachable(servers, spawnTile) {
  const blocked = new Set(activeMap.structuralBlockedKeys);
  for (const s of servers) blocked.add(`${s.col},${s.row}`);

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
      if (n.col < 1 || n.row < 1 || n.col > CONFIG.COLS - 2 || n.row > CONFIG.ROWS - 2) continue;
      if (blocked.has(key)) continue;
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
  // menu, frozen on the end screen, or v3: paused via Escape
  if (!game || game.phase !== PHASE.PLAYING || game.paused) return;

  game.elapsed += dt;
  game.score += CONFIG.POINTS.SURVIVE_PER_SEC * dt; // v2: trickle for staying alive

  updatePlayer(dt);
  updateIgnition(dt);
  updateFires(dt);
  updateExtinguishing(dt);
  checkEndConditions();
}

// --- Movement ---------------------------------------------------------------
// v2: collision with desks/partitions, resolved per axis so the player slides
// along an edge instead of getting stuck. Servers still don't block movement
// (that's a later version, per the roadmap).
function updatePlayer(dt) {
  const p = game.player;
  const step = CONFIG.PLAYER_SPEED * dt;
  const half = CONFIG.PLAYER_SIZE / 2;
  const minPos = CONFIG.TILE + half;
  const maxX = canvas.width - minPos;
  const maxY = canvas.height - minPos;

  let dx = 0, dy = 0;
  if (keys['ArrowLeft']) dx -= step;
  if (keys['ArrowRight']) dx += step;
  if (keys['ArrowUp']) dy -= step;
  if (keys['ArrowDown']) dy += step;

  const triedX = clamp(p.x + dx, minPos, maxX);
  if (!collidesWithObstacles(triedX, p.y, half)) p.x = triedX;

  const triedY = clamp(p.y + dy, minPos, maxY);
  if (!collidesWithObstacles(p.x, triedY, half)) p.y = triedY;

  // v3: facing + walk-cycle bookkeeping for the sprite. Vertical input wins
  // over horizontal when both are held (arbitrary but consistent choice).
  // Facing is only updated while actually moving, so the sprite keeps facing
  // its last direction once you stop instead of snapping back to "down".
  p.moving = dx !== 0 || dy !== 0;
  if (dy < 0) p.facing = 'up';
  else if (dy > 0) p.facing = 'down';
  else if (dx < 0) p.facing = 'left';
  else if (dx > 0) p.facing = 'right';

  p.walkClock = p.moving ? p.walkClock + dt : 0;
}

function collidesWithObstacles(x, y, half) {
  const left = x - half, right = x + half, top = y - half, bottom = y + half;
  return activeMap.solidObstacles.some(
    (o) => left < o.right && right > o.left && top < o.bottom && bottom > o.top
  );
}

// --- Random ignition, escalating over time ----------------------------------
function currentIgniteInterval() {
  const interval = CONFIG.IGNITE_INTERVAL_START - CONFIG.IGNITE_RAMP_PER_SEC * game.elapsed;
  return Math.max(CONFIG.IGNITE_INTERVAL_MIN, interval);
}

function updateIgnition(dt) {
  game.igniteTimer -= dt;
  if (game.igniteTimer > 0) return;

  const candidates = game.servers.filter((s) => s.state === STATE.OK);
  if (candidates.length > 0) {
    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    victim.state = STATE.BURNING;
    victim.burnTimer = 0;
  }

  game.igniteTimer = currentIgniteInterval();
}

// --- Burn-down --------------------------------------------------------------
function updateFires(dt) {
  for (const s of game.servers) {
    if (s.state !== STATE.BURNING) continue;

    s.burnTimer += dt;
    if (s.burnTimer >= CONFIG.BURN_DOWN_TIME) {
      s.state = STATE.BURNED_DOWN;
      s.burnTimer = 0;

      // v2: penalty for losing a server (never let the score go negative).
      game.score = Math.max(0, game.score - CONFIG.POINTS.BURN_PENALTY);

      if (game.extinguish.targetId === s.id) resetExtinguish();
    }
  }
}

// --- Hold-to-extinguish state machine ---------------------------------------
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
    target.state = STATE.OK;
    target.burnTimer = 0;
    game.score += CONFIG.POINTS.EXTINGUISH; // v2: reward for a successful save
    resetExtinguish();
  }
}

function resetExtinguish() {
  game.extinguish.targetId = null;
  game.extinguish.progress = 0;
}

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

function distanceToServerEdge(player, server) {
  const gapX = Math.abs(player.x - server.x) - (CONFIG.PLAYER_SIZE + CONFIG.SERVER_SIZE) / 2;
  const gapY = Math.abs(player.y - server.y) - (CONFIG.PLAYER_SIZE + CONFIG.SERVER_SIZE) / 2;
  return Math.max(0, Math.hypot(Math.max(0, gapX), Math.max(0, gapY)));
}

// --- Win / lose -------------------------------------------------------------
function checkEndConditions() {
  const burnedDown = countByState(STATE.BURNED_DOWN);
  const burning = countByState(STATE.BURNING);

  if (burnedDown >= CONFIG.MAX_BURNED_ALLOWED) {
    game.phase = PHASE.LOST;
    recordFinalScore(); // v2
    return;
  }

  if (game.elapsed >= CONFIG.SURVIVE_TIME && burning === 0) {
    game.phase = PHASE.WON;
    recordFinalScore(); // v2
  }
}

function countByState(state) {
  return game.servers.filter((s) => s.state === state).length;
}


/* -----------------------------------------------------------------------------
   CLIENT/UI LAYER: draw the state.
----------------------------------------------------------------------------- */
function draw() {
  if (!game) {
    // Menu is showing (pure DOM overlay) — just keep the canvas behind it a
    // plain brand-dark color so there's no flash of unstyled canvas.
    ctx.fillStyle = COLORS.bgDark;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  drawRoom();
  drawServers();
  drawPlayer();
  drawExtinguishBar();
  drawStatsPanel();       // v2: replaces the old plain debug text
  drawBurnScoreboard();   // v2: separate "X/3 SERVERS LOST" danger meter
  if (game.phase !== PHASE.PLAYING) drawEndScreen();
}

function drawRoom() {
  // Floor: tiled across the whole room.
  if (ASSETS.floorTile.loaded) {
    for (let c = 0; c < CONFIG.COLS; c++) {
      for (let r = 0; r < CONFIG.ROWS; r++) {
        ctx.drawImage(ASSETS.floorTile.img, c * CONFIG.TILE, r * CONFIG.TILE, CONFIG.TILE, CONFIG.TILE);
      }
    }
  } else {
    ctx.fillStyle = COLORS.bgDark;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Walls: border + partitions, drawn as individual textured tiles.
  for (const t of activeMap.wallTiles) {
    const x = t.col * CONFIG.TILE;
    const y = t.row * CONFIG.TILE;
    if (ASSETS.wallTile.loaded) {
      ctx.drawImage(ASSETS.wallTile.img, x, y, CONFIG.TILE, CONFIG.TILE);
    } else {
      ctx.fillStyle = COLORS.bgMid;
      ctx.fillRect(x, y, CONFIG.TILE, CONFIG.TILE);
    }
  }

  drawDesks();
}

function drawDesks() {
  for (const d of activeMap.deskTiles) {
    const x = d.col * CONFIG.TILE;
    const y = d.row * CONFIG.TILE;

    if (ASSETS.deskTable.loaded) {
      ctx.drawImage(ASSETS.deskTable.img, x, y, DESK_PIXEL_SIZE.w, DESK_PIXEL_SIZE.h);
    } else {
      ctx.fillStyle = COLORS.deskFallback;
      ctx.fillRect(x, y, DESK_PIXEL_SIZE.w, DESK_PIXEL_SIZE.h);
      ctx.strokeStyle = COLORS.deskFallbackBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, DESK_PIXEL_SIZE.w - 2, DESK_PIXEL_SIZE.h - 2);
    }
  }
}

// v3: where to draw a server's body — either the tall rack sprite (bottom-
// anchored near its tile so it "stands" on the floor like the desks do) or
// the old flat square, whichever asset is actually loaded. Everything else
// (target ring, countdown text, fire overlay) is positioned off this rect so
// it lines up correctly either way.
function getServerVisualRect(s) {
  if (ASSETS.serverRack.loaded) {
    const w = CONFIG.SERVER_SPRITE_W;
    const h = SERVER_SPRITE_H;
    return { left: s.x - w / 2, top: s.y - h + CONFIG.SERVER_SIZE / 2, w, h };
  }
  const w = CONFIG.SERVER_SIZE;
  const h = CONFIG.SERVER_SIZE;
  return { left: s.x - w / 2, top: s.y - h / 2, w, h };
}

function drawServers() {
  for (const s of game.servers) {
    const rect = getServerVisualRect(s);

    if (ASSETS.serverRack.loaded) {
      if (s.state === STATE.BURNED_DOWN) {
        // "Charred" look: desaturate + darken the same sprite, then a low
        // alpha dark overlay on top for extra soot.
        ctx.filter = 'grayscale(1) brightness(0.35)';
        ctx.drawImage(ASSETS.serverRack.img, rect.left, rect.top, rect.w, rect.h);
        ctx.filter = 'none';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(rect.left, rect.top, rect.w, rect.h);
      } else {
        // OK and BURNING both show the normal rack — fire is drawn on top.
        ctx.drawImage(ASSETS.serverRack.img, rect.left, rect.top, rect.w, rect.h);
      }
      if (s.state === STATE.BURNING) drawFireOverlay(s, rect);
    } else {
      // Fallback: flat colored square, same as v1/v2.
      ctx.fillStyle =
        s.state === STATE.BURNING     ? COLORS.burning :
        s.state === STATE.BURNED_DOWN ? COLORS.burnedDown :
                                        COLORS.ok;
      ctx.fillRect(rect.left, rect.top, rect.w, rect.h);
    }

    if (game.phase === PHASE.PLAYING) {
      const target = findExtinguishTarget();
      if (target && target.id === s.id) {
        ctx.strokeStyle = COLORS.targetRing;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.left - 3, rect.top - 3, rect.w + 6, rect.h + 6);
      }
    }

    if (s.state === STATE.BURNING) {
      const left = (CONFIG.BURN_DOWN_TIME - s.burnTimer).toFixed(1);
      ctx.fillStyle = COLORS.cream;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${left}s`, s.x, rect.top + rect.h + 12);
    }
  }
}

// v3: animated fire, only drawn when the rack sprite itself is present (the
// flat-square fallback above already communicates "burning" on its own via
// color, so it doesn't need a second overlay).
function drawFireOverlay(s, rect) {
  const anchorX = rect.left + rect.w / 2;
  // "Upper-middle" of the rack, per the brief — the flame's bottom edge
  // (frames are bottom-aligned) sits here so it looks like it's coming out
  // of the rack rather than floating above it.
  const anchorY = rect.top + rect.h * 0.45;
  const drawX = anchorX - FIRE_DRAW_SIZE.w / 2;
  const drawY = anchorY - FIRE_DRAW_SIZE.h;

  if (ASSETS.fireSheet.loaded) {
    const frame = Math.floor(s.burnTimer * CONFIG.FIRE_ANIM_FPS) % CONFIG.FIRE_FRAME_COUNT;
    ctx.drawImage(
      ASSETS.fireSheet.img,
      frame * CONFIG.FIRE_FRAME_W, 0, CONFIG.FIRE_FRAME_W, CONFIG.FIRE_FRAME_H,
      drawX, drawY, FIRE_DRAW_SIZE.w, FIRE_DRAW_SIZE.h
    );
  } else {
    // Simple pulsing flame blob fallback until the real sheet is added.
    const pulse = 1 + 0.15 * Math.sin(performance.now() / 120 + s.id);
    const r = (FIRE_DRAW_SIZE.w / 2) * pulse;
    ctx.fillStyle = COLORS.accentDark;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY - r * 0.6, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY - r * 0.5, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer() {
  const p = game.player;

  if (ASSETS.walkingSprite.loaded) {
    const row = CONFIG.DIRECTION_ROWS[p.facing];
    const frame = p.moving
      ? Math.floor(p.walkClock * CONFIG.WALK_ANIM_FPS) % CONFIG.PLAYER_FRAME_COUNT
      : 0; // idle pose

    const w = CONFIG.PLAYER_SPRITE_W;
    const h = PLAYER_SPRITE_H;
    // Bottom-anchored on the player's actual collision point, same idea as
    // the server rack — feet line up with where the hitbox really is.
    const drawX = p.x - w / 2;
    const drawY = p.y + CONFIG.PLAYER_SIZE / 2 - h;

    ctx.drawImage(
      ASSETS.walkingSprite.img,
      frame * PLAYER_CELL.w, row * PLAYER_CELL.h, PLAYER_CELL.w, PLAYER_CELL.h,
      drawX, drawY, w, h
    );
  } else {
    // Fallback: flat blue square, same as v1/v2.
    const size = CONFIG.PLAYER_SIZE;
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  }
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

// --- v2: stats HUD panel -----------------------------------------------------
// Replaces v1's raw debug text with stat_panel_frame.png (or a plain fallback
// panel) plus a pixel-font readout of the numbers players actually care about.
const HUD_PANEL = {
  x: 12,
  y: 12,
  w: 288 * CONFIG.HUD_PANEL_SCALE,
  h: 160 * CONFIG.HUD_PANEL_SCALE,
};

function drawStatsPanel() {
  const { x, y, w, h } = HUD_PANEL;

  if (ASSETS.statPanelFrame.loaded) {
    ctx.drawImage(ASSETS.statPanelFrame.img, x, y, w, h);
  } else {
    ctx.fillStyle = 'rgba(45, 52, 71, 0.9)'; // bgMid, translucent
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  const lines = [
    `TIME  ${game.elapsed.toFixed(0)}/${CONFIG.SURVIVE_TIME}`,
    `OK    ${countByState(STATE.OK)}`,
    `FIRE  ${countByState(STATE.BURNING)}`,
    `LOST  ${countByState(STATE.BURNED_DOWN)}`,
    `SCORE ${Math.floor(game.score)}`,
  ];

  ctx.fillStyle = COLORS.cream;
  ctx.font = `8px ${HUD_FONT}`;
  ctx.textAlign = 'left';
  lines.forEach((line, i) => ctx.fillText(line, x + 10, y + 20 + i * 16));

  // Small secondary debug line (not part of the styled panel) so the fire
  // ramp and extinguish timing are still visible while tuning CONFIG.
  ctx.fillStyle = COLORS.grey;
  ctx.font = '10px monospace';
  ctx.fillText(
    `ignite every ${currentIgniteInterval().toFixed(2)}s (next in ${Math.max(0, game.igniteTimer).toFixed(1)}s)`,
    x,
    y + h + 14
  );
}

// --- v2: burn scoreboard / danger meter --------------------------------------
// Deliberately separate from the stats panel so "how close to losing" reads
// at a glance, independent of the general numbers.
function drawBurnScoreboard() {
  const lost = countByState(STATE.BURNED_DOWN);
  const max = CONFIG.MAX_BURNED_ALLOWED;

  const w = 190, h = 44;
  const x = canvas.width - w - 12;
  const y = 12;

  // Pulse the border once we're one loss away from game over.
  const danger = lost >= max - 1;
  const pulse = danger ? 0.6 + 0.4 * Math.sin(performance.now() / 150) : 1;

  ctx.fillStyle = 'rgba(45, 52, 71, 0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.accent;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = COLORS.accent;
  ctx.font = `9px ${HUD_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${lost}/${max} SERVERS LOST`, x + 10, y + 18);

  // One small square per allowed loss: filled = lost, outline = still safe.
  const boxSize = 14, gap = 6;
  for (let i = 0; i < max; i++) {
    const bx = x + 10 + i * (boxSize + gap);
    const by = y + 26;
    if (i < lost) {
      ctx.fillStyle = COLORS.burnedDown;
      ctx.fillRect(bx, by, boxSize, boxSize);
    }
    ctx.strokeStyle = COLORS.grey;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, boxSize - 1, boxSize - 1);
  }
}

function drawEndScreen() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const won = game.phase === PHASE.WON;
  ctx.textAlign = 'center';

  ctx.fillStyle = won ? COLORS.barFill : COLORS.accent;
  ctx.font = 'bold 34px monospace';
  ctx.fillText(won ? 'REVENUE STACK SAVED' : 'REVENUE STACK DOWN', canvas.width / 2, canvas.height / 2 - 90);

  ctx.fillStyle = COLORS.cream;
  ctx.font = '14px monospace';
  ctx.fillText(
    `survived ${game.elapsed.toFixed(1)}s · ${countByState(STATE.BURNED_DOWN)} servers lost`,
    canvas.width / 2,
    canvas.height / 2 - 62
  );

  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(`FINAL SCORE: ${Math.floor(game.score)}`, canvas.width / 2, canvas.height / 2 - 32);

  // v2: session leaderboard, top 5.
  ctx.font = '13px monospace';
  ctx.fillStyle = COLORS.cream;
  ctx.fillText('TOP 5 THIS SESSION', canvas.width / 2, canvas.height / 2);

  sessionLeaderboard.forEach((entry, i) => {
    const label = entry.result === PHASE.WON ? 'WON ' : 'LOST';
    ctx.fillStyle = i === 0 ? COLORS.accent : COLORS.grey;
    ctx.fillText(
      `${i + 1}. ${entry.score} pts  ·  ${label}  ·  ${entry.elapsed.toFixed(0)}s`,
      canvas.width / 2,
      canvas.height / 2 + 22 + i * 18
    );
  });

  ctx.fillStyle = COLORS.cream;
  ctx.font = '14px monospace';
  ctx.fillText('press R to restart', canvas.width / 2, canvas.height / 2 + 22 + sessionLeaderboard.length * 18 + 22);
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

function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}


/* -----------------------------------------------------------------------------
   THE GAME LOOP: requestAnimationFrame + delta time. Runs continuously, even
   while the menu is showing (draw()/update() just no-op on `game === null`).
----------------------------------------------------------------------------- */
let lastFrameTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

// v2: no auto-start — the player begins at the main menu (see menuOverlay
// wiring above). The loop still runs so the canvas renders behind it.
showMenu(); // v3: also kicks off the background video's autoplay attempt
requestAnimationFrame(loop);
