import * as Phaser from "phaser";
import { Scene, Textures } from "phaser";
import {
  EventBus, EVT_PHASE_CHANGED, EVT_HUD, EVT_MISSION_COMPLETE, EVT_GAME_OVER,
  EVT_CURRENT_SCENE_READY, EVT_SET_TOUCH, EVT_JUMP, EVT_ACTION,
  EVT_RESTART_MISSION, EVT_RESUME, EVT_GO_TO_MENU, EVT_START_MISSION, EVT_TOGGLE_MUTE,
  EVT_REPAIR_PROGRESS,
  MISSIONS, loadSave, persistSave, peekQueuedMission, takeQueuedMission,
  type GamePhase, type HudState, type MissionDef, type MissionResult,
} from "../main";

const GW = 960, GH = 540;
const JUMP_V = -420, RUN_V = 250;

interface MovingPlat {
  sp: Phaser.Physics.Arcade.Sprite;
  ox: number; oy: number;
  ax: number; ay: number;
  range: number; speed: number; phase: number;
}
interface Bridge {
  gfx: Phaser.GameObjects.Graphics;
  solid: Phaser.Physics.Arcade.Image;
  x: number; y: number; w: number;
  cycle: number; offset: number;
}
interface Drone {
  sp: Phaser.Physics.Arcade.Sprite;
  ox: number; oy: number;
  range: number; speed: number; dir: number;
  alive: boolean; hp: number; isBoss: boolean;
  laser?: Phaser.GameObjects.Rectangle; laserT: number;
}
interface CellNode {
  sp: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number; y: number;
  installed: boolean;
}
interface RepairPad {
  ring: Phaser.GameObjects.Graphics;
  x: number; y: number;
  done: boolean;
}

