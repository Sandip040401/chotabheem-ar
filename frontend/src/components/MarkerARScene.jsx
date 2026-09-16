
import { useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'


/* ================================================================
   AR INSTALLATION CONFIGURATION

   CHANGE THESE VALUES FOR YOUR ACTUAL INSTALLATION
   ================================================================ */

const AR_CONFIG = {

  // Physical width of your floor marker in metres
  markerWidthMeters: 3.0,

  // Initial desired height of the AR character in metres
  characterHeightMeters: 1.5,

  // Initial character rotation
  characterRotationDegrees: 0,

  // Size change when pressing + / -
  sizeStepMeters: 0.10,

  // Minimum character height
  minCharacterHeightMeters: 0.5,

  // Maximum character height
  maxCharacterHeightMeters: 4.0,

  // Tracking smoothing before locking
  positionSmoothing: 0.20,
  rotationSmoothing: 0.20,
}


/* ================================================================
   ROOT MOTION
   ================================================================ */

const ROOT_BONES = [
  'elep_4_Root_M',
  'elep_4_RootPart1_M',
]


function stripRootMotion(animations) {

  return animations.map((clip) => {

    const cloned = clip.clone()

    cloned.tracks = cloned.tracks.filter((track) => {

      const bone = track.name.split('.')[0]

      return !(
        ROOT_BONES.includes(bone) &&
        (
          track.name.endsWith('.position') ||
          track.name.endsWith('.rotation')
        )
      )
    })

    return cloned
  })
}


/* ================================================================
   MAIN COMPONENT
   ================================================================ */

export default function MarkerARScene({ onExit }) {

  const containerRef = useRef(null)

  const mindARRef = useRef(null)

  const modelRef = useRef(null)

  const characterGroupRef = useRef(null)

  const mixerRef = useRef(null)

  /*
   * TRUE after the operator presses FIX POSITION.
   *
   * After this becomes true, MindAR marker tracking
   * no longer controls the AR character.
   */
  const positionLockedRef = useRef(false)

  /*
   * Saved world position.
   */
  const lockedPositionRef = useRef(
    new THREE.Vector3()
  )

  /*
   * Saved world rotation.
   */
  const lockedQuaternionRef = useRef(
    new THREE.Quaternion()
  )

  /*
   * Current desired real-world character height.
   */
  const characterHeightRef = useRef(
    AR_CONFIG.characterHeightMeters
  )

  /*
   * Original model height.
   */
  const originalHeightRef = useRef(1)


  const [trackingState, setTrackingState] =
    useState('searching')

  const [isStarting, setIsStarting] =
    useState(true)

  const [loadingMsg, setLoadingMsg] =
    useState('Initialising AR...')

  const [errorMsg, setErrorMsg] =
    useState(null)

  const [positionLocked, setPositionLocked] =
    useState(false)

  const [characterHeight, setCharacterHeight] =
    useState(
      AR_CONFIG.characterHeightMeters
    )

  const [rotationDegrees, setRotationDegrees] =
    useState(
      AR_CONFIG.characterRotationDegrees
    )


  /* ================================================================
     UPDATE CHARACTER SIZE
     ================================================================ */

  function updateCharacterSize(newHeight) {

    const clampedHeight = Math.min(
      AR_CONFIG.maxCharacterHeightMeters,
      Math.max(
        AR_CONFIG.minCharacterHeightMeters,
        newHeight
      )
    )

    characterHeightRef.current =
      clampedHeight

    setCharacterHeight(
      clampedHeight
    )

    const model = modelRef.current

    if (!model) {
      return
    }

    const originalHeight =
      originalHeightRef.current

    if (
      !originalHeight ||
      originalHeight <= 0
    ) {
      return
    }

    /*
     * Convert desired real-world height
     * into Three.js scale.
     */
    const scale =
      clampedHeight / originalHeight

    model.scale.setScalar(scale)

    /*
     * Keep feet on the floor.
     */
    const box =
      new THREE.Box3().setFromObject(model)

    model.position.y =
      -box.min.y
  }


  /* ================================================================
     UPDATE CHARACTER ROTATION
     ================================================================ */

  function updateRotation(degrees) {

    setRotationDegrees(degrees)

    if (characterGroupRef.current) {

      characterGroupRef.current.rotation.y =
        THREE.MathUtils.degToRad(
          degrees
        )
    }
  }


  /* ================================================================
     LOCK POSITION
     ================================================================ */

  function lockPosition() {

    /*
     * Already locked.
     */
    if (positionLockedRef.current) {
      return
    }

    const mindAR = mindARRef.current

    if (!mindAR) {
      return
    }

    /*
     * Get the MindAR anchor.
     */
    const anchor =
      mindAR.__chotaBheemAnchor

    if (!anchor) {

      alert(
        'AR anchor is not available.'
      )

      return
    }

    /*
     * Marker must currently be visible.
     */
    if (!anchor.group.visible) {

      alert(
        'Marker is not detected yet. Please make sure the camera can see the marker.'
      )

      return
    }

    /*
     * Get current marker world position.
     */
    const currentPosition =
      new THREE.Vector3()

    /*
     * Get current marker world rotation.
     */
    const currentQuaternion =
      new THREE.Quaternion()

    anchor.group.getWorldPosition(
      currentPosition
    )

    anchor.group.getWorldQuaternion(
      currentQuaternion
    )

    /*
     * SAVE POSITION.
     */
    lockedPositionRef.current.copy(
      currentPosition
    )

    /*
     * SAVE ROTATION.
     */
    lockedQuaternionRef.current.copy(
      currentQuaternion
    )

    /*
     * LOCK.
     */
    positionLockedRef.current =
      true

    setPositionLocked(
      true
    )

    setTrackingState(
      'locked'
    )
  }


  /* ================================================================
     UNLOCK POSITION
     ================================================================ */

  function unlockPosition() {

    positionLockedRef.current =
      false

    setPositionLocked(
      false
    )

    setTrackingState(
      'searching'
    )
  }


  /* ================================================================
     START AR
     ================================================================ */

  useEffect(() => {

    let stopped = false

    async function startAR() {

      try {

        /* ------------------------------------------------------------
           CREATE MINDAR
           ------------------------------------------------------------ */

        setLoadingMsg(
          'Preparing marker tracking...'
        )

        const mindarThree =
          new MindARThree({

            container:
              containerRef.current,

            imageTargetSrc:
              'assets/targets.mind',

            uiScanning:
              false,

            uiLoading:
              false,

            filterMinCF:
              0.0001,

            filterBeta:
              0.001,

            warmupTolerance:
              2,

            missTolerance:
              45,

            maxTrack:
              1,
          })

        mindARRef.current =
          mindarThree


        if (stopped) {
          return
        }


        const {
          renderer,
          scene,
          camera,
        } = mindarThree


        /* ------------------------------------------------------------
           RENDERER
           ------------------------------------------------------------ */

        renderer.setPixelRatio(
          Math.min(
            window.devicePixelRatio || 1,
            2.5
          )
        )

        renderer.toneMapping =
          THREE.ACESFilmicToneMapping

        renderer.toneMappingExposure =
          1.1

        renderer.outputColorSpace =
          THREE.SRGBColorSpace

        renderer.shadowMap.enabled =
          true

        renderer.shadowMap.type =
          THREE.PCFSoftShadowMap


        /* ------------------------------------------------------------
           LIGHTING
           ------------------------------------------------------------ */

        const ambientLight =
          new THREE.AmbientLight(
            0xffffff,
            1.2
          )

        scene.add(
          ambientLight
        )


        const fillLight =
          new THREE.DirectionalLight(
            0xffffff,
            0.6
          )

        fillLight.position.set(
          -2,
          3,
          2
        )

        scene.add(
          fillLight
        )


        /* ------------------------------------------------------------
           MARKER ANCHOR
           ------------------------------------------------------------ */

        const anchor =
          mindarThree.addAnchor(0)

        /*
         * Save anchor so the LOCK button
         * can access it.
         */
        mindarThree.__chotaBheemAnchor =
          anchor


        /* ------------------------------------------------------------
           INDEPENDENT AR ROOT
           ------------------------------------------------------------ */

        const arRoot =
          new THREE.Group()

        arRoot.visible =
          false

        scene.add(
          arRoot
        )


        /* ------------------------------------------------------------
           FLOOR SHADOW
           ------------------------------------------------------------ */

        const shadowPlane =
          new THREE.Mesh(

            new THREE.PlaneGeometry(
              AR_CONFIG.markerWidthMeters,
              AR_CONFIG.markerWidthMeters
            ),

            new THREE.ShadowMaterial({
              transparent: true,
              opacity: 0.35,
            })
          )

        shadowPlane.rotation.x =
          -Math.PI / 2

        shadowPlane.position.y =
          0.002

        shadowPlane.receiveShadow =
          true

        arRoot.add(
          shadowPlane
        )


        /* ------------------------------------------------------------
           CHARACTER LIGHT
           ------------------------------------------------------------ */

        const characterLight =
          new THREE.DirectionalLight(
            0xffffff,
            2.2
          )

        characterLight.position.set(
          1.5,
          3,
          2
        )

        characterLight.castShadow =
          true

        characterLight.shadow.mapSize.width =
          2048

        characterLight.shadow.mapSize.height =
          2048

        characterLight.shadow.camera.near =
          0.05

        characterLight.shadow.camera.far =
          10

        characterLight.shadow.camera.left =
          -3

        characterLight.shadow.camera.right =
          3

        characterLight.shadow.camera.top =
          3

        characterLight.shadow.camera.bottom =
          -3

        characterLight.target.position.set(
          0,
          0,
          0
        )

        arRoot.add(
          characterLight
        )

        arRoot.add(
          characterLight.target
        )


        /* ------------------------------------------------------------
           CHARACTER GROUP
           ------------------------------------------------------------ */

        const characterGroup =
          new THREE.Group()

        characterGroup.position.set(
          0,
          0,
          0
        )

        characterGroup.rotation.y =
          THREE.MathUtils.degToRad(
            AR_CONFIG.characterRotationDegrees
          )

        arRoot.add(
          characterGroup
        )

        characterGroupRef.current =
          characterGroup


        /* ------------------------------------------------------------
           LOAD GLB
           ------------------------------------------------------------ */

        setLoadingMsg(
          'Loading AR character...'
        )

        const dracoLoader =
          new DRACOLoader()

        dracoLoader.setDecoderPath(
          'vendor/draco/'
        )


        const loader =
          new GLTFLoader()

        loader.setDRACOLoader(
          dracoLoader
        )


        try {

          const gltf =
            await loader.loadAsync(
              'assets/Elephant_Turn_Walk.glb'
            )


          if (stopped) {
            return
          }


          const model =
            gltf.scene

          modelRef.current =
            model


          /* ----------------------------------------------------------
             MODEL PREPARATION
             ---------------------------------------------------------- */

          model.traverse(
            (child) => {

              if (
                child.isMesh ||
                child.isSkinnedMesh
              ) {

                child.frustumCulled =
                  false

                child.castShadow =
                  true

                child.receiveShadow =
                  true
              }
            }
          )


          /* ----------------------------------------------------------
             ORIGINAL MODEL HEIGHT
             ---------------------------------------------------------- */

          const originalBox =
            new THREE.Box3()
              .setFromObject(model)


          const originalHeight =
            originalBox.max.y -
            originalBox.min.y


          if (
            !originalHeight ||
            originalHeight <= 0
          ) {

            throw new Error(
              'Invalid model dimensions.'
            )
          }


          originalHeightRef.current =
            originalHeight


          /* ----------------------------------------------------------
             INITIAL SIZE
             ---------------------------------------------------------- */

          const initialScale =
            AR_CONFIG.characterHeightMeters /
            originalHeight


          model.scale.setScalar(
            initialScale
          )


          /*
           * Put feet exactly on floor.
           */
          const scaledBox =
            new THREE.Box3()
              .setFromObject(model)


          model.position.y =
            -scaledBox.min.y


          /* ----------------------------------------------------------
             ADD MODEL
             ---------------------------------------------------------- */

          characterGroup.add(
            model
          )


          /* ----------------------------------------------------------
             ANIMATION
             ---------------------------------------------------------- */

          const clips =
            stripRootMotion(
              gltf.animations
            )


          if (
            clips.length > 0
          ) {

            const mixer =
              new THREE.AnimationMixer(
                model
              )

            mixerRef.current =
              mixer


            const action =
              mixer.clipAction(
                clips[0]
              )

            action.reset()

            action.fadeIn(
              0.3
            )

            action.setLoop(
              THREE.LoopRepeat
            )

            action.play()

            action.timeScale =
              0.95
          }


        } catch (modelError) {

          console.error(
            'Model loading failed:',
            modelError
          )


          /*
           * FALLBACK BOX
           */

          const fallback =
            new THREE.Mesh(

              new THREE.BoxGeometry(
                0.4,
                AR_CONFIG.characterHeightMeters,
                0.4
              ),

              new THREE.MeshStandardMaterial({
                color: 0xf59e0b,
                roughness: 0.5,
              })
            )


          fallback.position.y =
            AR_CONFIG.characterHeightMeters /
            2


          fallback.castShadow =
            true

          fallback.receiveShadow =
            true


          characterGroup.add(
            fallback
          )


          modelRef.current =
            fallback

          originalHeightRef.current =
            AR_CONFIG.characterHeightMeters
        }


        /* ------------------------------------------------------------
           TARGET FOUND
           ------------------------------------------------------------ */

        anchor.onTargetFound =
          () => {

            if (stopped) {
              return
            }


            /*
             * After locking, ignore
             * MindAR tracking state.
             */
            if (
              positionLockedRef.current
            ) {

              return
            }


            setTrackingState(
              'found'
            )
          }


        /* ------------------------------------------------------------
           TARGET LOST
           ------------------------------------------------------------ */

        anchor.onTargetLost =
          () => {

            if (stopped) {
              return
            }


            /*
             * IMPORTANT:
             *
             * If position is locked,
             * marker loss doesn't matter.
             */
            if (
              positionLockedRef.current
            ) {

              return
            }


            setTrackingState(
              'lost'
            )
          }


        /* ------------------------------------------------------------
           START CAMERA
           ------------------------------------------------------------ */

        setLoadingMsg(
          'Starting camera...'
        )

        await mindarThree.start()


        if (stopped) {

          mindarThree.stop()

          return
        }


        /* ------------------------------------------------------------
           CONTINUOUS AUTOFOCUS
           ------------------------------------------------------------ */

        try {

          const video =
            mindarThree.video


          if (
            video?.srcObject
          ) {

            const track =
              video.srcObject
                .getVideoTracks()[0]


            const capabilities =
              track?.getCapabilities?.() ||
              {}


            if (
              capabilities.focusMode?.includes(
                'continuous'
              )
            ) {

              await track.applyConstraints({

                advanced: [
                  {
                    focusMode:
                      'continuous',
                  },
                ],

              })
            }
          }

        } catch {
          // Ignore unsupported autofocus.
        }


        setIsStarting(
          false
        )

        setTrackingState(
          'searching'
        )


        /* ------------------------------------------------------------
           RENDER LOOP
           ------------------------------------------------------------ */

        const clock =
          new THREE.Clock()


        const targetPosition =
          new THREE.Vector3()


        const targetQuaternion =
          new THREE.Quaternion()


        const smoothedPosition =
          new THREE.Vector3()


        const smoothedQuaternion =
          new THREE.Quaternion()


        let hasPose =
          false


        renderer.setAnimationLoop(
          () => {

            if (stopped) {
              return
            }


            const delta =
              Math.min(
                clock.getDelta(),
                0.033
              )


            /* ========================================================
               BEFORE POSITION LOCK
               ======================================================== */

            if (
              !positionLockedRef.current
            ) {

              if (
                anchor.group.visible
              ) {

                /*
                 * Get marker position.
                 */

                anchor.group.getWorldPosition(
                  targetPosition
                )


                /*
                 * Get marker rotation.
                 */

                anchor.group.getWorldQuaternion(
                  targetQuaternion
                )


                /*
                 * First detection.
                 */

                if (!hasPose) {

                  smoothedPosition.copy(
                    targetPosition
                  )

                  smoothedQuaternion.copy(
                    targetQuaternion
                  )

                  hasPose =
                    true

                } else {

                  /*
                   * Smooth movement.
                   */

                  smoothedPosition.lerp(
                    targetPosition,
                    AR_CONFIG.positionSmoothing
                  )


                  smoothedQuaternion.slerp(
                    targetQuaternion,
                    AR_CONFIG.rotationSmoothing
                  )
                }


                /*
                 * Position AR root.
                 */

                arRoot.position.copy(
                  smoothedPosition
                )


                arRoot.quaternion.copy(
                  smoothedQuaternion
                )


                arRoot.visible =
                  true

              } else {

                /*
                 * Marker is currently lost.
                 */
                arRoot.visible =
                  false

                hasPose =
                  false
              }


            } else {

              /* ======================================================
                 AFTER POSITION LOCK

                 DO NOT READ marker position anymore.
                 ====================================================== */

              arRoot.position.copy(
                lockedPositionRef.current
              )


              arRoot.quaternion.copy(
                lockedQuaternionRef.current
              )


              /*
               * ALWAYS VISIBLE.
               */
              arRoot.visible =
                true
            }


            /* --------------------------------------------------------
               UPDATE ANIMATION
               -------------------------------------------------------- */

            if (
              mixerRef.current
            ) {

              mixerRef.current.update(
                delta
              )
            }


            /* --------------------------------------------------------
               RENDER
               -------------------------------------------------------- */

            renderer.render(
              scene,
              camera
            )
          }
        )


      } catch (error) {

        console.error(
          'MindAR error:',
          error
        )


        if (stopped) {
          return
        }


        const message =
          error?.message || ''


        if (
          message.includes(
            'targets.mind'
          ) ||
          message.includes(
            '404'
          ) ||
          message.includes(
            'fetch'
          )
        ) {

          setErrorMsg(
            'TARGETS_MIND'
          )

        } else if (
          error?.name ===
          'NotAllowedError' ||
          message.includes(
            'camera'
          ) ||
          message.includes(
            'permission'
          )
        ) {

          setErrorMsg(
            'Camera permission denied. Please allow camera access.'
          )

        } else {

          setErrorMsg(
            'AR Error: ' +
            (
              message ||
              error?.name ||
              'Unknown error'
            )
          )
        }


        setIsStarting(
          false
        )
      }
    }


    startAR()


    /* --------------------------------------------------------------
       CLEANUP
       -------------------------------------------------------------- */

    return () => {

      stopped =
        true


      try {

        if (
          mindARRef.current
        ) {

          mindARRef.current
            .renderer
            ?.setAnimationLoop(
              null
            )


          mindARRef.current.stop()
        }

      } catch {
        // Ignore cleanup errors.
      }


      mixerRef.current =
        null

      modelRef.current =
        null

      characterGroupRef.current =
        null

      mindARRef.current =
        null
    }

  }, [])


  /* ================================================================
     ERROR
     ================================================================ */

  const isTargetsMindError =
    errorMsg === 'TARGETS_MIND'


  /* ================================================================
     UI
     ================================================================ */

  return (

    <div className="fixed inset-0 z-0 bg-black">


      {/* ============================================================
          CAMERA + THREE.JS
          ============================================================ */}

      <div
        ref={containerRef}
        className="w-full h-full"
      />


      {/* ============================================================
          LOADING
          ============================================================ */}

      {isStarting &&
        !errorMsg && (

          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95">

            <div className="text-6xl mb-5">
              🐘
            </div>


            <p className="text-amber-300 font-black text-xl">
              Chhota Bheem AR
            </p>


            <p className="text-slate-400 text-sm mt-2">
              {loadingMsg}
            </p>

          </div>

        )}


      {/* ============================================================
          ERROR
          ============================================================ */}

      {errorMsg && (

        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 p-6 text-center">

          <div className="text-5xl mb-4">
            ⚠️
          </div>


          <p className="text-amber-400 font-black text-xl">
            {isTargetsMindError
              ? 'targets.mind Missing'
              : 'AR Error'}
          </p>


          <p className="text-slate-300 text-sm mt-3 max-w-md">
            {isTargetsMindError
              ? 'Place targets.mind inside public/assets/.'
              : errorMsg}
          </p>


          <button
            onClick={onExit}
            className="mt-6 px-6 py-3 rounded-xl bg-amber-400 text-black font-black"
          >
            Go Back
          </button>

        </div>

      )}


      {/* ============================================================
          OPERATOR CONTROL PANEL
          ============================================================ */}

      {!isStarting &&
        !errorMsg && (

          <div className="absolute top-4 right-4 z-40 w-[280px]">

            <div className="bg-slate-950/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">


              {/* HEADER */}

              <div className="flex items-center justify-between mb-4">

                <div>

                  <p className="text-white font-black text-sm">
                    AR Configuration
                  </p>

                  <p className="text-slate-500 text-[10px] mt-1">
                    Installation controls
                  </p>

                </div>


                <div
                  className={[
                    'w-2.5 h-2.5 rounded-full',

                    positionLocked
                      ? 'bg-emerald-400'
                      : trackingState === 'found'
                        ? 'bg-yellow-400'
                        : 'bg-slate-500',

                  ].join(' ')}
                />

              </div>


              {/* ====================================================
                  POSITION STATUS
                  ==================================================== */}

              <div className="mb-4 p-3 rounded-xl bg-slate-900 border border-white/5">

                <p className="text-slate-500 text-[10px] uppercase tracking-wider">
                  Position
                </p>


                <p className="text-sm font-black mt-1">

                  {positionLocked

                    ? (
                      <span className="text-emerald-400">
                        ● LOCKED
                      </span>
                    )

                    : trackingState === 'found'

                      ? (
                        <span className="text-yellow-400">
                          ● MARKER FOUND
                        </span>
                      )

                      : trackingState === 'lost'

                        ? (
                          <span className="text-red-400">
                            ● MARKER LOST
                          </span>
                        )

                        : (
                          <span className="text-slate-400">
                            ● SEARCHING
                          </span>
                        )}

                </p>

              </div>


              {/* ====================================================
                  FIX POSITION
                  ==================================================== */}

              {!positionLocked ? (

                <button
                  onClick={lockPosition}
                  disabled={
                    trackingState !== 'found'
                  }
                  className={[
                    'w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 mb-4 transition',

                    trackingState === 'found'

                      ? 'bg-emerald-500 text-black hover:bg-emerald-400'

                      : 'bg-slate-800 text-slate-600 cursor-not-allowed',

                  ].join(' ')}
                >

                  <Lock className="w-4 h-4" />

                  FIX POSITION

                </button>

              ) : (

                <button
                  onClick={unlockPosition}
                  className="w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 mb-4 bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30"
                >

                  <Unlock className="w-4 h-4" />

                  UNLOCK POSITION

                </button>

              )}


              {/* ====================================================
                  CHARACTER SIZE
                  ==================================================== */}

              <div className="border-t border-white/10 pt-4">

                <div className="flex items-center justify-between mb-2">

                  <p className="text-slate-400 text-xs font-bold">
                    Character Height
                  </p>

                  <p className="text-amber-300 font-black text-sm">
                    {characterHeight.toFixed(2)} m
                  </p>

                </div>


                <div className="flex items-center gap-2">

                  <button
                    onClick={() =>
                      updateCharacterSize(
                        characterHeight -
                        AR_CONFIG.sizeStepMeters
                      )
                    }
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white"
                  >

                    <Minus className="w-4 h-4" />

                  </button>


                  <div className="flex-1 text-center bg-slate-900 rounded-xl py-2 text-white font-black">
                    {characterHeight.toFixed(2)}m
                  </div>


                  <button
                    onClick={() =>
                      updateCharacterSize(
                        characterHeight +
                        AR_CONFIG.sizeStepMeters
                      )
                    }
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white"
                  >

                    <Plus className="w-4 h-4" />

                  </button>

                </div>

              </div>


              {/* ====================================================
                  ROTATION
                  ==================================================== */}

              <div className="border-t border-white/10 mt-4 pt-4">

                <p className="text-slate-400 text-xs font-bold mb-2">
                  Character Rotation
                </p>


                <div className="flex items-center gap-2">

                  <button
                    onClick={() =>
                      updateRotation(
                        rotationDegrees - 15
                      )
                    }
                    className="flex-1 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white"
                  >

                    <RotateCcw className="w-4 h-4" />

                  </button>


                  <div className="flex-1 text-center bg-slate-900 rounded-xl py-2 text-white font-black text-xs">
                    {rotationDegrees}°
                  </div>


                  <button
                    onClick={() =>
                      updateRotation(
                        rotationDegrees + 15
                      )
                    }
                    className="flex-1 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white"
                  >

                    <RotateCw className="w-4 h-4" />

                  </button>

                </div>

              </div>


              {/* ====================================================
                  EXIT
                  ==================================================== */}

              <button
                onClick={onExit}
                className="w-full mt-4 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold hover:bg-slate-700"
              >
                EXIT AR
              </button>

            </div>

          </div>

        )}


      {/* ============================================================
          INSTRUCTIONS
          ============================================================ */}

      {!isStarting &&
        !errorMsg &&
        !positionLocked && (

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">

            <div className="bg-slate-950/90 backdrop-blur-xl border border-amber-400/30 rounded-2xl px-6 py-4 text-center">

              {trackingState === 'found' ? (

                <>

                  <p className="text-emerald-300 font-black">
                    ✓ Marker detected
                  </p>

                  <p className="text-slate-400 text-xs mt-1">
                    Press "FIX POSITION" to lock the AR here.
                  </p>

                </>

              ) : (

                <>

                  <p className="text-amber-300 font-black">
                    Point camera at the floor marker
                  </p>

                  <p className="text-slate-500 text-xs mt-1">
                    Waiting for marker detection...
                  </p>

                </>

              )}

            </div>

          </div>

        )}


      {/* ============================================================
          LOCKED MESSAGE
          ============================================================ */}

      {!isStarting &&
        !errorMsg &&
        positionLocked && (

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">

            <div className="bg-emerald-950/90 backdrop-blur-xl border border-emerald-400/40 rounded-2xl px-6 py-4 text-center">

              <p className="text-emerald-300 font-black">
                🔒 AR POSITION LOCKED
              </p>

              <p className="text-slate-400 text-xs mt-1">
                Character will remain fixed at this location.
              </p>

            </div>

          </div>

        )}

    </div>
  )
}

