import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import {
  StartGame,
  EventBus,
  EVT_PHASE_CHANGED,
  EVT_CURRENT_SCENE_READY,
  EVT_HUD,
  EVT_MISSION_COMPLETE,
  EVT_GAME_OVER,
  EVT_SET_TOUCH,
  EVT_JUMP,
  EVT_ACTION,
  EVT_RESTART_MISSION,
  EVT_RESUME,
  EVT_GO_TO_MENU,
  EVT_START_MISSION,
  EVT_TOGGLE_MUTE,
  MISSIONS,
  loadSave,
  persistSave,
  impactLevel,
  type GamePhase,
  type HudState,
  type MissionResult,
  type SaveData,
} from "./game/main";

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface Dialogue {
  speaker: string;
  text: string;
}

const MENU_LINES: Dialogue[] = [
  { speaker: "ZURI", text: "Eko City is dying — its grid, its markets, its water. The old systems were never rebooted." },
  { speaker: "ZURI", text: "You are the last engineer. Three districts. Three chances to bring them back to life." },
  { speaker: "EKO", text: "Systems nominal. Let's get to work." },
];

const MISSION_INTRO: Record<number, Dialogue[]> = {
  1: [
    { speaker: "ZURI", text: "Mission 1 — Smart Market. The Old Quarter's sensor mesh is offline. Collect 5 Energy Cells." },
    { speaker: "EKO", text: "Drones patrol the rooftops. Land on them from above to neutralize them." },
    { speaker: "ZURI", text: "Repair 3 parts, then reach the Smart Market Terminal and hold [E] to reboot the network." },
  ],
  2: [
    { speaker: "ZURI", text: "Mission 2 — Solar Grid. The rooftop array is starving for power. Recover 8 Solar Cores." },
    { speaker: "EKO", text: "Energy bridges flicker in and out. Time your crossings." },
    { speaker: "ZURI", text: "Repair the 3 Solar Stations, then interface with the grid terminal." },
  ],
  3: [
    { speaker: "ZURI", text: "Mission 3 — Waterfront. The AI purification plant is under lockdown. Install 10 Network Chips." },
    { speaker: "EKO", text: "An Elite Drone guards the terminal. Six stomps to take it down." },
    { speaker: "ZURI", text: "Reboot the Central AI Terminal, Eko. The city is watching." },
  ],
};

const VICTORY_LINES: Dialogue[] = [
  { speaker: "ZURI", text: "All three districts are online. The grid is humming again." },
  { speaker: "EKO", text: "This is just the beginning. Eko City will shine again." },
  { speaker: "ZURI", text: "Impact Level: ECOLOGICAL BALANCE ACHIEVED." },
];

function Typewriter({ line }: { line: Dialogue }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const id = window.setInterval(() => {
      setShown((s) => {
        if (s >= line.text.length) {
          window.clearInterval(id);
          return s;
        }
        return s + 1;
      });
    }, 22);
    return () => window.clearInterval(id);
  }, [line]);
  return (
    <div className="dlg-line">
      <span className="dlg-speaker">{line.speaker}</span>
      <span className="dlg-text">{line.text.slice(0, shown)}</span>
    </div>
  );
}

function DialogueBox({ lines, onDone, label }: { lines: Dialogue[]; onDone: () => void; label?: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [lines]);
  const last = idx >= lines.length - 1;
  const advance = useCallback(() => { if (!last) setIdx(idx + 1); else onDone(); }, [last, idx, onDone]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);
  const onDlgKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); }
  };
  return (
    <div className="dlg-box" role="button" tabIndex={0} aria-label={last ? (label ?? "Continue") : "Next line"} onClick={advance} onKeyDown={onDlgKey}>
      <Typewriter line={lines[idx]} />
      <button className="dlg-next" onClick={(e) => { e.stopPropagation(); advance(); }}>
        {last ? (label ?? "Continue") : "Next ▸"}
      </button>
    </div>
  );
}

const IconSoundOn = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" /></svg>
);
const IconSoundOff = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06a7 7 0 0 1 0 13.42zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.9 8.9 0 0 0 3.66-1.87L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z" /></svg>
);
const IconPause = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
);

