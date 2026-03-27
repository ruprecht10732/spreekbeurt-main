import type { __UNSTABLE_Project_OnDiskState } from '@theatre/core';

type CameraShot = {
  offset: { x: number; y: number; z: number };
  lookOffset: { x: number; y: number; z: number };
  drift: { x: number; y: number; z: number };
  mouseParallax: { x: number; y: number; z: number };
  lerp: number;
  flareVisible: boolean;
};

export const THEATRE_SLIDE_SEQUENCE_POSITIONS = {
  title: 0,
  inhoud: 1,
  h1: 2,
  h2: 3,
  h3: 4,
  h4: 5,
  h5: 6,
  extra: 7,
  quiz: 8,
  afsluiting: 9,
} as const;

export const THEATRE_TOUR_SEQUENCE_POSITIONS = {
  jupiter: 20,
  zon: 24,
  mercurius: 28,
  venus: 32,
  aarde: 36,
  maan: 38,
  mars: 40,
  saturnus: 44,
  uranus: 48,
  neptunus: 52,
  pluto: 56,
  'jupiter-einde': 60,
} as const;

const DEFAULT_MOUSE_PARALLAX = { x: 3, y: 3, z: 0 };
const SMOOTH_HANDLES = [0.5, 1, 0.5, 0] as const;
const HOLD_HANDLES = [0.5, 1, 0.5, 0] as const;

