import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Floating Apples Manager (apples hover/pop statically until caught and flow into basket)
export default function FloatingApples({ basketPosRef, onScore, onCollectEffect }) {
  const { scene } = useGLTF('assets/apple.glb')
  const { viewport } = useThree()
  const applesCount = 5
  
  const clonedScenes = useMemo(() => {
    return Array.from({ length: applesCount }, () => scene.clone(true))
  }, [scene])

  const applesState = useRef(
    Array.from({ length: applesCount }, () => ({
      x: 0,
      y: 0,
      baseY: 0,
      bobOffset: Math.random() * Math.PI * 2,
      size: 0.28,
      isFallingIn: false,
      fallTargetX: 0,
      fallTargetY: 0,
      fallX: 0,
      fallY: 0,
      fallProgress: 0
    }))
  )

  const appleRefs = useRef([])

  const spawnApple = (apple) => {
    let attempts = 0
    let valid = false
    let testX = 0
    let testBaseY = 0
    
    while (!valid && attempts < 25) {
      testX = (Math.random() - 0.5) * viewport.width * 0.75
      testBaseY = (Math.random() - 0.5) * viewport.height * 0.4
      
      valid = true
      for (const other of applesState.current) {
        if (other !== apple && other.x !== 0 && other.baseY !== 0) {
          const dx = testX - other.x
          const dy = testBaseY - other.baseY
          const dist = Math.hypot(dx, dy)
          if (dist < 0.6) {
            valid = false
            break
          }
        }
      }
      attempts++
    }
    
    apple.x = testX
    apple.baseY = testBaseY
    apple.y = apple.baseY
    apple.bobOffset = Math.random() * Math.PI * 2
    apple.currentScale = 0
    apple.isFallingIn = false
    apple.size = 0.28
  }

  useEffect(() => {
    applesState.current.forEach((apple) => {
      apple.currentScale = 0.28
    })
    applesState.current.forEach((apple) => {
      spawnApple(apple)
    })
  }, [viewport])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const basket = basketPosRef.current

    applesState.current.forEach((apple, idx) => {
      if (apple.isFallingIn) {
        apple.fallProgress += dt * 3.2
        
        const t = Math.min(1, apple.fallProgress)
        const startX = apple.fallStartX
        const startY = apple.fallStartY
        const endX = basket ? basket.x : apple.fallTargetX
        const endY = basket ? basket.y + 0.05 : apple.fallTargetY
        
        const controlY = Math.max(startY, endY) + 0.3
        
        apple.x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * startX + t * t * endX
        apple.y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY
        
        // Caught apple flows towards basket and shrinks to 0 (disappears into shopkeeper basket)
        apple.currentScale = THREE.MathUtils.lerp(apple.size, 0.0, t)

        if (t >= 1) {
          onScore?.()
          onCollectEffect?.(endX, endY, '#ff1744')
          spawnApple(apple)
        }
      } else {
        if (apple.currentScale < apple.size) {
          apple.currentScale = THREE.MathUtils.lerp(apple.currentScale, apple.size, 0.12)
        }

        apple.y = apple.baseY + Math.sin(state.clock.getElapsedTime() * 2.5 + apple.bobOffset) * 0.08

        if (basket) {
          const dx = apple.x - basket.x
          const dy = apple.y - (basket.y + 0.1)
          const dist = Math.hypot(dx, dy)

          if (dist < 0.42 && dy < 0.15 && dy > -0.25 && apple.currentScale > 0.2) {
            apple.isFallingIn = true
            apple.fallStartX = apple.x
            apple.fallStartY = apple.y
            apple.fallTargetX = basket.x
            apple.fallTargetY = basket.y + 0.1
            apple.fallProgress = 0
            onCollectEffect?.(apple.x, apple.y, '#ff1744')
          }
        }
      }

      const groupRef = appleRefs.current[idx]
      if (groupRef) {
        groupRef.position.set(apple.x, apple.y, 0)
        groupRef.scale.setScalar(apple.currentScale)
        groupRef.rotation.y += dt * 1.2
      }
    })
  })

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
