"use client"

import { useEffect, useRef, useState } from "react"
import {
  Building2,
  Compass,
  Focus,
  Map,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Route,
} from "lucide-react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import {
  CITY_POLYGON,
  GATES,
  MAP_ATTRIBUTION,
  POIS,
  RIVER_PATH,
  STREET_LABELS,
  URBAN_BLOCK_STATS,
  URBAN_STATS,
  type Point2,
  type Poi,
} from "@/data/plasencia"
import { buildStylizedCathedral } from "@/components/models/StylizedCathedral"
import { buildClayLandmark } from "@/components/models/ClayLandmarks"
import { buildClayMarketSquare } from "@/components/models/ClayDetails"
import {
  buildHistoricWall,
  buildPlazas,
  buildStreetNetwork,
  buildUrbanBuildings,
} from "@/components/models/UrbanFabric"

type ViewKey = "north" | "east" | "south" | "west" | "iso"
type LayerKey = "labels" | "streets" | "buildings"

type SceneApi = {
  focusPoi: (id: string) => void
  reset: () => void
  setLayer: (layer: LayerKey, visible: boolean) => void
  setView: (view: ViewKey) => void
  zoom: (direction: 1 | -1) => void
}

type CameraTween = {
  fromPosition: THREE.Vector3
  toPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  fromZoom: number
  toZoom: number
  startedAt: number
  duration: number
}

const COLORS = {
  aqueduct: 0xcbb28a,
  cream: 0xf1d9a7,
  darkStone: 0x8d775a,
  green: 0x7fae58,
  greenDark: 0x315c3b,
  plaza: 0xd7c29a,
  roof: 0xc85f35,
  road: 0xd9c29c,
  stone: 0xbda47c,
  water: 0x37b8d9,
}

const VIEW_POSITIONS: Record<ViewKey, THREE.Vector3> = {
  north: new THREE.Vector3(0, 48, 62),
  east: new THREE.Vector3(64, 48, 0),
  south: new THREE.Vector3(0, 48, -62),
  west: new THREE.Vector3(-64, 48, 0),
  iso: new THREE.Vector3(54, 52, 58),
}

const MIN_ZOOM = 0.55
const MAX_ZOOM = 7.2

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function pointInPolygon([x, z]: Point2, polygon: readonly Point2[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]
    const [xj, zj] = polygon[j]
    const intersects =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function segmentDistance(
  [px, pz]: Point2,
  [ax, az]: Point2,
  [bx, bz]: Point2,
) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared))
    : 0
  const x = ax + t * dx
  const z = az + t * dz
  return Math.hypot(px - x, pz - z)
}

function ribbonGeometry(points: readonly Point2[], width: number, y = 0.16) {
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

function extrudedPolygon(points: readonly Point2[], depth: number) {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], points[0][1])
  points.slice(1).forEach(([x, z]) => shape.lineTo(x, z))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.45,
    bevelThickness: 0.28,
    curveSegments: 2,
    depth,
  })
  geometry.rotateX(Math.PI / 2)
  return geometry
}

function standardMaterial(color: number, options: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.92,
    ...options,
  })
}

function buildCathedral() {
  return buildStylizedCathedral()
}

function createPoiModel(poi: Poi) {
  if (poi.kind === "cathedral") return buildCathedral()
  if (poi.kind === "wall") return new THREE.Group()
  return buildClayLandmark(poi)
}

function addCssLabel(
  parent: THREE.Object3D,
  className: string,
  html: string,
  position: THREE.Vector3,
) {
  const element = document.createElement("div")
  element.className = className
  element.innerHTML = html
  const label = new CSS2DObject(element)
  label.position.copy(position)
  parent.add(label)
  return label
}

