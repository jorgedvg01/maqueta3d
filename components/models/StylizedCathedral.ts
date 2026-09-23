import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"

import { mergeClayModel } from "@/components/models/ClayOptimization"

type Vec3 = readonly [number, number, number]

type CathedralMaterials = {
  darkStone: THREE.MeshStandardMaterial
  door: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial
  outline: THREE.LineBasicMaterial
  roof: THREE.MeshStandardMaterial
  roofDark: THREE.MeshStandardMaterial
  stone: THREE.MeshStandardMaterial
  stoneLight: THREE.MeshStandardMaterial
  stoneShade: THREE.MeshStandardMaterial
}

const SEGMENTS = 40

function createMaterials(): CathedralMaterials {
  const toon = (color: number) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      roughness: 0.93,
    })

  return {
    darkStone: toon(0x9b7a57),
    door: toon(0x604233),
    glass: toon(0x3f6f78),
    outline: new THREE.LineBasicMaterial({
      color: 0x5f4735,
      depthWrite: false,
      opacity: 0.16,
      transparent: true,
    }),
    roof: toon(0xc85f38),
    roofDark: toon(0x9d4932),
    stone: toon(0xd2b88a),
    stoneLight: toon(0xe6ce9e),
    stoneShade: toon(0xb99a70),
  }
}

function addOutline(mesh: THREE.Mesh, material: THREE.LineBasicMaterial, threshold = 48) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, threshold),
    material,
  )
  edges.scale.setScalar(1.003)
  edges.renderOrder = 3
  mesh.add(edges)
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
  outline?: THREE.LineBasicMaterial,
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  if (outline) addOutline(mesh, outline)
  parent.add(mesh)
  return mesh
}

function roundedBox(
  parent: THREE.Object3D,
  size: Vec3,
  position: Vec3,
  material: THREE.Material,
  outline?: THREE.LineBasicMaterial,
  radius = 0.08,
) {
  const safeRadius = Math.min(radius, size[0] * 0.18, size[1] * 0.18, size[2] * 0.18)
  return addMesh(
    parent,
    new RoundedBoxGeometry(size[0], size[1], size[2], 4, safeRadius),
    material,
    position,
    [0, 0, 0],
    outline,
  )
}

function cylinder(
  parent: THREE.Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Vec3,
  material: THREE.Material,
  rotation: Vec3 = [0, 0, 0],
  outline?: THREE.LineBasicMaterial,
  segments = SEGMENTS,
) {
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    position,
    rotation,
  )
  if (outline) {
    const upper = new THREE.Mesh(
      new THREE.TorusGeometry(radiusTop, 0.022, 6, segments),
      material,
    )
    upper.rotation.x = Math.PI / 2
    upper.position.y = height / 2
    const lower = new THREE.Mesh(
      new THREE.TorusGeometry(radiusBottom, 0.022, 6, segments),
      material,
    )
    lower.rotation.x = Math.PI / 2
    lower.position.y = -height / 2
    mesh.add(upper, lower)
  }
  return mesh
}

