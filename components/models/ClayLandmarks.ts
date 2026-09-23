import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"

import type { Poi } from "@/data/plasencia"
import { mergeClayModel } from "@/components/models/ClayOptimization"

type Vec3 = readonly [number, number, number]

type ClaySet = {
  cream: THREE.MeshStandardMaterial
  dark: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial
  iron: THREE.MeshStandardMaterial
  roof: THREE.MeshStandardMaterial
  roofDark: THREE.MeshStandardMaterial
  stone: THREE.MeshStandardMaterial
  stoneDark: THREE.MeshStandardMaterial
  white: THREE.MeshStandardMaterial
}

function clay(color: number, roughness = 0.94) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    roughness,
  })
}

function materials(accent = 0xc55d38, wall = 0xd9bd8d): ClaySet {
  return {
    cream: clay(0xefd7a9),
    dark: clay(0x553f32),
    glass: clay(0x355f68, 0.78),
    iron: clay(0x3d4542, 0.74),
    roof: clay(accent),
    roofDark: clay(new THREE.Color(accent).multiplyScalar(0.76).getHex()),
    stone: clay(wall),
    stoneDark: clay(new THREE.Color(wall).multiplyScalar(0.78).getHex()),
    white: clay(0xf2dfba),
  }
}

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
) {
  const object = new THREE.Mesh(geometry, material)
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
  material: THREE.Material,
  radius = 0.08,
  rotation: Vec3 = [0, 0, 0],
) {
  const safeRadius = Math.min(radius, size[0] * 0.2, size[1] * 0.2, size[2] * 0.2)
  return mesh(
    parent,
    new RoundedBoxGeometry(size[0], size[1], size[2], 4, safeRadius),
    material,
    position,
    rotation,
  )
}

function cylinder(
  parent: THREE.Object3D,
  top: number,
  bottom: number,
  height: number,
  position: Vec3,
  material: THREE.Material,
  segments = 36,
  rotation: Vec3 = [0, 0, 0],
) {
  return mesh(
    parent,
    new THREE.CylinderGeometry(top, bottom, height, segments, 1, false),
    material,
    position,
    rotation,
  )
}

function cone(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  position: Vec3,
  material: THREE.Material,
  segments = 36,
  rotation: Vec3 = [0, 0, 0],
) {
  return mesh(parent, new THREE.ConeGeometry(radius, height, segments), material, position, rotation)
}

