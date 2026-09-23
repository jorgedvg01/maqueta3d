import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"

import {
  CITY_POLYGON,
  GATES,
  STREETS,
  URBAN_BLOCKS,
  URBAN_BUILDINGS,
  URBAN_PLAZAS,
  type Point2,
  type Poi,
  type UrbanBlock,
  type UrbanBuilding,
} from "@/data/plasencia"
import { buildMasterClayBlock, MASTER_CLAY_BLOCK_ID } from "@/components/models/MasterClayBlock"

const WALL_COLORS = [
  0xf3d5a1,
  0xe8bb86,
  0xd7c29d,
  0xa8c9c3,
  0xdda07c,
  0xe9ca8d,
  0x91b8c3,
  0xcbb18b,
]
const ROOF_COLORS = [0xc85b35, 0xb94c31, 0xd27140, 0xa8442f, 0xd98149]
const WINDOW_COLORS = [0x315e64, 0x315d7c, 0x5a3e32, 0x4f7765]
const DISTRICT_PALETTES: Record<string, readonly number[]> = {
  "Catedral": [0xe9d4aa, 0xd9b985, 0xc7b18d, 0x9ebbc0],
  "Plaza Mayor": [0xf0cb91, 0xdf9b73, 0xa8c7c4, 0xd9bd99],
  "San Nicolás": [0xe7cda1, 0xc9a077, 0x94b7bd, 0xd88767],
  "Santo Domingo": [0xe0c39a, 0xb9a47f, 0x86aeb7, 0xd6a06e],
  "La Magdalena": [0xefd29c, 0xc5b08b, 0x9bbfbd, 0xe09871],
  "Santa Ana": [0xeac28b, 0xd78164, 0x87b1bd, 0xc7b18c],
  "Torre Lucía": [0xe4c295, 0xbda47f, 0x7fa7b4, 0xd99666],
}
const BASE_Y = 0.43

type GeometryBucket = {
  colors: number[]
  positions: number[]
}

type Facade = {
  a: Point2
  b: Point2
  direction: THREE.Vector2
  length: number
  midpoint: THREE.Vector2
  outward: THREE.Vector2
}

type RoofFrame = {
  center: THREE.Vector2
  halfLength: number
  halfWidth: number
  u: THREE.Vector2
  v: THREE.Vector2
}

function toonMaterial(color: number, vertexColors = false, doubleSided = false) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.94,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors,
  })
}

function clayFootprintGeometry(
  points: readonly Point2[],
  height: number,
  color: THREE.Color,
) {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], -points[0][1])
  points.slice(1).forEach(([x, z]) => shape.lineTo(x, -z))
  shape.closePath()

  const shortestEdge = points.reduce((minimum, point, index) => {
    const next = points[(index + 1) % points.length]
    return Math.min(minimum, Math.hypot(next[0] - point[0], next[1] - point[1]))
  }, Number.POSITIVE_INFINITY)
  const bevel = THREE.MathUtils.clamp(shortestEdge * 0.055, 0.018, 0.055)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: Math.min(0.038, bevel * 0.82),
    curveSegments: 10,
    depth: height,
    steps: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, BASE_Y, 0)
  const colors = new Float32Array(geometry.getAttribute("position").count * 3)
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r
    colors[index + 1] = color.g
    colors[index + 2] = color.b
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function appendGeometry(
  bucket: GeometryBucket,
  color: THREE.Color,
  source: THREE.BufferGeometry,
  matrix?: THREE.Matrix4,
) {
  const clone = source.clone()
  if (matrix) clone.applyMatrix4(matrix)
  const geometry = clone.index ? clone.toNonIndexed() : clone
  const positions = geometry.getAttribute("position")
  for (let index = 0; index < positions.count; index += 1) {
    bucket.positions.push(positions.getX(index), positions.getY(index), positions.getZ(index))
    bucket.colors.push(color.r, color.g, color.b)
  }
  geometry.dispose()
  if (geometry !== clone) clone.dispose()
  source.dispose()
}

function facadeMatrix(
  facade: Facade,
  y: number,
  offset: number,
) {
  return new THREE.Matrix4().set(
    facade.direction.x, 0, facade.outward.x, facade.midpoint.x + facade.outward.x * offset,
    0, 1, 0, y,
    facade.direction.y, 0, facade.outward.y, facade.midpoint.y + facade.outward.y * offset,
    0, 0, 0, 1,
  )
}

function polygonArea(points: readonly Point2[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    area += points[index][0] * next[1] - next[0] * points[index][1]
  }
  return area / 2
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, z] = polygon[index]
    const [previousX, previousZ] = polygon[previous]
    const intersects =
      z > point[1] !== previousZ > point[1] &&
      point[0] < ((previousX - x) * (point[1] - z)) / (previousZ - z) + x
    if (intersects) inside = !inside
  }
  return inside
}

function polygonCentroid(points: readonly Point2[]) {
  let area = 0
  let x = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const factor = points[index][0] * next[1] - next[0] * points[index][1]
    area += factor
    x += (points[index][0] + next[0]) * factor
    z += (points[index][1] + next[1]) * factor
  }
  if (Math.abs(area) < 0.00001) {
    return new THREE.Vector2(
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    )
  }
  return new THREE.Vector2(x / (3 * area), z / (3 * area))
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function appendTriangle(
  bucket: GeometryBucket,
  color: THREE.Color,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
) {
  bucket.positions.push(...a, ...b, ...c)
  for (let index = 0; index < 3; index += 1) bucket.colors.push(color.r, color.g, color.b)
}

function triangleNormalY(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
) {
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
}

function appendUpTriangle(
  bucket: GeometryBucket,
  color: THREE.Color,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
) {
  if (triangleNormalY(a, b, c) >= 0) appendTriangle(bucket, color, a, b, c)
  else appendTriangle(bucket, color, a, c, b)
}

function appendUpQuad(
  bucket: GeometryBucket,
  color: THREE.Color,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
) {
  appendUpTriangle(bucket, color, a, b, c)
  appendUpTriangle(bucket, color, a, c, d)
}

function appendBox(
  bucket: GeometryBucket,
  color: THREE.Color,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotationY = 0,
) {
  const [halfX, halfY, halfZ] = size.map((value) => value / 2)
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const transform = ([x, y, z]: readonly [number, number, number]) => [
    position[0] + x * cos + z * sin,
    position[1] + y,
    position[2] - x * sin + z * cos,
  ] as [number, number, number]
  const vertices = [
    transform([-halfX, -halfY, -halfZ]),
    transform([halfX, -halfY, -halfZ]),
    transform([halfX, -halfY, halfZ]),
    transform([-halfX, -halfY, halfZ]),
    transform([-halfX, halfY, -halfZ]),
    transform([halfX, halfY, -halfZ]),
    transform([halfX, halfY, halfZ]),
    transform([-halfX, halfY, halfZ]),
  ]
  const faces = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4],
    [1, 5, 6], [1, 6, 2],
  ]
  faces.forEach(([a, b, c]) => appendTriangle(bucket, color, vertices[a], vertices[b], vertices[c]))
}

