import { AUTO, Events, Scale, Game as PhaserGame } from "phaser";
import { Game } from "./scenes/Game";

/* ── EventBus: React ↔ Phaser bridge ─────────────────────────────── */
export const EventBus = new Events.EventEmitter();

/* Event name constants (shared by scene + App.tsx) */
export const EVT_PHASE_CHANGED = "phase-changed";
export const EVT_CURRENT_SCENE_READY = "current-scene-ready";
export const EVT_HUD = "hud-updated";
export const EVT_MISSION_COMPLETE = "mission-complete";
export const EVT_GAME_OVER = "game-over";
export const EVT_SET_TOUCH = "set-touch";
export const EVT_JUMP = "jump";
export const EVT_ACTION = "action";
export const EVT_RESTART_MISSION = "restart-mission";
export const EVT_RESUME = "resume";
export const EVT_GO_TO_MENU = "go-to-menu";
export const EVT_START_MISSION = "start-mission";
export const EVT_TOGGLE_MUTE = "toggle-mute";
export const EVT_REPAIR_PROGRESS = "repair-progress";

/** Mission id requested before the Phaser scene is listening. */
let queuedMissionId: number | null = null;

export function queueStartMission(id: number): void {
  queuedMissionId = id;
  EventBus.emit(EVT_START_MISSION, id);
}

export function takeQueuedMission(): number | null {
  const id = queuedMissionId;
  queuedMissionId = null;
  return id;
}

export function peekQueuedMission(): number | null {
  return queuedMissionId;
}

/* ── Shared types ────────────────────────────────────────────────── */
export type GamePhase =
  | "BOOT" | "MENU" | "HOW_TO_PLAY" | "BRIEFING" | "COUNTDOWN"
  | "PLAYING" | "PAUSED" | "GAME_OVER" | "MISSION_COMPLETE" | "VICTORY_CINEMATIC";
export type EV_PHASE = typeof EVT_PHASE_CHANGED;

export interface HudState {
  mission: number;
  score: number;
  hp: number;
  cells: number;
  cellsTotal: number;
  repairs: number;
  repairsTotal: number;
  objective: string;
  bossHp: number;
  bossHpMax: number;
  impact: number;
}

export interface MissionResult {
  mission: number;
  score: number;
  impact: number;
  nextUnlocked: boolean;
}

export interface MissionDef {
  id: number;
  name: string;
  desc: string;
  worldW: number;
  cells: number;
  repairs: number;
  drones: number;
  boss: boolean;
  skyTop: string;
  skyBottom: string;
  accent: string;
  movingPlatforms: number;
  bridges: number;
  bonus: number;
  impact: number;
  score: number;
  cellLabel: string;
  repairLabel: string;
}

/* ── Missions ────────────────────────────────────────────────────── */
export const MISSIONS: MissionDef[] = [
  {
    id: 1, name: "Smart Market", desc: "Reboot the Old Quarter sensor mesh.",
    worldW: 4200, cells: 5, repairs: 3, drones: 3, boss: false,
    skyTop: "#1a1040", skyBottom: "#3d2b66", accent: "#ffb347",
    movingPlatforms: 0, bridges: 0, bonus: 0, impact: 500, score: 1000,
    cellLabel: "Energy Cells", repairLabel: "Repair Parts",
  },
  {
    id: 2, name: "Solar Grid", desc: "Recover solar cores, repair the junction.",
    worldW: 5200, cells: 8, repairs: 3, drones: 5, boss: false,
    skyTop: "#0d2b4e", skyBottom: "#2f7a99", accent: "#ffd54f",
    movingPlatforms: 3, bridges: 2, bonus: 250, impact: 1000, score: 2000,
    cellLabel: "Solar Cores", repairLabel: "Solar Stations",
  },
  {
    id: 3, name: "Waterfront", desc: "Install data chips, face the Elite Drone.",
    worldW: 6200, cells: 10, repairs: 1, drones: 6, boss: true,
    skyTop: "#04121f", skyBottom: "#0e4d5c", accent: "#4fffc9",
    movingPlatforms: 4, bridges: 3, bonus: 500, impact: 2000, score: 5000,
    cellLabel: "Network Chips", repairLabel: "AI Terminal",
  },
];

/* ── Persistent save (localStorage) ──────────────────────────────── */
export interface SaveData {
  completed: number[];
  unlocked: number[];
  bestScores: Record<number, number>;
  totalImpact: number;
  districtRestored: number;
  soundMuted: boolean;
}

const SAVE_KEY = "eko_reboot_save_v2";

export function loadSave(): SaveData {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      const completed = Array.isArray(d.completed) ? d.completed : [];
      const unlocked = Array.isArray(d.unlocked) && d.unlocked.length
        ? d.unlocked
        : [1, ...completed.map((id) => id + 1).filter((id) => id <= 3)];
      return {
        completed,
        unlocked: Array.from(new Set([1, ...unlocked])).filter((id) => id >= 1 && id <= 3),
        bestScores: d.bestScores && typeof d.bestScores === "object" ? d.bestScores : {},
        totalImpact: typeof d.totalImpact === "number" ? d.totalImpact : 0,
        districtRestored: typeof d.districtRestored === "number"
          ? d.districtRestored
          : Math.round((completed.length / 3) * 100),
        soundMuted: d.soundMuted === true,
      };
    }
  } catch {
    /* corrupted save — start fresh */
  }
  return { completed: [], unlocked: [1], bestScores: {}, totalImpact: 0, districtRestored: 0, soundMuted: false };
}

export function recordMissionComplete(prev: SaveData, r: MissionResult): SaveData {
  const completed = prev.completed.includes(r.mission) ? prev.completed : [...prev.completed, r.mission];
  const unlocked = Array.from(new Set([...prev.unlocked, 1, r.mission, Math.min(3, r.mission + 1)]));
  return {
    ...prev,
    completed,
    unlocked,
    bestScores: { ...prev.bestScores, [r.mission]: Math.max(prev.bestScores[r.mission] ?? 0, r.score) },
    totalImpact: prev.totalImpact + r.impact,
    districtRestored: Math.round((completed.length / 3) * 100),
  };
}

export function persistSave(s: SaveData): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function impactLevel(total: number): { label: string; cls: string; tier: number } {
  if (total >= 900) return { label: "ECOLOGICAL BALANCE ACHIEVED", cls: "imp-max", tier: 3 };
  if (total >= 500) return { label: "GREENER FUTURE", cls: "imp-high", tier: 2 };
  if (total >= 150) return { label: "COMMUNITY IMPACT", cls: "imp-mid", tier: 1 };
  return { label: "FIRST STEPS", cls: "imp-low", tier: 0 };
}

/* ── Phaser bootstrap ────────────────────────────────────────────── */
export const StartGame = (parent: string): PhaserGame => {
  const game = new PhaserGame({
    type: AUTO,
    parent,
    backgroundColor: "#0b0f1e",
    scale: {
      mode: Scale.FIT,
      autoCenter: Scale.CENTER_BOTH,
      width: 960,
      height: 540,
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 900 }, debug: false },
    },
    input: { keyboard: true, mouse: true, touch: true },
    audio: { disableWebAudio: false },
    roundPixels: true,
    scene: [Game],
  });
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__PHASER_GAME__ = game;
    (window as unknown as Record<string, unknown>).__PHASER_EVENT_BUS__ = EventBus;
  }
  return game;
};

export default StartGame;