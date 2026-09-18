import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────
// Bird AR — Majestic Flying Flamingo in 3D AR Space
// ─────────────────────────────────────────────────────────────
export default function BirdAR({ spotPosRef, isTriggered, isConfiguringSpot }) {
  const groupRef = useRef()

  const { scene, animations } = useGLTF('assets/Flamingo-Original.glb')
  const { actions, names } = useAnimations(animations, groupRef)

  // ── Configure meshes & materials for rich, solid opaque textures ──────────
  useEffect(() => {
    if (!scene) return
    scene.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.frustumCulled = false
        child.castShadow    = true
        child.receiveShadow = false

        if (child.material) {
          child.material.transparent = false
          child.material.opacity     = 1.0
          child.material.depthWrite  = true
          child.material.depthTest   = true
          child.material.side        = THREE.FrontSide
          child.material.roughness   = 0.55
          child.material.metalness   = 0.05

          if (child.material.map) {
            child.material.map.colorSpace = THREE.SRGBColorSpace
            child.material.map.needsUpdate = true
          }
          child.material.needsUpdate = true
        }
      }
    })
  }, [scene])

  // ── Start flapping animation loop ───────────────────────────
  useEffect(() => {
    if (!names?.length) return
    const action = actions[names[0]]
    if (action) {
      action.reset().fadeIn(0.25).setLoop(THREE.LoopRepeat).play()
      action.timeScale = 1.15
    }
  }, [actions, names])

  // ── Smooth scale on load ─────────────────────────────────────
  const currentScaleRef = useRef(0.01)

  // ─────────────────────────────────────────────────────────────
  // FRAME LOOP — Aerial Flight Patrol anchored around Ground Spot
  // ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.033)

    const cfg       = spotPosRef?.current ?? {}
    const centerX   = cfg.x            ?? 0
    const centerZ   = cfg.z            ?? 0
    const radius    = cfg.birdRadius   ?? (cfg.walkRadius ? cfg.walkRadius * 1.1 : 1.4)
    const altitude  = cfg.birdAltitude ?? 1.1
    const birdScale = cfg.birdScale    ?? 0.8
    const baseSpeed = cfg.birdSpeed    ?? 0.35

    const flySpeed = isTriggered ? baseSpeed * 1.35 : baseSpeed
    const targetScale = birdScale * 0.32

    currentScaleRef.current = THREE.MathUtils.lerp(
      currentScaleRef.current,
      targetScale,
      dt * 4.5
    )

    if (names?.length && actions[names[0]]) {
      actions[names[0]].timeScale = THREE.MathUtils.lerp(
        actions[names[0]].timeScale,
        isTriggered ? 1.55 : 1.15,
        dt * 3.0
      )
    }

    // ── Calculate Flight Dynamics ──────────────────────────────
    const elapsedTime = state.clock.getElapsedTime()
    const flightAngle = elapsedTime * (flySpeed * 2.6)

    const currentPosX = centerX + Math.cos(flightAngle) * radius
    const currentPosZ = centerZ + Math.sin(flightAngle) * radius
    const undulation  = Math.sin(elapsedTime * 3.4) * 0.08
    const currentPosY = Math.max(0.3, altitude + undulation)

    const headingAngle = -flightAngle + Math.PI / 2
    const bankRoll = -0.22 * Math.sign(flySpeed)
    const pitch = Math.cos(elapsedTime * 3.4) * 0.05

    const scale = currentScaleRef.current

    if (groupRef.current) {
      groupRef.current.position.set(currentPosX, currentPosY, currentPosZ)
      groupRef.current.rotation.set(pitch, headingAngle, bankRoll)
      groupRef.current.scale.setScalar(scale)
    }
  })

  // POST-ANIMATION OVERRIDE
  useFrame((state) => {
    if (!groupRef.current) return
    const cfg       = spotPosRef?.current ?? {}
    const centerX   = cfg.x            ?? 0
    const centerZ   = cfg.z            ?? 0
    const radius    = cfg.birdRadius   ?? (cfg.walkRadius ? cfg.walkRadius * 1.1 : 1.4)
    const altitude  = cfg.birdAltitude ?? 1.1
    const baseSpeed = cfg.birdSpeed    ?? 0.35
    const flySpeed  = isTriggered ? baseSpeed * 1.35 : baseSpeed

    const elapsedTime = state.clock.getElapsedTime()
    const flightAngle = elapsedTime * (flySpeed * 2.6)

    const currentPosX = centerX + Math.cos(flightAngle) * radius
    const currentPosZ = centerZ + Math.sin(flightAngle) * radius
    const undulation  = Math.sin(elapsedTime * 3.4) * 0.08
    const currentPosY = Math.max(0.3, altitude + undulation)
    const headingAngle = -flightAngle + Math.PI / 2
    const bankRoll = -0.22 * Math.sign(flySpeed)
    const pitch = Math.cos(elapsedTime * 3.4) * 0.05

    groupRef.current.position.set(currentPosX, currentPosY, currentPosZ)
    groupRef.current.rotation.set(pitch, headingAngle, bankRoll)
  }, -1)

  const cfg     = spotPosRef?.current ?? {}
  const centerZ = cfg.z ?? 0

  return (
    <group>
      {/* Shadow-catcher floor plane (receives Three.js directional shadows seamlessly) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, centerZ]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial transparent opacity={0.35} />
      </mesh>

      {/* 3-D Flamingo Bird Model */}
      <group ref={groupRef} scale={0.01}>
        <primitive object={scene} />
      </group>
    </group>
  )
}

useGLTF.preload('assets/Flamingo-Original.glb')