const SHOTS: Record<keyof typeof THEATRE_SLIDE_SEQUENCE_POSITIONS, CameraShot> = {
  title: {
    offset: { x: -7, y: 8, z: 52 },
    lookOffset: { x: 0, y: 1, z: 0 },
    drift: { x: 0, y: -0.002, z: -0.008 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.015,
    flareVisible: true,
  },
  inhoud: {
    offset: { x: 28, y: 14, z: 34 },
    lookOffset: { x: 0, y: 1.4, z: 0 },
    drift: { x: -0.009, y: 0, z: -0.004 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.025,
    flareVisible: true,
  },
  h1: {
    offset: { x: -16, y: 3.2, z: 18 },
    lookOffset: { x: -1.1, y: 0.5, z: -0.3 },
    drift: { x: 0.0025, y: 0, z: -0.0025 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.03,
    flareVisible: false,
  },
  h2: {
    offset: { x: -3.5, y: -3.2, z: 5.4 },
    lookOffset: { x: 0.6, y: -2.5, z: -8.8 },
    drift: { x: -0.001, y: 0.002, z: 0 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.02,
    flareVisible: false,
  },
  h3: {
    offset: { x: -18, y: 20, z: 55 },
    lookOffset: { x: -12, y: -2, z: 0 },
    drift: { x: 0.005, y: -0.002, z: 0 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.02,
    flareVisible: true,
  },
  h4: {
    offset: { x: -22, y: -8, z: 16 },
    lookOffset: { x: 2, y: 0, z: 0 },
    drift: { x: 0.015, y: 0.004, z: -0.003 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.018,
    flareVisible: false,
  },
  h5: {
    offset: { x: -2, y: -18, z: 13 },
    lookOffset: { x: 0, y: 6, z: -1 },
    drift: { x: -0.002, y: 0.006, z: 0 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.025,
    flareVisible: false,
  },
  extra: {
    offset: { x: 5, y: 38, z: 22 },
    lookOffset: { x: 0, y: 0, z: -2 },
    drift: { x: -0.008, y: 0, z: 0.005 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.02,
    flareVisible: true,
  },
  quiz: {
    offset: { x: -2, y: 2, z: 17 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: -0.01, y: 0, z: -0.008 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.04,
    flareVisible: true,
  },
  afsluiting: {
    offset: { x: -5, y: 5, z: 38 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: 0, y: 0.002, z: 0.005 },
    mouseParallax: DEFAULT_MOUSE_PARALLAX,
    lerp: 0.015,
    flareVisible: true,
  },
};

const TOUR_SHOTS: Record<keyof typeof THEATRE_TOUR_SEQUENCE_POSITIONS, CameraShot> = {
  jupiter: {
    offset: { x: -22, y: 6, z: 19 },
    lookOffset: { x: 0, y: 0.5, z: 0 },
    drift: { x: 0.002, y: 0.0006, z: -0.0015 },
    mouseParallax: { x: 0.8, y: 0.8, z: 0 },
    lerp: 0.02,
    flareVisible: false,
  },
  zon: {
    offset: { x: 22, y: 7, z: 16 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: -0.002, y: 0.0008, z: 0.001 },
    mouseParallax: { x: 0.6, y: 0.6, z: 0 },
    lerp: 0.022,
    flareVisible: true,
  },
  mercurius: {
    offset: { x: 2.0, y: 0.8, z: 1.6 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: -0.0008, y: 0.0004, z: 0.0008 },
    mouseParallax: { x: 0.3, y: 0.3, z: 0 },
    lerp: 0.026,
    flareVisible: true,
  },
  venus: {
    offset: { x: 3.0, y: 1.2, z: 2.8 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: 0.001, y: 0.0004, z: -0.0007 },
    mouseParallax: { x: 0.3, y: 0.3, z: 0 },
    lerp: 0.026,
    flareVisible: true,
  },
  aarde: {
    offset: { x: 2.8, y: 1.4, z: 3.0 },
    lookOffset: { x: 0.1, y: 0.3, z: 0.1 },
    drift: { x: 0.0012, y: 0.0003, z: -0.0008 },
    mouseParallax: { x: 0.3, y: 0.3, z: 0 },
    lerp: 0.028,
    flareVisible: true,
  },
  maan: {
    offset: { x: 0.15, y: 0.06, z: 0.35 },
    lookOffset: { x: 0.02, y: -0.02, z: 0 },
    drift: { x: 0.0003, y: 0.0001, z: -0.0002 },
    mouseParallax: { x: 0.05, y: 0.05, z: 0 },
    lerp: 0.035,
    flareVisible: false,
  },
  mars: {
    offset: { x: 2.4, y: 1.2, z: 2.2 },
    lookOffset: { x: 0.1, y: 0.3, z: 0.1 },
    drift: { x: 0.0009, y: 0.0002, z: -0.0008 },
    mouseParallax: { x: 0.3, y: 0.3, z: 0 },
    lerp: 0.028,
    flareVisible: true,
  },
  saturnus: {
    offset: { x: -28, y: 13, z: 23 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: 0.0024, y: 0.0008, z: -0.0015 },
    mouseParallax: { x: 0.75, y: 0.75, z: 0 },
    lerp: 0.021,
    flareVisible: true,
  },
  uranus: {
    offset: { x: -12, y: 4.5, z: 11 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: 0.0014, y: 0.0003, z: -0.001 },
    mouseParallax: { x: 0.5, y: 0.5, z: 0 },
    lerp: 0.022,
    flareVisible: true,
  },
  neptunus: {
    offset: { x: 12, y: 4.2, z: 11 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: -0.0014, y: 0.0004, z: 0.001 },
    mouseParallax: { x: 0.5, y: 0.5, z: 0 },
    lerp: 0.022,
    flareVisible: true,
  },
  pluto: {
    offset: { x: 2.0, y: 0.9, z: 2.0 },
    lookOffset: { x: 0, y: 0, z: 0 },
    drift: { x: 0.0011, y: 0.0005, z: -0.0007 },
    mouseParallax: { x: 0.3, y: 0.3, z: 0 },
    lerp: 0.026,
    flareVisible: true,
  },
  'jupiter-einde': {
    offset: { x: 8, y: 10, z: 58 },
    lookOffset: { x: 0, y: 0.5, z: 0 },
    drift: { x: -0.0012, y: 0.0007, z: 0.0022 },
    mouseParallax: { x: 0.9, y: 0.9, z: 0 },
    lerp: 0.017,
    flareVisible: true,
  },
};

function encodedPath(path: string[]): string {
  return JSON.stringify(path);
}

function numericTrack(debugName: string, path: string[], readValue: (shot: CameraShot) => number) {
  return {
    trackId: debugName,
    path: encodedPath(path),
    data: {
      type: 'BasicKeyframedTrack',
      __debugName: debugName,
      keyframes: Object.entries(THEATRE_SLIDE_SEQUENCE_POSITIONS).map(([slideId, position]) => ({
        id: `${debugName}-${slideId}`,
        value: readValue(SHOTS[slideId]),
        position,
        handles: [...SMOOTH_HANDLES],
        connectedRight: true,
        type: 'bezier' as const,
      })),
    },
  };
}

function booleanTrack(debugName: string, path: string[], readValue: (shot: CameraShot) => boolean) {
  return {
    trackId: debugName,
    path: encodedPath(path),
    data: {
      type: 'BasicKeyframedTrack',
      __debugName: debugName,
      keyframes: Object.entries(THEATRE_SLIDE_SEQUENCE_POSITIONS).map(([slideId, position]) => ({
        id: `${debugName}-${slideId}`,
        value: readValue(SHOTS[slideId]),
        position,
        handles: [...HOLD_HANDLES],
        connectedRight: false,
        type: 'hold' as const,
      })),
    },
  };
}

function numericCombinedTrack(debugName: string, path: string[], readValue: (shot: CameraShot) => number) {
  return {
    trackId: debugName,
    path: encodedPath(path),
    data: {
      type: 'BasicKeyframedTrack',
      __debugName: debugName,
      keyframes: [
        ...Object.entries(THEATRE_SLIDE_SEQUENCE_POSITIONS).map(([slideId, position]) => ({
          id: `${debugName}-${slideId}`,
          value: readValue(SHOTS[slideId]),
          position,
          handles: [...SMOOTH_HANDLES],
          connectedRight: true,
          type: 'bezier' as const,
        })),
        ...Object.entries(THEATRE_TOUR_SEQUENCE_POSITIONS).map(([stopId, position]) => ({
          id: `tour-${debugName}-${stopId}`,
          value: readValue(TOUR_SHOTS[stopId]),
          position,
          handles: [...SMOOTH_HANDLES],
          connectedRight: true,
          type: 'bezier' as const,
        })),
      ],
    },
  };
}

function booleanCombinedTrack(debugName: string, path: string[], readValue: (shot: CameraShot) => boolean) {
  return {
    trackId: debugName,
    path: encodedPath(path),
    data: {
      type: 'BasicKeyframedTrack',
      __debugName: debugName,
      keyframes: [
        ...Object.entries(THEATRE_SLIDE_SEQUENCE_POSITIONS).map(([slideId, position]) => ({
          id: `${debugName}-${slideId}`,
          value: readValue(SHOTS[slideId]),
          position,
          handles: [...HOLD_HANDLES],
          connectedRight: false,
          type: 'hold' as const,
        })),
        ...Object.entries(THEATRE_TOUR_SEQUENCE_POSITIONS).map(([stopId, position]) => ({
          id: `tour-${debugName}-${stopId}`,
          value: readValue(TOUR_SHOTS[stopId]),
          position,
          handles: [...HOLD_HANDLES],
          connectedRight: false,
          type: 'hold' as const,
        })),
      ],
    },
  };
}

const allTracks = [
  numericCombinedTrack('offset.x', ['offset', 'x'], (shot) => shot.offset.x),
  numericCombinedTrack('offset.y', ['offset', 'y'], (shot) => shot.offset.y),
  numericCombinedTrack('offset.z', ['offset', 'z'], (shot) => shot.offset.z),
  numericCombinedTrack('lookOffset.x', ['lookOffset', 'x'], (shot) => shot.lookOffset.x),
  numericCombinedTrack('lookOffset.y', ['lookOffset', 'y'], (shot) => shot.lookOffset.y),
  numericCombinedTrack('lookOffset.z', ['lookOffset', 'z'], (shot) => shot.lookOffset.z),
  numericCombinedTrack('drift.x', ['drift', 'x'], (shot) => shot.drift.x),
  numericCombinedTrack('drift.y', ['drift', 'y'], (shot) => shot.drift.y),
  numericCombinedTrack('drift.z', ['drift', 'z'], (shot) => shot.drift.z),
  numericCombinedTrack('mouseParallax.x', ['mouseParallax', 'x'], (shot) => shot.mouseParallax.x),
  numericCombinedTrack('mouseParallax.y', ['mouseParallax', 'y'], (shot) => shot.mouseParallax.y),
  numericCombinedTrack('mouseParallax.z', ['mouseParallax', 'z'], (shot) => shot.mouseParallax.z),
  numericCombinedTrack('lerp', ['lerp'], (shot) => shot.lerp),
  booleanCombinedTrack('flareVisible', ['flareVisible'], (shot) => shot.flareVisible),
];

export const THEATRE_CAMERA_PROJECT_STATE = {
  definitionVersion: '0.4.0',
  revisionHistory: [],
  sheetsById: {
    'slide-camera': {
      staticOverrides: {
        byObject: {},
      },
      sequence: {
        type: 'PositionalSequence',
        length: 60,
        subUnitsPerUnit: 30,
        tracksByObject: {
          'jupiter-camera': {
            trackIdByPropPath: Object.fromEntries(allTracks.map((track) => [track.path, track.trackId])),
            trackData: Object.fromEntries(allTracks.map((track) => [track.trackId, track.data])),
          },
        },
      },
    },
  },
} as unknown as __UNSTABLE_Project_OnDiskState;