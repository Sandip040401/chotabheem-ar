import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js'
import {
  Lock,
  Unlock,
  Plus,
  Minus,
  RotateCcw,
  RotateCw,
  Settings,
  X,
  RefreshCw,
  Check,
  Sliders,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Sparkles,
  Camera,
} from 'lucide-react'

/**
 * MarkerARScene — Occlusion-Proof Fixed AR with Manual "Fix Position" & Config System
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. FIX POSITION (LOCK) SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 * - The operator points the camera at the floor marker.
 * - As soon as MindAR detects the marker, the character appears and the
 *   "📌 Fix Position" button lights up.
 * - Even if the marker briefly flickers or is obscured before clicking,
 *   the system holds the last detected position so the character never vanishes
 *   and the user can confidently click "Fix Position".
 * - Once clicked, the 3D position & rotation are permanently frozen. People can
 *   stand on the marker, walk over it, or cover it — the character remains fixed.
 * - Operators can click "Unlock / Re-align" anytime to reposition.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. REAL-WORLD SIZING & FEET GROUNDING
 * ─────────────────────────────────────────────────────────────────────────────
 * - 1 Three.js unit in MindAR = markerWidthMeters.
 * - Character scale = (heightMeters / markerWidthMeters) / nativeModelHeight.
 * - Feet are mathematically clamped to the floor plane:
 *     model.position.y = floorOffset - (nativeMinY * currentScale)
 * - Sizing buttons (+) and (-) or the slider adjust scale live in real meters.
 */

// ── Default configuration & LocalStorage key ────────────────────────────────
const STORAGE_KEY = 'chotabheem_ar_config_v1'

const DEFAULT_CONFIG = {
  markerWidthMeters: 1.0,
  characterHeightMeters: 1.5,
  minHeightMeters: 0.2,
  maxHeightMeters: 6.0,
  heightStepMeters: 0.1,
  characterRotationDegrees: 0,
  floorOffsetMeters: 0.002,
  nudgeStepMeters: 0.05,
  positionSmoothing: 0.15,
  rotationSmoothing: 0.15,
  missTolerance: 200,
  maxPixelRatio: 2.0,
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        markerWidth: typeof parsed.markerWidth === 'number' ? parsed.markerWidth : DEFAULT_CONFIG.markerWidthMeters,
        height: typeof parsed.height === 'number' ? parsed.height : DEFAULT_CONFIG.characterHeightMeters,
        rotation: typeof parsed.rotation === 'number' ? parsed.rotation : DEFAULT_CONFIG.characterRotationDegrees,
        floorOffset: typeof parsed.floorOffset === 'number' ? parsed.floorOffset : DEFAULT_CONFIG.floorOffsetMeters,
        nudgeX: typeof parsed.nudgeX === 'number' ? parsed.nudgeX : 0,
        nudgeZ: typeof parsed.nudgeZ === 'number' ? parsed.nudgeZ : 0,
      }
    }
  } catch (e) {
    console.warn('Failed to load saved AR config:', e)
  }
  return {
    markerWidth: DEFAULT_CONFIG.markerWidthMeters,
    height: DEFAULT_CONFIG.characterHeightMeters,
    rotation: DEFAULT_CONFIG.characterRotationDegrees,
    floorOffset: DEFAULT_CONFIG.floorOffsetMeters,
    nudgeX: 0,
    nudgeZ: 0,
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch (e) {
    console.warn('Failed to save AR config:', e)
  }
}

