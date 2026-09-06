import * as Phaser from 'phaser';
import {
    AUTO,
    Events,
    Game as PhaserGame,
    Scale,
    Scene,
    Physics,
    Types,
} from 'phaser';

// ---------------------------------------------------------------------------
// GAME CONSTANTS
// ---------------------------------------------------------------------------
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const WORLD_W = 3200;
export const WORLD_H = 540;
export const GRAVITY_Y = 850;
export const RUN_SPEED = 240;
export const JUMP_VY = -440;
export const DOUBLE_JUMP_VY = -380;

export const COLORS = {
    TEAL: 0x00e5ff,
    DEEP_TEAL: 0x0097a7,
    ORANGE: 0xff6d00,
    RED_ORANGE: 0xff3d00,
    GOLD: 0xffd600,
    AMBER: 0xffc107,
    NIGHT: 0x0d1117,
    VIOLET: 0x1a237e,
    BLUE: 0x283593,
    GREEN: 0x00e676,
    DARK_GREEN: 0x1b5e20,
    TERRA: 0xe65100,
    PINK: 0xc2185b,
    CLOTH: 0xffab00,
} as const;

// ---------------------------------------------------------------------------
// EVENT BUS
// ---------------------------------------------------------------------------
export const EventBus = new Events.EventEmitter();

// ---------------------------------------------------------------------------
// EVENT NAMES
// ---------------------------------------------------------------------------
export const EV_PHASE = 'phase-changed';
export const EV_SCENE_READY = 'current-scene-ready';
export const EV_HUD = 'hud-updated';
export const EV_DIALOGUE = 'companion-dialogue';
export const EV_START_MISSION = 'start-mission';
export const EV_TOGGLE_PAUSE = 'toggle-pause';
export const EV_RESTART = 'restart-mission';
export const EV_TRIGGER_REPAIR = 'trigger-repair';
export const EV_TOGGLE_AUDIO = 'toggle-audio';

// ---------------------------------------------------------------------------
// HUD STATE SHAPE
// ---------------------------------------------------------------------------
export interface HudState {
    hp: number;
    maxHp: number;
    energyCells: number;
    totalEnergyCells: number;
    repairParts: number;
    totalRepairParts: number;
    score: number;
    canRepair: boolean;
    repairProgress: number;
    terminalFixed: boolean;
}

// ---------------------------------------------------------------------------
// AUDIO SYNTH (Web Audio API)
// ---------------------------------------------------------------------------
class AfroSynth {
    private ctx: AudioContext | null = null;
    private musicGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private musicTimer: ReturnType<typeof setInterval> | null = null;
    muted = false;

    ensure() {
        if (this.ctx) return;
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx: AudioContext = new AC();
        this.ctx = ctx;
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = this.muted ? 0 : 0.16;
        this.musicGain.connect(ctx.destination);
        this.sfxGain = ctx.createGain();
        this.sfxGain.gain.value = this.muted ? 0 : 0.28;
        this.sfxGain.connect(ctx.destination);
    }

