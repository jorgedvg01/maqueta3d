import * as THREE from "three"
import * as urbanModule from "../components/models/UrbanFabric.ts"
import * as landmarkModule from "../components/models/ClayLandmarks.ts"
import * as detailsModule from "../components/models/ClayDetails.ts"
import * as dataModule from "../data/plasencia.ts"
import * as cathedralModule from "../components/models/StylizedCathedral.ts"

const startedAt = performance.now()

function inspect(name, object) {
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  let meshes = 0
  let triangles = 0
  let vertices = 0
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    meshes += 1
    const position = child.geometry.getAttribute("position")
    if (!position) throw new Error(`${name}: malla sin posiciones`)
    vertices += position.count
    triangles += child.geometry.index ? child.geometry.index.count / 3 : position.count / 3
    for (let index = 0; index < position.count; index += 1) {
      if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
        throw new Error(`${name}: coordenada no finita`)
      }
    }
  })
  if (bounds.isEmpty()) throw new Error(`${name}: límites vacíos`)
  const size = bounds.getSize(new THREE.Vector3())
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value < 500)) {
    throw new Error(`${name}: límites inválidos ${size.toArray().join(", ")}`)
  }
  return {
    bounds: size.toArray().map((value) => Number(value.toFixed(2))),
    meshes,
    name,
    triangles: Math.round(triangles),
    vertices,
  }
}

const reports = []
const urbanStartedAt = performance.now()
reports.push(inspect("69 manzanas", urbanModule.buildUrbanBuildings(dataModule.POIS)))
const urbanMilliseconds = performance.now() - urbanStartedAt
reports.push(inspect("muralla", urbanModule.buildHistoricWall()))
reports.push(inspect("plazas", urbanModule.buildPlazas()))
reports.push(inspect("calles", urbanModule.buildStreetNetwork()))
reports.push(inspect("mercado", detailsModule.buildClayMarketSquare()))
reports.push(inspect("Catedral Nueva y Vieja", cathedralModule.buildStylizedCathedral()))

for (const poi of dataModule.POIS) {
  if (poi.kind === "cathedral" || poi.kind === "wall") continue
  reports.push(inspect(poi.name, landmarkModule.buildClayLandmark(poi)))
}

console.log(JSON.stringify({
  elapsedMilliseconds: Math.round(performance.now() - startedAt),
  reports,
  totals: reports.reduce((totals, report) => ({
    meshes: totals.meshes + report.meshes,
    triangles: totals.triangles + report.triangles,
    vertices: totals.vertices + report.vertices,
  }), { meshes: 0, triangles: 0, vertices: 0 }),
  urbanMilliseconds: Math.round(urbanMilliseconds),
}, null, 2))
