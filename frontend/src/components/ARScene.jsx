import { Suspense, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Center } from '@react-three/drei'
import * as THREE from 'three'

import WickerBasket from './ar/models/WickerBasket.jsx'
import DiamondRing from './ar/models/DiamondRing.jsx'
import MysticCrystal from './ar/models/MysticCrystal.jsx'
import NinjaKatana from './ar/models/NinjaKatana.jsx'

import FloatingApples from './ar/games/FloatingApples.jsx'
import NinjaApples from './ar/games/NinjaApples.jsx'
import { GroundSpotMarker, SpotAppleShower, GroundSpotDetector } from './ar/games/SpotShowerMode.jsx'
import ElephantAR from './ar/models/ElephantAR.jsx'
import BirdAR from './ar/models/BirdAR.jsx'

import HandParticleBurst from './ar/effects/HandParticleBurst.jsx'

// ─────────────────────────────────────────────────────────────
// Camera manager — tilts camera downward in elephant / bird floor mode
// ─────────────────────────────────────────────────────────────
function CameraManager({ assetId }) {
  const { camera } = useThree()
  useEffect(() => {
    if (assetId === 'elephant') {
      camera.position.set(0, 1.8, 5)
      camera.fov = 55
    } else if (assetId === 'bird') {
      camera.position.set(0, 1.9, 5.2)
      camera.fov = 55
    } else {
      camera.position.set(0, 0, 4)
      camera.fov = 45
    }
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [assetId, camera])
  return null
}

// ─────────────────────────────────────────────────────────────
// Invisible floor plane — catches pointer events for click-and-drag floor placement
// ─────────────────────────────────────────────────────────────
function FloorPickerPlane({ isConfiguringSpot, spotPosRef, onUpdateSpotConfig }) {
  if (!isConfiguringSpot) return null

  const updatePos = (e) => {
    if (!spotPosRef?.current) return
    spotPosRef.current.x = e.point.x
    spotPosRef.current.z = e.point.z
  }

  const handlePointerDown = (e) => {
    e.stopPropagation()
    updatePos(e)
  }
  const handlePointerMove = (e) => {
    if (!e.buttons) return
    e.stopPropagation()
    updatePos(e)
  }
  const handlePointerUp = (e) => {
    e.stopPropagation()
    updatePos(e)
    onUpdateSpotConfig?.({
      ...spotPosRef.current,
      x: e.point.x,
      z: e.point.z,
    })
  }

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.01, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <planeGeometry args={[30, 30]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────
// Flat floor spot marker (for elephant XZ floor mode)
// ─────────────────────────────────────────────────────────────
function FloorSpotMarker({ spotPosRef, isConfiguringSpot, isTriggered }) {
  if (!isConfiguringSpot) return null

  const groupRef  = useRef()
  const ringRef   = useRef()
  const waveRef   = useRef()

  useFrame((state, delta) => {
    if (groupRef.current && spotPosRef?.current) {
      groupRef.current.position.x = spotPosRef.current.x || 0
      groupRef.current.position.z = spotPosRef.current.z || 0
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (isTriggered ? 2.2 : 0.55)
    }
    if (waveRef.current && isTriggered) {
      const t = (state.clock.getElapsedTime() * 1.5) % 1
      waveRef.current.scale.setScalar(1 + t * 0.6)
      waveRef.current.material.opacity = (1 - t) * 0.4
    }
  })

  const spotRadius = spotPosRef?.current?.radius ?? 0.7
  const color    = isTriggered ? '#00ff88' : isConfiguringSpot ? '#ffea00' : '#00e5ff'
  const emissive = isTriggered ? '#00cc55' : isConfiguringSpot ? '#ffab00' : '#0099cc'
  const ei       = isTriggered ? 2.2 : isConfiguringSpot ? 1.4 : 0.8
  const opacity  = isTriggered ? 0.82 : isConfiguringSpot ? 0.9 : 0.4

  return (
    <group ref={groupRef} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Outer ring (spinning) */}
      <mesh ref={ringRef}>
        <ringGeometry args={[spotRadius * 0.75, spotRadius, 48]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={ei}
          transparent opacity={opacity} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner fill */}
      <mesh>
        <ringGeometry args={[0, spotRadius * 0.18, 24]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.9} />
      </mesh>
      {/* Trigger pulse wave */}
      {isTriggered && (
        <mesh ref={waveRef}>
          <ringGeometry args={[spotRadius * 0.6, spotRadius * 0.8, 32]} />
          <meshBasicMaterial color="#ffeb3b" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// Standard hand / pointer anchor rig (non-ground modes)
// ─────────────────────────────────────────────────────────────
function AnchorRig({ asset, transform, handResults, basketPosRef, swordPosRef, swordRotRef, swordBounceScale, score }) {
  const group = useRef()
  const { viewport } = useThree()

  useFrame((state) => {
    if (!group.current) return

    const t = transform.current
    let targetX = t.x
    let targetY = t.y
    let targetZ = 0
    let targetRotY = t.rotY
    let targetRotX = t.rotX

    const hasHand = handResults?.multiHandLandmarks && handResults.multiHandLandmarks.length > 0

    if (hasHand) {
      const landmarks = handResults.multiHandLandmarks[0]

      if (asset.style === 'palm') {
        const palmX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4
        const palmY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4
        targetX = (palmX - 0.5) * viewport.width
        targetY = -(palmY - 0.5) * viewport.height
      } else if (asset.style === 'finger') {
        const fingerX = landmarks[14]?.x || landmarks[8].x
        const fingerY = landmarks[14]?.y || landmarks[8].y
        targetX = (fingerX - 0.5) * viewport.width
        targetY = -(fingerY - 0.5) * viewport.height
      } else if (asset.style === 'grip') {
        const wrist = landmarks[0]
        const middleBase = landmarks[9]
        targetX = (middleBase.x - 0.5) * viewport.width
        targetY = -(middleBase.y - 0.5) * viewport.height
        const dx = (middleBase.x - wrist.x) * viewport.width
        const dy = -(middleBase.y - wrist.y) * viewport.height
        targetRotY = Math.atan2(dy, dx)
      } else {
        const indexX = landmarks[8].x
        const indexY = landmarks[8].y
        targetX = (indexX - 0.5) * viewport.width
        targetY = -(indexY - 0.5) * viewport.height
      }
    } else {
      if (asset.style !== 'ground_spot') {
        targetX = state.pointer.x * (viewport.width / 2)
        targetY = state.pointer.y * (viewport.height / 2)
      }
    }

    group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, targetX, 0.35)
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, targetY, 0.35)
    group.current.position.z = THREE.MathUtils.lerp(group.current.position.z, targetZ, 0.35)
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, targetRotY, 0.35)
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, targetRotX, 0.35)

    if (basketPosRef) {
      basketPosRef.current = { x: group.current.position.x, y: group.current.position.y }
    }
    if (swordPosRef) {
      swordPosRef.current = { x: group.current.position.x, y: group.current.position.y }
      swordRotRef.current = { rotY: group.current.rotation.y }
    }
  })

  if (asset?.id === 'spot_shower' || asset?.id === 'elephant' || asset?.id === 'bird') return null

  return (
    <group ref={group}>
      <Center>
        {asset.id === 'apple'   && <WickerBasket bounceScale={swordBounceScale} score={score} />}
        {asset.id === 'ninja'   && <NinjaKatana swordBounceScale={swordBounceScale} />}
        {asset.id === 'ring'    && <DiamondRing />}
        {asset.id === 'crystal' && <MysticCrystal />}
      </Center>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// Main AR Scene
// ─────────────────────────────────────────────────────────────
export default function ARScene({
  asset,
  resetSignal,
  handResults,
  onScore,
  score,
  spotConfig,
  onUpdateSpotConfig,
  isConfiguringSpot,
  onSpotTriggerChange,
  isSpotTriggered,
  videoRef,
  maxDpr = 1.25,
  enableParticles = true,
}) {
  const transform     = useRef({ rotY: 0, rotX: 0, scale: asset?.baseScale || 1, x: 0, y: 0 })
  const gesture       = useRef({ mode: null, lastX: 0, lastY: 0, lastDist: 0 })
  const containerRef  = useRef(null)
  const [, forceRender] = useState(0)
  const isFloorMode   = asset?.id === 'elephant' || asset?.id === 'bird'

  const spotPosRef = useRef({
    x: spotConfig?.x || 0,
    y: spotConfig?.y ?? -0.6,
    radius: spotConfig?.radius || 0.7,
  })

  useEffect(() => {
    if (spotConfig) spotPosRef.current = { ...spotConfig }
  }, [spotConfig])

  const basketPosRef    = useRef(null)
  const swordPosRef     = useRef(null)
  const swordRotRef     = useRef(null)
  const swordBounceScale = useRef(1.0)
  const [particleColor, setParticleColor] = useState('#00ffcc')

  const particlesRef = useRef(
    Array.from({ length: 30 }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, scale: 0 }))
  )
  const particleIdxRef = useRef(0)

  const handleCollectEffect = (x, y, color = '#00ffcc') => {
    swordBounceScale.current = 1.35
    setParticleColor(color)
    if (!enableParticles) return
    const numBurst = 8
    for (let i = 0; i < numBurst; i++) {
      const idx   = (particleIdxRef.current + i) % 30
      const angle = (i / numBurst) * Math.PI * 2 + Math.random() * 0.5
      const speed = 1.5 + Math.random() * 2.0
      particlesRef.current[idx] = {
        x, y, z: 0.1,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 0.4,
        scale: 0.12 + Math.random() * 0.08,
      }
    }
    particleIdxRef.current = (particleIdxRef.current + numBurst) % 30
  }

  useEffect(() => { transform.current.scale = asset?.baseScale || 1 }, [asset])

  const reset = () => {
    transform.current = { rotY: 0, rotX: 0, scale: asset?.baseScale || 1, x: 0, y: 0 }
    forceRender((n) => n + 1)
  }
  useEffect(() => { if (resetSignal) reset() }, [resetSignal])

  // ── Standard mode drag (non-floor) ───────────────────────────
  const updateSpotFromPointer = (clientX, clientY, commitToState = false) => {
    if (!isConfiguringSpot || !containerRef.current || isFloorMode) return
    const rect = containerRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const relX   = (clientX - rect.left)  / rect.width
    const relY   = (clientY - rect.top)   / rect.height
    const aspect = rect.width / rect.height
    const vpH    = 2 * Math.tan((45 * Math.PI / 180) / 2) * 4   // ≈ 3.314
    const vpW    = vpH * aspect
    const newX   = (relX - 0.5) * vpW
    const newY   = -(relY - 0.5) * vpH
    spotPosRef.current.x = newX
    spotPosRef.current.y = newY
    if (commitToState && onUpdateSpotConfig) onUpdateSpotConfig({ ...spotPosRef.current })
  }

  const onPointerDown = (e) => {
    if (isFloorMode) return   // floor mode uses 3D plane events
    if (isConfiguringSpot) {
      gesture.current.mode  = 'dragSpot'
      gesture.current.lastX = e.clientX
      gesture.current.lastY = e.clientY
      updateSpotFromPointer(e.clientX, e.clientY, false)
      return
    }
    const hasHand = handResults?.multiHandLandmarks && handResults.multiHandLandmarks.length > 0
    if (hasHand) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesture.current.mode  = 'rotate'
    gesture.current.lastX = e.clientX
    gesture.current.lastY = e.clientY
  }

  const onPointerMove = (e) => {
    if (isFloorMode) return
    if (gesture.current.mode === 'dragSpot' && isConfiguringSpot) {
      gesture.current.lastX = e.clientX
      gesture.current.lastY = e.clientY
      updateSpotFromPointer(e.clientX, e.clientY, false)
      return
    }
    if (gesture.current.mode !== 'rotate') return
    const dx = e.clientX - gesture.current.lastX
    const dy = e.clientY - gesture.current.lastY
    gesture.current.lastX = e.clientX
    gesture.current.lastY = e.clientY
    transform.current.rotY += dx * 0.01
    transform.current.rotX = Math.max(-0.6, Math.min(0.6, transform.current.rotX + dy * 0.01))
  }

  const onPointerUp = (e) => {
    if (isFloorMode) return
    if (gesture.current.mode === 'dragSpot' && isConfiguringSpot) {
      updateSpotFromPointer(e?.clientX ?? gesture.current.lastX, e?.clientY ?? gesture.current.lastY, true)
    }
    gesture.current.mode = null
  }

  return (
    <div
      ref={containerRef}
      className="ar-scene"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Canvas
        dpr={[1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr || 1.25)]}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          precision: 'mediump',
          stencil: false,
          depth: true,
          failIfMajorPerformanceCaveat: false,
        }}
        shadows={isFloorMode}
        camera={{ position: [0, 0, 4], fov: 45 }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        {/* Switch camera perspective based on mode */}
        <CameraManager assetId={asset?.id} />

        {/* Lighting */}
        <ambientLight intensity={0.9} />
        <hemisphereLight args={[0xffffff, 0x444444, 0.6]} />
        {isFloorMode
          ? <directionalLight position={[3, 8, 4]} intensity={1.2} castShadow
              shadow-mapSize={[1024, 1024]}
              shadow-camera-near={0.1}
              shadow-camera-far={30}
              shadow-camera-left={-5}
              shadow-camera-right={5}
              shadow-camera-top={5}
              shadow-camera-bottom={-5}
            />
          : <>
              <directionalLight position={[3, 4, 5]}  intensity={1.1} />
              <directionalLight position={[-4, -2, -3]} intensity={0.35} />
            </>
        }

        {/* Ground Spot (apple shower mode) */}
        {asset.id === 'spot_shower' && (
          <Suspense fallback={null}>
            <GroundSpotMarker
              spotPosRef={spotPosRef}
              isConfiguringSpot={isConfiguringSpot}
              isTriggered={isSpotTriggered}
            />
            <SpotAppleShower
              spotPosRef={spotPosRef}
              isTriggered={isSpotTriggered}
              onScore={onScore}
              onCollectEffect={handleCollectEffect}
            />
            <GroundSpotDetector
              spotPosRef={spotPosRef}
              handResults={handResults}
              isConfiguringSpot={isConfiguringSpot}
              onSpotTriggerChange={onSpotTriggerChange}
              asset={asset}
              videoRef={videoRef}
            />
          </Suspense>
        )}

        {/* Elephant Floor AR mode */}
        {asset.id === 'elephant' && (
          <Suspense fallback={null}>
            {/* Flat floor spot marker (XZ plane) */}
            <FloorSpotMarker
              spotPosRef={spotPosRef}
              isConfiguringSpot={isConfiguringSpot}
              isTriggered={isSpotTriggered}
            />
            {/* Elephant model on XZ floor */}
            <ElephantAR
              spotPosRef={spotPosRef}
              isTriggered={isSpotTriggered}
              isConfiguringSpot={isConfiguringSpot}
            />
            {/* Invisible floor plane for tap-to-place in config mode */}
            <FloorPickerPlane
              isConfiguringSpot={isConfiguringSpot}
              spotPosRef={spotPosRef}
              onUpdateSpotConfig={onUpdateSpotConfig}
            />
            {/* Trigger zone detector */}
            <GroundSpotDetector
              spotPosRef={spotPosRef}
              handResults={handResults}
              isConfiguringSpot={isConfiguringSpot}
              onSpotTriggerChange={onSpotTriggerChange}
              asset={asset}
              videoRef={videoRef}
            />
          </Suspense>
        )}

        {/* Flamingo Bird AR mode */}
        {asset.id === 'bird' && (
          <Suspense fallback={null}>
            {/* Flat floor spot marker (XZ plane) */}
            <FloorSpotMarker
              spotPosRef={spotPosRef}
              isConfiguringSpot={isConfiguringSpot}
              isTriggered={isSpotTriggered}
            />
            {/* Flamingo Bird model in 3D flight */}
            <BirdAR
              spotPosRef={spotPosRef}
              isTriggered={isSpotTriggered}
              isConfiguringSpot={isConfiguringSpot}
            />
            {/* Invisible floor plane for tap-to-place in config mode */}
            <FloorPickerPlane
              isConfiguringSpot={isConfiguringSpot}
              spotPosRef={spotPosRef}
              onUpdateSpotConfig={onUpdateSpotConfig}
            />
            {/* Trigger zone detector */}
            <GroundSpotDetector
              spotPosRef={spotPosRef}
              handResults={handResults}
              isConfiguringSpot={isConfiguringSpot}
              onSpotTriggerChange={onSpotTriggerChange}
              asset={asset}
              videoRef={videoRef}
            />
          </Suspense>
        )}

        {/* Apple catcher game */}
        {asset.id === 'apple' && (
          <Suspense fallback={null}>
            <FloatingApples
              basketPosRef={basketPosRef}
              onScore={onScore}
              onCollectEffect={handleCollectEffect}
            />
          </Suspense>
        )}

        {/* Fruit ninja game */}
        {asset.id === 'ninja' && (
          <Suspense fallback={null}>
            <NinjaApples
              swordPosRef={swordPosRef}
              swordRotRef={swordRotRef}
              onScore={onScore}
              onCollectEffect={handleCollectEffect}
            />
          </Suspense>
        )}

        <AnchorRig
          asset={asset}
          transform={transform}
          handResults={handResults}
          basketPosRef={basketPosRef}
          swordPosRef={swordPosRef}
          swordRotRef={swordRotRef}
          swordBounceScale={swordBounceScale}
          score={score}
        />

        {enableParticles && <HandParticleBurst particlesRef={particlesRef} color={particleColor} />}
      </Canvas>
    </div>
  )
}