function gableRoofGeometry(width: number, height: number, depth: number) {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(0, height)
  shape.lineTo(width / 2, 0)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.055,
    bevelThickness: 0.045,
    curveSegments: 4,
    depth,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function gableRoof(
  parent: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  position: Vec3,
  material: THREE.Material,
  outline: THREE.LineBasicMaterial,
  ridges = 9,
) {
  const group = new THREE.Group()
  group.position.set(...position)
  parent.add(group)
  addMesh(group, gableRoofGeometry(width, height, depth), material, [0, 0, 0], [0, 0, 0], outline)

  const ridgeMaterial = material
  for (let index = 0; index < ridges; index += 1) {
    const x = -width / 2 + 0.2 + (index / Math.max(1, ridges - 1)) * (width - 0.4)
    const y = height * (1 - Math.abs(x) / (width / 2)) + 0.06
    addMesh(
      group,
      new THREE.CylinderGeometry(0.035, 0.035, depth - 0.06, 12),
      ridgeMaterial,
      [x, y, 0],
      [Math.PI / 2, 0, 0],
    )
  }
  return group
}

function buildArchShape(width: number, height: number) {
  const shape = new THREE.Shape()
  const spring = height - width / 2
  shape.moveTo(-width / 2, 0)
  shape.lineTo(width / 2, 0)
  shape.lineTo(width / 2, spring)
  shape.absarc(0, spring, width / 2, 0, Math.PI, false)
  shape.lineTo(-width / 2, 0)
  shape.closePath()
  return shape
}

function archSolid(
  parent: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  position: Vec3,
  material: THREE.Material,
  rotation: Vec3 = [0, 0, 0],
  outline?: THREE.LineBasicMaterial,
) {
  const geometry = new THREE.ExtrudeGeometry(buildArchShape(width, height), {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.018,
    curveSegments: 24,
    depth,
  })
  geometry.translate(0, 0, -depth / 2)
  return addMesh(parent, geometry, material, position, rotation, outline)
}

function archFrameGeometry(width: number, height: number, thickness: number, depth: number) {
  const shape = buildArchShape(width, height)
  const innerWidth = width - thickness * 2
  const innerHeight = height - thickness * 2
  const bottom = thickness
  const spring = bottom + innerHeight - innerWidth / 2
  const hole = new THREE.Path()
  hole.moveTo(-innerWidth / 2, bottom)
  hole.lineTo(-innerWidth / 2, spring)
  hole.absarc(0, spring, innerWidth / 2, Math.PI, 0, true)
  hole.lineTo(innerWidth / 2, bottom)
  hole.lineTo(-innerWidth / 2, bottom)
  shape.holes.push(hole)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.024,
    bevelThickness: 0.018,
    curveSegments: 24,
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
  outline: THREE.LineBasicMaterial,
  rotation: Vec3 = [0, 0, 0],
) {
  return addMesh(
    parent,
    archFrameGeometry(width, height, thickness, depth),
    material,
    position,
    rotation,
    outline,
  )
}

function addColumn(
  parent: THREE.Object3D,
  position: Vec3,
  height: number,
  radius: number,
  materials: CathedralMaterials,
) {
  const group = new THREE.Group()
  group.position.set(...position)
  parent.add(group)
  cylinder(group, radius, radius * 1.04, height, [0, height / 2, 0], materials.stoneLight, [0, 0, 0], undefined, 28)
  cylinder(group, radius * 1.38, radius * 1.48, 0.14, [0, 0.07, 0], materials.darkStone, [0, 0, 0], undefined, 28)
  cylinder(group, radius * 1.45, radius * 1.35, 0.16, [0, height - 0.08, 0], materials.darkStone, [0, 0, 0], undefined, 28)
  return group
}

function addPinnacle(
  parent: THREE.Object3D,
  position: Vec3,
  scale: number,
  materials: CathedralMaterials,
) {
  const group = new THREE.Group()
  group.position.set(...position)
  group.scale.setScalar(scale)
  parent.add(group)
  roundedBox(group, [0.32, 0.5, 0.32], [0, 0.25, 0], materials.stoneShade, materials.outline, 0.035)
  cylinder(group, 0.12, 0.23, 0.62, [0, 0.81, 0], materials.stoneLight, [0, 0, 0], undefined, 28)
  cylinder(group, 0, 0.105, 0.38, [0, 1.31, 0], materials.stone, [0, 0, 0], undefined, 28)
  return group
}

function addCross(parent: THREE.Object3D, position: Vec3, scale: number, materials: CathedralMaterials) {
  const group = new THREE.Group()
  group.position.set(...position)
  group.scale.setScalar(scale)
  parent.add(group)
  roundedBox(group, [0.1, 0.8, 0.1], [0, 0.4, 0], materials.darkStone, undefined, 0.025)
  roundedBox(group, [0.52, 0.1, 0.1], [0, 0.5, 0], materials.darkStone, undefined, 0.025)
  return group
}

function addWindow(
  parent: THREE.Object3D,
  position: Vec3,
  width: number,
  height: number,
  materials: CathedralMaterials,
  rotation: Vec3 = [0, 0, 0],
) {
  archSolid(parent, width, height, 0.075, position, materials.glass, rotation)
  const framePosition: Vec3 = [position[0], position[1] - 0.04, position[2]]
  archFrame(parent, width + 0.3, height + 0.28, 0.12, 0.11, framePosition, materials.stoneLight, materials.outline, rotation)
}

function addButtress(
  parent: THREE.Object3D,
  position: Vec3,
  height: number,
  materials: CathedralMaterials,
) {
  const group = new THREE.Group()
  group.position.set(...position)
  parent.add(group)
  roundedBox(group, [0.58, height * 0.48, 0.82], [0, height * 0.24, 0], materials.stoneShade, materials.outline, 0.055)
  roundedBox(group, [0.46, height * 0.32, 0.68], [0, height * 0.64, 0.06], materials.stone, materials.outline, 0.05)
  roundedBox(group, [0.34, height * 0.2, 0.52], [0, height * 0.89, 0.1], materials.stoneLight, materials.outline, 0.045)
  addPinnacle(group, [0, height, 0.1], 0.66, materials)
  return group
}

function buildNorthFacade(parent: THREE.Object3D, materials: CathedralMaterials) {
  const facade = new THREE.Group()
  facade.position.set(1, 0.4, -3.94)
  parent.add(facade)

  roundedBox(facade, [7.1, 5.65, 0.58], [0, 2.83, 0], materials.stone, materials.outline, 0.09)
  roundedBox(facade, [7.42, 0.28, 0.72], [0, 0.16, 0], materials.darkStone, materials.outline, 0.05)

  archSolid(facade, 1.74, 2.45, 0.1, [0, 0.24, -0.36], materials.door)
  archFrame(facade, 2.24, 2.9, 0.2, 0.2, [0, 0.18, -0.42], materials.stoneLight, materials.outline)
  archFrame(facade, 2.65, 3.28, 0.13, 0.15, [0, 0.12, -0.5], materials.darkStone, materials.outline)

  for (const x of [-2.1, 2.1]) {
    archSolid(facade, 0.92, 1.65, 0.09, [x, 0.34, -0.35], materials.door)
    archFrame(facade, 1.22, 1.94, 0.12, 0.16, [x, 0.28, -0.43], materials.stoneLight, materials.outline)
  }

  for (const y of [2.25, 3.44, 4.58]) {
    roundedBox(facade, [6.6, 0.16, 0.2], [0, y, -0.37], materials.darkStone, materials.outline, 0.035)
  }

  for (const x of [-2.75, -1.4, 1.4, 2.75]) {
    addColumn(facade, [x, 0.35, -0.5], 4.45, 0.16, materials)
  }
  for (const x of [-2.25, -0.78, 0.78, 2.25]) {
    addColumn(facade, [x, 2.45, -0.55], 2.22, 0.11, materials)
  }

  addWindow(facade, [0, 3.08, -0.38], 1.05, 1.38, materials)
  for (const x of [-2.12, 2.12]) {
    addWindow(facade, [x, 3.14, -0.38], 0.62, 1.02, materials)
  }

  const pediment = new THREE.Shape()
  pediment.moveTo(-1.65, 0)
  pediment.lineTo(0, 1.48)
  pediment.lineTo(1.65, 0)
  pediment.closePath()
  const pedimentGeometry = new THREE.ExtrudeGeometry(pediment, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.055,
    bevelThickness: 0.04,
    depth: 0.26,
  })
  pedimentGeometry.translate(0, 0, -0.13)
  addMesh(facade, pedimentGeometry, materials.stoneLight, [0, 5.48, -0.17], [0, 0, 0], materials.outline)

  const medallion = cylinder(facade, 0.46, 0.46, 0.14, [0, 6.05, -0.47], materials.darkStone, [Math.PI / 2, 0, 0], undefined, 36)
  medallion.scale.z = 0.45
  cylinder(facade, 0.3, 0.3, 0.16, [0, 6.05, -0.56], materials.stoneLight, [Math.PI / 2, 0, 0], undefined, 36)

  for (const x of [-3.25, -2.55, 2.55, 3.25]) {
    addPinnacle(facade, [x, 5.38, -0.04], x % 1 === 0 ? 0.82 : 0.72, materials)
  }
  addCross(facade, [0, 6.9, -0.08], 0.72, materials)
  return facade
}