    resume() {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(m: boolean) {
        this.muted = m;
        if (this.musicGain) this.musicGain.gain.value = m ? 0 : 0.16;
        if (this.sfxGain) this.sfxGain.gain.value = m ? 0 : 0.28;
    }

    private tone(
        freq: number,
        dur: number,
        type: OscillatorType,
        gain: number,
        dest: GainNode | null,
        slideTo?: number,
    ) {
        if (!this.ctx || !dest) return;
        const t0 = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(dest);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
    }

    playJump() {
        this.ensure();
        this.tone(320, 0.18, 'square', 0.5, this.sfxGain, 720);
    }

    playDoubleJump() {
        this.ensure();
        this.tone(500, 0.22, 'sawtooth', 0.4, this.sfxGain, 1100);
    }

    playCollect() {
        this.ensure();
        this.tone(880, 0.1, 'triangle', 0.6, this.sfxGain);
        this.tone(1320, 0.16, 'triangle', 0.5, this.sfxGain);
    }

    playPart() {
        this.ensure();
        this.tone(220, 0.08, 'square', 0.5, this.sfxGain);
        this.tone(440, 0.14, 'square', 0.4, this.sfxGain);
    }

    playHit() {
        this.ensure();
        this.tone(160, 0.28, 'sawtooth', 0.7, this.sfxGain, 60);
    }

    playButton() {
        this.ensure();
        this.tone(660, 0.06, 'triangle', 0.5, this.sfxGain);
    }

    playRepairTick() {
        this.ensure();
        this.tone(240, 0.05, 'square', 0.3, this.sfxGain);
    }

    playWin() {
        this.ensure();
        const notes = [523, 659, 784, 1046];
        notes.forEach((f, i) => {
            setTimeout(() => this.tone(f, 0.35, 'triangle', 0.6, this.sfxGain), i * 140);
        });
    }

    playGameOver() {
        this.ensure();
        const notes = [440, 349, 262, 196];
        notes.forEach((f, i) => {
            setTimeout(() => this.tone(f, 0.4, 'sawtooth', 0.5, this.sfxGain), i * 180);
        });
    }

    startMusic() {
        this.ensure();
        if (!this.ctx || this.musicTimer) return;
        const scale = [130.81, 164.81, 196.0, 246.94, 261.63, 329.63];
        let step = 0;
        const tick = () => {
            if (!this.ctx || this.muted) return;
            const i = step % 8;
            // Polyrhythmic shaker (high hat-ish noise burst via square blip)
            this.tone(2200 + (i % 2) * 600, 0.04, 'square', 0.08, this.musicGain);
            // Log-drum bassline
            if (i === 0 || i === 3 || i === 6) {
                const bass = scale[(step >> 3) % scale.length] / 2;
                this.tone(bass, 0.22, 'triangle', 0.55, this.musicGain);
            }
            // Synth arpeggio
            const arp = scale[(step * 3) % scale.length] * 2;
            this.tone(arp, 0.12, 'sawtooth', 0.12, this.musicGain);
            step++;
        };
        this.musicTimer = setInterval(tick, 140);
    }

    stopMusic() {
        if (this.musicTimer) {
            clearInterval(this.musicTimer);
            this.musicTimer = null;
        }
    }
}

export const synth = new AfroSynth();

// ---------------------------------------------------------------------------
// PROCEDURAL TEXTURE GENERATION
// ---------------------------------------------------------------------------
function genTextures(scene: Scene) {
    const g = scene.add.graphics();
    const tex = scene.textures;

    const finish = (key: string, w: number, h: number) => {
        g.generateTexture(key, w, h);
        g.clear();
    };

    // --- Tobi frames (64x72) — Afrofuturistic Lagos inventor ---
    // Teal-and-orange jacket, energy wrench device, sneakers. frame: 0 idle,1/2/3 run,4 jump,5 repair
    const drawTobi = (frame: number) => {
        const cx = 32;
        const crouch = frame === 5 ? 4 : 0;
        // --- legs (indigo tech trousers) ---
        g.fillStyle(0x1a237e, 1);
        if (frame === 1) {
            g.fillRect(cx - 11, 48 + crouch, 8, 16); g.fillRect(cx + 4, 51 + crouch, 8, 13);
        } else if (frame === 2) {
            g.fillRect(cx - 9, 51 + crouch, 8, 13); g.fillRect(cx + 2, 48 + crouch, 8, 16);
        } else if (frame === 3) {
            g.fillRect(cx - 13, 49 + crouch, 9, 15); g.fillRect(cx + 5, 49 + crouch, 9, 15);
        } else if (frame === 4) {
            g.fillRect(cx - 10, 48, 9, 11); g.fillRect(cx + 2, 48, 9, 11);
        } else {
            g.fillRect(cx - 8, 49 + crouch, 7, 15); g.fillRect(cx + 2, 49 + crouch, 7, 15);
        }
        // sneakers with glowing teal soles
        g.fillStyle(0xf5f5f5, 1);
        if (frame === 4) { g.fillRect(cx - 11, 56, 11, 4); g.fillRect(cx + 1, 56, 11, 4); }
        else { g.fillRect(cx - 9, 62 + crouch, 9, 4); g.fillRect(cx + 1, 62 + crouch, 9, 4); }
        g.fillStyle(COLORS.TEAL, 1);
        if (frame === 4) { g.fillRect(cx - 11, 59, 11, 2); g.fillRect(cx + 1, 59, 11, 2); }
        else { g.fillRect(cx - 9, 65 + crouch, 9, 2); g.fillRect(cx + 1, 65 + crouch, 9, 2); }
        // --- torso: teal-and-orange tech jacket ---
        const ty = 28 + crouch;
        g.fillStyle(COLORS.DEEP_TEAL, 1);
        g.fillRoundedRect(cx - 13, ty, 26, 21, 4);
        // bold orange jacket panels (shoulders + sides)
        g.fillStyle(COLORS.ORANGE, 1);
        g.fillRect(cx - 13, ty, 26, 5);
        g.fillRect(cx - 13, ty + 5, 5, 14);
        g.fillRect(cx + 8, ty + 5, 5, 14);
        // Ankara gold sash accent
        g.fillStyle(COLORS.GOLD, 1);
        g.fillTriangle(cx - 8, ty + 5, cx - 2, ty + 5, cx - 8, ty + 13);
        // glowing teal energy band across chest
        g.fillStyle(COLORS.TEAL, 1);
        g.fillRect(cx - 13, ty + 10, 26, 3);
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(cx, ty + 11, 2.4);
        // --- front arm: orange sleeve + glowing energy wrench device ---
        g.fillStyle(COLORS.ORANGE, 1);
        if (frame === 5) {
            g.fillRect(cx + 9, ty + 3, 12, 6);
            g.fillStyle(0x9e9e9e, 1); g.fillRect(cx + 19, ty + 1, 3, 9);
            g.fillStyle(COLORS.TEAL, 1); g.fillRect(cx + 17, ty, 7, 3);
            g.fillStyle(0xffffff, 0.9); g.fillCircle(cx + 20.5, ty + 5, 1.6);
        } else {
            g.fillRect(cx + 9, ty + 3, 10, 6);
            g.fillStyle(0x9e9e9e, 1); g.fillRect(cx + 15, ty + 2, 3, 8);
            g.fillStyle(COLORS.TEAL, 1); g.fillRect(cx + 13, ty + 1, 7, 2.5);
        }
        // --- back arm ---
        g.fillStyle(0x00796b, 1);
        g.fillRect(cx - 17, ty + 3, 7, 6);
        // --- tool belt ---
        g.fillStyle(0x4e342e, 1); g.fillRect(cx - 13, ty + 18, 26, 3);
        g.fillStyle(COLORS.AMBER, 1); g.fillRect(cx - 6, ty + 17, 3, 5); g.fillRect(cx + 4, ty + 17, 3, 5);
        // --- head ---
        const hy = 17 + crouch;
        g.fillStyle(0x8d5524, 1);
        g.fillCircle(cx, hy, 10);
        g.fillStyle(0x1a1a1a, 1);
        g.fillCircle(cx - 5, hy - 6, 5); g.fillCircle(cx + 5, hy - 6, 5); g.fillCircle(cx, hy - 9, 5);
        g.fillCircle(cx - 9, hy - 2, 3.5); g.fillCircle(cx + 9, hy - 2, 3.5);
        g.fillStyle(COLORS.TEAL, 0.9);
        g.fillRoundedRect(cx - 9, hy - 2, 18, 4, 2);
        g.fillStyle(0xffffff, 1); g.fillCircle(cx + 4, hy + 1, 2.6);
        g.fillStyle(0x000000, 1); g.fillCircle(cx + 5, hy + 1, 1.3);
        g.lineStyle(1.4, 0x4e342e, 1);
        g.beginPath(); g.arc(cx + 2, hy + 5, 3.5, 0.15 * Math.PI, 0.85 * Math.PI); g.strokePath();
        if (frame === 4) {
            g.fillStyle(COLORS.GOLD, 0.9);
            g.fillTriangle(cx - 6, 68, cx + 6, 68, cx, 78);
            g.fillStyle(COLORS.ORANGE, 0.8);
            g.fillTriangle(cx - 3, 68, cx + 3, 68, cx, 74);
        }
        if (frame === 5) {
            g.fillStyle(0xffffff, 1);
            g.fillCircle(cx + 26, ty + 3, 2); g.fillCircle(cx + 23, ty + 8, 1.5);
        }
    };
    const tobiFrames = ['tobi_0', 'tobi_1', 'tobi_2', 'tobi_3', 'tobi_jump', 'tobi_repair'];
    const tobiDraw = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < tobiFrames.length; i++) {
        drawTobi(tobiDraw[i]);
        finish(tobiFrames[i], 64, 72);
    }

    // --- Kobo companion orb (40x40) — floating holographic drone ---
    // outer glow halo
    g.fillStyle(COLORS.TEAL, 0.25); g.fillCircle(20, 20, 19);
    // solar wings (translucent amber panels)
    g.fillStyle(COLORS.GOLD, 0.85);
    g.fillTriangle(20, 20, 2, 8, 6, 20);
    g.fillTriangle(20, 20, 38, 8, 34, 20);
    g.lineStyle(1, COLORS.AMBER, 1);
    g.beginPath(); g.moveTo(6, 12); g.lineTo(16, 18); g.strokePath();
    g.beginPath(); g.moveTo(34, 12); g.lineTo(24, 18); g.strokePath();
    // metallic orb body
    g.fillStyle(0xb0bec5, 1); g.fillCircle(20, 20, 13);
    g.fillStyle(0x78909c, 1); g.fillCircle(20, 20, 10);
    // holographic eye display panel
    g.fillStyle(0x062a33, 1); g.fillRoundedRect(11, 15, 18, 10, 4);
    g.fillStyle(COLORS.TEAL, 1); g.fillRoundedRect(12, 16, 16, 8, 3);
    // big friendly holographic eye
    g.fillStyle(0xffffff, 1); g.fillCircle(20, 20, 4);
    g.fillStyle(0x05303a, 1); g.fillCircle(21, 20, 2);
    g.fillStyle(0xffffff, 1); g.fillCircle(22, 18.5, 0.9);
    // antenna with glowing tip
    g.lineStyle(2, 0x90a4ae, 1);
    g.beginPath(); g.moveTo(20, 7); g.lineTo(20, 2); g.strokePath();
    g.fillStyle(COLORS.GREEN, 1); g.fillCircle(20, 2, 2.4);
    // thruster glow beneath
    g.fillStyle(COLORS.GREEN, 0.7); g.fillTriangle(15, 33, 25, 33, 20, 39);
    finish('kobo', 40, 40);

