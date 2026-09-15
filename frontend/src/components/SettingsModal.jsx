import { useState, useEffect, useRef } from 'react'
import {
  Settings,
  X,
  Camera,
  Mic,
  Volume2,
  VolumeX,
  Check,
  RefreshCw,
  Sliders,
  Sparkles,
  Play,
  Video,
  Zap,
} from 'lucide-react'

export default function SettingsModal({
  isOpen,
  onClose,
  selectedCamera,
  setSelectedCamera,
  selectedMic,
  setSelectedMic,
  selectedSpeaker,
  setSelectedSpeaker,
  cameraResolution,
  setCameraResolution,
  volume,
  setVolume,
  isMuted,
  setIsMuted,
  onTestSound,
  perfPreset,
  setPerfPreset,
  trackingFps,
  setTrackingFps,
  enableParticles,
  setEnableParticles,
}) {
  const [cameras, setCameras] = useState([])
  const [mics, setMics] = useState([])
  const [speakers, setSpeakers] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const previewVideoRef = useRef(null)
  const [previewStream, setPreviewStream] = useState(null)
  const [permissionError, setPermissionError] = useState(null)

  // Enumerate hardware media devices
  const refreshDevices = async () => {
    setLoadingDevices(true)
    setPermissionError(null)
    try {
      // First request temporary permission if devices are unlabeled
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ video: true })
          tempStream.getTracks().forEach((t) => t.stop())
        } catch (e) {
          // Ignore error if already granted or denied
        }
      }

      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = devices.filter((d) => d.kind === 'videoinput')
      const audioInputs = devices.filter((d) => d.kind === 'audioinput')
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput')

      setCameras(videoInputs)
      setMics(audioInputs)
      setSpeakers(audioOutputs)

      // Set default selected devices if none saved
      if (!selectedCamera && videoInputs.length > 0) {
        setSelectedCamera(videoInputs[0].deviceId)
      }
      if (!selectedMic && audioInputs.length > 0) {
        setSelectedMic(audioInputs[0].deviceId)
      }
      if (!selectedSpeaker && audioOutputs.length > 0) {
        setSelectedSpeaker(audioOutputs[0].deviceId)
      }
    } catch (err) {
      console.error('Failed to enumerate devices:', err)
      setPermissionError('Unable to detect media devices. Please allow camera permissions.')
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      refreshDevices()
    }
  }, [isOpen])

  // Manage Live Preview Stream in Settings Modal
  useEffect(() => {
    if (!isOpen) {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop())
        setPreviewStream(null)
      }
      return
    }

    let active = true

    async function startPreview() {
      try {
        if (previewStream) {
          previewStream.getTracks().forEach((t) => t.stop())
        }

        const [width, height] = cameraResolution === '1080p' ? [1920, 1080] : cameraResolution === '480p' ? [640, 480] : [1280, 720]

        let stream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: selectedCamera
              ? { deviceId: { ideal: selectedCamera }, width: { ideal: width }, height: { ideal: height } }
              : { width: { ideal: width }, height: { ideal: height } },
            audio: false,
          })
        } catch (e) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        }

        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        setPreviewStream(stream)
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream
          await previewVideoRef.current.play().catch(() => {})
        }
      } catch (err) {
        console.error('Camera preview error:', err)
      }
    }

    startPreview()

    return () => {
      active = false
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop())
      }
    }
  }, [isOpen, selectedCamera, cameraResolution])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-slate-900/90 border border-slate-700/60 shadow-2xl shadow-indigo-500/10 text-white flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Settings className="w-6 h-6 animate-spin-slow" />
            </div>
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
                Hardware & Media Settings
              </h2>
              <p className="text-xs text-slate-400">Configure Camera, Microphone & Speaker Output</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 transition-colors rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {permissionError && (
            <div className="p-4 border rounded-2xl bg-rose-500/10 border-rose-500/30 text-rose-300 text-xs">
              {permissionError}
            </div>
          )}

          {/* Camera Section */}
          <div className="p-4 space-y-4 border rounded-2xl bg-slate-800/40 border-slate-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-indigo-400">
                <Camera className="w-5 h-5" />
                <span className="font-semibold text-sm">Camera Feed Source</span>
              </div>
              <button
                onClick={refreshDevices}
                disabled={loadingDevices}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDevices ? 'animate-spin' : ''}`} />
                <span>Rescan</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Dropdown & Resolution */}
              <div className="space-y-3">
                <div>
                  <label className="block mb-1.5 text-xs text-slate-400 font-medium">Camera Device</label>
                  <select
                    value={selectedCamera || ''}
                    onChange={(e) => setSelectedCamera(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    {cameras.length === 0 ? (
                      <option value="">Default Web Camera</option>
                    ) : (
                      cameras.map((cam, i) => (
                        <option key={cam.deviceId || i} value={cam.deviceId}>
                          {cam.label || `Camera ${i + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block mb-1.5 text-xs text-slate-400 font-medium">Video Resolution</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: '720p', label: '720p HD (Best)' },
                      { id: '1080p', label: '1080p FHD' },
                      { id: '480p', label: '480p Fast' },
                    ].map((res) => (
                      <button
                        key={res.id}
                        onClick={() => setCameraResolution(res.id)}
                        className={`py-2 px-2 text-[11px] font-medium rounded-xl border transition-all ${
                          cameraResolution === res.id
                            ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {res.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Camera Live Preview */}
              <div className="relative overflow-hidden rounded-xl bg-black border border-slate-700/80 flex items-center justify-center min-h-[140px]">
                <video
                  ref={previewVideoRef}
                  playsInline
                  muted
                  autoPlay
                  className="w-full h-full object-cover transform -scale-x-100"
                />
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Live Test Preview</span>
                </div>
              </div>
            </div>
          </div>

          {/* Audio & Speaker Section */}
          <div className="p-4 space-y-4 border rounded-2xl bg-slate-800/40 border-slate-700/50">
            <div className="flex items-center space-x-2 text-indigo-400">
              <Volume2 className="w-5 h-5" />
              <span className="font-semibold text-sm">Speaker & Sound Audio</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Speaker Select */}
              <div>
                <label className="block mb-1.5 text-xs text-slate-400 font-medium">Speaker Output Device</label>
                <select
                  value={selectedSpeaker || ''}
                  onChange={(e) => setSelectedSpeaker(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {speakers.length === 0 ? (
                    <option value="">System Default Audio Output</option>
                  ) : (
                    speakers.map((spk, i) => (
                      <option key={spk.deviceId || i} value={spk.deviceId}>
                        {spk.label || `Speaker ${i + 1}`}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Volume Slider & Test Button */}
              <div className="space-y-3">
                <label className="block text-xs text-slate-400 font-medium">Game Audio Volume ({Math.round(volume * 100)}%)</label>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={`p-2.5 rounded-xl border transition-colors ${
                      isMuted ? 'bg-rose-500/20 border-rose-500/40 text-rose-400' : 'bg-slate-950 border-slate-700 text-slate-300'
                    }`}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      setVolume(parseFloat(e.target.value))
                      if (isMuted) setIsMuted(false)
                    }}
                    className="flex-1 accent-indigo-500 h-2 bg-slate-950 rounded-lg cursor-pointer"
                  />
                  <button
                    onClick={onTestSound}
                    className="px-3 py-2 text-xs font-medium rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 transition-colors flex items-center space-x-1"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Test</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Microphone Section */}
          <div className="p-4 space-y-3 border rounded-2xl bg-slate-800/40 border-slate-700/50">
            <div className="flex items-center space-x-2 text-indigo-400">
              <Mic className="w-5 h-5" />
              <span className="font-semibold text-sm">Microphone Input</span>
            </div>
            <div>
              <label className="block mb-1.5 text-xs text-slate-400 font-medium">Microphone Device</label>
              <select
                value={selectedMic || ''}
                onChange={(e) => setSelectedMic(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
              >
                {mics.length === 0 ? (
                  <option value="">System Default Microphone</option>
                ) : (
                  mics.map((mic, i) => (
                    <option key={mic.deviceId || i} value={mic.deviceId}>
                      {mic.label || `Microphone ${i + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Browser Performance & Graphics Optimization Section */}
          <div className="p-4 space-y-4 border rounded-2xl bg-slate-800/40 border-slate-700/50">
            <div className="flex items-center space-x-2 text-indigo-400">
              <Zap className="w-5 h-5 text-amber-400" />
              <span className="font-semibold text-sm">Browser & Graphics Performance</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Graphics & Resolution Preset */}
              <div>
                <label className="block mb-1.5 text-xs text-slate-400 font-medium">Performance & DPR Profile</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'fast', label: '⚡ Ultra Fast (60 FPS)' },
                    { id: 'balanced', label: '⚖️ Balanced' },
                    { id: 'quality', label: '🎨 High Quality' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setPerfPreset?.(preset.id)}
                      className={`py-2 px-2 text-[11px] font-medium rounded-xl border transition-all ${
                        perfPreset === preset.id
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hand Tracking Refresh Rate */}
              <div>
                <label className="block mb-1.5 text-xs text-slate-400 font-medium">Hand Tracking Throttle</label>
                <select
                  value={trackingFps || 20}
                  onChange={(e) => setTrackingFps?.(parseInt(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value={25}>25 FPS - Ultra Responsive (Smooth)</option>
                  <option value={20}>20 FPS - Balanced (Recommended)</option>
                  <option value={15}>15 FPS - Low CPU Usage</option>
                  <option value={10}>10 FPS - Battery Saver</option>
                </select>
              </div>
            </div>

            {/* Particle Burst Toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-700/40">
              <div className="space-y-0.5">
                <span className="text-xs text-slate-300 font-medium">3D Hand Particle Burst Effects</span>
                <p className="text-[11px] text-slate-500">Disable particle bursts on low-end integrated GPUs</p>
              </div>
              <button
                onClick={() => setEnableParticles?.(!enableParticles)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  enableParticles
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-500'
                }`}
              >
                {enableParticles ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <span className="text-xs text-slate-500">Settings auto-save to application memory</span>
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-lg shadow-indigo-500/25 transition-all flex items-center space-x-2"
          >
            <Check className="w-4 h-4" />
            <span>Save & Apply Settings</span>
          </button>
        </div>
      </div>
    </div>
  )
}