function buildBellTower(parent: THREE.Object3D, materials: CathedralMaterials) {
  const tower = new THREE.Group()
  tower.position.set(-3.04, 0.42, -1.9)
  parent.add(tower)

  roundedBox(tower, [2.05, 5.15, 2.05], [0, 2.58, 0], materials.stoneShade, materials.outline, 0.11)
  roundedBox(tower, [2.28, 0.3, 2.28], [0, 2.55, 0], materials.darkStone, materials.outline, 0.05)
  roundedBox(tower, [1.84, 2.05, 1.84], [0, 6.1, 0], materials.stone, materials.outline, 0.09)
  roundedBox(tower, [2.08, 0.26, 2.08], [0, 5.06, 0], materials.stoneLight, materials.outline, 0.045)
  roundedBox(tower, [2.16, 0.28, 2.16], [0, 7.13, 0], materials.darkStone, materials.outline, 0.045)

  for (const rotation of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
    const side = new THREE.Group()
    side.rotation.y = rotation
    tower.add(side)
    archSolid(side, 0.64, 1.18, 0.08, [0, 5.58, -0.95], materials.glass)
    archFrame(side, 0.92, 1.45, 0.11, 0.11, [0, 5.53, -1.01], materials.stoneLight, materials.outline)
  }

  for (const [x, z] of [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]] as const) {
    addPinnacle(tower, [x, 7.22, z], 0.66, materials)
  }
  addCross(tower, [0, 7.5, 0], 0.72, materials)
  return tower
}