// ── Strip root bone motion ──────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function MarkerARScene({ onExit, selectedCamera, cameraResolution }) {
  const containerRef = useRef(null)
  const mindARRef    = useRef(null)

  // Loaded user settings
  const initialCfg = loadSavedConfig()
  const [markerWidth, setMarkerWidth]         = useState(initialCfg.markerWidth || DEFAULT_CONFIG.markerWidthMeters)
  const [characterHeight, setCharacterHeight] = useState(initialCfg.height)
  const [rotationDegrees, setRotationDegrees] = useState(initialCfg.rotation)
  const [floorOffset, setFloorOffset]         = useState(initialCfg.floorOffset)
  const [nudgeX, setNudgeX]                   = useState(initialCfg.nudgeX)
  const [nudgeZ, setNudgeZ]                   = useState(initialCfg.nudgeZ)

  // Camera Quality & Device states (720p HD by default for fast 30fps tracking)
  const [activeCamId, setActiveCamId]         = useState(() => selectedCamera || localStorage.getItem('cb_ar_camera') || '')
  const [activeRes, setActiveRes]             = useState(() => cameraResolution || localStorage.getItem('cb_ar_resolution') || '720p')
  const [cameraInfo, setCameraInfo]           = useState({ width: 0, height: 0, fps: 0, label: '' })
  const [availableCameras, setAvailableCameras] = useState([])

  // Tracking & Pose Lock states
  // 'searching' | 'detected' | 'held' | 'locked'
  const [trackingState, setTrackingState]   = useState('searching')
  const [isPositionLocked, setIsPositionLocked] = useState(false)
  const [hasEverDetected, setHasEverDetected]   = useState(false)
  const [isStarting, setIsStarting]         = useState(true)
  const [loadingMsg, setLoadingMsg]         = useState('Initialising High-Definition AR...')
  const [errorMsg, setErrorMsg]             = useState(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [saveToast, setSaveToast]           = useState(false)

  // Enumerate cameras so user can switch between webcams if multiple are connected
  useEffect(() => {
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoDevs = devices.filter(d => d.kind === 'videoinput')
        setAvailableCameras(videoDevs)
      }).catch(() => {})
    }
  }, [])

  // Refs for 3D objects and render loop
  const elSceneRef            = useRef(null)
  const elephantGroupRef      = useRef(null)
  const shadowPlaneRef        = useRef(null)
  const characterLightRef     = useRef(null)
  const mixerRef              = useRef(null)
  const nativeDimsRef         = useRef({ nativeHeight: 1.0, nativeMinY: 0.0 })
  const markerRootRef         = useRef(null)
  const anchorRef             = useRef(null)
  const fixedGroupRef         = useRef(null)

  // Pose Lock data
  const lockRef = useRef({
    isLocked: false,
    hasPose: false,
    lastDetectedMatrix: new THREE.Matrix4(),
  })

  // Live transform parameters ref so render loop doesn't lag behind state
  const liveParamsRef = useRef({
    height: initialCfg.height,
    rotation: initialCfg.rotation,
    floorOffset: initialCfg.floorOffset,
    nudgeX: initialCfg.nudgeX,
    nudgeZ: initialCfg.nudgeZ,
    markerWidth: initialCfg.markerWidth || DEFAULT_CONFIG.markerWidthMeters,
  })

  // ── Sync 3D transforms on config changes ──────────────────────────────────
  const apply3DTransforms = useCallback((h, rotDeg, fOffset, nx, nz, mW = markerWidth) => {
    liveParamsRef.current = { height: h, rotation: rotDeg, floorOffset: fOffset, nudgeX: nx, nudgeZ: nz, markerWidth: mW }

    const elScene = elSceneRef.current
    const dims = nativeDimsRef.current
    if (!elScene || !dims || dims.nativeHeight <= 0) return

    const effMarkerW = Math.max(0.05, mW || DEFAULT_CONFIG.markerWidthMeters)

    // Exact real-world scale:
    // In MindAR anchor units, 1.0 unit = 1 full marker width.
    // So character height in anchor units = h / effMarkerW.
    const currentScale = (h / effMarkerW) / dims.nativeHeight
    elScene.scale.setScalar(currentScale)

    // Floor contact: feet stay at exact floor offset regardless of scale
    elScene.position.y = fOffset - (dims.nativeMinY * currentScale)
    elScene.position.x = nx / effMarkerW
    elScene.position.z = nz / effMarkerW
    elScene.rotation.y = THREE.MathUtils.degToRad(rotDeg)

    // Dynamic shadow plane scale
    if (shadowPlaneRef.current) {
      const shadowSize = Math.max(effMarkerW * 0.7, h * 1.5)
      shadowPlaneRef.current.scale.set(shadowSize / effMarkerW, shadowSize / effMarkerW, 1)
    }
  }, [markerWidth])

  // Update whenever state changes & auto-save to localStorage
  useEffect(() => {
    apply3DTransforms(characterHeight, rotationDegrees, floorOffset, nudgeX, nudgeZ, markerWidth)
    saveConfig({
      markerWidth,
      height: characterHeight,
      rotation: rotationDegrees,
      floorOffset,
      nudgeX,
      nudgeZ,
    })
  }, [characterHeight, rotationDegrees, floorOffset, nudgeX, nudgeZ, markerWidth, apply3DTransforms])

  // ── Quick controls ────────────────────────────────────────────────────────
  const handleScaleDelta = (delta) => {
    setCharacterHeight(prev => {
      const next = Math.round((prev + delta) * 100) / 100
      return Math.min(DEFAULT_CONFIG.maxHeightMeters, Math.max(DEFAULT_CONFIG.minHeightMeters, next))
    })
  }

  const handleRotationDelta = (degrees) => {
    setRotationDegrees(prev => {
      let next = prev + degrees
      if (next < 0) next += 360
      if (next >= 360) next -= 360
      return next
    })
  }

  // ── Fix / Lock Position ───────────────────────────────────────────────────
  const handleFixPosition = useCallback(() => {
    const lk = lockRef.current
    if (!lk.hasPose) return

    lk.isLocked = true
    setIsPositionLocked(true)
    setTrackingState('locked')

    if (fixedGroupRef.current && markerRootRef.current) {
      fixedGroupRef.current.matrix.copy(lk.lastDetectedMatrix)
      fixedGroupRef.current.matrixWorld.copy(lk.lastDetectedMatrix)
      if (markerRootRef.current.parent !== fixedGroupRef.current) {
        fixedGroupRef.current.add(markerRootRef.current)
      }
      fixedGroupRef.current.visible = true
    }

    // Visual confirmation toast
    setSaveToast(true)
    setTimeout(() => setSaveToast(false), 2500)
  }, [])

  // ── Unlock Position ───────────────────────────────────────────────────────
  const handleUnlockPosition = useCallback(() => {
    const lk = lockRef.current
    lk.isLocked = false
    setIsPositionLocked(false)

    if (anchorRef.current?.group && markerRootRef.current) {
      if (markerRootRef.current.parent !== anchorRef.current.group) {
        anchorRef.current.group.add(markerRootRef.current)
      }
    }
    if (fixedGroupRef.current) {
      fixedGroupRef.current.visible = false
    }

    setTrackingState('searching')
  }, [])

  // ── Camera Quality & Device Switching ────────────────────────────────────
  const handleSwitchResolution = async (newRes) => {
    setActiveRes(newRes)
    localStorage.setItem('cb_ar_resolution', newRes)
    const video = mindARRef.current?.video
    if (video?.srcObject) {
      const track = video.srcObject.getVideoTracks()[0]
      if (track) {
        const [w, h] = newRes === '4k' ? [3840, 2160] : newRes === '1080p' ? [1920, 1080] : [1280, 720]
        await track.applyConstraints({ width: { ideal: w }, height: { ideal: h } }).catch(() => {})
        const s = track.getSettings?.() || {}
        setCameraInfo(prev => ({
          ...prev,
          width: s.width || w,
          height: s.height || h,
          fps: Math.round(s.frameRate || 30),
        }))
        mindARRef.current?.resize?.()
      }
    }
  }

  const handleSwitchCamera = (newCamId) => {
    setActiveCamId(newCamId)
    localStorage.setItem('cb_ar_camera', newCamId)
    window.location.reload()
  }

  // ── Reset to defaults ────────────────────────────────────────────────────
  const handleResetDefaults = () => {
    setMarkerWidth(DEFAULT_CONFIG.markerWidthMeters)
    setCharacterHeight(DEFAULT_CONFIG.characterHeightMeters)
    setRotationDegrees(DEFAULT_CONFIG.characterRotationDegrees)
    setFloorOffset(DEFAULT_CONFIG.floorOffsetMeters)
    setNudgeX(0)
    setNudgeZ(0)
    localStorage.removeItem(STORAGE_KEY)
  }

  // ── Main MindAR & Three.js lifecycle ──────────────────────────────────────
  useEffect(() => {
    let stopped = false

    async function startAR() {
      try {
        setLoadingMsg('Preparing High-Definition AR tracking...')

        const mindarThree = new MindARThree({
          container: containerRef.current,
          imageTargetSrc: 'assets/targets.mind',
          uiScanning: false,
          uiLoading: false,
          filterMinCF: 0.0001,
          filterBeta: 0.001,
          warmupTolerance: 2,
          missTolerance: DEFAULT_CONFIG.missTolerance,
          maxTrack: 1,
          environmentDeviceId: activeCamId || undefined,
        })

        mindARRef.current = mindarThree
        if (stopped) return

        const { renderer, scene, camera } = mindarThree

        // Renderer setup
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DEFAULT_CONFIG.maxPixelRatio))
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.15
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFSoftShadowMap

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 1.3))
        const fillLight = new THREE.DirectionalLight(0x80b5ff, 0.6)
        fillLight.position.set(-2, 3, -1)
        scene.add(fillLight)

        // MindAR Anchor
        const anchor = mindarThree.addAnchor(0)
        anchorRef.current = anchor

        // Fixed Anchor for holding/locking pose in scene space (occlusion-proof)
        const fixedGroup = new THREE.Group()
        fixedGroup.matrixAutoUpdate = false
        fixedGroup.visible = false
        scene.add(fixedGroup)
        fixedGroupRef.current = fixedGroup

        // markerRoot is the 3D container for Chhota Bheem & floor shadow
        const markerRoot = new THREE.Group()
        markerRoot.rotation.x = Math.PI / 2
        markerRootRef.current = markerRoot

        // Attach markerRoot directly to anchor.group for native MindAR tracking
        anchor.group.add(markerRoot)

        // Floor shadow
        const shadowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(DEFAULT_CONFIG.markerWidthMeters, DEFAULT_CONFIG.markerWidthMeters),
          new THREE.ShadowMaterial({ transparent: true, opacity: 0.38 })
        )
        shadowPlane.rotation.x = -Math.PI / 2
        shadowPlane.position.y = DEFAULT_CONFIG.floorOffsetMeters * 0.5
        shadowPlane.receiveShadow = true
        markerRoot.add(shadowPlane)
        shadowPlaneRef.current = shadowPlane

        // Key light
        const characterLight = new THREE.DirectionalLight(0xffffff, 2.2)
        characterLight.position.set(0.8, 3.0, 1.2)
        characterLight.castShadow = true
        characterLight.shadow.mapSize.width = 2048
        characterLight.shadow.mapSize.height = 2048
        characterLight.shadow.camera.near = 0.05
        characterLight.shadow.camera.far = 15
        const halfF = DEFAULT_CONFIG.markerWidthMeters * 0.7
        characterLight.shadow.camera.left = -halfF
        characterLight.shadow.camera.right = halfF
        characterLight.shadow.camera.top = halfF
        characterLight.shadow.camera.bottom = -halfF
        characterLight.target.position.set(0, 0, 0)
        markerRoot.add(characterLight)
        markerRoot.add(characterLight.target)
        characterLightRef.current = characterLight

        // Load 3D model
        setLoadingMsg('Loading Chhota Bheem model...')
        const dracoLoader = new DRACOLoader()
        dracoLoader.setDecoderPath('vendor/draco/')
        const loader = new GLTFLoader()
        loader.setDRACOLoader(dracoLoader)

        try {
          const gltf = await loader.loadAsync('assets/Elephant_Turn_Walk.glb')
          if (stopped) return

          const elScene = gltf.scene
          elSceneRef.current = elScene

          elScene.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
              child.frustumCulled = false
              child.castShadow = true
              child.receiveShadow = true
            }
          })

          // Calculate bounding box and native height
          const originalBox = new THREE.Box3().setFromObject(elScene)
          const nativeHeight = originalBox.max.y - originalBox.min.y
          const nativeMinY = originalBox.min.y

          nativeDimsRef.current = {
            nativeHeight: nativeHeight > 0 ? nativeHeight : 1.0,
            nativeMinY,
          }

          const elephantGroup = new THREE.Group()
          elephantGroup.position.set(0, 0, 0)
          elephantGroup.add(elScene)
          markerRoot.add(elephantGroup)
          elephantGroupRef.current = elephantGroup

          // Animation
          const clips = stripRootMotion(gltf.animations)
          if (clips.length > 0) {
            const mixer = new THREE.AnimationMixer(elScene)
            mixerRef.current = mixer
            const action = mixer.clipAction(clips[0])
            action.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat).play()
            action.timeScale = 0.95
          }

          // Apply saved transforms
          const p = liveParamsRef.current
          apply3DTransforms(p.height, p.rotation, p.floorOffset, p.nudgeX, p.nudgeZ)

        } catch (modelErr) {
          console.warn('GLB load failed, creating fallback geometry:', modelErr)
          const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, DEFAULT_CONFIG.characterHeightMeters, 0.5),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.3, roughness: 0.4 })
          )
          fallback.position.y = DEFAULT_CONFIG.characterHeightMeters / 2
          fallback.castShadow = true
          const elephantGroup = new THREE.Group()
          elephantGroup.add(fallback)
          markerRoot.add(elephantGroup)
          elephantGroupRef.current = elephantGroup
          elSceneRef.current = fallback
          nativeDimsRef.current = { nativeHeight: DEFAULT_CONFIG.characterHeightMeters, nativeMinY: 0 }
        }

        // ── Tracking Callbacks ──────────────────────────────────────────────
        anchor.onTargetFound = () => {
          if (stopped) return
          if (!lockRef.current.isLocked) {
            setTrackingState('detected')
            setHasEverDetected(true)
          }
        }

        anchor.onTargetLost = () => {
          if (stopped) return
          if (!lockRef.current.isLocked) {
            // Marker temporarily obscured before locking — hold position instead of instantly disappearing!
            setTrackingState('held')
          }
        }

        // ── Start MindAR with High-Definition stream interceptor ────────────
        setLoadingMsg('Starting HD Camera feed...')

        const origGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
        if (navigator.mediaDevices && origGetUserMedia) {
          const [idealW, idealH] = activeRes === '4k' ? [3840, 2160] : activeRes === '1080p' ? [1920, 1080] : [1280, 720]

          navigator.mediaDevices.getUserMedia = async (constraints) => {
            const enhanced = { ...constraints }
            if (enhanced.video && typeof enhanced.video === 'object') {
              enhanced.video.width = { ideal: idealW }
              enhanced.video.height = { ideal: idealH }
              enhanced.video.frameRate = { ideal: 30 }
              if (activeCamId) {
                enhanced.video.deviceId = { ideal: activeCamId }
              }
            }
            try {
              return await origGetUserMedia(enhanced)
            } catch (hdErr) {
              console.warn('[Camera] Stream fallback to default constraints:', hdErr)
              return await origGetUserMedia(constraints)
            }
          }
        }

        await mindarThree.start()

        // Restore original getUserMedia
        if (origGetUserMedia && navigator.mediaDevices) {
          navigator.mediaDevices.getUserMedia = origGetUserMedia
        }

        if (stopped) { mindarThree.stop(); return }

        // Continuous sharp autofocus, auto-exposure, and white balance
        try {
          const video = mindarThree.video
          if (video?.srcObject) {
            const track = video.srcObject.getVideoTracks()[0]
            if (track) {
              const settings = track.getSettings?.() || {}
              const cap = track.getCapabilities?.() || {}

              setCameraInfo({
                width: settings.width || 1280,
                height: settings.height || 720,
                fps: Math.round(settings.frameRate || 30),
                label: track.label || 'High Definition Camera',
              })

              const advanced = []
              if (cap.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' })
              if (cap.exposureMode?.includes('continuous')) advanced.push({ exposureMode: 'continuous' })
              if (cap.whiteBalanceMode?.includes('continuous')) advanced.push({ whiteBalanceMode: 'continuous' })
              if (advanced.length > 0) {
                await track.applyConstraints({ advanced }).catch(() => {})
              }
            }
          }
        } catch { /* ignore autofocus error */ }

        setIsStarting(false)
        setTrackingState('searching')

        // ── Render loop ─────────────────────────────────────────────────────
        const clock = new THREE.Clock()
        let hasDetectedOnce = false

        renderer.setAnimationLoop(() => {
          if (stopped) return
          const delta = Math.min(clock.getDelta(), 0.033)
          const lk = lockRef.current

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // MODE 1: POSITION LOCKED (100% Occlusion-proof)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (lk.isLocked) {
            if (markerRoot.parent !== fixedGroup) {
              fixedGroup.add(markerRoot)
            }
            fixedGroup.matrix.copy(lk.lastDetectedMatrix)
            fixedGroup.matrixWorld.copy(lk.lastDetectedMatrix)
            fixedGroup.visible = true

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // MODE 2: ACTIVE MARKER TRACKING (Marker in view)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          } else if (anchor.group.visible) {
            if (markerRoot.parent !== anchor.group) {
              anchor.group.add(markerRoot)
            }
            fixedGroup.visible = false

            // MindAR updates anchor.group.matrix; compute world matrix & save it
            anchor.group.updateMatrixWorld(true)
            lk.lastDetectedMatrix.copy(anchor.group.matrixWorld)
            lk.hasPose = true
            hasDetectedOnce = true

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // MODE 3: MARKER TEMPORARILY OBSCURED BEFORE LOCK
          // Hold the character at last known position so user can still click "Fix Position"!
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          } else if (hasDetectedOnce) {
            fixedGroup.matrix.copy(lk.lastDetectedMatrix)
            fixedGroup.matrixWorld.copy(lk.lastDetectedMatrix)
            if (markerRoot.parent !== fixedGroup) {
              fixedGroup.add(markerRoot)
            }
            fixedGroup.visible = true
          } else {
            fixedGroup.visible = false
          }

          // Update animation mixer
          if (mixerRef.current) {
            mixerRef.current.update(delta)
          }

          // Locomotion: Dynamic circular walking patrol on the marker floor
          if (elephantGroupRef.current && !lk.isLocked) {
            const walkAngle = clock.getElapsedTime() * 0.65
            const patrolR = 0.35 // patrol radius relative to marker
            elephantGroupRef.current.position.x = Math.cos(walkAngle) * patrolR
            elephantGroupRef.current.position.z = Math.sin(walkAngle) * patrolR
            elephantGroupRef.current.rotation.y = -walkAngle + Math.PI / 2

            if (shadowPlaneRef.current) {
              shadowPlaneRef.current.position.x = elephantGroupRef.current.position.x
              shadowPlaneRef.current.position.z = elephantGroupRef.current.position.z
            }
          }

          renderer.render(scene, camera)
        })

      } catch (err) {
        console.error('MindAR start error:', err)
        if (stopped) return
        const msg = err?.message ?? ''
        if (msg.includes('targets.mind') || msg.includes('404') || msg.includes('fetch')) {
          setErrorMsg('TARGETS_MIND')
        } else if (err.name === 'NotAllowedError' || msg.includes('camera') || msg.includes('permission')) {
          setErrorMsg('Camera permission denied. Please allow camera access and reload.')
        } else {
          setErrorMsg('AR Error: ' + (msg || err?.name || 'Unknown error'))
        }
        setIsStarting(false)
      }
    }

    startAR()

    return () => {
      stopped = true
      try {
        if (mindARRef.current) {
          mindARRef.current.renderer?.setAnimationLoop(null)
          mindARRef.current.stop()
        }
      } catch { /* ignore */ }
      mixerRef.current = null
      elSceneRef.current = null
      elephantGroupRef.current = null
      markerRootRef.current = null
      anchorRef.current = null
      fixedGroupRef.current = null
      mindARRef.current = null
    }
  }, [apply3DTransforms])

  const isTargetsMindError = errorMsg === 'TARGETS_MIND'
  const canFixPosition = (trackingState === 'detected' || trackingState === 'held' || hasEverDetected) && !isPositionLocked

  return (
    <div className="fixed inset-0 z-0 bg-black select-none overflow-hidden">
      {/* MindAR Camera Feed & WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Loading Overlay ─────────────────────────────────────────── */}
      {isStarting && !errorMsg && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl gap-5">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-amber-500/30" />
            <div className="absolute inset-0 rounded-full border-4 border-t-amber-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-2xl">🐘</div>
          </div>
          <div className="text-center">
            <p className="text-amber-300 font-black text-lg tracking-wide">Chhota Bheem AR</p>
            <p className="text-slate-400 text-sm mt-1 font-mono">{loadingMsg}</p>
          </div>
          <button
            onClick={onExit}
            className="mt-3 bg-slate-800/80 hover:bg-slate-700 text-slate-400 border border-slate-700 px-5 py-2 rounded-full text-xs font-bold transition-all"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Error Overlay ────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl gap-5 p-6 text-center">
          <div className="text-5xl">⚠️</div>
          <div>
            <p className="text-amber-400 font-black text-lg">
              {isTargetsMindError ? 'Marker Target Missing' : 'AR Error'}
            </p>
            <p className="text-slate-300 text-sm mt-2 max-w-sm">
              {isTargetsMindError
                ? 'The targets.mind file is missing. Please place it in public/assets/.'
                : errorMsg}
            </p>
          </div>
          <button
            onClick={onExit}
            className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-6 py-2.5 rounded-full font-black shadow-lg"
          >
            ← Go Back
          </button>
        </div>
      )}

      {/* ── Top HUD Bar (Always visible at z-50) ─────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 py-2.5 bg-slate-950/90 backdrop-blur-xl border-b border-white/10 shadow-2xl">
        {/* Quit Button */}
        <button
          onClick={onExit}
          className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/15 px-3.5 py-1.5 text-xs font-bold rounded-xl active:scale-95 transition-all shadow-md"
        >
          ← Exit
        </button>

        {/* Tracking & Lock Status Pill */}
        <div
          className={[
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black border transition-all duration-300 shadow-md',
            isPositionLocked
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/60 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
              : trackingState === 'detected'
              ? 'bg-amber-500/20 text-amber-300 border-amber-400/60 animate-pulse'
              : trackingState === 'held'
              ? 'bg-sky-500/20 text-sky-300 border-sky-400/60'
              : isStarting
              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-400/50'
              : 'bg-slate-800/80 text-slate-400 border-slate-700/60',
          ].join(' ')}
        >
          <span
            className={[
              'w-2 h-2 rounded-full flex-shrink-0',
              isPositionLocked
                ? 'bg-emerald-400'
                : trackingState === 'detected'
                ? 'bg-amber-400 animate-ping'
                : trackingState === 'held'
                ? 'bg-sky-400'
                : isStarting
                ? 'bg-indigo-400 animate-pulse'
                : 'bg-slate-500',
            ].join(' ')}
          />
          <span>
            {isPositionLocked
              ? '🔒 FIXED ON FLOOR'
              : trackingState === 'detected'
              ? '🟢 MARKER DETECTED'
              : trackingState === 'held'
              ? '📍 POSITION HELD'
              : isStarting
              ? '⏳ STARTING AR...'
              : '🔍 SCANNING...'}
          </span>
        </div>

        {/* Top Quick Actions: Fix Shortcut & Config */}
        <div className="flex items-center gap-1.5">
          {!isPositionLocked ? (
            <button
              onClick={handleFixPosition}
              disabled={!canFixPosition}
              className={[
                'flex items-center gap-1 px-3 py-1.5 text-xs font-black rounded-xl transition-all shadow-md',
                canFixPosition
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 animate-bounce active:scale-95 shadow-[0_0_15px_rgba(251,191,36,0.6)]'
                  : 'bg-slate-800 text-slate-500 border border-white/5 opacity-60 cursor-not-allowed',
              ].join(' ')}
              title="Lock AR Position"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock</span>
            </button>
          ) : (
            <button
              onClick={handleUnlockPosition}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-400/30 px-2.5 py-1.5 text-xs font-bold rounded-xl active:scale-95 transition-all shadow-md"
              title="Unlock AR Position"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Unlock</span>
            </button>
          )}

          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-400/30 px-3 py-1.5 text-xs font-bold rounded-xl active:scale-95 transition-all shadow-md"
            title="Open AR Configuration"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Config</span>
          </button>
        </div>
      </header>

      {/* ── Main Interactive Bottom Control Bar (Always visible at z-50) ── */}
      <div className="fixed bottom-4 sm:bottom-6 left-0 right-0 z-50 flex flex-col items-center gap-2.5 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pointer-events-auto">

        {/* Notification Toast */}
        {saveToast && (
          <div className="bg-emerald-950/95 border border-emerald-400/70 text-emerald-200 px-4 py-2 rounded-2xl text-xs font-black shadow-2xl flex items-center gap-2 animate-bounce">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>Position permanently fixed! Immune to occlusion.</span>
          </div>
        )}

        {/* Quick Controls Card */}
        <div className="w-full max-w-md bg-slate-950/95 backdrop-blur-2xl border-2 border-white/20 rounded-3xl p-3.5 shadow-[0_10px_40px_rgba(0,0,0,0.8)] flex flex-col gap-3">

          {/* Row 1: Primary Action Button (Fix Position / Unlock) */}
          <div>
            {isStarting ? (
              <div className="w-full py-3.5 px-4 rounded-2xl font-black text-xs flex items-center justify-center gap-2 bg-slate-900 text-amber-300 border border-amber-500/30 animate-pulse">
                <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                <span>STARTING AR CAMERA & LOADING MODEL...</span>
              </div>
            ) : !isPositionLocked ? (
              <button
                id="btn-fix-position"
                onClick={handleFixPosition}
                disabled={!canFixPosition}
                className={[
                  'w-full py-3.5 px-4 rounded-2xl font-black text-sm flex flex-col items-center justify-center gap-1 transition-all duration-300 shadow-xl',
                  canFixPosition
                    ? 'bg-gradient-to-r from-amber-400 via-amber-300 to-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(245,158,11,0.7)] hover:scale-[1.02] active:scale-[0.98]'
                    : 'bg-slate-800/90 text-slate-400 border border-white/10 opacity-75',
                ].join(' ')}
              >
                <div className="flex items-center gap-2 text-sm font-black">
                  <Lock className="w-4 h-4" />
                  <span>{canFixPosition ? '📌 CLICK TO FIX / LOCK POSITION' : '🔒 FIX / LOCK POSITION'}</span>
                </div>
                <span className="text-[11px] font-semibold opacity-85">
                  {canFixPosition ? 'Marker detected! Tap to freeze AR on floor' : 'Point camera at marker first to activate'}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-emerald-500/20 border border-emerald-400/50 rounded-2xl py-2.5 px-3 flex items-center justify-center gap-2 text-emerald-300 text-xs font-black shadow-lg">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>🔒 POSITION FIXED (IMMUNE TO OCCLUSION)</span>
                </div>
                <button
                  id="btn-unlock-position"
                  onClick={handleUnlockPosition}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/15 px-4 py-2.5 rounded-2xl text-xs font-black active:scale-95 transition-all flex items-center gap-1.5 shadow-md"
                  title="Unlock to re-track marker"
                >
                  <Unlock className="w-4 h-4 text-amber-400" />
                  <span>Unlock</span>
                </button>
              </div>
            )}
          </div>

            {/* Row 2: Quick Size Controls & Rotation Controls */}
            <div className="grid grid-cols-2 gap-2">

              {/* Character Size Quick Adjust */}
              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold px-1">
                  <span className="text-slate-400">Height</span>
                  <span className="text-amber-300 font-mono font-black">{characterHeight.toFixed(2)} m</span>
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => handleScaleDelta(-0.1)}
                    className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-90 text-white rounded-xl flex items-center justify-center transition-all"
                    title="Smaller (-10cm)"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleScaleDelta(0.1)}
                    className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-90 text-slate-950 font-black rounded-xl flex items-center justify-center transition-all shadow-md"
                    title="Larger (+10cm)"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Character Rotation Quick Adjust */}
              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold px-1">
                  <span className="text-slate-400">Turn</span>
                  <span className="text-amber-300 font-mono font-black">{rotationDegrees}°</span>
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => handleRotationDelta(-30)}
                    className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-90 text-white rounded-xl flex items-center justify-center transition-all"
                    title="Turn left 30°"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRotationDelta(30)}
                    className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-90 text-white rounded-xl flex items-center justify-center transition-all"
                    title="Turn right 30°"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

            </div>

          </div>

          {/* Helpful Sub-hint */}
          {!isPositionLocked && (
            <div className="bg-slate-950/70 backdrop-blur-md px-3 py-1 rounded-full border border-white/5 text-[11px] text-slate-400">
              {trackingState === 'searching'
                ? 'Align marker in camera → tap FIX POSITION'
                : 'Marker locked in memory! Tap button anytime'}
            </div>
          )}

        </div>

      {/* ── Comprehensive Config Drawer / Modal ──────────────────────── */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-white/15 rounded-3xl p-5 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-amber-400" />
                <h3 className="text-white font-black text-base">AR Configuration</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. Character Height (Size in Meters) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Character Height</span>
                </label>
                <span className="text-amber-300 font-mono font-black text-sm">{characterHeight.toFixed(2)} m</span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min="0.3"
                max="5.0"
                step="0.05"
                value={characterHeight}
                onChange={e => setCharacterHeight(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              />

              {/* Quick Size Presets */}
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {[
                  { label: 'Small', val: 1.0 },
                  { label: 'Normal', val: 1.5 },
                  { label: 'Large', val: 2.2 },
                  { label: 'Giant', val: 3.5 },
                ].map(p => (
                  <button
                    key={p.label}
                    onClick={() => setCharacterHeight(p.val)}
                    className={[
                      'py-1.5 text-[11px] font-bold rounded-xl border transition-all',
                      Math.abs(characterHeight - p.val) < 0.05
                        ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-sm'
                        : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {p.label} ({p.val}m)
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Physical Marker Width (Meters) */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Physical Marker Width</span>
                </label>
                <span className="text-emerald-300 font-mono font-black text-sm">{markerWidth.toFixed(2)} m</span>
              </div>

              <input
                type="range"
                min="0.2"
                max="5.0"
                step="0.05"
                value={markerWidth}
                onChange={e => setMarkerWidth(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />

              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {[
                  { label: 'A4 Paper', val: 0.21 },
                  { label: 'Desk', val: 0.5 },
                  { label: 'Standard', val: 1.0 },
                  { label: 'Floor 3m', val: 3.0 },
                ].map(p => (
                  <button
                    key={p.label}
                    onClick={() => setMarkerWidth(p.val)}
                    className={[
                      'py-1.5 text-[11px] font-bold rounded-xl border transition-all',
                      Math.abs(markerWidth - p.val) < 0.05
                        ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-sm font-black'
                        : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {p.label} ({p.val}m)
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Character Rotation */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Rotation Angle</span>
                </label>
                <span className="text-amber-300 font-mono font-black text-sm">{rotationDegrees}°</span>
              </div>

              <input
                type="range"
                min="0"
                max="355"
                step="5"
                value={rotationDegrees}
                onChange={e => setRotationDegrees(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              />

              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {[0, 90, 180, 270].map(deg => (
                  <button
                    key={deg}
                    onClick={() => setRotationDegrees(deg)}
                    className={[
                      'py-1 text-[11px] font-bold rounded-xl border transition-all',
                      rotationDegrees === deg
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Floor Height Offset (Elevation) */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300">Floor Level Offset</label>
                <span className="text-amber-300 font-mono font-black text-xs">{(floorOffset * 100).toFixed(1)} cm</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFloorOffset(f => Math.max(-0.2, f - 0.01))}
                  className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1"
                >
                  <ArrowDown className="w-3.5 h-3.5" /> Lower (-1cm)
                </button>
                <button
                  onClick={() => setFloorOffset(f => Math.min(0.5, f + 0.01))}
                  className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1"
                >
                  <ArrowUp className="w-3.5 h-3.5" /> Raise (+1cm)
                </button>
              </div>
            </div>

            {/* 4. Position Fine-Nudge (World X / Z offset) */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300">Nudge Position</label>
                <span className="text-slate-400 text-[10px]">X: {(nudgeX * 100).toFixed(0)}cm | Z: {(nudgeZ * 100).toFixed(0)}cm</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={() => setNudgeZ(z => z - DEFAULT_CONFIG.nudgeStepMeters)}
                  className="w-12 h-8 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center text-white"
                  title="Nudge Forward"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setNudgeX(x => x - DEFAULT_CONFIG.nudgeStepMeters)}
                    className="w-12 h-8 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center text-white"
                    title="Nudge Left"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setNudgeX(0); setNudgeZ(0) }}
                    className="px-2 py-1 bg-slate-950 text-slate-400 text-[10px] rounded-lg font-bold"
                  >
                    Center
                  </button>
                  <button
                    onClick={() => setNudgeX(x => x + DEFAULT_CONFIG.nudgeStepMeters)}
                    className="w-12 h-8 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center text-white"
                    title="Nudge Right"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => setNudgeZ(z => z + DEFAULT_CONFIG.nudgeStepMeters)}
                  className="w-12 h-8 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center text-white"
                  title="Nudge Backward"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 5. Camera Quality & Hardware Source */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-amber-400" />
                  <span>Camera Quality</span>
                </label>
                <span className="text-emerald-400 font-mono font-black text-xs">
                  {cameraInfo.width > 0 ? `${cameraInfo.width}×${cameraInfo.height} (${cameraInfo.fps}fps)` : activeRes.toUpperCase()}
                </span>
              </div>

              {/* Resolution Toggle */}
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: '720p', label: '720p HD' },
                  { id: '1080p', label: '1080p Full HD' },
                  { id: '4k', label: '4K UHD' },
                ].map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleSwitchResolution(r.id)}
                    className={[
                      'py-1.5 text-[11px] font-bold rounded-xl border transition-all',
                      activeRes === r.id
                        ? 'bg-amber-400 text-slate-950 border-amber-300 font-black shadow-sm'
                        : 'bg-slate-800/80 text-slate-400 border-white/5 hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Camera Device Switcher (if multiple cameras exist) */}
              {availableCameras.length > 1 && (
                <div className="mt-1 flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">Switch Camera Source</label>
                  <select
                    value={activeCamId}
                    onChange={e => handleSwitchCamera(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 text-white text-xs rounded-xl p-2 focus:outline-none focus:border-amber-400"
                  >
                    <option value="">Auto / Default Camera</option>
                    {availableCameras.map((cam, idx) => (
                      <option key={cam.deviceId || idx} value={cam.deviceId}>
                        {cam.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-[10px] text-slate-400 truncate">
                Active: {cameraInfo.label || 'Default Camera'}
              </p>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center gap-2 pt-3 border-t border-white/10 mt-1">
              <button
                onClick={handleResetDefaults}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-bold transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
              <button
                onClick={() => setShowConfigModal(false)}
                className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-xs transition-all shadow-lg active:scale-95"
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
