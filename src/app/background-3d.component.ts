import { Component, ElementRef, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy, NgZone, PLATFORM_ID, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';

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

  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  
  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.isBrowser && (changes['slideIndex'] || changes['slideId'])) {
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
    if (this.earthMesh) this.earthMesh.visible = false; // Hide earth by default

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
        // Distance - Warp speed effect
        this.baseCameraX = 30; this.baseCameraY = 15; this.baseCameraZ = 5;
        this.targetLookAt.set(0, 0, 0);
        this.targetStarSpeed = 0.25; // Much faster stars for warp speed
        this.targetShipSpeedMultiplier = 5;
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
        if (this.earthMesh) this.earthMesh.visible = true;
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

  /** Generates a simple procedural Earth texture */
  private generateEarthTexture(): THREE.CanvasTexture {
    const W = 512, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(W, H);
    const data = imageData.data;

    // Simple Perlin-like noise for continent shapes
    const perm = new Uint8Array(512);
    const p0 = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p0[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p0[i], p0[j]] = [p0[j], p0[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p0[i & 255];

    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a: number, b: number, t: number) => a + t * (b - a);
    const grad = (hash: number, x: number, y: number) => {
      switch (hash & 3) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y; }
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
    const fbm = (x: number, y: number, oct: number) => {
      let val = 0, amp = 1, freq = 1, max = 0;
      for (let i = 0; i < oct; i++) { val += perlin2d(x * freq, y * freq) * amp; max += amp; amp *= 0.5; freq *= 2; }
      return val / max;
    };

    for (let py = 0; py < H; py++) {
      const v = py / H;
      const lat = (v - 0.5) * Math.PI;
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const idx = (py * W + px) * 4;

        const nx = u * 6, ny = v * 6;
        const n = fbm(nx, ny, 6);

        // Polar ice caps
        const polarFade = Math.abs(lat) / (Math.PI / 2);
        const ice = polarFade > 0.75 ? (polarFade - 0.75) * 4 : 0;

        let r: number, g: number, b: number;
        if (ice > 0.5) {
          r = 230 + Math.random() * 20; g = 235 + Math.random() * 15; b = 240;
        } else if (n > 0.05) {
          // Land
          const height = (n - 0.05) * 4;
          r = 40 + height * 50; g = 90 + height * 40 - Math.abs(lat) * 20; b = 30 + height * 15;
          // Desert near equator
          if (Math.abs(lat) < 0.35 && n > 0.2) { r += 40; g += 10; b -= 10; }
        } else {
          // Ocean
          const depth = (0.05 - n) * 10;
          r = 15 + depth * 5; g = 40 + depth * 15; b = 130 + depth * 30 + n * 40;
        }

        data[idx] = Math.max(0, Math.min(255, r));
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
    texture.generateMipmaps = true;
    return texture;
  }

  private initThreeJs() {
    const container = this.canvasContainer.nativeElement;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0015);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = this.targetCameraZ;
    this.camera.position.x = this.targetCameraX;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

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
    this.jupiterGroup.rotation.z = 0.05; // Slight tilt
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
    const textureLoader = new THREE.TextureLoader();
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
      },
      undefined,
      (err) => console.warn('Could not load high-res Jupiter texture, using procedural fallback.', err)
    );

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

    // Procedural Earth Texture (no external URL needed)
    earthMaterial.map = this.generateEarthTexture();
    earthMaterial.color.setHex(0xffffff);
    earthMaterial.needsUpdate = true;

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

    // The 4 Galilean Moons
    const galileanConfigs = [
      { name: 'Io', color: 0xddaa33, size: 0.3, distance: 14, speed: 0.008 },
      { name: 'Europa', color: 0xeeeeee, size: 0.25, distance: 18, speed: 0.006 },
      { name: 'Ganymede', color: 0xaaaaaa, size: 0.4, distance: 24, speed: 0.004 },
      { name: 'Callisto', color: 0x666666, size: 0.35, distance: 32, speed: 0.002 }
    ];

    galileanConfigs.forEach(config => {
      const geo = new THREE.SphereGeometry(config.size, 32, 32);
      const mat = new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.8, bumpScale: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      this.jupiterGroup.add(mesh);
      this.galileanMoons.push({ mesh, distance: config.distance, speed: config.speed, angle: Math.random() * Math.PI * 2 });
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
      this.targetCameraX = this.baseCameraX + this.mouseX * 4;
      this.targetCameraY = this.baseCameraY + this.mouseY * 4;
      this.targetCameraZ = this.baseCameraZ;

      this.camera.position.x += (this.targetCameraX - this.camera.position.x) * 0.035;
      this.camera.position.y += (this.targetCameraY - this.camera.position.y) * 0.035;
      this.camera.position.z += (this.targetCameraZ - this.camera.position.z) * 0.035;

      this.currentLookAt.lerp(this.targetLookAt, 0.035);
      this.camera.lookAt(this.currentLookAt);
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

    if (this.postMaterial) {
      this.postMaterial.uniforms['uTime'].value = time;
    }
  }

  private createSpaceships() {
    const jupiterPos = this.jupiterGroup.position;
    const configs = [
      { type: 'fighter', radius: 14, speed: 0.006, y: 2, incl: 0.15, scale: 3 },
      { type: 'fighter', radius: 18, speed: -0.004, y: -1, incl: -0.2, scale: 2.5 },
      { type: 'fighter', radius: 16, speed: 0.005, y: 3.5, incl: 0.3, scale: 2.8 },
      { type: 'tie', radius: 20, speed: -0.005, y: -2, incl: 0.25, scale: 3 },
      { type: 'tie', radius: 23, speed: 0.003, y: 1.5, incl: -0.15, scale: 2.5 },
      { type: 'shuttle', radius: 28, speed: 0.002, y: 4, incl: 0.1, scale: 3.5 },
      { type: 'shuttle', radius: 33, speed: -0.0015, y: -3, incl: -0.18, scale: 3 },
      { type: 'fighter', radius: 40, speed: 0.003, y: 7, incl: 0.4, scale: 2 },
      { type: 'tie', radius: 45, speed: -0.002, y: -5, incl: -0.35, scale: 2 },
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
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xaabbcc, metalness: 0.8, roughness: 0.2, emissive: 0x112233, emissiveIntensity: 0.15 });

    // Fuselage
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.4, 8), bodyMat);
    body.rotation.x = -Math.PI / 2;
    group.add(body);

    // Wings
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.6, roughness: 0.3, emissive: 0x111122, emissiveIntensity: 0.1 });
    const wingGeo = new THREE.BoxGeometry(1.6, 0.03, 0.5);
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.z = 0.1;
    group.add(wings);

    // Cockpit canopy
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x224466, metalness: 0.9, roughness: 0.1, emissive: 0x113355, emissiveIntensity: 0.3 });
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), canopyMat);
    canopy.position.set(0, 0.12, -0.2);
    canopy.scale.set(1, 0.7, 1.3);
    group.add(canopy);

    // Engine glow
    const engineMat = new THREE.MeshBasicMaterial({ color: 0x66ccff });
    const engine = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), engineMat);
    engine.position.z = 0.7;
    group.add(engine);

    // Engine trail
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const trailGeo = new THREE.CylinderGeometry(0.005, 0.08, 1.6, 6);
    trailGeo.rotateX(Math.PI / 2);
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.z = 1.5;
    group.add(trail);

    // Wing-tip lights
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    const tipL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), tipMat);
    tipL.position.set(-0.8, 0, 0.1);
    group.add(tipL);
    const tipR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: 0x00ff44 }));
    tipR.position.set(0.8, 0, 0.1);
    group.add(tipR);

    return group;
  }

  private buildTieShip(): THREE.Group {
    const group = new THREE.Group();

    // Central cockpit sphere
    const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x556677, metalness: 0.9, roughness: 0.15, emissive: 0x112233, emissiveIntensity: 0.2 });
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), cockpitMat);
    group.add(cockpit);

    // Cockpit viewport
    const viewportMat = new THREE.MeshBasicMaterial({ color: 0x88ccff });
    const viewport = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), viewportMat);
    viewport.position.z = -0.29;
    group.add(viewport);

    // Hexagonal side panels
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.7, roughness: 0.25, emissive: 0x111122, emissiveIntensity: 0.1 });
    const panelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.04, 6);
    panelGeo.rotateZ(Math.PI / 2);
    const leftPanel = new THREE.Mesh(panelGeo, panelMat);
    leftPanel.position.x = -0.55;
    group.add(leftPanel);
    const rightPanel = new THREE.Mesh(panelGeo, panelMat);
    rightPanel.position.x = 0.55;
    group.add(rightPanel);

    // Struts connecting cockpit to panels
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.8, roughness: 0.2 });
    const strutGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
    strutGeo.rotateZ(Math.PI / 2);
    const leftStrut = new THREE.Mesh(strutGeo, strutMat);
    leftStrut.position.x = -0.3;
    group.add(leftStrut);
    const rightStrut = new THREE.Mesh(strutGeo, strutMat);
    rightStrut.position.x = 0.3;
    group.add(rightStrut);

    // Rear engine glow
    const engineMat = new THREE.MeshBasicMaterial({ color: 0xff4422 });
    const engine = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), engineMat);
    engine.position.z = 0.3;
    group.add(engine);

    // Engine trail
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff3311, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const trailGeo = new THREE.CylinderGeometry(0.005, 0.07, 1.2, 6);
    trailGeo.rotateX(Math.PI / 2);
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.z = 0.9;
    group.add(trail);

    return group;
  }

  private buildShuttleShip(): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xbbccdd, metalness: 0.7, roughness: 0.25, emissive: 0x112233, emissiveIntensity: 0.15 });

    // Main hull — elongated wedge
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 4), bodyMat);
    body.rotation.x = -Math.PI / 2;
    body.rotation.y = Math.PI / 4;
    group.add(body);

    // Cargo section
    const cargoMat = new THREE.MeshStandardMaterial({ color: 0x99aabb, metalness: 0.6, roughness: 0.3 });
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.6), cargoMat);
    cargo.position.set(0, 0, 0.3);
    group.add(cargo);

    // Dorsal fin
    const finMat = new THREE.MeshStandardMaterial({ color: 0x889aab, metalness: 0.5, roughness: 0.3 });
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 0.5), finMat);
    fin.position.set(0, 0.35, 0.15);
    group.add(fin);

    // Lower fins
    const lowerFin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), finMat);
    lowerFin.position.set(0, -0.15, 0.3);
    group.add(lowerFin);

    // Twin engines
    const engineMat = new THREE.MeshBasicMaterial({ color: 0xffbb44 });
    const engineL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), engineMat);
    engineL.position.set(-0.15, 0, 0.9);
    group.add(engineL);
    const engineR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), engineMat);
    engineR.position.set(0.15, 0, 0.9);
    group.add(engineR);

    // Twin engine trails
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff8833, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const trailGeoL = new THREE.CylinderGeometry(0.005, 0.06, 1.4, 6);
    trailGeoL.rotateX(Math.PI / 2);
    const trailL = new THREE.Mesh(trailGeoL, trailMat);
    trailL.position.set(-0.15, 0, 1.6);
    group.add(trailL);
    const trailGeoR = new THREE.CylinderGeometry(0.005, 0.06, 1.4, 6);
    trailGeoR.rotateX(Math.PI / 2);
    const trailR = new THREE.Mesh(trailGeoR, trailMat);
    trailR.position.set(0.15, 0, 1.6);
    group.add(trailR);

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
    }

    this.updateMoons();
    this.updateSpaceships(time);
    this.updateStarsAndDust(time);

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
