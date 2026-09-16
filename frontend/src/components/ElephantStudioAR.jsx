import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import {
  Move,
  RotateCw,
  Maximize2,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Camera,
  RefreshCw,
  Sparkles,
  Sliders,
  Check,
  X,
  Download,
  Play,
  Pause,
  LogOut,
  RotateCcw,
  Zap,
  Grid,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Compass,
} from 'lucide-react'

const STORAGE_KEY = 'elephant_studio_ar_config_v3'

const DEFAULT_CONFIG = {
  posX: 0.0,
  floorY: -1.45,         // Automatic ground floor level (meters below camera)
  posZ: -3.2,           // Distance in front of camera on the floor
  rotY: 20,             // Facing slightly towards camera
  heightMeters: 1.8,    // Natural adult elephant height
  shadowOpacity: 0.55,
  lightIntensity: 2.2,
  animSpeed: 0.95,
  isLocked: false,
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        posX: typeof p.posX === 'number' ? p.posX : DEFAULT_CONFIG.posX,
        floorY: typeof p.floorY === 'number' ? p.floorY : (typeof p.posY === 'number' ? p.posY : DEFAULT_CONFIG.floorY),
        posZ: typeof p.posZ === 'number' ? p.posZ : DEFAULT_CONFIG.posZ,
        rotY: typeof p.rotY === 'number' ? p.rotY : DEFAULT_CONFIG.rotY,
        heightMeters: typeof p.heightMeters === 'number' ? p.heightMeters : DEFAULT_CONFIG.heightMeters,
        shadowOpacity: typeof p.shadowOpacity === 'number' ? p.shadowOpacity : DEFAULT_CONFIG.shadowOpacity,
        lightIntensity: typeof p.lightIntensity === 'number' ? p.lightIntensity : DEFAULT_CONFIG.lightIntensity,
        animSpeed: typeof p.animSpeed === 'number' ? p.animSpeed : DEFAULT_CONFIG.animSpeed,
        isLocked: !!p.isLocked,
      }
    }
  } catch (e) {
    console.warn('Failed to load studio config:', e)
  }
  return { ...DEFAULT_CONFIG }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch (e) {
    console.warn('Failed to save studio config:', e)
  }
}

// Strip root motion tracks so animation loops smoothly in-place
const ROOT_BONES = ['elep_4_Root_M', 'elep_4_RootPart1_M']
function stripRootMotion(animations) {
  return animations.map(clip => {
    const cloned = clip.clone()
    cloned.tracks = cloned.tracks.filter(track => {
      const bone = track.name.split('.')[0]
      return !(
        ROOT_BONES.includes(bone) &&
        (track.name.endsWith('.position') || track.name.endsWith('.rotation'))
      )
    })
    return cloned
  })
}