function buildMelonTower(parent: THREE.Object3D, materials: CathedralMaterials) {
  const tower = new THREE.Group()
  tower.position.set(-3.32, 0.42, 2.12)
  parent.add(tower)

  cylinder(tower, 1.24, 1.42, 2.25, [0, 3.42, 0], materials.stoneShade, [0, 0, 0], materials.outline, 12)
  cylinder(tower, 1.34, 1.34, 0.2, [0, 4.58, 0], materials.darkStone, [0, 0, 0], undefined, 32)
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    const x = Math.sin(angle) * 1.05
    const z = Math.cos(angle) * 1.05
    const window = new THREE.Group()
    window.position.set(x, 3.42, z)
    window.rotation.y = angle
    tower.add(window)
    archSolid(window, 0.38, 0.72, 0.06, [0, 0, 0], materials.glass)
  }

  const dome = addMesh(
    tower,
    new THREE.SphereGeometry(1.36, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.stoneLight,
    [0, 4.7, 0],
  )
  dome.scale.y = 1.34

  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    const rim = new THREE.Vector3(Math.sin(angle) * 1.34, 4.74, Math.cos(angle) * 1.34)
    const middle = new THREE.Vector3(Math.sin(angle) * 0.82, 5.65, Math.cos(angle) * 0.82)
    const top = new THREE.Vector3(0, 6.48, 0)
    const curve = new THREE.QuadraticBezierCurve3(rim, middle, top)
    addMesh(tower, new THREE.TubeGeometry(curve, 16, 0.038, 8, false), materials.darkStone, [0, 0, 0])
  }

  cylinder(tower, 0.23, 0.3, 0.28, [0, 6.61, 0], materials.darkStone, [0, 0, 0], undefined, 24)
  addMesh(tower, new THREE.SphereGeometry(0.25, 32, 18), materials.stoneLight, [0, 6.93, 0])
  cylinder(tower, 0, 0.075, 0.56, [0, 7.31, 0], materials.darkStone, [0, 0, 0], undefined, 24)
  return tower
}

function buildApse(parent: THREE.Object3D, materials: CathedralMaterials) {
  const apse = new THREE.Group()
  apse.position.set(1, 0.42, 3.75)
  parent.add(apse)

  cylinder(apse, 2.45, 2.45, 4.05, [0, 2.03, 0], materials.stone, [0, 0, 0], undefined, 48)
  const roof = addMesh(
    apse,
    new THREE.SphereGeometry(2.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.roof,
    [0, 4.04, 0],
  )
  roof.scale.y = 0.62

  for (let index = 0; index < 7; index += 1) {
    const angle = -Math.PI * 0.65 + (index / 6) * Math.PI * 1.3
    const x = Math.sin(angle) * 2.42
    const z = Math.cos(angle) * 2.42
    addButtress(apse, [x, 0, z], 3.9, materials)
    const windowGroup = new THREE.Group()
    windowGroup.position.set(Math.sin(angle) * 2.48, 1.55, Math.cos(angle) * 2.48)
    windowGroup.rotation.y = angle
    apse.add(windowGroup)
    addWindow(windowGroup, [0, 0, 0], 0.52, 1.18, materials)
  }
  return apse
}

function buildSideArchitecture(parent: THREE.Object3D, materials: CathedralMaterials) {
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -2.25 : 4.25
    for (const z of [-2.45, -0.65, 1.15, 2.85]) {
      addButtress(parent, [x, 0.42, z], 4.2, materials)
      const windowRotation: Vec3 = [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0]
      addWindow(parent, [x + side * 0.055, 2.0, z - 0.7], 0.48, 1.14, materials, windowRotation)
    }
  }

  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -2.48 : 4.48
    for (const z of [-1.7, 0.15, 2]) {
      archFrame(
        parent,
        1.5,
        2.1,
        0.16,
        0.24,
        [x, 2.9, z],
        materials.stoneLight,
        materials.outline,
        [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0],
      )
    }
  }
}