    // --- Rogue Maintenance Drone (44x44) — metallic chassis, red scanner eye ---
    // anti-grav rotor pods
    g.fillStyle(0x263238, 1);
    g.fillRoundedRect(1, 6, 14, 7, 3);
    g.fillRoundedRect(29, 6, 14, 7, 3);
    g.fillStyle(COLORS.RED_ORANGE, 1);
    g.fillCircle(8, 9, 3); g.fillCircle(36, 9, 3);
    // rotor blur bars
    g.fillStyle(0x90a4ae, 0.5);
    g.fillRect(0, 4, 16, 2); g.fillRect(28, 4, 16, 2);
    // metallic chassis (angled armor plates)
    g.fillStyle(0x37474f, 1);
    g.fillRoundedRect(6, 14, 32, 18, 5);
    g.fillStyle(0x546e7a, 1);
    g.fillRoundedRect(9, 16, 26, 8, 3);
    g.fillStyle(0x263238, 1);
    g.fillRect(6, 24, 32, 3);
    // pulsating menace red scanner eye
    g.fillStyle(0x7f0000, 1); g.fillCircle(22, 21, 7);
    g.fillStyle(0xff1744, 1); g.fillCircle(22, 21, 5);
    g.fillStyle(0xff8a80, 1); g.fillCircle(22, 21, 2.4);
    g.fillStyle(0xffffff, 1); g.fillCircle(23.5, 19.5, 1);
    // warning ring
    g.lineStyle(2, COLORS.GOLD, 1); g.strokeCircle(22, 21, 9);
    // spark prongs / grabber claws
    g.fillStyle(COLORS.AMBER, 1);
    g.fillRect(12, 32, 4, 8); g.fillRect(28, 32, 4, 8);
    g.fillStyle(0x90a4ae, 1);
    g.fillRect(13, 39, 2, 4); g.fillRect(29, 39, 2, 4);
    finish('drone', 44, 44);

    // --- Solar Energy Cell (28x28) ---
    g.fillStyle(COLORS.GOLD, 1);
    g.fillRoundedRect(4, 2, 20, 24, 5);
    g.fillStyle(COLORS.AMBER, 1);
    g.fillRoundedRect(7, 5, 14, 18, 4);
    g.fillStyle(COLORS.TEAL, 1);
    g.fillRect(12, 7, 4, 14);
    g.fillRect(9, 12, 10, 4);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(9, 6, 3, 3);
    finish('cell', 28, 28);

    // --- Repair Component (24x24) ---
    g.fillStyle(0x00695c, 1);
    g.fillRoundedRect(3, 3, 18, 18, 3);
    g.fillStyle(0xbcaaa4, 1);
    for (let i = 0; i < 4; i++) {
        g.fillRect(5 + i * 4, 1, 2, 3);
        g.fillRect(5 + i * 4, 20, 2, 3);
    }
    g.fillStyle(COLORS.GREEN, 1);
    g.fillCircle(12, 12, 4);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(12, 12, 1.5);
    finish('part', 24, 24);

    // --- Damaged Terminal (64x80) ---
    g.fillStyle(0x263238, 1);
    g.fillRoundedRect(4, 8, 56, 72, 6);
    g.fillStyle(0x37474f, 1);
    g.fillRect(8, 14, 48, 30);
    g.fillStyle(0x455a64, 1);
    g.fillRect(12, 18, 40, 22);
    // offline red screen
    g.fillStyle(0xb71c1c, 1);
    g.fillRoundedRect(14, 20, 36, 18, 3);
    g.lineStyle(2, 0x000000, 1);
    g.beginPath();
    g.moveTo(26, 24); g.lineTo(38, 34);
    g.moveTo(38, 24); g.lineTo(26, 34);
    g.strokePath();
    // sparking cables
    g.lineStyle(2, COLORS.AMBER, 1);
    g.beginPath();
    g.moveTo(10, 52); g.lineTo(18, 60); g.lineTo(12, 68);
    g.strokePath();
    g.fillStyle(0x546e7a, 1);
    g.fillRect(10, 50, 44, 6);
    finish('terminal_off', 64, 80);

    // --- Repaired Terminal (64x80) ---
    g.fillStyle(0x263238, 1);
    g.fillRoundedRect(4, 8, 56, 72, 6);
    g.fillStyle(0x37474f, 1);
    g.fillRect(8, 14, 48, 30);
    g.fillStyle(COLORS.GREEN, 1);
    g.fillRoundedRect(14, 20, 36, 18, 3);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(28, 23, 36, 23, 30, 30);
    g.fillTriangle(34, 26, 42, 26, 36, 33);
    g.fillStyle(COLORS.TEAL, 1);
    g.fillRect(10, 50, 44, 6);
    g.fillStyle(COLORS.GOLD, 1);
    g.fillCircle(32, 66, 6);
    finish('terminal_on', 64, 80);

    // --- Platform tile (32x32) ---
    g.fillStyle(0x37474f, 1);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(COLORS.TEAL, 1);
    g.fillRect(0, 0, 32, 5);
    g.fillStyle(COLORS.DEEP_TEAL, 1);
    g.fillRect(0, 5, 32, 2);
    // geometric trim
    g.fillStyle(COLORS.GOLD, 1);
    g.fillTriangle(4, 14, 10, 14, 7, 20);
    g.fillTriangle(18, 14, 24, 14, 21, 20);
    g.fillStyle(0x263238, 1);
    g.fillRect(0, 28, 32, 4);
    finish('tile', 32, 32);

    // --- Solar platform tile ---
    g.fillStyle(0x1a237e, 1);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x0d47a1, 1);
    g.fillRect(0, 0, 32, 8);
    g.lineStyle(1, COLORS.TEAL, 1);
    g.strokeRect(0, 0, 32, 8);
    g.strokeRect(0, 8, 32, 8);
    g.fillStyle(COLORS.GOLD, 1);
    g.fillRect(14, 18, 4, 4);
    finish('solar_tile', 32, 32);

    // --- Smart Market stall (104x88) — Ankara/Kente patterned canopy ---
    // canopy: alternating vibrant cloth panels with zig-zag Kente trim
    const canopyCols = [COLORS.ORANGE, COLORS.PINK, COLORS.TEAL, COLORS.GOLD, COLORS.CLOTH];
    for (let i = 0; i < 5; i++) {
        g.fillStyle(canopyCols[i % canopyCols.length], 1);
        g.fillRect(i * 21, 0, 21, 16);
    }
    // scalloped valance under the canopy
    for (let i = 0; i < 8; i++) {
        g.fillStyle(canopyCols[(i + 2) % canopyCols.length], 1);
        g.fillTriangle(i * 13, 16, i * 13 + 13, 16, i * 13 + 6.5, 24);
    }
    // support posts
    g.fillStyle(0x5d4037, 1);
    g.fillRect(6, 22, 7, 66);
    g.fillRect(91, 22, 7, 66);
    // counter / shelf body
    g.fillStyle(0x455a64, 1);
    g.fillRect(10, 52, 84, 36);
    g.fillStyle(0x37474f, 1);
    g.fillRect(10, 52, 84, 5);
    // goods: circuit boards (teal) + solar battery pods (gold) + fruit baskets (magenta)
    g.fillStyle(COLORS.TEAL, 1); g.fillRect(16, 40, 18, 12);
    g.fillStyle(0x004d40, 1); g.fillRect(18, 42, 14, 2); g.fillRect(18, 46, 14, 2);
    g.fillStyle(COLORS.GOLD, 1); g.fillRect(40, 40, 14, 12);
    g.fillStyle(COLORS.AMBER, 1); g.fillRect(42, 42, 10, 3);
    g.fillStyle(COLORS.PINK, 1); g.fillCircle(66, 46, 7);
    g.fillStyle(COLORS.ORANGE, 1); g.fillCircle(78, 46, 7);
    // fiber-optic cable strung across the front (sagging polyline)
    g.lineStyle(1.5, COLORS.GREEN, 0.9);
    g.beginPath();
    g.moveTo(10, 30);
    for (let i = 1; i <= 6; i++) g.lineTo(10 + i * 14, 30 + Math.sin((i / 6) * Math.PI) * 9);
    g.strokePath();
    finish('stall', 104, 88);

    // --- Hanging solar lantern (20x30) ---
    g.lineStyle(1.5, 0x90a4ae, 1);
    g.beginPath(); g.moveTo(10, 0); g.lineTo(10, 6); g.strokePath();
    g.fillStyle(0x37474f, 1); g.fillRoundedRect(3, 6, 14, 4, 2);
    g.fillStyle(COLORS.GOLD, 0.95); g.fillRoundedRect(4, 10, 12, 14, 4);
    g.fillStyle(0xfffde7, 1); g.fillCircle(10, 17, 4);
    g.fillStyle(COLORS.AMBER, 1); g.fillRoundedRect(3, 24, 14, 3, 1);
    finish('lantern', 20, 30);

    // --- Hologram sign ---
    g.fillStyle(0x0d1117, 0.85);
    g.fillRoundedRect(0, 0, 96, 28, 6);
    g.lineStyle(2, COLORS.TEAL, 1);
    g.strokeRoundedRect(0, 0, 96, 28, 6);
    g.fillStyle(COLORS.GOLD, 1);
    g.fillCircle(10, 14, 4);
    g.fillStyle(COLORS.TEAL, 1);
    g.fillRect(22, 8, 60, 4);
    g.fillRect(22, 16, 44, 4);
    finish('holo_sign', 96, 28);

    // --- Energy elevator platform ---
    g.fillStyle(0x006064, 1);
    g.fillRoundedRect(0, 0, 80, 16, 4);
    g.fillStyle(COLORS.GREEN, 1);
    g.fillRect(0, 0, 80, 4);
    g.fillStyle(COLORS.TEAL, 0.8);
    for (let i = 0; i < 5; i++) g.fillRect(8 + i * 16, 8, 8, 4);
    finish('lift', 80, 16);

    // --- NPC market citizen (20x34) — colorful Ankara attire ---
    // head
    g.fillStyle(0x8d5524, 1); g.fillCircle(10, 7, 5.5);
    // gele head-wrap / cap (vibrant)
    g.fillStyle(COLORS.PINK, 1); g.fillCircle(10, 4, 5);
    g.fillStyle(COLORS.GOLD, 1); g.fillRect(5, 3, 10, 2);
    // torso: Ankara robe
    g.fillStyle(COLORS.ORANGE, 1); g.fillRect(4, 12, 12, 14);
    g.fillStyle(COLORS.TEAL, 1); g.fillRect(4, 12, 12, 3);
    g.fillStyle(COLORS.GOLD, 1); g.fillRect(7, 16, 2, 8); g.fillRect(11, 16, 2, 8);
    // arms
    g.fillStyle(COLORS.CLOTH, 1); g.fillRect(1, 13, 3, 9); g.fillRect(16, 13, 3, 9);
    // legs
    g.fillStyle(0x4e342e, 1); g.fillRect(5, 26, 4, 8); g.fillRect(11, 26, 4, 8);
    finish('citizen', 20, 34);

    g.destroy();
    void tex;
}