export default function ElephantStudioAR({ onExit, selectedCamera, cameraResolution }) {
  const initial = loadSavedConfig()

  // ── Transform States (Feet AUTOMATICALLY locked to floorY) ──────────────────
  const [posX, setPosX]                 = useState(initial.posX)
  const [floorY, setFloorY]             = useState(initial.floorY)
  const [posZ, setPosZ]                 = useState(initial.posZ)
  const [rotY, setRotY]                 = useState(initial.rotY)
  const [heightMeters, setHeightMeters] = useState(initial.heightMeters)
  const [shadowOpacity, setShadowOpacity] = useState(initial.shadowOpacity)
  const [lightIntensity, setLightIntensity] = useState(initial.lightIntensity)
  const [animSpeed, setAnimSpeed]       = useState(initial.animSpeed)
  const [isPlayingAnim, setIsPlayingAnim] = useState(true)
  const [isLocked, setIsLocked]         = useState(initial.isLocked)

  // ── UI States ─────────────────────────────────────────────────────────────
  const [controlTab, setControlTab]     = useState('quick')       // 'quick' | 'gizmo' | 'inspector'
  const [gizmoMode, setGizmoMode]       = useState('translate')   // 'translate' | 'rotate' | 'scale'
  const [showGizmo, setShowGizmo]       = useState(true)
  const [showGrid, setShowGrid]         = useState(false)
  const [isExhibitionMode, setIsExhibitionMode] = useState(false) // Clean visitor mode
  const [toastMsg, setToastMsg]         = useState(null)
  const [capturedSnapshot, setCapturedSnapshot] = useState(null)
  const [isLoading, setIsLoading]       = useState(true)
  const [activeCamId, setActiveCamId]   = useState(() => selectedCamera || localStorage.getItem('cb_ar_camera') || '')
  const [activeRes, setActiveRes]       = useState(() => cameraResolution || localStorage.getItem('cb_ar_resolution') || '720p')

  // ── Three.js & DOM Refs ───────────────────────────────────────────────────
  const containerRef       = useRef(null)
  const videoRef           = useRef(null)
  const canvasRef          = useRef(null)
  const sceneRef           = useRef(null)
  const cameraRef          = useRef(null)
  const rendererRef        = useRef(null)
  const elephantGroupRef   = useRef(null)
  const elSceneRef         = useRef(null)
  const shadowPlaneRef     = useRef(null)
  const characterLightRef  = useRef(null)
  const gridHelperRef      = useRef(null)
  const transformCtrlRef   = useRef(null)
  const mixerRef           = useRef(null)
  const nativeDimsRef      = useRef({ nativeHeight: 1.0, nativeMinY: 0.0 })
  const isDraggingGizmoRef = useRef(false)
  const isPointerDraggingRef = useRef(false)
  const dragPlaneRef       = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))

  const showToast = useCallback((msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }, [])

  // ── Synchronise 3D transforms to Three.js scene (AUTOMATIC FLOOR CLAMP) ───
  const applyTransforms = useCallback((x, fY, z, ry, h) => {
    const group = elephantGroupRef.current
    const model = elSceneRef.current
    const dims = nativeDimsRef.current
    if (!group || !model || dims.nativeHeight <= 0) return

    // Position root: Y is strictly locked to ground floor level fY
    group.position.set(x, fY, z)
    group.rotation.set(0, THREE.MathUtils.degToRad(ry), 0)

    // Exact real-world scale
    const scale = h / dims.nativeHeight
    model.scale.setScalar(scale)

    // Floor contact: feet are mathematically clamped to the floor plane (local Y = 0)
    model.position.y = -dims.nativeMinY * scale

    // Floor shadow plane stays flush with the floor surface
    if (shadowPlaneRef.current) {
      const sSize = Math.max(2.0, h * 1.6)
      shadowPlaneRef.current.scale.set(sSize, sSize, 1)
    }

    // Update ground grid position to match floorY
    if (gridHelperRef.current) {
      gridHelperRef.current.position.y = fY
    }

    // Update drag plane to match floorY
    dragPlaneRef.current.constant = -fY
  }, [])

  // Auto-sync & persist on any change
  useEffect(() => {
    applyTransforms(posX, floorY, posZ, rotY, heightMeters)
    saveConfig({
      posX, floorY, posZ,
      rotY,
      heightMeters,
      shadowOpacity,
      lightIntensity,
      animSpeed,
      isLocked,
    })
  }, [posX, floorY, posZ, rotY, heightMeters, shadowOpacity, lightIntensity, animSpeed, isLocked, applyTransforms])

  // Sync shadow opacity and light
  useEffect(() => {
    if (shadowPlaneRef.current) {
      shadowPlaneRef.current.material.opacity = shadowOpacity
    }
    if (characterLightRef.current) {
      characterLightRef.current.intensity = lightIntensity
    }
  }, [shadowOpacity, lightIntensity])

  // Sync grid helper visibility
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGrid && !isExhibitionMode
    }
  }, [showGrid, isExhibitionMode])

  // Sync animation speed and state
  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.timeScale = isPlayingAnim ? animSpeed : 0
    }
  }, [animSpeed, isPlayingAnim])

  // Sync TransformControls mode, axis restrictions, and visibility
  useEffect(() => {
    const ctrl = transformCtrlRef.current
    if (ctrl) {
      ctrl.setMode(gizmoMode)
      ctrl.enabled = showGizmo && !isLocked && !isExhibitionMode && controlTab === 'gizmo'
      ctrl.visible = showGizmo && !isLocked && !isExhibitionMode && controlTab === 'gizmo'

      // CRITICAL: Prevent gizmo from lifting the elephant off the floor!
      // In translate mode, ONLY show X (red) and Z (blue) handles so Y stays locked on the floor!
      if (gizmoMode === 'translate') {
        ctrl.showX = true
        ctrl.showY = false // NEVER allow pulling into mid-air!
        ctrl.showZ = true
      } else if (gizmoMode === 'rotate') {
        ctrl.showX = false
        ctrl.showY = true  // Only rotate around the vertical floor axis!
        ctrl.showZ = false
      } else if (gizmoMode === 'scale') {
        ctrl.showX = true
        ctrl.showY = true
        ctrl.showZ = true
      }
    }
  }, [gizmoMode, showGizmo, isLocked, isExhibitionMode, controlTab])

  // ── WebRTC HD Camera Initialisation ───────────────────────────────────────
  useEffect(() => {
    let activeStream = null
    async function startCamera() {
      try {
        const [w, h] = activeRes === '4k' ? [3840, 2160] : activeRes === '1080p' ? [1920, 1080] : [1280, 720]
        const constraints = {
          audio: false,
          video: {
            width: { ideal: w },
            height: { ideal: h },
            frameRate: { ideal: 30 },
            deviceId: activeCamId ? { ideal: activeCamId } : undefined,
          }
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        activeStream = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (camErr) {
        console.warn('HD camera stream failed, falling back to basic video:', camErr)
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          activeStream = fallbackStream
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream
            await videoRef.current.play().catch(() => {})
          }
        } catch { /* camera denied */ }
      }
    }

    startCamera()

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop())
      }
    }
  }, [activeCamId, activeRes])

  // ── Main Three.js Scene Setup ─────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    let stopped = false

    // Scene & Camera (slight natural tilt down towards floor)
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      54,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    )
    camera.position.set(0, 0, 0)
    camera.rotation.x = -THREE.MathUtils.degToRad(8) // Natural 8° downward pitch towards physical floor
    cameraRef.current = camera

    // WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    rendererRef.current = renderer

    // Lighting (Warm ambient + directional key light with soft shadow)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4)
    scene.add(ambientLight)

    const fillLight = new THREE.DirectionalLight(0x90c0ff, 0.7)
    fillLight.position.set(-3, 4, 1)
    scene.add(fillLight)

    const keyLight = new THREE.DirectionalLight(0xffffff, initial.lightIntensity)
    keyLight.position.set(2.5, 6, 2.5)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 2048
    keyLight.shadow.mapSize.height = 2048
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 25
    const fSize = 4.5
    keyLight.shadow.camera.left = -fSize
    keyLight.shadow.camera.right = fSize
    keyLight.shadow.camera.top = fSize
    keyLight.shadow.camera.bottom = -fSize
    keyLight.shadow.bias = -0.001
    scene.add(keyLight)
    characterLightRef.current = keyLight

    // Ground Helper Grid (for spatial floor calibration)
    const grid = new THREE.GridHelper(10, 20, 0xf59e0b, 0x475569)
    grid.position.y = initial.floorY
    grid.visible = false
    scene.add(grid)
    gridHelperRef.current = grid

    // Elephant Root Group (placed at ground floor level)
    const elephantGroup = new THREE.Group()
    elephantGroup.position.set(initial.posX, initial.floorY, initial.posZ)
    scene.add(elephantGroup)
    elephantGroupRef.current = elephantGroup
    keyLight.target = elephantGroup

    // Ground Floor Contact Shadow Plane
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: initial.shadowOpacity, transparent: true })
    )
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.position.y = 0.002
    shadowPlane.receiveShadow = true
    elephantGroup.add(shadowPlane)
    shadowPlaneRef.current = shadowPlane

    // Unity-style 3D TransformControls
    const transformControls = new TransformControls(camera, renderer.domElement)
    transformControls.size = 0.85
    transformControls.setSpace('world')
    transformControls.attach(elephantGroup)
    transformControls.showY = false // Lock Y so it never floats!
    scene.add(transformControls)
    transformCtrlRef.current = transformControls

    transformControls.addEventListener('dragging-changed', (e) => {
      isDraggingGizmoRef.current = e.value
    })

    transformControls.addEventListener('change', () => {
      if (isDraggingGizmoRef.current) {
        const p = elephantGroup.position
        const r = elephantGroup.rotation
        setPosX(parseFloat(p.x.toFixed(2)))
        setPosZ(parseFloat(p.z.toFixed(2)))
        setRotY(Math.round(THREE.MathUtils.radToDeg(r.y)))
      }
    })

    // Load 3D Elephant Model
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('vendor/draco/')
    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(dracoLoader)

    gltfLoader.load(
      'assets/Elephant_Turn_Walk.glb',
      (gltf) => {
        if (stopped) return
        const elScene = gltf.scene
        elSceneRef.current = elScene

        elScene.traverse((child) => {
          if (child.isMesh || child.isSkinnedMesh) {
            child.frustumCulled = false
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        const bbox = new THREE.Box3().setFromObject(elScene)
        const nativeH = bbox.max.y - bbox.min.y
        const nativeMinY = bbox.min.y

        nativeDimsRef.current = {
          nativeHeight: nativeH > 0 ? nativeH : 1.0,
          nativeMinY,
        }

        elephantGroup.add(elScene)

        // Setup walking animation
        const clips = stripRootMotion(gltf.animations)
        if (clips.length > 0) {
          const mixer = new THREE.AnimationMixer(elScene)
          mixerRef.current = mixer
          const action = mixer.clipAction(clips[0])
          action.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat).play()
          mixer.timeScale = initial.animSpeed
        }

        // Apply initial transforms firmly on the floor
        applyTransforms(
          initial.posX, initial.floorY, initial.posZ,
          initial.rotY,
          initial.heightMeters
        )

        setIsLoading(false)
      },
      undefined,
      (err) => {
        console.warn('GLB load error:', err)
        setIsLoading(false)
      }
    )

    // Animation Loop
    const clock = new THREE.Clock()
    let animFrameId = null

    function animate() {
      if (stopped) return
      animFrameId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.05)

      if (mixerRef.current) {
        mixerRef.current.update(delta)
      }

      renderer.render(scene, camera)
    }

    animate()

    // Window Resize Handler
    function handleResize() {
      if (!container || !renderer || !camera) return
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      stopped = true
      cancelAnimationFrame(animFrameId)
      window.removeEventListener('resize', handleResize)
      transformControls.dispose()
      renderer.dispose()
      mixerRef.current = null
      elSceneRef.current = null
      elephantGroupRef.current = null
    }
  }, [applyTransforms, initial])

  // ── Smooth Direct Screen Drag-and-Drop Floor Placement ────────────────────
  const raycastFloorPoint = useCallback((clientX, clientY) => {
    const container = containerRef.current
    const camera = cameraRef.current
    if (!container || !camera) return null

    const rect = container.getBoundingClientRect()
    const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1
    const mouseY = -((clientY - rect.top) / rect.height) * 2 + 1

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera)

    const targetPoint = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(dragPlaneRef.current, targetPoint)) {
      // Clamp boundaries so it stays on screen floor
      const clampedX = Math.max(-4.5, Math.min(4.5, targetPoint.x))
      const clampedZ = Math.max(-8.0, Math.min(-1.2, targetPoint.z))
      return { x: parseFloat(clampedX.toFixed(2)), z: parseFloat(clampedZ.toFixed(2)) }
    }
    return null
  }, [])

  const handlePointerDown = (e) => {
    if (isDraggingGizmoRef.current || isLocked || isExhibitionMode) return
    if (e.target.closest('.studio-interactive')) return

    const pt = raycastFloorPoint(e.clientX, e.clientY)
    if (pt) {
      isPointerDraggingRef.current = true
      setPosX(pt.x)
      setPosZ(pt.z)
    }
  }

  const handlePointerMove = (e) => {
    if (!isPointerDraggingRef.current || isDraggingGizmoRef.current || isLocked || isExhibitionMode) return
    const pt = raycastFloorPoint(e.clientX, e.clientY)
    if (pt) {
      setPosX(pt.x)
      setPosZ(pt.z)
    }
  }

  const handlePointerUp = () => {
    if (isPointerDraggingRef.current) {
      isPointerDraggingRef.current = false
      showToast('Position updated on floor')
    }
  }

  // ── Precision Step Nudge Handlers ─────────────────────────────────────────
  const nudge = (setter, delta, decimals = 2) => {
    setter(prev => parseFloat((prev + delta).toFixed(decimals)))
  }

  const handleSnapFloor = () => {
    setFloorY(-1.45)
    showToast('👣 Snapped directly to Ground Floor')
  }

  const handleResetCenter = () => {
    setPosX(DEFAULT_CONFIG.posX)
    setFloorY(DEFAULT_CONFIG.floorY)
    setPosZ(DEFAULT_CONFIG.posZ)
    setRotY(DEFAULT_CONFIG.rotY)
    setHeightMeters(DEFAULT_CONFIG.heightMeters)
    showToast('Reset to Center Floor')
  }

  // ── Photo Snapshot Capture ────────────────────────────────────────────────
  const handleCapturePhoto = () => {
    const video = videoRef.current
    const canvas3D = canvasRef.current
    if (!video || !canvas3D) return

    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = canvas3D.width
    snapCanvas.height = canvas3D.height
    const ctx = snapCanvas.getContext('2d')

    // 1. Draw camera video frame
    ctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height)

    // 2. Draw 3D WebGL render layer on top
    ctx.drawImage(canvas3D, 0, 0, snapCanvas.width, snapCanvas.height)

    // 3. Elegant Watermark badge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)'
    ctx.roundRect(snapCanvas.width - 240, snapCanvas.height - 60, 220, 45, 12)
    ctx.fill()
    ctx.fillStyle = '#f59e0b'
    ctx.font = 'bold 16px Inter, sans-serif'
    ctx.fillText('🐘 CHHOTA BHEEM AR', snapCanvas.width - 220, snapCanvas.height - 32)

    const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.92)
    setCapturedSnapshot(dataUrl)
    showToast('📸 Photo snapshot captured!')
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="fixed inset-0 z-0 bg-slate-950 select-none overflow-hidden touch-none"
    >
      {/* ── Background HD Webcam Stream ──────────────────────────────────── */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
      />

      {/* ── Foreground Three.js 3D Canvas Layer ─────────────────────────── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full z-10 pointer-events-auto"
      />

      {/* ── Loading Overlay ──────────────────────────────────────────────── */}
      {isLoading && (
        <div className="absolute inset-0 z-40 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin shadow-lg" />
          <p className="text-white font-black text-sm tracking-wide">Placing 3D Elephant on Floor...</p>
        </div>
      )}

      {/* ── Toast Notification ───────────────────────────────────────────── */}
      {toastMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-amber-400/60 text-amber-300 font-bold text-xs px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TOP HEADER & CONTROL MODE SELECTOR
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!isExhibitionMode && (
        <header className="studio-interactive fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2 bg-slate-950/85 backdrop-blur-xl border-b border-white/10 shadow-xl gap-2">
          {/* Left: Exit & Title */}
          <div className="flex items-center gap-2">
            <button
              onClick={onExit}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl border border-white/10 text-xs font-black flex items-center gap-1.5 transition-all active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Exit</span>
            </button>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-amber-400 font-black text-sm">🐘 Elephant AR</span>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-400/30">
                FLOOR FIXED
              </span>
            </div>
          </div>

          {/* Center: Control Tabs Switcher */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-2xl border border-white/10 shadow-inner">
            <button
              onClick={() => setControlTab('quick')}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
                controlTab === 'quick'
                  ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                  : 'text-slate-400 hover:text-white',
              ].join(' ')}
            >
              <Move className="w-3.5 h-3.5" />
              <span>Easy Controls</span>
            </button>

            <button
              onClick={() => { setControlTab('gizmo'); setShowGizmo(true) }}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
                controlTab === 'gizmo'
                  ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                  : 'text-slate-400 hover:text-white',
              ].join(' ')}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>3D Gizmo</span>
            </button>

            <button
              onClick={() => setControlTab('inspector')}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
                controlTab === 'inspector'
                  ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                  : 'text-slate-400 hover:text-white',
              ].join(' ')}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Inspector</span>
            </button>
          </div>

          {/* Right: Lock, Snapshot & Show Mode */}
          <div className="flex items-center gap-1.5">
            {/* Lock / Freeze AR */}
            <button
              onClick={() => {
                const next = !isLocked
                setIsLocked(next)
                showToast(next ? '🔒 Transform Fixed to Floor' : '🔓 Transform Unlocked')
              }}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md',
                isLocked
                  ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10',
              ].join(' ')}
            >
              {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden md:inline">{isLocked ? 'Locked' : 'Lock AR'}</span>
            </button>

            {/* Quick Photo Snapshot */}
            <button
              onClick={handleCapturePhoto}
              className="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-white/10 p-2 rounded-xl text-xs font-black transition-all shadow-md active:scale-95"
              title="Take photo"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>

            {/* Switch to Exhibition / Clean Mode */}
            <button
              onClick={() => {
                setIsExhibitionMode(true)
                showToast('🎬 Exhibition Mode (Tap corner to exit)')
              }}
              className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Show Mode</span>
            </button>
          </div>
        </header>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TAB 1: USER-FRIENDLY TOUCH D-PAD & QUICK BUTTONS (Default Active)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!isExhibitionMode && controlTab === 'quick' && (
        <div className="studio-interactive fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[96%] max-w-2xl bg-slate-900/92 backdrop-blur-2xl border border-white/15 rounded-3xl p-3 shadow-[0_10px_40px_rgba(0,0,0,0.8)] flex flex-col gap-2.5">
          
          {/* Row 1: Quick Status & Automatic Floor Notice */}
          <div className="flex items-center justify-between px-1 text-[11px] font-bold border-b border-white/10 pb-1.5">
            <span className="text-amber-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Floor Contact: <strong className="text-emerald-400">Firmly on Ground</strong></span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSnapFloor}
                className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 px-2 py-0.5 rounded-lg text-[10px] font-black transition-all"
              >
                👣 Snap to Ground
              </button>
              <button
                onClick={handleResetCenter}
                className="text-slate-400 hover:text-amber-300 text-[10px] flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset Center
              </button>
            </div>
          </div>

          {/* Row 2: Directional Movement & Floor Distance Controls */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            
            {/* Position X (Left / Right) */}
            <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5 items-center">
              <span className="text-[11px] font-black text-slate-300">Move Left / Right</span>
              <div className="flex items-center gap-1.5 w-full">
                <button
                  onClick={() => nudge(setPosX, -0.2)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Left
                </button>
                <button
                  onClick={() => nudge(setPosX, 0.2)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all"
                >
                  Right <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Position Z (Closer / Farther) */}
            <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5 items-center">
              <span className="text-[11px] font-black text-slate-300">Floor Distance</span>
              <div className="flex items-center gap-1.5 w-full">
                <button
                  onClick={() => nudge(setPosZ, -0.3)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all"
                  title="Push farther back on floor"
                >
                  <ArrowUp className="w-3.5 h-3.5" /> Farther
                </button>
                <button
                  onClick={() => nudge(setPosZ, 0.3)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all"
                  title="Bring closer to camera"
                >
                  Closer <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Rotation Y (Turn Left / Right) */}
            <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5 items-center">
              <span className="text-[11px] font-black text-slate-300">Turn ({rotY}°)</span>
              <div className="flex items-center gap-1.5 w-full">
                <button
                  onClick={() => nudge(setRotY, -20, 0)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center transition-all"
                  title="Turn Left"
                >
                  ↶ -20°
                </button>
                <button
                  onClick={() => nudge(setRotY, 20, 0)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center transition-all"
                  title="Turn Right"
                >
                  +20° ↷
                </button>
              </div>
            </div>

            {/* Scale / Height (Bigger / Smaller) */}
            <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5 items-center">
              <span className="text-[11px] font-black text-slate-300">Size: {heightMeters.toFixed(2)}m</span>
              <div className="flex items-center gap-1.5 w-full">
                <button
                  onClick={() => nudge(setHeightMeters, -0.15)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center transition-all"
                >
                  ➖ Smaller
                </button>
                <button
                  onClick={() => nudge(setHeightMeters, 0.15)}
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center transition-all shadow-md"
                >
                  ➕ Bigger
                </button>
              </div>
            </div>

          </div>

          {/* Row 3: Floor Height Level Calibrator (Raise/Lower floor if needed) */}
          <div className="flex items-center justify-between gap-2 px-1 pt-1 border-t border-white/10 text-[11px]">
            <span className="text-slate-400 font-bold">Floor Level:</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => nudge(setFloorY, -0.1)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-xl text-xs font-black transition-all"
                title="Lower floor level"
              >
                ⬇ Lower Ground (-10cm)
              </button>
              <button
                onClick={() => nudge(setFloorY, 0.1)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-xl text-xs font-black transition-all"
                title="Raise floor level"
              >
                ⬆ Raise Ground (+10cm)
              </button>
              <span className="font-mono text-emerald-400 font-bold">{floorY.toFixed(2)}m</span>
            </div>
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TAB 2: 3D GIZMO TOOLBAR (Move / Rotate / Scale)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!isExhibitionMode && controlTab === 'gizmo' && (
        <div className="studio-interactive fixed top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-xl border border-white/15 p-1.5 rounded-2xl shadow-2xl">
          <button
            onClick={() => setGizmoMode('translate')}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
              gizmoMode === 'translate'
                ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:bg-slate-800',
            ].join(' ')}
          >
            <Move className="w-3.5 h-3.5" /> Move on Floor (W)
          </button>

          <button
            onClick={() => setGizmoMode('rotate')}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
              gizmoMode === 'rotate'
                ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:bg-slate-800',
            ].join(' ')}
          >
            <RotateCw className="w-3.5 h-3.5" /> Rotate Yaw (E)
          </button>

          <button
            onClick={() => setGizmoMode('scale')}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
              gizmoMode === 'scale'
                ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:bg-slate-800',
            ].join(' ')}
          >
            <Maximize2 className="w-3.5 h-3.5" /> Scale (R)
          </button>

          <button
            onClick={() => setShowGrid(!showGrid)}
            className={[
              'p-1.5 rounded-xl text-xs transition-all',
              showGrid
                ? 'bg-amber-500/30 text-amber-300 border border-amber-400/40'
                : 'text-slate-400 hover:bg-slate-800',
            ].join(' ')}
            title="Toggle Ground Grid Helper"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TAB 3: FULL UNITY-STYLE INSPECTOR DOCK (Floating Right)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!isExhibitionMode && controlTab === 'inspector' && (
        <aside className="studio-interactive fixed right-3 top-14 bottom-4 z-30 w-80 max-w-[calc(100vw-24px)] flex flex-col transition-all">
          <div className="bg-slate-900/95 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-2xl flex flex-col h-full overflow-hidden">
            {/* Inspector Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-slate-950/70">
              <span className="text-white font-black text-xs tracking-wider uppercase flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-amber-400" /> Unity Transform Inspector
              </span>
              <button
                onClick={handleResetCenter}
                className="text-slate-400 hover:text-amber-300 text-[10px] font-bold"
              >
                Reset
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              
              {/* Position Inputs */}
              <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3 space-y-2.5">
                <span className="text-amber-300 font-black text-[11px] flex items-center gap-1.5">
                  <Move className="w-3.5 h-3.5" /> Position (Meters)
                </span>
                
                {/* X */}
                <div className="flex items-center justify-between gap-2">
                  <span className="w-12 font-bold text-rose-400">X (Left/Right)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={posX}
                    onChange={e => setPosX(parseFloat(e.target.value) || 0)}
                    className="w-20 bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-white font-mono text-center"
                  />
                  <div className="flex gap-1">
                    <button onClick={() => nudge(setPosX, -0.1)} className="bg-slate-800 px-2 py-1 rounded-lg font-black">-0.1</button>
                    <button onClick={() => nudge(setPosX, 0.1)} className="bg-slate-800 px-2 py-1 rounded-lg font-black">+0.1</button>
                  </div>
                </div>

                {/* Floor Y */}
                <div className="flex items-center justify-between gap-2">
                  <span className="w-12 font-bold text-emerald-400">Floor Y</span>
                  <input
                    type="number"
                    step="0.05"
                    value={floorY}
                    onChange={e => setFloorY(parseFloat(e.target.value) || 0)}
                    className="w-20 bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-white font-mono text-center"
                  />
                  <div className="flex gap-1">
                    <button onClick={() => nudge(setFloorY, -0.05)} className="bg-slate-800 px-2 py-1 rounded-lg font-black">-0.05</button>
                    <button onClick={() => nudge(setFloorY, 0.05)} className="bg-slate-800 px-2 py-1 rounded-lg font-black">+0.05</button>
                  </div>
                </div>

                {/* Z Distance */}
                <div className="flex items-center justify-between gap-2">
                  <span className="w-12 font-bold text-blue-400">Z (Depth)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={posZ}
                    onChange={e => setPosZ(parseFloat(e.target.value) || 0)}
                    className="w-20 bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-white font-mono text-center"
                  />
                  <div className="flex gap-1">
                    <button onClick={() => nudge(setPosZ, -0.2)} className="bg-slate-800 px-2 py-1 rounded-lg font-black">-0.2</button>
                    <button onClick={() => nudge(setPosZ, 0.2)} className="bg-slate-800 px-2 py-1 rounded-lg font-black">+0.2</button>
                  </div>
                </div>
              </div>

              {/* Rotation Dial */}
              <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3 space-y-2">
                <div className="flex justify-between items-center text-[11px] font-black text-slate-300">
                  <span className="text-amber-300 flex items-center gap-1.5"><RotateCw className="w-3.5 h-3.5" /> Rotation ({rotY}°)</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="5"
                  value={rotY < 0 ? rotY + 360 : rotY % 360}
                  onChange={e => setRotY(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
                <div className="grid grid-cols-4 gap-1 pt-1">
                  {[
                    { label: 'Front', deg: 0 },
                    { label: 'Right', deg: 90 },
                    { label: 'Back', deg: 180 },
                    { label: 'Left', deg: 270 },
                  ].map(c => (
                    <button
                      key={c.label}
                      onClick={() => setRotY(c.deg)}
                      className={[
                        'py-1 rounded-lg text-[10px] font-bold border transition-all',
                        rotY % 360 === c.deg
                          ? 'bg-amber-400 text-slate-950 border-amber-300 font-black'
                          : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                      ].join(' ')}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size In Meters */}
              <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3 space-y-2">
                <div className="flex justify-between items-center text-[11px] font-black text-slate-300">
                  <span className="text-amber-300 flex items-center gap-1.5"><Maximize2 className="w-3.5 h-3.5" /> Real-World Height</span>
                  <span className="text-amber-400 font-mono">{heightMeters.toFixed(2)}m</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="4.0"
                  step="0.05"
                  value={heightMeters}
                  onChange={e => setHeightMeters(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
                <div className="grid grid-cols-4 gap-1 pt-1">
                  {[
                    { label: 'Baby', h: 0.9 },
                    { label: 'Normal', h: 1.5 },
                    { label: 'Adult', h: 1.8 },
                    { label: 'Giant', h: 2.8 },
                  ].map(s => (
                    <button
                      key={s.label}
                      onClick={() => setHeightMeters(s.h)}
                      className={[
                        'py-1 rounded-lg text-[10px] font-bold border transition-all',
                        Math.abs(heightMeters - s.h) < 0.08
                          ? 'bg-amber-400 text-slate-950 border-amber-300 font-black'
                          : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                      ].join(' ')}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Animation & Shadow */}
              <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-black text-slate-300">
                  <span>Animation</span>
                  <button
                    onClick={() => setIsPlayingAnim(!isPlayingAnim)}
                    className="text-amber-400 hover:text-amber-300 flex items-center gap-1 font-bold"
                  >
                    {isPlayingAnim ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
                    <span>{isPlayingAnim ? 'Pause' : 'Play'}</span>
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">Speed</span>
                  <input
                    type="range"
                    min="0.3"
                    max="1.8"
                    step="0.05"
                    value={animSpeed}
                    onChange={e => setAnimSpeed(parseFloat(e.target.value))}
                    className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                  <span className="font-mono text-[10px] text-slate-300 w-8 text-right">{animSpeed.toFixed(1)}x</span>
                </div>
              </div>

            </div>

            {/* Inspector Footer Actions */}
            <div className="p-3 border-t border-white/10 bg-slate-950/80 flex items-center gap-2">
              <button
                onClick={() => {
                  const next = !isLocked
                  setIsLocked(next)
                  showToast(next ? '🔒 Transform Fixed to Floor' : '🔓 Transform Unlocked')
                }}
                className={[
                  'flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all shadow-md',
                  isLocked
                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                    : 'bg-amber-400 text-slate-950 hover:bg-amber-300',
                ].join(' ')}
              >
                {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                <span>{isLocked ? 'AR Locked' : 'Fix / Lock AR'}</span>
              </button>

              <button
                onClick={() => {
                  saveConfig({
                    posX, floorY, posZ,
                    rotY,
                    heightMeters,
                    shadowOpacity,
                    lightIntensity,
                    animSpeed,
                    isLocked,
                  })
                  showToast('💾 Studio layout saved!')
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2.5 rounded-xl border border-white/10 text-xs font-bold transition-all"
                title="Save current layout as default"
              >
                <Check className="w-4 h-4 text-emerald-400" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          EXHIBITION / CLEAN VISITOR MODE FLOATING CORNER CONTROLS
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {isExhibitionMode && (
        <div className="studio-interactive fixed top-3 right-3 z-40 flex items-center gap-2">
          {/* Quick Snapshot Button for Event Guests */}
          <button
            onClick={handleCapturePhoto}
            className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black px-4 py-2.5 rounded-2xl text-xs flex items-center gap-2 shadow-[0_0_25px_rgba(245,158,11,0.6)] hover:scale-105 active:scale-95 transition-all"
          >
            <Camera className="w-4 h-4" />
            <span>Take Photo</span>
          </button>

          {/* Return to Studio Editor */}
          <button
            onClick={() => setIsExhibitionMode(false)}
            className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/15 px-3 py-2.5 rounded-2xl text-xs font-black backdrop-blur-xl shadow-xl transition-all"
            title="Return to Studio Editor"
          >
            <Sliders className="w-4 h-4 text-amber-400" />
          </button>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          SNAPSHOT PREVIEW MODAL
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {capturedSnapshot && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-4 animate-in fade-in">
          <div className="relative max-w-xl w-full bg-slate-900 border border-white/15 rounded-3xl p-4 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-black text-sm flex items-center gap-2">
                <Camera className="w-4 h-4 text-amber-400" />
                <span>Captured AR Snapshot</span>
              </h3>
              <button
                onClick={() => setCapturedSnapshot(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <img
              src={capturedSnapshot}
              alt="AR Snapshot"
              className="w-full rounded-2xl border border-white/10 shadow-lg object-contain max-h-[65vh]"
            />

            <div className="flex items-center gap-2 pt-1">
              <a
                href={capturedSnapshot}
                download={`chotabheem-elephant-ar-${Date.now()}.jpg`}
                className="flex-1 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-98 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Download Photo</span>
              </a>
              <button
                onClick={() => setCapturedSnapshot(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floor Placement Helper Banner (Visible in Direct Drag) ─────────── */}
      {!isExhibitionMode && !isLocked && controlTab !== 'quick' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <p className="text-[11px] text-amber-300 font-bold bg-slate-950/85 border border-amber-400/40 px-3.5 py-1.5 rounded-full backdrop-blur-md shadow-xl flex items-center gap-2">
            <Move className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>Drag anywhere on floor to move • Feet auto-locked to ground</span>
          </p>
        </div>
      )}
    </div>
  )
}