function appendArchFace(
  bucket: GeometryBucket,
  color: THREE.Color,
  center: THREE.Vector2,
  direction: THREE.Vector2,
  outward: THREE.Vector2,
  bottomY: number,
  width: number,
  height: number,
  offset: number,
) {
  const radius = width / 2
  const springY = bottomY + height - radius
  const worldPoint = (x: number, y: number) => [
    center.x + direction.x * x + outward.x * offset,
    y,
    center.y + direction.y * x + outward.y * offset,
  ] as [number, number, number]
  const leftBottom = worldPoint(-radius, bottomY)
  const rightBottom = worldPoint(radius, bottomY)
  const rightSpring = worldPoint(radius, springY)
  const leftSpring = worldPoint(-radius, springY)
  appendTriangle(bucket, color, leftBottom, rightBottom, rightSpring)
  appendTriangle(bucket, color, leftBottom, rightSpring, leftSpring)
  const fanCenter = worldPoint(0, springY)
  for (let index = 0; index < 10; index += 1) {
    const first = (index / 10) * Math.PI
    const second = ((index + 1) / 10) * Math.PI
    appendTriangle(
      bucket,
      color,
      fanCenter,
      worldPoint(Math.cos(first) * radius, springY + Math.sin(first) * radius),
      worldPoint(Math.cos(second) * radius, springY + Math.sin(second) * radius),
    )
  }
}

function bucketMesh(bucket: GeometryBucket, material: THREE.Material, name: string) {
  const rawGeometry = new THREE.BufferGeometry()
  rawGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3))
  rawGeometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3))
  const geometry = mergeVertices(rawGeometry, 0.00001)
  rawGeometry.dispose()
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function exclusionRadius(poi: Poi) {
  if (poi.kind === "cathedral") return 3.8
  if (poi.kind === "townhall") return 2.5
  if (poi.kind === "church") return 1.9
  if (poi.kind === "tower") return 1.35
  if (poi.kind === "aqueduct" || poi.kind === "wall") return 0
  return 1.75
}

const STREET_SEGMENTS = STREETS.flatMap((street) =>
  street.points.slice(1).map((point, index) => ({
    a: street.points[index],
    b: point,
    width: street.width,
  })),
)

function pointToSegmentDistance(point: THREE.Vector2, a: Point2, b: Point2) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared
    ? THREE.MathUtils.clamp(((point.x - a[0]) * dx + (point.y - a[1]) * dz) / lengthSquared, 0, 1)
    : 0
  return Math.hypot(point.x - (a[0] + dx * t), point.y - (a[1] + dz * t))
}

function nearestStreetDistance(point: THREE.Vector2) {
  let distance = Number.POSITIVE_INFINITY
  for (const segment of STREET_SEGMENTS) {
    distance = Math.min(distance, pointToSegmentDistance(point, segment.a, segment.b))
  }
  return distance
}

function connectorClearsStreets(a: THREE.Vector2, b: THREE.Vector2) {
  for (let sample = 1; sample < 8; sample += 1) {
    const point = a.clone().lerp(b, sample / 8)
    for (const segment of STREET_SEGMENTS) {
      if (pointToSegmentDistance(point, segment.a, segment.b) < segment.width / 2 + 0.035) return false
    }
  }
  return true
}

function streetFacade(points: readonly Point2[], signedArea: number): Facade | null {
  let best: Facade | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.2) continue
    const direction = new THREE.Vector2(dx / length, dz / length)
    const outward = signedArea > 0
      ? new THREE.Vector2(direction.y, -direction.x)
      : new THREE.Vector2(-direction.y, direction.x)
    const midpoint = new THREE.Vector2((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    const distance = nearestStreetDistance(midpoint)
    const score = distance - Math.min(length, 2) * 0.035
    if (score < bestScore) {
      bestScore = score
      best = { a, b, direction, length, midpoint, outward }
    }
  }
  return best
}

function principalRoofFrame(points: readonly Point2[]): RoofFrame {
  const centroid = polygonCentroid(points)
  let xx = 0
  let xz = 0
  let zz = 0
  points.forEach(([x, z]) => {
    const dx = x - centroid.x
    const dz = z - centroid.y
    xx += dx * dx
    xz += dx * dz
    zz += dz * dz
  })
  let angle = 0.5 * Math.atan2(2 * xz, xx - zz)
  let u = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
  let v = new THREE.Vector2(-u.y, u.x)
  const project = (axis: THREE.Vector2) => points.map(([x, z]) => x * axis.x + z * axis.y)
  let alongU = project(u)
  let alongV = project(v)
  if (Math.max(...alongV) - Math.min(...alongV) > Math.max(...alongU) - Math.min(...alongU)) {
    angle += Math.PI / 2
    u = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
    v = new THREE.Vector2(-u.y, u.x)
    alongU = project(u)
    alongV = project(v)
  }
  const minU = Math.min(...alongU)
  const maxU = Math.max(...alongU)
  const minV = Math.min(...alongV)
  const maxV = Math.max(...alongV)
  return {
    center: u.clone().multiplyScalar((minU + maxU) / 2).add(v.clone().multiplyScalar((minV + maxV) / 2)),
    halfLength: (maxU - minU) / 2,
    halfWidth: (maxV - minV) / 2,
    u,
    v,
  }
}

function roofPoint(frame: RoofFrame, along: number, across: number, y: number) {
  return [
    frame.center.x + frame.u.x * along + frame.v.x * across,
    y,
    frame.center.y + frame.u.y * along + frame.v.y * across,
  ] as [number, number, number]
}

function appendFlatTerrace(
  surface: GeometryBucket,
  details: GeometryBucket,
  points: readonly Point2[],
  topY: number,
  roofColor: THREE.Color,
) {
  const vectors = points.map(([x, z]) => new THREE.Vector2(x, z))
  const faces = THREE.ShapeUtils.triangulateShape(vectors, [])
  const terraceY = topY + 0.055
  for (const face of faces) {
    const vertices = face.map((index) => [points[index][0], terraceY, points[index][1]] as [number, number, number])
    appendUpTriangle(surface, roofColor, vertices[0], vertices[1], vertices[2])
  }
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.12) continue
    appendBox(
      details,
      roofColor.clone().lerp(new THREE.Color(0xffe6bd), 0.24),
      [length, 0.15, 0.055],
      [(a[0] + b[0]) / 2, terraceY + 0.075, (a[1] + b[1]) / 2],
      -Math.atan2(dz, dx),
    )
  }
  return 0.2
}