// ---------------------------------------------------------------------------
// GAME SCENE
// ---------------------------------------------------------------------------
export class Game extends Scene {
    private player!: Phaser.Physics.Arcade.Sprite;
    private cursors!: any;
    private keys!: any;
    private platforms!: Physics.Arcade.StaticGroup;
    private lifts!: Physics.Arcade.Group;
    private cells!: Physics.Arcade.StaticGroup;
    private parts!: Physics.Arcade.StaticGroup;
    private drones!: Physics.Arcade.Group;
    private kobo!: Phaser.Physics.Arcade.Sprite;
    private terminal!: Phaser.GameObjects.Sprite;
    private particles!: Phaser.GameObjects.Particles.ParticleEmitter;
    private sparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;

    private phase: string = 'MENU';
    private hp = 3;
    private maxHp = 3;
    private score = 0;
    private cellsCollected = 0;
    private totalCells = 6;
    private partsCollected = 0;
    private totalParts = 4;
    private canRepair = false;
    private repairing = false;
    private repairProgress = 0;
    private terminalFixed = false;
    private invulnUntil = 0;
    private facingRight = true;
    private jumpQueued = false;
    private jumpHeld = false;
    private touchRepair = false;
    private touchLeft = false;
    private touchRight = false;
    private touchJump = false;
    private lastJumpPress = 0;
    private hudDirty = true;
    private ambient!: Phaser.GameObjects.Graphics;

    constructor() {
        super('Game');
    }

    preload() {
        this.load.image('fx_spark', 'assets/fx/spark.png');
        this.load.image('fx_star', 'assets/fx/star.png');
        this.load.image('fx_glow', 'assets/fx/glow.png');
        this.load.image('fx_smoke', 'assets/fx/smoke.png');
        this.load.audio('sfx_jump', 'assets/audio/sfx_jump.mp3');
        this.load.audio('sfx_collect', 'assets/audio/sfx_collect.mp3');
        this.load.audio('sfx_hit', 'assets/audio/sfx_hit.mp3');
        this.load.audio('sfx_powerup', 'assets/audio/sfx_powerup.mp3');
        this.load.audio('sfx_button', 'assets/audio/sfx_button.mp3');
        this.load.audio('sfx_win', 'assets/audio/sfx_win.mp3');
        this.load.audio('sfx_gameover', 'assets/audio/sfx_gameover.mp3');
        this.load.audio('bgm_action', 'assets/audio/bgm_action.mp3');
        this.load.audio('bgm_chill', 'assets/audio/bgm_chill.mp3');
    }

