import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import {
  Move,
  RotateCw,
  Maximize2,
  Lock,
  Unlock,
  Camera,
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
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Grid,
  Crosshair,
  Volume2,
  VolumeX,
  Timer,
  Maximize,
  Minimize,
  Copy,
  ChevronRight,
  ChevronLeft,
  Video,
  Sun,
} from 'lucide-react'

const STORAGE_KEY = 'elephant_studio_ar_config_v7'

const DEFAULT_CONFIG = {
  posX: 0.0,
  posZ: -2.6,           // Optimal front floor distance (meters)
  rotY: 20,             // Facing slightly towards camera (degrees)
  heightMeters: 1.4,    // Real-world height in meters
  feetOffset: -0.25,    // Precise feet-to-ground offset (meters)
  cameraHeight: 1.1,    // Camera height above floor in meters
  cameraPitch: 15,      // Camera downward tilt angle (degrees)
  shadowOpacity: 0.65,
  lightIntensity: 2.2,
  animSpeed: 0.95,
  soundEnabled: true,
  isLocked: false,
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        posX: typeof p.posX === 'number' ? p.posX : DEFAULT_CONFIG.posX,
        posZ: typeof p.posZ === 'number' ? p.posZ : DEFAULT_CONFIG.posZ,
        rotY: typeof p.rotY === 'number' ? p.rotY : DEFAULT_CONFIG.rotY,
        heightMeters: typeof p.heightMeters === 'number' ? p.heightMeters : DEFAULT_CONFIG.heightMeters,
        feetOffset: typeof p.feetOffset === 'number' ? p.feetOffset : DEFAULT_CONFIG.feetOffset,
        cameraHeight: typeof p.cameraHeight === 'number' ? p.cameraHeight : DEFAULT_CONFIG.cameraHeight,
        cameraPitch: typeof p.cameraPitch === 'number' ? p.cameraPitch : DEFAULT_CONFIG.cameraPitch,
        shadowOpacity: typeof p.shadowOpacity === 'number' ? p.shadowOpacity : DEFAULT_CONFIG.shadowOpacity,
        lightIntensity: typeof p.lightIntensity === 'number' ? p.lightIntensity : DEFAULT_CONFIG.lightIntensity,
        animSpeed: typeof p.animSpeed === 'number' ? p.animSpeed : DEFAULT_CONFIG.animSpeed,
        soundEnabled: typeof p.soundEnabled === 'boolean' ? p.soundEnabled : DEFAULT_CONFIG.soundEnabled,
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

// Strip root motion tracks so animation loops smoothly on the floor plane
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

// Web Audio API Synthesizer (Elephant Trumpet & Camera Shutter)
function playAudioEffect(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (type === 'trumpet') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(180, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15)
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.35)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.45)
    } else if (type === 'shutter') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(800, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08)
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.1)
    } else if (type === 'tick') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(600, ctx.currentTime)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.06)
    }
  } catch {
    /* AudioContext blocked */
  }
}

