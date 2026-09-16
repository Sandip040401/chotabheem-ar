import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js'
import { RotateCcw, RotateCw, RefreshCw, Lock } from 'lucide-react'

/**
 * MarkerARScene — Fixed Real-World Character Sizing + One-Shot Pose Lock
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OCCLUSION-PROOF FIXED INSTALLATION MODE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Problem:  People standing on the floor marker block the camera's view.
 *           MindAR loses tracking → character disappears.
 *
 * Solution: Since the camera NEVER MOVES in this installation, we only need
 *           to detect the marker ONCE at startup. After poseLockFrames of
 *           stable detection, the world pose is permanently frozen.
 *           Occlusion after that point is completely irrelevant — the character
 *           never disappears no matter what stands on the marker.
 *
 * State machine:
 *
 *   SEARCHING ──► CALIBRATING ──► 🔒 LOCKED (permanent)
 *                                      │
 *                              [Re-calibrate button]
 *                                      │
 *                                  SEARCHING
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHARACTER SIZING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Character size is COMPLETELY INDEPENDENT of marker size.
 *
 * Formula:
 *   exactScale = (characterHeightMeters / markerWidthMeters) / nativeModelHeight
 *
 * Only AR_CONFIG needs changing. The GLB's internal units don't matter.
 */

// ─────────────────────────────────────────────────────────────────────────────
// AR INSTALLATION CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const AR_CONFIG = {
  // ── Physical marker ──────────────────────────────────────────────────────
  // Actual printed width of the floor marker in metres.
  markerWidthMeters: 3.0,

  // ── AR character ─────────────────────────────────────────────────────────
  // Exact desired real-world height of the AR character in metres.
  characterHeightMeters: 1.5,

  // Base rotation of the character around the vertical axis (Y).
  // HUD rotation buttons offset from this value at runtime.
  characterRotationDegrees: 0,

  // Small Y offset above floor surface to prevent z-fighting.
  floorOffsetMeters: 0.002,

  // ── Pose lock (occlusion-proof fixed installation) ───────────────────────
  // Number of consecutive stable tracking frames required before the pose
  // is permanently locked. At 30 fps, 45 frames ≈ 1.5 seconds.
  // Once locked, marker occlusion (people standing on it) has zero effect.
  poseLockFrames: 45,

  // ── Tracking (pre-lock / fallback) ──────────────────────────────────────
  // Lerp/slerp factor per frame during the calibration phase.
  positionSmoothing: 0.12,
  rotationSmoothing: 0.12,

  // MindAR: consecutive missed frames before declaring tracking lost.
  // 300 ≈ 10 s at 30 fps — buys time during partial occlusions before lock.
  missTolerance: 300,

  // Seconds to hold the character visible if tracking is lost before lock.
  trackingHoldSeconds: 5,

  // ── Rendering ────────────────────────────────────────────────────────────
  maxPixelRatio: 2.5,
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT BONE NAMES — stripped so the character stays centred on the marker
// ─────────────────────────────────────────────────────────────────────────────
const ROOT_BONES = ['elep_4_Root_M', 'elep_4_RootPart1_M']