function addFacadeDetails(
  details: GeometryBucket,
  buildingId: string,
  facade: Facade,
  buildingHeight: number,
  topY: number,
  wallColor: THREE.Color,
  plazaCenter: THREE.Vector2 | null,
  block: UrbanBlock,
  houseUnits = 1,
) {
  const hash = hashString(`${block.id}-${buildingId}`)
  const rotation = -Math.atan2(facade.direction.y, facade.direction.x)
  const trimColor = wallColor.clone().lerp(new THREE.Color(0xffeed0), 0.48)
  const darkTrim = new THREE.Color(0x6f4a36)
  const iron = new THREE.Color(0x3f4542)
  const windowColor = new THREE.Color(WINDOW_COLORS[hash % WINDOW_COLORS.length])
  const isPlazaArcade = Boolean(
    (plazaCenter && facade.midpoint.distanceTo(plazaCenter) < 4.8 && facade.length > 0.46) ||
    (block.style === "arcaded" && facade.length > 0.4) ||
    (block.style === "cloister" && facade.length > 0.62 && hash % 2 === 0),
  )

  appendBox(
    details,
    trimColor,
    [facade.length * 0.94, 0.055, 0.052],
    [
      facade.midpoint.x + facade.outward.x * 0.024,
      topY - 0.085,
      facade.midpoint.y + facade.outward.y * 0.024,
    ],
    rotation,
  )
  appendBox(
    details,
    wallColor.clone().multiplyScalar(0.8),
    [facade.length * 0.96, 0.1, 0.045],
    [
      facade.midpoint.x + facade.outward.x * 0.02,
      BASE_Y + 0.05,
      facade.midpoint.y + facade.outward.y * 0.02,
    ],
    rotation,
  )

  const slots = THREE.MathUtils.clamp(Math.floor(facade.length / 0.24), 1, 4)
  const slotSpacing = facade.length / (slots + 1)
  const floors = buildingHeight > 1.68 ? 3 : buildingHeight > 1.28 ? 2 : 1
  const available = Math.max(0.38, buildingHeight - 0.34)
  const floorSpacing = available / floors
  const windowWidth = THREE.MathUtils.clamp(slotSpacing * 0.48, 0.09, 0.18)
  const windowHeight = THREE.MathUtils.clamp(floorSpacing * 0.48, 0.16, 0.25)

  if (isPlazaArcade) {
    const archCount = THREE.MathUtils.clamp(Math.floor(facade.length / 0.36), 1, 4)
    const archSpacing = facade.length / (archCount + 1)
    appendBox(
      details,
      trimColor.clone().multiplyScalar(0.92),
      [facade.length * 0.98, 0.085, 0.18],
      [
        facade.midpoint.x + facade.outward.x * 0.085,
        BASE_Y + 0.51,
        facade.midpoint.y + facade.outward.y * 0.085,
      ],
      rotation,
    )
    for (let index = 0; index < archCount; index += 1) {
      const along = (index - (archCount - 1) / 2) * archSpacing
      const center = facade.midpoint.clone().addScaledVector(facade.direction, along)
      const archWidth = Math.min(0.31, archSpacing * 0.72)
      const archHeight = 0.48
      appendArchFace(
        details,
        new THREE.Color(0x493b34),
        center,
        facade.direction,
        facade.outward,
        BASE_Y + 0.028,
        archWidth - 0.075,
        archHeight - 0.055,
        0.034,
      )
      appendGeometry(
        details,
        trimColor,
        archRingGeometry(archWidth, archHeight, 0.045, 0.115),
        facadeMatrix({ ...facade, midpoint: center }, BASE_Y + 0.025, 0.082),
      )
    }
  } else {
    const doorCount = THREE.MathUtils.clamp(houseUnits, 1, slots)
    for (let door = 0; door < doorCount; door += 1) {
      const slot = doorCount === 1
        ? hash % slots
        : Math.round((door + 0.5) * slots / doorCount - 0.5)
      const doorAlong = (slot - (slots - 1) / 2) * slotSpacing
      const doorCenter = facade.midpoint.clone().addScaledVector(facade.direction, doorAlong)
      appendBox(
        details,
        trimColor,
        [0.205, 0.39, 0.05],
        [doorCenter.x + facade.outward.x * 0.027, BASE_Y + 0.195, doorCenter.y + facade.outward.y * 0.027],
        rotation,
      )
      appendBox(
        details,
        darkTrim,
        [0.15, 0.345, 0.045],
        [doorCenter.x + facade.outward.x * 0.046, BASE_Y + 0.177, doorCenter.y + facade.outward.y * 0.046],
        rotation,
      )
    }
  }

  if (houseUnits > 1) {
    for (let unit = 1; unit < houseUnits; unit += 1) {
      const along = -facade.length / 2 + (unit / houseUnits) * facade.length
      const center = facade.midpoint.clone().addScaledVector(facade.direction, along)
      appendBox(
        details,
        trimColor.clone().multiplyScalar(0.9),
        [0.032, buildingHeight * 0.9, 0.038],
        [center.x + facade.outward.x * 0.03, BASE_Y + buildingHeight * 0.46, center.y + facade.outward.y * 0.03],
        rotation,
      )
    }
  }

  for (let floor = 0; floor < floors; floor += 1) {
    const y = BASE_Y + 0.41 + floor * floorSpacing
    if (y + windowHeight / 2 > topY - 0.16) continue
    for (let index = 0; index < slots; index += 1) {
      if (!isPlazaArcade && floor === 0) {
        const doorCount = THREE.MathUtils.clamp(houseUnits, 1, slots)
        const doorSlots = new Set(Array.from({ length: doorCount }, (_, door) => doorCount === 1
          ? hash % slots
          : Math.round((door + 0.5) * slots / doorCount - 0.5)))
        if (doorSlots.has(index)) continue
      }
      const along = (index - (slots - 1) / 2) * slotSpacing
      const center = facade.midpoint.clone().addScaledVector(facade.direction, along)
      appendBox(
        details,
        trimColor,
        [windowWidth + 0.052, windowHeight + 0.052, 0.043],
        [center.x + facade.outward.x * 0.026, y, center.y + facade.outward.y * 0.026],
        rotation,
      )
      appendBox(
        details,
        windowColor,
        [windowWidth, windowHeight, 0.04],
        [center.x + facade.outward.x * 0.046, y, center.y + facade.outward.y * 0.046],
        rotation,
      )
      appendBox(
        details,
        trimColor.clone().multiplyScalar(0.9),
        [windowWidth * 0.12, windowHeight, 0.044],
        [center.x + facade.outward.x * 0.05, y, center.y + facade.outward.y * 0.05],
        rotation,
      )
      if ((hash + index + floor) % 4 === 0 && facade.length > 0.42) {
        for (const side of [-1, 1]) {
          const shutterCenter = center.clone().addScaledVector(facade.direction, side * (windowWidth * 0.72))
          appendBox(
            details,
            windowColor.clone().multiplyScalar(0.84),
            [windowWidth * 0.3, windowHeight + 0.018, 0.038],
            [shutterCenter.x + facade.outward.x * 0.048, y, shutterCenter.y + facade.outward.y * 0.048],
            rotation,
          )
        }
      }
    }
  }

  if (facade.length > 0.52 && buildingHeight > 1.34 && hash % 7 === 2) {
    const oculusY = topY - 0.24
    const oculusRadius = THREE.MathUtils.clamp(facade.length * 0.08, 0.075, 0.12)
    appendGeometry(
      details,
      windowColor.clone().multiplyScalar(0.72),
      new THREE.CircleGeometry(oculusRadius, 28),
      facadeMatrix(facade, oculusY, 0.054),
    )
    appendGeometry(
      details,
      trimColor,
      new THREE.TorusGeometry(oculusRadius + 0.025, 0.022, 8, 32),
      facadeMatrix(facade, oculusY, 0.069),
    )
  }

  if (
    facade.length > 0.72 &&
    floors >= 2 &&
    (hash % 3 === 0 || isPlazaArcade || block.style === "lookout")
  ) {
    const balconyWidth = Math.min(0.56, facade.length * 0.58)
    const balconyY = BASE_Y + 0.41 + floorSpacing - windowHeight / 2 - 0.05
    const projection = 0.14
    appendBox(
      details,
      trimColor,
      [balconyWidth, 0.055, projection],
      [
        facade.midpoint.x + facade.outward.x * (projection / 2 + 0.045),
        balconyY,
        facade.midpoint.y + facade.outward.y * (projection / 2 + 0.045),
      ],
      rotation,
    )
    appendBox(
      details,
      iron,
      [balconyWidth, 0.025, 0.025],
      [
        facade.midpoint.x + facade.outward.x * (projection + 0.055),
        balconyY + 0.17,
        facade.midpoint.y + facade.outward.y * (projection + 0.055),
      ],
      rotation,
    )
    for (let rail = -2; rail <= 2; rail += 1) {
      const railCenter = facade.midpoint.clone().addScaledVector(facade.direction, rail * balconyWidth / 5)
      appendBox(
        details,
        iron,
        [0.018, 0.31, 0.018],
        [
          railCenter.x + facade.outward.x * (projection + 0.055),
          balconyY + 0.145,
          railCenter.y + facade.outward.y * (projection + 0.055),
        ],
        rotation,
      )
    }
  }
}

