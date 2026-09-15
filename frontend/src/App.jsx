import { useRef, useState, useCallback, useEffect } from 'react'
import {
  Apple,
  CloudRain,
  Swords,
  Sparkles,
  Orbit,
  Play,
  LogOut,
  Zap,
  Square,
  Target,
  Check,
  Volume2,
  VolumeX,
  RefreshCw,
  RotateCcw,
  CameraOff,
  Hand,
  Settings,
  Footprints,
  ScanLine,
  Printer,
} from 'lucide-react'
import CameraFeed from './components/CameraFeed.jsx'
import ARScene from './components/ARScene.jsx'
import MarkerARScene from './components/MarkerARScene.jsx'
import MarkerCard from './components/MarkerCard.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import './App.css'

const ASSETS = [
  { id: 'marker_elephant', title: 'Marker AR 🆕', Icon: ScanLine, iconColor: 'text-amber-300', url: null, baseScale: 1.0, style: 'marker', styleLabel: 'Print & Scan Marker' },
  { id: 'apple', title: 'Apple Catcher', Icon: Apple, iconColor: 'text-red-500', url: 'assets/apple.glb', baseScale: 0.45, style: 'palm', styleLabel: 'Basket Palm' },
  { id: 'spot_shower', title: 'Spot Shower Mode', Icon: CloudRain, iconColor: 'text-cyan-400', url: null, baseScale: 1.0, style: 'ground_spot', styleLabel: 'Ground Spot Zone' },
  { id: 'elephant', title: 'Safari Elephant', Icon: Footprints, iconColor: 'text-emerald-400', url: 'assets/Elephant_Turn_Walk.glb', baseScale: 0.8, style: 'ground_spot', styleLabel: 'Ground Spot AR' },
  { id: 'ninja', title: 'Fruit Ninja', Icon: Swords, iconColor: 'text-amber-400', url: null, baseScale: 0.8, style: 'grip', styleLabel: 'Katana Grip' },
  { id: 'ring', title: 'Diamond Ring', Icon: Sparkles, iconColor: 'text-yellow-300', url: null, baseScale: 0.8, style: 'finger', styleLabel: 'Finger Anchor' },
  { id: 'crystal', title: 'Mystic Crystal', Icon: Orbit, iconColor: 'text-purple-400', url: null, baseScale: 1.2, style: 'hover', styleLabel: 'Floating Anchor' },
]

const STATUS = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  ACTIVE: 'active',
  ERROR: 'error',
}

// Simple synthesizer for game sounds using Web Audio API
export const playSound = (type, isMuted = false, volume = 1.0) => {
  if (isMuted || volume <= 0) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    const now = ctx.currentTime
    const masterVol = Math.max(0, Math.min(1, volume))

    if (type === 'pop') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(400, now)
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.1)
      gain.gain.setValueAtTime(0.3, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12)
      osc.start(now)
      osc.stop(now + 0.12)
    } else if (type === 'shower') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(500 + Math.random() * 400, now)
      osc.frequency.exponentialRampToValueAtTime(1000 + Math.random() * 300, now + 0.08)
      gain.gain.setValueAtTime(0.25, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09)
      osc.start(now)
      osc.stop(now + 0.09)
    } else if (type === 'slice') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(800, now)
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.15)
      gain.gain.setValueAtTime(0.4, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15)
      osc.start(now)
      osc.stop(now + 0.15)
    } else if (type === 'click') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(600, now)
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05)
      gain.gain.setValueAtTime(0.2, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06)
      osc.start(now)
      osc.stop(now + 0.06)
    } else if (type === 'milestone') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(523.25, now)
      osc.frequency.setValueAtTime(659.25, now + 0.08)
      osc.frequency.setValueAtTime(783.99, now + 0.16)
      osc.frequency.setValueAtTime(1046.50, now + 0.24)
      gain.gain.setValueAtTime(0.25, now)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4)
      osc.start(now)
      osc.stop(now + 0.4)
    }
  } catch (e) {
    console.error('Audio failed to play:', e)
  }
}