    create() {
        genTextures(this);

        this.physics.world.gravity.y = GRAVITY_Y;
        this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setBackgroundColor('#0d1117');

        this.buildBackground();
        this.buildLevel();

        // --- Player ---
        this.player = this.physics.add.sprite(80, 400, 'tobi_0');
        this.player.setCollideWorldBounds(true);
        this.player.setSize(38, 58);
        this.player.setOffset(13, 4);
        this.player.setDepth(10);

        this.platforms = this.physics.add.staticGroup();
        this.buildPlatformColliders();

        this.lifts = this.physics.add.group({ allowGravity: false, immovable: true });
        this.buildLifts();

        this.cells = this.physics.add.staticGroup();
        this.parts = this.physics.add.staticGroup();
        this.buildCollectibles();

        this.drones = this.physics.add.group({ allowGravity: false, immovable: true });
        this.buildDrones();

        this.terminal = this.add.sprite(2900, 448, 'terminal_off').setDepth(8);
        this.terminal.setSize(56, 72).setInteractive();

        // --- Kobo companion ---
        this.kobo = this.physics.add.sprite(140, 360, 'kobo');
        this.kobo.setDepth(9);
        (this.kobo.body as Physics.Arcade.Body).setAllowGravity(false);
        this.kobo.setCollideWorldBounds(true);

        // --- Colliders ---
        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.collider(this.player, this.lifts);
        this.physics.add.collider(this.drones, this.platforms, undefined, undefined, this);

        // --- Overlaps ---
        this.physics.add.overlap(this.player, this.cells, (_p, c) => this.onCell(c as Phaser.Physics.Arcade.Sprite), undefined, this);
        this.physics.add.overlap(this.player, this.parts, (_p, c) => this.onPart(c as Phaser.Physics.Arcade.Sprite), undefined, this);
        this.physics.add.overlap(this.player, this.drones, (_p, d) => this.onDroneHit(d as Phaser.GameObjects.Sprite), undefined, this);

        // --- Particles ---
        this.particles = this.add.particles(0, 0, 'fx_glow', {
            speed: { min: 40, max: 120 },
            lifespan: 500,
            scale: { start: 0.7, end: 0 },
            quantity: 8,
            tint: [COLORS.TEAL, COLORS.GREEN],
            emitting: false,
        }).setDepth(11);
        this.sparkBurst = this.add.particles(0, 0, 'fx_spark', {
            speed: { min: 80, max: 200 },
            lifespan: 350,
            scale: { start: 0.8, end: 0 },
            quantity: 6,
            tint: COLORS.GOLD,
            emitting: false,
        }).setDepth(12);

        // --- Input ---
        this.keys = this.input.keyboard!.addKeys('A,D,W,S,SPACE,UP,DOWN,LEFT,RIGHT,E,F,ENTER,ESC,P');
        this.cursors = {
            left: [this.keys.LEFT, this.keys.A],
            right: [this.keys.RIGHT, this.keys.D],
            jump: [this.keys.SPACE, this.keys.W, this.keys.UP],
            repair: [this.keys.E, this.keys.F, this.keys.ENTER],
        };

        this.input.keyboard!.on('keydown-ESC', () => this.togglePause());
        this.input.keyboard!.on('keydown-P', () => this.togglePause());
        this.input.keyboard!.on('keydown-SPACE', () => {
            if (this.phase === 'GAME_OVER' || this.phase === 'MISSION_COMPLETE') this.onRestart();
        });
        this.input.keyboard!.on('keydown-ENTER', () => {
            if (this.phase === 'GAME_OVER' || this.phase === 'MISSION_COMPLETE') this.onRestart();
        });

        // --- EventBus from React ---
        EventBus.on(EV_START_MISSION, this.onStartMission, this);
        EventBus.on(EV_RESTART, this.onRestart, this);
        EventBus.on(EV_TOGGLE_PAUSE, this.togglePause, this);
        EventBus.on(EV_TRIGGER_REPAIR, this.onTriggerRepair, this);
        EventBus.on(EV_TOGGLE_AUDIO, this.onToggleAudio, this);
        // Mobile touch state
        EventBus.on('touch-move', this.onTouchMove, this);
        EventBus.on('touch-jump', this.onTouchJump, this);

        // --- Timers ---
        this.time.addEvent({ delay: 500, loop: true, callback: this.tickDrones, callbackScope: this });
        this.time.addEvent({ delay: 1000, loop: true, callback: this.tickAmbient, callbackScope: this });

        this.events.once('shutdown', () => {
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.input.keyboard?.removeAllListeners();
            this.sound.stopAll();
            synth.stopMusic();
            EventBus.off(EV_START_MISSION, this.onStartMission, this);
            EventBus.off(EV_RESTART, this.onRestart, this);
            EventBus.off(EV_TOGGLE_PAUSE, this.togglePause, this);
            EventBus.off(EV_TRIGGER_REPAIR, this.onTriggerRepair, this);
            EventBus.off(EV_TOGGLE_AUDIO, this.onToggleAudio, this);
            EventBus.off('touch-move', this.onTouchMove, this);
            EventBus.off('touch-jump', this.onTouchJump, this);
        });

        EventBus.emit(EV_SCENE_READY, this);
        this.changePhase('MENU');
        this.pushHud();
        this.say('Kobo', 'Systems online. Awaiting mission start, Tobi!', 'happy');
    }

    // ---------------- Background ----------------
    private buildBackground() {
        this.ambient = this.add.graphics().setDepth(0);
        this.ambient.fillStyle(0x0d1117, 1).fillRect(0, 0, WORLD_W, WORLD_H);

        // Warm Afrofuturistic sunset sky gradient (deep indigo -> magenta -> orange horizon)
        const sky = this.add.graphics().setScrollFactor(0.1).setDepth(1);
        const skyBands = [
            [0x1a1147, 0], [0x3b1860, 120], [0x7a2a6b, 240],
            [0xc0492f, 340], [0xf07a1e, 420], [0xffb74d, 480],
        ];
        for (let i = 0; i < skyBands.length; i++) {
            const [col, y] = skyBands[i];
            const nextY = i < skyBands.length - 1 ? skyBands[i + 1][1] : WORLD_H;
            sky.fillStyle(col, 1).fillRect(0, y, WORLD_W, nextY - y);
        }
        // low sun disk with halo over the lagoon
        sky.fillStyle(0xffe082, 0.35).fillCircle(720, 430, 150);
        sky.fillStyle(COLORS.GOLD, 0.7).fillCircle(720, 430, 90);
        sky.fillStyle(0xfff3c4, 1).fillCircle(720, 430, 58);

        // Lagos lagoon water band + shimmering sun reflection
        const water = this.add.graphics().setScrollFactor(0.2).setDepth(2);
        water.fillStyle(0x123a4a, 0.9).fillRect(0, 452, WORLD_W, 70);
        water.fillStyle(0x0d2b38, 1).fillRect(0, 500, WORLD_W, 30);
        for (let i = 0; i < 40; i++) {
            const rx = 640 + (i % 9) * 16 - 60;
            const ry = 458 + i * 1.6;
            water.fillStyle(COLORS.GOLD, 0.5 - (i % 6) * 0.06);
            water.fillRect(rx, ry, 30 + (i % 3) * 14, 2);
        }

        // Third Mainland Bridge silhouette: long deck + A-frame pylons + suspension cables
        const bridge = this.add.graphics().setScrollFactor(0.28).setDepth(3);
        bridge.fillStyle(0x0a0f1e, 1).fillRect(0, 430, WORLD_W, 12);
        bridge.lineStyle(2, COLORS.TEAL, 0.5);
        bridge.lineBetween(0, 430, WORLD_W, 430);
        for (let i = 0; i < 9; i++) {
            const px = 120 + i * 340;
            // A-frame pylon
            bridge.fillStyle(0x0a0f1e, 1);
            bridge.fillTriangle(px - 14, 430, px + 14, 430, px, 300);
            bridge.fillRect(px - 4, 300, 8, 14);
            // suspension cables fanning from pylon top
            bridge.lineStyle(1.5, COLORS.GOLD, 0.45);
            for (let c = 1; c <= 4; c++) {
                bridge.lineBetween(px, 306, px - c * 42, 430);
                bridge.lineBetween(px, 306, px + c * 42, 430);
            }
            // pylon aviation light
            bridge.fillStyle(COLORS.RED_ORANGE, 0.9).fillCircle(px, 300, 3);
        }

        // Mid skyline silhouette (warm-lit windows)
        const city = this.add.graphics().setScrollFactor(0.4).setDepth(4);
        for (let i = 0; i < 26; i++) {
            const x = i * 130;
            const h = 90 + ((i * 53) % 140);
            city.fillStyle(0x0a0f1e, 1).fillRect(x, 470 - h, 100, h);
            city.fillStyle(0x141a33, 1).fillRect(x + 6, 470 - h, 88, h);
            city.fillStyle(i % 3 === 0 ? COLORS.GOLD : COLORS.AMBER, 0.75);
            for (let wy = 0; wy < 5; wy++) {
                for (let wx = 0; wx < 4; wx++) {
                    if ((i + wx + wy) % 3 !== 0) continue;
                    city.fillRect(x + 14 + wx * 20, 470 - h + 12 + wy * 26, 8, 12);
                }
            }
        }

        // Transit rail + Danfo coaches
        const rail = this.add.graphics().setScrollFactor(0.5).setDepth(5);
        rail.fillStyle(0x263238, 1).fillRect(0, 300, WORLD_W, 10);
        rail.lineStyle(2, COLORS.TEAL, 0.6);
        rail.lineBetween(0, 300, WORLD_W, 300);
        for (let i = 0; i < 6; i++) {
            const x = 200 + i * 520;
            rail.fillStyle(COLORS.GOLD, 1).fillRoundedRect(x, 268, 96, 30, 6);
            rail.fillStyle(0x263238, 1).fillRect(x + 8, 274, 80, 12);
            rail.fillStyle(COLORS.TEAL, 1).fillRect(x + 12, 276, 14, 8);
            rail.fillCircle(x + 90, 284, 4);
        }

        // Market background wall + holo signs
        const market = this.add.graphics().setScrollFactor(0.7).setDepth(6);
        market.fillStyle(0x140d1f, 1).fillRect(0, 330, WORLD_W, 210);
        for (let i = 0; i < 10; i++) {
            const x = 100 + i * 300;
            market.fillStyle(0x1d1430, 1).fillRect(x, 350, 200, 120);
        }
        const signs = ['EKO SMART MARKET', 'SOLAR GRID 01', 'BALOGUN TECH HUB', 'ALABA DIGITAL', 'BATTERY SWAP', 'MAKOKO GRID', 'DANFO NET', 'POWER HUB', 'TECH BAZAAR', 'CITY REBOOT'];
        for (let i = 0; i < 10; i++) {
            const sx = 150 + i * 300;
            this.add.image(sx, 372, 'holo_sign').setScrollFactor(0.7).setDepth(7).setAlpha(0.9);
            const t = this.add.text(sx, 372, signs[i], {
                fontFamily: 'Arial Black, Arial',
                fontSize: '10px',
                color: '#00e5ff',
            }).setOrigin(0.5).setScrollFactor(0.7).setDepth(8).setAlpha(0.95);
            this.tweens.add({ targets: t, alpha: 0.55, yoyo: true, repeat: -1, duration: 900 + i * 100 });
            // hanging solar lanterns strung across the market front
            const lx = sx - 40 + (i % 2) * 80;
            const lantern = this.add.image(lx, 402, 'lantern').setScrollFactor(0.7).setDepth(8);
            lantern.setTint(COLORS.GOLD);
            this.tweens.add({
                targets: lantern,
                angle: { from: -8, to: 8 },
                yoyo: true, repeat: -1, duration: 1400 + i * 120, ease: 'Sine.inOut',
            });
            this.tweens.add({
                targets: lantern, alpha: { from: 0.7, to: 1 },
                yoyo: true, repeat: -1, duration: 700 + i * 60,
            });
        }
    }

