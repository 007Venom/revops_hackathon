/* =============================================================================
   RevOps Firefighter — v9
   =============================================================================
   v1 was logic-only rectangles. v2 added textures/menu/HUD/scoring. v3 added
   sprites/video/pause-menu (v3.1 map select, v4 balance + the Shantanu boss
   event, v4.1/v4.2 cleanup + a GIF menu background, v5 sprite/audio/HUD
   polish, v6/v6 graphics+sound follow-ups, v7 progressive difficulty, v8 bug
   fixes + sizing). v9:
     - the grid is ~30% bigger (COLS 20->26, ROWS 14->18, TILE unchanged at
       40px) — this gives servers' actual rendered sprite boxes enough room
       to satisfy v8's wall-clearance and server-overlap checks on every
       map, including the two that previously failed 100% of the time and
       placed zero servers. No map's desk/partition layout needed to change.
     - the stats panel (beside the canvas) and controls panel (under it) now
       derive their pixel size — and their internal font sizes/line spacing —
       from the main canvas instead of fixed constants, so any future grid
       resize keeps them proportional automatically (see BASE_CANVAS_W/H,
       STATS_PANEL_SCALE, CONTROLS_PANEL_SCALE).

   Architecture is unchanged:
     - DATA LAYER      : CONFIG + LEVELS + the `game` state object.
     - LOGIC LAYER     : update() and its helpers.
     - CLIENT/UI LAYER : draw() + the DOM menu/pause overlays in
                         index.html/style.css, plus two more small HUD
                         canvases (stats/controls) drawn alongside the main
                         one.

   Each version's additions are labelled "v2:" / "v3:" / "v3.1:" / "v4:" /
   "v5:" / "v7:" / "v8:" / "v9:" in comments so the diff against the previous
   version is easy to follow.
============================================================================= */


/* -----------------------------------------------------------------------------
   DATA LAYER: every tunable number lives here. Change these to rebalance.
----------------------------------------------------------------------------- */
const CONFIG = {
  // --- Map geometry ---------------------------------------------------------
  // v9: grid grown ~30% (20->26 cols, 14->18 rows) so servers' actual
  // rendered sprite boxes have enough room to clear the walls and each
  // other (see SERVER_WALL_MARGIN/SERVER_MIN_PIXEL_GAP below) without
  // touching any individual map's desk/partition layout — verified by
  // simulation to place all 10 servers on every map, 100% of the time.
  TILE: 40,               // pixel size of one grid tile
  COLS: 26,               // grid width in tiles  (26 * 40 = 1040px canvas)
  ROWS: 18,               // grid height in tiles (18 * 40 = 720px canvas)

  // --- Servers --------------------------------------------------------------
  SERVER_COUNT: 10,       // how many servers are placed at game start
  SERVER_SIZE: 32,        // drawn size of a server (fits inside a 40px tile)
  MIN_SERVER_GAP: 2,      // min distance in tiles between servers/desks/
                          // partitions (Chebyshev). This is what guarantees
                          // the room stays walkable.
  // v8: server-vs-wall and server-vs-server placement now also validate the
  // server rack sprite's actual rendered bounding box (see getServerBBoxAt()
  // below), not just this tile-based gap — SERVER_WALL_MARGIN/
  // SERVER_MIN_PIXEL_GAP are the extra pixel clearance required on top of
  // that box.
  SERVER_WALL_MARGIN: 6,     // min px between a server's sprite box and any wall
  SERVER_MIN_PIXEL_GAP: 6,   // min px between any two servers' sprite boxes
  MAX_BURNED_ALLOWED: 3,  // you lose when this many servers are BURNED_DOWN

  // --- Player ---------------------------------------------------------------
  // v5: both doubled alongside PLAYER_SPRITE_W below, keeping the same
  // hitbox-to-sprite-width ratio (0.6) the smaller sprite had — movement
  // speed and the collision code itself are unchanged, only these sizes.
  PLAYER_SIZE: 48,        // was 24
  // v7: base speed before LEVELS[].speedMultiplier is applied (see LEVELS,
  // just below CONFIG).
  PLAYER_SPEED: 190,      // pixels per second

  // --- Fire timing ----------------------------------------------------------
  // v7: fireInterval/burnTime are no longer flat constants or a time-based
  // ramp — they now come from the active entry in LEVELS (below), driven by
  // score. Only the grace period before the very first fire stays fixed.
  IGNITE_FIRST_DELAY: 2.0,     // grace period before the very first fire

  // --- Extinguishing --------------------------------------------------------
  EXTINGUISH_TIME: 2.0,   // seconds of holding SPACE to put a fire out
  EXTINGUISH_RANGE: 14,   // how many pixels away from the server's edge still
                          // counts as "next to it" (0 would mean touching)

  // --- v2: desks (solid obstacles) -------------------------------------------
  // Footprint is DESK_COLS x DESK_ROWS tiles, matching the ~128x80
  // desk_table.png asset. Per-map desk/partition tile lists now live in
  // MAPS (v3.1, below) instead of being fixed here.
  DESK_COLS: 3,
  DESK_ROWS: 2,
  // v8: desk_table.png and wall_tile.png are now drawn at 60% of their old
  // on-screen size (a 40% reduction), scaled down around the center of the
  // tile(s) they occupy. Collision boxes for desks/partitions are derived
  // from these same scaled rects (see DESK_VISUAL_SIZE / WALL_VISUAL_SIZE,
  // below buildMapLayout) so hitboxes always match what's drawn.
  DESK_VISUAL_SCALE: 0.6,
  WALL_VISUAL_SCALE: 0.6,

  // --- v4: scoring (replaces the v2 formula) -----------------------------------
  // Deliberately just one rule now: no time bonus, no burn-down penalty.
  POINTS: {
    EXTINGUISH: 1,        // per server successfully put out — the only rule
  },
  LEADERBOARD_SIZE: 5,    // top N scores kept for this browser session

  // --- v2/v5: HUD sizing --------------------------------------------------------
  // v5: was 0.55 when this panel sat small in the corner of the game canvas;
  // now it's a dedicated side panel, so it's drawn much bigger (see
  // statsCanvas sizing, near where `canvas` itself is set up).
  HUD_PANEL_SCALE: 1.25,  // stat_panel_frame.png (288x160) drawn at this scale
  CONTROLS_PANEL_W: 480,  // v5: controls/how-to-play panel, same frame art
  CONTROLS_PANEL_H: 267,  // (kept at ~the frame's native 1.8:1 aspect ratio)

  // --- v3: server rack + fire sprites -----------------------------------------
  SERVER_SPRITE_W: 40,       // drawn width; server_rack.png is 540x1116 (tall)
  FIRE_FRAME_W: 164,         // fire_spritesheet.png: 1312x393, 8 frames
  FIRE_FRAME_H: 393,
  FIRE_FRAME_COUNT: 8,
  FIRE_ANIM_FPS: 9,          // within the requested 8-10fps range
  FIRE_DRAW_SCALE: 1.3,      // fire drawn slightly wider than the rack

  // --- v3/v5: player walk cycle -------------------------------------------------
  // v5: walking_sprite_v2.png replaces walking_sprite.png — a corrected sheet
  // (frames trimmed to content, bottom-aligned on a uniform grid) that fixes
  // the "jumping" bug the old uneven frame cropping caused. Cell size is now
  // 248x283 (see PLAYER_CELL below) instead of the old 236x283.25. Same
  // direction-row mapping, guessed by eye — flag any direction that looks
  // wrong and we'll swap rows. Frame index 14 (row 3, col 2) may have some
  // missing body detail from the cleanup pass — watch for it mid-animation.
  DIRECTION_ROWS: { down: 0, up: 3, left: 1, right: 2 },
  PLAYER_FRAME_COUNT: 4,
  WALK_ANIM_FPS: 8,
  PLAYER_SPRITE_W: 80,       // v5: doubled from 40 — drawn width of the character

  // --- v4/v7: Shantanu boss event -----------------------------------------------
  // v7: the score threshold that used to arm this is gone — whether he's
  // active at all is now just LEVELS[].shantanuEnabled. His own cadence once
  // armed is unchanged.
  SHANTANU_INTERVAL: 15,         // seconds (game-time; frozen while paused)
  SHANTANU_WALK_SPEED: 150,      // pixels per second
  SHANTANU_ENTRY_DEPTH_TILES: 3, // how far in from the wall he stops to talk
  SHANTANU_BUBBLE_DURATION: 2.0, // seconds the speech bubble stays up
  SHANTANU_BUBBLE_TEXT: 'I have BAD SHANTANEWS for you!',
  // v5: his drawn size now just matches the player's (see SHANTANU_SPRITE_W,
  // derived from PLAYER_SPRITE_W further down) — no longer its own constant.

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

/* -----------------------------------------------------------------------------
   v7: PROGRESSIVE DIFFICULTY. Score-driven level table, replacing the old
   flat ignition-interval / burn-down-timer / player-speed constants and the
   old hardcoded "Shantanu unlocks at score >= 10" check. Everything
   downstream (updateIgnition, updateFires, updatePlayer, updateShantanuTimer)
   just reads getCurrentLevel(game.score) — retune by editing this table.
----------------------------------------------------------------------------- */
const LEVELS = [
  { level: 1, minScore: 0,  fireInterval: 8, burnTime: 14, speedMultiplier: 1.00, shantanuEnabled: false },
  { level: 2, minScore: 10, fireInterval: 8, burnTime: 14, speedMultiplier: 1.00, shantanuEnabled: true  },
  { level: 3, minScore: 20, fireInterval: 7, burnTime: 12, speedMultiplier: 1.25, shantanuEnabled: true  },
  { level: 4, minScore: 30, fireInterval: 6,  burnTime: 10, speedMultiplier: 1.50, shantanuEnabled: true  },
  { level: 5, minScore: 40, fireInterval: 6,  burnTime: 8,  speedMultiplier: 1.75, shantanuEnabled: true  },
];

// Current level = the highest entry whose minScore is <= score. LEVELS is
// ordered ascending by minScore, so the last match wins.
function getCurrentLevel(score) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (score >= lvl.minScore) current = lvl;
  }
  return current;
}

