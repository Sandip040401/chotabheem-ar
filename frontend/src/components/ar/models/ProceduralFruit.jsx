import * as THREE from 'three'

export const FRUIT_TYPES = [
  { name: 'apple', color: '#ff1744', innerColor: '#fffde7', size: 0.12 },
  { name: 'orange', color: '#ff9100', innerColor: '#ffe082', size: 0.12 },
  { name: 'watermelon', color: '#2e7d32', innerColor: '#ff5252', size: 0.15 },
  { name: 'banana', color: '#ffea00', innerColor: '#fffde7', size: 0.16 },
]

export function ProceduralFruit({ type, size }) {
  if (type === 'orange') {
    return (
      <mesh castShadow>
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial color="#ff9100" roughness={0.3} />
      </mesh>
    )
  }
  if (type === 'watermelon') {
    return (
      <mesh castShadow scale={[1.2, 0.95, 0.95]}>
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial color="#2e7d32" roughness={0.4} />
      </mesh>
    )
  }
  if (type === 'banana') {
    return (
      <group rotation={[0, 0, Math.PI / 6]}>
        <mesh castShadow>
          <torusGeometry args={[size * 1.2, 0.04, 12, 24, Math.PI / 1.5]} />
          <meshStandardMaterial color="#ffea00" roughness={0.3} />
        </mesh>
      </group>
    )
  }
  // Default Apple
  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial color="#ff1744" roughness={0.25} />
      </mesh>
      <mesh position={[0, size * 0.9, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.05, 8]} />
        <meshStandardMaterial color="#4e342e" />
      </mesh>
      <mesh position={[0.02, size * 0.95, 0]} rotation={[0, 0, -Math.PI / 4]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#76ff03" />
      </mesh>
    </group>
  )
}

export function HalfFruit({ color, innerColor, isLeft, size }) {
  const rotZ = isLeft ? Math.PI / 6 : -Math.PI / 6
  return (
    <group rotation={[0, 0, rotZ]}>
      <mesh castShadow>
        <sphereGeometry args={[size, 24, 24, 0, Math.PI]} />
        <meshStandardMaterial color={color} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <circleGeometry args={[size * 0.98, 24]} />
        <meshStandardMaterial color={innerColor} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export function HalfBanana({ isLeft, size }) {
  const rotZ = isLeft ? Math.PI / 4 : -Math.PI / 4
  return (
    <group rotation={[0, 0, rotZ]}>
      <mesh castShadow>
        <torusGeometry args={[size * 1.2, 0.04, 12, 12, Math.PI / 3]} />
        <meshStandardMaterial color="#ffea00" roughness={0.3} />
      </mesh>
    </group>
  )
}