type BlockModule = {
  building: UrbanBuilding
  center: THREE.Vector2
  facade: Facade | null
  frame: RoofFrame
  roofColor: THREE.Color
  roofHeight: number
  topY: number
  wallColor: THREE.Color
}

function blockWallColor(block: UrbanBlock, buildingIndex: number) {
  const palette = DISTRICT_PALETTES[block.district] ?? WALL_COLORS
  const color = new THREE.Color(palette[(buildingIndex + block.palette + block.rhythm) % palette.length])
  const lightnessShift = ((buildingIndex * 3 + block.rhythm) % 5 - 2) * 0.018
  color.offsetHSL(((block.palette % 3) - 1) * 0.006, 0, lightnessShift)
  return color
}

function blockRoofColor(block: UrbanBlock, buildingIndex: number) {
  const color = new THREE.Color(ROOF_COLORS[(block.accent + Math.floor(buildingIndex / 3)) % ROOF_COLORS.length])
  color.offsetHSL(((block.rhythm % 3) - 1) * 0.008, 0, ((buildingIndex + block.rhythm) % 3 - 1) * 0.018)
  return color
}

function blockBuildingHeight(block: UrbanBlock, building: UrbanBuilding, center: THREE.Vector2, index: number) {
  const width = Math.max(0.5, block.bounds[2] - block.bounds[0])
  const depth = Math.max(0.5, block.bounds[3] - block.bounds[1])
  const nx = (center.x - block.center[0]) / width
  const nz = (center.y - block.center[1]) / depth
  const wave = Math.sin((index + 1) * (block.rhythm + 1) * 1.37) * 0.105
  let composition = 0
  if (block.style === "stepped") composition = (nx + nz) * 0.48
  if (block.style === "courtyard") composition = Math.min(0.18, Math.hypot(nx, nz) * 0.32) - 0.08
  if (block.style === "arcaded") composition = Math.cos(index * 1.9) * 0.08
  if (block.style === "towered") composition = building.id === block.landmarkId ? 0.22 : -0.04
  if (block.style === "terraced") composition = (index % 3) * 0.075 - 0.08
  if (block.style === "bridged") composition = Math.sin(index * 0.8) * 0.12
  if (block.style === "garden") composition = -0.04 + Math.abs(nx) * 0.12
  if (block.style === "lookout") composition = building.id === block.landmarkId ? 0.18 : nz * 0.16
  if (block.style === "cloister") composition = -0.06 + Math.hypot(nx, nz) * 0.16
  if (block.style === "gabled") composition = Math.cos((index + block.rhythm) * 1.35) * 0.13
  const districtLift = block.district === "Plaza Mayor" ? 0.18 : block.district === "Catedral" ? 0.08 : 0
  return THREE.MathUtils.clamp(building.height * 0.86 + 0.2 + block.heightBias + wave + composition + districtLift, 1.02, 2.52)
}

function appendBlockConnectors(surface: GeometryBucket, block: UrbanBlock, modules: readonly BlockModule[]) {
  if (modules.length < 2) return
  const linked = new Set<number>([0])
  let elevatedBridges = 0
  while (linked.size < modules.length) {
    let best: { from: number; to: number; distance: number } | null = null
    for (const from of linked) {
      for (let to = 0; to < modules.length; to += 1) {
        if (linked.has(to)) continue
        const distance = modules[from].center.distanceTo(modules[to].center)
        if (!best || distance < best.distance) best = { from, to, distance }
      }
    }
    if (!best) break
    linked.add(best.to)
    const from = modules[best.from]
    const to = modules[best.to]
    if (best.distance > 2.2 || !connectorClearsStreets(from.center, to.center)) continue
    const midpoint = from.center.clone().lerp(to.center, 0.5)
    const direction = to.center.clone().sub(from.center).normalize()
    const rotation = -Math.atan2(direction.y, direction.x)
    const color = blockWallColor(block, best.to).lerp(blockWallColor(block, best.from), 0.5)
    appendBox(
      surface,
      color.clone().multiplyScalar(0.9),
      [best.distance + 0.12, 0.12, block.style === "courtyard" ? 0.24 : 0.16],
      [midpoint.x, BASE_Y + 0.06, midpoint.y],
      rotation,
    )
    if (block.style === "bridged" && elevatedBridges < 4 && best.distance > 0.48) {
      const bridgeY = Math.min(from.topY, to.topY) - 0.24
      appendBox(
        surface,
        from.roofColor.clone().lerp(to.roofColor, 0.5),
        [best.distance + 0.08, 0.2, 0.24],
        [midpoint.x, bridgeY, midpoint.y],
        rotation,
      )
      elevatedBridges += 1
    }
  }
}