// Global Ground Plane is strictly Y = 0
const WORLD_GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export default function ElephantStudioAR({ onExit, selectedCamera, cameraResolution }) {
  const initial = loadSavedConfig()

  // ── Transform States (Feet PERMANENTLY locked to Ground Y = 0) ─────────────
  const [posX, setPosX]                 = useState(initial.posX)
  const [posZ, setPosZ]                 = useState(initial.posZ)
  const [rotY, setRotY]                 = useState(initial.rotY)
  const [heightMeters, setHeightMeters] = useState(initial.heightMeters)
  const [feetOffset, setFeetOffset]     = useState(initial.feetOffset)
  
  // ── Camera Ground Perspective ──────────────────────────────────────────────
  const [cameraHeight, setCameraHeight] = useState(initial.cameraHeight)
  const [cameraPitch, setCameraPitch]   = useState(initial.cameraPitch)

  // ── Appearance & Audio ─────────────────────────────────────────────────────
  const [shadowOpacity, setShadowOpacity]   = useState(initial.shadowOpacity)
  const [lightIntensity, setLightIntensity] = useState(initial.lightIntensity)
  const [animSpeed, setAnimSpeed]           = useState(initial.animSpeed)
  const [isPlayingAnim, setIsPlayingAnim]   = useState(true)
  const [soundEnabled, setSoundEnabled]     = useState(initial.soundEnabled)
  const [isLocked, setIsLocked]             = useState(initial.isLocked)
  const [showGroundGrid, setShowGroundGrid] = useState(false)

  // ── UI & Mode States ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState('placement') // 'placement' | 'scale' | 'camera'
  const [showControls, setShowControls] = useState(true)
  const [isExhibitionMode, setIsExhibitionMode] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [toastMsg, setToastMsg]         = useState(null)
  const [capturedSnapshot, setCapturedSnapshot] = useState(null)
  const [countdown, setCountdown]       = useState(null)
  const [isLoading, setIsLoading]       = useState(true)
  const [availableCams, setAvailableCams] = useState([])
  const [activeCamId, setActiveCamId]   = useState(() => selectedCamera || localStorage.getItem('cb_ar_camera') || '')
  const [activeRes, setActiveRes]       = useState(() => cameraResolution || localStorage.getItem('cb_ar_resolution') || '720p')

  // ── Three.js & DOM Refs ───────────────────────────────────────────────────
  const containerRef         = useRef(null)
  const videoRef             = useRef(null)
  const canvasRef            = useRef(null)
  const sceneRef             = useRef(null)
  const cameraRef            = useRef(null)
  const rendererRef          = useRef(null)
  const elephantGroupRef     = useRef(null)
  const elSceneRef           = useRef(null)
  const shadowPlaneRef       = useRef(null)
  const targetReticleRef     = useRef(null)
  const groundWaveRef        = useRef(null)
  const gridHelperRef        = useRef(null)
  const characterLightRef    = useRef(null)
  const mixerRef             = useRef(null)
  const nativeDimsRef        = useRef({ nativeHeight: 1.0, nativeMinY: 0.0 })
  const isPointerDraggingRef = useRef(false)
  const pinchStartDistRef    = useRef(null)
  const pinchStartHeightRef  = useRef(1.4)
  const nudgeIntervalRef     = useRef(null)

  const showToast = useCallback((msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }, [])

  // ── Enumerate Devices ─────────────────────────────────────────────────────
  useEffect(() => {
    async function getDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoInputs = devices.filter(d => d.kind === 'videoinput')
        setAvailableCams(videoInputs)
      } catch { /* ignored */ }
    }
    getDevices()
  }, [])

  // ── Apply 3D Transforms (Clamped to Ground Y = 0) ──────────────────────────
  const applyTransforms = useCallback((x, z, ry, h, fOffset) => {
    const group = elephantGroupRef.current
    const model = elSceneRef.current
    const dims = nativeDimsRef.current
    if (!group || !model || dims.nativeHeight <= 0) return

    // Position group strictly on ground plane Y = 0
    group.position.set(x, 0, z)
    group.rotation.set(0, THREE.MathUtils.degToRad(ry), 0)

    // Exact scale in real meters
    const scale = h / dims.nativeHeight
    model.scale.setScalar(scale)

    // Floor clamping: bottom of feet at World Y = 0 + fOffset
    model.position.y = (-dims.nativeMinY * scale) + fOffset

    // Dynamic contact shadow
    if (shadowPlaneRef.current) {
      const sSize = Math.max(2.2, h * 1.75)
      shadowPlaneRef.current.scale.set(sSize, sSize, 1)
    }
  }, [])

  // Sync Camera position & pitch
  const applyCameraCalibration = useCallback((h, pitch) => {
    const camera = cameraRef.current
    if (!camera) return
    camera.position.set(0, h, 0)
    camera.rotation.set(-THREE.MathUtils.degToRad(pitch), 0, 0)
  }, [])

  // Auto-sync & persist on any change
  useEffect(() => {
    applyTransforms(posX, posZ, rotY, heightMeters, feetOffset)
    applyCameraCalibration(cameraHeight, cameraPitch)

    saveConfig({
      posX, posZ,
      rotY,
      heightMeters,
      feetOffset,
      cameraHeight,
      cameraPitch,
      shadowOpacity,
      lightIntensity,
      animSpeed,
      soundEnabled,
      isLocked,
    })
  }, [posX, posZ, rotY, heightMeters, feetOffset, cameraHeight, cameraPitch, shadowOpacity, lightIntensity, animSpeed, soundEnabled, isLocked, applyTransforms, applyCameraCalibration])

  // Sync lighting & shadow
  useEffect(() => {
    if (shadowPlaneRef.current) {
      shadowPlaneRef.current.material.opacity = shadowOpacity
    }
    if (characterLightRef.current) {
      characterLightRef.current.intensity = lightIntensity
    }
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGroundGrid && !isExhibitionMode
    }
  }, [shadowOpacity, lightIntensity, showGroundGrid, isExhibitionMode])

  // Sync animation
  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.timeScale = isPlayingAnim ? animSpeed : 0
    }
  }, [animSpeed, isPlayingAnim])

  // ── WebRTC HD Camera Stream ───────────────────────────────────────────────
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
        console.warn('HD camera stream fallback:', camErr)
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

    // Scene
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Camera calibrated to ground perspective
    const camera = new THREE.PerspectiveCamera(
      54,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    )
    camera.position.set(0, initial.cameraHeight, 0)
    camera.rotation.set(-THREE.MathUtils.degToRad(initial.cameraPitch), 0, 0)
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

    // Ground Helper Grid at Y = 0
    const grid = new THREE.GridHelper(12, 24, 0xf59e0b, 0x334155)
    grid.position.y = 0.001
    grid.visible = false
    scene.add(grid)
    gridHelperRef.current = grid

    // AR Ground Target Reticle (Glowing Ring on floor)
    const ringGeo = new THREE.RingGeometry(0.35, 0.42, 32)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    const reticle = new THREE.Mesh(ringGeo, ringMat)
    reticle.rotation.x = -Math.PI / 2
    reticle.position.set(initial.posX, 0.003, initial.posZ)
    scene.add(reticle)
    targetReticleRef.current = reticle

    // Ground Ripple Wave on Placement
    const waveGeo = new THREE.RingGeometry(0.01, 0.1, 32)
    const waveMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.0 })
    const wave = new THREE.Mesh(waveGeo, waveMat)
    wave.rotation.x = -Math.PI / 2
    wave.position.set(initial.posX, 0.004, initial.posZ)
    scene.add(wave)
    groundWaveRef.current = wave

    // Elephant Root Group (placed strictly at ground floor level Y = 0)
    const elephantGroup = new THREE.Group()
    elephantGroup.position.set(initial.posX, 0, initial.posZ)
    scene.add(elephantGroup)
    elephantGroupRef.current = elephantGroup
    keyLight.target = elephantGroup

    // Ground Contact Shadow Plane (sitting right on the floor Y = 0.002)
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: initial.shadowOpacity, transparent: true })
    )
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.position.y = 0.002
    shadowPlane.receiveShadow = true
    elephantGroup.add(shadowPlane)
    shadowPlaneRef.current = shadowPlane

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
          initial.posX, initial.posZ,
          initial.rotY,
          initial.heightMeters,
          initial.feetOffset
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

      // Animate reticle pulse
      if (targetReticleRef.current) {
        const p = Math.sin(clock.getElapsedTime() * 3) * 0.06 + 1.0
        targetReticleRef.current.scale.set(p, p, 1)
      }

      // Animate ground ripple wave
      if (groundWaveRef.current && groundWaveRef.current.material.opacity > 0.01) {
        groundWaveRef.current.scale.multiplyScalar(1.05)
        groundWaveRef.current.material.opacity *= 0.92
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
      renderer.dispose()
      mixerRef.current = null
      elSceneRef.current = null
      elephantGroupRef.current = null
    }
  }, [applyTransforms, initial])

  // ── Trigger Ground Placement Wave ─────────────────────────────────────────
  const triggerGroundWave = (x, z) => {
    if (groundWaveRef.current) {
      groundWaveRef.current.position.set(x, 0.004, z)
      groundWaveRef.current.scale.set(1, 1, 1)
      groundWaveRef.current.material.opacity = 0.8
    }
    if (soundEnabled) {
      playAudioEffect('trumpet')
    }
  }

  // ── Smooth Direct Screen-to-Ground Raycasting Drag ────────────────────────
  const raycastGroundPoint = useCallback((clientX, clientY) => {
    const container = containerRef.current
    const camera = cameraRef.current
    if (!container || !camera) return null

    const rect = container.getBoundingClientRect()
    const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1
    const mouseY = -((clientY - rect.top) / rect.height) * 2 + 1

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera)

    const targetPoint = new THREE.Vector3()
    // Intersect strictly with the infinite ground plane Y = 0
    if (raycaster.ray.intersectPlane(WORLD_GROUND_PLANE, targetPoint)) {
      if (targetPoint.z < -0.5 && targetPoint.z > -15.0) {
        const clampedX = Math.max(-5.0, Math.min(5.0, targetPoint.x))
        const clampedZ = Math.max(-8.0, Math.min(-0.8, targetPoint.z))
        return { x: parseFloat(clampedX.toFixed(2)), z: parseFloat(clampedZ.toFixed(2)) }
      }
    }
    return null
  }, [])

  const handlePointerDown = (e) => {
    if (isLocked || isExhibitionMode) return
    if (e.target.closest('.studio-interactive')) return

    const pt = raycastGroundPoint(e.clientX, e.clientY)
    if (pt) {
      isPointerDraggingRef.current = true
      setPosX(pt.x)
      setPosZ(pt.z)
      triggerGroundWave(pt.x, pt.z)
      if (targetReticleRef.current) {
        targetReticleRef.current.position.set(pt.x, 0.003, pt.z)
      }
    }
  }

  const handlePointerMove = (e) => {
    if (e.target.closest('.studio-interactive')) return

    const pt = raycastGroundPoint(e.clientX, e.clientY)
    if (pt && targetReticleRef.current) {
      targetReticleRef.current.position.set(pt.x, 0.003, pt.z)
    }

    if (isPointerDraggingRef.current && pt && !isLocked && !isExhibitionMode) {
      setPosX(pt.x)
      setPosZ(pt.z)
    }
  }

  const handlePointerUp = () => {
    if (isPointerDraggingRef.current) {
      isPointerDraggingRef.current = false
      showToast('🐘 Placed on Ground')
    }
  }

  // ── Multi-Touch Pinch-to-Zoom Scale ───────────────────────────────────────
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchStartDistRef.current = Math.hypot(dx, dy)
      pinchStartHeightRef.current = heightMeters
    }
  }

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && pinchStartDistRef.current && !isLocked) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const currentDist = Math.hypot(dx, dy)
      const ratio = currentDist / pinchStartDistRef.current
      const newHeight = Math.min(3.5, Math.max(0.6, pinchStartHeightRef.current * ratio))
      setHeightMeters(parseFloat(newHeight.toFixed(2)))
    }
  }

  // ── Precision Step Nudge Handlers (Single Tap + Long Press Continuous) ────
  const nudge = (setter, delta, decimals = 2) => {
    setter(prev => parseFloat((prev + delta).toFixed(decimals)))
  }

  const startContinuousNudge = (setter, delta, decimals = 2) => {
    nudge(setter, delta, decimals)
    nudgeIntervalRef.current = setInterval(() => {
      nudge(setter, delta, decimals)
    }, 120)
  }

  const stopContinuousNudge = () => {
    if (nudgeIntervalRef.current) {
      clearInterval(nudgeIntervalRef.current)
      nudgeIntervalRef.current = null
    }
  }

  const handleResetCenter = () => {
    setPosX(DEFAULT_CONFIG.posX)
    setPosZ(DEFAULT_CONFIG.posZ)
    setRotY(DEFAULT_CONFIG.rotY)
    setHeightMeters(DEFAULT_CONFIG.heightMeters)
    setFeetOffset(DEFAULT_CONFIG.feetOffset)
    setCameraHeight(DEFAULT_CONFIG.cameraHeight)
    setCameraPitch(DEFAULT_CONFIG.cameraPitch)
    if (targetReticleRef.current) {
      targetReticleRef.current.position.set(DEFAULT_CONFIG.posX, 0.003, DEFAULT_CONFIG.posZ)
    }
    showToast('Reset to Default Ground Setup')
  }

  // ── Preset Ground Calibration ─────────────────────────────────────────────
  const setGroundPreset = (type) => {
    if (type === 'laptop') {
      setCameraHeight(0.95)
      setCameraPitch(14)
      setPosZ(-2.4)
      showToast('💻 Calibrated for Desk / Laptop View')
    } else if (type === 'standing') {
      setCameraHeight(1.35)
      setCameraPitch(18)
      setPosZ(-2.8)
      showToast('🧍 Calibrated for Standing / Tripod View')
    } else if (type === 'stage') {
      setCameraHeight(1.8)
      setCameraPitch(24)
      setPosZ(-3.4)
      showToast('🏢 Calibrated for High Mount / Stage View')
    }
  }

  // ── Fullscreen Toggle ─────────────────────────────────────────────────────
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  // ── Photo Snapshot Capture (With 3s Countdown Timer) ──────────────────────
  const startPhotoCountdown = () => {
    if (countdown !== null) return
    let count = 3
    setCountdown(count)
    if (soundEnabled) playAudioEffect('tick')

    const timer = setInterval(() => {
      count -= 1
      if (count > 0) {
        setCountdown(count)
        if (soundEnabled) playAudioEffect('tick')
      } else {
        clearInterval(timer)
        setCountdown(null)
        executeSnapshot()
      }
    }, 1000)
  }

  const executeSnapshot = () => {
    const video = videoRef.current
    const canvas3D = canvasRef.current
    if (!video || !canvas3D) return

    if (soundEnabled) playAudioEffect('shutter')

    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = canvas3D.width
    snapCanvas.height = canvas3D.height
    const ctx = snapCanvas.getContext('2d')

    // 1. Draw camera video frame
    ctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height)

    // 2. Draw 3D WebGL render layer on top
    ctx.drawImage(canvas3D, 0, 0, snapCanvas.width, snapCanvas.height)

    // 3. Watermark badge with timestamp
    const now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.roundRect(snapCanvas.width - 270, snapCanvas.height - 65, 250, 48, 14)
    ctx.fill()
    ctx.fillStyle = '#f59e0b'
    ctx.font = 'bold 15px Inter, sans-serif'
    ctx.fillText('🐘 CHHOTA BHEEM AR', snapCanvas.width - 250, snapCanvas.height - 38)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px Inter, sans-serif'
    ctx.fillText(`Ground AR Studio • ${now}`, snapCanvas.width - 250, snapCanvas.height - 23)

    const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.94)
    setCapturedSnapshot(dataUrl)
    showToast('📸 Photo snapshot captured!')
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
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
        <div className="absolute inset-0 z-40 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin shadow-2xl" />
          <p className="text-white font-black text-sm tracking-wide">Placing 3D Elephant on Ground...</p>
        </div>
      )}

      {/* ── Toast Notification ───────────────────────────────────────────── */}
      {toastMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-amber-400/60 text-amber-300 font-bold text-xs px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── 3-Second Photo Countdown Overlay ─────────────────────────────── */}
      {countdown !== null && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/30 backdrop-blur-xs">
          <div className="text-8xl sm:text-9xl font-black text-amber-400 drop-shadow-[0_0_35px_rgba(245,158,11,0.8)] animate-ping">
            {countdown}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TOP HEADER BAR
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!isExhibitionMode && (
        <header className="studio-interactive fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2.5 bg-slate-950/85 backdrop-blur-xl border-b border-white/10 shadow-xl gap-2">
          {/* Left: Exit & Title */}
          <div className="flex items-center gap-2">
            <button
              onClick={onExit}
              className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-3 py-1.5 rounded-xl border border-white/10 text-xs font-black flex items-center gap-1.5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </button>
            <div className="flex items-center gap-1.5">
              <span className="text-amber-400 font-black text-sm">🐘 Elephant AR</span>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-400/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                GROUND LOCKED (Y = 0)
              </span>
            </div>
          </div>

          {/* Right: Camera Picker, Grid, Sound, Lock, Snapshot & Show Mode */}
          <div className="flex items-center gap-1.5">
            {/* Toggle Ground Grid */}
            <button
              onClick={() => setShowGroundGrid(!showGroundGrid)}
              className={[
                'p-2 rounded-xl text-xs font-black transition-all border flex items-center gap-1',
                showGroundGrid
                  ? 'bg-amber-500/30 text-amber-300 border-amber-400/40'
                  : 'bg-slate-800 text-slate-400 border-white/10 hover:bg-slate-700',
              ].join(' ')}
              title="Toggle Ground Grid Plane"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>

            {/* Sound Toggle */}
            <button
              onClick={() => {
                const next = !soundEnabled
                setSoundEnabled(next)
                showToast(next ? '🔊 Audio Effects Enabled' : '🔇 Audio Muted')
              }}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs border border-white/10 transition-all"
              title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-amber-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
            </button>

            {/* Toggle Controls Panel */}
            <button
              onClick={() => setShowControls(!showControls)}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all',
                showControls
                  ? 'bg-amber-400 text-slate-950 font-black shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/10',
              ].join(' ')}
              title="Toggle Controls Panel"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showControls ? 'Hide Controls' : 'Show Controls'}</span>
            </button>

            {/* Lock / Freeze AR */}
            <button
              onClick={() => {
                const next = !isLocked
                setIsLocked(next)
                showToast(next ? '🔒 Elephant Locked on Ground' : '🔓 Elephant Position Unlocked')
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

            {/* Photo Snapshot with 3s Timer */}
            <button
              onClick={startPhotoCountdown}
              className="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-white/10 p-2 rounded-xl text-xs font-black transition-all shadow-md active:scale-95 flex items-center gap-1"
              title="Take photo with 3-second timer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="text-[10px] hidden sm:inline">3s</span>
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
              <span className="hidden sm:inline">Show Mode</span>
            </button>
          </div>
        </header>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          RIGHT-SIDE DOCKABLE STUDIO CONTROLS (Categorized Tabs)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!isExhibitionMode && showControls && (
        <aside className="studio-interactive fixed right-3 top-14 bottom-4 z-30 w-84 max-w-[calc(100vw-24px)] flex flex-col transition-all">
          <div className="bg-slate-900/95 backdrop-blur-2xl border border-white/15 rounded-3xl p-3.5 shadow-[0_10px_40px_rgba(0,0,0,0.8)] flex flex-col gap-2.5 h-full overflow-y-auto">
            
            {/* Header: Title & Actions */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2 bg-slate-950/50 -mx-3.5 -mt-3.5 px-3.5 pt-3 rounded-t-3xl">
              <span className="text-white font-black text-xs tracking-wider uppercase flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-amber-400" /> Ground AR Controls
              </span>
              <button
                onClick={handleResetCenter}
                className="text-slate-400 hover:text-amber-300 text-[10px] font-bold flex items-center gap-0.5"
                title="Reset to center"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="grid grid-cols-3 gap-1 bg-slate-950/70 p-1 rounded-2xl border border-white/10">
              <button
                onClick={() => setActiveTab('placement')}
                className={[
                  'py-1.5 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1',
                  activeTab === 'placement' ? 'bg-amber-400 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white',
                ].join(' ')}
              >
                <Move className="w-3 h-3" /> Placement
              </button>
              <button
                onClick={() => setActiveTab('scale')}
                className={[
                  'py-1.5 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1',
                  activeTab === 'scale' ? 'bg-amber-400 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white',
                ].join(' ')}
              >
                <Maximize2 className="w-3 h-3" /> Scale & Feet
              </button>
              <button
                onClick={() => setActiveTab('camera')}
                className={[
                  'py-1.5 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1',
                  activeTab === 'camera' ? 'bg-amber-400 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white',
                ].join(' ')}
              >
                <Video className="w-3 h-3" /> Camera
              </button>
            </div>

            {/* ── TAB 1: PLACEMENT & MOVEMENT ─────────────────────────────── */}
            {activeTab === 'placement' && (
              <div className="flex flex-col gap-2.5">
                {/* Tap-to-Place Banner */}
                <div className="bg-amber-500/15 border border-amber-400/30 rounded-2xl p-2.5 flex items-center gap-2 text-amber-300 text-[11px] font-bold">
                  <Crosshair className="w-4 h-4 text-amber-400 shrink-0 animate-spin" style={{ animationDuration: '6s' }} />
                  <span>Tap anywhere on your floor to place elephant directly there!</span>
                </div>

                {/* Distance on Floor (Closer / Farther) */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-slate-300 flex items-center gap-1">
                      <ArrowUp className="w-3 h-3 text-blue-400" /> Floor Distance (Closer/Farther)
                    </span>
                    <span className="font-mono text-[10px] text-blue-400 font-bold">{Math.abs(posZ).toFixed(2)}m</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onMouseDown={() => startContinuousNudge(setPosZ, 0.35)}
                      onMouseUp={stopContinuousNudge}
                      onMouseLeave={stopContinuousNudge}
                      onTouchStart={() => startContinuousNudge(setPosZ, 0.35)}
                      onTouchEnd={stopContinuousNudge}
                      className="flex-1 py-2.5 bg-blue-500/20 border border-blue-400/30 hover:bg-blue-500/30 active:scale-95 text-blue-300 font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all shadow-sm"
                      title="Hold to bring closer continuously"
                    >
                      ⬇ Bring Closer
                    </button>
                    <button
                      onMouseDown={() => startContinuousNudge(setPosZ, -0.35)}
                      onMouseUp={stopContinuousNudge}
                      onMouseLeave={stopContinuousNudge}
                      onTouchStart={() => startContinuousNudge(setPosZ, -0.35)}
                      onTouchEnd={stopContinuousNudge}
                      className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all shadow-sm"
                      title="Hold to push farther continuously"
                    >
                      ⬆ Push Farther
                    </button>
                  </div>
                </div>

                {/* Move Left / Right */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-slate-300 flex items-center gap-1">
                      <ArrowLeft className="w-3 h-3 text-amber-400" /> Move Left / Right
                    </span>
                    <span className="font-mono text-[10px] text-amber-400 font-bold">{posX > 0 ? `+${posX.toFixed(2)}` : posX.toFixed(2)}m</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onMouseDown={() => startContinuousNudge(setPosX, -0.25)}
                      onMouseUp={stopContinuousNudge}
                      onMouseLeave={stopContinuousNudge}
                      onTouchStart={() => startContinuousNudge(setPosX, -0.25)}
                      onTouchEnd={stopContinuousNudge}
                      className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all shadow-sm"
                    >
                      <ArrowLeft className="w-4 h-4" /> Left
                    </button>
                    <button
                      onMouseDown={() => startContinuousNudge(setPosX, 0.25)}
                      onMouseUp={stopContinuousNudge}
                      onMouseLeave={stopContinuousNudge}
                      onTouchStart={() => startContinuousNudge(setPosX, 0.25)}
                      onTouchEnd={stopContinuousNudge}
                      className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all shadow-sm"
                    >
                      Right <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Turn / Orientation */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-slate-300 flex items-center gap-1">
                      <RotateCw className="w-3 h-3 text-purple-400" /> Turn Elephant
                    </span>
                    <span className="font-mono text-[10px] text-purple-400 font-bold">{rotY}°</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => nudge(setRotY, -20, 0)}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center transition-all"
                    >
                      ↶ Left (-20°)
                    </button>
                    <button
                      onClick={() => nudge(setRotY, 20, 0)}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black rounded-xl text-xs flex items-center justify-center transition-all"
                    >
                      Right (+20°) ↷
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 2: SCALE & FEET CONTACT ─────────────────────────────── */}
            {activeTab === 'scale' && (
              <div className="flex flex-col gap-2.5">
                {/* Feet-to-Floor Touch Clamping */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-emerald-400 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> Feet-to-Floor Contact
                    </span>
                    <span className="font-mono text-[10px] text-emerald-300 font-bold">
                      {feetOffset > 0 ? `+${feetOffset.toFixed(2)}` : feetOffset.toFixed(2)}m
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => nudge(setFeetOffset, -0.05)}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all shadow-sm"
                      title="Lower feet firmly to shadow plane"
                    >
                      ⬇ Lower Feet (-5cm)
                    </button>
                    <button
                      onClick={() => nudge(setFeetOffset, 0.05)}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-black rounded-xl text-xs flex items-center justify-center gap-1 transition-all shadow-sm"
                      title="Raise feet higher"
                    >
                      ⬆ Raise Feet (+5cm)
                    </button>
                  </div>
                </div>

                {/* Size / Height in Meters */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-slate-300 flex items-center gap-1">
                      <Maximize2 className="w-3 h-3 text-amber-400" /> Size (Height)
                    </span>
                    <span className="font-mono text-[10px] text-amber-400 font-bold">{heightMeters.toFixed(2)}m</span>
                  </div>
                  <div className="flex items-center gap-2">
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

                  {/* Size Presets */}
                  <div className="grid grid-cols-4 gap-1 pt-1">
                    {[
                      { label: 'Small', h: 1.1 },
                      { label: 'Normal', h: 1.4 },
                      { label: 'Adult', h: 1.8 },
                      { label: 'Giant', h: 2.4 },
                    ].map(p => (
                      <button
                        key={p.label}
                        onClick={() => setHeightMeters(p.h)}
                        className={[
                          'py-1 rounded-lg text-[10px] font-bold border transition-all',
                          Math.abs(heightMeters - p.h) < 0.08
                            ? 'bg-amber-400 text-slate-950 border-amber-300 font-black'
                            : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                        ].join(' ')}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Shadow Opacity & Lighting */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-slate-300 flex items-center gap-1">
                      <Sun className="w-3 h-3 text-amber-300" /> Shadow Darkness
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{Math.round(shadowOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="0.9"
                    step="0.05"
                    value={shadowOpacity}
                    onChange={e => setShadowOpacity(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                </div>
              </div>
            )}

            {/* ── TAB 3: CAMERA & ENVIRONMENT CALIBRATION ─────────────────── */}
            {activeTab === 'camera' && (
              <div className="flex flex-col gap-2.5">
                {/* Perspective Setup Presets */}
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-slate-300">Room Perspective Setup</span>
                    <span className="text-[10px] text-slate-400 font-mono">{cameraHeight.toFixed(2)}m / {cameraPitch}°</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => setGroundPreset('laptop')}
                      className="py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[10px] font-bold border border-white/5 transition-all"
                    >
                      💻 Laptop
                    </button>
                    <button
                      onClick={() => setGroundPreset('standing')}
                      className="py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[10px] font-bold border border-white/5 transition-all"
                    >
                      🧍 Tripod
                    </button>
                    <button
                      onClick={() => setGroundPreset('stage')}
                      className="py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[10px] font-bold border border-white/5 transition-all"
                    >
                      🏢 Stage
                    </button>
                  </div>

                  {/* Tilt & Height Steppers */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10 text-[10px]">
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-400 font-bold">Camera Tilt</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => nudge(setCameraPitch, -2, 0)}
                          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold"
                        >
                          ▲ Up
                        </button>
                        <button
                          onClick={() => nudge(setCameraPitch, 2, 0)}
                          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold"
                        >
                          ▼ Down
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-slate-400 font-bold">Camera Height</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => nudge(setCameraHeight, -0.1)}
                          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold"
                        >
                          -10cm
                        </button>
                        <button
                          onClick={() => nudge(setCameraHeight, 0.1)}
                          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold"
                        >
                          +10cm
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Resolution Selector */}
                {availableCams.length > 0 && (
                  <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-black text-slate-300">Camera Source</span>
                    <select
                      value={activeCamId}
                      onChange={e => {
                        setActiveCamId(e.target.value)
                        localStorage.setItem('cb_ar_camera', e.target.value)
                      }}
                      className="bg-slate-900 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white"
                    >
                      {availableCams.map((c, i) => (
                        <option key={c.deviceId || i} value={c.deviceId}>
                          {c.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* ── FOOTER: ANIMATION WALK & LOCK BUTTON ─────────────────────── */}
            <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-2 mt-auto">
              <div className="flex items-center justify-between text-[11px] font-black text-slate-300">
                <span>Animation Walk</span>
                <button
                  onClick={() => setIsPlayingAnim(!isPlayingAnim)}
                  className="text-amber-400 hover:text-amber-300 flex items-center gap-1 font-bold text-xs"
                >
                  {isPlayingAnim ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{isPlayingAnim ? 'Pause' : 'Play'}</span>
                </button>
              </div>

              {/* Large Lock Button */}
              <button
                onClick={() => {
                  const next = !isLocked
                  setIsLocked(next)
                  showToast(next ? '🔒 Elephant Locked on Ground' : '🔓 Elephant Position Unlocked')
                }}
                className={[
                  'w-full py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-98',
                  isLocked
                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                    : 'bg-amber-400 text-slate-950 hover:bg-amber-300',
                ].join(' ')}
              >
                {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                <span>{isLocked ? 'AR Ground Locked' : 'Lock AR Position'}</span>
              </button>
            </div>

          </div>
        </aside>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          EXHIBITION / CLEAN VISITOR MODE
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {isExhibitionMode && (
        <div className="studio-interactive fixed top-4 right-4 z-40 flex items-center gap-2">
          {/* Quick Snapshot Button for Event Guests */}
          <button
            onClick={startPhotoCountdown}
            className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black px-5 py-3 rounded-2xl text-xs flex items-center gap-2 shadow-[0_0_25px_rgba(245,158,11,0.6)] hover:scale-105 active:scale-95 transition-all"
          >
            <Camera className="w-4 h-4" />
            <span>Take Photo (3s)</span>
          </button>

          {/* Return to Studio Editor */}
          <button
            onClick={() => setIsExhibitionMode(false)}
            className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/15 p-3 rounded-2xl text-xs font-black backdrop-blur-xl shadow-xl transition-all"
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

      {/* ── Floor Placement Helper Banner (Visible during direct drag) ─────── */}
      {!isExhibitionMode && !isLocked && (
        <div className="fixed bottom-4 left-4 z-20 pointer-events-none">
          <p className="text-[11px] text-amber-300 font-bold bg-slate-950/85 border border-amber-400/40 px-3.5 py-1.5 rounded-full backdrop-blur-md shadow-xl flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5 text-amber-400 animate-spin" style={{ animationDuration: '4s' }} />
            <span>Tap your room floor to place elephant • Ground Locked (Y = 0)</span>
          </p>
        </div>
      )}
    </div>
  )
}
