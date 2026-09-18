import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Butter-Smooth 60 FPS 3D Ground Spot Marker
export function GroundSpotMarker({ spotPosRef, isConfiguringSpot, isTriggered }) {
  if (!isConfiguringSpot) return null

  const groupRef = useRef()
  const meshRef = useRef()
  const ringRef = useRef()
  const waveRef = useRef()
  const { viewport } = useThree()

  // Pre-created geometries to prevent GC memory churn
  const baseRadius = 0.7
  const outerGeom = useMemo(() => new THREE.RingGeometry(baseRadius * 0.1, baseRadius * 1.15, 32), [])
  const ringGeom = useMemo(() => new THREE.RingGeometry(baseRadius * 0.82, baseRadius, 48), [])
  const dashGeom = useMemo(() => new THREE.RingGeometry(baseRadius * 0.48, baseRadius * 0.54, 32), [])
  const centerGeom = useMemo(() => new THREE.CircleGeometry(baseRadius * 0.16, 24), [])
  const beamGeom = useMemo(() => new THREE.CylinderGeometry(baseRadius * 0.8, baseRadius * 0.9, 1.4, 32, 1, true), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.033)
    const time = state.clock.getElapsedTime()

    if (groupRef.current && spotPosRef?.current) {
      const pos = spotPosRef.current
      // Direct ref position sync
      groupRef.current.position.x = pos.x
      groupRef.current.position.y = pos.y
      // Smooth scale scaling according to spot radius setting
      const radiusScale = (pos.radius || 0.7) / baseRadius
      groupRef.current.scale.set(radiusScale, radiusScale, radiusScale)
    }

    if (ringRef.current) {
      const rotSpeed = isTriggered ? 2.5 : 0.8
      ringRef.current.rotation.z += dt * rotSpeed
    }

    if (meshRef.current) {
      const pulse = isTriggered 
        ? 1.0 + Math.sin(time * 10) * 0.06
        : 1.0 + Math.sin(time * 2.5) * 0.03
      meshRef.current.scale.setScalar(pulse)
    }

    if (waveRef.current && isTriggered) {
      const waveScale = 1.0 + ((time * 2) % 1) * 0.5
      waveRef.current.scale.setScalar(waveScale)
      waveRef.current.material.opacity = (1 - ((time * 2) % 1)) * 0.5
    }
  })

  return (
    <group ref={groupRef} position={[0, -0.6, 0.01]} rotation={[-Math.PI / 2.3, 0, 0]}>
      {/* 3D Floor Grid Helper lines */}
      <mesh geometry={outerGeom} position={[0, 0, -0.01]}>
        <meshBasicMaterial color={isTriggered ? '#ffeb3b' : '#00e5ff'} wireframe transparent opacity={0.25} />
      </mesh>

      {/* Base ground ring flat on floor plane */}
      <mesh ref={meshRef} geometry={ringGeom}>
        <meshStandardMaterial
          color={isConfiguringSpot ? '#ffea00' : isTriggered ? '#00e676' : '#00e5ff'}
          emissive={isConfiguringSpot ? '#ffab00' : isTriggered ? '#00c853' : '#00b0ff'}
          emissiveIntensity={isTriggered ? 2.0 : isConfiguringSpot ? 1.4 : 0.8}
          side={THREE.DoubleSide}
          transparent
          opacity={0.88}
        />
      </mesh>

      {/* Outer expanding energy wave when triggered */}
      {isTriggered && (
        <mesh ref={waveRef} geometry={ringGeom} position={[0, 0, 0.005]}>
          <meshBasicMaterial color="#ffeb3b" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Inner tech pattern */}
      <group ref={ringRef}>
        <mesh geometry={dashGeom}>
          <meshStandardMaterial
            color={isTriggered ? '#ffff00' : '#ffffff'}
            emissive={isTriggered ? '#ffd700' : '#80d8ff'}
            emissiveIntensity={0.9}
            wireframe
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Center target indicator */}
      <mesh geometry={centerGeom} position={[0, 0, 0.02]}>
        <meshStandardMaterial
          color={isConfiguringSpot ? '#ff1744' : isTriggered ? '#ffeb3b' : '#00e5ff'}
          emissive={isConfiguringSpot ? '#ff1744' : isTriggered ? '#ff9800' : '#00e5ff'}
          emissiveIntensity={1.4}
        />
      </mesh>

      {/* Vertical light beam when triggered */}
      {isTriggered && (
        <mesh geometry={beamGeom} position={[0, viewport.height * 0.4, 0]} rotation={[Math.PI / 2.3, 0, 0]}>
          <meshStandardMaterial
            color="#ffeb3b"
            emissive="#ff9800"
            emissiveIntensity={0.8}
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}

// Optimized 3D Apple Shower Manager (Paced 2-3 apples every 1-2 sec)
export function SpotAppleShower({ spotPosRef, isTriggered, onScore, onCollectEffect }) {
  const { scene } = useGLTF('assets/apple.glb')
  const { viewport } = useThree()
  const poolCount = 8

  const clonedScenes = useMemo(() => {
    return Array.from({ length: poolCount }, () => scene.clone(true))
  }, [scene])

  const applesState = useRef(
    Array.from({ length: poolCount }, () => ({
      x: 0,
      y: 999,
      z: 0,
      vy: 0,
      vx: 0,
      rotX: Math.random() * Math.PI,
      rotY: Math.random() * Math.PI,
      rotV: (Math.random() - 0.5) * 3,
      scale: 0.28 + Math.random() * 0.08,
      active: false,
    }))
  )

  const appleRefs = useRef([])
  const spawnTimer = useRef(0)
  const nextInterval = useRef(1.2)

  const spawnBatch = () => {
    const spotX = spotPosRef?.current?.x || 0
    const spotRadius = spotPosRef?.current?.radius || 0.7
    const spread = spotRadius * 0.7

    const batchSize = Math.floor(Math.random() * 2) + 2
    let spawned = 0

    for (let i = 0; i < poolCount && spawned < batchSize; i++) {
      const apple = applesState.current[i]
      if (!apple.active) {
        apple.x = spotX + (Math.random() - 0.5) * 2 * spread
        apple.y = viewport.height / 2 + 0.3 + Math.random() * 0.4
        apple.z = (Math.random() - 0.5) * 0.15
        apple.vy = -(1.2 + Math.random() * 0.8)
        apple.vx = (Math.random() - 0.5) * 0.4
        apple.rotV = (Math.random() - 0.5) * 4
        apple.scale = 0.26 + Math.random() * 0.08
        apple.active = true
        spawned++
      }
    }
  }

  useEffect(() => {
    if (isTriggered) {
      spawnTimer.current = 0
      nextInterval.current = 0.15
      applesState.current.forEach((apple) => {
        apple.active = false
        apple.y = 999
      })
    } else {
      applesState.current.forEach((apple) => {
        apple.active = false
        apple.y = 999
      })
    }
  }, [isTriggered])

  useFrame((state, delta) => {
    if (!isTriggered) return
    const dt = Math.min(delta, 0.033)
    const groundY = spotPosRef?.current?.y || -0.6
    const gravity = 4.2

    spawnTimer.current += dt
    if (spawnTimer.current >= nextInterval.current) {
      spawnTimer.current = 0
      nextInterval.current = 1.0 + Math.random() * 1.0
      spawnBatch()
    }

    applesState.current.forEach((apple, idx) => {
      const groupRef = appleRefs.current[idx]
      if (!apple.active) {
        if (groupRef) groupRef.position.set(0, 999, 0)
        return
      }

      apple.vy -= gravity * dt
      apple.y += apple.vy * dt
      apple.x += apple.vx * dt
      apple.rotY += apple.rotV * dt

      if (apple.y <= groundY + 0.08) {
        apple.active = false
        apple.y = 999
        onScore?.()
        onCollectEffect?.(apple.x, groundY, '#ff1744')
      }

      if (groupRef) {
        groupRef.position.set(apple.x, apple.y, apple.z)
        groupRef.scale.setScalar(apple.scale)
        groupRef.rotation.set(apple.rotX, apple.rotY, 0)
      }
    })
  })

  if (!isTriggered) return null

  return (
    <group>
      {clonedScenes.map((cloned, idx) => (
        <group key={idx} ref={(el) => (appleRefs.current[idx] = el)}>
          <primitive object={cloned} />
        </group>
      ))}
    </group>
  )
}

export function GroundSpotDetector({
  spotPosRef,
  handResults,
  isConfiguringSpot,
  onSpotTriggerChange,
  asset,
  videoRef,
}) {
  const { viewport } = useThree()
  const prevTriggeredRef   = useRef(false)
  const videoPresenceRef   = useRef(false)
  const canvasCtxRef       = useRef(null)
  const lastFrameRef       = useRef(null)
  const baselineRef        = useRef(null)
  const consecutiveCounter = useRef(0)
  const screenPosRef       = useRef({ x: 0.5, y: 0.68 })

  // Fast 16x16 video frame sampling
  useEffect(() => {
    if (asset?.id !== 'spot_shower' && asset?.id !== 'elephant' && asset?.id !== 'bird') return

    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    canvasCtxRef.current = canvas.getContext('2d', { willReadFrequently: true })

    const interval = setInterval(() => {
      if (isConfiguringSpot) {
        videoPresenceRef.current = false
        lastMotionTimeRef.current = 0
        return
      }

      const video = videoRef?.current
      if (!video || video.readyState < 2 || !canvasCtxRef.current) return

      try {
        const spotRadius = spotPosRef?.current?.radius || 0.7

        // Use cached screen position (from useFrame)
        const normX = Math.max(0.05, Math.min(0.95, screenPosRef.current.x))
        const normY = Math.max(0.05, Math.min(0.95, screenPosRef.current.y))

        const vidW = video.videoWidth || 640
        const vidH = video.videoHeight || 480

        const cropSize = Math.max(30, Math.floor(vidW * (spotRadius / (viewport.width || 3.3)) * 1.6))
        const srcX = Math.max(0, Math.min(vidW - cropSize, Math.floor(normX * vidW - cropSize / 2)))
        const srcY = Math.max(0, Math.min(vidH - cropSize, Math.floor(normY * vidH - cropSize / 2)))

        const ctx = canvasCtxRef.current
        ctx.drawImage(video, srcX, srcY, cropSize, cropSize, 0, 0, 16, 16)
        const imgData = ctx.getImageData(0, 0, 16, 16).data

        // Initialize frame references on start
        if (!lastFrameRef.current || !baselineRef.current) {
          lastFrameRef.current = new Uint8ClampedArray(imgData)
          baselineRef.current  = new Uint8ClampedArray(imgData)
          videoPresenceRef.current = false
          return
        }

        const last = lastFrameRef.current
        const base = baselineRef.current
        const len  = imgData.length

        let motionDiff   = 0
        let baselineDiff = 0

        for (let i = 0; i < len; i += 4) {
          // Motion diff: current frame vs previous frame
          motionDiff += Math.abs(imgData[i]     - last[i])
                     +  Math.abs(imgData[i + 1] - last[i + 1])
                     +  Math.abs(imgData[i + 2] - last[i + 2])

          // Baseline diff: current frame vs empty floor baseline
          baselineDiff += Math.abs(imgData[i]     - base[i])
                        + Math.abs(imgData[i + 1] - base[i + 1])
                        + Math.abs(imgData[i + 2] - base[i + 2])

          // Adapt baseline gradually when no active trigger is holding
          if (!videoPresenceRef.current) {
            base[i]     = base[i]     * 0.95 + imgData[i]     * 0.05
            base[i + 1] = base[i + 1] * 0.95 + imgData[i + 1] * 0.05
            base[i + 2] = base[i + 2] * 0.95 + imgData[i + 2] * 0.05
          }
        }

        // Save current frame as last frame
        lastFrameRef.current.set(imgData)

        const avgMotion   = motionDiff   / (16 * 16 * 3)
        const avgBaseline = baselineDiff / (16 * 16 * 3)

        // Genuine presence threshold: camera noise is ~3-5, real human motion/presence is 12-40+
        const rawPresence = avgMotion > 10.0 || avgBaseline > 14.0

        if (rawPresence) {
          consecutiveCounter.current = Math.min(3, consecutiveCounter.current + 1)
        } else {
          consecutiveCounter.current = Math.max(0, consecutiveCounter.current - 1)
        }

        if (consecutiveCounter.current >= 2) {
          videoPresenceRef.current = true
        } else if (consecutiveCounter.current === 0) {
          videoPresenceRef.current = false
        }
      } catch (e) {
        // Fallback safely
      }
    }, 80)

    return () => clearInterval(interval)
  }, [asset?.id, isConfiguringSpot, videoRef, viewport, spotPosRef])

  useFrame((state) => {
    if (asset?.id !== 'spot_shower' && asset?.id !== 'elephant' && asset?.id !== 'bird') return

    // ── Update cached screen position of trigger zone ────────
    const spotX = spotPosRef?.current?.x || 0
    const spotZ = spotPosRef?.current?.z || 0

    if (asset?.id === 'elephant' || asset?.id === 'bird') {
      // Floor mode: project XZ world position [spotX, 0, spotZ] using camera
      const worldPt = new THREE.Vector3(spotX, 0, spotZ)
      worldPt.project(state.camera)
      screenPosRef.current.x = THREE.MathUtils.clamp((worldPt.x + 1) / 2, 0.05, 0.95)
      screenPosRef.current.y = THREE.MathUtils.clamp((1 - worldPt.y) / 2, 0.05, 0.95)
    } else {
      const spotY = spotPosRef?.current?.y ?? -0.6
      screenPosRef.current.x = (spotX / viewport.width) + 0.5
      screenPosRef.current.y = (-spotY / viewport.height) + 0.5
    }

    // ── Shared Trigger logic (Hand landmark proximity OR Video presence) ────
    let handTriggered = false

    const hasHand = handResults?.multiHandLandmarks && handResults.multiHandLandmarks.length > 0
    if (hasHand) {
      const landmarks = handResults.multiHandLandmarks[0]
      const anchorX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4
      const anchorY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4
      const targetX = (anchorX - 0.5) * viewport.width
      const targetY = -(anchorY - 0.5) * viewport.height
      const spotY   = spotPosRef?.current?.y ?? -0.6
      const spotRadius = spotPosRef?.current?.radius || 0.7
      handTriggered = Math.hypot(targetX - spotX, targetY - spotY) <= spotRadius
    }

    const isTriggered = (!isConfiguringSpot && (videoPresenceRef.current || handTriggered))

    if (isTriggered !== prevTriggeredRef.current) {
      prevTriggeredRef.current = isTriggered
      onSpotTriggerChange?.(isTriggered)
    }
  })

  return null
}