function appendBlockSignature(
  surface: GeometryBucket,
  block: UrbanBlock,
  module: BlockModule,
) {
  const frame = module.frame
  const center = frame.center
  const rotation = -Math.atan2(frame.u.y, frame.u.x)
  const base = module.topY + 0.16
  const trim = module.wallColor.clone().lerp(new THREE.Color(0xffe7b9), 0.45)
  const dark = new THREE.Color(0x4c4b46)
  const smallLength = THREE.MathUtils.clamp(frame.halfLength * 0.92, 0.24, 0.62)
  const smallWidth = THREE.MathUtils.clamp(frame.halfWidth * 0.95, 0.22, 0.5)

  if (block.style === "towered") {
    appendBox(surface, trim, [smallLength, 0.82, smallWidth], [center.x, base + 0.41, center.y], rotation)
    const capColor = module.roofColor.clone().lerp(new THREE.Color(0xf1ddba), 0.62)
    appendBox(
      surface,
      capColor,
      [smallLength + 0.13, 0.1, smallWidth + 0.13],
      [center.x, base + 0.87, center.y],
      rotation,
    )
    for (const along of [-smallLength * 0.38, smallLength * 0.38]) {
      for (const across of [-smallWidth * 0.38, smallWidth * 0.38]) {
        const post = roofPoint(frame, along, across, base + 0.98)
        appendBox(surface, trim, [0.075, 0.18, 0.075], post, rotation)
      }
    }
    return
  }

  if (block.style === "garden") {
    for (let index = -1; index <= 1; index += 1) {
      const planter = center.clone().addScaledVector(frame.u, index * smallLength * 0.33)
      appendBox(surface, module.roofColor.clone().multiplyScalar(0.78), [0.19, 0.11, 0.2], [planter.x, base + 0.055, planter.y], rotation)
      appendBox(surface, new THREE.Color(index ? 0x6d9a52 : 0x8ab85f), [0.14, 0.22 + (index === 0 ? 0.08 : 0), 0.14], [planter.x, base + 0.21, planter.y], rotation)
    }
    return
  }

  if (block.style === "lookout" || block.style === "courtyard") {
    const canopyY = base + (block.style === "lookout" ? 0.58 : 0.4)
    for (const along of [-smallLength / 2, smallLength / 2]) {
      for (const across of [-smallWidth / 2, smallWidth / 2]) {
        const post = roofPoint(frame, along, across, canopyY - 0.2)
        appendBox(surface, trim, [0.055, block.style === "lookout" ? 0.72 : 0.42, 0.055], post, rotation)
      }
    }
    appendBox(surface, module.roofColor, [smallLength + 0.18, 0.1, smallWidth + 0.18], [center.x, canopyY + 0.16, center.y], rotation)
    return
  }

  if (block.style === "cloister") {
    const count = 5
    for (let index = 0; index < count; index += 1) {
      const along = -smallLength / 2 + (index / (count - 1)) * smallLength
      const post = roofPoint(frame, along, -smallWidth / 2, base + 0.2)
      appendBox(surface, trim, [0.045, 0.42, 0.045], post, rotation)
    }
    const beam = roofPoint(frame, 0, -smallWidth / 2, base + 0.42)
    appendBox(surface, trim, [smallLength + 0.08, 0.08, 0.07], beam, rotation)
    return
  }

  if (block.style === "stepped" || block.style === "terraced") {
    for (let index = 0; index < 3; index += 1) {
      const stepCenter = center.clone().addScaledVector(frame.u, (index - 1) * smallLength * 0.3)
      const height = 0.16 + index * 0.12
      appendBox(surface, index === 2 ? module.roofColor : trim, [smallLength * 0.34, height, smallWidth * 0.72], [stepCenter.x, base + height / 2, stepCenter.y], rotation)
    }
    return
  }

  if (block.style === "arcaded") {
    appendBox(surface, trim, [smallLength, 0.34, smallWidth], [center.x, base + 0.17, center.y], rotation)
    appendArchFace(surface, dark, center, frame.u, frame.v, base, Math.min(0.3, smallLength * 0.55), 0.29, smallWidth / 2 + 0.015)
    return
  }

  if (block.style === "gabled" && module.facade) {
    const facade = module.facade
    const facadeWidth = THREE.MathUtils.clamp(facade.length * 0.58, 0.46, 0.9)
    const facadeRotation = -Math.atan2(facade.direction.y, facade.direction.x)
    appendBox(
      surface,
      module.wallColor.clone().lerp(trim, 0.35),
      [facadeWidth, 0.34, 0.14],
      [
        facade.midpoint.x + facade.outward.x * 0.075,
        module.topY + 0.1,
        facade.midpoint.y + facade.outward.y * 0.075,
      ],
      facadeRotation,
    )
    for (const side of [-1, 1]) {
      const eyeCenter = facade.midpoint.clone().addScaledVector(facade.direction, side * facadeWidth * 0.18)
      const eyeFacade = { ...facade, midpoint: eyeCenter }
      appendGeometry(
        surface,
        dark,
        new THREE.CircleGeometry(0.065, 24),
        facadeMatrix(eyeFacade, module.topY + 0.1, 0.16),
      )
      appendGeometry(
        surface,
        trim,
        new THREE.TorusGeometry(0.087, 0.018, 8, 28),
        facadeMatrix(eyeFacade, module.topY + 0.1, 0.178),
      )
    }
    const orielY = module.topY - 0.48
    appendBox(
      surface,
      trim,
      [facadeWidth * 0.62, 0.54, 0.24],
      [
        facade.midpoint.x + facade.outward.x * 0.13,
        orielY,
        facade.midpoint.y + facade.outward.y * 0.13,
      ],
      facadeRotation,
    )
    appendBox(
      surface,
      dark,
      [facadeWidth * 0.42, 0.27, 0.035],
      [
        facade.midpoint.x + facade.outward.x * 0.265,
        orielY + 0.04,
        facade.midpoint.y + facade.outward.y * 0.265,
      ],
      facadeRotation,
    )
    if (hashString(block.id) % 2 === 0) {
      const turretCenter = facade.midpoint.clone().addScaledVector(facade.direction, facadeWidth * 0.55)
      const turretHeight = 0.92
      appendGeometry(
        surface,
        trim,
        new THREE.CylinderGeometry(0.18, 0.2, turretHeight, 28),
        new THREE.Matrix4().makeTranslation(
          turretCenter.x + facade.outward.x * 0.08,
          module.topY - 0.18,
          turretCenter.y + facade.outward.y * 0.08,
        ),
      )
      appendGeometry(
        surface,
        module.roofColor.clone().lerp(new THREE.Color(0xf1ddba), 0.62),
        new THREE.CylinderGeometry(0.25, 0.25, 0.11, 32),
        new THREE.Matrix4().makeTranslation(
          turretCenter.x + facade.outward.x * 0.08,
          module.topY + 0.335,
          turretCenter.y + facade.outward.y * 0.08,
        ),
      )
    }
    return
  }

  for (let index = -1; index <= 1; index += 1) {
    const chimney = center.clone().addScaledVector(frame.u, index * smallLength * 0.34)
    appendBox(surface, trim, [0.105, 0.32 + (index === 0 ? 0.1 : 0), 0.105], [chimney.x, base + 0.16, chimney.y], rotation)
  }
}

