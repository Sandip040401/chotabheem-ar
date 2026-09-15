import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js'

/**
 * MarkerARScene — NatGeo-style marker-based AR
 *
 * 100% local, zero CDN dependencies:
 *  - MindAR: installed via npm (mind-ar package, node_modules)
 *  - Three.js: same npm instance used by the rest of the app
 *  - DRACO decoder: downloaded to public/vendor/draco/
 *  - Elephant GLB: public/assets/Elephant_Turn_Walk.glb
 *  - targets.mind: public/assets/targets.mind (compiled once by user)
 *
 * How it works:
 *  - MindARThree creates its own WebGLRenderer + video camera feed
 *  - We add lights, shadow plane, elephant to MindAR's anchor.group
 *  - anchor.group is automatically positioned at the detected marker
 *  - Elephant orbits the marker origin every frame
 */

const ROOT_BONES = ['elep_4_Root_M', 'elep_4_RootPart1_M']

// ─────────────────────────────────────────────────────────────
// TUNING CONSTANTS
// MindAR units: 1.0 = physical width of the printed marker
// e.g. if marker is A4 (21cm wide), SCALE=0.3 makes elephant ~6cm tall
// Increase SCALE for larger prints or longer viewing distances
// ─────────────────────────────────────────────────────────────
const ELEPHANT_SCALE   = 0.30   // size of elephant relative to marker width
const ORBIT_RADIUS     = 0.55   // how far elephant walks from marker centre
const ORBIT_SPEED      = 0.40   // walking speed (radians per second)


function stripRootMotion(animations) {
  return animations.map(clip => {
    const cloned = clip.clone()
    cloned.tracks = cloned.tracks.filter(t => {
      const bone = t.name.split('.')[0]
      return !(ROOT_BONES.includes(bone) &&
        (t.name.endsWith('.position') || t.name.endsWith('.rotation')))
    })
    return cloned
  })
}

