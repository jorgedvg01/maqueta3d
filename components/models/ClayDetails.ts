import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"

import { mergeClayModel } from "@/components/models/ClayOptimization"

type Vec3 = readonly [number, number, number]

function material(color: number, roughness = 0.95) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness })
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  clay: THREE.Material,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
) {
  const object = new THREE.Mesh(geometry, clay)
  object.position.set(...position)
  object.rotation.set(...rotation)
  object.castShadow = true
  object.receiveShadow = true
  parent.add(object)
  return object
}

function roundedBox(
  parent: THREE.Object3D,
  size: Vec3,
  position: Vec3,
  clay: THREE.Material,
  radius = 0.035,
  rotation: Vec3 = [0, 0, 0],
) {
  return addMesh(
    parent,
    new RoundedBoxGeometry(size[0], size[1], size[2], 3, Math.min(radius, ...size.map((value) => value * 0.2))),
    clay,
    position,
    rotation,
  )
}

const WOOD = material(0x80543b)
const DARK_WOOD = material(0x5b3d31)
const LINEN = material(0xf4dfb5)
const IRON = material(0x424946, 0.78)
const FRUIT = [material(0xd16b3c), material(0xd6a834), material(0x6f9b4d), material(0xa54135)]
const CANOPIES = [material(0x6ea6b7), material(0xc85e68), material(0x83a64f), material(0xe4b447)]
const CLOTHES = [material(0x487a83), material(0xb75a43), material(0x7c8f4a), material(0xc28a43)]

function marketStall(parent: THREE.Object3D, x: number, z: number, colorIndex: number, rotationY = 0) {
  const group = new THREE.Group()
  group.position.set(x, 0.47, z)
  group.rotation.y = rotationY
  parent.add(group)

  roundedBox(group, [0.94, 0.14, 0.5], [0, 0.38, 0], WOOD, 0.04)
  roundedBox(group, [0.82, 0.28, 0.42], [0, 0.19, 0], DARK_WOOD, 0.05)
  for (const postX of [-0.41, 0.41]) {
    for (const postZ of [-0.2, 0.2]) {
      roundedBox(group, [0.055, 0.92, 0.055], [postX, 0.72, postZ], WOOD, 0.014)
    }
  }
  roundedBox(group, [1.12, 0.12, 0.74], [0, 1.18, 0], LINEN, 0.05, [0, 0, 0.045])
  const canopy = CANOPIES[colorIndex % CANOPIES.length]
  for (let strip = -2; strip <= 2; strip += 1) {
    if (strip % 2 === 0) roundedBox(group, [0.19, 0.13, 0.76], [strip * 0.205, 1.195, 0], canopy, 0.035, [0, 0, 0.045])
  }
  for (let item = 0; item < 7; item += 1) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), FRUIT[(item + colorIndex) % FRUIT.length])
    sphere.position.set(-0.34 + (item % 4) * 0.22, 0.5 + Math.floor(item / 4) * 0.08, -0.12 + (item % 2) * 0.2)
    sphere.castShadow = true
    group.add(sphere)
  }
}

function person(parent: THREE.Object3D, x: number, z: number, colorIndex: number, rotationY = 0) {
  const group = new THREE.Group()
  group.position.set(x, 0.47, z)
  group.rotation.y = rotationY
  parent.add(group)
  addMesh(group, new THREE.CylinderGeometry(0.105, 0.15, 0.38, 18), CLOTHES[colorIndex % CLOTHES.length], [0, 0.26, 0])
  addMesh(group, new THREE.SphereGeometry(0.115, 18, 12), material(0xd7a77a), [0, 0.57, 0])
  addMesh(group, new THREE.CylinderGeometry(0.14, 0.14, 0.045, 20), DARK_WOOD, [0, 0.69, 0])
  addMesh(group, new THREE.CylinderGeometry(0.09, 0.12, 0.11, 20), DARK_WOOD, [0, 0.75, 0])
}

function lamp(parent: THREE.Object3D, x: number, z: number) {
  addMesh(parent, new THREE.CylinderGeometry(0.035, 0.055, 1.05, 16), IRON, [x, 0.98, z])
  addMesh(parent, new THREE.SphereGeometry(0.13, 18, 12), material(0xf4d88f, 0.72), [x, 1.53, z])
  addMesh(parent, new THREE.ConeGeometry(0.18, 0.18, 20), IRON, [x, 1.69, z])
}

export function buildClayMarketSquare() {
  const group = new THREE.Group()
  group.name = "Mercado y vida urbana modelados en arcilla"

  marketStall(group, -1.6, -0.72, 0, 0.08)
  marketStall(group, -0.48, -0.82, 1, -0.04)
  marketStall(group, 0.7, -0.74, 2, 0.06)
  marketStall(group, 1.65, 0.34, 3, Math.PI - 0.08)
  marketStall(group, 0.52, 0.55, 0, Math.PI + 0.04)

  person(group, -2.05, 0.36, 0, -0.6)
  person(group, -1.0, 0.2, 1, 0.9)
  person(group, 1.05, 0.08, 2, -1.1)
  person(group, 2.05, -0.55, 3, 2.4)
  person(group, -0.1, 0.88, 1, Math.PI)

  lamp(group, -2.48, -1.1)
  lamp(group, 2.15, 0.82)
  return mergeClayModel(group, group.name)
}
