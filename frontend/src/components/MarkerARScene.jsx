import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js'
import { RotateCcw, RotateCw } from 'lucide-react'

/**
 * MarkerARScene — Fixed Real-World Character Sizing
 *
 * Character size is COMPLETELY INDEPENDENT of marker size.
 *
 * The only values that need calibrating are in AR_CONFIG below.
 *
 * Formula:
 *   MindAR unit scale  = characterHeightMeters / markerWidthMeters
 *   Final model scale  = (above) / nativeModelHeightUnits
 *
 * Example installation:
 *   Physical marker:  3.0 m wide
 *   Character:        1.5 m tall
 *   Camera:           ~8 m away
 *
 * Changing markerWidthMeters does NOT change the character height on screen.
 * If the character looks too large/small relative to a standing person,
 * adjust characterHeightMeters and re-test.
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
  // The HUD rotation buttons offset from this value at runtime.
  characterRotationDegrees: 0,

  // Small Y offset above floor surface to prevent z-fighting.
  floorOffsetMeters: 0.002,

  // ── Tracking smoothing ───────────────────────────────────────────────────
  // Lerp/slerp factors per frame. Lower = smoother but more lag.
  // Micro-movement (< 5 cm) uses half of this to eliminate jitter.
  positionSmoothing: 0.12,
  rotationSmoothing: 0.12,

  // How long (seconds) to keep the character visible after marker disappears.
  trackingHoldSeconds: 1.5,

  // ── Rendering ────────────────────────────────────────────────────────────
  maxPixelRatio: 2.5,
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT BONE NAMES — root motion stripped so character stays on marker
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

  const [trackingState, setTrackingState] = useState('searching')
  const [isStarting,   setIsStarting]     = useState(true)
  const [loadingMsg,   setLoadingMsg]     = useState('Initialising AR...')
  const [errorMsg,     setErrorMsg]       = useState(null)

  // Runtime rotation offset that operators can adjust via HUD buttons.
  // Added on top of AR_CONFIG.characterRotationDegrees every frame.
  const [modelRotation, setModelRotation] = useState(0)
  const modelRotationRef = useRef(0)

  const elSceneRef      = useRef(null)
  const elephantGroupRef = useRef(null)
  const lostTimeoutRef  = useRef(null)
  const mixerRef        = useRef(null)

  // Keep rotation ref in sync with state so the render loop reads it without
  // needing a React re-render on every button press.
  useEffect(() => {
    modelRotationRef.current = modelRotation
  }, [modelRotation])

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
          missTolerance:   45,
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

        // ── 4. MindAR anchor (tracks marker index 0) ─────────────────────
        const anchor = mindarThree.addAnchor(0)

        // ── 5. Display hierarchy ─────────────────────────────────────────
        //
        // displayRoot  ← positioned by LERP/SLERP each frame (anti-jitter)
        //   └─ markerRoot  ← rotated +90° around X so +Y is up from the floor
        //        ├─ shadowPlane
        //        ├─ ringMesh  (decorative)
        //        ├─ characterLight + target
        //        └─ elephantGroup
        //             └─ elScene  (the GLB model)
        //
        const displayRoot = new THREE.Group()
        displayRoot.visible = false
        scene.add(displayRoot)

        // Rotate so the marker's horizontal plane becomes the XZ floor.
        const markerRoot = new THREE.Group()
        markerRoot.rotation.x = Math.PI / 2
        displayRoot.add(markerRoot)

        // ── 6. Floor shadow catcher ──────────────────────────────────────
        // Sized to the physical marker so shadows look grounded correctly.
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
        // Frustum covers the full marker area so shadows are correctly cast.
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

          // Shadows & frustum culling
          elScene.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
              child.frustumCulled = false
              child.castShadow    = true
              child.receiveShadow = true
            }
          })

          // ── 10. Compute exact real-world scale ───────────────────────
          //
          // MindAR's coordinate system: 1 unit = markerWidthMeters
          //
          // We want the character to be characterHeightMeters tall.
          //
          //   unitsPerMetre  = 1 / markerWidthMeters
          //   targetHeightUnits = characterHeightMeters / markerWidthMeters
          //   exactScale = targetHeightUnits / nativeModelHeight
          //
          const originalBox    = new THREE.Box3().setFromObject(elScene)
          const nativeHeight   = originalBox.max.y - originalBox.min.y

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
          //
          // After scaling, recalculate the bounding box so min.y reflects
          // the actual scaled foot position, then shift up by that amount
          // plus the tiny floor offset.
          //
          const scaledBox  = new THREE.Box3().setFromObject(elScene)
          const scaledFoot = scaledBox.min.y
          elScene.position.y = AR_CONFIG.floorOffsetMeters - scaledFoot

          // ── 12. Base rotation from config ────────────────────────────
          elScene.rotation.y = THREE.MathUtils.degToRad(
            AR_CONFIG.characterRotationDegrees
          )

          // Group wraps the model so rotation from HUD buttons is applied
          // at the group level without disturbing model.position.
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

          // Fallback: a simple box at the correct real-world height.
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

        // ── 14. Tracking callbacks (debounced) ───────────────────────────
        anchor.onTargetFound = () => {
          if (stopped) return
          if (lostTimeoutRef.current) clearTimeout(lostTimeoutRef.current)
          lostTimeoutRef.current = null
          setTrackingState('found')
        }

        anchor.onTargetLost = () => {
          if (stopped) return
          if (lostTimeoutRef.current) clearTimeout(lostTimeoutRef.current)
          lostTimeoutRef.current = setTimeout(() => {
            if (!stopped) setTrackingState('lost')
          }, AR_CONFIG.trackingHoldSeconds * 1000)
        }

        // ── 15. Start MindAR (camera + tracking) ─────────────────────────
        setLoadingMsg('Starting camera...')
        await mindarThree.start()
        if (stopped) { mindarThree.stop(); return }

        // Enable continuous autofocus if the device supports it.
        try {
          const video = mindarThree.video
          if (video?.srcObject) {
            const track = video.srcObject.getVideoTracks()[0]
            const cap   = track?.getCapabilities?.() ?? {}
            if (cap.focusMode?.includes('continuous')) {
              await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
            }
          }
        } catch {
          // Autofocus not supported on this device — ignore.
        }

        setIsStarting(false)
        setTrackingState('searching')

        // ── 16. Render loop ───────────────────────────────────────────────
        const clock           = new THREE.Clock()
        const targetWorldPos  = new THREE.Vector3()
        const targetWorldQuat = new THREE.Quaternion()
        const smoothedPos     = new THREE.Vector3()
        const smoothedQuat    = new THREE.Quaternion()
        let hasLockedPose     = false
        let lastSeenTime      = 0

        renderer.setAnimationLoop(() => {
          if (stopped) return

          const delta = Math.min(clock.getDelta(), 0.033)
          const now   = clock.getElapsedTime()

          // ── Target visible: update smoothed pose ──────────────────────
          if (anchor.group.visible) {
            lastSeenTime = now
            anchor.group.getWorldPosition(targetWorldPos)
            anchor.group.getWorldQuaternion(targetWorldQuat)

            if (!hasLockedPose) {
              // First detection — snap instantly (no lerp lag on first lock).
              smoothedPos.copy(targetWorldPos)
              smoothedQuat.copy(targetWorldQuat)
              hasLockedPose = true
            } else {
              // Dual-rate damping:
              //   micro-movement (< 5 cm) → heavy damping (eliminate jitter)
              //   larger movement          → standard tracking
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

          } else {
            // ── Target lost: persistence latch ───────────────────────────
            if (hasLockedPose && (now - lastSeenTime < AR_CONFIG.trackingHoldSeconds)) {
              displayRoot.visible = true
            } else if (hasLockedPose) {
              displayRoot.visible = false
              hasLockedPose = false
            }
          }

          // ── Apply live rotation from HUD buttons ──────────────────────
          if (elephantGroupRef.current) {
            elephantGroupRef.current.rotation.y = modelRotationRef.current
          }

          // ── Decorative ring spin ───────────────────────────────────────
          ringMesh.rotation.z += delta * 0.8

          // ── Animation update ───────────────────────────────────────────
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
      mixerRef.current        = null
      elSceneRef.current      = null
      elephantGroupRef.current = null
      mindARRef.current       = null
    }
  }, [])

  const isTargetsMindError = errorMsg === 'TARGETS_MIND'

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
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border transition-all',
              trackingState === 'found'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50 animate-pulse'
                : trackingState === 'lost'
                ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                : 'bg-slate-800/80 text-slate-400 border-slate-600/50',
            ].join(' ')}
          >
            <span
              className={[
                'w-2 h-2 rounded-full flex-shrink-0',
                trackingState === 'found'
                  ? 'bg-emerald-400'
                  : trackingState === 'lost'
                  ? 'bg-amber-400'
                  : 'bg-slate-500',
              ].join(' ')}
            />
            {trackingState === 'found'
              ? '🐘 MARKER FOUND'
              : trackingState === 'lost'
              ? '📡 MARKER LOST'
              : '🔍 SCANNING...'}
          </div>

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
      )}

      {/* ── Bottom hint — searching ──────────────────────────────────── */}
      {!isStarting && !errorMsg && trackingState !== 'found' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-slate-950/85 border border-amber-400/40 rounded-2xl px-5 py-3 text-center max-w-[290px]">
            <div className="text-2xl mb-1">📄</div>
            <p className="text-amber-300 font-black text-sm">Point camera at floor marker</p>
            <p className="text-slate-400 text-xs mt-1">
              Waiting for marker…
            </p>
          </div>
        </div>
      )}

      {/* ── Bottom hint — found ──────────────────────────────────────── */}
      {!isStarting && !errorMsg && trackingState === 'found' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-emerald-900/80 border border-emerald-400/60 rounded-2xl px-5 py-3 text-center shadow-[0_0_30px_rgba(16,185,129,0.4)]">
            <p className="text-emerald-300 font-black text-sm">🐘 Character Active</p>
            <p className="text-slate-300 text-xs mt-1">
              Height: {AR_CONFIG.characterHeightMeters}m · Marker: {AR_CONFIG.markerWidthMeters}m wide
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
