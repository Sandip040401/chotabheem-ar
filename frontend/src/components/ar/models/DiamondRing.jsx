import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

// Custom Diamond Ring Model
export default function DiamondRing() {
  const gemRef = useRef()

  useFrame((state) => {
    if (!gemRef.current) return
    gemRef.current.rotation.y = state.clock.getElapsedTime() * 0.8
  })

  return (
    <group>
      <mesh castShadow receiveShadow>
        <torusGeometry args={[0.22, 0.04, 16, 64]} />
        <meshStandardMaterial
          color="#ffd700"
          metalness={0.9}
          roughness={0.15}
        />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.07, 0.04, 0.08, 8]} />
        <meshStandardMaterial
          color="#ffd700"
          metalness={0.9}
          roughness={0.15}
        />
      </mesh>
      <mesh ref={gemRef} position={[0, 0.3, 0]} rotation={[0, Math.PI / 4, 0]}>
        <octahedronGeometry args={[0.09]} />
        <meshPhysicalMaterial
          color="#e0f7fa"
          emissive="#00ffff"
          emissiveIntensity={0.5}
          transmission={0.9}
          opacity={1}
          transparent
          roughness={0}
          metalness={0.1}
          clearcoat={1}
          clearcoatRoughness={0}
          ior={2.4}
          thickness={0.5}
        />
      </mesh>
    </group>
  )
}