function gableGeometry(width: number, rise: number, depth: number) {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(0, rise)
  shape.lineTo(width / 2, 0)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.055,
    bevelThickness: 0.045,
    curveSegments: 8,
    depth,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function gableRoof(
  parent: THREE.Object3D,
  width: number,
  rise: number,
  depth: number,
  position: Vec3,
  material: THREE.Material,
  tileMaterial: THREE.Material,
  rotationY = 0,
  tileCount = 11,
) {
  const group = new THREE.Group()
  group.position.set(...position)
  group.rotation.y = rotationY
  parent.add(group)
  mesh(group, gableGeometry(width, rise, depth), material)

  for (let index = 0; index < tileCount; index += 1) {
    const x = -width / 2 + 0.14 + (index / Math.max(1, tileCount - 1)) * (width - 0.28)
    const y = rise * (1 - Math.abs(x) / (width / 2)) + 0.045
    cylinder(group, 0.025, 0.025, depth - 0.08, [x, y, 0], tileMaterial, 12, [Math.PI / 2, 0, 0])
  }
  cylinder(group, 0.055, 0.055, depth + 0.08, [0, rise + 0.035, 0], tileMaterial, 16, [Math.PI / 2, 0, 0])
  return group
}

function archShape(width: number, height: number) {
  const radius = width / 2
  const spring = height - radius
  const shape = new THREE.Shape()
  shape.moveTo(-radius, 0)
  shape.lineTo(radius, 0)
  shape.lineTo(radius, spring)
  shape.absarc(0, spring, radius, 0, Math.PI, false)
  shape.lineTo(-radius, 0)
  shape.closePath()
  return shape
}

function archFrameGeometry(width: number, height: number, thickness: number, depth: number) {
  const shape = archShape(width, height)
  const innerWidth = width - thickness * 2
  const innerHeight = height - thickness * 1.7
  const radius = innerWidth / 2
  const spring = thickness * 0.55 + innerHeight - radius
  const hole = new THREE.Path()
  hole.moveTo(-radius, thickness * 0.55)
  hole.lineTo(-radius, spring)
  hole.absarc(0, spring, radius, Math.PI, 0, true)
  hole.lineTo(radius, thickness * 0.55)
  hole.closePath()
  shape.holes.push(hole)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.028,
    bevelThickness: 0.025,
    curveSegments: 28,
    depth,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function archFrame(
  parent: THREE.Object3D,
  width: number,
  height: number,
  thickness: number,
  depth: number,
  position: Vec3,
  material: THREE.Material,
  rotation: Vec3 = [0, 0, 0],
) {
  return mesh(parent, archFrameGeometry(width, height, thickness, depth), material, position, rotation)
}

function windowUnit(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  set: ClaySet,
  width = 0.42,
  height = 0.66,
  balcony = false,
) {
  roundedBox(parent, [width + 0.16, height + 0.16, 0.09], [x, y, z], set.white, 0.035)
  roundedBox(parent, [width, height, 0.075], [x, y, z - 0.052], set.glass, 0.025)
  roundedBox(parent, [0.035, height, 0.035], [x, y, z - 0.1], set.white, 0.012)
  if (!balcony) return
  roundedBox(parent, [width + 0.34, 0.1, 0.34], [x, y - height / 2 - 0.08, z - 0.17], set.white, 0.035)
  const railY = y - height / 2 + 0.12
  roundedBox(parent, [width + 0.3, 0.045, 0.04], [x, railY + 0.23, z - 0.35], set.iron, 0.014)
  for (let rail = -2; rail <= 2; rail += 1) {
    roundedBox(parent, [0.025, 0.45, 0.025], [x + rail * (width + 0.22) / 5, railY, z - 0.35], set.iron, 0.008)
  }
}

function doorUnit(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  set: ClaySet,
  width = 0.62,
  height = 1.15,
) {
  archFrame(parent, width + 0.2, height + 0.18, 0.09, 0.12, [x, y - height / 2, z], set.white)
  mesh(parent, new THREE.ShapeGeometry(archShape(width, height), 24), set.dark, [x, y - height / 2 + 0.025, z - 0.07], [0, Math.PI, 0])
}

function arcade(
  parent: THREE.Object3D,
  count: number,
  span: number,
  bottomY: number,
  z: number,
  set: ClaySet,
) {
  const spacing = span / count
  const width = spacing * 0.78
  for (let index = 0; index < count; index += 1) {
    const x = -span / 2 + spacing * (index + 0.5)
    mesh(parent, new THREE.ShapeGeometry(archShape(width - 0.14, 1.18), 24), set.dark, [x, bottomY + 0.03, z + 0.035], [0, Math.PI, 0])
    archFrame(parent, width, 1.28, 0.1, 0.2, [x, bottomY, z - 0.04], set.white)
  }
  roundedBox(parent, [span + 0.18, 0.12, 0.28], [0, bottomY + 1.3, z - 0.07], set.white, 0.04)
}

function oculus(parent: THREE.Object3D, radius: number, position: Vec3, set: ClaySet) {
  mesh(parent, new THREE.CircleGeometry(radius, 40), set.glass, position, [0, Math.PI, 0])
  mesh(parent, new THREE.TorusGeometry(radius + 0.055, 0.04, 12, 48), set.white, [position[0], position[1], position[2] - 0.035])
}

function crenellations(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  set: ClaySet,
) {
  for (const z of [-depth / 2, depth / 2]) {
    for (let index = -2; index <= 2; index += 1) {
      roundedBox(parent, [0.32, 0.34, 0.28], [index * width / 5, y, z], set.white, 0.045)
    }
  }
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth * 0.22, depth * 0.22]) {
      roundedBox(parent, [0.28, 0.34, 0.32], [x, y, z], set.white, 0.045)
    }
  }
}