function buildOldCathedral(parent: THREE.Object3D, materials: CathedralMaterials) {
  const old = new THREE.Group()
  old.position.set(-3.2, 0.42, 1.25)
  parent.add(old)

  roundedBox(old, [3.35, 3.25, 5.2], [0, 1.63, 0], materials.stoneShade, materials.outline, 0.1)
  gableRoof(old, 3.65, 1.05, 5.38, [0, 3.24, 0], materials.roofDark, materials.outline, 7)
  roundedBox(old, [3.48, 0.16, 5.25], [0, 3.08, 0], materials.darkStone, undefined, 0.03)

  archSolid(old, 1.18, 1.86, 0.08, [0, 0.32, -2.66], materials.door)
  for (let index = 0; index < 3; index += 1) {
    archFrame(
      old,
      1.48 + index * 0.24,
      2.14 + index * 0.22,
      0.09,
      0.1,
      [0, 0.25 - index * 0.04, -2.73 - index * 0.025],
      index % 2 ? materials.stone : materials.stoneLight,
      materials.outline,
    )
  }
  const rose = cylinder(old, 0.46, 0.46, 0.1, [0, 2.55, -2.72], materials.glass, [Math.PI / 2, 0, 0], undefined, 36)
  rose.scale.z = 0.4
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    const spoke = roundedBox(old, [0.035, 0.76, 0.05], [0, 2.55, -2.79], materials.stoneLight, undefined, 0.01)
    spoke.rotation.z = angle
  }
  addCross(old, [0, 4.25, -2.3], 0.52, materials)
  return old
}

function addRoofLantern(parent: THREE.Object3D, materials: CathedralMaterials) {
  const lantern = new THREE.Group()
  lantern.position.set(1.15, 5.92, 0.65)
  parent.add(lantern)
  cylinder(lantern, 0.9, 1.08, 0.82, [0, 0.41, 0], materials.stoneLight, [0, 0, 0], materials.outline, 32)
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    const x = Math.sin(angle) * 0.82
    const z = Math.cos(angle) * 0.82
    roundedBox(lantern, [0.18, 0.48, 0.14], [x, 0.43, z], materials.glass, undefined, 0.025).rotation.y = angle
  }
  const dome = addMesh(
    lantern,
    new THREE.SphereGeometry(1.02, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.roof,
    [0, 0.82, 0],
  )
  dome.scale.y = 0.78
  addMesh(lantern, new THREE.SphereGeometry(0.13, 24, 12), materials.stoneLight, [0, 1.72, 0])
  addCross(lantern, [0, 1.79, 0], 0.4, materials)
}

export function buildStylizedCathedral() {
  const materials = createMaterials()
  const cathedral = new THREE.Group()
  cathedral.name = "Catedral Nueva y Vieja de Plasencia · maqueta ilustrada"
  cathedral.userData.kind = "hero-monument"
  cathedral.userData.style = "illustrated-diorama"

  roundedBox(cathedral, [10.7, 0.42, 9.1], [0.3, 0.21, 0.15], materials.stoneShade, materials.outline, 0.12)
  for (let step = 0; step < 4; step += 1) {
    roundedBox(
      cathedral,
      [4.9 + step * 0.42, 0.14, 0.74 + step * 0.28],
      [1, 0.49 + step * 0.11, -4.55 - step * 0.12],
      materials.stoneLight,
      materials.outline,
      0.045,
    )
  }

  roundedBox(cathedral, [5.45, 4.82, 7.55], [1, 2.83, 0.12], materials.stone, materials.outline, 0.12)
  roundedBox(cathedral, [1.85, 3.18, 6.95], [-2.52, 2.0, 0.15], materials.stoneShade, materials.outline, 0.1)
  roundedBox(cathedral, [1.85, 3.18, 6.95], [4.52, 2.0, 0.15], materials.stoneShade, materials.outline, 0.1)
  gableRoof(cathedral, 5.75, 1.52, 7.78, [1, 5.2, 0.12], materials.roof, materials.outline, 13)
  gableRoof(cathedral, 2.08, 0.72, 7.12, [-2.52, 3.54, 0.15], materials.roofDark, materials.outline, 5)
  gableRoof(cathedral, 2.08, 0.72, 7.12, [4.52, 3.54, 0.15], materials.roofDark, materials.outline, 5)

  buildNorthFacade(cathedral, materials)
  buildBellTower(cathedral, materials)
  buildOldCathedral(cathedral, materials)
  buildMelonTower(cathedral, materials)
  buildApse(cathedral, materials)
  buildSideArchitecture(cathedral, materials)
  addRoofLantern(cathedral, materials)

  cathedral.rotation.y = -0.07
  const optimized = mergeClayModel(cathedral, cathedral.name)
  optimized.userData.kind = "hero-monument"
  optimized.userData.style = "handmade-clay-illustration"
  return optimized
}
