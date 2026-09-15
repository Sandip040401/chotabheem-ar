import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Procedural Wicker Basket Model with 6 fixed 3D apples
export default function WickerBasket({ bounceScale }) {
  const groupRef = useRef()
  const { scene } = useGLTF('assets/apple.glb')

  const struts = useMemo(() => {
    const arr = []
    const count = 16
    const radius = 0.34
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      arr.push({ x, z, angle })
    }
    return arr
  }, [])

  // Memoize cloned scenes once when GLTF loads to prevent per-render cloning memory leak
  const clonedApples = useMemo(() => {
    const rawApples = [
      { id: 0, x: -0.1, y: -0.18, z: -0.07, rotX: 0.2, rotY: 0.5, scale: 0.19 },
      { id: 1, x: 0.1, y: -0.18, z: -0.07, rotX: -0.2, rotY: 1.2, scale: 0.19 },
      { id: 2, x: 0.0, y: -0.18, z: 0.1, rotX: 0.3, rotY: 2.1, scale: 0.20 },
      { id: 3, x: -0.09, y: -0.11, z: 0.03, rotX: -0.1, rotY: 0.8, scale: 0.18 },
      { id: 4, x: 0.09, y: -0.11, z: 0.03, rotX: 0.4, rotY: 2.7, scale: 0.18 },
      { id: 5, x: 0.0, y: -0.04, z: -0.01, rotX: 0.1, rotY: 1.6, scale: 0.21 },
    ]
    return rawApples.map((apple) => ({
      ...apple,
      clonedScene: scene.clone(true),
    }))
  }, [scene])

  useFrame(() => {
    if (!groupRef.current) return
    const scale = THREE.MathUtils.lerp(groupRef.current.scale.x, bounceScale.current, 0.25)
    groupRef.current.scale.set(scale, scale, scale)
    bounceScale.current = THREE.MathUtils.lerp(bounceScale.current, 1.0, 0.12)
  })

  return (
    <group ref={groupRef} position={[0, 0.1, 0]}>
      <mesh castShadow>
        <torusGeometry args={[0.35, 0.038, 12, 48]} />
        <meshStandardMaterial color="#5c3818" roughness={0.9} metalness={0.15} />
      </mesh>
      <mesh castShadow position={[0, -0.15, 0]}>
        <torusGeometry args={[0.29, 0.02, 8, 32]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, -0.3, 0]}>
        <torusGeometry args={[0.24, 0.025, 8, 32]} />
        <meshStandardMaterial color="#5c3818" roughness={0.9} />
      </mesh>
      {struts.map((strut, idx) => {
        const color = idx % 2 === 0 ? '#cd853f' : '#a0522d'
        return (
          <mesh
            key={idx}
            position={[strut.x * 0.9, -0.15, strut.z * 0.9]}
            rotation={[0.15, -strut.angle, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.015, 0.012, 0.32, 6]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
        )
      })}
      <mesh position={[0, -0.15, 0]}>
        <cylinderGeometry args={[0.33, 0.23, 0.29, 24, 1, true]} />
        <meshStandardMaterial
          color="#d2b48c"
          roughness={0.95}
          metalness={0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.02, 24]} />
        <meshStandardMaterial color="#5c3818" roughness={0.95} />
      </mesh>
      <group rotation={[0, 0, Math.PI / 2]}>
        <mesh>
          <torusGeometry args={[0.36, 0.022, 8, 48, Math.PI]} />
          <meshStandardMaterial color="#cd853f" roughness={0.9} />
        </mesh>
        <mesh rotation={[0, 0, 0.3]}>
          <torusGeometry args={[0.36, 0.024, 6, 24, Math.PI]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
        </mesh>
      </group>

      {/* Render the 6 fixed apples inside the shopkeeper basket */}
      {clonedApples.map((apple) => (
        <group
          key={apple.id}
          position={[apple.x, apple.y, apple.z]}
          rotation={[apple.rotX, apple.rotY, 0]}
          scale={apple.scale}
        >
          <primitive object={apple.clonedScene} />
        </group>
      ))}
    </group>
  )
}
