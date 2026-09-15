import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Custom Ninja Katana Model
export default function NinjaKatana({ swordBounceScale }) {
  const groupRef = useRef()
  const bladeRef = useRef()

  useFrame((state) => {
    if (groupRef.current) {
      const scale = THREE.MathUtils.lerp(groupRef.current.scale.x, swordBounceScale.current, 0.25)
      groupRef.current.scale.set(scale, scale, scale)
      swordBounceScale.current = THREE.MathUtils.lerp(swordBounceScale.current, 1.0, 0.12)
    }
    if (bladeRef.current) {
      bladeRef.current.material.emissiveIntensity = 0.5 + Math.sin(state.clock.getElapsedTime() * 10) * 0.3
    }
  })

  return (
    <group ref={groupRef} rotation={[0, 0, -Math.PI / 4]}>
      {/* Handle / Tsuka */}
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.022, 0.025, 0.25, 12]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>
      {/* Handle wrap details */}
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.024, 0.026, 0.23, 8]} />
        <meshStandardMaterial color="#d50000" wireframe />
      </mesh>

      {/* Guard / Tsuba */}
      <mesh position={[0, -0.22, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.015, 16]} />
        <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* Blade / Toshin */}
      <mesh ref={bladeRef} position={[0, 0.25, 0]}>
        <boxGeometry args={[0.012, 0.9, 0.045]} />
        <meshStandardMaterial
          color="#e0e0e0"
          metalness={0.95}
          roughness={0.1}
          emissive="#00e5ff"
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Blade Tip */}
      <mesh position={[0, 0.72, 0]} rotation={[0, 0, Math.PI / 4]}>
        <coneGeometry args={[0.032, 0.08, 4]} />
        <meshStandardMaterial color="#ffffff" metalness={0.95} roughness={0.1} />
      </mesh>

      {/* Energy Aura trail behind blade */}
      <mesh position={[0.015, 0.25, 0]}>
        <planeGeometry args={[0.05, 0.85]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