function finish(group: THREE.Group, name: string) {
  return mergeClayModel(group, name)
}

export function buildClayTownHall() {
  const group = new THREE.Group()
  const set = materials(0xb94f31, 0xd1ad78)
  roundedBox(group, [6.2, 3.2, 2.7], [0.55, 1.6, 0], set.stone, 0.12)
  arcade(group, 5, 5.75, 0.05, -1.39, set)
  for (const x of [-1.55, -0.5, 0.55, 1.6, 2.65]) windowUnit(group, x, 2.35, -1.39, set, 0.38, 0.62, x !== 2.65)
  gableRoof(group, 6.5, 1.05, 3.02, [0.55, 3.17, 0], set.roof, set.roofDark, 0, 15)

  roundedBox(group, [1.72, 6.25, 1.78], [-2.35, 3.12, -0.02], set.stoneDark, 0.11)
  roundedBox(group, [1.92, 0.22, 1.98], [-2.35, 5.3, -0.02], set.white, 0.055)
  archFrame(group, 0.58, 0.82, 0.1, 0.13, [-2.35, 4.86, -0.94], set.white)
  mesh(group, new THREE.CircleGeometry(0.42, 48), clay(0xf4e9ce), [-2.35, 3.85, -0.925], [0, Math.PI, 0])
  mesh(group, new THREE.TorusGeometry(0.45, 0.045, 12, 48), set.stoneDark, [-2.35, 3.85, -0.97])
  roundedBox(group, [0.045, 0.34, 0.035], [-2.35, 3.99, -0.99], set.dark, 0.01)
  roundedBox(group, [0.27, 0.045, 0.035], [-2.23, 3.85, -0.99], set.dark, 0.01, [0, 0, -0.28])
  cone(group, 1.32, 1.75, [-2.35, 6.95, -0.02], set.roof, 40)
  cylinder(group, 0.075, 0.075, 0.62, [-2.35, 8.08, -0.02], set.stoneDark, 20)
  return finish(group, "Palacio Municipal y torre de Mayorga de arcilla")
}

function buildSantaAna() {
  const group = new THREE.Group()
  const set = materials(0xc86439, 0xd9bf91)
  roundedBox(group, [4.25, 2.7, 2.65], [0.2, 1.35, 0], set.stone, 0.11)
  gableRoof(group, 4.5, 1.18, 2.95, [0.2, 2.7, 0], set.roof, set.roofDark, 0, 11)
  roundedBox(group, [1.2, 4.35, 1.3], [-1.38, 2.18, 0.02], set.stoneDark, 0.1)
  archFrame(group, 0.52, 0.78, 0.1, 0.13, [-1.38, 3.32, -0.69], set.white)
  cone(group, 0.9, 1.18, [-1.38, 4.94, 0.02], set.roof, 36)
  doorUnit(group, 0.65, 1.18, -1.36, set, 0.72, 1.25)
  oculus(group, 0.26, [0.65, 2.12, -1.4], set)
  return finish(group, "Iglesia de Santa Ana de arcilla")
}

function buildSantoDomingo() {
  const group = new THREE.Group()
  const set = materials(0xb95635, 0xd2b587)
  roundedBox(group, [4.7, 3.2, 2.85], [-0.95, 1.6, 0], set.stone, 0.11)
  gableRoof(group, 4.95, 1.25, 3.12, [-0.95, 3.2, 0], set.roof, set.roofDark, 0, 13)
  roundedBox(group, [5.1, 2.35, 2.3], [3.55, 1.18, 0.27], set.cream, 0.11)
  arcade(group, 5, 4.72, 0.05, -0.93, set)
  gableRoof(group, 5.35, 0.82, 2.55, [3.55, 2.35, 0.27], set.roof, set.roofDark, 0, 12)
  roundedBox(group, [1.25, 4.8, 1.35], [-2.55, 2.4, 0], set.stoneDark, 0.1)
  archFrame(group, 0.52, 0.76, 0.1, 0.14, [-2.55, 3.62, -0.72], set.white)
  cone(group, 0.93, 1.2, [-2.55, 5.15, 0], set.roof, 36)
  doorUnit(group, -0.25, 1.3, -1.47, set, 0.78, 1.35)
  return finish(group, "Iglesia y convento de Santo Domingo de arcilla")
}