export function buildUrbanBuildings(pois: readonly Poi[]) {
  const group = new THREE.Group()
  group.name = "Barrios y manzanas monumentales del recinto intramuros"
  const blockMaterial = toonMaterial(0xffffff, true, true)
  const roofLineMaterial = new THREE.LineBasicMaterial({ color: 0x82694d, opacity: 0.24, transparent: true })
  const buildingById = new Map(URBAN_BUILDINGS.map((building) => [building.id, building]))
  const plazaCenter = pois.find((poi) => poi.id === "plaza-mayor")
  const plazaPoint = plazaCenter ? new THREE.Vector2(...plazaCenter.position) : null

  for (const block of URBAN_BLOCKS) {
    const surface: GeometryBucket = { positions: [], colors: [] }
    const bodyGeometries: THREE.BufferGeometry[] = []
    const roofLines: number[] = []
    const modules: BlockModule[] = []
    const sourceBuildings = block.buildingIds
      .map((id) => buildingById.get(id))
      .filter((building): building is UrbanBuilding => Boolean(building))
      .filter((building) => {
        const center = polygonCentroid(building.points)
        return !pois.some((poi) => {
          const radius = exclusionRadius(poi)
          return radius > 0 && center.distanceTo(new THREE.Vector2(...poi.position)) < radius
        })
      })
    if (!sourceBuildings.length) continue

    if (block.id === MASTER_CLAY_BLOCK_ID) {
      group.add(buildMasterClayBlock(block, sourceBuildings))
      continue
    }

    sourceBuildings.forEach((building, buildingIndex) => {
      const center = polygonCentroid(building.points)
      const signedArea = polygonArea(building.points)
      const area = Math.abs(signedArea)
      const buildingHeight = blockBuildingHeight(block, building, center, buildingIndex)
      const topY = BASE_Y + buildingHeight
      const wallColor = blockWallColor(block, buildingIndex)
      const roofColor = blockRoofColor(block, buildingIndex)

      bodyGeometries.push(clayFootprintGeometry(building.points, buildingHeight, wallColor))
      for (let index = 0; index < building.points.length; index += 1) {
        const a = building.points[index]
        const b = building.points[(index + 1) % building.points.length]
        roofLines.push(a[0], topY + 0.215, a[1], b[0], topY + 0.215, b[1])
      }

      const frame = principalRoofFrame(building.points)
      const terraceColor = wallColor.clone().lerp(new THREE.Color(0xf1ddba), 0.52)
      const roofHeight = appendFlatTerrace(surface, surface, building.points, topY, terraceColor)

      const facade = streetFacade(building.points, signedArea)
      if (facade) {
        addFacadeDetails(
          surface,
          building.id,
          facade,
          buildingHeight,
          topY,
          wallColor,
          plazaPoint,
          block,
          sourceBuildings.length === 1 ? 3 : 1,
        )
      }

      const hash = hashString(`${block.id}-${building.id}`)
      if (area > 0.16 && hash % 4 === 0) {
        const chimneyAlong = ((hash % 7) / 6 - 0.5) * frame.halfLength
        const chimneyAcross = (((hash >>> 3) % 5) / 4 - 0.5) * frame.halfWidth * 0.5
        const chimney = roofPoint(
          frame,
          chimneyAlong,
          chimneyAcross,
          topY + roofHeight + 0.13,
        )
        const chimneyColor = wallColor.clone().lerp(new THREE.Color(0xf5dfba), 0.55)
        appendBox(surface, chimneyColor, [0.115, 0.32, 0.115], chimney, 0)
        appendBox(surface, roofColor.clone().multiplyScalar(0.78), [0.145, 0.055, 0.145], [chimney[0], chimney[1] + 0.18, chimney[2]], 0)
      }

      modules.push({ building, center, facade, frame, roofColor, roofHeight, topY, wallColor })
    })

    appendBlockConnectors(surface, block, modules)
    const landmark = modules.find((module) => module.building.id === block.landmarkId) ??
      [...modules].sort((left, right) => right.frame.halfLength * right.frame.halfWidth - left.frame.halfLength * left.frame.halfWidth)[0]
    if (landmark) appendBlockSignature(surface, block, landmark)

    const blockGroup = new THREE.Group()
    blockGroup.name = `${block.name} · ${block.district} · ${block.style}`
    blockGroup.userData = {
      blockId: block.id,
      district: block.district,
      sourceBuildings: sourceBuildings.length,
      style: block.style,
    }
    const bodyGeometry = mergeGeometries(bodyGeometries)
    bodyGeometries.forEach((geometry) => geometry.dispose())
    if (bodyGeometry) {
      const body = new THREE.Mesh(bodyGeometry, blockMaterial)
      body.name = `${block.name} · volúmenes de arcilla redondeados`
      body.castShadow = true
      body.receiveShadow = true
      blockGroup.add(body)
    }
    blockGroup.add(bucketMesh(surface, blockMaterial, `${block.name} · conjunto urbano unido`))
    if (roofLines.length) {
      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(roofLines, 3))
      const lines = new THREE.LineSegments(lineGeometry, roofLineMaterial)
      lines.name = `${block.name} · pretiles de azotea`
      lines.renderOrder = 4
      blockGroup.add(lines)
    }
    group.add(blockGroup)
  }
  return group
}