    // ---------------- Level ----------------
    private buildLevel() {
        const g = this.add.graphics().setDepth(6);
        void g;
        // Ground: continuous strip
        for (let x = 0; x < WORLD_W; x += 32) {
            this.add.image(x, 520, 'tile').setOrigin(0, 0).setDepth(6);
        }
        // Pit visual (a gap in the ground near x=1500)
        const pitX = 1480;
        this.add.rectangle(pitX, 522, 128, 40, 0x05070c).setDepth(7);
        this.add.rectangle(pitX, 522, 128, 8, COLORS.RED_ORANGE).setDepth(7).setAlpha(0.4);

        // Foreground market stalls (Ankara canopies) placed along the ground
        const stallXs = [360, 980, 1780, 2460, 2980];
        stallXs.forEach((sx, i) => {
            const st = this.add.image(sx, 520, 'stall').setOrigin(0.5, 1).setDepth(8);
            st.setTint(i % 2 === 0 ? 0xffffff : 0xffe0b0);
        });

        // Wandering/bobbing NPC citizens for lively atmosphere
        const citXs = [220, 540, 760, 1180, 1660, 2120, 2680, 3060];
        citXs.forEach((cx, i) => {
            const c = this.add.image(cx, 520, 'citizen').setOrigin(0.5, 1).setDepth(9);
            c.setTint(i % 3 === 0 ? 0xffffff : (i % 3 === 1 ? 0xffd9a0 : 0xd0f0ff));
            this.tweens.add({
                targets: c,
                y: 516,
                x: cx + (i % 2 === 0 ? 26 : -26),
                duration: 1600 + i * 180,
                yoyo: true, repeat: -1, ease: 'Sine.inOut',
            });
        });

        // Foreground hanging solar lanterns above the walkway
        for (let i = 0; i < 12; i++) {
            const lx = 160 + i * 260;
            const ln = this.add.image(lx, 150, 'lantern').setDepth(9);
            ln.setTint(i % 2 === 0 ? COLORS.GOLD : COLORS.AMBER);
            this.tweens.add({
                targets: ln, angle: { from: -6, to: 6 },
                yoyo: true, repeat: -1, duration: 1500 + i * 90, ease: 'Sine.inOut',
            });
        }
    }

    private buildPlatformColliders() {
        // Ground segments (skip the pit)
        for (let x = 0; x < WORLD_W; x += 32) {
            if (x >= 1480 && x < 1480 + 128) continue;
            const p = this.platforms.create(x + 16, 520 + 16, 'tile');
            p.setVisible(false);
            p.body!.setSize(32, 32);
        }
        // Floating platforms: [x, y, widthInTiles]
        const plats: [number, number, number][] = [
            [260, 420, 4], [420, 340, 3], [620, 400, 5],
            [860, 330, 4], [1040, 250, 3], [1180, 380, 4],
            [1560, 380, 3], [1720, 300, 4], [1920, 220, 3],
            [2080, 360, 5], [2320, 280, 4], [2520, 200, 3],
            [2640, 340, 4], [2820, 420, 5],
        ];
        plats.forEach(([x, y, w], idx) => {
            for (let i = 0; i < w; i++) {
                const tex = idx % 2 === 0 ? 'solar_tile' : 'tile';
                const p = this.platforms.create(x + i * 32 + 16, y + 16, tex);
                p.setVisible(false);
                p.body!.setSize(32, 32);
            }
            // visual strip
            this.add.rectangle(x + (w * 32) / 2, y + 16, w * 32, 32, idx % 2 === 0 ? 0x1a237e : 0x37474f)
                .setDepth(6);
            this.add.rectangle(x + (w * 32) / 2, y + 2, w * 32, 4, idx % 2 === 0 ? COLORS.TEAL : COLORS.GOLD)
                .setDepth(7);
        });

        // Stalls on ground
        const stallXs = [180, 700, 1250, 2000, 2450];
        stallXs.forEach((sx, i) => {
            const s = this.add.image(sx, 488, 'stall').setOrigin(0.5, 1).setDepth(7);
            this.tweens.add({ targets: s, scaleY: 1.02, yoyo: true, repeat: -1, duration: 1400 + i * 200 });
        });

        // Invisible platform under the Central Terminal so the player can stand
        // at terminal height and reach the repair proximity threshold.
        const tp = this.platforms.create(2900, 448, 'tile');
        tp.setVisible(false);
        tp.body!.setSize(96, 32);
    }

    private buildLifts() {
        const lifts: [number, number, number, number][] = [
            [980, 420, 980, 260],
            [1820, 440, 1820, 260],
            [2400, 420, 2400, 240],
        ];
        lifts.forEach(([x1, y1, x2, y2]) => {
            const l = this.lifts.create((x1 + x2) / 2, y1, 'lift');
            l.setDepth(7);
            this.tweens.add({
                targets: l,
                y: y2,
                duration: 2600,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.InOut',
                onUpdate: () => {
                    const b = l.body as Physics.Arcade.Body;
                    b.updateFromGameObject();
                },
            });
        });
    }