function buildMagdalena() {
  const group = new THREE.Group()
  const set = materials(0xb45434, 0xc5a87b)
  roundedBox(group, [4.1, 2.55, 2.5], [0.35, 1.28, 0], set.stone, 0.13)
  gableRoof(group, 4.35, 1.02, 2.8, [0.35, 2.55, 0], set.roof, set.roofDark, 0, 10)
  roundedBox(group, [1.5, 4.55, 1.48], [-1.45, 2.28, 0.1], set.stoneDark, 0.12)
  crenellations(group, 1.38, 1.38, 4.67, set)
  archFrame(group, 0.52, 0.78, 0.1, 0.14, [-1.45, 3.45, -0.68], set.white)
  doorUnit(group, 0.75, 1.16, -1.29, set, 0.7, 1.22)
  return finish(group, "Iglesia de la Magdalena de arcilla")
}

export function buildClayChurch(id: string) {
  if (id === "santo-domingo") return buildSantoDomingo()
  if (id === "magdalena") return buildMagdalena()
  return buildSantaAna()
}

function palaceShell(
  width: number,
  height: number,
  depth: number,
  set: ClaySet,
  windows = 4,
) {
  const group = new THREE.Group()
  roundedBox(group, [width, height, depth], [0, height / 2, 0], set.stone, 0.12)
  gableRoof(group, width + 0.28, 0.88, depth + 0.28, [0, height, 0], set.roof, set.roofDark, 0, Math.max(9, windows * 3))
  const spacing = width / (windows + 1)
  for (let index = 0; index < windows; index += 1) {
    const x = -width / 2 + spacing * (index + 1)
    windowUnit(group, x, height * 0.66, -depth / 2 - 0.045, set, 0.38, 0.62, index % 2 === 0)
  }
  doorUnit(group, 0, 1.15, -depth / 2 - 0.055, set, 0.72, 1.23)
  return group
}

function buildMirabel() {
  const set = materials(0xb45131, 0xcaa578)
  const group = palaceShell(5.8, 3.05, 2.9, set, 5)
  roundedBox(group, [1.35, 4.2, 1.45], [-2.25, 2.1, 0.05], set.stoneDark, 0.11)
  roundedBox(group, [1.35, 4.2, 1.45], [2.25, 2.1, 0.05], set.stoneDark, 0.11)
  cone(group, 0.93, 1.05, [-2.25, 4.72, 0.05], set.roof, 36)
  cone(group, 0.93, 1.05, [2.25, 4.72, 0.05], set.roof, 36)
  return finish(group, "Palacio del Marqués de Mirabel de arcilla")
}

function buildEpiscopal() {
  const set = materials(0xc0643c, 0xddc292)
  const group = palaceShell(5.4, 3.2, 2.8, set, 4)
  const pediment = gableGeometry(2.05, 0.78, 0.2)
  mesh(group, pediment, set.white, [0, 3.05, -1.48])
  oculus(group, 0.2, [0, 3.36, -1.61], set)
  for (const x of [-2.35, 2.35]) {
    cylinder(group, 0.48, 0.55, 3.62, [x, 1.81, -0.02], set.stoneDark, 40)
    cone(group, 0.62, 0.85, [x, 4.04, -0.02], set.roof, 40)
  }
  return finish(group, "Palacio Episcopal de arcilla")
}

function buildMonroy() {
  const set = materials(0xa94b31, 0xc4a276)
  const group = palaceShell(4.8, 2.8, 2.8, set, 3)
  for (const x of [-1.92, 1.92]) {
    roundedBox(group, [1.25, 4.25, 1.28], [x, 2.12, 0], set.stoneDark, 0.1)
    crenellations(group, 1.12, 1.14, 4.4, set)
  }
  return finish(group, "Casa palacio de los Monroy y sus dos torres")
}