function buildScene(
  scene: THREE.Scene,
  labels: THREE.Group,
  streetLabels: THREE.Group,
  buildings: THREE.Group,
  interactive: THREE.Object3D[],
) {
  const terrainMaterial = standardMaterial(0x6c9b55)
  const terrain = new THREE.Mesh(new THREE.BoxGeometry(112, 2.2, 82), terrainMaterial)
  terrain.position.set(0, -2.15, 0)
  terrain.receiveShadow = true
  scene.add(terrain)

  const shadowPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(50, 53, 2.2, 48),
    standardMaterial(0x426b40),
  )
  shadowPlate.scale.z = 0.68
  shadowPlate.position.set(0, -1.35, 0)
  shadowPlate.receiveShadow = true
  scene.add(shadowPlate)

  const riverBank = new THREE.Mesh(
    ribbonGeometry(RIVER_PATH, 10.5, -0.48),
    standardMaterial(0x9bc969),
  )
  riverBank.receiveShadow = true
  scene.add(riverBank)
  const river = new THREE.Mesh(
    ribbonGeometry(RIVER_PATH, 7.1, -0.34),
    standardMaterial(COLORS.water, {
      emissive: 0x0a4053,
      emissiveIntensity: 0.18,
      roughness: 0.38,
    }),
  )
  river.receiveShadow = true
  scene.add(river)

  const cityBase = new THREE.Mesh(
    extrudedPolygon(CITY_POLYGON, 1.2),
    standardMaterial(0xe7d6aa),
  )
  cityBase.position.y = 0.12
  cityBase.receiveShadow = true
  cityBase.castShadow = true
  scene.add(cityBase)

  scene.add(buildStreetNetwork())
  STREET_LABELS.forEach((street) => {
    addCssLabel(
      streetLabels,
      "street-label",
      street.name,
      new THREE.Vector3(street.position[0], 0.82, street.position[1]),
    )
  })
  scene.add(streetLabels)
  scene.add(buildPlazas())
  scene.add(buildHistoricWall())

  GATES.forEach((gate) => {
    addCssLabel(
      labels,
      "gate-label",
      gate.name,
      new THREE.Vector3(gate.position[0], 3.45, gate.position[1]),
    )
  })

  buildings.add(buildUrbanBuildings(POIS))
  buildings.add(buildClayMarketSquare())
  scene.add(buildings)

  const random = mulberry32(9821)
  const dummy = new THREE.Object3D()
  const treePositions: Array<{ pine: boolean; scale: number; x: number; z: number }> = []
  for (let index = 0; index < 115; index += 1) {
    const x = -49 + random() * 98
    const z = -29 + random() * 61
    if (pointInPolygon([x, z], CITY_POLYGON)) continue
    const riverDistance = RIVER_PATH.reduce((minimum, point, pointIndex) => {
      if (!pointIndex) return minimum
      return Math.min(minimum, segmentDistance([x, z], RIVER_PATH[pointIndex - 1], point))
    }, Number.POSITIVE_INFINITY)
    if (riverDistance < 4.2) continue
    treePositions.push({ pine: random() > 0.52, scale: 0.75 + random() * 0.8, x, z })
  }
  for (let index = 0; index < 20; index += 1) {
    treePositions.push({
      pine: true,
      scale: 0.9 + random() * 0.55,
      x: 34 + (random() - 0.5) * 9,
      z: 10 + (random() - 0.5) * 10,
    })
  }

  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.18, 0.25, 1.4, 16),
    standardMaterial(0x795438),
    treePositions.length,
  )
  const canopyMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1.05, 20, 14),
    standardMaterial(0xffffff, { vertexColors: true }),
    treePositions.length,
  )
  const canopyLobeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.78, 18, 12),
    standardMaterial(0xffffff, { vertexColors: true }),
    treePositions.length,
  )
  const pineMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.05, 2.7, 24),
    standardMaterial(0xffffff, { vertexColors: true }),
    treePositions.length,
  )
  treePositions.forEach((tree, index) => {
    dummy.position.set(tree.x, 0.2 + tree.scale * 0.65, tree.z)
    dummy.rotation.set(0, random() * Math.PI, 0)
    dummy.scale.set(tree.scale, tree.scale, tree.scale)
    dummy.updateMatrix()
    trunkMesh.setMatrixAt(index, dummy.matrix)

    dummy.position.set(tree.x, 1.45 * tree.scale, tree.z)
    dummy.scale.set(tree.pine ? 0.001 : tree.scale, tree.pine ? 0.001 : tree.scale, tree.pine ? 0.001 : tree.scale)
    dummy.updateMatrix()
    canopyMesh.setMatrixAt(index, dummy.matrix)
    canopyMesh.setColorAt(index, new THREE.Color(index % 3 === 0 ? 0x6f9f4f : 0x4f873f))

    dummy.position.set(tree.x + tree.scale * 0.34, 1.62 * tree.scale, tree.z - tree.scale * 0.16)
    dummy.scale.set(tree.pine ? 0.001 : tree.scale, tree.pine ? 0.001 : tree.scale, tree.pine ? 0.001 : tree.scale)
    dummy.updateMatrix()
    canopyLobeMesh.setMatrixAt(index, dummy.matrix)
    canopyLobeMesh.setColorAt(index, new THREE.Color(index % 3 === 1 ? 0x78a953 : 0x5f9546))

    dummy.position.set(tree.x, 1.7 * tree.scale, tree.z)
    dummy.scale.set(tree.pine ? tree.scale : 0.001, tree.pine ? tree.scale : 0.001, tree.pine ? tree.scale : 0.001)
    dummy.updateMatrix()
    pineMesh.setMatrixAt(index, dummy.matrix)
    pineMesh.setColorAt(index, new THREE.Color(index % 2 ? 0x3e7043 : 0x568847))
  })
  ;[trunkMesh, canopyMesh, canopyLobeMesh, pineMesh].forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  })

  const parkLabel = addCssLabel(
    labels,
    "place-label place-label--park",
    "<span>Parque de los Pinos</span>",
    new THREE.Vector3(34, 4.5, 10),
  )
  parkLabel.center.set(0.5, 0.5)

  POIS.forEach((poi) => {
    const model = createPoiModel(poi)
    const modelX = poi.id === "plaza-mayor" ? poi.position[0] - 1.05 : poi.position[0]
    const modelZ = poi.id === "plaza-mayor" ? poi.position[1] + 2.28 : poi.position[1]
    model.position.set(modelX, 0.34, modelZ)
    const modelScale =
      poi.kind === "cathedral" ? 0.5
        : poi.kind === "townhall" ? 0.7
          : poi.kind === "palace" ? 0.72
            : poi.kind === "tower" ? 0.76
              : poi.kind === "church" ? 0.78
                : 1
    model.scale.multiplyScalar(modelScale)
    if (poi.id === "catedral") model.rotation.y = -0.42
    if (poi.id === "acueducto") model.rotation.y = -0.42
    scene.add(model)

    const hitRadius = poi.kind === "aqueduct" ? 4.5 : poi.kind === "cathedral" ? 3.6 : 2.2
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(hitRadius, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthWrite: false,
        opacity: 0.001,
        transparent: true,
      }),
    )
    hit.position.set(poi.position[0], (poi.focusHeight ?? 3) * 0.6, poi.position[1])
    hit.userData.poiId = poi.id
    scene.add(hit)
    interactive.push(hit)

    addCssLabel(
      labels,
      "place-label",
      `<b>${poi.number}</b><span>${poi.name}</span>`,
      new THREE.Vector3(poi.position[0], (poi.focusHeight ?? 3) + 1.2, poi.position[1]),
    )
  })
  scene.add(labels)
}