// v7: level-up banner timing (see updateLevelBanner()/drawLevelBanner()).
const LEVEL_BANNER_DURATION = 2.0; // total seconds on screen
const LEVEL_BANNER_FADE = 0.5;     // of which this many seconds, at the end, fade out

// Server lifecycle states. OK -> BURNING -> BURNED_DOWN (permanent),
// or BURNING -> OK when the player extinguishes it in time.
const STATE = {
  OK: 'OK',
  BURNING: 'BURNING',
  BURNED_DOWN: 'BURNED_DOWN',
};

// Overall game states (menu is represented separately — see `game === null`).
// v7: no more WON — this is endless-survival now, the only way a run ends is
// LOST (MAX_BURNED_ALLOWED servers burned down).
const PHASE = {
  PLAYING: 'PLAYING',
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

// v9: both side panels now scale WITH the main canvas instead of using
// fixed pixel sizes, so resizing the grid (CONFIG.COLS/ROWS, like the 30%
// expansion above) keeps them proportional automatically — no separate
// constant to remember to update by hand next time. BASE_CANVAS_W/H is the
// canvas size everything else here (HUD_PANEL_SCALE, CONTROLS_PANEL_W/H,
// and the font sizes/line spacing inside drawSideStatsPanel()/
// drawControlsPanel()) was originally tuned at.
const BASE_CANVAS_W = 800;
const BASE_CANVAS_H = 560;
const STATS_PANEL_SCALE = canvas.height / BASE_CANVAS_H;   // sits beside the canvas -> tracks its height
const CONTROLS_PANEL_SCALE = canvas.width / BASE_CANVAS_W; // sits under the canvas -> tracks its width

// v5: stats panel (beside the canvas) and controls panel (under it) are
// their own small canvases now, instead of being drawn on top of `canvas`
// itself — see drawSideStatsPanel()/drawControlsPanel() further down.
const statsCanvas = document.getElementById('statsCanvas');
const statsCtx = statsCanvas.getContext('2d');
statsCanvas.width = Math.round(288 * CONFIG.HUD_PANEL_SCALE * STATS_PANEL_SCALE);
statsCanvas.height = Math.round(160 * CONFIG.HUD_PANEL_SCALE * STATS_PANEL_SCALE);

const controlsCanvas = document.getElementById('controlsCanvas');
const controlsCtx = controlsCanvas.getContext('2d');
controlsCanvas.width = Math.round(CONFIG.CONTROLS_PANEL_W * CONTROLS_PANEL_SCALE);
controlsCanvas.height = Math.round(CONFIG.CONTROLS_PANEL_H * CONTROLS_PANEL_SCALE);

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

  // v4
  shantanuSprite: 'assets/sprites/shantanu_sprite.png',

  // v5: walking_sprite_v2.png replaces the v3 walking_sprite.png (see the
  // CONFIG.DIRECTION_ROWS comment above for why). burnedServerRack is new —
  // a dedicated charred-rack graphic instead of a grayscale filter.
  walkingSprite: 'assets/sprites/walking_sprite_v2.png',
  burnedServerRack: 'assets/sprites/burned_server_rack.png',
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
// v9: every tile below is the original (pre-v9) layout shifted by
// (+3 cols, +2 rows) — exactly how much CONFIG.COLS/ROWS grew on each side
// (26-20=6, half=3; 18-14=4, half=2). The border wall already auto-expands
// to the new edges on its own (see buildMapLayout()), but these fixed desk/
// partition coordinates don't — without this shift every map's furniture
// would still sit where it was in the old 20x14 room, i.e. pinned to the
// new room's top-left corner with a large, uneven gap of new floor opening
// up only on the right/bottom. Shifting by the same amount the grid grew
// re-centers each map's layout with an even margin on all four sides
// instead, with zero change to spacing between desks or partitions (a pure
// translation) and zero change to their size (DESK_VISUAL_SCALE/
// WALL_VISUAL_SCALE are untouched).
const MAPS = [
  {
    id: 'open-floor',
    name: 'Open Floor',
    difficulty: 'Easy',
    tagline: 'Four corner desks and two short partition walls around a mostly open center.',
    deskTiles: [
      { col: 5, row: 4 }, { col: 18, row: 4 },
      { col: 5, row: 12 }, { col: 18, row: 12 },
    ],
    partitionTiles: [
      { col: 13, row: 5 }, { col: 13, row: 6 },
      { col: 12, row: 11 }, { col: 12, row: 12 },
    ],
  },
  {
    id: 'cubicle-rows',
    name: 'Cubicle Rows',
    difficulty: 'Medium',
    tagline: 'Two long desk rows split the floor into lanes — plan a loop instead of cutting straight across.',
    deskTiles: [
      { col: 5, row: 6 }, { col: 10, row: 6 }, { col: 15, row: 6 },
      { col: 5, row: 10 }, { col: 10, row: 10 }, { col: 15, row: 10 },
    ],
    partitionTiles: [
      { col: 19, row: 6 }, { col: 19, row: 7 },
      { col: 19, row: 10 }, { col: 19, row: 11 },
    ],
  },
  {
    id: 'server-ring',
    name: 'Server Ring',
    difficulty: 'Medium',
    tagline: 'Desks and partitions form a loose ring around the center — commit to one of four gaps to get in or out.',
    deskTiles: [
      { col: 9, row: 5 }, { col: 15, row: 5 },
      { col: 9, row: 11 }, { col: 15, row: 11 },
    ],
    // Shorter ring segments than the original design (2 tiles per side
    // instead of 4) — with the 4 corner desks already blocking ~24 tiles,
    // a full 16-tile ring left too little open floor for placeServers() to
    // reliably find a valid, fully-reachable spot for all 10 servers.
    partitionTiles: [
      { col: 8, row: 8 }, { col: 8, row: 9 },
      { col: 17, row: 8 }, { col: 17, row: 9 },
      { col: 12, row: 4 }, { col: 13, row: 4 },
      { col: 12, row: 13 }, { col: 13, row: 13 },
    ],
  },
  {
    id: 'maze-grid',
    name: 'Maze Grid',
    difficulty: 'Hard',
    tagline: 'Nine staggered desk pods with partition stubs at every gap — narrow corridors, hard choices under fire.',
    deskTiles: [
      { col: 5, row: 4 }, { col: 11, row: 4 }, { col: 17, row: 4 },
      { col: 5, row: 8 }, { col: 10, row: 8 }, { col: 17, row: 8 },
      { col: 5, row: 12 }, { col: 11, row: 12 }, { col: 17, row: 12 },
    ],
    partitionTiles: [
      { col: 8, row: 6 }, { col: 8, row: 10 },
      { col: 14, row: 6 }, { col: 14, row: 10 },
      { col: 20, row: 6 }, { col: 20, row: 10 },
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

// v8: the actual drawn (and collided-with) size of a desk/wall tile — 60% of
// the old full-footprint/full-tile size, centered within it. Centering
// (rather than anchoring at the tile's top-left) keeps every desk/wall tile
// still lined up on the same grid position, just visually smaller with an
// even gap of empty floor around it.
const DESK_VISUAL_SIZE = {
  w: DESK_PIXEL_SIZE.w * CONFIG.DESK_VISUAL_SCALE,
  h: DESK_PIXEL_SIZE.h * CONFIG.DESK_VISUAL_SCALE,
};
const DESK_VISUAL_OFFSET = {
  x: (DESK_PIXEL_SIZE.w - DESK_VISUAL_SIZE.w) / 2,
  y: (DESK_PIXEL_SIZE.h - DESK_VISUAL_SIZE.h) / 2,
};
const WALL_VISUAL_SIZE = CONFIG.TILE * CONFIG.WALL_VISUAL_SCALE;
const WALL_VISUAL_OFFSET = (CONFIG.TILE - WALL_VISUAL_SIZE) / 2;

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
  // is already handled by clamping the player's position, same as v1). v8:
  // sized to match the smaller drawn desk/wall visuals (DESK_VISUAL_SIZE /
  // WALL_VISUAL_SIZE), not the old full-tile footprint, so there's no
  // invisible oversized hitbox left over from the pre-v8 sizes.
  const solidObstacles = [
    ...map.deskTiles.map((d) => ({
      left: d.col * CONFIG.TILE + DESK_VISUAL_OFFSET.x,
      top: d.row * CONFIG.TILE + DESK_VISUAL_OFFSET.y,
      right: d.col * CONFIG.TILE + DESK_VISUAL_OFFSET.x + DESK_VISUAL_SIZE.w,
      bottom: d.row * CONFIG.TILE + DESK_VISUAL_OFFSET.y + DESK_VISUAL_SIZE.h,
    })),
    ...map.partitionTiles.map((t) => ({
      left: t.col * CONFIG.TILE + WALL_VISUAL_OFFSET,
      top: t.row * CONFIG.TILE + WALL_VISUAL_OFFSET,
      right: t.col * CONFIG.TILE + WALL_VISUAL_OFFSET + WALL_VISUAL_SIZE,
      bottom: t.row * CONFIG.TILE + WALL_VISUAL_OFFSET + WALL_VISUAL_SIZE,
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

// v5: walking_sprite_v2.png is 992x1132 in a 4x4 grid -> each source cell is
// exactly 248x283. Drawn scaled up to PLAYER_SPRITE_W wide, same aspect ratio.
const PLAYER_CELL = { w: 992 / 4, h: 1132 / 4 };
const PLAYER_SPRITE_H = Math.round(CONFIG.PLAYER_SPRITE_W * (PLAYER_CELL.h / PLAYER_CELL.w));

// shantanu_sprite.png is its own, unchanged 944x1133 sheet (236x283.25 per
// cell) — v5 only replaced the player's sheet, so this stays separate from
// PLAYER_CELL. He still shares CONFIG.DIRECTION_ROWS (same row convention),
// and per the v5 brief his drawn size is now pinned to the player's, not its
// own tunable — hence SHANTANU_SPRITE_W just mirrors PLAYER_SPRITE_W here
// rather than living in CONFIG.
const SHANTANU_CELL = { w: 944 / 4, h: 1133 / 4 };
const SHANTANU_SPRITE_W = CONFIG.PLAYER_SPRITE_W;
// Pinned to the player's exact height too (not derived from his own sheet's
// aspect ratio, which is very slightly different) — the brief calls for the
// same on-screen size for both, matching how burned_server_rack.png is also
// stretched to fit its target footprint rather than keeping its own aspect.
const SHANTANU_SPRITE_H = PLAYER_SPRITE_H;

// Which way Shantanu faces while walking straight in from / back out to each
// map edge (his in/out legs are a straight perpendicular line, so this is
// fixed per edge rather than computed from a direction vector each frame).
const EDGE_FACING_IN = { top: 'down', bottom: 'up', left: 'right', right: 'left' };
const EDGE_FACING_OUT = { top: 'up', bottom: 'down', left: 'left', right: 'right' };


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
const exitFallbackMsg = document.getElementById('exitFallbackMsg');

// v4.2: the menu background is a looping GIF now (<img>, not <video>), so
// there's no play()/pause()/muted to manage here anymore — showing/hiding
// the overlay is all that's needed; the GIF just keeps animating underneath.
function showMenu() {
  menuOverlay.style.display = 'flex';
}

function hideMenu() {
  menuOverlay.style.display = 'none';
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

/* -----------------------------------------------------------------------------
   v5: AUDIO. Two plain <audio> elements (declared in index.html, not created
   here) — a looping gameplay music track and Shantanu's one-shot alarm.
   Both are gated by the mute button, which is now real (it was a disabled
   stub through v4).
----------------------------------------------------------------------------- */
const gameplayMusicEl = document.getElementById('gameplayMusic');
const shantanuAlarmEl = document.getElementById('shantanuAlarm');
const btnMute = document.getElementById('btnMute');

let soundMuted = false;

function setMuted(muted) {
  soundMuted = muted;
  gameplayMusicEl.muted = muted;
  shantanuAlarmEl.muted = muted;
  btnMute.textContent = muted ? '🔇' : '🔊';
}

btnMute.addEventListener('click', () => setMuted(!soundMuted));

// Gameplay music: starts when a run actually begins (startGame(), further
// down), pauses whenever it isn't actively playing (win/lose or the Escape
// pause menu), resumes on Continue. .play() here is always triggered by a
// real click (Start Game / a map card / Continue), so autoplay restrictions
// don't apply — no muted-attribute workaround needed like the old menu video.
function playGameplayMusic() {
  gameplayMusicEl.play().catch(() => {
    // Ignore — e.g. the file isn't there yet.
  });
}

function pauseGameplayMusic() {
  gameplayMusicEl.pause();
}

// Shantanu's alarm: one-shot per event occurrence, played from the top each
// time in case a previous play somehow hasn't finished.
function playShantanuAlarm() {
  shantanuAlarmEl.currentTime = 0;
  shantanuAlarmEl.play().catch(() => {});
}


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

// v4.1: preview drawn with the real room sprites (floor/wall/desk tiles,
// the player's idle sprite at spawn) once they're loaded — same "PNG not
// there yet -> flat fallback shape" convention as drawRoom()/drawDesks()/
// drawPlayer(), so a card never looks broken while assets are still being
// dropped in, and it stays a true "here's what you'll see" preview instead
// of a separate mockup that can drift out of sync with the real rendering.
const MAP_PREVIEW_TILE_PX = 16;

function drawMapPreview(canvas, map) {
  const pctx = canvas.getContext('2d');
  const t = MAP_PREVIEW_TILE_PX;

  // Floor, tiled across the whole preview.
  if (ASSETS.floorTile.loaded) {
    for (let c = 0; c < CONFIG.COLS; c++) {
      for (let r = 0; r < CONFIG.ROWS; r++) {
        pctx.drawImage(ASSETS.floorTile.img, c * t, r * t, t, t);
      }
    }
  } else {
    pctx.fillStyle = COLORS.bgDark;
    pctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Border wall + partitions — same wall art, same tile list shape as the
  // real activeMap.wallTiles built in buildMapLayout().
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

  // v8: previewed at the same 60% wall scale as the real map, centered in
  // the tile, so the card matches actual gameplay.
  const wallVisual = t * CONFIG.WALL_VISUAL_SCALE;
  const wallOffset = (t - wallVisual) / 2;
  for (const w of wallTiles) {
    const wx = w.col * t + wallOffset;
    const wy = w.row * t + wallOffset;
    if (ASSETS.wallTile.loaded) {
      pctx.drawImage(ASSETS.wallTile.img, wx, wy, wallVisual, wallVisual);
    } else {
      pctx.fillStyle = COLORS.bgMid;
      pctx.fillRect(wx, wy, wallVisual, wallVisual);
    }
  }

  // Desks, stretched to their 3x2 footprint — v8: at the same 60% scale as
  // the real map, centered in that footprint.
  const deskFootprintW = CONFIG.DESK_COLS * t;
  const deskFootprintH = CONFIG.DESK_ROWS * t;
  const deskVisualW = deskFootprintW * CONFIG.DESK_VISUAL_SCALE;
  const deskVisualH = deskFootprintH * CONFIG.DESK_VISUAL_SCALE;
  const deskOffsetX = (deskFootprintW - deskVisualW) / 2;
  const deskOffsetY = (deskFootprintH - deskVisualH) / 2;
  for (const d of map.deskTiles) {
    const dx = d.col * t + deskOffsetX;
    const dy = d.row * t + deskOffsetY;
    if (ASSETS.deskTable.loaded) {
      pctx.drawImage(ASSETS.deskTable.img, dx, dy, deskVisualW, deskVisualH);
    } else {
      pctx.fillStyle = COLORS.deskFallback;
      pctx.fillRect(dx, dy, deskVisualW, deskVisualH);
    }
  }

  // Spawn marker — always the grid center, same tile startGame() uses.
  const spawnCol = Math.floor(CONFIG.COLS / 2);
  const spawnRow = Math.floor(CONFIG.ROWS / 2);
  const spawnX = (spawnCol + 0.5) * t;
  const spawnY = (spawnRow + 0.5) * t;

  if (ASSETS.walkingSprite.loaded) {
    // Idle "facing down" frame — row 0, frame 0 — same convention drawPlayer()
    // uses for an idle player (PLAYER_CELL is defined once, above, and reused
    // here rather than recomputed).
    const drawH = t * 1.6;
    const drawW = drawH * (PLAYER_CELL.w / PLAYER_CELL.h);
    pctx.drawImage(
      ASSETS.walkingSprite.img,
      0, 0, PLAYER_CELL.w, PLAYER_CELL.h,
      spawnX - drawW / 2, spawnY - drawH * 0.75,
      drawW, drawH
    );
  } else {
    pctx.fillStyle = COLORS.player;
    pctx.beginPath();
    pctx.arc(spawnX, spawnY, t * 0.35, 0, Math.PI * 2);
    pctx.fill();
  }
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
  if (paused) {
    rollTaunt();
    pauseGameplayMusic();   // v5
  } else {
    playGameplayMusic();    // v5: resume on Continue
  }
}

document.getElementById('btnContinue').addEventListener('click', () => setPaused(false));

document.getElementById('btnQuitToMenu').addEventListener('click', () => {
  // Ends the current run (no score is recorded — only WON/LOST do that,
  // unchanged from v2) and goes back to the main menu.
  pauseOverlay.style.display = 'none';
  pauseGameplayMusic(); // v5
  game = null;
  showMenu();
});


/* -----------------------------------------------------------------------------
   v2: in-memory session leaderboard. Lives for as long as the tab is open;
   intentionally not persisted (no localStorage / backend yet, per spec).
----------------------------------------------------------------------------- */
let sessionLeaderboard = [];

// v7: the leaderboard now ranks by finalScore = extinguishedCount * secondsPlayed
// (computed on game over), not the raw in-run +1-per-extinguish score.
function recordFinalScore() {
  const extinguishedCount = Math.floor(game.score);
  const secondsPlayed = Math.floor(game.elapsed);
  const finalScore = extinguishedCount * secondsPlayed;

  sessionLeaderboard.push({ finalScore, extinguishedCount, secondsPlayed });
  sessionLeaderboard.sort((a, b) => b.finalScore - a.finalScore);
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

    // v7: current difficulty level (index into LEVELS by `.level`, not
    // array index) + the level-up banner overlay. Starts at 1 with no
    // banner — the banner only fires on an actual increase (see
    // updateLevelProgress()).
    level: 1,
    levelBanner: null, // { text, timer } while a banner is showing, else null

    // v4: Shantanu boss event — see updateShantanuTimer()/updateShantanuActor().
    shantanuUnlocked: false,
    shantanuTimer: 0,
    shantanu: {
      state: 'IDLE', // IDLE -> ENTERING -> TALKING -> WALKING_TO_TARGET -> IGNITING -> LEAVING -> (back to IDLE)
      x: 0,
      y: 0,
      facing: 'down',
      moving: false,
      walkClock: 0,
      edge: null,
      entryPoint: null,
      stopPoint: null,
      targetServerId: null,
      bubbleTimer: 0,
    },
  };

  playGameplayMusic(); // v5: starts here, always triggered by a real click
}


/* -----------------------------------------------------------------------------
   LOGIC LAYER: server placement.

   Rules: interior tiles only, never within MIN_SERVER_GAP tiles (Chebyshev,
   grid-cell-based) of the player spawn, a desk, or a partition. v8: on top
   of that, a server's actual rendered sprite bounding box must also clear
   every wall by SERVER_WALL_MARGIN px (bug fix 1) and clear every other
   server's bounding box by SERVER_MIN_PIXEL_GAP px (bug fix 2) — see
   getServerBBoxAt()/serverBBoxClearsWalls()/bboxesOverlap(), below. Then a
   flood fill proves every server has a reachable tile next to it
   (desks/partitions count as blocked ground, same as v1's walls-only version
   did for servers alone).
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

      // v2: also keep clear of desks and partitions.
      if (nearAnyTile(col, row, activeMap.deskFootprintTiles, CONFIG.MIN_SERVER_GAP)) continue;
      if (nearAnyTile(col, row, activeMap.partitionTiles, CONFIG.MIN_SERVER_GAP)) continue;

      // v8 bug fix 1: the tile-based checks above only guarantee the
      // server's grid cell is clear — server_rack.png is drawn much taller
      // than one tile (see getServerBBoxAt(), below), so a tile that passes
      // the checks above can still render with the rack sprite poking into
      // the wall row above it. Validate the server's actual rendered
      // bounding box against all four walls instead of just its tile.
      const bbox = getServerBBoxAt(col, row);
      if (!serverBBoxClearsWalls(bbox)) continue;

      // v8 bug fix 2: same idea between servers — two servers in
      // "tile-adjacent-enough" cells could still have visually overlapping
      // or touching rack sprites. Compare actual bounding boxes (with a
      // small pixel buffer) instead of grid-cell distance.
      const overlapsServer = servers.some((s) =>
        bboxesOverlap(bbox, getServerBBoxAt(s.col, s.row), CONFIG.SERVER_MIN_PIXEL_GAP)
      );
      if (overlapsServer) continue;

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

// v8: a server's actual rendered bounding box if it were placed at (col,
// row) — matches getServerVisualRect()'s math exactly (tall rack sprite,
// bottom-anchored on the tile), so placement validation and drawing always
// agree on where a server's edges really are. Used for bug fixes 1 & 2.
function getServerBBoxAt(col, row) {
  const x = tileCenter(col);
  const y = tileCenter(row);
  const w = CONFIG.SERVER_SPRITE_W;
  const h = SERVER_SPRITE_H;
  return {
    left: x - w / 2,
    right: x + w / 2,
    top: y - h + CONFIG.SERVER_SIZE / 2,
    bottom: y + CONFIG.SERVER_SIZE / 2,
  };
}

// v8 bug fix 1: true only if the server's full sprite box stays inside the
// playable interior (inside the border wall ring) with CONFIG.SERVER_WALL_
// MARGIN px to spare on every side — including the top, which is where the
// tall rack sprite actually extends furthest from its anchor tile.
function serverBBoxClearsWalls(bbox) {
  const margin = CONFIG.SERVER_WALL_MARGIN;
  return (
    bbox.left >= CONFIG.TILE + margin &&
    bbox.right <= canvas.width - CONFIG.TILE - margin &&
    bbox.top >= CONFIG.TILE + margin &&
    bbox.bottom <= canvas.height - CONFIG.TILE - margin
  );
}

// v8 bug fix 2: true if two sprite boxes are within `buffer` px of touching
// or overlapping (an inflate-then-intersect test).
function bboxesOverlap(a, b, buffer) {
  return !(
    a.right + buffer <= b.left ||
    b.right + buffer <= a.left ||
    a.bottom + buffer <= b.top ||
    b.bottom + buffer <= a.top
  );
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
    // v7: set for real when the server actually ignites (see igniteServer())
    // — a server that's never caught fire doesn't need one yet.
    burnTime: 0,
  };
}

// v7: the one place a server transitions OK -> BURNING, whether from normal
// random ignition or Shantanu's IGNITING state. Locks in the *current*
// level's burnTime for this fire specifically — per the brief, a later level
// change must not retroactively shorten a fire that's already burning.
function igniteServer(server) {
  server.state = STATE.BURNING;
  server.burnTimer = 0;
  server.burnTime = getCurrentLevel(game.score).burnTime;
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

  updatePlayer(dt);
  updateIgnition(dt);
  updateFires(dt);
  updateExtinguishing(dt);
  updateLevelProgress();    // v7: after score can change, before it's used below
  updateLevelBanner(dt);    // v7
  updateShantanuTimer(dt);   // v4
  updateShantanuActor(dt);   // v4
  checkEndConditions();
}

// --- v7: progressive difficulty ----------------------------------------------
// Recomputes the active level from the current score every frame. On an
// actual increase, caps the in-flight ignition timer down to the new
// fireInterval (so a faster level applies right away instead of waiting out
// whatever was left of the old, slower countdown) and queues a one-shot
// level-up banner. Already-burning fires are untouched here — they keep the
// burnTime baked in by igniteServer() at the moment they ignited.
function updateLevelProgress() {
  const newLevel = getCurrentLevel(game.score);
  if (newLevel.level === game.level) return;

  game.level = newLevel.level;
  if (game.igniteTimer > newLevel.fireInterval) {
    game.igniteTimer = newLevel.fireInterval;
  }

  // Never banner the starting level — only real level-ups (2 and up).
  if (newLevel.level > 1) {
    game.levelBanner = { text: `LEVEL ${newLevel.level} REACHED`, timer: LEVEL_BANNER_DURATION };
  }
}

function updateLevelBanner(dt) {
  if (!game.levelBanner) return;
  game.levelBanner.timer -= dt;
  if (game.levelBanner.timer <= 0) game.levelBanner = null;
}

// --- Movement ---------------------------------------------------------------
// v2: collision with desks/partitions, resolved per axis so the player slides
// along an edge instead of getting stuck. Servers still don't block movement
// (that's a later version, per the roadmap).
function updatePlayer(dt) {
  const p = game.player;
  // v7: base speed scaled by the active level's speedMultiplier — composes
  // with CONFIG.PLAYER_SPEED rather than replacing it.
  const step = CONFIG.PLAYER_SPEED * getCurrentLevel(game.score).speedMultiplier * dt;
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

// --- Random ignition, driven by the active level ----------------------------
// v7: replaces the old time-based ramp — the interval is just whatever
// LEVELS[].fireInterval says for the current score.
function updateIgnition(dt) {
  game.igniteTimer -= dt;
  if (game.igniteTimer > 0) return;

  const candidates = game.servers.filter((s) => s.state === STATE.OK);
  if (candidates.length > 0) {
    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    igniteServer(victim);
  }

  game.igniteTimer = getCurrentLevel(game.score).fireInterval;
}

// --- Burn-down --------------------------------------------------------------
function updateFires(dt) {
  for (const s of game.servers) {
    if (s.state !== STATE.BURNING) continue;

    s.burnTimer += dt;
    if (s.burnTimer >= s.burnTime) {
      s.state = STATE.BURNED_DOWN;
      s.burnTimer = 0;

      // v4: no score penalty for a burn-down anymore — scoring is just
      // +1 per successful extinguish (see updateExtinguishing below).

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

// --- v4: Shantanu boss event --------------------------------------------------
// Small state machine, updated every frame like the fires are: a trigger
// timer (updateShantanuTimer) that arms once score >= threshold and then
// fires every SHANTANU_INTERVAL seconds, and an actor step
// (updateShantanuActor) that drives whichever state he's currently in.
// Both are called from update(), so both are naturally frozen along with
// everything else while the game is paused.

// Picks a random edge + a random point along it, and works out the
// straight-line stop point a few tiles in from that edge.
function pickShantanuSpawn() {
  const edges = ['top', 'bottom', 'left', 'right'];
  const edge = edges[Math.floor(Math.random() * edges.length)];

  // Keep the along-edge spawn point away from the corners.
  const margin = CONFIG.TILE * 1.5;
  const axisLength = (edge === 'top' || edge === 'bottom') ? canvas.width : canvas.height;
  const along = margin + Math.random() * (axisLength - margin * 2);

  const depthPx = CONFIG.SHANTANU_ENTRY_DEPTH_TILES * CONFIG.TILE;
  let entryPoint, stopPoint;

  if (edge === 'top') {
    entryPoint = { x: along, y: -SHANTANU_SPRITE_H };
    stopPoint = { x: along, y: CONFIG.TILE + depthPx };
  } else if (edge === 'bottom') {
    entryPoint = { x: along, y: canvas.height + SHANTANU_SPRITE_H };
    stopPoint = { x: along, y: canvas.height - CONFIG.TILE - depthPx };
  } else if (edge === 'left') {
    entryPoint = { x: -SHANTANU_SPRITE_W, y: along };
    stopPoint = { x: CONFIG.TILE + depthPx, y: along };
  } else {
    entryPoint = { x: canvas.width + SHANTANU_SPRITE_W, y: along };
    stopPoint = { x: canvas.width - CONFIG.TILE - depthPx, y: along };
  }

  return { edge, entryPoint, stopPoint };
}

// Arms once score crosses the threshold, then re-fires every
// SHANTANU_INTERVAL seconds for the rest of the run (no re-crossing needed).
function updateShantanuTimer(dt) {
  if (!game.shantanuUnlocked) {
    // v7: gated by the active level's shantanuEnabled flag instead of a
    // hardcoded score threshold.
    if (getCurrentLevel(game.score).shantanuEnabled) {
      // v8 bug fix 3: explicit trace logging so the 10-point unlock and the
      // timer arming that immediately follows it are both easy to confirm
      // while testing, instead of having to infer them from Shantanu's
      // first appearance 30s later.
      console.log(`[Shantanu] score threshold crossed (score=${Math.floor(game.score)}) — Shantanu enabled.`);
      game.shantanuUnlocked = true;
      game.shantanuTimer = CONFIG.SHANTANU_INTERVAL; // first event is 30s from here
      console.log(`[Shantanu] 30s recurring timer armed at elapsed=${game.elapsed.toFixed(1)}s.`);
    }
    return;
  }

  game.shantanuTimer -= dt;
  if (game.shantanuTimer > 0) return;
  game.shantanuTimer += CONFIG.SHANTANU_INTERVAL; // keeps cadence even if a tick overshoots

  // Only one Shantanu at a time — if a prior sequence is still running,
  // this tick is skipped entirely (per spec).
  if (game.shantanu.state !== 'IDLE') return;

  const okServers = game.servers.filter((s) => s.state === STATE.OK);
  if (okServers.length === 0) return; // nothing to ignite — wait for the next tick

  const spawn = pickShantanuSpawn();
  const s = game.shantanu;
  s.state = 'ENTERING';
  s.edge = spawn.edge;
  s.entryPoint = spawn.entryPoint;
  s.stopPoint = spawn.stopPoint;
  s.x = spawn.entryPoint.x;
  s.y = spawn.entryPoint.y;
  s.facing = EDGE_FACING_IN[spawn.edge];
  s.moving = true;
  s.walkClock = 0;
  s.targetServerId = null;

  playShantanuAlarm(); // v5: exactly once per occurrence, right as he appears
}

// Moves (x, y) toward (targetX, targetY) by at most maxDist, snapping
// exactly onto the target instead of overshooting past it.
function stepToward(x, y, targetX, targetY, maxDist) {
  const dx = targetX - x, dy = targetY - y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDist || dist === 0) return { x: targetX, y: targetY, arrived: true, dx, dy };
  const ratio = maxDist / dist;
  return { x: x + dx * ratio, y: y + dy * ratio, arrived: false, dx, dy };
}

// Same "vertical wins on a tie" convention as the player's own facing logic.
function facingFromDelta(dx, dy, fallback) {
  if (Math.abs(dy) > 0.01 && Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'up' : 'down';
  if (Math.abs(dx) > 0.01) return dx < 0 ? 'left' : 'right';
  return fallback;
}

function updateShantanuActor(dt) {
  const s = game.shantanu;
  if (s.state === 'IDLE') return;

  const step = CONFIG.SHANTANU_WALK_SPEED * dt;

  switch (s.state) {
    case 'ENTERING': {
      const move = stepToward(s.x, s.y, s.stopPoint.x, s.stopPoint.y, step);
      s.x = move.x;
      s.y = move.y;
      s.moving = true;
      s.walkClock += dt;
      if (move.arrived) {
        s.state = 'TALKING';
        s.moving = false;
        s.walkClock = 0;
        s.bubbleTimer = CONFIG.SHANTANU_BUBBLE_DURATION;
      }
      break;
    }

    case 'TALKING': {
      // Only his own movement freezes here — the player and every other
      // fire keep updating normally in the background (see update()).
      s.bubbleTimer -= dt;
      if (s.bubbleTimer > 0) break;

      const okServers = game.servers.filter((sv) => sv.state === STATE.OK);
      if (okServers.length === 0) {
        // Everything still OK at trigger time got extinguished/ignited by
        // something else while he was walking in/talking — bail gracefully.
        s.state = 'LEAVING';
        s.facing = EDGE_FACING_OUT[s.edge];
        s.moving = true;
        s.walkClock = 0;
        break;
      }

      const target = okServers[Math.floor(Math.random() * okServers.length)];
      s.targetServerId = target.id;
      s.state = 'WALKING_TO_TARGET';
      s.moving = true;
      s.walkClock = 0;
      break;
    }

    case 'WALKING_TO_TARGET': {
      const target = game.servers.find((sv) => sv.id === s.targetServerId);
      if (!target) { // shouldn't happen, but never get stuck if it does
        s.state = 'LEAVING';
        s.facing = EDGE_FACING_OUT[s.edge];
        break;
      }
      const move = stepToward(s.x, s.y, target.x, target.y, step);
      s.facing = facingFromDelta(move.dx, move.dy, s.facing);
      s.x = move.x;
      s.y = move.y;
      s.moving = true;
      s.walkClock += dt;
      if (move.arrived) s.state = 'IGNITING';
      break;
    }

    case 'IGNITING': {
      // One-frame state: force the target BURNING (bypassing normal random
      // ignition), then head for the exit. From here it's an ordinary fire —
      // same animation, burn-down timer and extinguishing rules as any other.
      const target = game.servers.find((sv) => sv.id === s.targetServerId);
      if (target) igniteServer(target); // v7: locks in the current level's burnTime
      s.state = 'LEAVING';
      s.facing = EDGE_FACING_OUT[s.edge];
      s.moving = true;
      s.walkClock = 0;
      break;
    }

    case 'LEAVING': {
      const move = stepToward(s.x, s.y, s.entryPoint.x, s.entryPoint.y, step);
      s.x = move.x;
      s.y = move.y;
      s.moving = true;
      s.walkClock += dt;
      if (move.arrived) {
        // DONE is folded into this transition — once he's back off-map
        // there's nothing left to do but wait for the next timer tick.
        s.state = 'IDLE';
        s.moving = false;
        s.walkClock = 0;
        s.targetServerId = null;
      }
      break;
    }
  }
}

// --- Lose --------------------------------------------------------------------
// v7: no more WON — this is endless-survival now, so the only end condition
// left is the original LOSE (MAX_BURNED_ALLOWED servers burned down).
function checkEndConditions() {
  const burnedDown = countByState(STATE.BURNED_DOWN);

  if (burnedDown >= CONFIG.MAX_BURNED_ALLOWED) {
    game.phase = PHASE.LOST;
    recordFinalScore(); // v2
    pauseGameplayMusic(); // v5
  }
}

function countByState(state) {
  return game.servers.filter((s) => s.state === state).length;
}


/* -----------------------------------------------------------------------------
   CLIENT/UI LAYER: draw the state.
----------------------------------------------------------------------------- */
function draw() {
  // v5: these two are their own side canvases now, so they're drawn every
  // frame regardless of game state — the stats panel just shows a "no run
  // yet" placeholder before Start Game, and the controls panel is static
  // reference info that's always relevant.
  drawSideStatsPanel();
  drawControlsPanel();

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
  drawShantanu();         // v4: only draws once he's actually active
  drawExtinguishBar();
  drawBurnScoreboard();   // v2: separate "X/3 SERVERS LOST" danger meter — stays
                          // on the main canvas as an in-the-moment overlay
  drawLevelBanner();      // v7: non-blocking overlay, drawn on top of everything
                          // else above but before the end screen dims the canvas
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

  // Walls: border + partitions, drawn as individual textured tiles. v8:
  // drawn at WALL_VISUAL_SIZE (60% of the tile), centered in the tile via
  // WALL_VISUAL_OFFSET, to match the shrunk collision boxes above.
  for (const t of activeMap.wallTiles) {
    const x = t.col * CONFIG.TILE + WALL_VISUAL_OFFSET;
    const y = t.row * CONFIG.TILE + WALL_VISUAL_OFFSET;
    if (ASSETS.wallTile.loaded) {
      ctx.drawImage(ASSETS.wallTile.img, x, y, WALL_VISUAL_SIZE, WALL_VISUAL_SIZE);
    } else {
      ctx.fillStyle = COLORS.bgMid;
      ctx.fillRect(x, y, WALL_VISUAL_SIZE, WALL_VISUAL_SIZE);
    }
  }

  drawDesks();
}

function drawDesks() {
  for (const d of activeMap.deskTiles) {
    // v8: drawn at DESK_VISUAL_SIZE (60% of the old footprint size),
    // centered in that footprint via DESK_VISUAL_OFFSET, to match the
    // shrunk collision box built in buildMapLayout().
    const x = d.col * CONFIG.TILE + DESK_VISUAL_OFFSET.x;
    const y = d.row * CONFIG.TILE + DESK_VISUAL_OFFSET.y;
    const w = DESK_VISUAL_SIZE.w;
    const h = DESK_VISUAL_SIZE.h;

    if (ASSETS.deskTable.loaded) {
      ctx.drawImage(ASSETS.deskTable.img, x, y, w, h);
    } else {
      ctx.fillStyle = COLORS.deskFallback;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = COLORS.deskFallbackBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
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
        // v5: dedicated charred sprite, replacing the old grayscale-filter
        // trick on the healthy rack. Stretched into the exact same rect the
        // healthy/burning rack uses, so it lines up on the same tile even
        // though the source art has a very different native aspect ratio.
        if (ASSETS.burnedServerRack.loaded) {
          ctx.drawImage(ASSETS.burnedServerRack.img, rect.left, rect.top, rect.w, rect.h);
        } else {
          // Asset not loaded yet — plain solid silhouette, same footprint.
          ctx.fillStyle = COLORS.burnedDown;
          ctx.fillRect(rect.left, rect.top, rect.w, rect.h);
        }
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
      const left = (s.burnTime - s.burnTimer).toFixed(1);
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

// v4: Shantanu himself, plus his speech bubble while TALKING. His x/y is
// used directly as the sprite's center (he has no separate ground hitbox
// the way the player does, since he never collides with anything).
function drawShantanu() {
  const s = game.shantanu;
  if (s.state === 'IDLE') return;

  const w = SHANTANU_SPRITE_W;
  const h = SHANTANU_SPRITE_H;
  const drawX = s.x - w / 2;
  const drawY = s.y - h / 2;

  if (ASSETS.shantanuSprite.loaded) {
    const row = CONFIG.DIRECTION_ROWS[s.facing];
    const frame = s.moving
      ? Math.floor(s.walkClock * CONFIG.WALK_ANIM_FPS) % CONFIG.PLAYER_FRAME_COUNT
      : 0;
    ctx.drawImage(
      ASSETS.shantanuSprite.img,
      frame * SHANTANU_CELL.w, row * SHANTANU_CELL.h, SHANTANU_CELL.w, SHANTANU_CELL.h,
      drawX, drawY, w, h
    );
  } else {
    // Fallback: a distinct colored square so he's still clearly a separate
    // "boss" entity rather than another player.
    ctx.fillStyle = '#6a2fb8';
    ctx.fillRect(drawX, drawY, w, h);
    ctx.fillStyle = COLORS.cream;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('S', s.x, s.y + 4);
  }

  if (s.state === 'TALKING') drawSpeechBubble(s.x, drawY, CONFIG.SHANTANU_BUBBLE_TEXT);
}

// Simple comic-style speech bubble: rounded rect + a small pointer triangle
// aimed at Shantanu's head. Plain canvas shapes, no extra assets needed.
function drawSpeechBubble(anchorX, anchorTopY, text) {
  ctx.font = 'bold 11px monospace';
  const paddingX = 10;
  const textWidth = ctx.measureText(text).width;
  const bubbleW = textWidth + paddingX * 2;
  const bubbleH = 26;
  const bubbleX = clamp(anchorX - bubbleW / 2, 6, canvas.width - bubbleW - 6);
  const bubbleY = anchorTopY - bubbleH - 14; // gap for the pointer

  ctx.fillStyle = COLORS.cream;
  ctx.strokeStyle = COLORS.accentDark;
  ctx.lineWidth = 2;
  roundRectPath(bubbleX, bubbleY, bubbleW, bubbleH, 8);
  ctx.fill();
  ctx.stroke();

  const pointerX = clamp(anchorX, bubbleX + 14, bubbleX + bubbleW - 14);
  ctx.beginPath();
  ctx.moveTo(pointerX - 7, bubbleY + bubbleH - 1);
  ctx.lineTo(pointerX + 7, bubbleY + bubbleH - 1);
  ctx.lineTo(pointerX, bubbleY + bubbleH + 10);
  ctx.closePath();
  ctx.fillStyle = COLORS.cream;
  ctx.fill();

  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.fillText(text, bubbleX + bubbleW / 2, bubbleY + bubbleH / 2 + 4);
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

// --- v7: level-up banner ------------------------------------------------------
// Big centered overlay on the game canvas, up for LEVEL_BANNER_DURATION
// seconds then faded out over the last LEVEL_BANNER_FADE of those — a
// non-blocking overlay, gameplay (and Shantanu, fires, etc.) keeps rendering
// underneath exactly as normal.
function drawLevelBanner() {
  const b = game.levelBanner;
  if (!b) return;

  const alpha = b.timer < LEVEL_BANNER_FADE ? Math.max(0, b.timer / LEVEL_BANNER_FADE) : 1;

  ctx.save();
  ctx.globalAlpha = alpha;

  const w = 380, h = 96;
  const x = canvas.width / 2 - w / 2;
  const y = canvas.height / 2 - h / 2;

  if (ASSETS.statPanelFrame.loaded) {
    ctx.drawImage(ASSETS.statPanelFrame.img, x, y, w, h);
  } else {
    ctx.fillStyle = 'rgba(45, 52, 71, 0.95)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.accent;
  ctx.font = `bold 22px ${HUD_FONT}`;
  ctx.fillText(b.text, canvas.width / 2, canvas.height / 2 + 8);

  ctx.restore();
}

// --- v2/v5: stats side panel --------------------------------------------------
// v2 drew this as a small box in the corner of the game canvas; v5 moves it
// to its own dedicated canvas beside the game (see statsCanvas, above), made
// bigger (HUD_PANEL_SCALE 0.55 -> 1.25) with all its content centered.
function drawSideStatsPanel() {
  const w = statsCanvas.width;
  const h = statsCanvas.height;

  if (ASSETS.statPanelFrame.loaded) {
    statsCtx.clearRect(0, 0, w, h);
    statsCtx.drawImage(ASSETS.statPanelFrame.img, 0, 0, w, h);
  } else {
    statsCtx.fillStyle = 'rgba(45, 52, 71, 0.9)'; // bgMid, translucent
    statsCtx.fillRect(0, 0, w, h);
    statsCtx.strokeStyle = COLORS.accent;
    statsCtx.lineWidth = 2;
    statsCtx.strokeRect(1, 1, w - 2, h - 2);
  }

  statsCtx.textAlign = 'center';

  // v9: font sizes + line spacing scale with the panel itself (see
  // STATS_PANEL_SCALE above) so text stays the same proportion of the frame
  // regardless of how big the frame is drawn.
  const s = STATS_PANEL_SCALE;

  if (!game) {
    // No run started yet — a friendly placeholder instead of all-zero stats.
    statsCtx.fillStyle = COLORS.grey;
    statsCtx.font = `${10 * s}px ${HUD_FONT}`;
    statsCtx.fillText('START A GAME', w / 2, h / 2 - 8 * s);
    statsCtx.fillText('TO SEE STATS', w / 2, h / 2 + 14 * s);
    return;
  }

  const lines = [
    `TIME  ${formatTime(game.elapsed)}`,      // v7: count-up stopwatch, mm:ss
    `LEVEL ${game.level}`,                    // v7
    `OK    ${countByState(STATE.OK)}`,
    `FIRE  ${countByState(STATE.BURNING)}`,
    `LOST  ${countByState(STATE.BURNED_DOWN)}`,
    `SCORE ${Math.floor(game.score)}`,
  ];

  statsCtx.fillStyle = COLORS.cream;
  statsCtx.font = `${13 * s}px ${HUD_FONT}`;
  const lineHeight = 24 * s;
  const startY = h / 2 - ((lines.length - 1) / 2) * lineHeight;
  lines.forEach((line, i) => statsCtx.fillText(line, w / 2, startY + i * lineHeight));

  // Small secondary debug line so the fire ramp/extinguish timing are still
  // visible while tuning CONFIG — now just the last line in the same panel
  // instead of floating below the old in-canvas box.
  statsCtx.fillStyle = COLORS.grey;
  statsCtx.font = `${11 * s}px monospace`;
  statsCtx.fillText(
    `ignite every ${getCurrentLevel(game.score).fireInterval.toFixed(1)}s (next in ${Math.max(0, game.igniteTimer).toFixed(1)}s)`,
    w / 2,
    startY + lines.length * lineHeight + 6 * s
  );
}

// --- v5: controls / how-to-play panel -----------------------------------------
// Static reference info, same stat_panel_frame.png HUD treatment, sitting
// under the game canvas. Content never changes, but it's cheap enough to
// just redraw every frame alongside everything else (and it means it
// upgrades from the fallback box to the real frame art automatically the
// moment stat_panel_frame.png finishes loading, with no extra plumbing).
const CONTROLS_LINES = [
  '↑↓←→  Move',
  'SPACE (hold near fire)  Extinguish',
  'ESC  Pause',
  'Lose if 3 servers burn down',
];

function drawControlsPanel() {
  const w = controlsCanvas.width;
  const h = controlsCanvas.height;

  if (ASSETS.statPanelFrame.loaded) {
    controlsCtx.clearRect(0, 0, w, h);
    controlsCtx.drawImage(ASSETS.statPanelFrame.img, 0, 0, w, h);
  } else {
    controlsCtx.fillStyle = 'rgba(45, 52, 71, 0.9)';
    controlsCtx.fillRect(0, 0, w, h);
    controlsCtx.strokeStyle = COLORS.accent;
    controlsCtx.lineWidth = 2;
    controlsCtx.strokeRect(1, 1, w - 2, h - 2);
  }

  controlsCtx.textAlign = 'center';

  // v9: same idea as drawSideStatsPanel() — font sizes + vertical positions
  // scale with the panel via CONTROLS_PANEL_SCALE, above.
  const s = CONTROLS_PANEL_SCALE;

  controlsCtx.fillStyle = COLORS.accent;
  controlsCtx.font = `${13 * s}px ${HUD_FONT}`;
  controlsCtx.fillText('HOW TO PLAY', w / 2, 34 * s);

  controlsCtx.fillStyle = COLORS.cream;
  controlsCtx.font = `${13 * s}px monospace`;
  const startY = 66 * s;
  const lineHeight = 22 * s;
  CONTROLS_LINES.forEach((line, i) => controlsCtx.fillText(line, w / 2, startY + i * lineHeight));
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

// v7: no more WON screen — endless-survival mode only ever ends in LOSE, so
// this only has one version now. The final score (extinguished × seconds
// played, per the v7 brief) replaces the raw in-run score as the headline
// number and what the leaderboard below it ranks by.
function drawEndScreen() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = 'center';

  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 34px monospace';
  ctx.fillText('REVENUE STACK DOWN', canvas.width / 2, canvas.height / 2 - 130);

  ctx.fillStyle = COLORS.cream;
  ctx.font = '14px monospace';
  ctx.fillText(
    `survived ${formatTime(game.elapsed)} · ${countByState(STATE.BURNED_DOWN)} servers lost`,
    canvas.width / 2,
    canvas.height / 2 - 104
  );

  const extinguishedCount = Math.floor(game.score);
  const secondsPlayed = Math.floor(game.elapsed);
  const finalScore = extinguishedCount * secondsPlayed;

  // The punchline of the screen — biggest, boldest text here.
  ctx.font = 'bold 30px monospace';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(`Your Score: ${finalScore}`, canvas.width / 2, canvas.height / 2 - 66);

  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = COLORS.cream;
  ctx.fillText('"You are the reasons the wizard invests into', canvas.width / 2, canvas.height / 2 - 38);
  ctx.fillText('his number one operating priority!"', canvas.width / 2, canvas.height / 2 - 20);

  // v2/v7: session leaderboard, top 5, ranked by finalScore now.
  ctx.font = '13px monospace';
  ctx.fillStyle = COLORS.cream;
  ctx.fillText('TOP 5 THIS SESSION', canvas.width / 2, canvas.height / 2 + 12);

  sessionLeaderboard.forEach((entry, i) => {
    ctx.fillStyle = i === 0 ? COLORS.accent : COLORS.grey;
    ctx.fillText(
      `${i + 1}. ${entry.finalScore} pts  ·  ${entry.extinguishedCount} saved  ·  ${formatTime(entry.secondsPlayed)}`,
      canvas.width / 2,
      canvas.height / 2 + 34 + i * 18
    );
  });

  ctx.fillStyle = COLORS.cream;
  ctx.font = '14px monospace';
  ctx.fillText('press R to restart', canvas.width / 2, canvas.height / 2 + 34 + sessionLeaderboard.length * 18 + 22);
}


/* -----------------------------------------------------------------------------
   Small maths helpers
----------------------------------------------------------------------------- */
function tileCenter(index) {
  return index * CONFIG.TILE + CONFIG.TILE / 2;
}

// v7: play-time stopwatch display, mm:ss.
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
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
showMenu();
requestAnimationFrame(loop);