function buildDean() {
  const set = materials(0xc3683e, 0xe1c798)
  const group = palaceShell(4.65, 3.05, 2.6, set, 4)
  roundedBox(group, [2.5, 0.12, 0.42], [0, 1.75, -1.46], set.white, 0.04)
  roundedBox(group, [2.4, 0.05, 0.04], [0, 2.02, -1.68], set.iron, 0.012)
  for (let rail = -5; rail <= 5; rail += 1) {
    roundedBox(group, [0.026, 0.48, 0.026], [rail * 0.2, 1.78, -1.68], set.iron, 0.008)
  }
  oculus(group, 0.23, [0, 2.62, -1.39], set)
  return finish(group, "Casa del Deán de arcilla")
}

function buildArgollas() {
  const set = materials(0xb95736, 0xd7b486)
  const group = palaceShell(5.25, 3.1, 2.75, set, 5)
  roundedBox(group, [4.35, 0.13, 0.42], [0, 1.72, -1.55], set.white, 0.045)
  roundedBox(group, [4.25, 0.05, 0.04], [0, 2.02, -1.77], set.iron, 0.012)
  for (let rail = -9; rail <= 9; rail += 1) {
    roundedBox(group, [0.025, 0.5, 0.025], [rail * 0.22, 1.77, -1.77], set.iron, 0.008)
  }
  return finish(group, "Casa de las Argollas de arcilla")
}

function buildMuseum() {
  const set = materials(0xaa4d32, 0xc5aa80)
  const group = palaceShell(4.25, 2.72, 2.65, set, 3)
  roundedBox(group, [1.22, 3.65, 1.2], [-1.5, 1.82, 0.02], set.stoneDark, 0.1)
  cone(group, 0.82, 0.92, [-1.5, 4.1, 0.02], set.roof, 36)
  return finish(group, "Museo Etnográfico Textil de arcilla")
}

export function buildClayPalace(id: string) {
  if (id === "mirabel") return buildMirabel()
  if (id === "episcopal") return buildEpiscopal()
  if (id === "monroy") return buildMonroy()
  if (id === "dean") return buildDean()
  if (id === "argollas") return buildArgollas()
  return buildMuseum()
}

export function buildClayTower() {
  const group = new THREE.Group()
  const set = materials(0xb45435, 0xc2a176)
  cylinder(group, 1.18, 1.38, 5.7, [0, 2.85, 0], set.stone, 56)
  cylinder(group, 1.34, 1.34, 0.2, [0, 5.48, 0], set.white, 56)
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2
    roundedBox(group, [0.38, 0.45, 0.32], [Math.cos(angle) * 1.13, 5.78, Math.sin(angle) * 1.13], set.white, 0.055, [0, -angle, 0])
  }
  for (const y of [1.6, 3.15, 4.45]) roundedBox(group, [0.17, 0.58, 0.08], [0, y, -1.33], set.dark, 0.025)
  return finish(group, "Torre Lucía de arcilla")
}

export function buildClayAqueduct() {
  const group = new THREE.Group()
  const set = materials(0xbc5736, 0xc8ad83)
  const count = 14
  const spacing = 2.15
  for (let index = 0; index < count; index += 1) {
    const z = (index - (count - 1) / 2) * spacing
    archFrame(group, 1.82, 4.25, 0.34, 0.9, [0, 0.08, z], index % 2 ? set.stone : set.cream, [0, Math.PI / 2, 0])
    roundedBox(group, [0.95, 0.22, 2.12], [0, 4.18, z], set.white, 0.07)
  }
  roundedBox(group, [1.12, 0.55, count * spacing + 0.8], [0, 4.63, 0], set.stoneDark, 0.1)
  roundedBox(group, [0.72, 0.18, count * spacing + 1], [0, 5.0, 0], set.white, 0.06)
  return finish(group, "Acueducto de San Antón de arcilla con arcos abiertos")
}

export function buildClayLandmark(poi: Poi) {
  if (poi.kind === "townhall") return buildClayTownHall()
  if (poi.kind === "aqueduct") return buildClayAqueduct()
  if (poi.kind === "church") return buildClayChurch(poi.id)
  if (poi.kind === "tower") return buildClayTower()
  if (poi.kind === "palace") return buildClayPalace(poi.id)
  return new THREE.Group()
}