export default function App() {
  const phaserRef = useRef<IRefPhaserGame>({ game: null, scene: null });
  const [phase, setPhase] = useState<GamePhase>("BOOT");
  const [hud, setHud] = useState<HudState | null>(null);
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [result, setResult] = useState<MissionResult | null>(null);
  const [introMission, setIntroMission] = useState<number | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const muteApplied = useRef(false);

  useLayoutEffect(() => {
    const game = StartGame("game-container");
    phaserRef.current.game = game;
    return () => {
      if (phaserRef.current.game) phaserRef.current.game.destroy(true);
      phaserRef.current.game = null;
      phaserRef.current.scene = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0)) {
      setIsTouch(true);
    }
    const onSceneReady = (scene: Phaser.Scene) => {
      phaserRef.current.scene = scene;
      // Apply persisted mute preference exactly once when the scene is ready.
      if (!muteApplied.current) {
        muteApplied.current = true;
        if (save.soundMuted) EventBus.emit(EVT_TOGGLE_MUTE);
      }
    };
    const onPhase = (p: GamePhase) => {
      setPhase(p);
      if (p === "PLAYING") { setIntroMission(null); setShowSettings(false); }
    };
    const onHud = (h: HudState) => setHud(h);
    const onComplete = (r: MissionResult) => {
      setResult(r);
      setSave((prev) => {
        const next: SaveData = {
          completed: prev.completed.includes(r.mission) ? prev.completed : [...prev.completed, r.mission],
          bestScores: { ...prev.bestScores, [r.mission]: Math.max(prev.bestScores[r.mission] ?? 0, r.score) },
          totalImpact: prev.totalImpact + r.impact,
          soundMuted: prev.soundMuted,
        };
        persistSave(next);
        return next;
      });
    };
    const onGameOver = () => setResult(null);
    const onMuteState = (m: boolean) => {
      setMuted(m);
      setSave((prev) => {
        const next: SaveData = { ...prev, soundMuted: m };
        persistSave(next);
        return next;
      });
    };
    EventBus.on(EVT_CURRENT_SCENE_READY, onSceneReady);
    EventBus.on(EVT_PHASE_CHANGED, onPhase);
    EventBus.on(EVT_HUD, onHud);
    EventBus.on(EVT_MISSION_COMPLETE, onComplete);
    EventBus.on(EVT_GAME_OVER, onGameOver);
    EventBus.on("mute-state", onMuteState);
    setPhase("MENU");
    return () => {
      EventBus.off(EVT_CURRENT_SCENE_READY, onSceneReady);
      EventBus.off(EVT_PHASE_CHANGED, onPhase);
      EventBus.off(EVT_HUD, onHud);
      EventBus.off(EVT_MISSION_COMPLETE, onComplete);
      EventBus.off(EVT_GAME_OVER, onGameOver);
      EventBus.off("mute-state", onMuteState);
    };
  }, [save.soundMuted]);

  const startMission = (id: number) => {
    setIntroMission(id);
    setPhase("BRIEFING");
  };

  // Deploy: launch the selected mission immediately (sets React phase + starts the Phaser scene).
  const launchScene = (id: number) => {
    setIntroMission(null);
    setResult(null);
    setPhase("PLAYING");
    EventBus.emit(EVT_START_MISSION, id);
  };

  const togglePause = () => {
    if (phase === "PLAYING") {
      setPhase("PAUSED");
      EventBus.emit(EVT_PHASE_CHANGED, "PAUSED");
    } else if (phase === "PAUSED") {
      setPhase("PLAYING");
      EventBus.emit(EVT_RESUME);
    }
  };

  const toMenu = () => {
    setResult(null);
    setHud(null);
    setShowSettings(false);
    setPhase("MENU");
    EventBus.emit(EVT_GO_TO_MENU);
  };

  const locked = (id: number) => id > 1 && !save.completed.includes(id - 1);
  const impact = impactLevel(save.totalImpact);
  const cellLabel = hud ? (MISSIONS[hud.mission - 1]?.cellLabel ?? "Cells") : "Cells";
  const repairLabel = hud ? (MISSIONS[hud.mission - 1]?.repairLabel ?? "Repairs") : "Repairs";

  const hold = (evt: string, down: boolean) => (e: RPointerEvent) => {
    e.preventDefault();
    const [name, arg] = evt.split("|");
    if (arg !== undefined) EventBus.emit(name, arg, down);
    else EventBus.emit(name, down);
  };

  const btn = (cls: string, txt: string, evt: string) => (
    <button
      className={`touch-btn ${cls}`}
      onPointerDown={hold(evt, true)}
      onPointerUp={hold(evt, false)}
      onPointerCancel={hold(evt, false)}
      onPointerLeave={hold(evt, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {txt}
    </button>
  );

  return (
    <div id="app-shell">
      <div id="game-container" />

      {/* HUD — top-left stats, top-center objective, top-right controls (zero overlap) */}
      {(phase === "PLAYING" || phase === "PAUSED") && hud && (
        <div id="hud">
          <div className="hud-left">
            <div className="hud-score">{hud.score.toString().padStart(6, "0")}</div>
            <div className="hud-hp" aria-label={`Health ${hud.hp} of 3`}>
              {"♥".repeat(Math.max(0, hud.hp))}{"♡".repeat(Math.max(0, 3 - hud.hp))}
            </div>
            <div className="hud-counters">
              <span className="hud-count">⚡ {cellLabel} {hud.cells}/{hud.cellsTotal}</span>
              <span className="hud-count">🔧 {repairLabel} {hud.repairs}/{hud.repairsTotal}</span>
            </div>
          </div>
          <div className="hud-center">
            <div className="hud-mission">{MISSIONS[hud.mission - 1]?.name ?? "EKO"}</div>
            <div className="hud-objective">{hud.objective}</div>
            {hud.bossHp > 0 && (
              <div className="boss-bar"><div className="boss-fill" style={{ width: `${(hud.bossHp / Math.max(1, hud.bossHpMax)) * 100}%` }} /></div>
            )}
          </div>
          <div className="hud-right">
            <button className="hud-btn icon-btn" aria-label={muted ? "Unmute sound" : "Mute sound"} onClick={() => EventBus.emit(EVT_TOGGLE_MUTE)}>
              {muted ? <IconSoundOff /> : <IconSoundOn />}
            </button>
            <button className="hud-btn icon-btn" aria-label="Pause" onClick={togglePause}>
              <IconPause />
            </button>
          </div>
        </div>
      )}

      {/* MENU */}
      {phase === "MENU" && (
        <div className="overlay menu-overlay">
          <div className="menu-grid">
            <div className="menu-left">
              <h1 className="title">EKO <span>REBOOT</span></h1>
              <p className="subtitle">An Afro-Futuristic Platformer</p>
              <div className="save-stats">
                <div><span>Impact</span><b className={impact.cls}>{impact.label}</b></div>
                <div><span>Districts</span><b>{save.completed.length}/3</b></div>
                <div><span>Total Best</span><b>{Object.values(save.bestScores).reduce((a, b) => a + b, 0)}</b></div>
              </div>
              <DialogueBox lines={MENU_LINES} onDone={() => setPhase("MENU")} label="Select Mission ▸" />
            </div>
            <div className="mission-list">
              {MISSIONS.map((m) => (
                <button
                  key={m.id}
                  className={`mission-card ${locked(m.id) ? "locked" : ""}`}
                  disabled={locked(m.id)}
                  onClick={() => startMission(m.id)}
                >
                  <div className="mc-num">0{m.id}</div>
                  <div className="mc-body">
                    <div className="mc-name">{m.name}</div>
                    <div className="mc-desc">{m.desc}</div>
                    <div className="mc-meta">⚡{m.cells} 🔧{m.repairs} 🤖{m.drones}{m.boss ? "+BOSS" : ""} · {m.worldW / 1000}km</div>
                  </div>
                  <div className="mc-status">
                    {locked(m.id) ? "🔒" : save.completed.includes(m.id) ? "✅" : "▶"}
                    {save.bestScores[m.id] ? <em>{save.bestScores[m.id]}</em> : null}
                  </div>
                </button>
              ))}
              <button className="mission-card howto" onClick={() => setPhase("HOW_TO_PLAY")}>
                <div className="mc-num">?</div>
                <div className="mc-body"><div className="mc-name">How to Play</div><div className="mc-desc">Controls & tips</div></div>
                <div className="mc-status">▶</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BRIEFING */}
      {phase === "BRIEFING" && introMission !== null && (
        <div className="overlay">
          <div className="panel">
            <h2>Mission {introMission} — {MISSIONS[introMission - 1].name}</h2>
            <DialogueBox lines={MISSION_INTRO[introMission]} onDone={() => launchScene(introMission)} label="Deploy EKO ▸" />
          </div>
        </div>
      )}

      {/* HOW TO PLAY */}
      {phase === "HOW_TO_PLAY" && (
        <div className="overlay">
          <div className="panel">
            <h2>How to Play</h2>
            <ul className="rules">
              <li><b>A / D</b> or <b>← →</b> — run</li>
              <li><b>SPACE / W / ↑</b> — jump (press again mid-air for double jump)</li>
              <li><b>E / K</b> — repair station & interface with terminal</li>
              <li><b>P / Esc</b> — pause</li>
              <li><b>Stomp</b> drones from above to destroy them</li>
              <li>Side contact costs 1 HP — you have 3</li>
              <li>Energy bridges blink — cross while they glow</li>
              <li>Touch: use the on-screen pad (left/right/jump/repair)</li>
            </ul>
            <button className="cta" onClick={() => setPhase("MENU")}>◂ Back</button>
          </div>
        </div>
      )}

      {/* PAUSED */}
      {phase === "PAUSED" && (
        <div className="overlay dim">
          <div className="panel center">
            {!showSettings ? (
              <>
                <h2>PAUSED</h2>
                <button className="cta" onClick={togglePause}>RESUME</button>
                <button className="cta secondary" onClick={() => { setPhase("PLAYING"); EventBus.emit(EVT_RESTART_MISSION); }}>RESTART MISSION</button>
                <button className="cta secondary" onClick={toMenu}>MISSION SELECT</button>
                <button className="cta secondary" onClick={() => setShowSettings(true)}>SETTINGS</button>
              </>
            ) : (
              <>
                <h2>SETTINGS</h2>
                <button className="cta secondary" onClick={() => EventBus.emit(EVT_TOGGLE_MUTE)}>{muted ? "SOUND: OFF" : "SOUND: ON"}</button>
                <ul className="rules" style={{ textAlign: "left" }}>
                  <li><b>A / D / ← / →</b> — move</li>
                  <li><b>SPACE / W / ↑</b> — jump & double jump</li>
                  <li><b>E / K</b> — repair / interface</li>
                  <li><b>P / Esc</b> — pause</li>
                </ul>
                <button className="cta" onClick={() => setShowSettings(false)}>◂ BACK</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* GAME OVER */}
      {phase === "GAME_OVER" && (
        <div className="overlay dim">
          <div className="panel center">
            <h2 className="danger">SYSTEM FAILURE</h2>
            <p className="score-line">Score {hud?.score ?? 0}</p>
            <button className="cta" onClick={() => { setPhase("PLAYING"); EventBus.emit(EVT_RESTART_MISSION); }}>RETRY MISSION</button>
            <button className="cta secondary" onClick={toMenu}>MAIN MENU</button>
          </div>
        </div>
      )}

      {/* MISSION COMPLETE */}
      {phase === "MISSION_COMPLETE" && result && (
        <div className="overlay">
          <div className="panel center">
            <h2 className="success">DISTRICT REBOOTED</h2>
            <p className="impact-line">+{result.impact} IMPACT — {impactLevel(save.totalImpact).label}</p>
            <p className="score-line">Mission Score {result.score}</p>
            {result.nextUnlocked && <p className="unlock-line">Next district unlocked!</p>}
            <button className="cta" onClick={() => startMission(Math.min(3, result.mission + 1))}>NEXT MISSION ▸</button>
            <button className="cta secondary" onClick={() => { setPhase("PLAYING"); EventBus.emit(EVT_RESTART_MISSION); }}>REPLAY</button>
            <button className="cta secondary" onClick={toMenu}>MAIN MENU</button>
          </div>
        </div>
      )}

      {/* VICTORY */}
      {phase === "VICTORY_CINEMATIC" && (
        <div className="overlay victory">
          <div className="panel center">
            <h1 className="title small">EKO <span>REBOOT</span></h1>
            <h2 className="success">LAGOS SMART CITY RESTORED</h2>
            <DialogueBox lines={VICTORY_LINES} onDone={toMenu} label="Return to Menu ▸" />
            <p className="score-line">Final Impact {save.totalImpact} · Total Best {Object.values(save.bestScores).reduce((a, b) => a + b, 0)}</p>
          </div>
        </div>
      )}

      {/* TOUCH CONTROLS */}
      {isTouch && (phase === "PLAYING") && (
        <div id="touch-controls">
          <div className="touch-left">
            {btn("t-dir", "◀", EVT_SET_TOUCH + "|left")}
            {btn("t-dir", "▶", EVT_SET_TOUCH + "|right")}
          </div>
          <div className="touch-right">
            <button className="touch-btn t-act" aria-label="Repair" onPointerDown={(e) => { e.preventDefault(); EventBus.emit(EVT_ACTION, true); }} onPointerUp={(e) => { e.preventDefault(); EventBus.emit(EVT_ACTION, false); }} onPointerCancel={() => EventBus.emit(EVT_ACTION, false)} onPointerLeave={() => EventBus.emit(EVT_ACTION, false)}>⚡</button>
            <button className="touch-btn t-jump" aria-label="Jump" onPointerDown={(e) => { e.preventDefault(); EventBus.emit(EVT_JUMP, true); }}>▲</button>
          </div>
        </div>
      )}
    </div>
  );
}
