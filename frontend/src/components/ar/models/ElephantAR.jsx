import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'

// Root bone name in the GLB — only its position track is stripped
const ROOT_BONE = 'elep_4_Root_M'

// ─────────────────────────────────────────────────────────────
// Floor Spot Ring Visual — flat circle on XZ floor plane (y≈0)
// ─────────────────────────────────────────────────────────────
function SpotCircleBoundary({ centerX, centerZ, radius, isConfiguringSpot, isActive }) {
  const circleRef = useRef()

  useFrame((state) => {
    const pulse = 1 + Math.sin(state.clock.getElapsedTime() * 2.5) * 0.08
    if (circleRef.current) circleRef.current.scale.set(pulse, pulse, pulse)
  })

  const color   = isActive ? '#00ff88' : isConfiguringSpot ? '#ffea00' : '#00e5ff'
  const opacity = isConfiguringSpot ? 0.7 : isActive ? 0.45 : 0.2

  return (
    <group position={[centerX, 0.005, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Outer boundary ring */}
      <mesh ref={circleRef}>
        <ringGeometry args={[radius * 0.96, radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner subtle glow fill */}
      <mesh>
        <circleGeometry args={[radius * 0.95, 32]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.2} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// Elephant AR — Anchored Floor Hero (Realistic, Grounded, No Sliding)
// ─────────────────────────────────────────────────────────────
export default function ElephantAR({ spotPosRef, isTriggered, isConfiguringSpot }) {
  const groupRef  = useRef()
  const shadowRef = useRef()

  const { scene, animations } = useGLTF('assets/Elephant_Turn_Walk.glb')

  // ── Strip root bone translation and rotation to prevent root-motion bugs
  const cleanedAnimations = useMemo(() => {
    if (!animations?.length) return []
    return animations.map(clip => {
      const cloned = clip.clone()
      cloned.tracks = cloned.tracks.filter(t => {
        const boneName = t.name.split('.')[0]
        const isRoot = boneName === 'elep_4_Root_M' || boneName === 'elep_4_RootPart1_M'
        if (isRoot && (t.name.endsWith('.position') || t.name.endsWith('.rotation'))) {
          return false
        }
        return true
      })
      return cloned
    })
  }, [animations])

  const { actions, names } = useAnimations(cleanedAnimations, groupRef)

  // ── Bounding box — find foot Y in model space ────────────────
  const footYRef = useRef(0)

  useEffect(() => {
    if (!scene) return
    const box = new THREE.Box3().setFromObject(scene)
    footYRef.current = box.min.y   // negative = feet below scene origin
  }, [scene])

  // ── Disable frustum culling on all meshes ────────────────────
  useEffect(() => {
    scene.traverse(child => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.frustumCulled = false
        child.castShadow    = true
      }
    })
  }, [scene])

  // ── Start animation loop at realistic speed ──────────────────
  useEffect(() => {
    if (!names?.length) return
    const action = actions[names[0]]
    if (action) {
      action.reset().fadeIn(0.4).setLoop(THREE.LoopRepeat).play()
      action.timeScale = 1.0  // Realistic natural timing
    }
  }, [actions, names])

  // ── Internal state refs ──────────────────────────────────────
  const currentScaleRef   = useRef(0)
  const currentOpacityRef = useRef(0)

  // Time-based latch: stay active MIN_ACTIVE_SEC after last detection
  const lastTriggerTimeRef = useRef(0)
  const isActiveRef        = useRef(false)
  const MIN_ACTIVE_SEC     = 6

  // ─────────────────────────────────────────────────────────────
  // FRAME LOOP — Anchor elephant to floor spot marker
  // ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.033)

    const cfg          = spotPosRef?.current ?? {}
    const centerX      = cfg.x            ?? 0
    const centerZ      = cfg.z            ?? 0
    const walkRadius   = cfg.walkRadius   ?? 1.0
    const elephantSize = cfg.elephantScale ?? 1.0

    // ── Latch ──────────────────────────────────────────────────
    if (isTriggered) {
      isActiveRef.current        = true
      lastTriggerTimeRef.current = state.clock.getElapsedTime()
    } else if (isActiveRef.current) {
      if (state.clock.getElapsedTime() - lastTriggerTimeRef.current > MIN_ACTIVE_SEC) {
        isActiveRef.current = false
      }
    }

    const isActive   = isActiveRef.current
    const shouldShow = isActive || isConfiguringSpot

    // ── Target scale fitting inside marker circle ──────────────
    const modelScale = Math.min(1.4, walkRadius * 0.48 * elephantSize)

    currentScaleRef.current   = THREE.MathUtils.lerp(currentScaleRef.current,
      shouldShow ? modelScale : 0, dt * 3.5)
    currentOpacityRef.current = THREE.MathUtils.lerp(currentOpacityRef.current,
      shouldShow ? (isConfiguringSpot ? 0.8 : 1.0) : 0, dt * 3.5)

    // ── Apply transform — anchored at floor marker position ────
    const scale = currentScaleRef.current
    if (groupRef.current) {
      groupRef.current.position.x = centerX
      groupRef.current.position.y = -footYRef.current * scale
      groupRef.current.position.z = centerZ
      groupRef.current.scale.setScalar(scale)

      scene.traverse(child => {
        if (child.isMesh && child.material) {
          child.material.transparent = true
          child.material.opacity     = currentOpacityRef.current
          child.material.needsUpdate = true
        }
      })
    }

    // Shadow follows elephant on floor
    if (shadowRef.current) {
      shadowRef.current.position.x    = centerX
      shadowRef.current.position.y    = 0.002
      shadowRef.current.position.z    = centerZ
      shadowRef.current.scale.x       = scale * 1.6
      shadowRef.current.scale.z       = scale * 0.95
      shadowRef.current.material.opacity = currentOpacityRef.current * 0.5
    }
  })

  // POST-ANIMATION OVERRIDE (priority -1 = after mixer)
  // Re-asserts position & grounding so residual bone offsets are fully locked on floor.
  useFrame(() => {
    if (!groupRef.current) return
    const cfg    = spotPosRef?.current ?? {}
    const scale  = currentScaleRef.current
    groupRef.current.position.x = cfg.x ?? 0
    groupRef.current.position.y = -footYRef.current * scale
    groupRef.current.position.z = cfg.z ?? 0
  }, -1)

  // ── Render-time bounds for marker circle visual ────────────
  const cfg        = spotPosRef?.current ?? {}
  const centerX    = cfg.x          ?? 0
  const centerZ    = cfg.z          ?? 0
  const walkRadius = cfg.walkRadius ?? 1.0

  return (
    <group>
      {/* Floor Circle Boundary ring */}
      <SpotCircleBoundary
        centerX={centerX}
        centerZ={centerZ}
        radius={walkRadius}
        isConfiguringSpot={isConfiguringSpot}
        isActive={isActiveRef.current}
      />

      {/* Soft blob shadow under elephant (on floor) */}
      <mesh
        ref={shadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, centerZ]}
        receiveShadow
      >
        <planeGeometry args={[1, 0.45]} />
        <meshBasicMaterial color="#000305" transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Shadow-catcher plane — receives elephant shadow from directional light */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, centerZ]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial transparent opacity={0.35} />
      </mesh>

      {/* 3-D Elephant model */}
      <group ref={groupRef} scale={0}>
        <primitive object={scene} />
      </group>
    </group>
  )
}

useGLTF.preload('assets/Elephant_Turn_Walk.glb')