export class Game extends Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private movingPlats: MovingPlat[] = [];
  private bridges: Bridge[] = [];
  private drones: Drone[] = [];
  private cells: CellNode[] = [];
  private pads: RepairPad[] = [];
  private boss: Drone | null = null;
  private mission: MissionDef = MISSIONS[0];
  private phase: GamePhase = "MENU";
  private playing = false;
  private hp = 3;
  private score = 0;
  private installed = 0;
  private repaired = 0;
  private invuln = false;
  private actionHeld = false;
  private touch = { left: false, right: false };
  private bossBar!: Phaser.GameObjects.Graphics;
  private lastHud = 0;
  private coyoteUntil = 0;
  private jumpBufferUntil = 0;
  private runTime = 0;
  private pendingStart = false;
  private jumpCount = 0;
  private objectiveText = "";
  private terminalX = 0;
  private terminalGfx!: Phaser.GameObjects.Graphics;
  private bgm: Phaser.Sound.BaseSound | null = null;
  private bgmKey = "";
  private kobo!: Phaser.GameObjects.Image;
  private repairHold = 0;
  private waterGfx?: Phaser.GameObjects.Graphics;
  private pose: "idle" | "run" | "jump" = "idle";

  constructor() { super("Game"); }

  init(data: { missionId?: number } = {}) {
    const queued = peekQueuedMission();
    const id = data.missionId ?? queued ?? undefined;
    if (id) {
      this.mission = MISSIONS.find((mm) => mm.id === id) || MISSIONS[0];
      this.pendingStart = true;
    }
  }

  preload() {
    this.load.image("tobi", "assets/chars/tobi.png");
    this.load.image("kobo", "assets/chars/kobo.jpg");
    this.load.image("drone_art", "assets/chars/drone.jpg");
    this.load.image("npc_art", "assets/chars/npcs.jpg");
    this.load.image("bg_market", "assets/bg/market.png");
    this.load.image("bg_solar", "assets/bg/solar.webp");
    this.load.image("bg_water", "assets/bg/waterfront.png");
    this.load.image("icon_energy", "assets/ui/energy.png");
    this.load.image("icon_repair", "assets/ui/repair.png");
    this.load.audio("sfx_collect", "assets/audio/sfx_collect.mp3");
    this.load.audio("sfx_hit", "assets/audio/sfx_hit.mp3");
    this.load.audio("sfx_drone", "assets/audio/sfx_drone.mp3");
    this.load.audio("sfx_gameover", "assets/audio/sfx_gameover.mp3");
    this.load.audio("sfx_repair", "assets/audio/sfx_repair.mp3");
    this.load.audio("bgm_menu", "assets/audio/bgm_menu.mp3");
    this.load.audio("bgm_mission", "assets/audio/bgm_mission.mp3");
    this.load.audio("bgm_victory", "assets/audio/bgm_victory.mp3");
  }

  create() {
    // Reset all state on (re)create — scene.restart() reuses the instance
    this.movingPlats = [];
    this.bridges = [];
    this.drones = [];
    this.cells = [];
    this.pads = [];
    this.boss = null;
    this.hp = 3;
    this.score = 0;
    this.installed = 0;
    this.repaired = 0;
    this.invuln = false;
    this.actionHeld = false;
    this.touch = { left: false, right: false };
    this.playing = false;
    this.jumpCount = 0;
    this.coyoteUntil = 0;
    this.jumpBufferUntil = 0;
    this.runTime = 0;
    this.lastHud = 0;
    this.objectiveText = "";
    this.terminalX = 0;
    this.repairHold = 0;
    this.pose = "idle";
    this.waterGfx = undefined;

    this.sound.mute = loadSave().soundMuted;
    EventBus.emit("mute-state", this.sound.mute);

    this.createTextures();
    this.createAnims();

    this.physics.world.setBounds(0, 0, this.mission.worldW, GH);
    this.cameras.main.setBounds(0, 0, this.mission.worldW, GH);
    this.createBackdrop();

    this.platforms = this.physics.add.staticGroup();
    this.buildGround();
    this.buildLevel();
    this.buildTerminal();
    this.updateObjective();

    const heroKey = this.textures.exists("tobi") ? "tobi" : "hero";
    this.player = this.physics.add.sprite(80, GH - 140, heroKey);
    this.player.setDepth(5);
    this.fitSprite(this.player, 70);
    const pb = this.player.body as Phaser.Physics.Arcade.Body;
    pb.setSize(this.player.width * 0.42, this.player.height * 0.78);
    this.player.setCollideWorldBounds(true);

    this.kobo = this.add.image(40, GH - 180, this.textures.exists("kobo") ? "kobo" : "drone");
    this.kobo.setDepth(6);
    this.fitImage(this.kobo, 42);

    this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(50);

    const kb = this.input.keyboard;
    if (!kb) {
      throw new Error("Keyboard plugin is not enabled");
    }
    kb.addCapture("SPACE,UP,DOWN,LEFT,RIGHT");
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys("A,D,W,S,SPACE,E,F,R,K,P,ESC") as { [k: string]: Phaser.Input.Keyboard.Key };

    this.physics.add.collider(this.player, this.platforms);
    for (const mp of this.movingPlats) this.physics.add.collider(this.player, mp.sp);
    for (const br of this.bridges) this.physics.add.collider(this.player, br.solid);

    this.physics.add.overlap(this.player, this.drones.map((d) => d.sp) as Phaser.Physics.Arcade.Sprite[], (_p, e) => this.hitDrone(e as Phaser.Physics.Arcade.Sprite), undefined, this);

    this.input.keyboard!.on("keydown-SPACE", () => this.queueJump());
    this.input.keyboard!.on("keydown-W", () => this.queueJump());
    this.input.keyboard!.on("keydown-UP", () => this.queueJump());
    this.input.keyboard!.on("keydown-P", () => this.togglePause());
    this.input.keyboard!.on("keydown-ESC", () => this.togglePause());
    this.input.once("pointerdown", () => this.sound.unlock());

    EventBus.on(EVT_SET_TOUCH, this.onTouch);
    EventBus.on(EVT_JUMP, this.onTouchJump);
    EventBus.on(EVT_ACTION, this.onTouchAction);
    EventBus.on(EVT_RESTART_MISSION, this.onRestart);
    EventBus.on(EVT_RESUME, this.onResume);
    EventBus.on(EVT_GO_TO_MENU, this.onMenu);
    EventBus.on(EVT_PHASE_CHANGED, this.onReactPhase);
    EventBus.on(EVT_START_MISSION, this.onStartMission);
    EventBus.on(EVT_TOGGLE_MUTE, this.onToggleMute);
    this.events.once("shutdown", () => {
      EventBus.off(EVT_SET_TOUCH, this.onTouch);
      EventBus.off(EVT_JUMP, this.onTouchJump);
      EventBus.off(EVT_ACTION, this.onTouchAction);
      EventBus.off(EVT_RESTART_MISSION, this.onRestart);
      EventBus.off(EVT_RESUME, this.onResume);
      EventBus.off(EVT_GO_TO_MENU, this.onMenu);
      EventBus.off(EVT_PHASE_CHANGED, this.onReactPhase);
      EventBus.off(EVT_START_MISSION, this.onStartMission);
      EventBus.off(EVT_TOGGLE_MUTE, this.onToggleMute);
      this.input.keyboard?.removeAllListeners();
    });

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(120, 80);

    EventBus.emit(EVT_CURRENT_SCENE_READY, this);
    this.pushHud(true);
    const shouldPlay = this.pendingStart || peekQueuedMission() !== null;
    if (shouldPlay) {
      this.pendingStart = false;
      takeQueuedMission();
      this.setPhase("PLAYING");
    } else {
      this.physics.pause();
      this.playBgm("bgm_menu");
    }
  }

  private fitSprite(sp: Phaser.Physics.Arcade.Sprite, targetH: number) {
    if (!sp.height) return;
    sp.setScale(targetH / sp.height);
  }

  private fitImage(img: Phaser.GameObjects.Image, targetH: number) {
    if (!img.height) return;
    img.setScale(targetH / img.height);
  }

  // ---------- texture helpers ----------
  private createTextures() {
    const mk = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    mk("tile_solar", 64, 24, (g) => {
      g.fillStyle(0x2a2f45).fillRect(0, 0, 64, 24);
      g.fillStyle(0x3d4463).fillRect(0, 0, 64, 6);
      g.fillStyle(0xffb347).fillRect(4, 8, 8, 3);
      g.fillStyle(0x4fffc9).fillRect(52, 14, 8, 3);
      g.lineStyle(1, 0x1a1e2e, 1).strokeRect(0, 0, 64, 24);
    });
    mk("tile_ground", 64, 40, (g) => {
      g.fillStyle(0x241f3a).fillRect(0, 0, 64, 40);
      g.fillStyle(0x4a3f6b).fillRect(0, 0, 64, 8);
      g.fillStyle(0xffb347).fillRect(0, 0, 64, 3);
      g.fillStyle(0x1a1630).fillRect(8, 16, 12, 8);
      g.fillStyle(0x1a1630).fillRect(40, 26, 14, 8);
    });
    mk("plat_moving", 96, 16, (g) => {
      g.fillStyle(0x123a4a).fillRoundedRect(0, 0, 96, 16, 6);
      g.fillStyle(0x4fffc9).fillRoundedRect(2, 2, 92, 5, 3);
      g.fillStyle(0x0a1e28).fillRect(12, 10, 8, 4);
      g.fillStyle(0x0a1e28).fillRect(76, 10, 8, 4);
    });
    mk("pad_glow", 56, 56, (g) => {
      g.fillStyle(0xffb347, 0.25).fillCircle(28, 28, 26);
      g.lineStyle(3, 0xffd54f, 1).strokeCircle(28, 28, 20);
    });
    mk("spark", 8, 8, (g) => {
      g.fillStyle(0xffd54f, 1).fillCircle(4, 4, 4);
      g.fillStyle(0xffffff, 0.9).fillCircle(4, 4, 2);
    });
    // Procedural hero spritesheet (32x48 per frame, 22 frames). The hero.png
    // asset is a 1x1 placeholder, so we build a real canvas spritesheet. Each
    // cell is registered via Texture.add(...) so its sourceSize / cut rect are
    // fully initialized — otherwise setSizeToFrame() reads frame.sourceSize on
    // an uninitialized frame and throws "Cannot read properties of null
    // (reading 'sourceSize')". createAnims() additionally only emits frames
    // that exist on the texture, so no animation can ever resolve a null frame.
    {
      if (this.textures.exists("hero")) this.textures.remove("hero");
      const fw = 32, fh = 48, count = 22;
      const cv = document.createElement("canvas");
      cv.width = fw * count; cv.height = fh;
      const ctx = cv.getContext("2d")!;
      for (let i = 0; i < count; i++) {
        const ox = i * fw;
        ctx.fillStyle = "#2d1b69";
        ctx.fillRect(ox + 10, 12, 12, 20);
        ctx.fillStyle = "#8b5e3c";
        ctx.fillRect(ox + 11, 2, 10, 10);
        ctx.fillStyle = "#4fffc9";
        ctx.fillRect(ox + 12, 5, 8, 4);
        ctx.fillStyle = "#1a1040";
        if (i < 4) {
          const legOff = [0, 3, 0, -3][i];
          ctx.fillRect(ox + 11 + legOff, 32, 4, 14);
          ctx.fillRect(ox + 17 - legOff, 32, 4, 14);
        } else if (i === 20) {
          ctx.fillRect(ox + 11, 32, 4, 10);
          ctx.fillRect(ox + 17, 32, 4, 10);
        } else if (i === 21) {
          ctx.fillRect(ox + 9, 32, 4, 14);
          ctx.fillRect(ox + 19, 32, 4, 14);
        } else {
          ctx.fillRect(ox + 12, 32, 4, 14);
          ctx.fillRect(ox + 16, 32, 4, 14);
        }
        ctx.fillStyle = "#3d2b80";
        ctx.fillRect(ox + 7, 14, 3, 10);
        ctx.fillRect(ox + 22, 14, 3, 10);
        ctx.fillStyle = "#ffb347";
        ctx.fillRect(ox + 13, 14, 6, 2);
      }
      const tex = this.textures.addCanvas("hero", cv);
      // addCanvas registers a __BASE frame; we add per-cell frames via
      // Texture.add (the Phaser 4 public API) so each has full metadata.
      if (tex) for (let i = 0; i < count; i++) tex.add(i, 0, i * fw, 0, fw, fh);
    }
    // Procedural drone spritesheet (32x32, 2 frames) — same clean Frame registration.
    {
      if (this.textures.exists("drone")) this.textures.remove("drone");
      const fw = 32, fh = 32, count = 2;
      const cv = document.createElement("canvas");
      cv.width = fw * count; cv.height = fh;
      const ctx = cv.getContext("2d")!;
      for (let i = 0; i < count; i++) {
        const ox = i * fw;
        ctx.fillStyle = "#3a3a5c";
        ctx.beginPath();
        ctx.ellipse(ox + 16, 16, 12, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff2d55";
        ctx.beginPath();
        ctx.arc(ox + 16, 14, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8888aa";
        const wingY = i === 0 ? 6 : 8;
        ctx.fillRect(ox + 2, wingY, 10, 3);
        ctx.fillRect(ox + 20, wingY, 10, 3);
      }
      const tex = this.textures.addCanvas("drone", cv);
      if (tex) for (let i = 0; i < count; i++) tex.add(i, 0, i * fw, 0, fw, fh);
    }
    // Procedural cell image
    mk("cell", 24, 24, (g) => {
      g.fillStyle(0x4fffc9, 0.9).fillCircle(12, 12, 10);
      g.fillStyle(0xffffff, 0.8).fillCircle(12, 12, 5);
      g.lineStyle(2, 0xffd54f, 1).strokeCircle(12, 12, 11);
    });
  }

  private createAnims() {
    // Only emit frames that are guaranteed to exist on the texture, so the
    // animation system can never resolve a null frame (which would crash
    // setSizeToFrame() on frame.sourceSize).
    const framesOf = (key: string, indices: number[]) =>
      indices
        .filter((i) => this.textures.exists(key) && this.textures.get(key).has(String(i)))
        .map((i) => ({ key, frame: i }));

    if (!this.anims.exists("hero_run")) {
      const frames = framesOf("hero", [0, 1, 2, 3]);
      if (frames.length) this.anims.create({ key: "hero_run", frames, frameRate: 10, repeat: -1 });
    }
    if (!this.anims.exists("hero_idle")) {
      const frames = framesOf("hero", [12]);
      if (frames.length) this.anims.create({ key: "hero_idle", frames, frameRate: 1, repeat: -1 });
    }
    if (!this.anims.exists("drone_fly")) {
      const frames = framesOf("drone", [0, 1]);
      if (frames.length) this.anims.create({ key: "drone_fly", frames, frameRate: 6, repeat: -1 });
    }
  }

  private createBackdrop() {
    const m = this.mission;
    const bg = this.add.graphics().setScrollFactor(0).setDepth(-10);
    bg.fillGradientStyle(parseInt(m.skyTop.slice(1), 16), parseInt(m.skyTop.slice(1), 16), parseInt(m.skyBottom.slice(1), 16), parseInt(m.skyBottom.slice(1), 16), 1);
    bg.fillRect(0, 0, GW, GH);

    // stars
    const stars = this.add.graphics().setScrollFactor(0.05).setDepth(-9);
    stars.fillStyle(0xffffff, 0.8);
    for (let i = 0; i < 90; i++) {
      const x = Phaser.Math.Between(0, m.worldW);
      const y = Phaser.Math.Between(10, 220);
      stars.fillPoint(x, y, Phaser.Math.Between(1, 2));
    }

    // far skyline (organic silhouette polygons, 3 parallax layers)
    const accent = parseInt(m.accent.slice(1), 16);
    this.layer(this.add.graphics().setScrollFactor(0.15).setDepth(-8), 0x141228, m.worldW, 300, 60, accent, 0.15);
    this.layer(this.add.graphics().setScrollFactor(0.35).setDepth(-7), 0x1d1a35, m.worldW, 350, 90, accent, 0.25);
    this.layer(this.add.graphics().setScrollFactor(0.6).setDepth(-6), 0x262045, m.worldW, 400, 70, accent, 0.35);

    const bgKey = m.id === 2 ? "bg_solar" : m.id === 3 ? "bg_water" : "bg_market";
    if (this.textures.exists(bgKey)) {
      const art = this.add.tileSprite(0, 0, m.worldW, GH, bgKey).setOrigin(0, 0).setScrollFactor(0.22).setDepth(-5).setAlpha(0.55);
      art.setTileScale(GH / Math.max(1, this.textures.get(bgKey).getSourceImage().height));
    }
    if (m.id === 3) {
      this.waterGfx = this.add.graphics().setDepth(2);
    }
    if (m.id === 1 && this.textures.exists("npc_art")) {
      for (let i = 0; i < 3; i++) {
        const npc = this.add.image(420 + i * 380, GH - 88, "npc_art").setDepth(3);
        this.fitImage(npc, 58);
      }
    }
  }

  private layer(g: Phaser.GameObjects.Graphics, color: number, w: number, baseY: number, amp: number, accent: number, alpha: number) {
    g.fillStyle(color, 1);
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(0, GH)];
    for (let x = 0; x <= w; x += 120) {
      const h = baseY - (Math.sin(x * 0.004) * 0.5 + 0.5) * amp - Math.abs(Math.sin(x * 0.013)) * amp * 0.6;
      pts.push(new Phaser.Math.Vector2(x, h));
    }
    pts.push(new Phaser.Math.Vector2(w, GH));
    g.fillPoints(pts, true);
    // lit windows
    g.fillStyle(accent, alpha);
    for (let x = 40; x < w; x += 160) {
      const idx = Math.floor(x / 120);
      const top = baseY - (Math.sin(x * 0.004) * 0.5 + 0.5) * amp - Math.abs(Math.sin(x * 0.013)) * amp * 0.6;
      for (let y = top + 14; y < GH - 60; y += 22) {
        if ((idx + y) % 3 === 0) g.fillRect(x, y, 5, 8);
      }
    }
  }

  // ---------- level build ----------
  private buildGround() {
    const m = this.mission;
    let x = 0;
    while (x < m.worldW) {
      const gap = x > 400 && Math.random() < 0.18 ? Phaser.Math.Between(110, 190) : 0;
      if (gap === 0) {
        const run = Phaser.Math.Between(3, 7);
        for (let i = 0; i < run; i++) this.addGroundTile(x + i * 64, GH - 40);
        x += run * 64;
      } else {
        x += gap;
      }
    }
    // guarantee start + end pads
    for (let i = 0; i < 5; i++) this.addGroundTile(i * 64, GH - 40);
    for (let i = 0; i < 6; i++) this.addGroundTile(m.worldW - (i + 1) * 64, GH - 40);
  }

  private addGroundTile(x: number, y: number) {
    const t = this.platforms.create(x + 32, y + 20, "tile_ground") as Phaser.Physics.Arcade.Image;
    t.setDisplaySize(64, 40);
    (t as unknown as { refreshBody: () => void }).refreshBody();
    (t.body as Phaser.Physics.Arcade.StaticBody).setSize(64, 40, false);
  }

  private addPlatform(x: number, y: number, w: number) {
    const count = Math.max(1, Math.round(w / 64));
    const p = this.platforms.create(x + (count * 64) / 2, y + 12, "tile_solar") as Phaser.Physics.Arcade.Image;
    p.setDisplaySize(count * 64, 24);
    (p as unknown as { refreshBody: () => void }).refreshBody();
    (p.body as Phaser.Physics.Arcade.StaticBody).setSize(count * 64, 24, false);
    return p;
  }

  private buildLevel() {
    const m = this.mission;
    const usable = m.worldW - 600;

    // floating platforms reachable from ground: H = v^2/(2g) ~ 88px, place at <= 0.75H steps
    for (let i = 0; i < 10; i++) {
      const px = 500 + (usable / 10) * i + Phaser.Math.Between(-40, 40);
      const py = GH - 130 - Phaser.Math.Between(0, 60);
      this.addPlatform(px, py, Phaser.Math.Between(2, 4) * 64);
    }

    // moving platforms
    for (let i = 0; i < m.movingPlatforms; i++) {
      const px = 900 + (usable / Math.max(1, m.movingPlatforms)) * i;
      const py = GH - 190 - Phaser.Math.Between(0, 40);
      const vertical = i % 2 === 1;
      const sp = this.physics.add.sprite(px, py, "plat_moving");
      sp.setImmovable(true).setDepth(3).body!.setSize(96, 16);
      (sp.body as Phaser.Physics.Arcade.Body).allowGravity = false;
      this.movingPlats.push({ sp, ox: px, oy: py, ax: vertical ? 0 : 1, ay: vertical ? 1 : 0, range: vertical ? 70 : 120, speed: 55 + i * 8, phase: i * 1.4 });
    }

    // light bridges (solid hidden until phase reveals)
    for (let i = 0; i < m.bridges; i++) {
      const bx = 1200 + (usable / Math.max(1, m.bridges)) * i;
      const by = GH - 170;
      const bw = 220;
      const gfx = this.add.graphics().setDepth(3);
      gfx.fillStyle(0x4fffc9, 0.55).fillRect(bx, by - 6, bw, 12);
      gfx.fillStyle(0xffffff, 0.7).fillRect(bx, by - 2, bw, 3);
      const solid = this.platforms.create(bx + bw / 2, by, "tile_solar") as Phaser.Physics.Arcade.Image;
      solid.setVisible(false);
      solid.setDisplaySize(bw, 12);
      (solid as unknown as { refreshBody: () => void }).refreshBody();
      (solid.body as Phaser.Physics.Arcade.StaticBody).setSize(bw, 12, false);
      this.bridges.push({ gfx, solid, x: bx, y: by, w: bw, cycle: 3200, offset: i * 1100 });
    }

    // collectible cells (energy cells / solar cores / network chips)
    for (let i = 0; i < m.cells; i++) {
      const cx = 700 + (usable / m.cells) * i + Phaser.Math.Between(-30, 30);
      const cy = GH - 200 - Phaser.Math.Between(0, 90);
      const cellKey = this.textures.exists("icon_energy") ? "icon_energy" : "cell";
      const sp = this.add.image(cx, cy, cellKey).setDepth(4);
      if (sp.height > 36) sp.setScale(36 / sp.height);
      const label = this.add.text(cx, cy - 30, m.cellLabel.toUpperCase(), { fontSize: "10px", color: "#ffd54f", fontFamily: "monospace" }).setOrigin(0.5).setDepth(4).setAlpha(0);
      this.tweens.add({ targets: sp, y: cy - 8, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      this.cells.push({ sp, label, x: cx, y: cy, installed: false });
    }

    // repair pads / stations
    for (let i = 0; i < m.repairs; i++) {
      const px = 850 + (usable / m.repairs) * i + Phaser.Math.Between(-60, 60);
      const py = GH - 62;
      const ring = this.add.graphics().setDepth(4);
      this.pads.push({ ring, x: px, y: py, done: false });
    }

    // drones
    for (let i = 0; i < m.drones; i++) {
      const dx = 1000 + (usable / m.drones) * i;
      const dy = GH - 150 - Phaser.Math.Between(0, 120);
      this.spawnDrone(dx, dy, 1.4, 60 + i * 10, 1, false);
    }
    if (m.boss) {
      this.boss = this.spawnDrone(m.worldW - 320, GH - 200, 1.6, 70, 6, true);
    }
  }

  // ---------- terminal ----------
  private buildTerminal() {
    const m = this.mission;
    this.terminalX = m.worldW - 220;
    this.terminalGfx = this.add.graphics().setDepth(4);
    this.drawTerminal();
  }
  private drawTerminal() {
    const g = this.terminalGfx;
    g.clear();
    const x = this.terminalX, y = GH - 64;
    g.fillStyle(0x12182e, 1).fillRoundedRect(x - 18, y - 56, 36, 56, 6);
    g.fillStyle(0x4fffc9, 0.9).fillRect(x - 12, y - 50, 24, 18);
    g.fillStyle(0xffd54f, 1).fillRect(x - 12, y - 28, 24, 4);
    g.lineStyle(2, 0x4dd0e1, 1).strokeRoundedRect(x - 18, y - 56, 36, 56, 6);
  }

  private spawnDrone(x: number, y: number, range: number, speed: number, hp: number, isBoss: boolean): Drone {
    const key = this.textures.exists("drone_art") ? "drone_art" : "drone";
    const sp = this.physics.add.sprite(x, y, key);
    if (this.anims.exists("drone_fly") && key === "drone") sp.play("drone_fly");
    (sp.body as Phaser.Physics.Arcade.Body).allowGravity = false;
    this.fitSprite(sp, isBoss ? 92 : 48);
    const db = sp.body as Phaser.Physics.Arcade.Body;
    db.setSize(sp.width * 0.55, sp.height * 0.5);
    sp.setDepth(4);
    let laser: Phaser.GameObjects.Rectangle | undefined;
    if (isBoss) laser = this.add.rectangle(x, y + 14, 300, 6, 0xff2d55, 0.85).setOrigin(0, 0.5).setDepth(4).setVisible(false);
    const d: Drone = {
      sp,
      ox: x,
      oy: y, range: range * 100, speed, dir: 1, alive: true, hp, isBoss, laser, laserT: 0 };
    this.drones.push(d);
    return d;
  }

  // ---------- EventBus handlers ----------
  private onTouch = (side: "left" | "right", down: boolean) => { this.touch[side] = down; };
  private onTouchJump = (down: boolean) => { if (down) this.queueJump(); };
  private onTouchAction = (down: boolean) => {
    if (down && !this.actionHeld) { this.actionHeld = true; this.doAction(); }
    if (!down) this.actionHeld = false;
  };
  private onStartMission = (id: number) => this.startMission(id);
  private onRestart = () => this.startMission(this.mission.id);
  private onResume = () => { if (this.phase === "PAUSED") this.setPhase("PLAYING"); };
  private onMenu = () => this.setPhase("MENU");
  private onToggleMute = () => {
    this.sound.mute = !this.sound.mute;
    const save = loadSave();
    save.soundMuted = this.sound.mute;
    persistSave(save);
    EventBus.emit("mute-state", this.sound.mute);
  };
  private onReactPhase = (p: GamePhase) => {
    if (p === "PAUSED") {
      this.phase = "PAUSED";
      this.playing = false;
      if (this.input.keyboard) this.input.keyboard.enabled = false;
      this.physics.pause();
      this.tweens.pauseAll();
    }
  };

  private togglePause() {
    if (this.playing) this.setPhase("PAUSED");
    else if (this.phase === "PAUSED") this.setPhase("PLAYING");
  }

  /** Called by React when a mission starts (via scene ref). */
  public startMission(id: number) {
    this.mission = MISSIONS.find((mm) => mm.id === id) || MISSIONS[0];
    this.pendingStart = true;
    this.time.delayedCall(0, () => this.scene.restart({ missionId: id }));
  }

  public setPhase(p: GamePhase) {
    this.phase = p;
    if (p === "PLAYING") {
      this.playing = true;
      if (this.input.keyboard) this.input.keyboard.enabled = true;
      this.physics.resume();
      this.tweens.resumeAll();
      this.sound.resumeAll();
      this.playBgm("bgm_mission");
    } else if (p === "PAUSED") {
      this.playing = false;
      this.physics.pause();
      this.tweens.pauseAll();
      this.sound.pauseAll();
    } else if (p === "MENU") {
      this.playing = false;
      this.physics.pause();
      this.tweens.resumeAll();
      this.sound.resumeAll();
      this.playBgm("bgm_menu");
    } else if (p === "MISSION_COMPLETE" || p === "VICTORY_CINEMATIC") {
      this.playing = false;
      this.playBgm("bgm_victory");
    } else if (p === "GAME_OVER") {
      this.playing = false;
      this.stopBgm();
    }
    EventBus.emit(EVT_PHASE_CHANGED, p);
  }

  // ---------- input helpers ----------
  private queueJump() {
    this.jumpBufferUntil = this.time.now + 120;
  }

  private grounded(): boolean {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    return body.blocked.down || body.touching.down || this.time.now < this.coyoteUntil;
  }

  private updateObjective() {
    const m = this.mission;
    const cellsLeft = Math.max(0, this.cells.length - this.installed);
    const padsLeft = Math.max(0, this.pads.length - this.repaired);
    const bossLeft = m.boss && this.boss !== null && this.boss.alive;
    if (cellsLeft > 0) {
      this.objectiveText = `Collect ${m.cellLabel}: ${this.installed}/${this.cells.length}`;
    } else if (padsLeft > 0) {
      this.objectiveText = `Repair ${m.repairLabel}: ${this.repaired}/${this.pads.length} — hold [E]`;
    } else if (bossLeft) {
      this.objectiveText = "Defeat the Elite Drone — stomp its core!";
    } else {
      this.objectiveText = "Reach the Terminal and hold [E] to reboot!";
    }
  }

  private doAction() {
    if (!this.playing) return;
    this.tickInteract(16);
  }

  private holdingAction(): boolean {
    return this.actionHeld || !!this.keys?.E?.isDown || !!this.keys?.F?.isDown || !!this.keys?.K?.isDown;
  }

  private collectNearbyCells() {
    const px = this.player.x, py = this.player.y;
    for (const c of this.cells) {
      if (c.installed) continue;
      if (Phaser.Math.Distance.Between(px, py, c.x, c.y) < 48) {
        c.installed = true;
        this.installed++;
        this.score += 100;
        this.safePlay("sfx_collect");
        this.tweens.add({ targets: c.sp, alpha: 0, y: c.y - 40, duration: 500, onComplete: () => c.sp.setVisible(false) });
        c.label.setText("ONLINE").setColor("#4fffc9").setAlpha(1).setY(c.y - 34);
        this.pushHud(true);
        this.checkWin();
      }
    }
  }

  private completeNearestPad() {
    const px = this.player.x, py = this.player.y;
    for (const pad of this.pads) {
      if (!pad.done && Math.abs(px - pad.x) < 50 && py > pad.y - 70) {
        pad.done = true;
        this.repaired++;
        this.score += 80;
        this.safePlay("sfx_repair");
        this.pushHud(true);
        this.checkWin();
        return;
      }
    }
  }

  private completeTerminal() {
    this.score += this.mission.score + this.mission.impact;
    this.playing = false;
    this.safePlay("sfx_repair");
    EventBus.emit(EVT_MISSION_COMPLETE, {
      mission: this.mission.id,
      score: this.score,
      impact: this.mission.impact,
      nextUnlocked: this.mission.id < MISSIONS.length,
    } as MissionResult);
    this.setPhase(this.mission.id >= MISSIONS.length ? "VICTORY_CINEMATIC" : "MISSION_COMPLETE");
  }

  private tickInteract(delta: number) {
    if (!this.playing) return;
    this.collectNearbyCells();
    if (!this.holdingAction()) {
      this.repairHold = 0;
      EventBus.emit(EVT_REPAIR_PROGRESS, 0);
      return;
    }
    const px = this.player.x, py = this.player.y;
    let kind: "pad" | "terminal" | null = null;
    for (const pad of this.pads) {
      if (!pad.done && Math.abs(px - pad.x) < 50 && py > pad.y - 70) kind = "pad";
    }
    const cellsLeft = this.cells.some((c) => !c.installed);
    const padsLeft = this.pads.some((p) => !p.done);
    const bossLeft = this.mission.boss && this.boss !== null && this.boss.alive;
    if (!cellsLeft && !padsLeft && !bossLeft && this.terminalX > 0) {
      if (Phaser.Math.Distance.Between(px, py, this.terminalX, GH - 90) < 90) kind = "terminal";
    }
    if (!kind) {
      this.repairHold = 0;
      EventBus.emit(EVT_REPAIR_PROGRESS, 0);
      return;
    }
    const need = kind === "terminal" ? 1100 : 850;
    this.repairHold += delta;
    EventBus.emit(EVT_REPAIR_PROGRESS, Math.min(1, this.repairHold / need));
    if (this.repairHold >= need) {
      this.repairHold = 0;
      EventBus.emit(EVT_REPAIR_PROGRESS, 0);
      if (kind === "pad") this.completeNearestPad();
      else this.completeTerminal();
    }
  }

  private burst(x: number, y: number) {
    this.safePlay("sfx_explosion");
    const em = this.add.particles(x, y, "spark", { speed: { min: 60, max: 220 }, lifespan: 500, scale: { start: 1, end: 0 }, quantity: 22, emitting: false });
    em.explode(22);
    this.time.delayedCall(700, () => em.destroy());
  }

  private safePlay(key: string, opt?: Phaser.Types.Sound.SoundConfig) {
    if (this.cache.audio.exists(key)) this.sound.play(key, { volume: 0.6, ...opt });
  }

  /** Phase-aware BGM: chill on menu, action during missions. Loops; no restart if already playing. */
  private playBgm(key: string) {
    if (!this.cache.audio.exists(key)) return;
    if (this.bgmKey === key && this.bgm && this.bgm.isPlaying) return;
    this.stopBgm();
    this.bgmKey = key;
    this.bgm = this.sound.add(key, { loop: true, volume: key === "bgm_action" ? 0.3 : 0.25 });
    this.bgm.play();
  }

  private stopBgm() {
    if (this.bgm) { this.bgm.stop(); this.bgm = null; }
    this.bgmKey = "";
  }

  private damage() {
    if (this.invuln || !this.playing) return;
    this.hp--;
    this.invuln = true;
    this.safePlay("sfx_hit");
    this.cameras.main.shake(140, 0.008);
    this.cameras.main.flash(120, 120, 0, 0);
    this.tweens.add({ targets: this.player, alpha: 0.3, duration: 140, yoyo: true, repeat: 5, onComplete: () => this.player.setAlpha(1) });
    this.pushHud(true);
    if (this.hp <= 0) {
      this.playing = false;
      this.safePlay("sfx_gameover");
      EventBus.emit(EVT_GAME_OVER, { mission: this.mission.id, score: this.score, time: Math.round(this.runTime / 1000), reason: "down", impact: this.mission.impact, nextUnlocked: false } as MissionResult);
      this.setPhase("GAME_OVER");
    }
  }

  private checkWin() {
    this.updateObjective();
    this.pushHud(true);
  }

  private pushHud(force = false) {
    const now = this.time.now;
    if (!force && now - this.lastHud < 200) return;
    this.lastHud = now;
    const hud: HudState = {
      mission: this.mission.id,
      hp: this.hp,
      score: this.score,
      cells: this.installed,
      cellsTotal: this.cells.length,
      repairs: this.repaired,
      repairsTotal: this.pads.length,
      bossHp: this.boss ? Math.max(0, this.boss.hp) / 6 : 0,
      bossHpMax: 1,
      objective: this.objectiveText || this.mission.desc,
      impact: this.mission.impact,
    };
    EventBus.emit(EVT_HUD, hud);
  }

  // ---------- main loop ----------
  update(time: number, delta: number) {
    if (!this.player || !this.player.body) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const dt = delta / 1000;

    if (!this.playing) {
      if (this.phase === "GAME_OVER" || this.phase === "MISSION_COMPLETE" || this.phase === "VICTORY_CINEMATIC") {
        body.setVelocity(0, body.velocity.y);
      }
      return;
    }

    this.runTime += delta;

    const left = this.cursors.left.isDown || this.keys.A.isDown || this.touch.left;
    const right = this.cursors.right.isDown || this.keys.D.isDown || this.touch.right;

    if (left && !right) {
      body.setVelocityX(-RUN_V);
      this.player.setFlipX(true);
      if (this.grounded()) this.player.play("hero_run", true);
    } else if (right && !left) {
      body.setVelocityX(RUN_V);
      this.player.setFlipX(false);
      if (this.grounded()) this.player.play("hero_run", true);
    } else {
      body.setVelocityX(body.velocity.x * 0.8);
      if (this.grounded()) { this.player.anims.stop(); this.player.setFrame(12); }
    }

    // coyote time bookkeeping + jump counter reset on landing
    if (body.blocked.down || body.touching.down) {
      this.coyoteUntil = time + 100;
      this.jumpCount = 0;
    }

    // buffered + coyote jump, with double jump in mid-air
    if (time < this.jumpBufferUntil) {
      if (this.grounded()) {
        body.setVelocityY(JUMP_V);
        this.jumpBufferUntil = 0;
        this.coyoteUntil = 0;
        this.jumpCount = 1;
        this.safePlay("sfx_jump");
        this.player.anims.stop();
        this.player.setFrame(20);
      } else if (this.jumpCount === 1) {
        body.setVelocityY(JUMP_V * 0.9);
        this.jumpBufferUntil = 0;
        this.jumpCount = 2;
        this.safePlay("sfx_jump", { rate: 1.35 });
        this.player.anims.stop();
        this.player.setFrame(20);
        if (this.textures.exists("spark")) {
          const puff = this.add.image(this.player.x, this.player.y + 20, "spark").setAlpha(0.7).setDepth(4).setScale(0.5);
          this.tweens.add({ targets: puff, alpha: 0, scale: 1.2, y: puff.y + 14, duration: 260, onComplete: () => puff.destroy() });
        }
      }
    }
    // variable jump height
    if (body.velocity.y < -120 && !(this.keys.SPACE.isDown || this.keys.W.isDown || this.cursors.up.isDown)) {
      body.setVelocityY(body.velocity.y * 0.55);
    }

    if (!this.grounded() && body.velocity.y > 0) this.player.setFrame(21);

    // fell into a pit (world bounds prevent falling below GH, so detect
    // the player resting below the ground surface at GH-40)
    if (this.player.y > GH - 18 && body.blocked.down) {
      this.player.x = 120; this.player.y = GH - 160;
      body.setVelocity(0, 0);
      this.damage();
    }

    // moving platforms
    for (const mp of this.movingPlats) {
      mp.sp.x = mp.ox + Math.sin(time / 1000 * (mp.speed / 60) + mp.phase) * mp.range * mp.ax;
      mp.sp.y = mp.oy + Math.sin(time / 1000 * (mp.speed / 60) + mp.phase) * mp.range * mp.ay;
    }

    // bridges cycle
    for (const br of this.bridges) {
      const t = (time + br.offset) % br.cycle;
      const on = t < br.cycle * 0.6;
      br.gfx.setVisible(on);
      br.solid.setVisible(on);
      (br.solid.body as Phaser.Physics.Arcade.StaticBody).enable = on;
    }

    // repair pad visuals
    for (const pad of this.pads) {
      pad.ring.clear();
      const pulse = Math.sin(time / 250) * 6;
      pad.ring.lineStyle(3, pad.done ? 0x4fffc9 : 0xffb347, pad.done ? 0.5 : 0.9);
      pad.ring.strokeCircle(pad.x, pad.y, 22 + pulse);
      if (!pad.done && Math.abs(this.player.x - pad.x) < 50 && this.player.y > pad.y - 70) {
        pad.ring.fillStyle(0xffd54f, 0.35);
        pad.ring.fillCircle(pad.x, pad.y, 18);
      }
    }

    // cell proximity labels
    for (const c of this.cells) {
      if (c.installed) continue;
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y) < 70;
      c.label.setAlpha(near ? 1 : 0);
    }

    // terminal proximity hint
    if (this.terminalGfx) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.terminalX, GH - 90) < 90;
      this.terminalGfx.setAlpha(near ? 1 : 0.65);
    }

    // drones
    for (const d of this.drones) {
      if (!d.alive) continue;
      const db = d.sp.body as Phaser.Physics.Arcade.Body;
      if (this.boss === d) {
        const dir = Math.sign(this.player.x - d.sp.x) || 1;
        db.setVelocityX(dir * 70);
        d.sp.y = d.oy - 40 + Math.sin(time / 500) * 24;
        d.laserT += delta;
        if (d.laserT > 2600) {
          d.laserT = 0;
          const laser = d.laser!;
          laser.setVisible(true);
          laser.x = d.sp.x; laser.y = d.sp.y + 14;
          const toward = this.player.x < d.sp.x ? -1 : 1;
          laser.setOrigin(toward > 0 ? 0 : 1, 0.5);
          this.tweens.add({ targets: laser, width: 420, alpha: { from: 0.9, to: 0 }, duration: 700, onComplete: () => { laser.setVisible(false).width = 0; laser.setOrigin(0, 0.5); } });
          this.time.delayedCall(250, () => {
            if (!this.playing || !this.boss) return;
            if (Math.abs(this.player.y - (this.boss.sp.y + 14)) < 30 &&
              Math.sign(this.player.x - this.boss.sp.x) === toward &&
              Math.abs(this.player.x - this.boss.sp.x) < 420) this.damage();
          });
        }
        this.drawBossBar();
      } else {
        d.sp.x += d.dir * d.speed * dt;
        if (d.sp.x > d.ox + d.range) d.dir = -1;
        if (d.sp.x < d.ox - d.range) d.dir = 1;
        d.sp.y = d.oy - 30 + Math.sin(time / 380 + d.ox) * 14;
        d.sp.setFlipX(d.dir < 0);
        db.setVelocity(0, 0);
      }
    }
  }

  private drawBossBar() {
    this.bossBar.clear();
    if (!this.boss || !this.boss.alive) return;
    const w = 300, h = 12, x = (GW - w) / 2, y = 20;
    this.bossBar.fillStyle(0x1a1e2e, 0.9).fillRoundedRect(x - 3, y - 3, w + 6, h + 6, 6);
    this.bossBar.fillStyle(0xff2d55, 1).fillRoundedRect(x, y, w * Math.max(0, this.boss.hp / 6), h, 5);
  }

  private hitDrone(enemy: Phaser.Physics.Arcade.Sprite) {
    const d = this.drones.find((dd) => dd.sp === enemy);
    if (!d || !d.alive) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const stomping = body.velocity.y > 60 && this.player.y < enemy.y - 8;
    if (stomping) {
      // Stomp damages any drone (including boss) and bounces the player
      d.hp--;
      this.safePlay("sfx_hit");
      this.cameras.main.shake(80, 0.004);
      d.sp.setTint(0xff6666);
      this.time.delayedCall(120, () => { if (d.sp.active) d.sp.clearTint(); });
      body.setVelocityY(JUMP_V * 0.6); // bounce up
      if (d.hp <= 0) {
        d.alive = false;
        this.score += d.isBoss ? 500 : 120;
        this.burst(d.sp.x, d.sp.y);
        if (d.isBoss) d.laser?.setVisible(false);
        this.tweens.add({ targets: d.sp, alpha: 0, scale: d.sp.scale * 1.6, angle: 180, duration: 420, onComplete: () => d.sp.destroy() });
        this.pushHud(true);
        this.checkWin();
      }
      return;
    }
    this.damage();
  }
}