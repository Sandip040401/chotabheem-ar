import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Instanced Particle Burst System for hand interaction effects
export default function HandParticleBurst({ particlesRef, color }) {
  const meshRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    if (!meshRef.current) return

    particlesRef.current.forEach((p, idx) => {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.scale = THREE.MathUtils.lerp(p.scale, 0, 0.1)

      dummy.position.set(p.x, p.y, p.z)
      dummy.scale.setScalar(p.scale)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(idx, dummy.matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[null, null, 30]}>
      <dodecahedronGeometry args={[0.05]} />
      <meshStandardMaterial color={color} emissive={color} roughness={0.1} />
    </instancedMesh>
  )
}
