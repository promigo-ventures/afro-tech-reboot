import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import StartGame, {
    EventBus,
    EV_PHASE,
    EV_SCENE_READY,
    EV_HUD,
    EV_DIALOGUE,
    EV_START_MISSION,
    EV_TOGGLE_PAUSE,
    EV_RESTART,
    EV_TRIGGER_REPAIR,
    EV_TOGGLE_AUDIO,
    type HudState,
} from './game/main';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

interface Dialogue {
    speaker: string;
    text: string;
    mood?: string;
}

const EMPTY_HUD: HudState = {
    hp: 3,
    maxHp: 3,
    energyCells: 0,
    totalEnergyCells: 6,
    repairParts: 0,
    totalRepairParts: 4,
    score: 0,
    canRepair: false,
    repairProgress: 0,
    terminalFixed: false,
};

// Inline SVG icons (no icon library allowed).
const IconCell = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="#ffd600" stroke="#7a5b00" strokeWidth="1" />
    </svg>
);
const IconPart = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
            d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l-2-.4a7 7 0 00-.6-1.5l1-1.8-1.7-1.7-1.8 1a7 7 0 00-1.5-.6L14 3h-4l-.4 2a7 7 0 00-1.5.6l-1.8-1L4.6 6.3l1 1.8A7 7 0 005 9.6L3 10v4l2 .4a7 7 0 00.6 1.5l-1 1.8 1.7 1.7 1.8-1a7 7 0 001.5.6L10 21h4l.4-2a7 7 0 001.5-.6l1.8 1 1.7-1.7-1-1.8a7 7 0 00.6-1.5L21 14z"
            fill="#4dd0e1"
            stroke="#083344"
            strokeWidth="0.8"
        />
    </svg>
);
const IconHeart = ({ filled }: { filled: boolean }) => (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
            d="M12 21s-7-4.6-9.5-9C1 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 16.4 12 21 12 21z"
            fill={filled ? '#ff1744' : 'rgba(255,255,255,0.18)'}
            stroke={filled ? '#7a0010' : 'rgba(255,255,255,0.4)'}
            strokeWidth="1"
        />
    </svg>
);
const IconPause = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="6" y="5" width="4" height="14" rx="1" fill="#eafcff" />
        <rect x="14" y="5" width="4" height="14" rx="1" fill="#eafcff" />
    </svg>
);
const IconPlay = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M7 4v16l13-8z" fill="#eafcff" />
    </svg>
);
const IconSound = ({ muted }: { muted: boolean }) => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="#eafcff" />
        {muted ? (
            <path d="M16 9l5 6M21 9l-5 6" stroke="#eafcff" strokeWidth="2" fill="none" strokeLinecap="round" />
        ) : (
            <path d="M16 8a5 5 0 010 8M18.5 6a8 8 0 010 12" stroke="#eafcff" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
    </svg>
);
const IconWrench = () => (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path
            d="M21 6.5a5 5 0 01-6.6 6.6L7 20.5 3.5 17l7.4-7.4A5 5 0 0117.5 3l-3 3 1 3 3 1 2.5-3.5z"
            fill="#eafcff"
        />
    </svg>
);

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [phase, setPhase] = useState<string>('MENU');
    const [hud, setHud] = useState<HudState>(EMPTY_HUD);
    const [dialogue, setDialogue] = useState<Dialogue | null>(null);
    const [muted, setMuted] = useState(false);
    const dialogueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Mount the Phaser game into #game-container exactly once; destroy on unmount.
    useLayoutEffect(() => {
        if (phaserRef.current === null) {
            const game = StartGame('game-container');
            phaserRef.current = { game, scene: null };
        }
        const readyHandler = (scene: Phaser.Scene) => {
            if (phaserRef.current) phaserRef.current.scene = scene;
        };
        EventBus.on('current-scene-ready', readyHandler);
        return () => {
            EventBus.removeListener('current-scene-ready', readyHandler);
            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, []);

    // Subscribe to scene -> React state.
    useEffect(() => {
        const onPhase = (p: string) => setPhase(p);
        const onHud = (s: HudState) => setHud(s);
        const onDialogue = (d: Dialogue) => {
            setDialogue(d);
            if (dialogueTimer.current) clearTimeout(dialogueTimer.current);
            dialogueTimer.current = setTimeout(() => setDialogue(null), 4200);
        };
        EventBus.on(EV_PHASE, onPhase);
        EventBus.on(EV_HUD, onHud);
        EventBus.on(EV_DIALOGUE, onDialogue);
        return () => {
            EventBus.removeListener(EV_PHASE, onPhase);
            EventBus.removeListener(EV_HUD, onHud);
            EventBus.removeListener(EV_DIALOGUE, onDialogue);
            if (dialogueTimer.current) clearTimeout(dialogueTimer.current);
        };
    }, []);

    const playing = phase === 'PLAYING' || phase === 'REPAIRING';

    const startMission = () => EventBus.emit(EV_START_MISSION);
    const resume = () => EventBus.emit(EV_TOGGLE_PAUSE);
    const pause = () => EventBus.emit(EV_TOGGLE_PAUSE);
    const restart = () => EventBus.emit(EV_RESTART);
    const toggleAudio = () => {
        const next = !muted;
        setMuted(next);
        EventBus.emit(EV_TOGGLE_AUDIO, { muted: next });
    };

    // Touch controls -> scene.
    const moveDir = (dir: number) => EventBus.emit('touch-move', dir);
    const jumpPress = (press: boolean) => EventBus.emit('touch-jump', press);
    const repairPress = (press: boolean) => EventBus.emit(EV_TRIGGER_REPAIR, press);

    // Prevent touch buttons from also firing keyboard/click handlers or scrolling.
    const noGhost = (e: RPointerEvent) => {
        e.preventDefault();
        (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    };

    const hearts = [];
    for (let i = 0; i < hud.maxHp; i++) hearts.push(<IconHeart key={i} filled={i < hud.hp} />);

    return (
        <div id="app">
            {/* The Phaser canvas mounts into #game-container (src/game/main.ts). */}
            <div id="game-container"></div>

            <div id="hud">
                {/* ---------- Top HUD bar (only during play) ---------- */}
                {playing && (
                    <div className="hud-top">
                        <div className="hud-left">
                            <div className="hud-hearts">{hearts}</div>
                            <div className="hud-counters">
                                <span className="chip">
                                    <IconCell /> {hud.energyCells}/{hud.totalEnergyCells}
                                </span>
                                <span className="chip">
                                    <IconPart /> {hud.repairParts}/{hud.totalRepairParts}
                                </span>
                            </div>
                        </div>
                        <div className="hud-score">
                            <span className="score-label">SCORE</span>
                            <span className="score-value">{hud.score}</span>
                        </div>
                        <div className="hud-right">
                            <button className="icon-btn" onClick={toggleAudio} aria-label="Toggle sound">
                                <IconSound muted={muted} />
                            </button>
                            <button className="icon-btn" onClick={pause} aria-label="Pause">
                                <IconPause />
                            </button>
                        </div>
                    </div>
                )}

                {/* ---------- Companion dialogue bubble ---------- */}
                {dialogue && playing && (
                    <div className={`dialogue mood-${dialogue.mood || 'neutral'}`}>
                        <span className="dialogue-speaker">{dialogue.speaker}</span>
                        <span className="dialogue-text">{dialogue.text}</span>
                    </div>
                )}

                {/* ---------- Repair prompt + progress ---------- */}
                {playing && hud.canRepair && !hud.terminalFixed && (
                    <div className="repair-prompt">
                        {hud.repairProgress > 0 ? (
                            <div className="repair-bar">
                                <div className="repair-fill" style={{ width: `${hud.repairProgress}%` }} />
                                <span>REBOOTING TERMINAL… {hud.repairProgress}%</span>
                            </div>
                        ) : (
                            <span className="repair-hint">Hold REPAIR at the Central Terminal to reboot the grid</span>
                        )}
                    </div>
                )}

                {/* ---------- Mobile touch controls ---------- */}
                {playing && (
                    <div className="touch-controls">
                        <div className="touch-pad">
                            <button
                                className="touch-btn"
                                onPointerDown={(e) => { noGhost(e); moveDir(-1); }}
                                onPointerUp={() => moveDir(0)}
                                onPointerLeave={() => moveDir(0)}
                                onPointerCancel={() => moveDir(0)}
                                aria-label="Move left"
                            >
                                ◀
                            </button>
                            <button
                                className="touch-btn"
                                onPointerDown={(e) => { noGhost(e); moveDir(1); }}
                                onPointerUp={() => moveDir(0)}
                                onPointerLeave={() => moveDir(0)}
                                onPointerCancel={() => moveDir(0)}
                                aria-label="Move right"
                            >
                                ▶
                            </button>
                        </div>
                        <div className="touch-actions">
                            {hud.canRepair && !hud.terminalFixed && (
                                <button
                                    className="touch-btn repair-btn"
                                    onPointerDown={(e) => { noGhost(e); repairPress(true); }}
                                    onPointerUp={() => repairPress(false)}
                                    onPointerLeave={() => repairPress(false)}
                                    onPointerCancel={() => repairPress(false)}
                                    aria-label="Repair"
                                >
                                    <IconWrench />
                                </button>
                            )}
                            <button
                                className="touch-btn jump-btn"
                                onPointerDown={(e) => { noGhost(e); jumpPress(true); }}
                                onPointerUp={() => jumpPress(false)}
                                onPointerLeave={() => jumpPress(false)}
                                onPointerCancel={() => jumpPress(false)}
                                aria-label="Jump"
                            >
                                ▲
                            </button>
                        </div>
                    </div>
                )}

                {/* ---------- MENU ---------- */}
                {phase === 'MENU' && (
                    <div className="overlay">
                        <div className="panel">
                            <p className="eyebrow">NEAR-FUTURE LAGOS · NIGERIA</p>
                            <h1 className="title">
                                EKO <span>REBOOT</span>
                            </h1>
                            <p className="tagline">Fix the City. Build the Future.</p>
                            <p className="blurb">
                                An Afrofuturistic repair adventure. Run, jump and double-jump across the Lagos Smart
                                Market, recover the Energy Cells and Repair Parts, dodge rogue drones, and reboot the
                                Central Terminal with your companion Kobo.
                            </p>
                            <button className="btn-primary" onClick={startMission}>
                                START MISSION
                            </button>
                            <p className="hint">Desktop: A/D or ← → move · Space/W jump · E/F repair · P pause</p>
                        </div>
                    </div>
                )}

                {/* ---------- STORY INTRO ---------- */}
                {phase === 'STORY_INTRO' && (
                    <div className="overlay">
                        <div className="panel">
                            <p className="eyebrow">MISSION BRIEF</p>
                            <h2 className="title-sm">The Grid is Failing</h2>
                            <p className="blurb">
                                Lagos' Smart Market powers millions. A cascade fault has knocked the Central Terminal
                                offline. You are <strong>Tobi</strong>, a young inventor; your drone companion{' '}
                                <strong>Kobo</strong> is with you. Gather <strong>6 Energy Cells</strong> and{' '}
                                <strong>4 Repair Parts</strong> scattered across the rooftops and bridges, then reach
                                the terminal to reboot the city's future.
                            </p>
                            <button className="btn-primary" onClick={startMission}>
                                BEGIN MISSION
                            </button>
                        </div>
                    </div>
                )}

                {/* ---------- PAUSED ---------- */}
                {phase === 'PAUSED' && (
                    <div className="overlay">
                        <div className="panel">
                            <h2 className="title-sm">Paused</h2>
                            <p className="blurb">The market holds its breath.</p>
                            <div className="btn-row">
                                <button className="btn-primary" onClick={resume}>
                                    <IconPlay /> RESUME
                                </button>
                                <button className="btn-ghost" onClick={restart}>
                                    RESTART
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- GAME OVER ---------- */}
                {phase === 'GAME_OVER' && (
                    <div className="overlay">
                        <div className="panel">
                            <p className="eyebrow danger">SYSTEMS DOWN</p>
                            <h2 className="title-sm">The Grid Went Dark</h2>
                            <p className="blurb">
                                Kobo kept the data: <strong>{hud.score}</strong> points, {hud.energyCells}/
                                {hud.totalEnergyCells} cells, {hud.repairParts}/{hud.totalRepairParts} parts.
                            </p>
                            <button className="btn-primary" onClick={restart}>
                                RETRY MISSION
                            </button>
                        </div>
                    </div>
                )}

                {/* ---------- MISSION COMPLETE ---------- */}
                {phase === 'MISSION_COMPLETE' && (
                    <div className="overlay">
                        <div className="panel">
                            <p className="eyebrow success">POWER RESTORED</p>
                            <h2 className="title-sm">The Smart Market Lives Again</h2>
                            <p className="blurb">
                                You rebooted the Central Terminal. Final score:{' '}
                                <strong>{hud.score}</strong>. Lagos shines brighter tonight.
                            </p>
                            <button className="btn-primary" onClick={restart}>
                                PLAY AGAIN
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;