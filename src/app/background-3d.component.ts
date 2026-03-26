import { Component, ElementRef, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy, NgZone, PLATFORM_ID, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

@Component({
  selector: 'app-background-3d',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #canvasContainer class="fixed inset-0 z-0 bg-black"></div>
  `
})
export class Background3DComponent implements OnInit, OnDestroy, OnChanges {
  @Input() slideIndex = 0;
  @Input() slideId = 'title';
  @Input() fadeOut = false;
  @Output() loaded = new EventEmitter<void>();
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private jupiterGroup!: THREE.Group;
  private jupiter!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  
  // 95 Moons: 4 Galilean + 91 small moons
  private readonly galileanMoons: { mesh: THREE.Mesh, distance: number, speed: number, angle: number }[] = [];
  private smallMoons!: THREE.InstancedMesh;
  private readonly smallMoonsData: { distance: number, speed: number, angle: number, inclination: number }[] = [];
  
  private stars!: THREE.Points;
  private dustSystem!: THREE.Points;
  private animationFrameId: number | null = null;
  private readonly isBrowser: boolean;
  private readonly startTime = Date.now();
  
  // Camera transition targets
  private targetCameraX = 0;
  private targetCameraY = 0;
  private targetCameraZ = 45;
  private baseCameraX = 0;
  private baseCameraY = 0;
  private baseCameraZ = 45;
  private readonly targetLookAt = new THREE.Vector3(0, 0, 0);
  private readonly currentLookAt = new THREE.Vector3(0, 0, 0);
  private targetJupiterRotationY: number | null = null;
  private mouseX = 0;
  private mouseY = 0;

  // Contextual Animation Targets
  private targetStarSpeed = 0.0001;
  private currentStarSpeed = 0.0001;
  private targetMoonSpeedMultiplier = 1;
  private currentMoonSpeedMultiplier = 1;
  private targetAtmospherePulse = 0;
  private currentAtmospherePulse = 0;
  private targetJupiterSpinSpeed = 0.0005;
  private currentJupiterSpinSpeed = 0.0005;

  private earthMesh!: THREE.Mesh;

  // Post-processing
  private postScene!: THREE.Scene;
  private postCamera!: THREE.OrthographicCamera;
  private postMaterial!: THREE.ShaderMaterial;
  private readonly nebulae: THREE.Mesh[] = [];

  // Spaceships orbiting Jupiter
  private readonly spaceshipData: {
    group: THREE.Group;
    orbitRadius: number;
    orbitSpeed: number;
    orbitAngle: number;
    orbitY: number;
    orbitInclination: number;
  }[] = [];
  private targetShipSpeedMultiplier = 1;
  private currentShipSpeedMultiplier = 1;
  private loadPromises: Promise<unknown>[] = [];

  // Earth orbit for h3 distance visualization
  private earthOrbitAngle = 0;
  private earthOrbitActive = false;

  // Distance beam between Earth and Jupiter
  private distanceBeam!: THREE.Group;
  private distanceBeamActive = false;
  private lastEmittedKm = 0;
  @Output() distanceKm = new EventEmitter<number>();

  // Galaxy band
  private galaxyBand!: THREE.Points;

  // Solar system planets in background
  private saturnGroup!: THREE.Group;
  private marsMesh!: THREE.Mesh;

  // Asteroid belt
  private asteroidBelt!: THREE.InstancedMesh;

  // Shooting stars
  private readonly shootingStars: { mesh: THREE.Mesh, velocity: THREE.Vector3, life: number, maxLife: number }[] = [];
  private shootingStarTimer = 0;

  // Comet
  private cometGroup!: THREE.Group;
  private cometAngle = 0;

  // Jupiter polar aurora
  private auroraTop!: THREE.Mesh;
  private auroraBottom!: THREE.Mesh;

  // Orbital trace rings for Galilean moons
  private readonly orbitalRings: THREE.Line[] = [];

  // Sun with corona
  private sunMesh!: THREE.Mesh;

  // Jupiter night-side lightning
  private readonly lightningFlashes: { mesh: THREE.Mesh, timer: number, cooldown: number }[] = [];

  // Io plasma torus (ionized sulfur ring along Io's orbit)
  private ioPlasmaTorusMesh!: THREE.Mesh;

  // Europa water plumes
  private europaPlume!: THREE.Points;

  // Solar wind particles streaming from sun
  private solarWind!: THREE.Points;
  private solarWindPositions!: Float32Array;

  // Jupiter radiation belts
  private radiationBelt!: THREE.Mesh;

  // Trojan asteroid clusters at L4/L5
  private trojanL4!: THREE.InstancedMesh;
  private trojanL5!: THREE.InstancedMesh;

  // Zodiacal light
  private zodiacalLight!: THREE.Mesh;

  // Orbit controls (Google Earth-style)
  private controls!: OrbitControls;
  private userInteracting = false;
  private userInteractionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Shared texture loader
  private textureLoader!: THREE.TextureLoader;

  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  
  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.isBrowser && (changes['slideIndex'] || changes['slideId'])) {
      this.userInteracting = false; // Reset to slide-driven camera on slide change
      if (this.userInteractionTimeout) clearTimeout(this.userInteractionTimeout);
      this.updateCameraForSlide(this.slideId);
    }
  }

  private updateCameraForSlide(id: string) {
    this.targetJupiterRotationY = null; // Default to normal rotation
    this.targetStarSpeed = 0.0001;
    this.targetMoonSpeedMultiplier = 1;
    this.targetAtmospherePulse = 0;
    this.targetJupiterSpinSpeed = 0.0005;
    this.targetShipSpeedMultiplier = 1;
    this.earthOrbitActive = false;
    this.distanceBeamActive = false;
    if (this.earthMesh) this.earthMesh.visible = false; // Hide earth by default
    if (this.distanceBeam) this.distanceBeam.visible = false;

    switch(id) {
      case 'title':
      case 'afsluiting':
        // Majestic wide shot
        this.baseCameraX = 0; this.baseCameraY = 0; this.baseCameraZ = 45;
        this.targetLookAt.set(0, 0, 0);
        this.targetShipSpeedMultiplier = 0.5;
        break;
      case 'inhoud':
        // Slightly angled overview
        this.baseCameraX = 25; this.baseCameraY = 10; this.baseCameraZ = 25;
        this.targetLookAt.set(0, 0, 0);
        break;
      case 'h1':
        // Composition / Gas giant - Close up on the bands, pulsing atmosphere
        this.baseCameraX = -16; this.baseCameraY = 0; this.baseCameraZ = 16;
        this.targetLookAt.set(-4, 0, 0);
        this.targetAtmospherePulse = 1; // Enable pulsing
        break;
      case 'h2':
        // The Great Red Spot - Zoom in dramatically close to the storm
        this.baseCameraX = 8; this.baseCameraY = -5; this.baseCameraZ = 6;
        this.targetLookAt.set(10, -3, -10);
        this.targetJupiterRotationY = 4.7;
        break;
      case 'h3':
        // Distance - Show Earth and Jupiter with distance beam
        this.baseCameraX = -5; this.baseCameraY = 18; this.baseCameraZ = 50;
        this.targetLookAt.set(0, 0, -8);
        this.targetStarSpeed = 0.002;
        this.targetShipSpeedMultiplier = 2;
        if (this.earthMesh) this.earthMesh.visible = true;
        this.earthOrbitActive = true;
        this.distanceBeamActive = true;
        break;
      case 'h4':
        // Age - Slow flyby
        this.baseCameraX = -20; this.baseCameraY = -10; this.baseCameraZ = 20;
        this.targetLookAt.set(0, 0, 0);
        break;
      case 'h5':
        // Size and Gravity - Look up at Jupiter from below, fast moons, show Earth
        this.baseCameraX = 0; this.baseCameraY = -18; this.baseCameraZ = 22;
        this.targetLookAt.set(0, 6, 0);
        this.targetMoonSpeedMultiplier = 35; // Super fast moons to show gravity
        if (this.earthMesh) {
          this.earthMesh.visible = true;
          this.earthMesh.position.set(-8, 2, -5);
        }
        break;
      case 'extra':
        // Moons - High angle looking down at the orbital plane
        this.baseCameraX = 0; this.baseCameraY = 35; this.baseCameraZ = 25;
        this.targetLookAt.set(0, 0, 0);
        break;
      case 'quiz':
        // Dramatic close-up and fast spin for the quiz
        this.baseCameraX = 0; this.baseCameraY = 0; this.baseCameraZ = 18;
        this.targetLookAt.set(0, 0, 0);
        this.targetJupiterSpinSpeed = 0.015; // Dynamic fast spin
        this.targetStarSpeed = 0.005; // Slightly faster stars
        this.targetShipSpeedMultiplier = 2;
        break;
      default:
    }
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.initThreeJs();
      Promise.all(this.loadPromises).then(() => this.loaded.emit());
      this.ngZone.runOutsideAngular(() => {
        this.animate();
      });
      globalThis.addEventListener('resize', this.onWindowResize.bind(this));
      globalThis.addEventListener('mousemove', this.onMouseMove.bind(this));
    }
  }

  ngOnDestroy() {
    if (this.isBrowser) {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
      }
      globalThis.removeEventListener('resize', this.onWindowResize.bind(this));
      globalThis.removeEventListener('mousemove', this.onMouseMove.bind(this));
      if (this.renderer) {
        this.renderer.dispose();
      }
      if (this.controls) {
        this.controls.dispose();
      }
      if (this.userInteractionTimeout) {
        clearTimeout(this.userInteractionTimeout);
      }
    }
  }

  private onMouseMove(event: MouseEvent) {
    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  /** Generates a high-fidelity 4K procedural Jupiter texture with Perlin-noise bands */
  private generateJupiterTexture(): THREE.CanvasTexture {
    const W = 4096, H = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(W, H);
    const data = imageData.data;

    // Permutation table for Perlin noise
    const perm = new Uint8Array(512);
    const p0 = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p0[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p0[i], p0[j]] = [p0[j], p0[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p0[i & 255];

    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a: number, b: number, t: number) => a + t * (b - a);
    const grad = (hash: number, x: number, y: number) => {
      switch (hash & 3) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        default: return -x - y;
      }
    };
    const perlin2d = (x: number, y: number) => {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
      const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
      return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
                  lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v);
    };
    const fbm = (x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5) => {
      let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
      for (let i = 0; i < octaves; i++) {
        value += perlin2d(x * frequency, y * frequency) * amplitude;
        maxAmp += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
      }
      return value / maxAmp;
    };

    // Jupiter band color definitions: alternating zones and belts
    const bands: { latMin: number; latMax: number; r: number; g: number; b: number }[] = [
      // South polar region
      { latMin: 0, latMax: 0.08, r: 115, g: 110, b: 105 },
      // South temperate belt
      { latMin: 0.08, latMax: 0.16, r: 155, g: 100, b: 65 },
      // South temperate zone
      { latMin: 0.16, latMax: 0.24, r: 210, g: 190, b: 165 },
      // South equatorial belt (dark, strong)
      { latMin: 0.24, latMax: 0.36, r: 165, g: 95, b: 55 },
      // Equatorial zone (bright white/cream)
      { latMin: 0.36, latMax: 0.55, r: 235, g: 225, b: 210 },
      // North equatorial belt (prominent dark brown)
      { latMin: 0.55, latMax: 0.68, r: 160, g: 90, b: 50 },
      // North tropical zone
      { latMin: 0.68, latMax: 0.76, r: 215, g: 195, b: 168 },
      // North temperate belt
      { latMin: 0.76, latMax: 0.84, r: 170, g: 115, b: 72 },
      // North temperate zone
      { latMin: 0.84, latMax: 0.92, r: 200, g: 185, b: 160 },
      // North polar region
      { latMin: 0.92, latMax: 1, r: 120, g: 115, b: 110 },
    ];

    const getBandColor = (lat: number): [number, number, number] => {
      for (let i = 0; i < bands.length - 1; i++) {
        const b = bands[i], next = bands[i + 1];
        if (lat >= b.latMin && lat < next.latMin) {
          // Smooth blend at edges
          const edgeWidth = 0.025;
          const distToEnd = next.latMin - lat;
          if (distToEnd < edgeWidth) {
            const t = 1 - distToEnd / edgeWidth;
            return [
              b.r + (next.r - b.r) * t * t,
              b.g + (next.g - b.g) * t * t,
              b.b + (next.b - b.b) * t * t
            ];
          }
          return [b.r, b.g, b.b];
        }
      }
      const last = bands.at(-1)!;
      return [last.r, last.g, last.b];
    };

    for (let py = 0; py < H; py++) {
      const v = py / H; // 0-1 from top to bottom
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const idx = (py * W + px) * 4;

        // Multi-octave noise for turbulent band distortion
        const nx = u * 8; // wraps nicely
        const ny = v * 4;
        const turbulence = fbm(nx, ny * 6, 6, 2.2, 0.48);
        const fineTurb = fbm(nx * 4, ny * 12, 4, 2.5, 0.4) * 0.3;

        // Distort the latitude lookup with noise to create wavy band edges
        const distortedLat = Math.max(0, Math.min(1, v + turbulence * 0.025 + fineTurb * 0.008));
        let [r, g, b] = getBandColor(distortedLat);

        // Apply noise-based hue/brightness variation within bands
        const bandNoise = fbm(nx * 2 + 100, ny * 8 + 50, 5, 2, 0.5);
        const detailNoise = fbm(nx * 8 + 200, ny * 20 + 150, 4, 2.3, 0.45);
        r += bandNoise * 18 + detailNoise * 8;
        g += bandNoise * 12 + detailNoise * 5;
        b += bandNoise * 8 + detailNoise * 3;

        // Longitudinal streaks (jet streams)
        const jetStream = Math.sin(v * Math.PI * 35 + turbulence * 8) * 0.5 + 0.5;
        const streakIntensity = jetStream * fbm(nx * 3, ny * 2, 3) * 12;
        r += streakIntensity;
        g += streakIntensity * 0.7;
        b += streakIntensity * 0.4;

        // Apply GRS, storms, and polar darkening
        [r, g, b] = this.applyTextureEffects(u, v, r, g, b, fbm);

        data[idx]     = Math.max(0, Math.min(255, r));
        data[idx + 1] = Math.max(0, Math.min(255, g));
        data[idx + 2] = Math.max(0, Math.min(255, b));
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    if ('SRGBColorSpace' in THREE) {
      texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
    }
    texture.wrapS = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private applyTextureEffects(
    u: number, v: number, r: number, g: number, b: number,
    fbm: (x: number, y: number, octaves: number, lacunarity?: number, gain?: number) => number
  ): [number, number, number] {
    const grsU = 0.293, grsV = 0.635;
    const grsRadiusX = 0.044, grsRadiusY = 0.022;
    const nx = u * 8, ny = v * 4;
    // Great Red Spot
    const du = u - grsU, dv = v - grsV;
    const grsDistSq = (du * du) / (grsRadiusX * grsRadiusX) + (dv * dv) / (grsRadiusY * grsRadiusY);
    if (grsDistSq < 4) {
      const grsDist = Math.sqrt(grsDistSq);
      const angle = Math.atan2(dv, du);
      const spiral = Math.sin(angle * 3 + grsDist * 8 + fbm(nx * 5 + 300, ny * 10 + 300, 3) * 4);

      if (grsDist < 1) {
        const t = grsDist;
        const coreR = 195 + spiral * 25;
        const coreG = 65 + spiral * 15 + t * 20;
        const coreB = 35 + spiral * 10 + t * 15;
        const mix = (1 - t) * 0.9;
        r = r * (1 - mix) + coreR * mix;
        g = g * (1 - mix) + coreG * mix;
        b = b * (1 - mix) + coreB * mix;
      } else if (grsDist < 2) {
        const haloT = (grsDist - 1);
        const swirlEffect = (1 - haloT) * 0.35 * (0.5 + spiral * 0.5);
        r = r + swirlEffect * 40;
        g = g - swirlEffect * 10;
        b = b - swirlEffect * 15;
      }
    }

    // White oval storms
    const stormSeed = Math.floor(v * 20) * 1000 + Math.floor(u * 30);
    const stormNoise = fbm(u * 40 + stormSeed * 0.001, v * 40, 2);
    if (stormNoise > 0.42 && Math.abs(v - 0.5) > 0.12) {
      const bright = (stormNoise - 0.42) * 80;
      r = Math.min(255, r + bright);
      g = Math.min(255, g + bright * 0.9);
      b = Math.min(255, b + bright * 0.7);
    }

    // Polar darkening
    const polarFade = Math.abs(v - 0.5) * 2;
    if (polarFade > 0.8) {
      const darkening = (polarFade - 0.8) * 2.5;
      r *= 1 - darkening * 0.4;
      g *= 1 - darkening * 0.4;
      b *= 1 - darkening * 0.35;
    }

    return [r, g, b];
  }

  private initThreeJs() {
    const container = this.canvasContainer.nativeElement;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = this.targetCameraZ;
    this.camera.position.x = this.targetCameraX;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // Orbit controls — Google Earth-style zoom/pan/rotate
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.5;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 200;
    this.controls.enablePan = true;
    this.controls.target.set(12, 0, -15); // Look at Jupiter
    this.controls.addEventListener('start', () => {
      this.userInteracting = true;
      if (this.userInteractionTimeout) clearTimeout(this.userInteractionTimeout);
    });
    this.controls.addEventListener('end', () => {
      // After 4 seconds of no interaction, resume slide-driven camera
      if (this.userInteractionTimeout) clearTimeout(this.userInteractionTimeout);
      this.userInteractionTimeout = setTimeout(() => {
        this.userInteracting = false;
      }, 4000);
    });

    // Milky Way skybox — immersive backdrop sphere
    const skyGeo = new THREE.SphereGeometry(500, 32, 32);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x111122,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    // Load milky way texture onto skybox
    this.textureLoader = new THREE.TextureLoader();
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_stars_milky_way.jpg', (tex) => {
        skyMat.map = tex;
        skyMat.color.setHex(0x444466); // slightly tinted to not overpower scene
        skyMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Foreground space dust — slow drifting motes near camera for depth parallax
    const fgDustCount = 150;
    const fgDustGeo = new THREE.BufferGeometry();
    const fgDustPos = new Float32Array(fgDustCount * 3);
    for (let i = 0; i < fgDustCount; i++) {
      fgDustPos[i * 3] = (Math.random() - 0.5) * 80;
      fgDustPos[i * 3 + 1] = (Math.random() - 0.5) * 80;
      fgDustPos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    fgDustGeo.setAttribute('position', new THREE.Float32BufferAttribute(fgDustPos, 3));
    const fgDust = new THREE.Points(fgDustGeo, new THREE.PointsMaterial({
      color: 0x6688cc, transparent: true, opacity: 0.12,
      size: 0.15, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.scene.add(fgDust);

    // Stars - Multi-colored with size variation and twinkle
    const starsGeometry = new THREE.BufferGeometry();
    const starsVertices = [];
    const starsColors = [];
    const starsSizes = [];
    const starColorPalette = [
      [1, 1, 1],
      [0.8, 0.85, 1],
      [1, 0.95, 0.8],
      [1, 0.8, 0.7],
      [0.7, 0.8, 1],
    ];

    for (let i = 0; i < 20000; i++) {
      starsVertices.push(
        THREE.MathUtils.randFloatSpread(2000),
        THREE.MathUtils.randFloatSpread(2000),
        THREE.MathUtils.randFloatSpread(2000)
      );
      const color = starColorPalette[Math.floor(Math.random() * starColorPalette.length)];
      starsColors.push(color[0], color[1], color[2]);
      starsSizes.push(Math.random() * 2.5 + 0.5);
    }

    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starsColors, 3));
    starsGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(starsSizes, 1));

    const starsMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float twinkle = sin(uTime * 2.0 + position.x * 0.1 + position.y * 0.15) * 0.3 + 0.7;
          gl_PointSize = aSize * twinkle * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = smoothstep(0.5, 0.0, dist);
          float core = smoothstep(0.3, 0.0, dist);
          vec3 finalColor = vColor + core * 0.5;
          gl_FragColor = vec4(finalColor, alpha * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.stars = new THREE.Points(starsGeometry, starsMaterial);
    this.scene.add(this.stars);

    // Add space dust / particles for parallax depth
    const dustGeometry = new THREE.BufferGeometry();
    const dustCount = 1500;
    const dustPos = new Float32Array(dustCount * 3);
    for(let i=0; i<dustCount*3; i++) {
        dustPos[i] = (Math.random() - 0.5) * 100;
    }
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMaterial = new THREE.PointsMaterial({ 
      color: 0xaaaaaa, 
      size: 0.15, 
      transparent: true, 
      opacity: 0.4 
    });
    this.dustSystem = new THREE.Points(dustGeometry, dustMaterial);
    this.scene.add(this.dustSystem);

    // Deep-space nebula clouds
    const nebulaConfigs = [
      { color: new THREE.Color(0x1a0a2e), radius: 250, pos: [-300, 100, -500] },
      { color: new THREE.Color(0x0a1628), radius: 300, pos: [200, -80, -600] },
      { color: new THREE.Color(0x2e0a0a), radius: 220, pos: [100, 200, -450] },
      { color: new THREE.Color(0x220044), radius: 280, pos: [-150, -60, -550] },
      { color: new THREE.Color(0x003322), radius: 200, pos: [300, 150, -400] },
      { color: new THREE.Color(0x441100), radius: 260, pos: [-250, -120, -650] },
      { color: new THREE.Color(0x110033), radius: 320, pos: [50, 100, -700] },
      { color: new THREE.Color(0x330011), radius: 240, pos: [180, -150, -500] },
    ];
    nebulaConfigs.forEach((cfg, i) => {
      const nebulaGeo = new THREE.SphereGeometry(cfg.radius, 32, 32);
      const nebulaMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: cfg.color },
          uTime: { value: 0 },
          uSeed: { value: i * 42.5 }
        },
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTime;
          uniform float uSeed;
          varying vec3 vPos;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float noise(vec3 p) {
            vec3 i = floor(p); vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i); float b = hash(i + vec3(1,0,0));
            float c = hash(i + vec3(0,1,0)); float d = hash(i + vec3(1,1,0));
            float e = hash(i + vec3(0,0,1)); float f1 = hash(i + vec3(1,0,1));
            float g = hash(i + vec3(0,1,1)); float h = hash(i + vec3(1,1,1));
            return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,f1,f.x), mix(g,h,f.x), f.y), f.z);
          }
          float fbm(vec3 p) {
            float v = 0.0; float a = 0.5;
            for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
            return v;
          }
          void main() {
            vec3 pos = normalize(vPos) * 3.0 + uSeed;
            float n = fbm(pos + uTime * 0.01);
            float alpha = smoothstep(0.3, 0.7, n) * 0.12;
            gl_FragColor = vec4(uColor * 2.0, alpha);
          }
        `,
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
      nebula.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      this.scene.add(nebula);
      this.nebulae.push(nebula);
    });

    // Group for Jupiter and Atmosphere
    this.jupiterGroup = new THREE.Group();
    this.jupiterGroup.position.set(12, 0, -15);
    this.jupiterGroup.rotation.z = 0.0546; // Jupiter axial tilt: 3.13°
    this.scene.add(this.jupiterGroup);

    // Jupiter Texture Generation — High-fidelity procedural with Perlin noise bands
    const fallbackTexture = this.generateJupiterTexture();
    fallbackTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    
    const jupiterGeometry = new THREE.SphereGeometry(10, 256, 256);
    const jupiterMaterial = new THREE.MeshStandardMaterial({ 
      map: fallbackTexture,
      roughness: 0.35,
      metalness: 0,
      envMapIntensity: 0.3
    });

    // Cinematic shader enhancement — red spot glow, subsurface warmth, micro-contrast
    jupiterMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <map_fragment>`,
        `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          
          // Enhance the Great Red Spot with a warm glow
          float redDominance = max(0.0, sampledDiffuseColor.r - max(sampledDiffuseColor.g, sampledDiffuseColor.b) * 0.85);
          sampledDiffuseColor.r += redDominance * 0.4;
          sampledDiffuseColor.g += redDominance * 0.05;
          
          // Micro-contrast for band definition
          vec3 luma = vec3(dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
          sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * sampledDiffuseColor.rgb * 1.8, 0.15);
          
          // Warm subsurface scattering tint (gas giant internal heat)
          sampledDiffuseColor.rgb += vec3(0.02, 0.008, 0.0) * (1.0 - dot(sampledDiffuseColor.rgb, vec3(0.333)));
          
          // Subtle cinematic color grading — push shadows blue, highlights warm
          float brightness = dot(sampledDiffuseColor.rgb, vec3(0.333));
          sampledDiffuseColor.rgb += mix(vec3(-0.01, -0.005, 0.02), vec3(0.02, 0.01, -0.01), brightness);

          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
          #endif
          diffuseColor *= sampledDiffuseColor;
        #endif
        `
      );
    };
    
    this.jupiter = new THREE.Mesh(jupiterGeometry, jupiterMaterial);
    this.jupiterGroup.add(this.jupiter);

    // Load NASA HST OPAL high-res Jupiter map from local assets
    const textureLoader = this.textureLoader;
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load(
        '20181107_hlsp_opal_hst_wfc3-uvis_jupiter-2017a_color_globalmap2.jpg',
        (texture) => {
          if ('SRGBColorSpace' in THREE) {
            texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
          }
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          jupiterMaterial.map = texture;
          jupiterMaterial.needsUpdate = true;
          resolve();
        },
        undefined,
        () => { console.warn('Could not load high-res Jupiter texture, using procedural fallback.'); resolve(); }
      );
    }));

    // Create Earth for scale comparison (Slide 5)
    // Jupiter radius is 10. Earth radius is ~11.2 times smaller, so 10 / 11.2 = 0.89
    const earthGeometry = new THREE.SphereGeometry(0.89, 64, 64);
    const earthMaterial = new THREE.MeshStandardMaterial({
      color: 0x2266cc, // Base blue if texture fails
      roughness: 0.6,
      metalness: 0.1
    });
    
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    // Position Earth to the left and slightly in front of Jupiter so it's clearly visible on slide 5
    // Jupiter is at (12, 0, -15). We want Earth to be near the camera focus on slide 5.
    // Slide 5 camera looks at (0, 6, 0) and is at (0, -18, 22).
    // Let's place Earth at (-8, 2, -5) relative to the scene, which puts it nicely in frame.
    this.earthMesh.position.set(-8, 2, -5);
    this.earthMesh.visible = false; // Hidden by default
    this.scene.add(this.earthMesh);

    // Earth Texture from local 8K asset
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load(
        '8k_earth_daymap.jpg',
        (texture) => {
          if ('SRGBColorSpace' in THREE) {
            texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
          }
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          earthMaterial.map = texture;
          earthMaterial.color.setHex(0xffffff);
          earthMaterial.needsUpdate = true;
          resolve();
        },
        undefined,
        () => { console.warn('Could not load Earth texture.'); resolve(); }
      );
    }));

    // Earth atmosphere glow (blue fresnel rim)
    const earthAtmoMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPosition, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float fresnel = 1.0 - dot(viewDir, vNormal);
          fresnel = pow(fresnel, 3.0);
          vec3 color = mix(vec3(0.3, 0.6, 1.0), vec3(0.6, 0.85, 1.0), fresnel);
          gl_FragColor = vec4(color, fresnel * 0.7);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const earthAtmo = new THREE.Mesh(new THREE.SphereGeometry(1.08, 32, 32), earthAtmoMat);
    this.earthMesh.add(earthAtmo);

    // Jupiter's Faint Ring System
    const ringGeometry = new THREE.RingGeometry(12, 18, 128);
    const pos = ringGeometry.attributes['position'];
    const v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++){
        v3.fromBufferAttribute(pos as THREE.BufferAttribute, i);
        (ringGeometry.attributes['uv'] as THREE.BufferAttribute).setXY(i, v3.length() < 15 ? 0 : 1, 1);
    }
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x887766,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2 + 0.05; // Align with equator
    this.jupiterGroup.add(ring);

    // Atmosphere Glow (Custom Shader)
    const vertexShader = `
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vNormalWorld;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vNormalWorld = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * vec4(vPosition, 1.0);
      }
    `;
    
    const fragmentShader = `
      uniform float uTime;
      uniform float uPulse;
      uniform vec3 uSunDirection;

      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vNormalWorld;

      // 3D noise for atmospheric turbulence
      float hash(float n) { return fract(sin(n) * 1e4); }
      float noise(vec3 x) {
          const vec3 step = vec3(110.0, 241.0, 171.0);
          vec3 i = floor(x);
          vec3 f = fract(x);
          float n = dot(i, step);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix( hash(n + dot(step, vec3(0, 0, 0))), hash(n + dot(step, vec3(1, 0, 0))), u.x),
                         mix( hash(n + dot(step, vec3(0, 1, 0))), hash(n + dot(step, vec3(1, 1, 0))), u.x), u.y),
                     mix(mix( hash(n + dot(step, vec3(0, 0, 1))), hash(n + dot(step, vec3(1, 0, 1))), u.x),
                         mix( hash(n + dot(step, vec3(0, 1, 1))), hash(n + dot(step, vec3(1, 1, 1))), u.x), u.y), u.z);
      }

      void main() {
        vec3 viewDirection = normalize(-vPosition);
        float fresnel = dot(viewDirection, vNormal);
        fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
        
        // Sun direction and scattering
        vec3 sunDir = normalize(uSunDirection);
        float sunDot = dot(vNormalWorld, sunDir);
        
        // Volumetric scattering approximations
        // Rayleigh scattering (prominent on day side)
        float rayleigh = smoothstep(-0.2, 1.0, sunDot);
        
        // Terminator glow (pronounced at the day/night boundary)
        float terminatorGlow = smoothstep(0.25, 0.0, abs(sunDot + 0.05));
        
        // Mie scattering (forward scattering halo around the sun)
        float mie = pow(max(dot(viewDirection, sunDir), 0.0), 8.0) * smoothstep(0.0, 0.5, sunDot);

        // Base glow from fresnel (edge of the atmosphere)
        float baseGlow = pow(fresnel, 3.5) * 1.5 + pow(fresnel, 7.0) * 2.5;
        
        // Atmospheric turbulence (shimmer/pulse)
        float turbulence = noise(vNormalWorld * 6.0 + uTime * 0.3);
        float highFreqTurbulence = noise(vNormalWorld * 15.0 - uTime * 0.6);
        float combinedTurbulence = mix(turbulence, highFreqTurbulence, 0.4);
        
        // The pulse intensity controls how active the atmosphere is
        float activePulse = uPulse * combinedTurbulence;
        
        // Combine effects
        float finalGlow = baseGlow * rayleigh + 
                          baseGlow * terminatorGlow * 3.0 + 
                          mie * 1.2 + 
                          (activePulse * fresnel * 4.0);

        // Colors
        vec3 dayColor = vec3(0.3, 0.6, 1.0); // Sci-fi blue/cyan
        vec3 nightColor = vec3(0.02, 0.05, 0.1); // Deep blue/black
        vec3 terminatorColor = vec3(1.0, 0.4, 0.05); // Fiery orange
        
        // Mix colors based on sun position
        vec3 colorMix = mix(nightColor, dayColor, rayleigh);
        colorMix = mix(colorMix, terminatorColor, terminatorGlow * 0.9);
        
        // Add pulse color (bright cyan/white flashes)
        vec3 pulseColor = vec3(0.7, 0.9, 1.0) * activePulse;
        colorMix += pulseColor;
        
        // Fade out the atmosphere on the dark side, except for the terminator
        float alpha = finalGlow * smoothstep(-0.4, 0.1, sunDot + terminatorGlow);
        
        gl_FragColor = vec4(colorMix, clamp(alpha, 0.0, 1.0));
      }
    `;

    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(-50, 10, 30).normalize() }
      },
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });

    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(10.3, 128, 128), atmosphereMaterial);
    this.jupiterGroup.add(this.atmosphere);

    // The 4 Galilean Moons — Kepler's 3rd law: T² ∝ a³, so ω ∝ a^(-3/2)
    // Real orbital periods: Io=1.769d, Europa=3.551d, Ganymede=7.155d, Callisto=16.689d
    // Speed ratios = inverse period ratios (ω = 2π/T)
    // Sizes proportional to real radii: Io=1821km, Europa=1561km, Ganymede=2634km, Callisto=2410km
    const galileanConfigs = [
      { name: 'Io', color: 0xddaa33, size: 0.3, distance: 14, speed: 0.008, texture: '2k_io.jpg' },
      { name: 'Europa', color: 0xeeeeee, size: 0.26, distance: 18, speed: 0.00398, texture: '2k_europa.jpg' },
      { name: 'Ganymede', color: 0xaaaaaa, size: 0.43, distance: 24, speed: 0.00198, texture: '2k_ganymede.jpg' },
      { name: 'Callisto', color: 0x666666, size: 0.4, distance: 32, speed: 0.000848, texture: '2k_callisto.jpg' }
    ];

    galileanConfigs.forEach(config => {
      const geo = new THREE.SphereGeometry(config.size, 32, 32);
      const mat = new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.8, bumpScale: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      this.jupiterGroup.add(mesh);
      this.galileanMoons.push({ mesh, distance: config.distance, speed: config.speed, angle: Math.random() * Math.PI * 2 });

      // Load real texture
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load(config.texture, (tex) => {
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          mat.map = tex; mat.color.setHex(0xffffff); mat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));
    });

    // The remaining 91 small moons (Total 95)
    const smallMoonGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const smallMoonMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
    this.smallMoons = new THREE.InstancedMesh(smallMoonGeo, smallMoonMat, 91);
    
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 91; i++) {
      const distance = 12 + Math.random() * 40;
      const speed = (Math.random() * 0.005 + 0.001) * (Math.random() > 0.5 ? 1 : -1);
      const angle = Math.random() * Math.PI * 2;
      const inclination = (Math.random() - 0.5) * Math.PI * 0.5; // Up to 45 deg inclination
      
      this.smallMoonsData.push({ distance, speed, angle, inclination });
      
      dummy.position.set(
        distance * Math.cos(angle),
        distance * Math.sin(angle) * Math.sin(inclination),
        distance * Math.sin(angle) * Math.cos(inclination)
      );
      dummy.updateMatrix();
      this.smallMoons.setMatrixAt(i, dummy.matrix);
    }
    this.jupiterGroup.add(this.smallMoons);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x111111);
    this.scene.add(ambientLight);

    // Main sun light (Warmer and brighter for cinematic contrast)
    const sunLight = new THREE.DirectionalLight(0xffeedd, 4);
    sunLight.position.set(-50, 10, 30);
    this.scene.add(sunLight);

    // Subtle rim light for cinematic effect (Menacing Sith/Empire fiery orange rim)
    const rimLight = new THREE.DirectionalLight(0xff3300, 3.5);
    rimLight.position.set(50, -20, -30);
    this.scene.add(rimLight);

    // Deep space blue fill light for cinematic teal/orange contrast
    const fillLight = new THREE.DirectionalLight(0x0044ff, 0.8);
    fillLight.position.set(0, 20, 20);
    this.scene.add(fillLight);

    // Cinematic Anamorphic Lens Flare
    const flareGeo = new THREE.PlaneGeometry(120, 120);
    const flareMat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0x88bbff) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mvPosition.xy += position.xy;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center);
          float core = 0.02 / (dist + 0.01) - 0.02;
          float streak = smoothstep(0.5, 0.0, abs(center.y * 30.0)) * smoothstep(0.5, 0.0, abs(center.x));
          float streak2 = smoothstep(0.5, 0.0, abs(center.y * 80.0)) * smoothstep(0.5, 0.0, abs(center.x * 0.8));
          float intensity = clamp(core + streak + streak2 * 1.5, 0.0, 1.0);
          gl_FragColor = vec4(color * intensity, intensity * 0.9);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    });
    const sunFlare = new THREE.Mesh(flareGeo, flareMat);
    sunFlare.position.copy(sunLight.position);
    this.scene.add(sunFlare);

    // Post-processing setup (Film Grain & Vignette)
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        float random(vec2 p) { return fract(sin(dot(p.xy, vec2(12.9898,78.233))) * 43758.5453123); }
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center);
          
          // Deeper cinematic vignette
          float vignette = smoothstep(1.0, 0.2, dist * 1.3);
          
          // Organic film grain
          float grain = (random(vUv * 1000.0 + mod(uTime, 10.0)) - 0.5) * 0.06;
          
          // Subtle anamorphic horizontal streak
          float streak = smoothstep(0.5, 0.0, abs(center.y)) * smoothstep(0.6, 0.3, abs(center.x)) * 0.015;
          
          vec4 overlayColor = vec4(0.0, 0.0, 0.0, 1.0 - vignette);
          
          // Teal-orange color grading at edges
          overlayColor.r += dist * 0.04;
          overlayColor.b += dist * 0.02;
          
          overlayColor.rgb += grain;
          overlayColor.a += abs(grain) * 0.4;
          overlayColor.a = max(overlayColor.a - streak, 0.0);
          
          gl_FragColor = overlayColor;
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

    // Add spaceships
    this.createSpaceships();

    // Galaxy effects for deep-space feel
    this.createGalaxyEffects();

    // Solar system planets: Saturn, Mars
    this.createSolarSystemPlanets();

    // Asteroid belt between Mars and Jupiter
    this.createAsteroidBelt();

    // Shooting stars (meteor pool)
    this.createShootingStars();

    // Comet with ion + dust tails
    this.createComet();

    // Jupiter polar aurora
    this.createJupiterAurora();

    // Faint orbital rings for Galilean moons
    this.createOrbitalRings();

    // Enhance Galilean moon details (Io volcanism, Europa ice)
    this.enhanceGalileanMoons();

    // Sun with corona glow
    this.createSun();

    // Jupiter night-side lightning flashes
    this.createLightning();

    // Io plasma torus (ionized sulfur along Io orbit)
    this.createIoPlasmaTorus();

    // Europa water plumes (Hubble discovery)
    this.createEuropaPlumes();

    // Solar wind particle stream
    this.createSolarWind();

    // Jupiter radiation belts
    this.createRadiationBelts();

    // Trojan asteroids at L4/L5 Lagrange points
    this.createTrojanAsteroids();

    // Zodiacal light along the ecliptic
    this.createZodiacalLight();

    // Distance beam between Earth and Jupiter
    this.createDistanceBeam();
  }

  private updateAtmosphere(time: number) {
    if (this.atmosphere) {
      const pulseScale = 1 + Math.sin(time * 3) * 0.03 * this.currentAtmospherePulse;
      this.atmosphere.scale.set(pulseScale, pulseScale, pulseScale);

      const mat = this.atmosphere.material as THREE.ShaderMaterial;
      if (mat.uniforms) {
        mat.uniforms['uTime'].value = time;
        mat.uniforms['uPulse'].value = this.currentAtmospherePulse;
      }
    }
  }

  private updateCamera() {
    if (this.camera) {
      if (!this.userInteracting) {
        // Slide-driven camera with mouse parallax
        this.targetCameraX = this.baseCameraX + this.mouseX * 4;
        this.targetCameraY = this.baseCameraY + this.mouseY * 4;
        this.targetCameraZ = this.baseCameraZ;

        this.camera.position.x += (this.targetCameraX - this.camera.position.x) * 0.035;
        this.camera.position.y += (this.targetCameraY - this.camera.position.y) * 0.035;
        this.camera.position.z += (this.targetCameraZ - this.camera.position.z) * 0.035;

        this.currentLookAt.lerp(this.targetLookAt, 0.035);
        this.controls.target.copy(this.currentLookAt);
      }
      this.controls.update();
    }
  }

  private updateJupiterRotation() {
    if (this.jupiterGroup) {
      if (this.targetJupiterRotationY === null) {
        this.jupiterGroup.rotation.y += this.currentJupiterSpinSpeed;
      } else {
        const diff = this.targetJupiterRotationY - this.jupiterGroup.rotation.y;
        const normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.jupiterGroup.rotation.y += normalizedDiff * 0.02;
      }
    }
  }

  private updateMoons() {
    this.galileanMoons.forEach(moon => {
      moon.angle += moon.speed * this.currentMoonSpeedMultiplier;
      moon.mesh.position.x = Math.cos(moon.angle) * moon.distance;
      moon.mesh.position.z = Math.sin(moon.angle) * moon.distance;
      moon.mesh.rotation.y += 0.01 * this.currentMoonSpeedMultiplier;
    });

    if (this.smallMoons) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 91; i++) {
        const data = this.smallMoonsData[i];
        data.angle += data.speed * this.currentMoonSpeedMultiplier;
        dummy.position.set(
          data.distance * Math.cos(data.angle),
          data.distance * Math.sin(data.angle) * Math.sin(data.inclination),
          data.distance * Math.sin(data.angle) * Math.cos(data.inclination)
        );
        dummy.updateMatrix();
        this.smallMoons.setMatrixAt(i, dummy.matrix);
      }
      this.smallMoons.instanceMatrix.needsUpdate = true;
    }
  }

  private updateStarsAndDust(time: number) {
    if (this.stars) {
      this.stars.rotation.y += this.currentStarSpeed;
      this.stars.rotation.x += this.currentStarSpeed * 0.5;
      const starMat = this.stars.material as THREE.ShaderMaterial;
      if (starMat.uniforms) starMat.uniforms['uTime'].value = time;
    }

    if (this.dustSystem) {
      this.dustSystem.rotation.y += this.currentStarSpeed * 3;
      this.dustSystem.rotation.x += this.currentStarSpeed;

      if (this.currentStarSpeed > 0.001) {
        const positions = this.dustSystem.geometry.attributes['position'] as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          let z = positions.getZ(i);
          z += this.currentStarSpeed * 300;
          if (z > 50) z -= 100;
          positions.setZ(i, z);
        }
        positions.needsUpdate = true;
      }
    }

    this.nebulae.forEach(mesh => {
      const mat = mesh.material as THREE.ShaderMaterial;
      if (mat.uniforms) mat.uniforms['uTime'].value = time;
    });

    if (this.galaxyBand) {
      const bandMat = this.galaxyBand.material as THREE.ShaderMaterial;
      if (bandMat.uniforms) bandMat.uniforms['uTime'].value = time;
    }

    if (this.postMaterial) {
      this.postMaterial.uniforms['uTime'].value = time;
    }
  }

  private createSpaceships() {
    const jupiterPos = this.jupiterGroup.position;
    const configs = [
      { type: 'fighter', radius: 14, speed: 0.006, y: 2, incl: 0.15, scale: 0.6 },
      { type: 'fighter', radius: 18, speed: -0.004, y: -1, incl: -0.2, scale: 0.5 },
      { type: 'fighter', radius: 16, speed: 0.005, y: 3.5, incl: 0.3, scale: 0.55 },
      { type: 'tie', radius: 20, speed: -0.005, y: -2, incl: 0.25, scale: 0.6 },
      { type: 'tie', radius: 23, speed: 0.003, y: 1.5, incl: -0.15, scale: 0.5 },
      { type: 'shuttle', radius: 28, speed: 0.002, y: 4, incl: 0.1, scale: 0.7 },
      { type: 'shuttle', radius: 33, speed: -0.0015, y: -3, incl: -0.18, scale: 0.6 },
      { type: 'fighter', radius: 40, speed: 0.003, y: 7, incl: 0.4, scale: 0.4 },
      { type: 'tie', radius: 45, speed: -0.002, y: -5, incl: -0.35, scale: 0.4 },
    ];

    configs.forEach(cfg => {
      let group: THREE.Group;
      switch (cfg.type) {
        case 'tie': group = this.buildTieShip(); break;
        case 'shuttle': group = this.buildShuttleShip(); break;
        default: group = this.buildFighterShip(); break;
      }
      group.scale.setScalar(cfg.scale);
      const angle = Math.random() * Math.PI * 2;
      const sinI = Math.sin(cfg.incl);
      const cosI = Math.cos(cfg.incl);
      group.position.set(
        jupiterPos.x + cfg.radius * Math.cos(angle),
        jupiterPos.y + cfg.y + cfg.radius * Math.sin(angle) * sinI,
        jupiterPos.z + cfg.radius * Math.sin(angle) * cosI
      );
      this.scene.add(group);
      this.spaceshipData.push({
        group,
        orbitRadius: cfg.radius,
        orbitSpeed: cfg.speed,
        orbitAngle: angle,
        orbitY: cfg.y,
        orbitInclination: cfg.incl,
      });
    });
  }

  private buildFighterShip(): THREE.Group {
    // X-Wing style: long fuselage, 4 strike foils (S-foils), 4 engine pods
    const group = new THREE.Group();
    const hullColor = 0xcccccc;
    const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, metalness: 0.5, roughness: 0.35, emissive: 0x222222, emissiveIntensity: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.2 });

    // Fuselage — long narrow nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.2, 8), hullMat);
    nose.rotation.x = -Math.PI / 2;
    group.add(nose);

    // Rear fuselage block
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.6), hullMat);
    rear.position.z = 0.55;
    group.add(rear);

    // Cockpit canopy (orange-tinted)
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xff8800, metalness: 0.9, roughness: 0.05, emissive: 0xff6600, emissiveIntensity: 0.25 });
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), canopyMat);
    canopy.position.set(0, 0.12, -0.05);
    canopy.scale.set(1, 0.6, 1.4);
    group.add(canopy);

    // Astromech droid dome behind cockpit
    const droidMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, metalness: 0.5, roughness: 0.4, emissive: 0x1133aa, emissiveIntensity: 0.2 });
    const droid = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), droidMat);
    droid.position.set(0, 0.14, 0.2);
    droid.scale.y = 0.7;
    group.add(droid);

    // 4 S-foils (strike foils) in X formation
    const wingMat = new THREE.MeshStandardMaterial({ color: hullColor, metalness: 0.4, roughness: 0.4 });
    const foilGeo = new THREE.BoxGeometry(1.2, 0.02, 0.18);
    const angles = [0.12, -0.12]; // spread angle
    const sides = [-1, 1]; // left, right
    for (const side of sides) {
      for (const angle of angles) {
        const foil = new THREE.Mesh(foilGeo, wingMat);
        foil.position.set(side * 0.6, angle * 3, 0.35);
        foil.rotation.z = side * angle;
        group.add(foil);

        // Red/orange stripe on top foils
        if (angle > 0) {
          const stripe = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.025, 0.06),
            new THREE.MeshBasicMaterial({ color: 0xcc2200 })
          );
          stripe.position.set(side * 0.75, angle * 3 + 0.015, 0.35);
          stripe.rotation.z = side * angle;
          group.add(stripe);
        }

        // Engine pod at the tip of each foil
        const engineHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8), darkMat);
        engineHousing.rotation.x = Math.PI / 2;
        engineHousing.position.set(side * 1.15, angle * 3, 0.4);
        group.add(engineHousing);

        // Engine glow
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry(0.05, 8),
          new THREE.MeshBasicMaterial({ color: 0xff4466, side: THREE.DoubleSide })
        );
        glow.position.set(side * 1.15, angle * 3, 0.53);
        group.add(glow);
      }
    }

    // Engine trails (4)
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff5577, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    for (const side of sides) {
      for (const angle of angles) {
        const trailGeo = new THREE.CylinderGeometry(0.003, 0.04, 1.0, 6);
        trailGeo.rotateX(Math.PI / 2);
        const trail = new THREE.Mesh(trailGeo, trailMat);
        trail.position.set(side * 1.15, angle * 3, 1.03);
        group.add(trail);
      }
    }

    // Laser cannon tips (4 — at end of each foil)
    const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    for (const side of sides) {
      for (const angle of angles) {
        const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 4), darkMat);
        laser.rotation.x = Math.PI / 2;
        laser.position.set(side * 1.15, angle * 3, -0.05);
        group.add(laser);
        const laserTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 4), laserMat);
        laserTip.position.set(side * 1.15, angle * 3, -0.22);
        group.add(laserTip);
      }
    }

    return group;
  }

  private buildTieShip(): THREE.Group {
    // TIE Fighter: spherical cockpit, twin hexagonal solar panels, connecting pylons
    const group = new THREE.Group();
    const imperialGrey = 0x445566;
    const darkGrey = 0x222233;
    const hullMat = new THREE.MeshStandardMaterial({ color: imperialGrey, metalness: 0.8, roughness: 0.15, emissive: 0x111122, emissiveIntensity: 0.15 });
    const darkMat = new THREE.MeshStandardMaterial({ color: darkGrey, metalness: 0.9, roughness: 0.1 });

    // Central cockpit — ball shape
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), hullMat);
    group.add(cockpit);

    // Cockpit viewport — front-facing circle window
    const viewportMat = new THREE.MeshBasicMaterial({ color: 0x88bbff, side: THREE.DoubleSide });
    const viewport = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.14, 8), viewportMat);
    viewport.position.z = -0.27;
    group.add(viewport);
    // Viewport crosshairs
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x556688, side: THREE.DoubleSide });
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.015, 0.001), crossMat);
    crossH.position.z = -0.275;
    group.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.28, 0.001), crossMat);
    crossV.position.z = -0.275;
    group.add(crossV);

    // Connecting pylons (horizontal bars from cockpit to panels)
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.85, roughness: 0.15 });
    const pylonGeo = new THREE.BoxGeometry(0.3, 0.06, 0.06);
    const pylonL = new THREE.Mesh(pylonGeo, pylonMat);
    pylonL.position.x = -0.42;
    group.add(pylonL);
    const pylonR = new THREE.Mesh(pylonGeo, pylonMat);
    pylonR.position.x = 0.42;
    group.add(pylonR);

    // Solar panel arrays — flat hexagons
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e, metalness: 0.6, roughness: 0.3,
      emissive: 0x0a0a1a, emissiveIntensity: 0.1
    });
    // Panel frame
    const frameMat = new THREE.MeshStandardMaterial({ color: imperialGrey, metalness: 0.8, roughness: 0.2 });

    for (const side of [-1, 1]) {
      // Outer frame — hexagonal ring
      const frameGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.04, 6);
      frameGeo.rotateZ(Math.PI / 2);
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.x = side * 0.6;
      group.add(frame);

      // Inner panel fill (slightly smaller solid hexagon)
      const panelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.035, 6);
      panelGeo.rotateZ(Math.PI / 2);
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.x = side * 0.6;
      group.add(panel);

      // Panel grid lines (vertical & horizontal struts on the panel)
      for (let i = -2; i <= 2; i++) {
        const gridV = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 1.0, 0.015),
          frameMat
        );
        gridV.position.set(side * 0.6, i * 0.2, 0);
        group.add(gridV);
      }
      for (let i = -2; i <= 2; i++) {
        const gridH = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.015, 1.0),
          frameMat
        );
        gridH.position.set(side * 0.6, 0, i * 0.2);
        group.add(gridH);
      }
    }

    // Twin rear ion engines (red glow)
    const engineMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    const engine = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), engineMat);
    engine.position.z = 0.28;
    group.add(engine);

    // Ion engine trail
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff2200, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const trailGeo = new THREE.CylinderGeometry(0.003, 0.06, 1.2, 6);
    trailGeo.rotateX(Math.PI / 2);
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.z = 0.88;
    group.add(trail);

    return group;
  }

  private buildShuttleShip(): THREE.Group {
    // Imperial Lambda-class Shuttle: central body, folded dorsal wing, two lower wings
    const group = new THREE.Group();
    const imperialWhite = 0xccccdd;
    const hullMat = new THREE.MeshStandardMaterial({ color: imperialWhite, metalness: 0.5, roughness: 0.3, emissive: 0x222233, emissiveIntensity: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.8, roughness: 0.15 });

    // Main body — elongated cone (front) + box (rear)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.0, 6), hullMat);
    nose.rotation.x = -Math.PI / 2;
    group.add(nose);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.9), hullMat);
    body.position.z = 0.4;
    group.add(body);

    // Cockpit windows
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x88bbff });
    const windowL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.001), windowMat);
    windowL.position.set(-0.176, 0.08, -0.1);
    group.add(windowL);
    const windowR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.001), windowMat);
    windowR.position.set(0.176, 0.08, -0.1);
    group.add(windowR);

    // Large dorsal wing (the tall center fin — Lambda's signature)
    const dorsalGeo = new THREE.BufferGeometry();
    const dorsalVerts = new Float32Array([
      0, 0.18, -0.2,   // base front
      0, 0.18, 0.85,   // base rear
      0, 1.6, 0.6,     // top point
    ]);
    dorsalGeo.setAttribute('position', new THREE.BufferAttribute(dorsalVerts, 3));
    dorsalGeo.computeVertexNormals();
    const dorsalMat = new THREE.MeshStandardMaterial({
      color: imperialWhite, metalness: 0.4, roughness: 0.3,
      side: THREE.DoubleSide, emissive: 0x111122, emissiveIntensity: 0.1
    });
    const dorsal = new THREE.Mesh(dorsalGeo, dorsalMat);
    group.add(dorsal);

    // Two lower folding wings (angled downward)
    for (const side of [-1, 1]) {
      const lowerGeo = new THREE.BufferGeometry();
      const lowerVerts = new Float32Array([
        side * 0.18, -0.18, -0.15,  // root front
        side * 0.18, -0.18, 0.8,    // root rear
        side * 1.0, -0.8, 0.5,      // tip
      ]);
      lowerGeo.setAttribute('position', new THREE.BufferAttribute(lowerVerts, 3));
      lowerGeo.computeVertexNormals();
      const lowerWing = new THREE.Mesh(lowerGeo, dorsalMat);
      group.add(lowerWing);

      // Engine nacelle at wing root
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), darkMat);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 0.18, -0.18, 0.85);
      group.add(nacelle);

      // Engine glow
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.04, 8), glowMat);
      glow.position.set(side * 0.18, -0.18, 1.0);
      group.add(glow);
    }

    // Central rear engine
    const engineMat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    const engine = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), engineMat);
    engine.position.z = 0.85;
    group.add(engine);

    // Engine trails (3 — center + two wing roots)
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    for (const xPos of [0, -0.18, 0.18]) {
      const trailGeo = new THREE.CylinderGeometry(0.003, 0.04, 1.2, 6);
      trailGeo.rotateX(Math.PI / 2);
      const trail = new THREE.Mesh(trailGeo, trailMat);
      trail.position.set(xPos, xPos === 0 ? 0 : -0.18, 1.45);
      group.add(trail);
    }

    return group;
  }

  private updateSpaceships(time: number) {
    const jupiterPos = this.jupiterGroup.position;

    this.spaceshipData.forEach(ship => {
      ship.orbitAngle += ship.orbitSpeed * this.currentShipSpeedMultiplier;
      const cosA = Math.cos(ship.orbitAngle);
      const sinA = Math.sin(ship.orbitAngle);
      const sinI = Math.sin(ship.orbitInclination);
      const cosI = Math.cos(ship.orbitInclination);

      ship.group.position.set(
        jupiterPos.x + ship.orbitRadius * cosA,
        jupiterPos.y + ship.orbitY + ship.orbitRadius * sinA * sinI,
        jupiterPos.z + ship.orbitRadius * sinA * cosI
      );

      // Face direction of travel
      const ahead = ship.orbitAngle + Math.sign(ship.orbitSpeed) * 0.1;
      ship.group.lookAt(
        jupiterPos.x + ship.orbitRadius * Math.cos(ahead),
        jupiterPos.y + ship.orbitY + ship.orbitRadius * Math.sin(ahead) * sinI,
        jupiterPos.z + ship.orbitRadius * Math.sin(ahead) * cosI
      );
    });
  }

  private createGalaxyEffects() {
    // Milky Way band - dense concentration of stars in a tilted plane
    const bandCount = 25000;
    const bandGeo = new THREE.BufferGeometry();
    const bandPos = new Float32Array(bandCount * 3);
    const bandColors = new Float32Array(bandCount * 3);
    const bandSizes = new Float32Array(bandCount);

    for (let i = 0; i < bandCount; i++) {
      const i3 = i * 3;
      const r = 80 + Math.pow(Math.random(), 0.5) * 700;
      const theta = Math.random() * Math.PI * 2;
      const thickness = (Math.random() - 0.5) * 30 * Math.exp(-Math.random() * 3);

      const x = r * Math.cos(theta);
      const y = thickness;
      const z = r * Math.sin(theta);

      // Tilt 25° and shift back
      const cosT = 0.906; // cos(25°)
      const sinT = 0.423; // sin(25°)
      bandPos[i3] = x;
      bandPos[i3 + 1] = y * cosT - z * sinT + 60;
      bandPos[i3 + 2] = y * sinT + z * cosT - 300;

      const b = 0.3 + Math.random() * 0.7;
      const colorRoll = Math.random();
      if (colorRoll < 0.4) {
        bandColors[i3] = b; bandColors[i3 + 1] = b * 0.95; bandColors[i3 + 2] = b * 0.85;
      } else if (colorRoll < 0.75) {
        bandColors[i3] = b * 0.85; bandColors[i3 + 1] = b * 0.9; bandColors[i3 + 2] = b;
      } else {
        bandColors[i3] = b; bandColors[i3 + 1] = b * 0.75; bandColors[i3 + 2] = b * 0.8;
      }
      bandSizes[i] = Math.random() * 1.5 + 0.3;
    }

    bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bandPos, 3));
    bandGeo.setAttribute('color', new THREE.Float32BufferAttribute(bandColors, 3));
    bandGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(bandSizes, 1));

    const bandMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float twinkle = sin(uTime * 1.5 + position.x * 0.05 + position.z * 0.08) * 0.15 + 0.85;
          gl_PointSize = aSize * twinkle * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = smoothstep(0.5, 0.1, dist) * 0.5;
          float core = smoothstep(0.2, 0.0, dist);
          vec3 c = vColor + core * 0.4;
          gl_FragColor = vec4(c, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.galaxyBand = new THREE.Points(bandGeo, bandMat);
    this.scene.add(this.galaxyBand);

    // Distant galaxy sprites
    const galaxyCount = 50;
    const gGeo = new THREE.BufferGeometry();
    const gPos = new Float32Array(galaxyCount * 3);
    const gSizes = new Float32Array(galaxyCount);
    for (let i = 0; i < galaxyCount; i++) {
      gPos[i * 3] = (Math.random() - 0.5) * 1500;
      gPos[i * 3 + 1] = (Math.random() - 0.5) * 800 + 50;
      gPos[i * 3 + 2] = -200 - Math.random() * 800;
      gSizes[i] = 2 + Math.random() * 5;
    }
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    gGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(gSizes, 1));

    this.scene.add(new THREE.Points(gGeo, new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aSize;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (400.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float glow = exp(-d * 6.0) * 0.6;
          float core = exp(-d * 18.0);
          vec3 color = mix(vec3(0.5, 0.4, 0.7), vec3(1.0, 0.95, 0.85), core);
          gl_FragColor = vec4(color, (glow + core * 0.4) * 0.35);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })));

    // Volumetric cosmic dust clouds
    const cDustCount = 3000;
    const cGeo = new THREE.BufferGeometry();
    const cPos = new Float32Array(cDustCount * 3);
    const cColors = new Float32Array(cDustCount * 3);
    for (let i = 0; i < cDustCount; i++) {
      cPos[i * 3] = (Math.random() - 0.5) * 300;
      cPos[i * 3 + 1] = (Math.random() - 0.5) * 300;
      cPos[i * 3 + 2] = (Math.random() - 0.5) * 300;
      const roll = Math.random();
      if (roll < 0.33) {
        cColors[i * 3] = 0.3; cColors[i * 3 + 1] = 0.2; cColors[i * 3 + 2] = 0.5;
      } else if (roll < 0.66) {
        cColors[i * 3] = 0.2; cColors[i * 3 + 1] = 0.3; cColors[i * 3 + 2] = 0.5;
      } else {
        cColors[i * 3] = 0.4; cColors[i * 3 + 1] = 0.25; cColors[i * 3 + 2] = 0.2;
      }
    }
    cGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
    cGeo.setAttribute('color', new THREE.Float32BufferAttribute(cColors, 3));
    this.scene.add(new THREE.Points(cGeo, new THREE.PointsMaterial({
      size: 0.4, transparent: true, opacity: 0.12, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));
  }

  private createSolarSystemPlanets() {
    // Saturn — visible in far background
    // Real: Saturn radius ≈ 9.45 Earth radii. Jupiter radius here = 10, Earth = 0.89
    // Saturn relative to Jupiter: 9.45/11.2 ≈ 0.84 of Jupiter → ~8.4 scene units
    // But for background we scale down for distance: use ~4 units for visual clarity
    this.saturnGroup = new THREE.Group();
    const saturnGeo = new THREE.SphereGeometry(4, 64, 64);
    const saturnMat = new THREE.MeshStandardMaterial({
      color: 0xd4b06a, roughness: 0.5, metalness: 0.1
    });
    const saturn = new THREE.Mesh(saturnGeo, saturnMat);
    this.saturnGroup.add(saturn);

    // Load Saturn texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_saturn.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        saturnMat.map = tex; saturnMat.color.setHex(0xffffff); saturnMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Saturn's iconic rings
    const innerR = 5.5, outerR = 9;
    const satRingGeo = new THREE.RingGeometry(innerR, outerR, 128, 4);
    // Create ring texture procedurally
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 512; ringCanvas.height = 64;
    const rCtx = ringCanvas.getContext('2d')!;
    // Cassini division and ring bands
    for (let x = 0; x < 512; x++) {
      const t = x / 512;
      let opacity = 0;
      let r = 210, g = 190, b = 150;
      if (t < 0.25) { // C ring (faint)
        opacity = 0.15 + Math.sin(t * 80) * 0.05;
        r = 160; g = 140; b = 110;
      } else if (t < 0.55) { // B ring (bright)
        opacity = 0.6 + Math.sin(t * 120) * 0.1;
      } else if (t < 0.62) { // Cassini division (gap)
        opacity = 0.04;
      } else if (t < 0.85) { // A ring
        opacity = 0.45 + Math.sin(t * 100) * 0.08;
        r = 200; g = 180; b = 140;
      } else { // F ring (thin, faint)
        opacity = t < 0.87 ? 0.2 : 0.05;
      }
      rCtx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
      rCtx.fillRect(x, 0, 1, 64);
    }
    const ringTexture = new THREE.CanvasTexture(ringCanvas);
    ringTexture.wrapS = THREE.ClampToEdgeWrapping;
    const satRingMat = new THREE.MeshBasicMaterial({
      map: ringTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    // Fix UVs to map radially
    const ringPos = satRingGeo.attributes['position'];
    const ringUv = satRingGeo.attributes['uv'] as THREE.BufferAttribute;
    const rv3 = new THREE.Vector3();
    for (let i = 0; i < ringPos.count; i++) {
      rv3.fromBufferAttribute(ringPos as THREE.BufferAttribute, i);
      const dist = rv3.length();
      ringUv.setXY(i, (dist - innerR) / (outerR - innerR), 0.5);
    }
    const satRing = new THREE.Mesh(satRingGeo, satRingMat);
    satRing.rotation.x = Math.PI / 2 - 0.47; // Saturn tilt ~26.7°
    this.saturnGroup.add(satRing);

    // Saturn position: far behind and to the right
    // Real: Saturn orbit ~9.5 AU, Jupiter 5.2 AU. Place it distant
    this.saturnGroup.position.set(120, 20, -200);
    this.saturnGroup.rotation.z = 0.466; // Saturn tilt: 26.7°
    this.scene.add(this.saturnGroup);

    // Mars — small red dot in the inner solar system direction
    // Real: Mars radius ≈ 0.53 Earth radii → 0.89 * 0.53 ≈ 0.47
    // Placed closer to show inner planet
    const marsGeo = new THREE.SphereGeometry(0.35, 32, 32);
    const marsMat = new THREE.MeshStandardMaterial({
      color: 0xc1440e, roughness: 0.8, metalness: 0.1
    });
    this.marsMesh = new THREE.Mesh(marsGeo, marsMat);
    this.marsMesh.position.set(-55, -5, 20);
    this.scene.add(this.marsMesh);

    // Load Mars texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_mars.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        marsMat.map = tex; marsMat.color.setHex(0xffffff); marsMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Mars atmosphere (thin, subtle)
    const marsAtmoMat = new THREE.MeshBasicMaterial({
      color: 0xff6633, transparent: true, opacity: 0.08,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const marsAtmo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), marsAtmoMat);
    this.marsMesh.add(marsAtmo);
  }

  private createAsteroidBelt() {
    // Main asteroid belt between Mars (~2.2 AU) and Jupiter (~5.2 AU)
    // In scene: Mars at ~-55x, Jupiter at ~12x → belt at ~-25x, spread over a torus
    const count = 800;
    const rockGeo = new THREE.IcosahedronGeometry(0.12, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x666655, roughness: 1, metalness: 0.2 });
    this.asteroidBelt = new THREE.InstancedMesh(rockGeo, rockMat, count);

    const dummy = new THREE.Object3D();
    const centerX = -20, centerZ = -10;
    const beltRadius = 35;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radOffset = (Math.random() - 0.5) * 12;
      const r = beltRadius + radOffset;
      const y = (Math.random() - 0.5) * 4;

      dummy.position.set(
        centerX + r * Math.cos(angle),
        y,
        centerZ + r * Math.sin(angle)
      );
      const s = 0.3 + Math.random() * 1.5;
      dummy.scale.set(s, s * (0.5 + Math.random() * 0.5), s);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.updateMatrix();
      this.asteroidBelt.setMatrixAt(i, dummy.matrix);

      // Random grey/brown colors
      const shade = 0.3 + Math.random() * 0.3;
      this.asteroidBelt.setColorAt(i, new THREE.Color(shade, shade * 0.9, shade * 0.8));
    }
    this.asteroidBelt.instanceColor!.needsUpdate = true;
    this.scene.add(this.asteroidBelt);
  }

  private createShootingStars() {
    // Pre-create a pool of shooting star meshes (initially invisible)
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(6); // 2 points (head + trail)
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.Line(geo, mat) as unknown as THREE.Mesh;
      line.visible = false;
      this.scene.add(line);
      this.shootingStars.push({
        mesh: line,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0
      });
    }
  }

  private spawnShootingStar() {
    const inactive = this.shootingStars.find(s => s.life <= 0);
    if (!inactive) return;

    // Spawn from random edge of view
    const side = Math.random();
    let x: number, y: number, z: number;
    if (side < 0.5) {
      x = (Math.random() - 0.5) * 120;
      y = 40 + Math.random() * 40;
      z = -20 + Math.random() * 40;
    } else {
      x = (Math.random() > 0.5 ? 60 : -60) + (Math.random() - 0.5) * 20;
      y = (Math.random() - 0.5) * 60;
      z = -20 + Math.random() * 40;
    }

    inactive.mesh.position.set(x, y, z);
    inactive.velocity.set(
      (Math.random() - 0.5) * 2,
      -(1 + Math.random() * 2),
      (Math.random() - 0.5)
    );
    inactive.maxLife = 40 + Math.random() * 60;
    inactive.life = inactive.maxLife;
    inactive.mesh.visible = true;
  }

  private updateShootingStars() {
    this.shootingStarTimer++;
    // Spawn roughly every 2-4 seconds (at 60fps)
    if (this.shootingStarTimer > 120 + Math.random() * 120) {
      this.spawnShootingStar();
      this.shootingStarTimer = 0;
    }

    this.shootingStars.forEach(star => {
      if (star.life <= 0) return;
      star.life--;

      const head = star.mesh.position;
      head.add(star.velocity);

      // Update trail line
      const geo = star.mesh.geometry;
      const pos = geo.attributes['position'] as THREE.BufferAttribute;
      const trail = star.velocity.clone().multiplyScalar(-4);
      pos.setXYZ(0, head.x, head.y, head.z);
      pos.setXYZ(1, head.x + trail.x, head.y + trail.y, head.z + trail.z);
      pos.needsUpdate = true;

      // Fade in/out
      const progress = 1 - star.life / star.maxLife;
      const alpha = progress < 0.1 ? progress / 0.1 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
      (star.mesh.material as THREE.LineBasicMaterial).opacity = alpha * 0.8;

      if (star.life <= 0) {
        star.mesh.visible = false;
      }
    });
  }

  private createComet() {
    this.cometGroup = new THREE.Group();

    // Comet nucleus (icy/rocky)
    const nucleusGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const nucleusMat = new THREE.MeshStandardMaterial({
      color: 0xbbccdd, roughness: 0.4, metalness: 0.2,
      emissive: 0x334466, emissiveIntensity: 0.3
    });
    this.cometGroup.add(new THREE.Mesh(nucleusGeo, nucleusMat));

    // Coma (glowing halo)
    const comaMat = new THREE.MeshBasicMaterial({
      color: 0x88bbee, transparent: true, opacity: 0.2,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.cometGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 16), comaMat));

    // Ion tail (blue, straight) using particles
    const ionCount = 200;
    const ionGeo = new THREE.BufferGeometry();
    const ionPos = new Float32Array(ionCount * 3);
    const ionOpacities = new Float32Array(ionCount);
    for (let i = 0; i < ionCount; i++) {
      const t = i / ionCount;
      ionPos[i * 3] = t * 30 + (Math.random() - 0.5) * 0.5;
      ionPos[i * 3 + 1] = (Math.random() - 0.5) * (0.5 + t * 2);
      ionPos[i * 3 + 2] = (Math.random() - 0.5) * (0.5 + t * 2);
      ionOpacities[i] = 1 - t;
    }
    ionGeo.setAttribute('position', new THREE.Float32BufferAttribute(ionPos, 3));
    ionGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(ionOpacities, 1));
    const ionTail = new THREE.Points(ionGeo, new THREE.ShaderMaterial({
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 2.5 * (100.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.5;
          gl_FragColor = vec4(0.4, 0.6, 1.0, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.cometGroup.add(ionTail);

    // Dust tail (yellowish, curved) using particles
    const dustCount = 150;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    const dustAlphas = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      const t = i / dustCount;
      dustPos[i * 3] = t * 20 + (Math.random() - 0.5);
      dustPos[i * 3 + 1] = t * t * 8 + (Math.random() - 0.5) * (1 + t * 3);
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * (0.5 + t * 2);
      dustAlphas[i] = (1 - t) * 0.7;
    }
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(dustAlphas, 1));
    const dustTail = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 2.0 * (100.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.4;
          gl_FragColor = vec4(1.0, 0.9, 0.5, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.cometGroup.add(dustTail);

    // Start comet on an elliptical orbit far out
    this.cometGroup.position.set(80, 30, -100);
    this.scene.add(this.cometGroup);
  }

  private updateComet() {
    // Elliptical orbit in the background
    this.cometAngle += 0.0003;
    const a = 120, b = 60; // semi-major, semi-minor
    this.cometGroup.position.set(
      a * Math.cos(this.cometAngle) + 20,
      b * Math.sin(this.cometAngle) * 0.3 + 15,
      -80 + Math.sin(this.cometAngle) * 30
    );
    // Point tail away from sun (sun at -50, 10, 30)
    const toSun = new THREE.Vector3(-50, 10, 30).sub(this.cometGroup.position).normalize();
    this.cometGroup.lookAt(this.cometGroup.position.clone().sub(toSun));
  }

  private createJupiterAurora() {
    // Jupiter has spectacular aurora at both poles due to its strong magnetic field
    const auroraGeo = new THREE.TorusGeometry(3.5, 0.8, 16, 64);
    const auroraMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vPos;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float wave = sin(vUv.x * 20.0 + uTime * 3.0) * 0.5 + 0.5;
          float shimmer = hash(vUv + uTime * 0.1) * 0.3;
          float pulse = sin(uTime * 2.0 + vUv.x * 10.0) * 0.3 + 0.7;
          float edge = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          float alpha = (wave * 0.5 + shimmer + 0.2) * edge * pulse * 0.25;
          vec3 color = mix(vec3(0.1, 0.8, 0.3), vec3(0.3, 0.4, 1.0), wave);
          color += vec3(0.8, 0.2, 0.5) * shimmer;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });

    // North pole aurora
    this.auroraTop = new THREE.Mesh(auroraGeo, auroraMat);
    this.auroraTop.position.y = 9;
    this.auroraTop.rotation.x = Math.PI / 2;
    this.jupiterGroup.add(this.auroraTop);

    // South pole aurora (clone material for independent time)
    const auroraMatS = auroraMat.clone();
    auroraMatS.uniforms = { uTime: { value: 0 } };
    this.auroraBottom = new THREE.Mesh(auroraGeo.clone(), auroraMatS);
    this.auroraBottom.position.y = -9;
    this.auroraBottom.rotation.x = -Math.PI / 2;
    this.jupiterGroup.add(this.auroraBottom);
  }

  private createOrbitalRings() {
    // Faint dotted orbital path rings for each Galilean moon
    const distances = [14, 18, 24, 32];
    const colors = [0xddaa33, 0xeeeeee, 0xaaaaaa, 0x666666];
    distances.forEach((dist, idx) => {
      const segments = 128;
      const positions = new Float32Array(segments * 3);
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        positions[i * 3] = Math.cos(angle) * dist;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = Math.sin(angle) * dist;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: colors[idx], transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.LineLoop(geo, mat) as unknown as THREE.Line;
      this.jupiterGroup.add(ring);
      this.orbitalRings.push(ring);
    });
  }

  private enhanceGalileanMoons() {
    // Io: volcanic glow (yellowish emissive spots)
    if (this.galileanMoons[0]) {
      const ioMat = this.galileanMoons[0].mesh.material as THREE.MeshStandardMaterial;
      ioMat.emissive = new THREE.Color(0xff6600);
      ioMat.emissiveIntensity = 0.15;

      // Volcanic plume particles around Io
      const plumeGeo = new THREE.BufferGeometry();
      const plumeCount = 30;
      const plumePos = new Float32Array(plumeCount * 3);
      for (let i = 0; i < plumeCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = 0.3 + Math.random() * 0.3;
        plumePos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        plumePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        plumePos[i * 3 + 2] = r * Math.cos(phi);
      }
      plumeGeo.setAttribute('position', new THREE.Float32BufferAttribute(plumePos, 3));
      const plumeMat = new THREE.PointsMaterial({
        color: 0xffaa33, size: 0.06, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.galileanMoons[0].mesh.add(new THREE.Points(plumeGeo, plumeMat));
    }

    // Europa: icy shimmer (bluish-white emissive, slight transparency)
    if (this.galileanMoons[1]) {
      const europaMat = this.galileanMoons[1].mesh.material as THREE.MeshStandardMaterial;
      europaMat.emissive = new THREE.Color(0x4488cc);
      europaMat.emissiveIntensity = 0.08;

      // Ice crack lines (thin line overlay)
      const crackGeo = new THREE.BufferGeometry();
      const crackCount = 20;
      const crackPos = new Float32Array(crackCount * 6); // line segments
      for (let i = 0; i < crackCount; i++) {
        const theta1 = Math.random() * Math.PI * 2;
        const phi1 = Math.random() * Math.PI;
        const r = 0.265;
        crackPos[i * 6] = r * Math.sin(phi1) * Math.cos(theta1);
        crackPos[i * 6 + 1] = r * Math.sin(phi1) * Math.sin(theta1);
        crackPos[i * 6 + 2] = r * Math.cos(phi1);
        const theta2 = theta1 + (Math.random() - 0.5) * 0.5;
        const phi2 = phi1 + (Math.random() - 0.5) * 0.5;
        crackPos[i * 6 + 3] = r * Math.sin(phi2) * Math.cos(theta2);
        crackPos[i * 6 + 4] = r * Math.sin(phi2) * Math.sin(theta2);
        crackPos[i * 6 + 5] = r * Math.cos(phi2);
      }
      crackGeo.setAttribute('position', new THREE.Float32BufferAttribute(crackPos, 3));
      const crackMat = new THREE.LineBasicMaterial({
        color: 0x88ccff, transparent: true, opacity: 0.3
      });
      this.galileanMoons[1].mesh.add(new THREE.LineSegments(crackGeo, crackMat));
    }

    // Ganymede: subtle surface detail (largest moon, slight emissive)
    if (this.galileanMoons[2]) {
      const ganyMat = this.galileanMoons[2].mesh.material as THREE.MeshStandardMaterial;
      ganyMat.emissive = new THREE.Color(0x444444);
      ganyMat.emissiveIntensity = 0.05;
    }

    // Callisto: dark, heavily cratered look (lower roughness for slight sheen)
    if (this.galileanMoons[3]) {
      const callistoMat = this.galileanMoons[3].mesh.material as THREE.MeshStandardMaterial;
      callistoMat.roughness = 0.95;
    }
  }

  private createSun() {
    // The Sun — bright glowing sphere in the direction of sunlight (-50, 10, 30)
    // Real sun: enormous, but at this scale we show it as a bright point with corona
    const sunGeo = new THREE.SphereGeometry(3, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xffffee,
      fog: false
    });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.position.set(-50, 10, 30);

    // Load Sun texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_sun.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        sunMat.map = tex; sunMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Inner corona (bright yellow-white)
    const coronaInnerGeo = new THREE.SphereGeometry(5, 32, 32);
    const coronaInnerMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vec3 viewDir = normalize(-vPos);
          float rim = 1.0 - dot(viewDir, vNormal);
          float corona = pow(rim, 2.0) * 1.5;
          vec3 color = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.6, 0.1), rim);
          gl_FragColor = vec4(color, corona * 0.6);
        }
      `,
      transparent: true, side: THREE.BackSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const coronaInner = new THREE.Mesh(coronaInnerGeo, coronaInnerMat);
    this.sunMesh.add(coronaInner);

    // Outer corona (faint extended halo)
    const coronaOuterGeo = new THREE.SphereGeometry(12, 32, 32);
    const coronaOuterMat = new THREE.MeshBasicMaterial({
      color: 0xffddaa, transparent: true, opacity: 0.06,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.sunMesh.add(new THREE.Mesh(coronaOuterGeo, coronaOuterMat));

    this.scene.add(this.sunMesh);
  }

  private createLightning() {
    // Jupiter has real lightning, discovered by Voyager 1
    // Blue-white flashes on the night side (opposite sun direction)
    // Sun is at (-50, 10, 30) → night side faces roughly (+x, -y, -z)
    for (let i = 0; i < 6; i++) {
      // Random positions on the night-side hemisphere
      const theta = Math.random() * Math.PI * 0.6 + Math.PI * 0.2; // latitude band
      const phi = Math.random() * Math.PI - Math.PI * 0.5; // night-side longitude
      const r = 10.05; // just above Jupiter surface

      const x = r * Math.sin(theta) * Math.cos(phi + Math.PI);
      const y = r * Math.cos(theta);
      const z = r * Math.sin(theta) * Math.sin(phi + Math.PI);

      const flashGeo = new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 8, 8);
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0x8888ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const flash = new THREE.Mesh(flashGeo, flashMat);
      flash.position.set(x, y, z);
      this.jupiterGroup.add(flash);
      this.lightningFlashes.push({
        mesh: flash,
        timer: 0,
        cooldown: 100 + Math.random() * 400 // frames between flashes
      });
    }
  }

  private updateLightning() {
    this.lightningFlashes.forEach(lf => {
      lf.timer++;
      if (lf.timer >= lf.cooldown) {
        // Flash! Quick bright burst then rapid decay
        const mat = lf.mesh.material as THREE.MeshBasicMaterial;
        const flashDuration = 4 + Math.random() * 6;
        const flashAge = lf.timer - lf.cooldown;

        if (flashAge < flashDuration) {
          // Flash on — random flicker pattern like real lightning
          const flicker = Math.random() > 0.3 ? 1 : 0.2;
          mat.opacity = flicker * (1 - flashAge / flashDuration) * 0.8;
        } else {
          mat.opacity = 0;
          lf.timer = 0;
          lf.cooldown = 100 + Math.random() * 400;
          // Reposition for next flash
          const theta = Math.random() * Math.PI * 0.6 + Math.PI * 0.2;
          const phi = Math.random() * Math.PI - Math.PI * 0.5;
          const r = 10.05;
          lf.mesh.position.set(
            r * Math.sin(theta) * Math.cos(phi + Math.PI),
            r * Math.cos(theta),
            r * Math.sin(theta) * Math.sin(phi + Math.PI)
          );
        }
      }
    });
  }

  private createIoPlasmaTorus() {
    // Io's volcanic activity ejects sulfur dioxide which gets ionized by Jupiter's
    // magnetosphere, forming a plasma torus along Io's orbital path
    // Io orbits at distance 14 in our scene
    const torusGeo = new THREE.TorusGeometry(14, 1.2, 24, 96);
    const torusMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vPos;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          // Patchy sulfur-yellow-orange glow
          float noise = hash(vUv * 20.0 + uTime * 0.05);
          float wave = sin(vUv.x * 40.0 + uTime * 2.0) * 0.5 + 0.5;
          float density = (noise * 0.5 + wave * 0.5) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          // Io plasma is characterized by orange/yellow sulfur emission
          vec3 color = mix(vec3(0.8, 0.5, 0.1), vec3(1.0, 0.8, 0.2), wave);
          gl_FragColor = vec4(color, density * 0.07);
        }
      `,
      transparent: true, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.ioPlasmaTorusMesh = new THREE.Mesh(torusGeo, torusMat);
    this.ioPlasmaTorusMesh.rotation.x = Math.PI / 2; // Flat in orbital plane
    this.jupiterGroup.add(this.ioPlasmaTorusMesh);
  }

  private createEuropaPlumes() {
    // Europa's water plumes — geysers of water vapor shooting from the icy surface
    // Discovered by Hubble Space Telescope, up to 200 km high
    // Europa is moon index 1, size 0.26 → plumes extend ~2x moon radius
    const plumeCount = 60;
    const plumeGeo = new THREE.BufferGeometry();
    const plumePos = new Float32Array(plumeCount * 3);
    const plumeSpeeds = new Float32Array(plumeCount);

    for (let i = 0; i < plumeCount; i++) {
      // Cluster around the south pole region (where plumes were observed)
      const spread = 0.15;
      plumePos[i * 3] = (Math.random() - 0.5) * spread;
      plumePos[i * 3 + 1] = -(0.26 + Math.random() * 0.6); // below moon, shooting down
      plumePos[i * 3 + 2] = (Math.random() - 0.5) * spread;
      plumeSpeeds[i] = 0.5 + Math.random() * 1.5;
    }
    plumeGeo.setAttribute('position', new THREE.Float32BufferAttribute(plumePos, 3));
    plumeGeo.setAttribute('speed', new THREE.Float32BufferAttribute(plumeSpeeds, 1));

    this.europaPlume = new THREE.Points(plumeGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float speed;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          float cycle = mod(uTime * speed * 0.5, 2.0);
          vec3 pos = position;
          pos.y -= cycle * 0.3;
          vAlpha = smoothstep(2.0, 0.0, cycle) * 0.6;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = 1.5 * (50.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(0.7, 0.85, 1.0, smoothstep(0.5, 0.0, d) * vAlpha);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));

    // Attached to Europa's mesh (galileanMoons[1])
    if (this.galileanMoons[1]) {
      this.galileanMoons[1].mesh.add(this.europaPlume);
    }
  }

  private updateEuropaPlumes(time: number) {
    if (this.europaPlume) {
      (this.europaPlume.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }
  }

  private createSolarWind() {
    // Solar wind: charged particles streaming from the Sun toward Jupiter
    // Sun at (-50, 10, 30), Jupiter at (12, 0, -15)
    const count = 400;
    const geo = new THREE.BufferGeometry();
    this.solarWindPositions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const sunPos = new THREE.Vector3(-50, 10, 30);
    const jupPos = new THREE.Vector3(12, 0, -15);
    const dir = jupPos.clone().sub(sunPos);

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const spread = 8 + t * 15; // widens as it travels
      this.solarWindPositions[i * 3] = sunPos.x + dir.x * t + (Math.random() - 0.5) * spread;
      this.solarWindPositions[i * 3 + 1] = sunPos.y + dir.y * t + (Math.random() - 0.5) * spread;
      this.solarWindPositions[i * 3 + 2] = sunPos.z + dir.z * t + (Math.random() - 0.5) * spread;
      sizes[i] = 0.3 + Math.random() * 0.5;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.solarWindPositions, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    this.solarWind = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (80.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = 1.0;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * 0.08;
          gl_FragColor = vec4(1.0, 0.95, 0.7, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.scene.add(this.solarWind);
  }

  private updateSolarWind() {
    if (!this.solarWind) return;
    const sunPos = new THREE.Vector3(-50, 10, 30);
    const jupPos = new THREE.Vector3(12, 0, -15);
    const dir = jupPos.clone().sub(sunPos).normalize();
    const speed = 0.3;
    const pos = this.solarWind.geometry.attributes['position'] as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + dir.x * speed;
      let y = pos.getY(i) + dir.y * speed;
      let z = pos.getZ(i) + dir.z * speed;

      // Reset if past Jupiter
      const t = new THREE.Vector3(x, y, z).sub(sunPos).dot(dir) / sunPos.distanceTo(jupPos);
      if (t > 1.2) {
        const spread = 8;
        x = sunPos.x + (Math.random() - 0.5) * spread;
        y = sunPos.y + (Math.random() - 0.5) * spread;
        z = sunPos.z + (Math.random() - 0.5) * spread;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  private createRadiationBelts() {
    // Jupiter's radiation belts are the most intense in the solar system
    // Charged particles trapped by the magnetic field form toroidal belts
    const beltGeo = new THREE.TorusGeometry(16, 5, 32, 96);
    const beltMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vPos;
        varying vec2 vUv;
        void main() {
          vPos = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vPos;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float noise = hash(vUv * 30.0 + uTime * 0.02);
          float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          float swirl = sin(vUv.x * 60.0 + uTime * 1.5 + noise * 5.0) * 0.5 + 0.5;
          float alpha = edge * (noise * 0.3 + swirl * 0.2) * 0.04;
          // Cyan-blue radiation glow
          vec3 color = mix(vec3(0.2, 0.5, 1.0), vec3(0.6, 0.3, 1.0), swirl);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.radiationBelt = new THREE.Mesh(beltGeo, beltMat);
    this.radiationBelt.rotation.x = Math.PI / 2;
    // Slight tilt relative to rotation axis (Jupiter's magnetic axis is tilted ~10°)
    this.radiationBelt.rotation.z = 0.175; // ~10 degrees
    this.jupiterGroup.add(this.radiationBelt);
  }

  private createTrojanAsteroids() {
    // Jupiter's Trojan asteroids orbit the Sun at L4 (60° ahead) and L5 (60° behind)
    // Jupiter is at (12, 0, -15) scene coords, Sun at (-50, 10, 30)
    // We place clusters at ~60° ahead and behind in Jupiter's orbit
    const jupPos = new THREE.Vector3(12, 0, -15);
    const sunPos = new THREE.Vector3(-50, 10, 30);
    const toSun = sunPos.clone().sub(jupPos).normalize();
    const orbitRadius = jupPos.distanceTo(sunPos);

    // L4: 60° ahead in orbit (counterclockwise)
    const angleL4 = Math.atan2(jupPos.z - sunPos.z, jupPos.x - sunPos.x) + Math.PI / 3;
    const l4Center = new THREE.Vector3(
      sunPos.x + orbitRadius * Math.cos(angleL4),
      0,
      sunPos.z + orbitRadius * Math.sin(angleL4)
    );

    // L5: 60° behind
    const angleL5 = Math.atan2(jupPos.z - sunPos.z, jupPos.x - sunPos.x) - Math.PI / 3;
    const l5Center = new THREE.Vector3(
      sunPos.x + orbitRadius * Math.cos(angleL5),
      0,
      sunPos.z + orbitRadius * Math.sin(angleL5)
    );

    const count = 120;
    const rockGeo = new THREE.IcosahedronGeometry(0.15, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777766, roughness: 1, metalness: 0.15 });

    // L4 cluster
    this.trojanL4 = new THREE.InstancedMesh(rockGeo, rockMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        l4Center.x + (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 6,
        l4Center.z + (Math.random() - 0.5) * 20
      );
      const s = 0.3 + Math.random() * 1.2;
      dummy.scale.set(s, s * (0.5 + Math.random()), s);
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      dummy.updateMatrix();
      this.trojanL4.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(this.trojanL4);

    // L5 cluster
    this.trojanL5 = new THREE.InstancedMesh(rockGeo, rockMat, count);
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        l5Center.x + (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 6,
        l5Center.z + (Math.random() - 0.5) * 20
      );
      const s = 0.3 + Math.random() * 1.2;
      dummy.scale.set(s, s * (0.5 + Math.random()), s);
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      dummy.updateMatrix();
      this.trojanL5.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(this.trojanL5);
  }

  private createZodiacalLight() {
    // Zodiacal light: faint glow of sunlight scattered by interplanetary dust
    // along the ecliptic plane. Visible as a triangular glow cone from the sun.
    const zlGeo = new THREE.ConeGeometry(40, 80, 32, 1, true);
    const zlMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          // Fade from bright near sun to invisible at edges
          float falloff = smoothstep(1.0, 0.0, vUv.y); // bright at base (sun end)
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float alpha = falloff * falloff * edge * 0.025;
          vec3 color = vec3(1.0, 0.95, 0.8); // warm sunlit dust
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.zodiacalLight = new THREE.Mesh(zlGeo, zlMat);
    // Emanates from the sun position along the ecliptic
    this.zodiacalLight.position.set(-50, 10, 30);
    // Point toward Jupiter
    this.zodiacalLight.lookAt(12, 0, -15);
    this.zodiacalLight.rotateX(Math.PI / 2);
    this.scene.add(this.zodiacalLight);
  }

  private createDistanceBeam() {
    const group = new THREE.Group();

    // Glowing line
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: 0xffe81f, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending
    })));

    // Particle dots along the beam
    const pCount = 60;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pCount * 3), 3));
    group.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0xffe81f, size: 0.25, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));

    group.visible = false;
    this.scene.add(group);
    this.distanceBeam = group;
  }

  private updateEarthOrbit() {
    // Earth orbital velocity: compressed visualization
    // Real ratio: Earth orbit (1 AU) / Jupiter orbit (5.2 AU) ≈ 1:5.2
    // Scene: Earth orbit r=12, Jupiter-Sun distance ≈ 42 → ratio ~1:3.5 (compressed)
    this.earthOrbitAngle += 0.002;
    const sunX = -25, sunZ = 5;
    const r = 12;
    this.earthMesh.position.set(
      sunX + r * Math.cos(this.earthOrbitAngle),
      1,
      sunZ + r * Math.sin(this.earthOrbitAngle)
    );
  }

  private updateDistanceBeam(time: number) {
    if (!this.distanceBeam || !this.distanceBeamActive || !this.earthMesh?.visible) {
      if (this.distanceBeam) this.distanceBeam.visible = false;
      return;
    }
    this.distanceBeam.visible = true;

    const ep = this.earthMesh.position;
    const jp = this.jupiterGroup.position;

    // Update line endpoints
    const line = this.distanceBeam.children[0] as THREE.Line;
    const lp = line.geometry.attributes['position'] as THREE.BufferAttribute;
    lp.setXYZ(0, ep.x, ep.y, ep.z);
    lp.setXYZ(1, jp.x, jp.y, jp.z);
    lp.needsUpdate = true;

    // Update particle dots along the beam
    const pts = this.distanceBeam.children[1] as THREE.Points;
    const pp = pts.geometry.attributes['position'] as THREE.BufferAttribute;
    const pCount = pp.count;
    for (let i = 0; i < pCount; i++) {
      const t = i / (pCount - 1);
      const wave = Math.sin(t * Math.PI * 6 + time * 4) * 0.2;
      pp.setXYZ(i,
        ep.x + (jp.x - ep.x) * t,
        ep.y + (jp.y - ep.y) * t + wave,
        ep.z + (jp.z - ep.z) * t
      );
    }
    pp.needsUpdate = true;

    // Map 3D distance to real km range (588-968 million km)
    // Min: Earth at opposition (closest to Jupiter) ≈ 3.93 AU = 588M km
    // Max: Earth at conjunction (farthest) ≈ 6.47 AU = 968M km
    const dist3D = ep.distanceTo(jp);
    const minDist3D = 30, maxDist3D = 54;
    const frac = Math.max(0, Math.min(1, (dist3D - minDist3D) / (maxDist3D - minDist3D)));
    const km = Math.round(588 + frac * (968 - 588));
    if (km !== this.lastEmittedKm) {
      this.lastEmittedKm = km;
      this.ngZone.run(() => this.distanceKm.emit(km));
    }
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    const time = (Date.now() - this.startTime) * 0.001;

    // Lerp contextual animation values
    this.currentStarSpeed += (this.targetStarSpeed - this.currentStarSpeed) * 0.02;
    this.currentMoonSpeedMultiplier += (this.targetMoonSpeedMultiplier - this.currentMoonSpeedMultiplier) * 0.02;
    this.currentAtmospherePulse += (this.targetAtmospherePulse - this.currentAtmospherePulse) * 0.05;
    this.currentJupiterSpinSpeed += (this.targetJupiterSpinSpeed - this.currentJupiterSpinSpeed) * 0.02;
    this.currentShipSpeedMultiplier += (this.targetShipSpeedMultiplier - this.currentShipSpeedMultiplier) * 0.02;

    this.updateAtmosphere(time);
    this.updateCamera();
    this.updateJupiterRotation();

    if (this.earthMesh?.visible) {
      this.earthMesh.rotation.y += 0.005;
      if (this.earthOrbitActive) {
        this.updateEarthOrbit();
      }
    }
    this.updateDistanceBeam(time);

    this.updateMoons();
    this.updateSpaceships(time);
    this.updateStarsAndDust(time);

    // New immersive effects
    this.updateShootingStars();
    this.updateComet();

    // Rotate Saturn slowly
    if (this.saturnGroup) {
      this.saturnGroup.rotation.y += 0.0002;
    }
    // Rotate Mars
    if (this.marsMesh) {
      this.marsMesh.rotation.y += 0.003;
    }

    // Update aurora shaders
    if (this.auroraTop) {
      (this.auroraTop.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }
    if (this.auroraBottom) {
      (this.auroraBottom.material as THREE.ShaderMaterial).uniforms['uTime'].value = time + 5;
    }

    // Lightning flashes on Jupiter's night side
    this.updateLightning();

    // Io plasma torus animation
    if (this.ioPlasmaTorusMesh) {
      (this.ioPlasmaTorusMesh.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }

    // Europa plume animation
    this.updateEuropaPlumes(time);

    // Solar wind streaming
    this.updateSolarWind();

    // Radiation belt animation
    if (this.radiationBelt) {
      (this.radiationBelt.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }

    // Sun corona pulse
    if (this.sunMesh) {
      const coronaScale = 1 + Math.sin(time * 0.5) * 0.02;
      this.sunMesh.children[0]?.scale.set(coronaScale, coronaScale, coronaScale);
    }

    this.renderer.autoClear = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.render(this.postScene, this.postCamera);
  }

  private onWindowResize() {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }
}
