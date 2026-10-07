// Arte do escritório para o navegador: personagens gerados na hora, metadados
// dos móveis e a planta (spots, salas). O tileset e o .tmj vêm de scripts/generate.ts.
export * from './raster';
export * from './palette';
export * from './font';
export * from './characters';
export { FURNITURE, type FurnitureMeta, type Overlay, type DepthMode } from './furniture';
export { MAP_W, MAP_H, ROOMS, SPOTS, PLACEMENTS, type SpotDef, type RoomDef, type Facing } from './map';
export { TILE } from './tiles';
