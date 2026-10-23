import { useMemo } from 'react'
import * as THREE from 'three'

// The one set of lights the battle ships and the patrol ships share (warm sunlight from the planet's lit side, plus a dim fill). They
// are always here while a planet is picked, rather than each fleet adding its own, because changing the number of lights in a scene
// makes the renderer rebuild every lit material: a hitch just when a battle starts.
export default function ShipLights() {
  const target = useMemo(() => new THREE.Object3D(), [])
  return (
    <>
      <primitive object={target} />
      <ambientLight intensity={0.9} color="#a89c90" />
      <directionalLight position={[-4, 1.4, 2.2]} target={target} intensity={2.4} color="#ffe2bc" />
    </>
  )
}
