import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js'
import { ZoomIn, ZoomOut, RotateCcw, RotateCw } from 'lucide-react'

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
// Default scale: 0.35 fits comfortably inside standard marker card
// ─────────────────────────────────────────────────────────────
const DEFAULT_SCALE = 0.35

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
  const [modelScale,   setModelScale]     = useState(DEFAULT_SCALE)
  const [modelRotation, setModelRotation] = useState(0)

  const modelScaleRef    = useRef(DEFAULT_SCALE)
  const modelRotationRef = useRef(0)
  const elephantGroupRef = useRef(null)
  const elSceneRef       = useRef(null)
  const footYRef         = useRef(0)

  // Sync ref with state
  useEffect(() => {
    modelScaleRef.current = modelScale
  }, [modelScale])

  useEffect(() => {
    modelRotationRef.current = modelRotation
  }, [modelRotation])

  useEffect(() => {
    let stopped = false

    async function startAR() {
      try {
        // ── 1. Create MindAR instance with high-stability smoothing ─
        setLoadingMsg('Preparing marker tracking...')

        const mindarThree = new MindARThree({
          container:      containerRef.current,
          imageTargetSrc: 'assets/targets.mind',
          uiScanning:     false,
          uiLoading:      false,
          // ── Rock-solid smoothing filter (eliminates shaking & jitter) ──
          // filterMinCF: very low cutoff eliminates micro-jitter when stationary
          // filterBeta: low velocity weight prevents erratic twitching on camera noise
          filterMinCF:       0.0001,
          filterBeta:        0.01,
          // Keep tracking locked smoothly across momentary frame drops (avoids restarts)
          warmupTolerance:   3,
          missTolerance:     35,
          maxTrack:          1,
        })
        mindARRef.current = mindarThree
        if (stopped) return

        const { renderer, scene, camera } = mindarThree

        // ── Renderer quality ──────────────────────────────────────────────
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5))
        renderer.toneMapping         = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.1
        renderer.outputColorSpace    = THREE.SRGBColorSpace
        renderer.shadowMap.enabled   = true
        renderer.shadowMap.type      = THREE.PCFSoftShadowMap

        // ── 2. Lighting ────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0xffffff, 1.2))

        const fillLight = new THREE.DirectionalLight(0x80aaff, 0.5)
        fillLight.position.set(-2, 2, -1)
        scene.add(fillLight)

        // ── 3. Anchor to image target index 0 ─────────────────────
        const anchor = mindarThree.addAnchor(0)

        // Container that aligns MindAR marker space with standard 3D floor space:
        // By default MindAR puts the card in XY plane (normal = +Z).
        // Rotating Math.PI / 2 around X maps +Z to +Y (vertical UP from floor),
        // making the card surface the horizontal XZ floor plane.
        const markerRoot = new THREE.Group()
        markerRoot.rotation.x = Math.PI / 2
        anchor.group.add(markerRoot)

        // Shadow catcher plane glued right on the card / floor surface (y = 0.0005)
        const shadowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(3, 3),
          new THREE.ShadowMaterial({ transparent: true, opacity: 0.45 })
        )
        shadowPlane.rotation.x = -Math.PI / 2
        shadowPlane.position.y = 0.0005
        shadowPlane.receiveShadow = true
        markerRoot.add(shadowPlane)

        // Gravity ring visual on the marker surface under the feet
        const ringMesh = new THREE.Mesh(
          new THREE.RingGeometry(0.16, 0.22, 64),
          new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6,
          })
        )
        ringMesh.rotation.x = -Math.PI / 2
        ringMesh.position.y = 0.001
        markerRoot.add(ringMesh)

        // Directional sunlight shining from above the floor onto the elephant
        const dirLight = new THREE.DirectionalLight(0xffffff, 2.2)
        dirLight.position.set(0.8, 2.5, 1.2)
        dirLight.castShadow            = true
        dirLight.shadow.mapSize.width  = 2048
        dirLight.shadow.mapSize.height = 2048
        dirLight.shadow.camera.near    = 0.05
        dirLight.shadow.camera.far     = 6
        dirLight.shadow.camera.left    = -1
        dirLight.shadow.camera.right   = 1
        dirLight.shadow.camera.top     = 1
        dirLight.shadow.camera.bottom  = -1
        dirLight.target.position.set(0, 0, 0)
        markerRoot.add(dirLight)
        markerRoot.add(dirLight.target)

        // ── 4. Load Elephant GLB (fully local) ────────────────────
        setLoadingMsg('Loading elephant model...')

        const dracoLoader = new DRACOLoader()
        dracoLoader.setDecoderPath('vendor/draco/')

        const loader = new GLTFLoader()
        loader.setDRACOLoader(dracoLoader)

        let elephantGroup = null
        let mixer         = null

        try {
          const gltf = await loader.loadAsync('assets/Elephant_Turn_Walk.glb')
          if (stopped) return

          const elScene = gltf.scene
          elSceneRef.current = elScene

          // Find exact foot Y offset so feet are glued precisely to y=0 (marker surface)
          const box = new THREE.Box3().setFromObject(elScene)
          const footY = box.min.y
          footYRef.current = footY

          elScene.traverse(child => {
            if (child.isMesh || child.isSkinnedMesh) {
              child.frustumCulled = false
              child.castShadow    = true
            }
          })

          const initScale = modelScaleRef.current
          elScene.scale.setScalar(initScale)
          elScene.position.y = -footY * initScale // Glue feet to marker surface y=0!

          elephantGroup = new THREE.Group()
          elephantGroup.position.set(0, 0, 0) // Centered right on the marker!
          elephantGroup.add(elScene)
          markerRoot.add(elephantGroup)
          elephantGroupRef.current = elephantGroup

          // Strip root translation to keep animation centered on the marker
          const clips = stripRootMotion(gltf.animations)
          mixer = new THREE.AnimationMixer(elScene)
          if (clips.length > 0) {
            const action = mixer.clipAction(clips[0])
            action.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat).play()
            action.timeScale = 0.95
          }
        } catch (glbErr) {
          console.warn('GLB load failed, using fallback box:', glbErr)
          const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.16, 0.12),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.3 })
          )
          fallback.position.y = 0.08
          elephantGroup = new THREE.Group()
          elephantGroup.position.set(0, 0, 0)
          elephantGroup.add(fallback)
          markerRoot.add(elephantGroup)
          elephantGroupRef.current = elephantGroup
        }

        // ── 5. Tracking callbacks ──────────────────────────────────
        anchor.onTargetFound = () => { if (!stopped) setTrackingState('found') }
        anchor.onTargetLost  = () => { if (!stopped) setTrackingState('lost')  }

        // ── 6. Start MindAR (opens camera + begins tracking) ────────────
        setLoadingMsg('Starting camera...')
        await mindarThree.start()
        if (stopped) { mindarThree.stop(); return }

        // Enable continuous autofocus if supported, without disrupting video stream
        try {
          const video = mindarThree.video
          if (video?.srcObject) {
            const track = video.srcObject.getVideoTracks()[0]
            const cap = track?.getCapabilities?.() ?? {}
            if (cap.focusMode?.includes('continuous')) {
              await track.applyConstraints({
                advanced: [{ focusMode: 'continuous' }]
              })
            }
          }
        } catch {
          // ignore if continuous focus is not supported
        }

        setIsStarting(false)
        setTrackingState('searching')

        // ── 7. Render loop ─────────────────────────────────────────
        const clock = new THREE.Clock()
        renderer.setAnimationLoop(() => {
          const delta = Math.min(clock.getDelta(), 0.033)

          // Keep elephant glued to (0, 0, 0) with user's desired scale and rotation
          if (elSceneRef.current && elephantGroupRef.current) {
            const currentScale = modelScaleRef.current
            elSceneRef.current.scale.setScalar(currentScale)
            // Keep bottom of feet locked to card surface y = 0
            elSceneRef.current.position.y = -footYRef.current * currentScale

            // User orientation
            elephantGroupRef.current.rotation.y = modelRotationRef.current
          }

          // Gentle decorative glow pulse on marker surface ring
          ringMesh.rotation.z += delta * 0.8

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

          {/* Quick scale & rotation controls */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 border border-white/10 rounded-full px-2 py-1 shadow-lg backdrop-blur-md">
            <button
              onClick={() => setModelScale(s => Math.max(0.15, +(s - 0.05).toFixed(2)))}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold active:scale-90 transition-transform"
              title="Shrink elephant"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="text-[10px] font-mono font-bold text-amber-300 w-8 text-center">
              {(modelScale * 100).toFixed(0)}%
            </span>
            <button
              onClick={() => setModelScale(s => Math.min(1.0, +(s + 0.05).toFixed(2)))}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold active:scale-90 transition-transform"
              title="Enlarge elephant"
            >
              <ZoomIn className="w-3 h-3" />
            </button>

            <div className="w-[1px] h-3.5 bg-white/20 mx-0.5" />

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