export default function MarkerARScene({ onExit }) {
  const containerRef = useRef(null)
  const mindARRef    = useRef(null)

  const [trackingState, setTrackingState] = useState('searching')
  const [isStarting,   setIsStarting]     = useState(true)
  const [loadingMsg,   setLoadingMsg]     = useState('Initialising AR...')
  const [errorMsg,     setErrorMsg]       = useState(null)

  useEffect(() => {
    let stopped = false

    async function startAR() {
      try {
        // ── 1. Create MindAR instance ──────────────────────────────
        setLoadingMsg('Preparing marker tracking...')

        const mindarThree = new MindARThree({
          container:      containerRef.current,
          imageTargetSrc: 'assets/targets.mind',
          uiScanning:     false,
          uiLoading:      false,
          // ── Long-distance tracking optimisations ──
          // Smoothing filter: lower filterMinCF = smoother tracking at distance
          // (reduces jitter when marker is small in frame)
          filterMinCF:       0.001,
          filterBeta:        1000,
          // Keep tracking lock for longer when marker partially hidden
          warmupTolerance:   5,    // frames before tracking is considered stable
          missTolerance:     10,   // frames before tracking is considered lost
          // Track only 1 target at a time (faster, uses less CPU)
          maxTrack:          1,
        })
        mindARRef.current = mindarThree
        if (stopped) return

        const { renderer, scene, camera } = mindarThree

        // ── Renderer quality ──────────────────────────────────────────────
        // Use device's native pixel density (Retina / AMOLED screens)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3))
        // Cinematic tone mapping — makes 3D lighting look much more realistic
        renderer.toneMapping        = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.0
        // Correct colour space for PBR materials
        renderer.outputColorSpace    = THREE.SRGBColorSpace
        // Enable shadows for the shadow-catcher plane
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type    = THREE.PCFSoftShadowMap

        // ── 2. Lighting ────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0xffffff, 1.0))

        const dirLight = new THREE.DirectionalLight(0xffffff, 2.0)
        dirLight.position.set(1, 3, 2)
        dirLight.castShadow             = true
        dirLight.shadow.mapSize.width   = 2048
        dirLight.shadow.mapSize.height  = 2048
        dirLight.shadow.camera.near     = 0.01
        dirLight.shadow.camera.far      = 10
        dirLight.shadow.camera.left     = -2
        dirLight.shadow.camera.right    = 2
        dirLight.shadow.camera.top      = 2
        dirLight.shadow.camera.bottom   = -2
        scene.add(dirLight)

        const fillLight = new THREE.DirectionalLight(0x80aaff, 0.4)
        fillLight.position.set(-2, -1, -1)
        scene.add(fillLight)

        // ── 3. Anchor to image target index 0 ─────────────────────
        const anchor = mindarThree.addAnchor(0)

        // Shadow catcher plane on the card surface
        const shadowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.ShadowMaterial({ transparent: true, opacity: 0.3 })
        )
        shadowPlane.rotation.x = -Math.PI / 2
        shadowPlane.receiveShadow = true
        anchor.group.add(shadowPlane)

        // Spinning glow ring on card surface
        const ringMesh = new THREE.Mesh(
          new THREE.RingGeometry(0.06, 0.14, 48),
          new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
          })
        )
        ringMesh.rotation.x = -Math.PI / 2
        ringMesh.position.y = 0.001
        anchor.group.add(ringMesh)

        // ── 4. Load Elephant GLB (fully local) ────────────────────
        setLoadingMsg('Loading elephant model...')

        const dracoLoader = new DRACOLoader()
        // Local DRACO decoder — no CDN
        dracoLoader.setDecoderPath('vendor/draco/')

        const loader = new GLTFLoader()
        loader.setDRACOLoader(dracoLoader)

        let elephantGroup = null
        let mixer         = null
        const orbit = { angle: 0, radius: ORBIT_RADIUS, speed: ORBIT_SPEED }

        try {
          const gltf = await loader.loadAsync('assets/Elephant_Turn_Walk.glb')
          if (stopped) return

          const elScene = gltf.scene

          // Find foot Y offset so elephant stands on the card
          const box = new THREE.Box3().setFromObject(elScene)
          const footY = box.min.y

          elScene.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
              child.frustumCulled = false
              child.castShadow    = true
            }
          })

          const SCALE = ELEPHANT_SCALE
          elScene.scale.setScalar(SCALE)
          elScene.position.y = -footY * SCALE // lift feet to y=0 (card surface)

          elephantGroup = new THREE.Group()
          elephantGroup.add(elScene)
          anchor.group.add(elephantGroup)

          // Strip root-bone motion to prevent root sliding
          const clips = stripRootMotion(gltf.animations)
          mixer = new THREE.AnimationMixer(elScene)
          if (clips.length > 0) {
            const action = mixer.clipAction(clips[0])
            action.reset().fadeIn(0.4).setLoop(THREE.LoopRepeat).play()
          }
        } catch (glbErr) {
          console.warn('GLB load failed, using fallback:', glbErr)
          // Fallback golden box — confirms tracking works even without GLB
          const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.12, 0.08),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.3 })
          )
          fallback.position.y = 0.06
          elephantGroup = new THREE.Group()
          elephantGroup.add(fallback)
          anchor.group.add(elephantGroup)
        }

        // ── 5. Tracking callbacks ──────────────────────────────────
        anchor.onTargetFound = () => { if (!stopped) setTrackingState('found') }
        anchor.onTargetLost  = () => { if (!stopped) setTrackingState('lost')  }

        // ── 6. Start MindAR (opens camera + begins tracking) ────────────
        setLoadingMsg('Starting camera...')
        await mindarThree.start()
        if (stopped) { mindarThree.stop(); return }

        // ── Upgrade camera to maximum available resolution ──────────────
        // MindAR opens the camera at its default (often 640×480).
        // After start(), we can push the video track to its max capability.
        // Tracking continues at MindAR's internal downscaled resolution;
        // the higher-res stream makes the camera PREVIEW sharper.
        try {
          const video = mindarThree.video
          if (video?.srcObject) {
            const track = video.srcObject.getVideoTracks()[0]
            if (track) {
              const cap = track.getCapabilities?.() ?? {}
              await track.applyConstraints({
                width:  { ideal: cap.width?.max  ?? 3840 },
                height: { ideal: cap.height?.max ?? 2160 },
                // Continuous autofocus (essential at 3-8m)
                ...(cap.focusMode?.includes('continuous') && {
                  focusMode: 'continuous',
                }),
              })
              const s = track.getSettings()
              console.info(`[MarkerAR] Camera: ${s.width}×${s.height}, facing: ${s.facingMode}`)
            }
          }
        } catch (camErr) {
          // applyConstraints not supported on all browsers — safe to ignore
          console.warn('[MarkerAR] Camera upgrade skipped:', camErr.message)
        }

        setIsStarting(false)
        setTrackingState('searching')

        // ── 7. Render loop ─────────────────────────────────────────
        const clock = new THREE.Clock()
        renderer.setAnimationLoop(() => {
          const delta = Math.min(clock.getDelta(), 0.033)

          // Elephant walks in a circle around the marker
          if (elephantGroup) {
            orbit.angle += delta * orbit.speed
            elephantGroup.position.set(
              Math.cos(orbit.angle) * orbit.radius,
              0,
              Math.sin(orbit.angle) * orbit.radius
            )
            // Face direction of travel
            elephantGroup.rotation.y = orbit.angle + Math.PI / 2
          }

          // Spin the glow ring
          ringMesh.rotation.z += delta * 1.2

          if (mixer) mixer.update(delta)
          renderer.render(scene, camera)
        })

      } catch (err) {
        console.error('MindAR error:', err)
        if (stopped) return

        const msg = err.message ?? ''
        if (msg.includes('targets.mind') || msg.includes('404') || msg.includes('fetch')) {
          setErrorMsg('TARGETS_MIND')
        } else if (err.name === 'NotAllowedError' || msg.includes('camera') || msg.includes('permission')) {
          setErrorMsg('Camera permission denied. Please allow camera access and try again.')
        } else {
          setErrorMsg('AR Error: ' + (msg || err.name || 'Unknown error'))
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
      } catch (e) { /* ignore cleanup errors on unmount */ }
      mindARRef.current = null
    }
  }, [])

  const isTargetsMindError = errorMsg === 'TARGETS_MIND'

  return (
    <div className="fixed inset-0 z-0 bg-black">
      {/* MindAR mounts its own canvas + video inside this div */}
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Loading overlay ── */}
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

      {/* ── Error overlay ── */}
      {errorMsg && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl gap-5 p-6 text-center">
          <div className="text-5xl">⚠️</div>
          <div>
            <p className="text-amber-400 font-black text-lg">
              {isTargetsMindError ? 'One-Time Setup Required' : 'AR Error'}
            </p>
            <p className="text-slate-300 text-sm mt-2 max-w-sm">
              {isTargetsMindError
                ? 'The targets.mind file is missing. Compile it once from the Bheem marker card.'
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

      {/* ── Active HUD ── */}
      {!isStarting && !errorMsg && (
        <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-slate-950/75 backdrop-blur-xl border-b border-white/10">
          <button
            onClick={onExit}
            className="bg-slate-800/90 text-slate-200 border border-slate-700/80 px-3 py-1.5 text-xs font-bold tracking-wide rounded-2xl flex items-center gap-1.5"
          >
            ← Quit
          </button>

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

          <div className="w-16" />
        </div>
      )}

      {/* ── Scanning hint ── */}
      {!isStarting && !errorMsg && trackingState !== 'found' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-slate-950/85 border border-amber-400/40 rounded-2xl px-5 py-3 text-center max-w-[290px]">
            <div className="text-2xl mb-1">📄</div>
            <p className="text-amber-300 font-black text-sm">Point camera at Bheem Card</p>
            <p className="text-slate-400 text-xs mt-1">
              Print <strong className="text-slate-300">bheem_marker.jpg</strong> and aim camera at it
            </p>
          </div>
        </div>
      )}

      {/* ── Marker found ── */}
      {!isStarting && !errorMsg && trackingState === 'found' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="bg-emerald-900/80 border border-emerald-400/60 rounded-2xl px-5 py-3 text-center shadow-[0_0_30px_rgba(16,185,129,0.4)]">
            <p className="text-emerald-300 font-black text-sm">🐘 Safari Elephant is ALIVE!</p>
            <p className="text-slate-300 text-xs mt-1">Walk around the card to see full 3D!</p>
          </div>
        </div>
      )}
    </div>
  )
}