function ribbonGeometry(points: readonly Point2[], width: number, y: number) {
  const positions: number[] = []
  const indices: number[] = []
  points.forEach(([x, z], index) => {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next[0] - previous[0]
    const dz = next[1] - previous[1]
    const length = Math.hypot(dx, dz) || 1
    const nx = (-dz / length) * (width / 2)
    const nz = (dx / length) * (width / 2)
    positions.push(x + nx, y, z + nz, x - nx, y, z - nz)
    if (index < points.length - 1) {
      const base = index * 2
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function buildStreetNetwork() {
  const group = new THREE.Group()
  group.name = "Red viaria completa del casco histórico"
  const edges = mergeGeometries(STREETS.map((street) => ribbonGeometry(street.points, street.width + 0.2, 0.37)))
  const surfaces = mergeGeometries(STREETS.map((street) => ribbonGeometry(street.points, street.width, 0.395)))
  if (edges) {
    const mesh = new THREE.Mesh(edges, toonMaterial(0xb59d78))
    mesh.receiveShadow = true
    group.add(mesh)
  }
  if (surfaces) {
    const mesh = new THREE.Mesh(surfaces, toonMaterial(0xe6d1aa))
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

export function buildPlazas() {
  const geometries = URBAN_PLAZAS.map((plaza) => {
    const shape = new THREE.Shape()
    shape.moveTo(plaza.points[0][0], plaza.points[0][1])
    plaza.points.slice(1).forEach(([x, z]) => shape.lineTo(x, z))
    shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape, 12)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(0, 0.41, 0)
    return geometry
  })
  const merged = mergeGeometries(geometries)
  const plazas = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), toonMaterial(0xd9c297))
  plazas.name = "Plazas y espacios abiertos"
  plazas.receiveShadow = true

  const palePavers: THREE.BufferGeometry[] = []
  const warmPavers: THREE.BufferGeometry[] = []
  URBAN_PLAZAS.forEach((plaza, plazaIndex) => {
    const xs = plaza.points.map((point) => point[0])
    const zs = plaza.points.map((point) => point[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    const stepX = 0.42
    const stepZ = 0.31
    let row = 0
    for (let z = minZ + stepZ / 2; z < maxZ; z += stepZ) {
      const stagger = row % 2 ? stepX / 2 : 0
      let column = 0
      for (let x = minX + stepX / 2 - stagger; x < maxX; x += stepX) {
        if (!pointInPolygon([x, z], plaza.points)) continue
        const geometry = transformedRoundedBox(
          [0.35, 0.045, 0.235],
          [x, 0.438, z],
          ((column + row + plazaIndex) % 3 - 1) * 0.025,
          0.035,
          2,
        )
        if ((column + row + plazaIndex) % 2) warmPavers.push(geometry)
        else palePavers.push(geometry)
        column += 1
      }
      row += 1
    }
  })

  const group = new THREE.Group()
  group.name = "Plazas pavimentadas con piezas de arcilla"
  group.add(plazas)
  const paleGeometry = mergeNonIndexed(palePavers)
  const warmGeometry = mergeNonIndexed(warmPavers)
  palePavers.forEach((geometry) => geometry.dispose())
  warmPavers.forEach((geometry) => geometry.dispose())
  if (paleGeometry) group.add(new THREE.Mesh(paleGeometry, toonMaterial(0xe4d1ad)))
  if (warmGeometry) group.add(new THREE.Mesh(warmGeometry, toonMaterial(0xcfb68e)))
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.receiveShadow = true
  })
  return group
}

function transformedRoundedBox(
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotationY: number,
  radius: number,
  segments = 2,
) {
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius)
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(1, 1, 1),
  )
  geometry.applyMatrix4(matrix)
  return geometry
}

function mergeNonIndexed(geometries: THREE.BufferGeometry[]) {
  if (!geometries.length) return null
  const indexed = geometries.filter((geometry) => Boolean(geometry.index)).length
  if (indexed > 0 && indexed < geometries.length) {
    return mergeGeometries(geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry))
  }
  return mergeGeometries(geometries)
}

function nearestBoundaryFrame(point: Point2) {
  let result = {
    distance: Number.POSITIVE_INFINITY,
    direction: new THREE.Vector2(1, 0),
    point: new THREE.Vector2(point[0], point[1]),
    segmentIndex: 0,
    t: 0,
  }
  for (let index = 0; index < CITY_POLYGON.length; index += 1) {
    const a = CITY_POLYGON[index]
    const b = CITY_POLYGON[(index + 1) % CITY_POLYGON.length]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const lengthSquared = dx * dx + dz * dz
    const t = lengthSquared
      ? THREE.MathUtils.clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared, 0, 1)
      : 0
    const projected = new THREE.Vector2(a[0] + dx * t, a[1] + dz * t)
    const distance = projected.distanceTo(new THREE.Vector2(point[0], point[1]))
    if (distance < result.distance) {
      result = {
        distance,
        direction: new THREE.Vector2(dx, dz).normalize(),
        point: projected,
        segmentIndex: index,
        t,
      }
    }
  }
  return result
}