export function PlasenciaDiorama() {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<SceneApi | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [showStreets, setShowStreets] = useState(false)
  const [showBuildings, setShowBuildings] = useState(true)
  const selected = POIS.find((poi) => poi.id === selectedId) ?? null

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer: THREE.WebGLRenderer | null = null
    let frame = 0
    let resizeObserver: ResizeObserver | null = null
    let disposed = false
    try {
      const scene = new THREE.Scene()
      scene.fog = new THREE.Fog(0xe4cba4, 72, 145)

      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)
      const aspect = width / height
      const viewSize = 66
      const camera = new THREE.OrthographicCamera(
        (-viewSize * aspect) / 2,
        (viewSize * aspect) / 2,
        viewSize / 2,
        -viewSize / 2,
        0.1,
        300,
      )
      camera.position.copy(VIEW_POSITIONS.iso)
      camera.zoom = 0.92
      camera.updateProjectionMatrix()

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8))
      renderer.setSize(width, height)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      renderer.domElement.className = "diorama-canvas"
      renderer.domElement.setAttribute("aria-label", "Maqueta 3D interactiva de Plasencia")
      mount.appendChild(renderer.domElement)

      const labelRenderer = new CSS2DRenderer()
      labelRenderer.setSize(width, height)
      labelRenderer.domElement.className = "diorama-labels"
      mount.appendChild(labelRenderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.075
      controls.enablePan = true
      controls.enableRotate = true
      controls.enableZoom = true
      controls.maxPolarAngle = 1.32
      controls.minPolarAngle = 0.35
      controls.minZoom = MIN_ZOOM
      controls.maxZoom = MAX_ZOOM
      controls.zoomToCursor = true
      controls.panSpeed = 0.7
      controls.rotateSpeed = 0.55
      controls.zoomSpeed = 0.82
      controls.target.set(0, 0.8, 0)
      controls.update()

      scene.add(new THREE.HemisphereLight(0xfff3d4, 0x41654a, 2.15))
      const sun = new THREE.DirectionalLight(0xffe2ac, 4.4)
      sun.position.set(-34, 58, -28)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.left = -60
      sun.shadow.camera.right = 60
      sun.shadow.camera.top = 50
      sun.shadow.camera.bottom = -50
      sun.shadow.bias = -0.00035
      scene.add(sun)
      const fill = new THREE.DirectionalLight(0xa7d8ff, 1.05)
      fill.position.set(45, 24, 38)
      scene.add(fill)

      const labels = new THREE.Group()
      const streetLabels = new THREE.Group()
      streetLabels.visible = false
      const buildings = new THREE.Group()
      const interactive: THREE.Object3D[] = []
      buildScene(scene, labels, streetLabels, buildings, interactive)

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const pointerStart = new THREE.Vector2()
      let tween: CameraTween | null = null
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

      const startTween = (
        position: THREE.Vector3,
        target: THREE.Vector3,
        zoom = camera.zoom,
      ) => {
        if (reducedMotion) {
          camera.position.copy(position)
          controls.target.copy(target)
          camera.zoom = zoom
          camera.updateProjectionMatrix()
          controls.update()
          return
        }
        tween = {
          duration: 950,
          fromPosition: camera.position.clone(),
          fromTarget: controls.target.clone(),
          fromZoom: camera.zoom,
          startedAt: performance.now(),
          toPosition: position.clone(),
          toTarget: target.clone(),
          toZoom: zoom,
        }
      }

      const focusPoi = (id: string) => {
        const poi = POIS.find((item) => item.id === id)
        if (!poi) return
        const target = new THREE.Vector3(poi.position[0], (poi.focusHeight ?? 3) * 0.38, poi.position[1])
        const direction = camera.position.clone().sub(controls.target).normalize()
        const distance = poi.kind === "aqueduct" ? 29 : 24
        const position = target.clone().add(direction.multiplyScalar(distance))
        position.y = Math.max(position.y, target.y + 15)
        const zoom = poi.kind === "aqueduct" ? 1.24 : poi.kind === "cathedral" ? 1.72 : 1.42
        startTween(position, target, zoom)
      }

      apiRef.current = {
        focusPoi,
        reset: () => startTween(VIEW_POSITIONS.iso, new THREE.Vector3(0, 0.8, 0), 0.92),
        setLayer: (layer, visible) => {
          if (layer === "labels") labels.visible = visible
          if (layer === "streets") streetLabels.visible = visible
          if (layer === "buildings") buildings.visible = visible
        },
        setView: (view) => startTween(VIEW_POSITIONS[view], new THREE.Vector3(0, 0.8, 0), 0.92),
        zoom: (direction) => {
          const step = camera.zoom < 2.4 ? 0.3 : 0.65
          camera.zoom = THREE.MathUtils.clamp(camera.zoom + direction * step, MIN_ZOOM, MAX_ZOOM)
          camera.updateProjectionMatrix()
        },
      }

      const setPointer = (event: PointerEvent) => {
        const bounds = renderer!.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      }

      const onPointerMove = (event: PointerEvent) => {
        setPointer(event)
        raycaster.setFromCamera(pointer, camera)
        const hovering = raycaster.intersectObjects(interactive, false).length > 0
        renderer!.domElement.style.cursor = hovering ? "pointer" : "grab"
      }
      const onPointerDown = (event: PointerEvent) => {
        pointerStart.set(event.clientX, event.clientY)
      }
      const onPointerUp = (event: PointerEvent) => {
        if (pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 7) return
        setPointer(event)
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects(interactive, false)[0]
        const id = hit?.object.userData.poiId as string | undefined
        if (id) {
          setSelectedId(id)
          focusPoi(id)
        }
      }
      renderer.domElement.addEventListener("pointermove", onPointerMove)
      renderer.domElement.addEventListener("pointerdown", onPointerDown)
      renderer.domElement.addEventListener("pointerup", onPointerUp)

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
        const key = event.key.toLowerCase()
        if (key === "n") apiRef.current?.setView("north")
        if (key === "e") apiRef.current?.setView("east")
        if (key === "s") apiRef.current?.setView("south")
        if (key === "o" || key === "w") apiRef.current?.setView("west")
        if (key === "i") apiRef.current?.setView("iso")
        if (key === "+" || key === "=") apiRef.current?.zoom(1)
        if (key === "-") apiRef.current?.zoom(-1)
      }
      window.addEventListener("keydown", onKeyDown)

      resizeObserver = new ResizeObserver(() => {
        const nextWidth = Math.max(1, mount.clientWidth)
        const nextHeight = Math.max(1, mount.clientHeight)
        const nextAspect = nextWidth / nextHeight
        camera.left = (-viewSize * nextAspect) / 2
        camera.right = (viewSize * nextAspect) / 2
        camera.top = viewSize / 2
        camera.bottom = -viewSize / 2
        camera.updateProjectionMatrix()
        renderer!.setSize(nextWidth, nextHeight)
        labelRenderer.setSize(nextWidth, nextHeight)
      })
      resizeObserver.observe(mount)

      const animate = (time: number) => {
        if (disposed) return
        if (tween) {
          const raw = Math.min(1, (time - tween.startedAt) / tween.duration)
          const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2
          camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased)
          controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased)
          camera.zoom = THREE.MathUtils.lerp(tween.fromZoom, tween.toZoom, eased)
          camera.updateProjectionMatrix()
          if (raw >= 1) tween = null
        }
        controls.update()
        renderer!.render(scene, camera)
        labelRenderer.render(scene, camera)
        frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
      requestAnimationFrame(() => setReady(true))

      return () => {
        disposed = true
        cancelAnimationFrame(frame)
        resizeObserver?.disconnect()
        window.removeEventListener("keydown", onKeyDown)
        renderer?.domElement.removeEventListener("pointermove", onPointerMove)
        renderer?.domElement.removeEventListener("pointerdown", onPointerDown)
        renderer?.domElement.removeEventListener("pointerup", onPointerUp)
        controls.dispose()
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        })
        labelRenderer.domElement.remove()
        renderer?.dispose()
        renderer?.domElement.remove()
        apiRef.current = null
      }
    } catch (reason) {
      console.error("No se pudo iniciar la maqueta 3D", reason)
      queueMicrotask(() => {
        if (!disposed) setError("Este dispositivo no ha podido iniciar la maqueta 3D.")
      })
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [])

  const changeLayer = (layer: LayerKey, visible: boolean) => {
    apiRef.current?.setLayer(layer, visible)
    if (layer === "labels") setShowLabels(visible)
    if (layer === "streets") setShowStreets(visible)
    if (layer === "buildings") setShowBuildings(visible)
  }

  return (
    <main className="map-shell">
      <div ref={mountRef} className="diorama-stage" />

      <header className="map-brand" aria-label="Título del mapa">
        <span className="brand-mark" aria-hidden="true"><Map /></span>
        <div>
          <p>Plasencia</p>
          <h1>Maqueta viva</h1>
        </div>
      </header>

      <section className="layer-panel" aria-label="Capas del mapa">
        <div className="panel-heading">
          <span>Capas</span>
          <Route aria-hidden="true" />
        </div>
        <label>
          <span><MapPin aria-hidden="true" /> Monumentos</span>
          <Switch checked={showLabels} onCheckedChange={(value) => changeLayer("labels", value)} aria-label="Mostrar nombres de monumentos" />
        </label>
        <label>
          <span><Route aria-hidden="true" /> Nombres de calles</span>
          <Switch checked={showStreets} onCheckedChange={(value) => changeLayer("streets", value)} aria-label="Mostrar nombres de calles" />
        </label>
        <label>
          <span><Building2 aria-hidden="true" /> Manzanas</span>
          <Switch checked={showBuildings} onCheckedChange={(value) => changeLayer("buildings", value)} aria-label="Mostrar manzanas" />
        </label>
      </section>

      <nav className="view-controls" aria-label="Orientación de la cámara">
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.setView("north")} aria-label="Vista norte" title="Norte (N)">N</Button>
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.setView("east")} aria-label="Vista este" title="Este (E)">E</Button>
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.setView("south")} aria-label="Vista sur" title="Sur (S)">S</Button>
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.setView("west")} aria-label="Vista oeste" title="Oeste (O)">O</Button>
        <span className="control-divider" />
        <Button variant="ghost" className="iso-button" onClick={() => apiRef.current?.setView("iso")} aria-label="Vista isométrica" title="Isométrica (I)"><Compass /> Iso</Button>
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.reset()} aria-label="Restablecer vista" title="Restablecer"><RotateCcw /></Button>
      </nav>

      <div className="zoom-controls" aria-label="Zoom del mapa">
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.zoom(1)} aria-label="Acercar"><Plus /></Button>
        <Button variant="ghost" size="icon" onClick={() => apiRef.current?.zoom(-1)} aria-label="Alejar"><Minus /></Button>
      </div>

      <p className="map-help"><span aria-hidden="true">↔</span> Arrastra para girar <i /> Rueda para acercar <i /> Pulsa un monumento</p>

      {!ready && !error && (
        <div className="map-loading" role="status">
          <span className="loading-compass"><Compass /></span>
          <p>Trazando el casco histórico…</p>
        </div>
      )}
      {error && <div className="map-error" role="alert">{error}</div>}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        {selected && (
          <SheetContent className="poi-sheet" side="right">
            <SheetHeader className="poi-header">
              <div className="poi-number">{String(selected.number).padStart(2, "0")}</div>
              <p className="poi-kicker">{selected.kicker}</p>
              <SheetTitle>{selected.name}</SheetTitle>
              <SheetDescription>{selected.summary}</SheetDescription>
            </SheetHeader>
            <div className="poi-model-mark" aria-hidden="true">
              <span><Building2 /></span>
              <div />
            </div>
            <div className="poi-actions">
              <Button onClick={() => apiRef.current?.focusPoi(selected.id)}><Focus /> Centrar de nuevo</Button>
              <p>Gira la maqueta mientras la ficha está abierta para examinar el edificio desde cualquier orientación.</p>
            </div>
          </SheetContent>
        )}
      </Sheet>

      <div className="map-count"><Route aria-hidden="true" /><span><b>{URBAN_STATS.namedStreets}</b> calles · <b>{URBAN_BLOCK_STATS.blocks}</b> manzanas únicas</span></div>
      <p className="map-source" title={MAP_ATTRIBUTION}>
        Datos: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        <span aria-hidden="true"> · </span>
        contraste: <a href="https://plasencia.es/web/images/documentos/doc-turismo/plano_casco_historico.pdf" target="_blank" rel="noreferrer">Ayuntamiento de Plasencia</a>
      </p>
    </main>
  )
}
