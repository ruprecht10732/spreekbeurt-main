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
  @Input() tourMode = false;
  @Output() loaded = new EventEmitter<void>();
  @Output() tourPlanet = new EventEmitter<string>();
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

  // Cinematic camera drift — slow creeping motion within each slide
  private cameraDriftX = 0;
  private cameraDriftY = 0;
  private cameraDriftZ = 0;
  private cameraDriftSpeedX = 0;
  private cameraDriftSpeedY = 0;
  private cameraDriftSpeedZ = 0;
  private cameraLerpSpeed = 0.035;
  private slideStartTime = 0;

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

    // Earth's Moon (Luna) orbiting Earth
    private moonMesh!: THREE.Mesh;
    private moonOrbitAngle = 0;

    // Titan — Saturn's largest moon
    private titanMesh!: THREE.Mesh;
    private titanOrbitAngle = 0;

    // Pluto — dwarf planet beyond Neptune
    private plutoMesh!: THREE.Mesh;

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
  private venusMesh!: THREE.Mesh;
  private mercuryMesh!: THREE.Mesh;
  private uranusMesh!: THREE.Mesh;
  private uranusGroup!: THREE.Group;
  private neptuneMesh!: THREE.Mesh;
  private neptuneGroup!: THREE.Group;
  private earthCloudsMesh!: THREE.Mesh;

  // Planet/moon labels (sprites)
  private readonly labelSprites: THREE.Sprite[] = [];

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

  // SpaceX Falcon 9 rocket launch
  private falconGroup!: THREE.Group;
  private falconExhaust!: THREE.Mesh;
  private falconLaunched = false;
  private falconLaunchTime = 0;
  private falconStartPos = new THREE.Vector3();
  private falconTargetPos = new THREE.Vector3();

  // Planet tour state
  private tourActive = false;
  private tourStopIndex = 0;
  private tourStopTime = 0;
  private tourTransitionProgress = 0;
  private readonly TOUR_STOP_DURATION = 8; // seconds at each planet
  private readonly TOUR_TRANSITION_DURATION = 3; // seconds flying between planets
  private tourStops: { name: string; camX: number; camY: number; camZ: number; lookX: number; lookY: number; lookZ: number }[] = [];

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
    if (this.isBrowser && changes['tourMode']) {
      if (this.tourMode && !this.tourActive) {
        this.startPlanetTour();
      } else if (!this.tourMode && this.tourActive) {
        this.tourActive = false;
      }
    }
  }

  private startPlanetTour() {
    // Build tour stops from actual planet positions
    this.tourStops = [];
    const jPos = this.jupiterGroup?.position || new THREE.Vector3(12, 0, -15);
    // Jupiter close-up first
    this.tourStops.push({ name: 'jupiter', camX: jPos.x - 20, camY: jPos.y + 5, camZ: jPos.z + 18, lookX: jPos.x, lookY: jPos.y, lookZ: jPos.z });
    // Sun
    if (this.sunMesh) {
      const p = this.sunMesh.position;
      this.tourStops.push({ name: 'zon', camX: p.x + 18, camY: p.y + 6, camZ: p.z + 14, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
    // Mercury
    if (this.mercuryMesh) {
      const p = this.mercuryMesh.position;
      this.tourStops.push({ name: 'mercurius', camX: p.x + 3, camY: p.y + 1, camZ: p.z + 3, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
    // Venus
    if (this.venusMesh) {
      const p = this.venusMesh.position;
      this.tourStops.push({ name: 'venus', camX: p.x + 4, camY: p.y + 1.5, camZ: p.z + 4, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
    // Earth
    if (this.earthMesh) {
      this.earthMesh.visible = true;
      this.earthMesh.position.set(-8, 2, -5);
      const p = this.earthMesh.position;
      this.tourStops.push({ name: 'aarde', camX: p.x + 4, camY: p.y + 1.5, camZ: p.z + 4, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
    // Mars
    if (this.marsMesh) {
      const p = this.marsMesh.position;
      this.tourStops.push({ name: 'mars', camX: p.x + 3, camY: p.y + 1, camZ: p.z + 3, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
    // Saturn
    if (this.saturnGroup) {
      const p = this.saturnGroup.position;
      this.tourStops.push({ name: 'saturnus', camX: p.x - 25, camY: p.y + 12, camZ: p.z + 20, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
    // Uranus
    if (this.uranusGroup) {
      const p = this.uranusGroup.position;
      this.tourStops.push({ name: 'uranus', camX: p.x - 10, camY: p.y + 4, camZ: p.z + 10, lookX: p.x, lookY: p.y, lookZ: p.z });
    }
      // Neptune — gas giant
      if (this.neptuneGroup) {
        const p = this.neptuneGroup.position;
        this.tourStops.push({ name: 'neptunus', camX: p.x + 10, camY: p.y + 4, camZ: p.z + 10, lookX: p.x, lookY: p.y, lookZ: p.z });
      }
      // Pluto — dwarf planet beyond Neptune
      if (this.plutoMesh) {
        const p = this.plutoMesh.position;
        this.tourStops.push({ name: 'pluto', camX: p.x + 6, camY: p.y + 3, camZ: p.z + 6, lookX: p.x, lookY: p.y, lookZ: p.z });
      }
    // Back to Jupiter — full circle
    this.tourStops.push({ name: 'jupiter-einde', camX: jPos.x + 5, camY: jPos.y + 8, camZ: jPos.z + 50, lookX: jPos.x, lookY: jPos.y, lookZ: jPos.z });

    this.tourActive = true;
    this.tourStopIndex = 0;
    this.tourStopTime = (Date.now() - this.startTime) * 0.001;
    this.tourTransitionProgress = 0;
    this.userInteracting = false;
    this.tourPlanet.emit(this.tourStops[0].name);
  }

  private updatePlanetTour(time: number) {
    if (!this.tourActive || this.tourStops.length === 0) return;

    const elapsed = time - this.tourStopTime;
    const stop = this.tourStops[this.tourStopIndex];
    const totalStopTime = this.TOUR_STOP_DURATION + this.TOUR_TRANSITION_DURATION;

    if (elapsed < this.TOUR_TRANSITION_DURATION) {
      // Flying to this stop — smooth ease-in-out
      const t = elapsed / this.TOUR_TRANSITION_DURATION;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad

      this.baseCameraX += (stop.camX - this.baseCameraX) * (ease * 0.05 + 0.01);
      this.baseCameraY += (stop.camY - this.baseCameraY) * (ease * 0.05 + 0.01);
      this.baseCameraZ += (stop.camZ - this.baseCameraZ) * (ease * 0.05 + 0.01);
      this.targetLookAt.set(
        this.targetLookAt.x + (stop.lookX - this.targetLookAt.x) * (ease * 0.05 + 0.01),
        this.targetLookAt.y + (stop.lookY - this.targetLookAt.y) * (ease * 0.05 + 0.01),
        this.targetLookAt.z + (stop.lookZ - this.targetLookAt.z) * (ease * 0.05 + 0.01)
      );
      this.cameraLerpSpeed = 0.04;
    } else if (elapsed < totalStopTime) {
      // At this stop — gentle orbit drift
      this.baseCameraX = stop.camX;
      this.baseCameraY = stop.camY;
      this.baseCameraZ = stop.camZ;
      this.targetLookAt.set(stop.lookX, stop.lookY, stop.lookZ);
      this.cameraLerpSpeed = 0.025;
      // Gentle circular drift around the planet
      const driftTime = elapsed - this.TOUR_TRANSITION_DURATION;
      this.cameraDriftX = Math.sin(driftTime * 0.3) * 2;
      this.cameraDriftY = Math.sin(driftTime * 0.2) * 0.5;
      this.cameraDriftZ = Math.cos(driftTime * 0.3) * 2;
    } else {
      // Move to next stop
      this.tourStopIndex++;
      this.cameraDriftX = 0;
      this.cameraDriftY = 0;
      this.cameraDriftZ = 0;
      if (this.tourStopIndex >= this.tourStops.length) {
        // Tour finished — loop back
        this.tourStopIndex = 0;
        this.tourStopTime = time;
      } else {
        this.tourStopTime = time;
      }
      this.tourPlanet.emit(this.tourStops[this.tourStopIndex].name);
      // Launch Falcon 9 when arriving at Earth
      if (this.tourStops[this.tourStopIndex].name === 'aarde' && !this.falconLaunched) {
        setTimeout(() => this.launchFalcon9(), 2000); // 2s after arriving
      }
    }
  }

  private updateCameraForSlide(id: string) {
    this.targetJupiterRotationY = null;
    this.targetStarSpeed = 0.0001;
    this.targetMoonSpeedMultiplier = 1;
    this.targetAtmospherePulse = 0;
    this.targetJupiterSpinSpeed = 0.0005;
    this.targetShipSpeedMultiplier = 1;
    this.earthOrbitActive = false;
    this.distanceBeamActive = false;
    this.cameraLerpSpeed = 0.035;
    this.cameraDriftSpeedX = 0;
    this.cameraDriftSpeedY = 0;
    this.cameraDriftSpeedZ = 0;
    this.cameraDriftX = 0;
    this.cameraDriftY = 0;
    this.cameraDriftZ = 0;
    this.slideStartTime = (Date.now() - this.startTime) * 0.001;
    if (this.earthMesh) this.earthMesh.visible = false;
    if (this.distanceBeam) this.distanceBeam.visible = false;

    switch(id) {
      case 'title':
        // ACT 1: Approach from deep space — camera far away, slowly drifting in
        this.baseCameraX = 5; this.baseCameraY = 8; this.baseCameraZ = 70;
        this.targetLookAt.set(0, 0, 0);
        this.targetShipSpeedMultiplier = 0.3;
        this.targetJupiterSpinSpeed = 0.0003;
        this.cameraLerpSpeed = 0.015; // Very slow, contemplative
        // Slow drift inward — approaching Jupiter
        this.cameraDriftSpeedZ = -0.008;
        this.cameraDriftSpeedY = -0.002;
        break;

      case 'inhoud':
        // ACT 1: Arrived — sweeping orbit reveals the solar system context
        this.baseCameraX = 30; this.baseCameraY = 12; this.baseCameraZ = 30;
        this.targetLookAt.set(0, 2, 0);
        this.targetShipSpeedMultiplier = 1;
        this.cameraLerpSpeed = 0.025;
        // Slow orbit drift — camera glides around Jupiter
        this.cameraDriftSpeedX = -0.012;
        this.cameraDriftSpeedZ = -0.006;
        break;

      case 'h1':
        // ACT 2: Dive into the atmosphere — close-up on Jupiter's bands
        this.baseCameraX = -14; this.baseCameraY = 2; this.baseCameraZ = 15;
        this.targetLookAt.set(-3, 0, 0);
        this.targetAtmospherePulse = 1;
        this.targetJupiterSpinSpeed = 0.001; // Slightly faster — showing the gas swirling
        this.cameraLerpSpeed = 0.03;
        // Slow creep closer into the clouds
        this.cameraDriftSpeedZ = -0.004;
        this.cameraDriftSpeedX = 0.003;
        break;

      case 'h2':
        // ACT 2: Dramatic swoop to the Great Red Spot
        this.baseCameraX = 8; this.baseCameraY = -4; this.baseCameraZ = 6;
        this.targetLookAt.set(10, -3, -10);
        this.targetJupiterRotationY = 4.7;
        this.cameraLerpSpeed = 0.02; // Slow dramatic reveal
        // Tiny drift — hovering over the storm
        this.cameraDriftSpeedY = 0.002;
        this.cameraDriftSpeedX = -0.001;
        break;

      case 'h3':
        // ACT 3: Pull way back — reveal the vast distance to Earth
        this.baseCameraX = -8; this.baseCameraY = 20; this.baseCameraZ = 55;
        this.targetLookAt.set(0, 0, -8);
        this.targetStarSpeed = 0.002;
        this.targetShipSpeedMultiplier = 2.5;
        this.cameraLerpSpeed = 0.02; // Slow pullback for dramatic scale
        if (this.earthMesh) this.earthMesh.visible = true;
        this.earthOrbitActive = true;
        this.distanceBeamActive = true;
        // Slow pan across the gap
        this.cameraDriftSpeedX = 0.005;
        this.cameraDriftSpeedY = -0.002;
        break;

      case 'h4':
        // ACT 3: Ancient flyby — majestic side pass like a spacecraft
        this.baseCameraX = -22; this.baseCameraY = -8; this.baseCameraZ = 22;
        this.targetLookAt.set(2, 0, 0);
        this.targetJupiterSpinSpeed = 0.0003; // Slow, ancient, timeless
        this.targetStarSpeed = 0.00005; // Stars barely move — frozen in time
        this.targetShipSpeedMultiplier = 0.3;
        this.cameraLerpSpeed = 0.018; // Very slow, contemplative
        // Long slow flyby drift
        this.cameraDriftSpeedX = 0.015;
        this.cameraDriftSpeedY = 0.004;
        this.cameraDriftSpeedZ = -0.003;
        break;

      case 'h5':
        // ACT 4: Power — look UP at Jupiter's massive underside
        this.baseCameraX = 3; this.baseCameraY = -20; this.baseCameraZ = 20;
        this.targetLookAt.set(0, 8, 0);
        this.targetMoonSpeedMultiplier = 30;
        this.targetJupiterSpinSpeed = 0.003; // Faster spin — showing rapid rotation
        this.cameraLerpSpeed = 0.025;
        if (this.earthMesh) {
          this.earthMesh.visible = true;
          this.earthMesh.position.set(-8, 2, -5);
        }
        // Slow rise upward — feeling the gravity
        this.cameraDriftSpeedY = 0.006;
        this.cameraDriftSpeedX = -0.002;
        break;

      case 'extra':
        // ACT 4: Rise above — reveal the magnificent moon system
        this.baseCameraX = 5; this.baseCameraY = 38; this.baseCameraZ = 22;
        this.targetLookAt.set(0, 0, -2);
        this.targetMoonSpeedMultiplier = 3; // Visible but graceful orbital motion
        this.targetJupiterSpinSpeed = 0.001;
        this.cameraLerpSpeed = 0.02;
        // Slow orbit above the moon plane
        this.cameraDriftSpeedX = -0.008;
        this.cameraDriftSpeedZ = 0.005;
        break;

      case 'quiz':
        // FINALE: Dynamic energy — Jupiter front and center, spinning with power
        this.baseCameraX = 0; this.baseCameraY = 2; this.baseCameraZ = 20;
        this.targetLookAt.set(0, 0, 0);
        this.targetJupiterSpinSpeed = 0.012;
        this.targetStarSpeed = 0.004;
        this.targetShipSpeedMultiplier = 3;
        this.targetMoonSpeedMultiplier = 4;
        this.cameraLerpSpeed = 0.04; // Snappy, energetic
        // Slow orbit — camera circles during quiz
        this.cameraDriftSpeedX = -0.01;
        this.cameraDriftSpeedZ = -0.008;
        break;

      case 'afsluiting':
        // EPILOGUE: Pull back to the wide shot we started from — full circle
        this.baseCameraX = 0; this.baseCameraY = 5; this.baseCameraZ = 50;
        this.targetLookAt.set(0, 0, 0);
        this.targetShipSpeedMultiplier = 0.5;
        this.targetJupiterSpinSpeed = 0.0003;
        this.targetStarSpeed = 0.00005;
        this.cameraLerpSpeed = 0.015; // Slow, peaceful departure
        // Gentle drift away — leaving Jupiter behind
        this.cameraDriftSpeedZ = 0.005;
        this.cameraDriftSpeedY = 0.002;
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
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0005);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = this.targetCameraZ;
    this.camera.position.x = this.targetCameraX;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
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
        skyMat.color.setHex(0x222233); // muted blue-grey — natural deep-space tint
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
      color: 0x6688cc, transparent: true, opacity: 0.08,
      size: 0.12, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.scene.add(fgDust);

    // Stars - Multi-colored with size variation and twinkle
    const starsGeometry = new THREE.BufferGeometry();
    const starsVertices = [];
    const starsColors = [];
    const starsSizes = [];
    // Spectral-class star colors (Hertzsprung-Russell diagram)
    // O/B type: blue-white, A type: white, F type: yellow-white,
    // G type: yellow (Sun), K type: orange, M type: red-orange
    const starColorPalette = [
      [0.65, 0.75, 1.0],   // O/B — hot blue-white (rare, bright)
      [0.82, 0.87, 1.0],   // A — white-blue (Sirius, Vega)
      [1.0, 0.98, 0.95],   // F — warm white
      [1.0, 0.94, 0.8],    // G — yellow-white (Sun-like)
      [1.0, 0.82, 0.62],   // K — orange (most common visible)
      [1.0, 0.7, 0.5],     // M — red-orange (faint)
    ];
    // Weighted distribution: M>K>G>F>A>O (realistic stellar population)
    const starWeights = [0.03, 0.08, 0.15, 0.22, 0.30, 0.22];
    const pickStarColor = () => {
      let r = Math.random();
      for (let i = 0; i < starWeights.length; i++) {
        r -= starWeights[i];
        if (r <= 0) return starColorPalette[i];
      }
      return starColorPalette[4]; // fallback K-type
    };

    for (let i = 0; i < 20000; i++) {
      starsVertices.push(
        THREE.MathUtils.randFloatSpread(2000),
        THREE.MathUtils.randFloatSpread(2000),
        THREE.MathUtils.randFloatSpread(2000)
      );
      const color = pickStarColor();
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
        varying float vSize;
        uniform float uTime;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Subtle atmospheric scintillation (twinkling)
          float twinkle = sin(uTime * 1.8 + position.x * 0.12 + position.y * 0.17) * 0.25 + 0.75;
          float sz = aSize * twinkle * (300.0 / -mvPosition.z);
          vSize = sz;
          gl_PointSize = sz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vSize;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          if (dist > 0.5) discard;
          
          // Soft Airy-disk-like falloff (realistic point-spread function)
          float alpha = smoothstep(0.5, 0.0, dist);
          float core = smoothstep(0.15, 0.0, dist);
          
          // Diffraction spikes for brighter stars (cross pattern)
          float spike = 0.0;
          if (vSize > 3.0) {
            float sx = smoothstep(0.08, 0.0, abs(uv.y)) * smoothstep(0.5, 0.1, abs(uv.x));
            float sy = smoothstep(0.08, 0.0, abs(uv.x)) * smoothstep(0.5, 0.1, abs(uv.y));
            spike = (sx + sy) * 0.4 * smoothstep(3.0, 6.0, vSize);
          }
          
          vec3 finalColor = vColor + core * 0.6;
          gl_FragColor = vec4(finalColor, clamp(alpha * 0.9 + spike, 0.0, 1.0));
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
      size: 0.12, 
      transparent: true, 
      opacity: 0.25 
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
    // Earth normal map for surface relief
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load('2k_earth_normal_map.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        earthMaterial.normalMap = tex;
        earthMaterial.normalScale = new THREE.Vector2(0.8, 0.8);
        earthMaterial.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
    // Earth specular map (oceans are shiny, land is rough)
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load('2k_earth_specular_map.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        earthMaterial.metalnessMap = tex;
        earthMaterial.roughness = 0.65;
        earthMaterial.metalness = 0.15;
        earthMaterial.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
    // Earth cloud layer — semi-transparent rotating sphere
    const earthCloudGeo = new THREE.SphereGeometry(0.905, 48, 48);
    const earthCloudMat = new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0.45, depthWrite: false,
      color: 0xffffff, roughness: 1.0, metalness: 0.0
    });
    this.earthCloudsMesh = new THREE.Mesh(earthCloudGeo, earthCloudMat);
    this.earthMesh.add(this.earthCloudsMesh);
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load('2k_earth_clouds.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        earthCloudMat.alphaMap = tex;
        earthCloudMat.map = tex;
        earthCloudMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
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

      // ─── Earth's Moon (Luna) ─────────────────────────────────────────────
      // Real radius: 1737 km. We scale to 0.28 scene units for visibility.
      // Orbit radius compressed to ~2.8 scene units from Earth.
      const moonGeo = new THREE.SphereGeometry(0.28, 32, 32);
      const moonMat = new THREE.MeshStandardMaterial({
        color: 0xbbbbaa, roughness: 0.92, metalness: 0.0
      });
      this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
      this.moonMesh.visible = false;
      this.scene.add(this.moonMesh);
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load('2k_moon.jpg', (tex) => {
          tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
          moonMat.map = tex; moonMat.color.setHex(0xffffff); moonMat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));

    // Jupiter's Faint Ring System — discovered by Voyager 1 (1979)
    // Halo ring: 1.29-1.71 Rj, Main ring: 1.71-1.81 Rj, Gossamer rings: to 3.16 Rj
    // In scene units (Rj=10): halo 12.9-17.1, main 17.1-18.1, gossamer to 31.6
    // Jupiter's rings are extremely faint — barely visible even to spacecraft
    const ringGeometry = new THREE.RingGeometry(12.9, 18.1, 128);
    const pos = ringGeometry.attributes['position'];
    const v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++){
        v3.fromBufferAttribute(pos as THREE.BufferAttribute, i);
        const t = (v3.length() - 12.9) / (18.1 - 12.9);
        (ringGeometry.attributes['uv'] as THREE.BufferAttribute).setXY(i, t, 0.5);
    }
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x887766,
      transparent: true,
      opacity: 0.06, // Very faint — Jupiter's rings are nearly invisible
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2 + 0.054; // Align with equator (3.13° tilt)
    this.jupiterGroup.add(ring);

    // Gossamer rings (extremely faint, extends to 3.16 Rj)
    const gossamerGeo = new THREE.RingGeometry(18.1, 31.6, 64);
    const gossamerMat = new THREE.MeshBasicMaterial({
      color: 0x887766, transparent: true, opacity: 0.015,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const gossamerRing = new THREE.Mesh(gossamerGeo, gossamerMat);
    gossamerRing.rotation.x = Math.PI / 2 + 0.054;
    this.jupiterGroup.add(gossamerRing);

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
    // Real radii: Io=1822km, Europa=1561km, Ganymede=2634km, Callisto=2410km
    // Scene radii: radius_km / Jupiter_radius_km(71492) × 10
    // Orbital distances use power-law compression (d^0.6) of real Rj values
    // to keep scene manageable while preserving relative ordering
    // Real Rj from center: Io=5.90, Europa=9.38, Ganymede=14.97, Callisto=26.33
    const galileanConfigs = [
      { name: 'Io', color: 0xddaa33, size: 0.255, distance: 14, speed: 0.008, texture: '2k_io.jpg' },
      { name: 'Europa', color: 0xeeeeee, size: 0.218, distance: 19, speed: 0.00399, texture: '2k_europa.jpg' },
      { name: 'Ganymede', color: 0xaaaaaa, size: 0.368, distance: 27, speed: 0.00198, texture: '2k_ganymede.jpg' },
      { name: 'Callisto', color: 0x666666, size: 0.337, distance: 39, speed: 0.000848, texture: '2k_callisto.jpg' }
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
      // Inner moons (Metis, Adrastea, Amalthea, Thebe) orbit at 1.8-3.1 Rj = 18-31 scene units
      // Irregular moons (Himalia group, retrograde groups) orbit much farther out
      // We distribute: ~8 inner (12-17), rest spread from Callisto outward (40-90)
      const isInner = i < 8;
      const distance = isInner ? 12 + Math.random() * 5 : 40 + Math.random() * 50;
      const speed = (Math.random() * 0.005 + 0.001) * (Math.random() > 0.5 ? 1 : -1);
      const angle = Math.random() * Math.PI * 2;
      // Inner moons have low inclination; irregular moons can be highly inclined or retrograde
      const inclination = isInner
        ? (Math.random() - 0.5) * 0.1  // near-equatorial
        : (Math.random() - 0.5) * Math.PI * 0.8; // Up to ~72° (some retrograde)
      
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

    // Lighting — physically motivated but cinematic
    // Deep space has virtually no ambient light; minimal fill preserves realism
    const ambientLight = new THREE.AmbientLight(0x050510, 0.25);
    this.scene.add(ambientLight);

    // Main sun light — warm white (5778K blackbody close to 0xfff5e0)
    // Directional to simulate parallel sun rays at Jupiter's distance.
    const sunLight = new THREE.DirectionalLight(0xfff5e0, 3.2);
    sunLight.position.set(-50, 10, 30);
    this.scene.add(sunLight);

    // Point light at the Sun — natural inverse-square falloff for nearby objects
    // Creates realistic illumination gradient on planets close to the Sun
    const sunPointLight = new THREE.PointLight(0xffeedd, 8, 200, 1.5);
    sunPointLight.position.set(-50, 10, 30);
    this.scene.add(sunPointLight);

    // Dim blue-ish fill from opposite side — scattered light / ISM reflection
    const fillLight = new THREE.DirectionalLight(0x0d1a33, 0.35);
    fillLight.position.set(50, -10, -30);
    this.scene.add(fillLight);

    // Subtle overhead hemisphere fill for readability (warm above, dark below)
    const hemiLight = new THREE.HemisphereLight(0x0a0a18, 0x000000, 0.15);
    this.scene.add(hemiLight);

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

    // Post-processing setup (Film Grain, Vignette, Bloom & Color Grading)
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
          
          // Soft cinematic vignette — wide falloff for natural look
          float vignette = smoothstep(1.1, 0.25, dist * 1.1);
          
          // Fine organic film grain (subtle, not distracting)
          float grain = (random(vUv * 800.0 + mod(uTime, 10.0)) - 0.5) * 0.03;
          
          // Subtle anamorphic horizontal streak
          float streak = smoothstep(0.5, 0.0, abs(center.y)) * smoothstep(0.6, 0.3, abs(center.x)) * 0.012;
          
          vec4 overlayColor = vec4(0.0, 0.0, 0.0, 1.0 - vignette);
          
          // Cinematic color grading: warm highlights, cool shadows
          // Subtle teal in shadows (outer edges)
          overlayColor.r += dist * 0.025;
          overlayColor.g += dist * 0.008;
          overlayColor.b += dist * 0.035;
          
          overlayColor.rgb += grain;
          overlayColor.a += abs(grain) * 0.3;
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

    // SpaceX Falcon 9 rocket (launches from Earth during tour)
    this.falconGroup = this.buildFalcon9();
    this.scene.add(this.falconGroup);

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

    // Subtle labels on all celestial bodies (must be after createSun)
    this.createCelestialLabels();

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
        // Accumulate cinematic drift (slow continuous camera creep within each slide)
        this.cameraDriftX += this.cameraDriftSpeedX;
        this.cameraDriftY += this.cameraDriftSpeedY;
        this.cameraDriftZ += this.cameraDriftSpeedZ;

        // Slide-driven camera with mouse parallax + cinematic drift
        this.targetCameraX = this.baseCameraX + this.mouseX * 3 + this.cameraDriftX;
        this.targetCameraY = this.baseCameraY + this.mouseY * 3 + this.cameraDriftY;
        this.targetCameraZ = this.baseCameraZ + this.cameraDriftZ;

        this.camera.position.x += (this.targetCameraX - this.camera.position.x) * this.cameraLerpSpeed;
        this.camera.position.y += (this.targetCameraY - this.camera.position.y) * this.cameraLerpSpeed;
        this.camera.position.z += (this.targetCameraZ - this.camera.position.z) * this.cameraLerpSpeed;

        this.currentLookAt.lerp(this.targetLookAt, this.cameraLerpSpeed);
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
    // Orbits placed between moon orbits: Io=14, Europa=19, Ganymede=27, Callisto=39
    const configs = [
      { type: 'fighter', radius: 16, speed: 0.006, y: 2, incl: 0.15, scale: 0.6 },
      { type: 'fighter', radius: 22, speed: -0.004, y: -1, incl: -0.2, scale: 0.5 },
      { type: 'fighter', radius: 17, speed: 0.005, y: 3.5, incl: 0.3, scale: 0.55 },
      { type: 'tie', radius: 24, speed: -0.005, y: -2, incl: 0.25, scale: 0.6 },
      { type: 'tie', radius: 32, speed: 0.003, y: 1.5, incl: -0.15, scale: 0.5 },
      { type: 'shuttle', radius: 35, speed: 0.002, y: 4, incl: 0.1, scale: 0.7 },
      { type: 'shuttle', radius: 42, speed: -0.0015, y: -3, incl: -0.18, scale: 0.6 },
      { type: 'fighter', radius: 50, speed: 0.003, y: 7, incl: 0.4, scale: 0.4 },
      { type: 'tie', radius: 55, speed: -0.002, y: -5, incl: -0.35, scale: 0.4 },
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

  private buildFalcon9(): THREE.Group {
    const group = new THREE.Group();

    // First stage — tall white cylinder (Falcon 9 is ~70m tall, we use ~0.5 scene units)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.4 });
    const firstStage = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.32, 12), bodyMat);
    firstStage.position.y = 0.16;
    group.add(firstStage);

    // Grid fins (4 small rectangles at base of first stage)
    const finMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.003), finMat);
      const angle = (i * Math.PI) / 2;
      fin.position.set(Math.cos(angle) * 0.03, 0.28, Math.sin(angle) * 0.03);
      fin.rotation.y = angle;
      group.add(fin);
    }

    // Interstage — dark band
    const interMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const interstage = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), interMat);
    interstage.position.y = 0.335;
    group.add(interstage);

    // Second stage — shorter white cylinder
    const secondStage = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.025, 0.12, 12), bodyMat);
    secondStage.position.y = 0.41;
    group.add(secondStage);

    // Payload fairing — nose cone
    const fairingMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.25, metalness: 0.3 });
    const fairing = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.07, 12), fairingMat);
    fairing.position.y = 0.505;
    group.add(fairing);

    // SpaceX logo strip — subtle dark band on first stage
    const logoStrip = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.02, 12), interMat);
    logoStrip.position.y = 0.12;
    group.add(logoStrip);

    // Landing legs (4 folded legs at base)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.06, 0.015), legMat);
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      leg.position.set(Math.cos(angle) * 0.035, 0.01, Math.sin(angle) * 0.035);
      leg.rotation.x = 0.3;
      leg.rotation.y = angle;
      group.add(leg);
    }

    // Nine Merlin engines at base (octaweb pattern) — small glowing circles
    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x444444, roughness: 0.4, metalness: 0.8,
      emissive: 0x331100, emissiveIntensity: 0.3
    });
    for (let i = 0; i < 9; i++) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.015, 8), engineMat);
      if (i === 0) {
        eng.position.set(0, -0.005, 0); // Center engine
      } else {
        const angle = ((i - 1) * Math.PI * 2) / 8;
        eng.position.set(Math.cos(angle) * 0.016, -0.005, Math.sin(angle) * 0.016);
      }
      group.add(eng);
    }

    // Exhaust plume — fiery cone pointing downward
    const exhaustMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float dist = length(vUv - vec2(0.5, 0.0));
          float core = smoothstep(0.5, 0.0, dist);
          // Hot white core → orange → red → transparent
          vec3 col = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.95, 0.8), core * core);
          float flicker = 0.85 + 0.15 * sin(uTime * 30.0 + vUv.y * 20.0);
          float alpha = core * flicker * smoothstep(1.0, 0.0, vUv.y);
          gl_FragColor = vec4(col, alpha * 0.9);
        }`,
      uniforms: { uTime: { value: 0 } },
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.falconExhaust = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.25, 12, 1, true), exhaustMat);
    this.falconExhaust.position.y = -0.14;
    this.falconExhaust.rotation.x = Math.PI; // Flip so tip faces down
    this.falconExhaust.visible = false;
    group.add(this.falconExhaust);

    // Exhaust glow (point light for dramatic lighting)
    const exhaustLight = new THREE.PointLight(0xff6622, 0, 3, 2);
    exhaustLight.name = 'exhaustLight';
    this.falconExhaust.add(exhaustLight);

    group.visible = false;
    return group;
  }

  private launchFalcon9() {
    if (!this.falconGroup || !this.earthMesh || !this.marsMesh) return;
    // Position at Earth's surface
    const earthPos = this.earthMesh.position;
    this.falconGroup.position.set(earthPos.x + 0.6, earthPos.y + 0.85, earthPos.z + 0.6);
    this.falconGroup.visible = true;
    this.falconExhaust.visible = true;
    this.falconLaunched = true;
    this.falconLaunchTime = (Date.now() - this.startTime) * 0.001;
    // Start and end positions
    this.falconStartPos.copy(this.falconGroup.position);
    this.falconTargetPos.copy(this.marsMesh.position);
    // Point exhaust light on
    const light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
    if (light) light.intensity = 4;
  }

  private updateFalcon9(time: number) {
    if (!this.falconLaunched || !this.falconGroup) return;

    const elapsed = time - this.falconLaunchTime;
    const totalDuration = 25; // seconds for full journey
    const t = Math.min(elapsed / totalDuration, 1);

    // Ease: slow start (liftoff), accelerate, then cruise
    const ease = t < 0.15 ? (t / 0.15) * (t / 0.15) * 0.15 : 0.15 + (t - 0.15) * (0.85 / 0.85);

    if (t < 0.08) {
      // Phase 1: Liftoff — straight up from Earth
      const liftT = t / 0.08;
      const liftEase = liftT * liftT; // Accelerating upward
      this.falconGroup.position.lerpVectors(
        this.falconStartPos,
        new THREE.Vector3(this.falconStartPos.x, this.falconStartPos.y + 3, this.falconStartPos.z),
        liftEase
      );
    } else if (t < 0.2) {
      // Phase 2: Gravity turn — arc over toward Mars
      const turnT = (t - 0.08) / 0.12;
      const above = new THREE.Vector3(this.falconStartPos.x, this.falconStartPos.y + 3, this.falconStartPos.z);
      const midpoint = new THREE.Vector3().lerpVectors(this.falconStartPos, this.falconTargetPos, 0.15);
      midpoint.y += 8; // High arc above the plane
      this.falconGroup.position.lerpVectors(above, midpoint, turnT);
    } else {
      // Phase 3: Interplanetary cruise toward Mars
      const cruiseT = (t - 0.2) / 0.8;
      const cruiseEase = 1 - Math.pow(1 - cruiseT, 2); // Ease out
      const midpoint = new THREE.Vector3().lerpVectors(this.falconStartPos, this.falconTargetPos, 0.15);
      midpoint.y += 8;
      this.falconGroup.position.lerpVectors(midpoint, this.falconTargetPos, cruiseEase);
      // Scale down as it flies away to simulate distance
      const scale = Math.max(0.3, 1 - cruiseT * 0.7);
      this.falconGroup.scale.setScalar(scale);
    }

    // Orient rocket along velocity (look in direction of travel)
    if (t > 0.01) {
      const dir = new THREE.Vector3();
      if (t < 0.08) {
        dir.set(0, 1, 0);
      } else {
        dir.subVectors(this.falconTargetPos, this.falconGroup.position).normalize();
      }
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion();
      const mat4 = new THREE.Matrix4();
      mat4.lookAt(new THREE.Vector3(), dir, up);
      quat.setFromRotationMatrix(mat4);
      // Rocket's "up" is Y axis, but lookAt points Z forward, so rotate
      const adjust = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      quat.multiply(adjust);
      this.falconGroup.quaternion.slerp(quat, 0.05);
    }

    // Exhaust animation
    if (this.falconExhaust) {
      const mat = this.falconExhaust.material as THREE.ShaderMaterial;
      mat.uniforms['uTime'].value = time;
      // Vary exhaust size with thrust
      const thrustScale = t < 0.15 ? 1.5 : 1;
      this.falconExhaust.scale.set(thrustScale, thrustScale * (1 + Math.sin(time * 20) * 0.1), thrustScale);
    }

    // Done
    if (t >= 1) {
      this.falconGroup.visible = false;
      this.falconExhaust.visible = false;
      this.falconLaunched = false;
    }
  }

  private createSolarSystemPlanets() {
    // Saturn — visible in far background
    // Saturn equatorial radius: 60,268 km → 60268/71492 × 10 = 8.43 scene units
    // Using correct relative size to Jupiter
    this.saturnGroup = new THREE.Group();
    const saturnGeo = new THREE.SphereGeometry(8.4, 64, 64);
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

    // Saturn's iconic rings (C ring inner to F ring outer)
    // Real: C ring at 1.24 Rs, A ring outer at 2.27 Rs → 10.4 to 19.1 scene units
    const innerR = 10.4, outerR = 19.1;
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

      // ─── Titan — Saturn's largest moon ───────────────────────────────────
      // Titan radius: 2575 km → 0.36 scene units. Orbit ~20 units from Saturn
      // (severely compressed; real orbit is ~1,221,865 km from Saturn center)
      const titanGeo = new THREE.SphereGeometry(0.5, 24, 24);
      const titanMat = new THREE.MeshStandardMaterial({
        color: 0xcc9944, roughness: 0.85, metalness: 0.05  // Orange-ish haze atmosphere
      });
      this.titanMesh = new THREE.Mesh(titanGeo, titanMat);
      // Initial position offset from Saturn
      const sp = this.saturnGroup.position;
      this.titanMesh.position.set(sp.x + 20, sp.y, sp.z);
      this.scene.add(this.titanMesh);
      // Load moon texture for Titan (reuse 2k_moon.jpg, tinted by material color)
      this.loadPromises.push(new Promise<void>((resolve) => {
        this.textureLoader.load('2k_moon.jpg', (tex) => {
          tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
          titanMat.map = tex;
          titanMat.color.setHex(0xcc9944); // Keep the warm orange tint
          titanMat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));

      // ─── Pluto — dwarf planet beyond Neptune ─────────────────────────────
      // Pluto radius: 1188 km → 0.17 scene units. Upscaled to 0.32 for visibility.
      // Position: farther from Neptune, highly inclined orbit
      const plutoGeo = new THREE.SphereGeometry(0.32, 20, 20);
      const plutoMat = new THREE.MeshStandardMaterial({
        color: 0xc4a882, roughness: 0.95, metalness: 0.0
      });
      this.plutoMesh = new THREE.Mesh(plutoGeo, plutoMat);
      this.plutoMesh.position.set(-240, -25, -220);
      this.scene.add(this.plutoMesh);
      this.loadPromises.push(new Promise<void>((resolve) => {
        this.textureLoader.load('2k_moon.jpg', (tex) => {
          tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
          plutoMat.map = tex;
          plutoMat.color.setHex(0xc4a882);
          plutoMat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));

    // Mars — small red dot in the inner solar system direction
    // Mars equatorial radius: 3,396 km → 3396/71492 × 10 = 0.475 scene units
    const marsGeo = new THREE.SphereGeometry(0.475, 32, 32);
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

    // Mars atmosphere (thin, subtle — real Mars atmosphere is only 1% of Earth's)
    const marsAtmoMat = new THREE.MeshBasicMaterial({
      color: 0xff6633, transparent: true, opacity: 0.05,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const marsAtmo = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 16), marsAtmoMat);
    this.marsMesh.add(marsAtmo);

    // Venus — inner solar system, near the Sun direction
    // Venus radius: 6,052 km → 6052/71492 × 10 = 0.846 scene units
    const venusGeo = new THREE.SphereGeometry(0.846, 48, 48);
    const venusMat = new THREE.MeshStandardMaterial({ color: 0xe8cda0, roughness: 0.7, metalness: 0.05 });
    this.venusMesh = new THREE.Mesh(venusGeo, venusMat);
    this.venusMesh.position.set(-42, 8, 25);
    this.scene.add(this.venusMesh);
    // Venus atmosphere texture (thick sulfuric acid clouds)
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_venus_atmosphere.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        venusMat.map = tex; venusMat.color.setHex(0xffffff); venusMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
    // Venus thick atmosphere glow — dual layer
    const venusAtmoMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal; varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPosition, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float fresnel = 1.0 - dot(viewDir, vNormal);
          fresnel = pow(fresnel, 2.5);
          vec3 col = mix(vec3(0.95, 0.85, 0.6), vec3(1.0, 0.92, 0.7), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.5);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.venusMesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.93, 32, 32), venusAtmoMat));

    // Mercury — smallest planet, closest to the Sun
    // Mercury radius: 2,440 km → 2440/71492 × 10 = 0.341 scene units
    const mercuryGeo = new THREE.SphereGeometry(0.341, 32, 32);
    const mercuryMat = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, roughness: 0.9, metalness: 0.15 });
    this.mercuryMesh = new THREE.Mesh(mercuryGeo, mercuryMat);
    this.mercuryMesh.position.set(-35, 5, 15);
    this.scene.add(this.mercuryMesh);
    // Mercury texture — cratered surface
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_mercury.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        mercuryMat.map = tex; mercuryMat.color.setHex(0xffffff); mercuryMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Uranus — distant ice giant, opposite direction from Sun
    // Uranus radius: 25,559 km → 25559/71492 × 10 = 3.575 scene units
    this.uranusGroup = new THREE.Group();
    const uranusGeo = new THREE.SphereGeometry(3.575, 48, 48);
    const uranusMat = new THREE.MeshStandardMaterial({ color: 0x9dd8d8, roughness: 0.4, metalness: 0.05 });
    this.uranusMesh = new THREE.Mesh(uranusGeo, uranusMat);
    this.uranusGroup.add(this.uranusMesh);
    // Uranus texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_uranus.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        uranusMat.map = tex; uranusMat.color.setHex(0xffffff); uranusMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
    // Uranus atmosphere glow (faint cyan)
    const uranusAtmoMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal; varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPosition, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float fresnel = 1.0 - dot(viewDir, vNormal);
          fresnel = pow(fresnel, 3.5);
          vec3 col = mix(vec3(0.5, 0.85, 0.9), vec3(0.7, 0.95, 1.0), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.4);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.uranusMesh.add(new THREE.Mesh(new THREE.SphereGeometry(3.85, 32, 32), uranusAtmoMat));
    // Uranus ring system — 13 narrow dark rings discovered by Voyager 2
    // Real: inner epsilon ring ~1.64 Ru to outer ~2.0 Ru → 5.86 to 7.15 scene units
    const uranusRingInner = 5.0, uranusRingOuter = 7.4;
    const uranusRingGeo = new THREE.RingGeometry(uranusRingInner, uranusRingOuter, 128, 4);
    const uranusRingCanvas = document.createElement('canvas');
    uranusRingCanvas.width = 512; uranusRingCanvas.height = 64;
    const uRCtx = uranusRingCanvas.getContext('2d')!;
    for (let x = 0; x < 512; x++) {
      const t = x / 512;
      let opacity = 0;
      // Narrow dark rings with gaps
      if (t > 0.05 && t < 0.08) opacity = 0.12;   // Ring 6
      if (t > 0.12 && t < 0.15) opacity = 0.1;    // Ring 5
      if (t > 0.2 && t < 0.24) opacity = 0.15;    // Ring 4
      if (t > 0.35 && t < 0.4) opacity = 0.12;    // Alpha ring
      if (t > 0.45 && t < 0.52) opacity = 0.14;   // Beta ring
      if (t > 0.6 && t < 0.65) opacity = 0.1;     // Eta ring
      if (t > 0.7 && t < 0.72) opacity = 0.08;    // Gamma ring
      if (t > 0.75 && t < 0.78) opacity = 0.09;   // Delta ring
      if (t > 0.82 && t < 0.95) opacity = 0.2 + Math.sin(t * 80) * 0.05; // Epsilon ring (brightest)
      uRCtx.fillStyle = `rgba(160,170,180,${opacity})`;
      uRCtx.fillRect(x, 0, 1, 64);
    }
    const uranusRingTex = new THREE.CanvasTexture(uranusRingCanvas);
    uranusRingTex.wrapS = THREE.ClampToEdgeWrapping;
    const uranusRingMat = new THREE.MeshBasicMaterial({
      map: uranusRingTex, transparent: true, side: THREE.DoubleSide, depthWrite: false
    });
    const urRingPos = uranusRingGeo.attributes['position'];
    const urRingUv = uranusRingGeo.attributes['uv'] as THREE.BufferAttribute;
    const urV3 = new THREE.Vector3();
    for (let i = 0; i < urRingPos.count; i++) {
      urV3.fromBufferAttribute(urRingPos as THREE.BufferAttribute, i);
      const dist = urV3.length();
      urRingUv.setXY(i, (dist - uranusRingInner) / (uranusRingOuter - uranusRingInner), 0.5);
    }
    const uranusRing = new THREE.Mesh(uranusRingGeo, uranusRingMat);
    uranusRing.rotation.x = Math.PI / 2; // Flat ring plane
    this.uranusGroup.add(uranusRing);
    this.uranusGroup.position.set(160, -10, 150);
    // Uranus is tilted 98° — rotates nearly on its side
    this.uranusGroup.rotation.z = 1.71;
    this.scene.add(this.uranusGroup);

    // Neptune — farthest giant planet
    // Neptune radius: 24,764 km → 24764/71492 × 10 = 3.464 scene units
    this.neptuneGroup = new THREE.Group();
    const neptuneGeo = new THREE.SphereGeometry(3.464, 48, 48);
    const neptuneMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.4, metalness: 0.05 });
    this.neptuneMesh = new THREE.Mesh(neptuneGeo, neptuneMat);
    this.neptuneGroup.add(this.neptuneMesh);
    // Neptune texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_neptune.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        neptuneMat.map = tex; neptuneMat.color.setHex(0xffffff); neptuneMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
    // Neptune atmosphere glow (deep blue)
    const neptuneAtmoMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal; varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPosition, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float fresnel = 1.0 - dot(viewDir, vNormal);
          fresnel = pow(fresnel, 3.0);
          vec3 col = mix(vec3(0.15, 0.3, 0.8), vec3(0.3, 0.5, 1.0), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.5);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.neptuneMesh.add(new THREE.Mesh(new THREE.SphereGeometry(3.75, 32, 32), neptuneAtmoMat));
    // Neptune ring system — faint ring arcs (Adams, Le Verrier, Galle)
    const neptuneRingInner = 4.6, neptuneRingOuter = 8.7;
    const neptuneRingGeo = new THREE.RingGeometry(neptuneRingInner, neptuneRingOuter, 128, 4);
    const neptuneRingCanvas = document.createElement('canvas');
    neptuneRingCanvas.width = 512; neptuneRingCanvas.height = 64;
    const nRCtx = neptuneRingCanvas.getContext('2d')!;
    for (let x = 0; x < 512; x++) {
      const t = x / 512;
      let opacity = 0;
      if (t > 0.05 && t < 0.15) opacity = 0.04; // Galle ring (faint)
      if (t > 0.35 && t < 0.42) opacity = 0.06; // Le Verrier ring
      if (t > 0.45 && t < 0.50) opacity = 0.03; // Lassell ring (faint)
      if (t > 0.75 && t < 0.82) opacity = 0.08 + Math.sin(t * 60) * 0.03; // Adams ring (with arcs)
      nRCtx.fillStyle = `rgba(140,150,170,${opacity})`;
      nRCtx.fillRect(x, 0, 1, 64);
    }
    const neptuneRingTex = new THREE.CanvasTexture(neptuneRingCanvas);
    neptuneRingTex.wrapS = THREE.ClampToEdgeWrapping;
    const neptuneRingMat = new THREE.MeshBasicMaterial({
      map: neptuneRingTex, transparent: true, side: THREE.DoubleSide, depthWrite: false
    });
    const npRingPos = neptuneRingGeo.attributes['position'];
    const npRingUv = neptuneRingGeo.attributes['uv'] as THREE.BufferAttribute;
    const npV3 = new THREE.Vector3();
    for (let i = 0; i < npRingPos.count; i++) {
      npV3.fromBufferAttribute(npRingPos as THREE.BufferAttribute, i);
      const dist = npV3.length();
      npRingUv.setXY(i, (dist - neptuneRingInner) / (neptuneRingOuter - neptuneRingInner), 0.5);
    }
    const neptuneRing = new THREE.Mesh(neptuneRingGeo, neptuneRingMat);
    neptuneRing.rotation.x = Math.PI / 2;
    this.neptuneGroup.add(neptuneRing);
    this.neptuneGroup.position.set(-180, 15, -160);
    this.neptuneGroup.rotation.z = 0.494; // Neptune tilt: 28.3°
    this.scene.add(this.neptuneGroup);

  }

  private createLabelSprite(text: string, scale: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = '600 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Subtle glow behind text
    ctx.shadowColor = 'rgba(180,200,255,0.5)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(220,230,255,0.7)';
    ctx.fillText(text, 128, 32);
    // Second pass for crispness
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(220,230,255,0.55)';
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, fog: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(scale * 4, scale, 1);
    this.labelSprites.push(sprite);
    return sprite;
  }

  private createCelestialLabels() {
    // Jupiter label — attached above Jupiter in the jupiterGroup
    const jupLabel = this.createLabelSprite('Jupiter', 3);
    jupLabel.position.set(0, 13, 0);
    this.jupiterGroup.add(jupLabel);

    // Galilean moon labels
    const moonNames = ['Io', 'Europa', 'Ganymede', 'Callisto'];
    this.galileanMoons.forEach((moon, i) => {
      const label = this.createLabelSprite(moonNames[i], 0.8);
      label.position.set(0, (moon.mesh.geometry as THREE.SphereGeometry).parameters.radius + 0.5, 0);
      moon.mesh.add(label);
    });

    // Sun
    const sunLabel = this.createLabelSprite('Zon', 2.5);
    sunLabel.position.set(0, 9, 0);
    this.sunMesh.add(sunLabel);

    // Earth
    const earthLabel = this.createLabelSprite('Aarde', 1.2);
    earthLabel.position.set(0, 1.8, 0);
    this.earthMesh.add(earthLabel);

    // Saturn
    const saturnLabel = this.createLabelSprite('Saturnus', 2.5);
    saturnLabel.position.set(0, 12, 0);
    this.saturnGroup.add(saturnLabel);

    // Mars
    const marsLabel = this.createLabelSprite('Mars', 1);
    marsLabel.position.set(0, 1.2, 0);
    this.marsMesh.add(marsLabel);

    // Venus
    const venusLabel = this.createLabelSprite('Venus', 1);
    venusLabel.position.set(0, 1.5, 0);
    this.venusMesh.add(venusLabel);

    // Mercury
    const mercuryLabel = this.createLabelSprite('Mercurius', 0.8);
    mercuryLabel.position.set(0, 1, 0);
    this.mercuryMesh.add(mercuryLabel);

    // Uranus
    const uranusLabel = this.createLabelSprite('Uranus', 1.8);
    uranusLabel.position.set(0, 5, 0);
    this.uranusMesh.add(uranusLabel);

    // Neptune
    const neptuneLabel = this.createLabelSprite('Neptunus', 1.8);
    neptuneLabel.position.set(0, 5, 0);
    this.neptuneMesh.add(neptuneLabel);
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
    // Distances match compressed orbital distances from galileanConfigs
    const distances = [14, 19, 27, 39];
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
    // The Sun — realistic multi-layer star at (-50, 10, 30)
    // Real: Sun radius 696,000 km = 97.4 Rj — would fill entire scene
    // Using artistic size (6 units) large enough to be prominent but not overwhelming
    const sunRadius = 6;

    // Photosphere — animated surface with limb darkening + granulation turbulence
    const sunGeo = new THREE.SphereGeometry(sunRadius, 64, 64);
    const sunMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunTex: { value: null as THREE.Texture | null }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec2 vUv;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vUv = uv;
          vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uSunTex;
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec2 vUv;

        // Simplex-like hash noise for granulation
        vec3 hash3(vec3 p) {
          p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
          return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
        }
        float noise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)), u.x),
                         mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)), u.x), u.y),
                     mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)), u.x),
                         mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)), u.x), u.y), u.z);
        }
        float fbm(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.0; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 viewDir = normalize(-vPos);
          float NdotV = dot(viewDir, vNormal);
          
          // Limb darkening — realistic solar profile (Neckel & Labs coefficients approximation)
          float mu = max(NdotV, 0.0);
          float limbDark = 0.3 + 0.93 * mu - 0.23 * mu * mu;
          
          // Base texture
          vec4 baseTex = texture2D(uSunTex, vUv);
          vec3 baseColor = baseTex.rgb;
          
          // Animated granulation turbulence — convection cells on surface
          vec3 noiseCoord = vec3(vUv * 8.0, uTime * 0.03);
          float granulation = fbm(noiseCoord) * 0.15;
          
          // Sunspot-like dark patches (slow drift)
          float spots = smoothstep(0.35, 0.5, fbm(vec3(vUv * 3.0, uTime * 0.008)));
          
          // Color temperature variation (hotter center = whiter, cooler limb = redder)
          vec3 hotColor = vec3(1.0, 0.98, 0.92);  // ~6000K white-yellow
          vec3 coolColor = vec3(1.0, 0.7, 0.3);    // ~4500K reddish
          vec3 tempColor = mix(coolColor, hotColor, mu * 0.8 + 0.2);
          
          vec3 finalColor = baseColor * tempColor * limbDark;
          finalColor += granulation * vec3(1.0, 0.85, 0.5);
          finalColor *= (1.0 - spots * 0.15); // Darken in sunspot regions
          
          // Bright HDR emission — push beyond 1.0 for tone mapping bloom
          finalColor *= 2.5;
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      fog: false
    });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.position.set(-50, 10, 30);

    // Load Sun texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_sun.jpg', (tex) => {
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
        sunMat.uniforms['uSunTex'].value = tex;
        sunMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Chromosphere — thin bright reddish layer just above photosphere (Hα emission)
    const chromoGeo = new THREE.SphereGeometry(sunRadius * 1.02, 48, 48);
    const chromoMat = new THREE.ShaderMaterial({
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
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vec3 viewDir = normalize(-vPos);
          float rim = 1.0 - dot(viewDir, vNormal);
          // Thin bright ring at the very edge — Hα red-pink emission
          float chromo = pow(rim, 6.0) * 3.0;
          vec3 color = mix(vec3(1.0, 0.3, 0.15), vec3(1.0, 0.5, 0.3), rim);
          gl_FragColor = vec4(color * 2.0, chromo * 0.8);
        }
      `,
      transparent: true, side: THREE.FrontSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.sunMesh.add(new THREE.Mesh(chromoGeo, chromoMat));

    // Inner corona (K-corona — electron-scattered white light)
    const coronaInnerGeo = new THREE.SphereGeometry(sunRadius * 1.7, 48, 48);
    const coronaInnerMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec2 vUv;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vUv = uv;
          vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec2 vUv;

        // Simple noise for coronal streamers
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise2(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }

        void main() {
          vec3 viewDir = normalize(-vPos);
          float rim = 1.0 - dot(viewDir, vNormal);
          
          // Radial coronal streamers — asymmetric, slowly rotating
          float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
          float streamers = 0.5 + 0.5 * sin(angle * 4.0 + uTime * 0.1);
          streamers *= 0.7 + 0.3 * noise2(vec2(angle * 3.0, uTime * 0.05));
          
          // Corona intensity falls off as ~r^-2.5
          float corona = pow(rim, 1.8) * 2.0;
          corona *= (0.6 + 0.4 * streamers);
          
          // Pearly white with slight warm tint
          vec3 color = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.8, 0.5), rim * 0.5);
          
          gl_FragColor = vec4(color * 1.5, corona * 0.5);
        }
      `,
      transparent: true, side: THREE.BackSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const coronaInner = new THREE.Mesh(coronaInnerGeo, coronaInnerMat);
    this.sunMesh.add(coronaInner);

    // Outer corona (F-corona — dust-scattered, very faint extended halo)
    const coronaOuterGeo = new THREE.SphereGeometry(sunRadius * 3.5, 32, 32);
    const coronaOuterMat = new THREE.ShaderMaterial({
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
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vec3 viewDir = normalize(-vPos);
          float rim = 1.0 - dot(viewDir, vNormal);
          float corona = pow(rim, 1.5) * 0.8;
          // Slow breathing
          corona *= 0.9 + 0.1 * sin(uTime * 0.3);
          vec3 color = vec3(1.0, 0.88, 0.65);
          gl_FragColor = vec4(color, corona * 0.12);
        }
      `,
      transparent: true, side: THREE.BackSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.sunMesh.add(new THREE.Mesh(coronaOuterGeo, coronaOuterMat));

    // God-rays / volumetric light cone (subtle directional glow toward camera)
    const godRayGeo = new THREE.SphereGeometry(sunRadius * 5, 16, 16);
    const godRayMat = new THREE.ShaderMaterial({
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
          float facing = max(dot(viewDir, vNormal), 0.0);
          float glow = pow(facing, 3.0) * 0.15;
          vec3 color = vec3(1.0, 0.92, 0.7);
          gl_FragColor = vec4(color, glow);
        }
      `,
      transparent: true, side: THREE.BackSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.sunMesh.add(new THREE.Mesh(godRayGeo, godRayMat));

    this.scene.add(this.sunMesh);
  }

  /** Random polar-region theta angle (favoring north/south poles per Juno data) */
  private polarTheta(): number {
    return Math.random() > 0.5 ? Math.random() * 0.5 : Math.PI - Math.random() * 0.5;
  }

  private createLightning() {
    // Jupiter has real lightning, discovered by Voyager 1 (1979), confirmed by Juno (2018)
    // Juno found lightning is more frequent near poles and occurs in ammonia-water clouds
    // Color: blue-white (similar to Earth but in hydrogen atmosphere)
    // Sun at (-50, 10, 30) → night side faces roughly (+x, -y, -z)

    for (let i = 0; i < 8; i++) {
      // Random positions on the night-side hemisphere, concentrated near poles (Juno finding)
      const isPolar = Math.random() > 0.4;
      const theta = isPolar
        ? this.polarTheta()
        : Math.random() * Math.PI * 0.6 + Math.PI * 0.2; // mid-latitude
      const phi = Math.random() * Math.PI - Math.PI * 0.5;
      const r = 10.05;

      const x = r * Math.sin(theta) * Math.cos(phi + Math.PI);
      const y = r * Math.cos(theta);
      const z = r * Math.sin(theta) * Math.sin(phi + Math.PI);

      // Branching bolt geometry — line segments forming a jagged bolt
      const boltGroup = new THREE.Group();
      boltGroup.position.set(x, y, z);

      // Orient bolt outward from Jupiter center
      boltGroup.lookAt(x * 2, y * 2, z * 2);

      // Main bolt + 2-3 branches
      const branchCount = 1 + Math.floor(Math.random() * 3);
      for (let b = 0; b < branchCount; b++) {
        const points: THREE.Vector3[] = [];
        const segments = 6 + Math.floor(Math.random() * 4);
        let px = (b === 0) ? 0 : (Math.random() - 0.5) * 0.3;
        let py = (b === 0) ? 0 : (Math.random() - 0.5) * 0.3;
        let pz = 0;
        const boltLen = (b === 0) ? 0.6 + Math.random() * 0.4 : 0.2 + Math.random() * 0.3;
        for (let s = 0; s <= segments; s++) {
          points.push(new THREE.Vector3(px, py, pz));
          px += (Math.random() - 0.5) * 0.15;
          py += (Math.random() - 0.5) * 0.15;
          pz += boltLen / segments;
        }
        const boltGeo = new THREE.BufferGeometry().setFromPoints(points);
        const boltMat = new THREE.LineBasicMaterial({
          color: b === 0 ? 0xaaccff : 0x6688dd,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          linewidth: 1
        });
        boltGroup.add(new THREE.Line(boltGeo, boltMat));
      }

      // Cloud illumination glow sphere under the bolt
      const glowGeo = new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 12, 12);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x8899cc,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      boltGroup.add(glowMesh);

      // Small point light for illuminating nearby clouds
      const boltLight = new THREE.PointLight(0x88aaff, 0, 3);
      boltGroup.add(boltLight);

      this.jupiterGroup.add(boltGroup);
      this.lightningFlashes.push({
        mesh: boltGroup as unknown as THREE.Mesh, // group stored in mesh field
        timer: 0,
        cooldown: 80 + Math.random() * 300
      });
    }
  }

  private updateLightning() {
    this.lightningFlashes.forEach(lf => {
      lf.timer++;
      if (lf.timer >= lf.cooldown) {
        const flashDuration = 6 + Math.random() * 10;
        const flashAge = lf.timer - lf.cooldown;
        const group = lf.mesh as unknown as THREE.Group;

        if (flashAge < flashDuration) {
          // Realistic multi-stroke flicker pattern
          // Real lightning has a leader + 2-4 return strokes within ~0.2s
          const strokePhase = flashAge / flashDuration;
          const isReturnStroke = Math.sin(strokePhase * Math.PI * 8) > 0;
          const baseIntensity = (1 - strokePhase) * (isReturnStroke ? 1 : 0.15);
          const flicker = baseIntensity * (0.5 + Math.random() * 0.5);

          // Update bolt lines
          group.children.forEach(child => {
            if (child instanceof THREE.Line) {
              (child.material as THREE.LineBasicMaterial).opacity = flicker * 0.9;
            } else if (child instanceof THREE.Mesh) {
              (child.material as THREE.MeshBasicMaterial).opacity = flicker * 0.4;
            } else if (child instanceof THREE.PointLight) {
              child.intensity = flicker * 8;
            }
          });
        } else {
          // All off
          group.children.forEach(child => {
            if (child instanceof THREE.Line) {
              (child.material as THREE.LineBasicMaterial).opacity = 0;
            } else if (child instanceof THREE.Mesh) {
              (child.material as THREE.MeshBasicMaterial).opacity = 0;
            } else if (child instanceof THREE.PointLight) {
              child.intensity = 0;
            }
          });
          lf.timer = 0;
          lf.cooldown = 80 + Math.random() * 300;
          // Regenerate bolt geometry for next flash (different path)
          group.children.forEach(child => {
            if (child instanceof THREE.Line) {
              const points: THREE.Vector3[] = [];
              const segments = 6 + Math.floor(Math.random() * 4);
              let px = (Math.random() - 0.5) * 0.3;
              let py = (Math.random() - 0.5) * 0.3;
              let pz = 0;
              const boltLen = 0.3 + Math.random() * 0.5;
              for (let s = 0; s <= segments; s++) {
                points.push(new THREE.Vector3(px, py, pz));
                px += (Math.random() - 0.5) * 0.15;
                py += (Math.random() - 0.5) * 0.15;
                pz += boltLen / segments;
              }
              child.geometry.dispose();
              child.geometry = new THREE.BufferGeometry().setFromPoints(points);
            }
          });
          // Reposition on night side
          const isPolar = Math.random() > 0.4;
          const theta = isPolar
            ? this.polarTheta()
            : Math.random() * Math.PI * 0.6 + Math.PI * 0.2;
          const phi = Math.random() * Math.PI - Math.PI * 0.5;
          const r = 10.05;
          const nx = r * Math.sin(theta) * Math.cos(phi + Math.PI);
          const ny = r * Math.cos(theta);
          const nz = r * Math.sin(theta) * Math.sin(phi + Math.PI);
          group.position.set(nx, ny, nz);
          group.lookAt(nx * 2, ny * 2, nz * 2);
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
    // Europa is moon index 1, size 0.218 → plumes extend ~2x moon radius
    const plumeCount = 60;
    const plumeGeo = new THREE.BufferGeometry();
    const plumePos = new Float32Array(plumeCount * 3);
    const plumeSpeeds = new Float32Array(plumeCount);

    for (let i = 0; i < plumeCount; i++) {
      // Cluster around the south pole region (where plumes were observed)
      const spread = 0.15;
      plumePos[i * 3] = (Math.random() - 0.5) * spread;
      plumePos[i * 3 + 1] = -(0.218 + Math.random() * 0.5); // below moon, shooting down
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
    // Inner belt peaks at ~1.5-3 Rj = 15-30 scene units from center
    const beltGeo = new THREE.TorusGeometry(20, 6, 32, 96);
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

    // Lerp contextual animation values (speed matches camera for cohesive feel)
    const contextLerp = Math.min(this.cameraLerpSpeed * 0.8, 0.04);
    this.currentStarSpeed += (this.targetStarSpeed - this.currentStarSpeed) * contextLerp;
    this.currentMoonSpeedMultiplier += (this.targetMoonSpeedMultiplier - this.currentMoonSpeedMultiplier) * contextLerp;
    this.currentAtmospherePulse += (this.targetAtmospherePulse - this.currentAtmospherePulse) * 0.05;
    this.currentJupiterSpinSpeed += (this.targetJupiterSpinSpeed - this.currentJupiterSpinSpeed) * contextLerp;
    this.currentShipSpeedMultiplier += (this.targetShipSpeedMultiplier - this.currentShipSpeedMultiplier) * contextLerp;

    this.updateAtmosphere(time);
    if (this.tourActive) this.updatePlanetTour(time);
    this.updateFalcon9(time);
    this.updateCamera();
    this.updateJupiterRotation();

    if (this.earthMesh?.visible) {
      this.earthMesh.rotation.y += 0.005;
      if (this.earthOrbitActive) {
        this.updateEarthOrbit();
      }
    }

      // Moon follows Earth, always visible when Earth is visible
      if (this.moonMesh) {
        const earthVisible = this.earthMesh?.visible ?? false;
        this.moonMesh.visible = earthVisible;
        if (earthVisible && this.earthMesh) {
          this.moonOrbitAngle += 0.008; // Faster than Earth orbit for visual clarity
          const ep = this.earthMesh.position;
          this.moonMesh.position.set(
            ep.x + 2.8 * Math.cos(this.moonOrbitAngle),
            ep.y + 0.3 * Math.sin(this.moonOrbitAngle * 0.5),
            ep.z + 2.8 * Math.sin(this.moonOrbitAngle)
          );
          this.moonMesh.rotation.y += 0.002;
        }
      }

      // Titan orbits Saturn
      if (this.titanMesh && this.saturnGroup) {
        this.titanOrbitAngle += 0.003;
        const sPos = this.saturnGroup.position;
        this.titanMesh.position.set(
          sPos.x + 22 * Math.cos(this.titanOrbitAngle),
          sPos.y + 1.5 * Math.sin(this.titanOrbitAngle * 0.4),
          sPos.z + 22 * Math.sin(this.titanOrbitAngle)
        );
        this.titanMesh.rotation.y += 0.002;
      }
      // Rotate Pluto slowly
      if (this.plutoMesh) {
        this.plutoMesh.rotation.y += 0.0008;
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
    // Rotate Venus (retrograde, very slow)
    if (this.venusMesh) {
      this.venusMesh.rotation.y -= 0.0003;
    }
    // Rotate Mercury
    if (this.mercuryMesh) {
      this.mercuryMesh.rotation.y += 0.001;
    }
    // Rotate Uranus (sideways)
    if (this.uranusMesh) {
      this.uranusMesh.rotation.y += 0.0004;
    }
    // Rotate Neptune
    if (this.neptuneMesh) {
      this.neptuneMesh.rotation.y += 0.0004;
    }
    // Rotate Earth cloud layer (slightly faster than Earth itself)
    if (this.earthCloudsMesh) {
      this.earthCloudsMesh.rotation.y += 0.0006;
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

    // Sun surface + corona animation
    if (this.sunMesh) {
      // Photosphere shader time (granulation + sunspot drift)
      const sunShader = (this.sunMesh.material as THREE.ShaderMaterial);
      if (sunShader.uniforms) sunShader.uniforms['uTime'].value = time;

      // Chromosphere (child 0) — subtle flicker
      const chromo = this.sunMesh.children[0];
      if (chromo) {
        const chromoMat = (chromo as THREE.Mesh).material as THREE.ShaderMaterial;
        if (chromoMat.uniforms) chromoMat.uniforms['uTime'].value = time;
      }

      // Inner corona (child 1) — slow rotation + breathing with streamer animation
      const coronaInner = this.sunMesh.children[1];
      if (coronaInner) {
        const ciMat = (coronaInner as THREE.Mesh).material as THREE.ShaderMaterial;
        if (ciMat.uniforms) ciMat.uniforms['uTime'].value = time;
        const s1 = 1 + Math.sin(time * 0.4) * 0.03 + Math.sin(time * 0.17) * 0.015;
        coronaInner.scale.set(s1, s1, s1);
        coronaInner.rotation.y = time * 0.02;
      }

      // Outer corona (child 2) — slow breathing
      const coronaOuter = this.sunMesh.children[2];
      if (coronaOuter) {
        const coMat = (coronaOuter as THREE.Mesh).material as THREE.ShaderMaterial;
        if (coMat.uniforms) coMat.uniforms['uTime'].value = time;
        const s2 = 1 + Math.sin(time * 0.25) * 0.04;
        coronaOuter.scale.set(s2, s2, s2);
      }

      // Slow self-rotation of the Sun (~25 day period, sped up for visual)
      this.sunMesh.rotation.y = time * 0.01;
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
