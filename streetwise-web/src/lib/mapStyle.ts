import type { StyleSpecification } from 'maplibre-gl';

// OpenFreeMap vector tiles (OpenMapTiles schema, keyless), recoloured with the
// map/* variables from the Figma file. Night for the walker and control room, Day for guardian and shop.

export type Theme = 'night' | 'day';

export const MAP_COLORS: Record<Theme, Record<string, string>> = {
  night: {
    land: '#141924', minor: '#232B3A', major: '#33405A', casing: '#141924', water: '#0E2233', park: '#172820',
    building: '#1A2030', buildingTop: '#202838', label: '#7F889A', halo: '#141924', path: '#2A3346',
  },
  day: {
    land: '#ECE6DA', minor: '#FFFFFF', major: '#FFFFFF', casing: '#DCD3C2', water: '#B9D8EC', park: '#CFE3C3',
    building: '#E3DCCE', buildingTop: '#E8E1D4', label: '#6E7380', halo: '#F4F0E8', path: '#F8F5EF',
  },
};

export const UI_COLORS: Record<Theme, Record<string, string>> = {
  night: { route: '#6B83FF', open: '#4FD1A5', checkin: '#FF8A3D', alert: '#EF4438', text: '#ECE7DC', text2: '#8E97A8', bg: '#10141C', surface: '#1B2230' },
  day: { route: '#4A63E8', open: '#1E9E74', checkin: '#E36A1A', alert: '#D92D20', text: '#151A22', text2: '#6A6F7B', bg: '#F4F0E8', surface: '#FFFFFF' },
};

const MINOR = ['minor', 'service', 'track'];
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];

export function buildStyle(theme: Theme): StyleSpecification {
  const c = MAP_COLORS[theme];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.land } },
      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood']]], paint: { 'fill-color': c.park, 'fill-opacity': 0.9 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      {
        id: 'building-flat', type: 'fill', source: 'omt', 'source-layer': 'building', maxzoom: 15.5,
        paint: { 'fill-color': c.building, 'fill-outline-color': c.land },
      },
      {
        id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 15,
        paint: {
          'fill-extrusion-color': c.buildingTop,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.85],
        },
      },
      {
        id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian']]],
        paint: { 'line-color': c.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 3], 'line-dasharray': [2, 1.5] },
      },
      ...(theme === 'day'
        ? [{
            id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
            filter: ['in', ['get', 'class'], ['literal', [...MINOR, ...MAJOR]]],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': c.casing, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 1.5, 15, 7, 18, 26] },
          } as StyleSpecification['layers'][number]]
        : []),
      {
        id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MINOR]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.minor, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.6, 15, 5, 18, 20] },
      },
      {
        id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MAJOR]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.major, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 1, 15, 7, 18, 28] },
      },
      {
        id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 13],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
          'text-max-angle': 30,
          'symbol-spacing': 280,
        },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'park-label', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 15,
        filter: ['==', ['get', 'class'], 'park'],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 8 },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.2 },
      },
    ] as StyleSpecification['layers'],
  };
}