function archRingGeometry(width: number, height: number, thickness: number, depth: number) {
  const outerRadius = width / 2
  const innerRadius = Math.max(0.08, outerRadius - thickness)
  const outerSpring = height - outerRadius
  const innerSpring = outerSpring
  const shape = new THREE.Shape()
  shape.moveTo(-outerRadius, 0)
  shape.lineTo(outerRadius, 0)
  shape.lineTo(outerRadius, outerSpring)
  shape.absarc(0, outerSpring, outerRadius, 0, Math.PI, false)
  shape.lineTo(-outerRadius, 0)
  const hole = new THREE.Path()
  hole.moveTo(-innerRadius, 0)
  hole.lineTo(-innerRadius, innerSpring)
  hole.absarc(0, innerSpring, innerRadius, Math.PI, 0, true)
  hole.lineTo(innerRadius, 0)
  hole.closePath()
  shape.holes.push(hole)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    curveSegments: 12,
    depth,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

export function buildHistoricWall() {
  const baseY = 0.38
  const wallHeight = 1.5
  const wallWidth = 0.66
  const wallBodies: THREE.BufferGeometry[] = []
  const merlons: THREE.BufferGeometry[] = []
  const towerBodies: THREE.BufferGeometry[] = []
  const towerCrowns: THREE.BufferGeometry[] = []
  const gateFrames: THREE.BufferGeometry[] = []
  const stoneDetails: GeometryBucket = { positions: [], colors: [] }
  const cityOrientation = polygonArea(CITY_POLYGON)
  const gatePlacements = GATES.map((gate) => ({ gate, frame: nearestBoundaryFrame(gate.position) }))

  const appendWallSection = (a: THREE.Vector2, b: THREE.Vector2, outward: THREE.Vector2) => {
    const dx = b.x - a.x
    const dz = b.y - a.y
    const length = Math.hypot(dx, dz)
    if (length < 0.08) return
    const angle = -Math.atan2(dz, dx)
    wallBodies.push(transformedRoundedBox(
      [length + 0.06, wallHeight, wallWidth],
      [(a.x + b.x) / 2, baseY + wallHeight / 2, (a.y + b.y) / 2],
      angle,
      0.085,
      2,
    ))
    const count = Math.max(1, Math.floor(length / 0.82))
    for (let step = 0; step <= count; step += 1) {
      const t = step / count
      merlons.push(transformedRoundedBox(
        [0.38, 0.34, wallWidth + 0.12],
        [a.x + dx * t, baseY + wallHeight + 0.17, a.y + dz * t],
        angle,
        0.055,
        2,
      ))
    }
    const blocks = Math.max(1, Math.floor(length / 2.4))
    const blockColor = new THREE.Color(0xa78962)
    for (let step = 0; step < blocks; step += 1) {
      const t = (step + 0.5) / blocks
      const offset = step % 2 ? 0.13 : -0.16
      const center = new THREE.Vector2(a.x + dx * t, a.y + dz * t)
      appendBox(
        stoneDetails,
        blockColor,
        [0.46, 0.15, 0.045],
        [
          center.x + outward.x * (wallWidth / 2 + 0.018),
          baseY + 0.48 + (step % 3) * 0.34 + offset,
          center.y + outward.y * (wallWidth / 2 + 0.018),
        ],
        angle,
      )
    }
  }

  for (let index = 0; index < CITY_POLYGON.length; index += 1) {
    const a = CITY_POLYGON[index]
    const b = CITY_POLYGON[(index + 1) % CITY_POLYGON.length]
    const segment = new THREE.Vector2(b[0] - a[0], b[1] - a[1])
    const length = segment.length()
    if (length < 0.08) continue
    const direction = segment.clone().normalize()
    const outward = cityOrientation > 0
      ? new THREE.Vector2(direction.y, -direction.x)
      : new THREE.Vector2(-direction.y, direction.x)
    const intervals = gatePlacements
      .filter(({ frame }) => frame.segmentIndex === index)
      .map(({ frame }) => ({ start: Math.max(0, frame.t - 1.02 / length), end: Math.min(1, frame.t + 1.02 / length) }))
      .sort((left, right) => left.start - right.start)
    let cursor = 0
    for (const interval of intervals) {
      if (interval.start > cursor) {
        appendWallSection(
          new THREE.Vector2(a[0], a[1]).addScaledVector(segment, cursor),
          new THREE.Vector2(a[0], a[1]).addScaledVector(segment, interval.start),
          outward,
        )
      }
      cursor = Math.max(cursor, interval.end)
    }
    if (cursor < 1) {
      appendWallSection(
        new THREE.Vector2(a[0], a[1]).addScaledVector(segment, cursor),
        new THREE.Vector2(b[0], b[1]),
        outward,
      )
    }
  }

  const cornerIndices = CITY_POLYGON
    .map((point, index) => ({ index, point }))
    .filter(({ index }) => index % 2 === 0)
  cornerIndices.forEach(({ index, point }) => {
    const previous = CITY_POLYGON[(index - 1 + CITY_POLYGON.length) % CITY_POLYGON.length]
    const next = CITY_POLYGON[(index + 1) % CITY_POLYGON.length]
    const directionA = new THREE.Vector2(point[0] - previous[0], point[1] - previous[1]).normalize()
    const directionB = new THREE.Vector2(next[0] - point[0], next[1] - point[1]).normalize()
    const outwardA = cityOrientation > 0
      ? new THREE.Vector2(directionA.y, -directionA.x)
      : new THREE.Vector2(-directionA.y, directionA.x)
    const outwardB = cityOrientation > 0
      ? new THREE.Vector2(directionB.y, -directionB.x)
      : new THREE.Vector2(-directionB.y, directionB.x)
    const outward = outwardA.add(outwardB).normalize()
    const center = new THREE.Vector2(point[0], point[1]).addScaledVector(outward, 0.18)
    const towerHeight = 2.18
    towerBodies.push(new THREE.CylinderGeometry(0.78, 0.88, towerHeight, 40, 1).translate(center.x, baseY + towerHeight / 2, center.y))
    towerCrowns.push(new THREE.CylinderGeometry(0.91, 0.91, 0.16, 40, 1).translate(center.x, baseY + towerHeight - 0.06, center.y))
    for (let merlon = 0; merlon < 8; merlon += 1) {
      const angle = (merlon / 8) * Math.PI * 2
      const x = center.x + Math.cos(angle) * 0.73
      const z = center.y + Math.sin(angle) * 0.73
      towerCrowns.push(transformedRoundedBox(
        [0.35, 0.36, 0.3],
        [x, baseY + towerHeight + 0.17, z],
        -angle,
        0.045,
        2,
      ))
    }
    const slitYaw = Math.atan2(outward.x, outward.y)
    appendBox(
      stoneDetails,
      new THREE.Color(0x59473a),
      [0.13, 0.38, 0.04],
      [center.x + outward.x * 0.875, baseY + 1.1, center.y + outward.y * 0.875],
      slitYaw,
    )
  })

  gatePlacements.forEach(({ frame }) => {
    const center = frame.point
    const direction = frame.direction
    const angle = -Math.atan2(direction.y, direction.x)
    const towerHeight = 2.34
    for (const side of [-1, 1]) {
      const tower = center.clone().addScaledVector(direction, side * 1.05)
      towerBodies.push(new THREE.CylinderGeometry(0.69, 0.78, towerHeight, 40, 1).translate(tower.x, baseY + towerHeight / 2, tower.y))
      towerCrowns.push(new THREE.CylinderGeometry(0.81, 0.81, 0.16, 40, 1).translate(tower.x, baseY + towerHeight - 0.06, tower.y))
      for (let merlon = 0; merlon < 8; merlon += 1) {
        const merlonAngle = (merlon / 8) * Math.PI * 2
        towerCrowns.push(transformedRoundedBox(
          [0.3, 0.34, 0.27],
          [
            tower.x + Math.cos(merlonAngle) * 0.65,
            baseY + towerHeight + 0.16,
            tower.y + Math.sin(merlonAngle) * 0.65,
          ],
          -merlonAngle,
          0.04,
          2,
        ))
      }
    }
    wallBodies.push(transformedRoundedBox(
      [1.6, 0.66, 0.74],
      [center.x, baseY + 1.78, center.y],
      angle,
      0.08,
      2,
    ))
    const arch = archRingGeometry(1.34, 1.63, 0.18, 0.18)
    arch.rotateY(angle)
    arch.translate(center.x, baseY + 0.02, center.y)
    gateFrames.push(arch)
    for (let merlon = -1; merlon <= 1; merlon += 1) {
      const merlonCenter = center.clone().addScaledVector(direction, merlon * 0.54)
      merlons.push(transformedRoundedBox(
        [0.34, 0.34, 0.84],
        [merlonCenter.x, baseY + 2.28, merlonCenter.y],
        angle,
        0.05,
        2,
      ))
    }
  })

  const group = new THREE.Group()
  group.name = "Muralla toy completa con torres y puertas"
  const bodyGeometry = mergeNonIndexed(wallBodies)
  const merlonGeometry = mergeNonIndexed(merlons)
  const towerGeometry = mergeNonIndexed(towerBodies)
  const crownGeometry = mergeNonIndexed(towerCrowns)
  const gateGeometry = mergeNonIndexed(gateFrames)
  if (bodyGeometry) group.add(new THREE.Mesh(bodyGeometry, toonMaterial(0xc5a77b)))
  if (merlonGeometry) group.add(new THREE.Mesh(merlonGeometry, toonMaterial(0xddc092)))
  if (towerGeometry) group.add(new THREE.Mesh(towerGeometry, toonMaterial(0xc9ad82)))
  if (crownGeometry) group.add(new THREE.Mesh(crownGeometry, toonMaterial(0xe0c398)))
  if (gateGeometry) group.add(new THREE.Mesh(gateGeometry, toonMaterial(0xe5c99b, false, true)))
  group.add(bucketMesh(stoneDetails, toonMaterial(0xffffff, true, true), "Relieves y saeteras de la muralla"))
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  return group
}