    private buildCollectibles() {
        const cellPos: [number, number][] = [
            [300, 380], [660, 350], [1060, 210], [1760, 260], [2120, 320], [2860, 390],
        ];
        cellPos.forEach(([x, y]) => {
            const c = this.cells.create(x, y, 'cell');
            c.setDepth(8);
            this.tweens.add({ targets: c, y: y - 8, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        });
        const partPos: [number, number][] = [
            [460, 300], [1220, 340], [1960, 180], [2560, 160],
        ];
        partPos.forEach(([x, y]) => {
            const p = this.parts.create(x, y, 'part');
            p.setDepth(8);
            this.tweens.add({ targets: p, angle: 360, duration: 3000, repeat: -1 });
        });
    }

    private buildDrones() {
        const routes: [number, number, number, number][] = [
            [520, 300, 820, 300],
            [1100, 300, 1100, 460],
            [1650, 240, 1980, 240],
            [2200, 300, 2500, 300],
            [2700, 260, 2700, 420],
        ];
        routes.forEach(([x1, y1, x2, y2]) => {
            const d = this.drones.create(x1, y1, 'drone');
            d.setDepth(9);
            d.setData('x1', x1); d.setData('y1', y1);
            d.setData('x2', x2); d.setData('y2', y2);
            d.setData('t', Math.random());
            d.setData('speed', 0.0006 + Math.random() * 0.0004);
            d.setData('dir', 1);
            // scan cone visual
            const cone = this.add.triangle(x1, y1 + 20, 0, 0, -14, 34, 14, 34, 0xff1744, 0.22).setDepth(8);
            d.setData('cone', cone);
        });
    }

    private tickDrones() {
        if (this.phase !== 'PLAYING' && this.phase !== 'REPAIRING') return;
        const list = this.drones.getChildren() as Phaser.GameObjects.Sprite[];
        for (const d of list) {
            if (!d || !d.active) continue;
            const t = d.getData('t') as number;
            const dir = d.getData('dir') as number;
            let nt = t + dir * (d.getData('speed') as number) * 500;
            if (nt > 1) { nt = 1; d.setData('dir', -1); }
            if (nt < 0) { nt = 0; d.setData('dir', 1); }
            d.setData('t', nt);
            const nx = (d.getData('x1') as number) * (1 - nt) + (d.getData('x2') as number) * nt;
            const ny = (d.getData('y1') as number) * (1 - nt) + (d.getData('y2') as number) * nt;
            d.setPosition(nx, ny);
            const cone = d.getData('cone') as Phaser.GameObjects.Triangle;
            if (cone) cone.setPosition(nx, ny + 20);
            // proximity dialogue
            if (this.player && Phaser.Math.Distance.Between(this.player.x, this.player.y, nx, ny) < 130) {
                if (Math.random() < 0.04) this.say('Kobo', 'Rogue drone ahead! Jump over it!', 'alert');
            }
        }
    }

    private tickAmbient() {
        if (this.phase !== 'PLAYING') return;
        if (this.player && this.player.active && Math.random() < 0.4) {
            const x = this.player.x + Phaser.Math.Between(-40, 40);
            const y = Phaser.Math.Between(300, 500);
            this.particles.setPosition(x, y).explode(1);
        }
    }

    // ---------------- Events ----------------
    private onStartMission() {
        if (this.phase === 'MENU') {
            this.changePhase('STORY_INTRO');
        } else if (this.phase === 'STORY_INTRO') {
            this.beginGameplay();
        }
    }

    private beginGameplay() {
        this.resetRun();
        this.changePhase('PLAYING');
        synth.resume();
        synth.startMusic();
        if (this.cache.audio.exists('bgm_action') && !synth.muted) {
            this.sound.play('bgm_action', { loop: true, volume: 0.35 });
        }
        this.say('Kobo', "Lagos Smart Market grid is failing! Collect 6 Energy Cells and 4 Repair Parts, then reboot the Central Terminal!", 'alert');
    }

    private onRestart() {
        this.sound.stopAll();
        this.resetRun();
        this.changePhase('PLAYING');
        synth.resume();
        synth.startMusic();
        if (this.cache.audio.exists('bgm_action') && !synth.muted) {
            this.sound.play('bgm_action', { loop: true, volume: 0.35 });
        }
        this.say('Kobo', 'Back in the field. Stay sharp, Tobi!', 'happy');
    }

    private resetRun() {
        this.hp = this.maxHp;
        this.score = 0;
        this.cellsCollected = 0;
        this.partsCollected = 0;
        this.repairProgress = 0;
        this.terminalFixed = false;
        this.canRepair = false;
        this.repairing = false;
        this.player.setPosition(80, 400);
        this.player.setVelocity(0, 0);
        this.terminal.setTexture('terminal_off');
        // respawn collectibles
        (this.cells.getChildren() as unknown as Phaser.Physics.Arcade.Sprite[]).forEach(c => c.enableBody(true, c.x, c.y, true, true));
        (this.parts.getChildren() as unknown as Phaser.Physics.Arcade.Sprite[]).forEach(p => p.enableBody(true, p.x, p.y, true, true));
        this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
        this.pushHud();
    }

    private togglePause() {
        if (this.phase === 'PLAYING' || this.phase === 'REPAIRING') {
            this.prevPhase = this.phase;
            this.changePhase('PAUSED');
            this.physics.world.pause();
            this.tweens.pauseAll();
            this.sound.pauseAll();
            synth.stopMusic();
        } else if (this.phase === 'PAUSED') {
            this.changePhase(this.prevPhase || 'PLAYING');
            this.physics.world.resume();
            this.tweens.resumeAll();
            this.sound.resumeAll();
            if (!synth.muted) synth.startMusic();
        }
    }
    private prevPhase: string | null = null;

    private onTriggerRepair(pressing: boolean) {
        this.touchRepair = pressing;
    }

    private onTouchMove(dir: number) {
        this.touchLeft = dir < 0;
        this.touchRight = dir > 0;
    }

    private onTouchJump(press: boolean) {
        if (press) {
            const now = this.time.now;
            if (now - this.lastJumpPress > 120) {
                this.jumpQueued = true;
                this.lastJumpPress = now;
            }
        }
    }

    private onToggleAudio(payload: { muted: boolean }) {
        synth.setMuted(payload.muted);
        this.sound.setMute(payload.muted);
    }

    private changePhase(p: string) {
        this.phase = p;
        EventBus.emit(EV_PHASE, p);
    }

    private say(speaker: string, text: string, mood?: string) {
        EventBus.emit(EV_DIALOGUE, { speaker, text, mood });
    }

    private pushHud() {
        const state: HudState = {
            hp: this.hp,
            maxHp: this.maxHp,
            energyCells: this.cellsCollected,
            totalEnergyCells: this.totalCells,
            repairParts: this.partsCollected,
            totalRepairParts: this.totalParts,
            score: this.score,
            canRepair: this.canRepair,
            repairProgress: Math.round(this.repairProgress),
            terminalFixed: this.terminalFixed,
        };
        EventBus.emit(EV_HUD, state);
    }

    private safePlay(key: string) {
        if (this.cache.audio.exists(key)) this.sound.play(key, { volume: 0.6 });
    }

    // ---------------- Overlaps ----------------
    private onCell(c: Phaser.Physics.Arcade.Sprite) {
        if (!c || !c.active || !c.visible) return;
        c.disableBody(true, true);
        this.cellsCollected++;
        this.score += 100;
        this.hudDirty = true;
        this.safePlay('sfx_collect');
        synth.playCollect();
        this.sparkBurst.setPosition(c.x, c.y).explode(10);
        const floatTxt = this.add.text(c.x, c.y - 20, '+100', { fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd600' })
            .setOrigin(0.5).setDepth(13);
        this.tweens.add({
            targets: floatTxt,
            y: c.y - 60, alpha: 0, duration: 800, onComplete: () => floatTxt.destroy(),
        });
        if (this.cellsCollected === this.totalCells) {
            this.say('Kobo', 'All Energy Cells secured! Now find the repair parts!', 'happy');
        } else {
            this.say('Kobo', `Energy Cell collected! ${this.totalCells - this.cellsCollected} to go.`, 'happy');
        }
    }

    private onPart(p: Phaser.Physics.Arcade.Sprite) {
        if (!p || !p.active || !p.visible) return;
        p.disableBody(true, true);
        this.partsCollected++;
        this.score += 150;
        this.hudDirty = true;
        this.safePlay('sfx_powerup');
        synth.playPart();
        this.sparkBurst.setPosition(p.x, p.y).explode(8);
        if (this.partsCollected === this.totalParts) {
            this.say('Kobo', 'Repair components complete! Head to the Central Terminal at the far right!', 'alert');
        }
    }

    private onDroneHit(d: Phaser.GameObjects.Sprite) {
        if (!d || !d.active) return;
        if (this.time.now < this.invulnUntil) return;
        this.hp--;
        this.invulnUntil = this.time.now + 1200;
        this.hudDirty = true;
        this.safePlay('sfx_hit');
        synth.playHit();
        this.cameras.main.shake(200, 0.012);
        this.player.setVelocity(this.player.x < d.x ? -220 : 220, -260);
        this.tweens.add({ targets: this.player, alpha: 0.3, yoyo: true, repeat: 3, duration: 120 });
        if (this.hp <= 0) {
            this.gameOver();
        } else {
            this.say('Kobo', 'Shield integrity damaged! Watch the drone patrol lines!', 'alert');
        }
    }

    private gameOver() {
        this.changePhase('GAME_OVER');
        synth.playGameOver();
        synth.stopMusic();
        this.sound.stopAll();
        this.safePlay('sfx_gameover');
        this.say('Kobo', 'Systems down... but we can reboot the attempt!', 'alert');
    }

    private winMission() {
        this.terminalFixed = true;
        this.score += 1000;
        this.terminal.setTexture('terminal_on');
        this.changePhase('MISSION_COMPLETE');
        synth.playWin();
        synth.stopMusic();
        this.sound.stopAll();
        this.safePlay('sfx_win');
        this.say('Kobo', 'Power restored! The Smart Market is alive again. You did it, Tobi!', 'happy');
        // victory particles
        for (let i = 0; i < 24; i++) {
            this.time.delayedCall(i * 60, () => {
                this.sparkBurst.setPosition(Phaser.Math.Between(2700, 3100), Phaser.Math.Between(200, 480)).explode(6);
            });
        }
        // citizens cheer
        for (let i = 0; i < 6; i++) {
            const c = this.add.image(2760 + i * 40, 500, 'citizen').setOrigin(0.5, 1).setDepth(8);
            this.tweens.add({ targets: c, y: 486, yoyo: true, repeat: 3, duration: 220 });
        }
        this.hudDirty = true;
    }

    // ---------------- Update loop ----------------
    update(time: number, delta: number) {
        void delta;
        if (this.phase !== 'PLAYING' && this.phase !== 'REPAIRING') return;
        if (!this.player || !this.player.active) return;

        const body = this.player.body as Physics.Arcade.Body;
        const onGround = body.blocked.down || body.touching.down;

        // Horizontal input
        let vx = 0;
        const left = this.touchLeft || this.keys.LEFT.isDown || this.keys.A.isDown;
        const right = this.touchRight || this.keys.RIGHT.isDown || this.keys.D.isDown;
        if (left && !right) { vx = -RUN_SPEED; this.facingRight = false; }
        if (right && !left) { vx = RUN_SPEED; this.facingRight = true; }
        this.player.setVelocityX(vx);
        this.player.setFlipX(!this.facingRight);

        // Jump
        const jumpKey = this.keys.SPACE.isDown || this.keys.W.isDown || this.keys.UP.isDown || this.touchJump;
        if (this.jumpQueued || (jumpKey && !this.jumpHeld)) {
            if (onGround) {
                this.player.setVelocityY(JUMP_VY);
                this.safePlay('sfx_jump');
                synth.playJump();
                this.particles.setPosition(this.player.x, this.player.y + 20).explode(5);
                this.jumpCount = 1;
            } else if (this.jumpCount < 2) {
                this.player.setVelocityY(DOUBLE_JUMP_VY);
                synth.playDoubleJump();
                this.sparkBurst.setPosition(this.player.x, this.player.y + 10).explode(8);
                this.jumpCount = 2;
            }
            this.jumpQueued = false;
        }
        this.jumpHeld = jumpKey;

        // Run animation
        const repairingNow = this.phase === 'REPAIRING';
        if (repairingNow) {
            this.runFrame += delta * 0.02;
            this.player.setTexture(Math.floor(this.runFrame) % 2 === 0 ? 'tobi_repair' : 'tobi_0');
        } else if (vx !== 0 && onGround) {
            this.runFrame += delta * 0.012;
            const f = Math.floor(this.runFrame) % 4;
            this.player.setTexture(`tobi_${f}`);
        } else if (!onGround) {
            this.player.setTexture('tobi_jump');
        } else {
            this.player.setTexture('tobi_0');
        }

        // Reset jump count on landing
        if (onGround) this.jumpCount = 0;

        // Kill plane
        if (this.player.y > WORLD_H + 40) {
            this.hp--;
            this.hudDirty = true;
            this.cameras.main.shake(200, 0.015);
            this.safePlay('sfx_hit');
            if (this.hp <= 0) {
                this.gameOver();
                return;
            }
            this.player.setPosition(80, 400);
            this.player.setVelocity(0, 0);
            this.say('Kobo', 'Careful of the energy pits! Grid integrity dropping!', 'alert');
        }

        // Kobo follow
        if (this.kobo) {
            const targetX = this.player.x + (this.facingRight ? 50 : -50);
            const targetY = this.player.y - 46 + Math.sin(time * 0.004) * 8;
            this.kobo.setPosition(
                Phaser.Math.Linear(this.kobo.x, targetX, 0.08),
                Phaser.Math.Linear(this.kobo.y, targetY, 0.08),
            );
            this.kobo.setFlipX(!this.facingRight);
        }

        // Terminal proximity
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.terminal.x, this.terminal.y - 20);
        const near = dist < 90;
        if (near !== this.canRepair) {
            this.canRepair = near;
            this.hudDirty = true;
            if (near && !this.terminalFixed && this.cellsCollected >= this.totalCells && this.partsCollected >= this.totalParts) {
                this.say('Kobo', 'Terminal detected! Hold REPAIR to reboot the grid!', 'alert');
            } else if (near && !this.terminalFixed) {
                this.say('Kobo', `Terminal offline. Need ${this.totalCells - this.cellsCollected} cells & ${this.totalParts - this.partsCollected} parts first.`, 'alert');
            }
        }

        // Repair channel
        const repairing = this.canRepair && !this.terminalFixed &&
            (this.keys.E.isDown || this.keys.F.isDown || this.keys.ENTER.isDown || this.touchRepair);
        if (repairing && this.cellsCollected >= this.totalCells && this.partsCollected >= this.totalParts) {
            if (this.phase !== 'REPAIRING') this.changePhase('REPAIRING');
            this.repairProgress += delta * 0.033; // ~3s
            this.hudDirty = true;
            if (Math.random() < 0.3) {
                this.sparkBurst.setPosition(this.terminal.x + Phaser.Math.Between(-20, 20), this.terminal.y + Phaser.Math.Between(-30, 20)).explode(2);
            }
            if (Math.random() < 0.2) synth.playRepairTick();
            if (this.repairProgress >= 100) {
                this.repairProgress = 100;
                this.hudDirty = true;
                this.winMission();
            }
        } else if (this.phase === 'REPAIRING') {
            this.changePhase('PLAYING');
            this.repairProgress = Math.max(0, this.repairProgress - delta * 0.05);
        }

        if (this.hudDirty) {
            this.pushHud();
            this.hudDirty = false;
        }
    }

    private jumpCount = 0;
    private runFrame = 0;
}

// ---------------------------------------------------------------------------
// START GAME
// ---------------------------------------------------------------------------
const StartGame = (parent: string) => {
    const config: Types.Core.GameConfig = {
        type: AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent,
        backgroundColor: '#0d1117',
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: GRAVITY_Y } },
        },
        scene: [Game],
    };

    const game = new PhaserGame(config);
    if (typeof window !== 'undefined') {
        (window as any).__PHASER_GAME__ = game;
        (window as any).__PHASER_EVENT_BUS__ = EventBus;
    }
    return game;
};

export default StartGame;