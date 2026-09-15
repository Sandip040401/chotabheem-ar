import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { FRUIT_TYPES, ProceduralFruit, HalfFruit, HalfBanana } from '../models/ProceduralFruit.jsx'

// Fruit Ninja Game Manager
export default function NinjaApples({ swordPosRef, swordRotRef, onScore, onCollectEffect }) {
  const { viewport } = useThree()
  const fruitsCount = 4

  const fruitsState = useRef(
    Array.from({ length: fruitsCount }, () => ({
      x: 0,
      y: -999,
      vx: 0,
      vy: 0,
      type: FRUIT_TYPES[0],
      sliced: false,
      leftHalf: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, rotV: 0 },
      rightHalf: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, rotV: 0 },
    }))
  )

  const fruitRefs = useRef([])
  const leftHalfRefs = useRef([])
  const rightHalfRefs = useRef([])

  const spawnFruit = (fruit) => {
    fruit.x = (Math.random() - 0.5) * viewport.width * 0.75
    fruit.y = -viewport.height / 2 - 0.4
    fruit.vx = (Math.random() - 0.5) * 0.8
    fruit.vy = 3.0 + Math.random() * 1.2
    fruit.type = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)]
    fruit.sliced = false
  }

  useEffect(() => {
    fruitsState.current.forEach((fruit, idx) => {
      spawnFruit(fruit)
      fruit.y -= idx * 1.8
    })
  }, [viewport])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const gravity = 4.5
    const swordPos = swordPosRef.current
    const swordRot = swordRotRef.current
    const angle = swordRot ? swordRot.rotY : 0

    fruitsState.current.forEach((fruit, idx) => {
      if (!fruit.sliced) {
        fruit.x += fruit.vx * dt
        fruit.y += fruit.vy * dt
        fruit.vy -= gravity * dt

        if (swordPos) {
          const bladeLength = 0.8
          const tipX = swordPos.x + Math.cos(angle) * bladeLength
          const tipY = swordPos.y + Math.sin(angle) * bladeLength

          const dx = tipX - swordPos.x
          const dy = tipY - swordPos.y
          const l2 = dx * dx + dy * dy
          let t = ((fruit.x - swordPos.x) * dx + (fruit.y - swordPos.y) * dy) / l2
          t = Math.max(0, Math.min(1, t))
          const projX = swordPos.x + t * dx
          const projY = swordPos.y + t * dy
          const dist = Math.hypot(fruit.x - projX, fruit.y - projY)

          if (dist < 0.25) {
            fruit.sliced = true
            onScore?.()
            onCollectEffect?.(fruit.x, fruit.y, fruit.type.color)

            fruit.leftHalf = {
              x: fruit.x,
              y: fruit.y,
              vx: fruit.vx - 1.2,
              vy: fruit.vy + 0.6,
              rot: 0,
              rotV: -3 - Math.random() * 5,
            }
            fruit.rightHalf = {
              x: fruit.x,
              y: fruit.y,
              vx: fruit.vx + 1.2,
              vy: fruit.vy + 0.6,
              rot: 0,
              rotV: 3 + Math.random() * 5,
            }
          }
        }

        if (fruit.y < -viewport.height / 2 - 0.5 && fruit.vy < 0) {
          spawnFruit(fruit)
        }

        const fruitGroup = fruitRefs.current[idx]
        if (fruitGroup) {
          fruitGroup.position.set(fruit.x, fruit.y, 0)
          fruitGroup.rotation.y += dt * 2.0
          fruitGroup.visible = true
        }

        if (leftHalfRefs.current[idx]) leftHalfRefs.current[idx].visible = false
        if (rightHalfRefs.current[idx]) rightHalfRefs.current[idx].visible = false
      } else {
        const l = fruit.leftHalf
        const r = fruit.rightHalf

        l.x += l.vx * dt
        l.y += l.vy * dt
        l.vy -= gravity * dt
        l.rot += l.rotV * dt

        r.x += r.vx * dt
        r.y += r.vy * dt
        r.vy -= gravity * dt
        r.rot += r.rotV * dt

        const leftGroup = leftHalfRefs.current[idx]
        if (leftGroup) {
          leftGroup.position.set(l.x, l.y, 0.05)
          leftGroup.rotation.z = l.rot
          leftGroup.visible = true
        }

        const rightGroup = rightHalfRefs.current[idx]
        if (rightGroup) {
          rightGroup.position.set(r.x, r.y, 0.05)
          rightGroup.rotation.z = r.rot
          rightGroup.visible = true
        }

        if (fruitRefs.current[idx]) fruitRefs.current[idx].visible = false

        if (l.y < -viewport.height / 2 - 0.5 && r.y < -viewport.height / 2 - 0.5) {
          spawnFruit(fruit)
        }
      }
    })
  })

  return (
    <group>
      {fruitsState.current.map((fruit, idx) => (
        <group key={idx}>
          <group ref={(el) => (fruitRefs.current[idx] = el)}>
            <ProceduralFruit type={fruit.type.name} size={fruit.type.size} />
          </group>
          <group ref={(el) => (leftHalfRefs.current[idx] = el)}>
            {fruit.type.name === 'banana' ? (
              <HalfBanana isLeft={true} size={fruit.type.size} />
            ) : (
              <HalfFruit
                color={fruit.type.color}
                innerColor={fruit.type.innerColor}
                isLeft={true}
                size={fruit.type.size}
              />
            )}
          </group>
          <group ref={(el) => (rightHalfRefs.current[idx] = el)}>
            {fruit.type.name === 'banana' ? (
              <HalfBanana isLeft={false} size={fruit.type.size} />
            ) : (
              <HalfFruit
                color={fruit.type.color}
                innerColor={fruit.type.innerColor}
                isLeft={false}
                size={fruit.type.size}
              />
            )}
          </group>
        </group>
      ))}
    </group>
  )
}
