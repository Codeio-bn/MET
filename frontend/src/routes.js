// ─── Walking routes ───────────────────────────────────────────────────────────
// Each entry is one route drawn as a colored polyline on the map.
// Coordinates are [lat, lng] pairs.
// Replace or extend these with real GPX-exported coordinates for the actual event.

export const ROUTES = [
  {
    name:  'Test Loop — Princenhage Centrum',
    color: '#3b82f6',
    width: 4,
    coords: [
      [51.5762, 4.7258], // Start: north-west (near Ettensebaan)
      [51.5768, 4.7295], // north along Schoolstraat
      [51.5763, 4.7330], // past the Barbara church
      [51.5748, 4.7358], // east toward Liesboslaan
      [51.5725, 4.7365], // south-east
      [51.5705, 4.7340], // south
      [51.5698, 4.7295], // south-west
      [51.5707, 4.7258], // west edge
      [51.5728, 4.7242], // back north-west
      [51.5762, 4.7258], // close the loop
    ],
  },
];