function stripRootMotion(animations) {
  return animations.map(clip => {
    const cloned = clip.clone()
    cloned.tracks = cloned.tracks.filter(t => {
      const bone = t.name.split('.')[0]
      return !(
        ROOT_BONES.includes(bone) &&
        (t.name.endsWith('.position') || t.name.endsWith('.rotation'))
      )
    })
    return cloned
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function MarkerARScene({ onExit }) {
  const containerRef = useRef(null)
  const mindARRef    = useRef(null)

  // 'searching' | 'calibrating' | 'locked' | 'lost'
  const [trackingState, setTrackingState] = useState('searching')
  const [isStarting,   setIsStarting]     = useState(true)
  const [loadingMsg,   setLoadingMsg]     = useState('Initialising AR...')
  const [errorMsg,     setErrorMsg]       = useState(null)
  const [lockProgress, setLockProgress]   = useState(0) // 0–100 %

  // Runtime rotation offset — operators adjust via HUD buttons.
  const [modelRotation, setModelRotation] = useState(0)
  const modelRotationRef = useRef(0)

  const elSceneRef       = useRef(null)
  const elephantGroupRef = useRef(null)
  const lostTimeoutRef   = useRef(null)
  const mixerRef         = useRef(null)

  // Shared with render loop so re-calibrate button can reset state cleanly.
  const poseLockRef      = useRef({
    locked:      false,
    frameCount:  0,
    lockedPos:   new THREE.Vector3(),
    lockedQuat:  new THREE.Quaternion(),
  })

  // Keep rotation ref in sync without a React re-render on every frame.
  useEffect(() => {
    modelRotationRef.current = modelRotation
  }, [modelRotation])

  // Re-calibrate: resets the lock so a fresh detection cycle begins.
  const handleRecalibrate = useCallback(() => {
    const pl = poseLockRef.current
    pl.locked     = false
    pl.frameCount = 0
    setTrackingState('searching')
    setLockProgress(0)
  }, [])

  // ── Main AR lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    let stopped = false

    async function startAR() {
      try {
        // ── 1. Create MindAR instance ────────────────────────────────────
        setLoadingMsg('Preparing marker tracking...')

        const mindarThree = new MindARThree({
          container:      containerRef.current,
          imageTargetSrc: 'assets/targets.mind',
          uiScanning:     false,
          uiLoading:      false,
          // Aggressive noise suppression for a fixed-camera installation.
          filterMinCF:     0.0001,
          filterBeta:      0.001,
          warmupTolerance: 2,
          // High miss tolerance gives MindAR maximum chance to re-acquire
          // during the calibration window before the pose lock triggers.
          missTolerance:   AR_CONFIG.missTolerance,
          maxTrack:        1,
        })

        mindARRef.current = mindarThree
        if (stopped) return

        const { renderer, scene, camera } = mindarThree

        // ── 2. Renderer quality ──────────────────────────────────────────
        renderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, AR_CONFIG.maxPixelRatio)
        )
        renderer.toneMapping         = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.1
        renderer.outputColorSpace    = THREE.SRGBColorSpace
        renderer.shadowMap.enabled   = true
        renderer.shadowMap.type      = THREE.PCFSoftShadowMap

        // ── 3. Scene-level ambient + fill ────────────────────────────────
        scene.add(new THREE.AmbientLight(0xffffff, 1.2))

        const fillLight = new THREE.DirectionalLight(0x80aaff, 0.5)
        fillLight.position.set(-2, 2, -1)
        scene.add(fillLight)

        // ── 4. MindAR anchor ─────────────────────────────────────────────
        const anchor = mindarThree.addAnchor(0)

        // ── 5. Display hierarchy ─────────────────────────────────────────
        //
        // displayRoot  ← repositioned by LERP/SLERP until lock, then frozen
        //   └─ markerRoot  ← rotated +90° around X so +Y is up from floor
        //        ├─ shadowPlane
        //        ├─ ringMesh  (decorative)
        //        ├─ characterLight + target
        //        └─ elephantGroup
        //             └─ elScene  (GLB model)
        //
        const displayRoot = new THREE.Group()
        displayRoot.visible = false
        scene.add(displayRoot)

        const markerRoot = new THREE.Group()
        markerRoot.rotation.x = Math.PI / 2
        displayRoot.add(markerRoot)

        // ── 6. Floor shadow catcher ──────────────────────────────────────
        const halfW = AR_CONFIG.markerWidthMeters
        const shadowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(halfW, halfW),
          new THREE.ShadowMaterial({ transparent: true, opacity: 0.40 })
        )
        shadowPlane.rotation.x = -Math.PI / 2
        shadowPlane.position.y = AR_CONFIG.floorOffsetMeters * 0.5
        shadowPlane.receiveShadow = true
        markerRoot.add(shadowPlane)

        // ── 7. Decorative ground ring ────────────────────────────────────
        const ringMesh = new THREE.Mesh(
          new THREE.RingGeometry(0.16, 0.22, 64),
          new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.55,
          })
        )
        ringMesh.rotation.x = -Math.PI / 2
        ringMesh.position.y = AR_CONFIG.floorOffsetMeters
        markerRoot.add(ringMesh)

        // ── 8. Character key light ───────────────────────────────────────
        const halfFrustum = AR_CONFIG.markerWidthMeters / 2
        const characterLight = new THREE.DirectionalLight(0xffffff, 2.2)
        characterLight.position.set(0.8, 2.5, 1.2)
        characterLight.castShadow             = true
        characterLight.shadow.mapSize.width   = 2048
        characterLight.shadow.mapSize.height  = 2048
        characterLight.shadow.camera.near     = 0.05
        characterLight.shadow.camera.far      = AR_CONFIG.markerWidthMeters * 4
        characterLight.shadow.camera.left     = -halfFrustum
        characterLight.shadow.camera.right    =  halfFrustum
        characterLight.shadow.camera.top      =  halfFrustum
        characterLight.shadow.camera.bottom   = -halfFrustum
        characterLight.target.position.set(0, 0, 0)
        markerRoot.add(characterLight)
        markerRoot.add(characterLight.target)

        // ── 9. Load GLB model ────────────────────────────────────────────
        setLoadingMsg('Loading Chhota Bheem model...')

        const dracoLoader = new DRACOLoader()
        dracoLoader.setDecoderPath('vendor/draco/')
        const loader = new GLTFLoader()
        loader.setDRACOLoader(dracoLoader)

        let elephantGroup = null

        try {
          const gltf = await loader.loadAsync('assets/Elephant_Turn_Walk.glb')
          if (stopped) return

          const elScene = gltf.scene
          elSceneRef.current = elScene

          elScene.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
              child.frustumCulled = false
              child.castShadow    = true
              child.receiveShadow = true
            }
          })

          // ── 10. Compute exact real-world scale ───────────────────────
          //
          // MindAR: 1 unit = markerWidthMeters
          // Desired: character = characterHeightMeters tall
          //
          //   exactScale = (characterHeightMeters / markerWidthMeters) / nativeHeight
          //
          const originalBox  = new THREE.Box3().setFromObject(elScene)
          const nativeHeight = originalBox.max.y - originalBox.min.y

          if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) {
            throw new Error('Could not determine model height from bounding box.')
          }

          const exactScale =
            (AR_CONFIG.characterHeightMeters / AR_CONFIG.markerWidthMeters) /
            nativeHeight

          console.log(
            '[AR_CONFIG] nativeHeight:', nativeHeight.toFixed(4),
            '| exactScale:', exactScale.toFixed(6),
            '| characterHeight:', AR_CONFIG.characterHeightMeters + 'm'
          )

          elScene.scale.setScalar(exactScale)

          // ── 11. Glue feet to floor surface ───────────────────────────
          const scaledBox  = new THREE.Box3().setFromObject(elScene)
          elScene.position.y = AR_CONFIG.floorOffsetMeters - scaledBox.min.y

          // ── 12. Base rotation from config ────────────────────────────
          elScene.rotation.y = THREE.MathUtils.degToRad(
            AR_CONFIG.characterRotationDegrees
          )

          elephantGroup = new THREE.Group()
          elephantGroup.position.set(0, 0, 0)
          elephantGroup.add(elScene)
          markerRoot.add(elephantGroup)
          elephantGroupRef.current = elephantGroup

          // ── 13. Animation ────────────────────────────────────────────
          const clips = stripRootMotion(gltf.animations)
          if (clips.length > 0) {
            const mixer  = new THREE.AnimationMixer(elScene)
            mixerRef.current = mixer
            const action = mixer.clipAction(clips[0])
            action.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat).play()
            action.timeScale = 0.95
          }

        } catch (glbErr) {
          console.warn('GLB load failed, using fallback box:', glbErr)

          const fallbackScale = AR_CONFIG.characterHeightMeters / AR_CONFIG.markerWidthMeters
          const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(fallbackScale * 0.4, fallbackScale, fallbackScale * 0.4),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.3 })
          )
          fallback.position.y = fallbackScale / 2 + AR_CONFIG.floorOffsetMeters
          fallback.castShadow = true

          elephantGroup = new THREE.Group()
          elephantGroup.add(fallback)
          markerRoot.add(elephantGroup)
          elephantGroupRef.current = elephantGroup
        }

        // ── 14. Tracking callbacks ────────────────────────────────────────
        // These only meaningfully affect the pre-lock (calibration) phase.
        // Once locked, anchor visibility is ignored by the render loop.
        anchor.onTargetFound = () => {
          if (stopped) return
          if (lostTimeoutRef.current) { clearTimeout(lostTimeoutRef.current); lostTimeoutRef.current = null }
          // Only update UI state if not yet permanently locked.
          if (!poseLockRef.current.locked) setTrackingState('calibrating')
        }

        anchor.onTargetLost = () => {
          if (stopped) return
          // Already locked — completely ignore; character stays visible.
          if (poseLockRef.current.locked) return
          if (lostTimeoutRef.current) clearTimeout(lostTimeoutRef.current)
          lostTimeoutRef.current = setTimeout(() => {
            if (!stopped && !poseLockRef.current.locked) setTrackingState('lost')
          }, AR_CONFIG.trackingHoldSeconds * 1000)
        }

        // ── 15. Start MindAR ─────────────────────────────────────────────
        setLoadingMsg('Starting camera...')
        await mindarThree.start()
        if (stopped) { mindarThree.stop(); return }

        // Continuous autofocus where supported.
        try {
          const video = mindarThree.video
          if (video?.srcObject) {
            const track = video.srcObject.getVideoTracks()[0]
            const cap   = track?.getCapabilities?.() ?? {}
            if (cap.focusMode?.includes('continuous')) {
              await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
            }
          }
        } catch { /* ignore */ }

        setIsStarting(false)
        setTrackingState('searching')

        // ── 16. Render loop ───────────────────────────────────────────────
        const clock           = new THREE.Clock()
        const targetWorldPos  = new THREE.Vector3()
        const targetWorldQuat = new THREE.Quaternion()
        const smoothedPos     = new THREE.Vector3()
        const smoothedQuat    = new THREE.Quaternion()
        let   hasFirstSnap    = false
        let   lastSeenTime    = 0

        renderer.setAnimationLoop(() => {
          if (stopped) return

          const delta = Math.min(clock.getDelta(), 0.033)
          const now   = clock.getElapsedTime()
          const pl    = poseLockRef.current

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // MODE A — POSE LOCKED (occlusion-proof)
          // Once locked, always render at the stored pose. The marker's
          // visibility is completely irrelevant from this point on.
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (pl.locked) {
            displayRoot.position.copy(pl.lockedPos)
            displayRoot.quaternion.copy(pl.lockedQuat)
            displayRoot.visible = true

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // MODE B — CALIBRATION PHASE (pre-lock)
          // Normal LERP/SLERP tracking. Count stable frames toward lock.
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          } else if (anchor.group.visible) {
            lastSeenTime = now
            anchor.group.getWorldPosition(targetWorldPos)
            anchor.group.getWorldQuaternion(targetWorldQuat)

            if (!hasFirstSnap) {
              // Snap instantly on first detection (zero lerp lag).
              smoothedPos.copy(targetWorldPos)
              smoothedQuat.copy(targetWorldQuat)
              hasFirstSnap = true
            } else {
              const dist   = smoothedPos.distanceTo(targetWorldPos)
              const factor = dist > 0.05
                ? AR_CONFIG.positionSmoothing
                : AR_CONFIG.positionSmoothing * 0.5
              smoothedPos.lerp(targetWorldPos, factor)
              smoothedQuat.slerp(targetWorldQuat, AR_CONFIG.rotationSmoothing)
            }

            displayRoot.position.copy(smoothedPos)
            displayRoot.quaternion.copy(smoothedQuat)
            displayRoot.visible = true

            // ── Count stable frames toward pose lock ──────────────────
            pl.frameCount++
            const progress = Math.min(
              Math.round((pl.frameCount / AR_CONFIG.poseLockFrames) * 100),
              100
            )
            // Throttle React state updates to every 5 % to avoid perf hit.
            if (progress % 5 === 0) setLockProgress(progress)

            if (pl.frameCount >= AR_CONFIG.poseLockFrames) {
              // ✅ LOCK — freeze pose permanently
              pl.lockedPos.copy(smoothedPos)
              pl.lockedQuat.copy(smoothedQuat)
              pl.locked = true
              setTrackingState('locked')
              setLockProgress(100)
              console.log('[AR] Pose locked — marker occlusion no longer matters.')
            }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // MODE C — HOLD (marker temporarily lost before lock)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          } else if (hasFirstSnap && (now - lastSeenTime < AR_CONFIG.trackingHoldSeconds)) {
            displayRoot.visible = true
          } else {
            displayRoot.visible = false
            hasFirstSnap = false
          }

          // ── Live rotation from HUD ───────────────────────────────────
          if (elephantGroupRef.current) {
            elephantGroupRef.current.rotation.y = modelRotationRef.current
          }

          // ── Decorative ring spin ─────────────────────────────────────
          ringMesh.rotation.z += delta * 0.8

          // ── Animation update ─────────────────────────────────────────
          if (mixerRef.current) mixerRef.current.update(delta)

          renderer.render(scene, camera)
        })

      } catch (err) {
        console.error('MindAR error:', err)
        if (stopped) return

        const msg = err?.message ?? ''
        if (msg.includes('targets.mind') || msg.includes('404') || msg.includes('fetch')) {
          setErrorMsg('TARGETS_MIND')
        } else if (err.name === 'NotAllowedError' || msg.includes('camera') || msg.includes('permission')) {
          setErrorMsg('Camera permission denied. Please allow camera access and try again.')
        } else {
          setErrorMsg('AR Error: ' + (msg || err?.name || 'Unknown error'))
        }
        setIsStarting(false)
      }
    }

    startAR()

    return () => {
      stopped = true
      if (lostTimeoutRef.current) clearTimeout(lostTimeoutRef.current)
      try {
        if (mindARRef.current) {
          mindARRef.current.renderer?.setAnimationLoop(null)
          mindARRef.current.stop()
        }
      } catch { /* ignore cleanup errors */ }
      mixerRef.current         = null
      elSceneRef.current       = null
      elephantGroupRef.current = null
      mindARRef.current        = null
    }
  }, [])

  const isTargetsMindError = errorMsg === 'TARGETS_MIND'
  const isLocked           = trackingState === 'locked'

  return (
    <div className="fixed inset-0 z-0 bg-black">
      {/* MindAR mounts its own canvas + video feed inside this div */}
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Loading overlay ─────────────────────────────────────────── */}
      {isStarting && !errorMsg && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl gap-5">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-amber-500/30" />
            <div className="absolute inset-0 rounded-full border-4 border-t-amber-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-2xl">🐘</div>
          </div>
          <div className="text-center">
            <p className="text-amber-300 font-black text-lg tracking-wide">Chhota Bheem AR</p>
            <p className="text-slate-400 text-sm mt-1 mono">{loadingMsg}</p>
          </div>
          <button
            onClick={onExit}
            className="mt-2 bg-slate-800/80 text-slate-400 border border-slate-700 px-4 py-1.5 rounded-full text-xs font-bold"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Error overlay ────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl gap-5 p-6 text-center">
          <div className="text-5xl">⚠️</div>
          <div>
            <p className="text-amber-400 font-black text-lg">
              {isTargetsMindError ? 'One-Time Setup Required' : 'AR Error'}
            </p>
            <p className="text-slate-300 text-sm mt-2 max-w-sm">
              {isTargetsMindError
                ? 'The targets.mind file is missing. Compile it once from your marker image.'
                : errorMsg}
            </p>
          </div>

          {isTargetsMindError && (
            <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-4 text-left max-w-sm w-full">
              <p className="text-amber-300 font-black text-sm mb-3">📋 Compile targets.mind (one-time)</p>
              <ol className="text-slate-300 text-xs space-y-2 list-decimal list-inside">
                <li>
                  Open{' '}
                  <a
                    href="https://hiukim.github.io/mind-ar-js-doc/tools/compile"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 underline"
                  >
                    MindAR Compiler ↗
                  </a>
                </li>
                <li>
                  Click <strong className="text-white">Add Image</strong> → upload{' '}
                  <code className="text-amber-300 bg-slate-800 px-1 rounded">public/assets/bheem_marker.jpg</code>
                </li>
                <li>Click <strong className="text-white">Start</strong> — wait ~30 sec</li>
                <li>
                  Download{' '}
                  <code className="text-amber-300 bg-slate-800 px-1 rounded">targets.mind</code>
                </li>
                <li>
                  Save to{' '}
                  <code className="text-amber-300 bg-slate-800 px-1 rounded">public/assets/targets.mind</code>
                </li>
                <li>Reload the app</li>
              </ol>
            </div>
          )}

          <button
            onClick={onExit}
            className="bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 px-6 py-2.5 rounded-full font-black"
          >
            ← Go Back
          </button>
        </div>
      )}

      {/* ── Active HUD ──────────────────────────────────────────────── */}
      {!isStarting && !errorMsg && (
        <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-slate-950/75 backdrop-blur-xl border-b border-white/10">

          {/* Quit button */}
          <button
            onClick={onExit}
            className="bg-slate-800/90 text-slate-200 border border-slate-700/80 px-3 py-1.5 text-xs font-bold tracking-wide rounded-2xl flex items-center gap-1.5"
          >
            ← Quit
          </button>

          {/* Tracking status pill */}
          <div
            className={[
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border transition-all duration-500',
              isLocked
                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/60'
                : trackingState === 'calibrating'
                ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                : trackingState === 'lost'
                ? 'bg-red-500/20 text-red-300 border-red-400/50'
                : 'bg-slate-800/80 text-slate-400 border-slate-600/50',
            ].join(' ')}
          >
            {isLocked
              ? <Lock className="w-3 h-3 flex-shrink-0" />
              : (
                <span
                  className={[
                    'w-2 h-2 rounded-full flex-shrink-0',
                    trackingState === 'calibrating' ? 'bg-amber-400 animate-pulse'
                    : trackingState === 'lost'       ? 'bg-red-400'
                    : 'bg-slate-500',
                  ].join(' ')}
                />
              )
            }
            {isLocked
              ? '🔒 POSE LOCKED'
              : trackingState === 'calibrating'
              ? `📡 CALIBRATING ${lockProgress}%`
              : trackingState === 'lost'
              ? '⚠️ MARKER LOST'
              : '🔍 SCANNING...'}
          </div>

          {/* Right-side controls */}
          <div className="flex items-center gap-2">
            {/* Re-calibrate button — only shown when locked */}
            {isLocked && (
              <button
                onClick={handleRecalibrate}
                className="flex items-center gap-1 bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-600/80 px-2.5 py-1.5 text-xs font-bold rounded-2xl active:scale-90 transition-all"
                title="Reset pose lock and re-calibrate"
              >
                <RefreshCw className="w-3 h-3" />
                Reset
              </button>
            )}

            {/* Rotation controls */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 border border-white/10 rounded-full px-2 py-1 shadow-lg backdrop-blur-md">
              <button
                onClick={() => setModelRotation(r => r - Math.PI / 6)}
                className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold active:scale-90 transition-transform"
                title="Turn left 30°"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                onClick={() => setModelRotation(r => r + Math.PI / 6)}
                className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold active:scale-90 transition-transform"
                title="Turn right 30°"
              >
                <RotateCw className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Calibration progress bar ─────────────────────────────────── */}
      {!isStarting && !errorMsg && trackingState === 'calibrating' && (
        <div className="absolute top-[60px] left-0 right-0 z-30 px-4">
          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full transition-all duration-200"
              style={{ width: `${lockProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Bottom hint — searching ──────────────────────────────────── */}
      {!isStarting && !errorMsg && (trackingState === 'searching' || trackingState === 'lost') && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-slate-950/85 border border-amber-400/40 rounded-2xl px-5 py-3 text-center max-w-[300px]">
            <div className="text-2xl mb-1">📄</div>
            <p className="text-amber-300 font-black text-sm">Point camera at floor marker</p>
            <p className="text-slate-400 text-xs mt-1">
              {trackingState === 'lost'
                ? 'Marker lost — waiting to re-acquire…'
                : 'Keep marker in view for ~2 seconds to lock'}
            </p>
          </div>
        </div>
      )}

      {/* ── Bottom hint — calibrating ────────────────────────────────── */}
      {!isStarting && !errorMsg && trackingState === 'calibrating' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-amber-950/80 border border-amber-400/50 rounded-2xl px-5 py-3 text-center max-w-[300px]">
            <p className="text-amber-300 font-black text-sm">📡 Calibrating pose…</p>
            <p className="text-slate-300 text-xs mt-1">
              Keep marker clear — locking in {lockProgress}%
            </p>
          </div>
        </div>
      )}

      {/* ── Bottom hint — locked ─────────────────────────────────────── */}
      {!isStarting && !errorMsg && isLocked && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-emerald-950/85 border border-emerald-400/60 rounded-2xl px-5 py-3 text-center shadow-[0_0_30px_rgba(16,185,129,0.35)] max-w-[300px]">
            <p className="text-emerald-300 font-black text-sm">🔒 Pose Locked — Occlusion-Proof</p>
            <p className="text-slate-300 text-xs mt-1">
              Character stays visible even if people stand on the marker
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