export default function App() {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [showMarkerCard, setShowMarkerCard] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [facingMode, setFacingMode] = useState('user') 
  const [assetIndex, setAssetIndex] = useState(0)
  const asset = ASSETS[assetIndex] || ASSETS[0]
  const [resetTick, setResetTick] = useState(0)
  const [handResults, setHandResults] = useState(null)
  const [score, setScore] = useState(0)
  const [scoreBump, setScoreBump] = useState(false)
  const videoRef = useRef(null)

  // Hardware & Media Settings State (Persistent in localStorage)
  const [selectedCamera, setSelectedCamera] = useState(() => localStorage.getItem('cb_ar_camera') || '')
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem('cb_ar_mic') || '')
  const [selectedSpeaker, setSelectedSpeaker] = useState(() => localStorage.getItem('cb_ar_speaker') || '')
  const [cameraResolution, setCameraResolution] = useState(() => localStorage.getItem('cb_ar_resolution') || '720p')
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem('cb_ar_volume') || '1.0'))
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('cb_ar_muted') === 'true')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Browser & Graphics Performance Settings (Persistent in localStorage)
  const [perfPreset, setPerfPreset] = useState(() => localStorage.getItem('cb_ar_perf_preset') || 'fast')
  const [trackingFps, setTrackingFps] = useState(() => parseInt(localStorage.getItem('cb_ar_tracking_fps') || '20'))
  const [enableParticles, setEnableParticles] = useState(() => localStorage.getItem('cb_ar_particles') !== 'false')

  useEffect(() => {
    if (selectedCamera) localStorage.setItem('cb_ar_camera', selectedCamera)
  }, [selectedCamera])

  useEffect(() => {
    if (selectedMic) localStorage.setItem('cb_ar_mic', selectedMic)
  }, [selectedMic])

  useEffect(() => {
    if (selectedSpeaker) localStorage.setItem('cb_ar_speaker', selectedSpeaker)
  }, [selectedSpeaker])

  useEffect(() => {
    localStorage.setItem('cb_ar_resolution', cameraResolution)
  }, [cameraResolution])

  useEffect(() => {
    localStorage.setItem('cb_ar_volume', volume.toString())
  }, [volume])

  useEffect(() => {
    localStorage.setItem('cb_ar_muted', isMuted ? 'true' : 'false')
  }, [isMuted])

  useEffect(() => {
    localStorage.setItem('cb_ar_perf_preset', perfPreset)
  }, [perfPreset])

  useEffect(() => {
    localStorage.setItem('cb_ar_tracking_fps', trackingFps.toString())
  }, [trackingFps])

  useEffect(() => {
    localStorage.setItem('cb_ar_particles', enableParticles ? 'true' : 'false')
  }, [enableParticles])

  const maxDpr = perfPreset === 'quality' ? 1.5 : perfPreset === 'balanced' ? 1.25 : 1.0
  const trackingResolution = perfPreset === 'quality' ? '480x360' : perfPreset === 'balanced' ? '360x270' : '320x240'

  const playAppSound = (type) => playSound(type, isMuted, volume)

  // Ground spot config state (persistent in localStorage)
  const [spotConfig, setSpotConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('chotabheem_ground_spot')
      if (saved) return {
        walkRadius: 1.2, elephantScale: 1.0, walkSpeed: 0.20,
        ...JSON.parse(saved),
      }
    } catch (e) {}
    return { x: 0, y: -0.6, radius: 0.7, walkRadius: 1.2, elephantScale: 1.0, walkSpeed: 0.20 }
  })
  const [isConfiguringSpot, setIsConfiguringSpot] = useState(false)
  const [isSpotTriggered, setIsSpotTriggered] = useState(false)

  const handleUpdateSpotConfig = (newCfg) => {
    setSpotConfig(newCfg)
    localStorage.setItem('chotabheem_ground_spot', JSON.stringify(newCfg))
  }

  const handleStart = useCallback(() => {
    // Marker mode: MindAR handles its own camera — go straight to ACTIVE
    if (ASSETS[assetIndex]?.id === 'marker_elephant') {
      setStatus(STATUS.ACTIVE)
    } else {
      setStatus(STATUS.REQUESTING)
    }
    setErrorMsg('')
  }, [assetIndex])

  const handleReady = useCallback(() => {
    setStatus(STATUS.ACTIVE)
  }, [])

  const handleError = useCallback((msg) => {
    setErrorMsg(msg)
    setStatus(STATUS.ERROR)
  }, [])

  const flipCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
  }, [])

  const handleExit = useCallback(() => {
    setStatus(STATUS.IDLE)
    setHandResults(null)
    setScore(0)
    setIsConfiguringSpot(false)
    setShowMarkerCard(false)
  }, [])

  const handleReset = useCallback(() => {
    setResetTick((t) => t + 1)
    playAppSound('pop')
  }, [isMuted, volume])

  const handleScore = useCallback(() => {
    setScore((s) => {
      const newScore = s + 1
      if (newScore > 0 && newScore % 5 === 0) {
        playAppSound('milestone')
      } else {
        playAppSound(asset.id === 'ninja' ? 'slice' : asset.id === 'spot_shower' ? 'shower' : 'pop')
      }
      return newScore
    })
    setScoreBump(true)
    setTimeout(() => setScoreBump(false), 200)
  }, [asset.id, isMuted, volume])

  const isCameraLive = status === STATUS.REQUESTING || status === STATUS.ACTIVE
  const isMarkerMode = asset?.id === 'marker_elephant'
  const hasHand = handResults?.multiHandLandmarks && handResults.multiHandLandmarks.length > 0

  // Show printable card overlay
  if (showMarkerCard) {
    return <MarkerCard onBack={() => setShowMarkerCard(false)} />
  }

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_center,#1b203a_0%,#0c0f1d_100%)]">
      {/* MindAR Marker Mode — MindAR owns the camera & canvas entirely */}
      {isCameraLive && isMarkerMode && (
        <MarkerARScene
          onExit={handleExit}
          isMuted={isMuted}
        />
      )}

      {/* Standard R3F modes — camera feed + Three.js canvas */}
      {isCameraLive && !isMarkerMode && (
        <>
          <CameraFeed
            ref={videoRef}
            facingMode={facingMode}
            selectedCamera={selectedCamera}
            cameraResolution={cameraResolution}
            trackingFps={trackingFps}
            trackingResolution={trackingResolution}
            onReady={handleReady}
            onError={handleError}
            onHandResults={setHandResults}
          />
          <ARScene
            asset={asset}
            resetSignal={resetTick}
            handResults={handResults}
            onScore={handleScore}
            isMuted={isMuted}
            score={score}
            spotConfig={spotConfig}
            onUpdateSpotConfig={handleUpdateSpotConfig}
            isConfiguringSpot={isConfiguringSpot}
            onSpotTriggerChange={setIsSpotTriggered}
            isSpotTriggered={isSpotTriggered}
            videoRef={videoRef}
            maxDpr={maxDpr}
            enableParticles={enableParticles}
          />
        </>
      )}

      {/* IDLE / DASHBOARD LANDING SCREEN (LIGHTWEIGHT WITH LUCIDE ICONS) */}
      {status === STATUS.IDLE && (
        <div className="relative z-10 h-full flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
          {/* Top Bar Settings & Audio Button */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
            <button
              onClick={() => {
                playAppSound('click')
                setIsSettingsOpen(true)
              }}
              className="bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-amber-300 px-3.5 py-2 rounded-2xl border border-white/10 hover:border-amber-400/50 font-bold text-xs tracking-wide transition-all shadow-xl flex items-center gap-2"
              title="Hardware & Media Settings"
            >
              <Settings className="w-4 h-4 text-indigo-400" />
              <span>Settings</span>
            </button>
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-white/10 p-2.5 rounded-2xl transition-all shadow-xl"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-amber-300" />}
            </button>
          </div>

          <div className="w-full max-w-[480px] flex flex-col items-center gap-6 my-auto">
            {/* Header Title */}
            <div className="flex flex-col items-center text-center gap-1.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
                <h1 className="text-[28px] font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 animate-float-title drop-shadow-[0_4px_16px_rgba(255,193,7,0.4)]">
                  CHHOTA BHEEM AR
                </h1>
                <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
              </div>
              <p className="text-[13px] text-slate-400 mono">
                Select an AR Game Mode to Play
              </p>
            </div>

            {/* AR Game Cards List */}
            <div className="w-full flex flex-col gap-3">
              {ASSETS.map((ast, idx) => {
                const ModeIcon = ast.Icon
                const isMarkerEntry = ast.id === 'marker_elephant'
                return (
                  <div
                    key={ast.id}
                    className={`glass-panel p-4 rounded-[22px] border flex items-center justify-between gap-4 transition-all hover:bg-slate-900/90 shadow-lg ${
                      isMarkerEntry
                        ? 'border-amber-400/60 bg-gradient-to-r from-amber-950/40 to-orange-950/30 hover:border-amber-300'
                        : 'border-white/10 hover:border-amber-400/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 text-left">
                      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
                        isMarkerEntry ? 'bg-amber-900/60 border-amber-500/50' : 'bg-slate-800/90 border-slate-700/80'
                      }`}>
                        <ModeIcon className={`w-5 h-5 ${ast.iconColor}`} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[15px] font-black text-amber-300">
                          {ast.title}
                        </span>
                        <span className="text-[11px] text-slate-400 mono">
                          {ast.styleLabel || 'Interactive AR'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Print Card shortcut for marker mode */}
                      {isMarkerEntry && (
                        <button
                          className="bg-slate-800/90 text-slate-300 border border-slate-600/80 px-2.5 py-2 rounded-[14px] text-[11px] font-bold flex items-center gap-1 transition-all hover:text-amber-300 hover:border-amber-400/50"
                          onClick={(e) => {
                            e.stopPropagation()
                            playSound('click', isMuted)
                            setShowMarkerCard(true)
                          }}
                          title="Print the AR Marker Card"
                        >
                          <Printer className="w-3 h-3" /> Card
                        </button>
                      )}
                      <button
                        className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-4 py-2.5 rounded-[18px] font-black text-[13px] tracking-wide shadow-[0_4px_14px_rgba(245,158,11,0.35)] transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
                        onClick={() => {
                          playSound('click', isMuted)
                          setAssetIndex(idx)
                          setIsConfiguringSpot(false)
                          handleStart()
                        }}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" /> {isMarkerEntry ? 'SCAN' : 'PLAY'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* CAMERA REQUESTING STATE — hidden for marker mode */}
      {status === STATUS.REQUESTING && !isMarkerMode && (
        <div className="relative z-10 h-full flex flex-col items-center justify-center gap-4 p-6 text-center bg-slate-950/90 backdrop-blur-xl">
          <div className="w-6 h-6 rounded-full bg-amber-400 animate-ping shadow-[0_0_20px_rgba(245,158,11,0.8)]" />
          <p className="mono text-slate-200 font-bold">Getting camera magic ready...</p>
        </div>
      )}

      {/* ACTIVE CAMERA AR HUD — hidden in marker mode (MarkerARScene has its own HUD) */}
      {status === STATUS.ACTIVE && !isMarkerMode && (
        <>
          {/* UNIFIED TOP GLASS HUD NAVBAR */}
          <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2 bg-slate-950/80 backdrop-blur-xl border-b border-white/10 shadow-lg gap-2">
            {/* Quit Button */}
            <button
              className="bg-slate-800/90 text-slate-200 hover:text-white border border-slate-700/80 px-3 py-1.5 text-[12px] font-bold tracking-wide rounded-[14px] transition-all flex items-center gap-1.5"
              onClick={handleExit}
              aria-label="Exit AR"
            >
              <LogOut className="w-3.5 h-3.5" /> Quit
            </button>

            {/* Mode Switcher Segmented Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 px-1 max-w-[55vw]">
              {ASSETS.map((ast, idx) => {
                const PillIcon = ast.Icon
                return (
                  <button
                    key={ast.id}
                    className={`px-3 py-1 text-[11px] font-bold rounded-full whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      idx === assetIndex
                        ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => {
                      playSound('click', isMuted)
                      setAssetIndex(idx)
                      setScore(0)
                      setIsConfiguringSpot(false)
                      setIsSpotTriggered(false)
                    }}
                  >
                    <PillIcon className="w-3.5 h-3.5" /> {ast.title}
                  </button>
                )
              })}
            </div>

            {/* Controls: Config / Mute / Flip */}
            <div className="flex items-center gap-1.5">
              {(asset.id === 'spot_shower' || asset.id === 'elephant') && (
                <button
                  className={`px-2.5 py-1 text-[11px] font-black tracking-wide rounded-[12px] transition-all border flex items-center gap-1 ${
                    isConfiguringSpot
                      ? 'bg-amber-400 text-slate-950 border-amber-300 animate-pulse'
                      : 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50 hover:bg-cyan-400/30'
                  }`}
                  onClick={() => {
                    playSound('click', isMuted)
                    setIsConfiguringSpot(!isConfiguringSpot)
                  }}
                >
                  {isConfiguringSpot ? <Check className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" />}
                  {isConfiguringSpot ? 'Save' : 'Config'}
                </button>
              )}

              <button
                className="bg-slate-800/90 text-slate-300 border border-slate-700/80 w-8 h-8 rounded-full flex items-center justify-center text-[14px]"
                onClick={() => {
                  playAppSound('click')
                  setIsSettingsOpen(true)
                }}
                aria-label="Settings"
                title="Hardware & Media Settings"
              >
                <Settings className="w-3.5 h-3.5 text-indigo-400" />
              </button>
              <button
                className="bg-slate-800/90 text-slate-300 border border-slate-700/80 w-8 h-8 rounded-full flex items-center justify-center text-[14px]"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-amber-300" />}
              </button>
              <button
                className="bg-slate-800/90 text-slate-300 border border-slate-700/80 w-8 h-8 rounded-full flex items-center justify-center text-[14px]"
                onClick={flipCamera}
                aria-label="Flip camera"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-200" />
              </button>
            </div>
          </div>

          {/* TOP CONFIG DRAWER PANEL */}
          {(asset.id === 'spot_shower' || asset.id === 'elephant') && isConfiguringSpot && (
            <div className="fixed top-[52px] left-1/2 -translate-x-1/2 z-30 w-[94%] max-w-[440px] glass-panel px-4 py-3 rounded-[20px] shadow-2xl flex flex-col gap-2.5 border border-amber-400/50">
              <div className="flex justify-between items-center border-b border-white/10 pb-1.5">
                <span className="text-[12px] font-black text-amber-300 flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-amber-300 animate-pulse" />
                  {asset.id === 'elephant' ? 'CONFIG ELEPHANT AR' : 'ALIGN FLOOR TRACKER'}
                </span>
                <span className="text-[10px] text-slate-400 mono">
                  pos ({spotConfig.x.toFixed(1)}, {spotConfig.y.toFixed(1)})
                </span>
              </div>

              <p className="text-[10px] text-slate-300 font-medium">
                {asset.id === 'elephant'
                  ? '👣 Tap anywhere on the floor to position the trigger zone. Use sliders to configure.'
                  : '💡 Drag ring on screen to reposition. Use sliders to configure.'}
              </p>


              {/* ── Trigger zone radius ── */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold text-cyan-300 w-32 shrink-0">
                  Trigger Zone: {(spotConfig.radius || 0.7).toFixed(2)}m
                </span>
                <input type="range" min="0.3" max="1.8" step="0.05"
                  value={spotConfig.radius || 0.7}
                  onChange={(e) => handleUpdateSpotConfig({ ...spotConfig, radius: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* ── Walk circle size (elephant only) ── */}
              {asset.id === 'elephant' && (
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-emerald-300 w-32 shrink-0">
                    Walk Circle: {(spotConfig.walkRadius || 1.2).toFixed(2)}m
                  </span>
                  <input type="range" min="0.4" max="2.5" step="0.05"
                    value={spotConfig.walkRadius || 1.2}
                    onChange={(e) => handleUpdateSpotConfig({ ...spotConfig, walkRadius: parseFloat(e.target.value) })}
                    className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}

              {/* ── Elephant model size (elephant only) ── */}
              {asset.id === 'elephant' && (
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-amber-300 w-32 shrink-0">
                    Elephant Size: {((spotConfig.elephantScale || 1.0) * 100).toFixed(0)}%
                  </span>
                  <input type="range" min="0.3" max="3.0" step="0.1"
                    value={spotConfig.elephantScale || 1.0}
                    onChange={(e) => handleUpdateSpotConfig({ ...spotConfig, elephantScale: parseFloat(e.target.value) })}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}

              {/* ── Walk speed (elephant only) ── */}
              {asset.id === 'elephant' && (
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-rose-300 w-32 shrink-0">
                    Walk Speed: {spotConfig.walkSpeed?.toFixed(2) ?? '0.20'}
                  </span>
                  <input type="range" min="0.05" max="0.8" step="0.05"
                    value={spotConfig.walkSpeed ?? 0.20}
                    onChange={(e) => handleUpdateSpotConfig({ ...spotConfig, walkSpeed: parseFloat(e.target.value) })}
                    className="w-full accent-rose-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[11px] py-1.5 rounded-[12px] flex items-center justify-center gap-1"
                  onClick={() => handleUpdateSpotConfig({ x: 0, y: 0, radius: 0.7, walkRadius: 1.2, elephantScale: 1.0, walkSpeed: 0.20 })}
                >
                  <RotateCcw className="w-3 h-3" /> Reset Defaults
                </button>
                <button
                  className="flex-1 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-[11px] py-1.5 rounded-[12px] flex items-center justify-center gap-1 shadow-lg shadow-amber-500/20"
                  onClick={() => setIsConfiguringSpot(false)}
                >
                  <Check className="w-3.5 h-3.5" /> Save Configuration
                </button>
              </div>
            </div>
          )}

          {/* FLOATING STATUS & SCORE HUD BADGE */}
          <div
            className={`fixed left-1/2 -translate-x-1/2 z-20 transition-all duration-200 ${
              isConfiguringSpot ? 'top-[165px]' : 'top-[56px]'
            }`}
          >
            {(asset.id === 'spot_shower' || asset.id === 'elephant') && !isConfiguringSpot && (
              <div className="mb-1 text-center">
                {isSpotTriggered ? (
                  <div className="bg-gradient-to-r from-emerald-600 via-amber-500 to-emerald-600 border border-amber-300 text-white font-black text-[12px] px-4 py-1.5 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.6)] animate-pulse flex items-center justify-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-300 animate-bounce" /> {asset.id === 'elephant' ? 'SPOT TRIGGERED! SAFARI ELEPHANT REVEALED!' : 'SPOT TRIGGERED! APPLE SHOWER ACTIVE!'}
                  </div>
                ) : (
                  <div className="glass-pill px-3 py-1 rounded-full text-cyan-300 font-bold text-[11px] border border-cyan-400/40 flex items-center justify-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-cyan-300" /> {asset.id === 'elephant' ? 'Stand in marker spot to reveal Safari Elephant!' : 'Stand on physical floor spot to trigger Apple Shower!'}
                  </div>
                )}
              </div>
            )}

            {(asset.id === 'apple' || asset.id === 'ninja' || asset.id === 'spot_shower') && (
              <div
                className={`mx-auto w-fit glass-pill border border-amber-400/50 px-5 py-1 rounded-full flex items-center gap-2.5 shadow-xl transition-transform duration-150 ${
                  scoreBump ? 'scale-110 border-pink-500' : ''
                }`}
              >
                <span className="text-[10px] font-extrabold text-slate-400 mono tracking-wider">
                  {asset.id === 'spot_shower' ? 'APPLES' : 'SCORE'}
                </span>
                <span className="text-[18px] font-black text-amber-300 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]">
                  {score}
                </span>
              </div>
            )}
          </div>

          {/* BOTTOM HELPER TIP */}
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            {asset.id === 'spot_shower' || asset.id === 'elephant' ? (
              <p className="text-[11px] text-cyan-300 font-bold bg-slate-950/80 border border-cyan-500/30 px-3 py-1 rounded-full mono text-center flex items-center justify-center gap-1.5">
                {isConfiguringSpot
                  ? 'Drag 3D ring flat over physical floor spot'
                  : asset.id === 'elephant'
                  ? 'Stand in marker spot to reveal Safari Elephant!'
                  : 'Stand on floor spot for Apple Shower!'}
              </p>
            ) : hasHand ? (
              <p className="text-[11px] text-emerald-400 font-bold bg-slate-950/80 border border-emerald-500/30 px-3 py-1 rounded-full mono animate-pulse-tracking flex items-center justify-center gap-1.5">
                <Hand className="w-3.5 h-3.5 text-emerald-400" /> HAND DETECTED
              </p>
            ) : (
              <p className="text-[11px] text-slate-300 bg-slate-950/80 border border-slate-700/50 px-3 py-1 rounded-full mono flex items-center justify-center gap-1.5">
                <Hand className="w-3.5 h-3.5 text-slate-400" /> Show hand to control toys & catch fruits!
              </p>
            )}
          </div>
        </>
      )}

      {/* ERROR SCREEN */}
      {status === STATUS.ERROR && (
        <div className="relative z-10 h-full flex flex-col items-center justify-center gap-4 p-6 text-center bg-slate-950/90 backdrop-blur-xl">
          <CameraOff className="w-8 h-8 text-amber-400" />
          <p className="mono text-[16px] font-bold text-amber-400">Uh oh! Camera is sleeping</p>
          <p className="text-[14px] text-slate-400 max-w-[320px]">{errorMsg}</p>
          <div className="flex gap-3 mt-2">
            <button
              className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-6 py-2.5 text-[14px] font-black rounded-full shadow-lg"
              onClick={handleStart}
            >
              Try again
            </button>
            <button
              className="bg-slate-800 text-white border border-slate-700 px-5 py-2.5 text-[13px] font-bold rounded-full"
              onClick={handleExit}
            >
              Go Back
            </button>
          </div>
        </div>
      )}

      {/* MEDIA HARDWARE SETTINGS MODAL */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        selectedCamera={selectedCamera}
        setSelectedCamera={setSelectedCamera}
        selectedMic={selectedMic}
        setSelectedMic={setSelectedMic}
        selectedSpeaker={selectedSpeaker}
        setSelectedSpeaker={setSelectedSpeaker}
        cameraResolution={cameraResolution}
        setCameraResolution={setCameraResolution}
        volume={volume}
        setVolume={setVolume}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onTestSound={() => playSound('milestone', false, volume)}
        perfPreset={perfPreset}
        setPerfPreset={setPerfPreset}
        trackingFps={trackingFps}
        setTrackingFps={setTrackingFps}
        enableParticles={enableParticles}
        setEnableParticles={setEnableParticles}
      />
    </div>
  )
}
