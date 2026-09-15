import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

// Custom Mystic Crystal Model
export default function MysticCrystal() {
  const crystalRef = useRef()

  useFrame((state) => {
    if (!crystalRef.current) return
    const time = state.clock.getElapsedTime()
    crystalRef.current.rotation.y = time * 1.5
    crystalRef.current.rotation.x = Math.sin(time) * 0.2
    crystalRef.current.position.y = Math.sin(time * 2) * 0.08
  })

  return (
    <group ref={crystalRef}>
      <mesh>
        <octahedronGeometry args={[0.3]} />
        <meshStandardMaterial
          color="#e040fb"
          wireframe
          transparent
          opacity={0.6}
        />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial
          color="#7c4dff"
          emissive="#651fff"
          roughness={0.15}
          metalness={0.85}
        />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <octahedronGeometry args={[0.08]} />
        <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" />
      </mesh>
      <mesh position={[0, -0.35, 0]}>
        <octahedronGeometry args={[0.08]} />
        <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" />
      </mesh>
    </group>
  )
}
